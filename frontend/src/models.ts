import { spawn } from 'node:child_process';

export interface ExecutionOptions { model?: string; reasoning_effort?: string }
export interface ModelChoice { model:string; name:string; efforts:string[]; defaultEffort?:string; isDefault:boolean }
export interface ModelCatalog { models:ModelChoice[]; fetched_at:number }

// Read-only app-server session: never creates a thread or starts an inference.
export async function discoverModels(cwd:string, executable=codexBinary(), prefixArgs:string[]=[]):Promise<ModelCatalog> {
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,[...prefixArgs,'app-server','--listen','stdio://','-c','model_provider="openai"'],{cwd,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let done=false,buffer='',bytes=0,id=1,pages=0;
    const models:ModelChoice[]=[];const cursors=new Set<string>();
    const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);child.stdin.end();child.kill();if(error)reject(error);else resolve({models,fetched_at:Date.now()});};
    const timer=setTimeout(()=>finish(new Error('Codex model discovery timed out. Check CLI sign-in and retry.')),15000);
    const send=(value:unknown)=>child.stdin.write(JSON.stringify(value)+'\n');
    child.on('error',()=>finish(new Error('Cannot launch Codex for model discovery. Check RN_CODEX_BIN and CLI installation.')));
    child.on('exit',()=>{if(!done)finish(new Error('Codex exited before returning its model catalog.'))});
    child.stdin.on('error',()=>finish(new Error('Codex model discovery connection closed.')));
    child.stderr.on('data',()=>{}); // Never forward CLI diagnostics that could contain account details.
    child.stdout.on('data',chunk=>{
      bytes+=chunk.length;if(bytes>2_000_000){finish(new Error('Codex model catalog exceeded size limit'));return}
      buffer+=chunk.toString();let end;
      while(!done&&(end=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let message:any;
        try{message=JSON.parse(line)}catch{finish(new Error('Invalid Codex app-server response'));return}
        if(message.id!==id)continue;
        if(message.error){finish(new Error('Codex model discovery failed. Check CLI version and sign-in, then refresh.'));return}
        if(id===1){send({method:'initialized'});id++;send({id,method:'model/list',params:{limit:100,includeHidden:false}});continue}
        if(!Array.isArray(message.result?.data)){finish(new Error('Codex returned an unsupported model catalog'));return}
        for(const entry of message.result.data){
          if(entry.hidden||typeof entry.model!=='string'||!entry.model||models.some(m=>m.model===entry.model))continue;
          const efforts=(entry.supportedReasoningEfforts||[]).map((e:any)=>e.reasoningEffort).filter((e:any)=>typeof e==='string'&&/^[a-z]+$/.test(e));
          models.push({model:entry.model,name:entry.displayName||entry.model,efforts,defaultEffort:entry.defaultReasoningEffort,isDefault:entry.isDefault===true});
        }
        const cursor=message.result.nextCursor;
        if(cursor){if(typeof cursor!=='string'||cursors.has(cursor)||++pages>20){finish(new Error('Invalid Codex model pagination'));return}cursors.add(cursor);id++;send({id,method:'model/list',params:{limit:100,includeHidden:false,cursor}})}else finish();
      }
    });
    send({id,method:'initialize',params:{clientInfo:{name:'aiconnect',title:'AIConnect',version:'0.1.0'}}});
  });
}

export function validateExecution(value:unknown, catalog?:ModelCatalog):ExecutionOptions {
  if(value===undefined)return {};
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid execution settings');
  const v=value as Record<string,unknown>;
  if(Object.keys(v).some(k=>!['model','reasoning_effort'].includes(k)))throw new Error('Unknown execution setting');
  if(v.model!==undefined&&(typeof v.model!=='string'||!v.model))throw new Error('Invalid model');
  if(v.reasoning_effort!==undefined&&(typeof v.reasoning_effort!=='string'||!v.reasoning_effort))throw new Error('Invalid reasoning effort');
  if(!v.model){if(v.reasoning_effort)throw new Error('Select a model before choosing reasoning effort');return {}}
  const model=catalog?.models.find(m=>m.model===v.model);
  if(!model)throw new Error('Selected model is not in the current Codex catalog. Refresh models and choose again.');
  if(v.reasoning_effort&&!model.efforts.includes(v.reasoning_effort as string))throw new Error('Reasoning effort is not supported by this model');
  return {model:model.model,...(v.reasoning_effort?{reasoning_effort:v.reasoning_effort as string}:{})};
}

export function executionArgs(options:ExecutionOptions={}) {
  return [...(options.model?['--model',options.model]:[]),...(options.reasoning_effort?['-c',`model_reasoning_effort=${JSON.stringify(options.reasoning_effort)}`]:[])];
}
import { codexBinary } from './codex-binary.ts';
