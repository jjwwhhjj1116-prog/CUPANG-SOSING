import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';

const model=providedOptionModule('app/supplier-hub-product-receipt.ts'),exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/supplier-hub-native-registration.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,Date,AbortController,setTimeout,clearTimeout,
  require(name){if(name==='@/app/supplier-hub-product-receipt')return model;return{};}});
const copy=value=>JSON.parse(JSON.stringify(value)),hash='a'.repeat(64),requestId='75200000-0000-4000-8000-000000000001';
function fixture(company={code:'A01526306',name:'유앤채'}){
  const now=Date.now(),source={productVersion:new Date(now-1000).toISOString(),contentRevision:1,optionRevision:2,quotationRevision:3,profileRevision:1},
    members=[{optionId:'one',optionLabel:'첫째',documentIndex:0},{optionId:'two',optionLabel:'둘째',documentIndex:1}],logical={
      productId:'synthetic-752',profileId:'profile',requestedProfileId:'profile',categoryId:'81452',fingerprint:hash,inputFingerprint:hash,schemaSha256:hash,source,company,members};
  const record={format:'yoofam-product-document-receipt-v1',recordType:'product-document',evidence:'chrome-observation',...logical,requestId,docId:7521,
    identity:{origin:'https://sourceflow.jjwwhhjj1116.workers.dev',appTabId:71,windowId:4,ownerId:'owner',accountContext:hash,...logical},
    identityDigest:hash,packetDigest:hash,preparedBodySha256:hash,originalBodySha256:hash,
    receipt:{state:'accepted',docId:7521,company,identityDigest:hash,preparedBodySha256:hash,observedAt:now-500,receiptId:7522,qvtRequestId:7522,sourceStatus:'FINISHED',evidence:'document-receipt',registered:false},
    registered:false,recordedAt:new Date(now).toISOString()};
  model.parseStoredProductReceipt(record);
  const observed={source:'supplier-hub-native-registration-v1',ownerId:'owner',company,productId:record.productId,requestId,docId:record.docId,qvtRequestId:7522,
    categoryId:'81452',membersCount:2,identityDigest:hash,preparedBodySha256:hash,observedAt:now,rows:[
      {quotationId:'75200000-0000-4000-8000-000000000003',skuId:'752001',productName:'둘째',status:'INSPECTION_COMPLETE'},
      {quotationId:'75200000-0000-4000-8000-000000000003',skuId:null,productName:'첫째',status:'INSPECTION'}],total:2,pagesRead:1,registered:false,mutated:false,optionMapping:'unverified'};
  const calls=[],deps={catalog:async()=>{calls.push('catalog');return{ownerId:'owner',company};},history:async()=>{calls.push('history');return[copy(record)];},
    bridge:async(type,payload)=>{calls.push({type,payload});return type==='PING'?{nativeRegistrationStatus:true}:{ok:true,observation:copy(observed)};}};
  return{record,observed,calls,deps};
}

for(const company of [{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}])test(`${company.code} native lookup binds saved request and returns aggregate evidence without option-order inference`,async()=>{
  const f=fixture(company),value=await exports.readSupplierHubNativeRegistration(f.record,new AbortController().signal,f.deps);
  assert.deepEqual(copy(value),f.observed);assert.equal(value.rows[0].productName,'둘째');assert.equal(value.rows[1].skuId,null);
  assert.equal(value.registered,false);assert.equal(value.optionMapping,'unverified');assert.ok(Object.isFrozen(value.rows[0]));
  assert.deepEqual(f.calls.filter(call=>typeof call==='object').map(call=>call.type),['PING','NATIVE_REGISTRATIONS']);
  assert.deepEqual(copy(f.calls.filter(call=>typeof call==='object')[1].payload),{productId:f.record.productId,requestId,identityDigest:hash,preparedBodySha256:hash});
  assert.equal(f.calls.filter(call=>call==='catalog').length,2);assert.equal(f.calls.filter(call=>call==='history').length,2);
});

test('native response never accepts request/quotation aliases, changed actor/body/cardinality or inferred option mapping',()=>{
  const f=fixture(),mutations=[v=>v.qvtRequestId='7522',v=>v.qvtRequestId='CID-synthetic-752',v=>v.docId='7521',v=>v.ownerId='other',v=>v.company.name='other',
    v=>v.productId='other',v=>v.requestId='75200000-0000-4000-8000-000000000002',v=>v.categoryId='80719',v=>v.membersCount=1,v=>v.identityDigest='b'.repeat(64),
    v=>v.preparedBodySha256='b'.repeat(64),v=>v.optionMapping='document-order',v=>v.registered=true,v=>v.mutated=true,v=>v.observedAt=Date.now()+60000,
    v=>v.observedAt=f.record.receipt.observedAt-1,v=>v.total=3,v=>v.pagesRead=0,v=>v.pagesRead=41,v=>v.rows[1].skuId='752001',v=>v.rows[1]=copy(v.rows[0]),
    v=>v.rows[0].quotationId='CID-synthetic-752',v=>v.rows[0].quotationId='CID-'+v.rows[0].quotationId,v=>v.rows[0].productName=' 상품 ',
    v=>v.rows[0].status='FINISHED',v=>v.rows[0].skuId=752001,v=>v.rows[0].skuId='0752001',v=>v.rows[0].productName='',v=>v.rows[0].optionId='one',v=>v.extra=true];
  for(const change of mutations){const value=copy(f.observed);change(value);assert.throws(()=>exports.validateNativeRegistrationObservation(value,f.record));}
  const empty={...copy(f.observed),total:0,rows:[]};assert.equal(exports.validateNativeRegistrationObservation(empty,f.record).total,0);
});

test('unknown/corrupt receipts, unavailable capability and stored history mismatch cannot request WIMS',async()=>{
  for(const mode of ['capability','history-missing','history-duplicate','history-changed','actor']){
    const f=fixture();if(mode==='capability')f.deps.bridge=async(type)=>{f.calls.push({type});return{nativeRegistrationStatus:false};};
    if(mode==='history-missing')f.deps.history=async()=>[];
    if(mode==='history-duplicate')f.deps.history=async()=>[copy(f.record),copy(f.record)];
    if(mode==='history-changed')f.deps.history=async()=>[{...copy(f.record),recordedAt:new Date(Date.now()+1).toISOString()}];
    if(mode==='actor')f.deps.catalog=async()=>({ownerId:'other',company:f.record.company});
    await assert.rejects(exports.readSupplierHubNativeRegistration(f.record,new AbortController().signal,f.deps));
    assert.ok(!f.calls.some(call=>call?.type==='NATIVE_REGISTRATIONS'),mode);
  }
});

test('held lookup rejects changed history or company after a valid response, and never saves a receipt',async()=>{
  for(const mode of ['history','company']){
    const f=fixture();let historyReads=0,actorReads=0;
    f.deps.history=async()=>++historyReads===2&&mode==='history'?[]:[copy(f.record)];
    f.deps.catalog=async()=>({ownerId:++actorReads===2&&mode==='company'?'other':'owner',company:f.record.company});
    await assert.rejects(exports.readSupplierHubNativeRegistration(f.record,new AbortController().signal,f.deps));
    assert.equal(f.calls.filter(call=>call?.type==='NATIVE_REGISTRATIONS').length,1);
  }
});

test('cancellation at a held capability response never starts the native query',async()=>{
  const f=fixture(),controller=new AbortController();let resolve;f.deps.bridge=type=>{f.calls.push({type});return new Promise(done=>{resolve=done;});};
  const task=exports.readSupplierHubNativeRegistration(f.record,controller.signal,f.deps);
  for(let i=0;i<30&&!resolve;i++)await new Promise(done=>setImmediate(done));assert.ok(resolve);controller.abort();resolve({nativeRegistrationStatus:true});
  await assert.rejects(task);assert.equal(f.calls.length,3);assert.equal(f.calls.filter(call=>call?.type==='NATIVE_REGISTRATIONS').length,0);
});
