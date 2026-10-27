import type { State } from './store.ts';
import { verifyRequest } from './trust.ts';

// Local-only view. Never exports keys, paths, worker output or full request text.
export function notificationView(state:State,connected:boolean){
  const rows=state.requests.filter(r=>r.owner_member_id===state.member?.id||r.sender_member_id===state.member?.id).map(r=>{
    const owner=r.owner_member_id===state.member?.id,run=state.runs[r.id],binding=state.bindings[r.repo_id];
    const retryApproval=r.status==='approval_pending'&&run&&['failed','interrupted'].includes(run.state);
    const status=retryApproval?r.status:run?.state||r.status,verified=verifyRequest(state,r).status==='verified';
    const pending=owner&&!!binding&&(!run||retryApproval)&&['approval_pending','queued'].includes(r.status)&&(retryApproval||!state.approvals[r.id])&&(r.status==='approval_pending'||r.kind==='change'||binding.questions!=='auto');
    const actions:string[]=[];
    if(connected&&pending&&verified&&!binding?.paused&&(r.kind==='change'?binding?.changes:binding?.questions!=='off'))actions.push('approve');
    if(connected&&owner&&r.status==='approval_pending')actions.push('reject');
    if(connected&&['approval_pending','queued','claimed','running'].includes(r.status))actions.push('cancel');
    if(connected&&r.status==='failed'&&verified)actions.push('retry');
    if(connected&&owner&&binding&&!binding.paused&&!run&&r.status==='queued'&&verified)actions.push('owner_context');
    return {id:r.id,title:String(r.title||'Request').slice(0,160),repo:state.repos.find(p=>p.id===r.repo_id)?.slug||'Repository',sender:state.members.find(m=>m.id===r.sender_member_id)?.handle||'Unknown member',status,pending,verified,actions,updated_at:r.updated_at||r.created_at||0};
  }).sort((a,b)=>Number(b.pending)-Number(a.pending)||b.updated_at-a.updated_at);
  return {connected,handle:state.member?.handle||'Not joined',pending:rows.filter(r=>r.pending).length,rows:rows.slice(0,100)};
}
