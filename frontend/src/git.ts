import { realpath, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { command } from './process.ts';
import type { Binding } from './store.ts';

export const git = (cwd: string, ...args: string[]) => command('git', ['-c','core.hooksPath='+ (process.platform === 'win32' ? 'NUL' : '/dev/null'), ...args], cwd);
export async function identify(path: string) {
  const canonical = await realpath(resolve(path));
  const top = await realpath(await git(canonical,'rev-parse','--show-toplevel'));
  const git_dir = await realpath(await git(top,'rev-parse','--path-format=absolute','--git-common-dir'));
  await git(top,'rev-parse','--verify','HEAD^{commit}');
  return {path: top, git_dir};
}
export async function verifyBinding(binding: Binding) {
  const identity = await identify(binding.path);
  if (identity.path !== binding.path || identity.git_dir !== binding.git_dir) throw new Error('repo_unavailable: local repository identity changed');
}
export function approvedPath(path: string, allowed: string[]) {
  const normalized = path.replaceAll('\\','/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..') || /^[A-Za-z]:/.test(normalized)) return false;
  if (normalized.split('/').some(p => p === '.git' || p === '.aws' || p === '.ssh' || p === '.codex' || p === '.env' || p.startsWith('.env.') || /\.(pem|key)$/i.test(p))) return false;
  return allowed.some(prefix => prefix === '.' || normalized === prefix || normalized.startsWith(prefix.replace(/\/$/,'')+'/'));
}
export async function makeWorktree(binding: Binding, dir: string, requestId: string, change: boolean) {
  await verifyBinding(binding);
  const base_commit = await git(binding.path,'rev-parse','HEAD');
  if (!/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(base_commit)) throw new Error('Invalid Git object id');
  const safeId = requestId.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,60);
  const branch = `network/${safeId}`; const worktree = join(dir,'worktrees',safeId);
  await mkdir(join(dir,'worktrees'),{recursive:true});
  await git(binding.path,'worktree','add',...(change ? ['-b',branch] : ['--detach']),worktree,base_commit);
  return {base_commit,branch,worktree};
}
export async function inspectDiff(binding: Binding, worktree: string, base: string) {
  const tracked = (await git(worktree,'diff','--name-only','-z',base)).split('\0').filter(Boolean);
  const untracked = (await git(worktree,'ls-files','--others','--exclude-standard','-z')).split('\0').filter(Boolean);
  const paths = [...new Set([...tracked,...untracked])];
  if (!paths.length) throw new Error('Codex produced no changes');
  if (paths.some(p=>!approvedPath(p,binding.allowed_paths))) throw new Error('Changed paths exceed local approved scope or include protected files; review worktree');
  // Stage only after path checks. Git stores symlinks as symlinks and never follows them here.
  await git(worktree,'add','--',...paths);
  const patch = await git(worktree,'diff','--cached','--binary',base);
  if (Buffer.byteLength(patch) > binding.max_diff_bytes) throw new Error('Diff exceeds local size policy; review worktree');
  return {paths, summary: await git(worktree,'diff','--cached','--stat',base)};
}
