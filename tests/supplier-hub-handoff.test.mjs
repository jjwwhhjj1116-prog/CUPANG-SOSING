import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
const code=ts.transpileModule(fs.readFileSync(new URL('../app/supplier-hub-handoff.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const localHistory={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/supplier-hub-local-history.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:localHistory,TextEncoder});
function harness(reply){
  const listeners=new Set(),timers=new Set(),sent=[];
  const win={location:{origin:'https://sourceflow.jjwwhhjj1116.workers.dev'},addEventListener:(_,cb)=>listeners.add(cb),removeEventListener:(_,cb)=>listeners.delete(cb),postMessage(message){sent.push(message);queueMicrotask(()=>reply?.(message,emit));}};
  const emit=(message,result,overrides={})=>{for(const listener of [...listeners])listener({source:win,origin:win.location.origin,data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:message.requestId,result},...overrides});};
  const exports={};vm.runInNewContext(code,{exports,window:win,crypto:webcrypto,Uint8Array,btoa,Error,require:name=>{assert.equal(name,'@/app/supplier-hub-local-history');return localHistory;},setTimeout:cb=>{timers.add(cb);return cb;},clearTimeout:cb=>timers.delete(cb)});
  return {api:exports,sent,listeners,timers,expire(){for(const cb of [...timers])cb();}};
}
const identity={productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64)};
const extensionManifest=JSON.parse(fs.readFileSync(new URL('../extensions/supplier-hub/manifest.json',import.meta.url),'utf8'));

test('actual content PING reports the runtime manifest version while retaining its capabilities',async()=>{
 const source=fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8');
 let capabilities;
 for(const manifest of [extensionManifest,{...extensionManifest,version:'9.8.7'}]){
  const listeners=[],replies=[],origin='https://sourceflow.jjwwhhjj1116.workers.dev';let manifestReads=0,commands=0;
  const window={addEventListener:(_type,listener)=>listeners.push(listener),postMessage:(message,targetOrigin)=>replies.push({message,targetOrigin})};
  vm.runInNewContext(source,{window,location:{origin},chrome:{runtime:{getManifest(){manifestReads++;return manifest;},onMessage:{addListener(){}},sendMessage(){commands++;throw Error('PING must not send a worker command');}}}});
  await listeners[0]({source:window,origin,data:{channel:'YOOFAM_HUB_HANDOFF',type:'PING',requestId:'a'.repeat(36)}});
  assert.equal(replies.length,1);assert.equal(replies[0].targetOrigin,origin);
  const {message}=replies[0];assert.equal(message.channel,'YOOFAM_HUB_HANDOFF_RESULT');assert.equal(message.requestId,'a'.repeat(36));
  assert.equal(message.result.version,manifest.version);assert.equal(manifestReads,1);assert.equal(commands,0);
  const {version:reportedVersion,...current}=JSON.parse(JSON.stringify(message.result));assert.equal(reportedVersion,manifest.version);
  assert.equal(current.ok,true);assert.equal(current.popupWindowBinding,true);assert.equal(current.serverReceiptReplayProtection,true);
  assert.equal(current.pendingReceiptRefreshRecovery,true);assert.equal(current.registrationObservationCas,true);
  assert.equal(current.productTransmissionHistory,true);assert.equal(current.historicalReceiptLookup,true);
  if(capabilities)assert.deepEqual(current,capabilities);else capabilities=current;
 }
});

test('installed-extension info uses only a read-only PING and reports the actual version and exact capability booleans',async()=>{
 for(const version of ['0.2.54','0.2.56','9.8.7','65535.65535.65535.65535']){
  const h=harness((message,emit)=>emit(message,{ok:true,version,pendingReceiptRefreshRecovery:true,registrationObservationCas:true}));
  assert.deepEqual(JSON.parse(JSON.stringify(await h.api.readSupplierHubExtensionInfo(new AbortController().signal))),{version,pendingReceiptRefreshRecovery:true,registrationObservationCas:true,productTransmissionHistory:false,historicalReceiptLookup:false});
  assert.deepEqual(h.sent.map(message=>message.type),['PING']);assert.equal(h.sent[0].payload,null);assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
 }
 for(const flag of [undefined,false,'true',1,null]){
  const h=harness((message,emit)=>emit(message,{ok:true,version:'0.2.54',pendingReceiptRefreshRecovery:flag,registrationObservationCas:flag}));
  assert.deepEqual(JSON.parse(JSON.stringify(await h.api.readSupplierHubExtensionInfo(new AbortController().signal))),{version:'0.2.54',pendingReceiptRefreshRecovery:false,registrationObservationCas:false,productTransmissionHistory:false,historicalReceiptLookup:false});
  assert.deepEqual(h.sent.map(message=>message.type),['PING']);
 }
 for(const version of [undefined,null,56,'','latest','0.2.056','0.2.65536','0.2.56.1.2','0.2.56\n','0.2.56<script>']){
  const h=harness((message,emit)=>emit(message,{ok:true,version,pendingReceiptRefreshRecovery:true,registrationObservationCas:true}));
  await assert.rejects(h.api.readSupplierHubExtensionInfo(new AbortController().signal),/설치된 Chrome 확장의 버전/);
  assert.deepEqual(h.sent.map(message=>message.type),['PING']);assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
 }
});

test('older extensions cannot start new pending recovery or SKU observation but retain their cached receipts',async()=>{
 const record={...savedFixture().record,registration:{quotationId:'123',scope:'visible-page',observedAt:Date.now(),registered:false,includedOptions:2,rows:[]}};
 const legacy={ok:true,version:'0.2.54',companyBinding:true,registrationLookup:true,registrationPages:true,companyMenuRecovery:true,resultTableRefreshObservation:true,acceptedReceiptRefreshRecovery:true};
 for(const [mode,flag] of [[true,'pendingReceiptRefreshRecovery'],['registration','registrationObservationCas']])for(const value of [undefined,false,'true',1,null]){
  const h=harness((message,emit)=>emit(message,message.type==='PING'?{...legacy,[flag]:value}:{ok:true,fingerprint:identity.fingerprint,registered:false,record}));
  await assert.rejects(h.api.getSupplierHubResult(identity,new AbortController().signal,mode),/0\.2\.56/);
  assert.deepEqual(h.sent.map(message=>message.type),['PING'],'unsupported recovery never dispatches a fresh Hub query');
  const cached=await h.api.getSupplierHubResult(identity,new AbortController().signal);
  assert.equal(cached.quotationId,'123');assert.equal(cached.registration.quotationId,'123');assert.equal(cached.registered,false);
  assert.deepEqual(h.sent.map(message=>message.type),['PING','RESULT'],'cached read is retained without prepare, retransmit or deletion');
  assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
 }
 const h=harness((message,emit)=>emit(message,message.type==='PING'?{...legacy,version:'0.2.56',pendingReceiptRefreshRecovery:true,registrationObservationCas:true}:{ok:true,fingerprint:identity.fingerprint,registered:false,record}));
 for(const mode of [true,'registration'])assert.equal((await h.api.getSupplierHubResult(identity,new AbortController().signal,mode)).quotationId,'123');
 assert.deepEqual(h.sent.map(message=>message.type),['PING','REFRESH','PING','REGISTRATION']);
 for(const message of h.sent.filter(message=>message.type!=='PING'))assert.deepEqual(JSON.parse(JSON.stringify(message.payload)),identity);
});

test('direct transmission checks both final-result capabilities before reading bytes or preparing a new upload',async()=>{
 const reviewed={priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:true};
 const legacy={ok:true,version:'0.2.54',companyBinding:true,directTransmission:true,latestSourceBinding:true,durableAttachmentRecovery:true,imageIntegrityBinding:true,serverReceiptReplayProtection:true,companyMenuRecovery:true,attachmentLifecycleRecovery:true};
 const start=async(api,blob)=>{
  const signal=new AbortController().signal;await api.checkSupplierHubExtension(signal,true);
  await api.prepareSupplierHubHandoff(blob,identity,signal);return api.transmitSupplierHubPackage(blob,identity,reviewed,signal);
 };
 for(const field of ['pendingReceiptRefreshRecovery','registrationObservationCas'])for(const value of [undefined,false,'true',1,null]){
  let readBytes=0;const blob={size:1,arrayBuffer:async()=>{readBytes++;return new Uint8Array([1]).buffer;}};
  const h=harness((message,emit)=>emit(message,{...legacy,pendingReceiptRefreshRecovery:true,registrationObservationCas:true,[field]:value}));
  await assert.rejects(start(h.api,blob),/0\.2\.56/);assert.equal(readBytes,0);
  assert.deepEqual(h.sent.map(message=>message.type),['PING'],'unsupported final steps do not prepare files, upload, or send consent selections');
  assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
 }
 const current=harness((message,emit)=>emit(message,message.type==='PING'?{...legacy,version:'0.2.57',pendingReceiptRefreshRecovery:true,registrationObservationCas:true,productTransmissionHistory:true,historicalReceiptLookup:true}:{ok:true,fingerprint:identity.fingerprint,registered:false,result:{state:'validation-requested',registered:false}}));
 assert.equal((await start(current.api,new Blob(['reviewed ZIP']))).state,'validation-requested');
 assert.deepEqual(current.sent.map(message=>message.type),['PING','PREPARE','TRANSMIT']);
 for(const message of current.sent.filter(message=>message.type!=='PING')){
  assert.equal(message.payload.fingerprint,identity.fingerprint);assert.equal(Buffer.from(message.payload.base64,'base64').toString(),'reviewed ZIP');
 }
 assert.deepEqual(JSON.parse(JSON.stringify(current.sent[2].payload.reviewedAgreements)),reviewed);
});

test('both new delivery paths require whole-product history and original-receipt lookup before reading any bytes',async()=>{
 const capability={ok:true,version:'0.2.56',companyBinding:true,directTransmission:true,latestSourceBinding:true,durableAttachmentRecovery:true,imageIntegrityBinding:true,serverReceiptReplayProtection:true,companyMenuRecovery:true,attachmentLifecycleRecovery:true,pendingReceiptRefreshRecovery:true,registrationObservationCas:true,popupWindowBinding:true};
 for(const direct of [false,true])for(const field of ['productTransmissionHistory','historicalReceiptLookup'])for(const missing of [undefined,false,'true',1,null]){
  const h=harness((message,emit)=>emit(message,{...capability,productTransmissionHistory:true,historicalReceiptLookup:true,[field]:missing}));
  await assert.rejects(h.api.checkSupplierHubExtension(new AbortController().signal,direct),/0\.2\.57/);assert.deepEqual(h.sent.map(message=>message.type),['PING']);
 }
});
test('historical result requests pin original A metadata while new draft B is never exported or transmitted',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}]){
  const receipt={schemaVersion:1,evidence:'chrome-observation',profileId:'original-profile',categoryId:identity.categoryId,fingerprint:identity.fingerprint,productVersion:'2026-10-01T00:00:00.000Z',recordedAt:'2026-10-01T00:00:01.000Z',result:{...savedFixture(company).record,quotationId:'original-id'}},record={...receipt.result,registration:{quotationId:'original-id',scope:'visible-page',includedOptions:2,observedAt:Date.now(),registered:false,rows:[]}};
  const h=harness((message,emit)=>emit(message,message.type==='PING'?{ok:true,productTransmissionHistory:true,historicalReceiptLookup:true}:{ok:true,fingerprint:identity.fingerprint,registered:false,record}));
  for(const registration of [false,true])assert.equal((await h.api.getHistoricalSupplierHubResult(identity.productId,receipt,new AbortController().signal,registration)).quotationId,'original-id');
  assert.deepEqual(h.sent.map(message=>message.type),['PING','REFRESH','PING','REGISTRATION']);
  for(const message of h.sent.filter(message=>message.type!=='PING')){assert.deepEqual(JSON.parse(JSON.stringify(message.payload)),{...identity,historical:true});assert.equal(message.payload.base64,undefined);assert.equal(message.payload.reviewedAgreements,undefined);}
  for(const patch of [{company:{code:'A01526306',name:'유앤채'}},{includedOptions:1},{quotationId:'other-id'}]){
   if(patch.company?.code===company.code)continue;
   const bad=harness((message,emit)=>emit(message,message.type==='PING'?{ok:true,productTransmissionHistory:true,historicalReceiptLookup:true}:{ok:true,fingerprint:identity.fingerprint,registered:false,record:{...record,...patch}}));
   await assert.rejects(bad.api.getHistoricalSupplierHubResult(identity.productId,receipt,new AbortController().signal));assert.deepEqual(bad.sent.map(message=>message.type),['PING','REFRESH']);
  }
 }
});

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
 const capability={ok:true,validationResume:true,latestSourceBinding:true,serverReceiptReplayProtection:true,companyMenuRecovery:true,attachmentLifecycleRecovery:true};
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

test('company menu recovery is required for upload, validation resume and registration searches',async()=>{
 const reviewed={priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:true};
 const legacy={ok:true,version:'0.2.39',companyBinding:true,directTransmission:true,latestSourceBinding:true,
  durableAttachmentRecovery:true,imageIntegrityBinding:true,serverReceiptReplayProtection:true,
  validationResume:true,registrationLookup:true,registrationPages:true,savedSubmission:true};
 const record={...savedFixture().record,registration:{quotationId:'123',scope:'visible-page',observedAt:Date.now(),registered:false,includedOptions:2,rows:[]}};
 const actions=[
  {type:'TRANSMIT',run:async api=>{await api.checkSupplierHubExtension(new AbortController().signal,true);return api.transmitSupplierHubPackage(new Blob(['reviewed ZIP']),identity,reviewed,new AbortController().signal);}},
  {type:'VALIDATE',run:api=>api.resumeSupplierHubValidation(identity,reviewed,new AbortController().signal)},
  {type:'REGISTRATION',run:api=>api.getSupplierHubResult(identity,new AbortController().signal,'registration')},
 ];
 for(const {type,run} of actions){
  for(const companyMenuRecovery of [undefined,false,'true']){
   const old=harness((message,emit)=>emit(message,{...legacy,companyMenuRecovery}));
   await assert.rejects(run(old.api),/0.2.40/);
   assert.deepEqual(old.sent.map(message=>message.type),['PING']);
   assert.equal(old.listeners.size,0);assert.equal(old.timers.size,0);
  }
  const current=harness((message,emit)=>emit(message,message.type==='PING'?{...legacy,version:'0.2.57',companyMenuRecovery:true,attachmentLifecycleRecovery:true,resultTableRefreshObservation:true,pendingReceiptRefreshRecovery:true,registrationObservationCas:true,productTransmissionHistory:true,historicalReceiptLookup:true}
   :{ok:true,fingerprint:identity.fingerprint,registered:false,record,result:{state:'validation-requested',registered:false}}));
  const result=await run(current.api);
  assert.equal(result.registered,false);assert.deepEqual(current.sent.map(message=>message.type),['PING',type]);
  assert.equal(current.sent[1].payload.fingerprint,identity.fingerprint);
  if(type==='TRANSMIT')assert.equal(Buffer.from(current.sent[1].payload.base64,'base64').toString(),'reviewed ZIP');
  else assert.equal(current.sent[1].payload.base64,undefined);
 }
 // Existing stored receipts remain readable without either menu capability.
 const previous=savedReply(savedFixture(),legacy);
 assert.equal((await previous.api.getSupplierHubSubmission(identity,new AbortController().signal)).attempt.state,'validation-requested');
 assert.equal((await previous.api.getSupplierHubResult(identity,new AbortController().signal)).quotationId,'123');
 assert.deepEqual(previous.sent.map(message=>message.type),['PING','RESULT','RESULT']);
});

test('new package preparation, direct upload and validation resume require attachment lifecycle recovery before sending bytes',async()=>{
 const reviewed={priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:true};
 const legacy={ok:true,version:'0.2.40',companyBinding:true,directTransmission:true,latestSourceBinding:true,
  durableAttachmentRecovery:true,imageIntegrityBinding:true,serverReceiptReplayProtection:true,
  companyMenuRecovery:true,validationResume:true,savedSubmission:true,registrationLookup:true,registrationPages:true};
 const actions=[
  {type:'PREPARE',run:async api=>{await api.checkSupplierHubExtension(new AbortController().signal);return api.prepareSupplierHubHandoff(new Blob(['reviewed ZIP']),identity,new AbortController().signal);}},
  {type:'TRANSMIT',run:async api=>{await api.checkSupplierHubExtension(new AbortController().signal,true);return api.transmitSupplierHubPackage(new Blob(['reviewed ZIP']),identity,reviewed,new AbortController().signal);}},
  {type:'VALIDATE',run:api=>api.resumeSupplierHubValidation(identity,reviewed,new AbortController().signal)},
 ];
 for(const {type,run} of actions){
  for(const attachmentLifecycleRecovery of [undefined,false,'true']){
   const old=harness((message,emit)=>emit(message,{...legacy,attachmentLifecycleRecovery}));
   await assert.rejects(run(old.api),/0.2.41/);
   assert.deepEqual(old.sent.map(message=>message.type),['PING']);
   assert.equal(old.listeners.size,0);assert.equal(old.timers.size,0);
  }
  const current=harness((message,emit)=>emit(message,message.type==='PING'?{...legacy,version:'0.2.57',attachmentLifecycleRecovery:true,productTransmissionHistory:true,historicalReceiptLookup:true,...(type==='PREPARE'?{popupWindowBinding:true}:{}),...(type==='TRANSMIT'?{pendingReceiptRefreshRecovery:true,registrationObservationCas:true}:{})}
   :{ok:true,fingerprint:identity.fingerprint,registered:false,result:{state:'validation-requested',registered:false}}));
  await run(current.api);assert.deepEqual(current.sent.map(message=>message.type),['PING',type]);
  assert.equal(current.sent[1].payload.fingerprint,identity.fingerprint);
  if(type==='VALIDATE')assert.equal(current.sent[1].payload.base64,undefined);
  else assert.equal(Buffer.from(current.sent[1].payload.base64,'base64').toString(),'reviewed ZIP');
  assert.equal(current.listeners.size,0);assert.equal(current.timers.size,0);
 }
 const fixture=savedFixture(),record={...fixture.record,registration:{quotationId:'123',scope:'visible-page',observedAt:Date.now(),registered:false,includedOptions:2,rows:[]}};
 const previous=harness((message,emit)=>emit(message,message.type==='PING'?{...legacy,resultTableRefreshObservation:true}:{ok:true,fingerprint:identity.fingerprint,registered:false,attempt:fixture.attempt,record}));
 assert.equal((await previous.api.getSupplierHubSubmission(identity,new AbortController().signal)).attempt.state,'validation-requested');
 assert.equal((await previous.api.getSupplierHubResult(identity,new AbortController().signal)).quotationId,'123');
 await assert.rejects(previous.api.getSupplierHubResult(identity,new AbortController().signal,'registration'),/0\.2\.56/);
 assert.deepEqual(previous.sent.map(message=>message.type),['PING','RESULT','RESULT','PING']);
});

test('popup preparation requires exact window binding support before reading or sending package bytes',async()=>{
 const legacy={ok:true,version:'0.2.44',companyBinding:true,latestSourceBinding:true,durableAttachmentRecovery:true,imageIntegrityBinding:true,serverReceiptReplayProtection:true,attachmentLifecycleRecovery:true};
 const prepare=async(api,blob)=>{await api.checkSupplierHubExtension(new AbortController().signal);await api.prepareSupplierHubHandoff(blob,identity,new AbortController().signal);};
 for(const popupWindowBinding of [undefined,false,'true']){
  let readBytes=0;const blob={size:1,arrayBuffer:async()=>{readBytes++;return new Uint8Array([1]).buffer;}};
  const h=harness((message,emit)=>emit(message,message.type==='PING'?{...legacy,popupWindowBinding}:{ok:true,fingerprint:identity.fingerprint,registered:false}));
  await assert.rejects(prepare(h.api,blob),/0\.2\.45/);
  assert.deepEqual(h.sent.map(message=>message.type),['PING']);assert.equal(readBytes,0);assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
 }
 const listeners=[],replies=[],origin='https://sourceflow.jjwwhhjj1116.workers.dev';
 const window={addEventListener:(_type,listener)=>listeners.push(listener),postMessage:value=>replies.push(value)};
 vm.runInNewContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8'),{window,location:{origin},chrome:{runtime:{getManifest:()=>extensionManifest,onMessage:{addListener(){}}}}});
 await listeners[0]({source:window,origin,data:{channel:'YOOFAM_HUB_HANDOFF',type:'PING',requestId:'a'.repeat(36)}});
 const actualCapability=replies[0].result;assert.equal(actualCapability.popupWindowBinding,true);
 const current=harness((message,emit)=>emit(message,message.type==='PING'?actualCapability:{ok:true,fingerprint:identity.fingerprint,registered:false}));
 await prepare(current.api,new Blob(['reviewed ZIP']));assert.deepEqual(current.sent.map(message=>message.type),['PING','PREPARE']);
 assert.equal(Buffer.from(current.sent[1].payload.base64,'base64').toString(),'reviewed ZIP');assert.equal(current.listeners.size,0);assert.equal(current.timers.size,0);
});

test('previous extension keeps validation resume and cached reads while new direct uploads and recovery require an update',async()=>{
 const capability={ok:true,version:'0.2.44',companyBinding:true,directTransmission:true,latestSourceBinding:true,durableAttachmentRecovery:true,imageIntegrityBinding:true,serverReceiptReplayProtection:true,companyMenuRecovery:true,attachmentLifecycleRecovery:true,validationResume:true,acceptedReceiptRefreshRecovery:true,resultTableRefreshObservation:true,registrationLookup:true,registrationPages:true,savedSubmission:true};
 const fixture=savedFixture(),record={...fixture.record,registration:{quotationId:'123',scope:'visible-page',observedAt:Date.now(),registered:false,includedOptions:2,rows:[]}};
 const reviewed={priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:true};
 const h=harness((message,emit)=>emit(message,message.type==='PING'?capability:{ok:true,fingerprint:identity.fingerprint,registered:false,attempt:fixture.attempt,record,result:{state:'validation-requested',registered:false}}));
 await assert.rejects(h.api.checkSupplierHubExtension(new AbortController().signal,true),/0\.2\.56/);
 assert.equal((await h.api.resumeSupplierHubValidation(identity,reviewed,new AbortController().signal)).state,'validation-requested');
 assert.equal((await h.api.getSupplierHubResult(identity,new AbortController().signal)).quotationId,'123');
 for(const mode of [true,'registration'])await assert.rejects(h.api.getSupplierHubResult(identity,new AbortController().signal,mode),/0\.2\.56/);
 assert.equal((await h.api.getSupplierHubSubmission(identity,new AbortController().signal)).result.quotationId,'123');
 assert.deepEqual(h.sent.map(message=>message.type),['PING','PING','VALIDATE','RESULT','PING','PING','PING','RESULT']);
 assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
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
  const h=harness((m,emit)=>emit(m,m.type==='PING'?{ok:true,companyBinding:true,latestSourceBinding:true,durableAttachmentRecovery:true,imageIntegrityBinding:true,serverReceiptReplayProtection:true,attachmentLifecycleRecovery:true,popupWindowBinding:true,productTransmissionHistory:true,historicalReceiptLookup:true}:{ok:true,fingerprint:identity.fingerprint,registered:false}));
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
 const h=harness((m,emit)=>emit(m,m.type==='PING'?{ok:true,companyBinding:true,directTransmission:true,latestSourceBinding:true,durableAttachmentRecovery:true,imageIntegrityBinding:true,serverReceiptReplayProtection:true,companyMenuRecovery:true,attachmentLifecycleRecovery:true,pendingReceiptRefreshRecovery:true,registrationObservationCas:true,productTransmissionHistory:true,historicalReceiptLookup:true}:{ok:true,fingerprint:identity.fingerprint,registered:false,result:{state:'validation-requested',validated:false,registered:false}}));
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
 const h=harness((m,emit)=>emit(m,m.type==='PING'?{ok:true,acceptedReceiptRefreshRecovery:true,pendingReceiptRefreshRecovery:true}:{ok:true,fingerprint:identity.fingerprint,registered:false,record}));
 assert.equal((await h.api.getSupplierHubResult(identity,new AbortController().signal,true)).state,'validation-pending');assert.deepEqual(h.sent.map(message=>message.type),['PING','REFRESH']);assert.equal(h.sent[1].payload.fingerprint,identity.fingerprint);
});

test('file refresh requires accepted receipt preservation before consulting Hub while cached records remain readable',async()=>{
 for(const acceptedReceiptRefreshRecovery of [undefined,false,'true']){
  const h=harness((m,emit)=>emit(m,m.type==='PING'?{ok:true,version:'0.2.41',acceptedReceiptRefreshRecovery}:{ok:true,fingerprint:identity.fingerprint,registered:false,record:savedFixture().record}));
  await assert.rejects(h.api.getSupplierHubResult(identity,new AbortController().signal,true),/0\.2\.42/);
  assert.deepEqual(h.sent.map(message=>message.type),['PING']);assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
  assert.equal((await h.api.getSupplierHubResult(identity,new AbortController().signal)).quotationId,'123');assert.equal(h.sent[1].type,'RESULT');
 }
});

test('live SKU search requires exact result-table observation while stored results and file refresh stay compatible',async()=>{
 const fixture=savedFixture(),record={...fixture.record,registration:{quotationId:'123',scope:'visible-page',observedAt:Date.now(),registered:false,includedOptions:2,rows:[]}};
 for(const resultTableRefreshObservation of [undefined,false,'true']){
  const capability={ok:true,version:'0.2.56',companyBinding:true,registrationLookup:true,registrationPages:true,companyMenuRecovery:true,acceptedReceiptRefreshRecovery:true,pendingReceiptRefreshRecovery:true,savedSubmission:true,resultTableRefreshObservation};
  const h=harness((message,emit)=>emit(message,message.type==='PING'?capability:{ok:true,fingerprint:identity.fingerprint,registered:false,attempt:fixture.attempt,record}));
  await assert.rejects(h.api.getSupplierHubResult(identity,new AbortController().signal,'registration'),/0\.2\.44/);
  assert.deepEqual(h.sent.map(message=>message.type),['PING']);assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
  assert.equal((await h.api.getSupplierHubResult(identity,new AbortController().signal)).quotationId,'123');
  assert.equal((await h.api.getSupplierHubResult(identity,new AbortController().signal,true)).quotationId,'123');
  assert.equal((await h.api.getSupplierHubSubmission(identity,new AbortController().signal)).result.quotationId,'123');
  assert.deepEqual(h.sent.map(message=>message.type),['PING','RESULT','PING','REFRESH','PING','RESULT']);
  assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
 }
});

test('app registration lookup needs its capability and returns only matching refreshed rows',async()=>{
 const record={...identity,origin:'https://sourceflow.jjwwhhjj1116.workers.dev',filename:`YOOFAM-${identity.fingerprint}.xlsx`,state:'validation-complete',quotationId:'123',observedAt:Date.now(),registered:false,includedOptions:3,
  registration:{quotationId:'123',scope:'visible-page',observedAt:Date.now(),registered:false,includedOptions:3,rows:[]}};
 const h=harness((m,emit)=>emit(m,m.type==='PING'?{ok:true,companyBinding:true,registrationLookup:true,registrationPages:true,companyMenuRecovery:true,resultTableRefreshObservation:true,registrationObservationCas:true}:{ok:true,fingerprint:identity.fingerprint,record,registered:false}));
 assert.equal((await h.api.getSupplierHubResult(identity,new AbortController().signal,'registration')).registration.quotationId,'123');
 assert.deepEqual(h.sent.map(message=>message.type),['PING','REGISTRATION']);assert.deepEqual(h.sent[1].payload,identity);
 const old=harness((m,emit)=>emit(m,{ok:true,companyBinding:true,directTransmission:true}));
 await assert.rejects(old.api.getSupplierHubResult(identity,new AbortController().signal,'registration'),/0.2.26/);assert.equal(old.sent.length,1);
 for(const patch of [{registration:undefined},{registration:{...record.registration,quotationId:'other'}},{registration:{...record.registration,includedOptions:2}},{state:'validation-pending'}]){
  const bad=harness((m,emit)=>emit(m,m.type==='PING'?{ok:true,companyBinding:true,registrationLookup:true,registrationPages:true,companyMenuRecovery:true,resultTableRefreshObservation:true,registrationObservationCas:true}:{ok:true,fingerprint:identity.fingerprint,record:{...record,...patch},registered:false}));
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

test('unresolved abbreviated quotation IDs cannot be restored, retained or used for SKU result binding',async()=>{
 for(const quotationId of ['c4541e05...','c4541e05…']){
  const value=savedFixture(),record={...value.record,quotationId},h=savedReply({...value,record});
  await assert.rejects(h.api.getSupplierHubResult(identity,new AbortController().signal),/전체 접수 ID/);
  await assert.rejects(h.api.getSupplierHubSubmission(identity,new AbortController().signal),/전체 접수 ID/);
  const source={filename:record.filename,company:record.company,includedOptions:record.includedOptions};
  assert.throws(()=>h.api.validateSupplierHubResultForSource(record,source),/전체 접수 ID/);
  assert.throws(()=>h.api.validateRegistrationResult({quotationId,scope:'visible-page',observedAt:Date.now(),registered:false,rows:[]},quotationId),/전체 견적서 ID/);
  assert.ok(h.sent.every(message=>['PING','RESULT'].includes(message.type)),'malformed cached IDs must not trigger a live Hub search or transmission');
 }
});

test('cancelling cache recovery releases all listeners and never sends a live Hub request',async()=>{
 const h=harness((message,emit)=>{if(message.type==='PING')emit(message,{ok:true,savedSubmission:true});});
 const controller=new AbortController(),pending=h.api.getSupplierHubSubmission(identity,controller.signal);
 await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(pending,/취소/);
 assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);assert.deepEqual(h.sent.map(message=>message.type),['PING','RESULT']);
});
