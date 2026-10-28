import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRecoveryFixture} from './helpers/native-product-recovery.mjs';
import {SINGLE_COMPANIES} from './helpers/supplier-hub-single-document.mjs';
import {createProductDocumentReceiver} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {PRODUCT_DOCUMENT_LIVE_VERIFIED,dispatchProductDocument} from '../extensions/supplier-hub/product-document-dispatch.mjs';
import {withProductDocumentChrome} from './helpers/product-document-preview.mjs';
import {nativeAssetRecoveryPage,nativeAssetRecoveryErrorCode} from '../extensions/supplier-hub/native-asset-recovery-page.mjs';
const copy=value=>JSON.parse(JSON.stringify(value));
const observationInput=(f,common)=>({...common,identityDigest:f.context.identityDigest,operation:'update',operationId:f.packet.requestId+':update',docId:f.createdDocId,
 baselineDocIds:[f.prior.docId],expectedBody:{...copy(f.context.packet.body),docId:f.createdDocId}});
const records=f=>f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords;
const mutations=f=>f.calls.filter(call=>call.name==='hub-fetch'&&call.method==='POST'&&/\/(?:create|update|validate-step\/\d+)$/.test(new URL(call.url).pathname));

for(const company of SINGLE_COMPANIES)test(`${company.code}: lost upload ACK recovery lists the exact new document without rewriting the ledger, files or document`,async()=>{
 const f=await nativeRecoveryFixture(company,{loseUploadAck:true});try{
  const beforeProtected=JSON.stringify(f.documents.get(f.prior.docId)),common=await f.start();await assert.rejects(f.update(common));
  const ledgerBefore=records(f),documentBefore=JSON.stringify(f.documents.get(f.createdDocId)),writes=mutations(f).length,uploads=f.state.uploads.length;
  f.state.recoveryRequests.length=0;const result=await f.adapter.inspectNativeAssets(observationInput(f,common));
  assert.equal(result.readOnly,true);assert.equal(result.ledgerMutated,false);assert.equal(result.unresolved,true);assert.equal(result.canContinue,false);assert.equal(result.remoteBytesVerified,false);assert.equal(result.actualUploadVerified,false);assert.equal(result.registered,false);
  assert.deepEqual(f.state.recoveryRequests.map(row=>row.method),['GET']);assert.equal(result.groups[0].state,'listed-unconfirmed');assert.equal(result.groups[0].listedFiles.length,1);
  assert.equal(result.groups[0].expectedFiles[0].byteLength,f.state.source.images[0].byteLength);assert.equal(result.groups[0].expectedFiles[0].contentType,'image/png');assert.equal(result.groups[0].remoteByteLengthVerified,false);assert.equal(result.groups[0].remoteContentTypeVerified,false);
  assert.equal(records(f),ledgerBefore);assert.equal(JSON.stringify(f.documents.get(f.createdDocId)),documentBefore);assert.equal(JSON.stringify(f.documents.get(f.prior.docId)),beforeProtected);assert.equal(f.state.uploads.length,uploads);assert.equal(mutations(f).length,writes);
  let recovered;await assert.rejects(f.adapter.recoverWrite(observationInput(f,common)),error=>{recovered=error.observation;return error.code==='NATIVE_ASSET_RECOVERY_READ_ONLY';});
  assert.equal(recovered.groups[0].state,'listed-unconfirmed');assert.equal(records(f),ledgerBefore);assert.equal(f.state.uploads.length,uploads);assert.equal(mutations(f).length,writes);assert.equal(f.submitted,0);
 }finally{f.close();}
});
test('native receiver recover reports read-only file facts and retains the original update-requested checkpoint',async()=>{
 const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0],{loseUploadAck:true});let checkpoint;const store={get:async()=>checkpoint,claim:async(_key,value)=>{if(checkpoint)return false;checkpoint=copy(value);return true;},compareAndSet:async(_key,expected,next)=>{if(JSON.stringify(checkpoint)!==JSON.stringify(expected))return false;checkpoint=copy(next);return true;}};
 try{const receiver=createProductDocumentReceiver({adapter:f.adapter,store}),started=await receiver.start(f.packet,f.sender);assert.equal(started.state,'update-requested');assert.equal(started.needsRecovery,true);
  const ledgerBefore=records(f),checkpointBefore=JSON.stringify(checkpoint),uploads=f.state.uploads.length,writes=mutations(f).length;const result=await receiver.recover(f.packet,f.sender);
  assert.equal(result.state,'update-requested');assert.equal(result.needsRecovery,true);assert.equal(result.error.code,'NATIVE_ASSET_RECOVERY_READ_ONLY');assert.match(result.error.message,/1\/4/);
  assert.equal(JSON.stringify(checkpoint),checkpointBefore);assert.equal(records(f),ledgerBefore);assert.equal(f.state.uploads.length,uploads);assert.equal(mutations(f).length,writes);assert.equal(f.submitted,0);
 }finally{f.close();}
});
test('already observed groups are compared with fresh list metadata while a later requested group stays unresolved',async()=>{
 const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0],{loseUploadAck:true,loseUploadAckGroup:'ADDITIONAL'});try{const common=await f.start();await assert.rejects(f.update(common));assert.deepEqual(f.state.uploads,['MAIN','ADDITIONAL']);const ledger=records(f),result=await f.adapter.inspectNativeAssets(observationInput(f,common));
  assert.equal(result.groups[0].state,'metadata-current');assert.equal(result.groups[1].state,'listed-unconfirmed');assert.equal(result.canContinue,false);assert.equal(records(f),ledger);assert.equal(f.state.uploads.length,2);assert.equal(f.submitted,0);
 }finally{f.close();}
});
test('legal queries use only the observed read-only files-by-type operation and cannot become an upload acknowledgement',async()=>{
 const f=await nativeRecoveryFixture(SINGLE_COMPANIES[1],{pdf:true,loseUploadAck:true,loseUploadAckGroup:'certificate'});try{const common=await f.start();await assert.rejects(f.update(common));const ledger=records(f),uploads=f.state.uploads.length;f.state.recoveryRequests.length=0;
  const result=await f.adapter.inspectNativeAssets(observationInput(f,common)),legal=result.groups.find(group=>group.groupKey==='legal:certificate');assert.equal(legal.state,'listed-unconfirmed');assert.equal(legal.expectedFiles[0].contentType,'application/pdf');assert.equal(legal.remoteContentTypeVerified,false);
  assert.deepEqual(f.state.recoveryRequests.map(row=>[new URL(row.url).pathname,row.method]),[['/sr/draft/api/get-images-by-id/'+f.createdDocId,'GET'],['/sr/draft/api/get-files-by-type/'+f.createdDocId,'POST']]);assert.equal(records(f),ledger);assert.equal(f.state.uploads.length,uploads);assert.equal(f.submitted,0);
 }finally{f.close();}
});
test('missing or full filename lists are diagnostic facts rather than remote byte/type/size evidence',async()=>{
 for(const missing of [false,true]){const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0],{loseUploadAck:true});try{const common=await f.start();await assert.rejects(f.update(common));if(missing)f.state.registry.clear();const before=records(f),result=await f.adapter.inspectNativeAssets(observationInput(f,common));assert.equal(result.groups[0].state,missing?'not-observed':'listed-unconfirmed');assert.equal(result.remoteBytesVerified,false);assert.equal(result.actualUploadVerified,false);assert.equal(result.canContinue,false);assert.equal(records(f),before);}finally{f.close();}}
});

test('read recovery uses each independently verified native source snapshot without a fourth duplicate source GET',async()=>{
 const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0],{loseUploadAck:true});try{
  const common=await f.start();await assert.rejects(f.update(common));
  const planReads=()=>f.state.appReads.filter(url=>{const parsed=new URL(url);return parsed.pathname.endsWith('/native-assets')&&!parsed.searchParams.has('key')&&!parsed.searchParams.has('bundle');}).length;
  const before=planReads(),writes=mutations(f).length,ledger=records(f);
  await f.adapter.inspectNativeAssets(observationInput(f,common));
  assert.equal(planReads()-before,6,'three independent source observations at each read boundary');
  assert.equal(mutations(f).length,writes);assert.equal(records(f),ledger);assert.equal(f.submitted,0);
 }finally{f.close();}
});
test('changed actor/source/body/frame/document/ledger and unfamiliar list entries fail closed without writes',async()=>{
 for(const kind of ['actor','source','body','tab','frame','doc','old-doc','ledger','unknown-file','observed-list','local-size','local-type','group-promotion']){const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0],{loseUploadAck:true,loseUploadAckGroup:kind==='observed-list'?'ADDITIONAL':undefined});try{const common=await f.start();await assert.rejects(f.update(common));const input=observationInput(f,common),writes=mutations(f).length,uploads=f.state.uploads.length;
  if(kind==='actor')f.state.company=copy(SINGLE_COMPANIES[1]);if(kind==='source')f.state.source={...f.state.source,inputFingerprint:'f'.repeat(64)};
  if(kind==='body')input.expectedBody.productName='changed';if(kind==='tab')input.tab.windowId++;
  if(kind==='frame'){const execute=f.api.scripting.executeScript;f.api.scripting.executeScript=async request=>{const result=await execute(request);if(request.func.name==='nativeAssetRecoveryPage')result[0].documentId='new-frame';return result;};}
  if(['doc','old-doc','ledger'].includes(kind)){const all=JSON.parse(records(f)),record=all[f.context.packetDigest];if(kind==='doc')record.docId='different-doc';if(kind==='old-doc')record.baselineDocIds.push(record.docId);if(kind==='ledger')record.nativeAssets.planSha256='f'.repeat(64);f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords=JSON.stringify(all);}
  if(kind==='unknown-file')f.state.registry.set('unexpected.png',{imageName:'unexpected.png',imageUrl:'/stored/unexpected.png',s3Link:'stored/unexpected.png'});
  if(kind==='observed-list'){const key=f.state.source.images[0].transportName;f.state.registry.set(key,{...f.state.registry.get(key),s3Link:'different-storage'});}
  if(['local-size','local-type','group-promotion'].includes(kind)){const execute=f.api.scripting.executeScript;f.api.scripting.executeScript=async request=>{const result=await execute(request);if(request.func.name==='nativeAssetRecoveryPage'){const observation=JSON.parse(result[0].result),group=observation.groups[0];if(kind==='local-size')group.expectedFiles[0].byteLength++;if(kind==='local-type')group.expectedFiles[0].contentType='image/jpeg';if(kind==='group-promotion')group.remoteBytesVerified=true;result[0].result=JSON.stringify(observation);}return result;};}
  const before=records(f);await assert.rejects(f.adapter.inspectNativeAssets(input));assert.equal(records(f),before);assert.equal(mutations(f).length,writes);assert.equal(f.state.uploads.length,uploads);assert.equal(f.submitted,0);
 }finally{f.close();}}
});
test('dispatch live gate remains false and no new start is enabled by the read-only recovery helper',async()=>{
 const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0]);try{assert.equal(PRODUCT_DOCUMENT_LIVE_VERIFIED,false);const preview=await withProductDocumentChrome(f.api,()=>dispatchProductDocument({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action:'preview',packet:f.packet},f.sender));assert.equal(preview.liveVerified,false);await assert.rejects(dispatchProductDocument({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action:'start',packet:f.packet},f.sender),error=>error.code==='PRODUCT_LIVE_CONTRACT_UNVERIFIED');assert.equal(f.state.uploads.length,0);assert.equal(f.submitted,0);}finally{f.close();}
});

test('failed native readback names only its comparison phase and fields, preserving every write guard',async()=>{
 const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0],{loseUploadAck:true});try{
  const common=await f.start();await assert.rejects(f.update(common));const input=observationInput(f,common),execute=f.api.scripting.executeScript;
  f.api.scripting.executeScript=async request=>{const result=await execute(request);if(request.func.name==='nativeAssetRecoveryPage'){const observation=JSON.parse(result[0].result);observation.observedAt=Date.now()-60001;result[0].result=JSON.stringify(observation);}return result;};
  const before=records(f),writes=mutations(f).length,uploads=f.state.uploads.length;
  await assert.rejects(f.adapter.inspectNativeAssets(input),error=>error.code==='NATIVE_ASSET_RECOVERY_UNCONFIRMED'&&error.message.includes('observation-envelope')&&error.message.includes('observed-at')&&!error.message.includes(f.packet.requestId));
  assert.equal(records(f),before);assert.equal(mutations(f).length,writes);assert.equal(f.state.uploads.length,uploads);assert.equal(f.submitted,0);
 }finally{f.close();}
});

// Simulate a transport that drops null-valued object properties, while strings
// pass through unchanged; omitted operation IDs must survive without defaults.
test('JSON result preserves unrequested group nulls through a null-dropping transport',async()=>{
 const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0],{loseUploadAck:true,loseUploadAckGroup:'ADDITIONAL'});try{
  const common=await f.start();await assert.rejects(f.update(common));const execute=f.api.scripting.executeScript;let demonstrated=false;
  const dropNull=value=>Array.isArray(value)?value.map(dropNull):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==null).map(([k,v])=>[k,dropNull(v)])):value;
  f.api.scripting.executeScript=async request=>{const result=await execute(request);if(request.func.name==='nativeAssetRecoveryPage'){
   assert.equal(typeof result[0].result,'string');const raw=JSON.parse(result[0].result),group=raw.groups.find(item=>item.requestState==='not-requested');assert.ok(group);
   assert.equal(group.operationId,null);assert.equal(Object.hasOwn(dropNull(raw).groups.find(item=>item.requestState==='not-requested'),'operationId'),false);demonstrated=true;
   result[0].result=dropNull(result[0].result);
  }return result;};
  const before=records(f),writes=mutations(f).length,uploads=f.state.uploads.length;const result=await f.adapter.inspectNativeAssets(observationInput(f,common));
  assert.equal(demonstrated,true);assert.equal(result.groups.find(group=>group.requestState==='not-requested').operationId,null);
  assert.equal(records(f),before);assert.equal(mutations(f).length,writes);assert.equal(f.state.uploads.length,uploads);assert.equal(f.submitted,0);
 }finally{f.close();}
});

test('invalid or tampered JSON recovery results fail closed without writes',async()=>{
 for(const kind of ['object','malformed','null','array','oversize','missing-null','foreign-doc','promoted']){
  const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0],{loseUploadAck:true,loseUploadAckGroup:'ADDITIONAL'});try{
   const common=await f.start();await assert.rejects(f.update(common));const execute=f.api.scripting.executeScript;
   f.api.scripting.executeScript=async request=>{const result=await execute(request);if(request.func.name==='nativeAssetRecoveryPage'){
    const original=JSON.parse(result[0].result);if(kind==='object')result[0].result=original;else if(kind==='malformed')result[0].result='{';else if(kind==='null')result[0].result='null';else if(kind==='array')result[0].result='[]';else if(kind==='oversize')result[0].result=' '.repeat(6*1024*1024+1);else{
     if(kind==='missing-null')delete original.groups.find(group=>group.requestState==='not-requested').operationId;
     if(kind==='foreign-doc')original.docId='different';if(kind==='promoted')original.remoteWrites=true;result[0].result=JSON.stringify(original);
    }
   }return result;};
   const before=records(f),writes=mutations(f).length,uploads=f.state.uploads.length;
   await assert.rejects(f.adapter.inspectNativeAssets(observationInput(f,common)),{code:'NATIVE_ASSET_RECOVERY_UNCONFIRMED'});
   assert.equal(records(f),before);assert.equal(mutations(f).length,writes);assert.equal(f.state.uploads.length,uploads);assert.equal(f.submitted,0);
  }finally{f.close();}
 }
});

test('page execution error diagnostics disclose only allowlisted labels and never exception text',async()=>{
 for(const mode of ['known-result','unknown-result','known-rejection','unknown-rejection']){
  const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0],{loseUploadAck:true});try{
   const common=await f.start();await assert.rejects(f.update(common));const execute=f.api.scripting.executeScript;
   const message=mode.startsWith('known')?'현재 파일 목록이 원래 확인한 업로드 응답과 다릅니다.':'secret customer identifier';
   f.api.scripting.executeScript=async request=>{if(request.func.name==='nativeAssetRecoveryPage'&&mode.endsWith('rejection'))throw Error(message);
    const result=await execute(request);if(request.func.name==='nativeAssetRecoveryPage')result[0].error={message};return result;};
   const before=records(f),writes=mutations(f).length,uploads=f.state.uploads.length;
   await assert.rejects(f.adapter.inspectNativeAssets(observationInput(f,common)),error=>error.code==='NATIVE_ASSET_RECOVERY_UNCONFIRMED'&&error.message.includes('observation-execution')&&error.message.includes(mode.startsWith('known')?'file-list-mismatch':'unrecognized')&&!error.message.includes(message));
   assert.equal(records(f),before);assert.equal(mutations(f).length,writes);assert.equal(f.state.uploads.length,uploads);assert.equal(f.submitted,0);
  }finally{f.close();}
 }
});

test('injected page returns only bounded allowlisted failures before and during file inspection',async()=>{
 const oversized=JSON.parse(await nativeAssetRecoveryPage(' '.repeat(8*1024*1024+1)));
 assert.deepEqual(oversized,{format:'yoofam-native-asset-recovery-error-v1',code:'input-too-large',stage:'input'});
 assert.equal(nativeAssetRecoveryErrorCode({...oversized,extra:'private'}),null);
 assert.equal(nativeAssetRecoveryErrorCode({...oversized,code:'private'}),null);
 for(const fault of ['mismatch','unexpected-network-error']){
  const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0],{loseUploadAck:true,loseUploadAckGroup:'ADDITIONAL'});try{
   const common=await f.start();await assert.rejects(f.update(common));
   if(fault==='mismatch'){const key=f.state.source.images[0].transportName;f.state.registry.set(key,{...f.state.registry.get(key),s3Link:'different-storage'});}
   else f.state.registry.values=()=>{throw Error('sensitive synthetic customer detail');};
   // Model Chrome's loss of an injected-function rejection as result:null.
   // A failure caught inside the page must still cross as a JSON diagnostic.
   const execute=f.api.scripting.executeScript;let lostException=false;
   f.api.scripting.executeScript=async request=>{try{return await execute(request);}catch(error){if(request.func.name!=='nativeAssetRecoveryPage')throw error;lostException=true;return[{frameId:0,documentId:f.hubDocumentId,result:null}];}};
   const before=records(f),writes=mutations(f).length,uploads=f.state.uploads.length;
   await assert.rejects(f.adapter.inspectNativeAssets(observationInput(f,common)),error=>error.code==='NATIVE_ASSET_RECOVERY_UNCONFIRMED'&&error.message.includes('observation-page')&&error.message.includes(fault==='mismatch'?'file-list-mismatch':'unrecognized')&&!error.message.includes('sensitive synthetic customer detail'));
   assert.equal(lostException,false);assert.equal(records(f),before);assert.equal(mutations(f).length,writes);assert.equal(f.state.uploads.length,uploads);assert.equal(f.submitted,0);
  }finally{f.close();}
 }
});

test('file list request distinguishes redirects, status, abort and network without retries or writes',async()=>{
 for(const [kind,expectedStage,expectedCode] of [
  ['redirect','http-response','http-redirect'],['unauthorized','http-response','http-401'],
  ['server','http-response','http-503'],['unknown-status','http-response','http-status'],
  ['network','http-request','http-network'],['abort','http-request','http-aborted'],['unknown-error','http-request','unrecognized']
 ]){
  const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0],{loseUploadAck:true});try{
   const common=await f.start();await assert.rejects(f.update(common));
   let calls=0;f.state.recoveryFetchOverride=async(_url,init)=>{calls++;assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.credentials,'include');
    if(kind==='network')throw new TypeError('private server detail');if(kind==='abort')throw new DOMException('private server detail','AbortError');
    if(kind==='unknown-error')throw Error('private server detail');if(kind==='redirect')return Response.redirect('https://example.invalid/login',302);
    return new Response('',{status:kind==='unauthorized'?401:kind==='server'?503:418});
   };
   const before=records(f),writes=mutations(f).length,uploads=f.state.uploads.length;
   await assert.rejects(f.adapter.inspectNativeAssets(observationInput(f,common)),error=>error.code==='NATIVE_ASSET_RECOVERY_UNCONFIRMED'&&error.message.includes('observation-page')&&error.message.includes(expectedStage)&&error.message.includes(expectedCode)&&!error.message.includes('private server detail'));
   assert.equal(calls,1);assert.equal(records(f),before);assert.equal(mutations(f).length,writes);assert.equal(f.state.uploads.length,uploads);assert.equal(f.submitted,0);
  }finally{f.close();}
 }
});

test('each image or legal file list gets its own bounded timer and an expired prior request cannot abort the next',async()=>{
 const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0],{pdf:true,loseUploadAck:true});try{
  const common=await f.start();await assert.rejects(f.update(common));const timers=[],signals=[];
  f.state.recoveryTimerHarness={setTimeout:(fn,delay)=>{const timer={fn,delay,cleared:false};timers.push(timer);return timer;},clearTimeout:timer=>{timer.cleared=true;}};
  f.state.onRecoveryFetch=(_url,init)=>{signals.push(init.signal);if(signals.length===2){assert.equal(timers[0].cleared,true);timers[0].fn();assert.equal(init.signal.aborted,false,'prior request deadline must not cancel a later request');}};
  const before=records(f),writes=mutations(f).length,uploads=f.state.uploads.length,result=await f.adapter.inspectNativeAssets(observationInput(f,common));
  assert.equal(signals.length,2);assert.notEqual(signals[0],signals[1]);assert.equal(timers.length,2);assert.deepEqual(timers.map(timer=>timer.delay),[30000,30000]);assert.ok(timers.every(timer=>timer.cleared));
  assert.equal(result.readOnly,true);assert.equal(result.canContinue,false);assert.equal(records(f),before);assert.equal(mutations(f).length,writes);assert.equal(f.state.uploads.length,uploads);assert.equal(f.submitted,0);
 }finally{f.close();}
});

test('a timed out read aborts the active request and leaves the original document unresolved',async()=>{
 const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0],{loseUploadAck:true});try{
  const common=await f.start();await assert.rejects(f.update(common));let timer,calls=0;
  f.state.recoveryTimerHarness={setTimeout:(fn,delay)=>{timer={fn,delay,cleared:false};return timer;},clearTimeout:handle=>{handle.cleared=true;}};
  f.state.recoveryFetchOverride=async(_url,init)=>{calls++;timer.fn();assert.equal(init.signal.aborted,true);throw new DOMException('private timeout details','AbortError');};
  const before=records(f),uploads=f.state.uploads.length,writes=mutations(f).length;
  await assert.rejects(f.adapter.inspectNativeAssets(observationInput(f,common)),error=>error.code==='NATIVE_ASSET_RECOVERY_UNCONFIRMED'&&error.message.includes('http-request')&&error.message.includes('http-timeout')&&!error.message.includes('private timeout details'));
  assert.equal(calls,1);assert.equal(timer.delay,30000);assert.equal(timer.cleared,true);assert.equal(records(f),before);assert.equal(f.state.uploads.length,uploads);assert.equal(mutations(f).length,writes);assert.equal(f.submitted,0);
 }finally{f.close();}
});
