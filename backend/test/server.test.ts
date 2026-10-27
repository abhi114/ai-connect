import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup } from 'node:sqlite';
import { request as httpRequest } from 'node:http';
import { createApp } from '../src/server.ts';
import type { ServerOptions } from '../src/server.ts';
import type { AddressInfo } from 'node:net';

async function setup(databasePath = ':memory:', options: ServerOptions = {}) {
  let time = 1800000000000;
  const app = createApp({databasePath, now: () => time, leaseMs: 1000, rateLimit: 10000, ...options});
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  async function api(path: string, data?: any, token?: string, method?: string) {
    const res = await fetch(base+path, {method: method ?? (data ? 'POST' : 'GET'), headers: {...(data ? {'content-type':'application/json'} : {}), ...(token ? {authorization: `Bearer ${token}`} : {})}, body: data ? JSON.stringify({idempotency_key: randomUUID(), ...data}) : undefined});
    return {status: res.status, ...await res.json() as any};
  }
  async function create(handle = 'alice') { return api('/v1/networks', {name:'Test network',handle}); }
  async function invite(owner: any, expires_in_seconds = 86400) { return api(`/v1/networks/${owner.network.id}/invites`, {expires_in_seconds}, owner.token); }
  async function joinMember(owner: any, handle = 'bob') { const code = (await invite(owner)).code; return api('/v1/join',{code,handle}); }
  async function publish(owner: any, extra: any = {}) { return (await api('/v1/repos', {slug:'checkout-api',description:'Checkout taxes',questions_enabled:true,changes_enabled:true,questions_require_approval:false,...extra},owner.token)).repo; }
  async function request(sender: any, repo: any, kind = 'question', extra: any = {}) { return api('/v1/requests', {repo_id:repo.id,recipient_member_id:repo.owner_member_id,kind,title:'Test request',body:'Explain taxes.',...extra},sender.token); }
  return {app, api, create, invite, joinMember, publish, request, advance: (ms: number) => time += ms, base};
}
const answer = {kind:'question_result',answer:'Tax is calculated in checkout.',base_commit:'a'.repeat(40),sources:[{path:'src/tax.ts',line:4}]};

test('manual retry retains history, requires fresh approval, and fences the old worker',async t=>{
  const f=await setup();t.after(()=>f.app.close());
  const owner=await f.create(),sender=await f.joinMember(owner),other=await f.joinMember(owner,'other');
  const repo=await f.publish(owner),{request}=await f.request(sender,repo),path='/v1/requests/'+request.id;
  assert.equal((await f.api(path+'/retry',{},sender.token)).status,409);
  const lease=await f.api(path+'/claim',{},owner.token);
  await f.api(path+'/fail',{lease_token:lease.lease_token,code:'timeout',message:'Timed out'},owner.token);
  assert.equal((await f.api(path+'/retry',{},other.token)).status,404);
  const retried=await f.api(path+'/retry',{},sender.token);
  assert.equal(retried.request.status,'approval_pending');
  assert.equal((await f.api(path+'/retry',{},owner.token)).status,409);
  assert.equal((await f.api(path+'/claim',{},owner.token)).status,409);
  await f.api(path+'/approve',{},owner.token);
  const next=await f.api(path+'/claim',{},owner.token);assert.equal(next.attempt,2);
  assert.equal((await f.api(path+'/complete',{lease_token:lease.lease_token,result:answer},owner.token)).status,409);
  assert.equal((await f.api(path+'/complete',{lease_token:next.lease_token,result:answer},owner.token)).request.status,'answered');
  const detail=await f.api(path,undefined,sender.token);
  assert.ok(detail.events.some((e:any)=>e.type==='request.failed'));
  assert.ok(detail.events.some((e:any)=>e.type==='request.retry_requested'));
  assert.equal((await f.api(path+'/retry',{},sender.token)).status,409);
});

test('network chat is durable, scoped, idempotent, paginated, and does not reveal private requests', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'aiconnect-chat-'));
  const path = join(dir, 'relay.sqlite');
  const f = await setup(path);
  t.after(() => rmSync(dir, {recursive:true, force:true}));
  const owner = await f.create(), bob = await f.joinMember(owner), carol = await f.joinMember(owner, 'carol'), outsider = await f.create('outsider');
  assert.equal((await f.api('/v1/messages')).status, 401);
  const first = await f.api('/v1/messages', {body:'First message', idempotency_key:'chat-first-key'}, owner.token);
  assert.equal(first.status, 201);
  assert.equal(first.message.sender_member_id, owner.member.id);
  assert.deepEqual(await f.api('/v1/messages', {body:'First message', idempotency_key:'chat-first-key'}, owner.token), first);
  assert.equal((await f.api('/v1/messages', {body:'Changed', idempotency_key:'chat-first-key'}, owner.token)).status, 409);
  await f.api('/v1/messages', {body:'Second message'}, bob.token);
  const last = await f.api('/v1/messages', {body:'Third message'}, owner.token);
  const newest = await f.api('/v1/messages?limit=2', undefined, bob.token);
  assert.deepEqual(newest.messages.map((m:any) => m.body), ['Second message','Third message']);
  const older = await f.api(`/v1/messages?limit=2&before=${newest.next_before}`, undefined, carol.token);
  assert.deepEqual(older.messages.map((m:any) => m.id), [first.message.id]);
  assert.equal(older.next_before, null);
  assert.deepEqual((await f.api(`/v1/messages?before=${last.message.id+1}`, undefined, outsider.token)).messages, []);
  const repo = await f.publish(owner);
  const request = await f.request(bob, repo);
  const events = (await f.api('/v1/events?after=0', undefined, carol.token)).events;
  assert.equal(events.filter((e:any) => e.type === 'chat.message').length, 3, 'Replay must not duplicate chat events');
  assert.ok(events.every((e:any) => e.request_id !== request.request.id), 'Public chat must not broaden private request visibility');
  assert.deepEqual(events.find((e:any) => e.type === 'chat.message').payload.message, first.message);
  assert.ok((await f.api('/v1/events?after=0', undefined, outsider.token)).events.every((e:any) => e.type !== 'chat.message'));
  await f.app.close();
  const reopened = await setup(path); t.after(() => reopened.app.close());
  assert.equal((await reopened.api('/v1/messages', undefined, bob.token)).messages.length, 3);
  assert.deepEqual(await reopened.api('/v1/messages', {body:'First message', idempotency_key:'chat-first-key'}, owner.token), first);
});

test('network chat rejects spoofed identity, excessive bodies, invalid cursors and revoked credentials', async t => {
  const f = await setup(); t.after(() => f.app.close());
  const owner = await f.create(), bob = await f.joinMember(owner);
  for (const field of ['sender_member_id','network_id','created_at','repo_id']) {
    assert.equal((await f.api('/v1/messages', {body:'hello',[field]:owner.member.id}, bob.token)).status, 400);
  }
  for (const body of ['', '   ', 'x'.repeat(8001), 2]) assert.equal((await f.api('/v1/messages', {body}, bob.token)).status, 400);
  for (const query of ['before=0','before=-1','before=1.5','before=abc','limit=0','limit=101','limit=NaN']) {
    assert.equal((await f.api(`/v1/messages?${query}`, undefined, bob.token)).status, 400);
  }
  assert.equal((await f.api('/v1/messages', {body:'x'.repeat(8000)}, bob.token)).status, 201);
  await f.api(`/v1/members/${bob.member.id}/revoke`, {}, owner.token);
  assert.equal((await f.api('/v1/messages', undefined, bob.token)).status, 401);
  assert.equal((await f.api('/v1/messages', {body:'revoked'}, bob.token)).status, 401);
});

test('ten members sharing one proxy IP can each run a minute of normal polling', async t => {
  const f=await setup(':memory:',{rateLimit:300}); t.after(()=>f.app.close());
  const owner=await f.create(); const members=[owner];
  for(let i=1;i<10;i++) members.push(await f.joinMember(owner,`member${i}`));
  f.advance(60000);
  // Every request reaches the server from 127.0.0.1, just like one reverse proxy.
  // Hold the clock fixed so all 1,200 requests fall inside a single quota window.
  for(let cycle=0;cycle<20;cycle++) {
    const replies=await Promise.all(members.flatMap(m=>[
      f.api('/v1/presence',{},m.token),
      ...['/v1/me','/v1/members','/v1/repos','/v1/requests','/v1/events?after=0'].map(path=>f.api(path,undefined,m.token))
    ]));
    assert.ok(replies.every(r=>r.status===200),`Polling cycle ${cycle} should not be throttled`);
  }
});

test('anonymous floods cannot block members; member budgets span devices and expire with Retry-After',async t=>{
  const f=await setup(':memory:',{rateLimit:3});t.after(()=>f.app.close());
  const owner=await f.create(), bob=await f.joinMember(owner);
  const second=await f.api('/v1/devices',{device_label:'second'},owner.token);
  assert.equal(second.status,201);f.advance(60000);
  for(let i=0;i<4;i++) {
    const res=await fetch(f.base+'/v1/me',{headers:{authorization:`Bearer invalid-${i}`,'x-forwarded-for':`192.0.2.${i+1}`,'forwarded':`for=192.0.2.${i+1}`}});
    assert.equal(res.status,i<3?401:429,'Changing credentials or forwarded IP must not bypass anonymous limits');
    await res.arrayBuffer();
  }
  assert.equal((await f.create('blocked')).status,429,'Enrollment shares the anonymous budget');
  for(let i=0;i<5;i++)for(const path of ['/health/live','/health/ready'])assert.equal((await f.api(path)).status,200);
  assert.equal((await f.api('/v1/me',undefined,owner.token)).status,200,'Valid members bypass exhausted anonymous budget');
  assert.equal((await f.api('/v1/me',undefined,second.token)).status,200);
  assert.equal((await f.api('/v1/me',undefined,owner.token)).status,200);
  f.advance(1500);
  const blocked=await fetch(f.base+'/v1/me',{headers:{authorization:`Bearer ${second.token}`,'x-forwarded-for':'203.0.113.5'}});
  assert.equal(blocked.status,429);assert.equal(blocked.headers.get('retry-after'),'59');await blocked.arrayBuffer();
  assert.equal((await f.api('/v1/me',undefined,bob.token)).status,200,'One noisy member cannot throttle another');
  f.advance(58500);
  assert.equal((await f.api('/v1/me',undefined,second.token)).status,200,'Member budget resets after one minute');
  assert.equal((await f.api('/v1/me',undefined,'invalid')).status,401,'Anonymous budget also resets');
});

test('WebSocket upgrades share the authenticated HTTP member budget and return Retry-After',async t=>{
  const f=await setup(':memory:',{rateLimit:1,unauthenticatedRateLimit:10});t.after(()=>f.app.close());
  const owner=await f.create(),bob=await f.joinMember(owner);f.advance(60000);
  async function upgrade(token:string) {
    return new Promise<{status:number;retry?:string}>((resolve,reject)=>{
      const req=httpRequest(f.base+'/v1/stream',{headers:{authorization:`Bearer ${token}`,connection:'Upgrade',upgrade:'websocket','sec-websocket-key':'dGhlIHNhbXBsZSBub25jZQ==','sec-websocket-version':'13'}});
      req.on('error',reject);req.setTimeout(3000,()=>req.destroy(new Error('Handshake timed out')));
      req.on('response',res=>{res.resume();resolve({status:res.statusCode!,retry:res.headers['retry-after']})});
      req.on('upgrade',(_res,socket)=>{socket.destroy();resolve({status:101})});req.end();
    });
  }
  assert.equal((await upgrade(owner.token)).status,101);
  assert.equal((await f.api('/v1/me',undefined,owner.token)).status,429);
  assert.deepEqual(await upgrade(owner.token),{status:429,retry:'60'});
  assert.equal((await f.api('/v1/me',undefined,bob.token)).status,200);
  assert.deepEqual(await upgrade(bob.token),{status:429,retry:'60'});
});

test('single-use hashed invitations, unique case-insensitive handles, expiry, identity, presence', async t => {
  const f = await setup(); t.after(() => f.app.close());
  const owner = await f.create(); assert.equal(owner.status,201);
  assert.equal((await f.api('/v1/me',undefined,owner.token)).member.id,owner.member.id);
  const invitation = await f.invite(owner); const bob = await f.api('/v1/join',{code:invitation.code,handle:'Bob'}); assert.equal(bob.member.handle,'bob');
  assert.equal((await f.api('/v1/join',{code:invitation.code,handle:'Carol'})).error.code,'invalid_invite');
  const code = (await f.invite(owner)).code;
  assert.equal((await f.api('/v1/join',{code,handle:'BOB'})).error.code,'handle_taken');
  assert.equal((await f.api('/v1/join',{code,handle:'Carol'})).status,201,'failed join must not consume code');
  const expired = await f.invite(owner,60); f.advance(61000);
  assert.equal((await f.api('/v1/join',{code:expired.code,handle:'Dan'})).error.code,'invalid_invite');
  assert.ok((await f.api('/v1/members',undefined,owner.token)).members.every((m:any) => !m.online));
  await f.api('/v1/presence',{},bob.token);
  assert.equal((await f.api('/v1/members',undefined,owner.token)).members.find((m:any) => m.id===bob.member.id).online,true);
  const stored = f.app.db.prepare('SELECT * FROM invites WHERE id=?').get(invitation.id)!;
  assert.notEqual(stored.code_hash,invitation.code);
});

test('durable offline question, idempotency, participant authorization and immutable result', async t => {
  const f = await setup(); t.after(() => f.app.close());
  const owner=await f.create(), bob=await f.joinMember(owner), carol=await f.joinMember(owner,'carol'), outsider=await f.create('eve');
  const repo=await f.publish(owner); f.advance(60000);
  const idem=randomUUID(); const first=await f.request(bob,repo,'question',{idempotency_key:idem}); const again=await f.request(bob,repo,'question',{idempotency_key:idem});
  assert.equal(first.request.id,again.request.id); assert.equal(first.request.status,'queued');
  assert.equal((await f.request(bob,repo,'question',{idempotency_key:idem,body:'Different'})).error.code,'idempotency_conflict');
  const path=`/v1/requests/${first.request.id}`;
  assert.equal((await f.api(path,undefined,carol.token)).status,404);
  assert.equal((await f.api(path,undefined,outsider.token)).status,404);
  assert.equal((await f.api(path+'/claim',{},bob.token)).status,403);
  assert.equal((await f.api('/v1/events?after=0',undefined,carol.token)).events.filter((e:any) => e.request_id).length,0);
  const lease=await f.api(path+'/claim',{},owner.token);
  assert.equal((await f.api(path+'/heartbeat',{lease_token:lease.lease_token},owner.token)).request.status,'running');
  const done=await f.api(path+'/complete',{lease_token:lease.lease_token,result:answer},owner.token); assert.equal(done.request.status,'answered');
  assert.equal((await f.api(path,undefined,bob.token)).result.answer,answer.answer);
  assert.equal((await f.api(path+'/complete',{lease_token:lease.lease_token,result:answer},owner.token)).status,409);
  const events=await f.api('/v1/events?after=0',undefined,bob.token);
  assert.ok(events.events.some((e:any) => e.type==='request.completed'));
  assert.equal((await f.api(`/v1/events?after=${events.cursor}`,undefined,bob.token)).events.length,0);
});

test('owner approval, cancel races, exclusive claim, expired lease reassignment and stale worker fencing', async t => {
  const f=await setup(); t.after(() => f.app.close());
  const owner=await f.create(), bob=await f.joinMember(owner), repo=await f.publish(owner);
  const second=await f.api('/v1/devices',{device_label:'second'},owner.token);
  const request=(await f.request(bob,repo,'change')).request; const path=`/v1/requests/${request.id}`;
  assert.equal((await f.api(path+'/claim',{},owner.token)).status,409);
  assert.equal((await f.api(path+'/approve',{},bob.token)).status,403);
  assert.equal((await f.api(path+'/approve',{},owner.token)).request.status,'queued');
  const claims=await Promise.all([f.api(path+'/claim',{},owner.token),f.api(path+'/claim',{},second.token)]);
  assert.deepEqual(claims.map(x=>x.status).sort(),[200,409]);
  const winner=claims.findIndex(x=>x.status===200), winnerToken=[owner.token,second.token][winner], loserToken=[second.token,owner.token][winner];
  f.advance(1001); const reassigned=await f.api(path+'/claim',{},loserToken); assert.equal(reassigned.attempt,2);
  assert.equal((await f.api(path+'/heartbeat',{lease_token:claims[winner].lease_token},winnerToken)).error.code,'stale_lease');
  const result={kind:'change_result',base_commit:'a'.repeat(40),commit:'b'.repeat(40),branch:'network/test',delivery:'local_branch',diff_summary:'Two tests added',tests:[{name:'unit',status:'passed'}],owner_review_required:true};
  assert.equal((await f.api(path+'/complete',{lease_token:reassigned.lease_token,result:{...result,delivery:'pushed_branch'}},loserToken)).status,400);
  assert.equal((await f.api(path+'/complete',{lease_token:reassigned.lease_token,result},loserToken)).request.status,'review_ready');
  assert.equal((await f.api(path+'/accept',{},bob.token)).request.status,'accepted');
  const cancelled=(await f.request(bob,repo,'change')).request;
  await f.api(`/v1/requests/${cancelled.id}/cancel`,{},bob.token);
  assert.equal((await f.api(`/v1/requests/${cancelled.id}/approve`,{},owner.token)).status,409);
});

test('catalog capability, approval defaults, path rejection, revocation, and paused execution', async t => {
  const f=await setup(); t.after(() => f.app.close());
  const owner=await f.create(), bob=await f.joinMember(owner);
  const defaultRepo=(await f.api('/v1/repos',{slug:'private',questions_enabled:true},owner.token)).repo;
  assert.equal((await f.request(bob,defaultRepo)).request.status,'approval_pending');
  assert.equal((await f.request(bob,defaultRepo,'change')).error.code,'repo_unavailable');
  assert.equal((await f.api('/v1/repos',{slug:'secrets',local_path:'/Users/secret'},owner.token)).error.code,'unknown_fields');
  const repo=await f.publish(owner), request=(await f.request(bob,repo)).request; const path=`/v1/requests/${request.id}`;
  const lease=await f.api(path+'/claim',{},owner.token);
  assert.equal((await f.api(path+'/complete',{lease_token:lease.lease_token,result:{...answer,sources:[{path:'/private/key'}]}},owner.token)).status,400);
  assert.equal((await f.api(`/v1/repos/${repo.id}`,{availability:'paused'},bob.token,'PATCH')).status,403);
  await f.api(`/v1/repos/${repo.id}`,{availability:'paused'},owner.token,'PATCH');
  assert.equal((await f.api(path,undefined,bob.token)).request.status,'cancelled');
  assert.equal((await f.api(path+'/complete',{lease_token:lease.lease_token,result:answer},owner.token)).status,409);
  await f.api(`/v1/members/${bob.member.id}/revoke`,{},owner.token);
  assert.equal((await f.api('/v1/me',undefined,bob.token)).status,401);
});

test('restart, backup restore and event cursor preserve history', async t => {
  const directory=mkdtempSync(join(tmpdir(),'pantheon-test-')); t.after(() => rmSync(directory,{recursive:true,force:true}));
  const filename=join(directory,'source.sqlite'); let f=await setup(filename);
  const owner=await f.create(), bob=await f.joinMember(owner), repo=await f.publish(owner), request=(await f.request(bob,repo)).request;
  const before=await f.api('/v1/events?after=0',undefined,bob.token);
  await backup(f.app.db,join(directory,'backup.sqlite')); await f.app.close();
  f=await setup(filename); assert.equal((await f.api(`/v1/requests/${request.id}`,undefined,bob.token)).request.status,'queued');
  assert.deepEqual((await f.api('/v1/events?after=0',undefined,bob.token)).events,before.events); await f.app.close();
  const restored=await setup(join(directory,'backup.sqlite')); t.after(()=>restored.app.close());
  assert.deepEqual((await restored.api('/v1/events?after=0',undefined,bob.token)).events,before.events);
});

test('input bounds, authentication, idempotent enrollment and invite revocation', async t => {
  const f=await setup(); t.after(()=>f.app.close()); const key=randomUUID();
  const owner=await f.api('/v1/networks',{name:'Test',handle:'alice',idempotency_key:key});
  const retry=await f.api('/v1/networks',{name:'Test',handle:'alice',idempotency_key:key}); assert.equal(retry.token,owner.token);
  assert.equal((await f.api('/v1/me')).status,401);
  assert.equal((await f.api('/v1/presence',{idempotency_key:'short'},owner.token)).status,400);
  assert.equal((await f.api('/v1/events?after=-1',undefined,owner.token)).status,400);
  assert.equal((await f.api('/v1/repos',{slug:'test',description:'x'.repeat(33000)},owner.token)).status,413);
  const invite=await f.invite(owner); await f.api(`/v1/invites/${invite.id}/revoke`,{},owner.token);
  assert.equal((await f.api('/v1/join',{code:invite.code,handle:'bob'})).error.code,'invalid_invite');
});

test('stricter question policy moves queued work back to owner approval', async t => {
  const f=await setup(); t.after(()=>f.app.close()); const owner=await f.create(), bob=await f.joinMember(owner), repo=await f.publish(owner);
  const request=(await f.request(bob,repo)).request; const path=`/v1/requests/${request.id}`;
  await f.api(`/v1/repos/${repo.id}`,{questions_require_approval:true},owner.token,'PATCH');
  assert.equal((await f.api(path,undefined,owner.token)).request.status,'approval_pending');
  assert.equal((await f.api(path+'/claim',{},owner.token)).status,409);
  await f.api(path+'/approve',{},owner.token);
  assert.equal((await f.api(path+'/claim',{},owner.token)).status,200);
});

test('authenticated WebSocket replays authorized events and closes revoked devices', async t => {
  const f=await setup(); t.after(()=>f.app.close()); const owner=await f.create(), bob=await f.joinMember(owner), repo=await f.publish(owner);
  const before=await f.api('/v1/events?after=0',undefined,bob.token);
  const frames:any[]=[];
  const socket=await new Promise<import('node:net').Socket>((resolve,reject)=>{
    const req=httpRequest(`${f.base}/v1/stream?after=${before.cursor}`,{headers:{authorization:`Bearer ${bob.token}`,connection:'Upgrade',upgrade:'websocket','sec-websocket-key':'dGhlIHNhbXBsZSBub25jZQ==','sec-websocket-version':'13'}});
    req.on('error',reject); req.on('response',res=>reject(new Error(`Unexpected ${res.statusCode}`)));
    req.on('upgrade',(_res,socket,head)=>{
      let pending=Buffer.alloc(0);
      const consume=(data:Buffer)=>{
        pending=Buffer.concat([pending,data]);
        while(pending.length>=2){
          let length=pending[1]&127, offset=2;
          if(length===126){if(pending.length<4)return;length=pending.readUInt16BE(2);offset=4;}
          if(pending.length<offset+length)return;
          if((pending[0]&15)===1)frames.push(JSON.parse(pending.subarray(offset,offset+length).toString()));
          pending=pending.subarray(offset+length);
        }
      };
      socket.on('data',consume); consume(head); resolve(socket);
    });req.end();
  });
  t.after(()=>socket.destroy());
  const created=(await f.request(bob,repo)).request;
  await new Promise(resolve=>setTimeout(resolve,700));
  assert.ok(frames.some(f=>f.type==='event'&&f.event.request_id===created.id));
  const closed=new Promise<void>(resolve=>socket.once('close',()=>resolve()));
  await f.api(`/v1/devices/${bob.device.id}/revoke`,{},bob.token);
  await Promise.race([closed,new Promise((_resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Revoked WebSocket stayed connected')),2000);timer.unref();})]);
});
