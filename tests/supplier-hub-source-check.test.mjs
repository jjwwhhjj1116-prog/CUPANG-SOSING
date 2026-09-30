import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {verifyAppQuotationSource} from '../extensions/supplier-hub/source-check.mjs';

const origin='https://sourceflow.jjwwhhjj1116.workers.dev',fingerprint='a'.repeat(64);
const identity={origin,productId:'product',categoryId:'80719',fingerprint};
const binding={appTabId:7,windowId:17};
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
const prepared=company=>({profileId:'profile',company});
const expected=company=>({...identity,profileId:'profile',filename:`YOOFAM-${fingerprint}.xlsx`,company});
function worker({tabPatch={},resultPatch={},moved=false,closed=false}={}){
 const calls=[];let reads=0;
 const api={tabs:{get:async id=>{calls.push(['get',id]);reads++;if(closed)throw Error('closed');return {id:7,windowId:17,url:origin+'/',...tabPatch,...(moved&&reads===2?{windowId:18}:{})};},
  sendMessage:async(id,message,frame)=>{calls.push(['message',id,message,frame]);return {ok:true,...message.expected,checkedAt:Date.now(),...resultPatch};}}};
 return {api,calls};
}

test('source check uses only the original app tab and bounded identity for both approved companies',async()=>{
 for(const company of companies){
  const h=worker();assert.equal(await verifyAppQuotationSource({...identity,base64:'do-not-copy-zip',createdAt:123},prepared(company),binding,h.api),true);
  assert.deepEqual(h.calls.map(([action])=>action),['get','message','get']);
  const [,id,message,frame]=h.calls[1];assert.equal(id,7);assert.deepEqual(frame,{frameId:0});
  assert.deepEqual(message,{type:'YOOFAM_VERIFY_QUOTATION_SOURCE',expected:expected(company)});
 }
});

test('missing bindings, legacy profiles, wrong accounts, moved and closed app tabs stop source checks',async()=>{
 for(const [who,files,where,options] of [
  [{...identity,origin:'https://other.test'},prepared(companies[0]),binding,{}],
  [identity,{company:companies[0]},binding,{}],
  [identity,prepared({code:'A01464742',name:'유앤채'}),binding,{}],
  [identity,prepared(companies[0]),{appTabId:7},{}],
  [identity,prepared(companies[0]),binding,{tabPatch:{id:8}}],
  [identity,prepared(companies[0]),binding,{tabPatch:{windowId:18}}],
  [identity,prepared(companies[0]),binding,{tabPatch:{url:'https://supplier.coupang.com/qvt/registration'}}],
  [identity,prepared(companies[0]),binding,{closed:true}],
 ]){
  const h=worker(options);await assert.rejects(verifyAppQuotationSource(who,files,where,h.api));assert.equal(h.calls.some(([name])=>name==='message'),false);
 }
 const moved=worker({moved:true});await assert.rejects(verifyAppQuotationSource(identity,prepared(companies[0]),binding,moved.api),/Chrome 창/);
});

test('every returned source identity and recent verification time must match the prepared package',async()=>{
 for(const resultPatch of [{ok:false,error:'saved source changed'},{fingerprint:'b'.repeat(64)},{productId:'other'},{categoryId:'81221'},
  {profileId:'other'},{filename:'old.xlsx'},{company:companies[1]},{checkedAt:0},{checkedAt:Date.now()-61000},{checkedAt:Date.now()+61000}]){
  const h=worker({resultPatch});await assert.rejects(verifyAppQuotationSource(identity,prepared(companies[0]),binding,h.api));
 }
});

function content({responsePatch={},reportPatch={},status=200,urlPatch,redirected=false,text,originPatch,hold=false}={}){
 const calls=[],listeners=[],windows=[];let expire;
 const requested=expected(companies[0]);
 const payload={fingerprint,filename:requested.filename,report:{productId:'product',categoryId:'80719',profileId:'profile',company:companies[0],submissionReady:false,...reportPatch},...responsePatch};
 const context={window:{addEventListener(type,listener){windows.push(listener);},postMessage(data,target){calls.push(['post',data,target]);}},
  location:{origin:originPatch??origin},chrome:{runtime:{id:'extension',onMessage:{addListener(listener){listeners.push(listener);}}}},
  URL,Date,AbortController,setTimeout(callback){expire=callback;return 1;},clearTimeout(){calls.push(['clear']);},
  fetch:async(path,init)=>{
   calls.push(['fetch',path,init]);
   if(hold)return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
   const response=new Response(text??JSON.stringify(payload),{status});
   Object.defineProperty(response,'url',{value:urlPatch??origin+path});Object.defineProperty(response,'redirected',{value:redirected});return response;
  }};
 vm.runInNewContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8'),context);
 return {calls,requested,run:request=>context.verifyCurrentQuotationSource(request??requested),listener:listeners[0],windows,context,expire:()=>expire()};
}

test('content source check calls the same-origin read-only API without exporting or sharing session credentials',async()=>{
 const h=content({reportPatch:{company:{...companies[0],privateField:'never-copy'}}});
 const result=await h.run();assert.equal(result.ok,true);assert.deepEqual(JSON.parse(JSON.stringify(result.company)),companies[0]);
 const [,path,init]=h.calls[0];assert.equal(path,'/api/products/product/quotation');assert.equal(init.method,'POST');
 assert.deepEqual(JSON.parse(init.body),{action:'source',profileId:'profile'});assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
 assert.equal(Object.hasOwn(result,'report'),false);assert.equal(Object.hasOwn(result,'rows'),false);assert.equal(h.calls.at(-1)[0],'clear');
});

test('content source check rejects account/category/profile/source changes and invalid response locations',async()=>{
 for(const options of [{reportPatch:{company:companies[1]}},{reportPatch:{productId:'other'}},{reportPatch:{categoryId:'81221'}},{reportPatch:{profileId:'other'}},
  {reportPatch:{submissionReady:true}},{responsePatch:{fingerprint:'b'.repeat(64)}},{responsePatch:{filename:'other.xlsx'}},{status:401},
  {urlPatch:'https://other.test/api/products/product/quotation'},{urlPatch:origin+'/login'},{redirected:true},{text:'not json'},{text:'x'.repeat(64001)}]){
  const h=content(options);await assert.rejects(h.run());assert.equal(h.calls.at(-1)[0],'clear');
 }
 for(const request of [{...expected(companies[0]),origin:'https://other.test'},{...expected(companies[0]),productId:'../p'},
  {...expected(companies[0]),company:companies[1],filename:'other.xlsx'}]){
  const h=content();await assert.rejects(h.run(request));assert.equal(h.calls.length,0);
 }
 const h=content({originPatch:'https://other.test'});await assert.rejects(h.run());assert.equal(h.calls.length,0);
});

test('content runtime listener ignores other extensions and expires a hung API request',async()=>{
 const h=content();let replies=0;
 assert.equal(h.listener({type:'YOOFAM_VERIFY_QUOTATION_SOURCE',expected:h.requested},{id:'foreign'},()=>replies++),undefined);
 assert.equal(h.listener({type:'OTHER',expected:h.requested},{id:'extension'},()=>replies++),undefined);assert.equal(replies,0);assert.equal(h.calls.length,0);
 const result=await new Promise(resolve=>assert.equal(h.listener({type:'YOOFAM_VERIFY_QUOTATION_SOURCE',expected:h.requested},{id:'extension'},resolve),true));assert.equal(result.ok,true);
 const held=content({hold:true}),checking=held.run();held.expire();await assert.rejects(checking,/aborted/);assert.equal(held.calls.at(-1)[0],'clear');
});

test('bridge advertises current-source binding together with direct transmission capability',async()=>{
 const h=content();
 await h.windows[0]({source:h.context.window,origin,data:{channel:'YOOFAM_HUB_HANDOFF',type:'PING',requestId:'a'.repeat(36)}});
 const reply=h.calls.find(([name])=>name==='post');assert.equal(reply[1].result.version,'0.2.28');assert.equal(reply[1].result.latestSourceBinding,true);assert.equal(reply[1].result.directTransmission,true);assert.equal(reply[1].result.savedSubmission,true);
});
