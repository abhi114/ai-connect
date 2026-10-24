import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Core } from '../src/core.ts';
import { Store } from '../src/store.ts';
import { createApp } from '../../backend/src/server.ts';
import { RemoteError } from '../src/remote.ts';

test('dashboard general chat uses existing membership and preserves participant privacy',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'aiconnect-chat-'));
  const app=createApp({rateLimit:10000});
  await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const server=`http://127.0.0.1:${(app.server.address() as any).port}`;
  const alice=new Core(new Store(join(dir,'alice'))),bob=new Core(new Store(join(dir,'bob'))),carol=new Core(new Store(join(dir,'carol')));
  try {
    await alice.dispatch('enroll',{name:'Chat test',handle:'alice',server});
    await bob.dispatch('enroll',{code:(await alice.dispatch('invite')).code,handle:'bob',server});
    await carol.dispatch('enroll',{code:(await alice.dispatch('invite')).code,handle:'carol',server});
    const {message}=await alice.dispatch('send_message',{body:'Hello network',sender_member_id:bob.store.state.member.id});
    assert.equal(message.sender_member_id,alice.store.state.member.id);
    assert.equal((await carol.dispatch('list_messages')).messages[0].body,'Hello network');
    await bob.dispatch('send_message',{body:'Second message'});
    const page=await alice.dispatch('list_messages',{limit:1});
    assert.equal(page.messages[0].body,'Second message');assert.ok(page.next_before);
    assert.equal((await alice.dispatch('list_messages',{before:page.next_before,limit:1})).messages[0].body,'Hello network');
    const {repo}=await alice.remote.mutate('/v1/repos',{slug:'private-demo',questions_enabled:true,questions_require_approval:true});
    await bob.sync();
    const {request}=await bob.dispatch('ask_repo',{repo_id:repo.id,body:'Private request body'});
    await carol.sync();assert.equal(carol.store.state.requests.length,0);
    await assert.rejects(carol.dispatch('get_request',{request_id:request.id}));
    assert.ok(!(await carol.dispatch('list_messages')).messages.some((m:any)=>m.body==='Private request body'));
    for(const args of [{body:''},{body:' '.repeat(10)},{body:'a'.repeat(8001)},{body:123}])await assert.rejects(alice.dispatch('send_message',args));
    for(const args of [{limit:0},{limit:101},{before:-1},{before:'1'}])await assert.rejects(alice.dispatch('list_messages',args));
    alice.folderPicker=async()=>({path:null});assert.deepEqual(await alice.dispatch('pick_folder'),{path:null});
    alice.folderPicker=async()=>({path:'/picked/repo'});assert.deepEqual(await alice.dispatch('pick_folder'),{path:'/picked/repo'});
    assert.equal(Object.keys(alice.store.state.bindings).length,0,'Selecting a folder never publishes it');
  } finally {alice.worker.stop();bob.worker.stop();carol.worker.stop();await app.close();}
});

test('offline general chat queues once and keeps its idempotency key on retry',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'aiconnect-chat-offline-'));const core=new Core(new Store(dir));
  core.store.state.member={id:'owner'};let online=false;const keys:string[]=[];
  core.remote.call=async(path,method,body)=>{keys.push(body.idempotency_key);if(!online)throw Error('offline');return {message:{id:1}};};
  const result=await core.dispatch('send_message',{body:'Send when connected'});
  assert.equal(result.pending,true);assert.equal(core.store.state.outbox.length,1);
  online=true;await core.remote.flush();assert.equal(core.store.state.outbox.length,0);assert.equal(keys[0],keys[1]);
});

test('rate limits and temporary timeouts retain queued chat until a successful retry',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'aiconnect-chat-retry-'));const core=new Core(new Store(dir));
  core.store.state.member={id:'owner'};let status=429;const keys:string[]=[];
  core.remote.call=async(path,method,body)=>{keys.push(body.idempotency_key);if(status)throw new RemoteError(status,'retry later');return {message:{id:1}};};
  assert.equal((await core.dispatch('send_message',{body:'Do not lose this message'})).pending,true);
  await assert.rejects(core.remote.flush());assert.equal(core.store.state.outbox.length,1);
  status=408;await assert.rejects(core.remote.flush());assert.equal(core.store.state.outbox.length,1);
  status=0;await core.remote.flush();assert.equal(core.store.state.outbox.length,0);
  assert.equal(new Set(keys).size,1);
});
