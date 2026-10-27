// Local native-app bridge, invoked with argument arrays (never a shell).
// Not an HTTP or MCP endpoint. Authentication remains owned by Codex.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir } from './store.ts';
import { command } from './process.ts';
import { ensureService, stopService } from './service.ts';
import { localCall } from './ipc.ts';
import { CodexIntegration } from './integration.ts';

export function dashboardURL(raw:string, settings=false) {
  const url=new URL(raw);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||!/^#token=[\w-]+$/.test(url.hash))throw Error('Invalid local dashboard address');
  url.pathname=settings?'/settings':'/';return url.href;
}
export async function desktopAction(action:string, run=command, signal?:AbortSignal):Promise<any> {
  const codex=process.env.RN_CODEX_BIN||'codex';
  if(action==='check') {
    const check=async(exe:string,args:string[])=>{try{await run(exe,args,dataDir(),{timeout:15_000});return true}catch{return false}};
    // xcode-select detects the missing developer tools without triggering Git's OS prompt.
    const developerTools=await check('/usr/bin/xcode-select',['-p']);
    return {git:developerTools&&await check('/usr/bin/git',['--version']),codex:await check(codex,['--version']),signed_in:await check(codex,['login','status'])};
  }
  if(action==='login'){await run(codex,['login'],dataDir(),{timeout:10*60_000,signal});return {signed_in:true};}
  if(action==='start'||action==='settings') {
    await ensureService();
    let runtime;try{runtime=await localCall('desktop_runtime')}catch{throw Error('An older companion is running. Finish active work, use Stop companion in Setup, then open the dashboard again. Do not delete your profile.');}
    if(runtime.node!==process.execPath||runtime.source!==new URL('./core.ts',import.meta.url).href)throw Error('Another AIConnect installation is running. Finish active work, use Stop companion, then open this dashboard again to use the bundled version.');
    const snapshot=await localCall('network_status');
    const url=JSON.parse(readFileSync(join(dataDir(),'dashboard.json'),'utf8')).url;
    return {url:dashboardURL(url,action==='settings'||!snapshot.member),enrolled:!!snapshot.member};
  }
  if(action==='integration')return new CodexIntegration().status();
  if(action.startsWith('register:'))return new CodexIntegration().register({confirmed:true,fingerprint:action.slice('register:'.length)});
  if(action==='stop') {
    const s=await localCall('snapshot');
    if(Object.values(s.runs||{}).some((r:any)=>['running','claimed','claiming'].includes(r.state))||Object.values(s.local_chats||{}).some((c:any)=>c.turns?.some((t:any)=>t.state==='running')))throw Error('Work is running. Finish it before stopping the companion.');
    return stopService();
  }
  throw Error('Unsupported desktop action');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const controller=new AbortController();
  if(process.argv[2]==='login')for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>controller.abort());
  desktopAction(process.argv[2],command,controller.signal).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1});
}
