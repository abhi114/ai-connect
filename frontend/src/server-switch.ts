/** TEMPORARY: remove this module and change_server RPC after tunnel-based development. */
import { randomUUID } from 'node:crypto';
import { registration, signData } from '../../shared/signing.ts';
export function serverOrigin(value:unknown):string {
  if(typeof value!=='string')throw Error('Enter a server URL');
  let u:URL;try{u=new URL(value.trim())}catch{throw Error('Enter a valid HTTPS server URL')}
  if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))))throw Error('Use an HTTPS origin without credentials, path, query or fragment. HTTP is allowed only for localhost.');
  return u.origin;
}
export async function checkServer(server:string,state:any){
  const call=async(path:string,body?:unknown)=>{
    const r=await fetch(server+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${state.token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw Error('New server rejected the connection ('+r.status+'). Existing URL has not changed.');
    return r.json() as Promise<any>;
  };
  const identity=await call('/v1/me');
  if(identity.network?.id!==state.network?.id||identity.member?.id!==state.member?.id||identity.device?.id!==state.device?.id)throw Error('This server does not match your existing network, member and device. URL unchanged.');
  const ownKey=async()=>{
    const roster=await call('/v1/keys');
    if(!Array.isArray(roster.keys))throw Error('New server does not support device trust. URL unchanged.');
    return roster.keys.find((k:any)=>k.device_id===state.device.id);
  };
  let own=await ownKey();
  if(state.signing&&!own){
    // First registration may never have reached the old tunnel. Register ONLY
    // the existing public key after identity checks; never rotate or replace it.
    const key=state.signing.public_key;
    await call('/v1/keys',{public_key:key,proof:signData(state.signing.private_key,registration(state.network.id,state.member.id,state.device.id,key)),idempotency_key:randomUUID()});
    own=await ownKey(); // A successful POST alone is not sufficient confirmation.
  }
  if(state.signing&&(!own||own.public_key!==state.signing.public_key||own.member_id!==state.member.id||own.network_id!==state.network.id||own.device_revoked_at||own.member_revoked_at))throw Error('Server signing key is different, revoked, or registration could not be confirmed. Existing keys and URL unchanged.');
}
