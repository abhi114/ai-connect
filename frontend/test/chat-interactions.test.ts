import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publicActivity,recordActivity } from '../src/activity.ts';
import { command } from '../src/process.ts';
import { Store } from '../src/store.ts';
import { identify,git,makeWorktree } from '../src/git.ts';
import { workspaceReview,revealWorkspace } from '../src/workspace-review.ts';
import { html,js } from '../src/dashboard.ts';

test('activity allows only public event shapes, excludes reasoning and raw command payloads',()=>{
 assert.equal(publicActivity({type:'item.completed',item:{id:'r',type:'reasoning',text:'private'}}),undefined);
 assert.equal(publicActivity({type:'item.completed',item:{id:'a',type:'agent_message',text:'{"answer":"final"}'}}),undefined);
 const event=publicActivity({type:'item.completed',item:{id:'c',type:'command_execution',command:'cat .env',aggregated_output:'secret',exit_code:2}})!;
 assert.deepEqual(event,{id:'c',kind:'command',text:'Workspace command · exit 2',state:'failed'});
 const note=publicActivity({type:'item.completed',item:{id:'n',type:'agent_message',channel:'commentary',text:'API_KEY=secret Bearer abc'}})!;
 assert.ok(!note.text.includes('secret'));assert.ok(!note.text.includes('abc'));
});
test('activity replaces running items, caps size and survives persistence',async()=>{
 const store=new Store(await mkdtemp(join(tmpdir(),'ai-activity-'))),run=store.state.runs.x={request_id:'x',repo_id:'r',state:'running'};
 const emit=recordActivity(store,run);emit({type:'item.started',item:{id:'a',type:'command_execution'}});emit({type:'item.completed',item:{id:'a',type:'command_execution',exit_code:0}});
 for(let i=0;i<120;i++)emit({type:'item.completed',item:{id:'c'+i,type:'file_change',changes:[]}});
 const saved=new Store(store.dir).state.runs.x;assert.equal(saved.activity?.length,100);assert.equal(saved.activity?.[0].state,'complete');assert.equal(saved.activity_truncated,true);
});
test('command emits JSON events before completion and preserves UTF-8 split chunks',async()=>{
 const events:any[]=[];const output=await command(process.execPath,['-e',`const b=Buffer.from(JSON.stringify({type:'note',text:'café'})+'\\n');process.stdout.write(b.subarray(0,b.length-4));setTimeout(()=>process.stdout.write(b.subarray(b.length-4)),20);setTimeout(()=>process.stdout.write(JSON.stringify({type:'done'})),40);`],tmpdir(),{onEvent:e=>events.push(e)});
 assert.equal(events[0].text,'café');assert.equal(events[1].type,'done');assert.ok(output.includes('café'));
});
test('workspace file review is local, scoped, non-executing and survives review commit',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ai-review-')),repo=join(dir,'repo');await mkdir(repo);await writeFile(join(repo,'hello.txt'),'before\n');
 await git(repo,'init');await git(repo,'add','.');await git(repo,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','base');
 const store=new Store(join(dir,'profile'));store.state.bindings.r={repo_id:'r',...await identify(repo),name:'repo',questions:'ask',changes:true,paused:false,allowed_paths:['.'],max_diff_bytes:200000};
 const tree=await makeWorktree(store.state.bindings.r,store.dir,'test',true);store.state.runs.x={request_id:'x',repo_id:'r',state:'awaiting_review',...tree};
 await writeFile(join(tree.worktree,'hello.txt'),'after\n');await writeFile(join(tree.worktree,'.env'),'SECRET=hidden');
 const view=await workspaceReview(store,'x');assert.deepEqual(view.files,['hello.txt']);assert.match(view.diff,/\+after/);assert.ok(!view.diff.includes('hidden'));
 await assert.rejects(workspaceReview(store,'x','../repo/hello.txt'));await assert.rejects(workspaceReview(store,'x','.env'));
 const launches:any[]=[];await revealWorkspace(store,'x','hello.txt',async(...args:any[])=>{launches.push(args);return ''});assert.equal(launches.length,1);assert.ok(!launches[0][1].includes(join(tree.worktree,'hello.txt')));
 await symlink(repo,join(tree.worktree,'outside'));await assert.rejects(revealWorkspace(store,'x','outside',async()=>{throw Error('must not launch')}),/Symlink/);
 await git(tree.worktree,'add','hello.txt');await git(tree.worktree,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','change');assert.match((await workspaceReview(store,'x','hello.txt')).diff,/\+after/);
 await assert.rejects(workspaceReview(store,'remote-only'),/owner computer/);
});
test('chat UI uses real activity, reviewable draft CTAs and exact recipient selection',()=>{
 new Function(js);assert.match(js,/activityPanel/);assert.match(js,/openWorkspace/);assert.match(js,/workspace_reveal/);assert.match(html,/delegate-search/);assert.match(js,/Multiple matches: choose/);assert.match(js,/Replace the unsent draft/);assert.doesNotMatch(js,/innerHTML\s*=/);
});
