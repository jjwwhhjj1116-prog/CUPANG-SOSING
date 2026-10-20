import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {extractPageSource} from '../extensions/supplier-hub/page-source.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {syntheticSnapshot,companies,plain} from './helpers/supplier-hub-single-projection.mjs';

// Synthetic product facts and a locally generated PNG supplied by the fixture
// transport. CDN strings select fixture bytes; this test makes no live request.
const offerId='700000000751',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const recorded=JSON.parse(fs.readFileSync(new URL('./fixtures/1688-mobile-813724060928.json',import.meta.url),'utf8'));
const images=recorded.data['5908930030308'].data.offerImgList.slice(0,2);
const facts=[{name:'材质',value:'硅胶'},{name:'型号',value:'TEST751'},{name:'产品尺寸',value:'20x3cm'},
  {name:'包装尺寸',value:'999x999cm'}];
const dictionary=new Map(Object.entries({'合成护具':'합성 보호대','合成检验说明':'합성 검수 설명','黑色':'검정','灰色':'회색',
  '材质':'재질','硅胶':'실리콘','型号':'모델명','产品尺寸':'제품 치수','20x3cm':'20x3cm','包装尺寸':'포장 크기','999x999cm':'999x999cm'}));
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
function translate(target){
  const url=new URL(target);assert.equal(url.origin,'https://translate.googleapis.com');
  const query=url.searchParams.get('q'),value=text=>{assert.ok(dictionary.has(text),text);return dictionary.get(text);};
  const result=query.startsWith('[[YFTR')?query.split('\n').map(line=>{
    const match=/^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line);assert.ok(match);return `${match[1]} ${value(match[2])}`;
  }).reverse().join('\n'):value(query);
  return Response.json([[[result,query]],null,'zh-CN']);
}
function capture(){return extractPageSource({sourceUrl,title:'Synthetic shop label',description:'合成检验说明',priceText:'¥5.30',minimumOrderText:'1件起批',
  scripts:[JSON.stringify({offerId,subject:'合成护具',skuModel:{offerId,skuInfoMap:{black:{skuId:'SYNTHETIC751-B',specAttrs:'黑色',price:'5.30'},gray:{skuId:'SYNTHETIC751-G',specAttrs:'灰色',price:'6.00'}}},offerImgList:[images[0]]}),
    JSON.stringify({offerId,propsList:facts}),JSON.stringify({offerId:'700000000752',propsList:[{name:'材质',value:'Wrong recommendation'}]})],
  detailImages:[images[1]]});}

for(const company of companies)test(`${company.code}: captured attributes reach saved intake, translated label, manual edits and full native review`,async()=>{
  const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,translationFetcher:translate,
    sourceFetcher:()=>assert.fail('Saved page capture must not fetch a supplier endpoint')});
  try{
    h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';delete h.bindings.AI;
    const snapshot=syntheticSnapshot(company),profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{
      name:'SYNTHETIC-751',categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,template:null,mappings:[],hubSchema:snapshot},'synthetic-profile-751');
    const context={...h.context,category:profile,settings:{...h.settings,brand:company.name},keywords:''};
    h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=?,goal=? WHERE id=?').run(offerId,sourceUrl,'work','job');
    h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(context),'job');
    const source=capture();assert.deepEqual(source.attributes,facts);
    const inbox=h.load('app/source-inbox.ts'),fingerprint=await inbox.pageSourceFingerprint(source),captureId='00000000-0000-4000-8000-000000000751';
    await json(await h.load('app/api/source-inbox/route.ts').POST(new Request('https://app.test/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({expectedOwnerId:'owner',expectedCompany:company,id:captureId,fingerprint,snapshot:source})})));
    const rawInbox=h.sqlite.prepare('SELECT payload FROM source_inbox').get().payload;
    const ready=await json(await h.load('app/api/source-inbox/ready/route.ts').GET(new Request('https://app.test/api/source-inbox/ready?sourceUrl='+encodeURIComponent(sourceUrl))));
    const job=await h.load('db/collection-jobs.ts').findCollectionJob('owner','job');let saved;
    const message=await h.load('app/intake-collection.ts').collectIntakeProduct(job,{signal:new AbortController().signal,
      fetcher:(path,init)=>h.route(path,{method:init?.method??'GET',body:init?.body}),probeExistingFromBrowser:async()=>ready.capture,
      captureFromBrowser:()=>assert.fail('No source reopen/supplement is needed'),onJob:value=>{saved=value;},onProgress(){}});
    assert.match(message,/상품 초안 저장됨/);assert.ok(saved.product_id);
    const base='/api/products/'+saved.product_id,receipt=await h.load('db/collection-results.ts').readCollectionResult('owner','job');
    assert.deepEqual(plain(receipt.result.attributes),facts);assert.equal(receipt.result.provider,'chrome-current-page-v1');
    const rawReceipt=JSON.stringify(receipt),original=(await json(await h.route(base+'/translation-source')));
    assert.deepEqual(original.attributes,facts);assert.equal(original.requestContext.categoryId,'81452');
    let content=(await json(await h.route(base+'/content'))).content;
    assert.equal(content.seo.title.value,company.name+' 합성 보호대');
    assert.equal(content.label.material.value,'실리콘');assert.equal(content.label.model.value,'TEST751');
    assert.equal(content.label.dimensions.value,'20x3cm','packaging dimensions must not replace product dimensions');
    assert.ok(content.categoryAttributes.values.some(pair=>pair.name==='재질'&&pair.value==='실리콘'));
    assert.ok(content.assets.main.value.length);assert.ok(content.assets.detail.value.length);
    const options=(await json(await h.route(base+'/options'))).options;
    assert.deepEqual(options.rows.map(row=>[row.supplierSku,row.translatedName,row.unitCostCny]),[['SYNTHETIC751-B','검정',5.3],['SYNTHETIC751-G','회색',6]]);
    const seo=await json(await h.route(base+'/seo-workspace'));
    await json(await h.route(base+'/seo-workspace',{method:'PATCH',body:{expectedProductVersion:seo.productVersion,expectedContentRevision:seo.content.revision,
      expectedOptionRevision:seo.options.revision,seo:{title:'직접 검토한 보호대',description:'직접 검토한 상세 설명',keywordText:'보호대'}}}));
    content=(await json(await h.route(base+'/content'))).content;
    content=(await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{material:'검토한 실리콘',model:''}}}}))).content;
    let view=await json(await h.route(base+'/quotation-fields'));
    const material=view.resolved.schema.fields.find(field=>JSON.stringify(field.hubWire?.path)===JSON.stringify(['legalPage','notices'])&&field.hubWire?.name==='소재');assert.ok(material);
    view=await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,
      changes:[{fieldKey:material.id,optionId:null,value:'검토한 실리콘'}]}}));
    const projection=await h.load('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument({snapshot,company,categoryId:'81452',categoryPath:snapshot.categoryPath,resolved:view.resolved});
    assert.equal(projection.payload.jsonDocument.length,2);assert.equal(projection.payload.displayCategoryCode,'81452');
    for(const document of projection.payload.jsonDocument){
      assert.equal(document.startPage.productName,'직접 검토한 보호대');
      assert.equal(document.legalPage.notices.find(pair=>pair.noticeItemName==='소재').noticeItemValue,'검토한 실리콘');
    }
    await h.intake();
    assert.deepEqual((await json(await h.route(base+'/content'))).content,content,'reopening/resuming must preserve reviewed edits and explicit model blank');
    assert.equal(JSON.stringify(await h.load('db/collection-results.ts').readCollectionResult('owner','job')),rawReceipt);
    assert.equal(h.sqlite.prepare('SELECT payload FROM source_inbox').get().payload,rawInbox);
    assert.equal(h.aiSources.length,0);assert.ok(h.network.every(host=>host==='cbu01.alicdn.com'||host==='translate.googleapis.com'));
    assert.equal(projection.remoteWrites,false);assert.equal(projection.registered,false);
    assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products WHERE id=?').get(saved.product_id).supplier_hub_status,'미전송');
  }finally{h.close();}
});
