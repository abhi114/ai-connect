import { randomUUID } from 'node:crypto';
import { isAbsolute,basename } from 'node:path';
import type { Store,Run } from './store.ts';
import type { Worker } from './worker.ts';
import type { ExecutionOptions } from './models.ts';
import { identify,verifyBinding,makeWorktree,git,inspectDiff } from './git.ts';
import { runLocalCodex,type LocalResponse } from './local-codex.ts';
import { verification,verifyRequest,signOutgoing } from './trust.ts';
import { resultPayload } from '../../shared/signing.ts';

export interface LocalTurn {id:string;body:string;kind:'question'|'change';created_at:number;execution:ExecutionOptions;answer?:string;delegations?:LocalResponse['delegations']}
export interface LocalLink {id:string;repo_id:string;kind:'question'|'change';body:string;created_at:number;error?:string;data?:any}
export interface LocalChat {id:string;repo_id:string;title:string;created_at:number;turns:LocalTurn[];links:LocalLink[];worktree?:string;branch?:string;base_commit?:string;head?:string;archived?:boolean}
export class LocalChats {
  store:Store;worker:Worker;runner=runLocalCodex;
  private linkCursor=0;
  constructor(store:Store,worker:Worker){this.store=store;this.worker=worker;store.state.local_chats||={};}
  get(id:string){const c=this.store.state.local_chats?.[id];if(!c)throw Error('Unknown local chat');return c;}
  async attach(path:string,name:string){if(!path||!isAbsolute(path))throw Error('Choose an absolute local repository path');const identity=await identify(path);const existing=Object.values(this.store.state.bindings).find(b=>b.path===identity.path&&b.git_dir===identity.git_dir);if(existing)return existing;
    const id='localrepo_'+randomUUID();const b={repo_id:id,...identity,name:name.trim().slice(0,100)||basename(identity.path),questions:'off' as const,changes:false,paused:false,allowed_paths:['.'],max_diff_bytes:200000};this.store.state.bindings[id]=b;this.store.save();return b;
  }
  create(repo_id:string,title:string){if(!this.store.state.bindings[repo_id])throw Error('Choose a repository attached to this computer');const c:LocalChat={id:'chat_'+randomUUID(),repo_id,title:title.trim().slice(0,100)||'Project chat',created_at:Date.now(),turns:[],links:[]};this.store.state.local_chats![c.id]=c;this.store.save();return c;}
  enqueue(id:string,body:string,kind:string,execution:ExecutionOptions,confirmed:boolean){const c=this.get(id);if(c.archived)throw Error('Chat is closed; worktree retained');if(!['question','change'].includes(kind))throw Error('Choose question or change');if(kind==='change'&&!confirmed)throw Error('Confirm local worktree edits for this turn');if(typeof body!=='string'||!body.trim()||body.length>16000)throw Error('Message must contain 1–16000 characters');if(c.turns.filter(t=>this.store.state.runs[t.id]?.state==='queued').length>=20)throw Error('Local chat queue is full');
    if(c.turns.some(t=>['failed','interrupted'].includes(this.store.state.runs[t.id]?.state)))throw Error('An earlier turn was interrupted. Inspect its worktree, then close this chat and start a new one.');
    const t:LocalTurn={id:'local_'+randomUUID(),body:body.trim(),kind:kind as any,created_at:Date.now(),execution};c.turns.push(t);this.store.state.runs[t.id]={request_id:t.id,repo_id:c.repo_id,local_chat_id:c.id,state:'queued',execution:{...execution}};this.store.save();return t;
  }
  candidates(){return Object.values(this.store.state.local_chats||{}).filter(c=>!c.archived).flatMap(c=>{
    // A failed/interrupted turn must be inspected, not silently continued.
    if(c.turns.some(t=>['failed','interrupted'].includes(this.store.state.runs[t.id]?.state)))return [];
    const turn=c.turns.find(t=>this.store.state.runs[t.id]?.state==='queued');return turn?[{chat:c,turn,created_at:turn.created_at,id:turn.id}]:[];
  });}
  async checkWorktree(c:LocalChat){const b=this.store.state.bindings[c.repo_id];if(!b)throw Error('Local binding unavailable');await verifyBinding(b);if(c.worktree){const actual=await identify(c.worktree);if(actual.git_dir!==b.git_dir||actual.path!==c.worktree||await git(c.worktree,'symbolic-ref','--short','HEAD')!==c.branch||await git(c.worktree,'rev-parse','HEAD')!==c.head)throw Error('Chat worktree identity or HEAD changed; inspect before continuing');}return b;}
  linkVerification(link:LocalLink){const data=link.data;if(!data)return {status:'pending',detail:'No verified reply yet'};const req=data.request;
    if(req.id!==link.id||req.repo_id!==link.repo_id||req.sender_member_id!==this.store.state.member?.id||req.kind!==link.kind||req.body!==link.body)return {status:'invalid',detail:'Linked request identity mismatch'};
    const v=verifyRequest(this.store.state,req);if(v.status!=='verified')return v;
    return data.result?verification(this.store.state,data.result_signature,'result',resultPayload(req,data.result),req.owner_member_id):{status:'pending',detail:'Awaiting result'};
  }
  input(c:LocalChat,t:LocalTurn){return {current_owner_message:t.body,mode:t.kind,conversation:c.turns.slice(0,c.turns.indexOf(t)).filter(x=>x.answer).map(x=>({owner:x.body,agent:x.answer})),untrusted_peer_results:c.links.filter(l=>this.linkVerification(l).status==='verified').map(l=>({request_id:l.id,repo_id:l.repo_id,question:l.body,result:l.data.result})),exposed_repositories:this.store.state.repos.filter(r=>!r.revoked_at&&r.availability==='active').map(r=>({repo_id:r.id,owner:this.store.state.members.find(m=>m.id===r.owner_member_id)?.handle,name:r.slug,description:r.description,questions:r.questions_enabled,changes:r.changes_enabled})),worktree:{branch:c.branch,base_commit:c.base_commit,head:c.head}};}
  async execute(c:LocalChat,t:LocalTurn,run:Run){const controller=new AbortController();this.worker.active.set(t.id,controller);
    try{const b=await this.checkWorktree(c);if(!c.worktree){Object.assign(c,await makeWorktree(b,this.store.dir,c.id,true));c.worktree=(await identify(c.worktree!)).path;c.head=c.base_commit;this.store.save();}
      if(await git(c.worktree!,'status','--porcelain=v1'))throw Error('Chat worktree has unreviewed or external edits');
      const mainBefore=await git(b.path,'status','--porcelain=v1');Object.assign(run,{worktree:c.worktree,branch:c.branch,base_commit:c.head,state:'running'});this.store.save();
      const response=await this.runner(this.input(c,t),c.worktree!,controller.signal,t.execution,t.kind==='change');
      if(controller.signal.aborted||run.state!=='running')throw Error('Local turn interrupted; inspect retained worktree');
      await this.checkWorktree(c);if(await git(b.path,'status','--porcelain=v1')!==mainBefore)throw Error('Main checkout changed during the turn');
      t.answer=response.answer;t.delegations=response.delegations;run.answer=response.answer;
      const dirty=await git(c.worktree!,'status','--porcelain=v1');
      if(t.kind==='question'&&dirty)throw Error('Read-only turn changed worktree; inspect it');
      if(dirty){const diff=await inspectDiff(b,c.worktree!,c.head!);run.diff_summary=diff.summary;run.state='awaiting_review';}
      else run.state='complete';this.store.save();
    }catch(e){run.state='interrupted';run.error=e instanceof Error?e.message:String(e);this.store.save();}
    finally{this.worker.active.delete(t.id);}
  }
  async review(id:string){
    const run=this.store.state.runs[id];if(!run?.local_chat_id||run.state!=='awaiting_review'||this.worker.active.has(id))throw Error('No local change awaiting review');
    const c=this.get(run.local_chat_id);run.state='claiming';this.worker.active.set(id,new AbortController());this.store.save();
    try{const b=await this.checkWorktree(c);await inspectDiff(b,c.worktree!,c.head!);await git(c.worktree!,'-c','user.name=AIConnect','-c','user.email=aiconnect@localhost','commit','--no-gpg-sign','-m',`AIConnect local turn ${id}`);c.head=await git(c.worktree!,'rev-parse','HEAD');run.state='complete';this.store.save();return {commit:c.head,branch:c.branch};}
    catch(e){run.state='interrupted';run.error='Commit held for inspection: '+(e instanceof Error?e.message:String(e));this.store.save();throw e;}
    finally{this.worker.active.delete(id);}
  }
  cancel(id:string){const run=this.store.state.runs[id];if(!run?.local_chat_id)throw Error('Unknown local turn');if(run.state==='queued')run.state='cancelled';else if(this.worker.active.has(id))this.worker.stop(id);else throw Error('Turn is not queued or running');this.store.save();}
  close(id:string){const c=this.get(id);if(c.turns.some(t=>this.worker.active.has(t.id)))throw Error('Stop the active turn before closing');c.archived=true;for(const t of c.turns){const r=this.store.state.runs[t.id];if(['queued','awaiting_review'].includes(r?.state))r.state='cancelled';}this.store.save();return {retained_worktree:c.worktree};}
  async delegate(id:string,repo_id:string,kind:string,body:string,confirmed:boolean){const c=this.get(id);if(c.archived)throw Error('Chat is closed');if(!confirmed)throw Error('Confirm the exact task brief and recipient before sending');if(!['question','change'].includes(kind)||typeof body!=='string'||!body.trim()||body.length>16000)throw Error('Invalid remote request');const repo=this.store.state.repos.find(r=>r.id===repo_id);if(!repo||repo.revoked_at||repo.availability!=='active')throw Error('Choose an available exposed repository');if(!(kind==='question'?repo.questions_enabled:repo.changes_enabled))throw Error('Selected capability is disabled');
    const signed=signOutgoing(this.store,'/v1/requests',{repo_id,recipient_member_id:repo.owner_member_id,kind,title:body.slice(0,100),body:body.trim()});const link:LocalLink={id:signed.signature.id,repo_id,kind:kind as any,body:body.trim(),created_at:Date.now()};c.links.push(link);this.store.save();
    try{const result=await this.worker.remote.durable('/v1/requests',signed);if(result.request)link.data=result;this.store.save();return {link,pending:result.pending};}catch(e){link.error=e instanceof Error?e.message:String(e);this.store.save();throw e;}
  }
  async refreshLinks(){const links=Object.values(this.store.state.local_chats||{}).flatMap(c=>c.links).filter(l=>!l.error&&!l.data?.result&&!['rejected','cancelled','failed','closed','accepted'].includes(l.data?.request?.status));if(!links.length)return;const start=this.linkCursor%links.length,batch=Array.from({length:Math.min(8,links.length)},(_,i)=>links[(start+i)%links.length]);this.linkCursor=start+batch.length;await Promise.all(batch.map(async l=>{try{l.data=await this.worker.remote.call('/v1/requests/'+encodeURIComponent(l.id));}catch{/* Outbox/offline requests remain linked for later retry. */}}));this.store.save();}
  view(){return Object.values(this.store.state.local_chats||{}).map(c=>({...c,links:c.links.map(l=>({...l,verification:this.linkVerification(l)}))}));}
}
