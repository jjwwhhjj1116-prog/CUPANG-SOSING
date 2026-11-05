import test from 'node:test';
import assert from 'node:assert/strict';
import {amendmentCopy as copy} from '../extensions/supplier-hub/native-draft-detail-amendment.mjs';
import {validateNativeDraftDetailAmendmentDelta as delta} from '../extensions/supplier-hub/native-draft-detail-amendment-delta.mjs';

import {fixture,multipartFixture,seal,cell,detailPath} from './helpers/native-draft-detail-amendment-delta.mjs';

test('exact detail publication delta retains old inputs and returns only new DETAIL upload metadata',async()=>{
 const f=await fixture(),before=JSON.stringify(f.source),after=JSON.stringify(f.next),proof=await delta(f.source,f.next);
 assert.equal(proof.format,'yoofam-native-draft-detail-amendment-delta-v1');assert.match(proof.deltaSha256,/^[a-f0-9]{64}$/);assert.deepEqual(proof.newDetailFiles,[f.newImage]);assert.deepEqual(proof.retainedDetailFiles,[]);
 assert.equal(proof.allowedPaths.length,6);assert.deepEqual(proof.allowedPaths[0],{documentIndex:0,wire:{path:detailPath}});assert.ok(Object.isFrozen(proof));assert.ok(Object.isFrozen(proof.newDetailFiles[0]));
 assert.equal(JSON.stringify(f.source),before);assert.equal(JSON.stringify(f.next),after);assert.deepEqual(await delta(copy(f.source),copy(f.next)),proof);
});

for(const [name,change]of Object.entries({
 price:s=>s.nativePlan.body.jsonDocument[0].productPage.supplyPrice++,model:s=>s.quotationView.overrides.common.model='다른 모델',
 blank:s=>delete s.quotationView.legacyOverrides.common.retainedBlank,manual:s=>s.quotationView.resolved.rows[1].fields.model.source='automatic',
 seo:s=>s.nativePlan.body.productName='다른 제목',category:s=>s.quotationView.categoryContext.categoryId='999',profile:s=>s.review.identity.requestedProfileId='profile',
 option:s=>s.review.members.reverse(),inclusion:s=>s.quotationView.resolved.rows[1].included=false,schema:s=>s.quotationView.resolved.schema.fields[0].label='다른 라벨',
 optin:s=>s.settings.settings.translateImages=false,provider:s=>s.settings.settings.imageVisionModel='other-model',scope:s=>s.settings.scope.company.name='다른 회사',
 content:s=>s.quotationView.contentRevision++,options:s=>s.quotationView.optionRevision++,extraRevision:s=>s.quotationView.revision++,
 pool:s=>s.quotationView.imageKeys.push('owner/unrelated.png'),foreignPool:s=>s.quotationView.imageKeys.push('other/stolen.png'),poolRemoval:s=>s.quotationView.imageKeys.shift(),
 otherImage:s=>s.nativePlan.images[0].byteLength++,legal:s=>s.nativePlan.body.jsonDocument[0].legalPage.certification='인증 완료',
 hidden:s=>s.quotationView.unseenSetting='new',unknown:s=>s.nativePlan.unseen='new',empty:s=>s.nativePlan.images.splice(1,1),
 editor:s=>s.quotationView.detailEditorInputs.origin.productId='other-product',
 wire:s=>s.quotationView.resolved.schema.fields[0].hubWire.path=['productPage','supplyPrice'],reviewExtra:s=>s.review.unknown=true,
 fileExtra:s=>s.nativePlan.images[1].unknown=true,referenceExtra:s=>s.nativePlan.images[1].references[0].unknown=true
}))test(`non-DETAIL ${name} mutation fails even after resealing all public hashes`,async()=>{const f=await fixture();change(f.next);await seal(f.next);await assert.rejects(delta(f.source,f.next));});

test('new selected DETAIL references must equal both body filenames and exact quotation cells',async()=>{
 for(const change of [s=>s.nativePlan.images[1].references[0].wire.path=['imagePage','images','mainImage'],s=>s.nativePlan.images[1].references[0].optionId='two',s=>s.quotationView.resolved.rows[1].fields.detailImages.value='',s=>s.quotationView.overrides.common.detailImages='owner/unrelated.png']){
  const f=await fixture();change(f.next);await seal(f.next);await assert.rejects(delta(f.source,f.next));
 }
});

test('a reused DETAIL transport name cannot carry replacement metadata or bytes',async()=>{const f=await fixture();f.next.nativePlan.images[1].transportName=f.oldImage.transportName;await seal(f.next);await assert.rejects(delta(f.source,f.next));});
test('unchanged body, forged hashes, clock rewind and executable JSON cannot create an amendment',async()=>{
 const f=await fixture();await assert.rejects(delta(f.source,f.source));
 const nochange=copy(f.source);nochange.quotationView.revision++;nochange.quotationView.productVersion=nochange.quotationView.updatedAt='2026-11-05T02:00:00.000Z';await seal(nochange);await assert.rejects(delta(f.source,nochange));
 const forged=copy(f.next);forged.review.reviewDigest='b'.repeat(64);await assert.rejects(delta(f.source,forged));
 const rewind=copy(f.next);rewind.quotationView.productVersion=rewind.quotationView.updatedAt=f.source.quotationView.productVersion;await seal(rewind);await assert.rejects(delta(f.source,rewind));
 let invoked=false;const unsafe={...f.next};Object.defineProperty(unsafe,'danger',{enumerable:true,get(){invoked=true;return true;}});await assert.rejects(delta(f.source,unsafe));assert.equal(invoked,false);
});

test('a sealed ordered multi-part publication uploads only new transport names and retains reused old DETAIL bytes',async()=>{
 const f=await multipartFixture(),proof=await delta(f.source,f.next);assert.deepEqual(proof.newDetailFiles,[f.newImage]);
 assert.equal(proof.retainedDetailFiles.length,1);assert.equal(proof.retainedDetailFiles[0].transportName,f.oldImage.transportName);
 assert.deepEqual(proof.retainedDetailFiles[0].references.map(row=>row.slotIndex),[1,1]);
});
test('saved multipart boundaries, dimensions, output ownership and ordered source coverage cannot be forged',async()=>{
 for(const change of [e=>e.parts[1].start=0,e=>e.parts[1].end=3,e=>e.parts[1].height=101,e=>e.parts[1].width=400,
  e=>e.parts[1].uploadId='f'.repeat(64),e=>e.parts[1].unrecognized='yes',e=>e.images[0].key=e.output.key,
  e=>e.images[0].width=16000,e=>e.images.push({...e.images[0],sha256:'f'.repeat(64)})]){
  const f=await multipartFixture();change(f.next.quotationView.detailEditorInputs);await seal(f.next);await assert.rejects(delta(f.source,f.next));
 }
});
test('exact linked schema aliases are allowed, while a similarly named unrelated field remains immutable',async()=>{
 const f=await fixture();for(const source of [f.source,f.next]){
  for(const view of [source.quotationView.resolved,source.quotationView.automatic]){
   delete view.schema.fields[0].hubWire;view.schema.fields.push({id:'rawDetail',type:'images',hubInput:'detailImages',hubWire:{path:detailPath}});
   view.schema.fields.push({id:'detailImagesMetadata',type:'text'});for(const row of view.rows){row.fields.rawDetail=copy(row.fields.detailImages);row.fields.detailImagesMetadata=cell('unchanged');}
  }
  source.quotationView.overrides.common.rawDetail=source.quotationView.overrides.common.detailImages;source.quotationView.overrides.common.detailImagesMetadata='unchanged';await seal(source);
 }
 assert.equal((await delta(f.source,f.next)).newDetailFiles.length,1);f.next.quotationView.overrides.common.detailImagesMetadata='changed';await seal(f.next);await assert.rejects(delta(f.source,f.next));
});
