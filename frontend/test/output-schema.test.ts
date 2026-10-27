import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { runCodex } from '../src/codex.ts';
import { runLocalCodex } from '../src/local-codex.ts';
import type { RepoRequest } from '../../shared/protocol.ts';
import type { command } from '../src/process.ts';

const request={kind:'question',title:'Explain tax',body:'Explain tax with sources'} as RepoRequest;
function runner(result:unknown,local=false):typeof command {
  return async(_exe,args,_cwd,options)=>{
    const path=args[args.indexOf('--output-schema')+1];
    assert.ok(args.includes('--output-schema'));assert.ok(isAbsolute(path));
    const schema=JSON.parse(readFileSync(path,'utf8'));
    assert.equal(schema.additionalProperties,false);
    assert.deepEqual(schema.required,local?['answer','delegations','next_steps']:['answer','sources']);
    assert.equal(args[args.indexOf('--sandbox')+1],'read-only');
    assert.ok(args.includes('--ignore-user-config'));assert.ok(options?.signal);
    return [
      {type:'item.completed',item:{type:'agent_message',text:'Reading tax calculation…'}},
      {type:'item.completed',item:{type:'agent_message',text:JSON.stringify(result)}},
      {type:'turn.completed'}
    ].map(e=>JSON.stringify(e)).join('\n');
  };
}
test('peer execution supplies an absolute packaged schema and accepts structured final answer after progress',async()=>{
  const result={answer:'Tax is 8%.',sources:[{path:'src/cart.js',line:29}]};
  assert.deepEqual(await runCodex(request,'/test',new AbortController().signal,{},undefined,runner(result)),result);
});
test('peer response validation still rejects malformed results',async()=>{
  for(const result of [null,{answer:'',sources:[]},{answer:'Tax',sources:[{path:'src/cart.js',line:0}]}]) {
    await assert.rejects(runCodex(request,'/test',new AbortController().signal,{},undefined,runner(result)),/failed validation/);
  }
});
test('local chats use their own schema and preserve proposals and next steps',async()=>{
  const result={answer:'Tax is 8%.',delegations:[{repo_id:'backend',kind:'question',body:'Confirm API schema'}],next_steps:[{label:'Check tests',prompt:'Explain the tests'}]};
  assert.deepEqual(await runLocalCodex({},'/test',new AbortController().signal,{},false,undefined,runner(result,true)),result);
});
test('owner context goes to trusted instructions while original peer input stays unchanged',async()=>{
  const run:typeof command=async(_exe,args,_cwd,options)=>{
    const instructions=args.find(a=>a.startsWith('developer_instructions='))!;
    assert.match(instructions,/owner_added_context/);assert.match(instructions,/Focus on rounding/);
    assert.match(instructions,/do not authorize extra access/i);
    const input=JSON.parse(options!.input!);assert.equal(input.body,request.body);assert.ok(!options!.input!.includes('Focus on rounding'));
    return JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({answer:'Tax',sources:[]})}});
  };
  await runCodex(request,'/test',new AbortController().signal,{},undefined,run,'Focus on rounding');
});
