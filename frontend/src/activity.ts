import type { Store, Run } from './store.ts';

export interface Activity {id:string;at:number;kind:'command'|'files'|'note'|'status';text:string;state:string}
export type ActivitySink=(event:unknown)=>void;

// Public progress only. Never retain reasoning items, command arguments/output,
// tool payloads, credentials, or opaque events in the dashboard activity log.
export function publicActivity(raw:any):Omit<Activity,'at'>|undefined {
  if(!raw||typeof raw!=='object')return;
  if(['turn.started','turn.completed','turn.failed'].includes(raw.type))return {id:raw.type,kind:'status',text:raw.type==='turn.started'?'Agent started':raw.type==='turn.completed'?'Agent response finished':'Agent run failed',state:raw.type};
  const i=raw.item;if(!i||typeof i.id!=='string'||i.id.length>100||!['item.started','item.updated','item.completed'].includes(raw.type))return;
  const state=raw.type==='item.completed'?(i.status==='failed'||(typeof i.exit_code==='number'&&i.exit_code!==0)?'failed':'complete'):'running';
  if(i.type==='command_execution')return {id:i.id,kind:'command',text:'Workspace command'+(Number.isInteger(i.exit_code)?' · exit '+i.exit_code:''),state};
  if(i.type==='file_change')return {id:i.id,kind:'files',text:'File changes'+(Array.isArray(i.changes)?' · '+i.changes.length+' paths':''),state};
  // agent_message is public assistant output; reasoning is a separate, excluded
  // item type. Omit structured final responses and unknown/private channels.
  if(i.type==='agent_message'&&(!i.channel||i.channel==='commentary')&&typeof i.text==='string'&&!/^\s*(?:\{|```)/.test(i.text))return {id:i.id,kind:'note',text:i.text.replace(/(?:Bearer\s+\S+|(?:sk-|ghp_)[A-Za-z0-9_-]+|[A-Z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\s*[=:]\s*\S+)/gi,'[redacted]').slice(0,800),state};
}
export function recordActivity(store:Store,run:Run):ActivitySink {
  run.started_at=Date.now();run.activity=[];store.save();
  return raw=>{const value=publicActivity(raw);if(!value)return;const items=run.activity!;const old=items.find(i=>i.id===value.id);if(old)Object.assign(old,value);else if(items.length<100)items.push({...value,at:Date.now()});else run.activity_truncated=true;store.save();};
}
