export const layoutHtml=`<div id="workspace-bar"><button id="toggle-sidebar" aria-label="Hide navigation" aria-expanded="true">☰</button><div role="tablist" aria-label="Workspace views" aria-orientation="vertical"><button id="tab-home" role="tab" aria-selected="true" aria-controls="home-panel" aria-label="Home" title="Home"><span aria-hidden="true">⌂</span><span class="nav-label">Home</span></button><button id="tab-chats" role="tab" aria-selected="false" aria-controls="chat-content" tabindex="-1" aria-label="Chats" title="Chats"><span aria-hidden="true">☏</span><span class="nav-label">Chats</span></button><button id="tab-settings" role="tab" aria-selected="false" aria-controls="setup-dialog" tabindex="-1" aria-label="Settings" title="Settings"><span aria-hidden="true">⚙</span><span class="nav-label">Settings</span></button></div><button id="toggle-inspector" aria-expanded="false" hidden>Show details</button></div><section id="home-panel" role="tabpanel" aria-labelledby="tab-home"><div id="home-summary"></div><div id="home-groups"></div></section>`;

export const layoutCss=`
#workspace-bar{display:flex;align-items:center;gap:14px;padding:10px 24px;border-bottom:1px solid var(--line);background:#fcfbf7;flex-shrink:0}
#workspace-bar [role=tablist]{display:flex;gap:6px}#workspace-bar [role=tab]{border-color:transparent;background:transparent;padding:9px 18px;font-weight:600;color:var(--muted)}
#workspace-bar [role=tab][aria-selected=true]{background:#dde5d3;color:#35462d;border-color:#becbad}#toggle-inspector{margin-left:auto;font-size:12px}#toggle-sidebar{padding:6px 11px}
.workspace.sidebar-collapsed{grid-template-columns:0 minmax(0,1fr)}.workspace.sidebar-collapsed>.sidebar{display:none}.workspace.sidebar-collapsed>main{grid-column:2}
#home-panel{overflow:auto;min-height:0;padding:28px clamp(20px,4vw,64px);flex:1}
#home-summary{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:28px}.home-stat{flex:1;min-width:140px;padding:18px 20px;background:#fffefa;border:1px solid var(--line);border-radius:12px}.home-stat strong{display:block;font-size:28px;margin-bottom:6px}.home-stat span{font-size:12px;color:var(--muted)}
.home-section{margin-bottom:28px}.home-section h2{font-size:16px;margin:0 0 12px}.home-row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:18px 20px;border:1px solid var(--line);border-radius:12px;background:#fffefa;margin:8px 0}.home-row.priority{border-left:4px solid #8b7047;background:#fcf8ef}.home-row h3{font-size:14px;margin:0 0 7px;line-height:1.5}.home-row p{font-size:12px;color:var(--muted);margin:0;line-height:1.6}.home-row button{white-space:nowrap;font-size:12px}.home-row>div{min-width:0;overflow-wrap:anywhere}
#chat-content{position:relative;display:grid;grid-template-columns:minmax(0,1fr);overflow:hidden}#chat-content>.inspector{display:none}#chat-content.details-open{grid-template-columns:minmax(0,1fr) 340px}#chat-content.details-open>.inspector{display:block}
#chat-content .chat-panel{min-height:0;height:100%;overflow:hidden}#chat-content #requests{min-height:0;max-height:none;padding:22px clamp(20px,4vw,60px)}
#compose{padding:12px 24px}#compose-body{min-height:50px;max-height:130px}#compose .hint{margin:5px 0}.compose-footer{margin-top:7px}.feed-caption{padding:10px 24px}header{padding-top:18px;padding-bottom:16px}
@media(max-width:1100px){#chat-content.details-open{grid-template-columns:minmax(0,1fr)}#chat-content.details-open>.inspector{position:absolute;right:0;top:0;bottom:0;width:min(390px,100%);z-index:3;border-left:1px solid var(--line);box-shadow:-12px 0 30px #343b241f;overflow:auto}}
@media(max-width:600px){.workspace{display:grid;grid-template-columns:180px minmax(0,1fr);height:100dvh}.sidebar{max-height:none}.workspace.sidebar-collapsed{grid-template-columns:0 minmax(0,1fr)}#workspace-bar{padding:8px;gap:6px}#workspace-bar [role=tab]{padding:8px 12px}#home-panel{padding:18px 12px}.home-row{align-items:flex-start;flex-direction:column;gap:12px}#compose{padding:10px 12px}.compose-footer{flex-wrap:wrap}.home-stat{min-width:110px}.toolbar{padding:8px}header{padding:12px}.chat-panel{flex-shrink:1}}

/* Keep all navigation in the sidebar; leave a usable rail when collapsed. */
.sidebar{padding:12px;gap:6px}.brand{padding:12px 6px}.space{padding:12px;margin-bottom:8px}
#workspace-bar{display:flex;flex-direction:column;align-items:stretch;padding:0 0 10px;gap:8px;background:transparent;border-bottom:1px solid var(--line)}
#toggle-sidebar{align-self:flex-end;width:36px;padding:6px}
#workspace-bar [role=tablist]{display:flex;flex-direction:column;gap:4px}
#workspace-bar [role=tab]{display:flex;align-items:center;gap:12px;text-align:left;padding:10px 12px}
#workspace-bar [role=tab]>span:first-child{width:20px;text-align:center;font-size:17px}
.workspace.sidebar-collapsed{grid-template-columns:58px minmax(0,1fr)}
.workspace.sidebar-collapsed>.sidebar{display:flex;padding:8px 5px;overflow:visible}
.workspace.sidebar-collapsed>.sidebar>:not(#workspace-bar){display:none}
.workspace.sidebar-collapsed #workspace-bar{border:0}.workspace.sidebar-collapsed #toggle-sidebar{align-self:center}
.workspace.sidebar-collapsed #workspace-bar [role=tab]{justify-content:center;padding:10px 4px}
.workspace.sidebar-collapsed .nav-label{display:none}
#setup-dialog{flex:1;min-height:0;overflow:auto;padding:24px clamp(20px,5vw,72px);width:auto;max-height:none}
#setup-dialog>section{max-width:850px;padding:20px;background:#fffefa;border:1px solid var(--line);border-radius:12px}
#setup-dialog>p,#setup-dialog>h2{max-width:850px}#setup-dialog p{font-size:13px;line-height:1.6;color:var(--muted)}
main.chat-mode header{padding:9px 18px;min-height:52px;flex-shrink:0}
main.chat-mode #breadcrumb,main.chat-mode #view-description{display:none}
main.chat-mode h1{font-size:18px;margin:0;line-height:1.3}
main.chat-mode .header-actions{display:flex;gap:8px}main.chat-mode .header-actions button{font-size:11px;padding:7px 10px}
.toolbar{padding:7px 16px;gap:10px;flex-shrink:0}.filters button{padding:6px 10px}
.feed-caption{padding:4px 16px;font-size:10px;min-height:24px;flex-shrink:0}
#chat-content #requests{padding:14px 20px;scroll-padding-block:16px}
.chat-item{margin-bottom:16px}.bubble-header{margin-bottom:5px}.bubble-body{padding:11px 14px}.day{margin-bottom:14px}
#compose{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 10px;padding:8px 16px;flex-shrink:0}
.compose-heading{grid-column:1;grid-row:1}.compose-heading select{padding:4px 7px}
#compose-audience{grid-column:1 / -1;grid-row:3;margin:0;font-size:10px;line-height:1.3}
#compose-body{grid-column:1;grid-row:2;height:44px;min-height:44px;max-height:100px;padding:9px 12px}
.compose-footer{grid-column:2;grid-row:2;margin:0;align-self:end}.compose-footer>span{display:none}
#compose-body:focus{height:72px}main.chat-mode #error,main.chat-mode #notice{margin:4px 16px;padding:5px 10px;max-height:42px;overflow:auto;font-size:11px}
@media(max-width:600px){.workspace.sidebar-collapsed{grid-template-columns:50px minmax(0,1fr)}.workspace.sidebar-collapsed>.sidebar{padding:6px 2px}main.chat-mode header{padding:8px 10px}main.chat-mode h1{font-size:15px}.header-actions .pill,#share-repo{display:none}#compose{padding:7px 10px;gap:5px}#compose-body{min-width:0}.compose-footer button{font-size:11px;padding:9px}.compose-heading{grid-column:1 / -1}.feed-caption{padding-inline:10px}.toolbar{padding:5px 10px}.filters{gap:1px}.filters button{font-size:11px;padding:5px}#chat-content #requests{padding:12px 10px}.avatar{width:25px;height:25px}.chat-item{gap:7px}}
`;

export const layoutJs=`
let mainTab='home',inspectorOpen=false;
const main=document.querySelector('main'),chatContent=document.querySelector('.content');chatContent.id='chat-content';chatContent.setAttribute('role','tabpanel');chatContent.setAttribute('aria-labelledby','tab-chats');
document.querySelector('.sidebar').prepend($('#workspace-bar'));document.querySelector('.header-actions').append($('#toggle-inspector'));main.insertBefore($('#home-panel'),chatContent);main.insertBefore($('#setup-dialog'),chatContent);
function setInspector(open){inspectorOpen=open;chatContent.classList.toggle('details-open',open);$('#toggle-inspector').textContent=open?'Hide details':'Show details';$('#toggle-inspector').setAttribute('aria-expanded',String(open));}
function setMainTab(tab){mainTab=tab;main.classList.toggle('chat-mode',tab==='chats');$('#setup-dialog').hidden=tab!=='settings';$('#home-panel').hidden=tab!=='home';chatContent.hidden=tab!=='chats';document.querySelector('.toolbar').hidden=tab!=='chats';$('#toggle-inspector').hidden=tab!=='chats';for(const name of ['home','chats','settings']){const b=$('#tab-'+name);b.setAttribute('aria-selected',String(name===tab));b.tabIndex=name===tab?0:-1;}if(tab==='settings')void loadTrust().catch(e=>{$('#setup-error').textContent=e.message});if(snapshot){renderNavigation();renderHeader();if(tab==='home')renderHome();else renderRequests();}}
function renderSettingsHeader(){$('#breadcrumb').textContent='WORKSPACE / SETTINGS';$('#view-title').textContent='Settings';$('#view-description').textContent='Membership, invitations, and your Codex connection.';}
function renderHomeHeader(){$('#breadcrumb').textContent='WORKSPACE / OVERVIEW';$('#view-title').textContent='Home';$('#view-description').textContent='Incoming requests, decisions, and work in progress.';}
function renderHome(){if(!snapshot||!changed('home',[snapshot.requests,snapshot.runs,snapshot.members,snapshot.repos]))return;const me=snapshot.member?.id;
const needs=[],working=[],queued=[],waiting=[],issues=[];
for(const r of [...snapshot.requests].sort((a,b)=>a.created_at-b.created_at)){const run=snapshot.runs[r.id],state=run?.state||r.status,owner=r.owner_member_id===me;
 if((owner&&(state==='approval_pending'||state==='awaiting_review'))||(r.sender_member_id===me&&state==='review_ready'))needs.push(r);
 else if(['claiming','claimed','running','delivery_pending'].includes(state))working.push(r);
 else if(state==='queued')queued.push(r);
 else if(state==='approval_pending'||state==='review_ready')waiting.push(r);
 else if(['failed','interrupted','delivery_failed'].includes(state))issues.push(r);
}
const summary=$('#home-summary');summary.replaceChildren();for(const [count,title] of [[needs.length,'Need your attention'],[working.length,'In progress'],[queued.length,'Queued'],[waiting.length,'Waiting on others']]){const c=node('div',undefined,'home-stat');c.append(node('strong',String(count)),node('span',title));summary.append(c)}
const groups=$('#home-groups');groups.replaceChildren();for(const [title,items,priority] of [['Needs your attention',needs,true],['In progress',working,false],['Queued · oldest first',queued,false],['Waiting on others',waiting,false],['Needs inspection',issues,false]]){if(!items.length)continue;const section=node('section',undefined,'home-section');section.append(node('h2',title+' · '+items.length));for(const r of items){const state=snapshot.runs[r.id]?.state||r.status,row=node('article',undefined,'home-row'+(priority?' priority':'')),body=node('div');body.append(node('h3',r.title||r.body),node('p',member(r.sender_member_id)+' → '+member(r.owner_member_id)+' · '+repo(r.repo_id)+' · '+label(state)));row.append(body,button(state==='approval_pending'&&r.owner_member_id===me?'Review request':state==='awaiting_review'?'Review change':'Open request',async()=>{chooseView(r.repo_id,r.sender_member_id===me?r.owner_member_id:r.sender_member_id);await selectRequest(r.id)}));section.append(row)}groups.append(section)}
if(!groups.childElementCount)groups.append(node('h2','You’re all caught up'),node('p','No pending requests or queued work. Open Chats to see conversations or start a request.','muted'));
}
for(const name of ['home','chats','settings']){$('#tab-'+name).onclick=()=>setMainTab(name);$('#tab-'+name).onkeydown=e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();const names=['home','chats','settings'],index=names.indexOf(mainTab),target=e.key==='Home'?names[0]:e.key==='End'?names[2]:names[(index+(['ArrowLeft','ArrowUp'].includes(e.key)?2:1))%3];setMainTab(target);$('#tab-'+target).focus()}};}
$('#toggle-sidebar').onclick=()=>{const collapsed=document.querySelector('.workspace').classList.toggle('sidebar-collapsed');$('#toggle-sidebar').setAttribute('aria-expanded',String(!collapsed));$('#toggle-sidebar').setAttribute('aria-label',collapsed?'Show navigation':'Hide navigation')};
$('#toggle-inspector').onclick=()=>setInspector(!inspectorOpen);$('#clear-selection').addEventListener('click',()=>setInspector(false));
if(innerWidth<700)$('#toggle-sidebar').click();setInspector(false);setMainTab('home');
`;
