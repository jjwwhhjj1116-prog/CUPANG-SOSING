import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const QWEN='@cf/qwen/qwen3-30b-a3b-fp8';
const plain=value=>JSON.parse(JSON.stringify(value));
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const payload=(h,table)=>JSON.parse(h.sqlite.prepare('SELECT payload FROM '+table).get().payload);
const translations=new Map(Object.entries({
 '是否偏光':'편광 여부','否':'아니요','抗UV等级':'UV 등급','镜片材质':'렌즈 재질','品牌':'브랜드','利翔':'리샹',
 '眼镜款式':'안경 형태','圆框':'원형 테','镜框材质':'테 재질','镜架材质':'안경테 재질','是否支持近视镜':'근시용 렌즈 지원 여부','不支持近视镜':'근시용 렌즈 미지원','货号':'판매자 품번',
 '镜片颜色':'렌즈 색상','镜架颜色':'테 색상','黑色':'검정','透射比分类':'투과율 분류','2类/遮阳镜':'2등급/선글라스','眼镜结构':'안경 구조','全框':'풀 테',
 '适用场景':'사용 상황','防晒,出游,骑行,驾驶,派对聚会':'차광,외출,자전거 타기,운전,파티 모임','上市年份/季节':'출시 연도/계절','2024年夏季':'2024년 여름','是否跨境出口专供货源':'수출 전용 상품 여부','是':'예',
 '颜色':'색상','亮黑':'유광 검정','砂黑':'무광 검정','砂灰':'무광 회색','亮黑,砂黑,砂灰':'유광 검정,무광 검정,무광 회색','尺码':'사이즈','太阳镜':'선글라스','太阳镜 加005 盒子':'선글라스 + 005 케이스','太阳镜,太阳镜 加005 盒子':'선글라스,선글라스 + 005 케이스',
 '产地':'생산지','台州':'타이저우','风格':'스타일','可爱风,日韩风,甜美风,小清新':'귀여운 스타일,일본 한국 스타일,사랑스러운 스타일,산뜻한 스타일','适用性别':'사용 성별','通用':'공용','风格分类':'스타일 분류','清新甜美':'산뜻하고 사랑스러운 스타일',
 '主要销售地区':'주요 판매 지역','非洲,欧洲,南美,东南亚,北美,东北亚,中东,其他':'아프리카,유럽,남미,동남아,북미,동북아,중동,기타','流行元素分类':'유행 요소 분류','生活用品':'생활용품',
}));
function translated(value){
 if(!/\p{Script=Han}/u.test(value))return value;
 if(value.includes(' / '))return value.split(' / ').map(translated).join(' / ');
 assert.ok(translations.has(value),'recorded fixture translation missing: '+value);return translations.get(value);
}
function translatedAttribute(pair,index){
 const option=/^option(?:-(color|size))?:/u.exec(pair.name),prefix='상품속성: ';
 return{sourceIndex:pair.sourceIndex??index,name:option?option[1]==='color'?'색상':option[1]==='size'?'사이즈':'옵션명':pair.name.startsWith(prefix)?prefix+translated(pair.name.slice(prefix.length)):translated(pair.name),value:translated(pair.value)};
}
const facts=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['translatedName','color','size','provenance','updatedAt'].includes(key)));
const prices=product=>Object.fromEntries(['source_url','source_image_key','image_keys','source_price_cny','exchange_rate','supply_margin','coupang_margin','supply_price','sale_price','msrp','supplier_hub_status'].map(key=>[key,product[key]]));

/** Real local handlers and ephemeral SQLite; provider replies and public
 * recorded collection bytes are fixtures, with no external requests. */
async function fixture({manual=false}={}){
 const google=[];
 const h=mobileIntakeHarness({companyCode:'A01526306',companyName:'유앤채',translationFetcher:async(target)=>{const url=new URL(target);assert.equal(url.origin,'https://translate.googleapis.com');google.push(url.searchParams.get('q'));return new Response('fixture Google rate limit',{status:429});}});
 try{
  h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';h.bindings.SOURCEFLOW_QUOTATION_AI_PROVIDER='workers-ai';h.bindings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY='true';
  const category=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'기록 선글라스',categoryId:'69900',categoryPath:['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'],template:null,mappings:[]},'cat');
  h.context.category=category;h.context.keywords=manual?'선글라스':'';h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');h.sqlite.prepare('UPDATE collection_jobs SET goal=? WHERE id=?').run('work','job');
  await json(await h.route('/api/collection-jobs/job/collect',{method:'POST'}));const receipt=payload(h,'collection_results');receipt.title='合成太阳镜';receipt.description='原文商品说明';h.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(JSON.stringify(receipt),'job');
  await h.intake();const product=()=>h.sqlite.prepare('SELECT * FROM products').get(),id=product().id;
  const failed=h.sqlite.prepare('SELECT * FROM translation_jobs ORDER BY created_at,id').all();assert.ok(failed.some(job=>job.status==='failed'));assert.ok(google.length>0);assert.ok(payload(h,'product_options').rows.some(row=>row.provenance.translatedName!=='translated'));
  if(manual){
   const options=payload(h,'product_options');for(const index of [0,1]){const row=options.rows[index];row.translatedName=index?'직접 확인한 옵션':'';row.color=index?'직접 확인한 색':'';row.size='';for(const key of ['translatedName','color','size'])row.provenance[key]='manual';}options.rows[1].unitCostCny=12;options.rows[1].provenance.unitCostCny='manual';options.rows[2].included=false;h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(options),id);
   const content=payload(h,'product_content');await json(await h.route('/api/products/'+id+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'직접 확정한 상품명',keywords:[]},label:{manufacturer:'직접 확정한 제조사'}}}}));
  }
  const generated=[],requests=[];const good={title:'원문 기준 선글라스',keywords:['선글라스'],description:'원문 기준 상품 설명',warnings:[]};
  h.bindings.SOURCEFLOW_TEXT_PROVIDER='workers-ai';h.bindings.SOURCEFLOW_TEXT_MODEL=QWEN;h.bindings.SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS='4096';
  h.bindings.AI={run:async(model,input)=>{
   assert.equal(model,QWEN);assert.equal(input.max_tokens,4096);assert.equal(Object.hasOwn(input,'response_format'),false);assert.ok(input.messages[1].content.endsWith('\n/no_think'));assert.match(input.messages[1].content,/^Translate the Chinese product data below into Korean\./u);const source=JSON.parse(input.messages[1].content.split('\n\nPRODUCT_SOURCE_JSON:\n')[1].slice(0,-'\n/no_think'.length));assert.ok(source.attributes.length);const draft={...good,attributes:source.attributes.map(translatedAttribute)};generated.push({model,source,draft});return{choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(draft)}}]};
  }};
  const configuration=(await json(await h.load('app/api/seo-generation/configuration/route.ts').GET())).configuration;assert.equal(configuration.translationConfig.model,QWEN);assert.equal(configuration.translationConfig.maxOutputTokens,4096);assert.equal(configuration.translationConfig.freeOnly,false);
  const fetcher=async(input,init={})=>{const target=typeof input==='string'?input:input.url,url=new URL(target,'https://app.test');assert.equal(url.origin,'https://app.test');requests.push({path:url.pathname,method:init.method??'GET',body:init.body?JSON.parse(init.body):null});if(url.pathname==='/api/supplier-hub/catalog-context')return Response.json({ownerId:'owner',company:{code:'A01526306',name:'유앤채'}});if(url.pathname==='/api/products/'+id)return h.load('app/api/products/[id]/route.ts').GET(new Request(url),{params:Promise.resolve({id})});return h.route(url.pathname+url.search,{method:init.method??'GET',body:init.body});};
  const immutable=()=>JSON.stringify({source:h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,context:h.sqlite.prepare('SELECT payload FROM collection_context').get().payload,links:h.sqlite.prepare('SELECT * FROM collection_products ORDER BY product_id').all(),oldJobs:failed.map(job=>h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(job.id)),bytes:[...h.objects].map(([key,bytes])=>[key,Buffer.from(bytes).toString('base64')]),prices:prices(product())});
  const run=()=>h.load('app/batch-selected-work.ts').runSelectedBatchProduct(id,{stages:['seo'],mode:'full',expectedOwnerId:'owner',signal:new AbortController().signal,fetcher,keys:new Map(),newKey:()=>crypto.randomUUID(),onStage:()=>{},seoGenerationConsent:configuration});
  return{h,id,google,generated,requests,immutable,good,run};
 }catch(error){h.close();throw error;}
}

for(const manual of [false,true])test('Google 429 intake → one full-mode Qwen SEO/options application preserves '+(manual?'manual values and blanks':'immutable source, SKU and prices'),async()=>{
 const f=await fixture({manual}),{h}=f;try{
  const before=f.immutable(),optionsBefore=plain(payload(h,'product_options')),contentBefore=plain(payload(h,'product_content')),googleCalls=f.google.length,result=await f.run();
  assert.equal(result.stages[0].status,'draft',JSON.stringify(result));assert.equal(f.generated.length,1);assert.equal(f.generated.filter(call=>call.model===QWEN).length,1);assert.equal(f.generated.filter(call=>call.model.includes('llama')).length,0);assert.equal(f.google.length,googleCalls,'batch must not retry Google');assert.equal(f.immutable(),before);
  const content=payload(h,'product_content'),options=payload(h,'product_options'),call=f.generated[0];assert.ok(call.source.attributes.some(pair=>pair.name.startsWith('상품속성: ')));assert.ok(call.source.attributes.some(pair=>pair.name.startsWith('option:')));assert.deepEqual(call.draft.attributes.map(pair=>pair.sourceIndex),call.source.attributes.map((pair,index)=>pair.sourceIndex??index));assert.ok(call.draft.attributes.every(pair=>!/[\p{Script=Han}]/u.test(pair.name+pair.value)));
  assert.deepEqual(options.rows.map(facts),optionsBefore.rows.map(facts));assert.equal(options.rows.length,optionsBefore.rows.length);assert.equal(content.seo.description.value,f.good.description);assert.equal(content.seo.description.provenance,'generated');
  if(manual){assert.deepEqual(content.seo.title,contentBefore.seo.title);assert.deepEqual(content.seo.keywords,contentBefore.seo.keywords);assert.deepEqual(content.label.manufacturer,contentBefore.label.manufacturer);assert.deepEqual(options.rows.slice(0,3),optionsBefore.rows.slice(0,3));assert.ok(options.rows.slice(3).every(row=>row.provenance.translatedName==='translated'));}
  else{assert.equal(content.seo.title.value,h.settings.brand+' '+f.good.title);assert.equal(content.seo.title.provenance,'generated');assert.deepEqual(content.seo.keywords.value,f.good.keywords);assert.equal(content.seo.keywords.provenance,'generated',JSON.stringify({before:contentBefore.seo.keywords,after:content.seo.keywords}));assert.ok(options.rows.every(row=>row.provenance.translatedName==='translated'));}
  const execute=f.requests.filter(request=>request.path.endsWith('/translation')&&request.body?.action==='execute'),apply=f.requests.filter(request=>request.path.endsWith('/translation-apply')&&request.body?.action==='apply');assert.equal(execute.length,1);assert.equal(apply.length,1);assert.equal(apply[0].body.scope,'all');assert.equal(apply[0].body.linkQuotationSeoDefaults,true);assert.equal(f.requests.filter(request=>request.path.endsWith('/seo-generation')&&request.method==='POST').length,0);assert.ok(!h.network.includes('supplier.coupang.com'));assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM translation_jobs WHERE status=?').get('completed').n,1);
 }finally{h.close();}
});
