import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {sizeChartApiFixture,companies,json,plain,allTables} from './helpers/supplier-hub-single-size-chart.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
const proofs=[];
const proofFiles=['app/product-label.ts','db/product-labels.ts','app/api/products/[id]/product-labels/route.ts','app/document-image-render.ts','tests/product-label-structure-api.test.mjs'];
const sourceHashes=()=>Object.fromEntries(proofFiles.map(file=>[file,sha(fs.readFileSync(file))]));
const frozenSourceHashes=sourceHashes();
const row=(view,id)=>view.rows.find(item=>item.optionId===id);
const structure=[{id:'productName',label:'검수 제품명',required:true},{id:'custom_storage',label:'보관 방법',required:false},
 {id:'netContents',label:'실내용량',required:false},{id:'material',label:'구성 재질',required:false}];

// Exercise the actual renderer's dynamic-row/width path. The canvas records
// glyph calls and returns a valid synthetic PNG; this does not claim pixel or
// browser font fidelity. Actual file/proof/attachment handlers verify the PNG.
async function renderedLabel(h,plan){
 const printed=[],canvas={width:0,height:0,getContext(){return{measureText:value=>({width:[...value].length*10}),fillRect(){},fillText(value,x,y){printed.push({value,x,y});}};},toBlob(callback,type){assert.equal(type,'image/png');callback(new Blob([png],{type}));}};
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/document-image-render.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,Blob,Error,document:{fonts:{load:async()=>[],ready:Promise.resolve()},createElement:tag=>{assert.equal(tag,'canvas');return canvas;}},require:name=>{assert.equal(name,'@/app/document-image');return h.load('app/document-image.ts');}});
 const result=await exports.renderDocument(plan);
 assert.deepEqual(printed.filter(item=>item.x===32).map(item=>item.value),plan.rows.map(([label])=>label+': '));
 assert.equal(result.width,800);assert.ok(result.height>0&&result.height<=12000);
 return{...result,printed};
}

function retained(f){
 const db=f.h.sqlite,product=db.prepare('SELECT * FROM products WHERE id=?').get(f.id);
 delete product.updated_at;delete product.quote_status;delete product.image_keys;
 return{product,content:db.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.id).payload,
  options:db.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id).payload,
  settings:db.prepare('SELECT * FROM workspace_settings ORDER BY owner_id').all(),context:db.prepare('SELECT * FROM collection_context ORDER BY job_id').all(),
  profiles:db.prepare('SELECT * FROM category_profiles ORDER BY id').all(),foreign:db.prepare('SELECT * FROM products WHERE owner_id<>? ORDER BY id').all('owner')};
}

for(const company of companies)test(`shared label structure reaches selected PNG and Single package without rewriting facts or legal notices (${company.code})`,async()=>{
 const f=await sizeChartApiFixture(company);
 try{
  const {h}=f,endpoint=f.base+'/product-labels'+f.query,quotationEndpoint=f.base+'/quotation-fields'+f.query;
  // Keep this old-format fixture explicit; new-product initialization is
  // covered separately and must not change legacy plans or upload identities.
  h.sqlite.prepare('DELETE FROM product_labels WHERE product_id=? AND owner_id=?').run(f.id,'owner');
  const model=h.load('app/product-label.ts'),upload=h.load('app/product-label-upload.ts'),attachment=h.load('app/product-label-attachment.ts');
  const read=()=>f.route(endpoint).then(json),save=(view,changes,nextStructure)=>f.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes,...(nextStructure===undefined?{}:{structure:nextStructure})}});
  const requests=[];
  const request=async(url,init={})=>{requests.push({url,method:init.method??'GET'});if(url==='/api/files')return h.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:init.body}));return f.route(url,{method:init.method??'GET',...(init.body!==undefined?{body:init.body}:{})});};
  const copied={...h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.id),id:'unrelated-product',owner_id:'unrelated-owner'};
  const columns=Object.keys(copied);h.sqlite.prepare(`INSERT INTO products(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(key=>copied[key]));
  const labelTarget=h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(f.view.resolved.schema.fields,'labelImages');
  await f.edit(labelTarget.linked.map(fieldKey=>({fieldKey,optionId:'synthetic-one',value:''})));
  let view=await read();assert.equal(Object.hasOwn(view,'structure'),false,'legacy storage remains optional until explicit structure save');
  const defaultStructure=model.productLabelFields.map(field=>({id:field.key,label:field.label,required:field.key==='productName'}));
  view=await json(await save(view,[{optionId:null,fieldKey:'manufacturer',value:'보관할 제조원'},
   {optionId:null,fieldKey:'material',value:'공통 확인 재질'},{optionId:'synthetic-one',fieldKey:'material',value:'옵션 확인 재질'},
   {optionId:'synthetic-two',fieldKey:'material',value:''},{optionId:'synthetic-excluded',fieldKey:'material',value:'제외 옵션 보존 재질'}]));
  const legacyPlan=plain(model.productLabelPlan(view,'synthetic-one')),sourceBefore=retained(f),quoteBefore=await json(await f.route(quotationEndpoint));
  const fileBefore=new Map([...h.objects].map(([key,bytes])=>[key,sha(bytes)])),imagesBefore=plain(view.imageKeys),stale=plain(view);
  view=await json(await save(view,[{optionId:null,fieldKey:'custom_storage',value:'건조한 곳 보관'},
   {optionId:'synthetic-one',fieldKey:'custom_storage',value:''},{optionId:null,fieldKey:'netContents',value:''}],structure));
  assert.deepEqual(plain(view.structure),structure);assert.deepEqual(plain((await read()).structure),structure);
  assert.equal(view.overrides.common.manufacturer,'보관할 제조원','removed fixed values are archived');
  assert.equal(row(view,'synthetic-one').values.custom_storage,'');assert.equal(row(view,'synthetic-two').values.custom_storage,'건조한 곳 보관');
  assert.equal(row(view,'synthetic-two').values.material,'');assert.equal(row(view,'synthetic-excluded').included,false);
  assert.equal(row(view,'synthetic-excluded').values.material,'제외 옵션 보존 재질');
  const plan=plain(model.productLabelPlan(view,'synthetic-one')),commonPlan=plain(model.productLabelPlan(view,null));
  assert.deepEqual(plan.rows,[[structure[0].label,row(view,'synthetic-one').values.productName],['구성 재질','옵션 확인 재질']]);
  assert.equal(commonPlan.rows[1][1],'건조한 곳 보관');assert.ok(!plan.rows.some(([label])=>label==='제조원'));
  assert.throws(()=>model.productLabelPlan(view,'synthetic-excluded'),/포함/);
  assert.deepEqual(retained(f),sourceBefore);assert.deepEqual((await json(await f.route(quotationEndpoint))).overrides,quoteBefore.overrides);
  const context={productId:f.id,endpoint,optionId:'synthetic-one'},signature=upload.productLabelPreviewSignature({...context,view}),uploadId=await upload.productLabelUploadId({...context,view});
  assert.notEqual(uploadId,await upload.productLabelUploadId({...context,view:stale}));
  const rendered=await renderedLabel(h,plan);
  const attached=await attachment.attachProductLabel({...context,quotationEndpoint,renderedView:view,blob:rendered.blob,uploadedKey:null,onUploaded(){}},request);
  assert.deepEqual(h.objects.get(attached.key),png);
  const metadata=(await h.bindings.FILES.head(attached.key)).customMetadata;
  assert.equal(metadata.productLabelPlanSha256,sha(JSON.stringify(plan)));assert.equal(metadata.productLabelOptionId,'synthetic-one');
  assert.equal(metadata.productLabelRecipe,'product-label-png-v1');
  const afterQuote=await json(await f.route(quotationEndpoint));
  for(const currentRow of afterQuote.resolved.rows){const previous=quoteBefore.resolved.rows.find(item=>item.optionId===currentRow.optionId);for(const[field,cell]of Object.entries(currentRow.fields))if(currentRow.optionId!=='synthetic-one'||!labelTarget.linked.includes(field))assert.deepEqual(cell,previous.fields[field],`unchanged quotation ${currentRow.optionId}/${field}`);}
  for(const field of labelTarget.linked)assert.equal(afterQuote.resolved.rows.find(item=>item.optionId==='synthetic-one').fields[field].value,attached.key);
  const ready=await json(await f.route(f.endpoint));assert.equal(ready.review.canPrepare,true,JSON.stringify(ready.review.issues));
  const published=await json(await f.prepare(ready.fingerprint));assert.equal(published.prepared,true);assert.equal(published.remoteWrites,false);assert.equal(published.registered,false);assert.equal(published.submissionReady,false);
  assert.ok(JSON.stringify(published.payload).includes('https://single-assets.example.test/'));
  view=await read();const blankRename=structure.map(item=>item.id==='custom_storage'?{...item,label:'보관 안내 변경'}:item);
  view=await json(await save(view,[],blankRename));assert.equal(upload.productLabelPreviewSignature({...context,view}),signature,'an omitted empty row caption does not change printed pixels');
  assert.equal((await json(await f.route(f.endpoint))).review.canPrepare,true);
  const nextStructure=blankRename.map(item=>item.id==='material'?{...item,label:'확인한 구성 재질'}:item);
  view=await json(await save(view,[],nextStructure));assert.notEqual(upload.productLabelPreviewSignature({...context,view}),signature);
  const oldPackage=await json(await f.route(f.endpoint));assert.equal(oldPackage.review.canPrepare,false);assert.ok(oldPackage.review.issues.some(issue=>issue.code==='GENERATED_PRODUCT_LABEL_STALE'));
  const beforeRetry=requests.length;
  await assert.rejects(attachment.attachProductLabel({...context,quotationEndpoint,renderedView:attached.view,blob:rendered.blob,uploadedKey:attached.key,onUploaded(){}},request),/변경|다시/);
  assert.ok(requests.slice(beforeRetry).every(item=>item.method==='GET'));
  const nextPlan=plain(model.productLabelPlan(view,'synthetic-one')),nextRendered=await renderedLabel(h,nextPlan);
  const replaced=await attachment.attachProductLabel({...context,quotationEndpoint,renderedView:view,blob:nextRendered.blob,uploadedKey:null,onUploaded(){}},request);
  assert.notEqual(replaced.key,attached.key);assert.ok(h.objects.has(attached.key),'previous PNG retained');
  assert.equal(replaced.quotation.resolved.rows.find(item=>item.optionId==='synthetic-one').fields[labelTarget.primary].value,replaced.key);
  assert.equal((await json(await f.route(f.endpoint))).review.canPrepare,true);
  view=await read();const archived=plain(view.overrides);
  view=await json(await save(view,[],defaultStructure));assert.deepEqual(plain(model.productLabelPlan(view,'synthetic-one')),legacyPlan);
  assert.equal(row(view,'synthetic-one').values.manufacturer,'보관할 제조원');assert.deepEqual(plain(view.overrides),archived);
  view=await json(await save(view,[],structure));assert.equal(row(view,'synthetic-one').values.custom_storage,'');assert.equal(row(view,null).values.custom_storage,'건조한 곳 보관');
  const untouched=allTables(f);
  assert.equal((await save(stale,[],structure)).status,409);assert.equal(allTables(f),untouched);
  for(const invalid of [[],structure.filter(item=>item.id!=='productName'),structure.map(item=>item.id==='productName'?{...item,required:false}:item),[...structure,structure[0]],structure.map(item=>item.id==='custom_storage'?{...item,label:''}:item),[...structure,{id:'noticeMaterial',label:'법적 고시 혼입',required:false}]]){
   assert.equal((await save(view,[],invalid)).status,400);assert.equal(allTables(f),untouched);
  }
  assert.equal((await save(view,[{optionId:'not-owned-option',fieldKey:'custom_storage',value:'forged'}])).status,400);assert.equal(allTables(f),untouched);
  assert.deepEqual(retained(f),sourceBefore);
  for(const[key,digest]of fileBefore)assert.equal(sha(h.objects.get(key)),digest);
  assert.ok(imagesBefore.every(key=>JSON.parse(h.sqlite.prepare('SELECT image_keys FROM products WHERE id=?').get(f.id).image_keys).includes(key)));
  assert.deepEqual(h.network,[]);assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products WHERE id=?').get(f.id).supplier_hub_status,sourceBefore.product.supplier_hub_status);
  proofs.push({company,syntheticSource:true,legacyRows:legacyPlan.rows.length,activeRows:plan.rows,renamedRows:nextPlan.rows,uploadId,firstKey:attached.key,replacementKey:replaced.key,
   requestCount:f.requests.length,uploads:requests.filter(item=>item.url==='/api/files'&&item.method==='POST').length,
   commonStructure:true,explicitBlanks:true,archivedValues:true,stalePlanBlocked:true,sourceAndLegalUnchanged:true,initialImageBytesUnchanged:true,otherOwnerUnchanged:true,registered:false,remoteWrites:false});
 }finally{f.close();}
});

test.after(()=>{assert.deepEqual(sourceHashes(),frozenSourceHashes,'tested sources remain fixed during the run');if(process.env.STEP702_PROOF_PATH)fs.writeFileSync(process.env.STEP702_PROOF_PATH,JSON.stringify({cases:proofs,sourceHashes:frozenSourceHashes,externalRequests:0,browserActions:0,supplierHubWrites:0,operatingProductWrites:0,pixelFidelity:'not asserted; synthetic canvas and PNG fixtures'},null,2));});
