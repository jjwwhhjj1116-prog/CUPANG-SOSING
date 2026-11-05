import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeDraftDetailAmendmentReceiver} from '../extensions/supplier-hub/native-draft-detail-amendment-receiver.mjs';
import {createNativeDraftDetailAmendmentStore} from '../extensions/supplier-hub/native-draft-detail-amendment-store.mjs';
import {amendmentDigest} from '../extensions/supplier-hub/native-draft-detail-amendment.mjs';
import {amendmentIndexedDB} from './helpers/amendment-indexeddb.mjs';
import {anchor as template,review as nextReview,requestId,amendmentId,plain,latest} from './helpers/native-draft-detail-amendment.mjs';
async function fixture(){
 const anchor=plain(template),key='product-document:'+anchor.parentPacketDigest,laneKey='product-document-lane:'+'f'.repeat(64),checkpoint={key,laneKey,requestId,docId:anchor.docId,state:'validated',draftOnly:true,sequence:15,validatedSteps:[2,3,4,5]};anchor.parentCheckpointSha256=await amendmentDigest(checkpoint);
 const parentReview={...plain(nextReview),reviewDigest:anchor.parentReviewDigest},packet={type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',version:1,requestId,createdAt:Date.now(),review:parentReview},parent={anchor,checkpoint,source:{review:parentReview},remote:{remote:{body:{text:'old'},images:[{imageName:'old'}],legal:[]}}};
 const idb=amendmentIndexedDB([[key,checkpoint],[laneKey,{key}]]),store=createNativeDraftDetailAmendmentStore(idb.api),calls=[],state={sourceCurrent:true,remote:plain(parent.remote.remote),fail:null,recovery:null};
 const adapter={authenticate:async()=>calls.push('auth'),readParent:async()=>plain(parent),verifyMissingParent:async()=>calls.push('missing-parent'),readNextSource:async()=>({packet:{...packet,review:plain(nextReview)},context:{key:'product-document:'+latest.packetDigest,identityDigest:latest.identityDigest,packetDigest:latest.packetDigest,originalBodySha256:nextReview.originalBodySha256,bodySha256:nextReview.preparedBodySha256,identity:{fingerprint:nextReview.identity.fingerprint}},source:{review:plain(nextReview)}}),verifyNextSource:async()=>{calls.push('source');if(!state.sourceCurrent)throw Error('source changed');},readRemote:async()=>({remote:plain(state.remote)}),prepareDetailParts:async()=>[{transportName:'new'}],
  upload:async()=>{calls.push('upload');if(state.fail==='upload')throw Error('ACK lost');state.remote.images.push({imageName:'new'});return{remote:plain(state.remote),ledger:{uploadAck:true}};},update:async()=>{calls.push('update');if(state.fail==='update')throw Error('ACK lost');state.remote.body={text:'new'};if(state.mutateAtUpdate)state.remote[state.mutateAtUpdate].push({outside:'change'});return{remote:plain(state.remote),ledger:{updateAck:true}};},verifyUpdatedBody:async(_record,body)=>assert.deepEqual(body,{text:'new'}),validate:async(_record,step)=>{calls.push('validate:'+step);if(state.fail==='validate:'+step)throw Error('ACK lost');return{remote:plain(state.remote),ledger:{}};},
  qualifyLatest:async()=>{calls.push('qualify');if(state.fail==='qualify')throw Error('source changed before qualification');return{latest,checkpoint:{key:'product-document:'+latest.packetDigest,laneKey,requestId,docId:anchor.docId,state:'validated'}};},recover:async()=>{calls.push('recover');return state.recovery;}};
 const receiver=createNativeDraftDetailAmendmentReceiver({store,adapter,validateDelta:async()=>({newDetailFiles:[{transportName:'new'}]})}),run=extra=>receiver.run({amendmentId,anchor,...extra},{});
 await receiver.run({action:'begin',amendmentId,packet,docId:anchor.docId},{});const preview=await run({action:'preview',nextReview});
 return{...idb,store,parent,packet,anchor,key,laneKey,state,calls,receiver,run,preview,apply:()=>run({action:'apply',nextReview,previewDigest:preview.previewDigest})};
}
test('preview exposes the exact current binding for UI apply without qualifying a lifecycle checkpoint',async()=>{
 const f=await fixture();assert.deepEqual(f.preview.latest,latest);assert.equal((await f.store.read(f.anchor,amendmentId)).latest,null);assert.equal(f.rows.has('product-document:'+latest.packetDigest),false);
});
test('editing remount inspection checks the original remote anchor before allowing editor access',async()=>{
 const f=await fixture();f.state.remote.body.text='outside-change';await assert.rejects(f.run({action:'inspect'}));assert.equal(f.calls.some(name=>name==='upload'||name==='update'||name.startsWith('validate:')),false);
});
test('same draft amendment uploads only delta, updates once, validates ordered steps and preserves parent/lane',async()=>{
 const f=await fixture(),parent=plain(f.rows.get(f.key)),lane=plain(f.rows.get(f.laneKey)),result=await f.apply();
 assert.equal(result.state,'validated');assert.deepEqual(result.execution,{create:0,upload:1,update:1,validate:4,submit:0});assert.deepEqual(result.validatedSteps,[2,3,4,5]);assert.deepEqual(result.latest,latest);
 assert.deepEqual(f.calls.filter(name=>name==='upload'||name==='update'||name.startsWith('validate:')),['upload','update','validate:2','validate:3','validate:4','validate:5']);assert.deepEqual(f.rows.get(f.key),parent);assert.deepEqual(f.rows.get(f.laneKey),lane);
 await f.apply();assert.equal(f.calls.filter(name=>name==='upload').length,1);assert.equal(f.calls.filter(name=>name==='update').length,1);
});
for(const phase of ['upload','update','validate:3'])test('unknown '+phase+' retains operation ID and recovery never dispatches',async()=>{
 const f=await fixture();f.state.fail=phase;const result=await f.apply(),before=f.calls.filter(name=>name==='upload'||name==='update'||name.startsWith('validate:'));
 assert.equal(result.needsRecovery,true);const child=await f.store.read(f.anchor,amendmentId);assert.ok(child.operationId.includes(':amend:'+amendmentId+':'));
 const recovered=await f.run({action:'recover'});assert.equal(recovered.needsRecovery,true);assert.deepEqual(f.calls.filter(name=>name==='upload'||name==='update'||name.startsWith('validate:')),before);await assert.rejects(f.apply());
});
test('source or remote changes stop before any upload/update/validation',async()=>{
 for(const change of [f=>f.state.sourceCurrent=false,f=>f.state.remote.body.text='changed']){const f=await fixture();change(f);const result=await f.apply().catch(error=>({error}));assert.ok(result.error);assert.equal(f.calls.some(name=>name==='upload'||name==='update'||name.startsWith('validate:')),false);}
});
for(const collection of ['images','legal'])test('successful body ACK cannot adopt concurrent '+collection+' changes',async()=>{
 const f=await fixture();
 // Observe the exact same successful update body, with an unrelated concurrent
 // file-list mutation. This must remain uncertain before any validation.
 f.state.mutateAtUpdate=collection;
 const result=await f.apply();assert.equal(result.state,'update-requested');assert.equal(result.needsRecovery,true);assert.ok(result.error);assert.equal(f.calls.some(name=>name.startsWith('validate:')),false);
});
test('positive upload recovery permits explicit remaining work without repeating upload',async()=>{
 const f=await fixture();f.state.fail='upload';await f.apply();f.state.remote.images.push({imageName:'new'});f.state.recovery={state:'files-saved',needsRecovery:false,uploadedRemote:plain(f.state.remote),uploadEvidence:{uploadAck:true}};
 const before=f.calls.filter(name=>name==='upload').length,recovered=await f.run({action:'recover'});assert.equal(recovered.state,'files-saved');assert.equal(recovered.needsRecovery,false);assert.deepEqual(recovered.execution,{create:0,upload:0,update:0,validate:0,submit:0});
 f.state.fail=null;const result=await f.apply();assert.equal(result.state,'validated');assert.equal(f.calls.filter(name=>name==='upload').length,before);assert.deepEqual(result.execution,{create:0,upload:0,update:1,validate:4,submit:0});
});
test('four successful validations cannot report qualified before latest checkpoint commit',async()=>{
 const f=await fixture();f.state.fail='qualify';const result=await f.apply();assert.equal(result.state,'updated');assert.deepEqual(result.validatedSteps,[2,3,4,5]);assert.ok(result.error);assert.equal((await f.store.read(f.anchor,amendmentId)).latest,null);
 const before=f.calls.filter(name=>name==='upload'||name==='update'||name.startsWith('validate:'));f.state.fail=null;const qualified=await f.apply();assert.equal(qualified.state,'validated');assert.deepEqual(f.calls.filter(name=>name==='upload'||name==='update'||name.startsWith('validate:')),before);assert.deepEqual(qualified.execution,{create:0,upload:0,update:0,validate:0,submit:0});
});
