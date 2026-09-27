import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readSupplierHubRegistration} from '../extensions/supplier-hub/registration-result.mjs';
function run(rows,options={}){
 const headings=['상품명','상품 등록일','카테고리','바코드','원본 견적서','견적서 ID','SKU ID','상태','등록 진행 단계'];
 const table={getClientRects:()=>[{}],querySelectorAll:selector=>selector==='thead th'?headings.map(innerText=>({innerText:innerText+' ?'})):rows.map(values=>({getClientRects:()=>[{}],querySelectorAll:()=>values.map(value=>({innerText:typeof value==='string'?value:value.text,querySelectorAll:()=>typeof value==='string'?[]:(value.copies??[]).map(copy=>({getClientRects:()=>copy.hidden?[]:[{}],getAttribute:()=>copy.id}))}))}))};
 return vm.runInNewContext(`(${readSupplierHubRegistration.toString()})(id)`,{id:options.id??'123',document:{querySelectorAll:()=>options.ambiguous?[table,table]:[table]},location:{origin:'https://supplier.coupang.com',pathname:options.path??'/qvt/wims'}});
}
test('only exact quotation ID rows are returned; completed rows never imply all-option registration',()=>{
 const row=['상품','날짜','카테고리','barcode','file.xlsx','123','sku','상품 검수 완료','발주서 발행'];
 const result=run([row,[...row.slice(0,5),'1234',...row.slice(6)]]);
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].skuId,'sku');assert.equal(result.rows[0].status,'상품 검수 완료');assert.equal(result.registered,false);assert.equal(result.scope,'visible-page');
});

test('observed abbreviated IDs use the exact visible copy-button value, never prefix matching',()=>{
 const id='c4541e05-8d56-4c6a-a67b-4d93683123c9';
 const row=value=>['상품','날짜','카테고리','barcode','file.xlsx',value,'sku','상품 검수중','가격/정책'];
 const result=run([
  row({text:'c4541e05...',copies:[{id}]}),
  row({text:'c4541e05...',copies:[{id:'c4541e05-0000-0000-0000-000000000000'}]}),
  row('c4541e05...'),
 ],{id});
 assert.equal(result.rows.length,1);assert.equal(result.quotationId,id);assert.equal(result.registered,false);
});

test('ambiguous, hidden, contradictory or whitespace-padded copy IDs do not associate another quotation',()=>{
 const id='c4541e05-8d56-4c6a-a67b-4d93683123c9';
 const cells=[
  {text:'c4541e05...',copies:[{id},{id}]},
  {text:'c4541e05...',copies:[{id,hidden:true}]},
  {text:'other...',copies:[{id}]},
  {text:'c4541e05...',copies:[{id:` ${id}`}]},
 ];
 assert.equal(run(cells.map(cell=>['상품','날짜','카테고리','','',cell,'','상품 검수중','']),{id}).rows.length,0);
});
test('empty page stays empty; malformed identity, wrong page and ambiguous table fail',()=>{
 assert.equal(run([['데이터가 없습니다']]).rows.length,0);
 for(const options of [{id:''},{id:' 123'},{id:{}},{path:'/qvt/registration'},{ambiguous:true}])assert.throws(()=>run([],options));
});
