import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceReviewHookFixture,reviewSourceFixture} from './helpers/source-review-intake.mjs';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const page=reviewSourceFixture().before,company=page.company;
const query={id:'33333333-3333-4333-8333-333333333333',ownerId:'owner',company,fingerprint:'c'.repeat(64),revision:1,captureVersion:2,receivedAt:'2026-11-02T00:00:00.000Z',archivedAt:null,
 sourceUrl:'https://detail.1688.com/offer/700000000799.html',offerId:'700000000799',title:'URL로 보관한 원문 상품',optionCount:2,thumbnailUrl:'https://cbu01.alicdn.com/synthetic-main.jpg'};
const pageReply=()=>Response.json({ownerId:'owner',company,items:[page]});
const queryReply=(captures=[query])=>Response.json({ownerId:'owner',company,captures});

test('unified reads merge independent page/query stores and a saved-query refresh never drops either list',async()=>{
 let captures=[];const h=sourceReviewHookFixture(async url=>url==='/api/source-inbox'?pageReply():queryReply(captures),true);try{
  h.render();await turn();assert.equal(h.render().items[0].id,page.id);assert.deepEqual(Array.from(h.render().queryItems),[]);
  captures=[query];h.render().reload();await turn();assert.equal(h.render().queryItems[0].id,query.id);assert.equal(h.render().items[0].id,page.id);
  h.render().reload();await turn();assert.equal(h.render().queryItems.length,1);assert.ok(h.calls.every(call=>(call.init.method??'GET')==='GET'));
 }finally{h.close();}
});

test('capture updates queued during a query list read are reread and an old-owner query response cannot appear in the new scope',async()=>{
 const releases=[];const h=sourceReviewHookFixture(url=>url==='/api/source-inbox'?pageReply():new Promise(resolve=>releases.push(resolve)),true);try{
  h.render();h.render().reload();assert.equal(releases.length,1);releases.shift()(queryReply([]));await turn();assert.equal(releases.length,1);
  const old=releases.shift();h.owner('next-owner');old(queryReply());await turn();assert.equal(h.render().queryItems.length,0);
  releases.shift()(Response.json({ownerId:'next-owner',company,captures:[]}));await turn();assert.equal(h.render().queryItems.length,0);
 }finally{h.close();}
});

test('malformed or foreign query summaries preserve the prior verified query/page rows and surface a stale notice',async()=>{
 for(const mutation of [row=>({...row,ownerId:'foreign'}),row=>({...row,company:{code:'A01526306',name:'유앤채'}}),row=>({...row,sourceUrl:row.sourceUrl+'?tracking=1'}),row=>({...row,thumbnailUrl:'https://foreign.test/a.png'}),row=>({...row,revision:0}),row=>({...row,archivedAt:'2026-11-02'})]){
  let captures=[query];const h=sourceReviewHookFixture(async url=>url==='/api/source-inbox'?pageReply():queryReply(captures),true);try{
   h.render();await turn();assert.equal(h.render().queryItems.length,1);captures=[mutation(query)];h.render().reload();await turn();
   assert.equal(h.render().queryItems[0].revision,query.revision);assert.equal(h.render().queryItems[0].ownerId,'owner');assert.equal(h.render().items[0].id,page.id);assert.match(h.render().queryError,/이전 목록에 최신 수집본/);
  }finally{h.close();}
 }
});

test('query failure and timeout retain page rows and recover by reads without collecting or promoting a product',async()=>{
 let mode='ready';const h=sourceReviewHookFixture((url,init)=>{
  if(url==='/api/source-inbox')return pageReply();if(mode==='ready')return queryReply();if(mode==='failure')return Response.json({error:'합성 조회 실패'},{status:503});
  return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
 },true);try{
  h.render();await turn();mode='failure';h.render().reload();await turn();assert.equal(h.render().items.length,1);assert.equal(h.render().queryItems.length,1);assert.match(h.render().queryError,/합성 조회 실패/);
  mode='timeout';h.render().reload();h.expire(15000);await turn();assert.equal(h.render().queryItems.length,1);assert.match(h.render().queryError,/응답이 지연/);
  mode='ready';h.render().reload();await turn();assert.equal(h.render().queryError,'');assert.ok(h.calls.every(call=>(call.init.method??'GET')==='GET'));
 }finally{h.close();}
});

test('same-owner company changes discard old rows, cancel late reads and cannot republish another company on failure',async()=>{
 const nextCompany={code:'A01526306',name:'유앤채'},releases=[];let selected=company,fail=false;
 const h=sourceReviewHookFixture(url=>{
  if(url==='/api/source-inbox')return Response.json({ownerId:'owner',company:selected,items:[]});
  if(fail)return Response.json({error:'새 회사 조회 실패'},{status:503});
  return new Promise(resolve=>releases.push({company:selected,resolve}));
 },true,company);try{
  h.render();const first=releases.shift();first.resolve(queryReply());await turn();assert.equal(h.render().queryItems.length,1);
  h.render().reload();const stale=releases.shift();selected=nextCompany;
  assert.equal(h.company(nextCompany).queryItems.length,0);const current=releases.shift(),nextQuery={...query,company:nextCompany,title:'새 회사 수집본'};
  current.resolve(Response.json({ownerId:'owner',company:nextCompany,captures:[nextQuery]}));await turn();assert.equal(h.render().queryItems[0].company.code,nextCompany.code);
  stale.resolve(queryReply());await turn();assert.equal(h.render().queryItems[0].company.code,nextCompany.code);
  selected=company;fail=true;assert.equal(h.company(company).queryItems.length,0);await turn();assert.equal(h.render().queryItems.length,0);assert.match(h.render().queryError,/새 회사 조회 실패/);
 }finally{h.close();}
});
