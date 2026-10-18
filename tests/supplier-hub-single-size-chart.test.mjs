import test from 'node:test';
import assert from 'node:assert/strict';
import {sizeChartProjectionFixture,sizePath,sizeKeys,companies,module,plain,keys,imageBytes,sha} from './helpers/supplier-hub-single-size-chart.mjs';

const assets=module('app/supplier-hub-single-assets.ts');
for(const company of companies)test(`one owned size-chart file becomes exactly one public URL on its bare Single image wire (${company.code})`,async()=>{
 const f=sizeChartProjectionFixture(company),input=await f.planInput(),before=JSON.stringify(input.projection);
 assert.equal(f.sizeField.type,'images');assert.equal(f.sizeField.hubInput,'sizeImages');assert.equal(f.sizeField.maxItems,5);
 const plan=await assets.buildSingleAssetPlan(input);assert.equal(plan.canPrepare,true,JSON.stringify(plan.issues));
 const size=plan.manifest.find(slot=>slot.role==='size');assert.deepEqual(plain(size.keys),[sizeKeys[0]]);assert.deepEqual(plain(size.wire),{path:sizePath});assert.equal(size.files.length,1);
 assert.equal(plan.files.length,8);assert.equal(plan.payload.jsonDocument[0].imagePage.images.sizeChartImage,size.files[0].url);
 assert.match(size.files[0].url,/^https:\/\/single-assets\.example\.test\/media\/quotation\/[a-f0-9]{64}$/);assert.ok(!size.files[0].url.includes(','));
 assert.equal(size.files[0].sha256,sha(imageBytes(100)));assert.equal(size.files[0].contentType,'image/png');assert.equal(JSON.stringify(input.projection),before);
 const preview=assets.singleAssetPackageView(plan,false);assert.equal(preview.prepared,false);assert.equal(preview.payload.jsonDocument[0].imagePage.images.sizeChartImage,undefined);
 const prepared=assets.singleAssetPackageView(plan,true);assert.equal(prepared.prepared,true);assert.equal(prepared.registered,false);assert.equal(prepared.remoteWrites,false);assert.equal(prepared.submissionReady,false);assert.equal(prepared.humanAgreementsConfirmed,false);
 assert.ok(!JSON.stringify(prepared.payload).includes('owner/'));assert.equal(prepared.manifest.find(slot=>slot.role==='size').files[0].verification,'stored-body-sha256');
});

test('manual size-chart blank stays blank and never restores a source image or creates a size publication',async()=>{
 const f=sizeChartProjectionFixture(undefined,'');
 const plan=await assets.buildSingleAssetPlan(await f.planInput());assert.equal(plan.canPrepare,true);
 assert.equal(plan.payload.jsonDocument[0].imagePage.images.sizeChartImage,'');assert.ok(!plan.manifest.some(slot=>slot.role==='size'));assert.ok(!plan.files.some(file=>file.key.startsWith('owner/size-chart-')));
});

test('size-chart links remain option-specific while an excluded option cannot publish another working image',async()=>{
 const f=sizeChartProjectionFixture(),two=structuredClone(f.row),excluded=structuredClone(f.row);
 two.optionId='synthetic-two';two.optionLabel='흰색';two.fields[f.sizeField.id].value=sizeKeys[1];
 excluded.optionId='synthetic-excluded';excluded.included=false;excluded.fields[f.sizeField.id].value='other-owner/working-size.png';
 f.resolved.rows.push(two,excluded);
 const plan=await assets.buildSingleAssetPlan(await f.planInput());assert.equal(plan.canPrepare,true);
 assert.equal(plan.payload.jsonDocument.length,2);assert.deepEqual(Array.from(plan.manifest.filter(slot=>slot.role==='size'),slot=>[slot.optionId,slot.keys[0]]),[['synthetic-one',sizeKeys[0]],['synthetic-two',sizeKeys[1]]]);
 assert.equal(plan.payload.jsonDocument[0].imagePage.images.sizeChartImage,plan.files.find(file=>file.key===sizeKeys[0]).url);assert.equal(plan.payload.jsonDocument[1].imagePage.images.sizeChartImage,plan.files.find(file=>file.key===sizeKeys[1]).url);
 assert.ok(!plan.files.some(file=>file.key==='other-owner/working-size.png'));assert.ok(!plan.manifest.some(slot=>slot.optionId==='synthetic-excluded'));
});

test('two through five size-chart files remain blocked rather than inventing comma, array or multipart save syntax',async()=>{
 for(let count=2;count<=5;count++){
  const f=sizeChartProjectionFixture(undefined,sizeKeys.slice(0,count).join('\n')),input=await f.planInput(),before=JSON.stringify(input.projection);
  const plan=await assets.buildSingleAssetPlan(input);assert.equal(plan.canPrepare,false);assert.ok(plan.issues.some(issue=>issue.code==='SINGLE_IMAGE_COUNT'&&issue.fieldId===f.sizeField.id));
  assert.ok(!plan.manifest.some(slot=>slot.role==='size'));assert.equal(plan.payload.jsonDocument[0].imagePage.images.sizeChartImage,undefined);assert.equal(JSON.stringify(input.projection),before);
 }
});

test('only exact bare sizeChartImage is recognized; wrong paths and named variants fail closed',async()=>{
 for(const mutate of [wire=>wire.path=['imagePage','images','sizeImages'],wire=>wire.path=['imagePage','details','sizeChartImage'],wire=>wire.path=['imagePage','images','sizeChartImage','extra'],wire=>wire.name='',wire=>Object.assign(wire,{name:'사이즈표',nameKey:'imageType',valueKey:'imageFiles'}),wire=>wire.valueKey='files']){
  const f=sizeChartProjectionFixture(),input=await f.planInput(),reference=input.projection.review.unresolvedImages.find(ref=>ref.fieldId===f.sizeField.id);mutate(reference.wire);
  const selection=assets.singleAssetSelection(input.projection,'owner',input.ownedKeys);assert.ok(selection.issues.some(issue=>issue.code==='SINGLE_IMAGE_ENCODING_UNVERIFIED'&&issue.fieldId===f.sizeField.id));
  const plan=await assets.buildSingleAssetPlan(input);assert.equal(plan.canPrepare,false);assert.ok(!plan.manifest.some(slot=>slot.role==='size'));
 }
});

test('size chart sharing another selected role key reuses its exact public capability and source bytes',async()=>{
 const f=sizeChartProjectionFixture(undefined,keys[0]),plan=await assets.buildSingleAssetPlan(await f.planInput());assert.equal(plan.canPrepare,true);
 assert.equal(plan.files.length,7);const main=plan.manifest.find(slot=>slot.role==='main'),size=plan.manifest.find(slot=>slot.role==='size');
 assert.equal(main.files[0].url,size.files[0].url);assert.equal(main.files[0].sha256,size.files[0].sha256);assert.equal(plan.files.filter(file=>file.key===keys[0]).length,1);
});

test('size references never guess delimiters, duplicate a key, or read an unowned/missing pool file',async()=>{
 for(const value of [sizeKeys[0]+','+sizeKeys[1],sizeKeys[0]+'|'+sizeKeys[1],'other-owner/size.png','owner/not-in-pool.png']){
  const f=sizeChartProjectionFixture(undefined,value),plan=await assets.buildSingleAssetPlan(await f.planInput());assert.equal(plan.canPrepare,false);assert.ok(plan.issues.some(issue=>issue.code==='SINGLE_IMAGE_REFERENCE'));assert.ok(!plan.manifest.some(slot=>slot.role==='size'));
 }
 const f=sizeChartProjectionFixture(),input=await f.planInput();input.projection.review.unresolvedImages.find(ref=>ref.fieldId===f.sizeField.id).keys=[sizeKeys[0],sizeKeys[0]];
 assert.ok(assets.singleAssetSelection(input.projection,'owner',input.ownedKeys).issues.some(issue=>issue.code==='SINGLE_IMAGE_REFERENCE'));
});

test('size-chart bytes retain all format, MIME, source digest and length checks',async()=>{
 for(const kind of ['missing','type','mime','sha','length']){
  const f=sizeChartProjectionFixture(),input=await f.planInput(),index=input.assets.findIndex(asset=>asset.key===sizeKeys[0]);
  if(kind==='missing')input.assets.splice(index,1);
  if(kind==='type'){const data=new Uint8Array([1,2,3]);input.assets[index]={...input.assets[index],data};input.metadata.set(sizeKeys[0],{size:data.byteLength,httpMetadata:{contentType:'image/png'}});}
  if(kind==='mime')input.metadata.get(sizeKeys[0]).httpMetadata.contentType='image/jpeg';
  if(kind==='sha')input.metadata.get(sizeKeys[0]).customMetadata.sha256='0'.repeat(64);
  if(kind==='length')input.metadata.get(sizeKeys[0]).size++;
  const plan=await assets.buildSingleAssetPlan(input);assert.equal(plan.canPrepare,false,kind);assert.ok(plan.issues.some(issue=>issue.level==='error'&&['SINGLE_IMAGE_MISSING','SINGLE_IMAGE_TYPE','SINGLE_IMAGE_METADATA','SINGLE_IMAGE_DIGEST'].includes(issue.code)));
 }
});
