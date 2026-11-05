import {amendmentCopy as copy,amendmentSame as same,amendmentDigest,amendmentFail as fail,validateNativeDraftDetailAmendmentAnchor} from './native-draft-detail-amendment.mjs';
const FORMAT='yoofam-native-draft-detail-amendment-private-v1',keyOf=id=>'product-document-detail-amendment:'+id,headOf=lane=>lane+':detail-amendment';
const immutable=['format','amendmentId','anchor','parentKey','laneKey','parentSnapshot','parentPacket','parentSource','parentRemote'];
const lookup=anchor=>Object.fromEntries(Object.entries(anchor).filter(([key])=>!['parentCheckpointSequence','parentCheckpointSha256'].includes(key)));
function parentValid(value){return value?.state==='validated'&&value.draftOnly===true&&!value.preparedLifecycle&&!value.receipt&&!value.submitRequestedAt&&same(value.validatedSteps,[2,3,4,5]);}
/** A child-only namespace in the existing private operation DB. The original
 * checkpoint and its product-lane owner are read fences, never write targets. */
export function createNativeDraftDetailAmendmentStore(indexedDBApi=globalThis.indexedDB){
 const open=async()=>{
  if(!indexedDBApi||typeof indexedDBApi.open!=='function')fail('DRAFT_DETAIL_AMENDMENT_STORAGE');
  if(typeof indexedDBApi.databases==='function'&&!(await indexedDBApi.databases()).some(row=>row.name==='yoofam-single-document-handoff'))return null;
  return new Promise((resolve,reject)=>{const request=indexedDBApi.open('yoofam-single-document-handoff');let missing=false;
   request.onupgradeneeded=()=>{missing=true;request.transaction.abort();};request.onerror=()=>missing?resolve(null):reject(request.error);
   request.onblocked=()=>reject(Error('원래 문서의 확장 보관함을 읽지 못했습니다.'));
   request.onsuccess=()=>{const db=request.result;if(missing||!db.objectStoreNames.contains('operations')){db.close();resolve(null);}else resolve(db);};
  });
 };
 const transaction=async(mode,run)=>{const db=await open();if(!db)return null;try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction('operations',mode),table=tx.objectStore('operations');let outcome,failure;
  const abort=error=>{failure=error;try{tx.abort();}catch{reject(error);}},get=(key,done)=>{const request=table.get(key);request.onerror=()=>abort(request.error);request.onsuccess=()=>{try{done(request.result);}catch(error){abort(error);}};};
  tx.oncomplete=()=>resolve(outcome);tx.onerror=()=>{failure??=tx.error;};tx.onabort=()=>reject(failure??tx.error??Error('수정 기록 저장을 확정하지 못했습니다.'));
  try{run({table,get,finish:value=>{outcome=value;}});}catch(error){abort(error);}
 });}finally{db.close();}};
 const guarded=(io,record,done)=>io.get(record.parentKey,parent=>io.get(record.laneKey,lane=>io.get(headOf(record.laneKey),head=>{
  if(!same(parent,record.parentSnapshot)||lane?.key!==record.parentKey||head?.key!==keyOf(record.amendmentId)||head.parentKey!==record.parentKey)fail('DRAFT_DETAIL_AMENDMENT_PARENT_CHANGED');done();
 })));
 const checked=async record=>{
  if(!record)return null;validateNativeDraftDetailAmendmentAnchor(record.anchor);
  if(record.format!==FORMAT||record.parentKey!=='product-document:'+record.anchor.parentPacketDigest||record.parentSnapshot?.key!==record.parentKey||record.parentSnapshot?.laneKey!==record.laneKey
   ||!parentValid(record.parentSnapshot)||record.anchor.parentCheckpointSequence!==record.parentSnapshot.sequence||await amendmentDigest(record.parentSnapshot)!==record.anchor.parentCheckpointSha256)fail('DRAFT_DETAIL_AMENDMENT_PARENT_CHANGED');
  return copy(record);
 };
 async function read(selection,amendmentId){
  const record=await transaction('readonly',io=>io.get(keyOf(amendmentId),child=>{
   if(!child){io.finish(null);return;}
   if(!same(selection,Object.hasOwn(selection,'parentCheckpointSequence')?child.anchor:lookup(child.anchor)))fail('DRAFT_DETAIL_AMENDMENT_SCOPE');
   guarded(io,child,()=>io.finish(child));
  }));return checked(record);
 }
 async function begin(parent,amendmentId,packet){
  const anchor=validateNativeDraftDetailAmendmentAnchor(parent.anchor),snapshot=copy(parent.checkpoint),parentKey='product-document:'+anchor.parentPacketDigest,laneKey=snapshot.laneKey;
  if(!parentValid(snapshot)||snapshot.key!==parentKey||snapshot.requestId!==anchor.requestId||String(snapshot.docId)!==String(anchor.docId)||snapshot.sequence!==anchor.parentCheckpointSequence||await amendmentDigest(snapshot)!==anchor.parentCheckpointSha256)fail('DRAFT_DETAIL_AMENDMENT_PARENT_CHANGED');
  const record={format:FORMAT,amendmentId,anchor,parentKey,laneKey,parentSnapshot:snapshot,parentPacket:copy(packet),parentSource:copy(parent.source),parentRemote:copy(parent.remote),state:'editing',sequence:1,updatedAt:Date.now(),previewDigest:null,latest:null,validatedSteps:[],needsRecovery:false};
  const saved=await transaction('readwrite',io=>io.get(parentKey,current=>io.get(laneKey,lane=>io.get(keyOf(amendmentId),existing=>io.get(headOf(laneKey),head=>{
   if(!same(current,snapshot)||lane?.key!==parentKey)fail('DRAFT_DETAIL_AMENDMENT_PARENT_CHANGED');
   if(existing){if(!same(existing.anchor,anchor)||!same(existing.parentPacket,packet)||head?.key!==keyOf(amendmentId))fail('DRAFT_DETAIL_AMENDMENT_CONFLICT');io.finish(existing);return;}
   if(head)fail('DRAFT_DETAIL_AMENDMENT_ACTIVE');
   io.table.add(record,keyOf(amendmentId));io.table.add({key:keyOf(amendmentId),parentKey,amendmentId},headOf(laneKey));io.finish(record);
  })))));
  if(!saved)fail('DRAFT_DETAIL_AMENDMENT_PARENT_MISSING');return checked(saved);
 }
 async function compareAndSet(expected,next,checkpoint){
  await checked(expected);
  if(immutable.some(key=>!same(expected[key],next[key]))||next.sequence!==expected.sequence+1||!Number.isSafeInteger(next.updatedAt)||next.updatedAt<expected.updatedAt)fail('DRAFT_DETAIL_AMENDMENT_CONFLICT');
  if(checkpoint&&(checkpoint.key===expected.parentKey||checkpoint.laneKey!==expected.laneKey||checkpoint.requestId!==expected.anchor.requestId||String(checkpoint.docId)!==String(expected.anchor.docId)))fail('DRAFT_DETAIL_AMENDMENT_SCOPE');
  return transaction('readwrite',io=>io.get(keyOf(expected.amendmentId),current=>{
   if(!same(current,expected)){io.finish(false);return;}
   guarded(io,expected,()=>{const commit=()=>{if(checkpoint)io.table.add(copy(checkpoint),checkpoint.key);io.table.put(copy(next),keyOf(next.amendmentId));io.finish(true);};
    if(checkpoint)io.get(checkpoint.key,prior=>{if(prior)fail('DRAFT_DETAIL_AMENDMENT_CHECKPOINT_EXISTS');commit();});else commit();});
  }));
 }
 async function activeFor(laneKey){return checked(await transaction('readonly',io=>io.get(headOf(laneKey),head=>{
  if(!head){io.finish(null);return;}io.get(head.key,child=>{if(!child)fail('DRAFT_DETAIL_AMENDMENT_CONFLICT');guarded(io,child,()=>io.finish(child));});
 })));}
 return Object.freeze({begin,read,compareAndSet,activeFor});
}
