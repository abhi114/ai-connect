import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { Core } from '../src/core.ts';
import { git } from '../src/git.ts';
import { createApp } from '../../backend/src/server.ts';
import { localInstructions,parseLocalResponse } from '../src/local-codex.ts';

async function wait(fn:()=>boolean){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,15));}throw Error('Wait timed out');}
async function repository(root:string,name:string){const path=join(root,name);await mkdir(path);await git(path,'init');await writeFile(join(path,'hello.txt'),'hello\n');await git(path,'add','.');await git(path,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','initial');return path;}
async function localFixture(){const root=await mkdtemp(join(tmpdir(),'aiconnect-local-test-'));const path=await repository(root,'project');const core=new Core(new Store(join(root,'profile')));const {binding}=await core.dispatch('local_attach',{path,name:'Private project'});const {chat}=await core.dispatch('local_create',{repo_id:binding.repo_id,title:'Private conversation'});return {root,path,core,binding,chat};}

test('private conversations persist, use an isolated persistent worktree, and run without relay enrollment',async()=>{
 const {path,core,binding,chat}=await localFixture();const inputs:any[]=[];
 core.worker.local.runner=async(input)=>{inputs.push(input);return {answer:'Remember: shipping threshold is 50'};};
 const {turn:first}=await core.dispatch('local_send',{chat_id:chat.id,body:'Remember the shipping rule',kind:'question'});
 await wait(()=>core.store.state.runs[first.id].state==='complete');
 assert.equal(core.store.state.outbox.length,0);assert.equal(core.store.state.repos.length,0);
 const restarted=new Core(new Store(core.store.dir));restarted.worker.local.runner=async(input,worktree)=>{inputs.push(input);assert.equal(worktree,chat.worktree);return {answer:'The previous threshold was 50'};};
 const {turn:second}=await restarted.dispatch('local_send',{chat_id:chat.id,body:'What did we discuss?',kind:'question'});
 await wait(()=>restarted.store.state.runs[second.id].state==='complete');
 assert.deepEqual(inputs[1].conversation,[{owner:'Remember the shipping rule',agent:'Remember: shipping threshold is 50'}]);
 assert.equal(restarted.store.state.bindings[binding.repo_id].path,await realpath(path));
 assert.notEqual(chat.worktree,path);assert.equal(await git(path,'status','--porcelain=v1'),'');
 await assert.rejects(core.dispatch('local_create',{repo_id:'someone-elses-repo'}),/attached/);
});

test('local edits require explicit consent, hold the shared repo queue for review, and never merge',async()=>{
 const {path,core,binding,chat}=await localFixture();const original=await git(path,'rev-parse','HEAD');let calls=0;
 core.worker.local.runner=async(_input,worktree,_signal,_execution,change)=>{calls++;if(change)await writeFile(join(worktree,'hello.txt'),'edited\n');return {answer:'Done'};};
 await assert.rejects(core.dispatch('local_send',{chat_id:chat.id,body:'Edit greeting',kind:'change'}),/Confirm/);
 const {turn}=await core.dispatch('local_send',{chat_id:chat.id,body:'Edit greeting',kind:'change',confirmed:true});
 await wait(()=>core.store.state.runs[turn.id].state==='awaiting_review');
 const {chat:other}=await core.dispatch('local_create',{repo_id:binding.repo_id});
 const {turn:queued}=await core.dispatch('local_send',{chat_id:other.id,body:'What is here?',kind:'question'});
 assert.equal(core.store.state.runs[queued.id].state,'queued');assert.equal(calls,1);
 await assert.rejects(core.dispatch('local_review',{turn_id:turn.id}),/Confirm/);
 assert.match((await core.dispatch('diff',{request_id:turn.id})).diff,/edited/);
 const restarted=new Core(new Store(core.store.dir));assert.equal(restarted.store.state.runs[turn.id].state,'awaiting_review');restarted.worker.local.runner=core.worker.local.runner;
 const result=await restarted.dispatch('local_review',{turn_id:turn.id,confirmed:true});assert.ok(result.commit);
 await wait(()=>restarted.store.state.runs[queued.id].state==='complete');
 assert.equal(await git(path,'rev-parse','HEAD'),original);assert.equal(await readFile(join(path,'hello.txt'),'utf8'),'hello\n');
 assert.equal(await readFile(join(chat.worktree!,'hello.txt'),'utf8'),'edited\n');
});

test('local and remote work share one repository lane, while a different repo runs concurrently',async()=>{
 const root=await mkdtemp(join(tmpdir(),'aiconnect-mixed-test-'));const a=await repository(root,'a'),b=await repository(root,'b');
 const relay=createApp({rateLimit:10000});await new Promise<void>(r=>relay.server.listen(0,'127.0.0.1',r));const server=`http://127.0.0.1:${(relay.server.address() as any).port}`;
 const owner=new Core(new Store(join(root,'owner'))),peer=new Core(new Store(join(root,'peer')));let release!:()=>void;
 try{await owner.dispatch('enroll',{name:'Mixed queue',handle:'owner',server});await peer.dispatch('enroll',{code:(await owner.dispatch('invite')).code,handle:'peer',server});
 const {repo:ra}=await owner.dispatch('expose',{path:a,name:'a',questions:'auto'}),{repo:rb}=await owner.dispatch('expose',{path:b,name:'b',questions:'auto'});await peer.sync();
 // A separate alias of the same Git directory must use the same lane.
 owner.store.state.bindings['private-alias']={...owner.store.state.bindings[ra.id],repo_id:'private-alias'};
 const {chat}=await owner.dispatch('local_create',{repo_id:'private-alias'});const latch=new Promise<void>(r=>release=r);
 owner.worker.local.runner=async()=>{await latch;return {answer:'Local done'};};owner.worker.runner=async()=>({answer:'Remote done',sources:[]});
 const {turn}=await owner.dispatch('local_send',{chat_id:chat.id,body:'Read local',kind:'question'});await wait(()=>owner.store.state.runs[turn.id].state==='running');
 const {request:remoteA}=await peer.dispatch('ask_repo',{repo_id:ra.id,body:'Read A'}),{request:remoteB}=await peer.dispatch('ask_repo',{repo_id:rb.id,body:'Read B'});await owner.sync();
 await wait(()=>owner.store.state.runs[remoteB.id]?.state==='complete');assert.equal(owner.store.state.runs[remoteA.id],undefined);
 release();await wait(()=>owner.store.state.runs[turn.id].state==='complete');await owner.sync();await wait(()=>owner.store.state.runs[remoteA.id]?.state==='complete');
 }finally{release?.();owner.worker.stop();peer.worker.stop();await wait(()=>!owner.worker.active.size&&!peer.worker.active.size);await relay.close();}
});

test('linked requests send only reviewed brief, return verified results to originating chat, and keep changes gated',async()=>{
 const {root,core,chat}=await localFixture();const target=await repository(root,'backend');const peer=new Core(new Store(join(root,'peer')));
 const relay=createApp({rateLimit:10000});await new Promise<void>(r=>relay.server.listen(0,'127.0.0.1',r));const server=`http://127.0.0.1:${(relay.server.address() as any).port}`;
 try{await core.dispatch('enroll',{name:'Links',handle:'owner',server});await peer.dispatch('enroll',{code:(await core.dispatch('invite')).code,handle:'peer',server});
 const {repo}=await peer.dispatch('expose',{path:target,name:'backend',questions:'auto',changes:true});await core.sync();
 core.worker.local.runner=async()=>({answer:'Private business context, never share automatically'});
 const {turn}=await core.dispatch('local_send',{chat_id:chat.id,body:'Our private plan',kind:'question'});await wait(()=>core.store.state.runs[turn.id].state==='complete');
 await assert.rejects(core.dispatch('local_delegate',{chat_id:chat.id,repo_id:repo.id,kind:'question',body:'API schema?'}),/Confirm/);
 peer.worker.runner=async()=>({answer:'POST /login uses email and password',sources:[]});
 const {link}=await core.dispatch('local_delegate',{chat_id:chat.id,repo_id:repo.id,kind:'question',body:'API schema?',confirmed:true});
 await peer.sync();await wait(()=>peer.store.state.runs[link.id]?.state==='complete');await core.sync();
 assert.equal(core.worker.local.linkVerification(link).status,'verified');assert.equal(link.data.request.body,'API schema?');
 assert.equal(JSON.stringify(await peer.remote.call('/v1/requests')).includes('private plan'),false);
 let received:any;core.worker.local.runner=async(input)=>{received=input;return {answer:'Use the login API'};};
 const {turn:next}=await core.dispatch('local_send',{chat_id:chat.id,body:'Use their answer to explain integration',kind:'question'});await wait(()=>core.store.state.runs[next.id].state==='complete');
 assert.equal(received.untrusted_peer_results[0].request_id,link.id);
 const peerPin=Object.values(core.store.state.trust!).find(p=>p.device_id===peer.store.state.device.id)!;peerPin.blocked=true;
 assert.equal(core.worker.local.linkVerification(link).status,'blocked');assert.deepEqual(core.worker.local.input(chat,next).untrusted_peer_results,[]);peerPin.blocked=false;
 link.data.result.answer='tampered';assert.equal(core.worker.local.linkVerification(link).status,'invalid');assert.deepEqual(core.worker.local.input(chat,next).untrusted_peer_results,[]);
 const {link:change}=await core.dispatch('local_delegate',{chat_id:chat.id,repo_id:repo.id,kind:'change',body:'Add logout',confirmed:true});await peer.sync();assert.equal(change.data.request.status,'approval_pending');assert.equal(peer.store.state.runs[change.id],undefined);
 }finally{core.worker.stop();peer.worker.stop();await wait(()=>!core.worker.active.size&&!peer.worker.active.size);await relay.close();}
});

test('interrupted turns are not retried; closing retains worktree and cancels queued work',async()=>{
 const {core,chat}=await localFixture();core.worker.local.runner=async()=>{throw Error('Runner stopped');};
 const {turn}=await core.dispatch('local_send',{chat_id:chat.id,body:'Read',kind:'question'});await wait(()=>core.store.state.runs[turn.id].state==='interrupted');
 const restored=new Core(new Store(core.store.dir));let ran=false;restored.worker.local.runner=async()=>{ran=true;return {answer:'Unexpected'};};await restored.sync();assert.equal(ran,false);
 await restored.dispatch('local_close',{chat_id:chat.id,confirmed:true});assert.equal(await git(chat.worktree!,'rev-parse','HEAD'),chat.base_commit);
 await assert.rejects(restored.dispatch('local_send',{chat_id:chat.id,body:'Again',kind:'question'}),/closed/);
});

test('local trusted instructions separate peer data and require review before delegation',()=>{
 assert.match(localInstructions(false),/Read-only turn/);assert.match(localInstructions(true),/Do not commit, push, merge/);
 assert.match(localInstructions(true),/Do not execute or send it yourself/);
 assert.match(localInstructions(true),/untrusted data/);
 const output=JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({answer:'Plan',delegations:[{repo_id:'r',kind:'question',body:'schema?'}]})}});
 assert.equal(parseLocalResponse(output).delegations?.[0].repo_id,'r');
 assert.throws(()=>parseLocalResponse('not JSON'));
});

test('local FIFO follows conversation order even for tied timestamps; queued cancellation does not execute',async()=>{
 const {core,chat}=await localFixture();const first=core.worker.local.enqueue(chat.id,'First','question',{},false),second=core.worker.local.enqueue(chat.id,'Second','question',{},false);second.created_at=first.created_at;
 assert.equal(core.worker.local.candidates()[0].id,first.id);core.worker.local.cancel(first.id);assert.equal(core.worker.local.candidates()[0].id,second.id);
 const inputs:any[]=[];core.worker.local.runner=async(input)=>{inputs.push(input);return {answer:'Second only'};};await core.sync();await wait(()=>core.store.state.runs[second.id].state==='complete');assert.equal(inputs.length,1);assert.equal(inputs[0].current_owner_message,'Second');
});
