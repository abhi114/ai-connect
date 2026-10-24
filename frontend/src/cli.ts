import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir } from './store.ts';
import { localCall } from './ipc.ts';
import { startDaemon } from './daemon.ts';
import { ensureService } from './service.ts';
import { setup, checkMcp } from './setup.ts';
import { banner, connectionLabel } from './brand.ts';

const help=`AIConnect — local companion (Node 24+, Git, authenticated Codex CLI)

npm run cli -- service run|start|stop
npm run cli -- setup [--team <name> --handle <handle> --server URL] [--name aiconnect]
npm run cli -- connect
npm run cli -- codex check
npm run cli -- create <network-name> --handle <handle> [--server URL]
npm run cli -- join <code> --handle <handle> [--server URL]
npm run cli -- invite
npm run cli -- status|members|inbox|doctor|dashboard
npm run cli -- models
npm run cli -- request approve <request-id> [--model <catalog-model> --effort <supported-effort>]
npm run cli -- repos search [words]
npm run cli -- repo expose <path> --name <slug> --description <text> [--questions ask|auto|off] [--changes]
npm run cli -- repo policy <repo-id> [--questions ask|auto|off] [--changes true|false] [--paused true|false] [--paths src,test]
npm run cli -- ask <repo-id|@handle/slug> <question>
npm run cli -- change <repo-id|@handle/slug> <goal>
npm run cli -- request show|approve|reject|cancel|diff|deliver|accept|close <request-id>

deliver means the owner reviewed the worktree and authorizes committing its current changes.
RN_HOME selects a local profile; RN_PORT selects dashboard port (default 4319).
Credentials are stored in a restrictive local file. Windows relies on profile-directory ACLs.
`;
function parse(argv:string[]) {const positional:string[]=[];const options:any={};for(let i=0;i<argv.length;i++){if(argv[i].startsWith('--')){const key=argv[i].slice(2);options[key]=argv[i+1]&&!argv[i+1].startsWith('--')?argv[++i]:true;}else positional.push(argv[i]);}return {positional,options};}
const bool=(value:any)=>value===true||value==='true';
export async function main(argv=process.argv.slice(2)) {
  const {positional:p,options:o}=parse(argv); const [verb,action,...rest]=p;
  if(!verb||verb==='help'||verb==='setup'||verb==='connect'||(verb==='service'&&['run','start'].includes(action)))banner();
  if(!verb||verb==='help'||o.help){console.log(help);return}
  if(verb==='connect'){const status=await ensureService();console.error(connectionLabel(status));return}
  if(verb==='setup'){console.log(JSON.stringify(await setup(o),null,2));return}
  if(verb==='codex'&&action==='check'){console.log(JSON.stringify(await checkMcp(),null,2));return}
  if(verb==='service'){
    if(action==='run'){
      const daemon=await startDaemon();console.error(`AIConnect companion ready. Dashboard: ${daemon.url}\nRelay status appears in the dashboard.`);
      for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>void daemon.stop());return;
    }
    if(action==='stop'){console.log(await localCall('shutdown'));return}
    if(action==='start'){
      console.log(await ensureService());return;
    }
    throw new Error('service supports run, start, stop');
  }
  if(verb==='dashboard'){console.log(JSON.parse(readFileSync(join(dataDir(),'dashboard.json'),'utf8')).url);return}
  let method=verb,args:any={};
  if(verb==='create'||verb==='join'){method='enroll';args={name:verb==='create'?action:undefined,code:verb==='join'?action:undefined,handle:o.handle,server:o.server};}
  else if(verb==='status')method='network_status';
  else if(verb==='members')method='list_members';
  else if(verb==='inbox')method='list_my_requests';
  else if(verb==='repos'){method='find_repos';args={query:action==='search'?rest.join(' '):[action,...rest].filter(Boolean).join(' ')};}
  else if(verb==='repo'&&action==='expose'){method='expose';args={path:resolve(rest[0]||'.'),name:o.name,description:o.description,questions:o.questions||'ask',changes:bool(o.changes)};}
  else if(verb==='repo'&&action==='policy'){method='policy';args={repo_id:rest[0],questions:o.questions,changes:o.changes===undefined?undefined:bool(o.changes),paused:o.paused===undefined?undefined:bool(o.paused),allowed_paths:o.paths?String(o.paths).split(','):undefined};}
  else if(verb==='ask'||verb==='change'){
    let repoId=action;
    if(action?.startsWith('@')){const [members,repos]=await Promise.all([localCall('list_members'),localCall('find_repos')]);const [handle,slug]=action.slice(1).split('/');const member=members.members.find((m:any)=>m.handle===handle);const repo=repos.repos.find((r:any)=>r.owner_member_id===member?.id&&r.slug===slug);if(!repo)throw new Error('No exact @handle/repo match');repoId=repo.id;}
    method=verb==='ask'?'ask_repo':'request_change';args={repo_id:repoId,body:rest.join(' ')};
  }
  else if(verb==='models'){method='list_models';args={refresh:true};}
  else if(verb==='request'){method=action==='show'?'get_request':action;args={request_id:rest[0],...(action==='approve'?{execution:{...(o.model?{model:o.model}:{}),...(o.effort?{reasoning_effort:o.effort}:{})}}:{})};}
  console.log(JSON.stringify(await localCall(method,args),null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1});
