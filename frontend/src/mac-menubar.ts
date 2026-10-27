import { mkdirSync,writeFileSync } from 'node:fs';
import { join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command } from './process.ts';
import { dataDir } from './store.ts';
import { createHash } from 'node:crypto';

export async function installMenubar(launch=true){
  if(process.platform!=='darwin')throw Error('The menu-bar helper currently supports macOS only');
  const dir=dataDir(),app=join(dir,'AIConnect Menu.app'),contents=join(app,'Contents'),bin=join(contents,'MacOS');
  mkdirSync(bin,{recursive:true,mode:0o700});
  const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  writeFileSync(join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.aiconnect.menubar.p${createHash('sha256').update(dir).digest('hex').slice(0,12)}</string><key>CFBundleName</key><string>AIConnect</string><key>CFBundleExecutable</key><string>AIConnectMenu</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>LSUIElement</key><true/><key>AIConnectProfile</key><string>${escape(dir)}</string></dict></plist>`,{mode:0o600});
  const source=join(dirname(fileURLToPath(import.meta.url)),'../native/macos/main.swift');
  await command('/usr/bin/xcrun',['swiftc','-swift-version','5',source,'-o',join(bin,'AIConnectMenu'),'-framework','Cocoa','-framework','UserNotifications'],dir);
  await command('/usr/bin/codesign',['--force','--sign','-',app],dir);
  if(launch)await command('/usr/bin/open',[app],dir);
  return {app,launched:launch,note:'Use Enable notifications in the AIConnect menu. Add this app to Login Items manually if wanted. Quit the helper before rebuilding.'};
}
