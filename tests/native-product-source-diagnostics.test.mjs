import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeReviewFixture,companies,plain,digest} from './helpers/native-source-review.mjs';

const secret='PRIVATE-customer-filename-token-897';
const resign=(plan,{identity=false,body=false}={})=>{
 if(identity)plan.identityDigest=digest(plan.identity);
 if(body){plan.originalBodySha256=digest(plan.body);const prepared=plain(plan.body);for(const document of prepared.jsonDocument)if(document.imagePage)for(const key of ['msrpAgree','labelContactAgreed'])if(Object.hasOwn(document.imagePage,key))document.imagePage[key]=false;plan.preparedBodySha256=digest(prepared);}
 const {sourcePlanSha256:ignored,...manifest}=plan;void ignored;plan.sourcePlanSha256=digest(manifest);
};
const diagnostic=field=>error=>{
 assert.ok(error instanceof Error);assert.ok(error.message.includes(`확인 항목: ${field}`),error.message);
 assert.equal(error.message.includes(secret),false);assert.equal(error.message.includes('owner/'),false);return true;
};
const catalog=company=>({ownerId:'owner',company});

test('current source scope reports only the precise fixed identity field and still rejects every mismatched read',async()=>{
 const f=await nativeReviewFixture();try{
  const before=f.state(),objects=f.objectState();
  const cases=[
   ['identity.shape',plan=>{plan.identity[secret]='untrusted extra';}],
   ['identity.ownerId',plan=>{plan.identity.ownerId=secret;}],
   ['identity.productId',plan=>{plan.identity.productId=secret;}],
   ['identity.company',plan=>{plan.identity.company=companies[1];}],
   ['identity.categoryId',plan=>{plan.identity.categoryId='999897';}],
   ['identity.categoryPath',plan=>{plan.identity.categoryPath=[secret];}],
   ['identity.schemaSha256',plan=>{plan.identity.schemaSha256=secret;}],
   ['identity.sourceFingerprint',plan=>{plan.identity.sourceFingerprint=secret;}],
   ['identity.inputFingerprint',plan=>{plan.identity.inputFingerprint='0'.repeat(64);}],
   ['identity.source.shape',plan=>{plan.identity.source[secret]=0;}],
   ['identity.source.productVersion',plan=>{plan.identity.source.productVersion=secret;}],
   ['identity.source.contentRevision',plan=>{plan.identity.source.contentRevision++;}],
   ['identity.source.optionRevision',plan=>{plan.identity.source.optionRevision++;}],
   ['identity.source.quotationRevision',plan=>{plan.identity.source.quotationRevision++;}],
   ['identity.source.profileId',plan=>{plan.identity.source.profileId=secret;}],
   ['identity.source.profileRevision',plan=>{plan.identity.source.profileRevision=-1;}],
   ['identity.members',plan=>{plan.identity.members[0].optionLabel=secret;}],
  ];
  for(const [field,mutate]of cases){const plan=plain(f.sourcePlan);mutate(plan);const reads=[];
   const fetcher=async(url,init)=>{reads.push(url);assert.equal(init.method,'GET');return Response.json(url===f.sourcePath?plan:catalog(companies[0]));};
   await assert.rejects(f.model.readCurrentNativeAssetSource({...f.scope,fetcher,signal:new AbortController().signal}),diagnostic(field));
   assert.deepEqual(reads,['/api/supplier-hub/catalog-context',f.sourcePath],'reject before later actor/Hub calls');
  }
  assert.equal(f.state(),before);assert.equal(f.objectState(),objects);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('a legacy selected image without edit proof stays a readiness blocker rather than a fabricated scope mismatch',async()=>{
 const f=await nativeReviewFixture();try{
  const plan=plain(f.sourcePlan);Object.assign(plan,{metadataValid:false,sourcePlanSha256:null,identityDigest:null,originalBodySha256:null,preparedBodySha256:null});
  plan.issues.push({code:'FREE_IMAGE_TRANSLATION_UNCONFIRMED',level:'error',message:secret});
  const fetcher=async url=>Response.json(url===f.sourcePath?plan:catalog(companies[0]));
  const read=await f.model.readCurrentNativeAssetSource({...f.scope,fetcher,signal:new AbortController().signal});assert.equal(read.metadataValid,false);
  await assert.rejects(f.model.compileNativeSupplierHubProductDocument({...f.input,sourcePlan:read}),error=>{
   assert.match(error.message,/^원본 파일·필수 입력·서류 해당 여부/);assert.match(error.message,/확인 항목: metadataValid, issues/);assert.equal(error.message.includes(secret),false);return true;
  });
  assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('re-signed synthetic envelopes cannot hide filename/body/wire mismatches behind generic diagnostics',async()=>{
 const f=await nativeReviewFixture();try{
  const before=f.state(),objects=f.objectState();
  const cases=[
   ['body.docId',plan=>{plan.body.docId=897001;}],
   ['body.scope',plan=>{plan.body.scope=secret;}],
   ['body.displayCategoryCode',plan=>{plan.body.displayCategoryCode='999897';}],
   ['body.categoryId',plan=>{plan.body.categoryId=secret;}],
   ['body.productNoticeNumber',plan=>{plan.body.productNoticeNumber=secret;}],
   ['body.version',plan=>{plan.body.version=secret;}],
   ['body.categoryPath',plan=>{plan.body.categoryPath=secret;}],
   ['body.jsonDocument',plan=>{plan.body.jsonDocument.pop();}],
   ['body.jsonDocument.pages',plan=>{plan.body.jsonDocument[0][secret]={};}],
   ['body.productName',plan=>{plan.body.productName=secret;}],
   ['images.key.owner',plan=>{plan.images[0].key=secret+'/private.png';}],
   ['images.sha256',plan=>{plan.images[0].sha256=secret;}],
   ['images.contentType',plan=>{plan.images[0].contentType='text/'+secret;}],
   ['images.byteLength',plan=>{plan.images[0].byteLength=0;}],
   ['images.transportName',plan=>{plan.images[0].transportName='../'+secret+'.png';}],
   ['images.references.member',plan=>{plan.images[0].references[0].optionId=secret;}],
   ['images.references.slotIndex',plan=>{plan.images[0].references[0].slotIndex=30;}],
   ['images.references.wire',plan=>{plan.images[0].references[0].wire.path=[secret];}],
   ['images.references.slotIndex.duplicate',plan=>{plan.images[0].references.push(plain(plan.images[0].references[0]));}],
   ['images.references.slotIndex.sequence',plan=>{plan.images[0].references[0].slotIndex=3;}],
   ['body.imageWiring.value',plan=>{plan.body.jsonDocument[0].imagePage.images.mainImage=secret;}],
   ['body.imagePage.agreementType',plan=>{plan.body.jsonDocument[0].imagePage.msrpAgree=secret;}],
  ];
  for(const [field,mutate]of cases){const plan=plain(f.sourcePlan);mutate(plan);resign(plan,{body:true});await assert.rejects(f.model.compileNativeSupplierHubProductDocument({...f.input,sourcePlan:plan}),diagnostic(field));}
  const quotationView=plain(f.quotationView);quotationView.imageKeys=quotationView.imageKeys.filter(key=>key!==f.sourcePlan.images[0].key);
  await assert.rejects(f.model.compileNativeSupplierHubProductDocument({...f.input,quotationView}),diagnostic('images.key.selected'));
  assert.equal(f.state(),before);assert.equal(f.objectState(),objects);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('each independent manifest, identity, original-body and prepared-body digest remains mandatory and names only its failed proof',async()=>{
 const f=await nativeReviewFixture();try{
  for(const field of ['sourcePlanSha256','identityDigest','originalBodySha256','preparedBodySha256']){const plan=plain(f.sourcePlan);plan[field]='0'.repeat(64);if(field!=='sourcePlanSha256')resign(plan);
   await assert.rejects(f.model.compileNativeSupplierHubProductDocument({...f.input,sourcePlan:plan}),diagnostic(field));
  }
  const review=await f.model.compileNativeSupplierHubProductDocument(f.input);assert.equal(review.reviewDigest.length,64);assert.equal(review.remoteWrites,false);assert.equal(review.submissionReady,false);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('the final read fence distinguishes an actor change and a changed retained source without accepting either',async()=>{
 const f=await nativeReviewFixture();try{
  let catalogs=0;const fetcher=async url=>Response.json(url===f.sourcePath?f.sourcePlan:catalog(++catalogs===1?companies[0]:companies[1]));
  await assert.rejects(f.model.readCurrentNativeAssetSource({...f.scope,fetcher,signal:new AbortController().signal}),diagnostic('actor'));
  const plan=plain(f.sourcePlan);const changed=plain(plan);changed.issues.push({code:'SYNTHETIC_REVIEW',level:'review',message:secret});
  const fresh=async url=>Response.json(url===f.sourcePath?changed:catalog(companies[0]));
  await assert.rejects(f.model.reviewCurrentNativeSupplierHubProductDocument({...f.input,sourcePlan:plan,fetcher:fresh,signal:new AbortController().signal}),diagnostic('sourcePlan.current'));
  assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
