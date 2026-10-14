import test from 'node:test';
import assert from 'node:assert/strict';
import {createSingleDocumentReceiver} from '../extensions/supplier-hub/single-document.mjs';
import {singleDocumentFixture,SINGLE_COMPANIES,deferred} from './helpers/supplier-hub-single-document.mjs';

const approvals=f=>f.calls.filter(call=>call.name==='confirmStageAgreements');
const stageReceipt=f=>f.storage.get(f.context.key).stageConsents??[];
const stages=f=>stageReceipt(f).map(receipt=>receipt.stage);
const waitUntil=async predicate=>{for(let n=0;n<100;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,1));}throw Error('Synthetic concurrent confirmation did not start');};

for(const company of SINGLE_COMPANIES){
  test(company.name+' full stage terms require separate action-time MSRP and label confirmations on the same new document',async()=>{
    const f=await singleDocumentFixture(company,{stageFlow:true,finalNoItems:true});
    try{
      const product=await f.receiver.start(f.packet,f.sender);assert.equal(product.state,'awaiting-stage-consent',JSON.stringify(product.error));assert.equal(product.challenge.stage,'productPage');
      assert.deepEqual(product.challenge.items.map(item=>item.key),['msrpAgree']);assert.equal(product.challenge.items[0].termsText,f.stageItems.productPage[0].termsText);assert.equal(product.challenge.items[0].title,f.stageItems.productPage[0].title);
      assert.equal(approvals(f).length,0);assert.equal(f.submitted,0);assert.deepEqual(stages(f),[]);assert.equal(f.documents.get(product.docId).jsonDocument[0].imagePage.msrpAgree,false);
      const image=await f.receiver.confirm(f.packet,f.sender,f.action(product));assert.equal(image.state,'awaiting-stage-consent',JSON.stringify(image.error));assert.equal(image.docId,product.docId);assert.equal(image.challenge.stage,'imagePage');
      assert.deepEqual(image.challenge.items.map(item=>item.key),['labelContactAgreed']);assert.equal(image.challenge.items[0].termsText,f.stageItems.imagePage[0].termsText);assert.deepEqual(stages(f),['productPage']);
      assert.equal(f.documents.get(product.docId).jsonDocument[0].imagePage.msrpAgree,true);assert.equal(f.documents.get(product.docId).jsonDocument[0].imagePage.labelContactAgreed,false);assert.equal(f.submitted,0);
      const final=await f.receiver.confirm(f.packet,f.sender,f.action(image));assert.equal(final.state,'awaiting-consent',JSON.stringify(final.error));assert.equal(final.docId,product.docId);assert.deepEqual(final.challenge.items,[]);assert.deepEqual(stages(f),['productPage','imagePage']);
      assert.equal(f.createCount,1);assert.equal(f.updateCount,1);assert.deepEqual(f.stageAcceptCounts,{productPage:1,imagePage:1});assert.equal(f.submitted,0);
      const submitted=await f.receiver.confirm(f.packet,f.sender,f.action(final));assert.equal(submitted.registered,true,JSON.stringify(submitted.error));assert.equal(f.submitted,1);assert.equal(f.createCount,1);f.assertPreserved();
    }finally{f.close();}
  });

  test(company.name+' expired changed wrong-stage or untrusted confirmations never select a stage agreement',async()=>{
    for(const mode of ['expired','changed-terms','changed-title','wrong-stage','untrusted','missing-user']){
      const f=await singleDocumentFixture(company,{stageFlow:true,humanConfirmed:mode!=='untrusted'});
      try{
        const initial=await f.receiver.start(f.packet,f.sender),action=f.action(initial);
        if(mode==='expired')f.now+=120001;if(mode==='changed-terms')f.stageItems.productPage[0].termsText+=' 다른 약관';if(mode==='changed-title')f.stageItems.productPage[0].title+=' 변경';
        if(mode==='wrong-stage')action.stage='imagePage';if(mode==='missing-user')delete action.userInitiated;
        const result=await f.receiver.confirm(f.packet,f.sender,action);assert.equal(result.state,'awaiting-stage-consent',JSON.stringify(result));assert.equal(result.registered,false);
        assert.equal(approvals(f).length,0);assert.deepEqual(stages(f),[]);assert.equal(f.stageItems.productPage[0].checked,false);assert.equal(f.submitted,0);f.assertPreserved();
      }finally{f.close();}
    }
  });

  test(company.name+' source session ABA invalidates a previously reviewed stage challenge',async()=>{
    const f=await singleDocumentFixture(company,{stageFlow:true});
    try{const initial=await f.receiver.start(f.packet,f.sender);f.sessionId='session-after-owner-logout-login';const result=await f.receiver.confirm(f.packet,f.sender,f.action(initial));assert.equal(result.state,'scope-blocked');assert.equal(result.registered,false);assert.equal(Object.hasOwn(result,'challenge'),false);assert.equal(approvals(f).length,0);assert.equal(f.submitted,0);f.assertPreserved();}finally{f.close();}
  });

  test(company.name+' stage consent ACK loss is resolved by exact read-only evidence and explicit resume without repeating acceptance',async()=>{
    const f=await singleDocumentFixture(company,{stageFlow:true,stageConsentLost:'productPage'});
    try{
      const initial=await f.receiver.start(f.packet,f.sender),pending=await f.receiver.confirm(f.packet,f.sender,f.action(initial));assert.equal(pending.state,'stage-consent-requested',JSON.stringify(pending));assert.equal(pending.needsRecovery,true);assert.equal(f.stageAcceptCounts.productPage,1);
      const navigationCount=f.calls.filter(call=>call.name==='navigate').length;await f.receiver.start(f.packet,f.sender);await f.receiver.confirm(f.packet,f.sender,f.action(initial));assert.equal(approvals(f).length,1);
      const recovered=await f.receiver.recover(f.packet,f.sender);assert.equal(recovered.state,'navigation-requested',JSON.stringify(recovered));assert.equal(recovered.recovered,true);assert.deepEqual(stages(f),['productPage']);assert.equal(f.calls.filter(call=>call.name==='navigate').length,navigationCount);assert.equal(f.stageIndex,0);
      const next=await f.receiver.resume(f.packet,f.sender);assert.equal(next.state,'awaiting-stage-consent',JSON.stringify(next));assert.equal(next.challenge.stage,'imagePage');assert.equal(approvals(f).length,1);assert.equal(f.createCount,1);assert.equal(f.submitted,0);f.assertPreserved();
    }finally{f.close();}
  });

  test(company.name+' unknown or mismatched stage consent recovery never accepts an unobserved checkbox',async()=>{
    for(const options of [{stageConsentNoCommit:'productPage'},{stageConsentLost:'productPage',stageRecoveryProof:{operationId:'wrong-operation'}},{stageConsentLost:'productPage',stageRecoveryProof:{stage:'imagePage'}},{stageConsentLost:'productPage',stageRecoveryProof:{readOnly:false}}]){
      const f=await singleDocumentFixture(company,{stageFlow:true,...options});
      try{
        const initial=await f.receiver.start(f.packet,f.sender);await f.receiver.confirm(f.packet,f.sender,f.action(initial));const calls=approvals(f).length;
        const result=await f.receiver.recover(f.packet,f.sender);assert.equal(result.state,'stage-consent-requested',JSON.stringify(result));assert.equal(result.registered,false);assert.equal(approvals(f).length,calls);assert.deepEqual(stages(f),[]);assert.equal(f.submitted,0);assert.equal(f.stageIndex,0);f.assertPreserved();
      }finally{f.close();}
    }
  });
}

test('non-consent body mutation before or after human stage acceptance blocks all later stages and final submission',async()=>{
  for(const mode of ['before-accept','after-accept']){
    const f=await singleDocumentFixture(SINGLE_COMPANIES[0],{stageFlow:true,before:(name,input,fixture)=>{if(mode==='after-accept'&&name==='confirmStageAgreements')fixture.documents.get(input.docId).jsonDocument[0].productPage.supplyPrice=1;}});
    try{
      const initial=await f.receiver.start(f.packet,f.sender);if(mode==='before-accept')f.documents.get(initial.docId).jsonDocument[0].productPage.supplyPrice=1;
      const result=await f.receiver.confirm(f.packet,f.sender,f.action(initial));assert.equal(result.error?.code,'READBACK_UNCONFIRMED',JSON.stringify({mode,result}));assert.equal(result.registered,false);
      assert.equal(f.stageAcceptCounts.imagePage,0);assert.equal(f.stageIndex,0);assert.equal(f.submitted,0);assert.equal(f.createCount,1);assert.equal(approvals(f).length,mode==='after-accept'?1:0);f.assertPreserved();
    }finally{f.close();}
  }
});

test('independent confirmations consume one durable stage transition and accept only once',async()=>{
  const held=deferred();let verifying=0;
  const f=await singleDocumentFixture(SINGLE_COMPANIES[0],{stageFlow:true,before:async name=>{if(name==='verifyHumanConfirmation'&&++verifying===1)await held.promise;}});
  try{
    const initial=await f.receiver.start(f.packet,f.sender),other=createSingleDocumentReceiver({adapter:f.adapter,store:f.storage.store,now:()=>f.now});
    const first=f.receiver.confirm(f.packet,f.sender,f.action(initial));await waitUntil(()=>verifying>0);const second=await other.confirm(f.packet,f.sender,f.action(initial));
    held.resolve();await first;assert.equal(second.state,'awaiting-stage-consent',JSON.stringify(second));assert.equal(second.challenge.stage,'imagePage');assert.deepEqual(f.stageAcceptCounts,{productPage:1,imagePage:0});assert.equal(approvals(f).length,1);assert.deepEqual(stages(f),['productPage']);assert.equal(f.createCount,1);assert.equal(f.submitted,0);f.assertPreserved();
  }finally{held.resolve();f.close();}
});

test('empty final checklist without two recorded stage approvals cannot submit',async()=>{
  const f=await singleDocumentFixture(SINGLE_COMPANIES[0],{agreementReview:{stage:'logisticsPage',items:[]}});
  try{const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.registered,false);assert.equal(result.state,'navigation-requested');assert.equal(f.submitted,0);assert.equal(f.calls.some(call=>call.name==='confirmAgreements'),false);f.assertPreserved();}finally{f.close();}
});

test('missing full terms or a mismatched checkbox identity cannot create a stage challenge',async()=>{
  for(const mutate of [item=>{item.termsText='';},item=>{item.title='';},item=>{item.id='agreeLabelContact';},item=>{item.key='labelContactAgreed';}]){
    const f=await singleDocumentFixture(SINGLE_COMPANIES[0],{stageFlow:true,stageAgreementReview:review=>{mutate(review.items[0]);return review;}});
    try{const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'navigation-requested');assert.equal(result.error.code,'AGREEMENT_REVIEW');assert.equal(Object.hasOwn(result,'challenge'),false);assert.equal(approvals(f).length,0);assert.equal(f.submitted,0);f.assertPreserved();}finally{f.close();}
  }
});

test('stage confirmation that expires while the human response is pending never clicks the checkbox',async()=>{
  const f=await singleDocumentFixture(SINGLE_COMPANIES[0],{stageFlow:true,before:(name,input,fixture)=>{if(name==='verifyHumanConfirmation')fixture.now+=120001;}});
  try{
    const started=await f.receiver.start(f.packet,f.sender),result=await f.receiver.confirm(f.packet,f.sender,f.action(started));assert.equal(result.state,'awaiting-stage-consent');assert.equal(result.error.code,'HUMAN_CONFIRMATION');assert.equal(approvals(f).length,0);assert.deepEqual(stages(f),[]);assert.equal(f.submitted,0);f.assertPreserved();
  }finally{f.close();}
});

test('unapproved body consent flag cannot be normalized by a later stage confirmation',async()=>{
  const f=await singleDocumentFixture(SINGLE_COMPANIES[0],{stageFlow:true});
  try{
    const initial=await f.receiver.start(f.packet,f.sender);f.documents.get(initial.docId).jsonDocument[0].imagePage.labelContactAgreed=true;
    const result=await f.receiver.confirm(f.packet,f.sender,f.action(initial));assert.equal(result.error.code,'READBACK_UNCONFIRMED');assert.equal(approvals(f).length,0);assert.deepEqual(stages(f),[]);assert.equal(f.stageIndex,0);assert.equal(f.submitted,0);f.assertPreserved();
  }finally{f.close();}
});

test('explicit resume after a recovered stage click rechecks non-consent body before advancing',async()=>{
  const f=await singleDocumentFixture(SINGLE_COMPANIES[0],{stageFlow:true,stageConsentLost:'productPage'});
  try{
    const initial=await f.receiver.start(f.packet,f.sender);await f.receiver.confirm(f.packet,f.sender,f.action(initial));
    const recovered=await f.receiver.recover(f.packet,f.sender);assert.equal(recovered.state,'navigation-requested');
    f.documents.get(initial.docId).jsonDocument[0].productPage.supplyPrice=1;const navigationCount=f.calls.filter(call=>call.name==='navigate').length;
    const result=await f.receiver.resume(f.packet,f.sender);assert.equal(result.error?.code,'READBACK_UNCONFIRMED',JSON.stringify(result));assert.equal(result.registered,false);
    assert.equal(f.calls.filter(call=>call.name==='navigate').length,navigationCount);assert.equal(f.stageIndex,0);assert.equal(f.stageAcceptCounts.productPage,1);assert.equal(f.stageAcceptCounts.imagePage,0);assert.equal(f.submitted,0);assert.equal(f.createCount,1);f.assertPreserved();
  }finally{f.close();}
});
