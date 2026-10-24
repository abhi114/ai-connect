import { openSync, closeSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataDir } from './store.ts';
import { localCall } from './ipc.ts';

let starting: Promise<any> | undefined;
export function ensureService() {
  return starting ||= start().finally(() => { starting=undefined; });
}
const pause=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
function ownerAlive() {
  try { const pid=Number(readFileSync(join(dataDir(),'daemon.lock'),'utf8'));if(!Number.isSafeInteger(pid)||pid<=0)return false;process.kill(pid,0);return true; }
  catch(error:any){return error.code==='EPERM';}
}
// Exported for deterministic slow-start/racing-shutdown regression tests.
export async function waitForService(deps:{probe:()=>Promise<any>;owned:()=>boolean;launch:()=>void;failure:()=>Error|undefined;now:()=>number;sleep:(ms:number)=>Promise<void>},timeoutMs=45_000) {
  const deadline=deps.now()+timeoutMs;let launched=false;
  while(deps.now()<deadline) {
    try{return await deps.probe()}catch{}
    if(deps.failure())throw deps.failure();
    if(!launched&&!deps.owned()){deps.launch();launched=true;}
    await deps.sleep(250);
  }
  throw new Error(`Companion did not become ready within ${timeoutMs/1000}s. It may still be starting or stopping. Inspect ${join(dataDir(),'daemon.log')}; do not delete your profile.`);
}
async function start() {
  let failure:Error|undefined;
  return waitForService({probe:()=>localCall('network_status',{}, {timeoutMs:750}),owned:ownerAlive,now:Date.now,sleep:pause,failure:()=>failure,launch:()=>{
    mkdirSync(dataDir(), {recursive:true,mode:0o700});
    const log=openSync(join(dataDir(),'daemon.log'),'a',0o600);
    try {
      const child=spawn(process.execPath,[fileURLToPath(new URL('./cli.ts',import.meta.url)),'service','run'],{detached:true,stdio:['ignore',log,log],windowsHide:true});
      child.on('error',error=>{failure=error;});child.unref();
    }finally{closeSync(log);}
  }});
}
export async function stopService() {
  if(!existsSync(join(dataDir(),'daemon.lock')))return {stopped:true};
  await localCall('shutdown');
  const deadline=Date.now()+45_000;
  while(existsSync(join(dataDir(),'daemon.lock'))&&ownerAlive()) {
    if(Date.now()>deadline)throw new Error('Companion is still stopping. Wait for workers to exit before starting again; inspect daemon.log.');
    await pause(100);
  }
  return {stopped:true};
}
