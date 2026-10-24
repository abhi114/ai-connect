import { createHash } from 'node:crypto';
import type { RepoRequest, Repo, Member } from '../../shared/protocol.ts';
import type { Binding, State } from './store.ts';
import type { ExecutionOptions } from './models.ts';

export function approvalDigest(request: RepoRequest, execution:ExecutionOptions={}) {
  const fields:unknown[]=[request.id,request.repo_id,request.sender_member_id,request.owner_member_id,request.kind,request.title,request.body,request.constraints,request.base_ref];
  // Preserve old default approvals while binding explicit selections to consent.
  if(execution.model||execution.reasoning_effort)fields.push([execution.model,execution.reasoning_effort]);
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}
export function authorize(state: State, request: RepoRequest): Binding {
  const binding=state.bindings[request.repo_id];
  const repo=state.repos.find((r:Repo)=>r.id===request.repo_id);
  const sender=state.members.find((m:Member)=>m.id===request.sender_member_id);
  if (!state.member || request.owner_member_id!==state.member.id || request.network_id!==state.member.network_id) throw new Error('Wrong owner/network');
  if (!sender || sender.revoked_at || sender.network_id!==request.network_id) throw new Error('Sender is not an active network member');
  if (!repo || repo.owner_member_id!==state.member.id || repo.network_id!==request.network_id || repo.revoked_at || repo.availability!=='active') throw new Error('Repo is not actively exposed');
  if (!binding || binding.paused) throw new Error('Local repo binding is unavailable or paused');
  if (!['queued','claimed','running'].includes(request.status)) throw new Error('Request is not executable');
  if (request.kind==='change' && (!binding.changes || !repo.changes_enabled)) throw new Error('Changes disabled');
  if (request.kind==='question' && (binding.questions==='off' || !repo.questions_enabled)) throw new Error('Questions disabled');
  if ((request.kind==='change' || binding.questions==='ask' || repo.questions_require_approval) && state.approvals[request.id]!==approvalDigest(request,state.execution_options?.[request.id])) throw new Error('Exact request has not been approved locally');
  return binding;
}
