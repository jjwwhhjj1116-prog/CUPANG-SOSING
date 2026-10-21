import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {extractPageSource,validatePageSource} from '../extensions/supplier-hub/page-source.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {companies,syntheticSnapshot,plain} from './helpers/supplier-hub-single-projection.mjs';
import {sourceReviewModule} from './helpers/source-review-intake.mjs';

// Reuse inert fixture declarations only. Importing a test module would register
// unrelated tests, and no page script or supplier resource may execute here.
async function fixture(path,names){
 const url=new URL(path,import.meta.url),source=fs.readFileSync(url,'utf8'),ast=ts.createSourceFile(url.href,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const declarations=ast.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isFunctionDeclaration(node)&&names.includes(node.name?.text));
 const code=declarations.map(node=>{let text=node.getFullText(ast);if(ts.isImportDeclaration(node)){const name=node.moduleSpecifier.text;if(!name.startsWith('node:'))text=text.replace("'"+name+"'",JSON.stringify(name.startsWith('.')?new URL(name,url).href:import.meta.resolve(name)));}return text;}).join('\n').replaceAll('import.meta.url',JSON.stringify(url.href));
 return import('data:text/javascript,'+encodeURIComponent(code+'\nexport {'+names.join(',')+'};'));
}
const dom=await fixture('./page-source-dom-options.test.mjs',['documentFromHtml','capture','html','tile','group','groupsHtml','combination','script','gallery','sourceUrl']);
const flow=await fixture('./page-dom-source-intake-flow.test.mjs',['documentFromHtml','capturedPage','retainedProduct','images','sourceUrl','offerId']);
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};

test('explicit DOM labels and values survive single, fixed-plus-varying and reversed axes without changing names, identities or prices',()=>{
 const single=dom.capture(dom.html(dom.tile('黑色')+dom.tile('灰色','¥6.10')));
 assert.deepEqual(single.options.map(row=>row.axisValues),[[{label:'颜色',value:'黑色'}],[{label:'颜色',value:'灰色'}]]);
 for(const reverse of [false,true]){
  const colors=dom.group('颜色分类',dom.tile('黑色')+dom.tile('灰色','¥6.10')),size=dom.group('尺寸','<li>均码 ¥999.00 库存9</li>'),material=dom.group('材质','<li>加绒</li>');
  const source=dom.capture(dom.groupsHtml((reverse?size+colors:colors+size)+material));
  assert.deepEqual(source.options.map(row=>[row.key,row.name,row.unitPriceCny]),[
   ['dom-row:1',reverse?'均码 / 黑色 / 加绒':'黑色 / 均码 / 加绒',5.3],['dom-row:2',reverse?'均码 / 灰色 / 加绒':'灰色 / 均码 / 加绒',6.1]]);
  assert.deepEqual(source.options[0].axisValues,reverse?[{label:'尺寸',value:'均码'},{label:'颜色分类',value:'黑色'},{label:'材质',value:'加绒'}]:[{label:'颜色分类',value:'黑色'},{label:'尺寸',value:'均码'},{label:'材质',value:'加绒'}]);
  const h=mobileIntakeHarness();try{assert.deepEqual(plain(h.load('app/source-inbox.ts').pageSourceCollectionResult(source).options).map(row=>[row.color,row.size]),[['黑色','均码'],['灰色','均码']]);assert.equal(h.network.length,0);}finally{h.close();}
 }
});

test('full inventory tuples preserve per-row axis bindings and prices; partial or guessed matrices still fail closed',()=>{
 const axes=dom.group('颜色',dom.tile('黑色','¥999.00')+dom.tile('灰色','¥999.00'))+dom.group('尺码','<li>S</li><li>M</li>');
 const rows=[['灰色 / M',7.3],['黑色 / S',5.3],['灰色 / S',6.1],['黑色 / M',6.3]],source=dom.capture(dom.groupsHtml(axes,rows.map(([name,price])=>dom.combination(name,'¥'+price)).join('')));
 assert.deepEqual(source.options.map(row=>[row.name,row.unitPriceCny,...row.axisValues.map(axis=>[axis.label,axis.value])]),rows.map(([name,price])=>[name,price,['颜色',name.split(' / ')[0]],['尺码',name.split(' / ')[1]]]));
 assert.throws(()=>dom.capture(dom.groupsHtml(axes)),/옵션 영역/);
 assert.throws(()=>dom.capture(dom.groupsHtml(axes,rows.slice(1).map(([name])=>dom.combination(name)).join(''))),/옵션 영역/);
 const declared=JSON.stringify({skuModel:{offerId:'700000000001',skuInfoMap:{script:{specAttrs:'黑色 / 均码',skuId:'observed-script-sku',price:'7.25'}}}});
 const result=dom.capture(dom.html(dom.tile('DOM 黑色')),{scripts:[dom.script,declared]});
 assert.equal(result.options[0].supplierSku,'observed-script-sku');assert.equal(result.options[0].axisValues,undefined,'script SKU precedence must not acquire unrelated DOM axes');
});

test('legacy, compound and ambiguous semantic axes never guess canonical color or size from a combined name',async()=>{
 const h=mobileIntakeHarness();try{
  const model=h.load('app/source-inbox.ts'),source=flow.capturedPage(),legacy=plain(source);for(const row of legacy.options)delete row.axisValues;
  assert.equal(JSON.stringify(validatePageSource(legacy)),JSON.stringify(legacy),'old v1 capture bytes remain compatible');
  assert.equal(await model.pageSourceFingerprint(validatePageSource(legacy)),await model.pageSourceFingerprint(legacy));
  const cases=[{axes:null,color:undefined,size:undefined},{axes:[{label:'颜色规格',value:'黑色 / 均码'}],color:undefined,size:undefined},
   {axes:[{label:'颜色',value:'黑色'},{label:'颜色分类',value:'深黑'},{label:'尺码',value:'均码'}],color:undefined,size:'均码'},
   {axes:[{label:'颜色',value:'黑色'},{label:'尺寸',value:'M'},{label:'尺码',value:'均码'}],color:'黑色',size:undefined}];
  for(const item of cases){const input=plain(legacy);if(item.axes)input.options[0].axisValues=item.axes;const row=model.pageSourceCollectionResult(input).options[0];assert.equal(row.color,item.color);assert.equal(row.size,item.size);assert.equal(row.name,'黑色 / 均码');}
  assert.equal(h.network.length,0);
 }finally{h.close();}
});

test('optional axis metadata rejects malformed, duplicate, injected or oversized values before capture publication',()=>{
 const source=flow.capturedPage(),valid={label:'颜色',value:'黑色'};
 for(const axes of [null,[],{},[null],[{...valid,extra:true}],[{label:'颜色'}],[{label:'unknown',value:'黑色'}],[valid,valid],Array.from({length:11},()=>valid),[{label:'颜色',value:''}],[{label:'颜色',value:' 黑色'}],[{label:'颜色',value:'黑\u0000色'}],[{label:'颜色',value:'色'.repeat(201)}]]){
  const input=plain(source);input.options[0].axisValues=axes;assert.throws(()=>validatePageSource(input),/옵션 축/);
 }
 const mismatched={format:'yoofam-page-dom-options-v1',sourceUrl:dom.sourceUrl,offerId:'700000000001',options:[{...dom.capture(dom.html(dom.tile('黑色'))).options[0],axisValues:[{label:'颜色',value:'灰色'}]}]};
 assert.throws(()=>extractPageSource({sourceUrl:dom.sourceUrl,scripts:[dom.script],domOptions:mismatched,title:'合成测试商品',gallery:[dom.gallery]}),/옵션 영역/);
});

test('explicit source review may rename an option without editing its immutable observed axes',()=>{
 const h=mobileIntakeHarness();try{
  const model=h.load('app/source-inbox.ts'),source=flow.capturedPage(),before=JSON.stringify(source),review={title:'직접 검토한 합성 상품',options:source.options.map(row=>({key:row.key,name:'직접 '+row.name,supplierSku:row.supplierSku,unitPriceCny:row.unitPriceCny,currency:row.currency,minimumOrder:row.minimumOrder}))};
  const reviewed=model.reviewPageSource(source,review);assert.equal(JSON.stringify(source),before);assert.deepEqual(plain(reviewed.options[0].axisValues),source.options[0].axisValues);assert.equal(reviewed.options[0].name,'직접 黑色 / 均码');
  const result=model.pageSourceCollectionResult(reviewed,true);assert.equal(result.options[0].color,'黑色');assert.equal(result.options[0].size,'均码');
  assert.throws(()=>model.reviewPageSource(source,{...review,options:[{...review.options[0],axisValues:[{label:'颜色',value:'灰色'}]}]}),/검토 항목/);assert.equal(h.network.length,0);
 }finally{h.close();}
});

test('review ACK preserves observed axes, rejects additions/removals/value changes, and accepts legacy optional absence',async()=>{
 const h=mobileIntakeHarness();try{
  const model=h.load('app/source-inbox.ts'),transition=sourceReviewModule('app/source-review-intake.ts'),source=flow.capturedPage();
  const item=async snapshot=>({id:'00000000-0000-4000-8000-000000000772',ownerId:'owner',company:companies[0],fingerprint:await model.pageSourceFingerprint(snapshot),snapshot,reviewed:null,revision:1,receivedAt:snapshot.collectedAt,issues:[],archivedAt:null});
  const before=await item(source),saved={...before,revision:2,reviewed:model.reviewPageSource(source,{title:'직접 검토 상품',options:source.options.map(({key,name,supplierSku,unitPriceCny,currency,minimumOrder})=>({key,name:'직접 '+name,supplierSku,unitPriceCny,currency,minimumOrder}))})};
  assert.equal(transition.validateReviewedSourceTransition(before,saved,'owner'),true);
  for(const axes of [undefined,[{label:'颜色',value:'灰色'},{label:'尺码',value:'均码'}],[...source.options[0].axisValues,{label:'材质',value:'加绒'}]]){
   const changed=plain(saved);if(axes===undefined)delete changed.reviewed.options[0].axisValues;else changed.reviewed.options[0].axisValues=axes;
   assert.equal(transition.validateReviewedSourceTransition(before,changed,'owner'),false);
  }
  const legacy=plain(source);for(const row of legacy.options)delete row.axisValues;
  const old=await item(legacy),ack={...old,revision:2,reviewed:plain(legacy)};assert.equal(transition.validateReviewedSourceTransition(old,ack,'owner'),true);
  const injected=plain(ack);injected.reviewed.options[0].axisValues=source.options[0].axisValues;assert.equal(transition.validateReviewedSourceTransition(old,injected,'owner'),false);
  assert.equal(h.network.length,0);
 }finally{h.close();}
});

for(const company of companies)test(company.code+': saved DOM axes pass actual intake/translation/quotation APIs while source, old work and files remain unchanged',async()=>{
 let sourceRequests=0;const translatedSources=[],h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,fixtureImageUrls:flow.images,sourceFetcher:()=>{sourceRequests++;assert.fail('Synthetic saved capture must not request any supplier');}});
 try{
  const translations=new Map([['黑色 / 均码','검정 / 프리'],['灰色 / 均码','회색 / 프리'],['黑色','검정'],['灰色','회색'],['均码','프리']]);
  h.bindings.AI.run=async(_model,input)=>{const source=JSON.parse(input.messages[1].content);translatedSources.push(source);return{response:{title:'합성 옵션 축 검수',description:'합성 검수 설명',keywords:['합성 검수'],warnings:[],attributes:source.attributes.map((pair,sourceIndex)=>({sourceIndex,name:pair.name,value:translations.get(pair.value)??pair.value}))}};};
  const oldId='synthetic-axis-protected-772',oldKey='owner/synthetic-axis-protected-772.png',birth=new Date().toISOString(),policy=h.load('app/pricing.ts').pricePolicy(h.settings);h.objects.set(oldKey,Uint8Array.of(7,7,2));
  await h.load('db/queries.ts').insertProduct({id:oldId,owner_id:'owner',source_url:'synthetic://axis-protected-work-772',title:'기존 검토 상품 유지',source_price_cny:8,exchange_rate:policy.exchangeRate,supply_margin:policy.supplyMargin,coupang_margin:policy.coupangMargin,supply_price:5600,sale_price:9340,msrp:12150,options_count:1,seo_status:'완료',image_status:'완료',quote_status:'대기',registration_status:'대기',supplier_hub_status:'미전송',image_keys:JSON.stringify([oldKey]),goal_stage:'work',created_at:birth,updated_at:birth},policy);
  const oldBefore=flow.retainedProduct(h,oldId),oldBytes=Buffer.from(h.objects.get(oldKey)).toString('hex');
  // This is an explicit synthetic exact-label form contract, not evidence that
  // any commercial product belongs to this category or a live Hub accepted it.
  const form=syntheticSnapshot(company),schema=JSON.parse(form.schemaString),exposed=schema.properties.productPage.properties.commonAttributes.properties.exposedAttributes;
  exposed.allOf[0].contains.properties.attributeValue.enum=['검정','회색'];exposed.allOf.push({contains:{type:'object',properties:{attributeName:{type:'string',enum:['사이즈'],requirement:'필수'},attributeValue:{type:'string',enum:['프리']}},required:['attributeName','attributeValue']}});form.schemaString=JSON.stringify(schema);
  const category=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'SYNTHETIC-AXIS-772',categoryId:form.categoryId,categoryPath:form.categoryPath,template:null,mappings:[],hubSchema:form});
  h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=?,goal=? WHERE id=?').run(flow.offerId,flow.sourceUrl,'work','job');h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify({...h.context,category,settings:{...h.settings,brand:company.name},keywords:''}),'job');
  const source=flow.capturedPage(),fingerprint=await h.load('app/source-inbox.ts').pageSourceFingerprint(source),captureId='00000000-0000-4000-8000-000000000772',api=h.load('app/api/source-inbox/route.ts');
  const post=patch=>api.POST(new Request('https://app.test/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:'owner',expectedCompany:company,id:captureId,fingerprint,snapshot:source,...patch})}));
  assert.equal((await post({expectedOwnerId:'other-owner'})).status,409);assert.equal((await post({expectedCompany:companies.find(other=>other.code!==company.code)})).status,409);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM source_inbox').get().n,0);
  await json(await post({}));const sourceBefore=JSON.stringify(h.sqlite.prepare('SELECT * FROM source_inbox WHERE id=?').get(captureId));
  const ready=await json(await h.load('app/api/source-inbox/ready/route.ts').GET(new Request('https://app.test/api/source-inbox/ready?'+new URLSearchParams({sourceUrl:flow.sourceUrl,captureId,fingerprint,revision:'1'}))));
  const run=async()=>h.load('app/intake-collection.ts').collectIntakeProduct(await h.load('db/collection-jobs.ts').findCollectionJob('owner','job'),{selectedCapture:ready.capture,signal:new AbortController().signal,fetcher:(path,init)=>h.route(path,{method:init?.method??'GET',body:init?.body}),onJob(){},onProgress(){},captureFromBrowser:()=>assert.fail('No browser source'),probeExistingFromBrowser:()=>assert.fail('No source probe')});
  assert.match(await run(),/상품 초안 저장됨/);const linked=await h.load('db/collection-jobs.ts').findCollectionJob('owner','job'),base='/api/products/'+linked.product_id;
  const receipt=await h.load('db/collection-results.ts').readCollectionResult('owner','job'),seo=await json(await h.route(base+'/seo-workspace')),quote=await json(await h.route(base+'/quotation-fields'));
  assert.deepEqual(plain(receipt.result.options).map(row=>[row.color,row.size]),[['黑色','均码'],['灰色','均码']]);
  assert.deepEqual(seo.options.rows.map(row=>[row.originalName,row.translatedName,row.color,row.size,row.provenance.color,row.provenance.size]),[['黑色 / 均码','검정 / 프리','검정','프리','translated','translated'],['灰色 / 均码','회색 / 프리','회색','프리','translated','translated']]);
  for(const [index,option] of seo.options.rows.entries())for(const [label,expected] of [['색상',index?'회색':'검정'],['사이즈','프리']]){
   const fields=quote.resolved.schema.fields.filter(field=>field.section==='product'&&field.visibility==='exposed'&&field.label===label);assert.equal(fields.length,1);
   const field=quote.resolved.rows.find(row=>row.optionId===option.id).fields[fields[0].id];assert.equal(field.value,expected);assert.equal(field.source,'option');
  }
  assert.ok(translatedSources.flatMap(row=>row.attributes).some(row=>row.name==='option-color:collected-1'&&row.value==='黑色'));assert.ok(translatedSources.flatMap(row=>row.attributes).some(row=>row.name==='option-size:collected-1'&&row.value==='均码'));
  const saved=flow.retainedProduct(h,linked.product_id),files=JSON.stringify([...h.objects].map(([key,bytes])=>[key,Buffer.from(bytes).toString('hex')]));assert.match(await run(),/기존 상품 열기/);
  assert.equal(flow.retainedProduct(h,linked.product_id),saved);assert.equal(JSON.stringify([...h.objects].map(([key,bytes])=>[key,Buffer.from(bytes).toString('hex')])),files);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM source_inbox WHERE id=?').get(captureId)),sourceBefore);assert.equal(flow.retainedProduct(h,oldId),oldBefore);assert.equal(Buffer.from(h.objects.get(oldKey)).toString('hex'),oldBytes);
  assert.equal(sourceRequests,0);assert.ok(h.network.every(host=>host==='cbu01.alicdn.com'));assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n,0);assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products WHERE id=?').get(linked.product_id).supplier_hub_status,'미전송');
 }finally{h.close();}
});
