import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {quotationAiApiFixture,companies,plain} from './helpers/quotation-ai-api.mjs';

const paths=['app/quotation-ai.ts','app/api/products/[id]/quotation-ai/route.ts','db/quotation-ai-jobs.ts'],sha=path=>createHash('sha256').update(fs.readFileSync(new URL('../'+path,import.meta.url))).digest('hex');
const frozen=Object.fromEntries(paths.map(path=>[path,sha(path)])),proofs=[];
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
async function seed(f,values,categoryId=f.profile.categoryId){
 const store=f.h.load('db/product-content.ts'),current=await store.readProductContent('owner',f.id);
 // Use the server-internal content store, as source translation does. The
 // public ContentPatch route deliberately cannot inject these reference facts.
 const next={...current,revision:current.revision+1,updatedAt:new Date(Date.now()+current.revision+1).toISOString(),
  categoryAttributes:{categoryId,jobId:'synthetic-translation-706',values}};
 assert.ok(await store.saveProductContent('owner',next,current.revision));return next;
}
const read=f=>f.request(undefined,'GET').then(response=>json(response));
const check=f=>{assert.deepEqual(f.h.network,[]);assert.equal(f.h.objects.size,0);assert.equal(f.h.aiSources.length,0);};
after(()=>{for(const[path,expected]of Object.entries(frozen))assert.equal(sha(path),expected);fs.writeFileSync(new URL('../outputs/step706-category-facts-api-proof.json',import.meta.url),JSON.stringify({sourceHashes:frozen,cases:proofs,
 boundary:'Actual owned API/session/SQLite job and source checks; synthetic source attributes and AI provider only. Fixture seeding uses internal content store.',
 allowedDatabaseMutation:'Synthetic fixture setup; generation writes quotation_ai_jobs and existing quotation_ai_daily quota only.',externalRequests:0,browserActions:0,operatingProductWrites:0,supplierHubWrites:0},null,2)+'\n');});

for(const company of companies)test(company.name+': actual quotation API sends current-category source facts and idempotently preserves the saved product',async()=>{
 const f=await quotationAiApiFixture(company);try{
  const values=[{name:'호환 기종',value:'전용기기-706A',sourceName:'상품속성: 适用机型'},{name:'결합 방식',value:'잠금식'}];await seed(f,values);
  const initial=await read(f),before=f.state(),body=f.requestBody(initial),out=await json(await f.request(body));
  assert.equal(out.job.status,'completed');assert.equal(out.job.applied,false);assert.equal(out.sourceCurrent,true);
  const calls=f.provider.calls.length;assert.ok(calls>=2);
  for(const call of f.provider.calls)assert.deepEqual(call.request.facts.attributes.filter(pair=>pair.provenance==='category-source-translation'),values.map(pair=>({...pair,provenance:'category-source-translation'})));
  const stored=JSON.parse(f.jobs()[0].review);assert.equal(stored.plan.facts.attributes.at(-2).value,'전용기기-706A');assert.deepEqual(plain(stored.company),company);
  const repeated=await json(await f.request(body));assert.equal(repeated.reused,true);assert.equal(repeated.job.id,out.job.id);assert.equal(f.provider.calls.length,calls);assert.equal(f.jobs().length,1);
  assert.equal(f.state(),before);check(f);proofs.push({company,kind:'current category',referenceFacts:2,providerCalls:calls,replayCalls:0,businessDataUnchanged:true});
 }finally{f.close();}
});

test('a changed saved source rejects the old review before the model; a fresh request receives the new reference without replacing the old result',async()=>{
 const f=await quotationAiApiFixture();try{
  await seed(f,[{name:'호환 기종',value:'전용기기-706A'}]);const first=await read(f),body=f.requestBody(first),out=await json(await f.request(body));
  const oldJob=plain(f.jobs()[0]),count=f.provider.calls.length;await seed(f,[{name:'호환 기종',value:'전용기기-706B'}]);const before=f.state();
  await json(await f.request(body),409);assert.equal(f.provider.calls.length,count);assert.deepEqual(plain(f.jobs()[0]),oldJob);
  const current=await read(f);assert.notEqual(current.fingerprint,first.fingerprint);const fresh=await json(await f.request(f.requestBody(current)));
  assert.notEqual(fresh.job.id,out.job.id);assert.ok(f.provider.calls.slice(count).every(call=>call.request.facts.attributes.some(pair=>pair.value==='전용기기-706B')));
  assert.ok(f.jobs().some(job=>JSON.stringify(plain(job))===JSON.stringify(oldJob)));assert.equal(f.state(),before);check(f);
  proofs.push({kind:'source revision',oldReviewRejectedBeforeProvider:true,explicitNewReviewUsesNewFacts:true,oldResultPreserved:true});
 }finally{f.close();}
});

test('foreign-category reference values never reach the actual provider',async()=>{
 const f=await quotationAiApiFixture();try{
  await seed(f,[{name:'다른 분류 속성',value:'다른분류-706C'}],'80719');const initial=await read(f),before=f.state();await json(await f.request(f.requestBody(initial)));
  assert.ok(f.provider.calls.length);assert.ok(f.provider.calls.every(call=>!JSON.stringify(call.request.facts).includes('다른분류-706C')));assert.equal(f.state(),before);check(f);
  proofs.push({kind:'foreign category',providerReceivesForeignCategory:false,businessDataUnchanged:true});
 }finally{f.close();}
});

test('malformed internal reference text cannot create an AI job or consume quota',async()=>{
 const f=await quotationAiApiFixture();try{
  await seed(f,[{name:'호환 기종',value:'bad\u0001'}]);const initial=await read(f),before=f.state(),out=await json(await f.request(f.requestBody(initial)),409);
  assert.equal(out.code,'AI_SOURCE');assert.equal(f.provider.calls.length,0);assert.equal(f.jobs().length,0);
  assert.equal(f.h.sqlite.prepare('SELECT SUM(requests) AS count FROM quotation_ai_daily').get().count,null);assert.equal(f.state(),before);check(f);
  proofs.push({kind:'malformed reference',providerCalls:0,jobs:0,quota:0,businessDataUnchanged:true});
 }finally{f.close();}
});
