import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {providedOptionModule as module} from './helpers/provided-option-quotation.mjs';

const model=module('app/product-label.ts'),proof=module('app/product-label-proof.ts'),upload=module('app/product-label-upload.ts');
const plain=value=>JSON.parse(JSON.stringify(value)),sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const version='2026-10-18T00:00:00.000Z',defaults=model.productLabelStructure();
const structure=[{id:'custom_false',label:'거짓 문자열',required:false},defaults[0],{id:'custom_white',label:'공백',required:false},
 {id:'material',label:'원문 재질',required:false},{id:'custom_zero',label:'숫자 문자열',required:false},{id:'netContents',label:'빈 내용량',required:false}];
const mixed={productName:'검토 제품',custom_false:'false',custom_white:' \t\n ',material:'<b>원문</b> \r\n그대로',custom_zero:'0',netContents:''};
function view(values={},fields){
 const definitions=model.productLabelDefinitions(fields===undefined?undefined:{structure:fields}),common=Object.fromEntries(definitions.map(field=>[field.key,values[field.key]??'']));
 const rows=[{optionId:null,optionLabel:'상품 공통값',included:false},{optionId:'red',optionLabel:'검토 옵션',included:true},{optionId:'excluded',optionLabel:'제외 옵션',included:false}].map(row=>({...row,
  values:{...common},automatic:Object.fromEntries(definitions.map(field=>[field.key,''])),sources:Object.fromEntries(definitions.map(field=>[field.key,'manual-common']))}));
 return {productId:'empty-label-test',revision:1,inputFingerprint:'a'.repeat(64),productVersion:version,contentRevision:0,optionRevision:0,quotationRevision:0,quotationInputFingerprint:'b'.repeat(64),
  categoryContext:{source:'profile',profileId:'cat',categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓']},imageKeys:[],
  overrides:{common,options:{}},rows,updatedAt:version,...(fields===undefined?{}:{structure:fields})};
}
async function metadata(v,legacy=false){
 return {productLabelRecipe:'product-label-png-v1',productLabelProductId:v.productId,productLabelOptionId:'red',productLabelProfileId:'cat',
  productLabelPlanSha256:sha(model.productLabelPlan(v,'red',legacy?{includeEmpty:true}:undefined)),
  productLabelCategorySha256:sha([v.categoryContext.categoryId,v.categoryContext.categoryPath]),productLabelProductVersion:v.productVersion,
  productLabelSourceFingerprint:v.inputFingerprint,productLabelRevision:String(v.revision),labelUploadId:'c'.repeat(64),labelBlobSha256:'d'.repeat(64)};
}
async function inspect(v,marked){
 const key='owner/quotation-label-'+marked.labelUploadId+'.png',reads=[];
 const resolved={schema:{fields:[{id:'labelImages',section:'image',label:'라벨',type:'images',visibility:'common'}]},rows:[
  {optionId:'red',optionLabel:'검토 옵션',included:true,fields:{labelImages:{value:key}}},
  {optionId:'excluded',optionLabel:'제외 옵션',included:false,fields:{labelImages:{value:key}}},
 ]};
 const before=JSON.stringify({v,marked,resolved}),issues=await proof.inspectGeneratedProductLabels({ownerId:'owner',productId:v.productId,profileId:'cat',resolved,
  head:async file=>{reads.push(file);return {customMetadata:marked};},readView:async profileId=>{assert.equal(profileId,'cat');return v;}});
 assert.equal(JSON.stringify({v,marked,resolved}),before);assert.equal(reads.length,1);return issues;
}

test('new PNG plans omit only exact empty values in saved order and retain whitespace, zero, false and literal text',()=>{
 const v=view(mixed,structure),before=JSON.stringify(v),plan=model.productLabelPlan(v,'red');
 assert.deepEqual(plain(plan.rows),[['거짓 문자열','false'],['제품명','검토 제품'],['공백',' \t\n '],['원문 재질','<b>원문</b> \r\n그대로'],['숫자 문자열','0']]);
 assert.equal(v.rows.find(row=>row.optionId==='red').values.netContents,'');assert.equal(v.rows.find(row=>row.optionId==='red').sources.netContents,'manual-common');
 assert.equal(v.structure.length,6);assert.equal(JSON.stringify(v),before);
});

test('whitespace-only labels remain printable without trimming; all exact-empty drafts remain editable but cannot invent a PNG',()=>{
 const v=view({productName:' \t\r\n '}),before=JSON.stringify(v);assert.deepEqual(plain(model.productLabelPlan(v,'red').rows),[['제품명',' \t\r\n ']]);assert.equal(JSON.stringify(v),before);
 const empty=view(),original=JSON.stringify(empty);model.verifyProductLabelsView(empty,'red');assert.throws(()=>model.productLabelPlan(empty,'red'),/한 항목/);assert.throws(()=>model.productLabelPlan(empty,'red',{includeEmpty:true}),/한 항목/);assert.equal(JSON.stringify(empty),original);
});

test('the compatibility helper reproduces the exact prior nine-row shape while the default keeps only nonempty rows',()=>{
 const v=view({productName:'유지할 제품명',material:'검토 재질'}),old=model.productLabelPlan(v,'red',{includeEmpty:true}),current=model.productLabelPlan(v,'red');
 assert.deepEqual(plain(old),plain({format:'product-label',title:'',subtitle:'',width:800,columnWidths:[240,480],headers:[],rows:model.productLabelFields.map(field=>[field.label,v.rows[1].values[field.key]]),footer:''}));
 assert.equal(old.rows.length,9);assert.deepEqual(plain(current.rows),[['제품명','유지할 제품명'],['원료명 및 성분명(재질)','검토 재질']]);assert.notEqual(sha(old),sha(current));
});

test('a complete prior v1 nine-row plan remains fresh only against its exact current ordered values and category',async()=>{
 const v=view({productName:'기존 PNG 제품명',material:'기존 PNG 재질'}),old=await metadata(v,true),before=JSON.stringify(v);
 assert.deepEqual(plain(await inspect(v,old)),[]);assert.equal(JSON.stringify(v),before);
});

test('new server metadata and upload identities describe the filtered plan without accepting a caller-supplied plan',async()=>{
 const v=view(mixed,structure),context={productId:v.productId,endpoint:'/api/products/'+v.productId+'/product-labels?profileId=cat',view:v,optionId:'red'},request=proof.productLabelProofRequest(context),uploadId=await upload.productLabelUploadId(context),marked=await proof.verifiedProductLabelMetadata(request,v,uploadId);
 assert.equal(marked.productLabelPlanSha256,sha(model.productLabelPlan(v,'red')));assert.notEqual(marked.productLabelPlanSha256,sha(model.productLabelPlan(v,'red',{includeEmpty:true})));
 const signature=JSON.parse(upload.productLabelPreviewSignature(context));assert.deepEqual(plain(signature.plan),plain(model.productLabelPlan(v,'red')));
 assert.deepEqual(plain(await inspect(v,{...marked,labelUploadId:uploadId,labelBlobSha256:'d'.repeat(64)})),[]);
});

test('current custom headings and ordering are compatible with their exact full-row v1 proof and new filtered proof',async()=>{
 const v=view(mixed,structure);assert.deepEqual(plain(await inspect(v,await metadata(v,true))),[]);assert.deepEqual(plain(await inspect(v,await metadata(v))),[]);
 assert.equal(model.productLabelPlan(v,'red',{includeEmpty:true}).rows.length,6);assert.equal(model.productLabelPlan(v,'red').rows.length,5);
});

test('changed visible values, headings and ordering invalidate both legacy and current authenticated plan proofs',async()=>{
 const initial=view(mixed,structure),old=await metadata(initial,true),current=await metadata(initial);
 for(const changed of [view({...mixed,material:'새 재질'},structure),view(mixed,structure.map(field=>field.id==='material'?{...field,label:'새 항목명'}:field)),view(mixed,[structure[1],structure[0],...structure.slice(2)])]){
  for(const marked of [old,current]){const issues=await inspect(changed,marked);assert.equal(issues.length,1);assert.equal(issues[0].code,'GENERATED_PRODUCT_LABEL_STALE');}
 }
 const emptyHeadingChange=view(mixed,structure.map(field=>field.id==='netContents'?{...field,label:'기존 빈 행의 다른 제목'}:field));
 assert.equal((await inspect(emptyHeadingChange,old))[0].code,'GENERATED_PRODUCT_LABEL_STALE','the old PNG actually printed that empty row heading');
 assert.deepEqual(plain(await inspect(emptyHeadingChange,current)),[],'the filtered PNG never printed the empty heading, so its visible plan is unchanged');
});

test('compatibility never bypasses category, product, profile or complete stored-owner proof checks',async()=>{
 const v=view(mixed,structure),old=await metadata(v,true);
 for(const corrupted of [{productLabelCategorySha256:'0'.repeat(64)},{productLabelProductId:'other-product'},{productLabelProfileId:'other-profile'},{productLabelOptionId:'../red'},{labelUploadId:'bad'},{labelBlobSha256:'bad'},{productLabelSourceFingerprint:'bad'}]){
  const issues=await inspect(v,{...old,...corrupted});assert.equal(issues.length,1);assert.ok(['GENERATED_PRODUCT_LABEL_STALE','GENERATED_PRODUCT_LABEL_UNCONFIRMED'].includes(issues[0].code));
 }
 const issues=await inspect(v,{...old,productLabelPlanSha256:'e'.repeat(64)});assert.equal(issues[0].code,'GENERATED_PRODUCT_LABEL_STALE');
});

test('an excluded option or all-empty current plan cannot gain freshness from an old plan hash',async()=>{
 const initial=view(mixed,structure),old=await metadata(initial,true),empty=view({},structure);
 assert.equal((await inspect(empty,old))[0].code,'GENERATED_PRODUCT_LABEL_UNCONFIRMED');
 assert.throws(()=>model.productLabelPlan(initial,'excluded'),/포함/);
});
