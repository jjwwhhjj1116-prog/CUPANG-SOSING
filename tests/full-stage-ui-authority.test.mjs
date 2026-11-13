import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {stageDOM,repo} from './helpers/cold-price-main-dom.mjs';
const {mobileIntakeHarness}=await import(pathToFileURL(path.join(repo,'tests/helpers/mobile-intake.mjs')).href);
const hold=()=>{let resolve;return{promise:new Promise(done=>resolve=done),resolve:()=>resolve()};};
async function fixture(){const api=mobileIntakeHarness();await api.intake();const product=await api.load('db/queries.ts').findProduct('owner',api.latest.product_id);return{api,product,base:'/api/products/'+product.id,scope:{ownerId:'owner',company:{code:'A01464742',name:'와이홉'},productId:product.id,productVersion:product.updated_at,sourceUrl:product.source_url,settingsEpoch:0,profileEpoch:0,profileId:null,refresh:0}};}

test('two real UI mutation leases cannot let the newer ACK release an older unresolved source write',async()=>{
 const f=await fixture(),h=await stageDOM(()=>assert.fail('explicit factory transport'));try{
  const {createRegistrationUiReads}=h.load('app/registration-ui-reads.tsx'),reads=createRegistrationUiReads(f.scope,new Set(),url=>f.api.route(url));await reads.options();const older=reads.beginMutation(),newer=reads.beginMutation();newer.confirm();await assert.rejects(reads.options(),/저장 상태/,'older source write remains unresolved');older.confirm();assert.equal((await reads.options()).options.productId,f.product.id);
 }finally{await h.close();f.api.close();}
});

test('one sealed explicit-profile episode also retains an independent genuine queryless response without URL aliasing',async()=>{
 const f=await fixture(),h=await stageDOM(()=>assert.fail('explicit factory transport'));try{
  const profile=await f.api.load('db/category-profiles.ts').createCategoryProfile('owner',{...f.api.context.category,template:null},f.api.context.category.id),calls=[],{createRegistrationUiReads}=h.load('app/registration-ui-reads.tsx'),reads=createRegistrationUiReads({...f.scope,profileId:profile.id},new Set(),url=>{calls.push(url);return f.api.route(url);}),plain=f.base+'/quotation-fields',selected=plain+'?profileId='+profile.id;
  const a=await reads.quotation(plain),b=await reads.quotation(selected);await reads.quotation(plain);await reads.quotation(selected);assert.deepEqual(calls,[plain,selected]);assert.notEqual(a.inputFingerprint,b.inputFingerprint);assert.notEqual(a.categoryContext.source,b.categoryContext.source);await assert.rejects(reads.quotation(plain+'?profileId=foreign-profile'),/저장 상태/);
 }finally{await h.close();f.api.close();}
});

test('an unresolved writer holds the same drawer across manual profile A→B→A until its own positive completion',async()=>{
 const f=await fixture(),h=await stageDOM(url=>f.api.route(url));let reads;try{
  const {usePriceMainUiReads}=h.load('app/registration-ui-reads.tsx');function Probe({scope}){reads=usePriceMainUiReads(scope);return null;}
  await h.render(Probe,{scope:f.scope});const old=reads,lease=reads.beginMutation();await h.render(Probe,{scope:{...f.scope,profileId:'different-profile',profileEpoch:1}});await assert.rejects(reads.options(),/저장 상태/);await h.render(Probe,{scope:f.scope});await assert.rejects(reads.options(),/저장 상태/);lease.confirm();assert.equal((await reads.options()).options.productId,f.product.id);await assert.rejects(old.options(),/저장 상태/);
 }finally{await h.close();f.api.close();}
});

test('control: zero subscribers during a pure handoff do not lose the in-flight same-episode full DTO',async()=>{
 const f=await fixture(),gate=hold(),calls=[],h=await stageDOM(()=>assert.fail('explicit factory transport'));try{
  const {createRegistrationUiReads}=h.load('app/registration-ui-reads.tsx'),reads=createRegistrationUiReads(f.scope,new Set(),async(url,init)=>{calls.push(init);const response=await f.api.route(url);await gate.promise;return response;}),a=new AbortController(),first=reads.content(a.signal),cancelled=assert.rejects(first,{name:'AbortError'});a.abort();await cancelled;await h.settle();const second=reads.content();assert.equal(calls.length,1);assert.equal(calls[0].signal.aborted,false);gate.resolve();assert.equal((await second).content.productId,f.product.id);
 }finally{gate.resolve();await h.close();f.api.close();}
});

test('focus invalidation discards only the earlier label snapshot, including an in-flight response',async()=>{
 const f=await fixture(),first=hold(),calls=[];
 const label=f.base+'/product-labels',quote=f.base+'/quotation-fields';
 const h=await stageDOM(async url=>{
  calls.push(url);
  const response=await f.api.route(url);
  if(url===label&&calls.filter(path=>path===label).length===1)await first.promise;
  return response;
 });
 let reads;
 try{
  const {usePriceMainUiReads}=h.load('app/registration-ui-reads.tsx');
  function Probe(){reads=usePriceMainUiReads(f.scope);return null;}
  await h.render(Probe,{});
  await reads.quotation(quote);
  const initial=reads.productLabels(label);
  const discarded=assert.rejects(initial,/저장 상태/);
  assert.equal(reads.hasProductLabels(label),true);
  reads.forgetProductLabels();
  assert.equal(reads.hasProductLabels(label),false);
  const current=await reads.productLabels(label);
  assert.equal(current.productId,f.product.id);
  first.resolve();
  await discarded;
  await reads.quotation(quote);
  assert.deepEqual(calls,[quote,label,label]);
 }finally{first.resolve();await h.close();f.api.close();}
});
