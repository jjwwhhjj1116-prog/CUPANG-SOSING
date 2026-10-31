import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';

const api=providedOptionModule('app/free-image-edit-review.ts'),records=providedOptionModule('app/free-image-edit-record.ts');
const hash=value=>createHash('sha256').update(value).digest('hex'),plain=value=>JSON.parse(JSON.stringify(value));
async function fixture({issue='자동 번역 미완료: 원문 확인',role='detail',workspace=false,index=0}={}){
 const productId='product',owner='owner',sourceKey=`owner/source-${index}.png`,source={productId,productVersion:'2026-10-31T01:00:00.000Z',contentRevision:2,
  sourceKey,sourceSha256:'a'.repeat(64),role,width:100,height:60,
  ...(workspace?{workspaceTarget:{kind:'detail-workspace',profileId:null,optionId:'option',photoId:'photo',revision:1,digest:'d'.repeat(64),bindingSha256:'e'.repeat(64)}}
   :{quotationTarget:{kind:'quotation',profileId:null,optionId:'option',input:role==='main'?'mainImage':role==='additional'?'additionalImages':'detailImages',fieldKey:'image',slotIndex:0,
    revision:3,inputFingerprint:'b'.repeat(64),optionRevision:1,bindingSha256:'c'.repeat(64),value:sourceKey}})};
 const document={format:'free-image-edit-v1',width:100,height:60,sourceLanguage:'zh',regions:[{id:'known',text:'已翻译',box:{x:0,y:0,width:40,height:15},confidence:90,
  selected:true,translated:'번역된 문구',issue:null,translationProvenance:'generated',background:'#ffffff',foreground:'#111111',fontSize:10},
  {id:'unresolved',text:'原文保留',box:{x:0,y:20,width:40,height:15},confidence:20,selected:false,translated:'',issue,translationProvenance:'empty',background:'#ffffff',foreground:'#111111',fontSize:10}]};
 const outputSha=hash('immutable-output-'+index),{key}=await records.freeImageEditOutputKey(source,document,outputSha);
 const prepared=await records.prepareFreeImageEditRecord(source,document,{source:'collection',profileId:'old-captured-profile',categoryId:'68183',categoryPath:['이전 카테고리']},
  {code:'A01526306',name:'유앤채'},{key,sha256:outputSha,bytes:123,width:100,height:60});
 const metadata={size:123,httpMetadata:{contentType:'image/png'},customMetadata:{freeImageEditDocumentSha256:prepared.documentSha256,freeImageEditRecordSha256:prepared.recordSha256,
  freeImageOutputSha256:outputSha,freeImageSourceSha256:hash(new TextEncoder().encode(providedOptionModule('app/free-image-translation.ts').freeImageSourceIdentity(source))),imageWidth:'100',imageHeight:'60'}};
 const f={owner,productId,key,source,document,prepared,metadata,bytes:new Uint8Array(prepared.bytes),calls:[],sidecarMissing:false,headMissing:false,sidecarSize:null};
 f.bucket={head:async selected=>{f.calls.push(['head',selected]);assert.equal(selected,key);return f.headMissing?null:metadata;},get:async selected=>{
  f.calls.push(['get',selected]);assert.equal(selected,key+'.edit.json','diagnostics must never download PNG pixels or source images');
  return f.sidecarMissing?null:{size:f.sidecarSize??f.bytes.length,httpMetadata:{contentType:'application/json'},body:new Response(f.bytes).body};}};
 f.review=(supplied)=>api.readFreeImageEditReview(f.bucket,owner,productId,key,supplied);
 f.changeRecord=edit=>{const value=JSON.parse(new TextDecoder().decode(f.bytes));edit(value);f.bytes=new TextEncoder().encode(JSON.stringify(value));metadata.customMetadata.freeImageEditRecordSha256=hash(f.bytes);};
 return f;
}

test('exact immutable sidecar reports every retained issue, including deselected rows and manual retry errors, without PNG reads',async()=>{
 for(const issue of ['자동 번역 미완료: 중국어 원문','번역 제공자 503 — 직접 다시 확인','  수동 재시도 오류  ']){
  const f=await fixture({issue}),before=JSON.stringify([f.document,f.metadata]),out=await f.review();
  assert.deepEqual(plain(out),{format:'free-image-edit-review-v1',productId:f.productId,key:f.key,status:'unresolved',unresolvedRegions:1});
  assert.deepEqual(f.calls,[['head',f.key],['get',f.key+'.edit.json']]);assert.equal(JSON.stringify([f.document,f.metadata]),before);
 }
});

test('cleared or whitespace-only issues retain explicit repaired/cleanup states and existing creation category or role',async()=>{
 for(const role of ['main','additional','detail'])for(const issue of [null,'',' \t\n ']){
  const f=await fixture({role,issue}),out=await f.review();assert.equal(out.status,'clear');assert.equal(out.unresolvedRegions,0);
 }
 const workspace=await fixture({workspace:true,issue:null});assert.match(workspace.key,/free-image-workspace-/);assert.equal((await workspace.review()).status,'clear');
 // No current destination role/category is inferred from the old source: the
 // same selected PNG may be deliberately reused in another destination.
 assert.equal((await workspace.review()).key,workspace.key);
});

test('preloaded exact HEAD metadata is reused; missing metadata never triggers an extra HEAD',async()=>{
 const f=await fixture();assert.equal((await f.review(f.metadata)).status,'unresolved');assert.deepEqual(f.calls,[['get',f.key+'.edit.json']]);
 f.calls.length=0;assert.equal((await f.review(null)).status,'unconfirmed');assert.deepEqual(f.calls,[]);
 const out=await api.readFreeImageEditReviews(f.bucket,f.owner,f.productId,[f.key],new Map());assert.equal(out[0].status,'unconfirmed');assert.deepEqual(f.calls,[]);
});

test('missing or corrupt record/hash/source/owner/product bindings are unconfirmed only for that exact selected output',async()=>{
 for(const mode of ['missing-head','missing-sidecar','record-hash','document-hash','source-hash','output-hash','size','dimensions','malformed-json','wrong-product','wrong-owner','wrong-result',
  'wrong-context','wrong-company','invalid-document','missing-markers','non-image']){
  const f=await fixture();
  if(mode==='missing-head')f.headMissing=true;if(mode==='missing-sidecar')f.sidecarMissing=true;
  if(mode==='record-hash')f.bytes[0]^=1;
  if(mode==='document-hash')f.metadata.customMetadata.freeImageEditDocumentSha256='0'.repeat(64);
  if(mode==='source-hash')f.metadata.customMetadata.freeImageSourceSha256='0'.repeat(64);
  if(mode==='output-hash')f.metadata.customMetadata.freeImageOutputSha256='0'.repeat(64);
  if(mode==='size')f.metadata.size=124;if(mode==='dimensions')f.metadata.customMetadata.imageWidth='101';
  if(mode==='malformed-json'){f.bytes=new TextEncoder().encode('{bad');f.metadata.customMetadata.freeImageEditRecordSha256=hash(f.bytes);}
  if(mode==='wrong-product')f.changeRecord(r=>r.source.productId='other');
  if(mode==='wrong-owner')f.changeRecord(r=>r.source.sourceKey='other/source.png');
  if(mode==='wrong-result')f.changeRecord(r=>r.result.key='owner/free-image-other.png');
  if(mode==='wrong-context')f.changeRecord(r=>r.context.extra='unrecorded');
  if(mode==='wrong-company')f.changeRecord(r=>r.company.name='다른 회사');
  if(mode==='invalid-document')f.changeRecord(r=>r.document.regions[0].box.width=1000);
  if(mode==='missing-markers')delete f.metadata.customMetadata.freeImageEditDocumentSha256;
  if(mode==='non-image')f.metadata.httpMetadata.contentType='application/json';
  const out=await f.review();assert.equal(out.status,'unconfirmed',mode);assert.equal(out.unresolvedRegions,null,mode);assert.equal(out.key,f.key,mode);
 }
 const f=await fixture();assert.equal((await api.readFreeImageEditReview(f.bucket,'other',f.productId,f.key)).status,'unconfirmed');
 assert.equal((await api.readFreeImageEditReview(f.bucket,f.owner,'different-product',f.key)).status,'unconfirmed');
 assert.deepEqual(f.calls,[],'foreign references are rejected before any I/O');
});

test('sidecar declared and actual byte limits fail closed without pixel fetches',async()=>{
 for(const mode of ['declared','actual','length-mismatch']){
  const f=await fixture();if(mode==='declared')f.sidecarSize=records.MAX_FREE_IMAGE_EDIT_RECORD_BYTES+1;
  if(mode==='actual'){f.bytes=new Uint8Array(records.MAX_FREE_IMAGE_EDIT_RECORD_BYTES+1);f.sidecarSize=records.MAX_FREE_IMAGE_EDIT_RECORD_BYTES;}
  if(mode==='length-mismatch')f.sidecarSize=f.bytes.length+1;
  assert.equal((await f.review()).status,'unconfirmed',mode);assert.deepEqual(f.calls,[['head',f.key],['get',f.key+'.edit.json']]);
 }
});

test('selected output batches deduplicate, ignore ordinary or foreign keys, bound reads, and isolate failures',async()=>{
 const first=await fixture(),second=await fixture({issue:null,index:1}),third=await fixture({index:2});third.sidecarMissing=true;
 const all=[first,second,third],bucket={head:key=>all.find(f=>f.key===key).bucket.head(key),get:key=>all.find(f=>key===f.key+'.edit.json').bucket.get(key)};
 const out=await api.readFreeImageEditReviews(bucket,'owner','product',[first.key,first.key,'owner/source.png','other/free-image-product.png',second.key,third.key]);
 assert.deepEqual(plain(out.map(r=>r.status)),['unresolved','clear','unconfirmed']);assert.equal(first.calls.length,2);
 const tooMany=Array.from({length:151},(_,i)=>'owner/free-image-product-'+i+'.png');
 const forbidden={head:()=>assert.fail('oversized scope must not make arbitrary reads'),get:()=>assert.fail('oversized scope must not make arbitrary reads')};
 const blocked=await api.readFreeImageEditReviews(forbidden,'owner','product',tooMany);assert.equal(blocked.length,151);assert.ok(blocked.every(r=>r.status==='unconfirmed'));
 const missingBucket=await api.readFreeImageEditReviews({},'owner','product',[first.key]);assert.equal(missingBucket[0].status,'unconfirmed');
});

test('batch sidecar reads never exceed three concurrent metadata/record inspections',async()=>{
 const fixtures=await Promise.all(Array.from({length:7},(_,index)=>fixture({index})));let running=0,maximum=0;
 const bucket={head:async key=>{running++;maximum=Math.max(maximum,running);await new Promise(resolve=>setImmediate(resolve));running--;return fixtures.find(f=>f.key===key).metadata;},
  get:async key=>{running++;maximum=Math.max(maximum,running);await new Promise(resolve=>setImmediate(resolve));running--;return fixtures.find(f=>key===f.key+'.edit.json').bucket.get(key);}};
 const result=await api.readFreeImageEditReviews(bucket,'owner','product',fixtures.map(f=>f.key));assert.equal(result.length,7);assert.equal(maximum,3);
});

test('deleted, replaced or reordered destinations inspect only their currently selected exact keys',async()=>{
 const partial=await fixture({index:10}),repaired=await fixture({index:11,issue:null}),ordinary='owner/uploaded-manual.png';
 const bucket={head:key=>{assert.equal(key,repaired.key,'the old pool member is not selected');return repaired.bucket.head(key);},get:key=>repaired.bucket.get(key)};
 const after=await api.readFreeImageEditReviews(bucket,'owner','product',[ordinary,repaired.key]);assert.equal(after.length,1);assert.equal(after[0].status,'clear');assert.deepEqual(partial.calls,[]);
 assert.deepEqual(plain(await api.readFreeImageEditReviews(bucket,'owner','product',[ordinary])),[]);
});
