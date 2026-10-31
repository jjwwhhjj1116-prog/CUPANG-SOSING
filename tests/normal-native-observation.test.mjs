import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createSupplierHubDocumentReceiver,SingleDocumentError,SINGLE_DOCUMENT_FORMAT} from '../extensions/supplier-hub/single-document.mjs';
import {singleDocumentNavigatePage,singleDocumentNavigationReadPage,singleDocumentSubmitPage} from '../extensions/supplier-hub/single-document-adapter.mjs';
import {singleDocumentFixture,SINGLE_COMPANIES,clone} from './helpers/supplier-hub-single-document.mjs';

async function fixture(options={}){
  const f=await singleDocumentFixture(options.company??SINGLE_COMPANIES[0],{stageFlow:true,finalNoItems:true,receipt:{state:'pending',evidence:'document-receipt',sourceStatus:'SUBMITTED',registered:false,qvtRequestId:'normal-observation',receiptId:'normal-observation',skuId:undefined}});
  f.adapter.qualifyPreparedDraft=async input=>({readOnly:true,docId:input.docId,company:clone(f.context.identity.company),identityDigest:f.context.identityDigest,packetDigest:f.context.packetDigest,sourcePlanSha256:f.context.identity.fingerprint,metadataObserved:true,checkedAt:f.now});
  f.waits=0;f.waitSignals=new Set();f.receiver=createSupplierHubDocumentReceiver({adapter:f.adapter,store:f.storage.store,now:()=>f.now,observationSignal:options.signal,
    observationWait:async(ms,signal)=>{assert.equal(ms,1000);assert.equal(signal.aborted,false);f.waits++;f.waitSignals.add(signal);f.now+=ms;await options.wait?.(f,signal);}},
  {format:SINGLE_DOCUMENT_FORMAT,identity:async()=>f.context,draftOnly:true,nativeLifecycle:true});
  f.final=async()=>{assert.equal((await f.receiver.prepareDraft(f.packet,f.sender)).state,'validated');let result=await f.receiver.reviewPreparedDraft(f.packet,f.sender);for(let index=0;index<2;index++)result=await f.receiver.confirmPreparedDraft(f.packet,f.sender,f.action(result));assert.equal(result.state,'awaiting-consent');return result;};
  return f;
}

for(const company of SINGLE_COMPANIES)test(`${company.code}: an asynchronous receipt appears on the third strict read after exactly one final click`,async()=>{
  const f=await fixture({company});try{
    const final=await f.final(),read=f.adapter.observeReceipt;let reads=0;
    f.adapter.observeReceipt=async input=>{reads++;if(reads<3)throw new SingleDocumentError('RECEIPT_NOT_VISIBLE','synthetic fresh empty list');return read(input);};
    const writes=f.calls.filter(call=>call.name==='hubRequest'&&call.input.method==='POST').length,result=await f.receiver.confirmPreparedDraft(f.packet,f.sender,f.action(final));
    assert.equal(result.state,'pending',JSON.stringify(result));assert.equal(reads,3);assert.equal(f.waits,2);assert.equal(f.submitted,1);assert.equal(result.receipt.qvtRequestId,'normal-observation');
    assert.equal(f.calls.filter(call=>call.name==='hubRequest'&&call.input.method==='POST').length,writes);f.assertPreserved();
  }finally{f.close();}
});

test('malformed/HTTP/mismatched receipt errors stop on their first read without polling or another submit',async()=>{
  for(const code of ['RECEIPT_UNCONFIRMED','RECEIPT_CHANGED','TAB_CHANGED','SOURCE_CHANGED']){
    const f=await fixture();try{const final=await f.final();let reads=0;f.adapter.observeReceipt=async()=>{reads++;throw new SingleDocumentError(code,'synthetic fixed failure');};
      const result=await f.receiver.confirmPreparedDraft(f.packet,f.sender,f.action(final));assert.equal(result.error.code,code);assert.equal(reads,1);assert.equal(f.waits,0);assert.equal(f.submitted,1);
    }finally{f.close();}
  }
});

test('a missing receipt exhausts bounded reads and remains uncertain; recovery reads without replay',async()=>{
  const f=await fixture();try{const final=await f.final(),read=f.adapter.observeReceipt;let reads=0;f.adapter.observeReceipt=async()=>{reads++;throw new SingleDocumentError('RECEIPT_NOT_VISIBLE','synthetic fresh empty list');};
    const result=await f.receiver.confirmPreparedDraft(f.packet,f.sender,f.action(final));assert.equal(result.state,'submit-requested');assert.equal(result.error.code,'RECEIPT_UNCONFIRMED');assert.equal(result.registered,false);assert.equal(reads,31);assert.equal(f.waits,30);assert.equal(f.submitted,1);
    f.adapter.observeReceipt=read;const recovered=await f.receiver.recoverPreparedDraft(f.packet,f.sender);assert.equal(recovered.state,'pending');assert.equal(f.submitted,1);f.assertPreserved();
  }finally{f.close();}
});

test('source, company, checkpoint changes or cancellation between receipt polls stop further reads',async()=>{
  for(const mode of ['source','company','checkpoint','abort']){
    const controller=new AbortController(),f=await fixture({signal:controller.signal,wait:async current=>{
      if(mode==='source')current.current=false;
      if(mode==='company')current.tab.company=clone(SINGLE_COMPANIES[1]);
      if(mode==='checkpoint'){const state=current.storage.get(current.context.key);current.storage.force(current.context.key,{...state,sequence:state.sequence+1});}
      if(mode==='abort')controller.abort();
    }});try{const final=await f.final();let reads=0;f.adapter.observeReceipt=async()=>{reads++;throw new SingleDocumentError('RECEIPT_NOT_VISIBLE','synthetic fresh empty list');};
      const result=await f.receiver.confirmPreparedDraft(f.packet,f.sender,f.action(final));assert.equal(reads,1);assert.equal(f.waits,1);assert.equal(f.submitted,1);assert.equal(result.error.code,{source:'SOURCE_CHANGED',company:'TAB_CHANGED',checkpoint:'CHECKPOINT_CONFLICT',abort:'OBSERVATION_ABORTED'}[mode]);
    }finally{f.close();}
  }
});

test('each distinct native Next can take longer than the old eight seconds without repeating either click',async()=>{
  const f=await fixture();try{
    assert.equal((await f.receiver.prepareDraft(f.packet,f.sender)).state,'validated');
    const original=f.adapter.navigate;let clicks=0,polls=0,phase=0;
    f.adapter.navigate=async input=>{if(phase<2){clicks++;const stage=phase===0?'startPage':'legalPage',next=phase===0?'Product Page':'Logistics Page';return {docId:input.docId,company:clone(f.context.identity.company),productName:f.packet.body.productName,awaitingNext:true,stage,next};}return original(input);};
    f.adapter.readNavigation=async input=>{polls++;const observed=polls%26===0;if(observed)phase++;return {docId:input.docId,company:clone(f.context.identity.company),productName:f.packet.body.productName,...input.waitingNext,awaitingNext:!observed,nextObserved:observed};};
    const result=await f.receiver.reviewPreparedDraft(f.packet,f.sender);assert.equal(result.state,'awaiting-stage-consent',JSON.stringify(result));assert.equal(clicks,2);assert.equal(f.waits,50);assert.equal(polls,52);assert.equal(f.submitted,0);assert.equal(f.waitSignals.size,2,'each native Next has an independent deadline/controller');
  }finally{f.close();}
});

test('unchanged native stage stays uncertain and source change prevents any further Next',async()=>{
  for(const mode of ['unchanged','source']){
    const f=await fixture({wait:async current=>{if(mode==='source')current.current=false;}});try{
      await f.receiver.prepareDraft(f.packet,f.sender);let clicks=0,polls=0;
      f.adapter.navigate=async input=>{clicks++;return {docId:input.docId,company:clone(f.context.identity.company),productName:f.packet.body.productName,awaitingNext:true,stage:'startPage',next:'Product Page'};};
      f.adapter.readNavigation=async input=>{polls++;return {docId:input.docId,company:clone(f.context.identity.company),productName:f.packet.body.productName,...input.waitingNext,awaitingNext:true,nextObserved:false};};
      const result=await f.receiver.reviewPreparedDraft(f.packet,f.sender);assert.equal(clicks,1);assert.equal(result.registered,false);assert.equal(result.error.code,mode==='source'?'SOURCE_CHANGED':'NATIVE_NEXT_RESULT_UNCONFIRMED');assert.equal(polls,mode==='source'?1:31);assert.equal(f.submitted,0);
    }finally{f.close();}
  }
});

test('a hard thirty-second deadline ignores a late receipt or route ACK without another operation',async t=>{
  for(const kind of ['receipt','next']){
    const f=await fixture();let release,started=false;try{
      const final=kind==='receipt'?await f.final():null;if(kind==='next')await f.receiver.prepareDraft(f.packet,f.sender);
      const read=f.adapter.observeReceipt;let reads=0,clicks=0;
      if(kind==='receipt')f.adapter.observeReceipt=async input=>{reads++;started=true;await new Promise(resolve=>{release=resolve;});return read(input);};
      else{
        f.adapter.navigate=async input=>{clicks++;return {docId:input.docId,company:clone(f.context.identity.company),productName:f.packet.body.productName,awaitingNext:true,stage:'startPage',next:'Product Page'};};
        f.adapter.readNavigation=async input=>{reads++;started=true;await new Promise(resolve=>{release=resolve;});return {docId:input.docId,company:clone(f.context.identity.company),productName:f.packet.body.productName,...input.waitingNext,awaitingNext:false,nextObserved:true};};
      }
      t.mock.timers.enable({apis:['setTimeout']});const pending=kind==='receipt'?f.receiver.confirmPreparedDraft(f.packet,f.sender,f.action(final)):f.receiver.reviewPreparedDraft(f.packet,f.sender);
      await new Promise(resolve=>setImmediate(resolve));assert.equal(started,true);t.mock.timers.tick(30000);
      const result=await pending;assert.equal(result.error.code,kind==='receipt'?'RECEIPT_UNCONFIRMED':'NATIVE_NEXT_RESULT_UNCONFIRMED');assert.equal(result.state,kind==='receipt'?'submit-requested':'navigation-requested');
      const preserved=clone(f.storage.get(f.context.key));release();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.storage.get(f.context.key),preserved);assert.equal(reads,1);assert.equal(f.submitted,kind==='receipt'?1:0);assert.equal(clicks,kind==='next'?1:0);
    }finally{release?.();t.mock.timers.reset();f.close();}
  }
});

test('cancellation before navigation, between observed stages, or in the final submit guard prevents that next click',async()=>{
  for(const mode of ['before-navigation','between-stages','before-submit']){
    const controller=new AbortController(),f=await fixture({signal:controller.signal});try{
      let result,clicks=0;
      if(mode==='before-submit'){
        const final=await f.final(),source=f.adapter.readSource;
        f.adapter.readSource=async input=>{const proof=await source(input);if(f.storage.get(f.context.key).state==='submit-requested')controller.abort();return proof;};
        result=await f.receiver.confirmPreparedDraft(f.packet,f.sender,f.action(final));assert.equal(f.submitted,0);
      }else{
        await f.receiver.prepareDraft(f.packet,f.sender);let observed=false;const read=f.adapter.readDocument;
        f.adapter.navigate=async input=>{clicks++;return {docId:input.docId,company:clone(f.context.identity.company),productName:f.packet.body.productName,awaitingNext:true,stage:'startPage',next:'Product Page'};};
        f.adapter.readNavigation=async input=>{observed=true;return {docId:input.docId,company:clone(f.context.identity.company),productName:f.packet.body.productName,...input.waitingNext,awaitingNext:false,nextObserved:true};};
        f.adapter.readDocument=async input=>{const proof=await read(input);if(observed)controller.abort();return proof;};
        if(mode==='before-navigation')controller.abort();result=await f.receiver.reviewPreparedDraft(f.packet,f.sender);assert.equal(clicks,mode==='before-navigation'?0:1);assert.equal(f.submitted,0);
      }
      assert.equal(result.error.code,'OBSERVATION_ABORTED');assert.equal(result.registered,false);f.assertPreserved();
    }finally{f.close();}
  }
});

function pageFixture(recovery=false){
  const binding={packetDigest:'bound-packet',identity:{company:SINGLE_COMPANIES[0]}},record={binding,docId:17,loadedDocId:17,watchToken:'bound-watch',watchState:'active',watchExpiresAt:Date.now()+60000,...(recovery?{currentReadRecovery:{}}:{})},dataset={yoofamSingleDocumentRecords:JSON.stringify({'bound-packet':record})};
  const location={origin:'https://supplier.coupang.com',pathname:'/sr/registration/step/legalPage'},state={title:'Legal Page',clicks:0};
  const button={disabled:false,innerText:'다음',getClientRects:()=>[{}],getAttribute:()=>null,click:()=>{state.clicks++;}},document={documentElement:{dataset},body:{innerText:'Company Code: '+SINGLE_COMPANIES[0].code},querySelector:()=>({innerText:state.title}),querySelectorAll:query=>query==='button[type="submit"]'?[button]:[]};
  const context=vm.createContext({location,document,Date}),run=(func,input)=>{context.input=input;return vm.runInContext('('+func.toString()+')(input)',context);};
  return {binding,record,dataset,location,state,run,input:{binding,docId:17,productName:'synthetic',stageConsents:[]}};
}

test('serialized native Next dispatches once; subsequent route observations are read-only and exact',async()=>{
  const f=pageFixture(),pending=await f.run(singleDocumentNavigatePage,f.input),afterClick=f.dataset.yoofamSingleDocumentRecords;
  assert.equal(pending.awaitingNext,true);assert.equal(f.state.clicks,1);
  const input={...f.input,waitingNext:{stage:'legalPage',next:'Logistics Page'}},waiting=f.run(singleDocumentNavigationReadPage,input);assert.equal(waiting.nextObserved,false);assert.equal(f.dataset.yoofamSingleDocumentRecords,afterClick);
  await assert.rejects(f.run(singleDocumentNavigatePage,f.input),/이미 실행/);assert.equal(f.state.clicks,1);
  f.location.pathname='/sr/registration/step/logisticsPage';f.state.title='Logistics Page';assert.equal(f.run(singleDocumentNavigationReadPage,input).nextObserved,true);assert.equal(f.dataset.yoofamSingleDocumentRecords,afterClick);assert.equal(f.state.clicks,1);
  f.location.pathname='/sr/registration/step/productPage';f.state.title='Product Page';assert.throws(()=>f.run(singleDocumentNavigationReadPage,input),/이외/);
});

test('a late image-to-legal transition recovers only the still-unrequested next stage without a click or marker change',()=>{
  const f=pageFixture(),record=JSON.parse(f.dataset.yoofamSingleDocumentRecords);record['bound-packet'].nextOperations={imagePage:{next:'Legal Page',state:'requested'}};record['bound-packet'].stageConsentOperations={imagePage:{state:'observed'}};f.dataset.yoofamSingleDocumentRecords=JSON.stringify(record);
  const input={...f.input,stageConsents:[{stage:'productPage'},{stage:'imagePage'}]},before=f.dataset.yoofamSingleDocumentRecords,result=f.run(singleDocumentNavigationReadPage,input);
  assert.equal(result.readyForContinue,true);assert.equal(result.stage,'imagePage');assert.equal(f.state.clicks,0);assert.equal(f.dataset.yoofamSingleDocumentRecords,before);
  record['bound-packet'].nextOperations.legalPage={next:'Logistics Page',state:'requested'};f.dataset.yoofamSingleDocumentRecords=JSON.stringify(record);assert.throws(()=>f.run(singleDocumentNavigationReadPage,input),/불명확/);assert.equal(f.state.clicks,0);
});

test('current-read recovery cannot dispatch Next/Submit or even update observational markers',async()=>{
  const f=pageFixture(true),before=f.dataset.yoofamSingleDocumentRecords;
  await assert.rejects(f.run(singleDocumentNavigatePage,f.input),/본문 저장/);assert.equal(f.dataset.yoofamSingleDocumentRecords,before);assert.equal(f.state.clicks,0);
  const records=JSON.parse(before);records['bound-packet'].confirmedChallengeId='challenge';f.dataset.yoofamSingleDocumentRecords=JSON.stringify(records);f.location.pathname='/sr/registration/step/logisticsPage';f.state.title='Logistics Page';const preserved=f.dataset.yoofamSingleDocumentRecords;
  assert.throws(()=>f.run(singleDocumentSubmitPage,{...f.input,challenge:{id:'challenge',items:[]}}),/본문 저장/);assert.equal(f.dataset.yoofamSingleDocumentRecords,preserved);assert.equal(f.state.clicks,0);
});
