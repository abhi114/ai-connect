import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Core } from '../src/core.ts';
import { Store } from '../src/store.ts';
import { serverOrigin, checkServer } from '../src/server-switch.ts';
import { createApp } from '../../backend/src/server.ts';
import { keypair, registration, signData } from '../../shared/signing.ts';

test('temporary server switch accepts only safe origins',()=>{
  assert.equal(serverOrigin(' https://test.trycloudflare.com/ '),'https://test.trycloudflare.com');
  for(const url of ['http://example.com','https://user:pass@example.com','https://example.com/path','https://example.com/?secret=x','https://example.com/#x','file:///tmp','invalid'])assert.throws(()=>serverOrigin(url));
});

test('first registration after an offline tunnel preserves existing keypair and membership',async t=>{
  const app=createApp({rateLimit:10000});await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const server=`http://127.0.0.1:${(app.server.address() as any).port}`;
  const core=new Core(new Store(await mkdtemp(join(tmpdir(),'server-first-key-'))));
  core.store.state.server=server;
  const identity=await core.remote.mutate('/v1/networks',{name:'Offline upgrade',handle:'alice'});
  Object.assign(core.store.state,identity,{signing:keypair(),server:'http://127.0.0.1:1'});core.store.save();
  const before=structuredClone(core.store.state);
  const result=await core.dispatch('change_server',{server,confirmed:true});
  assert.equal(result.connected,true);
  for(const field of ['token','member','network','device','signing','bindings','requests','runs'] as const)assert.deepEqual(core.store.state[field],before[field],field);
  const {keys}=await core.remote.call('/v1/keys');assert.equal(keys[0].public_key,before.signing!.public_key);
  assert.equal(new Store(core.store.dir).state.signing!.private_key,before.signing!.private_key);
});

test('different registered key is never replaced during URL switching',async t=>{
  const app=createApp({rateLimit:10000});await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const server=`http://127.0.0.1:${(app.server.address() as any).port}`;
  const core=new Core(new Store(await mkdtemp(join(tmpdir(),'server-key-mismatch-'))));core.store.state.server=server;
  const identity=await core.remote.mutate('/v1/networks',{name:'Mismatch test',handle:'alice'});
  Object.assign(core.store.state,identity,{signing:keypair()});
  const other=keypair(),data=registration(identity.network.id,identity.member.id,identity.device.id,other.public_key);
  await core.remote.mutate('/v1/keys',{public_key:other.public_key,proof:signData(other.private_key,data)});
  core.store.state.server='http://127.0.0.1:1';core.store.save();const before=structuredClone(core.store.state);
  await assert.rejects(core.dispatch('change_server',{server,confirmed:true}),/different/);
  assert.deepEqual(core.store.state,before);assert.deepEqual(new Store(core.store.dir).state,before);
  const response=await fetch(server+'/v1/keys',{headers:{Authorization:`Bearer ${identity.token}`}});
  assert.equal(((await response.json()) as any).keys[0].public_key,other.public_key);
});

test('registration conflicts and unconfirmed registration fail without changing local state',async t=>{
  for(const conflict of [true,false]){
    const state={token:'fixture-token',network:{id:'network'},member:{id:'member'},device:{id:'device'},signing:keypair(),server:'http://127.0.0.1:1'};
    let posts=0;
    const server=createServer(async(req,res)=>{
      res.setHeader('Content-Type','application/json');
      if(req.url==='/v1/me'){res.end(JSON.stringify({network:state.network,member:state.member,device:state.device}));return;}
      if(req.method==='POST'){
        posts++;let raw='';for await(const chunk of req)raw+=chunk;
        const body=JSON.parse(raw);assert.equal(body.public_key,state.signing.public_key);
        assert.equal(body.previous_proof,undefined);assert.ok(!raw.includes(state.signing.private_key));
        res.statusCode=conflict?409:200;res.end(JSON.stringify({registered:!conflict}));return;
      }
      res.end(JSON.stringify({keys:[]}));
    });
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));
    const before=structuredClone(state);
    await assert.rejects(checkServer(`http://127.0.0.1:${(server.address() as any).port}`,state),conflict?/409/:/could not be confirmed/);
    assert.equal(posts,1);assert.deepEqual(state,before);
  }
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
