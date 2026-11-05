import test from 'node:test';
import assert from 'node:assert/strict';
import {assetApiFixture,companies,plain} from './helpers/supplier-hub-single-assets.mjs';
import {quotationValidationFixture} from './helpers/quotation-save-validation.mjs';
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
async function setup(company){const f=await assetApiFixture(company,undefined,{productId:'synthetic-saved-quotation-975'});return{...f,path:f.base+'/quotation-fields'+f.query};}
const read=f=>f.h.route(f.path).then(json);
async function save(f,changes){const view=await read(f);return json(await f.h.route(f.path,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));}
const complete=[['taxType','과세'],['kcMarkType','해당사항없음'],['shelfLifeDays','0'],['handlingReason','해당사항없음'],['packagedWeightG','100'],['packagedDimensionsMm','100*100*100']].map(([fieldKey,value])=>({fieldKey,optionId:null,value}));
const summary=async f=>(await f.h.load('db/product-content.ts').readRegistrationSummaries('owner',[await f.h.load('db/queries.ts').findProduct('owner',f.id)]))[f.id];
const source=f=>JSON.stringify(Object.fromEntries(['products','product_content','product_options','product_price_policy','category_profiles','collection_context','collection_results','supplier_hub_receipts'].map(table=>[table,f.h.sqlite.prepare('SELECT * FROM '+table).all()])));

for(const company of companies)test(company.code+': positive field save records exact option validation and completes writing without transmission',async()=>{
 const f=await setup(company);try{
  const saved=await save(f,complete);assert.ok(saved.savedValidation,'a positive server save must return the saved validation projection');
  assert.equal(saved.savedValidation.format,'saved-quotation-validation-v1');assert.equal(saved.savedValidation.revision,saved.revision);assert.equal(saved.savedValidation.productVersion,saved.productVersion);assert.equal(saved.savedValidation.inputFingerprint,saved.inputFingerprint);
  assert.equal(saved.savedValidation.submissionReady,false);assert.equal(saved.savedValidation.registered,false);assert.equal(saved.submissionReady,false);
  assert.deepEqual(saved.savedValidation.rows.filter(row=>row.included).map(row=>[row.optionId,row.errorCount]),[['synthetic-one',0],['synthetic-two',0]]);
  const stored=JSON.parse(f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(f.id).payload);assert.ok(stored.savedValidation);assert.ok(stored.savedValidation.sourceBinding);
  assert.equal((await summary(f)).stages.quotation.state,'complete');assert.match((await summary(f)).stages.quotation.detail,/작성|입력/);assert.deepEqual((await read(f)).savedValidation,saved.savedValidation);assert.deepEqual(f.h.network,[]);
  const partial=await save(f,[{fieldKey:'taxType',optionId:'synthetic-two',value:''}]);assert.equal(partial.savedValidation.rows.find(row=>row.optionId==='synthetic-one').errorCount,0);assert.ok(partial.savedValidation.rows.find(row=>row.optionId==='synthetic-two').errorCount>0);assert.equal((await summary(f)).stages.quotation.state,'pending');
  const options=await f.h.load('db/product-options.ts').readProductOptions('owner',f.id),model=f.h.load('app/product-options.ts');
  const inputs=model.optionInputs(options).map(row=>row.id==='synthetic-two'?{...row,included:false}:row),product=await f.h.load('db/queries.ts').findProduct('owner',f.id);
  await f.h.load('db/product-options.ts').saveProductOptions('owner',model.applyOptionRows(options,inputs,new Date(Date.parse(product.updated_at)+1).toISOString()),options.revision,product.updated_at);
  assert.equal((await summary(f)).stages.quotation.state,'pending','changed option inclusion retires the previous proof');
  const current=await read(f);const checked=await json(await f.h.route(f.path,{method:'POST',body:{action:'validate-saved',expectedRevision:current.revision,expectedInputFingerprint:current.inputFingerprint}}));
  assert.equal(checked.savedValidation.rows.filter(row=>row.included).length,1);assert.equal((await summary(f)).stages.quotation.state,'complete','an excluded invalid option does not block the current included group');
 }finally{f.close();}
});

for(const company of companies)test(company.code+': saved-input recheck refreshes proof after settings drift without rewriting quotation inputs, clocks or source data',async()=>{
 const f=await setup(company);try{
  await save(f,complete);const settings=f.h.sqlite.prepare('SELECT payload FROM workspace_settings WHERE owner_id=?').get('owner'),next=JSON.parse(settings.payload);next.brand='변경한 합성 브랜드';f.h.sqlite.prepare('UPDATE workspace_settings SET payload=? WHERE owner_id=?').run(JSON.stringify(next),'owner');
  const stale=await read(f);assert.equal(stale.savedValidation,undefined);assert.equal((await summary(f)).stages.quotation.state,'pending');
  const before=source(f),stateBefore=JSON.parse(f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(f.id).payload),imageState=f.objectState();
  const checked=await json(await f.h.route(f.path,{method:'POST',body:{action:'validate-saved',expectedRevision:stale.revision,expectedInputFingerprint:stale.inputFingerprint}}));
  assert.ok(checked.savedValidation);assert.equal(checked.revision,stale.revision);assert.equal(checked.productVersion,stale.productVersion);assert.equal(checked.inputFingerprint,stale.inputFingerprint);assert.equal(source(f),before);assert.equal(f.objectState(),imageState);
  const stateAfter=JSON.parse(f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(f.id).payload);delete stateBefore.savedValidation;delete stateAfter.savedValidation;assert.deepEqual(stateAfter,stateBefore);assert.equal((await summary(f)).stages.quotation.state,'complete');assert.deepEqual(f.h.network,[]);
  await json(await f.h.route(f.path,{method:'POST',body:{action:'validate-saved',expectedRevision:stale.revision-1,expectedInputFingerprint:stale.inputFingerprint}}),409);
  f.h.setCompany(companies.find(row=>row.code!==company.code));assert.equal((await summary(f)).stages.quotation.state,'pending','another company cannot use the prior proof');
 }finally{f.close();}
});

test('validation evidence cannot be posted by the client and a metadata CAS race never replays the field save',async()=>{
 const f=await setup(companies[0]);try{
  await save(f,complete);const view=await read(f),beforeSource=source(f),before=f.h.sqlite.prepare('SELECT revision,payload FROM product_quotation_fields WHERE product_id=?').get(f.id);
  await json(await f.h.route(f.path,{method:'POST',body:{action:'validate-saved',expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,savedValidation:{registered:true}}}),400);assert.equal(source(f),beforeSource);
  const prepare=f.h.db.prepare;let raced=false;
  f.h.db.prepare=function(sql){if(!raced&&/^UPDATE product_quotation_fields SET payload=/u.test(sql)){raced=true;f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run(new Date(Date.parse(view.productVersion)+1000).toISOString(),f.id);}return prepare.call(this,sql);};
  await json(await f.h.route(f.path,{method:'POST',body:{action:'validate-saved',expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint}}),409);assert.equal(raced,true);
  const after=f.h.sqlite.prepare('SELECT revision,payload FROM product_quotation_fields WHERE product_id=?').get(f.id);assert.deepEqual(after,before);assert.equal((await summary(f)).stages.quotation.state,'pending');assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('a retired manual validation never borrows another completion source and a new semantic write clears its sidecar',async()=>{
 const f=await setup(companies[0]);try{
  await save(f,complete);const stages=f.h.load('app/registration-stage-status.ts').pendingRegistrationStages();stages.quotation={state:'complete',detail:'별도 실행 근거'};
  f.h.load('db/registration-stage-status.ts').readRegistrationExecutionStages=async()=>({[f.id]:stages});
  const row=f.h.sqlite.prepare('SELECT payload FROM category_profiles WHERE id=?').get(f.profile.id),profile=JSON.parse(row.payload);profile.name='바뀐 양식';f.h.sqlite.prepare('UPDATE category_profiles SET payload=?,revision=revision+1 WHERE id=?').run(JSON.stringify(profile),f.profile.id);
  assert.equal((await read(f)).savedValidation,undefined);assert.equal((await summary(f)).stages.quotation.state,'pending','the retired sidecar cannot be replaced by an unrelated completion claim');
  const saved=await f.h.load('app/quotation-fields-snapshot.ts').stableQuotationFieldsView('owner',f.id,f.profile.id);
  await f.h.load('db/quotation-fields.ts').saveQuotationFields('owner',f.id,saved.view.overrides,saved.view.revision,saved.source,saved.view.categoryContext.categoryId);
  const state=JSON.parse(f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(f.id).payload);assert.equal(state.savedValidation,undefined);assert.deepEqual(f.h.load('app/quotation-scopes.ts').scopedQuotationOverrides(state,saved.view.categoryContext.categoryId),plain(saved.view.overrides));
 }finally{f.close();}
});

for(const company of companies)test(company.code+': changing only saved validation results cannot complete an invalid form in the batched listing',async()=>{
 const f=await setup(company);try{
  await save(f,complete);await save(f,[{fieldKey:'taxType',optionId:'synthetic-two',value:''}]);
  const stored=f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(f.id).payload;
  for(const mutate of [proof=>{proof.rows.forEach(row=>{row.errorCount=0;});},proof=>{proof.rows[1].included=false;},proof=>{proof.categoryId='different-category';},proof=>{proof.inputFingerprint='0'.repeat(64);},proof=>{proof.fieldCount++;},proof=>{proof.schemaReady=false;}]){
   const state=JSON.parse(stored);mutate(state.savedValidation);f.h.sqlite.prepare('UPDATE product_quotation_fields SET payload=? WHERE product_id=?').run(JSON.stringify(state),f.id);
   assert.equal((await read(f)).savedValidation,undefined);assert.equal((await summary(f)).stages.quotation.state,'pending');
  }assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('saved-input recheck rejects a different valid semantic revision produced before its final read',async()=>{
 const f=await setup(companies[0]);try{
  const view=await save(f,complete),db=f.h.load('db/quotation-save-validation.ts'),original=db.saveQuotationValidation;let raced=false;
  db.saveQuotationValidation=async(...args)=>{const stored=await original(...args);if(stored&&!raced){raced=true;await save(f,[{fieldKey:'model',optionId:null,value:'동시 편집의 모델'}]);}return stored;};
  await json(await f.h.route(f.path,{method:'POST',body:{action:'validate-saved',expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint}}),409);
  const current=await read(f);assert.equal(raced,true);assert.equal(current.revision,view.revision+1);assert.equal(current.overrides.common.model,'동시 편집의 모델');assert.ok(current.savedValidation);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('metadata-only validation never changes the semantic automation fingerprint, and empty/excluded option groups remain pending',async()=>{
 const f=await setup(companies[0]);try{
  const view=await save(f,complete),snapshot=await f.h.load('app/quotation-fields-snapshot.ts').stableQuotationFieldsView('owner',f.id,f.profile.id),model=f.h.load('app/automation/model.ts'),product=await f.h.load('db/queries.ts').findProduct('owner',f.id),content=await f.h.load('db/product-content.ts').readProductContent('owner',f.id),settings=JSON.parse(f.h.sqlite.prepare('SELECT payload FROM workspace_settings WHERE owner_id=?').get('owner').payload),without=plain(snapshot.state);delete without.savedValidation;
  assert.equal(await model.automationInputFingerprint(product,settings,content,null,snapshot.options,snapshot.state),await model.automationInputFingerprint(product,settings,content,null,snapshot.options,without));
  const changed=plain(without);changed.revision++;assert.notEqual(await model.automationInputFingerprint(product,settings,content,null,snapshot.options,changed),await model.automationInputFingerprint(product,settings,content,null,snapshot.options,without));
  const validation=f.h.load('app/quotation-save-validation.ts');
  for(const rows of [[],[{optionId:null,included:true,errorCount:0}],view.savedValidation.rows.map(row=>({...row,included:false,errorCount:0}))])assert.equal(validation.savedQuotationValidationStage({...view.savedValidation,globalErrorCount:0,rows}).state,'pending');
 }finally{f.close();}
});

test('optional validation metadata storage failure cannot turn a confirmed input save into a reported failed save',async()=>{
 const f=await setup(companies[0]);try{
  const view=await read(f),db=f.h.load('db/quotation-save-validation.ts');db.saveQuotationValidation=async()=>{throw Error('synthetic optional metadata write failed');};
  const saved=await save(f,complete);assert.equal(saved.revision,view.revision+1);assert.equal(saved.overrides.common.taxType,'과세');assert.equal(saved.savedValidation,undefined);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

for(const company of companies)test(company.code+': metadata recheck preserves export/native source identity and the saved-scopes artifact',async()=>{
 const f=await setup(company);try{
  await save(f,[{fieldKey:'model',optionId:null,value:'합성 전송 모델'}]);const context={params:Promise.resolve({id:f.id})},legal=f.h.load('app/api/products/[id]/legal-documents/route.ts'),legalPath='https://app.test'+f.base+'/legal-documents';
  const documents=await json(await legal.GET(new Request(legalPath),context));
  await json(await legal.PATCH(new Request(legalPath,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:documents.revision,applicability:'not-applicable'})}),context));
  const current=await read(f),exporter=f.h.load('app/exports/quotation-source.ts'),files=f.h.load('app/exports/quotation-fields.ts'),native=f.h.load('app/api/products/[id]/native-assets/route.ts');
  const take=async()=>{const source=await exporter.readQuotationExportSource('owner',f.id,f.profile.id),resolved=exporter.resolveQuotationExport(source),fingerprint=await exporter.quotationExportFingerprint(source,2),assets=f.keys.map((key,index)=>({key,name:'assets/image-'+index+'.png',data:f.h.objects.get(key)})),archive=files.quotationFieldFiles(source,resolved,assets,fingerprint).files.find(file=>file.name==='quotation-saved-scopes.json').data,plan=await json(await native.GET(new Request('https://app.test'+f.base+'/native-assets'+f.query),context));assert.equal(plan.metadataValid,true,JSON.stringify(plan.issues));return{fingerprint,archive,identity:plan.identity,identityDigest:plan.identityDigest,sourcePlanSha256:plan.sourcePlanSha256,preparedBodySha256:plan.preparedBodySha256,originalBodySha256:plan.originalBodySha256};};
  const before=await take();assert.equal(Object.hasOwn(JSON.parse(before.archive).saved,'savedValidation'),false);
  await json(await f.h.route(f.path,{method:'POST',body:{action:'validate-saved',expectedRevision:current.revision,expectedInputFingerprint:current.inputFingerprint}}));
  assert.deepEqual(plain(await take()),plain(before));assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('queryless captured validation retires on source, content, option and capture payload drift even without a clock change',async()=>{
 const f=await quotationValidationFixture(companies[0],{captured:true});try{
  await f.save();const db=f.h.sqlite,restore=[];
  for(const [table,key,column,mutate] of [
   ['products','id','title',value=>value+' 바뀐 원문'],
   ['product_content','product_id','payload',value=>{const state=JSON.parse(value);state.seo.title.value='바뀐 저장 상품명';return JSON.stringify(state);}],
   ['product_options','product_id','payload',value=>{const state=JSON.parse(value);state.rows[1].included=false;return JSON.stringify(state);}],
   ['collection_context','job_id','payload',value=>{const state=JSON.parse(value);state.category.name='바뀐 수집 분류 이름';return JSON.stringify(state);}],
  ]){
   const id=table==='collection_context'?'job':f.id,before=db.prepare(`SELECT ${column} AS value FROM ${table} WHERE ${key}=?`).get(id).value;restore.push(()=>db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${key}=?`).run(before,id));
   db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${key}=?`).run(mutate(before),id);assert.equal((await f.read()).savedValidation,undefined,table);assert.equal((await summary(f)).stages.quotation.state,'pending',table);restore.pop()();assert.ok((await f.read()).savedValidation,table+' restored');
  }assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
