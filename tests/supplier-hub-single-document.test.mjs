import test from 'node:test';
import assert from 'node:assert/strict';
import {createSingleDocumentReceiver,createSingleDocumentStore,validateSingleDocumentPacket,validateSingleStepResponse,singleDocumentIdentity} from '../extensions/supplier-hub/single-document.mjs';
import {singleDocumentFixture,singlePacket,SINGLE_COMPANIES,SINGLE_SENDER,clone,deferred} from './helpers/supplier-hub-single-document.mjs';
async function until(predicate){for(let index=0;index<100;index++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}assert.fail('Synthetic operation did not reach the requested checkpoint.');}

for(const company of SINGLE_COMPANIES){
  test(company.name+' Single exact one-option sequence stops before consent and preserves original agreement defaults',async()=>{
    const f=await singleDocumentFixture(company);
    try{
      const started=await f.receiver.start(f.packet,f.sender);
      assert.equal(started.state,'awaiting-consent');assert.equal(started.registered,false);assert.equal(started.success,false);assert.equal(started.docId,'created-'+company.code);
      const protocol=f.calls.filter(call=>call.name==='hubRequest').map(call=>[call.input.method,call.input.path]);
      assert.deepEqual(protocol,[['GET','/sr/draft/api/drafts'],['POST','/sr/draft/api/create'],['POST','/sr/draft/api/update'],...[2,3,4,5].map(step=>['POST','/sr/qvt/api/validate-step/'+step]),['GET','/sr/draft/api/drafts']]);
      assert.equal(f.submitted,0);assert.equal(f.calls.some(call=>['confirmAgreements','submit'].includes(call.name)),false);assert.ok(f.items.every(item=>!item.checked));
      assert.notEqual(f.context.originalBodySha256,f.context.bodySha256);
      assert.equal(f.storage.get(f.context.key).originalBodySha256,f.context.originalBodySha256);f.assertPreserved();
      const complete=await f.receiver.confirm(f.packet,f.sender,f.action(started));
      assert.equal(complete.state,'registered');assert.equal(complete.registered,true);assert.equal(complete.receipt.skuId,'sku-'+company.code);assert.equal(f.submitted,1);
      const repeated=await f.receiver.confirm(f.packet,f.sender,f.action(started));assert.equal(repeated.registered,true);assert.equal(f.submitted,1);
      assert.equal(f.createCount,1);assert.equal(f.updateCount,1);f.assertPreserved();
    }finally{f.close();}
  });

  test(company.name+' lost create ACK requires exact read recovery and explicit resume with no second create',async()=>{
    const f=await singleDocumentFixture(company,{createLost:true});
    try{
      let result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'create-requested');assert.equal(result.needsRecovery,true);assert.equal(f.updateCount,0);
      result=await f.receiver.start({...f.packet,requestId:'second-request'},f.sender);assert.equal(result.duplicate,true);assert.equal(f.createCount,1);
      const before=f.calls.filter(call=>call.name==='hubRequest'&&call.input.method==='POST').length;
      result=await f.receiver.recover(f.packet,f.sender);assert.equal(result.state,'created');assert.equal(result.recovered,true);assert.equal(f.updateCount,0);
      assert.equal(f.calls.filter(call=>call.name==='hubRequest'&&call.input.method==='POST').length,before);
      result=await f.receiver.resume(f.packet,f.sender);assert.equal(result.state,'awaiting-consent');assert.equal(f.createCount,1);assert.equal(f.updateCount,1);f.assertPreserved();
    }finally{f.close();}
  });

  test(company.name+' lost update ACK halts validation, read recovery preserves exact fresh doc and never resends update',async()=>{
    const f=await singleDocumentFixture(company,{updateLost:true});
    try{
      let result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'update-requested');assert.equal(f.calls.some(call=>call.name==='hubRequest'&&call.input.path.includes('validate-step')),false);
      result=await f.receiver.resume(f.packet,f.sender);assert.equal(result.needsRecovery,true);assert.equal(f.updateCount,1);
      result=await f.receiver.recover(f.packet,f.sender);assert.equal(result.state,'updated');assert.equal(f.updateCount,1);
      result=await f.receiver.resume(f.packet,f.sender);assert.equal(result.state,'awaiting-consent');assert.equal(f.updateCount,1);f.assertPreserved();
    }finally{f.close();}
  });

  test(company.name+' HTTP 503 after create/update commit is unknown and explicit recovery never duplicates either write',async()=>{
    for(const operation of ['create','update']){
      const f=await singleDocumentFixture(company,{[operation+'Response']:{ok:false,status:503,json:{error:'readback failed after commit'}}});
      try{
        const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,operation+'-requested');assert.equal(result.needsRecovery,true);assert.equal(result.error.code,'ACK_UNCERTAIN');
        assert.equal(f.calls.some(call=>call.name==='navigate'),false);
        const before=[f.createCount,f.updateCount],recovered=await f.receiver.recover(f.packet,f.sender);
        assert.equal(recovered.state,operation==='create'?'created':'updated');assert.deepEqual([f.createCount,f.updateCount],before);
        if(operation==='create')f.adapter.hubRequest=async input=>{throw Error('No automatic write is authorized after this read recovery: '+input.path);};
        f.assertPreserved();
      }finally{f.close();}
    }
  });

  test(company.name+' no committed create or unrelated recovery proof stays blocked without selecting existing draft',async()=>{
    const f=await singleDocumentFixture(company,{createNoCommit:true});
    try{
      await f.receiver.start(f.packet,f.sender);const recovery=await f.receiver.recover(f.packet,f.sender);
      assert.equal(recovery.state,'create-requested');assert.equal(recovery.error.code,'READBACK_UNCONFIRMED');assert.equal(f.updateCount,0);assert.equal(f.calls.some(call=>call.name==='navigate'),false);
      const replay=await f.receiver.resume(f.packet,f.sender);assert.equal(replay.needsRecovery,true);assert.equal(f.createCount,1);f.assertPreserved();
    }finally{f.close();}
  });

  test(company.name+' company/session/source changes stop later writes including account ABA',async()=>{
    for(const boundary of ['create','update','validation','consent','submit']){
      let changed=false;
      const f=await singleDocumentFixture(company,{before:async(name,input,fixture)=>{
        if(changed)return;
        const hit=boundary==='create'&&name==='hubRequest'&&input.method==='GET'
          ||boundary==='update'&&name==='hubRequest'&&input.path.endsWith('/create')
          ||boundary==='validation'&&name==='readDocument'
          ||boundary==='consent'&&name==='verifyHumanConfirmation'
          ||boundary==='submit'&&name==='confirmAgreements';
        if(hit){changed=true;fixture.sessionId='session-after-aba';}
      }});
      try{
        const started=await f.receiver.start(f.packet,f.sender),outcome=started.state==='awaiting-consent'?await f.receiver.confirm(f.packet,f.sender,f.action(started)):started;
        assert.equal(outcome.error.code,'SOURCE_CHANGED',boundary);assert.equal(outcome.registered,false);assert.equal(f.submitted,0);
        assert.equal(f.createCount,boundary==='create'?0:1);assert.equal(f.updateCount,['create','update'].includes(boundary)?0:1);f.assertPreserved();
      }finally{f.close();}
    }
  });

  test(company.name+' malformed and rejected validation never navigate or report completion',async()=>{
    for(const value of [null,{code:200,data:[]},{code:200,data:[{success:true},{}]},{code:200,data:[{success:true,errors:[{columnName:'가격',message:'오류'}]}]},{code:200,data:[{success:false,errors:[{columnName:'가격',message:'원가 확인'}]}]}]){
      const f=await singleDocumentFixture(company,{validationResponse:()=>value});
      try{
        const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.registered,false);assert.equal(f.calls.some(call=>call.name==='navigate'),false);assert.equal(f.submitted,0);
        assert.equal(f.calls.filter(call=>call.name==='hubRequest'&&call.input.path.includes('validate-step')).length,1);
        if(value?.data?.[0]?.success===false){assert.equal(result.state,'validation-rejected');assert.deepEqual(f.storage.get(f.context.key).validationErrors,value.data[0].errors);}
        else assert.equal(result.state,'validation-requested');f.assertPreserved();
      }finally{f.close();}
    }
  });

  test(company.name+' uncertain step validation recovers read-only then resumes only remaining steps',async()=>{
    const f=await singleDocumentFixture(company,{validationLost:3});
    try{
      let result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'validation-requested');assert.deepEqual(f.storage.get(f.context.key).validatedSteps,[2]);
      result=await f.receiver.recover(f.packet,f.sender);assert.equal(result.state,'updated');assert.deepEqual(f.storage.get(f.context.key).validatedSteps,[2,3]);
      result=await f.receiver.resume(f.packet,f.sender);assert.equal(result.state,'awaiting-consent');
      assert.deepEqual(f.calls.filter(call=>call.name==='hubRequest'&&call.input.path.includes('validate-step')).map(call=>Number(call.input.path.split('/').at(-1))),[2,3,4,5]);f.assertPreserved();
    }finally{f.close();}
  });

  test(company.name+' stored body defaults, stale challenge, missing UI confirmation and changed agreement text never approve',async()=>{
    for(const failure of ['default','stale','untrusted','changed']){
      const f=await singleDocumentFixture(company,{humanConfirmed:failure!=='untrusted'});
      try{
        const started=await f.receiver.start(f.packet,f.sender),action=f.action(started);
        if(failure==='default')delete action.userInitiated;
        if(failure==='stale')f.now+=120001;
        if(failure==='changed')f.items[0].text+=' 다른 문구';
        const outcome=await f.receiver.confirm(f.packet,f.sender,action);assert.equal(outcome.state,'awaiting-consent');assert.equal(outcome.registered,false);
        assert.equal(f.calls.some(call=>call.name==='confirmAgreements'),false);assert.equal(f.submitted,0);assert.ok(f.items.every(item=>!item.checked));f.assertPreserved();
      }finally{f.close();}
    }
  });

  test(company.name+' final agreement recheck and durable submit marker prevent unchecked or duplicate submit',async()=>{
    let reads=0;
    const f=await singleDocumentFixture(company,{before:async(name,input,fixture)=>{
      if(name==='readAgreements'&&++reads===3)fixture.items[0].checked=false;
    }});
    try{
      const started=await f.receiver.start(f.packet,f.sender),result=await f.receiver.confirm(f.packet,f.sender,f.action(started));
      assert.equal(result.state,'consent-requested');assert.equal(result.error.code,'CONSENT_UNCONFIRMED');assert.equal(f.submitted,0);
      const restored=await f.receiver.recover(f.packet,f.sender);assert.equal(restored.state,'awaiting-consent');assert.notEqual(restored.challenge.id,started.challenge.id);
      const old=await f.receiver.confirm(f.packet,f.sender,f.action(started));assert.equal(old.error.code,'HUMAN_CONFIRMATION');assert.equal(f.submitted,0);
      const completed=await f.receiver.confirm(f.packet,f.sender,f.action(restored));assert.equal(completed.registered,true);assert.equal(f.submitted,1);f.assertPreserved();
    }finally{f.close();}
  });

  test(company.name+' lost final submit ACK is observed without another click; text-only success is not registration',async()=>{
    const f=await singleDocumentFixture(company,{submitLost:true});
    try{
      const started=await f.receiver.start(f.packet,f.sender),pending=await f.receiver.confirm(f.packet,f.sender,f.action(started));
      assert.equal(pending.state,'submit-requested');assert.equal(pending.registered,false);assert.equal(f.submitted,1);
      const observed=await f.receiver.observe(f.packet,f.sender);assert.equal(observed.registered,true);assert.equal(f.submitted,1);
      await f.receiver.confirm(f.packet,f.sender,f.action(started));assert.equal(f.submitted,1);f.assertPreserved();
    }finally{f.close();}
    const text=await singleDocumentFixture(company,{receipt:{evidence:'visible-text',skuId:undefined,receiptId:undefined}});
    try{const started=await text.receiver.start(text.packet,text.sender),result=await text.receiver.confirm(text.packet,text.sender,text.action(started));assert.equal(result.registered,false);assert.equal(result.state,'submit-requested');assert.equal(result.error.code,'RECEIPT_UNCONFIRMED');text.assertPreserved();}finally{text.close();}
  });

  test(company.name+' accepted receipt and exact registered identity remain distinct and cannot be replaced by stale/wrong SKU',async()=>{
    const options={receipt:{state:'accepted',evidence:'document-receipt',skuId:undefined}},f=await singleDocumentFixture(company,options);
    try{
      const started=await f.receiver.start(f.packet,f.sender),accepted=await f.receiver.confirm(f.packet,f.sender,f.action(started));
      assert.equal(accepted.state,'accepted');assert.equal(accepted.registered,false);assert.equal(accepted.success,false);
      options.receipt={};f.now++;const registered=await f.receiver.observe(f.packet,f.sender);assert.equal(registered.registered,true);
      options.receipt={skuId:'unrelated-sku'};f.now++;const wrong=await f.receiver.observe(f.packet,f.sender);assert.equal(wrong.receipt.skuId,'sku-'+company.code);assert.equal(wrong.error.code,'RECEIPT_CHANGED');
      options.receipt={observedAt:f.now-2};const stale=await f.receiver.observe(f.packet,f.sender);assert.equal(stale.error.code,'RECEIPT_CHANGED');assert.equal(f.submitted,1);f.assertPreserved();
    }finally{f.close();}
  });
}

test('Single packet rejects preview, bulk/multiple options, reused docId, mismatched start/category and non-app sender before any action',async()=>{
  const base=singlePacket();
  for(const edit of [p=>{p.type='YOOFAM_TRANSMIT_PACKAGE';},p=>{p.format='yoofam-supplier-hub-single-document-preview-v1';},p=>{p.body.docId='protected-existing';},p=>{p.body.jsonDocument.push(clone(p.body.jsonDocument[0]));},p=>{p.body.displayCategoryCode='999';},p=>{p.body.jsonDocument[0].startPage.productName='wrong';},p=>{p.company.name='wrong';},p=>{p.body.cookie='secret';},p=>{p.source.optionRevision=-1;}]){
    const packet=clone(base);edit(packet);assert.throws(()=>validateSingleDocumentPacket(packet,SINGLE_SENDER));
  }
  for(const sender of [{...SINGLE_SENDER,frameId:1},{...SINGLE_SENDER,url:'https://evil.test/'},{...SINGLE_SENDER,tab:{id:1,windowId:-1}},{...SINGLE_SENDER,url:'https://user:pass@sourceflow.jjwwhhjj1116.workers.dev/'}])assert.throws(()=>validateSingleDocumentPacket(base,sender));
});

test('pure validation response requires affirmative exact shape, never truthy strings or empty success',()=>{
  assert.deepEqual(validateSingleStepResponse({code:200,data:[{success:true}]}),{valid:true,errors:[]});
  for(const value of [false,{}, {code:'200',data:[{success:true}]},{code:200,data:[{success:'true'}]},{code:200,data:[{success:false,errors:['error']}]}])assert.throws(()=>validateSingleStepResponse(value));
});

test('native step validation accepts all successful members and preserves every later member failure',()=>{
  assert.deepEqual(validateSingleStepResponse({code:200,data:[{success:true},{success:true,errors:[]},{success:true}]}),{valid:true,errors:[]});
  const second={columnName:'옵션 2 포장 크기',message:'필수 값입니다.'},third={columnName:'옵션 3 표시사항',message:'확인해주세요.'};
  const response={code:200,data:[{success:true},{success:false,errors:[second]},{success:false,errors:[third]}]};
  const result=validateSingleStepResponse(response);assert.deepEqual(result,{valid:false,errors:[second,third]});
  result.errors[0].message='changed';assert.equal(response.data[1].errors[0].message,'필수 값입니다.');
  assert.deepEqual(validateSingleStepResponse({code:200,data:[{success:true},{success:false}]}),{valid:false,errors:[]});
});

test('native step validation rejects empty, sparse, contradictory or oversized aggregates without partial success',()=>{
  const good={success:true},failure={success:false,errors:[{columnName:'옵션',message:'검토 필요'}]},sparseRows=[good,,good],sparseErrors=[];
  sparseErrors.length=1;
  const invalid=[
    {code:200}, {code:200,data:[]}, {code:200,data:{success:true}},
    {code:200,data:sparseRows}, {code:200,data:[good,null]}, {code:200,data:[good,{success:1}]},
    {code:200,data:[good,{success:false,errors:{message:'not an array'}}]},
    {code:200,data:[good,{success:true,errors:[{columnName:'옵션',message:'contradiction'}]}]},
    {code:200,data:[good,{success:false,errors:sparseErrors}]},
    {code:200,data:[good,{success:false,errors:[{columnName:1,message:'invalid'}]}]},
    {code:200,data:[good,{success:false,errors:[{columnName:'x'.repeat(501),message:'invalid'}]}]},
    {code:200,data:[good,{success:false,errors:[{columnName:'옵션',message:'x'.repeat(2001)}]}]},
    {code:200,data:Array.from({length:201},()=>good)},
    {code:200,data:[{success:false,errors:Array.from({length:100},()=>failure.errors[0])},{success:false,errors:Array.from({length:101},()=>failure.errors[0])}]},
  ];
  for(const response of invalid)assert.throws(()=>validateSingleStepResponse(response),error=>error.code==='VALIDATION_RESPONSE');
  assert.deepEqual(validateSingleStepResponse({code:200,data:Array.from({length:200},()=>good)}),{valid:true,errors:[]});
  assert.equal(validateSingleStepResponse({code:200,data:[{success:false,errors:Array.from({length:100},()=>failure.errors[0])},{success:false,errors:Array.from({length:100},()=>failure.errors[0])}]}).errors.length,200);
});

test('two independent receivers share atomic lane/claim: held create gets only one remote request even with new request ID/app tab',async()=>{
  const wait=deferred(),f=await singleDocumentFixture(SINGLE_COMPANIES[0],{createWait:wait});
  try{
    const first=f.receiver.start(f.packet,f.sender);
    await until(()=>f.createCount>0);
    const second=createSingleDocumentReceiver({adapter:f.adapter,store:f.storage.store,now:()=>f.now});
    const duplicate=await second.start({...f.packet,requestId:'other-request'},f.sender);assert.equal(duplicate.state,'create-requested');assert.equal(duplicate.duplicate,true);
    await assert.rejects(second.start(f.packet,{...f.sender,tab:{id:999,windowId:f.sender.tab.windowId}}),error=>error.code==='CHECKPOINT');
    const changed={...f.packet,fingerprint:'d'.repeat(64),source:{...f.packet.source,optionRevision:6}};
    await assert.rejects(second.start(changed,f.sender),error=>error.code==='CHECKPOINT_CONFLICT');assert.equal(f.createCount,1);
    wait.resolve();assert.equal((await first).state,'awaiting-consent');f.assertPreserved();
  }finally{wait.resolve();f.close();}
});

test('create ACK pointing at a pre-existing draft halts without modifying or navigating that draft',async()=>{
  const f=await singleDocumentFixture(SINGLE_COMPANIES[0],{createResponse:{ok:true,status:200,json:{docId:'protected-existing'}}});
  try{const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'create-requested');assert.equal(result.error.code,'CREATE_UNCONFIRMED');assert.equal(f.updateCount,0);assert.equal(f.calls.some(call=>call.name==='navigate'),false);f.assertPreserved();}finally{f.close();}
});

test('readback must prove exact body/company/operation; lost ACK cannot select similarly named old draft',async()=>{
  for(const change of [{operationId:'another-operation'},{docId:'protected-existing'},{company:SINGLE_COMPANIES[1]},{identityDigest:'f'.repeat(64)},{readOnly:false}]){
    const f=await singleDocumentFixture(SINGLE_COMPANIES[0],{createLost:true,recoveryProof:change});
    try{await f.receiver.start(f.packet,f.sender);const outcome=await f.receiver.recover(f.packet,f.sender);assert.equal(outcome.state,'create-requested');assert.equal(outcome.error.code,'READBACK_UNCONFIRMED');assert.equal(f.updateCount,0);f.assertPreserved();}finally{f.close();}
  }
  const f=await singleDocumentFixture(SINGLE_COMPANIES[0],{readback:(input,fixture)=>({docId:input.docId,company:fixture.packet.company,identityDigest:fixture.context.identityDigest,body:{...fixture.documents.get(input.docId),productName:'old title'}})});
  try{const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'update-requested');assert.equal(result.error.code,'READBACK_UNCONFIRMED');assert.equal(f.calls.some(call=>call.name==='navigate'),false);f.assertPreserved();}finally{f.close();}
});

test('wrong authenticated Hub tab/company and unready source cannot create a document',async()=>{
  for(const options of [{selectedTab:{tabId:1,windowId:29,origin:'https://supplier.coupang.com',authenticated:true,company:SINGLE_COMPANIES[1]}},{selectedTab:{tabId:1,windowId:30,origin:'https://supplier.coupang.com',authenticated:true,company:SINGLE_COMPANIES[0]}},{sourceProof:{submissionReady:false}},{sourceProof:{priorDocumentClear:false}}]){
    const f=await singleDocumentFixture(SINGLE_COMPANIES[0],options);
    try{const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.registered,false);assert.equal(f.createCount,0);f.assertPreserved();}finally{f.close();}
  }
});

test('checkpoint CAS lost after remote commit preserves newer state and does not issue update',async()=>{
  const f=await singleDocumentFixture(SINGLE_COMPANIES[0],{before:async(name,input,fixture)=>{
    if(name==='hubRequest'&&input.path==='/sr/draft/api/create'){
      const current=fixture.storage.get(fixture.context.key);fixture.storage.force(fixture.context.key,{...current,sequence:current.sequence+1});
    }
  }});
  try{const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'create-requested');assert.equal(result.error.code,'CHECKPOINT_CONFLICT');assert.equal(f.updateCount,0);assert.equal(f.createCount,1);f.assertPreserved();}finally{f.close();}
});

test('independent confirm calls consume one durable consent/submit transition, never double click',async()=>{
  const held=deferred();let verifying=0;
  const f=await singleDocumentFixture(SINGLE_COMPANIES[0],{before:async name=>{if(name==='verifyHumanConfirmation'&&++verifying===1)await held.promise;}});
  try{
    const started=await f.receiver.start(f.packet,f.sender),second=createSingleDocumentReceiver({adapter:f.adapter,store:f.storage.store,now:()=>f.now});
    const first=f.receiver.confirm(f.packet,f.sender,f.action(started));await until(()=>verifying>0);
    const winner=await second.confirm(f.packet,f.sender,f.action(started));assert.equal(winner.registered,true);held.resolve();const late=await first;
    assert.equal(late.registered,true);assert.equal(late.error.code,'CHECKPOINT_CONFLICT');assert.equal(f.submitted,1);assert.equal(f.calls.filter(call=>call.name==='confirmAgreements').length,1);f.assertPreserved();
  }finally{held.resolve();f.close();}
});

test('transport identity is stable across request IDs and app tabs but company/option/source/original body changes are bound',async()=>{
  const packet=singlePacket(),base=await singleDocumentIdentity(packet,SINGLE_SENDER);
  assert.equal((await singleDocumentIdentity({...packet,requestId:'new-request'},SINGLE_SENDER)).key,base.key);
  const tab=await singleDocumentIdentity(packet,{...SINGLE_SENDER,tab:{id:2,windowId:3}});assert.equal(tab.key,base.key);assert.notEqual(tab.identityDigest,base.identityDigest);
  for(const change of [{optionId:'option-two'},{fingerprint:'d'.repeat(64)},{body:{...packet.body,remark:'reviewed'}},{source:{...packet.source,quotationRevision:6}}])assert.notEqual((await singleDocumentIdentity({...packet,...change},SINGLE_SENDER)).key,base.key);
  const noDefault=clone(packet);noDefault.body.jsonDocument[0].imagePage.msrpAgree=false;
  const changed=await singleDocumentIdentity(noDefault,SINGLE_SENDER);assert.equal(changed.bodySha256,base.bodySha256);assert.notEqual(changed.originalBodySha256,base.originalBodySha256);assert.notEqual(changed.key,base.key);
});

test('saved registered result is redacted after owner/session loss instead of leaking a cached receipt or completed flag',async()=>{
  const f=await singleDocumentFixture();
  try{
    const started=await f.receiver.start(f.packet,f.sender),registered=await f.receiver.confirm(f.packet,f.sender,f.action(started));assert.equal(registered.registered,true);
    const before=f.calls.filter(call=>call.name==='hubRequest').length;f.current=false;
    for(const action of ['start','resume','recover','observe']){
      const result=await f.receiver[action](f.packet,f.sender);assert.equal(result.state,'scope-blocked');assert.equal(result.registered,false);assert.equal(result.success,false);
      assert.equal(Object.hasOwn(result,'receipt'),false);assert.equal(Object.hasOwn(result,'docId'),false);assert.equal(Object.hasOwn(result,'identity'),false);
    }
    assert.equal(f.calls.filter(call=>call.name==='hubRequest').length,before);assert.equal(f.storage.get(f.context.key).state,'registered');f.assertPreserved();
  }finally{f.close();}
});

test('user confirmation cannot submit a same-doc form whose non-consent fields changed before or after reviewed checkbox acceptance',async()=>{
  for(const moment of ['before-confirm','after-consent']){
    const f=await singleDocumentFixture(SINGLE_COMPANIES[0],{before:async(name,input,fixture)=>{
      if(moment==='after-consent'&&name==='confirmAgreements')fixture.documents.get(input.docId).jsonDocument[0].productPage.supplyPrice=1;
    }});
    try{
      const started=await f.receiver.start(f.packet,f.sender);
      if(moment==='before-confirm')f.documents.get(started.docId).jsonDocument[0].productPage.supplyPrice=1;
      const result=await f.receiver.confirm(f.packet,f.sender,f.action(started));assert.equal(result.error.code,'READBACK_UNCONFIRMED');assert.equal(result.registered,false);assert.equal(f.submitted,0);
      assert.equal(f.calls.some(call=>call.name==='confirmAgreements'),moment==='after-consent');f.assertPreserved();
    }finally{f.close();}
  }
});

test('stored completion without document-bound receipt, complete steps or action-time human checkpoint is not trusted',async()=>{
  for(const patch of [{humanConfirmedAt:0},{validatedSteps:[]},{receipt:{state:'registered',evidence:'visible-text'}},{challenge:{id:'x',items:[]}}]){
    const f=await singleDocumentFixture();
    try{
      const started=await f.receiver.start(f.packet,f.sender);await f.receiver.confirm(f.packet,f.sender,f.action(started));
      const original=f.storage.get(f.context.key);f.storage.force(f.context.key,{...original,...patch});const count=f.calls.length;
      await assert.rejects(f.receiver.start(f.packet,f.sender),error=>error.code==='CHECKPOINT');assert.equal(f.calls.length,count);f.assertPreserved();
    }finally{f.close();}
  }
});

test('IndexedDB store uses a committed readwrite transaction for lane claim and exact snapshot CAS',async()=>{
  // Minimal transaction scheduler records the native IndexedDB contract. The
  // transport state-machine tests above use independent actual SQLite CAS.
  const rows=new Map(),transactions=[];
  const indexedDB={open:()=>{
    const request={};queueMicrotask(()=>{request.result={createObjectStore:()=>{},close:()=>{},transaction:(name,mode)=>{
      const tasks=[],tx={error:null,objectStore:()=>({
        get:key=>{const req={};tasks.push(()=>{req.result=clone(rows.get(key));req.onsuccess?.();});return req;},
        add:(value,key)=>{tasks.push(()=>{assert.equal(rows.has(key),false);rows.set(key,clone(value));});},
        put:(value,key)=>{tasks.push(()=>rows.set(key,clone(value)));},
      }),abort:()=>{tx.error=Error('aborted');tx.onabort?.();}};
      transactions.push({name,mode});setImmediate(()=>{while(tasks.length)tasks.shift()();tx.oncomplete?.();});return tx;
    }};request.onsuccess?.();});return request;
  }};
  const store=createSingleDocumentStore(indexedDB),context=await singleDocumentIdentity(singlePacket(),SINGLE_SENDER),base={laneKey:context.laneKey,state:'prepared',sequence:0};
  assert.equal(await store.claim(context.key,base),true);assert.equal(await store.claim(context.key,base),false);
  assert.equal(await store.claim('single-document:'+'e'.repeat(64),base),false);
  assert.equal(await store.compareAndSet(context.key,{...base,sequence:9},{...base,sequence:10}),false);
  assert.equal(await store.compareAndSet(context.key,base,{...base,sequence:1}),true);assert.deepEqual(await store.get(context.key),{...base,sequence:1});
  assert.deepEqual(transactions.map(item=>item.mode),['readwrite','readwrite','readwrite','readwrite','readwrite','readonly']);
  await assert.rejects(store.get('attempt:1'));
});
