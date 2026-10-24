import { randomUUID } from 'node:crypto';
import { Store } from './store.ts';
import { Remote } from './remote.ts';
import { Worker } from './worker.ts';
import { identify, git } from './git.ts';
import { approvalDigest } from './policy.ts';
import { command } from './process.ts';
import { discoverModels, validateExecution, type ModelCatalog } from './models.ts';
import { pickFolder } from './folder-picker.ts';

export class Core {
  folderPicker=pickFolder;
  modelCatalog?:ModelCatalog; modelDiscovery?:Promise<ModelCatalog>; modelLoader=discoverModels;
  async models(refresh=false) {
    if(!refresh&&this.modelCatalog&&Date.now()-this.modelCatalog.fetched_at<60_000)return this.modelCatalog;
    if(!this.modelDiscovery)this.modelDiscovery=this.modelLoader(this.store.dir).then(c=>this.modelCatalog=c).finally(()=>{this.modelDiscovery=undefined});
    return this.modelDiscovery;
  }
  store:Store; remote:Remote; worker:Worker; syncing=false; connected=false;
  constructor(store:Store) { this.store=store; this.remote=new Remote(store); this.worker=new Worker(store,this.remote); }
  async sync() {
    if(this.syncing || !this.store.state.token) return;
    this.syncing=true;
    try {
      await this.remote.flush();
      await this.remote.mutate('/v1/presence');
      const [identity,members,repos,requests,events]=await Promise.all([
        this.remote.call('/v1/me'),this.remote.call('/v1/members'),this.remote.call('/v1/repos'),this.remote.call('/v1/requests'),
        this.remote.call(`/v1/events?after=${this.store.state.cursor}`)
      ]);
      Object.assign(this.store.state,{member:identity.member,network:identity.network,members:members.members,repos:repos.repos,requests:requests.requests});
      this.store.state.cursor=events.cursor ?? events.events?.at(-1)?.id ?? this.store.state.cursor;
      delete this.store.state.connection_error; this.connected=true; this.store.save();
      await this.worker.tick();
    } catch(error) { this.connected=false; this.worker.stop(); this.store.state.connection_error=error instanceof Error?error.message:String(error); this.store.save(); }
    finally { this.syncing=false; }
  }
  async dispatch(method:string,args:any={}) {
    const state=this.store.state;
    switch(method) {
      case 'pick_folder': return this.folderPicker();
      case 'list_messages': {
        const limit=args.limit??50;
        if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Message limit must be 1–100');
        const query=new URLSearchParams({limit:String(limit)});
        if(args.before!==undefined){if(!Number.isSafeInteger(args.before)||args.before<1)throw new Error('Invalid message cursor');query.set('before',String(args.before));}
        return this.remote.call(`/v1/messages?${query}`);
      }
      case 'send_message': {
        if(typeof args.body!=='string'||!args.body.trim()||args.body.length>8000)throw new Error('Message must contain 1–8000 characters');
        if(!state.member)throw new Error('Join a network before sending messages');
        return this.remote.durable('/v1/messages',{body:args.body.trim()});
      }
      case 'list_models': return this.models(args.refresh===true);
      case 'network_status': return {network:state.network,member:state.member,connected:this.connected,pending_count:state.outbox.length,error:state.connection_error};
      case 'snapshot': return {server:state.server,network:state.network,member:state.member,members:state.members,repos:state.repos,requests:state.requests,bindings:state.bindings,runs:state.runs,connected:this.connected,error:state.connection_error,pending:state.outbox.length};
      case 'enroll': {
        if(state.token) throw new Error('This profile is already enrolled. Use a separate RN_HOME for another member.');
        if(args.server) state.server=String(args.server);
        const identity=await this.remote.mutate(args.code?'/v1/join':'/v1/networks',{code:args.code,name:args.name,handle:args.handle,device_label:args.device_label||'Local companion',idempotency_key:args.idempotency_key||randomUUID()});
        Object.assign(state,identity); this.store.save(); await this.sync();
        return {network:state.network,member:state.member,credential_storage:'Restricted-permission local file; OS keychain integration is deferred.'};
      }
      case 'invite': return this.remote.mutate(`/v1/networks/${state.network?.id}/invites`);
      case 'list_members': return {members:state.members};
      case 'find_repos': {
        const query=String(args.query||'').toLowerCase().split(/\s+/).filter(Boolean);
        return {repos:state.repos.filter(r=>query.every(q=>`${r.slug} ${r.description} ${r.tags?.join(' ')}`.toLowerCase().includes(q)))};
      }
      case 'expose': {
        const identity=await identify(String(args.path));
        const response=await this.remote.mutate('/v1/repos',{slug:args.name,description:args.description||undefined,tags:[],questions_enabled:args.questions!=='off',changes_enabled:!!args.changes,questions_require_approval:(args.questions||'ask')==='ask'});
        const repo=response.repo||response;
        state.bindings[repo.id]={repo_id:repo.id,...identity,name:args.name,questions:args.questions||'ask',changes:!!args.changes,paused:false,allowed_paths:['.'],max_diff_bytes:200_000};
        this.store.save(); await this.sync(); return {repo};
      }
      case 'policy': {
        const binding=state.bindings[args.repo_id]; if(!binding) throw new Error('Unknown local repo binding');
        if(args.questions!==undefined) { if(!['off','ask','auto'].includes(args.questions)) throw new Error('questions must be off, ask, or auto'); binding.questions=args.questions; }
        if(args.changes!==undefined) binding.changes=!!args.changes;
        if(args.paused!==undefined) binding.paused=!!args.paused;
        if(args.allowed_paths!==undefined) {
          if(!Array.isArray(args.allowed_paths) || !args.allowed_paths.length || args.allowed_paths.some((p:any)=>typeof p!=='string'||p.startsWith('/')||p.includes('..')||p.includes('\\')||p.includes(':'))) throw new Error('allowed_paths must contain relative path prefixes');
          binding.allowed_paths=args.allowed_paths;
        }
        this.store.save();
        if(binding.paused) for(const run of Object.values(state.runs)) if(run.repo_id===binding.repo_id) this.worker.stop(run.request_id);
        return this.remote.durable(`/v1/repos/${binding.repo_id}`,{availability:binding.paused?'paused':'active',questions_enabled:binding.questions!=='off',questions_require_approval:binding.questions==='ask',changes_enabled:binding.changes},'PATCH');
      }
      case 'ask_repo': case 'request_change': {
        if(typeof args.repo_id!=='string' || !args.repo_id) throw new Error('A stable repo_id is required');
        const repo=state.repos.find(r=>r.id===args.repo_id); if(!repo) throw new Error('Repo not found; run find_repos first');
        const body=String(args.body||args.question||args.goal||'').trim(); if(!body || body.length>16_000) throw new Error('Request body must contain 1–16000 characters');
        return this.remote.durable('/v1/requests',{repo_id:repo.id,recipient_member_id:repo.owner_member_id,kind:method==='ask_repo'?'question':'change',title:String(args.title||body.slice(0,100)),body,idempotency_key:args.idempotency_key||randomUUID()});
      }
      case 'list_my_requests': return {requests:state.requests};
      case 'get_request': return {...await this.remote.call(`/v1/requests/${encodeURIComponent(args.request_id)}`),local_run:state.runs[args.request_id],local_execution:state.execution_options?.[args.request_id]};
      case 'approve': {
        const {request}=await this.remote.call(`/v1/requests/${encodeURIComponent(args.request_id)}`);
        if(request.owner_member_id!==state.member?.id || !state.bindings[request.repo_id]) throw new Error('Only the bound repo owner may approve locally');
        if(request.status!=='approval_pending' && request.status!=='queued') throw new Error('Request cannot be approved in its current state');
        if(state.runs[request.id])throw new Error('Request already has a local run; execution settings are locked');
        const execution=validateExecution(args.execution,args.execution?.model?await this.models(true):undefined);
        // Recheck after asynchronous discovery so another approval cannot change a started run.
        if(state.runs[request.id])throw new Error('Request already has a local run; execution settings are locked');
        state.execution_options ||= {}; state.execution_options[request.id]=execution;
        state.approvals[request.id]=approvalDigest(request,execution); this.store.save();
        const result=request.status==='approval_pending'?await this.remote.durable(`/v1/requests/${request.id}/approve`,{}):{request};
        await this.sync(); return result;
      }
      case 'reject': case 'cancel': {
        this.worker.stop(args.request_id); delete state.approvals[args.request_id]; this.store.save();
        return this.remote.durable(`/v1/requests/${encodeURIComponent(args.request_id)}/${method}`,{});
      }
      case 'deliver': return this.worker.deliver(args.request_id);
      case 'accept': case 'close': return this.remote.durable(`/v1/requests/${encodeURIComponent(args.request_id)}/${method}`,{});
      case 'diff': {
        const run=state.runs[args.request_id]; if(!run?.worktree) throw new Error('No local worktree');
        return {diff:await git(run.worktree,'diff',run.base_commit!)};
      }
      case 'doctor': {
        const checks:any={node:process.version,server:state.server,connected:this.connected,credential_storage:'0600 file (Windows inherits profile directory ACL)',windows_tested:false};
        for(const executable of ['git',process.env.RN_CODEX_BIN||'codex']) try { checks[executable]=await command(executable,['--version'],this.store.dir); } catch(error) { checks[executable]=String(error); }
        return checks;
      }
      default: throw new Error(`Unknown local method: ${method}`);
    }
  }
}
