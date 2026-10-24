import { DatabaseSync, backup } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

const source = resolve(process.env.DATABASE_PATH || 'data/pantheon.sqlite');
const destination = process.argv[2];
if (!destination) throw new Error('Usage: node src/backup.ts /absolute/path/to/new-backup.sqlite');
if (!existsSync(source)) throw new Error(`Database does not exist: ${source}`);
const output = resolve(destination);
if (existsSync(output)) throw new Error('Backup destination already exists; choose a new filename');
mkdirSync(dirname(output), {recursive:true});
const db = new DatabaseSync(source, {readOnly:true});
try { await backup(db, output); console.log(JSON.stringify({event:'backup.complete',path:output})); } finally { db.close(); }
