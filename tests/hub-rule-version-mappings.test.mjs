import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
function snapshots(company){
 const legacy=hubSchemaSnapshot(company),raw=JSON.parse(legacy.schemaString);
 raw.required=['startPage','productPage'];
 raw.properties.productPage={type:'object',required:['modelNumber','brand'],properties:{modelNumber:{type:'string',title:'모델 번호'},brand:{type:'string',title:'상표 이름',enum:['양식 브랜드','검토 브랜드']}}};
 legacy.schemaString=JSON.stringify(raw);
 return {legacy,current:{...legacy,draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1',settingsInitialization:'couplus-options-v1'}};
}
function setup(h,company){
 const pair=snapshots(company),quote=h.load('app/quotation-schema.ts'),translate=h.load('app/hub-rule-version-mappings.ts').translateHubRuleVersionMappings;
 const fields=snap=>quote.getQuotationSchema(snap.categoryId,schemaPath,snap).fields;
 const at=(snap,key)=>fields(snap).find(field=>JSON.stringify(field.hubWire?.path)===JSON.stringify(['productPage',key]));
 return {...pair,quote,translate,fields,at};
}

test('wire identity round-trips manual columns and choice format without renaming constants or unmatched non-wire columns',()=>{
 const h=mobileIntakeHarness();try{
  const f=setup(h),mappings=[{column:1,field:f.at(f.legacy,'modelNumber').id,required:true},{column:0,field:f.at(f.legacy,'brand').id,required:false,choiceFormat:'label'},{column:2,field:'constant',constant:'직접 고정값',required:false},{column:3,field:'skuId',required:false}];
  const upgraded=f.translate(mappings,f.legacy,f.current);assert.deepEqual(clone(upgraded),[{...mappings[0],field:'model'},{...mappings[1],field:'brand'},mappings[2],mappings[3]]);
  assert.deepEqual(clone(f.translate(upgraded,f.current,f.legacy)),mappings);assert.notEqual(upgraded,mappings);assert.match(mappings[0].field,/^live_/);
  for(const changed of [{schemaString:f.current.schemaString+' '},{metadata:{...f.current.metadata,version:999}},{categoryPath:['changed']},{company:schemaCompanies[1]},{categoryId:'999999'},{inputBindings:undefined}])assert.equal(f.translate(mappings,f.legacy,{...f.current,...changed}),mappings);
 }finally{h.close();}
});

test('a missing exact target path fails before changing any mapping rather than borrowing a same-labelled field',()=>{
 const h=mobileIntakeHarness();try{
  const f=setup(h),raw=JSON.parse(f.legacy.schemaString);
  raw.properties.productPage.properties.modelNumber.title='모델명';raw.properties.productPage.properties.otherModel={type:'string',title:'모델명'};
  const legacy={...f.legacy,schemaString:JSON.stringify(raw)},current={...f.current,schemaString:legacy.schemaString};
  const field=f.fields(current).find(field=>JSON.stringify(field.hubWire?.path)===JSON.stringify(['productPage','otherModel']));
  const mappings=[{column:0,field:field.id,required:false}],before=clone(mappings);
  assert.throws(()=>f.translate(mappings,current,legacy),/같은 상세 양식 경로/);assert.deepEqual(mappings,before);
  assert.throws(()=>f.translate([{column:0,field:'live_991234_missing',required:false}],legacy,current),/이전 상세 양식/);
 }finally{h.close();}
});

for(const company of schemaCompanies)test(`same-form rule upgrade preserves frozen manual CSV and enables the next URL draft (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const f=setup(h,company),api=h.load('app/api/category-profiles/route.ts'),oldModel=f.at(f.legacy,'modelNumber').id,oldBrand=f.at(f.legacy,'brand').id;
  const bytes=new TextEncoder().encode('브랜드,모델,고정값\n'),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),storageKey=`owner/category-templates/${sha256}.csv`;
  await h.bindings.FILES.put(storageKey,bytes,{customMetadata:{sha256,format:'csv'}});
  const input={name:'합성 버전 연결',categoryId:f.legacy.categoryId,categoryPath:schemaPath,hubSchema:f.legacy,template:{name:'synthetic-version.csv',format:'csv',sheetName:'',headerRow:1,headers:['브랜드','모델','고정값'],sha256,storageKey},mappings:[{column:1,field:oldModel,required:false},{column:0,field:oldBrand,required:false,choiceFormat:'label'},{column:2,field:'constant',constant:'계속 유지',required:false}]};
  const {profile}=await json(await api.POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(input)})),201);
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');assert.match(await h.intake(),/상품 초안 저장됨/);
  const product=h.sqlite.prepare('SELECT * FROM products').get(),path=`/api/products/${product.id}/quotation-fields`;let view=await json(await h.route(path));
  view=await json(await h.route(path,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:oldModel,optionId:null,value:'기존 수동 모델'},{fieldKey:oldModel,optionId:'collected-2',value:''},{fieldKey:oldBrand,optionId:null,value:'검토 브랜드'}]}}));
  const exporter=h.load('app/exports/quotation-source.ts');
  const render=async()=>{const source=await exporter.readMappedQuotationSource('owner',product.id,profile.id),resolved=exporter.resolveQuotationExport(source),assets=JSON.parse(source.product.image_keys).map((key,index)=>({key,name:`images/${index}.png`})),rows=h.load('app/exports/quotation-fields.ts').resolvedQuotationRows(source,resolved,assets);return {source,fingerprint:await exporter.quotationExportFingerprint(source,2),mapped:await h.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes:bytes.buffer,profile:source.profile,rows,dataStartRow:2})};};
  const before=await render(),untouched={product:h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(product.id),content:h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(product.id),options:h.sqlite.prepare('SELECT * FROM product_options WHERE product_id=?').get(product.id),quotation:h.sqlite.prepare('SELECT * FROM product_quotation_fields WHERE product_id=?').get(product.id),context:h.sqlite.prepare('SELECT * FROM collection_context WHERE job_id=?').get('job')};
  assert.deepEqual(clone(before.mapped.values.map(row=>row.slice(0,3))),Array.from({length:6},(_,index)=>['검토 브랜드',index===1?'':'기존 수동 모델','계속 유지']));
  const mappings=f.translate(profile.mappings,profile.hubSchema,f.current);
  const {profile:upgraded}=await json(await api.PUT(new Request('https://app.test/api/category-profiles',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({id:profile.id,expectedRevision:profile.revision,profile:{...input,hubSchema:f.current,mappings}})})));
  assert.equal(upgraded.mappings[0].field,'model');assert.equal(upgraded.mappings[1].field,'brand');assert.deepEqual(upgraded.template,profile.template);
  const after=await render();assert.deepEqual(clone(after.source.profile.mappings),clone(profile.mappings));assert.deepEqual(after.mapped.values,before.mapped.values);assert.deepEqual(after.mapped.bytes,before.mapped.bytes);
  assert.notEqual(after.fingerprint,before.fingerprint);assert.equal(after.source.source.profile.revision,upgraded.revision);
  assert.equal(await h.load('db/quotation-fields.ts').quotationSourcesCurrent('owner',product.id,before.source.source),false);assert.equal(await h.load('db/quotation-fields.ts').quotationSourcesCurrent('owner',product.id,after.source.source),true);
  assert.deepEqual((await json(await h.route(path))).resolved,view.resolved);
  for(const [key,table] of [['product','products'],['content','product_content'],['options','product_options'],['quotation','product_quotation_fields']])assert.deepEqual(h.sqlite.prepare(`SELECT * FROM ${table} WHERE ${key==='product'?'id':'product_id'}=?`).get(product.id),untouched[key]);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM collection_context WHERE job_id=?').get('job'),untouched.context);
  // A second URL/receipt is a synthetic identity variant of the recorded fixture.
  // It verifies the new captured request, not a live second supplier product.
  const nextUrl='https://detail.1688.com/offer/813724060929.html',jobsApi=h.load('app/api/collection-jobs/route.ts');
  const queued=await json(await jobsApi.POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({urls:[nextUrl],goal:'collect',profileId:profile.id,expectedProfileRevision:upgraded.revision})})));
  const next=queued.jobs[0];assert.equal(next.context.category.hubSchema.inputBindings,'couplus-paths-v1');assert.equal(next.context.category.mappings[0].field,'model');
  const results=h.load('db/collection-results.ts'),receipt=await results.readCollectionResult('owner','job');await results.storeCollectionResult('owner',next.id,{...receipt.result,offerId:'813724060929',sourceUrl:nextUrl});
  const productApi=h.load('app/api/collection-jobs/[id]/product/route.ts'),created=await json(await productApi.POST(new Request(`https://app.test/api/collection-jobs/${next.id}/product`,{method:'POST'}),{params:Promise.resolve({id:next.id})}));
  const nextView=await json(await h.route(`/api/products/${created.productId}/quotation-fields`));assert.equal(nextView.resolved.rows.filter(row=>row.optionId!==null).length,6);assert.equal(nextView.resolved.schema.fields.find(field=>field.id==='model').hubInput,'model');assert.equal(nextView.resolved.rows[0].fields.brand.value,'양식 브랜드');assert.equal(nextView.resolved.rows[0].fields.brand.source,'couplus-default');assert.ok(!h.network.includes('supplier.coupang.com'));
 }finally{h.close();}
});
