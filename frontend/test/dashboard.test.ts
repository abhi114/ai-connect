import test from 'node:test';
import assert from 'node:assert/strict';
import { html, css, js } from '../src/dashboard.ts';
import { onboardingCss } from '../src/onboarding.ts';

test('warm light theme has readable text and consistent dialog colors',()=>{
  assert.match(css,/color-scheme:light/);
  assert.doesNotMatch(css+onboardingCss,/#0d1423|#19253b|#ae93ff|color-scheme:dark/);
  const luminance=(hex:string)=>{
    const channels=hex.match(/[a-f0-9]{2}/gi)!.map(c=>parseInt(c,16)/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
    return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
  };
  for(const [foreground,background] of [['30342d','f7f5ef'],['5e6656','eeede5'],['ffffff','536947'],['65705b','edf2e6'],['943c36','fae9e4'],['626a5a','fffdf7']]){
    const values=[luminance(foreground),luminance(background)].sort((a,b)=>b-a);
    assert.ok((values[0]+0.05)/(values[1]+0.05)>=4.5,`${foreground} on ${background} must meet normal-text AA contrast`);
  }
});

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

test('Home is the landing tab and panels release chat space when collapsed',()=>{
  assert.match(html,/role="tablist" aria-label="Workspace views"/);
  assert.match(html,/id="tab-home" role="tab" aria-selected="true"/);
  assert.match(js,/let mainTab='home',inspectorOpen=false/);
  assert.match(js,/setInspector\(false\);setMainTab\('home'\)/);
  assert.match(css,/sidebar-collapsed>main\{grid-column:2\}/);
  assert.match(css,/#chat-content\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/#chat-content>\.inspector\{display:none\}/);
  assert.match(js,/Needs your attention/);
  assert.match(js,/Queued · oldest first/);
  assert.match(js,/ArrowLeft.*ArrowRight/);
});

test('sidebar navigation and full-page Settings preserve vertical chat space',()=>{
  assert.match(html,/aria-orientation="vertical"/);
  assert.match(html,/id="tab-settings" role="tab"/);
  assert.match(html,/<section id="setup-dialog" role="tabpanel"/);
  assert.doesNotMatch(html,/<dialog id="setup-dialog"|id="setup-open"|id="setup-close"/);
  assert.match(js,/\.prepend\(\$\('#workspace-bar'\)\)/);
  assert.match(css,/sidebar-collapsed>\.sidebar\{display:flex/);
  assert.match(css,/main\.chat-mode header\{padding:9px 18px/);
  assert.match(css,/#compose-body\{[^}]*height:44px/);
});
