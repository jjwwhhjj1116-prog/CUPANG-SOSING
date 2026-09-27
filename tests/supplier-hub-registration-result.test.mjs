import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readSupplierHubRegistration} from '../extensions/supplier-hub/registration-result.mjs';
function run(rows,options={}){
 const headings=['상품명','상품 등록일','카테고리','바코드','원본 견적서','견적서 ID','SKU ID','상태','등록 진행 단계'];
 const table={getClientRects:()=>[{}],querySelectorAll:selector=>selector==='thead th'?headings.map(innerText=>({innerText:innerText+' ?'})):rows.map(values=>({getClientRects:()=>[{}],querySelectorAll:()=>values.map(innerText=>({innerText}))}))};
 return vm.runInNewContext(`(${readSupplierHubRegistration.toString()})(id)`,{id:options.id??'123',document:{querySelectorAll:()=>options.ambiguous?[table,table]:[table]},location:{origin:'https://supplier.coupang.com',pathname:options.path??'/qvt/wims'}});
}
test('only exact quotation ID rows are returned; completed rows never imply all-option registration',()=>{
 const row=['상품','날짜','카테고리','barcode','file.xlsx','123','sku','상품 검수 완료','발주서 발행'];
 const result=run([row,[...row.slice(0,5),'1234',...row.slice(6)]]);
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].skuId,'sku');assert.equal(result.rows[0].status,'상품 검수 완료');assert.equal(result.registered,false);assert.equal(result.scope,'visible-page');
});
test('empty page stays empty; malformed identity, wrong page and ambiguous table fail',()=>{
 assert.equal(run([['데이터가 없습니다']]).rows.length,0);
 for(const options of [{id:''},{id:' 123'},{id:{}},{path:'/qvt/registration'},{ambiguous:true}])assert.throws(()=>run([],options));
});
