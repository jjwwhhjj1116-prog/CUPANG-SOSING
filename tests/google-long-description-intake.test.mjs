import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {schemaCompanies} from './helpers/hub-schema.mjs';

const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const descriptionFor=length=>Array.from({length:Math.ceil(length/3500)},(_value,index)=>(index?'\n\n':'')+String(index+1)+' '+(index%2?'乙':'甲').repeat(3496)).join('').slice(0,length);
const translate=text=>text.replaceAll('甲','가').replaceAll('乙','나');
const content=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
const product=h=>h.sqlite.prepare('SELECT * FROM products').get();
const current=h=>JSON.stringify(['products','product_content','product_options','product_quotation_fields','product_price_policy','collection_context','collection_results'].map(table=>h.sqlite.prepare('SELECT * FROM '+table).all()));

async function fixture(company,length,{failure=false,expand=false}={}){
 const description=descriptionFor(length),queries=[];let chunks=0,fail=failure;
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,translationFetcher:target=>{
  const query=new URL(target).searchParams.get('q');queries.push(query);
  if(/[甲乙]/u.test(query)){
   if(++chunks===2&&fail)return new Response('synthetic middle chunk failure',{status:fail==='429'?429:400});
   return Response.json([[[translate(query)+(expand?'설명'.repeat(500):''),query]],null,'zh-CN']);
  }
  return Response.json([[[query==='收纳盒'?'수납함':'흰색',query]],null,'zh-CN']);
 }});
 try{
  const sourceUrl='https://detail.1688.com/offer/626000000001.html';
  h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=?').run('626000000001',sourceUrl);
  h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';delete h.bindings.AI;
  await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body:{schemaVersion:1,sourceUrl,provider:'synthetic-local-contract',collectedAt:new Date().toISOString(),title:'收纳盒',description,options:[{sku:'626001',name:'White',unitPriceCny:5.5,minimumOrder:10,stock:null}],images:[],attributes:[]}}));
  return{h,description,queries,setFailure(value){fail=value;chunks=0;}};
 }catch(error){h.close();throw error;}
}

for(const company of schemaCompanies)for(const length of [5600,20000])test(`a valid ${length}-character source description reaches editable SEO and quotation intact (${company.code})`,async()=>{
 const f=await fixture(company,length),{h}=f;
 try{
  const message=await h.intake(),saved=content(h),parts=f.queries.filter(query=>/[甲乙]/u.test(query));
  assert.equal(parts.join(''),f.description,'requests preserve all source characters, order and paragraph separators');assert.ok(parts.length>=2);assert.ok(parts.every(part=>part.length<=5000));
  assert.equal(saved.seo.description.value,translate(f.description));assert.equal(saved.seo.description.provenance,'manual');assert.equal(saved.detailDescriptionLinked,true);assert.doesNotMatch(message,/상품 설명 번역을 받지 못했습니다/);
  const quotation=await json(await h.route('/api/products/'+product(h).id+'/quotation-fields'));
  assert.ok(quotation.resolved.rows[0].fields.detailHtml.value.includes('가'));assert.ok(quotation.resolved.rows[0].fields.detailHtml.value.includes('나'));assert.ok(!quotation.resolved.rows[0].fields.detailHtml.value.includes('甲'));
  const before=current(h),requests=f.queries.length;await h.intake();assert.equal(current(h),before);assert.equal(f.queries.length,requests,'reopening an acknowledged source draft does not repeat any chunk');
  assert.equal(product(h).supplier_hub_status,'미전송');assert.ok(h.network.every(host=>host==='translate.googleapis.com'));
 }finally{h.close();}
});

for(const company of schemaCompanies)test(`an expanded full description cannot reject otherwise successful SEO and options (${company.code})`,async()=>{
 const f=await fixture(company,20000,{expand:true}),{h}=f;
 try{
  const message=await h.intake(),job=await h.load('db/translation-jobs.ts').findIntakeTranslation('owner',product(h).id);
  assert.equal(job.status,'completed');assert.equal(job.result.draft.description,'');assert.match(job.result.draft.warnings.join(' '),/20,000자/);assert.match(message,/검토 필요/);
  assert.equal(content(h).seo.description.value,f.description);assert.equal(content(h).seo.description.provenance,'collected');assert.ok(content(h).seo.title.value.includes('수납함'));
  const options=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);assert.equal(options.rows[0].translatedName,'흰색');assert.equal(options.rows[0].provenance.translatedName,'translated');
  const parts=f.queries.filter(query=>/[甲乙]/u.test(query));assert.equal(parts.join(''),f.description);assert.ok(parts.every(part=>translate(part).length+1000<=5000));assert.equal(product(h).supplier_hub_status,'미전송');
 }finally{h.close();}
});

for(const company of schemaCompanies)test(`a failed middle description chunk cannot become a partial description and manual review survives replay (${company.code})`,async()=>{
 for(const failure of [true,'429']){
  const f=await fixture(company,15000,{failure}),{h}=f;
  try{
   const message=await h.intake(),job=await h.load('db/translation-jobs.ts').findIntakeTranslation('owner',product(h).id);
   assert.equal(f.queries.filter(query=>/[甲乙]/u.test(query)).length,2,'stop this description at its first failed chunk');assert.match(message,/검토 필요/);
   assert.equal(job.status,'completed');assert.equal(job.result.draft.description,'');assert.equal(content(h).seo.description.value,f.description);assert.equal(content(h).seo.description.provenance,'collected');
   const base='/api/products/'+product(h).id,saved=content(h);await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:saved.revision,patch:{seo:{description:'직접 검토한 한국어 설명'},label:{material:''}}}}));
   const before=current(h),requests=f.queries.length;await h.intake();assert.equal(current(h),before);assert.equal(f.queries.length,requests);assert.equal(content(h).seo.description.value,'직접 검토한 한국어 설명');assert.equal(content(h).label.material.value,'');
   assert.equal(product(h).supplier_hub_status,'미전송');
  }finally{h.close();}
 }
});

for(const company of schemaCompanies)test(`explicit SEO retry can complete a long missing description without saving another stage (${company.code})`,async()=>{
 const f=await fixture(company,5600,{failure:true}),{h}=f;
 try{
  await h.intake();f.setFailure(false);const stored=product(h),before=current(h),firstQueries=f.queries.length;
  const helper=h.load('app/seo-translation-retry.ts'),state=helper.newSeoRetryState(stored.id,stored.updated_at),fetcher=(path,init={})=>h.route(path,{method:init.method??'GET',body:init.body});
  const controls={fetcher,signal:new AbortController().signal,onState(){}};
  const prepared=await helper.prepareSeoTranslationRetry(state,controls);assert.equal(prepared.job.status,'prepared');assert.equal(current(h),before);assert.equal(f.queries.length,firstQueries);
  const executed=await helper.executeSeoTranslationRetry(state,controls);assert.equal(executed.job.status,'completed');assert.equal(executed.job.result.draft.description,translate(f.description));assert.deepEqual(executed.job.review.source.attributes,[]);
  assert.equal(current(h),before,'explicit retry produces a review result and cannot apply any field itself');
  const queries=f.queries.slice(firstQueries),parts=queries.filter(query=>/[甲乙]/u.test(query));assert.equal(parts.join(''),f.description);assert.ok(queries.every(query=>query==='收纳盒'||/[甲乙]/u.test(query)));
  const count=f.queries.length;await helper.executeSeoTranslationRetry(JSON.parse(JSON.stringify(state)),controls);assert.equal(f.queries.length,count);
 }finally{h.close();}
});

test('description segmentation retains exact paragraphs and never divides a UTF-16 surrogate pair',()=>{
 const h=mobileIntakeHarness();try{
  const {splitGoogleTranslationText}=h.load('app/automation/google-translation-batch.ts');
  for(const text of ['甲'.repeat(4999)+'😀'+'乙'.repeat(600),'甲'.repeat(2700)+'\r\n\r\n'+'乙'.repeat(2900),'甲'.repeat(2600)+'\u2028'+'乙'.repeat(2800),'short text']){
   const parts=splitGoogleTranslationText(text);assert.equal(parts.join(''),text);assert.ok(parts.every(part=>part.length>0&&part.length<=5000));
   for(const part of parts){assert.ok(!/^[\uDC00-\uDFFF]/u.test(part));assert.ok(!/[\uD800-\uDBFF]$/u.test(part));}
   if(text.length<=5000)assert.deepEqual(JSON.parse(JSON.stringify(parts)),[text]);
  }
 }finally{h.close();}
});
