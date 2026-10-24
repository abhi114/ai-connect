import test from 'node:test';
import { signedRequest } from './fixtures/signing.ts';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { discoverModels, validateExecution, executionArgs } from '../src/models.ts';
import { approvalDigest, authorize } from '../src/policy.ts';

const catalog={fetched_at:Date.now(),models:[{model:'test-model',name:'Test',efforts:['low','high'],isDefault:true}]};
test('model discovery initializes app-server and follows pages, excluding hidden models',async()=>{
  const result=await discoverModels(process.cwd(),process.execPath,[fileURLToPath(new URL('./fixtures/model-server.mjs',import.meta.url))]);
  assert.deepEqual(result.models.map(m=>m.model),['first','second']);
  assert.deepEqual(result.models[1].efforts,['high']);
});
test('model discovery reports missing executable without hanging',async()=>{
  await assert.rejects(discoverModels(process.cwd(),'/nonexistent/aiconnect-codex'),/Cannot launch/);
});
test('execution selection only accepts catalog models and their supported efforts',()=>{
  assert.deepEqual(validateExecution(undefined),{});
  assert.deepEqual(validateExecution({}),{});
  assert.deepEqual(validateExecution({model:'test-model',reasoning_effort:'high'},catalog),{model:'test-model',reasoning_effort:'high'});
  for(const value of [null,[],{model:1},{model:'unknown'},{model:'test-model',reasoning_effort:'ultra'},{reasoning_effort:'high'},{shell:true}]) {
    assert.throws(()=>validateExecution(value,catalog));
  }
  assert.throws(()=>validateExecution({model:'test-model'}),/current Codex catalog/);
  assert.deepEqual(executionArgs({model:'test-model',reasoning_effort:'high'}),['--model','test-model','-c','model_reasoning_effort="high"']);
  assert.deepEqual(executionArgs(),[]);
});
test('approval is bound to model and effort, with legacy default approvals preserved',()=>{
  const request:any={id:'q',repo_id:'r',network_id:'n',owner_member_id:'owner',sender_member_id:'sender',kind:'change',status:'queued'};
  const settings={model:'test-model',reasoning_effort:'high'};
  const state:any={member:{id:'owner',network_id:'n'},members:[{id:'sender',network_id:'n'}],repos:[{id:'r',network_id:'n',owner_member_id:'owner',availability:'active',changes_enabled:true}],bindings:{r:{changes:true}},approvals:{q:approvalDigest(request,settings)},execution_options:{q:settings}};
  signedRequest(state,request);
  state.approvals.q=approvalDigest(request,settings);
  assert.doesNotThrow(()=>authorize(state,request));
  state.execution_options.q={model:'test-model',reasoning_effort:'low'};
  assert.throws(()=>authorize(state,request),/approved locally/);
  state.approvals.q=approvalDigest(request);delete state.execution_options;
  assert.doesNotThrow(()=>authorize(state,request));
});
