// Test a built app's runtime/companion in an isolated profile, never the real membership.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync,mkdtempSync } from 'node:fs';
import { join,resolve } from 'node:path';
import assert from 'node:assert/strict';
const run=promisify(execFile),app=resolve(process.argv[2]),res=join(app,'Contents/Resources');
const cache=resolve('.cache');mkdirSync(cache,{recursive:true});const profile=mkdtempSync(join(cache,'desktop-smoke-'));
const node=join(res,'runtime/bin/node'),bridge=join(res,'app/frontend/src/desktop.ts'),codex=join(res,'runtime/bin/codex');
const env={...process.env,RN_HOME:profile,RN_PORT:'0',RN_SERVER:'http://127.0.0.1:1',RN_CODEX_BIN:codex,CODEX_HOME:join(profile,'codex')};
const call=async(action)=>{const r=await run(node,[bridge,action],{env,timeout:60_000});return JSON.parse(r.stdout.trim());};
let started=false;
try{
  assert.match((await run(node,['--version'])).stdout,/^v24\./);
  assert.match((await run(codex,['--version'],{env})).stdout,/0\.164\.0/);
  const result=await call('start');started=true;assert.equal(result.enrolled,false);
  const url=new URL(result.url);assert.equal(url.pathname,'/settings');
  const response=await fetch(url);assert.equal(response.status,200);assert.match(await response.text(),/Join your team/);
  assert.equal((await fetch(new URL('/rpc',url),{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  console.log('PASS: bundled Node/Codex, isolated companion start, first-run Settings, authenticated dashboard boundary.');
}finally{if(started)await call('stop');}
console.log('Isolated smoke profile retained under .cache; no real credentials or enrollment used.');
