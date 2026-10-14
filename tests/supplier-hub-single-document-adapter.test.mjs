import test from 'node:test';
import assert from 'node:assert/strict';
import {singleBrowserFixture} from './helpers/supplier-hub-single-document-adapter.mjs';
import {SINGLE_COMPANIES} from './helpers/supplier-hub-single-document.mjs';

for(const company of SINGLE_COMPANIES){
  test(company.name+' concrete serialized tab adapter reads fresh package and sends exact create/update/2..5 without automatic agreement or false receipt',async()=>{
    const f=await singleBrowserFixture(company);
    try{
      const started=await f.receiver.start(f.packet,f.sender);assert.equal(started.state,'awaiting-consent',JSON.stringify(started.error));assert.equal(f.submitted,0);assert.deepEqual(f.selected,['created-'+company.code]);
      assert.ok(f.calls.filter(call=>call.name==='app-fetch').every(call=>call.init.method==='GET'&&call.init.credentials==='same-origin'&&call.init.redirect==='error'));
      const remote=f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST');assert.equal(remote.length,6);
      assert.deepEqual(remote.map(call=>new URL(call.url).pathname),['/sr/draft/api/create','/sr/draft/api/update',...[2,3,4,5].map(step=>'/sr/qvt/api/validate-step/'+step)]);
      for(const call of remote){assert.equal(call.init.credentials,'include');assert.equal(call.init.redirect,'error');assert.equal(Object.hasOwn(call.init.headers,'authorization'),false);assert.equal(Object.hasOwn(call.init.headers,'cookie'),false);}
      const body=JSON.parse(remote[0].init.body);assert.equal(body.jsonDocument[0].imagePage.msrpAgree,false);assert.equal(f.packet.body.jsonDocument[0].imagePage.msrpAgree,true);
      assert.equal(f.calls.filter(call=>call.name==='tabs-update').length,1);assert.ok(f.calls.filter(call=>call.name==='execute').every(call=>JSON.stringify(call.target.frameIds)==='[0]'));
      const submitted=await f.receiver.confirm(f.packet,f.sender,f.action(started));assert.equal(f.submitted,1);assert.equal(submitted.state,'submit-requested');assert.equal(submitted.registered,false);assert.equal(submitted.error.code,'RECEIPT_UNCONFIRMED');
      await f.receiver.observe(f.packet,f.sender);assert.equal(f.submitted,1);assert.deepEqual(f.documents.get('protected-previous'),f.prior);
    }finally{f.close();}
  });

  test(company.name+' metadata-only actual draft response blocks before navigation instead of inventing document contents',async()=>{
    const f=await singleBrowserFixture(company,{fullDocuments:false});
    try{
      const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'update-requested');assert.equal(result.registered,false);assert.equal(result.error.code,'READBACK_UNCONFIRMED');
      assert.equal(f.calls.some(call=>call.name==='tabs-update'),false);assert.deepEqual(f.selected,[]);assert.equal(f.submitted,0);assert.deepEqual(f.documents.get('protected-previous'),f.prior);
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

test('row identity absent never selects an API-position-matched existing draft',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{hideRowIdentity:true});
  try{const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'navigation-requested');assert.equal(result.registered,false);assert.deepEqual(f.selected,[]);assert.equal(f.submitted,0);assert.deepEqual(f.documents.get('protected-previous'),f.prior);}finally{f.close();}
});

test('a populated user Hub form is preserved and blocked before create request',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{dirtyHub:true});
  try{const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'create-requested');assert.equal(f.calls.some(call=>call.name==='hub-fetch'&&call.init.method==='POST'),false);assert.equal(f.submitted,0);assert.deepEqual(f.documents.get('protected-previous'),f.prior);}finally{f.close();}
});

test('same-window ambiguity or wrong frame cannot choose another Chrome profile/tab',async()=>{
  for(const options of [{extraTabs:[{id:72,windowId:29,url:'https://supplier.coupang.com/dashboard/KR',status:'complete'}]},{frameId:1}]){
    const f=await singleBrowserFixture(SINGLE_COMPANIES[0],options);
    try{const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.registered,false);assert.equal(f.calls.some(call=>call.name==='hub-fetch'),false);assert.equal(f.calls.some(call=>call.name==='tabs-update'),false);}finally{f.close();}
  }
});

test('trusted action-time app confirmation is required before concrete checkbox clicks and final submit',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{human:false});
  try{const started=await f.receiver.start(f.packet,f.sender);assert.equal(started.state,'awaiting-consent');const result=await f.receiver.confirm(f.packet,f.sender,f.action(started));assert.equal(result.error.code,'HUMAN_CONFIRMATION');assert.equal(f.submitted,0);assert.equal(JSON.parse(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords)[f.context.packetDigest].confirmedChallengeId,undefined);}finally{f.close();}
});
