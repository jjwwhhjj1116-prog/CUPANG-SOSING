import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readSupplierHubRegistration} from '../extensions/supplier-hub/registration-result.mjs';
import {querySupplierHubCompanyRegistrations} from '../extensions/supplier-hub/company-registration-page.mjs';
import {company,query,headers,nativeMarkup,qvtHarness} from './helpers/qvt-native-pagination.mjs';
const id='12345678-1234-1234-1234-123456789012',estimation='1234567';
// The current QVT cell structure is retained, with all business values replaced.
const cell=fs.readFileSync(new URL('./fixtures/hub-qvt-quotation-cell-20261019.html',import.meta.url),'utf8').trim();
const page=(quotation=cell,index=1,end=1,sku='<td>synthetic-sku</td>')=>({
 table:`<table><thead><tr>${headers.map(value=>`<th>${value}</th>`).join('')}</tr></thead><tbody><tr><td>합성 상품 ${index}</td><td><div>2026/10/19</div><div>10:00:00</div></td><td>합성 분류 (991742)</td><td>-</td><td>-</td>${quotation}${sku}<td>상품 검수중</td><td>가격/정책</td></tr></tbody></table>`,pager:nativeMarkup(index,end)});

for(const account of [company,{code:'A01464742',name:'와이홉'}])test(`${account.code}: the exact rendered primary UUID plus parenthesized estimation ID remains one quotation identity`,async()=>{
 const h=qvtHarness({quotation:id,company:account,capturedPages:[page()],total:1}),single=h.run(readSupplierHubRegistration,id,{company:account});
 assert.equal(single.rows.length,1);assert.equal(single.registered,false);assert.equal(single.page.current,1);assert.equal(single.page.hasNext,false);
 assert.equal(h.run(readSupplierHubRegistration,estimation).rows.length,0);
 const c=qvtHarness({mode:'company',company:account,capturedPages:[page()],total:1}),all=await c.settle(c.run(querySupplierHubCompanyRegistrations,query,account));
 assert.equal(all.rows.length,1);assert.equal(all.rows[0].quotationId,id);assert.equal(all.rows[0].skuId,'synthetic-sku');assert.equal(all.mutated,false);assert.equal(c.timers.size,0);
});

test('recorded-shaped quotation cells remain UUID-bound throughout all six fresh native pages',async()=>{
 const pages=Array.from({length:6},(_,i)=>page(cell,i+1,6,`<td>synthetic-sku-${i+1}</td>`));
 const h=qvtHarness({mode:'company',capturedPages:pages,total:6}),value=await h.settle(h.run(querySupplierHubCompanyRegistrations,query,company));
 assert.equal(value.pagesRead,6);assert.equal(value.rows.length,6);assert.ok(value.rows.every(row=>row.quotationId===id));assert.deepEqual(h.actions.filter(action=>action.kind==='page').map(action=>action.target),[2,3,4,5,6]);assert.equal(h.timers.size,0);
});

test('duplicate, misplaced or contradictory copy IDs fail without selecting a first button or matching a legacy alias',async()=>{
 const invalid=[
  cell.replace(estimation+'"',id+'"'),
  cell.replaceAll(estimation,'legacy'),
  cell.replace('<div>1234567</div>','<div>7654321</div>'),
  cell.replace('(<span','<span').replace('</span>)','</span>'),
  cell.replace('<div>12345678...</div>','<div>other...</div>'),
  cell.replace('text-success','other'),
  cell.replace('<span class="wims-list__clip">','<div class="wims-list__clip">').replace('</button></span>','</button></div>'),
  cell.replace('</td>','extra</td>'),
  cell.replace('</td>',`<button data-clipboard-text="${id}">${id}</button></td>`),
  cell.replace(`data-clipboard-text="${id}"`,`data-clipboard-text=" ${id}"`),
  cell.replace('12345678...','12345678... ('+estimation+')'),
 ];
 for(const quotation of invalid){
  const h=qvtHarness({quotation:id,capturedPages:[page(quotation)],total:1});assert.equal(h.run(readSupplierHubRegistration,id,{company}).rows.length,0);
  const c=qvtHarness({mode:'company',capturedPages:[page(quotation)],total:1});await assert.rejects(c.settle(c.run(querySupplierHubCompanyRegistrations,query,company)),/견적서 UUID/);assert.equal(c.timers.size,0);assert.equal(c.moves,0);
 }
});

test('the narrow quotation-cell exception never permits multiple SKU copy controls',async()=>{
 const sku='<td><button data-clipboard-text="sku-1">sku-1</button><button data-clipboard-text="sku-2">sku-2</button></td>';
 const h=qvtHarness({quotation:id,capturedPages:[page(cell,1,1,sku)],total:1});assert.throws(()=>h.run(readSupplierHubRegistration,id,{company}),/SKU ID/);
 const c=qvtHarness({mode:'company',capturedPages:[page(cell,1,1,sku)],total:1});await assert.rejects(c.settle(c.run(querySupplierHubCompanyRegistrations,query,company)),/중복/);assert.equal(c.timers.size,0);
});
