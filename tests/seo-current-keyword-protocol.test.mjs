import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchSeoKeywords,validateSeoKeywordRequest} from '../extensions/supplier-hub/seo-keywords.mjs';
const sender={url:'http://localhost:3000/registration',frameId:0,tab:{id:1,windowId:2}};
const request={type:'YOOFAM_SEO_KEYWORDS',capability:'couplus-consumer-keywords-v1',requestId:'11111111-1111-4111-8111-111111111111',query:'양 말&키'};
test('keyword protocol rejects foreign frames, origins, missing exact capability, malformed ids and oversize',()=>{
 assert.equal(validateSeoKeywordRequest(request,sender).query,request.query);
 for(const patch of [{capability:'relatedKeywords'},{query:'x'.repeat(201)},{query:'a\n'},{requestId:'wrong'},{headers:{}},{cookie:'secret'}])assert.throws(()=>validateSeoKeywordRequest({...request,...patch},sender));
 for(const patch of [{frameId:1},{url:'https://evil.test'},{tab:{}}])assert.throws(()=>validateSeoKeywordRequest(request,{...sender,...patch}));
});
test('collector owns an inactive search tab, returns bounded preference data and closes only owned tab',async()=>{
 const removed=[],created=[];const api={tabs:{create:async value=>{created.push(value);return{id:987,status:'complete'};},get:async id=>{assert.equal(id,987);return{status:'complete'};},remove:async id=>removed.push(id)},scripting:{executeScript:async value=>{assert.deepEqual(value.target,{tabId:987,frameIds:[0]});assert.equal(value.world,'ISOLATED');assert.deepEqual(value.args,[request.query]);return[{result:{keywords:[request.query,'양말'],warnings:[],rawHtml:'secret must not escape'}}];}}};
 const result=await dispatchSeoKeywords(request,sender,api);assert.equal(created[0].active,false);assert.equal(created[0].windowId,2);assert.match(created[0].url,/q=%EC%96%91%20%EB%A7%90%26%ED%82%A4/);assert.deepEqual(removed,[987]);assert.equal(result.rawHtml,undefined);assert.equal(result.requestId,request.requestId);assert.equal(result.capability,request.capability);
});

test('cancellation closes owned tab and frees shared queue without returning late data',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()+10000});const removed=[];let release;const script=new Promise(resolve=>{release=resolve;});
 const api={tabs:{create:async()=>({id:988}),get:async()=>({status:'complete'}),remove:async id=>removed.push(id)},scripting:{executeScript:async()=>script}};
 const scoped={...request,requestId:'22222222-2222-4222-8222-222222222222'},pending=dispatchSeoKeywords(scoped,sender,api);for(let i=0;i<5;i++)await Promise.resolve();
 const {cancelSeoKeywords}=await import('../extensions/supplier-hub/seo-keywords.mjs');cancelSeoKeywords({type:'YOOFAM_SEO_KEYWORDS_CANCEL',requestId:scoped.requestId},sender);await assert.rejects(pending,/cancelled/);assert.ok(removed.length);assert.ok(removed.every(id=>id===988));release([{result:{keywords:['late'],warnings:[]}}]);for(let i=0;i<4;i++)await Promise.resolve();t.mock.timers.reset();
});
test('30 second outer deadline closes owned tab even if browser script never replies',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()+70000});const removed=[];
 const api={tabs:{create:async()=>({id:989}),get:async()=>({status:'complete'}),remove:async id=>removed.push(id)},scripting:{executeScript:async()=>new Promise(()=>{})}};
 const pending=dispatchSeoKeywords({...request,requestId:'33333333-3333-4333-8333-333333333333'},sender,api);for(let i=0;i<5;i++)await Promise.resolve();const rejected=assert.rejects(pending,/deadline/);t.mock.timers.tick(30000);await rejected;assert.deepEqual(removed,[989]);t.mock.timers.reset();
});
