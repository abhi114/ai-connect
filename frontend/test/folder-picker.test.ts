import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { createFolderPicker } from '../src/folder-picker.ts';

test('macOS chooser uses static JXA and preserves Unicode and whitespace paths', async () => {
  const path = '/Users/Example/项目 with spaces /';
  const pick = createFolderPicker({platform: 'darwin', isDirectory: async value => value === path,
    run: async (executable, args, _cwd, options) => {
      assert.equal(executable, '/usr/bin/osascript');
      assert.deepEqual(args.slice(0, 3), ['-l', 'JavaScript', '-e']);
      assert.match(args[3], /chooseFolder/);
      assert.equal(options?.timeout, 120_000);
      const output = runInNewContext(args[3], {Application: {currentApplication: () => ({chooseFolder: () => path})}});
      assert.match(output, /\\u/);
      return output;
    }});
  assert.deepEqual(await pick(), {path});
});

test('Windows chooser uses STA and transports Unicode via base64', async () => {
  const path = 'C:\\Users\\नभी\\repo & project';
  const pick = createFolderPicker({platform: 'win32', isDirectory: async value => value === path,
    run: async (executable, args) => {
      assert.equal(executable, 'powershell.exe');
      assert.ok(args.includes('-STA'));
      assert.ok(args.includes('-NoProfile'));
      assert.match(args.at(-1)!, /FolderBrowserDialog/);
      assert.ok(!args.at(-1)!.includes(path));
      return Buffer.from(JSON.stringify({path}), 'utf8').toString('base64');
    }});
  assert.deepEqual(await pick(), {path});
});

test('cancelled dialog is not an error and does not inspect or expose anything', async () => {
  const pick = createFolderPicker({platform: 'darwin', run: async (_executable, args) => runInNewContext(args[3], {
    Application: {currentApplication: () => ({chooseFolder: () => { throw {errorNumber: -128}; }})},
  }),
    isDirectory: async () => { throw new Error('Must not inspect cancellation'); }});
  assert.deepEqual(await pick(), {path: null});
});

test('picker allows one concurrent dialog and unlocks after cancellation', async () => {
  let finish!: (value: string) => void;
  const pick = createFolderPicker({platform: 'darwin', run: async () => new Promise(resolve => { finish = resolve; })});
  const first = pick();
  await assert.rejects(pick(), /already open/);
  finish('{"path":null}');
  await first;
  const next = pick();
  finish('{"path":null}');
  assert.deepEqual(await next, {path: null});
});

test('unsupported systems, headless failure, timeout and invalid output have safe fallbacks', async () => {
  await assert.rejects(createFolderPicker({platform: 'linux'})(), /manually/);
  for (const message of ['spawn ENOENT secret stderr', 'Command timed out']) {
    const pick = createFolderPicker({platform: 'darwin', run: async () => { throw new Error(message); }});
    await assert.rejects(pick(), message === 'Command timed out' ? /timed out/ : /desktop session/);
    await assert.rejects(pick(), /manually/);
  }
  for (const output of ['bad json', '{}', '{"path":4}', '{"path":"/missing"}']) {
    const pick = createFolderPicker({platform: 'darwin', run: async () => output, isDirectory: async () => false});
    await assert.rejects(pick(), /invalid|did not return|accessible directory/);
  }
});
