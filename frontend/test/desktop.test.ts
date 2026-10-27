import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dashboardURL,desktopAction } from '../src/desktop.ts';

test('desktop bridge accepts only tokenized local dashboard URLs',()=>{
  assert.equal(dashboardURL('http://127.0.0.1:4319/#token=test-token',true),'http://127.0.0.1:4319/settings#token=test-token');
  for(const url of ['https://evil.test/#token=x','http://localhost/#token=x','http://u:p@127.0.0.1/#token=x','http://127.0.0.1/'])assert.throws(()=>dashboardURL(url));
});
test('desktop readiness checks do not start a daemon or mutate enrollment',async()=>{
  const calls:any[]=[];
  const status=await desktopAction('check',async(exe,args)=>{calls.push([exe,args]);return 'ok'});
  assert.deepEqual(status,{git:true,codex:true,signed_in:true});
  assert.ok(calls.some(c=>JSON.stringify(c[1])==='["login","status"]'));
  await assert.rejects(desktopAction('delete-profile'),/Unsupported/);
});
test('missing developer tools do not invoke git and failed login is reported',async()=>{
  const status=await desktopAction('check',async(exe,args)=>{assert.notEqual(exe,'/usr/bin/git');if(exe.includes('xcode-select')||args[0]==='login')throw Error('missing');return 'ok'});
  assert.deepEqual(status,{git:false,codex:true,signed_in:false});
});
test('packaging pins runtimes, excludes profile inputs and keeps setup local',()=>{
  const build=readFileSync(new URL('../packaging/macos/build.mjs',import.meta.url),'utf8');
  assert.match(build,/Checksum mismatch/);assert.match(build,/\['frontend\/src','shared'\]/);
  assert.doesNotMatch(build,/cpSync\([^\n]*homedir/);
  const native=readFileSync(new URL('../native/macos/desktop.swift',import.meta.url),'utf8');
  assert.match(native,/127\.0\.0\.1/);assert.match(native,/\.nonPersistent\(\)/);
  assert.doesNotMatch(native,/WKScriptMessageHandler/);
});
test('bundled menu opens its owning desktop app and preserves browser fallback for CLI installs',()=>{
  const menu=readFileSync(new URL('../native/macos/main.swift',import.meta.url),'utf8');
  const action=menu.slice(menu.indexOf('@objc func dashboard()'),menu.indexOf('@objc func toggleAlerts()'));
  assert.match(action,/Bundle\(url:desktop\)\?\.bundleIdentifier == "io.aiconnect.desktop"/);
  assert.match(action,/configuration.arguments = \["--open-dashboard"\]/);
  assert.match(action,/openApplication\(at:desktop/);
  assert.ok(action.indexOf('return')<action.indexOf('try connection()'));
  const native=readFileSync(new URL('../native/macos/desktop.swift',import.meta.url),'utf8');
  assert.match(native,/CommandLine.arguments.contains\("--open-dashboard"\)/);
  assert.match(native,/guard !busy,pendingDashboard else/);
  assert.match(native,/if window.contentView !== web/);
  assert.match(native,/window.deminiaturize\(nil\)/);
});
