import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS device_keys (device_id TEXT PRIMARY KEY REFERENCES devices(id), public_key TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS signed_records (network_id TEXT NOT NULL, signature_id TEXT NOT NULL, kind TEXT NOT NULL, record_id TEXT NOT NULL, envelope TEXT NOT NULL, PRIMARY KEY(network_id,signature_id));
    CREATE TABLE IF NOT EXISTS networks (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, network_id TEXT NOT NULL REFERENCES networks(id), handle TEXT NOT NULL COLLATE NOCASE, display_name TEXT NOT NULL, role TEXT NOT NULL, revoked_at INTEGER, UNIQUE(network_id,handle));
    CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), public_label TEXT NOT NULL, credential_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, revoked_at INTEGER);
    CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, network_id TEXT NOT NULL REFERENCES networks(id), code_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, expires_at INTEGER NOT NULL, redeemed_by TEXT, revoked_at INTEGER);
    CREATE TABLE IF NOT EXISTS repos (id TEXT PRIMARY KEY, network_id TEXT NOT NULL, owner_member_id TEXT NOT NULL REFERENCES members(id), slug TEXT NOT NULL COLLATE NOCASE, payload TEXT NOT NULL, UNIQUE(owner_member_id,slug));
    CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, network_id TEXT NOT NULL, repo_id TEXT NOT NULL REFERENCES repos(id), sender_member_id TEXT NOT NULL, owner_member_id TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS approvals (request_id TEXT PRIMARY KEY REFERENCES requests(id), owner_id TEXT NOT NULL, decision TEXT NOT NULL, scope_json TEXT NOT NULL, decided_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS leases (request_id TEXT PRIMARY KEY REFERENCES requests(id), device_id TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS results (request_id TEXT PRIMARY KEY REFERENCES requests(id), payload TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, network_id TEXT NOT NULL, request_id TEXT REFERENCES requests(id), actor_member_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS events_network_cursor ON events(network_id,id);
    CREATE TABLE IF NOT EXISTS network_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, network_id TEXT NOT NULL REFERENCES networks(id), sender_member_id TEXT NOT NULL REFERENCES members(id), body TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_network_cursor ON network_messages(network_id,id);
    CREATE INDEX IF NOT EXISTS requests_participants ON requests(network_id,owner_member_id,sender_member_id);
    CREATE TABLE IF NOT EXISTS idempotency (scope TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, response TEXT NOT NULL, status INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(scope,key));
    PRAGMA user_version=1;`);
  return db;
}
