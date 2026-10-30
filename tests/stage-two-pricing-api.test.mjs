import test from 'node:test';
import assert from 'node:assert/strict';
import {stageTwoFixture,companies,json,plain} from './helpers/stage-two-pricing.mjs';

for(const company of companies)test(`explicit unchanged save preserves arithmetic and sources, records a real review and survives unrelated quotation editing (${company.code})`,async()=>{
 const h=await stageTwoFixture(company);try{
  const legacy=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_price_policy WHERE product_id=?').get(h.id).payload);delete legacy.recalculationMode;
  h.sqlite.prepare('UPDATE product_price_policy SET payload=? WHERE product_id=?').run(JSON.stringify(legacy),h.id);
  const schema=h.load('app/quotation-schema.ts').getQuotationSchema('80719'),profile=await h.load('db/category-profiles.ts').createCategoryProfile(h.owner,{name:'가격 검토',categoryId:'80719',categoryPath:schema.categoryPath,template:null,mappings:[]},'review-profile');
  const suffix='?profileId='+profile.id,before=await json(await h.get(suffix)),body=h.body(before),status=h.load('app/registration-pricing-status.ts').savedRecalculatedRegistrationPricing;
  const currentState=()=>h.load('db/quotation-fields.ts').readQuotationFields(h.owner,h.id);
  const complete=async receipt=>status(receipt.product,receipt.options.options,await currentState(),receipt.quotation.resolved.schema,{ownerId:h.owner,profileId:profile.id});
  assert.equal(body.recalculate,false);assert.equal(body.policy.recalculationMode,undefined);assert.equal(before.pricingReview,null);assert.equal(await complete(before),false);
  const result=await json(await h.post(body,suffix));assert.equal(h.batches,1);assert.equal(result.product.pricing_policy,before.product.pricing_policy);assert.deepEqual(result.options.options.rows,before.options.options.rows);
  assert.equal(result.pricingReview.sourceInputFingerprint,body.expectedInputFingerprint);assert.equal(result.pricingReview.sourceProductVersion,before.product.updated_at);assert.equal(result.pricingReview.profileId,profile.id);assert.equal(result.pricingReview.ownerId,h.owner);
  assert.equal(await complete(result),true);h.load('app/stage-two-pricing.ts').verifyStageTwoPricingReceipt(before.options,before.quotation,body,result);
  const snapshot=await h.load('app/quotation-fields-snapshot.ts').stableQuotationFieldsView(h.owner,h.id,profile.id),overrides=plain(snapshot.view.overrides);overrides.common.title='가격 외 제목 검토';
  assert.ok(await h.load('db/quotation-fields.ts').saveQuotationFields(h.owner,h.id,overrides,snapshot.view.revision,snapshot.source,snapshot.view.categoryContext.categoryId));
  const later=await json(await h.get(suffix));assert.equal(await complete(later),true,'a later title save preserves the sealed price configuration');assert.deepEqual(later.pricingReview,result.pricingReview);assert.equal(later.product.pricing_policy,before.product.pricing_policy);
  const changed=plain(later.options.options);changed.rows[0].unitCostCny+=1;assert.equal(status(later.product,changed,await currentState(),later.quotation.resolved.schema,{ownerId:h.owner,profileId:profile.id}),false);
 }finally{h.close();}
});

test('excluding every option still saves atomically without manufacturing a completed pricing review',async()=>{
 const h=await stageTwoFixture();try{
  const before=await json(await h.get()),body=h.body(before);body.rows=body.rows.map(row=>({...row,included:false}));
  const result=await json(await h.post(body));assert.equal(h.batches,1);assert.equal(result.product.options_count,0);assert.equal(result.pricingReview,null);
  h.load('app/stage-two-pricing.ts').verifyStageTwoPricingReceipt(before.options,before.quotation,body,result);
 }finally{h.close();}
});

for(const company of companies){
 test(`stage-two one commit preserves sources, manual count and packaging while policy/prices/quote share one clock (${company.code})`,async()=>{
  const h=await stageTwoFixture(company);try{
   const before=await json(await h.get()),request=h.body(before),model=h.load('app/stage-two-pricing.ts'),oldOptions=plain(before.options.options);
   request.policy={...request.policy,exchangeRate:360,bundleEnabled:true,bundleCriterion:'supplyMargin',bundleMinimumSupplyMargin:3000,bundleMinimumCoupangMargin:3000};
   const chosen=model.recalculateStageTwoRows(request.rows,request.policy);assert.ok(chosen[0].unitsPerPack>1);assert.equal(chosen[2].unitsPerPack,7,'excluded source quantity is not recalculated');
   request.rows=chosen;request.rows[0].unitsPerPack=2;request.recalculate=true;request.changes=[{optionId:'row-a',fieldKey:'salePrice',value:'9000'}];
   const result=await json(await h.post(request));assert.equal(h.batches,1);assert.equal(result.options.options.rows[0].unitsPerPack,2,'manual count wins after auto choice');
   assert.equal(result.options.options.rows[0].packagingUnitsPerPack,1,'old measured pack is not automatically reconfirmed');
   assert.deepEqual(result.options.options.rows[2],oldOptions.rows[2]);assert.equal(result.quotation.overrides.options['row-a'].msrp,'11700');
   assert.equal(result.quotation.overrides.options['row-a'].salePrice,'9000');assert.equal(result.quotation.stageTwoMsrp['row-a'].value,'11700');
   assert.equal(result.options.options.updatedAt,result.product.updated_at);assert.equal(result.quotation.updatedAt,result.product.updated_at);
   assert.equal(result.quotation.optionRevision,result.options.options.revision);assert.equal(result.quotation.revision,before.quotation.revision+1);
   assert.deepEqual(result.options.optionRegistrationNumbers,before.options.optionRegistrationNumbers);assert.equal(result.product.supplier_hub_status,'미전송');
   for(const row of result.options.options.rows)for(const key of ['originalName','supplierSku','stock','minimumOrderQuantity','unitCostCny','packagedWeightG','packagedWidthMm','packagedLengthMm','packagedHeightMm'])assert.equal(row[key],oldOptions.rows.find(before=>before.id===row.id)[key],key);
   assert.strictEqual(model.verifyStageTwoPricingReceipt(before.options,before.quotation,request,result),result);
   for(const tamper of [r=>r.options.options.rows[0].unitsPerPack++,r=>r.quotation.inputFingerprint=before.quotation.inputFingerprint,r=>r.quotation.automatic.rows.find(row=>row.optionId==='row-a').fields.supplyPrice.value='1',r=>r.quotation.resolved.rows.find(row=>row.optionId==='row-b').fields.salePrice.value='1',r=>r.quotation.overrides.options['row-a'].msrp='1',r=>r.options.optionRegistrationNumbers['row-a']='000000000001']){const fake=plain(result);tamper(fake);assert.throws(()=>model.verifyStageTwoPricingReceipt(before.options,before.quotation,request,fake));}
   const after=await json(await h.get());assert.deepEqual(after,result);assert.equal((await h.post(request)).status,409);assert.equal(h.batches,1);
  }finally{h.close();}
 });
 test(`source-only and policy-only changes need no quotation edit; initial recovery GET remains read-only (${company.code})`,async()=>{
  const h=await stageTwoFixture(company);try{const before=await json(await h.get()),model=h.load('app/stage-two-pricing.ts'),snapshot=h.snapshot();assert.equal(model.unchangedStageTwoPricingReceipt({...before.options,imageLibrary:{advisory:true}},before.quotation,await json(await h.get())),true);assert.equal(h.snapshot(),snapshot);
   const request=h.body(before);request.rows[0].unitCostCny=4.2;request.policy.exchangeRate=370;request.recalculate=true;const result=await json(await h.post(request));assert.deepEqual(result.quotation.overrides,{common:{},options:{}});model.verifyStageTwoPricingReceipt(before.options,before.quotation,request,result);
  }finally{h.close();}
 });
 test(`reset only current-category direct prices then apply manual MSRP precedence and preserve other scopes (${company.code})`,async()=>{
  const h=await stageTwoFixture(company);try{
   const schema=h.load('app/quotation-schema.ts').getQuotationSchema('80719'),profile=await h.load('db/category-profiles.ts').createCategoryProfile(h.owner,{name:'LOCAL STAGE TWO CATEGORY',categoryId:'80719',categoryPath:schema.categoryPath,template:null,mappings:[]},'synthetic-profile');
   const old={schemaVersion:1,productId:h.id,revision:1,overrides:{common:{brand:'legacy protected'},options:{}},categoryOverrides:{'category:80719':{common:{brand:'current protected',supplyPrice:'100'},options:{'row-a':{model:'manual protected',salePrice:'10000',msrp:''}}},'category:81221':{common:{brand:'other protected'},options:{'row-b':{salePrice:'12345'}}}},updatedAt:h.product.updated_at};h.sqlite.prepare('INSERT INTO product_quotation_fields VALUES(?,?,?,?,?)').run(h.id,h.owner,1,JSON.stringify(old),old.updatedAt);
   const suffix='?profileId='+profile.id,before=await json(await h.get(suffix)),request=h.body(before);request.recalculate=true;request.changes=[{optionId:'row-a',fieldKey:'salePrice',value:'9000'},{optionId:'row-a',fieldKey:'msrp',value:''}];const result=await json(await h.post(request,suffix)),state=await h.load('db/quotation-fields.ts').readQuotationFields(h.owner,h.id);
   assert.deepEqual(plain(state.overrides),old.overrides);assert.deepEqual(plain(state.categoryOverrides['category:81221']),old.categoryOverrides['category:81221']);assert.equal(result.quotation.overrides.options['row-a'].model,'manual protected');assert.equal(result.quotation.overrides.common.brand,'current protected');assert.equal(Object.hasOwn(result.quotation.overrides.common,'supplyPrice'),false);assert.equal(result.quotation.overrides.options['row-a'].msrp,'');assert.equal(result.quotation.stageTwoMsrp,undefined);
   h.load('app/stage-two-pricing.ts').verifyStageTwoPricingReceipt(before.options,before.quotation,request,result);
  }finally{h.close();}
 });
 test(`invalid policies/scopes/source clocks reject without a transaction (${company.code})`,async()=>{
  const h=await stageTwoFixture(company);try{const before=await json(await h.get()),request=h.body(before),snapshot=h.snapshot();
   for(const invalid of [{...request,recalculate:'yes'},{...request,other:true},{...request,policy:{...request.policy,bundleEnabled:true}},{...request,policy:{...request.policy,bundleEnabled:true,bundleCriterion:'supplyMargin',bundleMinimumSupplyMargin:1,bundleMinimumCoupangMargin:3000}},{...request,changes:[{fieldKey:'brand',optionId:null,value:'unrequested nonprice'}]}]){assert.equal((await h.post(invalid)).status,400);assert.equal(h.snapshot(),snapshot);}
   for(const invalid of [{...request,expectedProductVersion:'2026-10-21T00:00:00.000Z'},{...request,expectedOptionRevision:0},{...request,expectedQuotationRevision:20},{...request,expectedInputFingerprint:'0'.repeat(64)}]){assert.equal((await h.post(invalid)).status,409);assert.equal(h.snapshot(),snapshot);}
   assert.equal((await h.post(request,'?profileId=x&profileId=x')).status,400);assert.equal((await h.post(request,'?other=x')).status,400);assert.equal((await h.post(request,'',{origin:'https://foreign.test'})).status,400);assert.equal((await h.post('x'.repeat(512*1024+1))).status,413);h.verified(false);assert.equal((await h.post(request)).status,503);assert.equal(h.snapshot(),snapshot);assert.equal(h.batches,0);
  }finally{h.close();}
 });
 test(`every actual atomic companion rolls back on fault and ignored write (${company.code})`,async()=>{
  for(const checkpoint of [1,2,3,4,5,6]){const h=await stageTwoFixture(company);try{const before=await json(await h.get()),snapshot=h.snapshot(),request=h.body(before);request.policy.exchangeRate=370;h.fault(checkpoint);assert.equal((await h.post(request)).status,503);assert.equal(h.snapshot(),snapshot,'fault '+checkpoint);}finally{h.close();}}
  for(const table of ['products','product_price_policy','product_quotation_fields']){const h=await stageTwoFixture(company);try{const before=await json(await h.get()),request=h.body(before);request.policy.exchangeRate=370;h.sqlite.exec(`CREATE TRIGGER ignored_companion BEFORE ${table==='products'?'UPDATE':'INSERT'} ON ${table} BEGIN SELECT RAISE(IGNORE); END`);const snapshot=h.snapshot();assert.equal((await h.post(request)).status,503);assert.equal(h.snapshot(),snapshot,table);}finally{h.close();}}
 });
 test(`clock triggers including same-price bundle-only restore-old cannot partially commit (${company.code})`,async()=>{
  for(const clock of ['2099-01-01T00:00:00.000Z','old'])for(const samePrice of [false,true]){const h=await stageTwoFixture(company);try{const before=await json(await h.get()),request=h.body(before);if(samePrice)request.policy={...request.policy,bundleEnabled:true,bundleCriterion:'supplyMargin',bundleMinimumSupplyMargin:3000,bundleMinimumCoupangMargin:3000};else request.policy.exchangeRate=370;
    h.sqlite.exec(`CREATE TRIGGER wrong_clock AFTER UPDATE ON product_price_policy BEGIN UPDATE products SET updated_at='${clock==='old'?before.product.updated_at:clock}' WHERE id=NEW.product_id; END`);const snapshot=h.snapshot();assert.equal((await h.post(request)).status,503);assert.equal(h.snapshot(),snapshot,'clock '+clock+' samePrice '+samePrice);
  }finally{h.close();}}
 });
 test(`raw source, member and same-revision races preserve newer facts with no atomic write (${company.code})`,async()=>{
  for(const kind of ['options','quotation','policy','settings','member','product','remove']){const h=await stageTwoFixture(company);try{const before=await json(await h.get()),request=h.body(before);let raced;h.before(()=>{
    if(kind==='options'){const row=h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(h.id),state=JSON.parse(row.payload);state.rows[0].stock=5;h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(state),h.id);}
    if(kind==='quotation')h.sqlite.prepare('INSERT INTO product_quotation_fields VALUES(?,?,?,?,?)').run(h.id,h.owner,1,JSON.stringify({schemaVersion:1,productId:h.id,revision:1,overrides:{common:{brand:'race'},options:{}},updatedAt:h.product.updated_at}),h.product.updated_at);
    if(kind==='policy')h.sqlite.prepare('UPDATE product_price_policy SET payload=? WHERE product_id=?').run(JSON.stringify({...h.policy,exchangeRate:370}),h.id);
    if(kind==='settings')h.sqlite.prepare('INSERT INTO workspace_settings VALUES(?,?,?)').run(h.owner,JSON.stringify(h.load('app/workspace-settings.ts').defaultSettings),h.product.updated_at);
    if(kind==='member')h.sqlite.prepare("UPDATE members SET status='suspended' WHERE id=?").run(h.owner);
    if(kind==='product')h.sqlite.prepare('UPDATE products SET title=? WHERE id=?').run('new raw title same clock',h.id);
    if(kind==='remove')h.sqlite.prepare('INSERT INTO product_removals VALUES(?,?,?,?)').run(h.id,h.owner,h.product.updated_at,h.product.updated_at);
    raced=h.snapshot();});const response=await h.post(request);assert.equal(response.status,409,kind+': '+await response.clone().text());assert.equal(h.snapshot(),raced,kind);
  }finally{h.close();}}
 });
 test(`exact content/profile/captured-category payload fences reject same-revision races (${company.code})`,async()=>{
  for(const kind of ['content','profile','collection']){const h=await stageTwoFixture(company);try{
   const schema=h.load('app/quotation-schema.ts').getQuotationSchema('80719'),profile=await h.load('db/category-profiles.ts').createCategoryProfile(h.owner,{name:'LOCAL FENCE CATEGORY',categoryId:'80719',categoryPath:schema.categoryPath,template:null,mappings:[]},'synthetic-fence-profile');
   const model=h.load('app/product-content.ts'),content=model.applyContentPatch(model.emptyProductContent(h.id),{seo:{title:'보존할 원본 제목'}},h.product.updated_at);h.sqlite.prepare('INSERT INTO product_content VALUES(?,?,?,?,?)').run(h.id,h.owner,content.revision,JSON.stringify(content),h.product.updated_at);
   const captured={category:profile,company:{code:company.code,name:company.name},capturedAt:h.product.updated_at,features:'보존할 수집 원문'};
   h.sqlite.prepare('INSERT INTO collection_jobs VALUES(?,?,?,?,?,?,?,?)').run('atomic-job',h.owner,'761000000001',h.product.source_url,'price','awaiting_connector',h.product.updated_at,h.product.updated_at);h.sqlite.prepare('INSERT INTO collection_context VALUES(?,?)').run('atomic-job',JSON.stringify(captured));h.sqlite.prepare('INSERT INTO collection_products VALUES(?,?,?,?)').run('atomic-job',h.owner,h.id,h.product.updated_at);
   const suffix='?profileId='+profile.id,before=await json(await h.get(suffix)),request=h.body(before);let raced;
   h.before(()=>{if(kind==='content'){const next=structuredClone(content);next.seo.title.value='동일 revision의 최신 제목';h.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(next),h.id);}
    if(kind==='profile'){const row=h.sqlite.prepare('SELECT payload FROM category_profiles WHERE id=?').get(profile.id),next=JSON.parse(row.payload);next.name='동일 revision의 최신 분류 설정';h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(JSON.stringify(next),profile.id);}
    if(kind==='collection')h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify({...captured,features:'동일 시각의 최신 수집 원문'}),'atomic-job');raced=h.snapshot();});
   assert.equal((await h.post(request,suffix)).status,409,kind);assert.equal(h.snapshot(),raced,kind+' newer raw data retained');
  }finally{h.close();}}
 });
}
