import { DatabaseSync, backup } from 'node:sqlite';
import { chmodSync, existsSync } from 'node:fs';
const source='/var/lib/aiconnect/pantheon.sqlite';
if(!existsSync(source))throw Error('Database missing; refusing to create an empty backup');
process.umask(0o077);
const output='/var/backups/aiconnect/pantheon-'+new Date().toISOString().replaceAll(':','-')+'.sqlite';
if(existsSync(output))throw Error('Backup already exists');
const db=new DatabaseSync(source,{readOnly:true});
try{await backup(db,output);chmodSync(output,0o600);console.log('Backup complete:',output)}finally{db.close()}
