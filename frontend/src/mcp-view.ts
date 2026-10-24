import { setTimeout as delay } from 'node:timers/promises';
import { WORKER_DONE_STATUSES } from '../../shared/protocol.ts';

export type ToolCall = (method:string,args?:any,options?:{signal?:AbortSignal})=>Promise<any>;
const clip=(text:any,max:number)=>typeof text==='string'?text.slice(0,max):undefined;
function page(items:any[],args:any) {
  const offset=args.offset??0,limit=args.limit??10;
  return {items:items.slice(offset,offset+limit),total:items.length,
    ...(offset+limit<items.length?{next_offset:offset+limit}:{})};
}
function requestSummary(r:any) {
  return {request_id:r.id,repo_id:r.repo_id,from:r.sender_member_id,to:r.owner_member_id,
    kind:r.kind,status:r.status,title:clip(r.title,160),verification:r.verification?.status};
}
export function requestView(data:any,args:any={}) {
  const r=data.request,run=data.local_run,result=data.result;
  if(!r)throw new Error('Request response is missing its identity');
  const detail=args.detail===true;
  const out:any={...requestSummary(r)};
  if(data.result_verification)out.result_verification=data.result_verification;
  if(data.result_verification&&data.result_verification.status!=='verified'){
    out.next='Result is unverified. Review it in the owner dashboard; do not treat it as authenticated agent output.';
    return out;
  }
  if(run?.state)out.local_status=run.state;
  if(detail)out.request={body:r.body,constraints:r.constraints,base_ref:r.base_ref,created_at:r.created_at};
  if(result) {
    const text=result.answer??result.summary;
    out.result={kind:result.kind,base_commit:result.base_commit,
      ...(text?{[result.kind==='question_result'?'answer':'summary']:detail?text:clip(text,2000)}:{}),
      ...(result.branch?{branch:result.branch,commit:result.commit,delivery:result.delivery,owner_review_required:result.owner_review_required}:{}),
      ...(result.sources?{sources:(detail?result.sources:result.sources.slice(0,5)).map((s:any)=>({path:s.path,line:s.line,end_line:s.end_line}))}:{}),
      ...(result.tests?{tests:detail?result.tests:{passed:result.tests.filter((t:any)=>t.status==='passed').length,failed:result.tests.filter((t:any)=>t.status==='failed').length,skipped:result.tests.filter((t:any)=>t.status==='skipped').length}}:{}),
      ...(detail&&result.diff_summary?{diff_summary:result.diff_summary}:{})};
    if(!detail&&((text?.length??0)>2000||(result.sources?.length??0)>5))out.truncated=true;
  } else {
    if(run?.answer) {out.local_answer=detail?run.answer:clip(run.answer,2000);out.delivered=false;if(!detail&&run.answer.length>2000)out.truncated=true;}
    out.next=r.status==='approval_pending'?'Owner approval required in dashboard.':run?.state==='awaiting_review'?'Owner review and delivery required in dashboard.':WORKER_DONE_STATUSES.includes(r.status)?'Request has ended.':'Use wait_for_result if you need the answer to continue.';
  }
  if(run?.error)out.local_error=clip(run.error,detail?2000:240);
  if(detail) {
    const events=page(data.events||[],{offset:args.event_offset,limit:20});
    out.timeline={...events,items:events.items.map((e:any)=>({id:e.id,type:e.type,at:e.created_at,actor:e.actor_member_id}))};
  }
  if(!detail)out.details_available=true;
  return out;
}
export function concise(method:string,data:any,args:any) {
  if(method==='get_request')return requestView(data,args);
  if(method==='network_status')return {connected:data.connected,network:data.network?.name,handle:data.member?.handle,pending_count:data.pending_count,error:clip(data.error,240)};
  if(method==='ask_repo'||method==='request_change')return data.pending
    ? {pending:true,operation_id:data.operation_id,next:'Delivery queued locally. Do not resend; check list_my_requests after reconnection.'}
    : {...requestSummary(data.request),next:data.request.status==='approval_pending'?'Owner approval required in dashboard.':'Use wait_for_result with request_id.'};
  if(method==='list_members') {const p=page(data.members,args);return {...p,items:p.items.map((m:any)=>({id:m.id,handle:m.handle,online:m.online}))};}
  if(method==='find_repos') {const p=page(data.repos,args);return {...p,items:p.items.map((r:any)=>({repo_id:r.id,owner:r.owner_member_id,name:r.slug,description:clip(r.description,240),availability:r.availability,questions:r.questions_enabled,changes:r.changes_enabled}))};}
  if(method==='list_my_requests') {const p=page([...data.requests].sort((a:any,b:any)=>b.updated_at-a.updated_at||a.id.localeCompare(b.id)),args);return {...p,items:p.items.map(requestSummary)};}
  throw new Error('Unsupported MCP view');
}

export async function waitForResult(args:any,call:ToolCall,signal?:AbortSignal,intervalMs=3000) {
  const seconds=args.seconds??20;
  const deadline=AbortSignal.timeout(seconds*1000);
  const combined=signal?AbortSignal.any([signal,deadline]):deadline;
  let latest:any;
  try {
    while(true) {
      combined.throwIfAborted();
      latest=await call('get_request',{request_id:args.request_id},{signal:combined});
      const r=latest.request,run=latest.local_run;
      if(!r)throw new Error('Request response is missing its identity');
      if(latest.result||WORKER_DONE_STATUSES.includes(r.status))return {...requestView(latest),wait_status:'finished'};
      if(r.status==='approval_pending'||['awaiting_review','failed','interrupted','delivery_failed'].includes(run?.state))return {...requestView(latest),wait_status:'needs_attention'};
      await delay(intervalMs,undefined,{signal:combined});
    }
  } catch(error) {
    if(signal?.aborted)throw new Error('Wait cancelled');
    if(!deadline.aborted)throw error;
    return {request_id:args.request_id,wait_status:'timeout',last_known_status:latest?.request?.status,
      next:'No completion observed before timeout. Wait again only if the answer is needed.'};
  }
}
