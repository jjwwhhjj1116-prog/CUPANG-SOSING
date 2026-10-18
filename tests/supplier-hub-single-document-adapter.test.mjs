import test from 'node:test';
import assert from 'node:assert/strict';
import {singleBrowserFixture} from './helpers/supplier-hub-single-document-adapter.mjs';
import {SINGLE_COMPANIES} from './helpers/supplier-hub-single-document.mjs';

for(const company of SINGLE_COMPANIES){
  test(company.name+' modal and next-step clicks may close the verified company menu without losing the owned document',async()=>{
    const f=await singleBrowserFixture(company,{companyMenuCloses:true});
    try{
      const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'awaiting-consent',JSON.stringify(result));
      assert.deepEqual(f.loaderRequests,[f.createdDocId]);assert.equal(f.nextClicks,4);assert.equal(f.submitted,0);assert.equal(f.checkboxClicks,0);
      assert.deepEqual(f.documents.get('protected-previous'),f.prior);
    }finally{f.close();}
  });
  test(company.name+' concrete serialized tab adapter reads fresh package and sends exact create/update/2..5 without automatic agreement or false receipt',async()=>{
    const f=await singleBrowserFixture(company);
    try{
      const started=await f.receiver.start(f.packet,f.sender);assert.equal(started.state,'awaiting-consent',JSON.stringify(started.error));assert.equal(f.submitted,0);assert.deepEqual(f.selected,[f.createdDocId]);
      assert.ok(f.calls.filter(call=>call.name==='app-fetch').every(call=>call.init.method==='GET'&&call.init.credentials==='same-origin'&&call.init.redirect==='error'));
      const remote=f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST');assert.equal(remote.length,6);
      assert.deepEqual(remote.map(call=>new URL(call.url).pathname),['/sr/draft/api/create','/sr/draft/api/update',...[2,3,4,5].map(step=>'/sr/qvt/api/validate-step/'+step)]);
      for(const call of remote){assert.equal(call.init.credentials,'include');assert.equal(call.init.redirect,'error');assert.equal(Object.hasOwn(call.init.headers,'authorization'),false);assert.equal(Object.hasOwn(call.init.headers,'cookie'),false);}
      const body=JSON.parse(remote[0].init.body);assert.equal(body.jsonDocument[0].imagePage.msrpAgree,false);assert.equal(f.packet.body.jsonDocument[0].imagePage.msrpAgree,true);
      assert.equal(f.calls.filter(call=>call.name==='tabs-update').length,1);assert.ok(f.calls.filter(call=>call.name==='execute').every(call=>JSON.stringify(call.target.frameIds)==='[0]'||call.target.documentIds?.length===1));
      assert.deepEqual(f.loaderRequests,[f.createdDocId]);assert.equal(f.ownDocumentReadsDuringLoad,0);assert.ok(Object.values(f.webRequest).every(event=>event.loadSize===0));
      const submitted=await f.receiver.confirm(f.packet,f.sender,f.action(started));assert.equal(f.submitted,1);assert.equal(submitted.state,'submit-requested');assert.equal(submitted.registered,false);assert.equal(submitted.error.code,'RECEIPT_UNCONFIRMED');
      await f.receiver.observe(f.packet,f.sender);assert.equal(f.submitted,1);assert.deepEqual(f.documents.get('protected-previous'),f.prior);
    }finally{f.close();}
  });

  test(company.name+' metadata-only draft list reads the owned document through shipped get-by-id contract',async()=>{
    const f=await singleBrowserFixture(company,{fullDocuments:false});
    try{
      const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'awaiting-consent',JSON.stringify(result.error));assert.equal(result.registered,false);
      const reads=f.calls.filter(call=>call.name==='hub-fetch'&&new URL(call.url).pathname.includes('/get-by-id/'));
      assert.ok(reads.length>=1);assert.ok(reads.every(call=>call.init.method==='GET'&&call.url.endsWith('/'+f.createdDocId)));
      assert.equal(reads.some(call=>call.url.endsWith('/protected-previous')),false);
      assert.equal(f.submitted,0);assert.deepEqual(f.documents.get('protected-previous'),f.prior);
    }finally{f.close();}
  });

  test(company.name+' Chrome reply loss recovers only actual in-tab ACK marker plus current full GET body; no repeat create',async()=>{
    const options={loseExecuteAck:'singleDocumentHubRequestPage',losePath:'/sr/draft/api/create'},f=await singleBrowserFixture(company,options);
    try{
      const pending=await f.receiver.start(f.packet,f.sender);assert.equal(pending.state,'create-requested');assert.equal(pending.needsRecovery,true);
      const before=f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').length;
      const recovered=await f.receiver.recover(f.packet,f.sender);assert.equal(recovered.state,'created');assert.equal(f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').length,before);
      options.loseExecuteAck=null;const resumed=await f.receiver.resume(f.packet,f.sender);assert.equal(resumed.state,'awaiting-consent');
      assert.equal(f.calls.filter(call=>call.name==='hub-fetch'&&call.url.endsWith('/create')).length,1);assert.deepEqual(f.documents.get('protected-previous'),f.prior);
    }finally{f.close();}
  });
}

test('fresh app GET rejects unprepared package, wrong source/body/schema/owner and HTML without any Hub write',async()=>{
  for(const options of [{packageView:{prepared:false}},{packageView:{fingerprint:'d'.repeat(64)}},{packageView:{schemaSha256:'e'.repeat(64)}},{appContentType:'text/html'},{bridge:{sessionId:'bad epoch'}},{beforeAppFetch:async(url,init,f)=>{if(url.includes('/supplier-hub-single-package'))f.ownerId='another-owner';}}]){
    const f=await singleBrowserFixture(SINGLE_COMPANIES[0],options);
    try{const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.registered,false);assert.equal(result.state,'scope-blocked');assert.equal(f.calls.some(call=>call.name==='hub-fetch'),false);assert.deepEqual(f.documents.get('protected-previous'),f.prior);}finally{f.close();}
  }
});

test('fresh package mismatch with a different option document cannot use a prepared packet supplied by the caller',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{beforeAppFetch:async(url,init,fixture)=>{
    if(url.includes('/supplier-hub-single-package'))fixture.packet.body.jsonDocument[0].productPage.supplyPrice=1;
  }});
  try{const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.error.code,'SOURCE_CHANGED');assert.equal(f.calls.some(call=>call.name==='hub-fetch'),false);}finally{f.close();}
});

test('public rows without a DOM docId load only the new owned document through exact Chrome observation',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{hideRowIdentity:true});
  try{const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'awaiting-consent',JSON.stringify(result.error));assert.equal(result.registered,false);assert.deepEqual(f.selected,[f.createdDocId]);assert.deepEqual(f.loaderRequests,[f.createdDocId]);assert.equal(f.submitted,0);assert.ok(Object.values(f.webRequest).every(event=>event.loadSize===0));assert.deepEqual(f.documents.get('protected-previous'),f.prior);}finally{f.close();}
});

test('wrong loader document, cached response or redirect cannot advance after the read-only selection',async()=>{
  for(const options of [{wrongLoaderId:987654321},{loaderCache:true},{loaderRedirect:true},{loaderError:true},{loaderStatus:403},{loaderContentType:'text/html'}]){
    const f=await singleBrowserFixture(SINGLE_COMPANIES[0],options);
    try{
      const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'navigation-requested',JSON.stringify(result));assert.equal(result.registered,false);
      assert.equal(f.nextClicks,0);assert.equal(f.checkboxClicks,0);assert.equal(f.submitted,0);assert.equal(f.loaded===f.createdDocId||options.wrongLoaderId!==undefined,true);
      assert.ok(Object.values(f.webRequest).every(event=>event.loadSize===0));assert.deepEqual(f.documents.get('protected-previous'),f.prior);
      const record=JSON.parse(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords)[f.context.packetDigest];assert.equal(record.loadedDocId,undefined);
    }finally{f.close();}
  }
});

test('changed complete API snapshot or ambiguous minute-level display tuple never clicks a document row',async()=>{
  const stale={draftList:(list,f)=>f.modal?list.map(row=>row.docId===f.createdDocId?{...row,modifiedAt:new Date(f.now+60000).toISOString()}:row):list};
  for(const options of [stale,{ambiguousRow:true}]){
    const f=await singleBrowserFixture(SINGLE_COMPANIES[0],options);
    try{const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'navigation-requested',JSON.stringify(result));assert.deepEqual(f.selected,[]);assert.deepEqual(f.loaderRequests,[]);assert.equal(f.nextClicks,0);assert.equal(f.submitted,0);assert.ok(Object.values(f.webRequest).every(event=>event.loadSize===0));assert.deepEqual(f.documents.get('protected-previous'),f.prior);}finally{f.close();}
  }
});

test('known unchecked MSRP consent halts at product page even without the HTML required flag',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{intermediateAgreementUnchecked:true});
  try{
    const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'navigation-requested',JSON.stringify(result));assert.equal(result.registered,false);
    assert.deepEqual(f.selected,[f.createdDocId]);assert.equal(f.hubLocation.pathname,'/sr/registration/step/productPage');assert.equal(f.nextClicks,1);
    assert.equal(f.intermediateAgreement.required,false);assert.equal(f.intermediateAgreement.checked,false);assert.equal(f.checkboxClicks,0);assert.equal(f.submitted,0);
    assert.ok(Object.values(f.webRequest).every(event=>event.loadSize===0));assert.deepEqual(f.documents.get('protected-previous'),f.prior);
  }finally{f.close();}
});

test('company header changing after the menu closes cannot nominate or load any row',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{companyMenuCloses:true,companyChangeAfterModal:true});
  try{
    const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'navigation-requested',JSON.stringify(result));assert.equal(result.registered,false);
    assert.deepEqual(f.selected,[]);assert.equal(f.nextClicks,0);assert.equal(f.checkboxClicks,0);assert.equal(f.submitted,0);assert.deepEqual(f.documents.get('protected-previous'),f.prior);
  }finally{f.close();}
});


test('new document price or schema revision changed after the UI GET cannot advance or mark the page loaded',async()=>{
  for(const mutate of [document=>{document.jsonDocument[0].productPage.supplyPrice+=1;},document=>{document.version+=1;}]){
    const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{documentRead:(document,fixture)=>{
      if(fixture.loaderRequests.length>0){mutate(document);fixture.documents.set(fixture.createdDocId,structuredClone(document));}
      return document;
    }});
    try{
      const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'navigation-requested',JSON.stringify(result));assert.equal(result.error.code,'READBACK_UNCONFIRMED');
      assert.deepEqual(f.selected,[f.createdDocId]);assert.deepEqual(f.loaderRequests,[f.createdDocId]);assert.equal(f.nextClicks,0);assert.equal(f.checkboxClicks,0);assert.equal(f.submitted,0);
      const record=JSON.parse(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords)[f.context.packetDigest];assert.equal(record.loadedDocId,undefined);
      assert.ok(Object.values(f.webRequest).every(event=>event.loadSize===0));assert.deepEqual(f.documents.get('protected-previous'),f.prior);
    }finally{f.close();}
  }
});

test('browser document replacement during the read-only loader blocks continuation in the replacement document',async()=>{
  const replacement='99999999-1111-4222-8333-444444444444';
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{beforeHubFetch:(url,init,fixture)=>{
    if(fixture.loaderRequests.length>0&&url.includes('/get-by-id/'))fixture.hubDocumentId=replacement;
  }});
  try{
    const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'scope-blocked',JSON.stringify(result));assert.equal(result.error.code,'TAB_CHANGED');assert.equal(result.registered,false);
    assert.deepEqual(f.selected,[f.createdDocId]);assert.equal(f.hubDocumentId,replacement);assert.equal(f.nextClicks,0);assert.equal(f.checkboxClicks,0);assert.equal(f.submitted,0);
    const record=JSON.parse(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords)[f.context.packetDigest];assert.equal(record.loadedDocId,undefined);
    assert.ok(Object.values(f.webRequest).every(event=>event.loadSize===0));assert.deepEqual(f.documents.get('protected-previous'),f.prior);
  }finally{f.close();}
});

test('a populated user Hub form is preserved and blocked before create request',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{dirtyHub:true});
  try{const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'create-requested');assert.equal(f.calls.some(call=>call.name==='hub-fetch'&&call.init.method==='POST'),false);assert.equal(f.submitted,0);assert.deepEqual(f.documents.get('protected-previous'),f.prior);}finally{f.close();}
});

test('existing same-window Hub tabs are not candidates and wrong frames still fail closed',async()=>{
  const extraTabs=[{id:72,windowId:29,url:'https://supplier.coupang.com/dashboard/KR',status:'complete'},{id:73,windowId:29,url:'https://supplier.coupang.com/sr/registration/step/productPage',status:'complete'}];
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{extraTabs});
  try{const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'awaiting-consent');assert.equal(result.registered,false);
    assert.deepEqual(f.tabs.filter(tab=>[72,73].includes(tab.id)),extraTabs);assert.equal(f.calls.some(call=>call.name==='tabs-query'),false);
    assert.equal(f.calls.some(call=>call.name==='execute'&&[72,73].includes(call.target.tabId)||call.name==='tabs-update'&&[72,73].includes(call.id)),false);
  }finally{f.close();}
  const invalid=await singleBrowserFixture(SINGLE_COMPANIES[0],{frameId:1});
  try{const result=await invalid.receiver.start(invalid.packet,invalid.sender);assert.equal(result.registered,false);assert.equal(invalid.calls.some(call=>call.name==='hub-fetch'),false);assert.equal(invalid.calls.some(call=>call.name==='tabs-update'),false);}finally{invalid.close();}
});

test('trusted action-time app confirmation is required before concrete checkbox clicks and final submit',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{human:false});
  try{const started=await f.receiver.start(f.packet,f.sender);assert.equal(started.state,'awaiting-consent');const result=await f.receiver.confirm(f.packet,f.sender,f.action(started));assert.equal(result.error.code,'HUMAN_CONFIRMATION');assert.equal(f.submitted,0);assert.equal(JSON.parse(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords)[f.context.packetDigest].confirmedChallengeId,undefined);}finally{f.close();}
});

test('get-by-id rejects wrong document, unknown status, wrappers, incomplete body and non-JSON errors before loading any row',async()=>{
  const changes=[
    document=>({...document,docId:'protected-previous'}),
    document=>({...document,status:'SUBMITTED'}),
    document=>({...document,status:'UNKNOWN'}),
    document=>({code:200,data:document}),
    document=>[document],
    document=>({...document,jsonDocument:[]}),
    document=>({...document,scope:'Retail_Uncategorized_Single'}),
    document=>({...document,version:document.version+1}),
    document=>{const copy=structuredClone(document);copy.jsonDocument[0].productPage.supplyPrice=123456;return copy;},
  ];
  for(const documentRead of changes){
    const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{fullDocuments:false,documentRead});
    try{
      const result=await f.receiver.start(f.packet,f.sender);
      assert.equal(result.state,'update-requested');assert.equal(result.error.code,'READBACK_UNCONFIRMED');
      assert.equal(result.registered,false);assert.deepEqual(f.selected,[]);assert.equal(f.submitted,0);
      assert.equal(f.calls.some(call=>call.name==='tabs-update'),false);assert.deepEqual(f.documents.get('protected-previous'),f.prior);
    }finally{f.close();}
  }
  for(const options of [{documentStatus:403},{documentContentType:'text/html'}]){
    const f=await singleBrowserFixture(SINGLE_COMPANIES[0],options);
    try{const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'update-requested');assert.equal(result.registered,false);assert.deepEqual(f.selected,[]);assert.equal(f.submitted,0);}finally{f.close();}
  }
});

test('lost update acknowledgement is recovered only with its exact owned get-by-id body and does not repeat a POST',async()=>{
  const options={fullDocuments:false,loseExecuteAck:'singleDocumentHubRequestPage',losePath:'/sr/draft/api/update'},f=await singleBrowserFixture(SINGLE_COMPANIES[1],options);
  try{
    const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'update-requested');assert.equal(result.needsRecovery,true);
    const writes=f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').length;
    const recovered=await f.receiver.recover(f.packet,f.sender);assert.equal(recovered.state,'updated');assert.equal(recovered.registered,false);
    assert.equal(f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').length,writes);
    assert.deepEqual(f.documents.get('protected-previous'),f.prior);assert.deepEqual(f.selected,[]);
  }finally{f.close();}
});

test('a caller cannot use get-by-id to read another existing draft through the page adapter',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0]);
  try{
    await f.receiver.start(f.packet,f.sender);
    const before=f.calls.filter(call=>call.name==='hub-fetch').length;
    await assert.rejects(()=>f.adapter.hubRequest({identity:f.context.identity,sessionId:f.sessionId,tab:{tabId:71},method:'GET',path:'/sr/draft/api/get-by-id/protected-previous'}),error=>error.code==='TAB_CHANGED');
    assert.equal(f.calls.filter(call=>call.name==='hub-fetch').length,before);assert.deepEqual(f.documents.get('protected-previous'),f.prior);
  }finally{f.close();}
});
