import test from 'node:test';
import assert from 'node:assert/strict';
import {singleBrowserFixture} from './helpers/supplier-hub-single-document-adapter.mjs';
import {SINGLE_COMPANIES} from './helpers/supplier-hub-single-document.mjs';

const record=f=>JSON.parse(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords)[f.context.packetDigest];
const writes=f=>f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST');
const preserved=f=>{assert.deepEqual(f.documents.get('protected-previous'),f.prior);assert.ok(Object.values(f.webRequest).every(event=>event.loadSize===0));};

for(const company of SINGLE_COMPANIES){
  test(company.name+' serialized modal capture and three human confirmations continue only the exact new document',async()=>{
    const f=await singleBrowserFixture(company,{stageFlow:true});
    try{
      const source=structuredClone(f.packet),product=await f.receiver.start(f.packet,f.sender);assert.equal(product.state,'awaiting-stage-consent',JSON.stringify(product));assert.equal(product.challenge.stage,'productPage');
      assert.equal(f.hubLocation.pathname,'/sr/registration/step/productPage');assert.equal(product.challenge.items[0].title,f.stageTitles.productPage);assert.equal(product.challenge.items[0].termsText,f.stageTerms.productPage.join('\n'));
      assert.equal(f.termModal,'productPage');assert.equal(f.stageCheckboxes.productPage.checked,false);assert.deepEqual(f.stageApprovalClicks,{productPage:0,imagePage:0});assert.equal(f.submitted,0);assert.equal(f.lastStageFooter.getAttribute('type'),null);
      const image=await f.receiver.confirm(f.packet,f.sender,f.action(product));assert.equal(image.state,'awaiting-stage-consent',JSON.stringify(image));assert.equal(image.challenge.stage,'imagePage');assert.equal(image.docId,f.createdDocId);
      assert.equal(image.challenge.items[0].termsText,f.stageTerms.imagePage.join('\n'));assert.equal(f.stageCheckboxes.productPage.checked,true);assert.equal(f.stageCheckboxes.imagePage.checked,false);
      assert.equal(f.documents.get(f.createdDocId).jsonDocument[0].imagePage.msrpAgree,true);assert.equal(f.documents.get(f.createdDocId).jsonDocument[0].imagePage.labelContactAgreed,false);assert.equal(record(f).stageConsentOperations.productPage.state,'observed');assert.equal(f.submitted,0);
      const final=await f.receiver.confirm(f.packet,f.sender,f.action(image));assert.equal(final.state,'awaiting-consent',JSON.stringify(final));assert.equal(final.challenge.stage,'logisticsPage');assert.deepEqual(final.challenge.items,[]);assert.equal(f.hubLocation.pathname,'/sr/registration/step/logisticsPage');
      assert.equal(record(f).stageConsentOperations.imagePage.state,'observed');assert.deepEqual(f.stageApprovalClicks,{productPage:1,imagePage:1});assert.deepEqual(f.stagePersisted.map(row=>row.stage),['productPage','imagePage']);assert.equal(f.submitted,0);
      const submitted=await f.receiver.confirm(f.packet,f.sender,f.action(final));assert.equal(submitted.state,'submit-requested',JSON.stringify(submitted));assert.equal(submitted.registered,false);assert.equal(submitted.error.code,'RECEIPT_UNCONFIRMED');assert.equal(f.submitted,1);
      assert.deepEqual(f.packet,source);assert.equal(writes(f).filter(call=>call.url.endsWith('/create')).length,1);assert.equal(writes(f).filter(call=>call.url.endsWith('/update')).length,1);assert.equal(f.ownDocumentReadsDuringLoad,0);preserved(f);
    }finally{f.close();}
  });

  test(company.name+' lost modal executeScript acknowledgement recovers read-only evidence without clicking acceptance again',async()=>{
    const f=await singleBrowserFixture(company,{stageFlow:true,stageLostExecuteAck:'productPage'});
    try{
      const initial=await f.receiver.start(f.packet,f.sender),pending=await f.receiver.confirm(f.packet,f.sender,f.action(initial));assert.equal(pending.state,'stage-consent-requested',JSON.stringify(pending));assert.equal(pending.needsRecovery,true);assert.equal(f.stageApprovalClicks.productPage,1);
      const clicks=f.nextClicks,remoteWrites=writes(f).length;await f.receiver.start(f.packet,f.sender);await f.receiver.confirm(f.packet,f.sender,f.action(initial));assert.equal(f.stageApprovalClicks.productPage,1);
      const recovered=await f.receiver.recover(f.packet,f.sender);assert.equal(recovered.state,'navigation-requested',JSON.stringify(recovered));assert.equal(f.nextClicks,clicks);assert.equal(writes(f).length,remoteWrites);assert.equal(f.stageApprovalClicks.productPage,1);
      const image=await f.receiver.resume(f.packet,f.sender);assert.equal(image.state,'awaiting-stage-consent',JSON.stringify(image));assert.equal(image.challenge.stage,'imagePage');assert.equal(f.stageApprovalClicks.productPage,1);assert.equal(f.submitted,0);preserved(f);
    }finally{f.close();}
  });
}

test('wrong title unknown checkbox empty terms or multiple modals cannot be accepted',async()=>{
  for(const options of [{stageWrongTitle:true},{stageWrongId:true},{stageEmptyTerms:true},{stageModalAmbiguous:true}]){
    const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{stageFlow:true,...options});
    try{const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'navigation-requested',JSON.stringify(result));assert.equal(Object.hasOwn(result,'challenge'),false);assert.equal(result.registered,false);assert.deepEqual(f.stageApprovalClicks,{productPage:0,imagePage:0});assert.equal(f.stageCheckboxes.productPage.checked,false);assert.equal(f.submitted,0);preserved(f);}finally{f.close();}
  }
});

test('terms title expiry or source actor changes during trusted human confirmation block modal acceptance',async()=>{
  for(const mutate of [f=>{f.stageTerms.productPage[0]+=' 변경된 전문';},f=>{f.stageTitles.productPage='변경된 제목';},f=>{f.clockOffset+=120001;},f=>{f.ownerId='another-owner';},f=>{f.sessionId='another-source-session';}]){
    const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{stageFlow:true,beforeHumanConfirmation:(message,fixture)=>{mutate(fixture);}});
    try{
      const initial=await f.receiver.start(f.packet,f.sender),clicks=f.nextClicks,result=await f.receiver.confirm(f.packet,f.sender,f.action(initial));assert.equal(result.registered,false);assert.ok(['awaiting-stage-consent','scope-blocked'].includes(result.state),JSON.stringify(result));
      assert.deepEqual(f.stageApprovalClicks,{productPage:0,imagePage:0});assert.equal(f.stageCheckboxes.productPage.checked,false);assert.equal(f.nextClicks,clicks);assert.equal(f.submitted,0);preserved(f);
    }finally{f.close();}
  }
});

test('modal acceptance with an unchecked result remains uncertain and recovery never repeats the button click',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{stageFlow:true,stageUncheckedAfterAccept:'productPage'});
  try{
    const initial=await f.receiver.start(f.packet,f.sender),pending=await f.receiver.confirm(f.packet,f.sender,f.action(initial));assert.equal(pending.state,'stage-consent-requested',JSON.stringify(pending));assert.equal(record(f).stageConsentOperations.productPage.state,'requested');assert.equal(f.stageApprovalClicks.productPage,1);
    const next=f.nextClicks,result=await f.receiver.recover(f.packet,f.sender);assert.equal(result.state,'stage-consent-requested',JSON.stringify(result));assert.equal(f.stageApprovalClicks.productPage,1);assert.equal(f.nextClicks,next);assert.equal(f.stageCheckboxes.productPage.checked,false);assert.equal(f.submitted,0);preserved(f);
  }finally{f.close();}
});

test('business body changed during stage confirmation is detected before clicking NEXT',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{stageFlow:true,beforeHumanConfirmation:(message,fixture)=>{fixture.documents.get(fixture.createdDocId).jsonDocument[0].productPage.supplyPrice=1;}});
  try{
    const initial=await f.receiver.start(f.packet,f.sender),next=f.nextClicks,result=await f.receiver.confirm(f.packet,f.sender,f.action(initial));assert.equal(result.error?.code,'READBACK_UNCONFIRMED',JSON.stringify(result));assert.equal(f.nextClicks,next);assert.deepEqual(f.stageApprovalClicks,{productPage:0,imagePage:0});assert.equal(f.submitted,0);preserved(f);
  }finally{f.close();}
});

test('company dropdown interactions cannot silently accept or replace the reviewed modal',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{stageFlow:true,companyMenuCloses:true});
  try{
    const initial=await f.receiver.start(f.packet,f.sender);assert.equal(initial.state,'awaiting-stage-consent',JSON.stringify(initial));
    const image=await f.receiver.confirm(f.packet,f.sender,f.action(initial));assert.equal(image.state,'awaiting-stage-consent',JSON.stringify(image));assert.equal(image.challenge.stage,'imagePage');assert.equal(f.stageApprovalClicks.productPage,1);assert.equal(f.submitted,0);preserved(f);
  }finally{f.close();}
});

test('lost next-step acknowledgement is recovered by observing the current owned stage without repeating NEXT',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{stageFlow:true,nextLostExecuteAck:'productPage'});
  try{
    const product=await f.receiver.start(f.packet,f.sender),pending=await f.receiver.confirm(f.packet,f.sender,f.action(product));assert.equal(pending.state,'navigation-requested',JSON.stringify(pending));assert.equal(f.hubLocation.pathname,'/sr/registration/step/imagePage');
    assert.equal(record(f).nextOperations.productPage.state,'observed');const clicks=f.nextClicks,remote=writes(f).length;
    const recovered=await f.receiver.recover(f.packet,f.sender);assert.equal(recovered.state,'awaiting-stage-consent',JSON.stringify(recovered));assert.equal(recovered.challenge.stage,'imagePage');assert.equal(f.nextClicks,clicks);assert.equal(writes(f).length,remote);
    assert.deepEqual(f.stageApprovalClicks,{productPage:1,imagePage:0});assert.equal(f.submitted,0);preserved(f);
  }finally{f.close();}
});

test('unobserved next-step click remains blocked and explicit recovery or resume never repeats it',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{stageFlow:true,nextNoCommitStage:'productPage'});
  try{
    const product=await f.receiver.start(f.packet,f.sender),pending=await f.receiver.confirm(f.packet,f.sender,f.action(product));assert.equal(pending.state,'navigation-requested',JSON.stringify(pending));assert.equal(f.hubLocation.pathname,'/sr/registration/step/productPage');
    assert.equal(record(f).nextOperations.productPage.state,'requested');const clicks=f.nextClicks;
    for(const action of ['recover','resume']){const result=await f.receiver[action](f.packet,f.sender);assert.equal(result.state,'navigation-requested',JSON.stringify(result));assert.equal(result.registered,false);assert.equal(f.nextClicks,clicks);}
    assert.deepEqual(f.stageApprovalClicks,{productPage:1,imagePage:0});assert.equal(f.submitted,0);preserved(f);
  }finally{f.close();}
});
