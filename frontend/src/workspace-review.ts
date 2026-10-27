import { realpath,lstat } from 'node:fs/promises';
import { resolve,relative,isAbsolute,dirname } from 'node:path';
import { git,identify,verifyBinding,approvedPath } from './git.ts';
import { command } from './process.ts';
import type { Store } from './store.ts';

const inside=(root:string,path:string)=>{const p=relative(root,path);return p===''||(!p.startsWith('..')&&!isAbsolute(p));};
export async function runWorkspace(store:Store,id:string){
  const run=store.state.runs[id],binding=run&&store.state.bindings[run.repo_id];
  if(!run?.worktree||!binding||!run.base_commit)throw Error('No local workspace for this request. Files remain on the owner computer.');
  await verifyBinding(binding);
  const root=await realpath(run.worktree),managed=await realpath(resolve(store.dir,'worktrees'));
  if(!inside(managed,root)||(await identify(root)).git_dir!==binding.git_dir)throw Error('Worktree identity changed');
  if(!/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(run.base_commit))throw Error('Invalid recorded base');
  return {run,binding,root};
}
async function filesAt(root:string,base:string,allowed:string[]){
  const tracked=(await git(root,'diff','--no-ext-diff','--no-textconv','--name-only','-z',base,'--')).split('\0').filter(Boolean);
  const untracked=(await git(root,'ls-files','--others','--exclude-standard','-z')).split('\0').filter(Boolean);
  return [...new Set([...tracked,...untracked])].filter(p=>approvedPath(p,allowed));
}
export async function workspaceReview(store:Store,id:string,path?:string){
  const {run,binding,root}=await runWorkspace(store,id);
  const paths=await filesAt(root,run.base_commit!,binding.allowed_paths);
  if(path!==undefined&&(!approvedPath(path,binding.allowed_paths)||!paths.includes(path)))throw Error('Choose a changed file from this worktree');
  const selected=path===undefined?paths:[path];
  let diff='';
  for(const p of selected.slice(0,200)){
    const patch=await git(root,'--literal-pathspecs','diff','--no-ext-diff','--no-textconv',run.base_commit!,'--',p);
    diff+=patch||`${p}: untracked file (content not previewed until staged for review).\n`;
    if(Buffer.byteLength(diff)>200000){diff=diff.slice(0,100000)+'\n[Preview truncated. Inspect locally.]';break;}
  }
  return {branch:run.branch,worktree:root,base_commit:run.base_commit,files:paths.slice(0,200),file_count:paths.length,truncated:paths.length>200,diff:diff||'No changes against this turn’s base.',scope:'Current worktree compared with this turn’s base; later turns may also be included.'};
}
// Never execute a changed file or open arbitrary model-supplied URLs. File actions
// reveal its parent folder; paths must still be changed, scoped and non-symlinked.
export async function revealWorkspace(store:Store,id:string,path?:string,launch=command){
  const {run,binding,root}=await runWorkspace(store,id);let target=root;
  if(path!==undefined){if(!approvedPath(path,binding.allowed_paths)||!(await filesAt(root,run.base_commit!,binding.allowed_paths)).includes(path))throw Error('File is not in this change');
    let cursor=root;for(const part of path.split(/[\\/]/)){cursor=resolve(cursor,part);try{if((await lstat(cursor)).isSymbolicLink())throw Error('Symlink reveal is not allowed');}catch(e:any){if(e.code!=='ENOENT')throw e;}}
    target=await realpath(dirname(resolve(root,path)));if(!inside(root,target))throw Error('Path is outside worktree');
  }
  if(process.platform==='darwin')await launch('/usr/bin/open',[target],root);
  else if(process.platform==='win32')await launch('explorer.exe',[target],root);
  else throw Error('Folder reveal is supported on macOS and Windows. Use the displayed worktree path.');
  return {opened:true};
}
