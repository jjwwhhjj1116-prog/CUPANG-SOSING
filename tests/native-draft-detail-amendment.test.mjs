import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNativeDraftDetailAmendmentRequest as request,validateNativeDraftDetailAmendmentObservation as observation,validateNativeDraftDetailAmendmentAnchor as anchor} from '../extensions/supplier-hub/native-draft-detail-amendment.mjs';

const amendmentId='fbd02007-798b-4d43-862b-92a58d48dfcf',requestId='f69bda85-7f5c-4e8b-90f1-9550f70d81ba',hash='a'.repeat(64),company={code:'A01464742',name:'와이홉'};
const parent=()=>({origin:'https://sourceflow.jjwwhhjj1116.workers.dev',ownerId:'owner',company:{...company},productId:'product',requestId,docId:2362997,parentIdentityDigest:hash,parentPacketDigest:hash,parentReviewDigest:hash,parentSourcePlanSha256:hash,parentOriginalBodySha256:hash,parentPreparedBodySha256:hash,parentCheckpointSequence:15,parentCheckpointSha256:hash});
const result=()=>({format:'yoofam-native-draft-detail-amendment-v1',amendmentId,anchor:parent(),state:'editing',sequence:1,observedAt:Date.now(),previewDigest:null,latest:null,validatedSteps:[],needsRecovery:false,
 capabilities:{appendDetail:true},execution:{create:0,upload:0,update:0,validate:0,submit:0},readOnly:true,registered:false});
test('amendment DTOs retain immutable exact parent scope and reject untrusted extra capabilities',()=>{
 const input={action:'inspect',amendmentId,anchor:parent()},parsed=request(input);assert.deepEqual(parsed,input);assert.ok(Object.isFrozen(parsed.anchor));
 input.anchor.docId=7;assert.equal(parsed.anchor.docId,2362997);
 for(const change of [v=>v.reset=true,v=>v.anchor.ownerId='other/owner',v=>v.anchor.company.name='다른 회사',v=>v.anchor.docId=0,v=>v.anchor.parentCheckpointSequence=0,v=>v.anchor.parentPacketDigest='bad',v=>v.amendmentId='not-a-uuid']){const value={action:'inspect',amendmentId,anchor:parent()};change(value);assert.throws(()=>request(value));}
 assert.deepEqual(anchor(parent()),parent());
});
test('lost begin ACK inspection is a scoped lookup and cannot invent an editable child',()=>{
 const {parentCheckpointSequence:omitted,parentCheckpointSha256:omittedHash,...lookup}=parent();void omitted;void omittedHash;
 const input={action:'inspect',amendmentId,lookup};assert.deepEqual(request(input),input);
 const absent={...result(),state:'not-found',anchor:null,sequence:0,capabilities:{appendDetail:false}};
 assert.deepEqual(observation(absent,input),absent);assert.throws(()=>observation({...absent,state:'editing'},input));
 assert.throws(()=>request({...input,action:'apply'}));assert.throws(()=>request({...input,anchor:parent()}));
});
test('read-only observations reject hidden writes, stale source identity and mismatched parent replies',()=>{
 const input={action:'preview',amendmentId,anchor:parent(),nextReview:{format:'yoofam-supplier-hub-product-document-v1',type:'YOOFAM_PRODUCT_DOCUMENT_REVIEW',identity:{fingerprint:hash},body:{},members:[{}],reviewDigest:hash,originalBodySha256:hash,preparedBodySha256:hash,registered:false,remoteWrites:false,submissionReady:false}};
 assert.equal(observation(result(),{action:'inspect',amendmentId,anchor:parent()}).state,'editing');
 for(const change of [v=>v.execution.upload=1,v=>v.execution.create=1,v=>v.anchor.docId=7,v=>v.readOnly=false,v=>v.registered=true,v=>v.capabilities.reset=true,v=>v.latest={reviewDigest:'b'.repeat(64),sourcePlanSha256:hash,originalBodySha256:hash,preparedBodySha256:hash,identityDigest:hash,packetDigest:hash}]){const value=result();change(value);assert.throws(()=>observation(value,input));}
});
