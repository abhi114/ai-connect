/** TEMPORARY: remove this module and change_server RPC after tunnel-based development. */
export function serverOrigin(value:unknown):string {
  if(typeof value!=='string')throw Error('Enter a server URL');
  let u:URL;try{u=new URL(value.trim())}catch{throw Error('Enter a valid HTTPS server URL')}
  if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))))throw Error('Use an HTTPS origin without credentials, path, query or fragment. HTTP is allowed only for localhost.');
  return u.origin;
}
export async function checkServer(server:string,state:any){
  const get=async(path:string)=>{
    const r=await fetch(server+path,{headers:{Authorization:`Bearer ${state.token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw Error('New server rejected the connection ('+r.status+'). Existing URL has not changed.');
    return r.json() as Promise<any>;
  };
  const identity=await get('/v1/me');
  if(identity.network?.id!==state.network?.id||identity.member?.id!==state.member?.id||identity.device?.id!==state.device?.id)throw Error('This server does not match your existing network, member and device. URL unchanged.');
  const roster=await get('/v1/keys');
  if(!Array.isArray(roster.keys))throw Error('New server does not support device trust. URL unchanged.');
  const own=roster.keys.find((k:any)=>k.device_id===state.device.id);
  if(state.signing&&own?.public_key!==state.signing.public_key)throw Error('This server does not have your current signing key. URL unchanged.');
}
