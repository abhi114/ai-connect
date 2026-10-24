import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../backend/src/server.ts';
import { Store } from '../src/store.ts';
import { Core } from '../src/core.ts';
import { git, approvedPath, identify, verifyBinding } from '../src/git.ts';
import { handle, tools } from '../src/mcp.ts';
import { authorize } from '../src/policy.ts';
import { startDaemon } from '../src/daemon.ts';
import { Remote } from '../src/remote.ts';
import { Worker } from '../src/worker.ts';
import { js } from '../src/dashboard.ts';

async function waitFor(fn:()=>boolean) {for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,30))}throw Error('Condition timed out')}

test('owner approval, pinned question, reviewed change and immutable delivery through real relay',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'rn-client-'));const repo=join(dir,'repo');await mkdir(repo);
  await git(repo,'init');await git(repo,'config','user.name','Test Owner');await git(repo,'config','user.email','owner@example.test');
  await writeFile(join(repo,'hello.txt'),'hello\n');await git(repo,'add','.');await git(repo,'commit','-m','initial');
  const original=await git(repo,'rev-parse','HEAD');
  const app=createApp({rateLimit:10_000});await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));
  const server=`http://127.0.0.1:${(app.server.address() as any).port}`;
  const alice=new Core(new Store(join(dir,'alice')));const bob=new Core(new Store(join(dir,'bob')));
  try{
    await alice.dispatch('enroll',{name:'Test network',handle:'alice',server});
    const invite=await alice.dispatch('invite');await bob.dispatch('enroll',{code:invite.code,handle:'bob',server});
    const {repo:published}=await alice.dispatch('expose',{path:repo,name:'hello',description:'Toy test repository',questions:'auto',changes:true});
    assert.equal(JSON.stringify(await bob.remote.call('/v1/repos')).includes(repo),false,'local path never published');
    await bob.sync();let calls=0;
    alice.modelLoader=async()=>({fetched_at:Date.now(),models:[{model:'test-model',name:'Test',efforts:['high'],isDefault:true}]});
    alice.worker.runner=async(request,worktree,signal,execution)=>{calls++;if(request.kind==='change'){assert.deepEqual(execution,{model:'test-model',reasoning_effort:'high'});await writeFile(join(worktree,'hello.txt'),'hello from isolated change\n')}return {answer:'See hello.txt:1',sources:[{path:'hello.txt',line:1}]};};
    const {request:question}=await bob.dispatch('ask_repo',{repo_id:published.id,body:'What does hello contain?'});
    await alice.sync();await waitFor(()=>alice.store.state.runs[question.id]?.state==='complete');
    const answer=await bob.dispatch('get_request',{request_id:question.id});assert.equal(answer.request.status,'answered');assert.equal(answer.result.base_commit,original);assert.equal(answer.result.sources[0].path,'hello.txt');
    const {request:change}=await bob.dispatch('request_change',{repo_id:published.id,body:'Change the greeting'});
    await alice.sync();assert.equal(change.status,'approval_pending');assert.equal(calls,1,'unapproved change does not execute');
    await assert.rejects(bob.dispatch('approve',{request_id:change.id,execution:{model:'test-model'}}),/owner/);
    await assert.rejects(alice.dispatch('approve',{request_id:change.id,execution:{model:'test-model',reasoning_effort:'ultra'}}),/not supported/);
    assert.equal(alice.store.state.approvals[change.id],undefined);
    await alice.dispatch('approve',{request_id:change.id,execution:{model:'test-model',reasoning_effort:'high'}});await waitFor(()=>alice.store.state.runs[change.id]?.state==='awaiting_review');
    assert.deepEqual(new Store(alice.store.dir).state.execution_options?.[change.id],{model:'test-model',reasoning_effort:'high'});
    assert.deepEqual((await alice.dispatch('get_request',{request_id:change.id})).local_run.execution,{model:'test-model',reasoning_effort:'high'});
    await assert.rejects(alice.dispatch('approve',{request_id:change.id,execution:{}}),/current state|locked/);
    assert.equal(await readFile(join(repo,'hello.txt'),'utf8'),'hello\n');assert.equal(await git(repo,'status','--porcelain=v1'),'');
    const run=alice.store.state.runs[change.id];assert.equal(await git(run.worktree!,'rev-parse','HEAD'),original);
    await alice.dispatch('deliver',{request_id:change.id});
    const result=await bob.dispatch('get_request',{request_id:change.id});assert.equal(result.request.status,'review_ready');assert.equal(result.result.delivery,'local_branch');assert.equal(result.result.tests[0].status,'skipped');
    assert.equal(result.result.summary,'See hello.txt:1','The requester receives the AI response for a delivered change');
    assert.equal(await git(repo,'rev-parse',result.result.branch),result.result.commit);assert.equal(await git(repo,'rev-parse','HEAD'),original);
    await alice.sync();assert.equal(calls,2,'sync replay does not run twice');
    await bob.dispatch('accept',{request_id:change.id});assert.equal((await bob.dispatch('get_request',{request_id:change.id})).request.status,'accepted');
    const {request:rejected}=await bob.dispatch('request_change',{repo_id:published.id,body:'Should never execute'});await alice.dispatch('reject',{request_id:rejected.id});await alice.sync();assert.equal(calls,2);
  }finally{alice.worker.stop();bob.worker.stop();await app.close();}
});

test('local policy rejects missing approvals, spoofed owner, protected and out-of-scope paths',()=>{
  assert.equal(approvedPath('src/index.ts',['src']),true);
  for(const path of ['../secret','/etc/passwd','.env','.env.production','src/key.pem','.git/config','.codex/config.toml'])assert.equal(approvedPath(path,['.']),false,path);
  assert.equal(approvedPath('other/file.ts',['src']),false);
  const request:any={id:'q',repo_id:'r',network_id:'n',owner_member_id:'owner',sender_member_id:'sender',kind:'change',status:'queued'};
  const state:any={member:{id:'owner',network_id:'n'},members:[{id:'sender',network_id:'n'}],repos:[{id:'r',network_id:'n',owner_member_id:'owner',availability:'active',changes_enabled:true}],bindings:{r:{changes:true}},approvals:{}};
  assert.throws(()=>authorize(state,request),/approved locally/);assert.throws(()=>authorize(state,{...request,owner_member_id:'evil'}),/Wrong owner/);
});

test('MCP tool contract validates targets and cannot expose approval or local filesystem tools',async()=>{
  assert.equal(tools.length,8);assert.equal(tools.some(t=>t.name==='approve'),false);
  const result=await handle({method:'tools/call',params:{name:'request_change',arguments:{body:'Fix it'}}},async()=>{throw Error('must not call')});assert.equal(result.isError,true);
  const initialize=await handle({method:'initialize',params:{protocolVersion:'2025-03-26'}});assert.equal(initialize.protocolVersion,'2025-03-26');
  const offline=await handle({method:'tools/call',params:{name:'network_status'}},async()=>{throw Error('Companion unavailable')});assert.equal(offline.isError,true);
});

test('localhost dashboard requires token, rejects hostile origins and serves CSP',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'rn-local-'));const daemon=await startDaemon(dir,0);const base=`http://127.0.0.1:${daemon.port}`;
  try{
    const page=await fetch(base);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy')!,/frame-ancestors 'none'/);
    const payload={method:'snapshot'};
    const denied=await fetch(base+'/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});assert.equal(denied.status,401);
    const hostile=await fetch(base+'/rpc',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${daemon.core.store.state.session_token}`,Origin:'https://evil.example'},body:JSON.stringify(payload)});assert.equal(hostile.status,403);
    const allowed=await fetch(base+'/rpc',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${daemon.core.store.state.session_token}`},body:JSON.stringify(payload)});assert.equal(allowed.status,200);
  }finally{await daemon.stop()}
});

test('outbound retries retain the exact idempotency key and restart never re-executes old jobs',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'rn-recovery-'));const store=new Store(dir);const remote=new Remote(store);
  store.state.member={id:'owner',network_id:'network'};store.state.device={id:'device'};
  const sent:any[]=[];let offline=true;
  remote.call=async(path,method,body)=>{sent.push({path,method,body});if(offline)throw Error('connection lost');return {request:{id:'durable'}}};
  const queued=await remote.durable('/v1/requests',{body:'hello'});assert.equal(queued.pending,true);assert.equal(store.state.outbox.length,1);
  const restarted=new Store(dir);assert.equal(restarted.state.outbox[0].body.idempotency_key,sent[0].body.idempotency_key);
  offline=false;await remote.flush();assert.equal(store.state.outbox.length,0);assert.deepEqual(sent[0],sent[1]);
  store.state.runs.old={request_id:'old',repo_id:'r',state:'running',worktree:'/preserved/worktree'};store.save();
  const worker=new Worker(new Store(dir),remote,async()=>{throw Error('Must not execute')});
  assert.equal(worker.store.state.runs.old.state,'interrupted');assert.equal(worker.store.state.runs.old.worktree,'/preserved/worktree');
});

test('repository identity checks prevent rebinding and dashboard JS parses',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'rn-binding-'));await git(dir,'init');await writeFile(join(dir,'f'),'x');await git(dir,'add','.');await git(dir,'-c','user.name=Test','-c','user.email=t@localhost','commit','-m','init');
  const identity=await identify(dir);await assert.rejects(verifyBinding({...identity,git_dir:identity.git_dir+'-replaced'} as any),/identity changed/);
  assert.doesNotThrow(()=>new Function(js));
});
