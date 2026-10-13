import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {schemaCompanies} from './helpers/hub-schema.mjs';

// Synthetic non-variant identity derived from local source structure. All fetch
// responses, model output and media bytes stay in-memory; no real offer is read.
const offerId='622000000001',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`,title='单一收纳篮';
const read=name=>JSON.parse(fs.readFileSync(new URL('fixtures/'+name,import.meta.url),'utf8'));
function sourceFixture(){
 const mobile=read('1688-mobile-813724060928.json'),skuPayload=read('1688-skus-813724060928.json');
 const changeIdentity=value=>{if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(key==='offerId')value[key]=offerId;else changeIdentity(item);}};changeIdentity(mobile);changeIdentity(skuPayload);
 mobile.globalData.tempModel.offerTitle=title;skuPayload.data.result.data.offerBaseInfo.title=title;
 const gallery=Object.values(mobile.data).find(value=>value?.data?.offerImgList).data;gallery.offerImgList=gallery.offerImgList.slice(0,3);
 Object.values(mobile.data).find(value=>value?.data?.propsList).data.propsList=[{name:'material',value:'PP'},{name:'model',value:'BASKET-S1'},{name:'product dimensions',value:'20 x 15 x 10 cm'}];
 const detailUrl='https://itemcdn.tmall.com/1688offer/Step622Synthetic1';mobile.globalData.detailModel={offerId,detailUrl:'https://air.1688.com/app/detail?'+new URLSearchParams({offerId,url:detailUrl})};
 const detailImage=gallery.offerImgList.pop(),detailSource='var offer_details = '+JSON.stringify({content:`<p>单一商品原文说明</p><img src="${detailImage}">`})+';';
 const data=skuPayload.data.result.data;data.skuModel.skuProps=[];data.skuModel.skuInfoMap={'':{skuId:'622000000010',specAttrs:'',price:'12.5',canBookCount:0}};data.orderParamModel.orderParam.beginNum=3;data.orderParamModel.orderParam.skuParam.skuPriceType='skuPrice';
 return{format:'1688-public-mobile-capture-v1',sourceUrl,mobileHtml:'<script>window.__INIT_DATA='+JSON.stringify(mobile)+';</script>',skuPayload,detailSource};
}
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};

for(const company of schemaCompanies)for(const mode of ['server-mobile','chrome-mobile'])test(`a non-variant URL becomes one editable SKU with SEO, price, images, label and quotation linkage (${company.code}, ${mode})`,async()=>{
 const capture=sourceFixture(),requests=[],h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,sourceFetcher:async target=>{
  const url=new URL(target);requests.push(url.hostname);assert.ok(!url.href.includes('813724060928'),'this synthetic flow never requests the previously selected offer');
  if(url.hostname==='detail.1688.com')return new Response('<html>no product JSON-LD</html>',{headers:{'content-type':'text/html'}});
  if(url.hostname==='m.1688.com')return new Response(capture.mobileHtml,{headers:{'content-type':'text/html'}});
  if(url.hostname==='h5api.m.1688.com'){assert.equal(JSON.parse(JSON.parse(url.searchParams.get('data')).params).offerId,offerId);return Response.json(capture.skuPayload);}
  assert.equal(url.hostname,'itemcdn.tmall.com');return new Response(capture.detailSource,{headers:{'content-type':'text/plain'}});
 }});
 try{
  h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=?,goal=? WHERE id=?').run(offerId,sourceUrl,'work','job');h.context.keywords='수납,바스켓';h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  let generations=0;h.bindings.AI.run=async(_model,input)=>{generations++;const source=JSON.parse(input.messages[1].content);assert.equal(source.title,title);assert.equal(source.category.id,'80719');assert.equal(source.guidance.keywords,'수납,바스켓');return{response:{title:'단일 수납 바스켓',description:'단일 수납 상품 검토용 설명',keywords:['수납'],warnings:[],attributes:source.attributes.map((pair,sourceIndex)=>({sourceIndex,name:pair.name.startsWith('option:')?'옵션명':pair.name.replace('상품속성: ',''),value:pair.name.startsWith('option:')?'단일 바스켓':pair.value}))}};};
  if(mode==='chrome-mobile')await json(await h.route('/api/collection-jobs/job/browser-capture',{method:'POST',body:capture}));
  assert.match(await h.intake(),/상품 초안 저장됨/);
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,receipt=await h.load('db/collection-results.ts').readCollectionResult('owner','job'),options=await json(await h.route(base+'/options')),content=(await json(await h.route(base+'/content'))).content;
  assert.equal(receipt.result.offerId,offerId);assert.equal(receipt.result.sourceUrl,sourceUrl);assert.equal(receipt.result.title,title);assert.equal(receipt.result.options.length,1);assert.equal(receipt.result.provider,mode==='server-mobile'?'1688-public-mobile-v1':'chrome-public-mobile-v1');
  const option=options.options.rows[0];assert.equal(option.supplierSku,'622000000010');assert.equal(option.originalName,title);assert.equal(option.translatedName,'단일 바스켓');assert.equal(option.unitCostCny,12.5);assert.equal(option.minimumOrderQuantity,3);assert.equal(option.stock,0);assert.equal(option.color,'');assert.equal(option.size,'');
  assert.equal(product.options_count,1);assert.equal(product.supplier_hub_status,'미전송');assert.equal(generations,1);assert.equal(content.seo.title.value,'검토 브랜드 단일 수납 바스켓');assert.deepEqual(content.seo.keywords.value,['수납']);
  for(const role of ['main','additional','detail'])assert.equal(content.assets[role].value.length,1);assert.equal(content.label.material.value,'PP');assert.equal(content.label.model.value,'BASKET-S1');assert.equal(content.label.dimensions.value,'20 x 15 x 10 cm');assert.equal(content.label.importer.value,company.name);
  const view=await json(await h.route(base+'/quotation-fields')),fields=view.resolved.rows.find(row=>row.optionId===option.id).fields;assert.equal(view.categoryContext.categoryId,'80719');assert.equal(fields.title.value,'검토 브랜드 단일 수납 바스켓, 단일 바스켓');
  assert.deepEqual(['supplyPrice','salePrice','msrp'].map(key=>fields[key].value),['8750','14580','18950']);assert.equal(fields.noticeMaterial.value,'PP');assert.equal(fields.noticeServiceContact.value,'쿠팡 고객센터 1577-7011');assert.equal(fields.boxSkuQuantity.value,'50');assert.equal(fields.kcMarkType.value,'해당사항없음');assert.equal(fields.shelfLifeDays.value,'0');
  for(const key of ['mainImage','additionalImages','detailImages'])assert.ok(fields[key].value,key);assert.match(fields.detailHtml.value,/단일 수납 상품 검토용 설명/);
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'직접 검토한 단일 바스켓'},label:{material:'직접 확인한 PP'},assets:{additional:[]}}}}));
  const reviewed=await json(await h.route(base+'/quotation-fields')),current=reviewed.resolved.rows.find(row=>row.optionId===option.id).fields;assert.equal(current.title.value,'직접 검토한 단일 바스켓, 단일 바스켓');assert.equal(current.noticeMaterial.value,'직접 확인한 PP');assert.equal(current.additionalImages.value,'');
  const before=JSON.stringify({product:h.sqlite.prepare('SELECT * FROM products').get(),content:h.sqlite.prepare('SELECT * FROM product_content').get(),options:h.sqlite.prepare('SELECT * FROM product_options').get(),context:h.sqlite.prepare('SELECT * FROM collection_context').get()}),network=h.network.length;
  await h.intake();assert.equal(generations,1);assert.equal(h.network.length,network);assert.equal(JSON.stringify({product:h.sqlite.prepare('SELECT * FROM products').get(),content:h.sqlite.prepare('SELECT * FROM product_content').get(),options:h.sqlite.prepare('SELECT * FROM product_options').get(),context:h.sqlite.prepare('SELECT * FROM collection_context').get()}),before);
  const columns=['skuId','skuName','sourceUrl','sourcePriceCny',...view.resolved.schema.fields.map(field=>field.id)],bytes=new TextEncoder().encode(columns.join(',')+'\n'),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'csv');
  await h.bindings.FILES.put(storageKey,bytes,{customMetadata:{sha256,format:'csv'}});await h.load('db/category-profiles.ts').createCategoryProfile('owner',{...h.context.category,name:'단일 SKU 합성 CSV',template:{name:'synthetic-single.csv',format:'csv',sha256,storageKey,sheetName:'',headerRow:1,headers:columns},mappings:columns.map((field,column)=>({field,column,required:false}))},'cat');
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));assert.equal(preview.rows.length,1);assert.deepEqual(preview.report.company,company);const exported=Object.fromEntries(columns.map((key,index)=>[key,preview.rows[0][index]]));
  assert.equal(String(exported.skuId),'622000000010');assert.equal(exported.skuName,'단일 바스켓');assert.equal(exported.sourceUrl,sourceUrl);assert.equal(String(exported.sourcePriceCny),'12.5');assert.equal(exported.title,'직접 검토한 단일 바스켓, 단일 바스켓');assert.equal(exported.noticeMaterial,'직접 확인한 PP');assert.equal(exported.additionalImages,'');assert.deepEqual(['supplyPrice','salePrice','msrp'].map(key=>String(exported[key])),['8750','14580','18950']);
  const download=await h.route(base+'/quotation',{method:'POST',body:{action:'download',fingerprint:preview.fingerprint}});assert.equal(download.status,200,await download.clone().text());const actual=h.load('app/category-profiles.ts').parseTemplateText(await download.text(),',',2);assert.deepEqual(Array.from(actual,String),preview.rows[0].map(String));
  if(mode==='chrome-mobile')assert.deepEqual(requests,[]);else assert.deepEqual(requests,['detail.1688.com','m.1688.com','h5api.m.1688.com','itemcdn.tmall.com']);
 }finally{h.close();}
});
