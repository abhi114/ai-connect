import { randomUUID } from 'node:crypto';
import { Store } from './store.ts';
import { Remote, RemoteError } from './remote.ts';
import { Worker } from './worker.ts';
import { identify, git } from './git.ts';
import { approvalDigest } from './policy.ts';
import { command } from './process.ts';
import { discoverModels, validateExecution, type ModelCatalog } from './models.ts';
import { pickFolder } from './folder-picker.ts';
import { CodexIntegration } from './integration.ts';
import { verifyRequest, verification, verifyMessage, requireVerified, trustView, changeTrust } from './trust.ts';
import { resultPayload } from '../../shared/signing.ts';

export class Core {
  folderPicker=pickFolder;
  integration:CodexIntegration; enrolling=false;
  modelCatalog?:ModelCatalog; modelDiscovery?:Promise<ModelCatalog>; modelLoader=discoverModels;
  async models(refresh=false) {
    if(!refresh&&this.modelCatalog&&Date.now()-this.modelCatalog.fetched_at<60_000)return this.modelCatalog;
    if(!this.modelDiscovery)this.modelDiscovery=this.modelLoader(this.store.dir).then(c=>this.modelCatalog=c).finally(()=>{this.modelDiscovery=undefined});
    return this.modelDiscovery;
  }
  store:Store; remote:Remote; worker:Worker; syncing=false; connected=false; stopping=false;
  constructor(store:Store) { this.store=store; this.remote=new Remote(store); this.worker=new Worker(store,this.remote);this.integration=new CodexIntegration(store.dir); }
  async sync() {
    if(this.stopping || this.syncing || !this.store.state.token) return;
    this.syncing=true;
    try {
      await this.remote.refreshTrust();
      await this.remote.flush();
      await this.remote.mutate('/v1/presence');
      const [identity,members,repos,requests,events]=await Promise.all([
        this.remote.call('/v1/me'),this.remote.call('/v1/members'),this.remote.call('/v1/repos'),this.remote.call('/v1/requests'),
        this.remote.call(`/v1/events?after=${this.store.state.cursor}`)
      ]);
      Object.assign(this.store.state,{member:identity.member,network:identity.network,members:members.members,repos:repos.repos,requests:requests.requests});
      this.store.state.cursor=events.cursor ?? events.events?.at(-1)?.id ?? this.store.state.cursor;
      delete this.store.state.connection_error; this.connected=true; this.store.save();
      if(this.store.state.outbox.some(i=>!i.body.signature&&['/v1/requests','/v1/messages'].includes(i.path))){
        this.store.state.connection_error='Legacy unsigned outgoing messages are held, not resent. Check delivery before submitting a new signed request.';this.store.save();
      }
      if(!this.stopping)await this.worker.tick();
    } catch(error) { this.connected=false; this.worker.stop(); this.store.state.connection_error=error instanceof Error?error.message:String(error); this.store.save(); }
    finally { this.syncing=false; }
  }
  async dispatch(method:string,args:any={}) {
    const state=this.store.state;
    switch(method) {
      case 'trust_status': {
        let refresh_error:string|undefined;
        if(state.token)try{await this.remote.refreshTrust()}catch(e){refresh_error=e instanceof Error?e.message:String(e)}
        return {...trustView(this.store),refresh_error};
      }
      case 'trust_update': {
        const result=changeTrust(this.store,args);
        if(args.action==='block')for(const r of state.requests)if(r.signature?.device_id===args.device_id)this.worker.stop(r.id);
        await this.worker.tick();return result;
      }
      case 'integration_status': return this.integration.status();
      case 'integration_register': return this.integration.register(args);
      case 'pick_folder': return this.folderPicker();
      case 'list_messages': {
        const limit=args.limit??50;
        if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Message limit must be 1–100');
        const query=new URLSearchParams({limit:String(limit)});
        if(args.before!==undefined){if(!Number.isSafeInteger(args.before)||args.before<1)throw new Error('Invalid message cursor');query.set('before',String(args.before));}
        await this.remote.refreshTrust();
        const page=await this.remote.call(`/v1/messages?${query}`);
        return {...page,messages:page.messages.map((m:any)=>({...m,verification:verifyMessage(this.store,m)}))};
      }
      case 'send_message': {
        if(typeof args.body!=='string'||!args.body.trim()||args.body.length>8000)throw new Error('Message must contain 1–8000 characters');
        if(!state.member)throw new Error('Join a network before sending messages');
        return this.remote.durable('/v1/messages',{body:args.body.trim()});
      }
      case 'list_models': return this.models(args.refresh===true);
      case 'network_status': return {network:state.network,member:state.member,connected:this.connected,pending_count:state.outbox.length,error:state.connection_error};
      case 'snapshot': return {server:state.server,network:state.network,member:state.member,members:state.members,repos:state.repos,requests:state.requests.map(r=>({...r,verification:verifyRequest(state,r)})),bindings:state.bindings,runs:state.runs,connected:this.connected,error:state.connection_error,pending:state.outbox.length};
      case 'enroll': {
        if(state.token) throw new Error('This profile is already enrolled. Use a separate RN_HOME for another member.');
        if(this.enrolling)throw new Error('Joining is already in progress');
        this.enrolling=true;
        try {
          const server=new URL(String(args.server||state.server));
          if(server.username||server.password||server.search||server.hash||server.pathname!=='/'||!(server.protocol==='https:'||(server.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(server.hostname))))throw new Error('Use an HTTPS server origin (HTTP only for localhost), without credentials, path or query.');
          const body={code:args.code,name:args.name,handle:args.handle,device_label:args.device_label||'Local companion'};
          const pending=state.pending_enrollment;
          if(pending&&(pending.server!==server.origin||JSON.stringify({...pending.body,idempotency_key:undefined})!==JSON.stringify(body)))throw new Error('A previous join has an uncertain result. Retry with the same server, invite and username to recover it safely.');
          state.server=server.origin;
          state.pending_enrollment ||= {server:server.origin,body:{...body,idempotency_key:args.idempotency_key||randomUUID()}};
          this.store.save();
          const identity=await this.remote.mutate(args.code?'/v1/join':'/v1/networks',state.pending_enrollment.body);
          Object.assign(state,identity);delete state.pending_enrollment;this.store.save(); await this.sync();
          return {network:state.network,member:state.member,credential_storage:'Restricted-permission local file; OS keychain integration is deferred.'};
        }catch(error){if(error instanceof RemoteError&&error.status<500&&![408,429].includes(error.status)){delete state.pending_enrollment;this.store.save();}throw error;}
        finally{this.enrolling=false;}
      }
      case 'invite': {
        if(state.member?.role!=='admin')throw new Error('Only a network admin can create invitations');
        return {...await this.remote.mutate(`/v1/networks/${state.network?.id}/invites`),server:state.server};
      }
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
        return this.remote.durable('/v1/requests',{repo_id:repo.id,recipient_member_id:repo.owner_member_id,kind:method==='ask_repo'?'question':'change',title:String(args.title||body.slice(0,100)).trim(),body,idempotency_key:args.idempotency_key||randomUUID()});
      }
      case 'list_my_requests': return {requests:state.requests.map(r=>({...r,verification:verifyRequest(state,r)}))};
      case 'get_request': {
        await this.remote.refreshTrust();
        const data=await this.remote.call(`/v1/requests/${encodeURIComponent(args.request_id)}`);
        const verified=verifyRequest(state,data.request);
        const resultVerification=data.result?verification(state,data.result_signature,'result',resultPayload(data.request,data.result),data.request.owner_member_id):undefined;
        return {...data,request:{...data.request,verification:verified},result_verification:resultVerification,local_run:state.runs[args.request_id],local_execution:state.execution_options?.[args.request_id]};
      }
      case 'approve': {
        const {request}=await this.remote.call(`/v1/requests/${encodeURIComponent(args.request_id)}`);
        if(request.owner_member_id!==state.member?.id || !state.bindings[request.repo_id]) throw new Error('Only the bound repo owner may approve locally');
        await this.remote.refreshTrust();requireVerified(state,request);
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
