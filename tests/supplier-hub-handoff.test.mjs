import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
const code=ts.transpileModule(fs.readFileSync(new URL('../app/supplier-hub-handoff.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(reply){
  const listeners=new Set(),timers=new Set(),sent=[];
  const win={location:{origin:'https://sourceflow.jjwwhhjj1116.workers.dev'},addEventListener:(_,cb)=>listeners.add(cb),removeEventListener:(_,cb)=>listeners.delete(cb),postMessage(message){sent.push(message);queueMicrotask(()=>reply?.(message,emit));}};
  const emit=(message,result,overrides={})=>{for(const listener of [...listeners])listener({source:win,origin:win.location.origin,data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:message.requestId,result},...overrides});};
  const exports={};vm.runInNewContext(code,{exports,window:win,crypto:webcrypto,Uint8Array,btoa,Error,setTimeout:cb=>{timers.add(cb);return cb;},clearTimeout:cb=>timers.delete(cb)});
  return {api:exports,sent,listeners,timers,expire(){for(const cb of [...timers])cb();}};
}
const identity={productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64)};

test('only missing replies to read-only result requests have a retryable error type',async()=>{
 for(const type of ['RESULT','REFRESH','REGISTRATION','PING','PREPARE','TRANSMIT','VALIDATE','CATEGORIES','SCHEMA','TEMPLATE']){
  const h=harness(),pending=h.api.exchange(type,identity,new AbortController().signal);
  const rejected=assert.rejects(pending,error=>error instanceof Error&&(error instanceof h.api.SupplierHubLookupUnavailable)===['RESULT','REFRESH','REGISTRATION'].includes(type));
  h.expire();await rejected;assert.equal(h.sent.length,1);assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
 }
});

test('explicit extension errors and cancelled reads are fatal instead of retryable',async()=>{
 const h=harness((message,emit)=>emit(message,{ok:false,error:'회사코드 불일치'}));
 await assert.rejects(h.api.exchange('REGISTRATION',identity,new AbortController().signal),error=>!(error instanceof h.api.SupplierHubLookupUnavailable)&&/회사코드/.test(error.message));
 const cancelled=harness(),controller=new AbortController(),pending=cancelled.api.exchange('REFRESH',identity,controller.signal);
 const rejected=assert.rejects(pending,error=>!(error instanceof cancelled.api.SupplierHubLookupUnavailable));controller.abort();await rejected;
 for(const current of [h,cancelled]){assert.equal(current.listeners.size,0);assert.equal(current.timers.size,0);}
});

test('a late abandoned reply cannot acknowledge the next lookup request',async()=>{
 let oldRequest,emitReply;const h=harness((message,emit)=>{oldRequest??=message;emitReply=emit;});
 const first=h.api.exchange('REFRESH',identity,new AbortController().signal);const rejected=assert.rejects(first,h.api.SupplierHubLookupUnavailable);
 await Promise.resolve();h.expire();await rejected;
 let settled=false;const next=h.api.exchange('REFRESH',identity,new AbortController().signal).then(value=>{settled=true;return value;});
 await Promise.resolve();assert.notEqual(h.sent[0].requestId,h.sent[1].requestId);
 emitReply(oldRequest,{ok:true,marker:'stale'});await Promise.resolve();assert.equal(settled,false);assert.equal(h.listeners.size,1);
 emitReply(h.sent[1],{ok:true,marker:'fresh'});assert.equal((await next).marker,'fresh');assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
});
test('validation resumption uses identity and fresh choices only, enforces extension capability and rejects false acknowledgements',async()=>{
 const reviewed={priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:true};
 const capability={ok:true,validationResume:true,latestSourceBinding:true,serverReceiptReplayProtection:true};
 const h=harness((m,emit)=>emit(m,m.type==='PING'?capability:{ok:true,fingerprint:identity.fingerprint,registered:false,result:{state:'validation-requested',registered:false}}));
 assert.equal((await h.api.resumeSupplierHubValidation(identity,reviewed,new AbortController().signal)).state,'validation-requested');
 assert.deepEqual(h.sent.map(m=>m.type),['PING','VALIDATE']);assert.deepEqual(JSON.parse(JSON.stringify(h.sent[1].payload)),{...identity,reviewedAgreements:reviewed});assert.equal(h.sent[1].payload.base64,undefined);
 assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
 const old=harness((m,emit)=>emit(m,{...capability,validationResume:false}));await assert.rejects(old.api.resumeSupplierHubValidation(identity,reviewed,new AbortController().signal),/0.2.39/);assert.deepEqual(old.sent.map(m=>m.type),['PING']);
 for(const result of [{state:'partial',registered:false},{state:'validation-requested',registered:true},{state:'attached',registered:false,error:7}]){
  const bad=harness((m,emit)=>emit(m,m.type==='PING'?capability:{ok:true,fingerprint:identity.fingerprint,registered:false,result}));await assert.rejects(bad.api.resumeSupplierHubValidation(identity,reviewed,new AbortController().signal),/응답/);
 }
});
test('new file delivery requires server receipt checks before preparing or transmitting',async()=>{
 for(const direct of [false,true]){
  const h=harness((m,emit)=>emit(m,{ok:true,companyBinding:true,directTransmission:true,latestSourceBinding:true,durableAttachmentRecovery:true,imageIntegrityBinding:true}));
  await assert.rejects(h.api.checkSupplierHubExtension(new AbortController().signal,direct),/0.2.34/);assert.deepEqual(h.sent.map(m=>m.type),['PING']);
 }
});
test('registration evidence stays bound to quotation ID and a bounded visible page',()=>{
 const api=harness().api;
 const value={quotationId:'123',scope:'visible-page',registered:false,observedAt:Date.now(),includedOptions:2,rows:[{title:'상품',submittedAt:'date',category:'cat',barcode:'',sourceQuotation:'file',skuId:'1',status:'상품 검수 완료',stage:'발주서 발행'}]};
 assert.equal(api.validateRegistrationResult(value,'123').registered,false);
 for(const patch of [{quotationId:'other'},{scope:'all'},{registered:true},{observedAt:Infinity},{includedOptions:0},{includedOptions:201},{rows:[{}]},{rows:Array(1001).fill(value.rows[0])}])assert.throws(()=>api.validateRegistrationResult({...value,...patch},'123'));
});

test('multi-page evidence validates actual coverage without treating it as registered',()=>{
 const api=harness().api;
 const value={quotationId:'123',scope:'queried-pages',registered:false,observedAt:Date.now(),includedOptions:2,pagesRead:2,hasMore:false,rows:[]};
 assert.equal(api.validateRegistrationResult(value,'123').pagesRead,2);
 for(const patch of [{pagesRead:0},{pagesRead:201},{pagesRead:1.5},{hasMore:undefined},{hasMore:'false'},{includedOptions:undefined},{scope:'visible-page'}])assert.throws(()=>api.validateRegistrationResult({...value,...patch},'123'));
 for(const hasMore of [true,null])assert.equal(api.validateRegistrationResult({...value,hasMore},'123').hasMore,hasMore);
});
test('web package handoff sends exact reviewed identity and bytes, cleans listeners',async()=>{
  const h=harness((m,emit)=>emit(m,m.type==='PING'?{ok:true,companyBinding:true,latestSourceBinding:true,durableAttachmentRecovery:true,imageIntegrityBinding:true,serverReceiptReplayProtection:true}:{ok:true,fingerprint:identity.fingerprint,registered:false}));
  await h.api.checkSupplierHubExtension(new AbortController().signal);
  await h.api.prepareSupplierHubHandoff(new Blob(['ZIP fixture']),identity,new AbortController().signal);
  assert.equal(h.sent[0].type,'PING');assert.equal(h.sent[1].payload.fingerprint,identity.fingerprint);
  assert.equal(Buffer.from(h.sent[1].payload.base64,'base64').toString(),'ZIP fixture');assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
});
test('foreign-window and foreign-origin responses cannot acknowledge handoff',async()=>{
  const h=harness((m,emit)=>{emit(m,{ok:true},{source:{}});emit(m,{ok:true},{origin:'https://evil.example'});});
  const pending=h.api.checkSupplierHubExtension(new AbortController().signal);await Promise.resolve();assert.equal(h.listeners.size,1);h.expire();await assert.rejects(pending,/설치/);assert.equal(h.listeners.size,0);
});
test('mismatched acknowledgement, oversized payload, cancellation and extension error fail without retries',async()=>{
  const h=harness((m,emit)=>emit(m,{ok:true,fingerprint:'b'.repeat(64),registered:false}));
  await assert.rejects(()=>h.api.prepareSupplierHubHandoff(new Blob(['x']),identity,new AbortController().signal),/다릅니다/);assert.equal(h.sent.length,1);
  await assert.rejects(()=>h.api.prepareSupplierHubHandoff({size:31*1024*1024},identity,new AbortController().signal),/30MB/);assert.equal(h.sent.length,1);
  const idle=harness(),controller=new AbortController(),pending=idle.api.checkSupplierHubExtension(controller.signal);controller.abort();await assert.rejects(pending,/취소/);assert.equal(idle.listeners.size,0);
  const failed=harness((m,emit)=>emit(m,{ok:false,error:'저장 실패'}));await assert.rejects(()=>failed.api.checkSupplierHubExtension(new AbortController().signal),/저장 실패/);assert.equal(failed.sent.length,1);
});

test('result retrieval uses exact reviewed identity and never promotes validation to registration',async()=>{
  const record={...identity,origin:'https://sourceflow.jjwwhhjj1116.workers.dev',filename:`YOOFAM-${identity.fingerprint}.xlsx`,state:'validation-complete',status:'완료',quotationId:'123',observedAt:Date.now(),registered:false};
  const h=harness((m,emit)=>emit(m,{ok:true,fingerprint:identity.fingerprint,record,registered:false}));
  const result=await h.api.getSupplierHubResult(identity,new AbortController().signal);
  assert.equal(h.sent[0].type,'RESULT');assert.equal(result.quotationId,'123');assert.equal(result.registered,false);assert.equal(h.listeners.size,0);
  for(const change of [{productId:'other'},{categoryId:'999'},{fingerprint:'b'.repeat(64)},{filename:'different.xlsx'},{registered:true},{observedAt:NaN},{state:'registered'},{detail:{}}]){
    const wrong=harness((m,emit)=>emit(m,{ok:true,fingerprint:identity.fingerprint,record:{...record,...change},registered:false}));
    await assert.rejects(()=>wrong.api.getSupplierHubResult(identity,new AbortController().signal));
  }
  const missing=harness((m,emit)=>emit(m,{ok:true,fingerprint:identity.fingerprint,record:null,registered:false}));
  assert.equal(await missing.api.getSupplierHubResult(identity,new AbortController().signal),null);
});
test('result retrieval keeps the submitted option count bound to the observed quotation',async()=>{
 const record={...identity,origin:'https://sourceflow.jjwwhhjj1116.workers.dev',filename:`YOOFAM-${identity.fingerprint}.xlsx`,state:'validation-complete',quotationId:'123',observedAt:Date.now(),registered:false,includedOptions:3,
  registration:{quotationId:'123',scope:'visible-page',observedAt:Date.now(),registered:false,includedOptions:3,rows:[{title:'상품',submittedAt:'date',category:'cat',barcode:'',sourceQuotation:'file',skuId:'sku',status:'검수중',stage:'확인중'}]}};
 const response=value=>harness((m,emit)=>emit(m,{ok:true,fingerprint:identity.fingerprint,record:value,registered:false})).api.getSupplierHubResult(identity,new AbortController().signal);
 assert.equal((await response(record)).registration.includedOptions,3);
 await assert.rejects(response({...record,registration:{...record.registration,includedOptions:2}}),/옵션 수/);
 await assert.rejects(response({...record,includedOptions:undefined}),/옵션 수/);
 await assert.rejects(response({...record,includedOptions:201}),/검토한 상품/);
});

test('old extension without company binding cannot prepare a new handoff',async()=>{
 const h=harness((m,emit)=>emit(m,{ok:true,version:'0.2.17'}));
 await assert.rejects(h.api.checkSupplierHubExtension(new AbortController().signal),/0.2.18/);
 assert.equal(h.sent.length,1);
});

test('direct transmission requires the new capability and sends the current reviewed choices once',async()=>{
 const reviewed={priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:true};
 const h=harness((m,emit)=>emit(m,m.type==='PING'?{ok:true,companyBinding:true,directTransmission:true,latestSourceBinding:true,durableAttachmentRecovery:true,imageIntegrityBinding:true,serverReceiptReplayProtection:true}:{ok:true,fingerprint:identity.fingerprint,registered:false,result:{state:'validation-requested',validated:false,registered:false}}));
 await h.api.checkSupplierHubExtension(new AbortController().signal,true);
 assert.equal((await h.api.transmitSupplierHubPackage(new Blob(['zip']),identity,reviewed,new AbortController().signal)).state,'validation-requested');
 assert.equal(h.sent[1].type,'TRANSMIT');assert.equal(h.sent[1].payload.productId,identity.productId);assert.equal(h.sent[1].payload.reviewedAgreements,reviewed);
 assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
 const old=harness((m,emit)=>emit(m,{ok:true,companyBinding:true}));await assert.rejects(old.api.checkSupplierHubExtension(new AbortController().signal,true),/0.2.23/);
 await assert.rejects(h.api.transmitSupplierHubPackage(new Blob(['zip']),identity,{...reviewed,priceData:false},new AbortController().signal),/필수/);assert.equal(h.sent.length,2);
});

test('required evidence requires extension support before sending bytes and rejects conflicting review',async()=>{
 const reviewed={priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:false,legalDocumentsRequired:true};
 const old=harness((m,emit)=>emit(m,{ok:true}));
 await assert.rejects(old.api.transmitSupplierHubPackage(new Blob(['zip']),identity,reviewed,new AbortController().signal),/0.2.38/);
 assert.deepEqual(old.sent.map(m=>m.type),['PING']);
 const h=harness((m,emit)=>emit(m,m.type==='PING'?{ok:true,legalDocumentAttachments:true}:{ok:true,fingerprint:identity.fingerprint,registered:false,result:{state:'validation-requested',registered:false}}));
 assert.equal((await h.api.transmitSupplierHubPackage(new Blob(['zip']),identity,reviewed,new AbortController().signal)).state,'validation-requested');
 assert.deepEqual(h.sent.map(m=>m.type),['PING','TRANSMIT']);assert.equal(h.sent[1].payload.reviewedAgreements,reviewed);
 await assert.rejects(h.api.transmitSupplierHubPackage(new Blob(['zip']),identity,{...reviewed,legalDocumentsNotApplicable:true},new AbortController().signal),/필수/);
 assert.equal(h.sent.length,2);assert.equal(h.listeners.size,0);
});

test('latest-source capability is required for both prepared and direct app transmission',async()=>{
 for(const direct of [false,true]){
  const old=harness((m,emit)=>emit(m,{ok:true,companyBinding:true,directTransmission:true}));
  await assert.rejects(old.api.checkSupplierHubExtension(new AbortController().signal,direct),/0.2.27/);assert.equal(old.sent.length,1);
 }
});

test('new deliveries require durable recovery while existing claims remain readable with the previous version',async()=>{
 for(const direct of [false,true]){
  const old=harness((m,emit)=>emit(m,{ok:true,companyBinding:true,directTransmission:true,latestSourceBinding:true,savedSubmission:true}));
  await assert.rejects(old.api.checkSupplierHubExtension(new AbortController().signal,direct),/0.2.30/);
  assert.equal(old.sent.length,1,'only a capability read is permitted before export or upload');
 }
 const previous=savedReply(savedFixture());
 assert.equal((await previous.api.getSupplierHubSubmission(identity,new AbortController().signal)).attempt.state,'validation-requested');
});

test('new app deliveries require image integrity capability before creating or sending a package',async()=>{
 for(const direct of [false,true]){
  const old=harness((m,emit)=>emit(m,{ok:true,version:'0.2.30',companyBinding:true,directTransmission:true,latestSourceBinding:true,durableAttachmentRecovery:true}));
  await assert.rejects(old.api.checkSupplierHubExtension(new AbortController().signal,direct),/0.2.31/);
  assert.equal(old.sent.length,1);assert.equal(old.sent[0].type,'PING');
 }
});

test('direct transmission rejects unrelated acknowledgements and never retries an uncertain remote request',async()=>{
 const reviewed={priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:true};
 for(const response of [{fingerprint:'b'.repeat(64),registered:false,result:{state:'validation-requested',registered:false}},{fingerprint:identity.fingerprint,registered:false,result:{state:'registered',registered:true}}]){
   const h=harness((m,emit)=>emit(m,{ok:true,...response}));await assert.rejects(h.api.transmitSupplierHubPackage(new Blob(['zip']),identity,reviewed,new AbortController().signal));assert.equal(h.sent.length,1);
 }
 const h=harness();const pending=h.api.transmitSupplierHubPackage(new Blob(['zip']),identity,reviewed,new AbortController().signal);
 await new Promise(resolve=>setImmediate(resolve));h.expire();await assert.rejects(pending,/다시 전송하지/);assert.equal(h.sent.length,1);assert.equal(h.listeners.size,0);
});

test('live refresh uses the current identity rather than only previously stored validation',async()=>{
 const record={...identity,origin:'https://sourceflow.jjwwhhjj1116.workers.dev',filename:`YOOFAM-${identity.fingerprint}.xlsx`,state:'validation-pending',observedAt:Date.now(),registered:false};
 const h=harness((m,emit)=>emit(m,{ok:true,fingerprint:identity.fingerprint,registered:false,record}));
 assert.equal((await h.api.getSupplierHubResult(identity,new AbortController().signal,true)).state,'validation-pending');assert.equal(h.sent[0].type,'REFRESH');assert.equal(h.sent[0].payload.fingerprint,identity.fingerprint);
});

test('app registration lookup needs its capability and returns only matching refreshed rows',async()=>{
 const record={...identity,origin:'https://sourceflow.jjwwhhjj1116.workers.dev',filename:`YOOFAM-${identity.fingerprint}.xlsx`,state:'validation-complete',quotationId:'123',observedAt:Date.now(),registered:false,includedOptions:3,
  registration:{quotationId:'123',scope:'visible-page',observedAt:Date.now(),registered:false,includedOptions:3,rows:[]}};
 const h=harness((m,emit)=>emit(m,m.type==='PING'?{ok:true,companyBinding:true,registrationLookup:true,registrationPages:true}:{ok:true,fingerprint:identity.fingerprint,record,registered:false}));
 assert.equal((await h.api.getSupplierHubResult(identity,new AbortController().signal,'registration')).registration.quotationId,'123');
 assert.deepEqual(h.sent.map(message=>message.type),['PING','REGISTRATION']);assert.deepEqual(h.sent[1].payload,identity);
 const old=harness((m,emit)=>emit(m,{ok:true,companyBinding:true,directTransmission:true}));
 await assert.rejects(old.api.getSupplierHubResult(identity,new AbortController().signal,'registration'),/0.2.26/);assert.equal(old.sent.length,1);
 for(const patch of [{registration:undefined},{registration:{...record.registration,quotationId:'other'}},{registration:{...record.registration,includedOptions:2}},{state:'validation-pending'}]){
  const bad=harness((m,emit)=>emit(m,m.type==='PING'?{ok:true,companyBinding:true,registrationLookup:true,registrationPages:true}:{ok:true,fingerprint:identity.fingerprint,record:{...record,...patch},registered:false}));
  await assert.rejects(bad.api.getSupplierHubResult(identity,new AbortController().signal,'registration'));assert.equal(bad.sent.length,2);
 }
});

function savedFixture(company={code:'A01464742',name:'와이홉'}){
 const attempt={...identity,origin:'https://sourceflow.jjwwhhjj1116.workers.dev',company,includedOptions:2,startedAt:Date.now(),tabId:123,windowId:17,state:'validation-requested',registered:false};
 const record={...identity,origin:attempt.origin,filename:`YOOFAM-${identity.fingerprint}.xlsx`,company,includedOptions:2,state:'validation-complete',quotationId:'123',observedAt:Date.now(),registered:false};
 return {attempt,record};
}
function savedReply(value,capability={savedSubmission:true}){
 return harness((message,emit)=>emit(message,message.type==='PING'?{ok:true,...capability}:{ok:true,fingerprint:identity.fingerprint,registered:false,...value}));
}
test('cached claim recovery supports both companies and uses only PING plus a stored RESULT',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}]){
  const value=savedFixture(company),h=savedReply(value);
  const result=await h.api.getSupplierHubSubmission(identity,new AbortController().signal);
  assert.equal(result.attempt.company.code,company.code);assert.equal(result.result.quotationId,'123');assert.equal(result.result.registered,false);
  assert.deepEqual(h.sent.map(message=>message.type),['PING','RESULT']);assert.equal(h.sent[1].payload,identity);
  assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
 }
 const empty=savedReply({attempt:null,record:null});
 const result=await empty.api.getSupplierHubSubmission(identity,new AbortController().signal);assert.equal(result.attempt,null);assert.equal(result.result,null);
 const receipt=savedReply({...savedFixture(),attempt:null});assert.equal((await receipt.api.getSupplierHubSubmission(identity,new AbortController().signal)).result.quotationId,'123');
});

test('a claimed upload with no receipt remains an attempt, including uncertain and partial outcomes',async()=>{
 for(const state of ['started','attached','partial','unconfirmed','validation-requested']){
  const value=savedFixture(),h=savedReply({...value,attempt:{...value.attempt,state},record:null});
  const result=await h.api.getSupplierHubSubmission(identity,new AbortController().signal);
  assert.equal(result.attempt.state,state);assert.equal(result.attempt.registered,false);assert.equal(result.result,null);
 }
});

test('old extension, missing claim field, forged identities and invalid claim shapes cannot authorize recovery',async()=>{
 const old=savedReply({attempt:null,record:null},{});
 await assert.rejects(old.api.getSupplierHubSubmission(identity,new AbortController().signal),/0.2.28/);assert.equal(old.sent.length,1);
 const value=savedFixture();
 for(const patch of [{origin:'http://localhost:3000'},{productId:'other'},{categoryId:'999'},{fingerprint:'b'.repeat(64)},{company:null},{company:{code:'__proto__',name:'bad'}},{company:{code:'A01464742',name:'유앤채'}},{includedOptions:0},{includedOptions:201},{includedOptions:1.5},{startedAt:Infinity},{startedAt:Date.now()+120000},{tabId:-1},{windowId:undefined},{registered:true},{state:'not-started'},{state:'registered'},{error:{}}]){
  const h=savedReply({...value,attempt:{...value.attempt,...patch}});
  await assert.rejects(h.api.getSupplierHubSubmission(identity,new AbortController().signal));
  assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
 }
 await assert.rejects(savedReply({record:null}).api.getSupplierHubSubmission(identity,new AbortController().signal));
 await assert.rejects(savedReply({attempt:null}).api.getSupplierHubSubmission(identity,new AbortController().signal));
});

test('saved receipt cannot contradict the persisted claim company, count or exact filename',async()=>{
 const value=savedFixture();
 for(const patch of [{company:undefined},{company:{code:'A01526306',name:'유앤채'}},{includedOptions:1},{filename:'wrong.xlsx'},{productId:'other'},{registered:true}]){
  await assert.rejects(savedReply({...value,record:{...value.record,...patch}}).api.getSupplierHubSubmission(identity,new AbortController().signal));
 }
});

test('manual and recovered source binding also checks option coverage and pinned quotation ID',()=>{
 const api=harness().api,value=savedFixture(),source={filename:value.record.filename,company:value.attempt.company,includedOptions:2,quotationId:'123'};
 api.validateSupplierHubResultForSource(value.record,source);
 for(const patch of [{filename:'wrong.xlsx'},{company:undefined},{company:{code:'A01464742',name:'유앤채'}},{includedOptions:3},{quotationId:'other'},{registered:true},{registration:{includedOptions:2,rows:[{},{},{}]}}])
  assert.throws(()=>api.validateSupplierHubResultForSource({...value.record,...patch},source));
});

test('cancelling cache recovery releases all listeners and never sends a live Hub request',async()=>{
 const h=harness((message,emit)=>{if(message.type==='PING')emit(message,{ok:true,savedSubmission:true});});
 const controller=new AbortController(),pending=h.api.getSupplierHubSubmission(identity,controller.signal);
 await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(pending,/취소/);
 assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);assert.deepEqual(h.sent.map(message=>message.type),['PING','RESULT']);
});
