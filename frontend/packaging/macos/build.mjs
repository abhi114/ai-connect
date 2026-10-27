// Build on macOS with Xcode Command Line Tools. Recipients need neither npm nor Node.
import { mkdirSync,readFileSync,writeFileSync,copyFileSync,cpSync,existsSync,chmodSync,symlinkSync,readdirSync,lstatSync } from 'node:fs';
import { join,resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

if(process.platform!=='darwin')throw Error('Build this installer on macOS');
const arch=process.argv[2]||process.arch;
if(!['arm64','x64'].includes(arch))throw Error('Use arm64 or x64');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const output=join(root,'dist',`macos-${arch}-${Date.now()}`),cache=join(root,'.cache','macos');
mkdirSync(output,{recursive:true});mkdirSync(cache,{recursive:true});
const nodeVersion='24.22.1',codexVersion='0.164.0';
const nodeHash={arm64:'89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7',x64:'d132557e7ee2b85af08b0c8c34338e65c6430f2238d01f727728ef42dc83b035'}[arch];
const codexHash={arm64:'pDizgOUAtq3/k3AbUFHbaU19WpYKCja+oFpNSTLKrDQj4lTUNSDuTPJip4uQVn2/1EipQdpQrGMOQBVuI1znAA==',x64:'lIe+udnguPGzBezkgbkj2Eaz0YqOhNXT7jja136Fj0sXfI+UKNS2icmaK14GcoRAgeVEpDTtC1ftamWBPmD1zg=='}[arch];
async function download(url,name,algorithm,hash,encoding){
  const path=join(cache,name);
  if(!existsSync(path)){console.log('Downloading',name);const r=await fetch(url);if(!r.ok)throw Error(`Download failed: ${r.status}`);writeFileSync(path,Buffer.from(await r.arrayBuffer()));}
  if(createHash(algorithm).update(readFileSync(path)).digest(encoding)!==hash)throw Error(`Checksum mismatch: ${path}. Remove this exact cached archive and retry.`);
  return path;
}
const nodeName=`node-v${nodeVersion}-darwin-${arch}`;
const nodeArchive=await download(`https://nodejs.org/dist/v${nodeVersion}/${nodeName}.tar.gz`,nodeName+'.tar.gz','sha256',nodeHash,'hex');
const codexArchive=await download(`https://registry.npmjs.org/@openai/codex/-/codex-${codexVersion}-darwin-${arch}.tgz`,`codex-${codexVersion}-${arch}.tgz`,'sha512',codexHash,'base64');
const run=(exe,args)=>execFileSync(exe,args,{stdio:'inherit'});
const extracted=join(output,'dependencies');mkdirSync(extracted);
run('/usr/bin/tar',['-xzf',nodeArchive,'-C',extracted]);run('/usr/bin/tar',['-xzf',codexArchive,'-C',extracted]);
const stage=join(output,'disk'),app=join(stage,'AIConnect.app'),contents=join(app,'Contents'),res=join(contents,'Resources'),bin=join(contents,'MacOS');
mkdirSync(bin,{recursive:true});mkdirSync(join(res,'runtime','bin'),{recursive:true});
// Explicit allowlist: no profiles, databases, tests, .env, git metadata or developer dependencies.
for(const part of ['frontend/src','shared'])cpSync(join(root,'..',part),join(res,'app',part),{recursive:true,filter:p=>!/(^|\/)node_modules(\/|$)/.test(p)});
copyFileSync(join(root,'package.json'),join(res,'app','frontend','package.json'));
copyFileSync(join(extracted,nodeName,'bin','node'),join(res,'runtime','bin','node'));
cpSync(join(extracted,nodeName,'lib','node_modules','npm'),join(res,'runtime','lib','node_modules','npm'),{recursive:true});
symlinkSync('../lib/node_modules/npm/bin/npm-cli.js',join(res,'runtime','bin','npm'));
symlinkSync('../lib/node_modules/npm/bin/npx-cli.js',join(res,'runtime','bin','npx'));
const triple=arch==='arm64'?'aarch64-apple-darwin':'x86_64-apple-darwin';
const vendor=join(extracted,'package','vendor',triple);
cpSync(vendor,join(res,'runtime','vendor',triple),{recursive:true});
if(!existsSync(join(vendor,'bin','codex')))throw Error('Unexpected Codex package layout');
symlinkSync(`../vendor/${triple}/bin/codex`,join(res,'runtime','bin','codex'));
const licenses=join(res,'licenses');mkdirSync(licenses);
copyFileSync(join(extracted,nodeName,'LICENSE'),join(licenses,'NODE-LICENSE'));
for(const [name,hash] of [['LICENSE','d17f227e4df5da1600391338865ce0f3055211760a36688f816941d58232d8dc'],['NOTICE','9d71575ecfd9a843fc1677b0efb08053c6ba9fd686a0de1a6f5382fd3c220915']]){
  const source=await download(`https://raw.githubusercontent.com/openai/codex/rust-v${codexVersion}/${name}`,`codex-${codexVersion}-${name}`,'sha256',hash,'hex');
  copyFileSync(source,join(licenses,'CODEX-'+name));
}
// Preserve package license/notice files, including recursively shipped notices.
function notices(dir,prefix=''){for(const entry of readdirSync(dir)){const p=join(dir,entry);if(lstatSync(p).isDirectory())notices(p,prefix+entry+'-');else if(/license|notice|copying/i.test(entry))copyFileSync(p,join(licenses,prefix+entry));}}
notices(join(extracted,'package'));
writeFileSync(join(licenses,'BUNDLED-SOFTWARE.txt'),`Node.js ${nodeVersion}: https://nodejs.org/\nCodex CLI ${codexVersion}: https://github.com/openai/codex (Apache-2.0)\nDownloaded official platform npm distribution; archive integrity pinned in build.mjs.\nAIConnect is an independent project, not an OpenAI product.\n`);
const xml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function plist(id,exe,menu=false){return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleName</key><string>AIConnect</string><key>CFBundleDisplayName</key><string>AIConnect</string><key>CFBundleExecutable</key><string>${exe}</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.1.0</string><key>CFBundleVersion</key><string>1</string><key>LSMinimumSystemVersion</key><string>13.0</string>${menu?'<key>LSUIElement</key><true/>':''}<key>NSHighResolutionCapable</key><true/><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/><key>NSAllowsArbitraryLoadsInWebContent</key><true/></dict></dict></plist>`;}
writeFileSync(join(contents,'Info.plist'),plist('io.aiconnect.desktop','AIConnect').replace('<string>13.0</string>','<string>13.5</string>'));
const target=(arch==='arm64'?'arm64':'x86_64')+'-apple-macosx13.0';
run('/usr/bin/xcrun',['swiftc','-swift-version','5','-O','-target',target,join(root,'native/macos/desktop.swift'),'-o',join(bin,'AIConnect'),'-framework','Cocoa','-framework','WebKit']);
const helper=join(res,'AIConnect Menu.app'),hc=join(helper,'Contents');mkdirSync(join(hc,'MacOS'),{recursive:true});
writeFileSync(join(hc,'Info.plist'),plist('io.aiconnect.desktop.menu','AIConnectMenu',true));
run('/usr/bin/xcrun',['swiftc','-swift-version','5','-O','-target',target,join(root,'native/macos/main.swift'),'-o',join(hc,'MacOS','AIConnectMenu'),'-framework','Cocoa','-framework','UserNotifications']);
const identity=process.env.AICONNECT_SIGN_IDENTITY||'-';
// Sign nested Mach-O executables first. Preserve resource files and executable permissions.
function signBinaries(dir){for(const entry of readdirSync(dir)){const p=join(dir,entry),st=lstatSync(p);if(st.isSymbolicLink())continue;if(st.isDirectory())signBinaries(p);else if(st.mode&0o111){const kind=execFileSync('/usr/bin/file',['-b',p],{encoding:'utf8'});if(kind.includes('Mach-O'))run('/usr/bin/codesign',['--force','--sign',identity,...(identity==='-'?[]:['--options','runtime','--timestamp']),p]);}}}
// Node's JIT needs this entitlement when hardened-runtime signing for distribution.
const entitlement=join(output,'node-entitlements.plist');writeFileSync(entitlement,'<plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>');
signBinaries(res);run('/usr/bin/codesign',['--force','--sign',identity,...(identity==='-'?[]:['--options','runtime','--timestamp','--entitlements',entitlement]),join(res,'runtime/bin/node')]);
for(const bundle of [helper,app])run('/usr/bin/codesign',['--force','--sign',identity,...(identity==='-'?[]:['--options','runtime','--timestamp']),bundle]);
run('/usr/bin/codesign',['--verify','--deep','--strict',app]);
writeFileSync(join(res,'build-info.json'),JSON.stringify({node:nodeVersion,codex:codexVersion,arch,server:'https://aiconnect.162-35-104-181.sslip.io',signing:identity==='-'?'ad-hoc development':'Developer ID',created:new Date().toISOString()},null,2));
// Adding build metadata changes the outer seal; sign it again.
run('/usr/bin/codesign',['--force','--sign',identity,...(identity==='-'?[]:['--options','runtime','--timestamp']),app]);
symlinkSync('/Applications',join(stage,'Applications'));
copyFileSync(join(root,'packaging/macos/INSTALL.txt'),join(stage,'READ ME FIRST.txt'));
const dmg=join(output,`AIConnect-macOS-${arch}.dmg`);
run('/usr/bin/hdiutil',['create','-volname','AIConnect','-srcfolder',stage,'-ov','-format','UDZO',dmg]);
if(process.env.AICONNECT_NOTARY_PROFILE){if(identity==='-')throw Error('Notarization requires Developer ID signing');run('/usr/bin/xcrun',['notarytool','submit',dmg,'--keychain-profile',process.env.AICONNECT_NOTARY_PROFILE,'--wait']);run('/usr/bin/xcrun',['stapler','staple',dmg]);}
writeFileSync(dmg+'.sha256',createHash('sha256').update(readFileSync(dmg)).digest('hex')+'  '+dmg.split('/').pop()+'\n');
console.log(`\nReady: ${dmg}\n${identity==='-'?'Development build: not notarized. macOS may block first launch.':'Signed build: check notarization result before distribution.'}`);
