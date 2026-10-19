import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {normalizeRejectionDetails,isRejectionDetails,receiptRejectionDetailsValid} from '../extensions/supplier-hub/rejection-details.mjs';
import {SupplierHubRejectionDetails} from './helpers/rejection-details-ui.mjs';
const pair={columnName:'단품 포장 무게',message:'양수를 입력해주세요.\n단위: g'},remark=errors=>JSON.stringify({errors});
const details=()=>normalizeRejectionDetails(remark([pair]));
test('native remark selects only columnName/message, preserves order and exact text, removes exact duplicate pairs',()=>{
 const value=normalizeRejectionDetails(remark([{...pair,internal:'discard'},pair,{columnName:' a|b ',message:'c'},{columnName:' a',message:'b |c'}]));
 assert.equal(value.status,'available');assert.deepEqual(value.errors,[pair,{columnName:' a|b ',message:'c'},{columnName:' a',message:'b |c'}]);
 assert.ok(isRejectionDetails(value));assert.ok(Object.isFrozen(value)&&Object.isFrozen(value.errors)&&Object.isFrozen(value.errors[0]));
});
test('bad or absent native remark retains unavailable diagnostics without manufacturing receipt success',()=>{
 for(const input of [undefined,null,{},[],0,'', '{',JSON.stringify(null),JSON.stringify({errors:[]}),remark([null]),remark([{...pair,message:''}]),remark([{...pair,columnName:'x'.repeat(201)}]),remark([{...pair,message:'x'.repeat(2001)}]),remark([{...pair,message:'\u0000'}]),'x'.repeat(262145),remark(Array(33).fill(pair)),remark(Array.from({length:32},(_,i)=>({columnName:String(i),message:'가'.repeat(1000)})))]){
  const value=normalizeRejectionDetails(input);assert.equal(value.status,'unavailable');assert.deepEqual(value.errors,[]);assert.ok(isRejectionDetails(value));
 }
});
test('strict optional diagnostics permit legacy receipts and only native REJECTED/state rejected',()=>{
 assert.ok(receiptRejectionDetailsValid({sourceStatus:'REJECTED',state:'rejected'}));
 for(const status of ['SUBMITTED','FINISHED',undefined])assert.equal(receiptRejectionDetailsValid({sourceStatus:status,state:'rejected',rejectionDetails:details()}),false);
 assert.ok(receiptRejectionDetailsValid({sourceStatus:'REJECTED',state:'rejected',rejectionDetails:details()}));
 assert.equal(receiptRejectionDetailsValid({sourceStatus:'REJECTED',state:'pending',rejectionDetails:details()}),false);
 assert.equal(receiptRejectionDetailsValid({sourceStatus:'REJECTED',state:'rejected',rejectionDetails:undefined}),false);
});
test('wire diagnostics reject unknown keys, missing fields, empty available rows, duplicates, holes, symbols and accessors without invocation',()=>{
 for(const change of [d=>d.foreign=true,d=>delete d.format,d=>d.status='unavailable',d=>d.errors=[],d=>d.errors.push({...pair}),d=>delete d.errors[0],d=>d.errors.foreign=true,d=>d.errors[0].secret=true,d=>d.errors[Symbol('x')]=1,d=>d.errors[0].message='x'.repeat(2001)]){
  const value=structuredClone(details());change(value);assert.equal(isRejectionDetails(value),false);
 }
 let touched=0;for(const target of ['root','array','row']){const d=structuredClone(details());Object.defineProperty(target==='root'?d:target==='array'?d.errors:d.errors[0],target==='root'?'status':target==='array'?'0':'message',{get(){touched++;throw Error('must not read');},enumerable:true});assert.equal(isRejectionDetails(d),false);}assert.equal(touched,0);
 const foreign=vm.runInNewContext('('+JSON.stringify(details())+')');assert.ok(isRejectionDetails(foreign));
});
test('actual React component escapes native text and exposes field/reason table; legacy/unavailable diagnostics retain fallback',()=>{
 const value=normalizeRejectionDetails(remark([{columnName:'<img src=x>',message:'<script>alert(1)</script> & 이유'}]));
 const html=renderToStaticMarkup(createElement(SupplierHubRejectionDetails,{details:value}));
 assert.match(html,/<caption>Supplier Hub 반려 상세<\/caption>/);assert.match(html,/scope="col">항목/);assert.match(html,/반려 사유/);
 assert.match(html,/&lt;img src=x&gt;/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script|<img|dangerouslySetInnerHTML/);
 for(const input of [undefined,normalizeRejectionDetails(null),{...value,foreign:true}])assert.match(renderToStaticMarkup(createElement(SupplierHubRejectionDetails,{details:input})),/반려 상세는 Supplier Hub에서 확인해주세요/);
});
