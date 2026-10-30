import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {nativeRecoveryFixture} from './helpers/native-product-recovery.mjs';
import {SINGLE_COMPANIES} from './helpers/supplier-hub-single-document.mjs';
import {createVerifiedProductDocumentBrowserAdapter} from '../extensions/supplier-hub/product-document-adapter.mjs';
import {createProductDocumentDraftReceiver} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {singleDocumentNavigatePage,singleDocumentSubmitPage} from '../extensions/supplier-hub/single-document-adapter.mjs';

const copy=value=>JSON.parse(JSON.stringify(value));
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64');
const response=(url,value,type='application/json')=>{const result=new Response(type==='application/json'?JSON.stringify(value):value,{headers:{'content-type':type}});Object.defineProperty(result,'url',{value:url});return result;};
const posts=f=>f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').map(call=>new URL(call.url).pathname);
const beforeConsent=value=>{const body=copy(value);for(const row of body.jsonDocument??[]){row.imagePage.msrpAgree=false;row.imagePage.labelContactAgreed=false;}return body;};

// The source plan, receiver, browser adapter and current-server reader are the
// production modules. Vendor Next/Submit buttons deliberately model their
// observed implicit body update; current-read recovery must never click them.
// Only the external Chrome/Hub surface is synthetic; no live site is called.
async function recoveredFixture(company,options={}){
 let loseRead=true;
 const f=await nativeRecoveryFixture(company,{memberCount:3,browser:{stageFlow:true,finalNoItems:true,...options,
  documentRead:body=>loseRead?null:body,
  registerRequestedRows:[],
 }});
 let selected;
 try{
  assert.equal(f.context.identity.members.length,3);assert.equal(f.context.packet.body.jsonDocument.length,3);assert.ok(f.state.source.images.every(file=>file.references.length===3));
  const original=createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store});
  const initial=await original.prepareDraft(f.packet,f.sender);assert.equal(initial.state,'update-requested');assert.equal(initial.docId,f.createdDocId);loseRead=false;
  const checkpoint=await f.storage.store.get(f.context.key),previousTarget=checkpoint.ownedTarget;
  const protectedBefore=JSON.stringify(f.documents.get(f.prior.docId)),bodyBefore=beforeConsent(f.documents.get(f.createdDocId)),uploadsBefore=copy(f.state.uploads),postsBefore=posts(f);
  f.closeOwnedTab();
  const vendorRequests=[],vendorButton=f.hubDocument.querySelectorAll('button[type="submit"]')[0];
  vendorButton.click=()=>{
   vendorRequests.push({method:'POST',path:'/sr/draft/api/update'});f.documents.get(f.createdDocId).productName+=' forbidden-vendor-save';
   if(f.hubLocation.pathname.endsWith('/logisticsPage'))vendorRequests.push({method:'POST',path:'/sr/qvt/api/validate-step/5'},{method:'POST',path:'/sr/qvt/api/validate-single-product'});
   throw Error('Synthetic vendor button performed its forbidden implicit body update');
  };
  for(const [name,file]of f.state.registry)f.state.registry.set(name,{...file,imageUrl:'/sr/api/image/get-by-key?key='+encodeURIComponent(file.s3Link),host:'supplier.coupang.com'});
  const requests=[],execute=f.api.scripting.executeScript;
  f.api.scripting.executeScript=async request=>{
   const input=typeof request.args?.[0]==='string'?JSON.parse(request.args[0]):request.args?.[0];
   const validation=request.func.name==='singleDocumentHubRequestPage'&&input?.method==='POST'&&/^\/sr\/qvt\/api\/validate-step\/[2-5]$/.test(input.path);
   if(request.func.name!=='savedDraftCurrentReadPage'&&!validation)return execute(request);
   const scope=vm.createContext({document:f.hubDocument,location:f.hubLocation,crypto:webcrypto,AbortController,TextEncoder,TextDecoder,Uint8Array,URL,Response,Date,setTimeout,clearTimeout,structuredClone,
    fetch:async(url,init)=>{
     requests.push({url,method:init.method,body:init.body});const pathname=new URL(url).pathname;
     if(validation){
      assert.equal(pathname,input.path);assert.equal(init.method,'POST');assert.equal(JSON.parse(init.body).docId,f.createdDocId);f.calls.push({name:'hub-fetch',url,init:{...init,signal:undefined}});
      const step=Number(pathname.at(-1));return response(url,{code:200,data:Array.from({length:3},(_,index)=>step===options.rejectStep&&index===2?{success:false,errors:[{columnName:'포장 크기',message:'세 번째 옵션의 규격 확인이 필요합니다.'}]}:{success:true,errors:[]})});
     }
     if(pathname==='/sr/draft/api/drafts')return response(url,[...f.documents.values()].map(body=>({...copy(body),status:'UNFINISHED'})));
     if(pathname==='/sr/draft/api/drafts/register-requested')return response(url,[]);
     if(pathname==='/sr/draft/api/get-by-id/'+f.createdDocId)return response(url,{...copy(f.documents.get(f.createdDocId)),status:'UNFINISHED'});
     if(pathname==='/sr/draft/api/get-images-by-id/'+f.createdDocId)return response(url,[...f.state.registry.values()].map(copy));
     if(pathname==='/sr/draft/api/get-files-by-type/'+f.createdDocId){assert.equal(init.method,'POST');assert.equal(init.body,'{}');return response(url,[]);}
     assert.equal(pathname,'/sr/api/image/get-by-key');assert.equal(init.method,'GET');return response(url,bytes,'image/png');
    }});
   const frame=(await execute({target:{tabId:request.target.tabId,frameIds:[0]},func:()=>true,args:[]}))[0];
   scope.args=copy(request.args);return[{frameId:0,documentId:frame.documentId,result:copy(await vm.runInContext('('+request.func.toString()+')(...args)',scope))}];
  };
  const confirmations=[],send=f.api.tabs.sendMessage;
  f.api.tabs.sendMessage=async(id,message,frame)=>{
   if(message.type!=='YOOFAM_CONFIRM_NATIVE_PRODUCT_DOCUMENT_ACTION')return send(id,message,frame);
   assert.equal(id,f.sender.tab.id);assert.equal(frame.frameId,0);confirmations.push(copy(message.expected));
   return{ok:true,userInitiated:true,challengeId:message.expected.challenge.id,identityDigest:f.context.identityDigest,checkedAt:Date.now()};
  };
  // The existing browser helper emits loader events for its initial tab 71.
  // Route that same synthetic event to the positively rebound replacement.
  let targetId;
  for(const event of Object.values(f.webRequest)){const emit=event.emit;event.emit=details=>emit({...details,tabId:targetId??details.tabId});}
  selected=await createVerifiedProductDocumentBrowserAdapter(f.context,{api:f.api});
  const receiver=createProductDocumentDraftReceiver({adapter:selected.adapter,store:f.storage.store});
  const assertPreserved=(expectedSteps=[2,3,4,5])=>{
   assert.deepEqual(f.state.uploads,uploadsBefore);assert.equal(JSON.stringify(f.documents.get(f.prior.docId)),protectedBefore);assert.deepEqual(beforeConsent(f.documents.get(f.createdDocId)),bodyBefore);
   assert.deepEqual(posts(f).slice(postsBefore.length),expectedSteps.map(step=>'/sr/qvt/api/validate-step/'+step));
   assert.ok(requests.every(row=>row.method==='GET'||/^\/sr\/qvt\/api\/validate-step\/[2-5]$/.test(new URL(row.url).pathname)||new URL(row.url).pathname==='/sr/draft/api/get-files-by-type/'+f.createdDocId&&row.body==='{}'));
  };
  return{f,adapter:selected.adapter,receiver,checkpoint,previousTarget,confirmations,requests,vendorRequests,assertPreserved,
   bind:async()=>{const read=await receiver.recoverPreparedDraft(f.packet,f.sender);assert.equal(read.error.code,'SAVED_DRAFT_TARGET_CLOSED');const bound=await receiver.recoverSavedDraftTarget(f.packet,f.sender);assert.equal(bound.state,'updated',JSON.stringify(bound));targetId=(await f.storage.store.get(f.context.key)).ownedTarget.tabId;return bound;},
   close:()=>{selected.adapter.dispose();f.adapter.dispose();f.close();}};
 }catch(error){selected?.adapter.dispose();f.adapter.dispose();f.close();throw error;}
}

for(const company of SINGLE_COMPANIES)test(company.code+': recovered original document validates all members then blocks official forward buttons that would resend its body',async()=>{
 const q=await recoveredFixture(company);try{
  const bound=await q.bind(),original=q.checkpoint.requestId,documentId=q.checkpoint.docId;
  const validated=await q.receiver.prepareDraft(q.f.packet,q.f.sender);assert.equal(validated.state,'validated',JSON.stringify(validated));assert.deepEqual(validated.draftProof.validatedSteps,[2,3,4,5]);
  const savedAudit=copy((await q.f.storage.store.get(q.f.context.key)).savedDraftTargetRecovery);
  const current=await q.receiver.reviewPreparedDraft(q.f.packet,q.f.sender);assert.equal(current.state,'navigation-requested');assert.equal(current.error.code,'SAVED_DRAFT_NATIVE_BUTTON_WRITE_BLOCKED');assert.match(current.error.message,/공식 다음 버튼.*본문 저장.*재전송하지/);assert.equal(current.challenge,undefined);assert.equal(current.receipt,undefined);assert.equal(current.docId,documentId);assert.equal(current.requestId,original);assert.equal(current.registered,false);
  assert.equal(q.confirmations.length,0);assert.deepEqual(q.f.stageApprovalClicks,{productPage:0,imagePage:0});assert.deepEqual(q.vendorRequests,[]);
  const record=JSON.parse(q.f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords)[q.f.context.packetDigest];assert.equal(record.submitOperationId,undefined);assert.equal(record.submitProof,undefined);assert.equal(record.nextOperations,undefined);assert.equal(record.updateOperationId,undefined);assert.equal(record.nativeAssets,undefined);assert.equal(record.currentReadRecovery.fileBodyWritesAllowed,false);for(const step of [2,3,4,5])assert.equal(record.validation[step].response.data.length,3);
  const checkpoint=await q.f.storage.store.get(q.f.context.key);assert.deepEqual(checkpoint.savedDraftTargetRecovery,savedAudit);assert.deepEqual(checkpoint.savedDraftTargetRecovery.previousTarget,q.previousTarget);assert.equal(bound.docId,documentId);
  assert.equal(q.f.calls.some(call=>call.name==='execute'&&['singleDocumentNavigatePage','singleDocumentSubmitPage'].includes(call.func)),false);q.assertPreserved();
 }finally{q.close();}
});

test('the third recovered member rejecting step 3 halts the whole document before any consent or receipt',async()=>{
 const q=await recoveredFixture(SINGLE_COMPANIES[0],{rejectStep:3});try{
  await q.bind();const rejected=await q.receiver.prepareDraft(q.f.packet,q.f.sender);
  assert.equal(rejected.state,'validation-rejected',JSON.stringify(rejected));assert.deepEqual(rejected.validationRejection.validatedSteps,[2]);assert.equal(rejected.validationRejection.step,3);assert.equal(rejected.validationRejection.operationId,q.checkpoint.requestId+':validate:3');
  const record=JSON.parse(q.f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords)[q.f.context.packetDigest];assert.equal(record.state,'validation-rejected');assert.equal(record.validation[3].state,'observed');assert.equal(record.validation[3].response.data.length,3);assert.equal(record.validation[3].response.data[2].success,false);
  const attempted=await q.receiver.reviewPreparedDraft(q.f.packet,q.f.sender);assert.equal(attempted.error.code,'NATIVE_PREPARED_UNCONFIRMED');assert.equal(attempted.state,'validation-rejected');assert.equal(attempted.receipt,undefined);assert.equal(attempted.challenge,undefined);
  const repeated=await q.receiver.prepareDraft(q.f.packet,q.f.sender);assert.equal(repeated.state,'validation-rejected');assert.equal(q.confirmations.length,0);assert.equal(q.f.calls.some(call=>call.name==='execute'&&['singleDocumentNavigatePage','singleDocumentSubmitPage'].includes(call.func)),false);q.assertPreserved([2,3]);
 }finally{q.close();}
});

test('serialized forward guards stop every current-read Next and final Submit before vendor body writes or operation markers',async()=>{
 const q=await recoveredFixture(SINGLE_COMPANIES[0]);try{
  await q.bind();await q.receiver.prepareDraft(q.f.packet,q.f.sender);const checkpoint=await q.f.storage.store.get(q.f.context.key),target={tabId:checkpoint.ownedTarget.tabId,frameIds:[0]},data=q.f.hubDocument.documentElement.dataset,records=JSON.parse(data.yoofamSingleDocumentRecords),base=copy(records[q.f.context.packetDigest]);
  for(const stage of ['startPage','productPage','imagePage','legalPage']){
   q.f.hubLocation.pathname='/sr/registration/step/'+stage;if(q.f.stageCheckboxes[stage])q.f.stageCheckboxes[stage].checked=true;
   records[q.f.context.packetDigest]={...copy(base),loadedDocId:checkpoint.docId};data.yoofamSingleDocumentRecords=JSON.stringify(records);const before=data.yoofamSingleDocumentRecords;
   await assert.rejects(q.f.api.scripting.executeScript({target,func:singleDocumentNavigatePage,args:[{binding:base.binding,docId:checkpoint.docId,productName:q.f.context.packet.body.productName,stageConsents:[{stage:'productPage'},{stage:'imagePage'}]}]}),/공식 다음 버튼.*본문 저장.*재전송하지/);
   assert.equal(data.yoofamSingleDocumentRecords,before);assert.deepEqual(q.vendorRequests,[]);assert.equal(q.f.hubLocation.pathname,'/sr/registration/step/'+stage);
  }
  q.f.hubLocation.pathname='/sr/registration/step/logisticsPage';const challenge={id:'current-final-challenge',items:[]};records[q.f.context.packetDigest]={...copy(base),loadedDocId:checkpoint.docId,confirmedChallengeId:challenge.id};data.yoofamSingleDocumentRecords=JSON.stringify(records);const before=data.yoofamSingleDocumentRecords;
  await assert.rejects(q.f.api.scripting.executeScript({target,func:singleDocumentSubmitPage,args:[{binding:base.binding,docId:checkpoint.docId,operationId:checkpoint.requestId+':submit',challenge,expectedBody:{...copy(q.f.context.packet.body),docId:checkpoint.docId}}]}),/공식 등록 버튼.*본문 저장.*재전송하지/);
  assert.equal(data.yoofamSingleDocumentRecords,before);assert.deepEqual(q.vendorRequests,[]);assert.equal(q.confirmations.length,0);q.assertPreserved();
 }finally{q.close();}
});

test('adapter final-submit guard reports its stable no-resend code before page execution or submit proof',async()=>{
 const q=await recoveredFixture(SINGLE_COMPANIES[1]);try{
  await q.bind();await q.receiver.prepareDraft(q.f.packet,q.f.sender);const checkpoint=await q.f.storage.store.get(q.f.context.key),data=q.f.hubDocument.documentElement.dataset,before=data.yoofamSingleDocumentRecords,calls=q.f.calls.filter(call=>call.name==='execute'&&call.func==='singleDocumentSubmitPage').length;
  await assert.rejects(q.adapter.submit({tab:checkpoint.tab,identity:q.f.context.identity,sessionId:checkpoint.sessionId,docId:checkpoint.docId,requestId:checkpoint.requestId,operationId:checkpoint.requestId+':submit',challenge:{id:'unused',items:[]},expectedBody:{...copy(q.f.context.packet.body),docId:checkpoint.docId}}),error=>error.code==='SAVED_DRAFT_NATIVE_BUTTON_WRITE_BLOCKED'&&/공식 등록 버튼.*본문 저장.*재전송하지/.test(error.message));
  assert.equal(data.yoofamSingleDocumentRecords,before);assert.equal(q.f.calls.filter(call=>call.name==='execute'&&call.func==='singleDocumentSubmitPage').length,calls);assert.deepEqual(q.vendorRequests,[]);q.assertPreserved();
 }finally{q.close();}
});
