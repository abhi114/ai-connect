import test from 'node:test';
import assert from 'node:assert/strict';
import { html, css, js } from '../src/dashboard.ts';

test('dashboard bundle parses and all static ID selectors have matching elements', () => {
  assert.doesNotThrow(() => new Function(js));
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'DOM IDs must be unique');
  for (const match of js.matchAll(/\$\('#([\w-]+)'\)/g)) {
    assert.ok(ids.includes(match[1]), `missing dashboard element: ${match[1]}`);
  }
});

test('dashboard keeps user-generated content inert and sharing opt-in', () => {
  assert.doesNotMatch(js, /\.innerHTML\s*=|insertAdjacentHTML\(/);
  assert.match(js, /textContent=text/);
  assert.match(html, /id="repo-changes" type="checkbox">/);
  assert.match(html, /value="ask">Ask me before each question/);
  assert.match(js, /rpc\('pick_folder'\)/);
  assert.match(js, /rpc\('expose'/);
  assert.match(js, /Only request participants|Visible to request participants/);
  assert.match(css, /focus-visible/);
});
