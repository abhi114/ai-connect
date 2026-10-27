import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { Core } from '../src/core.ts';
import { notificationView } from '../src/notifications.ts';
import { signedRequest } from './fixtures/signing.ts';
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
