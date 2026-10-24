import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForService, ensureService, stopService } from '../src/service.ts';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('slow Windows-style cold start waits beyond six seconds and launches once',async()=>{
  let clock=0,launches=0;
  const result=await waitForService({probe:async()=>{if(clock<12000)throw Error('not ready');return {ready:true}},owned:()=>false,launch:()=>{launches++},failure:()=>undefined,now:()=>clock,sleep:async ms=>{clock+=ms}});
  assert.deepEqual(result,{ready:true});assert.equal(launches,1);
});
test('start waits for the previous shutdown lock before spawning',async()=>{
  let clock=0,launchTime=-1;
  await waitForService({probe:async()=>{if(launchTime<0||clock<launchTime+500)throw Error('stopping');return {}},owned:()=>clock<3000,launch:()=>{launchTime=clock},failure:()=>undefined,now:()=>clock,sleep:async ms=>{clock+=ms}});
  assert.equal(launchTime,3000);
});
test('startup has a bounded timeout and does not spawn against an existing owner',async()=>{
  let clock=0;
  await assert.rejects(waitForService({probe:async()=>{throw Error('unavailable')},owned:()=>true,launch:()=>assert.fail('duplicate spawn'),failure:()=>undefined,now:()=>clock,sleep:async ms=>{clock+=ms}},1000),/did not become ready/);
});
test('real stop immediately followed by start preserves the profile on the first attempt',async()=>{
  const previous={home:process.env.RN_HOME,port:process.env.RN_PORT};
  const dir=await mkdtemp(join(tmpdir(),'aiconnect-lifecycle-'));process.env.RN_HOME=dir;process.env.RN_PORT='0';
  try {
    await ensureService();const before=JSON.parse(await readFile(join(dir,'state.json'),'utf8'));
    await stopService();await ensureService();const after=JSON.parse(await readFile(join(dir,'state.json'),'utf8'));
    assert.equal(after.session_token,before.session_token);
    await stopService();
  }finally{await stopService().catch(()=>{});if(previous.home===undefined)delete process.env.RN_HOME;else process.env.RN_HOME=previous.home;if(previous.port===undefined)delete process.env.RN_PORT;else process.env.RN_PORT=previous.port;}
});
