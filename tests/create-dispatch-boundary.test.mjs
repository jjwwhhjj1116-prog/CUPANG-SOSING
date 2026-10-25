import test from 'node:test';
import assert from 'node:assert/strict';
import {singleDocumentFixture,SINGLE_COMPANIES as companies} from './helpers/supplier-hub-single-document.mjs';
import {createSupplierHubDocumentReceiver,SingleDocumentError,singleDocumentIdentity,SINGLE_DOCUMENT_FORMAT} from '../extensions/supplier-hub/single-document.mjs';

test('a failed final create guard preserves the same operation and resumes only a positively undispatched create',async()=>{
 const f=await singleDocumentFixture(companies[0]);
 try{
  let stop=true;
  const adapter={...f.adapter,readSource:async input=>{
   if(stop&&f.storage.get(f.context.key)?.state==='create-requested')throw new SingleDocumentError('SOURCE_CHANGED','source changed before dispatch');
   return f.adapter.readSource(input);
  }};
  const receiver=createSupplierHubDocumentReceiver({adapter,store:f.storage.store,now:()=>f.now},{format:SINGLE_DOCUMENT_FORMAT,identity:singleDocumentIdentity,draftOnly:true});
  const first=await receiver.prepareDraft(f.packet,f.sender);
  assert.equal(first.state,'scope-blocked');assert.equal(f.createCount,0);
  const saved=f.storage.get(f.context.key);
  assert.equal(saved.state,'target-created');assert.equal(saved.requestId,f.packet.requestId);assert.equal(saved.operationId,f.packet.requestId+':target');
  assert.equal(saved.docId,null);assert.ok(saved.ownedTarget);
  stop=false;
  const recovered=await receiver.recoverDraft(f.packet,f.sender);
  assert.equal(recovered.state,'target-created');assert.equal(recovered.needsRecovery,false);assert.equal(f.createCount,0);
  const completed=await receiver.prepareDraft(f.packet,f.sender);
  assert.equal(completed.state,'validated');assert.equal(completed.requestId,f.packet.requestId);assert.equal(f.createCount,1);
  assert.equal(f.submitted,0);f.assertPreserved();
 }finally{f.close();}
});

test('an uncertain create after the adapter is called never rolls back or retries its remote write',async()=>{
 const f=await singleDocumentFixture(companies[0],{createNoCommit:true});
 try{
  const receiver=createSupplierHubDocumentReceiver({adapter:f.adapter,store:f.storage.store,now:()=>f.now},{format:SINGLE_DOCUMENT_FORMAT,identity:singleDocumentIdentity,draftOnly:true});
  const first=await receiver.prepareDraft(f.packet,f.sender);
  assert.equal(first.state,'create-requested');assert.equal(first.needsRecovery,true);
  const before=f.calls.filter(c=>c.name==='hubRequest'&&c.input.method==='POST').length;
  await receiver.recoverDraft(f.packet,f.sender);await receiver.prepareDraft(f.packet,f.sender);
  assert.equal(f.storage.get(f.context.key).state,'create-requested');
  assert.equal(f.calls.filter(c=>c.name==='hubRequest'&&c.input.method==='POST').length,before);
  assert.equal(f.submitted,0);f.assertPreserved();
 }finally{f.close();}
});
