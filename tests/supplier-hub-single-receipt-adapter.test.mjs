import test from 'node:test';
import assert from 'node:assert/strict';
import {singleBrowserFixture} from './helpers/supplier-hub-single-document-adapter.mjs';
import {SINGLE_COMPANIES} from './helpers/supplier-hub-single-document.mjs';
import {createSingleDocumentBrowserAdapter} from '../extensions/supplier-hub/single-document-adapter.mjs';
import {createSingleDocumentReceiver} from '../extensions/supplier-hub/single-document.mjs';

const requestPath='/sr/draft/api/drafts/register-requested';
const protectedDocument=f=>assert.deepEqual(f.documents.get('protected-previous'),f.prior);
const countWrites=f=>f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').length;
const countReceiptReads=f=>f.calls.filter(call=>call.name==='hub-fetch'&&new URL(call.url).pathname===requestPath).length;
const ownRow=(f,changes={})=>({docId:f.createdDocId,status:'SUBMITTED',qvtRequestId:'000657-QVT-raw',
  productName:f.documents.get(f.createdDocId).productName,categoryPath:f.documents.get(f.createdDocId).categoryPath,modifiedAt:new Date(Date.now()+f.clockOffset).toISOString(),remark:'',...changes});
async function readyFinal(f){
  let result=await f.receiver.start(f.packet,f.sender);
  for(let index=0;index<2&&result.state==='awaiting-stage-consent';index++)result=await f.receiver.confirm(f.packet,f.sender,f.action(result));
  assert.equal(result.state,'awaiting-consent',JSON.stringify(result));assert.equal(f.submitted,0);return result;
}
async function submit(f){const final=await readyFinal(f);return f.receiver.confirm(f.packet,f.sender,f.action(final));}
const receiptOptions=extra=>({stageFlow:true,registerRequestedRows:f=>[ownRow(f)],...extra});
function receiptInput(f,result){return {tab:{tabId:71,windowId:f.sender.tab.windowId,origin:'https://supplier.coupang.com',company:f.company},identity:f.context.identity,identityDigest:f.context.identityDigest,
  preparedBodySha256:f.context.bodySha256,docId:result.docId,operationId:f.packet.requestId+':submit',submitRequestedAt:Date.now()+f.clockOffset,
  expectedBody:{...structuredClone(f.context.packet.body),docId:result.docId}};}

for(const company of SINGLE_COMPANIES)test(company.name+' fresh exact request row progresses pending to accepted while raw QVT ID remains distinct from SKU completion',async()=>{
  let status='SUBMITTED';const f=await singleBrowserFixture(company,receiptOptions({registerRequestedRows:f=>[ownRow(f,{status})]}));
  try{
    const pending=await submit(f);assert.equal(pending.state,'pending',JSON.stringify(pending));assert.equal(pending.registered,false);assert.equal(pending.success,false);
    assert.equal(pending.receipt.receiptId,'000657-QVT-raw');assert.equal(pending.receipt.docId,f.createdDocId);assert.equal(pending.receipt.evidence,'document-receipt');assert.equal(pending.receipt.skuId,undefined);
    const writes=countWrites(f),reads=countReceiptReads(f),submitted=f.submitted;status='FINISHED';const accepted=await f.receiver.observe(f.packet,f.sender);
    assert.equal(accepted.state,'accepted',JSON.stringify(accepted));assert.equal(accepted.registered,false);assert.equal(accepted.success,false);assert.equal(accepted.receipt.receiptId,pending.receipt.receiptId);assert.equal(accepted.receipt.skuId,undefined);
    assert.ok(countReceiptReads(f)>reads);assert.equal(countWrites(f),writes);assert.equal(f.submitted,submitted);assert.equal(submitted,1);protectedDocument(f);
    const lookup=f.calls.filter(call=>call.name==='hub-fetch'&&new URL(call.url).pathname===requestPath);assert.ok(lookup.every(call=>call.init.method==='GET'&&call.init.credentials==='include'&&call.init.redirect==='error'&&call.init.body===undefined));
  }finally{f.close();}
});

test('fresh REJECTED request stays rejected without marking a SKU registered or replaying submit',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],receiptOptions({registerRequestedRows:f=>[ownRow(f,{status:'REJECTED',remark:JSON.stringify({errors:[{columnName:'color',message:'합성 입력 반려'}]})})]}));
  try{const rejected=await submit(f);assert.equal(rejected.state,'rejected',JSON.stringify(rejected));assert.equal(rejected.registered,false);assert.equal(rejected.success,false);assert.equal(rejected.receipt.receiptId,'000657-QVT-raw');
    const writes=countWrites(f);await f.receiver.recover(f.packet,f.sender);assert.equal(countWrites(f),writes);assert.equal(f.submitted,1);protectedDocument(f);
  }finally{f.close();}
});

test('fresh empty list overrides stale completion UI and never causes an automatic resubmit',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],receiptOptions({registerRequestedRows:[]}));
  try{const result=await submit(f);assert.equal(f.hubDocument.querySelector('.text-primary').innerText,'상품 등록 완료');assert.equal(result.state,'submit-requested',JSON.stringify(result));assert.equal(result.registered,false);assert.equal(result.receipt,undefined);
    const writes=countWrites(f);await f.receiver.recover(f.packet,f.sender);await f.receiver.observe(f.packet,f.sender);await f.receiver.start(f.packet,f.sender);
    assert.equal(countWrites(f),writes);assert.equal(f.submitted,1);assert.ok(countReceiptReads(f)>=3);protectedDocument(f);
  }finally{f.close();}
});

test('duplicated exact docId rows are ambiguous and cannot be deduplicated into success',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],receiptOptions({registerRequestedRows:f=>[ownRow(f),ownRow(f)]}));
  try{const result=await submit(f);assert.equal(result.state,'submit-requested',JSON.stringify(result));assert.equal(result.receipt,undefined);assert.equal(result.registered,false);assert.equal(f.submitted,1);protectedDocument(f);}finally{f.close();}
});

test('a different docId with identical title/category is not the newly owned request',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],receiptOptions({registerRequestedRows:f=>[ownRow(f,{docId:'protected-previous',status:'FINISHED'})]}));
  try{const result=await submit(f);assert.equal(result.state,'submit-requested',JSON.stringify(result));assert.equal(result.receipt,undefined);assert.equal(result.registered,false);assert.equal(f.submitted,1);protectedDocument(f);}finally{f.close();}
});

test('foreign unrelated request rows may be present but only the exact owned docId can supply raw QVT evidence',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],receiptOptions({registerRequestedRows:f=>[ownRow(f,{docId:'protected-previous',productName:f.prior.productName,categoryPath:f.prior.categoryPath,qvtRequestId:'foreign-qvt'}),ownRow(f)]}));
  try{const result=await submit(f);assert.equal(result.state,'pending',JSON.stringify(result));assert.equal(result.receipt.receiptId,'000657-QVT-raw');assert.equal(result.receipt.docId,f.createdDocId);protectedDocument(f);}finally{f.close();}
});

test('unknown status, wrong document data, missing or abbreviated QVT IDs are not authoritative receipts',async()=>{
  for(const changes of [{status:'UNKNOWN'},{status:'UNFINISHED'},{productName:'same-company other saved name'},{categoryPath:'다른 카테고리 (99999)'},{qvtRequestId:null},{qvtRequestId:''},{qvtRequestId:'partial…'},{qvtRequestId:'partial...'}]){
    const f=await singleBrowserFixture(SINGLE_COMPANIES[0],receiptOptions({registerRequestedRows:f=>[ownRow(f,changes)]}));
    try{const result=await submit(f);assert.equal(result.state,'submit-requested',JSON.stringify({changes,result}));assert.equal(result.registered,false);assert.equal(result.receipt,undefined);assert.equal(f.submitted,1);protectedDocument(f);}finally{f.close();}
  }
});

test('request lookup consumes fresh direct JSON arrays and refuses guessed response wrappers',async()=>{
  for(const wrapper of [f=>({code:200,data:[ownRow(f)]}),f=>({requests:[ownRow(f)]}),f=>ownRow(f),()=>null]){
    const f=await singleBrowserFixture(SINGLE_COMPANIES[0],receiptOptions({registerRequestedRows:f=>wrapper(f)}));
    try{const result=await submit(f);assert.equal(result.state,'submit-requested',JSON.stringify(result));assert.equal(result.receipt,undefined);assert.equal(result.registered,false);protectedDocument(f);}finally{f.close();}
  }
});

test('HTTP errors, non-JSON and foreign/redirected response URLs cannot supply receipt provenance',async()=>{
  for(const settings of [{registerRequestedStatus:403},{registerRequestedContentType:'text/html'},{registerRequestedUrl:'https://other.test/register-requested'},{registerRequestedRedirected:true}]){
    const f=await singleBrowserFixture(SINGLE_COMPANIES[0],receiptOptions(settings));
    try{const result=await submit(f);assert.equal(result.state,'submit-requested',JSON.stringify({settings,result}));assert.equal(result.receipt,undefined);assert.equal(result.registered,false);assert.equal(f.submitted,1);protectedDocument(f);}finally{f.close();}
  }
});

test('previous raw QVT ID is immutable across repeated fresh observations',async()=>{
  let changed=false;const f=await singleBrowserFixture(SINGLE_COMPANIES[0],receiptOptions({registerRequestedRows:f=>[ownRow(f,{qvtRequestId:changed?'another-QVT-ID':'000657-QVT-raw',status:changed?'FINISHED':'SUBMITTED'})]}));
  try{const initial=await submit(f);assert.equal(initial.state,'pending',JSON.stringify(initial));changed=true;const writes=countWrites(f),result=await f.receiver.observe(f.packet,f.sender);
    assert.equal(result.state,'pending',JSON.stringify(result));assert.equal(result.error.code,'RECEIPT_CHANGED');assert.equal(result.receipt.receiptId,initial.receipt.receiptId);assert.equal(result.registered,false);assert.equal(countWrites(f),writes);assert.equal(f.submitted,1);protectedDocument(f);
  }finally{f.close();}
});

test('accepted request state cannot regress to pending from another list read',async()=>{
  let status='FINISHED';const f=await singleBrowserFixture(SINGLE_COMPANIES[0],receiptOptions({registerRequestedRows:f=>[ownRow(f,{status})]}));
  try{const initial=await submit(f);assert.equal(initial.state,'accepted',JSON.stringify(initial));status='SUBMITTED';const result=await f.receiver.observe(f.packet,f.sender);
    assert.equal(result.state,'accepted');assert.equal(result.error.code,'RECEIPT_CHANGED');assert.equal(result.registered,false);assert.equal(result.receipt.receiptId,initial.receipt.receiptId);assert.equal(f.submitted,1);protectedDocument(f);
  }finally{f.close();}
});

test('a forged pre-submit receipt observation cannot request the list or claim completion',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],receiptOptions());
  try{const final=await readyFinal(f),reads=countReceiptReads(f),writes=countWrites(f);await assert.rejects(f.adapter.observeReceipt(receiptInput(f,final)));
    assert.equal(countReceiptReads(f),reads);assert.equal(countWrites(f),writes);assert.equal(f.submitted,0);protectedDocument(f);
  }finally{f.close();}
});

test('a caller cannot turn the receipt lookup into a POST, body-bearing GET, different operation or guessed endpoint',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],receiptOptions());
  try{const result=await submit(f);assert.equal(result.state,'pending',JSON.stringify(result));const reads=countReceiptReads(f),writes=countWrites(f);
    const base={identity:f.context.identity,sessionId:f.sessionId,tab:{tabId:71},method:'GET',path:requestPath,operationId:f.packet.requestId+':submit'};
    for(const changes of [{method:'POST',body:{docId:f.createdDocId}},{body:{docId:f.createdDocId}},{operationId:'different:submit'},{path:requestPath+'?docId='+f.createdDocId},{path:requestPath+'/other'}])await assert.rejects(f.adapter.hubRequest({...base,...changes}));
    assert.equal(countReceiptReads(f),reads);assert.equal(countWrites(f),writes);assert.equal(f.submitted,1);protectedDocument(f);
  }finally{f.close();}
});

test('changed owned submit proof cannot reuse the previously accepted receipt lookup scope',async()=>{
  for(const mutate of [proof=>{proof.docId='protected-previous';},proof=>{proof.operationId='different:submit';},proof=>{proof.preparedBodySha256='f'.repeat(64);},proof=>{proof.identityDigest='f'.repeat(64);},proof=>{proof.version+=1;},proof=>{proof.requestedAt+=100000;}]){
    const f=await singleBrowserFixture(SINGLE_COMPANIES[0],receiptOptions());
    try{const initial=await submit(f);assert.equal(initial.state,'pending',JSON.stringify(initial));const records=JSON.parse(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords),reads=countReceiptReads(f);
      mutate(records[f.context.packetDigest].submitProof);f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords=JSON.stringify(records);
      const result=await f.receiver.observe(f.packet,f.sender);assert.equal(result.registered,false);assert.equal(result.error.code,'RECEIPT_UNCONFIRMED');assert.equal(result.receipt.receiptId,initial.receipt.receiptId);assert.equal(countReceiptReads(f),reads);assert.equal(f.submitted,1);protectedDocument(f);
    }finally{f.close();}
  }
});

test('current company or saved source changing during the authoritative GET cannot return acceptance',async()=>{
  for(const mode of ['company','source']){
    const f=await singleBrowserFixture(SINGLE_COMPANIES[0],receiptOptions({beforeHubFetch:(url,_init,f)=>{if(new URL(url).pathname===requestPath){
      if(mode==='company')f.company={code:'A01464742',name:'와이홉'};else f.packet.body.jsonDocument[0].productPage.supplyPrice+=1;
    }}}));
    try{const result=await submit(f);assert.equal(result.registered,false);assert.notEqual(result.state,'accepted');assert.notEqual(result.state,'pending');assert.equal(result.receipt,undefined);assert.equal(f.submitted,1);protectedDocument(f);}finally{f.close();}
  }
});

test('browser document UUID replacement during GET is refused even if an exact receipt row is returned',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],receiptOptions({beforeHubFetch:(url,_init,f)=>{if(new URL(url).pathname===requestPath)f.hubDocumentId=crypto.randomUUID();}}));
  try{const result=await submit(f);assert.equal(result.registered,false);assert.notEqual(result.state,'accepted');assert.notEqual(result.state,'pending');assert.equal(result.receipt,undefined);assert.equal(f.submitted,1);protectedDocument(f);}finally{f.close();}
});

test('lost native submit acknowledgement recovers the original request through GET without a second click',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],receiptOptions({submitLoseExecuteAck:true}));
  try{const lost=await submit(f);assert.equal(lost.state,'submit-requested',JSON.stringify(lost));assert.equal(lost.needsRecovery,true);assert.equal(lost.receipt,undefined);assert.equal(f.submitted,1);
    const writes=countWrites(f),clicks=f.nextClicks;const recovered=await f.receiver.recover(f.packet,f.sender);assert.equal(recovered.state,'pending',JSON.stringify(recovered));assert.equal(recovered.registered,false);assert.equal(recovered.receipt.receiptId,'000657-QVT-raw');
    await f.receiver.confirm(f.packet,f.sender,{action:'confirm-and-submit',userInitiated:true});await f.receiver.resume(f.packet,f.sender);assert.equal(f.submitted,1);assert.equal(f.nextClicks,clicks);assert.equal(countWrites(f),writes);protectedDocument(f);
  }finally{f.close();}
});

test('native completion/form reset in the same browser document does not require loading or editing the submitted form again',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[1],receiptOptions({afterNativeSubmit:f=>{f.loaded=null;f.termModal=null;f.modal=false;f.hubDocument.querySelectorAll('.rsc-text-input input').forEach(node=>{node.value='';});}}));
  try{const final=await readyFinal(f),uuid=f.hubDocumentId,result=await f.receiver.confirm(f.packet,f.sender,f.action(final));assert.equal(f.hubDocumentId,uuid);assert.equal(f.loaded,null);assert.equal(result.state,'pending',JSON.stringify(result));assert.equal(result.registered,false);
    const selections=[...f.selected],writes=countWrites(f);await f.receiver.observe(f.packet,f.sender);assert.deepEqual(f.selected,selections);assert.equal(countWrites(f),writes);assert.equal(f.submitted,1);protectedDocument(f);
  }finally{f.close();}
});

test('service worker replacement remains fail closed and cannot replay a submit or restore ownership from a saved marker',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],receiptOptions({submitLoseExecuteAck:true}));let replacement;
  try{const lost=await submit(f);assert.equal(lost.state,'submit-requested',JSON.stringify(lost));const clicks=f.nextClicks,writes=countWrites(f);f.adapter.dispose();
    replacement=createSingleDocumentBrowserAdapter({api:f.api});const receiver=createSingleDocumentReceiver({adapter:replacement,store:f.storage.store});
    const result=await receiver.recover(f.packet,f.sender);assert.equal(result.state,'scope-blocked',JSON.stringify(result));assert.equal(result.registered,false);assert.equal(result.receipt,undefined);
    await receiver.resume(f.packet,f.sender);assert.equal(f.nextClicks,clicks);assert.equal(countWrites(f),writes);assert.equal(f.submitted,1);protectedDocument(f);
  }finally{replacement?.dispose();f.close();}
});
