import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {sizeChartApiFixture,sizeKeys,companies,module,plain,keys,imageBytes,sha,json,publicKeys,allTables} from './helpers/supplier-hub-single-size-chart.mjs';
import {SINGLE_DOCUMENT_LIVE_VERIFIED} from '../extensions/supplier-hub/single-dispatch.mjs';

const files=['app/supplier-hub-single-assets.ts','app/components/supplier-hub-single-review.tsx','app/exports/single-package.ts','app/supplier-hub-single-projection.ts','app/supplier-hub-single-client.ts','app/media/quotation/[token]/route.ts','extensions/supplier-hub/single-dispatch.mjs'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]));
const preserve=(f,db,privateFiles)=>{assert.equal(allTables(f),db);assert.equal(f.objectState(),privateFiles);assert.deepEqual(f.h.network,[]);assert.equal(f.h.aiSources.length,0);assert.equal(f.storage.privatePutAttempts,0);};
const isPreparedOnly=view=>{assert.equal(view.registered,false);assert.equal(view.remoteWrites,false);assert.equal(view.submissionReady,false);assert.equal(view.humanAgreementsConfirmed,false);assert.equal(view.payload.docId,null);assert.equal(view.review.externalAvailabilityVerified,false);};

for(const company of companies)test(`size-chart prepare and lost-ack GET recovery preserve exact included option URLs and source state (${company.code})`,async t=>{
 const f=await sizeChartApiFixture(company),sourceBefore=hashes();
 try{
  const db=allTables(f),privateFiles=f.objectState(),privateCount=f.h.objects.size;
  const preview=await json(await f.route(f.endpoint));assert.equal(preview.prepared,false);assert.equal(preview.review.canPrepare,true,JSON.stringify(preview.review.issues.filter(issue=>issue.level==='error')));
  isPreparedOnly(preview);assert.equal(publicKeys(f).length,0);assert.equal(f.storage.publicPutAttempts,0);assert.equal(preview.payload.jsonDocument.length,2);
  const sizes=preview.manifest.filter(slot=>slot.role==='size');assert.deepEqual(sizes.map(slot=>[slot.optionId,slot.keys[0]]),[['synthetic-one',sizeKeys[0]],['synthetic-two',sizeKeys[1]]]);
  assert.ok(!preview.manifest.some(slot=>slot.optionId==='synthetic-excluded'||slot.keys.includes(sizeKeys[2])));
  assert.ok(preview.payload.jsonDocument.every(document=>document.imagePage.images.sizeChartImage===undefined));
  assert.equal((await f.serve(sizes[0].files[0].url)).status,404);assert.equal(f.storage.publicPutAttempts,0);preserve(f,db,privateFiles);
  if(company.code==='A01526306')f.loseNextPrepareAcknowledgement();
  const result=await f.prepare(preview.fingerprint);
  if(company.code==='A01526306')await json(result,503);else await json(result);
  assert.equal(publicKeys(f).length,9);assert.equal(f.storage.publicPutAttempts,9);assert.equal(f.h.objects.size,privateCount+9);
  const beforeRecovery=f.storage.publicPutAttempts,prepared=await json(await f.route(f.endpoint));assert.equal(f.storage.publicPutAttempts,beforeRecovery,'GET recovery must not repeat prepare or storage puts');
  assert.equal(prepared.prepared,true);assert.equal(prepared.fingerprint,preview.fingerprint);isPreparedOnly(prepared);assert.deepEqual(plain(prepared.company),company);
  for(const [index,key]of [sizeKeys[0],sizeKeys[1]].entries()){
   const slot=prepared.manifest.find(slot=>slot.role==='size'&&slot.keys[0]===key),file=slot.files[0],url=prepared.payload.jsonDocument[index].imagePage.images.sizeChartImage;
   assert.equal(url,file.url);assert.equal(typeof url,'string');assert.match(url,/^https:\/\/single-assets\.example\.test\/media\/quotation\/[a-f0-9]{64}$/);assert.ok(!url.includes(','));
   assert.equal(file.verification,'stored-body-sha256');assert.equal(file.published,true);assert.equal(file.sha256,sha(imageBytes(100+index)));
   const response=await f.serve(url);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(sha(new Uint8Array(await response.arrayBuffer())),file.sha256);
   const client=module('app/supplier-hub-single-client.ts'),packet=await client.singlePackagePacket(prepared,'owner',slot.optionId);
   assert.equal(packet.body.jsonDocument.length,1);assert.equal(packet.body.jsonDocument[0].imagePage.images.sizeChartImage,url);assert.equal(packet.optionId,slot.optionId);assert.equal(packet.company.code,company.code);assert.equal(packet.body.docId,null);
   assert.ok(Object.isFrozen(packet));assert.ok(Object.isFrozen(packet.body.jsonDocument[0]));
  }
  const again=await json(await f.route(f.endpoint));assert.equal(again.prepared,true);assert.equal(f.storage.publicPutAttempts,beforeRecovery);assert.deepEqual(plain(again.payload),plain(prepared.payload));
  assert.equal(f.requests.filter(request=>request.method==='POST'&&request.path===f.endpoint).length,1);assert.equal(SINGLE_DOCUMENT_LIVE_VERIFIED,false);assert.deepEqual(hashes(),sourceBefore);preserve(f,db,privateFiles);
  assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n,0);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_single_receipts').get().n,0);
  t.diagnostic(JSON.stringify({company,sourceHashes:sourceBefore,sourceFrozen:true,requests:f.requests,requestCount:f.requests.length,
   privateFiles:privateCount,privateFilesUnchanged:true,databaseUnchanged:true,databaseTables:JSON.parse(db).length,publicFiles:publicKeys(f).length,publicPutAttempts:f.storage.publicPutAttempts,preparePosts:1,lostAcknowledgement:company.code==='A01526306',readOnlyRecovery:true,
   sizeSelection:[{optionId:'synthetic-one',key:sizeKeys[0]},{optionId:'synthetic-two',key:sizeKeys[1]}],excludedSizeKeyPublished:false,actualMediaRouteSha256Verified:true,packetSingleSizeUrlPreserved:true,registered:false,liveGate:SINGLE_DOCUMENT_LIVE_VERIFIED,externalNetwork:0,hubWrites:0,nativeBrowser:false}));
 }finally{f.close();}
});

test('manual size blank and shared main/size key retain final choices with no extra size publication',async()=>{
 for(const mode of ['manual-blank','shared-key']){
  const f=await sizeChartApiFixture();try{
   const changes=mode==='manual-blank'?[{fieldKey:f.sizeField,optionId:'synthetic-two',value:''}]:['synthetic-one','synthetic-two'].map(optionId=>({fieldKey:f.sizeField,optionId,value:keys[0]}));
   await f.edit(changes);const db=allTables(f),privateFiles=f.objectState(),view=await json(await f.route(f.endpoint)),out=await json(await f.prepare(view.fingerprint));assert.equal(out.prepared,true);isPreparedOnly(out);
   if(mode==='manual-blank'){
    assert.equal(out.payload.jsonDocument[1].imagePage.images.sizeChartImage,'');assert.ok(!out.manifest.some(slot=>slot.role==='size'&&slot.optionId==='synthetic-two'));assert.equal(publicKeys(f).length,8);
    assert.ok(!out.manifest.some(slot=>slot.keys.includes(sizeKeys[1])||slot.keys.includes(sizeKeys[2])));
    const packet=await module('app/supplier-hub-single-client.ts').singlePackagePacket(out,'owner','synthetic-two');assert.equal(packet.body.jsonDocument[0].imagePage.images.sizeChartImage,'');
   }else{
    assert.equal(publicKeys(f).length,7);assert.equal(new Set(out.manifest.flatMap(slot=>slot.files).map(file=>file.url)).size,7);
    for(const document of out.payload.jsonDocument)assert.equal(document.imagePage.images.sizeChartImage,document.imagePage.images.mainImage);
   }
   preserve(f,db,privateFiles);assert.equal(SINGLE_DOCUMENT_LIVE_VERIFIED,false);
  }finally{f.close();}
 }
});

test('actual final quotation accepts two to five owned charts for review but blocks unverified Single multi-file encoding without publishing',async()=>{
 for(let count=2;count<=5;count++){
  const f=await sizeChartApiFixture();try{
   await f.edit([{fieldKey:f.sizeField,optionId:'synthetic-one',value:sizeKeys.slice(0,count).join('\n')}]);
   const db=allTables(f),privateFiles=f.objectState(),view=await json(await f.route(f.endpoint)),out=await json(await f.prepare(view.fingerprint));
   assert.equal(view.review.canPrepare,false);assert.equal(out.prepared,false);assert.ok(out.review.issues.some(issue=>issue.code==='SINGLE_IMAGE_COUNT'&&issue.fieldId===f.sizeField));
   assert.equal(out.payload.jsonDocument[0].imagePage.images.sizeChartImage,undefined);assert.equal(publicKeys(f).length,0);assert.equal(f.storage.publicPutAttempts,0);isPreparedOnly(out);preserve(f,db,privateFiles);
  }finally{f.close();}
 }
});

test('cross-company scope and unowned or delimiter-like size references cannot prepare another owner file',async()=>{
 for(const company of companies){
  const f=await sizeChartApiFixture(company);try{
   const view=await json(await f.route(f.endpoint));
   for(const value of ['other-owner/private-size.png',sizeKeys[0]+','+sizeKeys[1],sizeKeys[0]+'|'+sizeKeys[1]]){
    const current=await json(await f.route(f.base+'/quotation-fields'+f.query)),db=allTables(f),privateFiles=f.objectState();
    await json(await f.route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:{expectedRevision:current.revision,expectedInputFingerprint:current.inputFingerprint,changes:[{fieldKey:f.sizeField,optionId:'synthetic-one',value}]}}),400);
    preserve(f,db,privateFiles);assert.equal(publicKeys(f).length,0);
   }
   const db=allTables(f),privateFiles=f.objectState();f.h.setCompany(companies.find(other=>other.code!==company.code));await json(await f.prepare(view.fingerprint),409);assert.equal(publicKeys(f).length,0);preserve(f,db,privateFiles);
  }finally{f.close();}
 }
});

test('missing, corrupt or changed size source bytes cannot use an earlier preparation fingerprint',async()=>{
 for(const mode of ['missing','corrupt','changed','sha']){
  const f=await sizeChartApiFixture();try{
   const view=await json(await f.route(f.endpoint));
   if(mode==='missing')f.h.objects.delete(sizeKeys[0]);
   else if(mode==='corrupt')await f.h.bindings.FILES.put(sizeKeys[0],new Uint8Array([1,2,3]),{httpMetadata:{contentType:'image/png'}});
   else if(mode==='changed')await f.h.bindings.FILES.put(sizeKeys[0],imageBytes(199),{httpMetadata:{contentType:'image/png'},customMetadata:{sha256:sha(imageBytes(199))}});
   else await f.h.bindings.FILES.put(sizeKeys[0],imageBytes(100),{httpMetadata:{contentType:'image/png'},customMetadata:{sha256:'0'.repeat(64)}});
   // The intentional corrupt-fixture setup is outside the read/prepare phase.
   f.storage.privatePutAttempts=0;const db=allTables(f),privateFiles=f.objectState(),out=await f.prepare(view.fingerprint);
   assert.ok([400,409].includes(out.status),await out.clone().text());assert.equal(publicKeys(f).length,0);assert.equal(f.storage.publicPutAttempts,0);preserve(f,db,privateFiles);
  }finally{f.close();}
 }
});

test('GET recovery verifies the actual public size body and rejects forged matching metadata without overwriting it',async()=>{
 const f=await sizeChartApiFixture();try{
  const preview=await json(await f.route(f.endpoint)),file=preview.manifest.find(slot=>slot.role==='size').files[0],publicKey='quotation-public-detail/'+new URL(file.url).pathname.split('/').at(-1);
  assert.equal((await json(await f.prepare(preview.fingerprint))).prepared,true);
  // Corrupt an already complete isolated publication. If other public files
  // were absent, GET correctly stops at incomplete preparation first.
  await f.h.bindings.FILES.put(publicKey,imageBytes(199),{httpMetadata:{contentType:'image/png'},customMetadata:{publication:'yoofam-public-detail-v1',sha256:file.sha256}});
  const db=allTables(f),privateFiles=f.objectState(),puts=f.storage.publicPutAttempts;
  const read=await json(await f.route(f.endpoint),409);assert.equal(read.code,'SINGLE_PUBLIC_IMAGE_CONFLICT');assert.equal(f.storage.publicPutAttempts,puts);assert.equal(sha(f.h.objects.get(publicKey)),sha(imageBytes(199)));preserve(f,db,privateFiles);
 }finally{f.close();}
});
