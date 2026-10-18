import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {assetApiFixture,assetSnapshot,companies,plain,sha} from './helpers/supplier-hub-single-assets.mjs';
import {allTables,json} from './helpers/supplier-hub-single-size-chart.mjs';

const native=createRequire(import.meta.url);
const compiledEditor=ts.transpileModule(fs.readFileSync(new URL('../app/components/quotation-fields-editor.tsx',import.meta.url),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
}).outputText;
const change=(fieldKey,value,optionId=null)=>({fieldKey,value,optionId});
const cell=(view,optionId,key)=>view.resolved.rows.find(row=>row.optionId===optionId).fields[key];
const actualIds=view=>view.resolved.rows.filter(row=>row.optionId!==null).map(row=>row.optionId);
const stored=f=>JSON.parse(f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(f.id).payload);
const files=f=>JSON.stringify([...f.h.objects].map(([key,bytes])=>[key,sha(bytes)]));

// Only the unrendered leaf components are omitted. The production save planner,
// every field resolver, the API handlers and all SQLite guards remain real.
function planner(h){
 const exports={};
 vm.runInNewContext(compiledEditor,{exports,Error,URL,TextEncoder,AbortController,structuredClone,
  fetch(){throw Error('No external request is allowed by the save-plan fixture.');},require(name){
   if(name.endsWith('.css')||name.startsWith('@/app/components/'))return {};
   if(name.startsWith('@/app/'))return h.load(name.slice(2)+'.ts');
   return native(name);
  }});
 return exports;
}

function weightSnapshot(company){
 const snapshot=assetSnapshot(company),raw=JSON.parse(snapshot.schemaString);
 raw.properties.logisticsPage.properties.skuUnitBoxWeight={type:'string',title:'한 개 단품 포장 무게',minLength:1,requirement:'필수'};
 snapshot.schemaString=JSON.stringify(raw);return snapshot;
}

async function fixture(company){
 const f=await assetApiFixture(company,weightSnapshot(company)),{h}=f;
 const endpoint=f.base+'/quotation-fields'+f.query;
 const view=()=>h.route(endpoint).then(json);
 const save=(current,changes)=>h.route(endpoint,{method:'PUT',body:{expectedRevision:current.revision,expectedInputFingerprint:current.inputFingerprint,changes}});
 const weight=f.byWire(['logisticsPage','skuUnitBoxWeight']);assert.ok(weight);
 const editor=planner(h);
 const alternateSchema=h.load('app/quotation-schema.ts').getQuotationSchema('80719');
 const alternate=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{
  name:'SYNTHETIC 714 preserved category',categoryId:'80719',categoryPath:plain(alternateSchema.categoryPath),template:null,mappings:[],
 },'synthetic-other-category-714');
 const alternateEndpoint=f.base+'/quotation-fields?profileId='+alternate.id;
 const alternateView=await json(await h.route(alternateEndpoint));
 await json(await h.route(alternateEndpoint,{method:'PUT',body:{expectedRevision:alternateView.revision,expectedInputFingerprint:alternateView.inputFingerprint,
  changes:[change('title','다른 카테고리에 저장한 상품명'),change('brand','다른 카테고리 옵션 브랜드','synthetic-excluded')]}}));

 // Both approved companies have real independent products and category records
 // in this same SQLite database. A save must not touch the other company's row.
 const other=companies.find(item=>item.code!==company.code),otherId='synthetic-other-company-714';
 const product=h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.id);
 const policy=h.load('app/pricing.ts').pricePolicy(h.settings);
 await h.load('db/queries.ts').insertProduct({...product,id:otherId,source_url:'synthetic://step714-other-company',title:'다른 회사 원문'},policy);
 const content=h.load('app/product-content.ts').applyContentPatch(h.load('app/product-content.ts').emptyProductContent(otherId),{seo:{title:'다른 회사 콘텐츠'}},new Date().toISOString());
 await h.load('db/product-content.ts').saveProductContent('owner',content,0);
 const otherSchema=weightSnapshot(other),otherProfile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{
  name:'SYNTHETIC 714 other approved company',categoryId:otherSchema.categoryId,categoryPath:otherSchema.categoryPath,hubSchema:otherSchema,template:null,mappings:[],
 },'synthetic-other-company-profile-714');
 const otherEndpoint='/api/products/'+otherId+'/quotation-fields?profileId='+otherProfile.id;
 h.setCompany(other);
 const otherView=await json(await h.route(otherEndpoint));
 await json(await h.route(otherEndpoint,{method:'PUT',body:{expectedRevision:otherView.revision,expectedInputFingerprint:otherView.inputFingerprint,
  changes:[change('title','다른 회사에서 검토한 견적 상품명')]}}));
 h.setCompany(company);
 return {...f,endpoint,view,save,editor,weight,alternateEndpoint,otherEndpoint,otherId};
}

// Save legitimately advances the primary quotation revision and product clock.
// Everything else, including the other company's complete product, stays exact.
function protectedState(f){
 const {h}=f;
 const tables=h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('products','product_quotation_fields') ORDER BY name").all();
 const source=tables.map(({name})=>[name,h.sqlite.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]);
 const products=h.sqlite.prepare('SELECT * FROM products ORDER BY rowid').all().map(row=>{
  if(row.id!==f.id)return row;
  const rest={...row};delete rest.updated_at;delete rest.quote_status;return rest;
 });
 const otherQuotations=h.sqlite.prepare('SELECT * FROM product_quotation_fields WHERE product_id<>? ORDER BY rowid').all(f.id);
 return JSON.stringify({source,products,otherQuotations,files:files(f),network:h.network,ai:h.aiSources});
}

for(const company of companies)test(`all-option primary save persists only selected pending fields in every actual row (${company.code})`,async()=>{
 const f=await fixture(company),{h,editor}=f;
 try{
  let view=await f.view();
  const ids=actualIds(view),selected=ids[0],second=ids[1],excluded=ids[2];
  assert.deepEqual(view.resolved.rows.filter(row=>row.optionId!==null).map(row=>row.included),[true,true,false]);
  const manufacturer=f.byWire(['productPage','manufacturer']),brand=f.byWire(['productPage','brand']);
  assert.ok(manufacturer);assert.ok(brand);
  view=await json(await f.save(view,[change('title','보존할 공통 상품명'),change(manufacturer,'보존할 공통 제조사'),
   ...ids.flatMap((id,index)=>[change(brand,'옵션별 기존 브랜드 '+index,id),change('title','옵션별 기존 제목 '+index,id)])]));
  const common=plain(view.overrides.common),otherScope=plain(stored(f).categoryOverrides['category:80719']);
  const stable=protectedState(f),beforeAll=allTables(f),beforeFiles=files(f),beforeView=JSON.stringify(view),beforeCalls=h.calls.length;
  const pending=[change('title','현재 옵션에서 검토한 상품명',selected),change(manufacturer,'',selected),
   change(brand,'다른 옵션에서 아직 저장하지 않은 브랜드',second),change('model','별도의 공통 대기 수정')];
  const pendingBefore=JSON.stringify(pending);
  const off=editor.quotationSavePlan(view,pending,selected,false),on=editor.quotationSavePlan(view,pending,selected,true);
  editor.quotationSavePlan(view,pending,selected,false);
  assert.deepEqual(plain(off.changes),pending);
  assert.deepEqual(plain(off.propagated),[]);
  assert.equal(on.propagated.length,4);
  assert.equal(on.propagated.filter(item=>item.included===false).length,2);
  assert.ok(on.propagated.every(item=>['title',manufacturer].includes(item.fieldKey)));
  assert.equal(on.changes.filter(item=>item.fieldKey===brand).length,1,'unrelated pending target edit is saved once, never copied');
  assert.equal(on.changes.filter(item=>item.fieldKey==='model').length,1,'common pending edit remains common');
  assert.equal(allTables(f),beforeAll,'switch/preview cannot write SQLite');
  assert.equal(h.calls.length,beforeCalls,'switch/preview cannot issue even a local request');
  assert.equal(files(f),beforeFiles);assert.equal(JSON.stringify(view),beforeView);assert.equal(JSON.stringify(pending),pendingBefore);

  const saved=await json(await f.save(view,on.changes));
  assert.equal(saved.revision,view.revision+1);
  assert.equal(h.calls.length,beforeCalls+1,'only the explicit save issued a request after local plan previews');
  assert.deepEqual(plain(saved.overrides.common),{...common,model:'별도의 공통 대기 수정'});
  for(const id of ids){
   assert.equal(cell(saved,id,'title').value,'현재 옵션에서 검토한 상품명');assert.equal(cell(saved,id,'title').source,'manual-option');
   assert.equal(cell(saved,id,manufacturer).value,'');assert.equal(cell(saved,id,manufacturer).source,'manual-option');
   assert.equal(cell(saved,id,brand).value,id===second?'다른 옵션에서 아직 저장하지 않은 브랜드':'옵션별 기존 브랜드 '+ids.indexOf(id));
  }
  assert.deepEqual(saved.resolved.rows.filter(row=>row.optionId!==null).map(row=>row.included),[true,true,false]);
  assert.equal(cell(saved,null,'title').value,'보존할 공통 상품명');
  assert.deepEqual(plain(stored(f).categoryOverrides['category:80719']),otherScope);
  assert.equal(protectedState(f),stable,'only this category quotation override and its product metadata changed');
  const reloaded=await f.view();assert.deepEqual(reloaded.overrides,saved.overrides);assert.equal(reloaded.revision,saved.revision);

  // An excluded row is a valid source. Restore deletes each targeted override
  // and falls back to the preserved common values without changing inclusion.
  const reset=editor.quotationSavePlan(reloaded,[change('title',null,excluded),change(manufacturer,null,excluded)],excluded,true);
  const restored=await json(await f.save(reloaded,reset.changes));
  for(const id of ids){
   assert.equal(Object.hasOwn(restored.overrides.options[id]??{},'title'),false);
   assert.equal(Object.hasOwn(restored.overrides.options[id]??{},manufacturer),false);
   assert.equal(cell(restored,id,'title').value,'보존할 공통 상품명');assert.equal(cell(restored,id,'title').source,'manual-common');
   assert.equal(cell(restored,id,manufacturer).value,'보존할 공통 제조사');
  }
  assert.equal(cell(restored,excluded,brand).value,'옵션별 기존 브랜드 2');
  assert.equal(restored.resolved.rows.find(row=>row.optionId===excluded).included,false);
  assert.equal(protectedState(f),stable);
  assert.deepEqual(plain(stored(f).categoryOverrides['category:80719']),otherScope);
  const beforeOtherAttempt=allTables(f);
  const otherRejected=await json(await h.route(f.otherEndpoint,{method:'PUT',body:{expectedRevision:restored.revision,expectedInputFingerprint:restored.inputFingerprint,changes:on.changes}}),409);
  assert.equal(otherRejected.code,'QUOTATION_COMPANY_MISMATCH');assert.equal(allTables(f),beforeOtherAttempt);
  assert.equal(h.network.length,0);assert.equal(h.aiSources.length,0);
 }finally{f.close();}
});

for(const company of companies)test(`all-option price/weight peers save atomically and stale source/revision guards reject (${company.code})`,async()=>{
 const f=await fixture(company),{h,editor}=f;
 try{
  let view=await f.view();const ids=actualIds(view),excluded=ids.at(-1);
  const targets=h.load('app/quotation-price-targets.ts').quotationPriceTargets(view.resolved.schema.fields);
  assert.ok(targets.supplyPrice.linked.length>1);assert.notEqual(f.weight,'packagedWeightG');
  const common=plain(view.overrides.common),stable=protectedState(f);
  const draft=[change(targets.supplyPrice.primary,'13000',excluded),change(targets.salePrice.primary,'21000',excluded),change(f.weight,'450',excluded)];
  const before=allTables(f),beforeCalls=h.calls.length,plan=editor.quotationSavePlan(view,draft,excluded,true);
  assert.equal(allTables(f),before);assert.equal(h.calls.length,beforeCalls);assert.equal(plan.propagated.length,12);
  let saved=await json(await f.save(view,plan.changes));
  assert.equal(saved.revision,view.revision+1);assert.deepEqual(plain(saved.overrides.common),common);
  for(const id of ids){
   for(const key of targets.supplyPrice.linked)assert.equal(saved.overrides.options[id][key],'13000');
   for(const key of targets.salePrice.linked)assert.equal(saved.overrides.options[id][key],'21000');
   for(const key of ['packagedWeightG',f.weight])assert.equal(saved.overrides.options[id][key],'450');
  }
  assert.equal(saved.resolved.rows.find(row=>row.optionId===excluded).included,false);
  assert.equal(protectedState(f),stable,'price copies change quotation fields, not stored source prices or packaging facts');
  const acknowledged=h.load('app/quotation-fields-confirmation.ts').confirmQuotationFieldsSave(view,saved,plan.changes);
  assert.equal(acknowledged,saved);
  const afterSave=allTables(f),objects=files(f);
  const revisionFailure=await json(await f.save(view,plan.changes),409);
  assert.equal(revisionFailure.code,'QUOTATION_FIELDS_CONFLICT');assert.equal(allTables(f),afterSave);assert.equal(files(f),objects);

  const blankPlan=editor.quotationSavePlan(saved,[change(f.weight,'',excluded)],excluded,true);
  const blank=await json(await f.save(saved,blankPlan.changes));
  for(const id of ids)for(const key of ['packagedWeightG',f.weight]){
   assert.equal(blank.overrides.options[id][key],'');assert.equal(cell(blank,id,key).source,'manual-option');
  }
  const resetPlan=editor.quotationSavePlan(blank,[change(targets.supplyPrice.primary,null,excluded),change(targets.salePrice.primary,null,excluded),
   change(f.weight,null,excluded),change('packagedWeightG',null,excluded)],excluded,true);
  saved=await json(await f.save(blank,resetPlan.changes));
  for(const id of ids){
   for(const key of [...targets.supplyPrice.linked,...targets.salePrice.linked,'packagedWeightG',f.weight])assert.equal(Object.hasOwn(saved.overrides.options[id]??{},key),false);
   assert.equal(cell(saved,id,targets.supplyPrice.primary).value,common[targets.supplyPrice.primary]);
   for(const key of ['packagedWeightG',f.weight])assert.deepEqual(cell(saved,id,key),saved.automatic.rows.find(row=>row.optionId===id).fields[key]);
  }
  assert.deepEqual(plain(saved.overrides.common),common);assert.equal(protectedState(f),stable);

  // A stale input fingerprint cannot be rescued by a current quotation revision.
  view=await f.view();
  const content=await h.load('db/product-content.ts').readProductContent('owner',f.id);
  const changed=h.load('app/product-content.ts').applyContentPatch(content,{seo:{title:'명시적으로 바꾼 원본 콘텐츠'}},new Date().toISOString());
  await h.load('db/product-content.ts').saveProductContent('owner',changed,content.revision);
  const afterSource=allTables(f),sourcePlan=editor.quotationSavePlan(view,[change('title','오래된 화면의 대기값',excluded)],excluded,true);
  const sourceFailure=await json(await f.save(view,sourcePlan.changes),409);
  assert.equal(sourceFailure.code,'QUOTATION_FIELDS_CONFLICT');assert.equal(allTables(f),afterSource);assert.equal(files(f),objects);
  const current=await f.view();assert.equal(current.revision,saved.revision);assert.notEqual(current.inputFingerprint,view.inputFingerprint);
  assert.deepEqual(current.overrides,saved.overrides);assert.equal(h.network.length,0);assert.equal(h.aiSources.length,0);
 }finally{f.close();}
});
