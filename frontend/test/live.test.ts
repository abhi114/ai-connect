import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, identify, makeWorktree } from '../src/git.ts';
import { runCodex } from '../src/codex.ts';
import type { Binding } from '../src/store.ts';
import type { RepoRequest } from '../../shared/protocol.ts';

test('live Codex reads and edits isolated toy worktrees', {skip:process.env.RN_LIVE_CODEX!=='1',timeout:240000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'aiconnect-live-'));
  await git(dir,'init');await writeFile(join(dir,'hello.txt'),'hello from AIConnect\n');
  await git(dir,'add','.');await git(dir,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','initial');
  const binding={...await identify(dir)} as Binding;
  const question=await makeWorktree(binding,join(dir,'tasks'),'question',false);
  const answer=await runCodex({kind:'question',title:'Read greeting',body:'Read hello.txt. What exact greeting does it contain? Cite hello.txt line 1.'} as RepoRequest,question.worktree,AbortSignal.timeout(110000));
  assert.match(answer.answer,/hello from AIConnect/);
  const change=await makeWorktree(binding,join(dir,'tasks'),'change',true);
  await runCodex({kind:'change',title:'Update greeting',body:'Replace hello.txt contents with exactly hello from connected agents followed by a newline. Edit only this file. No tests are needed for this text fixture.'} as RepoRequest,change.worktree,AbortSignal.timeout(110000));
  assert.equal(await readFile(join(change.worktree,'hello.txt'),'utf8'),'hello from connected agents\n');
  assert.equal(await readFile(join(dir,'hello.txt'),'utf8'),'hello from AIConnect\n');
  console.log('Live worktrees retained for inspection:',dir);
});
