/** Wire protocol v1. Runtime: Node >=24; snake_case fields over HTTP. */
export type RequestKind = 'question' | 'change';
export type RequestStatus = 'approval_pending' | 'queued' | 'claimed' | 'running' | 'answered' | 'review_ready' | 'accepted' | 'closed' | 'rejected' | 'cancelled' | 'failed';
export interface Network { id: string; name: string; created_at: number }
/** Deliberately network-visible human chat; private request/result records remain participant-only. */
export interface NetworkMessage { id: number; network_id: string; sender_member_id: string; body: string; created_at: number }
export interface NetworkMessagePage { messages: NetworkMessage[]; next_before: number|null }
export interface Member { id: string; network_id: string; handle: string; display_name: string; role: 'admin'|'member'; revoked_at: number|null; online?: boolean }
export interface Device { id: string; member_id: string; public_label: string; last_seen_at: number; revoked_at: number|null }
export interface Identity { token: string; member: Member; device: Device; network: Network }
export interface Repo { id: string; network_id: string; owner_member_id: string; slug: string; description: string; tags: string[]; questions_enabled: boolean; changes_enabled: boolean; questions_require_approval: boolean; availability: 'active'|'paused'; revoked_at: number|null }
export interface RepoRequest { id: string; network_id: string; repo_id: string; sender_member_id: string; owner_member_id: string; kind: RequestKind; status: RequestStatus; title: string; body: string; base_ref: string|null; constraints: string[]; created_at: number; updated_at: number; version: number }
export interface SourceReference { path: string; line?: number; end_line?: number }
export interface QuestionResult { kind: 'question_result'; answer: string; base_commit: string; sources: SourceReference[] }
export interface ChangeResult { kind: 'change_result'; base_commit: string; commit: string; branch: string; delivery: 'local_branch'|'pushed_branch'; diff_summary: string; summary?: string; tests: {name: string; status: 'passed'|'failed'|'skipped'}[]; owner_review_required: true; remote_verified?: boolean }
export type Result = QuestionResult | ChangeResult;
export interface NetworkEvent { id: number; network_id: string; request_id: string|null; actor_member_id: string; type: string; payload: Record<string, unknown>; created_at: number }
export interface Lease { lease_token: string; expires_at: number; attempt: number; request: RepoRequest }
export interface ErrorEnvelope { error: { code: string; message: string } }
export const API_VERSION = 'v1';
export const TERMINAL_STATUSES: RequestStatus[] = ['answered','accepted','closed','rejected','cancelled','failed'];
export const WORKER_DONE_STATUSES: RequestStatus[] = [...TERMINAL_STATUSES, 'review_ready'];
export const HANDLE_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;
export const GIT_OID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
export const MAX_BODY_BYTES = 32768;
