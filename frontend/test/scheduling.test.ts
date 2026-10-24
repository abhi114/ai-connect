import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { Remote } from '../src/remote.ts';
import { Worker } from '../src/worker.ts';

async function fixture() {
  const store=new Store(await mkdtemp(join(tmpdir(),'aiconnect-queue-')));
  store.state.member={id:'owner',network_id:'network'};
  store.state.members=['alice','bob'].map(id=>({id,network_id:'network'}));
  for(const id of ['a','alias-a','b']) {
    const folder=id==='alias-a'?'a':id;
    store.state.bindings[id]={repo_id:id,path:join(store.dir,folder),git_dir:join(store.dir,folder,'.git'),name:id,questions:'auto',changes:true,paused:false,allowed_paths:['.'],max_diff_bytes:10000};
    store.state.repos.push({id,network_id:'network',owner_member_id:'owner',availability:'active',questions_enabled:true});
  }
  const remote=new Remote(store);
  remote.mutate=async()=>({});
  const worker=new Worker(store,remote);
  const started:string[]=[];
  worker.execute=async(request,run)=>{started.push(request.id);run.state='running';};
  const request=(id:string,repo:string,created:number,sender='alice')=>({id,repo_id:repo,network_id:'network',owner_member_id:'owner',sender_member_id:sender,kind:'question',status:'queued',created_at:created});
  return {store,worker,remote,started,request};
}

test('different repositories run concurrently; same repository is FIFO across senders and aliases',async()=>{
  const {store,worker,started,request}=await fixture();
  // Relay returns newest first; approval-eligible work must run oldest first.
  store.state.requests=[request('a2','alias-a',3,'bob'),request('b1','b',2),request('a1','a',1)];
  await Promise.all([worker.tick(),worker.tick()]);
  assert.deepEqual(started,['a1','b1']);
  assert.equal(store.state.runs.a2,undefined,'queued request is not claimed early');
  assert.equal(store.state.requests[0].id,'a2','scheduler does not reorder the snapshot');
  store.state.runs.a1.state='complete';
  await worker.tick();
  assert.deepEqual(started,['a1','b1','a2']);
});

test('review and pending delivery hold the repository lane, but do not block other repositories',async()=>{
  const {store,worker,started,request}=await fixture();
  store.state.requests=[request('a2','alias-a',2),request('b1','b',3)];
  store.state.runs.a1={request_id:'a1',repo_id:'a',state:'awaiting_review'};
  await worker.tick();
  assert.deepEqual(started,['b1']);
  store.state.runs.a1.state='delivery_pending';
  worker.deliverResult=async()=>{};
  await worker.tick();
  assert.deepEqual(started,['b1']);
  store.state.runs.a1.state='complete';
  await worker.tick();
  assert.deepEqual(started,['b1','a2']);
});

test('cancelled or authority-lost runner must exit before the next same-folder request starts',async()=>{
  const {store,worker,remote,started,request}=await fixture();
  store.state.requests=[request('a1','a',1),request('a2','alias-a',2)];
  store.state.runs.a1={request_id:'a1',repo_id:'a',state:'running',lease_token:'lease'};
  const controller=new AbortController();worker.active.set('a1',controller);
  remote.mutate=async()=>{throw Error('authority lost');};
  await worker.tick();
  assert.equal(controller.signal.aborted,true);
  assert.equal(store.state.runs.a1.state,'interrupted');
  assert.deepEqual(started,[]);
  worker.active.delete('a1'); // execute() finally: process has actually exited.
  await worker.tick();
  assert.deepEqual(started,['a2']);
});

test('unapproved requests do not execute or block approved eligible work',async()=>{
  const {store,worker,started,request}=await fixture();
  store.state.requests=[{...request('unapproved','a',1),status:'approval_pending'},request('eligible','a',2)];
  await worker.tick();
  assert.deepEqual(started,['eligible']);
});
