import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { RepoRequest } from '../../shared/protocol.ts';
import type { Store, Run } from './store.ts';
import { Remote, RemoteError } from './remote.ts';
import { authorize } from './policy.ts';
import { approvedPath, git, inspectDiff, makeWorktree, verifyBinding } from './git.ts';
import { runCodex } from './codex.ts';
import { signOutgoing, requireVerified } from './trust.ts';
import { LocalChats } from './local-chats.ts';

export class Worker {
  store: Store; remote: Remote; active = new Map<string,AbortController>();
  runner: typeof runCodex;
  local: LocalChats;
  private ticking = false;
  // Bindings are canonicalized by identify(). Share one lane across aliases and
  // linked worktrees of the same Git repository, not merely a relay repo ID.
  private lane(repoId:string) {
    const binding=this.store.state.bindings[repoId];
    const path=binding?.git_dir || binding?.path;
    if(!path)return `repo:${repoId}`;
    const canonical=resolve(path);
    return process.platform==='win32'?canonical.toLowerCase():canonical;
  }
  constructor(store: Store, remote: Remote, runner = runCodex) {
    this.store=store; this.remote=remote; this.runner=runner;
    this.local=new LocalChats(store,this);
    for (const run of Object.values(store.state.runs)) {
      if(run.local_chat_id&&run.state==='awaiting_review')continue;
      if (['claiming','running','awaiting_review'].includes(run.state)) {
        run.state='interrupted'; run.error='Daemon restarted. Preserved worktree; inspect it before creating a new request. No automatic execution retry.';
      }
    }
    store.save();
  }
  async tick(remoteAllowed=true) {
    if(this.ticking)return;
    this.ticking=true;
    try { await this.schedule(remoteAllowed); } finally { this.ticking=false; }
  }
  private async schedule(remoteAllowed:boolean) {
    for (const run of Object.values(this.store.state.runs)) {
      if(run.local_chat_id||!remoteAllowed)continue;
      if (run.lease_token && ['running','awaiting_review'].includes(run.state)) {
        const current=this.store.state.requests.find(r=>r.id===run.request_id);
        try {
          if (!current) throw new Error('Request is no longer accessible');
          authorize(this.store.state,current);
          await this.remote.mutate(`/v1/requests/${run.request_id}/heartbeat`,{lease_token:run.lease_token});
        } catch {
          this.active.get(run.request_id)?.abort(); run.state='interrupted';
          run.error='Execution authority was lost. Worktree retained for review.'; this.store.save();
        }
      }
      if (run.state==='delivery_pending') await this.deliverResult(run);
    }
    const requests=[...(remoteAllowed?this.store.state.requests:[]).map(request=>({request,id:request.id,created_at:request.created_at})),...this.local.candidates()].sort((a,b)=>a.created_at-b.created_at||a.id.localeCompare(b.id));
    for (const candidate of requests) {
      if('chat' in candidate){const {chat,turn}=candidate;const lane=this.lane(chat.repo_id);if(Object.values(this.store.state.runs).some(r=>this.lane(r.repo_id)===lane&&(this.active.has(r.request_id)||['claiming','running','awaiting_review','delivery_pending'].includes(r.state))))continue;const run=this.store.state.runs[turn.id];run.state='claiming';this.store.save();void this.local.execute(chat,turn,run);continue;}
      const request=candidate.request as RepoRequest;
      if (request.status!=='queued' || this.store.state.runs[request.id]) continue;
      let binding; try { binding=authorize(this.store.state,request); } catch { continue; }
      const lane=this.lane(binding.repo_id);
      if (Object.values(this.store.state.runs).some(r=>this.lane(r.repo_id)===lane &&
        (this.active.has(r.request_id) || ['claiming','running','awaiting_review','delivery_pending'].includes(r.state)))) continue;
      const explicit=this.store.state.execution_options?.[request.id];
      const execution=explicit??(request.kind==='question'&&binding.questions==='auto'?binding.auto_execution:undefined);
      const run:Run={request_id:request.id,repo_id:request.repo_id,state:'claiming',execution:{...execution}};
      this.store.state.runs[request.id]=run; this.store.save();
      void this.execute(request,run);
    }
  }
  async execute(request:RepoRequest,run:Run) {
    const controller=new AbortController(); this.active.set(request.id,controller);
    try {
      const binding=authorize(this.store.state,request);
      if(request.base_ref && request.base_ref!=='HEAD') throw new Error('Only the bound checkout HEAD is supported as a base in this MVP');
      await verifyBinding(binding);
      const lease=await this.remote.mutate(`/v1/requests/${request.id}/claim`);
      run.lease_token=lease.lease_token; run.state='running'; this.store.save();
      authorize(this.store.state,lease.request || request);
      await this.remote.mutate(`/v1/requests/${request.id}/heartbeat`,{lease_token:run.lease_token});
      Object.assign(run,await makeWorktree(binding,this.store.dir,request.id,request.kind==='change')); this.store.save();
      const mainBefore=await git(binding.path,'status','--porcelain=v1');
      const response=await this.runner(request,run.worktree!,controller.signal,run.execution);
      if (run.state!=='running' || controller.signal.aborted) throw new Error('Run cancelled or lease lost');
      if (await git(binding.path,'status','--porcelain=v1')!==mainBefore) throw new Error('Main checkout changed while task ran; held for owner review');
      run.answer=response.answer;
      run.sources=[];
      for(const source of response.sources.slice(0,100)) {
        if(typeof source?.path!=='string' || !approvedPath(source.path,['.']) || (source.line!==undefined && (!Number.isInteger(source.line)||source.line<1))) continue;
        try{await git(run.worktree!,'cat-file','-e',`${run.base_commit}:${source.path}`);run.sources.push({path:source.path,...(source.line?{line:source.line}:{})});}catch{}
      }
      if (request.kind==='question') {
        if (await git(run.worktree!,'status','--porcelain=v1')) throw new Error('Read-only question changed the worktree');
        run.result={kind:'question_result',base_commit:run.base_commit,answer:run.answer,sources:run.sources};
        run.state='delivery_pending'; this.store.save(); await this.deliverResult(run);
      } else {
        const diff=await inspectDiff(binding,run.worktree!,run.base_commit!);
        run.diff_summary=diff.summary; run.state='awaiting_review'; this.store.save();
      }
    } catch (error) {
      run.state='failed'; run.error=String(error instanceof Error?error.message:error); this.store.save();
      if(run.lease_token) {
        try { await this.remote.mutate(`/v1/requests/${request.id}/fail`,{lease_token:run.lease_token,code:'local_execution_failed',message:'Local execution failed or was held for owner inspection; see owner dashboard.'}); } catch {}
      }
    } finally { this.active.delete(request.id); }
  }
  async deliver(id:string) {
    const run=this.store.state.runs[id];
    if (!run || run.state!=='awaiting_review') throw new Error('Run is not awaiting local review');
    const {request}=await this.remote.call(`/v1/requests/${id}`);
    const binding=authorize(this.store.state,request);
    await verifyBinding(binding);
    if(await git(run.worktree!,'symbolic-ref','--short','HEAD')!==run.branch || await git(run.worktree!,'rev-parse','HEAD')!==run.base_commit) throw new Error('Task branch or base changed; inspect the worktree before delivery');
    const diff=await inspectDiff(binding,run.worktree!,run.base_commit!);
    await this.remote.mutate(`/v1/requests/${id}/heartbeat`,{lease_token:run.lease_token});
    await git(run.worktree!,'-c','user.name=Repo Network','-c','user.email=repo-network@localhost','commit','--no-gpg-sign','-m',`Repo Network change ${id}`);
    const commit=await git(run.worktree!,'rev-parse','HEAD');
    run.result={kind:'change_result',base_commit:run.base_commit,commit,branch:run.branch,delivery:'local_branch',diff_summary:diff.summary,summary:run.answer?.slice(0,12000),
      tests:[{name:'Owner should inspect Codex summary; companion has no trusted configured test runner',status:'skipped'}],owner_review_required:true};
    run.state='delivery_pending'; this.store.save(); await this.deliverResult(run);
    return {run};
  }
  async deliverResult(run:Run) {
    run.delivery_key ||= randomUUID(); this.store.save();
    try {
      const current=this.store.state.requests.find(r=>r.id===run.request_id);
      if(!current)throw Error('Original request unavailable');
      requireVerified(this.store.state,current);
      const path=`/v1/requests/${run.request_id}/complete`;
      run.result_signature ||= signOutgoing(this.store,path,{result:run.result}).signature;this.store.save();
      await this.remote.mutate(path,{lease_token:run.lease_token,result:run.result,signature:run.result_signature,idempotency_key:run.delivery_key});
      run.state='complete'; this.store.save();
    } catch(error) {
      run.error='Result delivery held: '+(error instanceof Error?error.message:String(error));this.store.save();
      if(error instanceof RemoteError && error.status<500 && error.status!==429) {
        run.state='delivery_failed';run.error='Result delivery rejected: '+error.message;this.store.save();
      }
      // Retry transport failures using the immutable result, never execute Codex again.
    }
  }
  stop(id?:string) { for(const [key,controller] of this.active) if(!id || key===id) controller.abort(); }
}
