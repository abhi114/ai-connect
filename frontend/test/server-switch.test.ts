import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Core } from '../src/core.ts';
import { Store } from '../src/store.ts';
import { serverOrigin } from '../src/server-switch.ts';
import { createApp } from '../../backend/src/server.ts';

test('temporary server switch accepts only safe origins',()=>{
  assert.equal(serverOrigin(' https://test.trycloudflare.com/ '),'https://test.trycloudflare.com');
  for(const url of ['http://example.com','https://user:pass@example.com','https://example.com/path','https://example.com/?secret=x','https://example.com/#x','file:///tmp','invalid'])assert.throws(()=>serverOrigin(url));
});

test('temporary switch reconnects to same backend without changing identity, trust or history',async t=>{
  const app=createApp({rateLimit:10000});await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const alias=createServer((req,res)=>app.server.emit('request',req,res));await new Promise<void>(r=>alias.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>alias.close(()=>r())));
  const origin=(s:any)=>`http://127.0.0.1:${s.address().port}`;
  const core=new Core(new Store(await mkdtemp(join(tmpdir(),'server-switch-'))));
  await core.dispatch('enroll',{server:origin(app.server),name:'Test',handle:'alice'});
  const before=structuredClone(core.store.state);
  await assert.rejects(core.dispatch('change_server',{server:origin(alias)}),/Confirm/);
  core.worker.active.set('busy',new AbortController());
  await assert.rejects(core.dispatch('change_server',{server:origin(alias),confirmed:true}),/workers finish/);core.worker.active.clear();
  const result=await core.dispatch('change_server',{server:origin(alias),confirmed:true});
  assert.equal(result.connected,true);assert.equal(result.server,origin(alias));
  for(const field of ['token','member','network','signing','trust','bindings','requests','runs'] as const)assert.deepEqual(core.store.state[field],before[field],field);
  assert.equal(new Store(core.store.dir).state.server,origin(alias));assert.equal(core.worker.remote,core.remote);
  // Failure never rewrites the saved URL, and redirects never forward credentials.
  const wrong=createServer((_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({network:{id:'other'}}));});
  await new Promise<void>(r=>wrong.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>wrong.close(()=>r())));
  await assert.rejects(core.dispatch('change_server',{server:origin(wrong),confirmed:true}),/does not match/);
  assert.equal(core.store.state.server,origin(alias));
  const redirect=createServer((_req,res)=>{res.writeHead(302,{location:origin(wrong)+'/v1/me'});res.end()});
  await new Promise<void>(r=>redirect.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>redirect.close(()=>r())));
  await assert.rejects(core.dispatch('change_server',{server:origin(redirect),confirmed:true}));assert.equal(core.store.state.server,origin(alias));
});
