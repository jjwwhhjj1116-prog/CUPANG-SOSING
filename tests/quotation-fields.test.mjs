import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';

function modules(env, mode='development', owner='owner') {
  const cache=new Map();
  function load(file) {
    if(cache.has(file))return cache.get(file);
    const code=ts.transpileModule(fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const exports={};cache.set(file,exports);
    vm.runInNewContext(code,{exports,Error,crypto,URL,Response,Request,TextEncoder,TextDecoder,Uint8Array,DataView,structuredClone,process:{env:{NODE_ENV:mode}},require(name){
      if(name==='next/server')return {NextResponse:Response};
      if(name==='cloudflare:workers')return {env};
      if(name==='@/app/chatgpt-auth')return {getChatGPTUser:async()=>({userId:owner}),getWorkspaceOwnerId:async()=>owner};
      if(name.startsWith('@/'))return load(name.slice(2)+'.ts');
      throw Error(name);
    }},{filename:file});return exports;
  }
  return load;
}
const version='2999-01-01T00:00:00.000Z';
const product={id:'product',owner_id:'owner',source_url:'https://detail.1688.com/offer/123456789.html',title:'LOCAL TEST ONLY',source_price_cny:10,exchange_rate:100,supply_margin:0,coupang_margin:0,supply_price:1000,sale_price:1000,msrp:1300,options_count:1,seo_status:'대기',image_status:'대기',quote_status:'대기',registration_status:'수동 입력',supplier_hub_status:'미전송',image_keys:'["owner/image.png"]',goal_stage:'collect',created_at:version,updated_at:version};
async function harness() {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of ['0001_sourceflow_bootstrap.sql','0002_quotation_fields.sql'])sqlite.exec(fs.readFileSync(new URL('../db/migrations/'+file,import.meta.url),'utf8'));
  let beforeSave=null;
  const db={prepare(sql){let args=[];const query={sql,bind(...values){args=values;return query;},execute(){return sqlite.prepare(sql).all(...args);},async first(){return query.execute()[0]??null;},async all(){return {results:query.execute()};},async run(){return sqlite.prepare(sql).run(...args);}};return query;},
    async batch(queries){if(beforeSave&&queries.some(query=>query.sql.startsWith('INSERT INTO product_quotation_fields'))){const callback=beforeSave;beforeSave=null;callback();}sqlite.exec('BEGIN');try{const result=queries.map(query=>({results:query.execute()}));sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  const env={DB:db};const load=modules(env);const queries=load('db/queries.ts');await queries.insertProduct(product);
  return {sqlite,env,load,queries,store:load('db/quotation-fields.ts'),route:load('app/api/products/[id]/quotation-fields/route.ts'),setBeforeSave(callback){beforeSave=callback;}};
}
const context={params:Promise.resolve({id:'product'})};
const request=(body,profileId)=>new Request('http://localhost/api/products/product/quotation-fields'+(profileId?'?profileId='+profileId:''),{method:body?'PUT':'GET',headers:{'content-type':'application/json',origin:'http://localhost'},...(body?{body:JSON.stringify(body)}:{})});
async function get(h,profileId){const response=await h.route.GET(request(null,profileId),context);assert.equal(response.status,200,await response.clone().text());return response.json();}
function put(h,view,changes,profileId){return h.route.PUT(request({expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes},profileId),context);}
async function profile(h,id='80719'){return h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'LOCAL TEST category',categoryId:id,categoryPath:id==='80719'?['주방용품','주방수납/정리','주방수납바구니/바스켓']:['미확인 카테고리'],template:null,mappings:[]});}
const baseGuard=()=>({productVersion:version,imageKeys:product.image_keys,pricingPolicy:null,contentRevision:0,optionRevision:0,settingsPayload:null,profile:null,collection:null});

async function linkedFixture(h) {
 const selected=await profile(h);const settings=h.load('app/workspace-settings.ts').defaultSettings;
 const jobs=await h.load('db/collection-jobs.ts').enqueueCollection('owner',[{offerId:'123456789',sourceUrl:product.source_url,goal:'work'}],{category:selected,settings,features:'',keywords:'',capturedAt:version});
 h.sqlite.prepare('INSERT INTO collection_products VALUES(?,?,?,?)').run(jobs[0].id,'owner','product',version);
 return jobs[0];
}

test('product-bound category is shared by editor and export and missing context never falls back',async()=>{
 const h=await harness();try{
  const job=await linkedFixture(h);const view=await get(h);
  const exports=h.load('app/exports/quotation-source.ts');const saved=await exports.readQuotationExportSource('owner','product',null);
  assert.equal(saved.source.collection.snapshot.linked,true);assert.equal(saved.source.collection.snapshot.id,job.id);
  assert.deepEqual(JSON.parse(JSON.stringify(exports.resolveQuotationExport(saved))),view.resolved);
  h.sqlite.prepare('DELETE FROM collection_context WHERE job_id=?').run(job.id);
  await assert.rejects(()=>h.store.readQuotationCollectionSource('owner','123456789','product'),/카테고리 원문/);
  assert.equal((await h.route.GET(request(),context)).status,503);
  assert.equal(await h.store.readQuotationCollectionSource('other','123456789','product'),null);
 }finally{h.sqlite.close();}
});

test('category link removal between read and save rejects writes and preserves quotation draft',async()=>{
 const h=await harness();try{
  const job=await linkedFixture(h);const view=await get(h);
  h.setBeforeSave(()=>h.sqlite.prepare('DELETE FROM collection_products WHERE job_id=?').run(job.id));
  const result=await put(h,view,[{fieldKey:'brand',optionId:null,value:'must not save'}]);
  assert.equal(result.status,409);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM product_quotation_fields').get().n,0);
 }finally{h.sqlite.close();}
});

test('saved SEO, option pricing and stage image changes reach editor and export while manual quotation values survive',async()=>{
 const h=await harness();try{
  await linkedFixture(h);let before=await get(h);
  const response=await put(h,before,[{fieldKey:'taxType',optionId:null,value:'면세'}]);assert.equal(response.status,200);
  const content=h.load('app/product-content.ts').emptyProductContent('product');content.revision=1;content.updatedAt=version;
  content.seo.title.value='수정된 SEO 상품명';content.seo.keywords.value=['검색어'];content.seo.description.value='수정 상세 설명';
  for(const role of ['main','additional','detail','label'])content.assets[role].value=['owner/image.png'];
  content.label.countryOfOrigin.value='확인 제조국';
  h.sqlite.prepare('INSERT INTO product_content VALUES(?,?,?,?,?)').run('product','owner',1,JSON.stringify(content),version);
  const optionsModel=h.load('app/product-options.ts');
  const options=optionsModel.applyOptionRows(optionsModel.emptyProductOptions('product'),[{...optionsModel.emptyOptionInput('one'),unitCostCny:4,included:true,unitsPerPack:2}],version);
  h.sqlite.prepare('INSERT INTO product_options VALUES(?,?,?,?,?)').run('product','owner',1,JSON.stringify(options),version);
  const view=await get(h);assert.notEqual(view.inputFingerprint,before.inputFingerprint);
  const row=view.resolved.rows.find(row=>row.optionId==='one');
  for(const [id,value] of Object.entries({title:'수정된 SEO 상품명',searchTags:'검색어',quantity:'2',taxType:'면세',noticeCountryOfOrigin:'확인 제조국'}))assert.equal(row.fields[id].value,value);
  for(const id of ['mainImage','additionalImages','detailImages','labelImages'])assert.equal(row.fields[id].value,'owner/image.png');
  assert.match(row.fields.detailHtml.value,/수정 상세 설명/);assert.equal(row.fields.supplyPrice.source,'pricing');
  const exports=h.load('app/exports/quotation-source.ts');const saved=await exports.readQuotationExportSource('owner','product',null);
  assert.deepEqual(JSON.parse(JSON.stringify(exports.resolveQuotationExport(saved))),view.resolved);
 }finally{h.sqlite.close();}
});

test('unsaved and partial settings do not inject example registration facts into editor or export',async()=>{
 const h=await harness();try{
  const selected=await profile(h);
  for(const payload of [null,{exchangeRate:200},{brand:'실제 브랜드',manufacturer:'실제 제조사'}]){
   if(payload)await h.queries.saveSettings('owner',JSON.stringify(payload));
   const view=await get(h,selected.id);
   const fields=view.resolved.rows[0].fields;
   assert.equal(fields.brand.value,payload?.brand??'');assert.equal(fields.manufacturer.value,payload?.manufacturer??'');
   assert.equal(fields.tradeType.value,'');assert.equal(fields.importType.value,'');
   const exports=h.load('app/exports/quotation-source.ts');
   const saved=await exports.readQuotationExportSource('owner','product',selected.id);
   assert.equal(saved.settings.importer,'');assert.equal(saved.settings.serviceContact,'');
   assert.equal(saved.settings.exchangeRate,payload?.exchangeRate??190);
   assert.deepEqual(JSON.parse(JSON.stringify(exports.resolveQuotationExport(saved))),view.resolved);
  }
 }finally{h.sqlite.close();}
});

test('price policy remains valid without registration facts and still rejects malformed price inputs',async()=>{
 const h=await harness();try{
  const settingsModel=h.load('app/workspace-settings.ts');
  const options=h.load('app/product-options.ts');
  const empty=settingsModel.savedRegistrationSettings(null);
  assert.equal(empty.brand,'');assert.equal(empty.tradeType,'');
  const actual=options.resolveOptionPricePolicy(product,empty);
  const baseline=options.resolveOptionPricePolicy(product,settingsModel.defaultSettings);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)),JSON.parse(JSON.stringify(baseline)));
  for(const change of [{roundingUnit:7},{minimumMarginEnabled:'false'},{minimumMargin:-1}])assert.throws(()=>options.resolveOptionPricePolicy(product,{...empty,...change}));
  assert.throws(()=>settingsModel.savedRegistrationSettings({tradeType:'invalid'}));
  assert.equal(settingsModel.defaultSettings.brand,'SourceFlow Select');
 }finally{h.sqlite.close();}
});

test('GET resolves latest saved sources and collection category without creating overrides or claiming submission readiness',async()=>{
  const h=await harness();try{
    const selected=await profile(h);const settings=h.load('app/workspace-settings.ts').defaultSettings;
    await h.queries.saveSettings('owner',JSON.stringify({...settings,brand:'저장 브랜드'}));
    await h.load('db/collection-jobs.ts').enqueueCollection('owner',[{offerId:'123456789',sourceUrl:product.source_url,goal:'work'}],{category:selected,settings,features:'',keywords:'',capturedAt:version});
    const view=await get(h);assert.equal(view.categoryContext.source,'collection');assert.equal(view.resolved.schema.categoryId,'80719');
    assert.equal(view.resolved.rows[0].fields.brand.value,'저장 브랜드');assert.equal(view.resolved.rows[0].fields.brand.source,'settings');
    assert.equal(view.revision,0);assert.equal(view.submissionReady,false);assert.equal(view.resolved.schema.submissionReady,false);
    assert.deepEqual(view.imageKeys,['owner/image.png']);assert.equal(view.inputFingerprint.length,64);
    assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS total FROM product_quotation_fields').get().total,0);
  }finally{h.sqlite.close();}
});

test('common and multiple option overrides save atomically, survive new automatic settings and distinguish blank from reset',async()=>{
  const h=await harness();try{
    const selected=await profile(h);const optionModel=h.load('app/product-options.ts');
    const options=optionModel.applyOptionRows(optionModel.emptyProductOptions('product'),['one','two'].map(id=>({...optionModel.emptyOptionInput(id),originalName:'LOCAL '+id,included:true,unitCostCny:2})),version);
    h.sqlite.prepare('INSERT INTO product_options VALUES (?,?,?,?,?)').run('product','owner',1,JSON.stringify(options),version);
    let view=await get(h,selected.id);
    const saved=await put(h,view,[{fieldKey:'brand',optionId:null,value:'공통 직접 입력'},{fieldKey:'model',optionId:'one',value:'모델 A'},{fieldKey:'model',optionId:'two',value:'모델 B'},{fieldKey:'manufacturer',optionId:null,value:''}],selected.id);
    assert.equal(saved.status,200);view=await saved.json();assert.equal(view.revision,1);assert.ok(view.productVersion>version);
    assert.equal(view.resolved.rows.find(row=>row.optionId==='one').fields.model.value,'모델 A');assert.equal(view.resolved.rows.find(row=>row.optionId==='two').fields.model.value,'모델 B');
    const settings=h.load('app/workspace-settings.ts').defaultSettings;
    await h.queries.saveSettings('owner',JSON.stringify({...settings,brand:'새 자동 브랜드',manufacturer:'새 자동 제조사'}));
    const newer=await get(h,selected.id);assert.notEqual(newer.inputFingerprint,view.inputFingerprint);
    assert.equal(newer.resolved.rows[0].fields.brand.value,'공통 직접 입력');assert.equal(newer.resolved.rows[0].fields.manufacturer.value,'');assert.equal(newer.automatic.rows[0].fields.brand.value,'새 자동 브랜드');
    const restored=await put(h,newer,[{fieldKey:'brand',optionId:null,value:null}],selected.id);assert.equal(restored.status,200);
    const final=await restored.json();assert.equal(final.resolved.rows[0].fields.brand.value,'새 자동 브랜드');assert.equal(final.overrides.options.one.model,'모델 A');assert.equal(final.overrides.common.manufacturer,'');
    assert.equal(final.submissionReady,false);
  }finally{h.sqlite.close();}
});

test('competing SQLite writers accept one revision and never partially apply another option batch',async()=>{
  const h=await harness();try{
    const first={common:{title:'first'},options:{one:{model:'A'},two:{model:'B'}}};
    const second={common:{title:'second'},options:{one:{model:'C'},two:{model:'D'}}};
    const result=await Promise.all([h.store.saveQuotationFields('owner','product',first,0,baseGuard()),h.store.saveQuotationFields('owner','product',second,0,baseGuard())]);
    assert.equal(result.filter(Boolean).length,1);
    const saved=await h.store.readQuotationFields('owner','product');assert.equal(saved.revision,1);assert.equal(JSON.stringify(saved.overrides),JSON.stringify(result.find(Boolean).overrides));
    assert.equal(await h.store.saveQuotationFields('owner','product',second,0,baseGuard()),null);
    assert.equal((await h.store.readQuotationFields('other','product')).revision,0);
    assert.equal(await h.store.saveQuotationFields('other','product',second,0,baseGuard()),null);
  }finally{h.sqlite.close();}
});

test('SQLite save compares product, image, price-policy, content, options and settings sources in the commit statement',async()=>{
  for(const mutate of [
    db=>db.prepare('UPDATE products SET updated_at=?').run('2999-01-02T00:00:00.000Z'),
    db=>db.prepare('UPDATE products SET image_keys=?').run('[]'),
    db=>db.prepare('INSERT INTO product_price_policy VALUES (?,?)').run('product','{"changed":true}'),
    db=>db.prepare('INSERT INTO product_content VALUES (?,?,?,?,?)').run('product','owner',1,'{}',version),
    db=>db.prepare('INSERT INTO product_options VALUES (?,?,?,?,?)').run('product','owner',1,'{}',version),
    db=>db.prepare('INSERT INTO workspace_settings VALUES (?,?,?)').run('owner','{"changed":true}',version),
  ]){const h=await harness();try{mutate(h.sqlite);assert.equal(await h.store.saveQuotationFields('owner','product',{common:{title:'stale'},options:{}},0,baseGuard()),null);assert.equal((await h.store.readQuotationFields('owner','product')).revision,0);}finally{h.sqlite.close();}}
});

test('profile and collection snapshot races reject saves, including a newly attached collection context',async()=>{
  const h=await harness();try{
    const selected=await profile(h);const guard={...baseGuard(),profile:{id:selected.id,revision:selected.revision}};
    h.sqlite.prepare('UPDATE category_profiles SET revision=revision+1 WHERE id=?').run(selected.id);
    assert.equal(await h.store.saveQuotationFields('owner','product',{common:{},options:{}},0,guard),null);
    const collectionGuard={...baseGuard(),collection:{offerId:'123456789',snapshot:null}};
    const jobs=await h.load('db/collection-jobs.ts').enqueueCollection('owner',[{offerId:'123456789',sourceUrl:product.source_url,goal:'work'}],{category:selected,settings:h.load('app/workspace-settings.ts').defaultSettings,features:'',keywords:'',capturedAt:version});
    assert.equal(await h.store.saveQuotationFields('owner','product',{common:{},options:{}},0,collectionGuard),null);
    const snapshot=await h.store.readQuotationCollectionSource('owner','123456789');assert.ok(snapshot);
    await h.load('db/collection-jobs.ts').cancelCollection('owner',jobs[0].id);
    assert.equal(await h.store.saveQuotationFields('owner','product',{common:{},options:{}},0,{...baseGuard(),collection:{offerId:'123456789',snapshot}}),null);
    assert.equal(await h.store.readQuotationCollectionSource('other','123456789'),null);
  }finally{h.sqlite.close();}
});

test('API stale inputs, stale editor revisions and changes during final commit return 409 without replacing edits',async()=>{
  const h=await harness();try{
    const view=await get(h);
    h.setBeforeSave(()=>h.sqlite.prepare('INSERT INTO workspace_settings VALUES (?,?,?)').run('owner','{}',version));
    assert.equal((await put(h,view,[{fieldKey:'title',optionId:null,value:'stale title'}])).status,409);
    assert.equal((await h.store.readQuotationFields('owner','product')).revision,0);
    assert.equal((await put(h,view,[{fieldKey:'title',optionId:null,value:'still stale'}])).status,409);
    const latest=await get(h);const success=await put(h,latest,[{fieldKey:'title',optionId:null,value:'saved title'}]);assert.equal(success.status,200);
    assert.equal((await put(h,latest,[{fieldKey:'title',optionId:null,value:'second editor'}])).status,409);
    assert.equal((await h.store.readQuotationFields('owner','product')).overrides.common.title,'saved title');
  }finally{h.sqlite.close();}
});

test('validation rejects unknown fields, readonly category, foreign options/images and malformed requests before storage',async()=>{
  const h=await harness();try{
    const view=await get(h);
    for(const changes of [[{fieldKey:'unconfirmed-category-field',optionId:null,value:'x'}],[{fieldKey:'category',optionId:null,value:'80719'}],[{fieldKey:'title',optionId:'foreign-option',value:'x'}],[{fieldKey:'mainImage',optionId:null,value:'other/image.png'}],[{fieldKey:'mainImage',optionId:null,value:'owner/missing.png'}]])assert.equal((await put(h,view,changes)).status,400);
    const requestBody={expectedRevision:0,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:'title',optionId:null,value:'value'}]};
    assert.equal((await h.route.PUT(request({...requestBody,submissionReady:true}),context)).status,400);
    assert.equal((await h.route.PUT(new Request('http://localhost',{method:'PUT',headers:{'content-type':'application/json',origin:'https://foreign.invalid'},body:JSON.stringify(requestBody)}),context)).status,400);
    assert.equal((await h.route.PUT(new Request('http://localhost',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({...requestBody,changes:'x'.repeat(513*1024)})}),context)).status,413);
    assert.equal((await h.store.readQuotationFields('owner','product')).revision,0);
  }finally{h.sqlite.close();}
});

test('owner isolation and production authentication remain closed before quotation access',async()=>{
  const h=await harness();try{
    const foreign=modules(h.env,'development','other')('app/api/products/[id]/quotation-fields/route.ts');
    assert.equal((await foreign.GET(request(),context)).status,404);
    const selected=await profile(h);h.sqlite.prepare('UPDATE category_profiles SET owner_id=? WHERE id=?').run('other',selected.id);
    assert.equal((await h.route.GET(request(null,selected.id),context)).status,404);
    const closed=modules({},'production')('app/api/products/[id]/quotation-fields/route.ts');
    assert.equal((await closed.GET(request(),context)).status,503);assert.equal((await closed.PUT(request({}),context)).status,503);
  }finally{h.sqlite.close();}
});

test('switching to an unconfirmed category preserves hidden prior overrides without treating its fields as verified',async()=>{
  const h=await harness();try{
    const known=await profile(h);const unknown=await profile(h,'99999');
    const initial=await get(h,known.id);assert.equal((await put(h,initial,[{fieldKey:'color',optionId:null,value:'직접 입력한 색상'}],known.id)).status,200);
    const changed=await get(h,unknown.id);assert.equal(changed.resolved.schema.status,'unconfirmed');assert.ok(!changed.resolved.schema.fields.some(field=>field.id==='color'));assert.equal(changed.overrides.common.color,'직접 입력한 색상');
    assert.equal((await put(h,changed,[{fieldKey:'title',optionId:null,value:'공통 제목'}],unknown.id)).status,200);
    const restored=await get(h,known.id);assert.equal(restored.resolved.rows[0].fields.color.value,'직접 입력한 색상');assert.equal(restored.overrides.common.title,'공통 제목');
  }finally{h.sqlite.close();}
});

test('80719 API validates barcode edits against the stored input mode without overwriting saved values', async () => {
  const h = await harness(); try {
    const selected = await profile(h); let view = await get(h, selected.id);
    let response = await put(h, view, [{ fieldKey: 'barcodeMode', optionId: null, value: 'existing' }, { fieldKey: 'barcode', optionId: null, value: 'ABC123' }], selected.id);
    assert.equal(response.status, 200); view = await response.json();
    response = await put(h, view, [{ fieldKey: 'barcode', optionId: null, value: 'abc123' }, { fieldKey: 'brand', optionId: null, value: 'must not save' }], selected.id);
    assert.equal(response.status, 400); assert.match((await response.json()).error, /바코드/);
    const unchanged = await get(h, selected.id); assert.equal(unchanged.revision, view.revision); assert.equal(unchanged.overrides.common.barcode, 'ABC123'); assert.equal(unchanged.overrides.common.brand, undefined);
    response = await put(h, unchanged, [{ fieldKey: 'barcode', optionId: null, value: '-AB--1' }], selected.id);
    assert.equal(response.status, 200); assert.equal((await response.json()).overrides.common.barcode, '-AB--1');
  } finally { h.sqlite.close(); }
});
