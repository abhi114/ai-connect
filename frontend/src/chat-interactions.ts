export const interactionCss=`.work-activity{border-left:2px solid #c6ceba;padding:0 12px;margin:14px 0}.work-activity summary{font-size:12px;font-weight:600}.work-activity ol{padding-left:18px;font-size:12px;line-height:1.8}.work-activity .hint{font-size:10px}.next-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.next-actions button{border-radius:20px;font-size:11px;padding:7px 11px}.review-layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:14px;min-height:240px}.review-files{max-height:55vh;overflow:auto;display:flex;flex-direction:column;gap:6px}.review-files button{text-align:left;overflow-wrap:anywhere;font-size:12px}.review-files button[aria-pressed=true]{background:#e1e9d5;border-color:#81936d}.review-meta{font-size:11px;overflow-wrap:anywhere}.review-diff{margin:0;font:12px/1.65 ui-monospace,monospace;background:#f4f3ec;padding:14px;border-radius:10px;max-height:55vh!important}.review-diff span{display:block;white-space:pre-wrap;min-height:1em}.diff-add{background:#e2efdb;color:#285022}.diff-remove{background:#f6e5df;color:#853b2c}.diff-hunk{color:#665b92}.workspace-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}@media(max-width:650px){.review-layout{grid-template-columns:1fr}.review-files{max-height:140px}}`;

export const interactionJs=`
const activityOpen=new Set();let reviewSequence=0;
function activityPanel(run){
 const details=node('details',undefined,'work-activity'),items=run?.activity||[],id=run?.request_id;
 const running=['claiming','running'].includes(run?.state),seconds=run?.started_at?Math.max(0,Math.round(((run.finished_at||Date.now())-run.started_at)/1000)):0;
 details.append(node('summary',(running?'Working':'Work activity')+' · '+items.length+' updates'+(seconds?' · '+seconds+'s':'')));
 details.open=activityOpen.has(id);details.ontoggle=()=>{if(details.isConnected){if(details.open)activityOpen.add(id);else activityOpen.delete(id)}};
 details.append(node('p','Observed execution events on this computer—not private reasoning. Command arguments and outputs are omitted.','hint'));
 const list=node('ol');for(const event of items)list.append(node('li',event.text+' · '+event.state));details.append(list);
 if(!items.length)details.append(node('p',running?'Waiting for supported progress events.':'No activity was captured for this run.','hint'));
 if(run?.activity_truncated)details.append(node('p','Showing the first 100 activity items.','hint'));
 return details;
}
function draftLocal(text){const field=$('#local-body');if(field.value.trim()&&!confirm('Replace the unsent draft with this suggestion?'))return;field.value=text;$('#local-mode').value='question';field.focus();}
function localNextActions(c,t){const actions=node('div',undefined,'next-actions'),steps=t.next_steps?.length?t.next_steps:[{label:t.kind==='change'?'Explain the changes':'Explain further',prompt:'Explain the previous result in more detail, including risks and relevant files.'},{label:'Suggest verification steps',prompt:'Suggest concrete verification steps for the previous result. Do not edit files.'}];for(const step of steps)actions.append(button(step.label,()=>draftLocal(step.prompt)));actions.append(button('Ask another repo…',()=>openDelegation(c.id)));return actions;}
async function openWorkspace(id){
 const seq=++reviewSequence,dialog=$('#details'),host=$('#detail');host.replaceChildren(node('p','Loading local workspace…'));host.className='';if(!dialog.open)dialog.showModal();
 try{const data=await rpc('diff',{request_id:id});if(seq!==reviewSequence)return;host.replaceChildren();
 host.append(node('p',(data.branch||'Detached worktree')+' · '+data.file_count+' changed files','review-meta'),node('p',data.scope,'hint'),node('p',data.worktree,'review-meta'));
 const controls=node('div',undefined,'workspace-actions');controls.append(button('Open worktree folder',()=>rpc('workspace_reveal',{request_id:id})));host.append(controls);
 const layout=node('div',undefined,'review-layout'),files=node('nav',undefined,'review-files'),body=node('div');files.setAttribute('aria-label','Changed files');const caption=node('p','All changed files','hint'),reveal=button('Reveal file folder',()=>rpc('workspace_reveal',{request_id:id,path:chosen})),pre=node('pre',undefined,'review-diff');let chosen,selection=0;reveal.hidden=true;
 function paint(text){pre.replaceChildren();for(const line of text.split('\\n'))pre.append(node('span',line,line.startsWith('+')?'diff-add':line.startsWith('-')?'diff-remove':line.startsWith('@@')?'diff-hunk':''));}
 async function choose(path,b){const n=++selection;chosen=path;for(const item of files.children)item.setAttribute('aria-pressed',String(item===b));caption.textContent=path||'All changed files';reveal.hidden=!path;try{const d=path?await rpc('diff',{request_id:id,path}):data;if(n===selection&&seq===reviewSequence)paint(d.diff)}catch(e){if(n===selection)pre.textContent=e.message}}
 const all=button('All changes',()=>choose(undefined,all));all.setAttribute('aria-pressed','true');files.append(all);for(const path of data.files){const b=button(path,()=>choose(path,b));b.setAttribute('aria-pressed','false');files.append(b)}
 if(data.truncated)files.append(node('p','First 200 files shown.','hint'));body.append(caption,reveal,pre);layout.append(files,body);host.append(layout);paint(data.diff);
 }catch(e){if(seq===reviewSequence)host.replaceChildren(node('p',e.message,'hint'))}
}
`;
