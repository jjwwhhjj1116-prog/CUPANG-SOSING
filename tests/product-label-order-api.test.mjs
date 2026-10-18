import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {sizeChartApiFixture,companies,json,plain,allTables} from './helpers/supplier-hub-single-size-chart.mjs';
import {SINGLE_DOCUMENT_LIVE_VERIFIED} from '../extensions/supplier-hub/single-dispatch.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
const files=['app/product-label.ts','db/product-labels.ts','app/api/products/[id]/product-labels/route.ts','app/product-label-upload.ts',
 'app/product-label-proof.ts','app/product-label-attachment.ts','app/document-image-render.ts','app/supplier-hub-single-assets.ts',
 'app/supplier-hub-single-projection.ts','app/supplier-hub-single-client.ts','tests/product-label-order-api.test.mjs','tests/helpers/supplier-hub-single-size-chart.mjs'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,sha(fs.readFileSync(new URL('../'+file,import.meta.url)))]));
const frozen=hashes(),proofs=[];
const initialStructure=[{id:'productName',label:'제품 이름',required:true},{id:'material',label:'확인 재질',required:false},
 {id:'custom_storage',label:'보관 방법',required:false},{id:'netContents',label:'구성 수량',required:false}];
const reordered=[initialStructure[3],initialStructure[2],initialStructure[1],initialStructure[0]];
const values=view=>view.rows.map(row=>({optionId:row.optionId,optionLabel:row.optionLabel,included:row.included,
 values:Object.fromEntries(Object.entries(row.values).sort()),automatic:Object.fromEntries(Object.entries(row.automatic).sort()),sources:Object.fromEntries(Object.entries(row.sources).sort())}));

function protectedState(f){
 const db=f.h.sqlite,product={...db.prepare('SELECT * FROM products WHERE id=?').get(f.id)};
 delete product.updated_at;delete product.quote_status;delete product.image_keys;
 return {product,...Object.fromEntries(['product_content','product_options','product_price_policy'].map(table=>[table,db.prepare('SELECT * FROM '+table+' WHERE product_id=?').get(f.id)])),
  settings:db.prepare('SELECT * FROM workspace_settings ORDER BY owner_id').all(),profiles:db.prepare('SELECT * FROM category_profiles ORDER BY id').all(),
  collection:db.prepare('SELECT * FROM collection_context ORDER BY job_id').all(),otherProducts:db.prepare('SELECT * FROM products WHERE id<>? ORDER BY id').all(f.id)};
}

// The real renderer runs with a recording canvas and a valid inert PNG body.
// This checks drawing order and the actual upload/recipe pipeline, not browser
// glyph pixels, remote publication availability or Supplier Hub acceptance.
async function render(h,plan){
 const printed=[],canvas={width:0,height:0,getContext(){return {measureText:value=>({width:[...value].length*10}),fillRect(){},fillText(value,x,y){printed.push({value,x,y});}};},
  toBlob(callback,type){assert.equal(type,'image/png');callback(new Blob([png],{type}));}};
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/document-image-render.ts',import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,Blob,Error,document:{fonts:{load:async()=>[],ready:Promise.resolve()},createElement:tag=>{assert.equal(tag,'canvas');return canvas;}},
  require:name=>{assert.equal(name,'@/app/document-image');return h.load('app/document-image.ts');}});
 const rendered=await exports.renderDocument(plan);
 assert.deepEqual(printed.filter(item=>item.x===32).map(item=>item.value),plan.rows.map(([label])=>label+': '));
 assert.equal(rendered.width,800);assert.ok(rendered.height>0&&rendered.height<=12000);
 return rendered;
}

for(const company of companies)test(`metadata-only label reorder survives reload, exact option PNG regeneration and Single packet (${company.code})`,async()=>{
 const f=await sizeChartApiFixture(company);
 try{
  const {h}=f,endpoint=f.base+'/product-labels'+f.query,quotationEndpoint=f.base+'/quotation-fields'+f.query,calls=[];
  const request=async(url,init={})=>{
   const response=url==='/api/files'?await h.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:init.body})):
    await f.route(url,{method:init.method??'GET',...(init.body!==undefined?{body:init.body}:{})});
   calls.push({url,method:init.method??'GET',status:response.status});return response;
  };
  const read=()=>request(endpoint).then(json),quote=()=>request(quotationEndpoint).then(json);
  const save=(view,changes,structure)=>request(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes,
   ...(structure===undefined?{}:{structure})}}).then(json);
  const saveQuote=async changes=>{const view=await quote();return json(await request(quotationEndpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));};
  const target=h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(f.view.resolved.schema.fields,'labelImages');
  await saveQuote([null,'synthetic-one','synthetic-two'].flatMap(optionId=>target.linked.map(fieldKey=>({optionId,fieldKey,value:''}))));
  let view=await save(await read(),[{optionId:null,fieldKey:'material',value:'공통 원료'},
   {optionId:'synthetic-one',fieldKey:'material',value:'옵션 직접 원료'},{optionId:'synthetic-two',fieldKey:'material',value:''},
   {optionId:'synthetic-excluded',fieldKey:'material',value:'제외 옵션 값 보존'},
   {optionId:null,fieldKey:'custom_storage',value:'건조한 곳 보관'},{optionId:null,fieldKey:'netContents',value:'1개'}],initialStructure);
  const unrelated={...h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.id),id:'unrelated-label-order',owner_id:'unrelated-owner'};
  const columns=Object.keys(unrelated);h.sqlite.prepare(`INSERT INTO products(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(key=>unrelated[key]));
  const model=h.load('app/product-label.ts'),upload=h.load('app/product-label-upload.ts'),attachment=h.load('app/product-label-attachment.ts');
  const attach=async optionId=>{
   const saved=await read(),plan=plain(model.productLabelPlan(saved,optionId)),rendered=await render(h,plan);
   const out=await attachment.attachProductLabel({productId:f.id,endpoint,quotationEndpoint,optionId,renderedView:saved,blob:rendered.blob,uploadedKey:null,onUploaded(){}},request);
   assert.equal((await h.bindings.FILES.head(out.key)).customMetadata.productLabelPlanSha256,sha(JSON.stringify(plan)));
   return {...out,plan};
  };
  const first=await attach('synthetic-one'),second=await attach('synthetic-two'),common=await attach(null);
  const oldQuote=await quote(),ownReferences=oldQuote.resolved.rows.filter(row=>row.included).map(row=>[row.optionId,row.fields[target.primary].value]);
  assert.deepEqual(ownReferences,[['synthetic-one',first.key],['synthetic-two',second.key]],'common attachment preserves both exact option references');
  assert.equal(oldQuote.overrides.common[target.primary],common.key);
  assert.equal((await json(await request(f.endpoint))).review.canPrepare,true);
  const sourceBefore=protectedState(f),originalFiles=new Map([...h.objects].map(([key,bytes])=>[key,sha(bytes)]));
  view=await read();const before=plain(view),beforeValues=values(view),beforeOverrides=plain(view.overrides),beforePool=plain(view.imageKeys);
  const oldRecipes=await Promise.all(['synthetic-one','synthetic-two'].map(optionId=>upload.productLabelUploadId({productId:f.id,endpoint,optionId,view})));
  view=await save(view,[],reordered);
  model.verifyProductLabelSave(before,view,null,{},reordered);
  assert.equal(view.revision,before.revision+1);assert.equal(view.quotationRevision,before.quotationRevision);assert.equal(view.contentRevision,before.contentRevision);assert.equal(view.optionRevision,before.optionRevision);
  assert.ok(Date.parse(view.productVersion)>Date.parse(before.productVersion));assert.deepEqual(plain(view.structure),reordered);
  assert.deepEqual(plain((await read()).structure),reordered);assert.deepEqual(values(view),beforeValues);assert.deepEqual(plain(view.overrides),beforeOverrides);assert.deepEqual(plain(view.imageKeys),beforePool);
  assert.deepEqual(JSON.parse(h.sqlite.prepare('SELECT payload FROM product_labels WHERE product_id=?').get(f.id).payload).structure,reordered);
  assert.deepEqual(protectedState(f),sourceBefore);
  const reorderedPlans=['synthetic-one','synthetic-two'].map(optionId=>plain(model.productLabelPlan(view,optionId)));
  for(const[index,optionId]of ['synthetic-one','synthetic-two'].entries()){
   const row=view.rows.find(row=>row.optionId===optionId);
   assert.deepEqual(reorderedPlans[index].rows,reordered.filter(field=>row.values[field.id]!=='').map(field=>[field.label,row.values[field.id]]));
   assert.notEqual(await upload.productLabelUploadId({productId:f.id,endpoint,optionId,view}),oldRecipes[index]);
  }
  assert.ok(!reorderedPlans[1].rows.some(([heading])=>heading==='확인 재질'),'option manual blank remains omitted rather than inheriting common material');
  const blocked=await json(await request(f.endpoint));
  assert.equal(blocked.review.canPrepare,false);assert.deepEqual(blocked.review.issues.filter(issue=>issue.code==='GENERATED_PRODUCT_LABEL_STALE').map(issue=>issue.optionId).sort(),['synthetic-one','synthetic-two']);
  assert.deepEqual(plain((await quote()).overrides),plain(oldQuote.overrides));
  const retryStart=calls.length;
  await assert.rejects(attachment.attachProductLabel({productId:f.id,endpoint,quotationEndpoint,optionId:'synthetic-one',renderedView:first.view,blob:null,uploadedKey:first.key,onUploaded(){}},request),/변경|다시/);
  assert.ok(calls.slice(retryStart).every(call=>call.method==='GET'));
  const nextFirst=await attach('synthetic-one');assert.notEqual(nextFirst.key,first.key);
  const partial=await json(await request(f.endpoint));assert.equal(partial.review.canPrepare,false);
  assert.deepEqual(partial.review.issues.filter(issue=>issue.code==='GENERATED_PRODUCT_LABEL_STALE').map(issue=>issue.optionId),['synthetic-two']);
  assert.equal((await quote()).resolved.rows.find(row=>row.optionId==='synthetic-two').fields[target.primary].value,second.key);
  const nextSecond=await attach('synthetic-two'),nextCommon=await attach(null);
  assert.notEqual(nextSecond.key,second.key);assert.notEqual(nextCommon.key,common.key);
  const finalQuote=await quote();
  assert.equal(finalQuote.overrides.common[target.primary],nextCommon.key);
  for(const[current,previous]of finalQuote.resolved.rows.map(row=>[row,oldQuote.resolved.rows.find(old=>old.optionId===row.optionId)])){
   for(const[field,cell]of Object.entries(current.fields))if(!target.linked.includes(field))assert.deepEqual(cell,previous.fields[field],`unchanged quotation ${current.optionId}/${field}`);
  }
  for(const[optionId,expected]of [['synthetic-one',nextFirst.key],['synthetic-two',nextSecond.key]])for(const field of target.linked)assert.equal(finalQuote.resolved.rows.find(row=>row.optionId===optionId).fields[field].value,expected);
  assert.deepEqual(protectedState(f),sourceBefore);assert.deepEqual(values(await read()),beforeValues);
  for(const[key,digest]of originalFiles)assert.equal(sha(h.objects.get(key)),digest,'old files stay intact: '+key);
  const ready=await json(await request(f.endpoint));assert.equal(ready.review.canPrepare,true,JSON.stringify(ready.review.issues));
  const database=allTables(f),privateFiles=f.objectState();
  const prepared=await json(await request(f.endpoint,{method:'POST',body:{action:'prepare',expectedFingerprint:ready.fingerprint}}));
  assert.equal(prepared.prepared,true);assert.equal(prepared.registered,false);assert.equal(prepared.remoteWrites,false);assert.equal(prepared.submissionReady,false);
  const packets=[];
  for(const[optionId,key]of [['synthetic-one',nextFirst.key],['synthetic-two',nextSecond.key]]){
   const slot=prepared.manifest.find(slot=>slot.role==='label'&&slot.optionId===optionId);assert.deepEqual(slot.keys,[key]);assert.equal(slot.files.length,1);
   const file=slot.files[0];assert.equal(file.published,true);assert.equal(file.sha256,sha(png));
   const served=await f.serve(file.url);assert.equal(served.status,200);assert.equal(sha(new Uint8Array(await served.arrayBuffer())),sha(png));
   const packet=await h.load('app/supplier-hub-single-client.ts').singlePackagePacket(prepared,'owner',optionId);
   assert.equal(packet.company.code,company.code);assert.equal(packet.optionId,optionId);assert.equal(packet.body.docId,null);assert.equal(packet.body.jsonDocument.length,1);
   assert.equal(packet.body.jsonDocument[0].imagePage.images.labelImages.find(item=>item.labelImageType===slot.wire.name).labelImageFiles,file.url);
   packets.push({optionId,key,url:file.url,planSha256:sha(JSON.stringify(optionId==='synthetic-one'?nextFirst.plan:nextSecond.plan)),pngSha256:file.sha256});
  }
  assert.ok(!prepared.manifest.some(slot=>slot.role==='label'&&[first.key,second.key,common.key,nextCommon.key].some(key=>slot.keys.includes(key))));
  assert.equal(allTables(f),database,'Single preparation does not rewrite business state');assert.equal(f.objectState(),privateFiles);
  assert.deepEqual(h.network,[]);assert.equal(h.aiSources.length,0);assert.equal(SINGLE_DOCUMENT_LIVE_VERIFIED,false);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_single_receipts').get().n,0);
  proofs.push({company,requests:calls,requestCount:calls.length,mediaRequests:2,metadataOnlySave:true,beforeStructure:initialStructure,afterStructure:reordered,
   valuesAndNamesUnchanged:true,optionManualBlank:true,excludedValuesUnchanged:true,oldPngStaleForBothOptions:true,oneOptionRegenerationLeavesOtherStale:true,
   commonAttachmentPreservesOptionReferences:true,sourceAndPricesUnchanged:true,otherProductUnchanged:true,oldFilesUnchanged:true,
   packets,registered:false,remoteWrites:false,submissionReady:false,liveGate:SINGLE_DOCUMENT_LIVE_VERIFIED});
 }finally{f.close();}
});

test.after(()=>{
 assert.deepEqual(hashes(),frozen,'pure/backend sources stay frozen while testing');
 if(process.env.STEP710_PROOF_PATH)fs.writeFileSync(process.env.STEP710_PROOF_PATH,JSON.stringify({format:'product-label-order-api-proof-v1',sourceHashes:frozen,cases:proofs,
  externalRequests:0,browserActions:0,providerCalls:0,productionWrites:0,supplierHubWrites:0,
  boundary:'Actual local route handlers, SQLite/R2, renderer drawing order, server PNG proof and Single packet; synthetic schema/canvas/PNG. No pixel fidelity or actual Hub acceptance claimed.'},null,2)+'\n');
});
