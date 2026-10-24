import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ExecutionOptions } from './models.ts';
import type { Pin } from './trust.ts';
import type { SignedEnvelope } from '../../shared/signing.ts';

export interface Binding {
  repo_id: string; path: string; git_dir: string; name: string;
  questions: 'auto' | 'ask' | 'off'; changes: boolean; paused: boolean;
  allowed_paths: string[]; max_diff_bytes: number;
}
export interface Run {
  result_signature?: SignedEnvelope;
  execution?: ExecutionOptions;
  request_id: string; repo_id: string; state: string; lease_token?: string;
  worktree?: string; branch?: string; base_commit?: string; answer?: string;
  sources?: { path: string; line?: number }[]; diff_summary?: string;
  error?: string; result?: unknown; delivery_key?: string;
}
export interface State {
  signing?: {public_key:string;private_key:string};
  trust?: Record<string,Pin>;
  message_receipts?: Record<string,string>;
  pending_enrollment?: {server:string;body:any};
  execution_options?: Record<string, ExecutionOptions>;
  server: string; token?: string; member?: any; device?: any; network?: any;
  session_token: string; cursor: number; bindings: Record<string, Binding>;
  approvals: Record<string, string>; runs: Record<string, Run>;
  outbox: { id: string; method: string; path: string; body: any }[];
  requests: any[]; members: any[]; repos: any[]; connection_error?: string;
}
export const dataDir = () => resolve(process.env.RN_HOME || join(homedir(), '.repo-network'));
export const socketPath = (dir = dataDir()) => process.platform === 'win32'
  ? `\\\\.\\pipe\\repo-network-${createHash('sha256').update(dir).digest('hex').slice(0,20)}`
  : join(dir, 'daemon.sock');
export class Store {
  dir: string; file: string; state: State;
  constructor(dir = dataDir()) {
    this.dir = dir; this.file = join(dir, 'state.json');
    mkdirSync(dir, {recursive: true, mode: 0o700});
    this.state = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {
      server: process.env.RN_SERVER || 'http://127.0.0.1:8787', session_token: randomUUID(), cursor: 0,
      bindings: {}, approvals: {}, runs: {}, outbox: [], requests: [], members: [], repos: []
    };
    this.save();
  }
  save() {
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state, null, 2), {mode: 0o600});
    renameSync(temp, this.file);
    if (process.platform !== 'win32') chmodSync(this.file, 0o600);
  }
}
export function readLocalState(dir = dataDir()): State {
  try { return JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')); }
  catch { throw new Error('Companion is not configured. Run: npm run cli -- service run'); }
}
