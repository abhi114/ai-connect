export const layoutHtml=`<div id="workspace-bar"><button id="toggle-sidebar" aria-label="Hide navigation" aria-expanded="true">☰</button><div role="tablist" aria-label="Workspace views" aria-orientation="vertical"><button id="tab-home" role="tab" aria-selected="true" aria-controls="home-panel" aria-label="Home" title="Home"><span aria-hidden="true">⌂</span><span class="nav-label">Home</span></button><button id="tab-chats" role="tab" aria-selected="false" aria-controls="chat-content" tabindex="-1" aria-label="Chats" title="Chats"><span aria-hidden="true">☏</span><span class="nav-label">Chats</span></button><button id="tab-settings" role="tab" aria-selected="false" aria-controls="setup-dialog" tabindex="-1" aria-label="Settings" title="Settings"><span aria-hidden="true">⚙</span><span class="nav-label">Settings</span></button></div><button id="toggle-inspector" aria-expanded="false" hidden>Show details</button></div><section id="home-panel" role="tabpanel" aria-labelledby="tab-home"><div id="home-summary"></div><div id="home-groups"></div></section>`;

import { homeModel } from './home-model.ts';

export const layoutCss=`
#workspace-bar{display:flex;align-items:center;gap:14px;padding:10px 24px;border-bottom:1px solid var(--line);background:#fcfbf7;flex-shrink:0}
#workspace-bar [role=tablist]{display:flex;gap:6px}#workspace-bar [role=tab]{border-color:transparent;background:transparent;padding:9px 18px;font-weight:600;color:var(--muted)}
#workspace-bar [role=tab][aria-selected=true]{background:#dde5d3;color:#35462d;border-color:#becbad}#toggle-inspector{margin-left:auto;font-size:12px}#toggle-sidebar{padding:6px 11px}
.workspace.sidebar-collapsed{grid-template-columns:0 minmax(0,1fr)}.workspace.sidebar-collapsed>.sidebar{display:none}.workspace.sidebar-collapsed>main{grid-column:2}
#home-panel{overflow:auto;min-height:0;padding:28px clamp(20px,4vw,64px);flex:1}
.home-spotlight{padding:26px 30px;margin:0 0 28px;border:1px solid #c6cdb7;border-left:4px solid #75865f;border-radius:18px;background:linear-gradient(115deg,#eef2e5,#fffdf7);overflow-wrap:anywhere}.home-spotlight h2{font-size:clamp(20px,2.1vw,29px);line-height:1.3;max-width:900px;margin:12px 0}.home-spotlight p{line-height:1.6;color:var(--muted);font-size:13px}.home-preview{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}.home-spotlight .eyebrow{font-size:10px}.home-spotlight button{margin-top:8px}.home-section>summary{cursor:pointer;display:flex;align-items:center;gap:10px;padding:10px 0;list-style:revert;font-weight:650;font-size:14px}.home-section>summary span{border-radius:20px;padding:2px 9px;background:#e6eadc;font-size:12px}.home-section>.hint{margin:0 0 10px}.home-row .home-context{margin-top:6px;font-size:11px}.home-empty{padding:20px;border:1px dashed var(--line);border-radius:12px}.home-empty p{color:var(--muted);font-size:13px}
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
${homeModel.toString()}
let mainTab='home',inspectorOpen=false;
const main=document.querySelector('main'),chatContent=document.querySelector('.content');chatContent.id='chat-content';chatContent.setAttribute('role','tabpanel');chatContent.setAttribute('aria-labelledby','tab-chats');
document.querySelector('.sidebar').prepend($('#workspace-bar'));document.querySelector('.header-actions').append($('#toggle-inspector'));main.insertBefore($('#home-panel'),chatContent);main.insertBefore($('#setup-dialog'),chatContent);
document.querySelector('[role=tablist]').insertBefore($('#tab-agent'),$('#tab-chats'));main.insertBefore($('#local-panel'),chatContent);$('#tab-chats').querySelector('.nav-label').textContent='Network';$('#tab-chats').setAttribute('aria-label','Network');$('#tab-chats').title='Network requests and messages';
document.querySelector('[role=tablist]').insertBefore($('#tab-routines'),$('#tab-settings'));main.insertBefore($('#routines-panel'),chatContent);
function setInspector(open){inspectorOpen=open;chatContent.classList.toggle('details-open',open);$('#toggle-inspector').textContent=open?'Hide details':'Show details';$('#toggle-inspector').setAttribute('aria-expanded',String(open));}
function setMainTab(tab){mainTab=tab;$('#routines-panel').hidden=tab!=='routines';if(tab==='routines')void renderRoutines();main.classList.toggle('chat-mode',tab==='chats'||tab==='agent');$('#local-panel').hidden=tab!=='agent';$('#setup-dialog').hidden=tab!=='settings';$('#home-panel').hidden=tab!=='home';chatContent.hidden=tab!=='chats';document.querySelector('.toolbar').hidden=tab!=='chats';$('#toggle-inspector').hidden=tab!=='chats';for(const name of ['home','agent','chats','routines','settings']){const b=$('#tab-'+name);b.setAttribute('aria-selected',String(name===tab));b.tabIndex=name===tab?0:-1;}if(tab==='settings')void loadTrust().catch(e=>{$('#setup-error').textContent=e.message});if(snapshot){renderNavigation();renderHeader();if(tab==='home')renderHome();else if(tab==='agent')renderLocal();else renderRequests();}}
function renderSettingsHeader(){$('#breadcrumb').textContent='WORKSPACE / SETTINGS';$('#view-title').textContent='Settings';$('#view-description').textContent='Membership, invitations, and your Codex connection.';}
function renderHomeHeader(){$('#breadcrumb').textContent='WORKSPACE / OVERVIEW';$('#view-title').textContent='Home';$('#view-description').textContent='Incoming requests, decisions, and work in progress.';}
const homeSections=new Map();
async function openHomeRequest(r){if(r.local_chat_id){openLocal(r.local_chat_id);return;}chooseView(r.repo_id,r.sender_member_id===snapshot.member?.id?r.owner_member_id:r.sender_member_id);await selectRequest(r.id)}
function homeContext(r,state){const run=snapshot.runs[r.id],parts=[...(r.local_chat_id?['My agent · private']:[]),label(state),time(r.updated_at||r.created_at)];if(r.verification)parts.push('Signature: '+r.verification.status);if(run?.execution)parts.push((run.execution.model||'Codex default')+' · '+(run.execution.reasoning_effort||'default reasoning'));return parts.join(' · ')}
function renderHome(){if(!snapshot||!changed('home',[snapshot.member?.id,snapshot.requests,snapshot.runs,snapshot.members,snapshot.repos,snapshot.local_chats,networkMessages,new Date().toDateString()]))return;
const {groups:g,latest}=homeModel(snapshot,networkMessages),me=snapshot.member?.id;
const summary=$('#home-summary');summary.replaceChildren();for(const [count,title] of [[g.approvals.length,'To approve by me'],[g.reviews.length,'Changes to review'],[g.working.length,'Working'],[g.queued.length,'Queued']]){const c=node('div',undefined,'home-stat');c.append(node('strong',String(count)),node('span',title));summary.append(c)}
const groups=$('#home-groups');groups.replaceChildren();
if(latest){const hero=node('article',undefined,'home-spotlight'),r=latest.request,m=latest.message;
 hero.append(node('div',r?.local_chat_id?'LATEST PRIVATE ACTIVITY':r?'LATEST REQUEST ACTIVITY':'LATEST NETWORK MESSAGE','eyebrow'),node('h2',r?(r.title||r.body):'Message from '+member(m.sender_member_id)),node('p',r?(r.local_chat_id?'My agent · '+repo(r.repo_id):member(r.sender_member_id)+' → '+member(r.owner_member_id)+' · '+repo(r.repo_id)):'Shared with the network · '+time(m.created_at)));
 if(!r||r.body!==r.title)hero.append(node('p',r?r.body:m.body,'home-preview'));
 if(r)hero.append(node('p',homeContext(r,snapshot.runs[r.id]?.state==='complete'?r.status:(snapshot.runs[r.id]?.state||r.status))));
 hero.append(button(r?.local_chat_id?'Open private chat':r?'Open request':'Open network chat',async()=>{if(r)await openHomeRequest(r);else{chooseView();$('#filter').value='all';$('#search').value='';renderRequests(true)}}));groups.append(hero);
}
for(const [key,title,hint,priority] of [['approvals','To approve by me','Needs your attention · choose a model and approve or reject.',true],['reviews','Changes needing my review','Inspect the change before committing locally or delivering it, or open a delivered result.',true],['working','Working now','Agents currently executing or delivering results.',false],['queued','Queued · oldest first','One request per local repository runs at a time.',false],['waiting','Waiting on others','Requests waiting for the other participant to act.',false],['today','Changes completed today','Local work and network results updated today. Completion does not mean merged or pushed.',false],['issues','Needs inspection','Failed or interrupted requests. Open the details before retrying.',true]]){
 const items=g[key];if(!items.length)continue;const section=node('details',undefined,'home-section'),heading=node('summary',title);heading.append(node('span',String(items.length)));section.open=homeSections.get(key)??true;section.ontoggle=()=>homeSections.set(key,section.open);section.append(heading,node('p',hint,'hint'));
 for(const {request:r,state} of items){const row=node('article',undefined,'home-row'+(priority?' priority':'')),body=node('div');body.append(node('h3',r.title||r.body),node('p',(r.kind==='change'?'Change':'Question')+' · '+repo(r.repo_id)+' · '+member(r.sender_member_id)+' → '+member(r.owner_member_id)),node('p',homeContext(r,state),'home-context'));row.append(body,button(key==='approvals'?'Review request':key==='reviews'?'Review change':'Open request',()=>openHomeRequest(r)));section.append(row)}groups.append(section);
}
if(!g.approvals.length&&!g.reviews.length&&!g.working.length&&!g.queued.length&&!g.waiting.length&&!g.issues.length){const empty=node('div',undefined,'home-empty');empty.append(node('h3','No pending work'),node('p',latest?'Your latest activity is above. Open Chats for the full history.':'Share a repository or open Chats to start collaborating.'));groups.append(empty)}
}
for(const name of ['home','agent','chats','routines','settings']){$('#tab-'+name).onclick=()=>setMainTab(name);$('#tab-'+name).onkeydown=e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();const names=['home','agent','chats','routines','settings'],index=names.indexOf(mainTab),target=e.key==='Home'?names[0]:e.key==='End'?names[4]:names[(index+(['ArrowLeft','ArrowUp'].includes(e.key)?4:1))%5];setMainTab(target);$('#tab-'+target).focus()}};}
$('#toggle-sidebar').onclick=()=>{const collapsed=document.querySelector('.workspace').classList.toggle('sidebar-collapsed');$('#toggle-sidebar').setAttribute('aria-expanded',String(!collapsed));$('#toggle-sidebar').setAttribute('aria-label',collapsed?'Show navigation':'Hide navigation')};
$('#toggle-inspector').onclick=()=>setInspector(!inspectorOpen);$('#clear-selection').addEventListener('click',()=>setInspector(false));
if(innerWidth<700)$('#toggle-sidebar').click();setInspector(false);setMainTab('home');
`;
