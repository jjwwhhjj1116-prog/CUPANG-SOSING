import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash,webcrypto} from 'node:crypto';
import {createProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';
import {productDocumentIdentity} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {singleDocumentIdentity} from '../extensions/supplier-hub/single-document.mjs';
import {singlePacket,SINGLE_COMPANIES,SINGLE_SENDER} from './helpers/supplier-hub-single-document.mjs';
import {normalizeRejectionDetails} from '../extensions/supplier-hub/rejection-details.mjs';

const native=createRequire(import.meta.url),origin=new URL(SINGLE_SENDER.url).origin,plain=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex'),cases=[];
const files=['app/supplier-hub-product-client.ts','app/supplier-hub-single-client.ts','extensions/supplier-hub/product-document-receiver.mjs','tests/supplier-hub-product-client.test.mjs'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]));
const frozen=hashes();
after(()=>{assert.deepEqual(hashes(),frozen);fs.writeFileSync(new URL('../outputs/step728-product-client-proof.json',import.meta.url),JSON.stringify({sourceHashes:frozen,cases,
  boundary:'Actual app client, pure product packet, browser-bound identity and receipt parsers. Window bridge, clock and local API are isolated fixtures; true live flag is a synthetic test response only.',hubWrites:0,businessWrites:0,externalRequests:0,actualReceiptVerified:false},null,2)+'\n');});
async function fixture(company=SINGLE_COMPANIES[0],options={}){
  const clock={now:Date.now()},listeners=new Set(),timers=new Map(),sent=[],calls=[],modules=new Map();let sequence=0;
  const single=singlePacket(company),body=plain(single.body),second=plain(body.jsonDocument[0]);second.startPage.productName='두 번째 저장 옵션';second.productPage.modelNumber='';second.productPage.supplyPrice='';body.jsonDocument.push(second);
  const identity={ownerId:single.ownerId,company:plain(company),productId:single.productId,profileId:single.profileId,requestedProfileId:options.queryless?null:single.profileId,
    categoryId:single.categoryId,fingerprint:single.fingerprint,inputFingerprint:'d'.repeat(64),schemaSha256:single.schemaSha256,source:{...single.source,profileId:single.profileId}};
  const review={format:'yoofam-supplier-hub-product-document-v1',type:'YOOFAM_PRODUCT_DOCUMENT_REVIEW',identity,members:[{optionId:'first',optionLabel:'첫 옵션',documentIndex:0},{optionId:'second',optionLabel:'둘째 옵션',documentIndex:1}],body,registered:false,remoteWrites:false,submissionReady:false};
  const deferred=plain(body);for(const document of deferred.jsonDocument)for(const key of ['msrpAgree','labelContactAgreed'])document.imagePage[key]=false;
  review.originalBodySha256=digest(body);review.preparedBodySha256=digest(deferred);review.reviewDigest=digest({format:review.format,type:review.type,identity,members:review.members,originalBodySha256:review.originalBodySha256,preparedBodySha256:review.preparedBodySha256});
  const packet=await createProductDocumentPacket(review,{now:clock.now}),context=await productDocumentIdentity(packet,SINGLE_SENDER,{now:clock.now});
  const f={clock,packet,context,review,sent,calls,timers,listeners,actor:{ownerId:identity.ownerId,company:plain(company)},history:[],bridge:null};
  const win={location:{origin},addEventListener(type,fn){if(type==='message')listeners.add(fn);},removeEventListener(type,fn){if(type==='message')listeners.delete(fn);},postMessage(message,target){assert.equal(target,origin);assert.equal(message.type,'PRODUCT_DOCUMENT');sent.push(plain(message));void Promise.resolve().then(async()=>{const result=await f.bridge(message.payload);if(result!==undefined)f.emit(message,result);}).catch(error=>f.emit(message,null,{ok:false,error:error.message,code:error.code}));}};
  f.emit=(message,result,envelope,overrides={})=>{for(const listener of [...listeners])listener({source:win,origin,data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:message.requestId,result:envelope??{ok:true,result}},...overrides});};
  const setTimer=(fn,delay)=>{const id=++sequence;timers.set(id,{fn,due:clock.now+delay});return id;},clearTimer=id=>timers.delete(id);
  class LocalDate extends Date{static now(){return clock.now;}}
  f.fetch=async(url,init={})=>{calls.push({url,method:init.method??'GET',body:init.body?JSON.parse(init.body):undefined});await options.beforeFetch?.(url,init,f);
    if(url==='/api/supplier-hub/catalog-context')return Response.json(f.actor);
    if(String(url).includes('/supplier-hub-product-receipt')){
      if(init.method==='POST'){
        const body=JSON.parse(init.body),record={...plain(await load('app/supplier-hub-product-receipt.ts').validateProductReceiptObservation(body.observation,review,origin,clock.now)),recordedAt:new Date(clock.now).toISOString()};
        await options.beforeSaveReply?.(record,f);f.history=[record];return Response.json({receipt:record});
      }
      return options.historyResponse?options.historyResponse(f):Response.json({format:'yoofam-native-receipt-history-v1',productId:identity.productId,receipts:f.history});
    }throw Error('Unexpected/forbidden request '+url);
  };
  const load=file=>{if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,Error,Date:LocalDate,URL,TextEncoder,TextDecoder,Uint8Array,AbortController,structuredClone,crypto:webcrypto,window:win,setTimeout:setTimer,clearTimeout:clearTimer,fetch:(...args)=>f.fetch(...args),require:name=>name.startsWith('@/')?load(name.slice(2)+'.ts'):name.endsWith('.mjs')?native(fileURLToPath(new URL('../'+path.posix.join(path.posix.dirname(file),name),import.meta.url))):native(name)},{filename:file});return exports;};
  f.load=load;f.window=win;f.client=load('app/supplier-hub-product-client.ts');
  f.preview=()=>({format:review.format,requestId:packet.requestId,identity:plain(context.identity),identityDigest:context.identityDigest,packetDigest:context.packetDigest,productId:identity.productId,fingerprint:identity.fingerprint,members:plain(review.members),reviewDigest:review.reviewDigest,
    preparedBodySha256:review.preparedBodySha256,originalBodySha256:review.originalBodySha256,liveVerified:options.verified===true,remoteWrites:false,registered:false});
  f.state=(state='awaiting-consent',extra={})=>({format:review.format,requestId:packet.requestId,identity:plain(context.identity),identityDigest:context.identityDigest,packetDigest:context.packetDigest,originalBodySha256:review.originalBodySha256,preparedBodySha256:review.preparedBodySha256,state,docId:'new-document-728',registered:false,success:false,needsRecovery:false,...extra});
  f.challenge=(stage)=>({id:'1'.repeat(64),docId:'new-document-728',packetDigest:context.packetDigest,issuedAt:clock.now,expiresAt:clock.now+120000,...(stage?{stage}:{}),items:stage==='logisticsPage'?[]:[{key:'businessTerms',id:'businessTerms',text:'직접 검토할 합성 약관',required:true,...(stage?{title:'정확한 약관 제목',termsText:'첫 문단\n전체 약관\n마지막 문단'}:{})}]});
  f.observation=(status='SUBMITTED')=>{const state={SUBMITTED:'pending',FINISHED:'accepted',REJECTED:'rejected'}[status];return f.state(state,{receipt:{state,sourceStatus:status,docId:'new-document-728',company:plain(company),identityDigest:context.identityDigest,preparedBodySha256:context.bodySha256,observedAt:clock.now,receiptId:'qvt-728',qvtRequestId:'qvt-728',evidence:'document-receipt',registered:false}});};
  f.bridge=async payload=>payload.action==='preview'?f.preview():f.state('awaiting-consent',{challenge:f.challenge()});
  f.advance=amount=>{clock.now+=amount;for(const [id,timer]of [...timers])if(timer.due<=clock.now){timers.delete(id);timer.fn();}};
  f.wait=async predicate=>{for(let i=0;i<300;i++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}assert.fail('Client fixture did not reach requested boundary.');};
  f.session=()=>f.client.previewProductDocument(packet,new AbortController().signal);return f;
}

for(const company of SINGLE_COMPANIES)test(company.name+' full preview binds all rows; production false gate emits no start and never scalar fallback',async()=>{
  const f=await fixture(company),session=await f.session();assert.equal(session.preview.members.length,2);assert.equal(session.packet.review.body.jsonDocument[1].productPage.modelNumber,'');assert.equal(Object.hasOwn(session.preview.identity,'optionId'),false);assert.equal(session.preview.packetDigest,f.context.packetDigest);
  assert.ok(Object.isFrozen(session.packet.review.body.jsonDocument[1]));await assert.rejects(f.client.runProductDocument(session,'start',new AbortController().signal),error=>error.code==='PRODUCT_DOCUMENT_LIVE_CONTRACT_UNVERIFIED'&&error.uncertain===false);
  assert.deepEqual(f.sent.map(message=>message.payload.action),['preview']);assert.equal(f.calls.length,0);cases.push({name:'full readonly preview '+company.code,members:2,scalarFallback:false,mutationMessages:0});
});

test('preview rejects changed membership, body, saved company and browser identity without exposing a session',async()=>{
  const changes=[value=>value.members.reverse(),value=>value.identity.members[1].optionId='other',value=>value.identity.company=SINGLE_COMPANIES[1],value=>value.identity.windowId=-1,value=>value.identityDigest='f'.repeat(64),value=>value.preparedBodySha256='f'.repeat(64),value=>value.reviewDigest='f'.repeat(64),value=>value.registered=true,value=>value.optionId='first'];
  for(const change of changes){const f=await fixture();f.bridge=async()=>{const value=f.preview();change(value);return value;};await assert.rejects(f.session(),error=>error.code==='PRODUCT_DOCUMENT_REPLY_IDENTITY');assert.equal(f.sent.length,1);}
  cases.push({name:'preview scope rejection',mutations:changes.length});
});

test('synthetic enabled response validates complete staged terms and native statuses while never declaring SKU registration',async()=>{
  const f=await fixture(SINGLE_COMPANIES[0],{verified:true}),session=await f.session();f.bridge=async()=>f.state('awaiting-stage-consent',{challenge:f.challenge('productPage')});
  const stage=await f.client.runProductDocument(session,'start',new AbortController().signal);assert.match(stage.challenge.items[0].termsText,/마지막 문단/);assert.equal(stage.registered,false);
  for(const status of ['SUBMITTED','FINISHED','REJECTED']){f.bridge=async()=>f.observation(status);const result=await f.client.runProductDocument(session,'observe',new AbortController().signal);assert.equal(result.receipt.sourceStatus,status);assert.equal(result.registered,false);assert.equal(result.success,false);assert.equal(result.identity.members.length,2);}
  f.bridge=async()=>f.state('awaiting-consent',{challenge:f.challenge('logisticsPage')});assert.equal((await f.client.runProductDocument(session,'observe',new AbortController().signal)).challenge.items.length,0);
  cases.push({name:'stages and native receipts',testOnlyEnabled:true,receiptRecords:1,catalogRegistrationClaim:false});
});

test('every returned identity and receipt is checked; second member edits or scalar SKU cannot pass',async()=>{
  const changes=[value=>value.identity.members[1].optionLabel='changed',value=>value.identity.requestedProfileId=null,value=>value.preparedBodySha256='f'.repeat(64),value=>value.receipt.skuId='single-sku',value=>value.receipt.qvtRequestId='different',value=>value.registered=true,value=>value.state='registered',value=>value.identity.optionId='first'];
  for(const change of changes){const f=await fixture(SINGLE_COMPANIES[0],{verified:true}),session=await f.session();f.bridge=async()=>{const value=f.observation();change(value);return value;};await assert.rejects(f.client.runProductDocument(session,'observe',new AbortController().signal),error=>error.code==='PRODUCT_DOCUMENT_REPLY_IDENTITY'&&error.uncertain===false);assert.equal(f.sent.length,2);}
  const f=await fixture(SINGLE_COMPANIES[0],{verified:true}),session=await f.session(),changed=plain(session);changed.packet.review.members[1].optionId='other';await assert.rejects(f.client.runProductDocument(changed,'start',new AbortController().signal));assert.equal(f.sent.length,1);
});

test('lost ACK and abort retain uncertain original operation; bridge never retries or accepts another tab response',async()=>{
  const f=await fixture(SINGLE_COMPANIES[0],{verified:true}),session=await f.session();f.bridge=async()=>undefined;
  const start=f.client.runProductDocument(session,'start',new AbortController().signal);await f.wait(()=>f.sent.length===2);
  f.emit(f.sent[1],f.observation(),undefined,{origin:'https://other.test'});assert.equal(f.listeners.size,1);f.advance(60001);
  await assert.rejects(start,error=>error.code==='PRODUCT_DOCUMENT_ACK_MISSING'&&error.uncertain===true);assert.equal(f.sent.length,2);assert.equal(f.listeners.size,0);
  const controller=new AbortController(),recover=f.client.runProductDocument(session,'recover',controller.signal);await f.wait(()=>f.sent.length===3);controller.abort();await assert.rejects(recover,error=>error.uncertain===false);assert.equal(f.sent.length,3);assert.equal(f.listeners.size,0);cases.push({name:'unknown ACK',automaticRetries:0,mutatingUncertain:true,readonlyUncertain:false});
});

test('expired initial preview/start are blocked, exact observed request can still recover after initial TTL',async()=>{
  const f=await fixture(SINGLE_COMPANIES[0],{verified:true}),session=await f.session();f.advance(180000);await assert.rejects(f.session());await assert.rejects(f.client.runProductDocument(session,'start',new AbortController().signal));assert.equal(f.sent.length,1);
  f.bridge=async()=>f.state('created');assert.equal((await f.client.runProductDocument(session,'recover',new AbortController().signal)).state,'created');assert.equal(f.sent.length,2);
});

async function groupRecord(f,status='SUBMITTED'){return {...plain(await f.load('app/supplier-hub-product-receipt.ts').validateProductReceiptObservation(f.observation(status),f.review,origin,f.clock.now)),recordedAt:new Date(f.clock.now).toISOString()};}

for(const company of SINGLE_COMPANIES)test(company.name+' Single client saves refreshed rejected diagnostics with same timestamp and exact document identity',async()=>{
 const f=await fixture(company),record=await legacyRecord(f),packet=singlePacket(company);packet.accountContext=record.identity.accountContext;
 record.receipt.state='rejected';record.receipt.sourceStatus='REJECTED';record.receipt.rejectionDetails=normalizeRejectionDetails(JSON.stringify({errors:[{columnName:'무게',message:'처음 사유'}]}));
 const observation={format:packet.format,requestId:record.requestId,identity:record.identity,identityDigest:record.identityDigest,packetDigest:record.packetDigest,preparedBodySha256:record.preparedBodySha256,originalBodySha256:record.originalBodySha256,
  state:'rejected',docId:record.docId,registered:false,success:false,needsRecovery:false,receipt:plain(record.receipt)};
 const attempt={packet,profileId:packet.profileId,optionId:packet.optionId,observation},saved=plain(record);saved.receipt.rejectionDetails=normalizeRejectionDetails(JSON.stringify({errors:[{columnName:'크기',message:'갱신 사유'}]}));
 const calls=[],request=async(url,init)=>{calls.push({url,method:init?.method});return Response.json(String(url).includes('catalog-context')?f.actor:{receipt:saved});};
 const client=f.load('app/supplier-hub-single-client.ts'),value=await client.saveSingleReceiptObservation(attempt,new AbortController().signal,request);
 assert.equal(value.receipt.rejectionDetails.errors[0].columnName,'크기');assert.equal(value.docId,observation.docId);assert.equal(value.registered,false);assert.equal(calls.filter(row=>row.method==='POST').length,1);assert.equal(f.sent.length,0);
 saved.receipt.qvtRequestId='foreign';await assert.rejects(client.saveSingleReceiptObservation(attempt,new AbortController().signal,request));
});
async function legacyRecord(f){const packet=singlePacket(f.actor.company);packet.accountContext=digest(['sourceflow-managed-product-account-v1',packet.ownerId,packet.company.code,packet.company.name]);const context=await singleDocumentIdentity(packet,SINGLE_SENDER),state={format:packet.format,requestId:packet.requestId,identity:context.identity,identityDigest:context.identityDigest,packetDigest:context.packetDigest,originalBodySha256:context.originalBodySha256,preparedBodySha256:context.bodySha256,state:'pending',docId:'legacy-doc-728',registered:false,success:false,needsRecovery:false,
  receipt:{state:'pending',sourceStatus:'SUBMITTED',docId:'legacy-doc-728',company:f.actor.company,identityDigest:context.identityDigest,preparedBodySha256:context.bodySha256,observedAt:f.clock.now,receiptId:'legacy-qvt-728',qvtRequestId:'legacy-qvt-728',evidence:'document-receipt',registered:false}};
  return {...plain(await f.load('app/supplier-hub-single-receipt.ts').validateSingleReceiptObservation(state,packet,origin,f.clock.now)),recordedAt:new Date(f.clock.now).toISOString()};}

for(const company of SINGLE_COMPANIES)test(company.name+' mixed native history reads once per document with company before/after and queryless scope preserved',async()=>{
  const f=await fixture(company,{queryless:true});f.history=[await groupRecord(f),await legacyRecord(f)];const before=canonical(f.history),records=await f.client.readNativeReceiptHistory({productId:f.packet.review.identity.productId},new AbortController().signal,f.fetch);
  assert.equal(records.length,2);assert.equal(records[0].members.length,2);assert.equal(records[0].requestedProfileId,null);assert.equal(records[1].optionId,'synthetic-option');assert.equal(canonical(f.history),before);assert.ok(f.calls.every(call=>call.method==='GET'));assert.equal(f.calls.filter(call=>call.url.includes('product-receipt')).length,1);assert.equal(f.calls.some(call=>call.url.includes('?profileId=')),false);assert.equal(f.sent.length,0);
});

test('history rejects company change, foreign member, bad profile and malformed JSON without restoring any bridge session',async()=>{
  for(const kind of ['account-change','foreign-record','profile','malformed','redirect','html']){
    const options={beforeFetch:async(url,init,f)=>{if(kind==='account-change'&&String(url).includes('product-receipt'))f.actor={...f.actor,company:SINGLE_COMPANIES[1]};},historyResponse:undefined};
    if(kind==='malformed')options.historyResponse=()=>new Response('{',{headers:{'content-type':'application/json'}});
    if(kind==='redirect')options.historyResponse=()=>{const response=Response.json({});Object.defineProperty(response,'redirected',{value:true});return response;};
    if(kind==='html')options.historyResponse=()=>new Response('<html/>',{headers:{'content-type':'text/html'}});
    const f=await fixture(SINGLE_COMPANIES[0],options);f.history=[await groupRecord(f)];if(kind==='foreign-record')f.history[0].identity.ownerId='other-owner';
    await assert.rejects(f.client.readNativeReceiptHistory({productId:f.packet.review.identity.productId,...(kind==='profile'?{profileId:'other-profile'}:{})},new AbortController().signal,f.fetch));assert.equal(f.sent.length,0);assert.ok(f.calls.every(call=>call.method==='GET'));
  }
});

for(const company of SINGLE_COMPANIES)test(company.name+' product client permits newer rejection diagnostics for exact IDs, but rejects false success or malformed details',async()=>{
 const f=await fixture(company,{beforeSaveReply:async(record)=>{record.receipt.rejectionDetails=normalizeRejectionDetails(JSON.stringify({errors:[{columnName:'크기',message:'새로 확인한 사유'}]}));}});
 const observation=f.observation('REJECTED');observation.receipt.rejectionDetails=normalizeRejectionDetails(JSON.stringify({errors:[{columnName:'무게',message:'이전 사유'}]}));
 const attempt={packet:f.packet,observation},before=canonical(attempt),saved=await f.client.saveProductReceiptObservation(attempt,new AbortController().signal,f.fetch);
 assert.equal(saved.receipt.rejectionDetails.errors[0].columnName,'크기');assert.equal(saved.docId,observation.docId);assert.equal(saved.registered,false);assert.equal(canonical(attempt),before);assert.equal(f.sent.length,0);
 for(const mutate of [o=>o.receipt.rejectionDetails.errors[0].secret=true,o=>{o.state=o.receipt.state='accepted';o.receipt.sourceStatus='FINISHED';}]){
  const bad=plain(attempt);mutate(bad.observation);const posts=f.calls.filter(row=>row.method==='POST').length;await assert.rejects(f.client.saveProductReceiptObservation(bad,new AbortController().signal,f.fetch));assert.equal(f.calls.filter(row=>row.method==='POST').length,posts);
 }
});

for(const company of SINGLE_COMPANIES)test(company.name+' one immutable full-group observation saves once, explicit local retry preserves null query and never emits Hub action',async()=>{
  const f=await fixture(company,{queryless:true}),observation=f.observation(),attempt={packet:f.packet,observation},before=canonical(attempt),record=await f.client.saveProductReceiptObservation(attempt,new AbortController().signal,f.fetch);
  assert.equal(record.members.length,2);assert.equal(record.registered,false);assert.equal(record.receipt.qvtRequestId,'qvt-728');assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.equal(f.calls.find(call=>call.method==='POST').body.profileId,null);assert.equal(f.sent.length,0);assert.equal(canonical(attempt),before);
  const retried=await f.client.saveProductReceiptObservation(attempt,new AbortController().signal,f.fetch);assert.equal(retried.requestId,record.requestId);assert.equal(retried.docId,record.docId);assert.equal(f.sent.length,0);assert.equal(f.calls.filter(call=>call.method==='POST').length,2);cases.push({name:'local save '+company.code,members:2,records:1,querylessPreserved:true,hubActions:0});
});

test('save rejects changed full body/member/company echo and keeps original receipt after missing local ACK',async()=>{
  for(const kind of ['member','receipt','account','lost-ack']){
    const f=await fixture(SINGLE_COMPANIES[0],{beforeSaveReply:async(record,fixture)=>{if(kind==='member')record.members[1].optionId='other';if(kind==='receipt')record.receipt.qvtRequestId='other';if(kind==='account')fixture.actor={...fixture.actor,company:SINGLE_COMPANIES[1]};if(kind==='lost-ack')throw Error('Synthetic local save response lost');}}),attempt={packet:f.packet,observation:f.observation()},before=canonical(attempt);
    await assert.rejects(f.client.saveProductReceiptObservation(attempt,new AbortController().signal,f.fetch));assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.equal(f.sent.length,0);assert.equal(canonical(attempt),before);
  }
  const mismatched=await fixture(),observation=mismatched.observation();observation.requestId='other-original-request';await assert.rejects(mismatched.client.saveProductReceiptObservation({packet:mismatched.packet,observation},new AbortController().signal,mismatched.fetch));assert.equal(mismatched.calls.filter(call=>call.method==='POST').length,0);assert.equal(mismatched.sent.length,0);
});

test('terminal transport metadata is copied away before strict local receipt save; unknown extras and tampered facts still reject',async()=>{
  for(const metadata of [{duplicate:true},{recovered:true},{error:{code:'READBACK_FAILED',message:'이전 접수 증거를 유지한 조회 오류'}},{duplicate:false,recovered:true,error:{code:'CHECKPOINT_CONFLICT',message:'더 최신 보관 결과를 유지합니다.'}}]){
    const f=await fixture(SINGLE_COMPANIES[0],{verified:true}),session=await f.session();f.bridge=async()=>({...f.observation('FINISHED'),...metadata});
    const observation=await f.client.runProductDocument(session,'observe',new AbortController().signal),before=canonical(observation);
    const saved=await f.client.saveProductReceiptObservation({packet:f.packet,observation},new AbortController().signal,f.fetch);assert.equal(saved.receipt.state,'accepted');assert.equal(saved.members.length,2);assert.equal(saved.registered,false);
    const posts=f.calls.filter(call=>call.method==='POST');assert.equal(posts.length,1);assert.equal(Object.hasOwn(posts[0].body.observation,'duplicate'),false);assert.equal(Object.hasOwn(posts[0].body.observation,'recovered'),false);assert.equal(Object.hasOwn(posts[0].body.observation,'error'),false);assert.equal(canonical(observation),before);assert.equal(f.sent.length,2);
  }
  for(const patch of [value=>value.unknown='unsupported',value=>value.duplicate='true',value=>value.recovered='true',value=>value.error={code:'X',message:'diagnostic',unknown:true},value=>{value.recovered=true;value.receipt.qvtRequestId='tampered';}]){
    const f=await fixture(),observation=f.observation();patch(observation);await assert.rejects(f.client.saveProductReceiptObservation({packet:f.packet,observation},new AbortController().signal,f.fetch));assert.equal(f.calls.filter(call=>call.method==='POST').length,0);assert.equal(f.sent.length,0);
  }
});
