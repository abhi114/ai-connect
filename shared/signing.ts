import { createHash, createPublicKey, generateKeyPairSync, sign, verify, randomUUID } from 'node:crypto';
export type SignedKind = 'request'|'message'|'result';
export interface SignedEnvelope { version:1; id:string; kind:SignedKind; network_id:string; member_id:string; device_id:string; public_key:string; issued_at:number; signature:string }
export function canonical(value:any):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value??null);
}
export const digest=(value:any)=>createHash('sha256').update(canonical(value)).digest('hex');
export function keypair(){const keys=generateKeyPairSync('ed25519');return {public_key:keys.publicKey.export({type:'spki',format:'der'}).toString('base64'),private_key:keys.privateKey.export({type:'pkcs8',format:'der'}).toString('base64')};}
export function validKey(key:unknown):key is string {
  try {if(typeof key!=='string'||key.length!==60)return false;const bytes=Buffer.from(key,'base64');return bytes.length===44&&bytes.toString('base64')===key&&createPublicKey({key:bytes,type:'spki',format:'der'}).asymmetricKeyType==='ed25519';}catch{return false;}
}
export const fingerprint=(key:string)=>createHash('sha256').update(Buffer.from(key,'base64')).digest('hex');
export function signData(privateKey:string,data:any){return sign(null,Buffer.from(canonical(data)),{key:Buffer.from(privateKey,'base64'),format:'der',type:'pkcs8'}).toString('base64');}
export function verifyData(publicKey:string,data:any,signature:string){try{return validKey(publicKey)&&typeof signature==='string'&&signature.length===88&&verify(null,Buffer.from(canonical(data)),{key:Buffer.from(publicKey,'base64'),format:'der',type:'spki'},Buffer.from(signature,'base64'));}catch{return false;}}
export function registration(network:string,member:string,device:string,key:string){return {domain:'aiconnect-device-key/v1',network,member,device,key};}
export function seal(identity:{network_id:string;member_id:string;device_id:string;public_key:string;private_key:string},kind:SignedKind,payload:any,id=randomUUID()):SignedEnvelope {
  const {private_key,...who}=identity;const header={version:1 as const,id,kind,...who,issued_at:Date.now()};
  return {...header,signature:signData(private_key,{domain:'aiconnect-message/v1',header,payload})};
}
export function verifyEnvelope(e:SignedEnvelope,payload:any):boolean {
  if(!e||e.version!==1||!['request','message','result'].includes(e.kind)||typeof e.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(e.id)||!Number.isSafeInteger(e.issued_at)||e.issued_at<0)return false;
  const {signature,...header}=e;return verifyData(e.public_key,{domain:'aiconnect-message/v1',header,payload},signature);
}
export function requestPayload(r:any){return {id:r.id,repo_id:r.repo_id,owner_member_id:r.owner_member_id,kind:r.kind,title:r.title,body:r.body,base_ref:r.base_ref??null,constraints:r.constraints??[]};}
export function requestDigest(r:any){return digest({network_id:r.network_id,sender_member_id:r.sender_member_id,...requestPayload(r)});}
export function resultPayload(r:any,result:any){return {request_id:r.id,request_digest:requestDigest(r),recipient_member_id:r.sender_member_id,repo_id:r.repo_id,result};}
