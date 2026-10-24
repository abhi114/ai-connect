import { keypair, seal, requestPayload } from '../../../shared/signing.ts';
// Real signatures for isolated unit fixtures; never bypass production checks.
const identities=new WeakMap<object,Map<string,ReturnType<typeof keypair>>>();
export function signedRequest(state:any,request:any){
  if(!identities.has(state))identities.set(state,new Map());const map=identities.get(state)!;
  if(!map.has(request.sender_member_id))map.set(request.sender_member_id,keypair());
  const keys=map.get(request.sender_member_id)!,device='device-'+request.sender_member_id;
  state.trust ||= {};state.trust[request.network_id+':'+device]={network_id:request.network_id,member_id:request.sender_member_id,device_id:device,public_key:keys.public_key,blocked:false,revoked:false,confirmed:true};
  request.signature=seal({...keys,network_id:request.network_id,member_id:request.sender_member_id,device_id:device},'request',requestPayload(request),request.id);
  return request;
}
