import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {managedProductHarness,managedFixture} from './helpers/managed-products.mjs';

const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}],plain=value=>JSON.parse(JSON.stringify(value));
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>typeof tree==='string'||typeof tree==='number'?String(tree):Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):'';
const native=createRequire(import.meta.url),fixtureUrl=new URL('./managed-products-panel.test.mjs',import.meta.url);
const uiSource=fs.readFileSync(fixtureUrl,'utf8'),ast=ts.createSourceFile('ui.mjs',uiSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),uiNode=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='ui');assert.ok(uiNode);
// Reuse the existing actual component harness without importing its test cases.
export const managedStatusUI=vm.runInNewContext('('+uiNode.getText(ast).replaceAll('import.meta.url','fixtureUrl')+')',
 {fs,vm,ts,native,fixtureUrl,assert,nodes,text,URL,URLSearchParams,FormData,AbortController,Error,queueMicrotask,setImmediate});
const field=(panel,label)=>{const found=nodes(panel.render()).find(node=>node.props?.['aria-label']===label);assert.ok(found,label);return found;};
const barcode=panel=>nodes(panel.render()).find(node=>node.type?.name==='ManagedProductBarcodePanel');
const sources=h=>JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products ORDER BY owner_id,company_code,sku_id').all());
const emptyRemote=h=>{for(const table of ['products','collection_jobs','supplier_hub_receipts'])assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);};
export async function managedStatusFixture(company=companies[0]){
 const h=managedProductHarness();Object.assign(h.state.user.membership,{companyCode:company.code,companyName:company.name});h.syncMember();
 const bytes=managedFixture(130,rows=>rows.forEach((row,index)=>{row['발주가능상태']=index===0?'':index<10?' 정상 ':index===10?'  ':index>=120?'보류%_':'정상';row['상품명']='상품 '+String(index).padStart(3,'0');row['판매가']=String(index);row['바코드']='00123'+index;}));
 const preview=await json(await h.submit(bytes,{companyCode:company.code}));await json(await h.submit(bytes,{companyCode:company.code,action:'import',sha256:preview.sha256}),201);
 // Foreign rows are fixture-only and must never contribute a status or count.
 h.sqlite.prepare('INSERT INTO managed_products SELECT ?,company_code,?,title,json_set(source_payload,\'$."발주가능상태"\',?),source_name,source_sha256,source_row,first_imported_at,imported_at FROM managed_products WHERE sku_id=?').run('different-owner','9000000001','외부 소유자 상태','1000000000');
 h.sqlite.prepare('INSERT INTO managed_products SELECT owner_id,?,?,title,json_set(source_payload,\'$."발주가능상태"\',?),source_name,source_sha256,source_row,first_imported_at,imported_at FROM managed_products WHERE owner_id=? AND company_code=? AND sku_id=?').run(company.code==='A01464742'?'A01526306':'A01464742','9000000002','다른 회사 상태',h.state.user.userId,company.code,'1000000000');
 return{h,company,bytes,before:sources(h),close(){h.close();}};
}

for(const company of companies)test(`exact order statuses aggregate the whole owned company before LIMIT and combine with search, other filters and export (${company.code})`,async()=>{
 const f=await managedStatusFixture(company),{h}=f;try{
  const all=await json(await h.fetcher('/api/managed-products?page=2&pageSize=10'));
  assert.equal(all.products.length,10);assert.equal(all.total,130);assert.deepEqual(all.summary.orderStatuses,[{value:'',count:1},{value:'  ',count:1},{value:' 정상 ',count:9},{value:'보류%_',count:10},{value:'정상',count:109}]);
  const params=new URLSearchParams({orderStatus:'보류%_',filter:'unavailable',search:'상품 12',sort:'판매가',direction:'descending',columnFilters:JSON.stringify([{column:'판매가',operator:'gte',value:'125'}])});
  const filtered=await json(await h.fetcher('/api/managed-products?'+params));assert.equal(filtered.total,5);assert.deepEqual(filtered.products.map(product=>product.values['판매가']),['129','128','127','126','125']);assert.deepEqual(filtered.summary.orderStatuses,all.summary.orderStatuses);
  params.set('expectedAccountContext',filtered.accountContext);const downloaded=await h.fetcher('/api/managed-products/export?'+params);assert.equal(downloaded.status,200,await downloaded.clone().text());
  const workbook=await h.load('app/managed-products.ts').parseManagedProductWorkbook(await downloaded.arrayBuffer(),company);assert.deepEqual(Array.from(workbook.rows,row=>row.values['판매가']),['129','128','127','126','125']);assert.ok(workbook.rows.every(row=>row.values['발주가능상태']==='보류%_'));assert.equal(workbook.rows[0].values['바코드'],'00123129');
  const blank=await json(await h.fetcher('/api/managed-products?orderStatus='));assert.equal(blank.total,1);assert.equal(blank.products[0].skuId,'1000000000');
  assert.equal((await json(await h.fetcher('/api/managed-products?orderStatus='+encodeURIComponent(' 정상 ')))).total,9);
  assert.equal((await json(await h.fetcher('/api/managed-products?orderStatus='+encodeURIComponent('  ')))).total,1);
  assert.equal((await json(await h.fetcher('/api/managed-products?orderStatus='+encodeURIComponent('없었던 정확한 상태')))).total,0);
  assert.equal(sources(h),f.before);emptyRemote(h);
 }finally{f.close();}
});

test('duplicate, oversized and NUL status queries are rejected and exact strings never become SQL or LIKE operators',async()=>{
 const f=await managedStatusFixture(),{h}=f;try{
  const initial=await json(await h.fetcher('/api/managed-products')),model=h.load('app/managed-products.ts');
  assert.equal(model.parseManagedOrderStatus(new URLSearchParams()),undefined);assert.equal(model.parseManagedOrderStatus(new URLSearchParams('orderStatus=')),'');assert.equal(model.validManagedOrderStatus('보류 😀'),true);assert.equal(model.validManagedOrderStatus('\ud800'),false);
  for(const suffix of ['orderStatus=정상&orderStatus=보류','orderStatus='+encodeURIComponent('x'.repeat(2001)),'orderStatus=%00']){
   await json(await h.fetcher('/api/managed-products?'+suffix),400);await json(await h.fetcher('/api/managed-products/export?expectedAccountContext='+initial.accountContext+'&'+suffix),400);
  }
  for(const value of ["' OR 1=1 --",'%','_'])assert.equal((await json(await h.fetcher('/api/managed-products?'+new URLSearchParams({orderStatus:value})))).total,0);
  assert.equal(sources(h),f.before);emptyRemote(h);
 }finally{f.close();}
});

test('status menus reject an incomplete over-limit list rather than silently truncating the original company states',async()=>{
 for(const mode of ['distinct','length']){const h=managedProductHarness();try{
  const bytes=managedFixture(mode==='distinct'?201:1,rows=>rows.forEach((row,index)=>row['발주가능상태']=mode==='distinct'?'합성 상태 '+index:'합성'.repeat(1001))),preview=await json(await h.submit(bytes));await json(await h.submit(bytes,{action:'import',sha256:preview.sha256}),201);const before=sources(h);
  const response=await json(await h.fetcher('/api/managed-products'),413);assert.match(response.error,/발주가능상태/);assert.equal(sources(h),before);emptyRemote(h);
 }finally{h.close();}}
});

for(const company of companies)test(`actual registered-products UI chooses a full-company state, resets page, composes sorting and downloads the exact rows (${company.code})`,async()=>{
 const f=await managedStatusFixture(company),panel=managedStatusUI(f.h.fetcher);try{
  await panel.settle();panel.button('다음').props.onClick();await panel.settle();assert.match(text(panel.render()),/2 \/ 13/);
  field(panel,'발주가능상태 필터').props.onClick();assert.ok(nodes(panel.render()).find(node=>node.props?.['aria-label']==='발주가능상태 선택'));assert.ok(panel.button('「보류%_」 10개'));assert.ok(panel.button('(공란) 1개'));assert.ok(panel.button('「정상」 109개'));assert.ok(panel.button('「 정상 」 9개'));assert.ok(panel.button('(공백 2자) 1개'));assert.ok(!text(panel.render()).includes('외부 소유자 상태'));assert.ok(!text(panel.render()).includes('다른 회사 상태'));
  const spaced=nodes(panel.button('「 정상 」 9개')).find(node=>node.props?.className==='managed-order-status-value');assert.equal(text(spaced),'「 정상 」');assert.equal(spaced.props.title,'" 정상 "');
  panel.button('「보류%_」 10개').props.onClick();await panel.settle();const latest=new URL(f.h.state.calls.filter(call=>call.url.startsWith('/api/managed-products?')).at(-1).url,'https://app.test');assert.equal(latest.searchParams.get('page'),'1');assert.equal(latest.searchParams.get('orderStatus'),'보류%_');assert.equal(nodes(panel.render()).filter(node=>node.type==='tr'&&node.props['data-sku-id']).length,10);
  field(panel,'판매가 정렬').props.onClick();await panel.settle();field(panel,'판매가 정렬').props.onClick();await panel.settle();panel.button('상품DB 다운로드').props.onClick();await panel.settle();assert.equal(panel.downloads.length,1);
  const exported=await f.h.load('app/managed-products.ts').parseManagedProductWorkbook(await panel.downloads[0].blob.arrayBuffer(),company);assert.equal(exported.rows.length,10);assert.equal(exported.rows[0].values['판매가'],'129');assert.ok(exported.rows.every(row=>row.values['발주가능상태']==='보류%_'));
  field(panel,'발주가능상태 필터').props.onClick();panel.button('「 정상 」 9개').props.onClick();await panel.settle();assert.equal(new URL(f.h.state.calls.filter(call=>call.url.startsWith('/api/managed-products?')).at(-1).url,'https://app.test').searchParams.get('orderStatus'),' 정상 ');assert.equal(text(field(panel,'발주가능상태 필터')),'발주가능상태 · 「 정상 」');assert.match(text(panel.render()),/전체 결과 9개/);
  field(panel,'발주가능상태 필터').props.onClick();panel.button('(공백 2자) 1개').props.onClick();await panel.settle();assert.equal(new URL(f.h.state.calls.filter(call=>call.url.startsWith('/api/managed-products?')).at(-1).url,'https://app.test').searchParams.get('orderStatus'),'  ');assert.equal(text(field(panel,'발주가능상태 필터')),'발주가능상태 · (공백 2자)');assert.match(text(panel.render()),/전체 결과 1개/);
  field(panel,'발주가능상태 필터').props.onClick();panel.button('(공란) 1개').props.onClick();await panel.settle();assert.match(text(panel.render()),/전체 결과 1개/);panel.button('발주가능상태 필터 해제').props.onClick();await panel.settle();assert.match(text(panel.render()),/전체 결과 130개/);
  assert.equal(sources(f.h),f.before);emptyRemote(f.h);
 }finally{panel.close();f.close();}
});

test('barcode buttons pass the exact owned row context and fresh reads or late close callbacks cannot retain or close a different popup',async()=>{
 const f=await managedStatusFixture(),panel=managedStatusUI(f.h.fetcher);try{
  await panel.settle();field(panel,'SKU 1000000000 바코드출력').props.onClick();const first=barcode(panel);assert.ok(first);assert.equal(first.props.skuId,'1000000000');assert.deepEqual(plain(first.props.company),f.company);assert.match(first.props.accountContext,/^[a-f0-9]{64}$/);const oldClose=first.props.onClose;oldClose();assert.equal(barcode(panel),undefined);
  field(panel,'SKU 1000000001 바코드출력').props.onClick();assert.equal(barcode(panel).props.skuId,'1000000001');oldClose();assert.equal(barcode(panel).props.skuId,'1000000001');
  const retained=field(panel,'SKU 1000000000 바코드출력').props.onClick;panel.button('목록 새로고침').props.onClick();retained();assert.equal(barcode(panel),undefined);await panel.settle();assert.equal(barcode(panel),undefined);
  field(panel,'SKU 1000000000 구매정보').props.onClick();retained();assert.equal(barcode(panel),undefined,'barcode does not discard a pending purchase editor');assert.ok(nodes(panel.render()).find(node=>node.type?.name==='ManagedPurchaseInfoPanel'));
  assert.equal(sources(f.h),f.before);emptyRemote(f.h);
 }finally{panel.close();f.close();}
});

test('an account switch resets a selected original status and closes the prior barcode dialog without publishing another owner state',async()=>{
 const f=await managedStatusFixture(),panel=managedStatusUI(f.h.fetcher);try{
  await panel.settle();field(panel,'발주가능상태 필터').props.onClick();panel.button('「보류%_」 10개').props.onClick();await panel.settle();field(panel,'SKU 1000000120 바코드출력').props.onClick();assert.ok(barcode(panel));
  const old=f.h.state.user;f.h.state.user={...old,userId:'next-status-owner',membership:{...old.membership,id:'next-status-owner'}};f.h.syncMember();panel.button('목록 새로고침').props.onClick();await panel.settle();assert.equal(barcode(panel),undefined);assert.match(text(panel.render()),/전체 결과 0개/);assert.equal(field(panel,'발주가능상태 필터').props.children[1],'');
  const newest=new URL(f.h.state.calls.filter(call=>call.url.startsWith('/api/managed-products?')).at(-1).url,'https://app.test');assert.equal(newest.searchParams.has('orderStatus'),false);assert.equal(newest.searchParams.get('page'),'1');assert.equal(sources(f.h),f.before);emptyRemote(f.h);
 }finally{panel.close();f.close();}
});
