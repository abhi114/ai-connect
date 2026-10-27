import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

// Resolve the native binary: npm's codex.cmd shim cannot be spawned with shell:false.
// Re-evaluate on each use so an install/update does not require a cached path reset.
export function codexBinary(options:{platform?:string;arch?:string;env?:NodeJS.ProcessEnv;exists?:(path:string)=>boolean}={}) {
  const env=options.env??process.env, platform=options.platform??process.platform;
  if(env.RN_CODEX_BIN)return env.RN_CODEX_BIN;
  if(platform!=='win32')return 'codex';
  const exists=options.exists??existsSync;
  const arch=options.arch??process.arch;
  const pathValue=Object.entries(env).find(([key])=>key.toLowerCase()==='path')?.[1]||'';
  const dirs=pathValue.split(';').map(p=>p.trim().replace(/^"|"$/g,'')).filter(Boolean);
  const prefixes=[...dirs,env.npm_config_prefix,env.NPM_CONFIG_PREFIX,env.APPDATA&&win32.join(env.APPDATA,'npm'),env.LOCALAPPDATA&&win32.join(env.LOCALAPPDATA,'npm')].filter((p):p is string=>!!p);
  const triple=arch==='arm64'?'aarch64-pc-windows-msvc':'x86_64-pc-windows-msvc';
  const candidates:string[]=[];
  for(const prefix of new Set(prefixes)) {
    candidates.push(win32.join(prefix,'codex.exe'));
    const root=win32.join(prefix,'node_modules','@openai','codex');
    for(const base of [win32.join(root,'node_modules','@openai',`codex-win32-${arch}`),root]) {
      for(const folder of ['codex','bin'])candidates.push(win32.join(base,'vendor',triple,folder,'codex.exe'));
    }
  }
  const binary=candidates.find(exists);
  if(binary)return binary;
  throw new Error('Codex CLI was not found. Install it with npm install -g @openai/codex, then retry. Codex desktop alone does not install the CLI. For a custom installation, set RN_CODEX_BIN to codex.exe.');
}
