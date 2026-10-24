import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkMcp, registrationArgs, mcpPath } from '../src/setup.ts';
import { localCall } from '../src/ipc.ts';
import { startDaemon } from '../src/daemon.ts';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

test('desktop transport cold-starts one companion, exposes tools and reconnects without replacing its state',async()=>{
  const previousHome=process.env.RN_HOME, previousPort=process.env.RN_PORT;
  const dir=await mkdtemp(join(tmpdir(),'rn-mcp-'));
  process.env.RN_HOME=dir;process.env.RN_PORT='0';
  try {
    const first=await checkMcp();
    assert.equal(first.mcp,'ok');assert.equal(first.tools.length,8);
    assert.equal(first.network.connected,false);
    const lock=await readFile(join(dir,'daemon.lock'),'utf8');
    const state=await readFile(join(dir,'state.json'),'utf8');
    await Promise.all([checkMcp(),checkMcp()]);
    assert.equal(await readFile(join(dir,'daemon.lock'),'utf8'),lock);
    assert.equal(await readFile(join(dir,'state.json'),'utf8'),state);
    const args=registrationArgs();assert.ok(args.includes(`RN_HOME=${dir}`));
    assert.deepEqual(args.slice(-2),[process.execPath,mcpPath]);
    assert.throws(()=>registrationArgs('bad.name'),/Server name/);
  } finally {
    await localCall('shutdown').catch(()=>{});
    if(previousHome===undefined)delete process.env.RN_HOME;else process.env.RN_HOME=previousHome;
    if(previousPort===undefined)delete process.env.RN_PORT;else process.env.RN_PORT=previousPort;
  }
});

test('real stdio wait permits ping/cancellation while dashboard RPC retains full detail',async()=>{
  const previousHome=process.env.RN_HOME,previousPort=process.env.RN_PORT;
  const dir=await mkdtemp(join(tmpdir(),'rn-wait-'));process.env.RN_HOME=dir;process.env.RN_PORT='0';
  const daemon=await startDaemon(dir,0);
  const request={id:'q',status:'running',kind:'question',body:'Full original question',repo_id:'repo',sender_member_id:'bob',owner_member_id:'alice',title:'Question'};
  const events=[{id:1,type:'request.created',payload:{body:request.body}}];
  daemon.core.remote.call=async()=>({request,result:null,events});
  daemon.core.store.state.runs.q={request_id:'q',repo_id:'repo',state:'running',lease_token:'PRIVATE_LEASE',worktree:'/private/local-worktree'};
  const child=spawn(process.execPath,[mcpPath],{stdio:['pipe','pipe','pipe']});
  const responses=new Map<number,any>();const listeners=new Map<number,(value:any)=>void>();
  const lines=createInterface({input:child.stdout});lines.on('line',line=>{const reply=JSON.parse(line);responses.set(reply.id,reply);listeners.get(reply.id)?.(reply)});
  child.stderr.resume();
  const receive=(id:number)=>new Promise<any>((resolve,reject)=>{
    if(responses.has(id)){resolve(responses.get(id));return;}
    const timer=setTimeout(()=>{listeners.delete(id);reject(Error(`No MCP reply for ${id}`))},5000);
    listeners.set(id,value=>{clearTimeout(timer);listeners.delete(id);resolve(value)});
  });
  const send=(value:any)=>child.stdin.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
  try {
    send({id:1,method:'initialize',params:{protocolVersion:'2025-03-26'}});await receive(1);
    send({id:2,method:'tools/call',params:{name:'wait_for_result',arguments:{request_id:'q',seconds:25}}});
    send({id:3,method:'ping'});assert.deepEqual((await receive(3)).result,{});
    assert.equal(responses.has(2),false,'Ping is served while wait is pending');
    send({method:'notifications/cancelled',params:{requestId:2}});
    const cancelled=await receive(2);assert.equal(cancelled.result.isError,true);assert.match(cancelled.result.content[0].text,/cancelled/);
    send({id:4,method:'tools/call',params:{name:'get_request',arguments:{request_id:'q'}}});
    const compact=JSON.parse((await receive(4)).result.content[0].text);assert.equal(compact.request_id,'q');assert.equal(compact.timeline,undefined);
    const full=await localCall('get_request',{request_id:'q'});
    assert.equal(full.request.body,request.body);assert.deepEqual(full.events,events);assert.equal(full.local_run.worktree,'/private/local-worktree');
  } finally {
    child.kill();lines.close();await daemon.stop();
    if(previousHome===undefined)delete process.env.RN_HOME;else process.env.RN_HOME=previousHome;
    if(previousPort===undefined)delete process.env.RN_PORT;else process.env.RN_PORT=previousPort;
  }
});
