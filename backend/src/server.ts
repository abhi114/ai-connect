import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Socket } from 'node:net';
import { openDatabase } from './db.ts';
import { validKey, registration, verifyData, verifyEnvelope, requestPayload, resultPayload } from '../../shared/signing.ts';
import { HANDLE_PATTERN, GIT_OID_PATTERN, MAX_BODY_BYTES, WORKER_DONE_STATUSES } from '../../shared/protocol.ts';
import type { Member, Repo, RepoRequest, NetworkEvent, NetworkMessage, Result, RequestStatus } from '../../shared/protocol.ts';

type Row = Record<string, any>;
type Auth = { member: Member; device: Row };
type Reply = { status?: number; body: any };
export interface ServerOptions { databasePath?: string; now?: () => number; leaseMs?: number; credentialTtlMs?: number; rateLimit?: number; unauthenticatedRateLimit?: number }
class ApiError extends Error {
  code: string; status: number; retryAfter?: number;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
function fail(status: number, code: string, message: string): never { throw new ApiError(status, code, message); }
const id = (prefix: string) => `${prefix}_${randomBytes(12).toString('hex')}`;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function str(body: Row, field: string, max = 1000, optional = false): string {
  const value = body[field];
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, 'invalid_input', `${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function strings(value: unknown, field: string, max = 20): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max || value.some(x => typeof x !== 'string' || !x.trim() || x.length > 2000)) fail(400, 'invalid_input', `Invalid ${field}`);
  return value;
}
function bool(body: Row, field: string, fallback: boolean): boolean {
  if (body[field] === undefined) return fallback;
  if (typeof body[field] !== 'boolean') fail(400, 'invalid_input', `${field} must be boolean`);
  return body[field];
}
function allowed(body: Row, names: string[]) {
  const extra = Object.keys(body).filter(k => k !== 'idempotency_key' && !names.includes(k));
  if (extra.length) fail(400, 'unknown_fields', `Unsupported fields: ${extra.join(', ')}`);
}
function safeRef(value: string) {
  if (value.startsWith('-') || /[\s~^:?*\[\\\x00-\x1f]/.test(value) || value.includes('..') || value.includes('@{') || value.endsWith('/') || value.endsWith('.')) fail(400, 'invalid_ref', 'Invalid Git ref');
}
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function createApp(options: ServerOptions = {}) {
  const db = openDatabase(options.databasePath ?? ':memory:');
  const now = options.now ?? Date.now;
  const leaseMs = options.leaseMs ?? 120_000;
  const ttl = options.credentialTtlMs ?? 30 * 86400_000;
  const one = (sql: string, ...args: SQLInputValue[]): Row | undefined => db.prepare(sql).get(...args) as Row | undefined;
  const all = (sql: string, ...args: SQLInputValue[]): Row[] => db.prepare(sql).all(...args) as Row[];
  const run = (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).run(...args);
  // Idempotent enrollment/claim replies contain secrets, so response blobs are encrypted.
  // Production operators should protect the database and backups as credential-bearing data.
  let keyHex = one('SELECT value FROM settings WHERE key=?', 'response_key')?.value;
  if (!keyHex) { keyHex = randomBytes(32).toString('hex'); run('INSERT INTO settings VALUES (?,?)', 'response_key', keyHex); }
  const key = Buffer.from(keyHex, 'hex');
  function encrypt(value: any): string {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
    const content = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), content]).toString('base64');
  }
  function decrypt(value: string): any {
    const bytes = Buffer.from(value, 'base64'); const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28)); return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString());
  }
  function transaction<T>(fn: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function event(network: string, actor: string, type: string, payload: Row, request: string|null = null) {
    run('INSERT INTO events(network_id,request_id,actor_member_id,type,payload,created_at) VALUES (?,?,?,?,?,?)', network, request, actor, type, JSON.stringify(payload), now());
  }
  function authenticate(req: IncomingMessage): Auth {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ') || header.length > 300) fail(401, 'unauthorized', 'Bearer device credential required');
    const device = one('SELECT * FROM devices WHERE credential_hash=? AND revoked_at IS NULL AND expires_at>?', hash(header.slice(7)), now());
    if (!device) fail(401, 'unauthorized', 'Device credential invalid, expired, or revoked');
    const member = one('SELECT * FROM members WHERE id=? AND revoked_at IS NULL', device.member_id) as Member|undefined;
    if (!member) fail(401, 'unauthorized', 'Membership revoked');
    return { member, device };
  }
  function publicDevice(device: Row) { const { credential_hash, expires_at, ...safe } = device; return safe; }
  function enroll(member: Member, label: string) {
    const token = randomBytes(32).toString('base64url'); const deviceId = id('dev');
    run('INSERT INTO devices VALUES (?,?,?,?,?,?,NULL)', deviceId, member.id, label, hash(token), now() + ttl, now());
    return { token, member, device: publicDevice(one('SELECT * FROM devices WHERE id=?', deviceId)!), network: one('SELECT * FROM networks WHERE id=?', member.network_id) };
  }
  function signed(auth:Auth, envelope:any, kind:string, payload:any, recordId:string) {
    const registered=one('SELECT public_key FROM device_keys WHERE device_id=?',auth.device.id);
    // Older clients can retain readable history during rolling upgrades. Once a
    // device registers a key it can never downgrade its writes to unsigned.
    if(!envelope&&!registered)return;
    if(!envelope||envelope.kind!==kind||envelope.network_id!==auth.member.network_id||envelope.member_id!==auth.member.id||envelope.device_id!==auth.device.id||envelope.public_key!==registered?.public_key||!verifyEnvelope(envelope,payload))fail(400,'invalid_signature','A valid registered device signature is required');
    if(one('SELECT signature_id FROM signed_records WHERE network_id=? AND signature_id=?',auth.member.network_id,envelope.id))fail(409,'signature_replay','Signed message already submitted; retry using its original idempotency key');
    run('INSERT INTO signed_records VALUES (?,?,?,?,?)',auth.member.network_id,envelope.id,kind,recordId,JSON.stringify(envelope));
  }
  function proof(network:string,kind:string,record:string){const row=one('SELECT envelope FROM signed_records WHERE network_id=? AND kind=? AND record_id=?',network,kind,record);return row?JSON.parse(row.envelope):undefined;}
  function repoById(repoId: string, auth: Auth): Repo {
    const row = one('SELECT payload FROM repos WHERE id=? AND network_id=?', repoId, auth.member.network_id);
    if (!row) fail(404, 'not_found', 'Repository not found');
    return JSON.parse(row.payload);
  }
  function requestById(requestId: string, auth: Auth): RepoRequest {
    const row = one('SELECT payload FROM requests WHERE id=? AND network_id=? AND (sender_member_id=? OR owner_member_id=?)', requestId, auth.member.network_id, auth.member.id, auth.member.id);
    if (!row) fail(404, 'not_found', 'Request not found');
    return JSON.parse(row.payload);
  }
  function owner(request: RepoRequest, auth: Auth) { if (request.owner_member_id !== auth.member.id) fail(403, 'owner_required', 'Only the repository owner can perform this action'); }
  function saveRequest(request: RepoRequest, status: RequestStatus, actor: string, type: string, details: Row = {}) {
    request.status = status; request.updated_at = now(); request.version++;
    run('UPDATE requests SET status=?,payload=? WHERE id=?', status, JSON.stringify(request), request.id);
    event(request.network_id, actor, type, { status, version: request.version, ...details }, request.id);
  }
  function activeRepo(request: RepoRequest, auth: Auth) {
    const repo = repoById(request.repo_id, auth);
    if (repo.revoked_at || repo.availability !== 'active' || !(request.kind === 'question' ? repo.questions_enabled : repo.changes_enabled)) fail(409, 'repo_unavailable', 'Repository is paused, revoked, or capability disabled');
    if (!one('SELECT id FROM members WHERE id=? AND revoked_at IS NULL', request.sender_member_id)) fail(409, 'sender_revoked', 'Sender membership revoked');
    return repo;
  }
  function expireLeases() {
    transaction(() => {
      for (const row of all("SELECT r.payload FROM requests r JOIN leases l ON r.id=l.request_id WHERE l.expires_at<=? AND r.status IN ('claimed','running')", now())) {
        const request: RepoRequest = JSON.parse(row.payload);
        saveRequest(request, 'queued', request.owner_member_id, 'lease.expired');
      }
    });
  }
  function requireLease(request: RepoRequest, auth: Auth, body: Row): Row {
    owner(request, auth); activeRepo(request, auth);
    if (!['claimed','running'].includes(request.status)) fail(409, 'invalid_state', 'Request is not executing');
    const token = str(body, 'lease_token', 200);
    const lease = one('SELECT * FROM leases WHERE request_id=? AND device_id=? AND token_hash=? AND expires_at>?', request.id, auth.device.id, hash(token), now());
    if (!lease) fail(409, 'stale_lease', 'Lease is expired, superseded, or belongs to another device');
    return lease;
  }
  function eventsFor(auth: Auth, after: number, limit = 500): {events: NetworkEvent[]; cursor: number} {
    const rows = all(`SELECT e.* FROM events e LEFT JOIN requests r ON e.request_id=r.id WHERE e.network_id=? AND e.id>? AND (e.request_id IS NULL OR r.sender_member_id=? OR r.owner_member_id=?) ORDER BY e.id LIMIT ?`, auth.member.network_id, after, auth.member.id, auth.member.id, limit);
    return { events: rows.map(row => ({...row, payload: JSON.parse(row.payload)})) as NetworkEvent[], cursor: rows.length ? rows.at(-1)!.id : after };
  }
  function resultValid(value: unknown, request: RepoRequest): Result {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'invalid_result', 'result must be an object');
    const result = value as Row;
    if (!GIT_OID_PATTERN.test(str(result, 'base_commit', 64))) fail(400, 'invalid_result', 'base_commit must be a Git SHA-1 or SHA-256 object ID');
    if (request.kind === 'question') {
      allowed(result, ['kind','answer','base_commit','sources']);
      if (result.kind !== 'question_result') fail(400, 'invalid_result', 'Expected question_result');
      str(result, 'answer', 24000);
      if (!Array.isArray(result.sources) || result.sources.length > 100) fail(400, 'invalid_result', 'sources must be an array');
      for (const source of result.sources) {
        if (!source || typeof source !== 'object') fail(400, 'invalid_result', 'Invalid source');
        allowed(source, ['path','line','end_line']); const path = str(source, 'path', 500);
        if (/^(?:[/\\]|[a-z]:)/i.test(path) || path.split(/[/\\]/).includes('..')) fail(400, 'invalid_result', 'Source paths must be repo-relative');
        for (const key of ['line','end_line']) if (source[key] !== undefined && (!Number.isInteger(source[key]) || source[key] < 1)) fail(400, 'invalid_result', 'Source lines must be positive integers');
        if (source.end_line !== undefined && (source.line === undefined || source.end_line < source.line)) fail(400, 'invalid_result', 'Invalid source line range');
      }
    } else {
      allowed(result, ['kind','base_commit','commit','branch','delivery','diff_summary','summary','tests','owner_review_required','remote_verified']);
      if (result.summary !== undefined) str(result, 'summary', 12000);
      if (result.kind !== 'change_result' || !GIT_OID_PATTERN.test(str(result, 'commit', 64)) || result.commit.length !== result.base_commit.length) fail(400, 'invalid_result', 'Invalid change result Git object IDs');
      safeRef(str(result, 'branch', 240)); str(result, 'diff_summary', 12000);
      if (!['local_branch','pushed_branch'].includes(result.delivery) || result.owner_review_required !== true) fail(400, 'invalid_result', 'Change must identify delivery and require owner review');
      if (result.delivery === 'pushed_branch' && result.remote_verified !== true) fail(400, 'invalid_result', 'Pushed branch requires owner-client remote verification');
      if (!Array.isArray(result.tests) || result.tests.length > 100) fail(400, 'invalid_result', 'tests must be an array');
      for (const test of result.tests) {
        if (!test || typeof test !== 'object') fail(400, 'invalid_result', 'Invalid test entry');
        allowed(test, ['name','status']); str(test, 'name', 200);
        if (!['passed','failed','skipped'].includes(test.status)) fail(400, 'invalid_result', 'Invalid test status');
      }
    }
    return result as Result;
  }

  function route(method: string, url: URL, body: Row, auth?: Auth): Reply {
    const path = url.pathname;
    if (method === 'POST' && ['/v1/networks','/v1/join'].includes(path)) {
      allowed(body, path.endsWith('join') ? ['code','handle','display_name','device_label'] : ['name','handle','display_name','device_label']);
      const handle = str(body, 'handle', 32).replace(/^@/, '').toLowerCase();
      if (!HANDLE_PATTERN.test(handle)) fail(400, 'invalid_handle', 'Handle must be 2–32 characters, start with a letter, and contain letters, digits, _ or -');
      let networkId: string; let invite: Row|undefined;
      if (path === '/v1/join') {
        invite = one('SELECT * FROM invites WHERE code_hash=?', hash(str(body, 'code', 80).toUpperCase().replace(/[-\s]/g,'')));
        if (!invite || invite.revoked_at || invite.redeemed_by || invite.expires_at <= now()) fail(400, 'invalid_invite', 'Invitation is invalid, expired, revoked, or already redeemed');
        networkId = invite.network_id;
      } else { networkId = id('net'); run('INSERT INTO networks VALUES (?,?,?)', networkId, str(body, 'name', 100), now()); }
      if (one('SELECT id FROM members WHERE network_id=? AND handle=?', networkId, handle)) fail(409, 'handle_taken', 'Handle is already used in this network');
      const member: Member = { id: id('mem'), network_id: networkId, handle, display_name: str(body, 'display_name', 100, true) || handle, role: invite ? 'member' : 'admin', revoked_at: null };
      run('INSERT INTO members VALUES (?,?,?,?,?,NULL)', member.id, networkId, handle, member.display_name, member.role);
      if (invite) run('UPDATE invites SET redeemed_by=? WHERE id=?', member.id, invite.id);
      event(networkId, member.id, 'member.joined', {member_id: member.id, handle});
      return {status: 201, body: enroll(member, str(body, 'device_label', 100, true) || 'companion')};
    }
    if (!auth) fail(401, 'unauthorized', 'Authentication required');
    const member = auth.member;
    if(method==='GET'&&path==='/v1/keys')return {body:{keys:all('SELECT d.id device_id,d.member_id,m.network_id,k.public_key,d.revoked_at device_revoked_at,m.revoked_at member_revoked_at FROM device_keys k JOIN devices d ON d.id=k.device_id JOIN members m ON m.id=d.member_id WHERE m.network_id=?',member.network_id)}};
    if(method==='POST'&&path==='/v1/keys'){
      allowed(body,['public_key','proof','previous_proof']);
      const key=body.public_key, data=registration(member.network_id,member.id,auth.device.id,key);
      if(!validKey(key)||!verifyData(key,data,body.proof))fail(400,'invalid_key','Valid Ed25519 key and proof of possession required');
      const old=one('SELECT public_key FROM device_keys WHERE device_id=?',auth.device.id);
      if(old&&old.public_key!==key&&!verifyData(old.public_key,data,body.previous_proof))fail(409,'key_change','Key replacement requires the existing device key');
      run('INSERT INTO device_keys VALUES (?,?) ON CONFLICT(device_id) DO UPDATE SET public_key=excluded.public_key',auth.device.id,key);
      return {body:{registered:true}};
    }
    if (method === 'GET' && path === '/v1/messages') {
      const before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER);
      const limit = Number(url.searchParams.get('limit') ?? 50);
      if (!Number.isSafeInteger(before) || before < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail(400, 'invalid_input', 'before must be a positive safe integer and limit must be 1–100');
      const rows = all('SELECT * FROM network_messages WHERE network_id=? AND id<? ORDER BY id DESC LIMIT ?', member.network_id, before, limit + 1);
      const page = rows.slice(0, limit);
      const next_before = rows.length > limit ? page.at(-1)!.id : null;
      return {body: {messages: page.reverse().map(m=>({...m,signature:proof(member.network_id,'message',String(m.id))})), next_before}};
    }
    if (method === 'POST' && path === '/v1/messages') {
      allowed(body, ['body','signature']);
      const text = str(body, 'body', 8000);
      const inserted = run('INSERT INTO network_messages(network_id,sender_member_id,body,created_at) VALUES (?,?,?,?)', member.network_id, member.id, text, now());
      signed(auth,body.signature,'message',{body:text},String(inserted.lastInsertRowid));
      const message = one('SELECT * FROM network_messages WHERE id=?', inserted.lastInsertRowid) as unknown as NetworkMessage;
      Object.assign(message,{signature:body.signature});
      event(member.network_id, member.id, 'chat.message', {message});
      return {status: 201, body: {message}};
    }
    if (method === 'GET' && path === '/v1/me') return {body: {member, device: publicDevice(auth.device), network: one('SELECT * FROM networks WHERE id=?', member.network_id)}};
    if (method === 'GET' && path === '/v1/metrics') {
      if (member.role !== 'admin') fail(403, 'admin_required', 'Network admin required');
      return {body: {queue_depth: one("SELECT count(*) count FROM requests WHERE network_id=? AND status IN ('queued','approval_pending')", member.network_id)!.count}};
    }
    if (method === 'POST' && path === '/v1/devices') {
      allowed(body, ['device_label']); event(member.network_id, member.id, 'device.enrolled', {});
      return {status: 201, body: enroll(member, str(body, 'device_label', 100))};
    }
    if (method === 'POST' && path === '/v1/presence') {
      allowed(body, []); run('UPDATE devices SET last_seen_at=? WHERE id=?', now(), auth.device.id);
      return {body: {online: true, server_time: now()}};
    }
    if (method === 'GET' && path === '/v1/members') return {body: {members: all('SELECT m.*, EXISTS(SELECT 1 FROM devices d WHERE d.member_id=m.id AND d.revoked_at IS NULL AND d.expires_at>? AND d.last_seen_at>?) online FROM members m WHERE network_id=? AND revoked_at IS NULL ORDER BY handle', now(), now()-45000, member.network_id).map(m => ({...m, online: !!m.online}))}};
    let match = path.match(/^\/v1\/networks\/([^/]+)\/invites$/);
    if (method === 'POST' && match) {
      allowed(body, ['expires_in_seconds']);
      if (match[1] !== member.network_id || member.role !== 'admin') fail(403, 'admin_required', 'Network admin required');
      const seconds = body.expires_in_seconds ?? 86400;
      if (!Number.isInteger(seconds) || seconds < 60 || seconds > 604800) fail(400, 'invalid_input', 'Invite lifetime must be 60–604800 seconds');
      const code = randomBytes(6).toString('hex').toUpperCase(); const inviteId = id('inv'); const expires = now()+seconds*1000;
      run('INSERT INTO invites VALUES (?,?,?,?,?,NULL,NULL)', inviteId, member.network_id, hash(code), member.id, expires);
      event(member.network_id, member.id, 'invite.created', {invite_id: inviteId});
      return {status: 201, body: {id: inviteId, code, expires_at: expires}};
    }
    match = path.match(/^\/v1\/(members|devices|invites)\/([^/]+)\/revoke$/);
    if (method === 'POST' && match) {
      allowed(body, []); const [, kind, target] = match;
      if (kind === 'devices') {
        const device = one('SELECT * FROM devices WHERE id=? AND member_id=?', target, member.id);
        if (!device) fail(404, 'not_found', 'Device not found');
        run('UPDATE devices SET revoked_at=? WHERE id=?', now(), target);
      } else {
        if (member.role !== 'admin') fail(403, 'admin_required', 'Network admin required');
        if (kind === 'members' && target === member.id) fail(409, 'admin_required', 'Cannot revoke the network creator');
        if (!one(`SELECT id FROM ${kind} WHERE id=? AND network_id=?`, target, member.network_id)) fail(404, 'not_found', 'Resource not found');
        run(`UPDATE ${kind} SET revoked_at=? WHERE id=?`, now(), target);
      }
      if (kind === 'members' || kind === 'devices') {
        const affected = kind === 'members' ? all('SELECT payload FROM requests WHERE network_id=? AND (sender_member_id=? OR owner_member_id=?)', member.network_id, target, target) : all('SELECT r.payload FROM requests r JOIN leases l ON r.id=l.request_id WHERE l.device_id=?', target);
        for (const row of affected) { const request: RepoRequest = JSON.parse(row.payload); if (!WORKER_DONE_STATUSES.includes(request.status)) saveRequest(request, 'cancelled', member.id, 'request.cancelled', {reason: `${kind}.revoked`}); }
      }
      event(member.network_id, member.id, `${kind}.revoked`, {id: target}); return {body: {revoked: true}};
    }
    if (method === 'GET' && path === '/v1/repos') {
      const terms = (url.searchParams.get('query') || '').toLowerCase().split(/\s+/).filter(Boolean);
      const repos = all('SELECT r.payload,m.handle FROM repos r JOIN members m ON m.id=r.owner_member_id WHERE r.network_id=? AND m.revoked_at IS NULL', member.network_id).map(r => ({...JSON.parse(r.payload), owner_handle: r.handle})).filter(r => !r.revoked_at && (r.availability === 'active' || r.owner_member_id === member.id));
      return {body: {repos: repos.filter(r => terms.every(t => `${r.slug} ${r.description} ${r.tags.join(' ')} ${r.owner_handle}`.toLowerCase().includes(t)))}};
    }
    match = path.match(/^\/v1\/repos\/([^/]+)$/);
    if ((method === 'POST' && path === '/v1/repos') || (method === 'PATCH' && match)) {
      allowed(body, ['slug','description','tags','questions_enabled','changes_enabled','questions_require_approval','availability']);
      const previous = match ? repoById(match[1], auth) : undefined;
      if (previous && previous.owner_member_id !== member.id) fail(403, 'owner_required', 'Repository owner required');
      const slug = body.slug === undefined && previous ? previous.slug : str(body, 'slug', 80).toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(slug)) fail(400, 'invalid_input', 'Invalid repository slug');
      if (one('SELECT id FROM repos WHERE owner_member_id=? AND slug=? AND id<>?', member.id, slug, previous?.id ?? '')) fail(409, 'repo_exists', 'Repository slug already exists for this owner');
      const availability = body.availability ?? previous?.availability ?? 'active';
      if (!['active','paused'].includes(availability)) fail(400, 'invalid_input', 'Invalid availability');
      const repo: Repo = {id: previous?.id ?? id('rep'), network_id: member.network_id, owner_member_id: member.id, slug, description: body.description === undefined ? previous?.description ?? '' : str(body, 'description', 2000), tags: body.tags === undefined ? previous?.tags ?? [] : strings(body.tags, 'tags'), questions_enabled: bool(body, 'questions_enabled', previous?.questions_enabled ?? false), changes_enabled: bool(body, 'changes_enabled', previous?.changes_enabled ?? false), questions_require_approval: bool(body, 'questions_require_approval', previous?.questions_require_approval ?? true), availability, revoked_at: null};
      run('INSERT INTO repos VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,payload=excluded.payload', repo.id, repo.network_id, member.id, slug, JSON.stringify(repo));
      for (const row of all("SELECT payload FROM requests WHERE repo_id=? AND status IN ('claimed','running')", repo.id)) {
        const request: RepoRequest = JSON.parse(row.payload);
        if (availability !== 'active' || !(request.kind === 'question' ? repo.questions_enabled : repo.changes_enabled) || (request.kind === 'question' && repo.questions_require_approval && !one("SELECT request_id FROM approvals WHERE request_id=? AND decision='approved'", request.id))) saveRequest(request, 'cancelled', member.id, 'request.cancelled', {reason: 'repo_policy_changed'});
      }
      if (repo.questions_require_approval) {
        for (const row of all("SELECT r.payload FROM requests r LEFT JOIN approvals a ON a.request_id=r.id WHERE r.repo_id=? AND r.status='queued' AND a.request_id IS NULL", repo.id)) {
          const request: RepoRequest = JSON.parse(row.payload);
          if (request.kind === 'question') saveRequest(request, 'approval_pending', member.id, 'request.approval_required');
        }
      }
      event(member.network_id, member.id, previous ? 'repo.updated' : 'repo.published', {repo}); return {status: previous ? 200 : 201, body: {repo}};
    }
    if (method === 'POST' && path === '/v1/requests') {
      allowed(body, ['repo_id','recipient_member_id','kind','title','body','base_ref','constraints','signature']);
      const repo = repoById(str(body, 'repo_id', 100), auth);
      if (!['question','change'].includes(body.kind)) fail(400, 'invalid_input', 'kind must be question or change');
      if (body.recipient_member_id !== undefined && body.recipient_member_id !== repo.owner_member_id) fail(400, 'recipient_mismatch', 'Recipient does not own this repo');
      const kind = body.kind;
      if (repo.revoked_at || repo.availability !== 'active' || !(kind === 'question' ? repo.questions_enabled : repo.changes_enabled) || !one('SELECT id FROM members WHERE id=? AND revoked_at IS NULL', repo.owner_member_id)) fail(409, 'repo_unavailable', 'Repository is unavailable or capability disabled');
      const base = str(body, 'base_ref', 240, true) || null; if (base) safeRef(base);
      const request: RepoRequest = {id: id('req'), network_id: member.network_id, repo_id: repo.id, sender_member_id: member.id, owner_member_id: repo.owner_member_id, kind, status: kind === 'change' || repo.questions_require_approval ? 'approval_pending' : 'queued', title: str(body, 'title', 200), body: str(body, 'body', 16000), base_ref: base, constraints: strings(body.constraints, 'constraints'), created_at: now(), updated_at: now(), version: 1};
      if(body.signature){request.id=body.signature.id;Object.assign(request,{signature:body.signature});}
      signed(auth,body.signature,'request',requestPayload(request),request.id);
      run('INSERT INTO requests VALUES (?,?,?,?,?,?,?)', request.id, member.network_id, repo.id, member.id, repo.owner_member_id, request.status, JSON.stringify(request));
      event(member.network_id, member.id, 'request.created', {request}, request.id); return {status: 201, body: {request}};
    }
    if (method === 'GET' && path === '/v1/requests') {
      const status = url.searchParams.get('status');
      const requests = all('SELECT payload FROM requests WHERE network_id=? AND (sender_member_id=? OR owner_member_id=?) ORDER BY rowid DESC LIMIT 1000', member.network_id, member.id, member.id).map(r => JSON.parse(r.payload)).filter(r => !status || r.status === status);
      return {body: {requests}};
    }
    match = path.match(/^\/v1\/requests\/([^/]+)(?:\/(approve|reject|cancel|claim|heartbeat|complete|fail|accept|close))?$/);
    if (match) {
      const request = requestById(match[1], auth); const action = match[2];
      if (method === 'GET' && !action) return {body: {request, result_signature:proof(member.network_id,'result',request.id), result: one('SELECT payload FROM results WHERE request_id=?', request.id) ? JSON.parse(one('SELECT payload FROM results WHERE request_id=?', request.id)!.payload) : null, events: all('SELECT * FROM events WHERE request_id=? ORDER BY id', request.id).map(e => ({...e, payload: JSON.parse(e.payload)}))}};
      if (method !== 'POST' || !action) fail(404, 'not_found', 'Endpoint not found');
      if (['approve','reject'].includes(action)) {
        allowed(body, ['reason']); owner(request, auth);
        if (request.status !== 'approval_pending') fail(409, 'invalid_state', 'Request is not awaiting approval');
        if (action === 'approve') activeRepo(request, auth);
        run('INSERT INTO approvals VALUES (?,?,?,?,?)', request.id, member.id, action === 'approve' ? 'approved' : 'rejected', JSON.stringify({title: request.title, body: request.body, constraints: request.constraints, base_ref: request.base_ref}), now());
        saveRequest(request, action === 'approve' ? 'queued' : 'rejected', member.id, `request.${action === 'approve' ? 'approved' : 'rejected'}`, {reason: str(body, 'reason', 2000, true)});
      } else if (action === 'cancel') {
        allowed(body, ['reason']);
        if (WORKER_DONE_STATUSES.includes(request.status)) fail(409, 'invalid_state', 'Completed or terminal request cannot be cancelled');
        saveRequest(request, 'cancelled', member.id, 'request.cancelled', {reason: str(body, 'reason', 2000, true)});
      } else if (action === 'claim') {
        allowed(body, []); owner(request, auth); const repo = activeRepo(request, auth);
        if (request.status !== 'queued') fail(409, 'not_claimable', 'Request is not queued');
        if ((request.kind === 'change' || repo.questions_require_approval) && !one("SELECT request_id FROM approvals WHERE request_id=? AND decision='approved'", request.id)) fail(409, 'approval_required', 'Owner approval required');
        const old = one('SELECT * FROM leases WHERE request_id=?', request.id);
        const token = randomBytes(32).toString('base64url'); const expires = now()+leaseMs; const attempt = (old?.attempt ?? 0)+1;
        run('INSERT INTO leases VALUES (?,?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET device_id=excluded.device_id,token_hash=excluded.token_hash,expires_at=excluded.expires_at,attempt=excluded.attempt', request.id, auth.device.id, hash(token), expires, attempt);
        saveRequest(request, 'claimed', member.id, 'request.claimed', {device_id: auth.device.id, expires_at: expires, attempt});
        return {body: {request, lease_token: token, expires_at: expires, attempt}};
      } else if (action === 'heartbeat') {
        allowed(body, ['lease_token']); const lease = requireLease(request, auth, body); const expires = now()+leaseMs;
        run('UPDATE leases SET expires_at=? WHERE request_id=?', expires, request.id); run('UPDATE devices SET last_seen_at=? WHERE id=?', now(), auth.device.id);
        if (request.status === 'claimed') saveRequest(request, 'running', member.id, 'request.running');
        return {body: {request, expires_at: expires, attempt: lease.attempt}};
      } else if (action === 'complete') {
        allowed(body, ['lease_token','result','signature']); requireLease(request, auth, body); const result = resultValid(body.result, request);
        signed(auth,body.signature,'result',resultPayload(request,result),request.id);
        run('INSERT INTO results VALUES (?,?,?)', request.id, JSON.stringify(result), now());
        saveRequest(request, request.kind === 'question' ? 'answered' : 'review_ready', member.id, 'request.completed', {result});
        return {body: {request, result}};
      } else if (action === 'fail') {
        allowed(body, ['lease_token','code','message']); requireLease(request, auth, body);
        saveRequest(request, 'failed', member.id, 'request.failed', {code: str(body, 'code', 100), message: str(body, 'message', 2000)});
      } else if (action === 'accept' || action === 'close') {
        allowed(body, []);
        if (request.kind !== 'change' || request.status !== 'review_ready') fail(409, 'invalid_state', 'Change must be ready for review');
        if (action === 'close') owner(request, auth);
        if (action === 'accept' && member.id !== request.sender_member_id) fail(403, 'sender_required', 'Only sender can acknowledge receipt');
        saveRequest(request, action === 'accept' ? 'accepted' : 'closed', member.id, `request.${action === 'accept' ? 'accepted' : 'closed'}`);
      }
      return {body: {request}};
    }
    if (method === 'GET' && path === '/v1/events') {
      const after = Number(url.searchParams.get('after') || 0);
      if (!Number.isSafeInteger(after) || after < 0) fail(400, 'invalid_cursor', 'after must be a non-negative integer');
      return {body: eventsFor(auth, after)};
    }
    fail(404, 'not_found', 'Endpoint not found');
  }

  const limits = new Map<string, {start: number; count: number}>();
  const metrics = {requests: 0, errors: 0, claim_conflicts: 0};
  function rateLimit(req: IncomingMessage, member?: Member) {
    // Verified members have independent budgets even when a proxy or NAT shares one IP.
    // Unauthenticated traffic uses the socket peer only; forwarded headers are untrusted.
    const limiterKey = member ? `member:${member.id}` : `ip:${req.socket.remoteAddress ?? 'unknown'}`; let entry = limits.get(limiterKey);
    if (!entry || now()-entry.start >= 60000) { entry = {start: now(), count: 0}; limits.set(limiterKey, entry); }
    const maximum = member ? (options.rateLimit ?? 300) : (options.unauthenticatedRateLimit ?? options.rateLimit ?? 300);
    if (++entry.count > maximum) {
      const error = new ApiError(429, 'rate_limited', 'Too many requests; retry after the Retry-After interval');
      error.retryAfter = Math.max(1, Math.ceil((entry.start + 60000 - now()) / 1000));
      throw error;
    }
    if (limits.size > 10000) for (const [key, value] of limits) if (now()-value.start >= 60000) limits.delete(key);
  }
  function authenticateAndLimit(req: IncomingMessage): Auth {
    let auth: Auth;
    try { auth = authenticate(req); }
    catch (error) { rateLimit(req); throw error; }
    rateLimit(req, auth.member);
    return auth;
  }
  async function readBody(req: IncomingMessage): Promise<Row> {
    if (!['POST','PATCH'].includes(req.method ?? '')) return {};
    if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'unsupported_media_type', 'Use application/json');
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY_BYTES) fail(413, 'body_too_large', 'Maximum request size is 32 KiB'); chunks.push(chunk); }
    let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { fail(400, 'invalid_json', 'Invalid JSON body'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'invalid_json', 'Body must be an object');
    return body as Row;
  }
  function send(res: ServerResponse, status: number, body: any) {
    res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'}); res.end(JSON.stringify(body));
  }
  const server = createServer(async (req, res) => {
    metrics.requests++;
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      // Hosting health probes must not consume user or anonymous request budgets.
      if (req.method === 'GET' && url.pathname === '/health/live') { send(res, 200, {ok: true}); return; }
      if (req.method === 'GET' && url.pathname === '/health/ready') { one('SELECT 1'); send(res, 200, {ok: true}); return; }
      const publicRoute = req.method === 'POST' && ['/v1/networks','/v1/join'].includes(url.pathname);
      const auth = publicRoute ? (rateLimit(req), undefined) : authenticateAndLimit(req);
      const body = await readBody(req); expireLeases();
      let reply: Reply;
      if (['POST','PATCH'].includes(req.method ?? '')) {
        const idemKey = str(body, 'idempotency_key', 200);
        if (idemKey.length < 8) fail(400, 'invalid_idempotency_key', 'Use a random idempotency key of at least 8 characters');
        const scope = auth?.device.id ?? `public:${url.pathname}`; const fingerprint = hash(canonical({path: url.pathname, method: req.method, body}));
        reply = transaction(() => {
          const prior = one('SELECT * FROM idempotency WHERE scope=? AND key=?', scope, idemKey);
          if (prior) {
            if (prior.fingerprint !== fingerprint) fail(409, 'idempotency_conflict', 'Key was already used with different input');
            return {status: prior.status, body: decrypt(prior.response)};
          }
          const response = route(req.method!, url, body, auth);
          run('INSERT INTO idempotency VALUES (?,?,?,?,?,?)', scope, idemKey, fingerprint, encrypt(response.body), response.status ?? 200, now());
          return response;
        });
      } else reply = route(req.method ?? 'GET', url, body, auth);
      send(res, reply.status ?? 200, reply.body);
    } catch (error) {
      metrics.errors++; if (error instanceof ApiError && ['not_claimable','stale_lease'].includes(error.code)) metrics.claim_conflicts++;
      const status = error instanceof ApiError ? error.status : 500;
      if (status === 500) console.error(JSON.stringify({level: 'error', event: 'request_failure', message: error instanceof Error ? error.message : 'Unknown error'}));
      if (!res.headersSent) {
        if (error instanceof ApiError && error.retryAfter !== undefined) res.setHeader('Retry-After', error.retryAfter);
        send(res, status, {error: {code: error instanceof ApiError ? error.code : 'internal_error', message: error instanceof ApiError ? error.message : 'Internal server error'}});
      }
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  // Server-to-client RFC6455 text stream. Worker mutations always use authenticated HTTP.
  const sockets = new Set<Socket>();
  server.on('upgrade', (req, rawSocket, head) => {
    const socket = rawSocket as Socket;
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const auth = authenticateAndLimit(req);
      if (url.pathname !== '/v1/stream') fail(404, 'not_found', 'Stream not found');
      let cursor = Number(url.searchParams.get('after') || 0);
      const wsKey = req.headers['sec-websocket-key'];
      if (!Number.isSafeInteger(cursor) || cursor < 0 || typeof wsKey !== 'string' || Buffer.from(wsKey, 'base64').length !== 16 || req.headers['sec-websocket-version'] !== '13' || req.headers.upgrade?.toLowerCase() !== 'websocket') fail(400, 'invalid_stream', 'Invalid WebSocket handshake');
      const accept = createHash('sha1').update(wsKey+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      sockets.add(socket); let lastPong = now(); let pending = head;
      const frame = (opcode: number, data = Buffer.alloc(0)) => {
        const header = data.length < 126 ? Buffer.from([0x80|opcode, data.length]) : Buffer.from([0x80|opcode,126,data.length >> 8,data.length & 255]);
        socket.write(Buffer.concat([header, data]));
      };
      const pump = () => {
        try {
          authenticate(req); if (now()-lastPong > 45000 || socket.writableLength > 1_000_000) { socket.destroy(); return; }
          const batch = eventsFor(auth, cursor, 100);
          for (const event of batch.events) { const bytes = Buffer.from(JSON.stringify({type: 'event', event, cursor: event.id})); if (bytes.length > 65535) throw new Error('Event too large'); frame(1, bytes); cursor = event.id; }
        } catch { socket.destroy(); }
      };
      const interval = setInterval(pump, 500); const ping = setInterval(() => frame(9), 15000);
      const consume = (data: Buffer) => {
        pending = Buffer.concat([pending, data]);
        if (pending.length > 4096) { socket.destroy(); return; }
        while (pending.length >= 2) {
          const opcode = pending[0] & 15; const size = pending[1] & 127;
          if (!(pending[0] & 128) || (pending[0] & 112) || !(pending[1] & 128) || size > 125 || ![8,9,10].includes(opcode)) { socket.destroy(); return; }
          if (pending.length < size+6) return;
          const payload = Buffer.from(pending.subarray(6,6+size)); for (let i=0;i<size;i++) payload[i] ^= pending[2+i%4]; pending = pending.subarray(6+size);
          if (opcode === 8) { frame(8); socket.end(); return; }
          if (opcode === 9) frame(10,payload);
          if (opcode === 10) { lastPong = now(); run('UPDATE devices SET last_seen_at=? WHERE id=?', now(), auth.device.id); }
        }
      };
      socket.on('data', consume); socket.on('error', () => socket.destroy()); socket.on('close', () => {clearInterval(interval); clearInterval(ping); sockets.delete(socket);});
      pump(); if (head.length) consume(Buffer.alloc(0));
    } catch (error) {
      const retry = error instanceof ApiError && error.retryAfter !== undefined ? `Retry-After: ${error.retryAfter}\r\n` : '';
      socket.end(`HTTP/1.1 ${error instanceof ApiError ? error.status : 500} Error\r\n${retry}Connection: close\r\nContent-Length: 0\r\n\r\n`);
    }
  });
  const sweep = setInterval(() => { try { expireLeases(); } catch { /* HTTP reports DB failures; retry next sweep. */ } }, 5000); sweep.unref();
  return {server, db, metrics, close: async () => {clearInterval(sweep); for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); db.close();}};
}
