import test from 'node:test';
import assert from 'node:assert/strict';
import { win32 } from 'node:path';
import { codexBinary } from '../src/codex-binary.ts';

test('explicit executable is preserved and Unix uses normal PATH lookup',()=>{
  assert.equal(codexBinary({platform:'win32',env:{RN_CODEX_BIN:'custom.exe'}}),'custom.exe');
  assert.equal(codexBinary({platform:'darwin',env:{}}),'codex');
});
test('Windows discovers native executables behind npm shims without running a shell',()=>{
  for(const arch of ['x64','arm64'])for(const folder of ['codex','bin']) {
    const prefix='C:\\Users\\A Person\\AppData\\Roaming\\npm';
    const expected=win32.join(prefix,'node_modules','@openai','codex','node_modules','@openai',`codex-win32-${arch}`,'vendor',arch==='arm64'?'aarch64-pc-windows-msvc':'x86_64-pc-windows-msvc',folder,'codex.exe');
    assert.equal(codexBinary({platform:'win32',arch,env:{APPDATA:'C:\\Users\\A Person\\AppData\\Roaming'},exists:p=>p===expected}),expected);
  }
});
test('Windows searches mixed-case PATH and custom npm prefixes and legacy packages',()=>{
  for(const env of [{Path:'"D:\\Node Tools"'},{npm_config_prefix:'D:\\Node Tools'}]) {
    const expected='D:\\Node Tools\\node_modules\\@openai\\codex\\vendor\\x86_64-pc-windows-msvc\\codex\\codex.exe';
    assert.equal(codexBinary({platform:'win32',arch:'x64',env,exists:p=>p===expected}),expected);
  }
  const expected='D:\\Tools\\codex.exe';
  assert.equal(codexBinary({platform:'win32',env:{PATH:'D:\\Tools'},exists:p=>p===expected}),expected);
});
test('missing Windows executable gives install guidance instead of ENOENT',()=>{
  assert.throws(()=>codexBinary({platform:'win32',env:{},exists:()=>false}),/npm install -g @openai\/codex/);
});
