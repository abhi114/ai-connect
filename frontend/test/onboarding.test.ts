import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { Core } from '../src/core.ts';
import { createApp } from '../../backend/src/server.ts';
import { onboardingJs } from '../src/onboarding.ts';

test('integration feedback stays beside repair and prevents duplicate operations',()=>{
  assert.match(onboardingJs,/integration-register'\)\.after\(integrationFeedback\)/);
  assert.match(onboardingJs,/aria-live','polite/);
  assert.match(onboardingJs,/Each Codex step allows up to 5 minutes/);
  const handlers=onboardingJs.slice(onboardingJs.indexOf("$('#integration-check').onclick"));
  assert.doesNotMatch(handlers,/setup-error/);
  assert.equal((handlers.match(/if\(integrationBusy\)return/g)||[]).length,2);
  assert.match(handlers,/Could not repair integration/);
  assert.doesNotThrow(()=>new Function(onboardingJs));
});

test('dashboard invite/join preserves existing identity and enforces admin-only invitations',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'aiconnect-onboarding-'));
  const relay=createApp({rateLimit:10000});await new Promise<void>(r=>relay.server.listen(0,'127.0.0.1',r));
  const server=`http://127.0.0.1:${(relay.server.address() as any).port}`;
  const owner=new Core(new Store(join(dir,'owner'))),friend=new Core(new Store(join(dir,'friend')));
  try {
    await owner.dispatch('enroll',{name:'Test',handle:'owner',server});
    const invite=await owner.dispatch('invite');assert.equal(invite.server,server);
    await friend.dispatch('enroll',{server,code:invite.code,handle:'friend'});
    const token=friend.store.state.token;
    await assert.rejects(friend.dispatch('invite'),/admin/);
    await assert.rejects(friend.dispatch('enroll',{server,code:invite.code,handle:'replacement'}),/already enrolled/);
    assert.equal(friend.store.state.token,token);
    assert.equal(new Store(friend.store.dir).state.member.handle,'friend');
  }finally{owner.worker.stop();friend.worker.stop();await relay.close();}
});
test('uncertain join retries reuse the persisted key after restart without consuming another invite',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'aiconnect-join-retry-'));
  const first=new Core(new Store(dir));let key='';
  first.remote.mutate=async(_path,body)=>{key=body.idempotency_key;throw Error('connection lost after server accepted');};
  const args={server:'https://example.test',code:'test-invite',handle:'friend'};
  await assert.rejects(first.dispatch('enroll',args),/connection lost/);
  const retry=new Core(new Store(dir));
  await assert.rejects(retry.dispatch('enroll',{...args,server:'https://different.test'}),/uncertain result/);
  retry.remote.mutate=async(_path,body)=>{assert.equal(body.idempotency_key,key);return {token:'test-token',member:{id:'friend',handle:'friend',network_id:'test'},network:{id:'test'}};};
  retry.sync=async()=>{};
  await retry.dispatch('enroll',args);assert.equal(retry.store.state.pending_enrollment,undefined);
});
