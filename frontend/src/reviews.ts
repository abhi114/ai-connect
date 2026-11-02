import { homeModel } from './home-model.ts';

export function reviewItems(snapshot:any,mode='pending'):{request:any;state:string}[] {
  if(mode==='pending')return homeModel(snapshot).groups.reviews.filter((i:any)=>i.request.kind==='change');
  const me=snapshot.member?.id;
  return snapshot.requests.filter((r:any)=>r.kind==='change'&&['review_ready','accepted','closed'].includes(r.status)&&(r.owner_member_id===me||r.sender_member_id===me)).map((request:any)=>({request,state:request.status}));
}
export const reviewsHtml=`<button id="tab-reviews" role="tab" aria-selected="false" aria-controls="reviews-panel" tabindex="-1" aria-label="Reviews" title="Reviews"><span aria-hidden="true">▤</span><span class="nav-label">Reviews</span></button><section id="reviews-panel" role="tabpanel" aria-labelledby="tab-reviews" hidden><div class="reviews-tools"><label>Project <select id="reviews-project"><option value="">All projects</option></select></label><label>Show <select id="reviews-mode"><option value="pending">Needs my review</option><option value="delivered">Delivered changes</option></select></label><span id="reviews-count" class="hint"></span></div><p class="hint">Review changes here without searching through chats. Each card belongs to one request and worktree. Automatic changes can wait here in separate worktrees while the next task runs. Manual changes and private edits keep their review holds.</p><div class="reviews-layout"><div id="review-cards"></div><article id="review-detail"><p>Select a change to inspect its request, result and files.</p></article></div></section>`;
export const reviewsCss=`button.home-stat{text-align:left;cursor:pointer}button.home-stat:hover{border-color:#75865f;background:#f0f4e8}#reviews-panel{flex:1;min-height:0;overflow:auto;padding:22px clamp(16px,3vw,44px)}.reviews-tools{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.reviews-tools label{font-size:12px}.reviews-tools select{margin-left:6px}.reviews-layout{display:grid;grid-template-columns:minmax(230px,320px) minmax(0,1fr);gap:22px;align-items:start}.review-project h2{font-size:14px}.review-project{margin-bottom:24px}.review-card{display:block;width:100%;text-align:left;margin:8px 0;padding:16px;background:#fffefa}.review-card[aria-pressed=true]{border-color:#75865f;background:#edf2e5}.review-card strong{display:block;line-height:1.5}.review-card small{display:block;margin-top:7px;color:var(--muted);line-height:1.6}#review-detail{background:#fffefa;border:1px solid var(--line);border-radius:14px;padding:22px;min-width:0}#review-detail h2{font-size:20px;line-height:1.4}#review-detail pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.7}#review-detail .review-diff{max-height:65vh!important}#review-detail .review-files{max-height:250px}#review-detail .actions{flex-wrap:wrap}.review-info{overflow-wrap:anywhere;font-size:12px;color:var(--muted)}@media(max-width:1000px){.reviews-layout{grid-template-columns:1fr}.review-project{display:flex;gap:8px;flex-wrap:wrap}.review-project h2{width:100%}.review-card{width:min(100%,340px)}}`;
export const reviewsJs=`
${reviewItems.toString()}
let reviewSelected,reviewProject='',reviewMode='pending',reviewEpoch=0,reviewLoad=0,reviewFile;
function openReviews(project='',id){reviewProject=project||'';reviewMode='pending';reviewSelected=id;reviewFile=undefined;signatures.delete('review-detail');setMainTab('reviews');void renderReviews();}
function reviewProjectLabel(id){const r=snapshot.repos.find(r=>r.id===id);return r?member(r.owner_member_id)+'/'+repo(id):'My agent / '+repo(id)}
function renderReviewsHeader(){$('#breadcrumb').textContent='WORKSPACE / REVIEWS';$('#view-title').textContent='Changes to review';$('#view-description').textContent='Project changes, isolated worktrees, and delivery decisions.';}
$('#reviews-project').onchange=()=>{reviewProject=$('#reviews-project').value;reviewSelected=undefined;void renderReviews()};
$('#reviews-mode').onchange=()=>{reviewMode=$('#reviews-mode').value;reviewSelected=undefined;void renderReviews()};
async function renderReviews(){
 if(!snapshot||mainTab!=='reviews')return;
 const items=reviewItems(snapshot,reviewMode),projects=$('#reviews-project');projects.replaceChildren(new Option('All projects',''));
 for(const id of [...new Set(items.map(i=>i.request.repo_id))])projects.append(new Option(reviewProjectLabel(id),id));
 if(reviewProject&&!items.some(i=>i.request.repo_id===reviewProject))projects.append(new Option(reviewProjectLabel(reviewProject),reviewProject));projects.value=reviewProject;$('#reviews-mode').value=reviewMode;
 const visible=items.filter(i=>!reviewProject||i.request.repo_id===reviewProject).sort((a,b)=>a.request.created_at-b.request.created_at);
 $('#reviews-count').textContent=visible.length+' change'+(visible.length===1?'':'s')+' · '+items.length+' total';
 if(!visible.some(i=>i.request.id===reviewSelected))reviewSelected=visible[0]?.request.id;
 const list=$('#review-cards');list.replaceChildren();
 for(const repoId of [...new Set(visible.map(i=>i.request.repo_id))]){const group=node('section',undefined,'review-project'),rows=visible.filter(i=>i.request.repo_id===repoId);group.append(node('h2',reviewProjectLabel(repoId)+' · '+rows.length));for(const {request:r,state} of rows){const b=button('',()=>{reviewSelected=r.id;reviewFile=undefined;signatures.delete('review-detail');return renderReviews()});b.className='review-card';b.setAttribute('aria-pressed',String(reviewSelected===r.id));b.append(node('strong',r.title||r.body),node('small',(r.local_chat_id?'My agent':member(r.sender_member_id)+' → '+member(r.owner_member_id))+' · '+label(state)),node('small',time(r.updated_at||r.created_at)));group.append(b)}list.append(group)}
 if(!visible.length)list.append(node('p',reviewMode==='pending'?'No changes need your review in this view.':'No delivered changes in this view.','empty'));
 if(!visible.some(i=>i.request.id===reviewSelected))reviewSelected=visible[0]?.request.id;
 const item=visible.find(i=>i.request.id===reviewSelected),host=$('#review-detail'),load=++reviewLoad;
 if(!item){reviewEpoch++;host.replaceChildren(node('p','Select another project or return when a change is ready.'));return;}
 try{
 const id=item.request.id,privateTurn=!!item.request.local_chat_id,detail=privateTurn?{request:item.request,local_run:snapshot.runs[id]}:await rpc('get_request',{request_id:id});
 if(load!==reviewLoad||mainTab!=='reviews')return;
 const r=detail.request,run=detail.local_run,result=detail.result;
 if(!changed('review-detail',[id,detail,reviewFile]))return;
 const epoch=++reviewEpoch;
 host.replaceChildren(node('h2',r.title||r.body),node('p',repo(r.repo_id)+' · '+label(run?.state==='complete'?r.status:run?.state||r.status),'review-info'),message(privateTurn?'Your local task':'Original request from '+member(r.sender_member_id),r.body,false));
 host.append(node('p','Request '+r.id,'review-info'));if(r.constraints?.length)host.append(message('Requested constraints',r.constraints.join(' · '),false));if(run?.error)host.append(message('Worker status',run.error,false));
 if(run?.answer||result?.summary)host.append(message('Agent summary',run?.answer||result.summary,true));
 if(run?.owner_context)host.append(message('Your instructions for this attempt',run.owner_context,false));
 if(run?.execution)host.append(node('p',(run.execution.model||'Codex default')+' · '+(run.execution.reasoning_effort||'default effort'),'review-info'));
 if(run)host.append(activityPanel(run));
 const actions=node('div',undefined,'actions');
 if(run?.worktree){host.append(node('p','Worktree: '+run.worktree,'review-info'),node('p','Branch: '+(run.branch||'detached')+' · Base: '+run.base_commit,'review-info'));actions.append(button('Open worktree folder',()=>rpc('workspace_reveal',{request_id:id})));}
 if(run?.state==='awaiting_review'&&(privateTurn||r.owner_member_id===snapshot.member?.id&&r.verification?.status==='verified'))actions.append(button(privateTurn?'Commit reviewed local change':'Commit & send reviewed change',async()=>{if(!confirm('Commit this reviewed change on its isolated branch'+(privateTurn?'?':' and deliver the result?')+' This does not merge or push.'))return;await rpc(privateTurn?'local_review':'deliver',privateTurn?{turn_id:id,confirmed:true}:{request_id:id});signatures.delete('review-detail');}));
 if(r.status==='review_ready'&&r.sender_member_id===snapshot.member?.id&&detail.result_verification?.status==='verified')actions.append(button('Acknowledge received change',()=>rpc('accept',{request_id:id})));
 if(result?.branch)host.append(node('p','Delivered branch: '+result.branch+' · Commit: '+result.commit,'review-info'));
 if(detail.events?.length){const timeline=node('details');timeline.append(node('summary','Request timeline'));for(const event of detail.events)timeline.append(node('p',time(event.created_at)+' · '+event.type,'review-info'));host.append(timeline);}
 if(result?.diff_summary)host.append(message('Delivered changes',result.diff_summary,true));
 if(result?.tests?.length)host.append(node('p','Tests: '+result.tests.map(t=>t.status+' — '+t.name).join('; '),'review-info'));
 host.append(actions);
 if(run?.worktree){const data=await rpc('diff',{request_id:id});if(epoch!==reviewEpoch||mainTab!=='reviews')return;host.append(node('h3','Changed files · '+data.file_count));
 const files=node('div',undefined,'review-files'),pre=node('pre',data.diff,'review-diff');let fileEpoch=0;
 for(const path of [undefined,...data.files])files.append(button(path||'All changes',async()=>{const n=++fileEpoch;const selectedData=path?await rpc('diff',{request_id:id,path}):data;if(n===fileEpoch&&epoch===reviewEpoch)pre.textContent=selectedData.diff}));host.append(files,pre);
 }else host.append(node('p','Files and diffs remain on the owner computer. Review the delivered summary here.','hint'));
 }catch(e){if(load===reviewLoad){signatures.delete('review-detail');host.replaceChildren(node('p','Unable to load review: '+e.message));}}
}
`;
