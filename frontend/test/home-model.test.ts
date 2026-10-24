import test from 'node:test';
import assert from 'node:assert/strict';
import { homeModel } from '../src/home-model.ts';

const now=new Date(2026,9,25,12).getTime();
const request=(id:string,status:string,extra:any={})=>({id,status,kind:'change',owner_member_id:'me',sender_member_id:'peer',created_at:now-1000,updated_at:now,...extra});
const snapshot=(requests:any[],runs:any={})=>({member:{id:'me'},requests,runs});
test('Home separates owner approvals, owner review and requester delivered review',()=>{
 const {groups:g}=homeModel(snapshot([request('approve','approval_pending'),request('review','running'),request('received','review_ready',{sender_member_id:'me',owner_member_id:'peer'}),request('sent','approval_pending',{sender_member_id:'me',owner_member_id:'peer'})],{review:{state:'awaiting_review'}}),[],now);
 assert.deepEqual(g.approvals.map((i:any)=>i.request.id),['approve']);
 assert.deepEqual(g.reviews.map((i:any)=>i.request.id),['review','received']);
 assert.deepEqual(g.waiting.map((i:any)=>i.request.id),['sent']);
 assert.equal(g.today.length,1);
});
test('completed local runs do not hide remote review state and today excludes questions and old changes',()=>{
 const {groups:g}=homeModel(snapshot([request('delivered','review_ready'),request('old','complete',{updated_at:new Date(2026,9,24,12).getTime()}),request('question','complete',{kind:'question'}),request('working','running'),request('queued','queued'),request('failed','failed')],{delivered:{state:'complete'}}),[],now);
 assert.equal(g.waiting[0].request.id,'delivered');
 assert.deepEqual(g.today.map((i:any)=>i.request.id),['delivered']);
 assert.equal(g.working.length,1);assert.equal(g.queued.length,1);assert.equal(g.issues.length,1);
});
test('latest activity includes general messages and request updates, even when no work is pending',()=>{
 const s=snapshot([request('done','complete')]);
 assert.equal(homeModel(s,[{id:'m',created_at:now+1}],now).latest?.message.id,'m');
 assert.equal(homeModel(s,[{id:'m',created_at:now-1}],now).latest?.request.id,'done');
 assert.equal(homeModel(snapshot([]),[],now).latest,undefined);
});
