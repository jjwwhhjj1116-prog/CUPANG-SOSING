import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {sizeChartApiFixture,companies,json,plain,allTables} from './helpers/supplier-hub-single-size-chart.mjs';
import {SINGLE_DOCUMENT_LIVE_VERIFIED} from '../extensions/supplier-hub/single-dispatch.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex'),proofs=[];
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
const files=['app/product-label.ts','db/product-labels.ts','app/api/products/[id]/product-labels/route.ts','app/product-label-upload.ts','app/product-label-proof.ts',
 'app/product-label-attachment.ts','app/product-label-references.ts','app/product-label-batch.ts','app/document-image-render.ts','app/supplier-hub-single-assets.ts',
 'app/supplier-hub-single-projection.ts','app/supplier-hub-single-client.ts','tests/product-label-rewrite-single.test.mjs','tests/helpers/supplier-hub-single-size-chart.mjs'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,sha(fs.readFileSync(new URL('../'+file,import.meta.url)))]));
const frozen=hashes();
const structure=[{id:'custom_storage',label:'보관 방법',required:false},{id:'productName',label:'확인 제품명',required:true},{id:'material',label:'원료명',required:false}];
function protectedState(f){
 const db=f.h.sqlite,product={...db.prepare('SELECT * FROM products WHERE id=?').get(f.id)};delete product.updated_at;delete product.quote_status;delete product.image_keys;
 return {product,...Object.fromEntries(['product_content','product_options','product_price_policy'].map(table=>[table,db.prepare('SELECT * FROM '+table+' WHERE product_id=?').get(f.id)])),
  settings:db.prepare('SELECT * FROM workspace_settings ORDER BY owner_id').all(),profiles:db.prepare('SELECT * FROM category_profiles ORDER BY id').all(),
  collection:db.prepare('SELECT * FROM collection_context ORDER BY job_id').all(),otherProducts:db.prepare('SELECT * FROM products WHERE id<>? ORDER BY id').all(f.id)};
}
async function render(h,plan){
 const printed=[],canvas={width:0,height:0,getContext(){return {measureText:value=>({width:[...value].length*10}),fillRect(){},fillText(value,x,y){printed.push({value,x,y});}};},
  toBlob(callback,type){assert.equal(type,'image/png');callback(new Blob([png],{type}));}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/document-image-render.ts',import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,Blob,Error,document:{fonts:{load:async()=>[],ready:Promise.resolve()},createElement:tag=>{assert.equal(tag,'canvas');return canvas;}},require:name=>{assert.equal(name,'@/app/document-image');return h.load('app/document-image.ts');}});
 const out=await exports.renderDocument(plan);assert.deepEqual(printed.filter(item=>item.x===32).map(item=>item.value),plan.rows.map(([name])=>name+': '));return out;
}

for(const company of companies)test(`same-value rewrite regenerates option and inherited common PNGs through exact Single packets (${company.code})`,async()=>{
 const f=await sizeChartApiFixture(company),{h}=f,endpoint=f.base+'/product-labels'+f.query,quotationEndpoint=f.base+'/quotation-fields'+f.query,calls=[];
 const request=async(url,init={})=>{const response=url==='/api/files'?await h.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:init.body})):
  await f.route(url,{method:init.method??'GET',...(init.body===undefined?{}:{body:init.body})});calls.push({url,method:init.method??'GET',status:response.status});return response;};
 const read=()=>request(endpoint).then(json),quote=()=>request(quotationEndpoint).then(json),target=h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(f.view.resolved.schema.fields,'labelImages');
 const model=h.load('app/product-label.ts'),upload=h.load('app/product-label-upload.ts'),attachment=h.load('app/product-label-attachment.ts'),receipt=h.load('app/product-label-proof.ts');
 const saveQuote=async changes=>{const current=await quote();return json(await request(quotationEndpoint,{method:'PUT',body:{expectedRevision:current.revision,expectedInputFingerprint:current.inputFingerprint,changes}}));};
 const attach=async optionId=>{
  const current=await read(),plan=plain(model.productLabelPlan(current,optionId)),rendered=await render(h,plan),context={productId:f.id,endpoint,optionId,view:current};
  const out=await attachment.attachProductLabel({productId:f.id,endpoint,quotationEndpoint,optionId,renderedView:current,blob:rendered.blob,uploadedKey:null,onUploaded(){}},request);
  const id=await upload.productLabelUploadId(context),stored=await receipt.readProductLabelReceipt(id,request);
  assert.equal(stored.key,out.key);assert.equal(stored.proof.renderEpoch,current.renderEpoch);assert.equal(stored.proof.planSha256,sha(JSON.stringify(plan)));
  assert.equal((await h.bindings.FILES.head(out.key)).customMetadata.productLabelRenderEpoch,current.renderEpoch===undefined?undefined:String(current.renderEpoch));
  return {...out,plan,uploadId:id};
 };
 try{
  let view=await read();view=await json(await request(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,structure,
   changes:[{optionId:null,fieldKey:'productName',value:'보존할 공통 제품명'},{optionId:null,fieldKey:'material',value:'실리콘'},
    {optionId:null,fieldKey:'custom_storage',value:'건조한 장소'},{optionId:'synthetic-one',fieldKey:'material',value:''},{optionId:'synthetic-excluded',fieldKey:'material',value:'제외 옵션 직접 값'}]}}));
  const manual='owner/label.png';
  await saveQuote([null,'synthetic-one'].flatMap(optionId=>target.linked.map(fieldKey=>({optionId,fieldKey,value:''}))).concat(target.linked.map(fieldKey=>({optionId:'synthetic-excluded',fieldKey,value:manual}))));
  const foreign={...h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.id),id:'rewrite-unrelated-product',owner_id:'other-owner'},columns=Object.keys(foreign);
  h.sqlite.prepare(`INSERT INTO products(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(key=>foreign[key]));
  const common=await attach(null),old=await attach('synthetic-one'),before=await read(),oldQuote=await quote(),source=protectedState(f);
  assert.equal(Object.hasOwn(before,'renderEpoch'),false);assert.equal(oldQuote.resolved.rows.find(row=>row.optionId==='synthetic-one').fields[target.primary].value,old.key);
  assert.equal(oldQuote.resolved.rows.find(row=>row.optionId==='synthetic-two').fields[target.primary].value,common.key);assert.equal(Object.hasOwn(oldQuote.overrides.options['synthetic-two']??{},target.primary),false);
  assert.equal((await json(await request(f.endpoint))).review.canPrepare,true);
  const originals=new Map([...h.objects].map(([key,bytes])=>[key,sha(bytes)])),contentBefore=plain(before.rows),overridesBefore=plain(before.overrides),imagesBefore=plain(before.imageKeys);
  view=await json(await request(endpoint,{method:'POST',body:{expectedRevision:before.revision,expectedInputFingerprint:before.inputFingerprint}}));
  assert.equal(view.renderEpoch,1);assert.deepEqual(plain(view.rows),contentBefore);assert.deepEqual(plain(view.structure),structure);assert.deepEqual(plain(view.overrides),overridesBefore);assert.deepEqual(plain(view.imageKeys),imagesBefore);
  assert.deepEqual(protectedState(f),source);assert.deepEqual(plain((await quote()).overrides),plain(oldQuote.overrides));
  const blocked=await json(await request(f.endpoint)),dbAfterRewrite=allTables(f),privateAfterRewrite=f.objectState();
  assert.equal(blocked.review.canPrepare,false);assert.deepEqual(blocked.review.issues.filter(issue=>issue.code==='GENERATED_PRODUCT_LABEL_STALE').map(issue=>issue.optionId).sort(),['synthetic-one','synthetic-two']);
  const cannotPrepare=await json(await request(f.endpoint,{method:'POST',body:{action:'prepare',expectedFingerprint:blocked.fingerprint}}));assert.equal(cannotPrepare.prepared,false);assert.equal(f.storage.publicPutAttempts,0);assert.equal(allTables(f),dbAfterRewrite);assert.equal(f.objectState(),privateAfterRewrite);

  // Pure selection guards read actual old receipts. Only genuine common
  // inheritance of a different generation is eligible for option shadowing.
  const inherited=await quote(),selectionInput={productId:f.id,view:inherited,optionId:'synthetic-two',renderEpoch:1};
  assert.deepEqual(plain((await attachment.productLabelReferenceSelection(selectionInput,null,request)).retained),[]);
  assert.deepEqual(plain((await attachment.productLabelReferenceSelection({...selectionInput,renderEpoch:undefined},null,request)).retained),[common.key],'legacy/same-generation cross-scope references remain protected');
  const explicit=plain(inherited);explicit.overrides.options['synthetic-two']={...explicit.overrides.options['synthetic-two'],...Object.fromEntries(target.linked.map(id=>[id,common.key]))};
  assert.deepEqual(plain((await attachment.productLabelReferenceSelection({...selectionInput,view:explicit},null,request)).retained),[common.key],'an explicitly reselected common file is never silently removed');
  const mixed=plain(inherited),mixedValue=common.key+'\n'+manual;
  for(const id of target.linked){mixed.overrides.common[id]=mixedValue;mixed.resolved.rows.find(row=>row.optionId==='synthetic-two').fields[id].value=mixedValue;}
  const mixedBefore=JSON.stringify(mixed);assert.deepEqual(plain((await attachment.productLabelReferenceSelection({...selectionInput,view:mixed},null,request)).retained),[manual]);assert.equal(JSON.stringify(mixed),mixedBefore);
  const foreignReceipt=async(url,init)=>{const response=await request(url,init);if(!url.startsWith('/api/files?'))return response;const body=await response.json();return Response.json({...body,productLabelProof:{...body.productLabelProof,profileId:'other-profile'}});};
  assert.deepEqual(plain((await attachment.productLabelReferenceSelection(selectionInput,null,foreignReceipt)).retained),[common.key]);

  const next=await attach('synthetic-one');assert.notEqual(next.key,old.key);assert.notEqual(next.uploadId,old.uploadId);assert.deepEqual(next.plan,old.plan);
  const partial=await json(await request(f.endpoint));assert.equal(partial.review.canPrepare,false);assert.deepEqual(partial.review.issues.filter(issue=>issue.code==='GENERATED_PRODUCT_LABEL_STALE').map(issue=>issue.optionId),['synthetic-two']);
  const inheritedNext=await attach('synthetic-two');assert.notEqual(inheritedNext.key,common.key);assert.deepEqual(inheritedNext.plan,common.plan);
  const finalQuote=await quote();assert.equal(finalQuote.overrides.common[target.primary],common.key,'option rewrite does not rewrite the stored common reference');
  for(const[optionId,key]of [['synthetic-one',next.key],['synthetic-two',inheritedNext.key]])for(const id of target.linked)assert.equal(finalQuote.resolved.rows.find(row=>row.optionId===optionId).fields[id].value,key);
  assert.equal(finalQuote.resolved.rows.find(row=>row.optionId==='synthetic-excluded').fields[target.primary].value,manual);assert.deepEqual(plain(finalQuote.overrides.options['synthetic-excluded']),plain(oldQuote.overrides.options['synthetic-excluded']));
  for(const row of finalQuote.resolved.rows){const previous=oldQuote.resolved.rows.find(oldRow=>oldRow.optionId===row.optionId);for(const[id,cell]of Object.entries(row.fields))if(!target.linked.includes(id))assert.deepEqual(cell,previous.fields[id]);}
  assert.deepEqual(protectedState(f),source);assert.deepEqual(plain((await read()).rows),contentBefore);
  for(const[key,digest]of originals)assert.equal(sha(h.objects.get(key)),digest,'preserved source/generated/manual file '+key);
  const ready=await json(await request(f.endpoint));assert.equal(ready.review.canPrepare,true,JSON.stringify(ready.review.issues));
  const dbReady=allTables(f),privateReady=f.objectState(),prepared=await json(await request(f.endpoint,{method:'POST',body:{action:'prepare',expectedFingerprint:ready.fingerprint}}));
  assert.equal(prepared.prepared,true);assert.equal(prepared.registered,false);assert.equal(prepared.remoteWrites,false);assert.equal(prepared.submissionReady,false);
  const packets=[];
  for(const[optionId,key]of [['synthetic-one',next.key],['synthetic-two',inheritedNext.key]]){
   const slot=prepared.manifest.find(slot=>slot.role==='label'&&slot.optionId===optionId);assert.deepEqual(slot.keys,[key]);assert.equal(slot.files.length,1);
   const file=slot.files[0];assert.equal(file.sha256,sha(png));assert.equal(file.published,true);
   const served=await f.serve(file.url);assert.equal(served.status,200);assert.equal(sha(new Uint8Array(await served.arrayBuffer())),sha(png));
   const packet=await h.load('app/supplier-hub-single-client.ts').singlePackagePacket(prepared,'owner',optionId);
   assert.equal(packet.optionId,optionId);assert.equal(packet.company.code,company.code);assert.equal(packet.body.docId,null);assert.equal(packet.body.jsonDocument.length,1);
   assert.equal(packet.body.jsonDocument[0].imagePage.images.labelImages.find(item=>item.labelImageType===slot.wire.name).labelImageFiles,file.url);
   packets.push({optionId,key,url:file.url,renderEpoch:1,pngSha256:file.sha256});
  }
  assert.ok(!prepared.manifest.some(slot=>slot.role==='label'&&[old.key,common.key,manual].some(key=>slot.keys.includes(key))));assert.equal(allTables(f),dbReady);assert.equal(f.objectState(),privateReady);
  assert.equal(SINGLE_DOCUMENT_LIVE_VERIFIED,false);assert.deepEqual(h.network,[]);assert.equal(h.aiSources.length,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_single_receipts').get().n,0);
  proofs.push({company,calls,requestCount:calls.length,mediaRequests:2,oldOptionKey:old.key,oldInheritedCommonKey:common.key,packets,
   preserved:{values:true,structure:true,manualBlank:true,excludedManualReference:true,commonReference:true,oldFiles:true,prices:true,source:true,otherProduct:true},
   guards:{legacyCrossScopePreserved:true,explicitOptionReselectionPreserved:true,manualInInheritedListPreserved:true,otherProfilePreserved:true},
   afterRewriteStaleOptions:2,afterFirstNewPngStaleOptions:1,afterBothNewPngStaleOptions:0,registered:false,remoteWrites:false,submissionReady:false,liveGate:SINGLE_DOCUMENT_LIVE_VERIFIED});
 }finally{f.close();}
});

test.after(()=>{assert.deepEqual(hashes(),frozen);fs.writeFileSync(process.env.STEP711_SINGLE_PROOF_PATH??'outputs/step711-rewrite-single-proof.json',JSON.stringify({format:'step711-rewrite-single-v1',sourceHashes:frozen,cases:proofs,
 externalRequests:0,browserActions:0,providerCalls:0,productionWrites:0,supplierHubWrites:0,
 boundary:'Actual local labels rewrite POST, renderer drawing calls, upload/receipt/attachment handlers, SQLite/R2, Single preparation/client packet and media bytes. Synthetic schema/canvas/PNG; no pixel fidelity or real Hub acceptance asserted.'},null,2)+'\n');});
