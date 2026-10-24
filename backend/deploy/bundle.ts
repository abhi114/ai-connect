// Explicit runtime allowlist: never upload profiles, databases, .env, or the client.
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const outputRoot = join(root, 'backend/dist');
mkdirSync(outputRoot, {recursive:true});
const output = mkdtempSync(join(outputRoot, 'railway-'));
const files = ['backend/package.json', 'backend/src/main.ts', 'backend/src/config.ts',
  'backend/src/server.ts', 'backend/src/db.ts', 'backend/src/backup.ts',
  'shared/package.json', 'shared/protocol.ts'];
for (const file of files) {
  const destination = join(output, file);
  mkdirSync(dirname(destination), {recursive:true});
  copyFileSync(join(root, file), destination);
}
copyFileSync(join(root, 'backend/deploy/Dockerfile'), join(output, 'Dockerfile'));
console.log(output);
