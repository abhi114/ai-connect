import { resolve } from 'node:path';
import { command } from './process.ts';
import { dataDir } from './store.ts';
import { ensureService } from './service.ts';
import { localCall } from './ipc.ts';

import { mcpPath, registrationArgs, CodexIntegration } from './integration.ts';
export { mcpPath, registrationArgs } from './integration.ts';
export async function setup(options:Record<string,any>) {
  if(Number(process.versions.node.split('.')[0])<24) throw new Error('Node 24 or newer is required');
  const binary=codexBinary();
  await command(binary,['--version'],process.cwd());
  await command('git',['--version'],process.cwd());
  const status=await ensureService();
  if(!status.member && (options.team||options.invite)) {
    if(!options.handle) throw new Error('--handle is required when creating or joining a network');
    await localCall('enroll',{name:options.team,code:options.invite,handle:options.handle,server:options.server});
  }
  // Inspect the catalog first; a failed read must never become an overwrite.
  const name=options.name||'aiconnect';
  const args=registrationArgs(name);
  const existing=JSON.parse(await command(binary,['mcp','list','--json'],process.cwd()));
  const entry=existing.find((item:any)=>item.name===name);
  if(entry) {
    const same=entry.transport?.command===process.execPath &&
      JSON.stringify(entry.transport?.args)===JSON.stringify([mcpPath]) &&
      entry.transport?.env?.RN_HOME===dataDir() && entry.transport?.env?.RN_PORT===(process.env.RN_PORT||'4319');
    if(!same) {
      if(options.repair===true&&name==='aiconnect') {const integration=new CodexIntegration();const current=await integration.status();await integration.register({confirmed:true,fingerprint:current.fingerprint});}
      else throw new Error(`MCP server ${name} has different settings. Open the dashboard > Network & setup to review and repair it, or use setup --repair for the same AIConnect profile.`);
    }
    if(entry.enabled===false) throw new Error(`MCP server ${name} is disabled. Enable it in Codex settings.`);
  } else await command(binary,args,process.cwd());
  const check=await checkMcp();
  return {registered:name,profile:resolve(dataDir()),...check,next:'In Codex desktop Settings > MCP servers, restart this server, then open a new chat and ask to list your repo network members. Run codex login separately if local execution is not signed in.'};
}
export async function checkMcp() {
  const messages=[
    {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'repo-network-check',version:'1'}}},
    {jsonrpc:'2.0',method:'notifications/initialized'},
    {jsonrpc:'2.0',id:2,method:'tools/list'},
    {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'network_status',arguments:{}}}
  ];
  const output=await command(process.execPath,[mcpPath],process.cwd(),{input:messages.map(m=>JSON.stringify(m)).join('\n')+'\n',timeout:60000});
  const replies=output.split('\n').map(line=>JSON.parse(line));
  const init=replies.find(r=>r.id===1), list=replies.find(r=>r.id===2), status=replies.find(r=>r.id===3);
  if(!init?.result?.serverInfo || !list?.result?.tools?.length || !status?.result || status.result.isError) throw new Error('MCP transport check failed: '+JSON.stringify(status||replies));
  return {mcp:'ok',tools:list.result.tools.map((t:any)=>t.name),network:JSON.parse(status.result.content[0].text)};
}
import { codexBinary } from './codex-binary.ts';
