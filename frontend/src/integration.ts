import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { dataDir } from './store.ts';
import { command } from './process.ts';

export const mcpPath=fileURLToPath(new URL('./mcp.ts',import.meta.url));
// First-time macOS Keychain approval needs human time, not a normal CLI timeout.
export const integrationTimeoutMs=5*60_000;
export function registrationArgs(name='aiconnect',profile=dataDir()) {
  if(!/^[a-zA-Z0-9_-]+$/.test(name))throw new Error('Server name must use letters, numbers, underscores or hyphens');
  return ['mcp','add',name,'--env',`RN_HOME=${profile}`,'--env',`RN_PORT=${process.env.RN_PORT||4319}`,
    '--env',`PATH=${process.env.PATH||''}`,...(process.env.RN_CODEX_BIN?['--env',`RN_CODEX_BIN=${process.env.RN_CODEX_BIN}`]:[]),
    '--',process.execPath,mcpPath];
}
export class CodexIntegration {
  busy=false;
  profile:string;run:typeof command;
  constructor(profile=dataDir(),run=command){this.profile=profile;this.run=run;}
  private async invoke(args:string[]) {
    try {return await this.run(codexBinary(),args,process.cwd(),{timeout:integrationTimeoutMs});}
    catch(error) {
      if(error instanceof Error&&error.message==='Command timed out')throw new Error('Codex integration timed out after 5 minutes. Respond to any macOS Keychain prompt, then check integration again before retrying repair.');
      throw error;
    }
  }
  private async entry(){
    const entries=JSON.parse(await this.invoke(['mcp','list','--json']));
    if(!Array.isArray(entries))throw new Error('Unexpected Codex MCP catalog');
    return entries.find((e:any)=>e.name==='aiconnect');
  }
  private describe(entry:any) {
    const t=entry?.transport;
    const matches=!!entry&&t?.command===process.execPath&&JSON.stringify(t?.args)===JSON.stringify([mcpPath])&&t?.env?.RN_HOME===this.profile&&t?.env?.RN_PORT===(process.env.RN_PORT||'4319');
    // Do not replace another tool or switch the user's membership/profile.
    const repairable=!entry||matches||(t?.env?.RN_HOME===this.profile&&t?.args?.length===1&&/[\\/]src[\\/]mcp\.ts$/.test(t.args[0]));
    return {registered:!!entry,matches,enabled:entry?.enabled!==false,repairable,
      fingerprint:createHash('sha256').update(JSON.stringify(entry??null)).digest('hex'),
      current_path:t?.args?.[0]||null,expected_path:mcpPath,profile:resolve(this.profile),
      next:'Restart the AIConnect MCP server or reopen Codex desktop, then use a new chat. Codex account login is separate.'};
  }
  async status(){return this.describe(await this.entry());}
  async register(args:{confirmed?:boolean;fingerprint?:string}) {
    if(this.busy)throw new Error('Codex registration is already being updated');
    this.busy=true;
    try {
      const before=await this.status();
      if(args.confirmed!==true||args.fingerprint!==before.fingerprint)throw new Error('Review the current registration and confirm again; settings may have changed.');
      if(!before.repairable)throw new Error('Existing aiconnect entry belongs to another profile or tool. No settings changed; inspect it in Codex settings.');
      if(!before.enabled)throw new Error('AIConnect is disabled in Codex. Enable it in Codex settings first.');
      // codex mcp add updates only the named entry; never remove first.
      if(!before.matches)await this.invoke(registrationArgs('aiconnect',this.profile));
      const after=await this.status();if(!after.matches)throw new Error('Registration could not be verified. Inspect Codex MCP settings.');
      return after;
    }finally{this.busy=false;}
  }
}
import { codexBinary } from './codex-binary.ts';
