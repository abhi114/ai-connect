import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { Core } from '../src/core.ts';
import { notificationView } from '../src/notifications.ts';
import { signedRequest } from './fixtures/signing.ts';
import { approvalDigest } from '../src/policy.ts';
async function fixture(){const store=new Store(await mkdtemp(join(tmpdir(),'aiconnect-notifications-')));store.state.member={id:'owner',network_id:'network'};store.state.bindings.repo={repo_id:'repo',name:'demo',path:'/not-used',git_dir:'/not-used',questions:'ask',changes:true,paused:false,allowed_paths:['.'],max_diff_bytes:1000};const r=signedRequest(store.state,{id:'one',network_id:'network',sender_member_id:'bob',owner_member_id:'owner',repo_id:'repo',kind:'question',title:'Explain',body:'Private full text',constraints:[],base_ref:null,status:'approval_pending'});store.state.requests=[r];return {store,r};}
test('notification view gates approval by ownership, trust, local policy and connectivity',async()=>{
 const {store,r}=await fixture();let view=notificationView(store.state,true);assert.equal(view.pending,1);assert.ok(view.rows[0].actions.includes('approve'));assert.ok(!JSON.stringify(view).includes('Private full text'));assert.ok(!JSON.stringify(view).includes('session_token'));
 assert.deepEqual(notificationView(store.state,false).rows[0].actions,[]);
 r.body='tampered';assert.ok(!notificationView(store.state,true).rows[0].actions.includes('approve'));
 r.owner_member_id='someone-else';r.sender_member_id='third-person';assert.equal(notificationView(store.state,true).rows.length,0);
});
test('auto questions remain visible without approval, changes and review remain explicit',async()=>{
 const {store,r}=await fixture();store.state.bindings.repo.questions='auto';r.status='queued';assert.equal(notificationView(store.state,true).rows[0].pending,false);assert.ok(!notificationView(store.state,true).rows[0].actions.includes('approve'));
 store.state.runs.one={request_id:'one',repo_id:'repo',state:'awaiting_review'};assert.equal(notificationView(store.state,true).rows[0].status,'awaiting_review');assert.ok(!notificationView(store.state,true).rows[0].actions.includes('approve'));
});
test('notification action rejects missing consent, stale state and untrusted approvals',async()=>{
 const {store,r}=await fixture(),core=new Core(store);core.connected=true;core.sync=async()=>{};
 await assert.rejects(core.dispatch('notification_action',{request_id:'one',action:'approve'}),/Confirm/);
 await assert.rejects(core.dispatch('notification_action',{request_id:'one',action:'deliver',confirmed:true}),/supported/);
 r.status='answered';await assert.rejects(core.dispatch('notification_action',{request_id:'one',action:'approve',confirmed:true}),/unavailable/);
 r.status='approval_pending';r.body='tampered';await assert.rejects(core.dispatch('notification_action',{request_id:'one',action:'approve',confirmed:true}),/unavailable/);
});
test('notification approval uses the existing signed approval digest with default execution',async()=>{
 const {store,r}=await fixture(),core=new Core(store);core.connected=true;core.sync=async()=>{};
 core.remote.call=async()=>({request:r});core.remote.refreshTrust=async()=>{};
 let endpoint='';core.remote.durable=async(path)=>{endpoint=path;return {request:r}};
 await core.dispatch('notification_action',{request_id:r.id,action:'approve',confirmed:true});
 assert.equal(endpoint,'/v1/requests/one/approve');assert.ok(store.state.approvals.one);assert.deepEqual(store.state.execution_options?.one,{});
 assert.ok(!notificationView(store.state,true).rows[0].actions.includes('approve'));
});
test('menu retry requires consent, returns to fresh approval, and archives failed work on approval',async()=>{
 const {store,r}=await fixture(),core=new Core(store);core.connected=true;core.sync=async()=>{};
 r.status='failed';store.state.approvals[r.id]='old-approval';
 store.state.runs[r.id]={request_id:r.id,repo_id:r.repo_id,state:'failed',error:'AI timed out',worktree:'/preserved-work'};
 core.remote.call=async()=>({request:{...r}});core.remote.refreshTrust=async()=>{};
 core.remote.durable=async(path)=>{if(path.endsWith('/retry'))r.status='approval_pending';else if(path.endsWith('/approve'))r.status='queued';return {request:r}};
 assert.ok(notificationView(store.state,true).rows[0].actions.includes('retry'));
 await assert.rejects(core.dispatch('retry',{request_id:r.id}),/Confirm/);
 await core.dispatch('notification_action',{request_id:r.id,action:'retry',confirmed:true});
 const row=notificationView(store.state,true).rows[0];assert.equal(row.pending,true);assert.ok(row.actions.includes('approve'));
 assert.equal(store.state.runs[r.id].worktree,'/preserved-work');
 await core.dispatch('approve',{request_id:r.id,execution:{}});
 assert.equal(store.state.runs[r.id],undefined);
 assert.equal(store.state.run_attempts?.[r.id][0].worktree,'/preserved-work');
 assert.notEqual(store.state.approvals[r.id],'old-approval');
});

test('menu approval validates model and effort and stores owner context separately from peer request',async()=>{
 const {store,r}=await fixture(),core=new Core(store);core.connected=true;core.sync=async()=>{};
 core.remote.call=async()=>({request:r});core.remote.refreshTrust=async()=>{};
 core.modelLoader=async()=>({models:[{model:'test-model',name:'Test model',efforts:['medium'],isDefault:false}],fetched_at:Date.now()});
 const sent:any[]=[];core.remote.durable=async(path,body)=>{sent.push({path,body});return {request:r}};
 await assert.rejects(core.dispatch('notification_action',{request_id:r.id,action:'approve',confirmed:true,execution:{model:'test-model',reasoning_effort:'invalid'}}),/not supported/);
 const execution={model:'test-model',reasoning_effort:'medium'};
 await core.dispatch('notification_action',{request_id:r.id,action:'approve',confirmed:true,execution,owner_context:'Focus on rounding edge cases'});
 assert.deepEqual(store.state.execution_options?.[r.id],execution);
 assert.equal(store.state.owner_contexts?.[r.id],'Focus on rounding edge cases');
 assert.equal(r.body,'Private full text');assert.deepEqual(sent[0].body,{});
 assert.equal(store.state.approvals[r.id],approvalDigest(r,execution,'Focus on rounding edge cases'));
 assert.notEqual(store.state.approvals[r.id],approvalDigest(r,execution,'different instructions'));
});

test('queued automatic questions accept owner context, while started work rejects late changes',async()=>{
 const {store,r}=await fixture(),core=new Core(store);core.connected=true;
 r.status='queued';store.state.bindings.repo.questions='auto';
 core.sync=async()=>{throw Error('must not start the queue before context save')};
 core.remote.call=async()=>({request:r});core.remote.refreshTrust=async()=>{};
 assert.ok(notificationView(store.state,true).rows[0].actions.includes('owner_context'));
 await core.dispatch('notification_action',{request_id:r.id,action:'owner_context',confirmed:true,owner_context:'Use short examples'});
 assert.equal(store.state.owner_contexts?.[r.id],'Use short examples');
 await assert.rejects(core.dispatch('owner_context',{request_id:r.id,confirmed:true,owner_context:'x'.repeat(8001)}),/8000/);
 store.state.runs[r.id]={request_id:r.id,repo_id:r.repo_id,state:'claiming'};
 assert.ok(!notificationView(store.state,true).rows[0].actions.includes('owner_context'));
 await assert.rejects(core.dispatch('owner_context',{request_id:r.id,confirmed:true,owner_context:'late'}),/locked/);
 assert.equal(store.state.owner_contexts?.[r.id],'Use short examples');
});
