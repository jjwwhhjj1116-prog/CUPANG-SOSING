import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const plain=value=>JSON.parse(JSON.stringify(value)),now=Date.now();
const review=()=>({identity:{ownerId:'owner',productId:'product',company:{code:'A01464742',name:'와이홉'}},reviewDigest:'a'.repeat(64),originalBodySha256:'b'.repeat(64),preparedBodySha256:'c'.repeat(64)});
const session=(requestId='00000000-0000-4000-8000-000000000732')=>({packet:{requestId,createdAt:now},preview:{identityDigest:'d'.repeat(64),identity:{appTabId:7,windowId:9}}});
const validationObservation=(saved,s)=>({format:'yoofam-supplier-hub-product-document-v1',state:'validation-rejected',requestId:saved.requestId,docId:'rejected-'+saved.requestId,registered:false,success:false,needsRecovery:false,recovered:true,
 identityDigest:saved.identityDigest,packetDigest:s.packetDigest,originalBodySha256:saved.originalBodySha256,preparedBodySha256:saved.preparedBodySha256,
 identity:{origin:saved.origin,ownerId:saved.ownerId,company:{code:saved.companyCode,name:saved.companyName},productId:saved.productId,appTabId:saved.appTabId,windowId:saved.windowId},
 validationRejection:{evidence:'document-validation-rejection',operationId:saved.requestId+':validate:2',step:2,validatedSteps:[],checkpointSequence:8,rejectedAt:now,submitted:false,consented:false}});
const nativeRejection=saved=>({format:'yoofam-product-document-receipt-v1',requestId:saved.requestId,productId:saved.productId,docId:'native-rejected',identity:{origin:saved.origin,ownerId:saved.ownerId,appTabId:saved.appTabId,windowId:saved.windowId},company:{code:saved.companyCode,name:saved.companyName},
 originalBodySha256:saved.originalBodySha256,preparedBodySha256:saved.preparedBodySha256,identityDigest:saved.identityDigest,
 receipt:{sourceStatus:'REJECTED',state:'rejected',docId:'native-rejected',evidence:'document-receipt',registered:false,identityDigest:saved.identityDigest,preparedBodySha256:saved.preparedBodySha256,observedAt:now,receiptId:'qvt-rejected',qvtRequestId:'qvt-rejected'}});
async function claimedValidation(h,r,uuid){const s=session(uuid);s.packetDigest=s.preview.packetDigest='e'.repeat(64);const saved=await h.api.claimProductDocumentPending(r,s,h.signal);return {s,saved,observation:validationObservation(saved,s),release:()=>h.api.clearValidationRejectedProductDocumentPending(r,saved,s,validationObservation(saved,s),h.signal,async()=>true)};}
function fixture(){
 const data=new Map(),writes=[],lockCalls=[];let tail=Promise.resolve(),onRead=()=>{},onSet=()=>{};
 const storage={getItem(key){onRead(key);return data.get(key)??null;},setItem(key,value){onSet(key,value);writes.push(key);data.set(key,value);},removeItem:key=>data.delete(key)};
 const locks={request(name,options,run){lockCalls.push(name);const request=tail.then(()=>{if(options.signal.aborted)throw Error('aborted');return run();});tail=request.catch(()=>{});return request;}};
 const window={location:{origin:'https://sourceflow.jjwwhhjj1116.workers.dev'},localStorage:storage,navigator:{locks}},exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/supplier-hub-product-pending.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,window,Error,Date});
 return{api:exports,data,writes,lockCalls,window,set onRead(fn){onRead=fn;},set onSet(fn){onSet=fn;},signal:new AbortController().signal};
}
test('small pending descriptor preserves exact operation without storing body, images, agreements or credentials',async()=>{
 const h=fixture(),r=review(),s=session(),saved=await h.api.claimProductDocumentPending(r,s,h.signal);assert.equal(saved.requestId,s.packet.requestId);assert.equal(saved.createdAt,now);
 assert.deepEqual(plain(h.api.readProductDocumentPending(r)),plain(saved));assert.equal(h.data.size,1);assert.equal(h.lockCalls.length,1);
 assert.ok([...h.data.values()][0].length<1500);assert.doesNotMatch([...h.data.values()][0],/jsonDocument|imageUrl|password|cookie|approvedKeys|authorization/u);
 assert.equal(h.api.productDocumentPendingCurrent(saved,r),true);
 assert.doesNotThrow(()=>h.api.assertProductDocumentPending(r,saved,{...s,packet:{...s.packet,createdAt:now+200000}}));
});
test('exclusive claim prevents deterministic cross-tab read/set interleaving and never overwrites the first UUID',async()=>{
 const h=fixture(),r=review(),first=session(),other=session('00000000-0000-4000-8000-000000000733');let next;
 h.onRead=()=>{if(!next){next=true;next=h.api.claimProductDocumentPending(r,other,h.signal);void next.catch(()=>{});}};
 const saved=await h.api.claimProductDocumentPending(r,first,h.signal);await assert.rejects(next,/이전 전송 기록/);
 assert.equal(h.api.readProductDocumentPending(r).requestId,saved.requestId);assert.equal(h.writes.length,1);assert.equal(h.lockCalls.length,2);assert.equal(h.lockCalls[0],h.lockCalls[1]);
});
test('storage getter/write/readback failures and missing Web Locks fail before authorizing any dispatch',async()=>{
 for(const kind of ['getter','write','readback','locks']){
  const h=fixture(),r=review();
  if(kind==='getter')Object.defineProperty(h.window,'localStorage',{get(){throw Error('blocked');}});
  if(kind==='write')h.onSet=()=>{throw Error('quota');};
  if(kind==='readback')h.onSet=()=>{h.onRead=()=>{throw Error('readback');};};
  if(kind==='locks')h.window.navigator={};
  await assert.rejects(h.api.claimProductDocumentPending(r,session(),h.signal));assert.equal(h.data.size,kind==='readback'?1:0,'an uncertain stored descriptor remains reserved');
 }
});
test('corrupt and unknown fields never disappear; account/company/product scopes cannot read each other',async()=>{
 const h=fixture(),r=review(),saved=await h.api.claimProductDocumentPending(r,session(),h.signal),key=h.api.productDocumentPendingKey(r);
 for(const raw of ['{broken',JSON.stringify({...saved,body:'forbidden'}),JSON.stringify({...saved,requestId:'not-uuid'}),JSON.stringify({...saved,appTabId:-1}),JSON.stringify({...saved,ownerId:'other'}),'x'.repeat(4097)]){
  h.data.set(key,raw);assert.throws(()=>h.api.readProductDocumentPending(r));assert.equal(h.data.get(key),raw);
 }
 h.data.set(key,JSON.stringify(saved));
 for(const identity of [{...r.identity,ownerId:'other'},{...r.identity,productId:'other'},{...r.identity,company:{code:'A01526306',name:'유앤채'}}])assert.equal(h.api.readProductDocumentPending({...r,identity}),null);
});
test('source/hash changes, different tab/window and concurrent descriptor replacement cannot resume the original operation',async()=>{
 const h=fixture(),r=review(),s=session(),saved=await h.api.claimProductDocumentPending(r,s,h.signal);
 for(const patch of [{reviewDigest:'e'.repeat(64)},{originalBodySha256:'e'.repeat(64)},{preparedBodySha256:'e'.repeat(64)}])assert.throws(()=>h.api.assertProductDocumentPending({...r,...patch},saved,s));
 for(const patch of [{appTabId:8},{windowId:8}])assert.throws(()=>h.api.assertProductDocumentPending(r,saved,{...s,preview:{...s.preview,identity:{...s.preview.identity,...patch}}}));
 h.data.set(h.api.productDocumentPendingKey(r),JSON.stringify({...saved,requestId:'00000000-0000-4000-8000-000000000733'}));assert.throws(()=>h.api.assertProductDocumentPending(r,saved,s));
});
test('only durable exact rejection permits compare-delete; pending/accepted/changed records stay reserved',async()=>{
 const h=fixture(),r=review(),s=session(),saved=await h.api.claimProductDocumentPending(r,s,h.signal);
 const rejected={format:'yoofam-product-document-receipt-v1',requestId:saved.requestId,productId:saved.productId,docId:'native-rejected',identity:{origin:saved.origin,ownerId:saved.ownerId,appTabId:saved.appTabId,windowId:saved.windowId},company:r.identity.company,
  originalBodySha256:saved.originalBodySha256,preparedBodySha256:saved.preparedBodySha256,identityDigest:saved.identityDigest,
  receipt:{sourceStatus:'REJECTED',state:'rejected',docId:'native-rejected',company:r.identity.company,evidence:'document-receipt',registered:false,identityDigest:saved.identityDigest,preparedBodySha256:saved.preparedBodySha256,observedAt:now,receiptId:'qvt-rejected',qvtRequestId:'qvt-rejected'}};
 for(const change of [record=>record.receipt={sourceStatus:'SUBMITTED',state:'pending'},record=>record.receipt={sourceStatus:'FINISHED',state:'accepted'},record=>record.requestId='different',record=>record.identity.ownerId='other',record=>record.preparedBodySha256='e'.repeat(64),
  record=>delete record.docId,record=>delete record.receipt.qvtRequestId,record=>delete record.receipt.observedAt,record=>record.receipt.observedAt=0,record=>record.receipt.receiptId='different',record=>record.identity.appTabId++]){
  const value=plain(rejected);change(value);await assert.rejects(h.api.clearRejectedProductDocumentPending(r,saved,value,h.signal));assert.ok(h.api.readProductDocumentPending(r));
 }
 assert.equal(await h.api.clearRejectedProductDocumentPending(r,saved,rejected,h.signal,()=>false),false);assert.ok(h.api.readProductDocumentPending(r),'a session that connected while history waited keeps its recovery descriptor');
 await h.api.clearRejectedProductDocumentPending(r,saved,rejected,h.signal);assert.equal(h.api.readProductDocumentPending(r),null);
 await assert.rejects(h.api.claimProductDocumentPending(r,session('00000000-0000-4000-8000-000000000734'),h.signal),/수정/);
 const next=await h.api.claimProductDocumentPending({...r,reviewDigest:'e'.repeat(64)},session('00000000-0000-4000-8000-000000000734'),h.signal);assert.notEqual(next.requestId,saved.requestId);
 await assert.rejects(h.api.clearRejectedProductDocumentPending(r,saved,rejected,h.signal));assert.equal(h.api.readProductDocumentPending(r).requestId,next.requestId);
});

test('validation rejection compare-delete requires recovered exact pre-submit evidence and preserves every uncertain or wrong-scope descriptor',async()=>{
 const h=fixture(),r=review(),s=session();s.packetDigest=s.preview.packetDigest='e'.repeat(64);
 const saved=await h.api.claimProductDocumentPending(r,s,h.signal),observation={format:'yoofam-supplier-hub-product-document-v1',state:'validation-rejected',requestId:saved.requestId,
  docId:'local-rejected-document',registered:false,success:false,needsRecovery:false,recovered:true,identityDigest:saved.identityDigest,packetDigest:s.packetDigest,
  originalBodySha256:saved.originalBodySha256,preparedBodySha256:saved.preparedBodySha256,
  identity:{origin:saved.origin,ownerId:saved.ownerId,company:r.identity.company,productId:saved.productId,appTabId:saved.appTabId,windowId:saved.windowId},
  validationRejection:{evidence:'document-validation-rejection',operationId:saved.requestId+':validate:2',step:2,validatedSteps:[],checkpointSequence:8,rejectedAt:now,submitted:false,consented:false}};
 const changes=[value=>delete value.validationRejection,value=>value.recovered=false,value=>value.needsRecovery=true,value=>value.error={code:'READ_FAILED',message:'failed'},value=>value.docId=null,
  value=>value.receipt={},value=>value.challenge={},value=>value.registered=true,value=>value.identity.ownerId='another',value=>value.identity.company={code:'A01526306',name:'유앤채'},
  value=>value.identity.productId='other',value=>value.identity.origin='https://foreign.example',value=>value.identity.appTabId++,value=>value.identity.windowId++,value=>value.identityDigest='f'.repeat(64),
  value=>value.originalBodySha256='f'.repeat(64),value=>value.preparedBodySha256='f'.repeat(64),value=>value.packetDigest='f'.repeat(64),value=>value.requestId='other',
  value=>value.validationRejection.operationId='wrong:validate:2',value=>value.validationRejection.step=3,value=>value.validationRejection.validatedSteps=[2],value=>value.validationRejection.checkpointSequence=0,
  value=>value.validationRejection.rejectedAt=now-1,value=>value.validationRejection.submitted=true,value=>value.validationRejection.consented=true,value=>value.validationRejection.extra=true];
 for(const change of changes){const value=plain(observation);change(value);await assert.rejects(h.api.clearValidationRejectedProductDocumentPending(r,saved,s,value,h.signal,async()=>true));assert.deepEqual(plain(h.api.readProductDocumentPending(r)),plain(saved));}
 assert.equal(await h.api.clearValidationRejectedProductDocumentPending(r,saved,s,observation,h.signal,async()=>false),false);assert.ok(h.api.readProductDocumentPending(r));
 await h.api.clearValidationRejectedProductDocumentPending(r,saved,s,observation,h.signal,async()=>true);assert.equal(h.api.readProductDocumentPending(r),null);
 await assert.rejects(h.api.claimProductDocumentPending(r,session('00000000-0000-4000-8000-000000000735'),h.signal),/수정/);
 const corrected={...r,reviewDigest:'f'.repeat(64)},next=await h.api.claimProductDocumentPending(corrected,session('00000000-0000-4000-8000-000000000735'),h.signal);
 await assert.rejects(h.api.clearValidationRejectedProductDocumentPending(r,saved,s,observation,h.signal,async()=>true));assert.equal(h.api.readProductDocumentPending(r).requestId,next.requestId);
});

test('a reservation replacement during the async locked validation freshness check cannot be deleted',async()=>{
 const h=fixture(),r=review(),s=session();s.packetDigest=s.preview.packetDigest='e'.repeat(64);const saved=await h.api.claimProductDocumentPending(r,s,h.signal);
 const observation={format:'yoofam-supplier-hub-product-document-v1',state:'validation-rejected',requestId:saved.requestId,docId:'rejected',registered:false,success:false,needsRecovery:false,recovered:true,
  identityDigest:saved.identityDigest,packetDigest:s.packetDigest,originalBodySha256:saved.originalBodySha256,preparedBodySha256:saved.preparedBodySha256,
  identity:{origin:saved.origin,ownerId:saved.ownerId,company:r.identity.company,productId:saved.productId,appTabId:saved.appTabId,windowId:saved.windowId},
  validationRejection:{evidence:'document-validation-rejection',operationId:saved.requestId+':validate:2',step:2,validatedSteps:[],checkpointSequence:8,rejectedAt:now,submitted:false,consented:false}};
 const next={...saved,requestId:'00000000-0000-4000-8000-000000000735'};
 await assert.rejects(h.api.clearValidationRejectedProductDocumentPending(r,saved,s,observation,h.signal,async()=>{h.data.set(h.api.productDocumentPendingKey(r),JSON.stringify(next));return true;}));
 assert.equal(h.api.readProductDocumentPending(r).requestId,next.requestId);
});

test('bounded rejection ledger retains A and B so restoring either review or changing only UUID/tab cannot claim again',async()=>{
 const h=fixture(),a=review(),b={...a,reviewDigest:'e'.repeat(64),originalBodySha256:'f'.repeat(64)},first=await claimedValidation(h,a);await first.release();
 const second=await claimedValidation(h,b,'00000000-0000-4000-8000-000000000736');await second.release();
 assert.equal(h.api.readProductDocumentRejections(a).length,2);assert.equal(h.api.readProductDocumentPending(a),null);
 for(const value of [a,b]){
  assert.throws(()=>h.api.assertProductDocumentNotRejected(value),/수정/);
  const other=session('00000000-0000-4000-8000-000000000737');other.preview.identity={appTabId:700,windowId:900};await assert.rejects(h.api.claimProductDocumentPending(value,other,h.signal),/수정/);
 }
 const raw=h.data.get(h.api.productDocumentRejectionKey(a));assert.ok(raw.length<4096);assert.doesNotMatch(raw,/jsonDocument|imageUrl|termsText|approvedKeys|password|cookie|authorization/u);
 const c={...a,reviewDigest:'f'.repeat(64)};assert.doesNotThrow(()=>h.api.assertProductDocumentNotRejected(c));await h.api.claimProductDocumentPending(c,session('00000000-0000-4000-8000-000000000738'),h.signal);
});

test('ledger write/readback failures preserve original pending and a durable-before-delete record permits exact release retry',async()=>{
 for(const mode of ['write','readback','removed','changed']){
  const h=fixture(),r=review(),attempt=await claimedValidation(h,r),key=h.api.productDocumentRejectionKey(r);
  h.onSet=(name,raw)=>{if(name!==key)return;if(mode==='write')throw Error('quota');if(mode==='readback')h.onRead=name=>{if(name===key)throw Error('readback failed');};
   if(mode==='removed')h.onRead=name=>{if(name===key)h.data.delete(key);};
   if(mode==='changed')h.onRead=name=>{if(name===key){const rows=JSON.parse(raw);rows[0].validationRejection.checkpointSequence++;h.data.set(key,JSON.stringify(rows));}};
  };
  await assert.rejects(attempt.release());assert.equal(h.api.readProductDocumentPending(r).requestId,attempt.saved.requestId,mode);
  h.onSet=()=>{};h.onRead=()=>{};assert.doesNotThrow(()=>h.api.assertProductDocumentPending(r,attempt.saved,attempt.s));
  if(mode==='changed'){await assert.rejects(attempt.release());assert.equal(h.api.readProductDocumentPending(r).requestId,attempt.saved.requestId);}
  else {await attempt.release();assert.equal(h.api.readProductDocumentPending(r),null);assert.equal(h.api.readProductDocumentRejections(r).length,1);}
 }
});

test('unknown/corrupt or wrong-scope rejection ledgers are never overwritten or used to authorize a new claim',async()=>{
 const h=fixture(),r=review(),attempt=await claimedValidation(h,r);await attempt.release();const key=h.api.productDocumentRejectionKey(r),good=JSON.parse(h.data.get(key));
 const corrupt=['{bad','[]',JSON.stringify([{...good[0],unknown:true}]),JSON.stringify([{...good[0],pending:{...good[0].pending,ownerId:'foreign'}}]),
  JSON.stringify([{...good[0],validationRejection:{...good[0].validationRejection,submitted:true}}]),JSON.stringify([good[0],good[0]]),'x'.repeat(65537)];
 for(const raw of corrupt){h.data.set(key,raw);assert.throws(()=>h.api.readProductDocumentRejections(r));await assert.rejects(h.api.claimProductDocumentPending({...r,reviewDigest:'e'.repeat(64)},session('00000000-0000-4000-8000-000000000739'),h.signal));assert.equal(h.data.get(key),raw);assert.equal(h.api.readProductDocumentPending(r),null);}
 h.data.set(key,JSON.stringify(good));for(const identity of [{...r.identity,ownerId:'foreign'},{...r.identity,productId:'foreign'},{...r.identity,company:{code:'A01526306',name:'유앤채'}}]){
  const other={...r,identity};assert.deepEqual(plain(h.api.readProductDocumentRejections(other)),[]);h.data.set(h.api.productDocumentRejectionKey(other),JSON.stringify(good));assert.throws(()=>h.api.readProductDocumentRejections(other));
 }
});

test('a full rejection ledger never evicts prior identities and retains the next rejected pending operation',async()=>{
 const h=fixture(),r=review();for(let index=0;index<32;index++){
  const value={...r,reviewDigest:index.toString(16).padStart(64,'0')},uuid='00000000-0000-4000-8000-'+String(index).padStart(12,'0'),attempt=await claimedValidation(h,value,uuid);await attempt.release();
 }
 const key=h.api.productDocumentRejectionKey(r),before=h.data.get(key),next={...r,reviewDigest:'f'.repeat(64)},attempt=await claimedValidation(h,next,'00000000-0000-4000-8000-000000000999');
 await assert.rejects(attempt.release());assert.equal(h.data.get(key),before);assert.equal(h.api.readProductDocumentRejections(r).length,32);assert.equal(h.api.readProductDocumentPending(r).requestId,attempt.saved.requestId);
});

test('a newer observation of the same native rejected document permits release retry after durable ledger and failed pending deletion',async()=>{
 const h=fixture(),r=review(),saved=await h.api.claimProductDocumentPending(r,session(),h.signal),record=nativeRejection(saved),remove=h.window.localStorage.removeItem;
 record.receipt.observedAt=now+2;
 h.window.localStorage.removeItem=()=>{throw Error('pending delete failed');};await assert.rejects(h.api.clearRejectedProductDocumentPending(r,saved,record,h.signal));
 const key=h.api.productDocumentRejectionKey(r),before=h.data.get(key);assert.equal(h.api.readProductDocumentPending(r).requestId,saved.requestId);h.window.localStorage.removeItem=remove;
 for(const change of [value=>{value.receipt.qvtRequestId=value.receipt.receiptId='changed-qvt';},value=>{value.docId=value.receipt.docId='changed-doc';},value=>value.receipt.observedAt=now+1]){
  const wrong=plain(record);change(wrong);await assert.rejects(h.api.clearRejectedProductDocumentPending(r,saved,wrong,h.signal));assert.equal(h.data.get(key),before);assert.ok(h.api.readProductDocumentPending(r));
 }
 const newer=plain(record);newer.receipt.observedAt=now+3;await h.api.clearRejectedProductDocumentPending(r,saved,newer,h.signal);
 assert.equal(h.api.readProductDocumentPending(r),null);assert.equal(h.data.get(key),before,'original compact rejection remains immutable');
});
