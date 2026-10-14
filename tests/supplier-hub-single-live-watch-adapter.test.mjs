import test from 'node:test';
import assert from 'node:assert/strict';
import {singleBrowserFixture} from './helpers/supplier-hub-single-document-adapter.mjs';
import {SINGLE_COMPANIES} from './helpers/supplier-hub-single-document.mjs';
import {createSingleDocumentBrowserAdapter} from '../extensions/supplier-hub/single-document-adapter.mjs';
import {createSingleDocumentReceiver} from '../extensions/supplier-hub/single-document.mjs';

const otherLoad=async f=>{
  f.termModal=null;f.hubLocation.pathname='/sr/registration/step/startPage';
  f.hubDocument.querySelectorAll('.btn-outline-secondary')[0].click();
  const row=f.hubDocument.querySelectorAll('.sr-contents__table-draft tbody > tr')[0];
  await row.querySelectorAll('td')[3].querySelectorAll('.btn-outline-primary')[0].click();
  f.hubLocation.pathname='/sr/registration/step/productPage';
};
const protectedRow=f=>assert.deepEqual(f.documents.get('protected-previous'),f.prior);
for(const company of SINGLE_COMPANIES){
  for(const timing of ['after-challenge','during-human','before-final']){
    test(company.name+' foreign SPA draft load '+timing+' cannot accept terms, NEXT or submit for the stale owned marker',async()=>{
      const options={stageFlow:true},f=await singleBrowserFixture(company,options);
      try{
        let challenge=await f.receiver.start(f.packet,f.sender);assert.equal(challenge.state,'awaiting-stage-consent');const uuid=f.hubDocumentId;
        if(timing==='before-final'){
          challenge=await f.receiver.confirm(f.packet,f.sender,f.action(challenge));challenge=await f.receiver.confirm(f.packet,f.sender,f.action(challenge));assert.equal(challenge.state,'awaiting-consent');
        }
        const next=f.nextClicks,approvals={...f.stageApprovalClicks};
        if(timing==='during-human')options.beforeHumanConfirmation=async()=>otherLoad(f);else await otherLoad(f);
        const result=await f.receiver.confirm(f.packet,f.sender,f.action(challenge));assert.equal(result.registered,false);assert.equal(f.loaded,'protected-previous');assert.equal(f.hubDocumentId,uuid);
        assert.equal(f.nextClicks,next);assert.deepEqual(f.stageApprovalClicks,approvals);assert.equal(f.submitted,0);protectedRow(f);
        await f.receiver.recover(f.packet,f.sender);await f.receiver.resume(f.packet,f.sender);assert.equal(f.nextClicks,next);assert.equal(f.submitted,0);
      }finally{f.close();}
    });
  }
}
test('native trusted Hub input interrupts the owned flow while synthetic input cannot replace the trusted app confirmation',async()=>{
  for(const name of ['pointerdown','keydown','input','change']){
    const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{stageFlow:true});
    try{const started=await f.receiver.start(f.packet,f.sender),clicks=f.nextClicks;f.hubEvent(name,true);
      const result=await f.receiver.confirm(f.packet,f.sender,f.action(started));assert.equal(result.registered,false);assert.equal(f.nextClicks,clicks);assert.equal(f.stageApprovalClicks.productPage,0);assert.equal(f.submitted,0);protectedRow(f);
    }finally{f.close();}
  }
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{stageFlow:true});
  try{const started=await f.receiver.start(f.packet,f.sender);f.hubEvent('input',false);const result=await f.receiver.confirm(f.packet,f.sender,f.action(started));assert.equal(result.challenge.stage,'imagePage');assert.equal(f.stageApprovalClicks.productPage,1);protectedRow(f);}finally{f.close();}
});
test('worker adapter replacement cannot trust the persisted loaded marker without its live in-memory observer',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{stageFlow:true});let restarted;
  try{
    const started=await f.receiver.start(f.packet,f.sender),clicks=f.nextClicks;f.adapter.dispose();restarted=createSingleDocumentBrowserAdapter({api:f.api});
    const receiver=createSingleDocumentReceiver({adapter:restarted,store:f.storage.store});
    const result=await receiver.confirm(f.packet,f.sender,f.action(started));assert.equal(result.registered,false);assert.equal(f.nextClicks,clicks);assert.equal(f.stageApprovalClicks.productPage,0);assert.equal(f.submitted,0);protectedRow(f);
  }finally{restarted?.dispose();f.close();}
});
test('full document replacement and tab detach stop the next operation before any acceptance',async()=>{
  for(const action of [f=>{f.hubDocumentId=crypto.randomUUID();},f=>f.api.tabs.onDetached.emit(71,{oldWindowId:f.sender.tab.windowId,oldPosition:0}),f=>f.api.tabs.onUpdated.emit(71,{url:'https://supplier.coupang.com/sr/registration/step/startPage'},{windowId:f.sender.tab.windowId})]){
    const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{stageFlow:true});
    try{const started=await f.receiver.start(f.packet,f.sender),clicks=f.nextClicks;action(f);const result=await f.receiver.confirm(f.packet,f.sender,f.action(started));assert.equal(result.registered,false);assert.equal(f.nextClicks,clicks);assert.equal(f.stageApprovalClicks.productPage,0);assert.equal(f.submitted,0);protectedRow(f);}finally{f.close();}
  }
});
test('foreign document with the same product title is still a different document and cannot be accepted',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{stageFlow:true});
  try{const started=await f.receiver.start(f.packet,f.sender),next=f.nextClicks;f.documents.get('protected-previous').productName=f.documents.get(f.createdDocId).productName;f.prior.productName=f.documents.get(f.createdDocId).productName;
    await otherLoad(f);const result=await f.receiver.confirm(f.packet,f.sender,f.action(started));assert.equal(result.registered,false);assert.equal(f.stageApprovalClicks.productPage,0);assert.equal(f.nextClicks,next);assert.equal(f.submitted,0);protectedRow(f);
  }finally{f.close();}
});
