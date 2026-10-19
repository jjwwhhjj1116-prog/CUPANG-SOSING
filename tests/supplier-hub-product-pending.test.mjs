import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const plain=value=>JSON.parse(JSON.stringify(value)),now=Date.now();
const review=()=>({identity:{ownerId:'owner',productId:'product',company:{code:'A01464742',name:'와이홉'}},reviewDigest:'a'.repeat(64),originalBodySha256:'b'.repeat(64),preparedBodySha256:'c'.repeat(64)});
const session=(requestId='00000000-0000-4000-8000-000000000732')=>({packet:{requestId,createdAt:now},preview:{identityDigest:'d'.repeat(64),identity:{appTabId:7,windowId:9}}});
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
 const rejected={format:'yoofam-product-document-receipt-v1',requestId:saved.requestId,productId:saved.productId,identity:{ownerId:saved.ownerId},company:r.identity.company,
  originalBodySha256:saved.originalBodySha256,preparedBodySha256:saved.preparedBodySha256,identityDigest:saved.identityDigest,receipt:{sourceStatus:'REJECTED',state:'rejected'}};
 for(const change of [record=>record.receipt={sourceStatus:'SUBMITTED',state:'pending'},record=>record.receipt={sourceStatus:'FINISHED',state:'accepted'},record=>record.requestId='different',record=>record.identity.ownerId='other',record=>record.preparedBodySha256='e'.repeat(64)]){
  const value=plain(rejected);change(value);await assert.rejects(h.api.clearRejectedProductDocumentPending(r,saved,value,h.signal));assert.ok(h.api.readProductDocumentPending(r));
 }
 assert.equal(await h.api.clearRejectedProductDocumentPending(r,saved,rejected,h.signal,()=>false),false);assert.ok(h.api.readProductDocumentPending(r),'a session that connected while history waited keeps its recovery descriptor');
 await h.api.clearRejectedProductDocumentPending(r,saved,rejected,h.signal);assert.equal(h.api.readProductDocumentPending(r),null);
 const next=await h.api.claimProductDocumentPending(r,session('00000000-0000-4000-8000-000000000734'),h.signal);assert.notEqual(next.requestId,saved.requestId);
 await assert.rejects(h.api.clearRejectedProductDocumentPending(r,saved,rejected,h.signal));assert.equal(h.api.readProductDocumentPending(r).requestId,next.requestId);
});
