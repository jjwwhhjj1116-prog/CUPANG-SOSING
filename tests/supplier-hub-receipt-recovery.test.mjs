import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {readAppSupplierHubReceipt,readAppSupplierHubStoredReceipt,assertAppSupplierHubNotSubmitted} from '../extensions/supplier-hub/receipt-recovery.mjs';

const identity={origin:'http://localhost:3000',productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64)};
const binding={appTabId:7,windowId:17},company={code:'A01464742',name:'와이홉'};
function receipt(patch={}){return {schemaVersion:1,evidence:'chrome-observation',profileId:'profile',categoryId:identity.categoryId,fingerprint:identity.fingerprint,
 result:{company,includedOptions:6,filename:`YOOFAM-${identity.fingerprint}.xlsx`,quotationId:'quote-123',state:'validation-complete',registered:false,observedAt:Date.now(),registration:{rows:[{skuId:'old'}]}},...patch};}
function content(options={}){
 const calls=[],listeners=[];let expire;
 const value=options.receipt===null?null:receipt(options.receipt);
 const context={URL,Date,AbortController,setTimeout:options.hold?callback=>{expire=callback;return 1;}:setTimeout,clearTimeout:options.hold?()=>{}:clearTimeout,location:{origin:options.origin??identity.origin},
  window:{addEventListener(){},postMessage(){}},chrome:{runtime:{id:'extension',onMessage:{addListener(listener){listeners.push(listener);}}}},
  fetch:async(path,init)=>{
   calls.push({path,init});
   if(options.hold)return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
   const body=init.method==='GET'?{receipt:value}:{fingerprint:identity.fingerprint,filename:`YOOFAM-${identity.fingerprint}.xlsx`,report:{productId:identity.productId,categoryId:identity.categoryId,profileId:'profile',company:value?.result.company??company,rowCount:6,submissionReady:false,...options.source}};
   const response=new Response(options.text??JSON.stringify(body),{status:options.status??200});
   Object.defineProperty(response,'url',{value:options.url??identity.origin+path});Object.defineProperty(response,'redirected',{value:options.redirected??false});return response;
  }};
 vm.runInNewContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8'),context);
 return {calls,run:expected=>context.readCurrentQuotationReceipt(expected??identity),stored:()=>context.readCurrentQuotationReceipt(identity,false),listener:listeners[0],expire:()=>expire()};
}

test('content reads only its owner-scoped receipt then verifies the same saved form and six options without exporting files',async()=>{
 for(const approved of [company,{code:'A01526306',name:'유앤채'}]){
  const value=receipt();value.result.company={...approved,private:'must-not-copy'};
  const h=content({receipt:value}),reply=await h.run();assert.equal(reply.ok,true);
  assert.equal(reply.receipt.result.quotationId,'quote-123');assert.equal(reply.receipt.result.includedOptions,6);
  assert.deepEqual(JSON.parse(JSON.stringify(reply.receipt.result.company)),approved);assert.equal(reply.receipt.result.registration,undefined);
  assert.equal(h.calls.length,2);assert.equal(h.calls[0].path,`/api/products/p/supplier-hub-receipt?fingerprint=${identity.fingerprint}`);
  for(const {init} of h.calls){assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');}
  assert.equal(h.calls[0].init.method,'GET');assert.deepEqual(JSON.parse(h.calls[1].init.body),{action:'source',profileId:'profile'});
 }
 const empty=content({receipt:null});assert.equal((await empty.run()).receipt,null);assert.equal(empty.calls.length,1);
});

test('content rejects malformed, foreign, incomplete and changed receipts instead of falling back to upload',async()=>{
 const complete=receipt();
 for(const options of [{receipt:{schemaVersion:2}},{receipt:{evidence:'made-up'}},{receipt:{profileId:'../profile'}},{receipt:{categoryId:'999'}},{receipt:{fingerprint:'b'.repeat(64)}},
  ...[{state:'validation-pending'},{quotationId:' quote-123'},{quotationId:'x'.repeat(201)},{filename:'other.xlsx'},{includedOptions:0},{registered:true},{observedAt:0},
    {observedAt:Date.now()+61000},{company:{code:company.code,name:'유앤채'}}].map(patch=>({receipt:{result:{...complete.result,...patch}}})),
  {source:{rowCount:5}},{source:{company:{code:'A01526306',name:'유앤채'}}},{source:{profileId:'other'}},
  {status:401},{url:'http://localhost:3000/login'},{url:'https://other.test/api/products/p/supplier-hub-receipt'},{redirected:true},{text:'bad json'},{text:'x'.repeat(1024*1024+1)}]){
  const h=content(options);await assert.rejects(h.run());assert.ok(h.calls.length<=2);
 }
 for(const expected of [{...identity,origin:'https://other.test'},{...identity,productId:'../p'},{...identity,categoryId:'x'}]){const h=content();await assert.rejects(h.run(expected));assert.equal(h.calls.length,0);}
 const h=content({origin:'https://other.test'});await assert.rejects(h.run());assert.equal(h.calls.length,0);
});

test('receipt runtime reads are restricted to this extension and never arrive from a page message',async()=>{
 const h=content();let replies=0;
 assert.equal(h.listener({type:'YOOFAM_READ_QUOTATION_RECEIPT',expected:identity},{id:'foreign'},()=>replies++),undefined);
 assert.equal(replies,0);assert.equal(h.calls.length,0);
 const result=await new Promise(resolve=>assert.equal(h.listener({type:'YOOFAM_READ_QUOTATION_RECEIPT',expected:identity},{id:'extension'},resolve),true));assert.equal(result.ok,true);
});
test('an unresponsive receipt API is aborted without a second source request',async()=>{
 const h=content({hold:true}),reading=h.run();h.expire();await assert.rejects(reading,/aborted/);assert.equal(h.calls.length,1);
});

function worker(options={}){
 const calls=[];let gets=0;
 const api={tabs:{get:async()=>{calls.push('get');return {id:7,windowId:17,url:identity.origin+'/',...(options.moved&&++gets===2?{windowId:18}:{}),...options.tab};},
  sendMessage:async(id,message,frame)=>{calls.push({id,message,frame});return {ok:true,...message.expected,checkedAt:Date.now(),
    ...(['YOOFAM_READ_QUOTATION_RECEIPT','YOOFAM_READ_TRANSMISSION_RECEIPT'].includes(message.type)?{receipt:options.receipt===null?null:receipt(options.receipt)}:{}),...options.reply};}}};
 return {api,calls,run:()=>readAppSupplierHubReceipt(identity,binding,api),stored:()=>readAppSupplierHubStoredReceipt(identity,binding,api)};
}
test('worker restores only the accepted ID contract and discards old rows and arbitrary receipt fields',async()=>{
 const h=worker(),saved=await h.run();assert.equal(saved.receiptRecovered,true);assert.equal(saved.profileId,'profile');assert.equal(saved.quotationId,'quote-123');assert.equal(saved.registration,undefined);
 assert.deepEqual(h.calls.filter(value=>typeof value==='object').map(value=>value.message.type),['YOOFAM_READ_QUOTATION_RECEIPT','YOOFAM_VERIFY_QUOTATION_SOURCE']);
 for(const call of h.calls.filter(value=>typeof value==='object')){assert.equal(call.id,7);assert.deepEqual(call.frame,{frameId:0});assert.equal(call.message.expected.base64,undefined);}
 assert.equal(await worker({receipt:null}).run(),null);
});
test('worker rejects moved app tabs, old verification clocks and mismatched reply identities',async()=>{
 for(const options of [{moved:true},{tab:{url:'https://other.test/'}},{reply:{ok:false}},{reply:{categoryId:'999'}},{reply:{productId:'other'}},
  {reply:{checkedAt:Date.now()-61000}},{receipt:{profileId:'../profile'}},{receipt:{fingerprint:'b'.repeat(64)}}])await assert.rejects(worker(options).run());
});

test('preflight reads preserve pending and rejected states while accepted-ID lookup remains strict',async()=>{
 for(const state of ['validation-pending','validation-rejected']){
  const value=receipt();value.result={...value.result,state,quotationId:undefined,status:'확인 중',detail:'원래 응답'};
  const h=content({receipt:value});const reply=await new Promise(resolve=>assert.equal(h.listener({type:'YOOFAM_READ_TRANSMISSION_RECEIPT',expected:identity},{id:'extension'},resolve),true));
  assert.equal(reply.ok,true);assert.equal(reply.receipt.result.state,state);assert.equal(reply.receipt.result.quotationId,undefined);assert.equal(reply.receipt.result.detail,'원래 응답');
  assert.equal(reply.receipt.result.registration,undefined);assert.equal(h.calls.length,2);
  await assert.rejects(content({receipt:value}).run());await assert.rejects(worker({receipt:value}).run());
  const native=worker({receipt:value}),saved=await native.stored();assert.equal(saved.state,state);assert.equal(saved.receiptRecovered,true);
  assert.deepEqual(native.calls.filter(v=>typeof v==='object').map(v=>v.message.type),['YOOFAM_READ_TRANSMISSION_RECEIPT','YOOFAM_VERIFY_QUOTATION_SOURCE']);
 }
});

test('preflight never interprets unreadable or mismatched server receipts as permission to attach',async()=>{
 const prepared={profileId:'profile',company,includedOptions:6};
 for(const options of [{reply:{ok:false}},{reply:{receipt:undefined}},{reply:{checkedAt:Date.now()-61000}},
  {receipt:{result:{...receipt().result,state:'unknown'}}},{receipt:{result:{...receipt().result,detail:'x'.repeat(20001)}}}]){
  const h=worker(options);let writes=0;
  await assert.rejects(assertAppSupplierHubNotSubmitted(identity,prepared,binding,h.api,async()=>{writes++;}),error=>error.code==='SUPPLIER_HUB_RECEIPT_UNCONFIRMED');assert.equal(writes,0);
 }
 for(const options of [{receipt:{result:{...receipt().result,includedOptions:5}}},{receipt:{profileId:'other'}}]){
  const h=worker(options);let writes=0;await assert.rejects(assertAppSupplierHubNotSubmitted(identity,prepared,binding,h.api,async()=>{writes++;}),error=>error.code==='SUPPLIER_HUB_RECEIPT_UNCONFIRMED');assert.equal(writes,0);
 }
 assert.equal(await assertAppSupplierHubNotSubmitted(identity,prepared,binding,worker({receipt:null}).api,async()=>{throw Error('must not claim');}),true);
 const h=worker();let claims=0;await assert.rejects(assertAppSupplierHubNotSubmitted(identity,prepared,binding,h.api,async(action,key,value)=>{
  claims++;assert.equal(action,'claim');assert.ok(key.startsWith('result:'));assert.equal(value.quotationId,'quote-123');return false;
 }),error=>error.code==='SUPPLIER_HUB_ALREADY_SUBMITTED');assert.equal(claims,1);
});

test('stored receipt content rejects invalid bodies and untrusted runtime callers',async()=>{
 for(const options of [{status:503},{redirected:true},{receipt:{result:{...receipt().result,state:'unknown'}}},
  {source:{rowCount:5}},{text:'not json'},{text:'x'.repeat(1024*1024+1)}])await assert.rejects(content(options).stored());
 const h=content();assert.equal(h.listener({type:'YOOFAM_READ_TRANSMISSION_RECEIPT',expected:identity},{id:'foreign'},()=>assert.fail('foreign reply')),undefined);assert.equal(h.calls.length,0);
});
