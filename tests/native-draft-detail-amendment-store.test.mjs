import test from 'node:test';
import assert from 'node:assert/strict';
import {amendmentDigest} from '../extensions/supplier-hub/native-draft-detail-amendment.mjs';
import {createNativeDraftDetailAmendmentStore} from '../extensions/supplier-hub/native-draft-detail-amendment-store.mjs';
import {amendmentIndexedDB} from './helpers/amendment-indexeddb.mjs';
const hash='a'.repeat(64),amendmentId='fbd02007-798b-4d43-862b-92a58d48dfcf',otherId='c87adf1b-dfdc-4c1d-87ec-5e5f600d7a03';
async function fixture(){
 const key='product-document:'+hash,laneKey='product-document-lane:'+'b'.repeat(64),company={code:'A01464742',name:'와이홉'},checkpoint={key,laneKey,requestId:'f69bda85-7f5c-4e8b-90f1-9550f70d81ba',docId:2362997,state:'validated',draftOnly:true,sequence:15,validatedSteps:[2,3,4,5]};
 const anchor={origin:'https://sourceflow.jjwwhhjj1116.workers.dev',ownerId:'owner',company,productId:'product',requestId:checkpoint.requestId,docId:checkpoint.docId,parentIdentityDigest:hash,parentPacketDigest:hash,parentReviewDigest:hash,parentSourcePlanSha256:hash,parentOriginalBodySha256:hash,parentPreparedBodySha256:hash,parentCheckpointSequence:15,parentCheckpointSha256:await amendmentDigest(checkpoint)};
 const idb=amendmentIndexedDB([[key,checkpoint],[laneKey,{key}]]),parent={anchor,checkpoint,source:{settings:{brand:'기존 브랜드'}},remote:{body:{docId:2362997},images:[]}},packet={requestId:checkpoint.requestId};
 return{...idb,parent,packet,key,laneKey,store:createNativeDraftDetailAmendmentStore(idb.api),anchor};
}
test('atomic amendment reservation is idempotent, preserves its immutable parent and fences another child',async()=>{
 const f=await fixture(),old=structuredClone(f.rows.get(f.key)),lane=structuredClone(f.rows.get(f.laneKey));
 const child=await f.store.begin(f.parent,amendmentId,f.packet);assert.equal(child.state,'editing');assert.equal(child.sequence,1);
 assert.deepEqual(await f.store.begin(f.parent,amendmentId,f.packet),child);await assert.rejects(f.store.begin(f.parent,otherId,f.packet));
 assert.deepEqual(f.rows.get(f.key),old);assert.deepEqual(f.rows.get(f.laneKey),lane);assert.deepEqual(await f.store.read(f.anchor,amendmentId),child);
 const otherBucket=amendmentIndexedDB();assert.equal(await createNativeDraftDetailAmendmentStore(otherBucket.api).read(f.anchor,amendmentId),null);
});
test('simultaneous begins reserve one child and changed parent/lane cannot authorize a write',async()=>{
 const f=await fixture(),out=await Promise.allSettled([f.store.begin(f.parent,amendmentId,f.packet),f.store.begin(f.parent,otherId,f.packet)]);assert.equal(out.filter(row=>row.status==='fulfilled').length,1);
 for(const mode of ['parent','lane']){const g=await fixture();if(mode==='parent')g.rows.get(g.key).sequence++;else g.rows.set(g.laneKey,{key:'product-document:'+'c'.repeat(64)});await assert.rejects(g.store.begin(g.parent,amendmentId,g.packet));assert.equal([...g.rows.keys()].some(key=>key.startsWith('product-document-detail-amendment:')),false);}
});
test('child CAS never changes its anchor/parent packet, rewinds sequence or loses the active-child fence',async()=>{
 const f=await fixture(),child=await f.store.begin(f.parent,amendmentId,f.packet),next={...child,state:'previewed',sequence:2,updatedAt:child.updatedAt+1};
 assert.equal(await f.store.compareAndSet(child,next),true);assert.equal(await f.store.compareAndSet(child,next),false);
 for(const change of [value=>value.anchor.docId=7,value=>value.parentPacket.requestId='another',value=>value.sequence=1]){const value=structuredClone(next);value.sequence++;value.updatedAt++;change(value);await assert.rejects(f.store.compareAndSet(next,value));}
 f.rows.get(f.key).sequence++;await assert.rejects(f.store.read(f.anchor,amendmentId));
});
test('latest amended checkpoint cannot overwrite a pre-existing operation',async()=>{
 const f=await fixture(),child=await f.store.begin(f.parent,amendmentId,f.packet),key='product-document:'+'d'.repeat(64),checkpoint={key,laneKey:f.laneKey,requestId:f.anchor.requestId,docId:f.anchor.docId,state:'validated'};
 f.rows.set(key,{...checkpoint,sequence:70});
 await assert.rejects(f.store.compareAndSet(child,{...child,sequence:2,updatedAt:child.updatedAt+1},checkpoint));assert.equal(f.rows.get(key).sequence,70);assert.equal((await f.store.read(f.anchor,amendmentId)).sequence,1);
});
