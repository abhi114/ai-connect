import { randomUUID } from 'node:crypto';
import type { Store } from './store.ts';
import type { LocalChats } from './local-chats.ts';
import type { ExecutionOptions } from './models.ts';

export interface Schedule {frequency:'hourly'|'daily'|'weekdays'|'weekly';time:string;day:number;timezone:string}
export interface Routine {id:string;name:string;prompt:string;repo_id:string;schedule:Schedule;execution:ExecutionOptions;enabled:boolean;next_at:number|null;last_turn_id?:string;history:{at:number;reason:string;chat_id?:string;turn_id?:string;error?:string}[]}
export function validateSchedule(s:any):Schedule {
  if(!s||!['hourly','daily','weekdays','weekly'].includes(s.frequency)||typeof s.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)||!Number.isInteger(s.day)||s.day<0||s.day>6||typeof s.timezone!=='string'||s.timezone.length>80)throw Error('Choose a valid frequency, time, weekday and timezone');
  try{new Intl.DateTimeFormat('en-US',{timeZone:s.timezone}).format()}catch{throw Error('Invalid timezone')}
  return {frequency:s.frequency,time:s.time,day:s.day,timezone:s.timezone};
}
// UTC-minute scan handles named zones without assuming their offset is fixed.
// Nonexistent DST times are skipped. Daily schedules skip a second repeated wall
// time by advancing at least 60 minutes after an occurrence.
export function nextRoutine(s:Schedule,after:number):number {
  const f=new Intl.DateTimeFormat('en-US',{timeZone:s.timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  for(let t=Math.floor(after/60000)*60000+60000,end=t+9*86400000;t<end;t+=60000){const p=Object.fromEntries(f.formatToParts(t).map(x=>[x.type,x.value]));const day=days.indexOf(p.weekday);if(p.minute!==s.time.slice(3))continue;if(s.frequency!=='hourly'&&p.hour!==s.time.slice(0,2))continue;if(s.frequency==='weekdays'&&(day===0||day===6))continue;if(s.frequency==='weekly'&&day!==s.day)continue;return t;}
  throw Error('No upcoming occurrence found');
}
export class Routines {
  private store:Store;
  private chats:LocalChats;
  private now:()=>number;
  constructor(store:Store,chats:LocalChats,now=()=>Date.now()){this.store=store;this.chats=chats;this.now=now;store.state.routines||={};}
  get(id:string){const r=this.store.state.routines?.[id];if(!r)throw Error('Unknown routine');return r;}
  save(b:any,execution:ExecutionOptions){
    if(b.confirmed!==true)throw Error('Confirm scheduled read-only execution using this computer’s Codex account');
    if(b.id)this.get(b.id);
    if(typeof b.name!=='string'||!b.name.trim()||b.name.length>100||typeof b.prompt!=='string'||!b.prompt.trim()||b.prompt.length>8000||!this.store.state.bindings[b.repo_id]||typeof b.enabled!=='boolean')throw Error('Name, prompt, local repository and enabled state are required');
    const schedule=validateSchedule(b.schedule),old=b.id?this.get(b.id):undefined;
    if(!old&&Object.keys(this.store.state.routines!).length>=100)throw Error('Routine limit reached');
    const r:Routine={id:old?.id||'routine_'+randomUUID(),name:b.name.trim(),prompt:b.prompt.trim(),repo_id:b.repo_id,schedule,execution:{...execution},enabled:b.enabled,next_at:b.enabled?nextRoutine(schedule,this.now()):null,last_turn_id:old?.last_turn_id,history:old?.history||[]};
    this.store.state.routines![r.id]=r;this.store.save();return r;
  }
  toggle(id:string,enabled:boolean,confirmed:boolean){if(typeof enabled!=='boolean'||(enabled&&!confirmed))throw Error('Confirm enabling scheduled execution');const r=this.get(id);r.enabled=enabled;r.next_at=enabled?nextRoutine(r.schedule,this.now()):null;this.store.save();return r;}
  remove(id:string){this.get(id);delete this.store.state.routines![id];this.store.save();return {ok:true};}
  busy(r:Routine){
    const active=(id:string)=>['queued','claiming','running','awaiting_review','delivery_pending'].includes(this.store.state.runs[id]?.state);
    if(r.last_turn_id&&active(r.last_turn_id))return true;
    // Recover an enqueue persisted just before a crash saved its routine pointer.
    for(const h of r.history){const turn=h.chat_id?this.store.state.local_chats?.[h.chat_id]?.turns.find(t=>active(t.id)):undefined;if(turn){r.last_turn_id=turn.id;this.store.save();return true;}}
    return false;
  }
  run(id:string,reason='manual'){
    const r=this.get(id);if(this.busy(r))throw Error('This routine already has queued or active work');
    // Reserve durably before creating a chat. A crash may leave a held record,
    // but restarting must never repeat the same scheduled occurrence.
    const record:Routine['history'][number]={at:this.now(),reason,error:'Run reserved; if interrupted before enqueue, inspect and use Run now.'};r.history.unshift(record);r.history=r.history.slice(0,30);this.store.save();
    try{const c=this.chats.create(r.repo_id,r.name+' · '+new Date(record.at).toISOString());record.chat_id=c.id;this.store.save();const t=this.chats.enqueue(c.id,r.prompt,'question',r.execution,false);record.turn_id=t.id;r.last_turn_id=t.id;delete record.error;this.store.save();return {chat_id:c.id,turn_id:t.id};}
    catch(e){record.error=e instanceof Error?e.message:String(e);this.store.save();throw e;}
  }
  tick(){const now=this.now();for(const r of Object.values(this.store.state.routines||{})){
    if(!r.enabled||r.next_at===null||r.next_at>now)continue;const due=r.next_at;
    r.next_at=nextRoutine(r.schedule,r.schedule.frequency==='hourly'?now:Math.max(now,due+60*60000));this.store.save();
    if(now-due>12*3600000||this.busy(r)){r.history.unshift({at:now,reason:now-due>12*3600000?'Skipped: missed by more than 12 hours':'Skipped: previous run still queued or active'});r.history=r.history.slice(0,30);this.store.save();continue;}
    try{this.run(r.id,now-due>120000?'Catch-up':'Scheduled')}catch{/* Failure recorded; no automatic execution retry. */}
  }}
  view(){return Object.values(this.store.state.routines||{}).map(r=>({...r,busy:this.busy(r),history:r.history.map(h=>({...h,state:h.turn_id?this.store.state.runs[h.turn_id]?.state:undefined}))}));}
}
