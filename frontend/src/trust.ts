import { randomUUID } from 'node:crypto';
import { keypair, fingerprint, seal, verifyEnvelope, requestPayload, resultPayload, validKey } from '../../shared/signing.ts';
import type { SignedEnvelope, SignedKind } from '../../shared/signing.ts';
import type { Verification } from '../../shared/protocol.ts';
import type { State, Store } from './store.ts';

export interface PeerKey {network_id:string;member_id:string;device_id:string;public_key:string;device_revoked_at?:number|null;member_revoked_at?:number|null}
export interface Pin {network_id:string;member_id:string;device_id:string;public_key:string;pending_key?:string;blocked:boolean;revoked:boolean;confirmed:boolean}
export function ensureIdentity(store:Store){if(!store.state.signing){store.state.signing=keypair();store.save();}return store.state.signing;}
export function identity(store:Store){const s=store.state;if(!s.member?.network_id||!s.device?.id)throw Error('Join a network before signing messages');return {...ensureIdentity(store),network_id:s.member.network_id,member_id:s.member.id,device_id:s.device.id};}
export function observeKeys(store:Store,keys:PeerKey[]){
  const s=store.state;s.trust ||= {};
  if(!Array.isArray(keys)||keys.some(k=>!k||!validKey(k.public_key)||typeof k.device_id!=='string'||typeof k.member_id!=='string'))throw Error('Invalid device key roster');
  for(const k of keys){
    if(k.network_id!==s.member?.network_id)continue;
    const key=k.network_id+':'+k.device_id,previous=s.trust[key];
    if(previous){
      if(previous.member_id!==k.member_id){previous.blocked=true;continue;}
      previous.revoked=!!(k.device_revoked_at||k.member_revoked_at);
      // A changed key never silently becomes trusted again after roster changes.
      if(previous.public_key!==k.public_key)previous.pending_key=k.public_key;
    }else{
      const existing=Object.values(s.trust).some(p=>p.network_id===k.network_id&&p.member_id===k.member_id);
      s.trust[key]={...k,blocked:false,revoked:!!(k.device_revoked_at||k.member_revoked_at),confirmed:false,...(existing?{public_key:'',pending_key:k.public_key}:{})};
    }
  }
  store.save();
}
export function verification(state:State,e:SignedEnvelope|undefined,kind:SignedKind,payload:any,sender:string):Verification {
  const result=(status:Verification['status'],detail:string):Verification=>({status,detail,...(validKey(e?.public_key)?{fingerprint:fingerprint(e!.public_key)}:{})});
  if(!e)return result('unsigned','Legacy unsigned content; cannot authorize execution. Ask the sender to submit a new signed request.');
  if(e.kind!==kind||e.network_id!==state.member?.network_id||e.member_id!==sender||!verifyEnvelope(e,payload))return result('invalid','Signature or signed routing/content does not match.');
  if(e.device_id===state.device?.id&&e.member_id===state.member?.id&&e.public_key===state.signing?.public_key)return result('verified','Signed by this device.');
  const pin=state.trust?.[e.network_id+':'+e.device_id];
  if(!pin||pin.member_id!==sender)return result('unknown_key','Sender device is not in the locally trusted roster; refresh the connection.');
  if(pin.blocked)return result('blocked','Device blocked locally.');
  if(pin.revoked)return result('revoked','Device or member is revoked.');
  if(pin.pending_key||pin.public_key!==e.public_key)return result('key_changed','Device key changed or a new device needs confirmation in Settings.');
  return result('verified',pin.confirmed?'Signature verified against a confirmed fingerprint.':'Signature verified using first-contact trust; fingerprint not independently confirmed.');
}
export function verifyRequest(state:State,r:any):Verification {
  if(r.signature&&(r.signature.id!==r.id||r.signature.network_id!==r.network_id))return {status:'invalid',detail:'Request ID or network does not match signed identity.'};
  return verification(state,r.signature,'request',requestPayload(r),r.sender_member_id);
}
export function requireVerified(state:State,r:any){const v=verifyRequest(state,r);if(v.status!=='verified')throw Error('Request not verified: '+v.detail);}
export function verifyMessage(store:Store,m:any):Verification {
  const v=verification(store.state,m.signature,'message',{body:m.body},m.sender_member_id);
  if(v.status!=='verified')return v;
  if(m.network_id!==m.signature.network_id)return {status:'invalid',detail:'Message network does not match signature.'};
  const receipts=store.state.message_receipts ||= {},key=m.signature.network_id+':'+m.signature.id;
  if(receipts[key]&&receipts[key]!==String(m.id))return {status:'invalid',detail:'Replay: same signed message appeared under another record ID.'};
  if(!receipts[key]){receipts[key]=String(m.id);store.save();}
  return v;
}
export function signOutgoing(store:Store,path:string,body:any){
  if(body.signature)return body;
  let kind:SignedKind,payload:any;const id=randomUUID();
  if(path==='/v1/messages'){kind='message';payload={body:body.body};}
  else if(path==='/v1/requests'){
    kind='request';payload=requestPayload({...body,id,owner_member_id:body.recipient_member_id??store.state.repos.find(r=>r.id===body.repo_id)?.owner_member_id});
  }else if(/^\/v1\/requests\/[^/]+\/complete$/.test(path)){
    const r=store.state.requests.find(r=>r.id===path.split('/')[3]);if(!r)throw Error('Cannot sign a result without its original request');
    requireVerified(store.state,r);kind='result';payload=resultPayload(r,body.result);
  }else return body;
  return {...body,signature:seal(identity(store),kind,payload,id)};
}
export function trustView(store:Store){const s=store.state;return {own_fingerprint:fingerprint(ensureIdentity(store).public_key),device_id:s.device?.id,peers:Object.values(s.trust||{}).filter(p=>p.device_id!==s.device?.id).map(p=>({...p,fingerprint:p.public_key?fingerprint(p.public_key):null,pending_fingerprint:p.pending_key?fingerprint(p.pending_key):null}))};}
export function changeTrust(store:Store,args:any){
  const p=store.state.trust?.[store.state.member?.network_id+':'+args.device_id];
  if(!p)throw Error('Unknown peer device');
  if(args.action==='block')p.blocked=true;
  else if(args.action==='confirm'){
    const key=p.pending_key||p.public_key;
    if(args.confirmed!==true||args.fingerprint!==fingerprint(key))throw Error('Confirm the exact current fingerprint after checking with the teammate');
    p.public_key=key;delete p.pending_key;p.blocked=false;p.confirmed=true;
  }else throw Error('Trust action must be block or confirm');
  store.save();return trustView(store);
}
