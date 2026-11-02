import { randomUUID } from 'node:crypto';
import type { Store,State,Run } from './store.ts';
import { verifyRequest } from './trust.ts';

export type AuditCategory='question'|'change'|'local'|'access'|'approval'|'review'|'trust'|'network'|'execution';
export interface AuditEntry {
  id:string;at:number;category:AuditCategory;action:string;summary:string;
  outcome:'requested'|'allowed'|'blocked'|'failed'|'completed'|'info';
  actor:'you'|'peer'|'system'|'unknown';actor_id?:string;actor_name:string;
  scope:'computer'|'outgoing';source:'local'|'relay'|'history';
  request_id?:string;repo_id?:string;chat_id?:string;kind?:'question'|'change';
  topic?:string;path?:string;detail?:string;key?:string;
}
export const AUDIT_LIMIT=5000;
export function auditText(value:unknown,max=240) {
  return typeof value==='string'?value.replace(/(?:Bearer\s+\S+|(?:sk-|ghp_)[A-Za-z0-9_-]+|[A-Z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\s*[=:]\s*\S+)/gi,'[redacted]').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max):'';
}
export function appendAudit(store:Store,input:Partial<AuditEntry>&Pick<AuditEntry,'category'|'action'|'summary'>) {
  const s=store.state,entries=s.audit_log||=[];
  if(input.key&&entries.some(e=>e.key===input.key))return;
  const actor=input.actor||'you',actorId=input.actor_id||(actor==='you'?s.member?.id:undefined);
  const entry:AuditEntry={id:randomUUID(),at:input.at??Date.now(),category:input.category,action:auditText(input.action,100),summary:auditText(input.summary),outcome:input.outcome||'info',actor,actor_id:actorId,
    actor_name:auditText(input.actor_name||s.members.find(m=>m.id===actorId)?.handle||(actor==='you'?'You':actor==='system'?'AIConnect':'Unidentified client'),80),scope:input.scope||'computer',source:input.source||'local'};
  for(const field of ['request_id','repo_id','chat_id','kind','topic','path','detail','key'] as const)if(typeof input[field]==='string')(entry as any)[field]=auditText(input[field],field==='detail'?600:field==='path'?500:240);
  entries.push(entry);
  if(entries.length>AUDIT_LIMIT){s.audit_dropped=(s.audit_dropped||0)+entries.length-AUDIT_LIMIT;s.audit_log=entries.slice(-AUDIT_LIMIT);}
  try{store.save();delete s.audit_warning;}catch{s.audit_warning='Some activity could not be saved. Check free disk space and profile permissions.';}
}
export function auditReason(error:unknown) {
  const value=error instanceof Error?error.message:String(error);
  for(const [pattern,reason] of [[/timed? ?out|timeout/i,'Execution or connection timed out'],[/quota|token.*limit|rate.?limit|usage.?limit/i,'A usage or rate limit was reported'],[/not verified|signature|trust|revoked|key changed/i,'Signature or device trust checks blocked the operation'],[/approv|confirm/i,'Required approval or confirmation was missing'],[/scope|protected|outside|symlink|path|binding|wrong owner|only.*owner|choose a changed file|file is not in this change/i,'Repository scope, ownership or path checks blocked the operation'],[/structured JSON|valid JSON|answer failed validation/i,'The agent response did not match the required format']] as const)if(pattern.test(value))return reason;
  return 'Operation did not complete; inspect the associated request for details';
}
export function requestAuditContext(state:State,id?:string):Partial<AuditEntry> {
  const run=id?state.runs[id]:undefined,request=id?state.requests.find(r=>r.id===id):undefined,repoId=run?.repo_id||request?.repo_id;
  const chat=run?.local_chat_id?state.local_chats?.[run.local_chat_id]:undefined,turn=chat?.turns.find(t=>t.id===id);
  return {request_id:id,repo_id:repoId||undefined,chat_id:run?.local_chat_id,kind:request?.kind||turn?.kind,topic:request?.title||turn?.body,scope:request&&request.owner_member_id!==state.member?.id?'outgoing':'computer'};
}
const operations:Record<string,[AuditCategory,string]>={
  ask_repo:['question','Question sent'],request_change:['change','Change request sent'],local_send:['local','Local agent task submitted'],local_delegate:['local','Cross-repository request sent'],
  approve:['approval','Execution approved'],reject:['approval','Request rejected'],cancel:['approval','Cancellation requested'],retry:['approval','Retry requested'],owner_context:['approval','Owner instructions updated'],
  deliver:['review','Change reviewed; delivery requested'],local_review:['review','Local change reviewed and committed'],accept:['review','Delivered change acknowledged'],close:['review','Delivered change closed'],
  diff:['access','Worktree diff requested'],workspace_reveal:['access','Worktree folder reveal requested'],expose:['access','Repository sharing configured'],policy:['access','Repository permissions updated'],local_attach:['access','Local repository attached'],
  trust_update:['trust','Device trust updated'],enroll:['network','Network membership configured'],invite:['network','Invitation created'],integration_register:['network','Codex integration registration requested'],change_server:['network','Server reconnection requested'],
  local_create:['local','Local project chat created'],local_cancel:['local','Local task cancellation requested'],local_close:['local','Local project chat closed'],
  routine_save:['local','Routine settings saved'],routine_toggle:['local','Routine schedule toggled'],routine_remove:['local','Routine schedule removed'],routine_run:['local','Routine run requested']
};
export function auditOperation(store:Store,method:string,args:any={},result?:any,error?:unknown) {
  args=args&&typeof args==='object'?args:{};
  if(method==='notification_action')method=args.action;
  const spec=Object.hasOwn(operations,method)?operations[method]:undefined;if(!spec)return;
  const id=args.request_id||args.turn_id||result?.request?.id||result?.turn?.id||result?.link?.id;
  const context=requestAuditContext(store.state,id);
  context.repo_id||=args.repo_id||result?.repo?.id||result?.binding?.repo_id;
  context.chat_id||=args.chat_id||result?.chat?.id;
  if(!context.repo_id&&context.chat_id)context.repo_id=store.state.local_chats?.[context.chat_id]?.repo_id;
  if(['ask_repo','request_change','local_delegate'].includes(method)){context.scope='outgoing';context.topic=result?.request?.title||args.title||args.body;context.kind=method==='ask_repo'?'question':method==='request_change'?'change':args.kind;}
  const detail=error?auditReason(error):method==='owner_context'?'Owner instructions recorded separately; their text is not copied into this log.':method==='policy'?`Question mode: ${auditText(args.questions,10)||'unchanged'}; change mode: ${auditText(args.change_mode,10)||'unchanged'}; sharing: ${args.paused===undefined?'unchanged':args.paused?'paused':'active'}`:method==='trust_update'?`Device action: ${auditText(args.action,30)}`:undefined;
  const blocked=!!error&&/block|required|missing/.test(detail||'');
  const minute=Math.floor(Date.now()/60000);
  appendAudit(store,{...context,category:spec[0],action:method,summary:spec[1],outcome:error?(blocked?'blocked':'failed'):result?.pending?'requested':'allowed',actor:'you',detail,
    path:['diff','workspace_reveal','expose','local_attach'].includes(method)?(typeof args.path==='string'?args.path:method==='workspace_reveal'&&id?store.state.runs[id]?.worktree:undefined):undefined,
    key:method==='diff'?`diff:${id}:${auditText(args.path,100)}:${error?'failed':'ok'}:${minute}`:undefined});
}
const relayLabels:Record<string,string>={'request.created':'Request received','request.approved':'Request approved','request.rejected':'Request rejected','request.cancelled':'Request cancelled','request.failed':'Remote request failed','request.completed':'Result delivered','request.accepted':'Change receipt acknowledged','request.closed':'Change closed','request.retry_requested':'Retry requested','request.approval_required':'Request held for approval'};
export function auditRelayEvents(store:Store,events:any[]) {
  const s=store.state;
  for(const event of events||[]){
    if(!relayLabels[event.type])continue;
    const r=s.requests.find(r=>r.id===event.request_id);if(!r)continue;
    const onComputer=r.owner_member_id===s.member?.id&&!!s.bindings[r.repo_id],outgoing=r.sender_member_id===s.member?.id;
    if(!onComputer&&!outgoing)continue;
    if(event.type!=='request.created'&&onComputer&&s.runs[r.id])continue;
    if(outgoing&&event.actor_member_id===s.member?.id&&event.type==='request.created'&&s.audit_log?.some(e=>e.request_id===r.id&&['ask_repo','request_change','local_delegate'].includes(e.action)))continue;
    const verification=verifyRequest(s,r),unverified=verification.status!=='verified';
    appendAudit(store,{category:r.kind,action:event.type,summary:event.type==='request.created'?(onComputer?'Incoming '+(r.kind==='change'?'change request':'question'):'Outgoing request recorded'):relayLabels[event.type],
      request_id:r.id,repo_id:r.repo_id,kind:r.kind,topic:r.title,actor:event.actor_member_id===s.member?.id?'you':'peer',actor_id:event.actor_member_id,scope:onComputer?'computer':'outgoing',source:'relay',
      outcome:unverified?'blocked':event.type==='request.failed'?'failed':event.type==='request.completed'?'completed':event.type==='request.created'?'requested':'info',detail:unverified?'Request held: '+verification.detail:'Relay event metadata; this does not prove a file was read.',at:event.created_at,key:'relay:'+event.id});
  }
}
export function auditRun(store:Store,run:Run,action:string,summary:string,outcome:AuditEntry['outcome'],detail?:string) {
  const c=requestAuditContext(store.state,run.request_id),r=store.state.requests.find(r=>r.id===run.request_id);
  appendAudit(store,{...c,category:run.local_chat_id?'local':c.kind||'execution',action,summary,outcome,detail,actor:run.local_chat_id?'you':r?.sender_member_id===store.state.member?.id?'you':'peer',actor_id:r?.sender_member_id,key:`run:${run.request_id}:${action}:${run.worktree||''}`});
}
export function activityLog(state:State,args:any={}) {
  const categories=['all','question','change','local','access','approval','review','trust','network','execution'],outcomes=['all','requested','allowed','blocked','failed','completed','info'];
  if(!categories.includes(args.category||'all')||!outcomes.includes(args.outcome||'all')||!['computer','outgoing','all'].includes(args.scope||'computer')||!['all','you','peer','system','unknown'].includes(args.actor||'all')||args.kind!==undefined&&!['question','change'].includes(args.kind))throw Error('Invalid activity filter');
  for(const field of ['from','to'])if(args[field]!==undefined&&(!Number.isSafeInteger(args[field])||args[field]<0))throw Error('Invalid activity date range');
  if(args.from!==undefined&&args.to!==undefined&&args.from>=args.to)throw Error('The end date must follow the start date');
  const offset=args.offset??0,limit=args.limit??100;if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>200)throw Error('Invalid activity page');
  const entries=[...(state.audit_log||[])];
  // Existing profiles have request metadata but no retroactive per-file audit trail.
  for(const r of state.requests){const computer=r.owner_member_id===state.member?.id&&!!state.bindings[r.repo_id];if(!computer&&r.sender_member_id!==state.member?.id)continue;if(entries.some(e=>e.request_id===r.id&&['request.created','ask_repo','request_change','local_delegate'].includes(e.action)))continue;
    entries.push({id:'history:'+r.id,at:r.created_at,category:r.kind,action:'history.request',summary:computer?'Previously received '+(r.kind==='change'?'change request':'question'):'Previously sent request',request_id:r.id,repo_id:r.repo_id,kind:r.kind,topic:auditText(r.title),actor:r.sender_member_id===state.member?.id?'you':'peer',actor_id:r.sender_member_id,actor_name:auditText(state.members.find(m=>m.id===r.sender_member_id)?.handle||'Unknown member',80),scope:computer?'computer':'outgoing',source:'history',outcome:'requested',detail:'Existing request metadata only. Detailed access logging was not available when this request was created.'});
  }
  for(const chat of Object.values(state.local_chats||{}))for(const turn of chat.turns){if(entries.some(e=>e.request_id===turn.id&&['local_send','routine.enqueued'].includes(e.action)))continue;entries.push({id:'history:'+turn.id,at:turn.created_at,category:'local',action:'history.local_task',summary:'Previously submitted local agent task',request_id:turn.id,repo_id:chat.repo_id,chat_id:chat.id,kind:turn.kind,topic:auditText(turn.body),actor:'you',actor_id:state.member?.id,actor_name:'You',scope:'computer',source:'history',outcome:'requested',detail:'Existing local conversation metadata only; this is not a retroactive file-access trace.'});}
  const query=auditText(args.search,120).toLowerCase();
  const filtered=entries.filter(e=>(e.category!=='execution'||args.category==='execution'||args.include_execution===true)&&(args.from===undefined||e.at>=args.from)&&(args.to===undefined||e.at<args.to)&&(!args.category||args.category==='all'||e.category===args.category)&&(!args.kind||e.kind===args.kind)&&(!args.outcome||args.outcome==='all'||e.outcome===args.outcome)&&(!args.actor||args.actor==='all'||e.actor===args.actor)&&((args.scope||'computer')==='all'||e.scope===(args.scope||'computer'))&&(!args.repo_id||e.repo_id===args.repo_id)&&(!args.member_id||e.actor_id===args.member_id)&&(!query||[e.summary,e.topic,e.actor_name,e.path,e.detail,state.repos.find(r=>r.id===e.repo_id)?.slug,state.bindings[e.repo_id||'']?.name].join(' ').toLowerCase().includes(query))).sort((a,b)=>b.at-a.at||b.id.localeCompare(a.id));
  return {entries:filtered.slice(offset,offset+limit),total:filtered.length,next_offset:offset+limit<filtered.length?offset+limit:null,summary:{questions:new Set(filtered.filter(e=>e.kind==='question').map(e=>e.request_id||e.id)).size,changes:new Set(filtered.filter(e=>e.kind==='change').map(e=>e.request_id||e.id)).size,blocked:filtered.filter(e=>e.outcome==='blocked').length,failures:filtered.filter(e=>e.outcome==='failed').length},retained:state.audit_log?.length||0,dropped:state.audit_dropped||0,limit:AUDIT_LIMIT,warning:state.audit_warning};
}
