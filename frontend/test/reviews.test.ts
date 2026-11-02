import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewItems } from '../src/reviews.ts';
import { html,js } from '../src/dashboard.ts';

test('reviews separate pending owner changes, incoming delivered results, and delivered history',()=>{
 const make=(id:string,repo_id:string,status:string,owner='me',sender='peer')=>({id,repo_id,status,kind:'change',owner_member_id:owner,sender_member_id:sender,created_at:1,updated_at:1});
 const s={member:{id:'me'},local_chats:[],requests:[make('a','repo-a','running'),make('b','repo-b','running'),make('incoming','repo-a','review_ready','peer','me'),make('delivered','repo-a','review_ready'),{...make('question','repo-a','running'),kind:'question'},make('queued','repo-a','queued')],runs:{a:{state:'awaiting_review'},b:{state:'awaiting_review'},delivered:{state:'complete'}}};
 assert.deepEqual(reviewItems(s).map(i=>i.request.id),['a','b','incoming']);
 assert.deepEqual(reviewItems(s,'delivered').map(i=>i.request.id),['incoming','delivered']);
 assert.deepEqual(reviewItems(s).filter(i=>i.request.repo_id==='repo-a').map(i=>i.request.id),['a','incoming']);
});
test('dedicated review panel has direct diff and delivery actions and Home opens it',()=>{
 assert.doesNotThrow(()=>new Function(js));assert.match(html,/id="tab-reviews"/);assert.match(html,/id="reviews-panel"/);
 assert.match(js,/function openReviews/);assert.match(js,/function renderReviews/);assert.match(js,/rpc\('diff'/);
 assert.match(js,/title==='Changes to review'.*c.onclick=\(\)=>openReviews/);
 const route=js.slice(js.indexOf('async function openHomeRequest'),js.indexOf('function homeContext'));
 assert.match(route,/openReviews\(r.repo_id,r.id\)/);
});
