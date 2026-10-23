import test from 'node:test';
import assert from 'node:assert/strict';
import {assetProjectionFixture,assetSnapshot,companies,module,plain,sha} from './helpers/supplier-hub-single-assets.mjs';
import {projectionFixture} from './helpers/supplier-hub-single-projection.mjs';
const source=module('app/native-asset-source-plan.ts'),legalModule=module('app/native-legal-attachment-plan.ts');
async function fixture(company=companies[0]){
 const f=assetProjectionFixture(company),base=await f.planInput(),projection=base.projection;
 const identity={ownerId:'owner',productId:'synthetic-native-source',company:{...company},categoryId:f.input.categoryId,categoryPath:[...f.input.categoryPath],schemaSha256:projection.schemaSha256,
  sourceFingerprint:'b'.repeat(64),inputFingerprint:'c'.repeat(64),source:{productVersion:'2026-10-20T01:00:00.000Z',contentRevision:3,optionRevision:4,quotationRevision:5,profileId:'captured-category',profileRevision:null},
  members:[{optionId:'synthetic-one',optionLabel:'검정',documentIndex:0}]};
 const nativeLegalAttachmentPlan=await legalModule.buildNativeLegalAttachmentPlan({identity,applicability:'not-applicable',context:{schemaSha256:identity.schemaSha256,categoryId:identity.categoryId,company,targets:[],issues:[],files:[],registered:false,remoteWrites:false,submissionReady:false}});
 assert.equal(nativeLegalAttachmentPlan.metadataValid,true,JSON.stringify(nativeLegalAttachmentPlan.issues));
 return {...f,input:{identity,projection,ownedKeys:base.ownedKeys,assets:base.assets,metadata:base.metadata,nativeLegalAttachmentPlan}};
}
for(const company of companies)test(`${company.code}: actual projected private references become an independent filename body, not the legacy/public URL payload`,async()=>{
 const f=await fixture(company),before=JSON.stringify(f.input.projection),oldAssets=f.input.assets.map(file=>[file.key,sha(file.data)]),plan=await source.buildNativeAssetSourcePlan(f.input);
 assert.equal(plan.metadataValid,true,JSON.stringify(plan.issues));assert.equal(plan.format,'yoofam-native-asset-source-plan-v1');assert.equal(plan.storageNameSemantics,'private-key-leaf');assert.equal(plan.images.length,7);
 assert.equal(plan.nativeLegalAttachmentPlan,null);assert.equal(plan.identity.source.profileRevision,null);assert.deepEqual(plain(plan.identity.company),company);
 for(const key of ['registered','remoteWrites','submissionReady','transportReady','bytesVerified'])assert.equal(plan[key],false);
 assert.equal(plan.sourcePlanSha256,await source.nativeAssetSourcePlanSha256(plan));assert.equal(plan.identityDigest,sha(source.nativeAssetSourceCanonical(plan.identity)));
 assert.equal(plan.originalBodySha256,sha(source.nativeAssetSourceCanonical(plan.body)));assert.equal(plan.preparedBodySha256,plan.originalBodySha256);
 const image=plan.body.jsonDocument[0].imagePage,byKey=new Map(plan.images.map(file=>[file.key,file]));
 assert.equal(image.images.mainImage,byKey.get(f.input.assets[0].key).transportName);
 assert.equal(image.images.additionalImage,f.input.assets.slice(1,3).map(file=>byKey.get(file.key).transportName).join(','));
 assert.equal(image.details.detailedImage,f.input.assets.slice(3,6).map(file=>byKey.get(file.key).transportName).join(','));
 assert.equal(image.images.labelImages[0].labelImageFiles,byKey.get(f.input.assets[6].key).transportName);
 assert.equal(image.msrpAgree,false);assert.equal(image.labelContactAgreed,false);assert.equal(plan.body.jsonDocument[0].productPage.commonAttributes.purchasePrice,'11960');
 for(const file of plan.images){assert.equal(file.originalName,file.key.slice('owner/'.length));assert.ok(file.transportName.length<=100);assert.match(file.transportName,/^[a-z]+-[a-f0-9]{64}-[a-f0-9]{16}\.png$/);assert.equal(file.sha256,sha(f.input.assets.find(asset=>asset.key===file.key).data));assert.equal(file.references[0].optionId,'synthetic-one');assert.equal(file.references[0].documentIndex,0);}
 assert.equal(JSON.stringify(f.input.projection),before);assert.deepEqual(f.input.assets.map(file=>[file.key,sha(file.data)]),oldAssets);assert.ok(!JSON.stringify(plan.body).includes('https://'));assert.ok(!JSON.stringify(plan.body).includes('owner/'));
 const repeat=await source.buildNativeAssetSourcePlan(f.input);assert.equal(repeat.sourcePlanSha256,plan.sourcePlanSha256);
});
test('generated image leaves longer than 180 characters retain exact owned bytes and short Hub aliases',async()=>{
 for(const company of companies){const f=await fixture(company),old=f.input.assets[0].key;
  const leaf=`free-image-00000000-0000-4000-8000-000000000001-${'a'.repeat(64)}-${'b'.repeat(64)}.png`,key=`owner/${leaf}`;
  assert.equal(leaf.length,181);
  f.input.projection=JSON.parse(JSON.stringify(f.input.projection).split(old).join(key));
  f.input.ownedKeys=f.input.ownedKeys.map(value=>value===old?key:value);
  f.input.assets=f.input.assets.map(asset=>asset.key===old?{...asset,key}:asset);
  f.input.metadata.set(key,f.input.metadata.get(old));f.input.metadata.delete(old);
  const plan=await source.buildNativeAssetSourcePlan(f.input);
  assert.equal(plan.metadataValid,true,JSON.stringify(plan.issues));const image=plan.images.find(image=>image.key===key);
  assert.equal(image.originalName,leaf);assert.ok(image.transportName.length<=100);assert.equal(image.sha256,sha(f.input.assets[0].data));
  assert.equal(plan.body.jsonDocument[0].imagePage.images.mainImage,image.transportName);assert.equal(plan.registered,false);
 }
});
test('source clocks, selected bytes and native filename body each affect the independent source-plan hash',async()=>{
 const f=await fixture(),old=await source.buildNativeAssetSourcePlan(f.input);
 for(const mutate of [input=>input.identity.source.optionRevision++,input=>input.identity.sourceFingerprint='e'.repeat(64),input=>input.identity.inputFingerprint='d'.repeat(64)]){
  const next=await fixture();mutate(next.input);next.input.nativeLegalAttachmentPlan=await legalModule.buildNativeLegalAttachmentPlan({identity:next.input.identity,applicability:'not-applicable',context:{schemaSha256:next.input.identity.schemaSha256,categoryId:next.input.identity.categoryId,company:next.input.identity.company,targets:[],issues:[],files:[],registered:false,remoteWrites:false,submissionReady:false}});
  const changed=await source.buildNativeAssetSourcePlan(next.input);assert.equal(changed.metadataValid,true,JSON.stringify(changed.issues));assert.notEqual(changed.sourcePlanSha256,old.sourcePlanSha256);
 }
 const next=await fixture(),asset=next.input.assets[0];asset.data[asset.data.length-1]^=1;asset.sha256=sha(asset.data);next.input.metadata.set(asset.key,{size:asset.data.length,httpMetadata:{contentType:'image/png'},customMetadata:{sha256:asset.sha256}});
 const changed=await source.buildNativeAssetSourcePlan(next.input);assert.equal(changed.metadataValid,true);assert.notEqual(changed.images[0].transportName,old.images[0].transportName);assert.notEqual(changed.sourcePlanSha256,old.sourcePlanSha256);assert.notEqual(changed.preparedBodySha256,old.preparedBodySha256);
});
test('wrong identity/company/category/member, foreign/unowned references and stale files fail closed without a target or body hash',async()=>{
 const mutations=[f=>f.input.identity.company=companies[1],f=>f.input.identity.categoryId='99999',f=>f.input.identity.members[0].optionId='other',f=>f.input.identity.members[0].documentIndex=1,f=>f.input.identity.ownerId='-owner',
  f=>f.input.projection.review.unresolvedImages[0].keys=['other/private.png'],f=>f.input.projection.review.unresolvedImages[0].savedValue='other',f=>f.input.projection.review.unresolvedImages[0].wire.path=['legalPage','images','mainImage'],
  f=>f.input.assets[0].sha256='f'.repeat(64),f=>f.input.metadata.get(f.input.assets[0].key).customMetadata.sha256='f'.repeat(64),f=>f.input.metadata.delete(f.input.assets[0].key),f=>f.input.ownedKeys=f.input.ownedKeys.slice(1),
  f=>f.input.nativeLegalAttachmentPlan.identity.source.contentRevision++,f=>f.input.projection.payload.docId=123,f=>f.input.projection.review.unresolvedImages.push(plain(f.input.projection.review.unresolvedImages[0]))];
 for(const mutate of mutations){const f=await fixture();mutate(f);const plan=await source.buildNativeAssetSourcePlan(f.input);assert.equal(plan.metadataValid,false,JSON.stringify(plan));assert.equal(plan.sourcePlanSha256,null);assert.equal(plan.originalBodySha256,null);assert.equal(plan.preparedBodySha256,null);assert.ok(plan.issues.some(issue=>issue.level==='error'));assert.equal(Object.hasOwn(plan,'target'),false);}
});
test('unconfirmed legality, unsupported image source roles/HTML and invalid prices remain visible blockers',async()=>{
 for(const kind of ['legal','html','price','wire']){const f=await fixture();if(kind==='legal')f.input.nativeLegalAttachmentPlan.metadataValid=false;if(kind==='html')f.input.projection.payload.jsonDocument[0].imagePage.details.htmlProductDetailContent='<img src="https://invalid.test/original.png">';if(kind==='price')f.input.projection.review.issues.push({code:'VALUE_INVALID',level:'error',message:'invalid saved price',optionId:'synthetic-one'});if(kind==='wire')f.input.projection.review.unresolvedImages[0].wire.path=['imagePage','details','htmlProductDetailContent'];
  const plan=await source.buildNativeAssetSourcePlan(f.input);assert.equal(plan.metadataValid,false);assert.equal(plan.sourcePlanSha256,null);assert.ok(plan.issues.some(issue=>issue.level==='error'));assert.equal(plan.transportReady,false);}
});

test('legal source blocker exposes current safe plan reasons while retaining one blocking issue and no capability',async()=>{
 const f=await fixture();f.input.nativeLegalAttachmentPlan.metadataValid=false;f.input.nativeLegalAttachmentPlan.planSha256=null;
 f.input.nativeLegalAttachmentPlan.issues=[{code:'NATIVE_LEGAL_APPLICABILITY_UNCONFIRMED',message:'실제 상품의 서류 해당 여부를 직접 확인해주세요.'},{code:'NATIVE_LEGAL_CONTEXT_ISSUES',message:'현재 원본 서류의 누락·미연결·저장값 문제를 먼저 해결해주세요.'}];
 const plan=await source.buildNativeAssetSourcePlan(f.input),issues=plan.issues.filter(issue=>issue.code==='NATIVE_ASSET_LEGAL_UNCONFIRMED');
 assert.equal(issues.length,1);assert.match(issues[0].message,/서류 해당 여부.*누락·미연결·저장값/);assert.equal(plan.metadataValid,false);assert.equal(plan.sourcePlanSha256,null);assert.equal(plan.transportReady,false);
});
test('explicitly saved true agreement is preserved in the original body but deferred only in its independently hashed prepared form',async()=>{
 const f=await fixture();f.input.projection.payload.jsonDocument[0].imagePage.msrpAgree=true;
 const plan=await source.buildNativeAssetSourcePlan(f.input);assert.equal(plan.metadataValid,true,JSON.stringify(plan.issues));assert.equal(plan.body.jsonDocument[0].imagePage.msrpAgree,true);assert.notEqual(plan.originalBodySha256,plan.preparedBodySha256);
 const prepared=plain(plan.body);prepared.jsonDocument[0].imagePage.msrpAgree=false;assert.equal(plan.preparedBodySha256,sha(source.nativeAssetSourceCanonical(prepared)));assert.equal(f.input.projection.payload.jsonDocument[0].imagePage.msrpAgree,true);
});
test('schema/quotation/source errors are retained and inert projection accessors never execute',async()=>{
 const f=await fixture();f.input.sourceIssues=[{kind:'error',code:'SOURCE_GAP',message:'actual missing source',optionId:null,optionLabel:'원문'}];const blocked=await source.buildNativeAssetSourcePlan(f.input);assert.equal(blocked.metadataValid,false);assert.ok(blocked.issues.some(issue=>issue.code==='SOURCE_GAP'&&issue.level==='error'));
 const other=await fixture();let getters=0;Object.defineProperty(other.input.projection,'payload',{enumerable:true,get(){getters++;return{};}});const result=await source.buildNativeAssetSourcePlan(other.input);assert.equal(result.metadataValid,false);assert.equal(getters,0);
});
test('safe native read selection includes two size and two label originals while the legacy selection stays unchanged',async()=>{
 const f=await fixture(),snapshot=assetSnapshot(),raw=JSON.parse(snapshot.schemaString);raw.properties.imagePage.properties.images.properties.sizeChartImage={type:'string',title:'사이즈표 파일명'};snapshot.schemaString=JSON.stringify(raw);
 const next=projectionFixture(snapshot);
 for(const entry of f.input.projection.review.fields.filter(field=>field.path.length)){const field=f.schema.fields.find(field=>field.id===entry.fieldId);if(field?.hubWire)next.set(field.hubWire.path,field.hubWire.name,entry.savedValue,entry.source);}
 const size=f.input.assets.slice(1,3).map(file=>file.key),label=[f.input.assets[6].key,f.input.assets[0].key];
 next.set(['imagePage','images','sizeChartImage'],undefined,size.join('\n'));next.set(['imagePage','images','labelImages'],'제품 한글 표시사항 라벨 또는 도안 이미지',label.join('\n'));
 f.input.projection=await module('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument(next.input);f.input.identity.schemaSha256=f.input.projection.schemaSha256;
 f.input.nativeLegalAttachmentPlan=await legalModule.buildNativeLegalAttachmentPlan({identity:f.input.identity,applicability:'not-applicable',context:{schemaSha256:f.input.identity.schemaSha256,categoryId:f.input.identity.categoryId,company:f.input.identity.company,targets:[],issues:[],files:[],registered:false,remoteWrites:false,submissionReady:false}});
 const native=source.nativeAssetSourceImageKeys({projection:f.input.projection,owner:'owner',ownedKeys:f.input.ownedKeys}),legacy=module('app/supplier-hub-single-assets.ts').singleAssetSelection(f.input.projection,'owner',f.input.ownedKeys);
 assert.equal(native.length,7);assert.ok(legacy.issues.some(issue=>issue.code==='SINGLE_IMAGE_COUNT'));assert.equal(legacy.selections.some(selection=>['size','label'].includes(selection.role)),false);
 const plan=await source.buildNativeAssetSourcePlan(f.input);assert.equal(plan.metadataValid,true,JSON.stringify(plan.issues));const doc=plan.body.jsonDocument[0],files=(type,keys)=>keys.map(key=>plan.images.find(file=>file.key===key&&file.imageType===type).transportName).join(',');
 assert.equal(doc.imagePage.images.sizeChartImage,files('SIZECHART',size));assert.equal(doc.imagePage.images.labelImages[0].labelImageFiles,files('LABEL',label));
 assert.equal(plan.images.filter(file=>file.imageType==='SIZECHART').length,2);assert.equal(plan.images.filter(file=>file.imageType==='LABEL').length,2);
 const foreign=plain(f.input.projection);foreign.review.unresolvedImages[0].keys=['other/private.png'];foreign.review.unresolvedImages[0].savedValue='other/private.png';assert.equal(source.nativeAssetSourceImageKeys({projection:foreign,owner:'owner',ownedKeys:f.input.ownedKeys}).includes('other/private.png'),false);
});
test('reusing 20MiB of unique originals as 70MiB of role-specific multipart aliases is blocked before a source capability is issued',async()=>{
 const f=await fixture(),png=Buffer.from(f.input.assets[0].data).subarray(0,-1),length=10*1024*1024;
 const table=Array.from({length:256},(_,value)=>{let crc=value;for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;return crc>>>0;});
 const padded=marker=>{const dataLength=length-png.length-12,chunk=Buffer.alloc(dataLength+12);chunk.writeUInt32BE(dataLength,0);chunk.write('npAD',4,'ascii');chunk[8]=marker;let crc=0xffffffff;for(let index=4;index<chunk.length-4;index++)crc=(crc>>>8)^table[(crc^chunk[index])&255];chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);return new Uint8Array(Buffer.concat([png.subarray(0,-12),chunk,png.subarray(-12)]));};
 f.input.assets=f.input.assets.slice(0,2).map((asset,index)=>({...asset,data:padded(index)}));
 f.input.metadata=new Map(f.input.assets.map(asset=>{asset.sha256=sha(asset.data);return[asset.key,{size:asset.data.length,httpMetadata:{contentType:'image/png'},customMetadata:{sha256:asset.sha256}}];}));
 const keys=f.input.assets.map(asset=>asset.key),before=f.input.assets.map(asset=>sha(asset.data));
 for(const reference of f.input.projection.review.unresolvedImages){reference.keys=reference.wire.path.at(-1)==='mainImage'?[keys[0]]:[...keys];reference.savedValue=reference.keys.join('\n');const field=f.input.projection.review.fields.find(field=>field.optionId===reference.optionId&&field.fieldId===reference.fieldId);field.savedValue=reference.savedValue;}
 const plan=await source.buildNativeAssetSourcePlan(f.input);assert.equal(plan.metadataValid,false);assert.equal(plan.sourcePlanSha256,null);assert.equal(plan.originalBodySha256,null);assert.ok(plan.issues.some(issue=>issue.code==='NATIVE_ASSET_TRANSPORT_IMAGE_LIMIT'&&issue.level==='error'));
 assert.equal(plan.images.length,7);assert.equal(new Set(plan.images.map(file=>file.key)).size,2);assert.equal(plan.images.reduce((sum,file)=>sum+file.byteLength,0),70*1024*1024);assert.deepEqual(f.input.assets.map(asset=>sha(asset.data)),before);assert.equal(plan.transportReady,false);
});
