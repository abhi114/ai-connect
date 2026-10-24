import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readConfig } from '../src/config.ts';

test('local defaults remain loopback and accept an explicit database', () => {
  assert.deepEqual(readConfig({}), {host:'127.0.0.1',port:8787,databasePath:resolve('data/pantheon.sqlite')});
  assert.equal(readConfig({DATABASE_PATH:'test.sqlite'}).databasePath, resolve('test.sqlite'));
});
test('Railway uses its port, public bind and persistent volume', () => {
  const env = {RAILWAY_ENVIRONMENT_ID:'test',RAILWAY_VOLUME_MOUNT_PATH:'/data',PORT:'12345'};
  assert.deepEqual(readConfig(env), {host:'0.0.0.0',port:12345,databasePath:resolve('/data/pantheon.sqlite')});
  assert.equal(readConfig({...env,DATABASE_PATH:'/data/sub/db.sqlite'}).databasePath, resolve('/data/sub/db.sqlite'));
});
test('Railway refuses missing storage and paths outside the volume', () => {
  assert.throws(()=>readConfig({RAILWAY_ENVIRONMENT_ID:'test'}), /persistent volume/);
  for (const path of ['/data','/data-other/db.sqlite','/tmp/db.sqlite','/data/../db.sqlite']) {
    assert.throws(()=>readConfig({RAILWAY_ENVIRONMENT_ID:'test',RAILWAY_VOLUME_MOUNT_PATH:'/data',DATABASE_PATH:path}), /inside/);
  }
});
test('invalid ports fail before starting the server', () => {
  for (const port of ['0','65536','NaN','1.5','-1']) assert.throws(()=>readConfig({PORT:port}), /PORT/);
});
