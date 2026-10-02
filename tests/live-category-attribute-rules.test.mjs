import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
function snapshot(company){
 const snap=hubSchemaSnapshot(company),raw=JSON.parse(snap.schemaString);
 raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf.push({contains:{type:'object',properties:{name:{type:'string',enum:['검증용 원문 속성']},value:{type:'string',maxLength:1000}}}});
 return {...snap,schemaString:JSON.stringify(raw)};
}
async function setup(local,snap,{collect=true}={}){
 const input={name:'시험 실제 구조 분류',categoryId:snap.categoryId,categoryPath:schemaPath,hubSchema:snap,template:null,mappings:[]},api=local.load('app/api/category-profiles/route.ts');
 const response=await api.POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));assert.equal(response.status,201,await response.clone().text());
 const {profile}=await response.json();local.context.category=profile;local.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(local.context),'job');
 if(!collect)return {input,profile,api};
 assert.match(await local.intake(),/상품 초안 저장됨/);
 const product=local.sqlite.prepare('SELECT * FROM products').get(),path='/api/products/'+product.id+'/quotation-fields',view=await(await local.route(path)).json();
 const field=view.resolved.schema.fields.find(item=>item.label==='검증용 원문 속성');assert.match(field.id,/^live_/);
 const job=await local.load('db/translation-jobs.ts').findIntakeTranslation('owner',product.id),source=job.review.source.attributes.find(item=>item.name.startsWith('상품속성: '));assert.ok(source);
 const rules={format:'sourceflow-attribute-rules-v1',categoryId:snap.categoryId,rules:[{sourceName:source.name,fieldId:field.id,fieldSignature:JSON.stringify(field)}]};
 return {input,profile,api,product,path,view,field,rules,source};
}
function ruleApi(local){
 const api=local.load('app/api/quotation-attribute-rules/route.ts');
 return {get:query=>api.GET(new Request('https://app.test/api/quotation-attribute-rules?'+new URLSearchParams(query))),put:(body,origin)=>api.PUT(new Request('https://app.test/api/quotation-attribute-rules',{method:'PUT',headers:{'content-type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(body)}))};
}

for(const company of schemaCompanies)test('owner product captured live fields can save/reuse rules without changing manual work: '+company.code,async()=>{
 const local=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const snap=snapshot(company),f=await setup(local,snap),api=ruleApi(local),query={categoryId:snap.categoryId,productId:f.product.id,profileId:f.profile.id};
  const blank=await local.route(f.path,{method:'PUT',body:{expectedRevision:f.view.revision,expectedInputFingerprint:f.view.inputFingerprint,changes:[{fieldKey:f.field.id,optionId:null,value:''}]}});assert.equal(blank.status,200);
  const before=JSON.stringify(local.sqlite.prepare('SELECT * FROM products').all()),quoteBefore=JSON.stringify(local.sqlite.prepare('SELECT * FROM product_quotation_fields').all());
  assert.equal((await api.put({rules:f.rules,expectedRevision:0})).status,400,'A forged live field without owner product context must fail');
  const response=await api.put({rules:f.rules,expectedRevision:0,productId:f.product.id,profileId:f.profile.id});assert.equal(response.status,200,await response.clone().text());
  assert.equal((await response.json()).revision,1);assert.equal((await(await api.get(query)).json()).revision,1);
  const next=plain(snap),raw=JSON.parse(next.schemaString);raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf.at(-1).contains.properties.value.maxLength=2;next.schemaString=JSON.stringify(raw);
  assert.equal((await f.api.PUT(new Request('https://app.test/api/category-profiles',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({id:f.profile.id,expectedRevision:f.profile.revision,profile:{...f.input,hubSchema:next}})}))).status,200);
  const saved=await api.put({rules:f.rules,expectedRevision:1,productId:f.product.id,profileId:f.profile.id});assert.equal(saved.status,200,await saved.clone().text());
  assert.equal((await(saved.json())).revision,2);assert.equal(JSON.stringify(local.sqlite.prepare('SELECT * FROM products').all()),before);assert.equal(JSON.stringify(local.sqlite.prepare('SELECT * FROM product_quotation_fields').all()),quoteBefore);
  const view=await(await local.route(f.path)).json();assert.equal(view.resolved.rows[0].fields[f.field.id].value,'');assert.equal(view.resolved.rows[0].fields[f.field.id].source,'manual-common');assert.equal(view.resolved.schema.fields.find(item=>item.id===f.field.id).maxLength,1000);
  local.sqlite.prepare('DELETE FROM category_profiles WHERE owner_id=? AND id=?').run('owner',f.profile.id);
  assert.equal((await api.get({categoryId:snap.categoryId,productId:f.product.id})).status,200,'Frozen intake rules must not require a subsequently deleted profile');
  const capturedSave=await api.put({rules:f.rules,expectedRevision:2,productId:f.product.id});assert.equal(capturedSave.status,200,await capturedSave.clone().text());assert.equal((await capturedSave.json()).revision,3);
  assert.ok(!local.network.includes('supplier.coupang.com'));
 }finally{local.close();}
});

for(const company of schemaCompanies)test('next URL intake reuses saved live-field rule into six-option quotation and preserves later edits: '+company.code,async()=>{
 const first=mobileIntakeHarness({companyCode:company.code,companyName:company.name}),next=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const snap=snapshot(company),f=await setup(first,snap),api=ruleApi(first),saved=await api.put({rules:f.rules,expectedRevision:0,productId:f.product.id});assert.equal(saved.status,200,await saved.clone().text());
  const record=await saved.json();await setup(next,snap,{collect:false});assert.ok(await next.load('db/quotation-attribute-rules.ts').saveAttributeRules('owner',record.rules,0));
  assert.match(await next.intake(),/상품 초안 저장됨/);const product=next.sqlite.prepare('SELECT * FROM products').get(),path='/api/products/'+product.id+'/quotation-fields',view=await(await next.route(path)).json(),included=view.resolved.rows.filter(row=>row.optionId!==null&&row.included);
  assert.equal(included.length,6);assert.equal(next.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
  for(const row of view.resolved.rows){assert.equal(row.fields[f.field.id].value,f.source.value);assert.equal(row.fields[f.field.id].source,'content');}
  const put=await next.route(path,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:f.field.id,optionId:included[0].optionId,value:''},{fieldKey:'title',optionId:null,value:'최종 검토 상품명'}]}});assert.equal(put.status,200,await put.clone().text());
  const source=await next.load('app/exports/quotation-source.ts').readQuotationExportSource('owner',product.id,null),resolved=next.load('app/exports/quotation-source.ts').resolveQuotationExport(source),rows=next.load('app/exports/quotation-fields.ts').resolvedQuotationRows(source,resolved,[]);
  assert.equal(rows.length,6);assert.equal(rows[0][f.field.id],'');assert.equal(rows[1][f.field.id],f.source.value);assert.ok(rows.every(row=>row.title==='최종 검토 상품명'));
  assert.ok(!first.network.includes('supplier.coupang.com')&&!next.network.includes('supplier.coupang.com'));
 }finally{first.close();next.close();}
});

test('live rule API refuses foreign owner/category/profile/company, stale signatures and cross-origin writes',async()=>{
 const local=mobileIntakeHarness();try{
  const snap=snapshot(schemaCompanies[0]),f=await setup(local,snap),api=ruleApi(local),body={rules:f.rules,expectedRevision:0,productId:f.product.id,profileId:f.profile.id};
  for(const [change,status] of [[{productId:'missing'},404],[{productId:'../bad'},400],[{profileId:'missing'},404],[{productId:undefined,profileId:f.profile.id},400],[{rules:{...f.rules,categoryId:'80719'}},409],[{rules:{...f.rules,rules:[{...f.rules.rules[0],fieldSignature:'{}'}]}},400]])assert.equal((await api.put({...body,...change})).status,status);
  assert.equal((await api.put(body,'https://other.test')).status,400);
  local.sqlite.prepare('UPDATE products SET owner_id=? WHERE id=?').run('other',f.product.id);assert.equal((await api.put(body)).status,404);assert.equal((await api.get({categoryId:snap.categoryId,productId:f.product.id})).status,404);local.sqlite.prepare('UPDATE products SET owner_id=? WHERE id=?').run('owner',f.product.id);
  local.context.category.hubSchema.company=schemaCompanies[1];local.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(local.context),'job');assert.equal((await api.put(body)).status,409);
  assert.equal(local.sqlite.prepare('SELECT COUNT(*) AS n FROM quotation_attribute_rules').get().n,0);
 }finally{local.close();}
});

test('captured rule schema rejects changed category/association and skips hidden fields when disabled',()=>{
 const local=mobileIntakeHarness();try{
  const snap=snapshot(schemaCompanies[0]),model=local.load('app/quotation-attribute-schema.ts'),category={name:'test',categoryId:snap.categoryId,categoryPath:schemaPath,hubSchema:snap,template:null,mappings:[]},source={offerId:'813724060928',snapshot:{payload:JSON.stringify({category}),linked:true}};
  const schema=model.attributeCategorySchema(snap.categoryId,model.capturedAttributeCategory(snap.categoryId,source)),field=schema.fields.find(item=>item.label==='렌즈 소재'),rules={format:'sourceflow-attribute-rules-v1',categoryId:snap.categoryId,rules:[{sourceName:'상품속성: fixture',fieldId:field.id,fieldSignature:JSON.stringify(field)}]};
  const attributes={categoryId:snap.categoryId,jobId:'fixture',hiddenAttributes:false,values:[{name:'렌즈 소재',sourceName:'상품속성: fixture',value:'PC'}]};
  const apply=local.load('app/intake-attribute-rules.ts').applyIntakeAttributeRules,result=apply(attributes,JSON.stringify(rules),schema);assert.equal(result.snapshot.bindings.length,0);assert.ok(result.skipped.some(item=>item.includes('꺼져')));
  assert.equal(apply({...attributes,hiddenAttributes:true},JSON.stringify(rules),schema).snapshot.bindings[0].value,'PC');
  assert.throws(()=>model.capturedAttributeCategory('80719',source));assert.throws(()=>model.capturedAttributeCategory(snap.categoryId,{...source,snapshot:{...source.snapshot,linked:false}}));assert.throws(()=>apply(attributes,JSON.stringify(rules),local.load('app/quotation-schema.ts').getQuotationSchema('80719')));
 }finally{local.close();}
});

test('product rule context read failures return unavailable without saving or exposing database errors',async()=>{
 const local=mobileIntakeHarness();try{
  const snap=snapshot(schemaCompanies[0]),f=await setup(local,snap),api=ruleApi(local),prepare=local.db.prepare;
  local.db.prepare=()=>{throw Error('private database fixture failure');};
  const put=await api.put({rules:f.rules,expectedRevision:0,productId:f.product.id});assert.equal(put.status,503);assert.doesNotMatch(await put.text(),/private database/);
  assert.equal((await api.get({categoryId:snap.categoryId,productId:f.product.id})).status,503);
  local.db.prepare=prepare;assert.equal(local.sqlite.prepare('SELECT COUNT(*) AS n FROM quotation_attribute_rules').get().n,0);
 }finally{local.close();}
});

test('live suggestions carry owner product/profile context and retain signature/manual-choice guards',async()=>{
 const local=mobileIntakeHarness();try{
  const snap=snapshot(schemaCompanies[0]),schema=local.load('app/quotation-schema.ts').getQuotationSchema(snap.categoryId,schemaPath,snap),field=schema.fields.find(item=>item.label==='검증용 원문 속성');
  const view={productVersion:'v',contentRevision:1,categoryContext:{source:'profile',profileId:'profile_1'},resolved:{schema,rows:[{optionId:null,included:true,fields:{[field.id]:{value:'',source:'empty'}}}]},overrides:{common:{},options:{}},imageKeys:[]};
  const job={productId:'product_1',productVersion:'v',contentRevision:1,status:'completed',review:{source:{category:{id:snap.categoryId},attributes:[{name:'상품속성: fixture',value:'원문'}]}},result:{draft:{attributes:[{sourceIndex:0,name:field.label,value:'검토값'}]}}},calls=[];
  const api=local.load('app/quotation-attribute-suggestions.ts'),result=await api.fetchAttributeSuggestions('product_1',view,job,null,async(url,init)=>{calls.push({url,init});return Response.json({rules:null,revision:0});});
  assert.equal(result.mapping[0],field.id);const query=new URL(calls[0].url,'https://app.test').searchParams;assert.equal(query.get('categoryId'),snap.categoryId);assert.equal(query.get('productId'),'product_1');assert.equal(query.get('profileId'),'profile_1');assert.equal(calls[0].init.method,undefined);
  view.resolved.rows[0].fields[field.id].source='manual-common';assert.deepEqual(plain((await api.fetchAttributeSuggestions('product_1',view,job,null,async()=>Response.json({rules:null,revision:0}))).mapping),{});
  view.categoryContext.source='collection';await api.fetchAttributeSuggestions('product_1',view,job,null,async url=>{assert.equal(new URL(url,'https://app.test').searchParams.has('profileId'),false);return Response.json({rules:null,revision:0});});
 }finally{local.close();}
});
