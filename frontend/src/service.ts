import { openSync, closeSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataDir } from './store.ts';
import { localCall } from './ipc.ts';

let starting: Promise<any> | undefined;
export function ensureService() {
  return starting ||= start().finally(() => { starting=undefined; });
}
async function start() {
  try { return await localCall('network_status'); } catch {}
  mkdirSync(dataDir(), {recursive:true,mode:0o700});
  const log=openSync(join(dataDir(),'daemon.log'),'a',0o600);
  const child=spawn(process.execPath,[fileURLToPath(new URL('./cli.ts',import.meta.url)),'service','run'],{
    detached:true,stdio:['ignore',log,log],windowsHide:true
  });
  let failure: Error | undefined;
  child.on('error',error=>{failure=error;}); child.unref(); closeSync(log);
  for(let i=0;i<60;i++) {
    if(failure) throw failure;
    try { return await localCall('network_status'); } catch {}
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error(`Companion startup failed. Inspect ${join(dataDir(),'daemon.log')}`);
}
