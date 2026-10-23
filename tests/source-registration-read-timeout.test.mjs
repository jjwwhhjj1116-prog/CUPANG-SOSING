import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceReviewHookFixture,reviewSourceFixture} from './helpers/source-review-intake.mjs';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const item=reviewSourceFixture().before;

test('list timeout preserves prior rows with an explicit stale warning and the next foreground can recover',async()=>{
 let count=0;const h=sourceReviewHookFixture(async(_url,init)=>{
  if(++count===2)return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
  return Response.json({ownerId:'owner',company:item.company,items:[{...item,captureVersion:count===1?5:6}]});
 });
 try{h.render();await turn();assert.equal(h.render().items[0].captureVersion,5);h.event();h.expire(15000);await turn();assert.equal(h.render().items[0].captureVersion,5);assert.match(h.render().error,/응답이 지연.*최신 수집본이 없을 수/);assert.equal(h.calls[1].init.signal.aborted,true);
  h.event();await turn();assert.equal(h.render().items[0].captureVersion,6);assert.equal(h.render().error,'');
 }finally{h.close();}
});

test('503 is visibly stale and an old owner timeout cannot publish data or an error in a new scope',async()=>{
 let count=0;const h=sourceReviewHookFixture(async(_url,init)=>{
  count++;if(count===1)return Response.json({ownerId:'owner',items:[item]});if(count===2)return new Response('temporarily unavailable',{status:503});
  return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
 });
 try{h.render();await turn();h.event();await turn();assert.equal(h.render().items[0].id,item.id);assert.match(h.render().error,/이전 목록에 최신 수집본이 없을 수/);h.event();h.owner('other');await turn();assert.equal(h.render().items.length,0);assert.equal(h.render().error,'');}
 finally{h.close();}
});
