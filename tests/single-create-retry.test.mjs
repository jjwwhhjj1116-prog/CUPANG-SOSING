import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {singleDocumentRetryCreatePage} from '../extensions/supplier-hub/single-create-retry-page.mjs';
import {nativeRecoveryFixture} from './helpers/native-product-recovery.mjs';
import {createProductDocumentDraftReceiver} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {createProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';

const canon=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canon).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}';
function pageFixture(options={}){
 const now=Date.now(),body={docId:null,productName:'합성 886 재시도 상품',scope:'Retail_Categorized_Single',jsonDocument:[{productPage:{supplyPrice:3420}}]},digest=createHash('sha256').update(canon(body)).digest('hex');
 const binding={identity:{company:{code:'A01526306',name:'유앤채'},members:[{documentIndex:0}]},identityDigest:'a'.repeat(64),packetDigest:'b'.repeat(64),preparedBodySha256:digest,originalBodySha256:'c'.repeat(64),nativeAssetSourcePlanSha256:'d'.repeat(64),requestId:'original-request'};
 const input={binding,method:'POST',path:'/sr/draft/api/create',operationId:'original-request:create',body,verifiedBodyCanonical:canon(body),baselineDocIds:[7],retryCreateApproval:{attempt:1,originalSequence:3,originalRequestedAt:now-120000,approvedAt:now}},calls=[],dataset={};
 const old={docId:7,productName:'기존 보호 상품',modifiedAt:new Date(now-86400000).toISOString()};
 const document={documentElement:{dataset},body:{innerText:'Company Code: A01526306'},querySelectorAll:()=>[]},location=new URL('https://supplier.coupang.com/dashboard/KR');
 const fetch=async(url,init)=>{
  calls.push({path:new URL(url).pathname,method:init.method});
  let value=options.rows??[old];
  if(url.endsWith('/register-requested'))value=options.requested??[];
  if(init.method==='POST'){
   const record=JSON.parse(dataset.yoofamSingleDocumentRecords)[binding.packetDigest];assert.equal(record.state,'create-requested');assert.equal(record.createRetry.attempt,1);
   assert.deepEqual(JSON.parse(init.body),body);if(options.lostAck)throw Error('lost ACK');value={docId:99};
  }
  const result=Response.json(value,{status:options.status??200});Object.defineProperty(result,'url',{value:url});return result;
 };
 const context=vm.createContext({document,location,fetch,crypto:options.noCrypto?undefined:webcrypto,TextEncoder:options.noCrypto?undefined:TextEncoder,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,Date});
 const run=(wire={})=>{let argument=wire.json?JSON.stringify(input):structuredClone(input);if(wire.dropNull)argument=JSON.parse(JSON.stringify(argument,(key,value)=>value===null?undefined:value));return vm.runInContext('('+singleDocumentRetryCreatePage.toString()+')',context)(argument);};
 return{input,binding,body,dataset,calls,document,location,old,run};
}

test('approved retry reads both complete lists immediately before one create with the original request and body',async()=>{
 const f=pageFixture(),result=await f.run();assert.equal(result.ok,true);assert.equal(result.json.docId,99);
 assert.deepEqual(f.calls,[{path:'/sr/draft/api/drafts',method:'GET'},{path:'/sr/draft/api/drafts/register-requested',method:'GET'},{path:'/sr/draft/api/create',method:'POST'}]);
 const record=JSON.parse(f.dataset.yoofamSingleDocumentRecords)[f.binding.packetDigest];assert.equal(record.docId,99);assert.equal(record.createOperationId,'original-request:create');
 assert.equal(record.createRetry.unfinishedCount,1);assert.equal(record.createRetry.requestedCount,0);
 const blocked=await f.run();assert.equal(blocked.ok,false);assert.equal(blocked.createRetryFailure.canContinue,false);assert.equal(f.calls.length,3,'a persisted attempt cannot dispatch again');
});

test('duplicate, changed baseline, failed lists, changed body/company or existing marker blocks the retry before any POST',async()=>{
 for(const mode of ['title','baseline','requested','http','body','company','marker','approval']){
  const f=pageFixture();
  if(mode==='title')f.input.body.productName=f.old.productName;
  if(mode==='baseline')f.input.baselineDocIds=[];
  if(mode==='requested'){const other=pageFixture({requested:[{...f.old,docId:8,productName:f.body.productName}]});const blocked=await other.run();assert.equal(blocked.createRetryFailure.phase,'duplicate');assert.equal(blocked.createRetryFailure.canContinue,false);assert.equal(other.calls.some(c=>c.method==='POST'),false);continue;}
  if(mode==='http'){const other=pageFixture({status:503});const blocked=await other.run();assert.equal(blocked.createRetryFailure.phase,'list-unfinished');assert.equal(blocked.createRetryFailure.dispatched,false);assert.equal(blocked.createRetryFailure.canContinue,true);assert.equal(other.calls.some(c=>c.method==='POST'),false);continue;}
  if(mode==='body')f.input.body.jsonDocument[0].productPage.supplyPrice=999;
  if(mode==='company')f.document.body.innerText='Company Code: A01464742';
  if(mode==='marker')f.dataset.yoofamSingleDocumentRecords=JSON.stringify({[f.binding.packetDigest]:{state:'create-requested'}});
  if(mode==='approval')f.input.retryCreateApproval.attempt=2;
  const blocked=await f.run();assert.equal(blocked.ok,false,mode);assert.equal(blocked.createRetryFailure.dispatched,false,mode);assert.equal(f.calls.some(c=>c.method==='POST'),false,mode);
 }
});

test('a lost retry ACK preserves the one attempt marker and never replays creation',async()=>{
 const f=pageFixture({lostAck:true}),lost=await f.run(),blocked=await f.run();assert.equal(lost.createRetryFailure.dispatched,true);assert.equal(lost.createRetryFailure.canContinue,false);assert.equal(blocked.createRetryFailure.canContinue,false);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(JSON.parse(f.dataset.yoofamSingleDocumentRecords)[f.binding.packetDigest].docId,null);
});

test('verified body comparison has no dependency on destination crypto and read-only inspection cannot dispatch or write a marker',async()=>{
 const f=pageFixture({noCrypto:true});f.input.inspectOnly=true;
 const result=await f.run();assert.equal(result.json.retryPrecheck.remoteWrites,false);assert.equal(result.json.retryPrecheck.markerAbsent,true);
 assert.equal(f.calls.length,2);assert.ok(f.calls.every(call=>call.method==='GET'));assert.deepEqual(f.dataset,{});
 delete f.input.inspectOnly;assert.equal((await f.run()).ok,true);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
});

test('read-only inspection retains the original approval but rejects a changed exact body, duplicate, or existing marker',async()=>{
 for(const mode of ['body','duplicate','marker']){const f=pageFixture(mode==='duplicate'?{requested:[{docId:99,productName:'합성 886 재시도 상품',modifiedAt:new Date().toISOString()}]}:{});f.input.inspectOnly=true;
  if(mode==='body')f.input.body.productName='changed';if(mode==='marker')f.dataset.yoofamSingleDocumentRecords=JSON.stringify({[f.binding.packetDigest]:{state:'create-requested'}});
  assert.equal((await f.run()).ok,false);assert.equal(f.calls.some(call=>call.method==='POST'),false);
 }
});

test('read-only structural failures identify the exact predicate without reaching any remote request',async()=>{
 const cases=[['body-document-id',f=>{f.input.body.docId=1;}],['body-scope',f=>{f.input.body.scope='changed';}],['body-members',f=>{f.input.binding.identity.members=null;}],
  ['body-document-count',f=>{f.input.body.jsonDocument=[];}],['body-member-order',f=>{f.input.binding.identity.members[0].documentIndex=1;}],['body-product-name',f=>{f.input.body.productName='';}]];
 for(const [phase,change]of cases){const f=pageFixture();f.input.inspectOnly=true;change(f);const result=await f.run();assert.equal(result.createRetryFailure.phase,phase);assert.equal(result.createRetryFailure.dispatched,false);assert.deepEqual(f.calls,[]);assert.deepEqual(f.dataset,{});}
});

test('the exact JSON wire preserves the null new-document ID through a lossy object-argument boundary',async()=>{
 const broken=pageFixture();broken.input.inspectOnly=true;
 assert.equal((await broken.run({dropNull:true})).createRetryFailure.phase,'body-document-id');assert.deepEqual(broken.calls,[]);
 const fixed=pageFixture();fixed.input.inspectOnly=true;
 assert.equal((await fixed.run({json:true,dropNull:true})).json.retryPrecheck.remoteWrites,false);assert.equal(fixed.calls.length,2);assert.deepEqual(fixed.dataset,{});
 fixed.input.body.docId=10;assert.equal((await fixed.run({json:true,dropNull:true})).createRetryFailure.phase,'body-document-id');
 assert.equal(fixed.calls.some(call=>call.method==='POST'),false,'serialization never repairs a genuinely non-null existing document ID');
});

test('native original-request retry, private uploads and four-step preparation retain exact values across lossy object arguments',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});let f;
 try{
  f=await nativeRecoveryFixture(undefined,{sourceSessionId:'json-wire-null-fidelity',browser:{dropNullArguments:true}});const prior=structuredClone(f.documents.get(f.prior.docId));
  const dropped={...f.adapter,hubRequest:async input=>input.method==='POST'&&input.path.endsWith('/create')?undefined:f.adapter.hubRequest(input)};
  const legacy=createProductDocumentDraftReceiver({adapter:dropped,store:f.storage.store});await legacy.prepareDraft(f.packet,f.sender);t.mock.timers.tick(61000);await legacy.retryCreateDraft(f.packet,f.sender);await legacy.resumeCreateRetryDraft(f.packet,f.sender);
  const receiver=createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store}),recovered=await receiver.recoverDraft(f.packet,f.sender);
  assert.equal(recovered.state,'target-created',JSON.stringify(recovered));assert.equal(recovered.requestId,f.packet.requestId);
  const packet=await createProductDocumentPacket(f.packet.review,{requestId:f.packet.requestId,createdAt:Date.now(),now:Date.now()}),done=await receiver.prepareDraft(packet,f.sender);
  assert.equal(done.state,'validated',JSON.stringify(done));assert.deepEqual(done.draftProof.validatedSteps,[2,3,4,5]);
  assert.equal(f.calls.filter(c=>c.name==='hub-fetch'&&c.init.method==='POST'&&c.url.endsWith('/create')).length,1);
  assert.deepEqual(f.documents.get(f.prior.docId),prior);assert.equal(f.submitted,0);
 }finally{f?.close();t.mock.timers.reset();}
});

test('ordinary native preparation also retains the null create ID and file-plan values over the JSON wire',async()=>{
 const f=await nativeRecoveryFixture(undefined,{sourceSessionId:'ordinary-json-wire',browser:{dropNullArguments:true}});
 try{const receiver=createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store}),result=await receiver.prepareDraft(f.packet,f.sender);
  assert.equal(result.state,'validated',JSON.stringify(result));assert.equal(result.draftProof.validatedSteps.length,4);
  assert.equal(f.calls.filter(c=>c.name==='hub-fetch'&&c.init.method==='POST'&&c.url.endsWith('/create')).length,1);assert.equal(f.submitted,0);
 }finally{f.close();}
});

test('unrelated newly submitted activity does not block the original approved retry, while the same title does',async()=>{
 const f=pageFixture({requested:[{docId:2346424,productName:'다른 PP 배수 바구니',modifiedAt:new Date().toISOString()}]});
 f.input.retryCreateApproval.approvedAt-=300000;f.input.retryCreateApproval.originalRequestedAt-=300000;
 const result=await f.run();assert.equal(result.ok,true);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
 const duplicate=pageFixture({requested:[{docId:2346424,productName:f.body.productName,modifiedAt:new Date().toISOString()}]});
 const rejected=await duplicate.run();assert.equal(rejected.createRetryFailure.phase,'duplicate');assert.equal(duplicate.calls.some(c=>c.method==='POST'),false);
});

test('a legacy interrupted approved retry continues once with its UUID, audit and owned tab; a sent marker cannot replay',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});let f;
 try{
  f=await nativeRecoveryFixture(undefined,{sourceSessionId:'legacy-approved-source'});const prior=structuredClone(f.documents.get(f.prior.docId));
  const dropped={...f.adapter,hubRequest:async input=>input.method==='POST'&&input.path.endsWith('/create')?undefined:f.adapter.hubRequest(input)};
  const legacy=createProductDocumentDraftReceiver({adapter:dropped,store:f.storage.store});
  await legacy.prepareDraft(f.packet,f.sender);t.mock.timers.tick(61000);
  const pending=await legacy.retryCreateDraft(f.packet,f.sender);assert.equal(pending.state,'create-requested');assert.equal(pending.draftProof.createRetryApproved,true);
  assert.equal(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords,undefined);
  const packet=await createProductDocumentPacket(f.packet.review,{requestId:f.packet.requestId,createdAt:Date.now(),now:Date.now()});
  const receiver=createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store});
  const result=await receiver.resumeCreateRetryDraft(packet,f.sender);assert.equal(result.state,'created',JSON.stringify(result));assert.equal(result.requestId,f.packet.requestId);
  await receiver.resumeCreateRetryDraft(packet,f.sender);await receiver.retryCreateDraft(packet,f.sender);
  assert.equal(f.calls.filter(c=>c.name==='hub-fetch'&&c.init.method==='POST'&&c.url.endsWith('/create')).length,1);
  const record=JSON.parse(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords)[f.context.packetDigest];
  assert.equal(record.createRetry.attempt,1);assert.equal(record.createRetry.resumeUsed,true);
  assert.equal(f.calls.filter(c=>c.name==='tabs-create').length,1);assert.deepEqual(f.documents.get(f.prior.docId),prior);assert.equal(f.submitted,0);
 }finally{f?.close();t.mock.timers.reset();}
});

test('actual native receiver retains the UUID and owned target, creates once, and resumes the remaining preparation without modifying a prior draft',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});let f;
 try{
  f=await nativeRecoveryFixture(undefined,{sourceSessionId:'original-retry-source'});const prior=structuredClone(f.documents.get(f.prior.docId));
  const interrupted=createProductDocumentDraftReceiver({adapter:{...f.adapter,hubRequest:async input=>{if(input.method==='POST'&&input.path.endsWith('/create'))throw Error('old unobserved create');return f.adapter.hubRequest(input);}},store:f.storage.store});
  const first=await interrupted.prepareDraft(f.packet,f.sender);assert.equal(first.state,'create-requested');assert.equal(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords,undefined);
  t.mock.timers.tick(61000);
  const receiver=createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store});const retried=await receiver.retryCreateDraft(f.packet,f.sender);
  assert.equal(retried.state,'created',JSON.stringify(retried));assert.equal(retried.docId,f.createdDocId);assert.equal(retried.requestId,f.packet.requestId);
  const posts=()=>f.calls.filter(c=>c.name==='hub-fetch'&&c.init.method==='POST'&&c.url.endsWith('/create')).length;
  assert.equal(posts(),1);await receiver.retryCreateDraft(f.packet,f.sender);assert.equal(posts(),1);
  const packet=await createProductDocumentPacket(f.packet.review,{requestId:f.packet.requestId,createdAt:Date.now(),now:Date.now()});
  const completed=await receiver.prepareDraft(packet,f.sender);assert.equal(completed.state,'validated',JSON.stringify(completed));assert.equal(completed.draftProof.validatedSteps.length,4);
  assert.equal(posts(),1);assert.equal(f.calls.filter(c=>c.name==='tabs-create').length,1);assert.deepEqual(f.documents.get(f.prior.docId),prior);assert.equal(f.submitted,0);
 }finally{f?.close();t.mock.timers.reset();}
});

test('a confirmed unsent list failure preserves approval and rolls back only to same-target preparation',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});let f;
 try{
  f=await nativeRecoveryFixture(undefined,{sourceSessionId:'unsent-approved-source',browser:{registerRequestedStatus:503}});
  const interrupted=createProductDocumentDraftReceiver({adapter:{...f.adapter,hubRequest:async input=>input.method==='POST'&&input.path.endsWith('/create')?undefined:f.adapter.hubRequest(input)},store:f.storage.store});
  await assert.rejects(interrupted.resumeCreateRetryDraft(f.packet,f.sender),error=>error.code==='CHECKPOINT');
  await interrupted.prepareDraft(f.packet,f.sender);t.mock.timers.tick(61000);
  const receiver=createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store});
  const pending=await receiver.retryCreateDraft(f.packet,f.sender);
  assert.equal(pending.state,'target-created',JSON.stringify(pending));assert.equal(pending.error.code,'CREATE_RETRY_PRECHECK_NOT_SENT');assert.equal(pending.draftProof.createRetryApproved,true);
  assert.equal(f.calls.some(c=>c.name==='hub-fetch'&&c.init.method==='POST'&&c.url.endsWith('/create')),false);
  assert.equal(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords,undefined);
 }finally{f?.close();t.mock.timers.reset();}
});

test('read recovery after a legacy unsent approved continuation proves source, marker and both lists before same-request preparation',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});let f;
 try{
  f=await nativeRecoveryFixture(undefined,{sourceSessionId:'read-only-create-inspection'});const prior=structuredClone(f.documents.get(f.prior.docId));
  const dropped={...f.adapter,hubRequest:async input=>input.method==='POST'&&input.path.endsWith('/create')?undefined:f.adapter.hubRequest(input)};
  const legacy=createProductDocumentDraftReceiver({adapter:dropped,store:f.storage.store});await legacy.prepareDraft(f.packet,f.sender);t.mock.timers.tick(61000);
  await legacy.retryCreateDraft(f.packet,f.sender);await legacy.resumeCreateRetryDraft(f.packet,f.sender);
  const receiver=createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store}),recovered=await receiver.recoverDraft(f.packet,f.sender);
  assert.equal(recovered.state,'target-created',JSON.stringify(recovered));assert.equal(recovered.recovered,true);assert.equal(recovered.draftProof.createRetryApproved,true);
  const posts=()=>f.calls.filter(c=>c.name==='hub-fetch'&&c.init.method==='POST'&&c.url.endsWith('/create')).length;assert.equal(posts(),0);
  const packet=await createProductDocumentPacket(f.packet.review,{requestId:f.packet.requestId,createdAt:Date.now(),now:Date.now()});
  const done=await receiver.prepareDraft(packet,f.sender);assert.equal(done.state,'validated',JSON.stringify(done));assert.equal(posts(),1);
  await receiver.recoverDraft(packet,f.sender);assert.equal(posts(),1);assert.deepEqual(f.documents.get(f.prior.docId),prior);assert.equal(f.submitted,0);
 }finally{f?.close();t.mock.timers.reset();}
});

test('read-only retry recovery reports the correlated failing list without creating or releasing the original checkpoint',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});let f;
 try{
  f=await nativeRecoveryFixture(undefined,{sourceSessionId:'inspect-list-diagnostic',browser:{registerRequestedStatus:503}});
  const dropped={...f.adapter,hubRequest:async input=>input.method==='POST'&&input.path.endsWith('/create')?undefined:f.adapter.hubRequest(input)};
  const legacy=createProductDocumentDraftReceiver({adapter:dropped,store:f.storage.store});
  await legacy.prepareDraft(f.packet,f.sender);t.mock.timers.tick(61000);await legacy.retryCreateDraft(f.packet,f.sender);await legacy.resumeCreateRetryDraft(f.packet,f.sender);
  const receiver=createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store}),result=await receiver.recoverDraft(f.packet,f.sender);
  assert.equal(result.state,'create-requested');assert.equal(result.error.code,'CREATE_RETRY_INSPECTION_BLOCKED');assert.match(result.error.message,/제출요청 목록/);
  assert.equal(result.requestId,f.packet.requestId);assert.equal(result.docId,null);
  assert.equal(f.calls.some(c=>c.name==='hub-fetch'&&c.init.method==='POST'&&c.url.endsWith('/create')),false);
  assert.equal(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords,undefined);
 }finally{f?.close();t.mock.timers.reset();}
});
