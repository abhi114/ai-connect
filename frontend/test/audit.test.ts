import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.ts';
import { Core } from '../src/core.ts';
import { appendAudit,activityLog,auditRelayEvents,AUDIT_LIMIT } from '../src/audit.ts';
import { signedRequest } from './fixtures/signing.ts';
import { publicActivity } from '../src/activity.ts';
import { html,js } from '../src/dashboard.ts';
import { startDaemon } from '../src/daemon.ts';

async function fixture(){const store=new Store(await mkdtemp(join(tmpdir(),'aiconnect-audit-')));store.state.member={id:'me',network_id:'net'};store.state.members=[{id:'me',handle:'owner'},{id:'peer',handle:'teammate'}];store.state.bindings.repo={repo_id:'repo',path:'/test',git_dir:'/test/.git',name:'Demo',questions:'ask',changes:true,paused:false,allowed_paths:['.'],max_diff_bytes:10000};return store;}
test('computer scope excludes unrelated network noise and separates outgoing work',async()=>{
 const store=await fixture();
 const base={network_id:'net',repo_id:'repo',sender_member_id:'peer',owner_member_id:'me',kind:'question',title:'Explain taxes',created_at:100,status:'approval_pending'};
 const own=signedRequest(store.state,{...base,id:'incoming'}),out=signedRequest(store.state,{...base,id:'outgoing',repo_id:'elsewhere',sender_member_id:'me',owner_member_id:'peer'});
 store.state.requests=[own,out,{...base,id:'unrelated',repo_id:'elsewhere',sender_member_id:'other',owner_member_id:'another'}];
 auditRelayEvents(store,[{id:1,type:'request.created',request_id:own.id,actor_member_id:'peer',created_at:100},{id:2,type:'message.created',actor_member_id:'peer',created_at:100},{id:3,type:'request.created',request_id:'unrelated',actor_member_id:'other',created_at:100}]);
 auditRelayEvents(store,[{id:1,type:'request.created',request_id:own.id,actor_member_id:'peer',created_at:100}]);
 assert.equal(store.state.audit_log?.length,1);
 const local=activityLog(store.state);assert.equal(local.total,1);assert.equal(local.entries[0].request_id,'incoming');assert.equal(local.entries[0].source,'relay');
 assert.deepEqual(activityLog(store.state,{scope:'outgoing'}).entries.map(e=>e.request_id),['outgoing']);
 assert.equal(activityLog(store.state,{scope:'all'}).total,2);
});
test('filters use explicit date boundaries, kind, actor, outcome and project with pagination',async()=>{
 const store=await fixture();
 for(let i=0;i<5;i++)appendAudit(store,{category:i%2?'change':'question',kind:i%2?'change':'question',action:'test',summary:'Observed event '+i,at:100+i,actor:i%2?'you':'peer',outcome:i===4?'blocked':'allowed',repo_id:i===0?'other':'repo'});
 assert.equal(activityLog(store.state,{from:101,to:104}).total,3);
 assert.equal(activityLog(store.state,{kind:'change',actor:'you',repo_id:'repo'}).total,2);
 assert.equal(activityLog(store.state,{outcome:'blocked'}).total,1);
 const page=activityLog(store.state,{limit:2});assert.equal(page.entries.length,2);assert.equal(page.next_offset,2);assert.equal(activityLog(store.state,{offset:page.next_offset!,limit:2}).entries[0].at,102);
 assert.throws(()=>activityLog(store.state,{category:'secrets'}),/Invalid/);assert.throws(()=>activityLog(store.state,{from:200,to:100}),/end date/);assert.throws(()=>activityLog(store.state,{limit:5000}),/page/);
});
test('command metadata is kept out of the overview but can be explicitly inspected',async()=>{
 const store=await fixture();appendAudit(store,{category:'execution',action:'command.finished',summary:'Workspace command · exit 0',outcome:'completed'});
 assert.equal(activityLog(store.state).total,0);assert.equal(activityLog(store.state,{category:'execution'}).total,1);assert.equal(activityLog(store.state,{include_execution:true}).total,1);
});
test('audit is bounded, survives restart, and never copies arbitrary payload fields',async()=>{
 const store=await fixture();appendAudit(store,{category:'access',action:'diff',summary:'Diff requested',detail:'Bearer sensitive-token API_KEY=secret',session_token:'do-not-copy',owner_context:'private instructions'} as any);
 const text=JSON.stringify(store.state.audit_log);assert.ok(!text.includes('sensitive-token'));assert.ok(!text.includes('do-not-copy'));assert.ok(!text.includes('private instructions'));assert.match(text,/redacted/);
 const entry=store.state.audit_log![0];store.state.audit_log=Array.from({length:AUDIT_LIMIT},(_,i)=>({...entry,id:String(i)}));
 appendAudit(store,{category:'trust',action:'trust',summary:'Trust changed'});assert.equal(store.state.audit_log.length,AUDIT_LIMIT);assert.equal(store.state.audit_dropped,1);
 const restored=new Store(store.dir);assert.equal(restored.state.audit_log?.length,AUDIT_LIMIT);assert.equal(restored.state.audit_dropped,1);
});
test('blocked local actions are audited, while read-only polling never produces log noise',async()=>{
 const store=await fixture(),core=new Core(store);
 await core.dispatch('snapshot');await core.dispatch('network_status');await core.dispatch('activity_log');assert.equal(store.state.audit_log,undefined);
 await assert.rejects(core.dispatch('diff',{request_id:'missing',path:'../../private'}));
 const entry=store.state.audit_log![0];assert.equal(entry.category,'access');assert.equal(entry.path,'../../private');assert.ok(['blocked','failed'].includes(entry.outcome));
 await core.dispatch('activity_log');assert.equal(store.state.audit_log!.length,1);
 assert.equal(publicActivity({type:'item.completed',item:{id:'secret',type:'reasoning',text:'hidden reasoning'}}),undefined);
});
test('historical records are labeled as metadata rather than fabricated access events',async()=>{
 const store=await fixture();store.state.requests=[{id:'old',kind:'change',repo_id:'repo',sender_member_id:'peer',owner_member_id:'me',title:'Old task',created_at:10}];
 const result=activityLog(store.state);assert.equal(result.entries[0].source,'history');assert.match(result.entries[0].detail!,/metadata only/);assert.equal(store.state.audit_log,undefined);
});
test('activity page has local scope, day filters and safe text rendering',()=>{
 assert.match(html,/id="tab-log"/);assert.match(html,/On this computer/);assert.match(html,/Last 7 days/);
 assert.match(js,/rpc\('activity_log'/);assert.match(js,/function renderAuditEntries/);assert.doesNotThrow(()=>new Function(js));
 assert.doesNotMatch(js,/\.innerHTML\s*=/);
});
test('real companion rejects and audits unauthenticated RPC without retaining supplied credentials',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'aiconnect-audit-http-')),daemon=await startDaemon(dir,0);t.after(()=>daemon.stop());
 const base=new URL(daemon.url).origin;
 const denied=await fetch(base+'/rpc',{method:'POST',headers:{Authorization:'Bearer not-a-real-secret','Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,401);
 await fetch(base+'/favicon.ico');
 const log=await daemon.core.dispatch('activity_log',{category:'access'});
 assert.equal(log.total,1);assert.equal(log.entries[0].actor,'unknown');assert.equal(log.entries[0].outcome,'blocked');
 assert.ok(!JSON.stringify(daemon.core.store.state.audit_log).includes('not-a-real-secret'));
 assert.equal((await fetch(base+'/activity')).status,200);
});
