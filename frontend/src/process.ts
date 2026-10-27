import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export function command(executable: string, args: string[], cwd: string, options: {
  input?: string; signal?: AbortSignal; timeout?: number; maxBytes?: number; onEvent?:(event:unknown)=>void;
} = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    if(options.signal?.aborted){reject(new Error('Command cancelled'));return}
    const child = spawn(executable, args, {cwd, shell: false, windowsHide: true,
      stdio: ['pipe','pipe','pipe'], detached:process.platform!=='win32'});
    let output = ''; let errors = ''; let bytes = 0; let failure: Error | undefined;
    const decoder=new StringDecoder('utf8');let pending='';
    const line=(value:string)=>{let event;try{event=JSON.parse(value)}catch{return}options.onEvent?.(event)};
    let forceTimer:ReturnType<typeof setTimeout>|undefined;
    const terminate=()=>{
      if(!child.pid)return;
      if(process.platform==='win32') {
        const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',shell:false});
        killer.on('error',()=>child.kill());
      } else {
        try{process.kill(-child.pid,'SIGTERM')}catch{child.kill()}
        forceTimer=setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL')}catch{}},1000);
        forceTimer.unref();
      }
    };
    const abort=()=>{failure=new Error('Command cancelled');terminate()};
    options.signal?.addEventListener('abort',abort,{once:true});
    const cleanup=()=>{clearTimeout(timeout);if(forceTimer)clearTimeout(forceTimer);options.signal?.removeEventListener('abort',abort)};
    const timeout = setTimeout(() => { failure = new Error('Command timed out'); terminate(); }, options.timeout || 120_000);
    const collect = (data: Buffer, stderr: boolean) => {
      bytes += data.length;
      if (bytes > (options.maxBytes || 2_000_000)) { if(!failure){failure = new Error('Command output exceeded limit');terminate()} return; }
      if (stderr) errors += data.toString(); else {const text=decoder.write(data);output+=text;if(options.onEvent){pending+=text;let end;while((end=pending.indexOf('\n'))>=0){line(pending.slice(0,end));pending=pending.slice(end+1);}}}
    };
    child.stdout.on('data', d => collect(d,false)); child.stderr.on('data',d=>collect(d,true));
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', code => { cleanup();const tail=decoder.end();output+=tail;if(options.onEvent&&pending+tail)line(pending+tail); if (failure || code !== 0) reject(failure || new Error(`${executable} failed (${code}): ${errors.slice(-1500)}`)); else resolve(output.trim()); });
    child.stdin.on('error', () => {});
    child.stdin.end(options.input || '');
  });
}
