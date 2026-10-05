import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const content=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
const options=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);
const product=h=>h.sqlite.prepare('SELECT * FROM products').get();
const snapshot=h=>JSON.stringify({product:product(h),content:content(h),options:options(h)});

// Recorded supplier facts, real API/SQLite; deliberately incomplete AI output is
// controlled here. It is not a claim that the production model returned this draft.
for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}]){
 test(`partial source translation becomes a reviewable draft without extra model calls (${company.companyCode})`,async()=>{
  const h=mobileIntakeHarness(company);
  try{
   h.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run();
   const generate=h.bindings.AI.run;
   h.bindings.AI.run=async(...args)=>{const result=await generate(...args);result.response.attributes=result.response.attributes.slice(0,24);return result;};
   const contextBefore=h.sqlite.prepare('SELECT payload FROM collection_context').get().payload;
   const message=await h.intake();
   assert.match(message,/검토 필요/);assert.doesNotMatch(message,/SEO·옵션 초안을 생성해 반영했습니다/);
   assert.equal(h.aiSources.length,1,'a usable partial response must not launch another option generation');
   assert.equal(h.aiSources[0].attributes.length,42);
   assert.equal(content(h).seo.title.value,'검토 브랜드 우드 패턴 다리 선글라스');
   assert.equal(content(h).categoryAttributes.values.length,24);
   assert.equal(options(h).rows.length,6);
   assert.ok(options(h).rows.every(row=>row.provenance.translatedName!=='translated'&&row.provenance.color!=='translated'&&row.provenance.size!=='translated'));
   assert.equal(h.objects.size,19);assert.equal(h.stats.maxDownloads,3);
   assert.ok(content(h).assets.main.value.length>0);assert.equal(content(h).assets.detail.value.length,11);
   assert.equal(product(h).supplier_hub_status,'미전송');assert.equal(product(h).image_status,'대기');
   const savedJob=h.sqlite.prepare("SELECT * FROM translation_jobs WHERE idempotency_key='intake-auto-v1'").get();
   assert.equal(savedJob.status,'completed');assert.equal(JSON.parse(savedJob.result).draft.attributes.length,24);
   assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context').get().payload,contextBefore);
   const quote=await (await h.route(`/api/products/${product(h).id}/quotation-fields`)).json();
   assert.equal(quote.resolved.rows[0].fields.supplyPrice.value,'4260');

   let response=await h.route(`/api/products/${product(h).id}/content`,{method:'PATCH',body:{expectedRevision:content(h).revision,patch:{seo:{title:'',description:'',keywords:[]},label:{material:''},labelClears:['material']}}});
   assert.equal(response.status,200,await response.clone().text());
   const edited=h.load('app/product-options.ts').optionInputs(options(h));edited[0].included=false;edited[1].translatedName='직접 확인한 옵션명';
   response=await h.route(`/api/products/${product(h).id}/options`,{method:'PATCH',body:{expectedRevision:options(h).revision,expectedProductVersion:product(h).updated_at,rows:edited}});
   assert.equal(response.status,200,await response.clone().text());
   const before=snapshot(h),retry=await h.intake();
   assert.match(retry,/검토 필요/);assert.equal(h.aiSources.length,1);assert.equal(snapshot(h),before);
   assert.equal(content(h).seo.title.provenance,'manual');assert.equal(content(h).seo.keywords.provenance,'manual');
   assert.equal(options(h).rows[0].included,false);assert.equal(options(h).rows[1].translatedName,'직접 확인한 옵션명');
   assert.equal(h.sqlite.prepare("SELECT result FROM translation_jobs WHERE id=?").get(savedJob.id).result,savedJob.result);
  }finally{h.close();}
 });
}

test('partial draft requires a confirmed apply or preview before becoming reviewable; lost acknowledgement reuses the result',async()=>{
 const h=mobileIntakeHarness();
 try{
  h.sqlite.prepare("UPDATE collection_jobs SET goal='collect'").run();await h.intake();
  const generate=h.bindings.AI.run;h.bindings.AI.run=async(...args)=>{const result=await generate(...args);result.response.attributes=result.response.attributes.slice(0,24);return result;};
  const prepare=h.load('app/intake-seo.ts').prepareIntakeSeoOutcome,id=product(h).id;
  let lose=true;
  const fetcher=async(path,init)=>{
   const response=await h.route(path,{method:init?.method??'GET',body:init?.body});
   if(lose&&path.endsWith('/translation-apply')&&JSON.parse(init.body).action==='apply'){lose=false;throw Error('시험 저장 응답 유실');}
   return response;
  };
  const uncertain=await prepare(id,fetcher,new AbortController().signal);
  assert.equal(uncertain.completed,false);assert.equal(uncertain.reviewRequired,false);assert.match(uncertain.message,/시험 저장 응답 유실/);
  const saved=snapshot(h),recovered=await prepare(id,fetcher,new AbortController().signal);
  assert.equal(recovered.completed,false);assert.equal(recovered.reviewRequired,true);assert.match(recovered.message,/검토 필요/);
  assert.equal(snapshot(h),saved);assert.equal(h.aiSources.length,1);
 }finally{h.close();}
});
