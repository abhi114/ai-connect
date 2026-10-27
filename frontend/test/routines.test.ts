import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.ts';
import { Core } from '../src/core.ts';
import { Routines,nextRoutine,validateSchedule,type Schedule } from '../src/routines.ts';
import { html,js } from '../src/dashboard.ts';
const schedule:Schedule={frequency:'daily',time:'09:00',day:1,timezone:'Asia/Kolkata'};
async function fixture(){const store=new Store(await mkdtemp(join(tmpdir(),'ai-routines-')));store.state.bindings.r={repo_id:'r',name:'demo',path:'/not-executed',git_dir:'/not-executed/.git',questions:'off',changes:false,paused:false,allowed_paths:['.'],max_diff_bytes:200000};const core=new Core(store);let clock=Date.parse('2026-10-26T00:00:00Z');const routines=new Routines(store,core.worker.local,()=>clock);const save=(extra:any={})=>routines.save({name:'Check',prompt:'Review only',repo_id:'r',schedule,enabled:true,confirmed:true,...extra},{});return {store,core,routines,save,setTime:(t:number)=>clock=t};}
test('schedules validate timezone/time and compute daily, weekly, weekdays and hourly',()=>{
 assert.equal(new Date(nextRoutine(schedule,Date.parse('2026-10-26T00:00Z'))).toISOString(),'2026-10-26T03:30:00.000Z');
 assert.equal(new Date(nextRoutine({...schedule,frequency:'weekly',day:5},Date.parse('2026-10-26T00:00Z'))).toISOString(),'2026-10-30T03:30:00.000Z');
 assert.equal(new Date(nextRoutine({...schedule,frequency:'weekdays'},Date.parse('2026-10-30T04:00Z'))).toISOString(),'2026-11-02T03:30:00.000Z');
 assert.equal(new Date(nextRoutine({...schedule,frequency:'hourly'},Date.parse('2026-10-26T00:01Z'))).toISOString(),'2026-10-26T00:30:00.000Z');
 assert.throws(()=>validateSchedule({...schedule,timezone:'Invalid/Zone'}));assert.throws(()=>validateSchedule({...schedule,time:'25:00'}));
});
test('DST nonexistent time skips day; repeated wall time not scheduled twice by tick',async()=>{
 const s:Schedule={...schedule,timezone:'America/New_York',time:'02:30'};
 assert.equal(new Date(nextRoutine(s,Date.parse('2026-03-08T05:00Z'))).toISOString(),'2026-03-09T06:30:00.000Z');
 const f=await fixture(),r=f.save({schedule:{...s,time:'01:30'}});r.next_at=Date.parse('2026-11-01T05:30Z');f.setTime(r.next_at);f.routines.tick();assert.equal(new Date(r.next_at!).toISOString(),'2026-11-02T06:30:00.000Z');
});
test('due routines create read-only fresh chats exactly once across restart',async()=>{
 const f=await fixture(),r=f.save();f.setTime(r.next_at!);f.routines.tick();const h=r.history[0];assert.ok(h.chat_id&&h.turn_id);assert.equal(f.store.state.local_chats![h.chat_id].turns[0].kind,'question');assert.equal(f.store.state.runs[h.turn_id].state,'queued');
 const restored=new Store(f.store.dir),core=new Core(restored),routines=new Routines(restored,core.worker.local,()=>Date.parse('2026-10-26T03:30Z'));routines.tick();assert.equal(Object.keys(restored.state.local_chats!).length,1);assert.equal(restored.state.outbox.length,0);
});
test('overlap cannot evade bounded history, missed schedules skip, pause and removal retain chats',async()=>{
 const f=await fixture(),r=f.save();f.setTime(r.next_at!);f.routines.tick();const chat=r.history[0].chat_id!;for(let i=0;i<40;i++){f.setTime(r.next_at!);f.routines.tick();}assert.equal(Object.keys(f.store.state.local_chats!).length,1);assert.equal(r.history.length,30);assert.throws(()=>f.routines.run(r.id),/active work/);
 f.routines.toggle(r.id,false,false);assert.equal(r.next_at,null);assert.throws(()=>f.routines.toggle(r.id,true,false),/Confirm/);f.routines.remove(r.id);assert.ok(f.store.state.local_chats![chat]);
 const second=f.save();f.setTime(second.next_at!+13*3600000);f.routines.tick();assert.match(second.history[0].reason,/12 hours/);assert.equal(second.last_turn_id,undefined);
});
test('consent and local binding required; catch-up once and failure recorded',async()=>{
 const f=await fixture();assert.throws(()=>f.save({confirmed:false}),/Confirm/);assert.throws(()=>f.save({repo_id:'remote'}),/local repository/);
 const r=f.save();f.setTime(r.next_at!+3600000);f.routines.tick();assert.equal(r.history[0].reason,'Catch-up');assert.equal(r.history.length,1);
 const failed=f.save({name:'Missing'});delete f.store.state.bindings.r;f.setTime(failed.next_at!);f.routines.tick();assert.ok(failed.history[0].error);assert.ok(failed.next_at!>Date.parse('2026-10-26T03:30Z'));
});
test('restart recovers enqueue before routine pointer was saved',async()=>{
 const f=await fixture(),r=f.save();f.routines.run(r.id);const id=r.last_turn_id;delete r.last_turn_id;delete r.history[0].turn_id;f.store.save();
 const restored=new Store(f.store.dir),core=new Core(restored);assert.equal(core.routines.busy(core.routines.get(r.id)),true);assert.equal(core.routines.get(r.id).last_turn_id,id);assert.throws(()=>core.routines.run(r.id),/active work/);
});
test('routines UI supplies safe templates, explicit consent and sidebar navigation',()=>{new Function(js);assert.match(html,/id="tab-routines"/);assert.match(html,/routine-consent/);assert.match(js,/routine_run/);assert.match(js,/renderRoutinesHeader/);assert.match(html,/No automatic edits/);});
