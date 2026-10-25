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
 const input={binding,method:'POST',path:'/sr/draft/api/create',operationId:'original-request:create',body,baselineDocIds:[7],retryCreateApproval:{attempt:1,originalSequence:3,originalRequestedAt:now-120000,approvedAt:now}},calls=[],dataset={};
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
 const context=vm.createContext({document,location,fetch,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,Date});
 const run=()=>vm.runInContext('('+singleDocumentRetryCreatePage.toString()+')',context)(structuredClone(input));
 return{input,binding,body,dataset,calls,document,location,old,run};
}

test('approved retry reads both complete lists immediately before one create with the original request and body',async()=>{
 const f=pageFixture(),result=await f.run();assert.equal(result.ok,true);assert.equal(result.json.docId,99);
 assert.deepEqual(f.calls,[{path:'/sr/draft/api/drafts',method:'GET'},{path:'/sr/draft/api/drafts/register-requested',method:'GET'},{path:'/sr/draft/api/create',method:'POST'}]);
 const record=JSON.parse(f.dataset.yoofamSingleDocumentRecords)[f.binding.packetDigest];assert.equal(record.docId,99);assert.equal(record.createOperationId,'original-request:create');
 assert.equal(record.createRetry.unfinishedCount,1);assert.equal(record.createRetry.requestedCount,0);
 await assert.rejects(f.run());assert.equal(f.calls.length,3,'a persisted attempt cannot dispatch again');
});

test('duplicate, changed baseline, newer remote activity, failed lists, changed body/company or existing marker blocks the retry before any POST',async()=>{
 for(const mode of ['title','baseline','newer','requested','http','body','company','marker','approval']){
  const f=pageFixture();
  if(mode==='title')f.input.body.productName=f.old.productName;
  if(mode==='baseline')f.input.baselineDocIds=[];
  if(mode==='newer')f.input.retryCreateApproval.originalRequestedAt=1;
  if(mode==='requested'){const other=pageFixture({requested:[{...f.old,docId:8,productName:f.body.productName}]});await assert.rejects(other.run());assert.equal(other.calls.some(c=>c.method==='POST'),false);continue;}
  if(mode==='http'){const other=pageFixture({status:503});await assert.rejects(other.run());assert.equal(other.calls.some(c=>c.method==='POST'),false);continue;}
  if(mode==='body')f.input.body.jsonDocument[0].productPage.supplyPrice=999;
  if(mode==='company')f.document.body.innerText='Company Code: A01464742';
  if(mode==='marker')f.dataset.yoofamSingleDocumentRecords=JSON.stringify({[f.binding.packetDigest]:{state:'create-requested'}});
  if(mode==='approval')f.input.retryCreateApproval.attempt=2;
  await assert.rejects(f.run(),undefined,mode);assert.equal(f.calls.some(c=>c.method==='POST'),false,mode);
 }
});

test('a lost retry ACK preserves the one attempt marker and never replays creation',async()=>{
 const f=pageFixture({lostAck:true});await assert.rejects(f.run());await assert.rejects(f.run());
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(JSON.parse(f.dataset.yoofamSingleDocumentRecords)[f.binding.packetDigest].docId,null);
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
