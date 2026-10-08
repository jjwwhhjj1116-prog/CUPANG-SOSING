import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {validateProductTransferRecords,productTransferHistoryBlocked,assertProductNotTransmitted,readOwnedProductTransferHistory} from '../extensions/supplier-hub/product-history.mjs';
const origin='http://localhost:3000',productId='product',identity={origin,productId,categoryId:'80719',fingerprint:'b'.repeat(64)},binding={appTabId:7,windowId:17};
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}],plain=value=>JSON.parse(JSON.stringify(value));
const ui={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/supplier-hub-local-history.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:ui,TextEncoder,Date});
function record(kind,patch={}){const value={origin,productId,categoryId:'69900',fingerprint:'a'.repeat(64),company:companies[0],includedOptions:6,filename:`YOOFAM-${'a'.repeat(64)}.xlsx`,registered:false,state:kind==='result'?'validation-pending':'unconfirmed',observedAt:Date.now(),startedAt:Date.now()-10000,...patch};return {key:`${kind}:${origin}:${productId}:${value.categoryId}:${value.fingerprint}`,value};}
function serverReceipt(patch={}){const value=record('result',patch).value;return {schemaVersion:1,evidence:'chrome-observation',profileId:'original-profile',categoryId:value.categoryId,fingerprint:value.fingerprint,productVersion:'2026-10-01T00:00:00.000Z',recordedAt:'2026-10-01T00:00:01.000Z',result:value};}
function api(history){const calls=[];return {calls,tabs:{get:async()=>({id:7,windowId:17,url:origin+'/'}),sendMessage:async(id,message,frame)=>{calls.push({id,message,frame});assert.equal(message.type,'YOOFAM_READ_PRODUCT_TRANSMISSION_HISTORY');return {ok:true,...message.expected,checkedAt:Date.now(),history};}}};}
for(const company of companies)test(`all old fingerprints block pending, accepted and uncertain work, but a verified file-only rejection permits correction (${company.code})`,async()=>{
 for(const rows of [[record('transmission',{company,state:'started'})],[record('transmission',{company,state:'partial'})],[record('transmission',{company,state:'unconfirmed'})],[record('result',{company})],[record('result',{company,state:'validation-complete',quotationId:'original-full-id'})],[record('result',{company,state:'validation-rejected',quotationId:'assigned-id'})],[record('result',{company,state:'validation-rejected',registration:{rows:[]}})]]){
  const before=JSON.stringify(rows);assert.equal(productTransferHistoryBlocked(origin,productId,rows),true);assert.equal(ui.validateSupplierHubLocalHistory(rows,origin,productId).blocked,true);assert.equal(JSON.stringify(rows),before);
  const empty={schemaVersion:1,productId,blocked:false,receipts:[]},bridge=api(empty);
  await assert.rejects(assertProductNotTransmitted(identity,binding,bridge,async()=>rows),error=>error.code==='SUPPLIER_HUB_ALREADY_SUBMITTED');assert.deepEqual(bridge.calls.map(call=>call.message.type),['YOOFAM_READ_PRODUCT_TRANSMISSION_HISTORY']);
 }
 const rows=[record('transmission',{company}),record('result',{company,state:'validation-rejected',quotationId:''})];assert.equal(productTransferHistoryBlocked(origin,productId,rows),false);assert.equal(ui.validateSupplierHubLocalHistory(rows,origin,productId).blocked,false);
 const rejected=serverReceipt({company,state:'validation-rejected'}),bridge=api({schemaVersion:1,productId,blocked:false,receipts:[rejected]});await assertProductNotTransmitted(identity,binding,bridge,async()=>rows);
 for(const patch of [{company:{code:company.code,name:'틀린 회사'}},{includedOptions:0},{filename:'wrong.xlsx'},{observedAt:0}]){const malformed=[record('result',{company,state:'validation-rejected',...patch})];assert.equal(productTransferHistoryBlocked(origin,productId,malformed),true);assert.equal(ui.validateSupplierHubLocalHistory(malformed,origin,productId).blocked,true);}
});
test('incomplete, malformed, duplicate and inconsistent server history never authorize a new upload',async()=>{
 const good=serverReceipt({state:'validation-rejected'}),history={schemaVersion:1,productId,blocked:false,receipts:[good]};
 for(const value of [undefined,{...history,schemaVersion:2},{...history,productId:'other'},{...history,blocked:true},{...history,receipts:[good,good]},
  {...history,receipts:[{...good,productVersion:'invalid'}]},{...history,receipts:[{...good,recordedAt:'invalid'}]},{...history,receipts:[{...good,result:{...good.result,company:{code:'A01464742',name:'유앤채'}}}]},
  {...history,receipts:[{...good,result:{...good.result,includedOptions:0}}]},{...history,receipts:[{...good,result:{...good.result,state:'validation-pending'}}]}])await assert.rejects(assertProductNotTransmitted(identity,binding,api(value),async()=>[]));
 for(const rows of [[{...record('transmission'),key:'result:foreign'}],[record('transmission',{productId:'other'})],Array.from({length:201},()=>record('transmission'))]){
  assert.throws(()=>validateProductTransferRecords(origin,productId,rows));assert.throws(()=>ui.validateSupplierHubLocalHistory(rows,origin,productId));
 }
});
test('actual IndexedDB history scans only this app and product and leaves original records untouched',async()=>{
 const rows=new Map(),writes=[];const own=[record('transmission'),record('result')];for(const row of own)rows.set(row.key,row.value);
 rows.set('attempt:123',{working:'unchanged'});rows.set('package',{original:'bytes'});rows.set('result:'+origin+':other:69900:'+'a'.repeat(64),{other:'unchanged'});rows.set('result:http://127.0.0.1:3000:'+productId+':69900:'+'a'.repeat(64),{otherOrigin:'unchanged'});
 const before=plain([...rows]);let transactions=0,closed=0;
 const db={close(){closed++;},transaction(_table,mode){transactions++;assert.equal(mode,'readonly');const entries=[...rows];let index=0;const tx={abort(){tx.onabort?.();},objectStore:()=>({openCursor(){const request={};const advance=()=>queueMicrotask(()=>{const row=entries[index++];request.result=row?{key:row[0],value:structuredClone(row[1]),continue:advance}:null;request.onsuccess?.();if(!row)tx.oncomplete?.();});advance();return request;},put(){writes.push('put');assert.fail('history may not write');}})};return tx;}};
 const indexedDB={open(){const request={};queueMicrotask(()=>{request.result=db;request.onsuccess?.();});return request;}},ctx=vm.createContext({indexedDB,URL,Date,TextEncoder});
 vm.runInContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-store.mjs',import.meta.url),'utf8').replace(/export (const|async function|function) /g,'$1 '),ctx);
 assert.deepEqual(plain(await ctx.transferRecord('history',`history:${origin}:${productId}`)),own);assert.equal(transactions,1);assert.equal(closed,1);assert.deepEqual(plain([...rows]),before);assert.deepEqual(writes,[]);
 await assert.rejects(ctx.transferRecord('history','history:https://foreign.test:product'));assert.equal(transactions,1);
});
test('actual content history command is an owner-scoped read and rejects an understated block flag',async()=>{
 const listeners=[],calls=[];let current={schemaVersion:1,productId,blocked:true,receipts:[serverReceipt()]};
 const ctx={location:{origin},window:{addEventListener(){},postMessage(){}},chrome:{runtime:{id:'extension',onMessage:{addListener:listener=>listeners.push(listener)}}},URL,Date,AbortController,setTimeout,clearTimeout,fetch:async(path,init)=>{calls.push({path,init});const response=Response.json({history:current});Object.defineProperty(response,'url',{value:origin+path});return response;}};
 vm.runInNewContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8'),ctx);
 const command={type:'YOOFAM_READ_PRODUCT_TRANSMISSION_HISTORY',expected:{origin,productId}},run=()=>new Promise(resolve=>assert.equal(listeners[0](command,{id:'extension'},resolve),true));
 assert.equal(listeners[0](command,{id:'foreign'},()=>assert.fail('foreign access')),undefined);assert.equal(calls.length,0);
 const reply=await run();assert.equal(reply.ok,true);assert.equal(reply.history.blocked,true);assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/products/product/supplier-hub-receipt?mode=history');assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.credentials,'same-origin');
 current={...current,blocked:false};assert.equal((await run()).ok,false);assert.ok(calls.every(call=>call.init.method==='GET'));
});
test('local HISTORY reveals no records until current owner/product and approved company are reverified',async()=>{
 for(const mode of ['okay','owner-denied','owner-switched','company-switched','foreign-local','ownership-lost']){
  let contexts=0,serverReads=0,localReads=0;const bridge={tabs:{get:async()=>({id:7,windowId:17,url:origin+'/'}),sendMessage:async(_id,message)=>{
   if(message.type==='YOOFAM_READ_CATALOG_CONTEXT'){contexts++;return {ok:true,ownerId:mode==='owner-switched'&&contexts===2?'new-owner':'owner',company:mode==='company-switched'&&contexts===2?companies[1]:companies[0]};}
   assert.equal(message.type,'YOOFAM_READ_PRODUCT_TRANSMISSION_HISTORY');serverReads++;if(mode==='owner-denied'||mode==='ownership-lost'&&serverReads===2)return {ok:false,error:'owner product missing'};
   return {ok:true,...message.expected,checkedAt:Date.now(),history:{schemaVersion:1,productId,blocked:false,receipts:[]}};
  }}},read=async()=>{localReads++;return [record('transmission',{company:mode==='foreign-local'?companies[1]:companies[0]})];};
  if(mode==='okay'){assert.equal((await readOwnedProductTransferHistory(identity,binding,bridge,read)).length,1);assert.equal(serverReads,2);assert.equal(contexts,2);}
  else await assert.rejects(readOwnedProductTransferHistory(identity,binding,bridge,read));
  assert.equal(localReads,mode==='owner-denied'?0:1);
 }
});
