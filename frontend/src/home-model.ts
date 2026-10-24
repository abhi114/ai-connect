// Pure presentation model, shared with the browser and tested without a live account.
export function homeModel(snapshot:any,messages:any[]=[],now=Date.now()) {
  const me=snapshot.member?.id;
  const groups:any={approvals:[],reviews:[],working:[],queued:[],waiting:[],today:[],issues:[]};
  const day=new Date(now).toDateString();
  const requests=[...snapshot.requests].sort((a,b)=>a.created_at-b.created_at);
  for(const request of requests){
    const run=snapshot.runs[request.id];
    const state=run&&run.state!=='complete'?run.state:request.status;
    const item={request,state},owner=request.owner_member_id===me,sender=request.sender_member_id===me;
    if(owner&&state==='approval_pending')groups.approvals.push(item);
    else if((owner&&state==='awaiting_review')||(sender&&state==='review_ready'))groups.reviews.push(item);
    else if(['claiming','claimed','running','delivery_pending'].includes(state))groups.working.push(item);
    else if(state==='queued')groups.queued.push(item);
    else if(['approval_pending','awaiting_review','review_ready'].includes(state))groups.waiting.push(item);
    else if(['failed','interrupted','delivery_failed'].includes(state))groups.issues.push(item);
    if(request.kind==='change'&&['complete','review_ready','accepted','closed'].includes(state)&&new Date(request.updated_at).toDateString()===day)groups.today.push(item);
  }
  groups.today.sort((a:any,b:any)=>b.request.updated_at-a.request.updated_at);
  const latest: {request?:any;message?:any;at:number}|undefined=[...requests.map(request=>({request,at:request.updated_at||request.created_at})),...messages.map(message=>({message,at:message.created_at}))].sort((a,b)=>b.at-a.at)[0];
  return {groups,latest};
}
