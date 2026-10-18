import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {sizeChartApiFixture,companies,json,plain,allTables} from './helpers/supplier-hub-single-size-chart.mjs';

const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
const sha=value=>createHash('sha256').update(value).digest('hex'),cases=[];
const files=['app/product-label.ts','app/product-label-proof.ts','tests/product-label-empty-rows-api.test.mjs'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,sha(fs.readFileSync(file))])),frozen=hashes();
function preserved(f){
 const db=f.h.sqlite,product={...db.prepare('SELECT * FROM products WHERE id=?').get(f.id)};
 delete product.updated_at;delete product.quote_status;delete product.image_keys;
 return{product,content:db.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.id).payload,
  options:db.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id).payload,
  settings:db.prepare('SELECT * FROM workspace_settings ORDER BY owner_id').all(),context:db.prepare('SELECT * FROM collection_context ORDER BY job_id').all(),
  profiles:db.prepare('SELECT * FROM category_profiles ORDER BY id').all(),foreign:db.prepare('SELECT * FROM products WHERE owner_id<>? ORDER BY id').all('owner')};
}

for(const company of companies)test(`empty product-label rows are omitted while exact prior full-row PNG proofs remain usable (${company.code})`,async()=>{
 const f=await sizeChartApiFixture(company);
 try{
  const {h}=f,model=h.load('app/product-label.ts'),attachment=h.load('app/product-label-attachment.ts'),endpoint=f.base+'/product-labels'+f.query,quotationEndpoint=f.base+'/quotation-fields'+f.query;
  const read=()=>f.route(endpoint).then(json),save=(view,changes,structure)=>f.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes,...(structure===undefined?{}:{structure})}}).then(json);
  const requests=[],request=async(url,init={})=>{requests.push({url,method:init.method??'GET'});return url==='/api/files'?h.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:init.body})):f.route(url,{method:init.method??'GET',...(init.body!==undefined?{body:init.body}:{})});};
  const copy={...h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.id),id:'other-company-product',owner_id:'other-company-owner'};
  const columns=Object.keys(copy);h.sqlite.prepare(`INSERT INTO products(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(key=>copy[key]));
  const target=h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(f.view.resolved.schema.fields,'labelImages');
  const selectKey=key=>f.edit(target.linked.map(fieldKey=>({fieldKey,optionId:'synthetic-one',value:key})));
  await selectKey('');
  let view=await read();
  const defaults=model.productLabelStructure(view),values={productName:'합성 확인 제품명',manufacturer:'',importer:company.name,countryOfOrigin:'',netContents:'',material:'',productType:'',precautions:' ',usageStandard:''};
  view=await save(view,Object.entries(values).map(([fieldKey,value])=>({fieldKey,optionId:null,value})).concat([
   {fieldKey:'productName',optionId:'synthetic-two',value:'다른 옵션 제품명'},{fieldKey:'productName',optionId:'synthetic-excluded',value:'제외 옵션 제품명'},
  ]));
  const baseline=preserved(f),quoteBefore=await json(await f.route(quotationEndpoint)),originalFiles=new Map([...h.objects].map(([key,bytes])=>[key,sha(bytes)])),originalImages=plain(view.imageKeys);
  const context={productId:f.id,endpoint,quotationEndpoint,optionId:'synthetic-one'};
  const attach=renderedView=>attachment.attachProductLabel({...context,renderedView,blob:new Blob([png],{type:'image/png'}),uploadedKey:null,onUploaded(){}},request);

  // Existing-version fixture: temporarily expose only the exact 17ec5d6
  // full-row layout to the actual upload/proof/attachment handlers. Restore
  // immediately; production writes below always use the current filtered plan.
  const currentPlan=model.productLabelPlan;
  model.productLabelPlan=(saved,id)=>{const plan=currentPlan(saved,id),selected=saved.rows.find(row=>row.optionId===id);return{...plan,rows:model.productLabelDefinitions(saved).map(field=>[field.label,selected.values[field.key]])};};
  let old,oldPlan;
  try{oldPlan=plain(model.productLabelPlan(view,'synthetic-one'));old=await attach(view);}finally{model.productLabelPlan=currentPlan;}
  assert.equal(oldPlan.rows.length,9);
  const oldObject=await h.bindings.FILES.head(old.key),oldMetadata=plain(oldObject.customMetadata);
  assert.equal(oldMetadata.productLabelRecipe,'product-label-png-v1');assert.equal(oldMetadata.productLabelPlanSha256,sha(JSON.stringify(oldPlan)));
  view=await read();const savedBeforePlan=allTables(f),filtered=plain(model.productLabelPlan(view,'synthetic-one'));
  assert.deepEqual(filtered.rows,[['제품명','합성 확인 제품명'],['수입 및 판매원',company.name],['사용 시 주의사항',' ']]);
  assert.equal(allTables(f),savedBeforePlan,'printing never clears saved empty values');
  assert.deepEqual(plain(view.overrides.common),values);
  const compatible=await json(await f.route(f.endpoint));assert.equal(compatible.review.canPrepare,true,JSON.stringify(compatible.review.issues));
  assert.ok(!compatible.review.issues.some(issue=>issue.code==='GENERATED_PRODUCT_LABEL_STALE'));
  assert.deepEqual(plain((await h.bindings.FILES.head(old.key)).customMetadata),oldMetadata,'read-only compatibility does not rewrite old proof');
  const modern=await attach(view),modernMetadata=(await h.bindings.FILES.head(modern.key)).customMetadata;
  assert.notEqual(modern.key,old.key);assert.equal(modernMetadata.productLabelPlanSha256,sha(JSON.stringify(filtered)));
  assert.ok(h.objects.has(old.key));assert.equal(modern.quotation.resolved.rows.find(row=>row.optionId==='synthetic-one').fields[target.primary].value,modern.key);

  const staleCodes=[];
  const rejectBoth=async()=>{for(const key of [old.key,modern.key]){await selectKey(key);const pkg=await json(await f.route(f.endpoint));assert.equal(pkg.review.canPrepare,false);assert.ok(pkg.review.issues.some(issue=>issue.code==='GENERATED_PRODUCT_LABEL_STALE'));staleCodes.push({key,code:'GENERATED_PRODUCT_LABEL_STALE'});}};
  view=await read();view=await save(view,[],defaults.map(field=>field.id==='productName'?{...field,label:'바꾼 제품명 제목'}:field));
  await rejectBoth();
  view=await save(await read(),[],defaults);
  for(const key of [old.key,modern.key]){await selectKey(key);assert.equal((await json(await f.route(f.endpoint))).review.canPrepare,true,'restoring exact facts restores both exact plan proofs');}
  view=await save(await read(),[{fieldKey:'productName',optionId:null,value:'변경된 확인 제품명'}]);await rejectBoth();
  const structure=[{id:'custom_storage',label:'보관 안내',required:false},{id:'importer',label:'수입 및 판매원',required:false},
   {id:'productName',label:'제품명',required:true},{id:'precautions',label:'주의사항',required:false},{id:'material',label:'재질',required:false}];
  view=await save(await read(),[{fieldKey:'custom_storage',optionId:null,value:'0'},{fieldKey:'custom_storage',optionId:'synthetic-one',value:''},
   {fieldKey:'importer',optionId:'synthetic-two',value:''}],structure);
  const selected=plain(model.productLabelPlan(view,'synthetic-one')),other=plain(model.productLabelPlan(view,'synthetic-two'));
  assert.deepEqual(selected.rows,[['수입 및 판매원',company.name],['제품명','변경된 확인 제품명'],['주의사항',' ']]);
  assert.deepEqual(other.rows,[['보관 안내','0'],['제품명','다른 옵션 제품명'],['주의사항',' ']]);
  assert.equal(view.overrides.options['synthetic-one'].custom_storage,'');assert.equal(view.overrides.options['synthetic-two'].importer,'');
  assert.throws(()=>model.productLabelPlan(view,'synthetic-excluded'),/포함/);
  const regenerated=await attach(view),meta=(await h.bindings.FILES.head(regenerated.key)).customMetadata;
  assert.equal(meta.productLabelPlanSha256,sha(JSON.stringify(selected)));assert.notEqual(regenerated.key,old.key);assert.notEqual(regenerated.key,modern.key);
  const ready=await json(await f.route(f.endpoint));assert.equal(ready.review.canPrepare,true,JSON.stringify(ready.review.issues));
  const published=await json(await f.prepare(ready.fingerprint));assert.equal(published.prepared,true);assert.equal(published.remoteWrites,false);assert.equal(published.registered,false);assert.equal(published.submissionReady,false);
  const finalQuote=await json(await f.route(quotationEndpoint));
  for(const entry of finalQuote.resolved.rows){const before=quoteBefore.resolved.rows.find(item=>item.optionId===entry.optionId);for(const[field,cell]of Object.entries(entry.fields))if(entry.optionId!=='synthetic-one'||!target.linked.includes(field))assert.deepEqual(cell,before.fields[field],`preserved quote ${entry.optionId}/${field}`);}
  // Empty-all protection does not consume archived values. A literal space
  // remains printable, matching the source's truthiness rule without trimming.
  view=await save(await read(),[{fieldKey:'productName',optionId:'synthetic-one',value:''}],[{id:'productName',label:'제품명',required:true}]);
  assert.throws(()=>model.productLabelPlan(view,'synthetic-one'),/한 항목|저장/);
  const archives=plain(view.overrides);
  view=await save(view,[{fieldKey:'productName',optionId:'synthetic-one',value:' '}]);
  assert.deepEqual(plain(model.productLabelPlan(view,'synthetic-one').rows),[['제품명',' ']]);
  assert.equal(view.overrides.common.custom_storage,archives.common.custom_storage);assert.equal(view.overrides.options['synthetic-two'].importer,'');
  assert.deepEqual(preserved(f),baseline);
  for(const[key,digest]of originalFiles)assert.equal(sha(h.objects.get(key)),digest);
  assert.equal(sha(h.objects.get(old.key)),sha(png));assert.deepEqual(plain((await h.bindings.FILES.head(old.key)).customMetadata),oldMetadata);
  assert.ok(originalImages.every(key=>JSON.parse(h.sqlite.prepare('SELECT image_keys FROM products WHERE id=?').get(f.id).image_keys).includes(key)));
  assert.deepEqual(h.network,[]);
  cases.push({company,syntheticSource:true,priorFullRows:oldPlan.rows.length,newRows:filtered.rows,customOptionRows:selected.rows,customOtherRows:other.rows,
   oldPlanSha256:oldMetadata.productLabelPlanSha256,newPlanSha256:modernMetadata.productLabelPlanSha256,oldKey:old.key,newKey:modern.key,regeneratedKey:regenerated.key,
   unchangedLegacyProofAccepted:true,staleChecks:staleCodes.length,sourceLegalSettingsImagesOtherOwnerPreserved:true,
   requests:f.requests.length,fileUploads:requests.filter(item=>item.url==='/api/files'&&item.method==='POST').length,registered:false,remoteWrites:false});
 }finally{f.close();}
});

test.after(()=>{assert.deepEqual(hashes(),frozen);if(process.env.STEP703_PROOF_PATH)fs.writeFileSync(process.env.STEP703_PROOF_PATH,JSON.stringify({sourceHashes:frozen,cases,externalRequests:0,browserActions:0,operatingProductWrites:0,supplierHubWrites:0,
 boundary:'Actual local handlers/SQLite/proof/attachments/Single package; valid synthetic PNG bytes, no rendered glyph pixel claim. Prior full-row PNGs are produced with an explicitly isolated old-layout function override.'},null,2));});
