import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {providedOptionModule as module} from './helpers/provided-option-quotation.mjs';

const model=module('app/product-label.ts'),upload=module('app/product-label-upload.ts'),proof=module('app/product-label-proof.ts'),result=module('app/product-label-result.ts');
const plain=value=>JSON.parse(JSON.stringify(value)),sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const version='2026-10-18T00:00:00.000Z',endpoint='/api/products/current-label/product-labels?profileId=cat',quotationEndpoint='/api/products/current-label/quotation-fields?profileId=cat';
const input={productId:'current-label',optionId:'red',endpoint,quotationEndpoint};
function view(epoch){
 const common=Object.fromEntries(model.productLabelFields.map(field=>[field.key,field.key==='productName'?'현재 저장 제품':field.key==='material'?'실리콘':'']));
 const rows=[{optionId:null,optionLabel:'상품 공통',included:false},{optionId:'red',optionLabel:'빨강',included:true},{optionId:'blue',optionLabel:'파랑',included:true}].map(row=>({...row,values:{...common},
  automatic:Object.fromEntries(model.productLabelFields.map(field=>[field.key,''])),sources:Object.fromEntries(model.productLabelFields.map(field=>[field.key,'manual-common']))}));
 return {productId:'current-label',revision:1,inputFingerprint:'a'.repeat(64),productVersion:version,contentRevision:0,optionRevision:0,quotationRevision:1,quotationInputFingerprint:'b'.repeat(64),
  categoryContext:{source:'profile',profileId:'cat',categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓']},imageKeys:[],
  overrides:{common,options:{}},rows,updatedAt:version,...(epoch===undefined?{}:{renderEpoch:epoch})};
}
async function fixture(options={}){
 const {proofOption='red',common=false,full=false}=options,epoch=Object.hasOwn(options,'epoch')?options.epoch:1;
 const v=view(epoch),context={productId:v.productId,endpoint,optionId:proofOption,view:v},uploadId=await upload.productLabelUploadId(context),key='owner/quotation-label-'+uploadId+'.png';
 const metadata={...await proof.verifiedProductLabelMetadata(proof.productLabelProofRequest(context),v,uploadId),labelUploadId:uploadId,labelBlobSha256:'c'.repeat(64)};
 if(full)metadata.productLabelPlanSha256=sha(model.productLabelPlan(v,proofOption,{includeEmpty:true}));
 v.imageKeys=[key];
 const q={revision:1,inputFingerprint:v.quotationInputFingerprint,productVersion:v.productVersion,contentRevision:0,optionRevision:0,categoryContext:plain(v.categoryContext),imageKeys:[key],
  overrides:common?{common:{labelImages:key},options:{}}:{common:{},options:{red:{labelImages:key}}},
  resolved:{schema:{fields:[{id:'labelImages',section:'image',label:'표시사항',type:'images',visibility:'common'}]},rows:v.rows.map(row=>({optionId:row.optionId,optionLabel:row.optionLabel,included:row.included,fields:{labelImages:{value:key}}}))}};
 const state={view:v,quotation:q,body:{key,contentType:'image/png',size:12,sha256:'d'.repeat(64),productLabelProof:plain(proof.productLabelReceiptFromMetadata(metadata))},fileStatus:200,afterFile:null},calls=[];
 const request=async(url,init={})=>{
  calls.push({url,method:init.method??'GET'});assert.equal(init.method??'GET','GET','completion never writes');
  if(url===endpoint)return Response.json(state.view);if(url===quotationEndpoint)return Response.json(state.quotation);
  assert.equal(url,'/api/files?labelUploadId='+uploadId);const response=Response.json(state.body,{status:state.fileStatus});state.afterFile?.();return response;
 };
 return {state,key,uploadId,calls,request,read:()=>result.readCurrentProductLabelResult(input,request)};
}

test('one exact current generated PNG completes only after a second unchanged source/reference snapshot',async()=>{
 const f=await fixture(),before=JSON.stringify(f.state),out=await f.read();assert.equal(out.reason,null);assert.equal(out.result.key,f.key);assert.equal(out.result.plan,'filtered');assert.equal(out.result.proof.renderEpoch,1);
 assert.equal(f.calls.length,7);assert.equal(JSON.stringify(f.state),before);assert.deepEqual(plain(out.references.view),plain(f.state.view));
});

test('common completion requires exact common scope or genuine option inheritance, not an explicitly reselected other-scope file',async()=>{
 const f=await fixture({proofOption:null,common:true});assert.equal((await f.read()).result.key,f.key);
 const common=await result.readCurrentProductLabelResult({...input,optionId:null},f.request);assert.equal(common.result.key,f.key);
 f.state.quotation.overrides.options.red={labelImages:f.key};assert.equal((await f.read()).reason,'stale');
 const other=await fixture({proofOption:'blue'});assert.equal((await other.read()).reason,'stale');
});

test('exact same-epoch full-row legacy proof remains complete while rewritten or changed content is stale',async()=>{
 const full=await fixture({full:true});assert.equal((await full.read()).result.plan,'legacy-full');
 const old=await fixture({epoch:undefined,full:true});assert.equal((await old.read()).result.plan,'legacy-full');
 old.state.view.renderEpoch=1;assert.equal((await old.read()).reason,'stale');
 full.state.view.rows.forEach(row=>{row.values.material='변경한 재질';});full.state.view.overrides.common.material='변경한 재질';assert.equal((await full.read()).reason,'stale');
});

test('missing, manual, unproven and multiple final references remain editable without treating filenames as evidence',async()=>{
 for(const mode of ['missing','manual','unmarked','unconfirmed','multiple']){
  const f=await fixture();
  if(mode==='missing')f.state.quotation.resolved.rows.find(row=>row.optionId==='red').fields.labelImages.value='';
  if(mode==='manual'){f.state.view.imageKeys=['owner/manual.png'];f.state.quotation.imageKeys=['owner/manual.png'];f.state.quotation.resolved.rows.find(row=>row.optionId==='red').fields.labelImages.value='owner/manual.png';}
  if(mode==='unmarked')delete f.state.body.productLabelProof;
  if(mode==='unconfirmed')f.state.body={key:null};
  if(mode==='multiple'){f.state.view.imageKeys.push('owner/manual.png');f.state.quotation.imageKeys.push('owner/manual.png');f.state.quotation.resolved.rows.find(row=>row.optionId==='red').fields.labelImages.value=f.key+'\nowner/manual.png';}
  const out=await f.read();assert.equal(out.result,null);assert.equal(out.reason,{missing:'missing',manual:'manual',unmarked:'manual',unconfirmed:'unconfirmed',multiple:'ambiguous'}[mode]);
  assert.equal(f.calls.length,['unmarked','unconfirmed'].includes(mode)?4:3);
 }
 const unowned=await fixture();unowned.state.view.imageKeys=[];unowned.state.quotation.imageKeys=[];assert.equal((await unowned.read()).reason,'unconfirmed');assert.equal(unowned.calls.length,3);
});

test('wrong product, profile, category, option and epoch proofs never complete even when the displayed image key exists',async()=>{
 for(const changes of [{productId:'other-product'},{profileId:'other-profile'},{categorySha256:'0'.repeat(64)},{optionId:'blue'},{renderEpoch:2},{planSha256:'0'.repeat(64)}]){
  const f=await fixture();Object.assign(f.state.body.productLabelProof,changes);const out=await f.read();assert.equal(out.reason,'stale');assert.equal(out.result,null);assert.equal(f.calls.length,4);
 }
 const owner=await fixture();owner.state.body.key=owner.key.replace('owner/','other-owner/');await assert.rejects(owner.read(),/계정|파일/);
});

test('infrastructure and malformed authenticated receipts throw rather than being normalized into missing completion',async()=>{
 for(const mode of ['503','malformed-epoch','malformed-key']){
  const f=await fixture();if(mode==='503'){f.state.fileStatus=503;f.state.body={error:'storage unavailable'};}
  if(mode==='malformed-epoch')f.state.body.productLabelProof.renderEpoch=0;if(mode==='malformed-key')f.state.body.key='owner/forged.png';
  await assert.rejects(f.read());assert.equal(f.calls.length,4);
 }
});

test('rewrite, label edit or reference changes during receipt lookup cannot paint a previously valid completed result',async()=>{
 for(const mode of ['epoch','value','reference','source']){
  const f=await fixture();f.state.afterFile=()=>{
   if(mode==='epoch')f.state.view.renderEpoch=2;
   if(mode==='value'){f.state.view.rows.forEach(row=>{row.values.material='동시 수정';});f.state.view.overrides.common.material='동시 수정';}
   if(mode==='reference')f.state.quotation.resolved.rows.find(row=>row.optionId==='red').fields.labelImages.value='';
   if(mode==='source'){f.state.view.productVersion='2026-10-18T00:00:00.001Z';f.state.quotation.productVersion=f.state.view.productVersion;}
  };
  await assert.rejects(f.read(),/변경/);assert.equal(f.calls.length,7);
 }
});
