import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { handle } from '../src/mcp.ts';
import { requestView, waitForResult } from '../src/mcp-view.ts';

const request={id:'request-1',repo_id:'repo-1',sender_member_id:'bob',owner_member_id:'alice',kind:'question',status:'running',title:'Explain login',body:'Original peer question',constraints:['Read only'],created_at:1};
const pending=()=>({request:{...request},result:null,events:[],local_run:{state:'running',lease_token:'PRIVATE_LEASE',worktree:'/private/repository'}});
const invoke=(name:string,args:any,call:any)=>handle({method:'tools/call',params:{name,arguments:args}},call);
const unpack=(reply:any)=>JSON.parse(reply.content[0].text);

test('MCP previews exclude repeated history and secrets; explicit details recover text without changing dashboard data',async()=>{
  const original={...pending(),request:{...request,status:'answered'},result:{kind:'question_result',answer:'Answer text '.repeat(700),base_commit:'a'.repeat(40),sources:Array.from({length:9},(_,i)=>({path:`src/file${i}.ts`,line:1}))},events:Array.from({length:45},(_,i)=>({id:i,type:'request.updated',actor_member_id:'alice',created_at:i,payload:{result:'Repeated answer '.repeat(100)}}))};
  const saved=JSON.stringify(original);
  const compact=unpack(await invoke('get_request',{request_id:request.id},async()=>original));
  assert.equal(compact.result.answer.length,2000);assert.equal(compact.result.sources.length,5);assert.equal(compact.truncated,true);
  assert.equal(compact.request,undefined);assert.equal(compact.timeline,undefined);
  assert.ok(JSON.stringify(compact).length<saved.length/10,'Large historical response should shrink materially');
  const detail=unpack(await invoke('get_request',{request_id:request.id,detail:true,event_offset:20},async()=>original));
  assert.equal(detail.result.answer,original.result.answer);assert.equal(detail.result.sources.length,9);assert.equal(detail.request.body,request.body);
  assert.equal(detail.timeline.items[0].id,20);assert.equal(detail.timeline.items.length,20);assert.equal(detail.timeline.next_offset,40);
  for(const response of [compact,detail]){assert.ok(!JSON.stringify(response).includes('PRIVATE_LEASE'));assert.ok(!JSON.stringify(response).includes('/private/repository'));}
  assert.equal(JSON.stringify(original),saved,'Dashboard source object retains all fields and full history');
  console.log(`Fixture response characters: detailed source ${saved.length}, MCP preview ${JSON.stringify(compact).length}`);
});

test('lists are paginated and submissions do not echo messages or invent remote IDs for offline work',async()=>{
  const members=Array.from({length:31},(_,i)=>({id:`m${i}`,handle:`member${i}`,online:true,network_id:'redundant',display_name:'Full name'}));
  const first=unpack(await invoke('list_members',{},async()=>({members})));
  assert.equal(first.items.length,10);assert.equal(first.next_offset,10);assert.equal(first.total,31);
  const last=unpack(await invoke('list_members',{offset:30,limit:25},async()=>({members})));
  assert.equal(last.items.length,1);assert.equal(last.next_offset,undefined);assert.equal(last.items[0].network_id,undefined);
  const sent=unpack(await invoke('ask_repo',{repo_id:'repo-1',body:request.body},async()=>({request})));
  assert.equal(sent.request_id,request.id);assert.equal(sent.body,undefined);
  const offline=unpack(await invoke('ask_repo',{repo_id:'repo-1',body:request.body},async()=>({pending:true,operation_id:'op1'})));
  assert.equal(offline.pending,true);assert.equal(offline.request_id,undefined);
  for(const args of [{seconds:26},{seconds:0},{seconds:1.2},{seconds:'3'},{extra:true}]) {
    const response=await invoke('wait_for_result',{request_id:request.id,...args},async()=>{throw Error('Must not execute')});assert.equal(response.isError,true);
  }
  assert.equal((await invoke('list_members',{limit:100},async()=>({members}))).isError,true);
});

test('wait returns one final answer after internal polls, and stops for review, rejection or failure',async()=>{
  let calls=0;
  const result=await waitForResult({request_id:request.id,seconds:1},async()=>{
    calls++;return calls<3?pending():{...pending(),request:{...request,status:'answered'},result:{kind:'question_result',answer:'The answer',sources:[]}};
  },undefined,5);
  assert.equal(calls,3);assert.equal(result.wait_status,'finished');assert.equal(result.result.answer,'The answer');
  for(const status of ['rejected','cancelled','failed'])assert.equal((await waitForResult({request_id:request.id},async()=>({...pending(),request:{...request,status}}))).wait_status,'finished');
  for(const state of ['awaiting_review','interrupted','delivery_failed']) {
    const reply=await waitForResult({request_id:request.id},async()=>({...pending(),local_run:{state,answer:'Draft response'}}));
    assert.equal(reply.wait_status,'needs_attention');assert.equal(reply.delivered,false);
  }
  assert.equal((await waitForResult({request_id:request.id},async()=>({...pending(),request:{...request,status:'approval_pending'}}))).wait_status,'needs_attention');
});

test('wait timeout stays bounded during stalled I/O; cancellation and network errors are not completion',async()=>{
  const started=Date.now();
  const result=await waitForResult({request_id:request.id,seconds:1},async(_method,_args,options)=>{await delay(10000,undefined,{signal:options?.signal});return pending();});
  assert.equal(result.wait_status,'timeout');assert.equal(result.result,undefined);assert.ok(Date.now()-started<2500);
  const controller=new AbortController();let calls=0;
  await assert.rejects(waitForResult({request_id:request.id},async()=>{calls++;controller.abort();return pending();},controller.signal),/cancelled/);
  assert.equal(calls,1);
  await assert.rejects(waitForResult({request_id:request.id},async()=>{throw Error('Relay offline')}),/Relay offline/);
});

test('change preview retains delivery and honest test status, with full diff on demand',()=>{
  const data={...pending(),request:{...request,kind:'change',status:'review_ready'},result:{kind:'change_result',summary:'Updated validation',branch:'network/task',commit:'b'.repeat(40),base_commit:'a'.repeat(40),delivery:'local_branch',owner_review_required:true,diff_summary:'Detailed diff',tests:[{name:'unit',status:'skipped'}]}};
  const preview=requestView(data);assert.equal(preview.result.delivery,'local_branch');assert.equal(preview.result.owner_review_required,true);assert.deepEqual(preview.result.tests,{passed:0,failed:0,skipped:1});assert.equal(preview.result.diff_summary,undefined);
  assert.equal(requestView(data,{detail:true}).result.diff_summary,'Detailed diff');
});
