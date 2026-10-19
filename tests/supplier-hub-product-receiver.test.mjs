import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';
import {createProductDocumentReceiver,productDocumentIdentity,PRODUCT_DOCUMENT_RECEIVER_FORMAT} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {validateSingleDocumentPacket} from '../extensions/supplier-hub/single-document.mjs';
import {singlePacket,sqliteSingleStore,SINGLE_COMPANIES,SINGLE_SENDER,clone} from './helpers/supplier-hub-single-document.mjs';

const NOW=1_800_000_000_000,UUID='72800000-0000-4000-8000-000000000001';
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
async function packetFor(company=SINGLE_COMPANIES[0],edit){
  const single=singlePacket(company),body=clone(single.body),second=clone(body.jsonDocument[0]);
  second.startPage.productName=company.name+' 두 번째 저장 옵션';second.productPage.modelNumber='MODEL-SECOND';second.productPage.supplyPrice='';second.productPage.normalPrice=0;
  second.imagePage.details.detailedImage='';second.productPage.futureSavedValue={blank:'',zero:0,flag:false};body.jsonDocument.push(second);
  const identity={ownerId:single.ownerId,company:clone(company),productId:single.productId,profileId:single.profileId,requestedProfileId:single.profileId,
    categoryId:single.categoryId,fingerprint:single.fingerprint,inputFingerprint:'d'.repeat(64),schemaSha256:single.schemaSha256,source:{...single.source,profileId:single.profileId}};
  const members=[{optionId:'synthetic-first',optionLabel:'첫 저장 옵션',documentIndex:0},{optionId:'synthetic-second',optionLabel:'두 번째 저장 옵션',documentIndex:1}];
  const review={format:PRODUCT_DOCUMENT_RECEIVER_FORMAT,type:'YOOFAM_PRODUCT_DOCUMENT_REVIEW',identity,members,body,registered:false,remoteWrites:false,submissionReady:false};edit?.(review);
  const deferred=clone(review.body);for(const document of deferred.jsonDocument)for(const key of ['msrpAgree','labelContactAgreed'])if(Object.hasOwn(document.imagePage??{},key))document.imagePage[key]=false;
  review.originalBodySha256=digest(review.body);review.preparedBodySha256=digest(deferred);
  review.reviewDigest=digest({format:review.format,type:review.type,identity:review.identity,members:review.members,originalBodySha256:review.originalBodySha256,preparedBodySha256:review.preparedBodySha256});
  return createProductDocumentPacket(review,{requestId:UUID,now:NOW});
}

/** Actual shared receiver, committed SQLite claim/CAS, inert adapter boundary.
 * The remote simulator only stores new synthetic documents in local memory.
 * Existing records and original packet bytes are never used as update targets.
 */
async function fixture(company=SINGLE_COMPANIES[0],options={}){
  const packet=options.packet??await packetFor(company),sender=clone(SINGLE_SENDER),context=await productDocumentIdentity(packet,sender,{now:NOW}),storage=options.storage??sqliteSingleStore();
  const protectedBody={docId:'protected-existing',productName:'작업 중인 기존 상품',jsonDocument:[{productPage:{price:7777}}]},documents=new Map([[protectedBody.docId,clone(protectedBody)]]);
  const tab={tabId:71,windowId:sender.tab.windowId,origin:'https://supplier.coupang.com',requestId:packet.requestId,packetDigest:context.packetDigest,company:clone(company),authenticated:true};
  const calls=[],operations=new Map(),items=[{key:'businessTerms',id:'businessTerms',text:'합성 문서 제출 약관',required:true,checked:false,enabled:true}];
  const stages=['productPage','imagePage'],stageKeys={productPage:['msrpAgree','agreeMSRPTerm'],imagePage:['labelContactAgreed','agreeLabelContact']};
  const stageItems=Object.fromEntries(stages.map(stage=>[stage,[{key:stageKeys[stage][0],id:stageKeys[stage][1],text:'합성 '+stage+' 동의',title:'합성 '+stage+' 약관',termsText:'합성 약관 전문을 직접 확인합니다.',required:true,checked:false,enabled:true}]]));
  const f={packet,sender,context,storage,calls,documents,operations,items,stageItems,now:NOW,sourceCurrent:true,sessionId:'synthetic-group-session',createCount:0,updateCount:0,submitCount:0,stageIndex:0};
  const record=async(name,input)=>{calls.push({name,input:clone(input)});await options.before?.(name,input,f);};
  const proof=input=>({docId:input.docId,company:clone(company),identityDigest:context.identityDigest,body:clone(documents.get(input.docId))});
  const stageReview=input=>({docId:input.docId,company:clone(company),stage:stages[f.stageIndex],readyForConsent:true,items:clone(stageItems[stages[f.stageIndex]])});
  const adapter={
    readSource:async input=>{await record('readSource',input);return {current:f.sourceCurrent,submissionReady:true,priorDocumentClear:true,identity:clone(context.identity),bodySha256:context.originalBodySha256,sessionId:f.sessionId};},
    createTarget:async input=>{await record('createTarget',input);return {tabId:tab.tabId,windowId:tab.windowId,origin:tab.origin,requestId:input.requestId,packetDigest:input.packetDigest};},
    readTab:async input=>{await record('readTab',input);return clone(tab);},
    hubRequest:async input=>{
      await record('hubRequest',input);assert.equal(input.tab.tabId,71);const state=storage.get(context.key);
      if(input.method==='GET'){assert.equal(input.path,'/sr/draft/api/drafts');return {ok:true,status:200,json:[...documents.keys()].map(docId=>({docId}))};}
      if(input.path==='/sr/draft/api/create'||input.path==='/sr/draft/api/update'){
        const create=input.path.endsWith('/create');assert.equal(state.state,create?'create-requested':'update-requested');assert.equal(input.body.jsonDocument.length,2);
        for(const document of input.body.jsonDocument)for(const key of ['msrpAgree','labelContactAgreed'])if(Object.hasOwn(document.imagePage??{},key))assert.equal(document.imagePage[key],false);
        assert.equal(input.body.jsonDocument[1].productPage.supplyPrice,packet.review.body.jsonDocument[1].productPage.supplyPrice);assert.equal(input.body.jsonDocument[1].productPage.normalPrice,0);
        if(create){f.createCount++;assert.equal(input.body.docId,null);}else{f.updateCount++;assert.equal(input.body.docId,'new-group-'+company.code);}
        const docId='new-group-'+company.code,body={...clone(input.body),docId};documents.set(docId,body);operations.set(input.operationId,{docId});
        if(create&&options.createLost)throw Error('Synthetic committed create ACK lost');
        return {ok:true,status:200,json:create?{docId}:{}};
      }
      assert.equal(state.state,'validation-requested');assert.deepEqual(input.body,{docId:'new-group-'+company.code,version:packet.review.body.version});return {ok:true,status:200,json:{code:200,data:[{success:true}]}};
    },
    readDocument:async input=>{await record('readDocument',input);const value=proof(input);return options.readback?options.readback(value,f):value;},
    recoverWrite:async input=>{await record('recoverWrite',input);const operation=operations.get(input.operationId);return operation?{...proof({...input,docId:operation.docId}),readOnly:true,operationId:input.operationId}:null;},
    readValidation:async input=>{await record('readValidation',input);return {readOnly:true,operationId:input.operationId,docId:input.docId,company:clone(company),step:input.step,response:{code:200,data:[{success:true}]}};},
    navigate:async input=>{
      await record('navigate',input);
      if(options.stageFlow){while(f.stageIndex<2&&stageItems[stages[f.stageIndex]][0].checked){const key=stageKeys[stages[f.stageIndex]][0];for(const document of documents.get(input.docId).jsonDocument)document.imagePage[key]=true;f.stageIndex++;}
        if(f.stageIndex<2)return {...stageReview(input),productName:packet.review.body.productName,readyForSubmit:false};}
      return {docId:input.docId,company:clone(company),productName:packet.review.body.productName,readyForSubmit:true};
    },
    readStageAgreements:async input=>{await record('readStageAgreements',input);return stageReview(input);},
    confirmStageAgreements:async input=>{await record('confirmStageAgreements',input);for(const item of stageItems[input.stage])item.checked=true;return stageReview(input);},
    readAgreements:async input=>{await record('readAgreements',input);return {docId:input.docId,company:clone(company),readyForSubmit:true,items:clone(items)};},
    verifyHumanConfirmation:async input=>{await record('verifyHumanConfirmation',input);return {confirmed:true,challengeId:input.challenge.id,identityDigest:context.identityDigest};},
    confirmAgreements:async input=>{await record('confirmAgreements',input);for(const item of items)item.checked=true;return {docId:input.docId,company:clone(company),readyForSubmit:true,items:clone(items)};},
    submit:async input=>{await record('submit',input);assert.equal(storage.get(context.key).state,'submit-requested');assert.ok(items.every(item=>item.checked));f.submitCount++;if(options.submitLost)throw Error('Synthetic committed submit ACK lost');return {dispatched:true};},
    observeReceipt:async input=>{await record('observeReceipt',input);return {state:options.accepted?'accepted':'pending',sourceStatus:options.accepted?'FINISHED':'SUBMITTED',docId:input.docId,company:clone(company),identityDigest:context.identityDigest,
      preparedBodySha256:context.bodySha256,observedAt:f.now,receiptId:728001,qvtRequestId:728001,evidence:'document-receipt',registered:false,...options.receipt};},
  };
  f.adapter=adapter;f.receiver=createProductDocumentReceiver({adapter,store:storage.store,now:()=>f.now});
  f.action=result=>({action:result.challenge.stage?'confirm-and-continue':'confirm-and-submit',...(result.challenge.stage?{stage:result.challenge.stage}:{}),userInitiated:true,challengeId:result.challenge.id,confirmedAt:f.now,approvedKeys:result.challenge.items.filter(item=>item.required).map(item=>item.key)});
  f.assertPreserved=()=>{assert.deepEqual(documents.get(protectedBody.docId),protectedBody);assert.equal(digest(packet.review.body),packet.review.originalBodySha256);};f.close=()=>{if(!options.storage)storage.db.close();};return f;
}

for(const company of SINGLE_COMPANIES){
  test(company.name+' whole group writes once, preserves second-row values and stores one native document receipt',async()=>{
    const f=await fixture(company);try{const started=await f.receiver.start(f.packet,f.sender);assert.equal(started.state,'awaiting-consent');assert.equal(started.format,PRODUCT_DOCUMENT_RECEIVER_FORMAT);assert.equal(started.identity.members.length,2);assert.equal(Object.hasOwn(started.identity,'optionId'),false);
      assert.equal(f.createCount,1);assert.equal(f.updateCount,1);assert.equal(f.submitCount,0);assert.equal(f.calls.filter(call=>call.name==='hubRequest'&&call.input.path.includes('validate-step')).length,4);
      const received=await f.receiver.confirm(f.packet,f.sender,f.action(started));assert.equal(received.state,'pending');assert.equal(received.receipt.qvtRequestId,728001);assert.equal(received.registered,false);assert.equal(received.success,false);assert.equal(f.submitCount,1);
      const replay=await f.receiver.confirm(f.packet,f.sender,f.action(started));assert.equal(replay.state,'pending');assert.equal(f.submitCount,1);assert.equal(f.storage.db.prepare('SELECT COUNT(*) n FROM operations').get().n,1);f.assertPreserved();
    }finally{f.close();}
  });
  test(company.name+' all-row stage consent normalization accepts only known flags and keeps exact whole body',async()=>{
    const f=await fixture(company,{stageFlow:true,accepted:true});try{let result=await f.receiver.start(f.packet,f.sender);assert.equal(result.challenge.stage,'productPage');result=await f.receiver.confirm(f.packet,f.sender,f.action(result));assert.equal(result.challenge.stage,'imagePage');
      result=await f.receiver.confirm(f.packet,f.sender,f.action(result));assert.equal(result.state,'awaiting-consent');result=await f.receiver.confirm(f.packet,f.sender,f.action(result));assert.equal(result.state,'accepted');assert.equal(result.registered,false);assert.equal(f.submitCount,1);
      for(const document of f.documents.get(result.docId).jsonDocument){assert.equal(document.imagePage.msrpAgree,true);assert.equal(document.imagePage.labelContactAgreed,true);}assert.equal(f.createCount,1);assert.equal(f.updateCount,1);f.assertPreserved();
    }finally{f.close();}
  });
  test(company.name+' changed second row blocks before validation or navigation without touching protected product',async()=>{
    const f=await fixture(company,{readback:value=>{value.body.jsonDocument[1].productPage.supplyPrice='invented';return value;}});try{const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.error.code,'READBACK_UNCONFIRMED');assert.equal(result.registered,false);assert.equal(f.createCount,1);assert.equal(f.updateCount,1);assert.equal(f.calls.some(call=>call.name==='hubRequest'&&call.input.path.includes('validate-step')),false);assert.equal(f.calls.some(call=>call.name==='navigate'),false);assert.equal(f.submitCount,0);f.assertPreserved();}finally{f.close();}
  });
  test(company.name+' lost create ACK recovers whole body read-only then resumes once',async()=>{
    const f=await fixture(company,{createLost:true});try{let result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'create-requested');assert.equal(result.needsRecovery,true);assert.equal(f.createCount,1);assert.equal(f.updateCount,0);
      const postCount=f.calls.filter(call=>call.name==='hubRequest'&&call.input.method==='POST').length;result=await f.receiver.recover(f.packet,f.sender);assert.equal(result.state,'created');assert.equal(f.calls.filter(call=>call.name==='hubRequest'&&call.input.method==='POST').length,postCount);
      result=await f.receiver.resume(f.packet,f.sender);assert.equal(result.state,'awaiting-consent');assert.equal(f.createCount,1);assert.equal(f.updateCount,1);f.assertPreserved();}finally{f.close();}
  });
}

test('group identity binds ordered members and nullable requested profile; source changes do not open a second body lane',async()=>{
  const packet=await packetFor(),context=await productDocumentIdentity(packet,SINGLE_SENDER,{now:NOW});
  const changed=await packetFor(SINGLE_COMPANIES[0],review=>{review.body.jsonDocument[1].productPage.supplyPrice='9000';review.identity.source.quotationRevision++;}),next=await productDocumentIdentity(changed,SINGLE_SENDER,{now:NOW});
  assert.notEqual(context.key,next.key);assert.equal(context.laneKey,next.laneKey);assert.notEqual(context.identityDigest,next.identityDigest);
  const reordered=await packetFor(SINGLE_COMPANIES[0],review=>{review.members.reverse();review.members.forEach((member,index)=>member.documentIndex=index);review.body.jsonDocument.reverse();review.body.productName=review.body.jsonDocument[0].startPage.productName;}),order=await productDocumentIdentity(reordered,SINGLE_SENDER,{now:NOW});
  assert.notEqual(context.packetDigest,order.packetDigest);assert.equal(context.laneKey,order.laneKey);
  const queryless=await packetFor(SINGLE_COMPANIES[0],review=>{review.identity.requestedProfileId=null;}),none=await productDocumentIdentity(queryless,SINGLE_SENDER,{now:NOW});assert.equal(none.identity.requestedProfileId,null);assert.equal(none.identity.profileId,'synthetic-profile');assert.notEqual(none.identityDigest,context.identityDigest);
  const f=await fixture(SINGLE_COMPANIES[0],{packet,createLost:true});try{await f.receiver.start(packet,f.sender);await assert.rejects(f.receiver.start(changed,f.sender),error=>error.code==='CHECKPOINT_CONFLICT');assert.equal(f.createCount,1);f.assertPreserved();}finally{f.close();}
});

test('uncertain create reserves whole product across label/order/member/profile/category edits before any receipt exists',async()=>{
  const f=await fixture(SINGLE_COMPANIES[0],{createLost:true});try{
    const first=await f.receiver.start(f.packet,f.sender);assert.equal(first.state,'create-requested');assert.equal(first.receipt,undefined);assert.equal(f.storage.get(f.context.key).receipt,null);
    const changes=[
      review=>{review.members[1].optionLabel='수정한 표시 이름';},
      review=>{review.members.reverse();review.members.forEach((member,index)=>member.documentIndex=index);review.body.jsonDocument.reverse();review.body.productName=review.body.jsonDocument[0].startPage.productName;},
      review=>{review.members[1].optionId='different-included-member';},
      review=>{review.identity.profileId='other-profile';review.identity.requestedProfileId='other-profile';review.identity.source.profileId='other-profile';review.identity.source.profileRevision++;},
      review=>{review.identity.requestedProfileId=null;},
      review=>{review.identity.categoryId='99999';review.body.displayCategoryCode='99999';review.body.categoryPath='변경한 카테고리 (99999)';for(const document of review.body.jsonDocument)document.startPage.categoryPath=review.body.categoryPath;},
    ];
    const checkpoint=clone(f.storage.get(f.context.key));
    for(const change of changes){const packet=await packetFor(SINGLE_COMPANIES[0],change),context=await productDocumentIdentity(packet,f.sender,{now:NOW});assert.notEqual(context.key,f.context.key);assert.equal(context.laneKey,f.context.laneKey);
      await assert.rejects(f.receiver.start(packet,f.sender),error=>error.code==='CHECKPOINT_CONFLICT');assert.equal(f.createCount,1);assert.equal(f.updateCount,0);assert.deepEqual(f.storage.get(f.context.key),checkpoint);}
    assert.equal(f.storage.db.prepare('SELECT COUNT(*) n FROM operations').get().n,1);f.assertPreserved();
  }finally{f.close();}
});

test('durable reservation permits a different product and permits a new document only after positive known rejection',async()=>{
  const storage=sqliteSingleStore(),f=await fixture(SINGLE_COMPANIES[0],{storage,createLost:true});
  try{
    await f.receiver.start(f.packet,f.sender);
    const otherPacket=await packetFor(SINGLE_COMPANIES[0],review=>{review.identity.productId='other-synthetic-product';}),other=await fixture(SINGLE_COMPANIES[0],{storage,packet:otherPacket});
    try{assert.notEqual(other.context.laneKey,f.context.laneKey);assert.equal((await other.receiver.start(other.packet,other.sender)).state,'awaiting-consent');assert.equal(other.createCount,1);assert.equal(f.createCount,1);other.assertPreserved();}finally{other.close();}
    const rejectPacket=await packetFor(SINGLE_COMPANIES[0],review=>{review.identity.productId='positively-rejected-product';}),rejected=await fixture(SINGLE_COMPANIES[0],{storage,packet:rejectPacket,receipt:{state:'rejected',sourceStatus:'REJECTED'}});
    try{
      const ready=await rejected.receiver.start(rejected.packet,rejected.sender),result=await rejected.receiver.confirm(rejected.packet,rejected.sender,rejected.action(ready));assert.equal(result.state,'rejected');const previous=clone(storage.get(rejected.context.key));
      const revisedPacket=await packetFor(SINGLE_COMPANIES[0],review=>{review.identity.productId='positively-rejected-product';review.body.jsonDocument[1].productPage.supplyPrice='4321';review.identity.source.quotationRevision++;}),revised=await fixture(SINGLE_COMPANIES[0],{storage,packet:revisedPacket});
      try{assert.equal(revised.context.laneKey,rejected.context.laneKey);assert.notEqual(revised.context.key,rejected.context.key);assert.equal((await revised.receiver.start(revised.packet,revised.sender)).state,'awaiting-consent');assert.equal(revised.createCount,1);assert.deepEqual(storage.get(rejected.context.key),previous);revised.assertPreserved();}finally{revised.close();}
      rejected.assertPreserved();
    }finally{rejected.close();}
    assert.equal(storage.db.prepare('SELECT COUNT(*) n FROM operations').get().n,4);f.assertPreserved();
  }finally{f.close();storage.db.close();}
});

test('whole-group receipt never accepts a scalar SKU or registration status without every member join',async()=>{
  for(const receipt of [{state:'registered',sourceStatus:undefined,evidence:'document-and-sku',skuId:'one-sku'},{state:'accepted',skuId:'one-sku'},{state:'accepted',sourceStatus:undefined}]){
    const f=await fixture(SINGLE_COMPANIES[0],{receipt});try{const started=await f.receiver.start(f.packet,f.sender),result=await f.receiver.confirm(f.packet,f.sender,f.action(started));assert.equal(result.state,'submit-requested');assert.equal(result.error.code,'RECEIPT_UNCONFIRMED');assert.equal(result.registered,false);assert.equal(f.submitCount,1);f.assertPreserved();}finally{f.close();}
  }
});

test('lost submit ACK is observed without another submit; full source/account change blocks continuation',async()=>{
  const f=await fixture(SINGLE_COMPANIES[0],{submitLost:true});try{const started=await f.receiver.start(f.packet,f.sender),pending=await f.receiver.confirm(f.packet,f.sender,f.action(started));assert.equal(pending.state,'submit-requested');assert.equal(f.submitCount,1);const observed=await f.receiver.observe(f.packet,f.sender);assert.equal(observed.state,'pending');assert.equal(f.submitCount,1);
    f.sourceCurrent=false;const blocked=await f.receiver.observe(f.packet,f.sender);assert.equal(blocked.state,'scope-blocked');assert.equal(blocked.format,PRODUCT_DOCUMENT_RECEIVER_FORMAT);assert.equal(blocked.error.code,'SOURCE_CHANGED');assert.equal(f.submitCount,1);f.assertPreserved();}finally{f.close();}
});

test('strict legacy format and sender boundaries remain distinct from the whole-product contract',async()=>{
  const packet=await packetFor();assert.throws(()=>validateSingleDocumentPacket(packet,SINGLE_SENDER));await assert.rejects(productDocumentIdentity(singlePacket(),SINGLE_SENDER,{now:NOW}));
  for(const sender of [{...SINGLE_SENDER,frameId:1},{...SINGLE_SENDER,url:'https://other.test/'},{...SINGLE_SENDER,tab:{id:1,windowId:-1}},{...SINGLE_SENDER,url:'https://user:pass@sourceflow.jjwwhhjj1116.workers.dev/'}])await assert.rejects(productDocumentIdentity(packet,sender,{now:NOW}));
  const f=await fixture();try{await f.receiver.start(f.packet,f.sender);const checkpoint=f.storage.get(f.context.key);checkpoint.format='yoofam-supplier-hub-single-document-v1';f.storage.force(f.context.key,checkpoint);await assert.rejects(f.receiver.resume(f.packet,f.sender),error=>error.code==='CHECKPOINT');assert.equal(f.createCount,1);f.assertPreserved();}finally{f.close();}
});

test('expired initial request cannot create, while its exact committed unknown ACK remains recoverable read-only',async()=>{
  const f=await fixture(SINGLE_COMPANIES[0],{createLost:true});try{
    await f.receiver.start(f.packet,f.sender);f.now+=180000;
    await assert.rejects(f.receiver.start(f.packet,f.sender),error=>error.code==='EXPIRED');
    const before=f.calls.filter(call=>call.name==='hubRequest'&&call.input.method==='POST').length,recovered=await f.receiver.recover(f.packet,f.sender);
    assert.equal(recovered.state,'created');assert.equal(f.calls.filter(call=>call.name==='hubRequest'&&call.input.method==='POST').length,before);assert.equal(f.createCount,1);
    const result=await f.receiver.resume(f.packet,f.sender);assert.equal(result.state,'awaiting-consent');assert.equal(f.createCount,1);assert.equal(f.updateCount,1);f.assertPreserved();
  }finally{f.close();}
  const empty=await fixture();try{empty.now+=180000;await assert.rejects(empty.receiver.start(empty.packet,empty.sender),error=>error.code==='EXPIRED');await assert.rejects(empty.receiver.recover(empty.packet,empty.sender),error=>error.code==='CHECKPOINT');assert.equal(empty.createCount,0);}finally{empty.close();}
});

test('a positively observed group rejection stays terminal and later conflicting native statuses retain original evidence',async()=>{
  const options={receipt:{state:'rejected',sourceStatus:'REJECTED'}},f=await fixture(SINGLE_COMPANIES[0],options);try{
    const ready=await f.receiver.start(f.packet,f.sender),rejected=await f.receiver.confirm(f.packet,f.sender,f.action(ready));assert.equal(rejected.state,'rejected');const prior=clone(f.storage.get(f.context.key));
    for(const status of [{state:'accepted',sourceStatus:'FINISHED'},{state:'pending',sourceStatus:'SUBMITTED'}]){options.receipt=status;f.now++;const conflict=await f.receiver.observe(f.packet,f.sender);assert.equal(conflict.state,'rejected');assert.equal(conflict.error.code,'RECEIPT_CHANGED');assert.equal(conflict.receipt.sourceStatus,'REJECTED');assert.deepEqual(f.storage.get(f.context.key),prior);assert.equal(f.submitCount,1);}
    f.assertPreserved();
  }finally{f.close();}
});
