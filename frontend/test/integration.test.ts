import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexIntegration, mcpPath } from '../src/integration.ts';
import { command } from '../src/process.ts';

function fixture(entry?:any){
  const calls:string[][]=[];
  const run:typeof command=async(_binary,args)=>{calls.push(args);if(args[1]==='list')return JSON.stringify(entry?[entry]:[]);assert.equal(args[1],'add');entry={name:'aiconnect',enabled:true,transport:{command:process.execPath,args:[mcpPath],env:{RN_HOME:'/test-profile',RN_PORT:process.env.RN_PORT||'4319'}}};return 'Added';};
  return {integration:new CodexIntegration('/test-profile',run),calls};
}
test('dashboard registration requires explicit current consent and only upserts aiconnect',async()=>{
  const {integration,calls}=fixture();const before=await integration.status();
  await assert.rejects(integration.register({fingerprint:before.fingerprint}),/confirm again/);
  await assert.rejects(integration.register({confirmed:true,fingerprint:'stale'}),/confirm again/);
  const after=await integration.register({confirmed:true,fingerprint:before.fingerprint});assert.equal(after.matches,true);
  assert.equal(calls.filter(c=>c[1]==='add').length,1);assert.equal(calls.some(c=>c[1]==='remove'),false);
  await integration.register({confirmed:true,fingerprint:after.fingerprint});assert.equal(calls.filter(c=>c[1]==='add').length,1);
});
test('repair accepts moved same-profile installation but refuses other profiles/tools and disabled entries',async()=>{
  const entry={name:'aiconnect',enabled:true,transport:{command:'old-node',args:['C:\\old\\frontend\\src\\mcp.ts'],env:{RN_HOME:'/test-profile',SECRET:'never-return-this'}}};
  const {integration}=fixture(entry);const s=await integration.status();assert.equal(s.repairable,true);assert.equal(JSON.stringify(s).includes('never-return-this'),false);
  assert.equal((await integration.register({confirmed:true,fingerprint:s.fingerprint})).matches,true);
  for(const other of [{...entry,transport:{...entry.transport,env:{RN_HOME:'/other-profile'}}},{...entry,transport:{...entry.transport,args:['unrelated.js']}},{...entry,enabled:false}]){
    const {integration:blocked,calls}=fixture(other);const b=await blocked.status();await assert.rejects(blocked.register({confirmed:true,fingerprint:b.fingerprint}));assert.equal(calls.some(c=>c[1]==='add'),false);
  }
});
