import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeReviewFixture,companies,json} from './helpers/native-source-review.mjs';

async function fixture(company=companies[0],alter){
 const f=await nativeReviewFixture(company),source=f.h.load('app/exports/quotation-source.ts'),read=source.readQuotationExportSource,fingerprint=source.quotationExportFingerprint;
 const counts={reads:0,fingerprints:0,active:0};
 source.readQuotationExportSource=async(...args)=>{const value=await read(...args);counts.reads++;alter?.(value,counts.reads);return value;};
 source.quotationExportFingerprint=async(...args)=>{counts.fingerprints++;return fingerprint(...args);};
 const api=f.h.load('app/api/products/[id]/native-assets/route.ts');
 return{...f,counts,get:()=>api.GET(new Request('https://app.test'+f.sourcePath),f.context)};
}

for(const company of companies)test(company.code+': identical full DTOs reuse only pure fingerprint calculation while current source and file guards still run',async()=>{
 const f=await fixture(company);try{
  const before=f.state(),objects=f.objectState(),response=await f.get(),plan=await json(response);
  assert.equal(plan.metadataValid,true);assert.equal(f.counts.fingerprints,1);assert.equal(f.counts.reads,3,'initial source and full current-source proofs before/after native bytes');
  const firstReads=f.counts.reads;await json(await f.get());assert.equal(f.counts.fingerprints,2,'another request must calculate its own initial fingerprint');assert.equal(f.counts.reads,firstReads+3);
  assert.equal(f.state(),before);assert.equal(f.objectState(),objects);
 }finally{f.close();}
});

test('same source clocks with changed full DTO content still use the original fingerprint and reject the change',async()=>{
 const f=await fixture(companies[0],(value,reads)=>{if(reads>1)value.content.seo.title='changed without changing any source clock';});try{
  const response=await f.get(),body=await response.json();assert.equal(response.status,409);assert.equal(body.code,'SINGLE_SOURCE_CHANGED');assert.ok(f.counts.fingerprints>1);
 }finally{f.close();}
});

test('a changed registration display number falls back to its equal original fingerprint and stays allowed',async()=>{
 const f=await fixture(companies[0],(value,reads)=>{if(reads>1)value.product.registration_number=987654;});try{
  assert.equal((await json(await f.get())).metadataValid,true);assert.equal(f.counts.fingerprints,3);assert.equal(f.counts.reads,3);
 }finally{f.close();}
});

test('undefined/null, numeric edge and marker-looking string values cannot collide in complete source keys',async()=>{
 for(const [initial,next,rejected]of [[undefined,null,false],[NaN,null,false],[-0,0,false],[undefined,'\u0000undefined',true]]){
  const f=await fixture(companies[0],(value,reads)=>{value.keyProbe=reads===1?initial:next;});try{
   const response=await f.get();assert.equal(response.status,rejected?409:200);assert.ok(f.counts.fingerprints>1,'different complete values must fall back even when their ordinary fingerprint happens to match');
  }finally{f.close();}
 }
});

test('custom inherited and accessor DTOs always keep the original fingerprint path',async()=>{
 for(const mode of ['prototype','accessor']){const f=await fixture(companies[0],value=>{if(mode==='prototype')Object.setPrototypeOf(value,Object.assign(Object.create(null),{inherited:'untrusted'}));else Object.defineProperty(value,'keyProbe',{get:()=>null,enumerable:true});});try{
  assert.equal((await json(await f.get())).metadataValid,true);assert.equal(f.counts.fingerprints,3);assert.equal(f.counts.reads,3);
 }finally{f.close();}}
});
