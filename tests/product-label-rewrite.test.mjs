import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {providedOptionModule as module} from './helpers/provided-option-quotation.mjs';

const model=module('app/product-label.ts'),upload=module('app/product-label-upload.ts'),proof=module('app/product-label-proof.ts');
const attachment=module('app/product-label-attachment.ts'),references=module('app/product-label-references.ts');
const plain=value=>JSON.parse(JSON.stringify(value)),sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const version='2026-10-18T00:00:00.000Z',nextVersion='2026-10-18T00:00:00.001Z';
const endpoint='/api/products/rewrite-test/product-labels?profileId=cat',quotationEndpoint='/api/products/rewrite-test/quotation-fields?profileId=cat';
function view(epoch){
 const common=Object.fromEntries(model.productLabelFields.map(field=>[field.key,field.key==='productName'?'저장 문구 유지':field.key==='material'?'실리콘':'']));
 const rows=[{optionId:null,optionLabel:'상품 공통값',included:false},{optionId:'red',optionLabel:'검토 옵션',included:true},{optionId:'excluded',optionLabel:'제외 옵션',included:false}]
  .map(row=>({...row,values:{...common},automatic:Object.fromEntries(model.productLabelFields.map(field=>[field.key,''])),sources:Object.fromEntries(model.productLabelFields.map(field=>[field.key,'manual-common']))}));
 return {productId:'rewrite-test',revision:1,inputFingerprint:'a'.repeat(64),productVersion:version,contentRevision:0,optionRevision:0,quotationRevision:0,quotationInputFingerprint:'b'.repeat(64),
  categoryContext:{source:'profile',profileId:'cat',categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓']},imageKeys:[],
  overrides:{common,options:{}},rows,updatedAt:version,...(epoch===undefined?{}:{renderEpoch:epoch})};
}
const context=v=>({productId:v.productId,endpoint,optionId:'red',view:v});
async function marked(v,{full=false}={}){
 const id=await upload.productLabelUploadId(context(v)),metadata=await proof.verifiedProductLabelMetadata(proof.productLabelProofRequest(context(v)),v,id);
 if(full)metadata.productLabelPlanSha256=sha(model.productLabelPlan(v,'red',{includeEmpty:true}));
 return {...metadata,labelUploadId:id,labelBlobSha256:'d'.repeat(64)};
}
async function inspect(v,metadata){
 const key='owner/quotation-label-'+metadata.labelUploadId+'.png',before=JSON.stringify({v,metadata});
 const resolved={schema:{fields:[{id:'labelImages',section:'image',label:'라벨',type:'images',visibility:'common'}]},rows:[
  {optionId:'red',optionLabel:'검토 옵션',included:true,fields:{labelImages:{value:key}}},
  {optionId:'excluded',optionLabel:'제외 옵션',included:false,fields:{labelImages:{value:key}}}]};
 const out=await proof.inspectGeneratedProductLabels({ownerId:'owner',productId:v.productId,profileId:'cat',resolved,head:async()=>({customMetadata:metadata}),readView:async()=>v});
 assert.equal(JSON.stringify({v,metadata}),before);return plain(out);
}
function pair(v,key='owner/label.png'){
 const saved=plain(v);saved.imageKeys=[key];
 const quotation={revision:saved.quotationRevision,inputFingerprint:saved.quotationInputFingerprint,productVersion:saved.productVersion,contentRevision:saved.contentRevision,optionRevision:saved.optionRevision,
  categoryContext:plain(saved.categoryContext),imageKeys:[key],updatedAt:saved.productVersion,overrides:{common:{},options:{red:{labelImages:key}}},automatic:{rows:[]},
  resolved:{schema:{fields:[{id:'labelImages',section:'image',label:'라벨',type:'images',visibility:'common',maxItems:30,maxLength:16000}]},rows:[{optionId:'red',optionLabel:'검토 옵션',included:true,fields:{labelImages:{value:key}}}]}};
 return {view:saved,quotation,keys:[key]};
}

test('absent epoch retains the exact legacy signature, identity and server metadata; rewrite changes identity without changing the plan',async()=>{
 const legacy=view(),before=JSON.stringify(legacy),expected=JSON.stringify({productId:legacy.productId,endpoint,category:legacy.categoryContext,optionId:'red',plan:model.productLabelPlan(legacy,'red')});
 assert.equal(upload.productLabelPreviewSignature(context(legacy)),expected);
 assert.equal(await upload.productLabelUploadId(context(legacy)),sha({recipe:'product-label-png-v1',signature:expected}));
 const old=await marked(legacy);assert.equal(Object.hasOwn(old,'productLabelRenderEpoch'),false);assert.equal(Object.hasOwn(proof.productLabelReceiptFromMetadata(old),'renderEpoch'),false);
 const first=view(1),second=view(2);assert.deepEqual(plain(model.productLabelPlan(first,'red')),plain(model.productLabelPlan(legacy,'red')));
 assert.notEqual(await upload.productLabelUploadId(context(first)),old.labelUploadId);assert.notEqual(await upload.productLabelUploadId(context(first)),await upload.productLabelUploadId(context(second)));
 assert.equal(JSON.parse(upload.productLabelPreviewSignature(context(first))).renderEpoch,1);assert.equal(JSON.stringify(legacy),before);
});

test('epochs must be positive safe integers when present, with no explicit zero, null, numeric text or overflow',()=>{
 assert.equal(model.validateProductLabelRenderEpoch(undefined),undefined);
 for(const epoch of [1,2,Number.MAX_SAFE_INTEGER]){assert.equal(model.validateProductLabelRenderEpoch(epoch),epoch);model.verifyProductLabelsView(view(epoch),'red');}
 for(const epoch of [0,-1,1.5,null,'1',true,Infinity,NaN,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>model.validateProductLabelRenderEpoch(epoch));assert.throws(()=>model.verifyProductLabelsView({...view(),renderEpoch:epoch},'red'));assert.throws(()=>upload.productLabelPreviewSignature(context({...view(),renderEpoch:epoch})));
 }
 assert.throws(()=>model.verifyProductLabelsView({...view(),renderEpoch:undefined},'red'));
});

test('ordinary saves and retained drafts cannot acknowledge another generation; explicit clean latest-read may accept it',()=>{
 const before=view(1),structure=model.productLabelStructure(before),saved={...plain(before),revision:2,productVersion:nextVersion,updatedAt:nextVersion,inputFingerprint:'c'.repeat(64),structure};
 model.verifyProductLabelSave(before,saved,'red',{},structure);
 const rewritten={...saved,renderEpoch:2};assert.throws(()=>model.verifyProductLabelSave(before,rewritten,'red',{},structure));
 assert.throws(()=>model.verifyProductLabelRefresh(before,rewritten,'red',{}));assert.throws(()=>model.verifyProductLabelRefresh(before,rewritten,'red',{material:'로컬 입력'}));
 model.verifyProductLabelRefresh(before,rewritten,'red',{},undefined,true);
 assert.throws(()=>model.verifyProductLabelRefresh(before,rewritten,'red',{material:'로컬 입력'},undefined,true));
});

test('server receipts round-trip a canonical optional epoch while malformed metadata and receipt numbers are rejected',async()=>{
 for(const epoch of [undefined,1,Number.MAX_SAFE_INTEGER]){
  const v=view(epoch),metadata=await marked(v),receipt=proof.productLabelReceiptFromMetadata(metadata),key='owner/quotation-label-'+metadata.labelUploadId+'.png';
  assert.equal(receipt.renderEpoch,epoch);if(epoch!==undefined)assert.equal(metadata.productLabelRenderEpoch,String(epoch));
  const response=await proof.readProductLabelReceipt(metadata.labelUploadId,async()=>Response.json({key,contentType:'image/png',size:12,sha256:'e'.repeat(64),productLabelProof:receipt}));assert.equal(response.proof.renderEpoch,epoch);
 }
 const metadata=await marked(view(1)),receipt=proof.productLabelReceiptFromMetadata(metadata),key='owner/quotation-label-'+metadata.labelUploadId+'.png';
 for(const invalid of ['',null,0,'0','01','1.0','1e0',' 1','+1','9007199254740992',undefined])assert.throws(()=>proof.productLabelReceiptFromMetadata({...metadata,productLabelRenderEpoch:invalid}));
 for(const invalid of [0,-1,null,'1',1.1,Number.MAX_SAFE_INTEGER+1])await assert.rejects(proof.readProductLabelReceipt(metadata.labelUploadId,async()=>Response.json({key,contentType:'image/png',size:12,sha256:'e'.repeat(64),productLabelProof:{...receipt,renderEpoch:invalid}})));
});

test('rewrite stales only authenticated prior generations, including exact full-row legacy plans, without mutating files or values',async()=>{
 const legacy=view(),first=view(1),second=view(2);
 for(const full of [false,true]){
  const old=await marked(legacy,{full}),current=await marked(first,{full});
  assert.deepEqual(await inspect(legacy,old),[]);assert.deepEqual(await inspect(first,current),[]);
  assert.equal((await inspect(first,old))[0].code,'GENERATED_PRODUCT_LABEL_STALE');assert.equal((await inspect(second,current))[0].code,'GENERATED_PRODUCT_LABEL_STALE');
 }
 const manual={labelUploadId:'f'.repeat(64),productLabelRenderEpoch:'invalid'};assert.deepEqual(await inspect(second,manual),[],'unmarked manual files are never interpreted as a generated recipe');
 const bad=await marked(first);assert.equal((await inspect(first,{...bad,productLabelRenderEpoch:'01'}))[0].code,'GENERATED_PRODUCT_LABEL_UNCONFIRMED');
});

test('an exact current-epoch durable PNG is recovered without writes; a matching plan with missing or forged epoch cannot attach',async()=>{
 const v=view(2),metadata=await marked(v),id=metadata.labelUploadId,key='owner/quotation-label-'+id+'.png',state=pair(v,key),valid=proof.productLabelReceiptFromMetadata(metadata);
 for(const epoch of [undefined,1,3,2]){
  const receipt={...plain(valid)};if(epoch===undefined)delete receipt.renderEpoch;else receipt.renderEpoch=epoch;
  const calls=[],request=async(url,init={})=>{calls.push({url,method:init.method??'GET'});assert.equal(init.method??'GET','GET');
   if(url===endpoint)return Response.json(state.view);if(url===quotationEndpoint)return Response.json(state.quotation);
   assert.equal(url,'/api/files?labelUploadId='+id);return Response.json({key,contentType:'image/png',size:12,sha256:'e'.repeat(64),productLabelProof:receipt});};
  const input={productId:v.productId,endpoint,quotationEndpoint,renderedView:state.view,optionId:'red',blob:null,uploadedKey:key,onUploaded(){}};
  if(epoch===2){const result=await attachment.attachProductLabel(input,request);assert.equal(result.key,key);}else await assert.rejects(attachment.attachProductLabel(input,request),/원천|확인/);
  assert.ok(calls.every(call=>call.method==='GET'));
 }
 const newer=pair(view(3),key),calls=[];await assert.rejects(attachment.attachProductLabel({productId:v.productId,endpoint,quotationEndpoint,renderedView:state.view,optionId:'red',blob:null,uploadedKey:key,onUploaded(){}},async url=>{calls.push(url);return Response.json(url===endpoint?newer.view:newer.quotation);}),/변경|다시/);
 assert.ok(calls.every(url=>!url.startsWith('/api/files')),'stale rendered generation stops before receipt or upload');
});

test('reference read/save/refresh cannot silently accept an epoch change even with otherwise identical revision, plan or overrides',async()=>{
 const input={productId:'rewrite-test',optionId:'red',endpoint,quotationEndpoint},before=pair(view(1)),rewritten=pair(view(2));
 references.productLabelReferences(input,before.view,before.quotation);
 assert.throws(()=>references.verifyProductLabelReferenceRefresh(input,before,rewritten));
 let reads=0;await assert.rejects(references.readProductLabelReferences(input,async url=>Response.json(url===quotationEndpoint?before.quotation:(++reads===1?before.view:rewritten.view))),/변경/);
 const calls=[];await assert.rejects(references.saveProductLabelReferences(input,before,[],async(url,init={})=>{calls.push(init.method??'GET');return Response.json(url===endpoint?rewritten.view:rewritten.quotation);}),/바뀌|변경/);assert.ok(calls.every(method=>method==='GET'));
 const saved=pair(view(1));saved.view.productVersion=nextVersion;saved.view.quotationRevision=1;saved.view.quotationInputFingerprint='c'.repeat(64);
 Object.assign(saved.quotation,{revision:1,inputFingerprint:'c'.repeat(64),productVersion:nextVersion,updatedAt:nextVersion});saved.quotation.overrides.options.red.labelImages='';saved.quotation.resolved.rows[0].fields.labelImages.value='';saved.keys=[];
 references.verifyProductLabelReferenceSave(input,before,saved,[]);
 assert.throws(()=>references.verifyProductLabelReferenceSave(input,before,{...saved,view:{...saved.view,renderEpoch:2}},[]));
});
