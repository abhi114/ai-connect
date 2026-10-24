import { request } from 'node:http';
import { readLocalState, socketPath } from './store.ts';

export function localCall(method:string,args:any={},options:{signal?:AbortSignal}={}) {
  return new Promise<any>((resolve,reject)=>{
    let state; try { state=readLocalState(); } catch(error) { reject(error); return; }
    const req=request({socketPath:socketPath(),path:'/rpc',method:'POST',signal:options.signal,headers:{Authorization:`Bearer ${state.session_token}`,'Content-Type':'application/json'}},response=>{
      let body=''; response.on('data',chunk=>{body+=chunk; if(body.length>4_000_000) response.destroy(new Error('Response too large'));});
      response.on('end',()=>{try{const result=JSON.parse(body); if(result.error)reject(new Error(result.error)); else resolve(result.result);}catch(error){reject(error);}});
      response.on('error',reject);
    });
    req.on('error',()=>reject(new Error('Companion is unavailable. Start it with: npm run cli -- service run')));
    req.setTimeout(30_000,()=>req.destroy(new Error('Companion request timed out')));
    req.end(JSON.stringify({method,args}));
  });
}
