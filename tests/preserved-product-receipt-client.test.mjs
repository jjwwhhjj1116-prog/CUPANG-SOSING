import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {singlePacket,SINGLE_COMPANIES,SINGLE_SENDER} from './helpers/supplier-hub-single-document.mjs';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
import {createProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';
import {productDocumentIdentity} from '../extensions/supplier-hub/product-document-receiver.mjs';
import * as historical from '../extensions/supplier-hub/preserved-product-receipt.mjs';

const clone=value=>structuredClone(value),plain=value=>JSON.parse(JSON.stringify(value));
const receiptModel=providedOptionModule('app/supplier-hub-product-receipt.ts');
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const digest=async value=>Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))).toString('hex');
async function evidence(company,ids={docId:50123,qvtRequestId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}){
 const single=singlePacket(company),body=clone(single.body),identity={ownerId:single.ownerId,company:clone(company),productId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',profileId:single.profileId,requestedProfileId:single.profileId,
  categoryId:single.categoryId,fingerprint:single.fingerprint,inputFingerprint:'d'.repeat(64),schemaSha256:single.schemaSha256,source:{...single.source,profileId:single.profileId}};
 identity.source.productVersion=new Date(Date.now()-60000).toISOString();const deferred=clone(body);
 for(const row of deferred.jsonDocument)for(const key of ['msrpAgree','labelContactAgreed'])row.imagePage[key]=false;
 const review={format:'yoofam-supplier-hub-product-document-v1',type:'YOOFAM_PRODUCT_DOCUMENT_REVIEW',identity,members:[{optionId:single.optionId,optionLabel:'합성 옵션',documentIndex:0}],body,registered:false,remoteWrites:false,submissionReady:false,
  originalBodySha256:await digest(body),preparedBodySha256:await digest(deferred)};
 review.reviewDigest=await digest({format:review.format,type:review.type,identity,members:review.members,originalBodySha256:review.originalBodySha256,preparedBodySha256:review.preparedBodySha256});
 const target={requestId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',productId:identity.productId,company:clone(company),...ids};
 const packet=await createProductDocumentPacket(review,{requestId:target.requestId}),context=await productDocumentIdentity(packet,SINGLE_SENDER),scope={origin:context.identity.origin,ownerId:identity.ownerId,company:clone(company)};
 const ownedTarget={tabId:71,windowId:context.identity.windowId,origin:'https://supplier.coupang.com',requestId:target.requestId,packetDigest:context.packetDigest};
 const checkpoint={format:review.format,draftOnly:true,state:'updated',key:context.key,laneKey:context.laneKey,identity:clone(context.identity),identityDigest:context.identityDigest,packetDigest:context.packetDigest,
  originalBodySha256:context.originalBodySha256,bodySha256:context.bodySha256,requestId:target.requestId,docId:target.docId,sequence:12,updatedAt:Date.now()-1000,baselineDocIds:[1234],ownedTarget,tab:{...ownedTarget,authenticated:true,company:clone(company)}};
 const {origin:unusedOrigin,appTabId:unusedTab,windowId:unusedWindow,accountContext:unusedAccount,fingerprint:unusedFingerprint,...source}=context.identity;
 void unusedOrigin;void unusedTab;void unusedWindow;void unusedAccount;void unusedFingerprint;
 const currentSource={...source,productName:body.productName,categoryPath:body.categoryPath},anchor=await historical.historicalProductReceiptAnchor({target,checkpoint,scope,currentSource}),documentId='11111111-1111-4111-8111-111111111111';
 const provenance={method:'GET',url:historical.HISTORICAL_PRODUCT_RECEIPT_URL,status:200,redirected:false,contentType:'application/json',cache:'no-store',company:clone(company),docId:target.docId,qvtRequestId:target.qvtRequestId,
  identityDigest:anchor.identityDigest,packetDigest:anchor.packetDigest,requestId:target.requestId,tabId:71,windowId:anchor.identity.windowId,documentId,
  observedTab:{tabId:71,windowId:anchor.identity.windowId,documentId,selection:'original-owned-tab',originalTabId:71,originalTabAbsent:false},readId:anchor.readId,observedAt:Date.now()};
 const candidate=historical.normalizeHistoricalProductReceipt({anchor,readResult:{format:'yoofam-historical-product-receipt-read-v1',readOnly:true,remoteWrites:false,provenance,
  row:{docId:target.docId,status:'FINISHED',qvtRequestId:target.qvtRequestId,productName:body.productName,categoryPath:body.categoryPath,modifiedAt:new Date().toISOString(),remark:''}}});
 const stored={format:'yoofam-product-document-receipt-v1',recordType:'product-document',evidence:'chrome-observation',productId:identity.productId,profileId:identity.profileId,requestedProfileId:identity.requestedProfileId,
  categoryId:identity.categoryId,fingerprint:identity.fingerprint,inputFingerprint:identity.inputFingerprint,schemaSha256:identity.schemaSha256,source:clone(anchor.identity.source),company:clone(company),members:clone(review.members),
  requestId:target.requestId,docId:target.docId,identity:clone(anchor.identity),identityDigest:anchor.identityDigest,packetDigest:anchor.packetDigest,preparedBodySha256:anchor.preparedBodySha256,originalBodySha256:anchor.originalBodySha256,
  receipt:clone(candidate.receipt),registered:false,recordedAt:new Date().toISOString()};
 receiptModel.parseStoredProductReceipt(stored);await historical.validateHistoricalProductReceiptCandidate(candidate,{scope,currentSource});
 const {company:unusedCompany,...selection}=target;void unusedCompany;return {candidate,stored,selection,scope};
}
async function fixture(company=SINGLE_COMPANIES[0],ids){
 const f=await evidence(company,ids),listeners=new Set(),timers=new Map(),sent=[],posts=[],pings=[],contexts=[];let timerId=0;
 Object.assign(f,{listeners,timers,sent,posts,pings,contexts,capability:{version:'2.1.77',preservedProductReceiptReconciliation:true},actor:{ownerId:f.scope.ownerId,company:clone(company)},onContext:null,onPost:null,postError:null,onPing:null});
 const win={location:{origin:f.scope.origin},addEventListener(type,listener){assert.equal(type,'message');listeners.add(listener);},removeEventListener:(type,listener)=>listeners.delete(listener),postMessage:(message,origin)=>{assert.equal(origin,f.scope.origin);sent.push(message);}};
 const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/preserved-product-receipt-client.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:api,Error,crypto:webcrypto,window:win,AbortController,Object,TextEncoder,Date,
  setTimeout(fn,delay){assert.equal(delay,120000);const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
  require:name=>name.includes('preserved-product-receipt.mjs')?historical:name==='@/app/supplier-hub-product-receipt'?receiptModel:name==='@/app/supplier-hub-handoff'?{exchange:async(type,payload,signal)=>{assert.equal(type,'PING');assert.equal(payload,null);assert.equal(signal.aborted,false);pings.push(type);await f.onPing?.();return clone(f.capability);}}:{readSingleCatalogContext:async signal=>{assert.equal(signal.aborted,false);contexts.push('catalog');await f.onContext?.(contexts.length);return clone(f.actor);}},
  fetch:async(path,init)=>{posts.push({path,init});assert.equal(init.signal.aborted,false);assert.equal(init.method,'POST');assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');await f.onPost?.();if(f.postError)throw f.postError;
   const response=Response.json(f.response??{format:'yoofam-historical-product-receipt-import-v1',receipt:f.stored,remoteWrites:false,canResume:false},{status:f.responseStatus??200});
   Object.defineProperty(response,'url',{value:f.responseUrl??f.scope.origin+path});return response;},
 });
 f.api=api;f.window=win;f.reply=(value=f.candidate,event={})=>{const request=sent.at(-1);assert.ok(request);for(const listener of [...listeners])listener({source:win,origin:f.scope.origin,data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:request.requestId,result:{ok:true,result:value}},...event});};return f;
}
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
const start=async f=>{const controller=new AbortController(),promise=f.api.syncPreservedProductReceipt(f.selection,f.scope.ownerId,controller.signal);await settle();return {controller,promise};};

test('receipt sync validates actual retained evidence for both companies then imports locally exactly once, preserving typed document and QVT IDs',async()=>{
 for(const [company,ids]of[[SINGLE_COMPANIES[0],{docId:50123,qvtRequestId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}],[SINGLE_COMPANIES[1],{docId:'50124',qvtRequestId:71234}]]){
  const f=await fixture(company,ids),{promise}=await start(f);assert.equal(f.sent.length,1);assert.equal(f.posts.length,0);assert.deepEqual(plain(f.sent[0].payload),{action:'reconcile',target:{...f.selection,company}});assert.equal(f.sent[0].type,'PRESERVED_PRODUCT_RECEIPT');
  f.reply();const saved=await promise;assert.deepEqual(plain(saved),f.stored);assert.equal(saved.docId,ids.docId);assert.equal(saved.receipt.qvtRequestId,ids.qvtRequestId);assert.equal(saved.registered,false);assert.equal(saved.receipt.state,'accepted');
  assert.equal(f.posts.length,1);assert.equal(f.posts[0].path,`/api/products/${f.selection.productId}/supplier-hub-product-history-import`);assert.deepEqual(JSON.parse(f.posts[0].init.body),{action:'import-history',candidate:plain(f.candidate)});
  assert.equal(f.contexts.length,5);assert.deepEqual(f.pings,['PING']);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);assert.equal(f.sent.length,1);
 }
});

test('unsupported worker, wrong actor or malformed selection fails before any receipt command or import',async()=>{
 for(const capability of[{version:'2.1.76',preservedProductReceiptReconciliation:true},{version:'2.1.77'},{version:'2.1.77',preservedProductReceiptReconciliation:false},{version:'not-a-version',preservedProductReceiptReconciliation:true},{version:'2.1.65536',preservedProductReceiptReconciliation:true}]){
  const f=await fixture();f.capability=capability;await assert.rejects(f.api.syncPreservedProductReceipt(f.selection,f.scope.ownerId,new AbortController().signal),/2.1.77/);assert.equal(f.sent.length,0);assert.equal(f.posts.length,0);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);
 }
 for(const change of['owner','doc','qvt','getter']){
  const f=await fixture();let getters=0;if(change==='owner')f.actor.ownerId='another-owner';if(change==='doc')f.selection.docId=NaN;if(change==='qvt')f.selection.qvtRequestId='';if(change==='getter')Object.defineProperty(f.selection,'docId',{get(){getters++;return 50123;},enumerable:true});
  await assert.rejects(f.api.syncPreservedProductReceipt(f.selection,f.scope.ownerId,new AbortController().signal));assert.equal(getters,0);assert.equal(f.sent.length,0);assert.equal(f.posts.length,0);assert.equal(f.pings.length,0);
 }
});

test('uncorrelated or foreign-window replies are ignored and partial, broadened or typed-mismatched receipt evidence never imports',async()=>{
 const ignored=await fixture(),running=await start(ignored);
 for(const event of[{origin:'https://other.test'},{source:{}},{data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:'wrong',result:{ok:true,result:ignored.candidate}}}]){ignored.reply(ignored.candidate,event);assert.equal(ignored.listeners.size,1);assert.equal(ignored.posts.length,0);}
 ignored.reply();await running.promise;assert.equal(ignored.posts.length,1);
 for(const mutate of[value=>{value.remoteWrites=true;},value=>{value.anchor.target.docId=String(value.anchor.target.docId);},value=>{value.anchor.target.qvtRequestId='another-qvt';},value=>{delete value.provenance.observedTab;},value=>{value.receipt.sourceStatus='SUBMITTED';},value=>{value.anchor.currentSource.members[0].optionId='another-option';},value=>{value.anchor.checkedAt=Date.now()-121000;}]){
  const f=await fixture(),{promise}=await start(f),rejected=assert.rejects(promise);const value=clone(f.candidate);mutate(value);f.reply(value);await rejected;assert.equal(f.posts.length,0);assert.equal(f.sent.length,1);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);
 }
});

test('actor or company change at each async boundary discards the evidence and never imports before its final source check',async()=>{
 for(const at of[2,3,4,5])for(const field of['owner','company']){
  const f=await fixture();f.onContext=count=>{if(count===at){if(field==='owner')f.actor.ownerId='changed-member';else f.actor.company=clone(SINGLE_COMPANIES[1]);}};
  const promise=f.api.syncPreservedProductReceipt(f.selection,f.scope.ownerId,new AbortController().signal),rejected=assert.rejects(promise,/회원·회사/);await settle();if(f.sent.length)f.reply();await rejected;
  assert.equal(f.posts.length,at===5?1:0);assert.equal(f.sent.length,at===2?0:1);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);
 }
});

test('selection is frozen before catalog await; later caller changes cannot redirect the original request',async()=>{
 const f=await fixture(),original=clone(f.selection);f.onContext=count=>{if(count===1){f.selection.docId='new-doc';f.selection.qvtRequestId='new-qvt';}};
 const {promise}=await start(f);assert.deepEqual(plain(f.sent[0].payload.target),{...original,company:f.scope.company});f.reply();const saved=await promise;assert.equal(saved.docId,original.docId);assert.equal(f.posts.length,1);
});

test('timeout, abort, bridge failure and lost import ACK clean up and never replay either operation',async()=>{
 for(const mode of['timeout','abort','bridge-error','post-error','post-abort']){
  const f=await fixture(),{promise,controller}=await start(f),rejected=assert.rejects(promise);
  if(mode==='timeout')[...f.timers.values()][0]();else if(mode==='abort')controller.abort();else if(mode==='bridge-error')f.reply(null,{data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:f.sent[0].requestId,result:{ok:false,error:'readonly query unavailable'}}});else{if(mode==='post-error')f.postError=Error('local save ACK lost');else f.onPost=()=>controller.abort();f.reply();}
  await rejected;assert.equal(f.posts.length,mode.startsWith('post-')?1:0);assert.equal(f.sent.length,1);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);await settle();assert.equal(f.sent.length,1);
 }
 const f=await fixture(),controller=new AbortController();controller.abort();await assert.rejects(f.api.syncPreservedProductReceipt(f.selection,f.scope.ownerId,controller.signal));assert.equal(f.contexts.length,0);assert.equal(f.sent.length,0);assert.equal(f.posts.length,0);
});

test('local import responses must match immutable original identity, body and typed IDs without retrying an uncertain save',async()=>{
 for(const change of['remote','resume','format','doc-type','qvt','identity','packet','original-sha','prepared-sha','older','pending','invalid-url','http-error']){
  const f=await fixture();f.response={format:'yoofam-historical-product-receipt-import-v1',receipt:clone(f.stored),remoteWrites:false,canResume:false};
  if(change==='remote')f.response.remoteWrites=true;if(change==='resume')f.response.canResume=true;if(change==='format')f.response.format='another-format';if(change==='doc-type')f.response.receipt.docId=String(f.response.receipt.docId);if(change==='qvt')f.response.receipt.receipt.qvtRequestId='foreign-qvt';
  if(change==='identity')f.response.receipt.identity.members[0].optionLabel='changed';if(change==='packet')f.response.receipt.packetDigest='f'.repeat(64);if(change==='original-sha')f.response.receipt.originalBodySha256='f'.repeat(64);if(change==='prepared-sha')f.response.receipt.preparedBodySha256='f'.repeat(64);
  if(change==='older')f.response.receipt.receipt.observedAt-=1;if(change==='pending'){f.response.receipt.receipt.state='pending';f.response.receipt.receipt.sourceStatus='SUBMITTED';}if(change==='invalid-url')f.responseUrl='https://other.test/import';if(change==='http-error'){f.responseStatus=409;f.response={error:'current source changed'};}
  const {promise}=await start(f),rejected=assert.rejects(promise);f.reply();await rejected;assert.equal(f.posts.length,1);assert.equal(f.sent.length,1);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);
 }
});
