import test from 'node:test';
import assert from 'node:assert/strict';
import {managedProductHarness,managedFixture} from './helpers/managed-products.mjs';
import {importPriceFixture,postImportPrices} from './helpers/managed-import-prices.mjs';

const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}],now=Date.parse('2026-10-13T05:30:00Z');
const threshold=new Date(now);threshold.setDate(threshold.getDate()-7);const cutoff=+threshold;
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const raw=h=>JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products ORDER BY owner_id,company_code,sku_id').all());
const priceRows=h=>JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_import_prices ORDER BY sku_id,import_date').all());
const sku=index=>String(1000000000+index);
function prepare(h,company){Object.assign(h.state.user.membership,{companyCode:company.code,companyName:company.name});h.syncMember();h.load('app/managed-product-history.ts').managedHistoryCutoff=()=>cutoff;}
async function importFile(h,company,bytes){const before=await json(await h.submit(bytes,{companyCode:company.code}));return json(await h.submit(bytes,{companyCode:company.code,action:'import',sha256:before.sha256,accountContext:before.accountContext}),201);}
const list=(h,params={})=>h.fetcher('/api/managed-products?'+new URLSearchParams(params));
const exportFile=(h,context,params={})=>h.fetcher('/api/managed-products/export?'+new URLSearchParams({expectedAccountContext:context,...params}));

test('rolling seven-day predicate accepts native dates independently of previous-value tooltip evidence',()=>{
 const h=managedProductHarness();try{const m=h.load('app/managed-product-history.ts'),expect=new Date(now);expect.setDate(expect.getDate()-7);assert.equal(m.managedHistoryCutoff(now),cutoff);
 for(const [date,recent] of [[cutoff,true],[cutoff-1,false],[new Date(cutoff).toISOString(),true],['Tue, 06 Oct 2026 05:30:00 GMT',true],['2026-10-06T14:30:00+09:00',true],['2026-10-06',false],['2030-01-01',true],['not-a-date',false]]){
  const source={productIdHistory:JSON.stringify([{date}]),priceHistory:JSON.stringify([{date,price:0}]),'노출ID':'','productId':'43210','공급가':'0'},saved=JSON.stringify(source),normalized=m.normalizeManagedProductHistory(source),view=m.managedProductHistoryView(normalized,cutoff);
  assert.equal(view.productId.changedRecently,recent,String(date));assert.equal(view.price.changedRecently,recent);assert.equal(view.productId.current,'43210');assert.equal(view.price.current,'0');if(normalized.productId.latest)assert.equal(normalized.productId.latest.previous,null);if(normalized.price.latest)assert.equal(normalized.price.latest.previous,'0');assert.equal(JSON.stringify(source),saved);
 }
 const older=m.normalizeManagedProductHistory({productIdHistory:JSON.stringify([{date:'2024-01-01',productId:'first'},{date:'2025-01-01',productId:'latest'}])});assert.equal(m.managedProductHistoryView(older,cutoff).productId.changedRecently,false);assert.equal(older.productId.latest.previous,'latest');
 }finally{h.close();}
});

test('other-seller matching follows JavaScript truthiness and never depends on names',()=>{
 const h=managedProductHarness();try{const m=h.load('app/managed-product-history.ts');for(const [value,expected] of [['false',true],[1,true],[[],true],[{},true],[false,false],[0,false],[null,false],['',false]]){const raw=JSON.stringify({hasOtherSellers:value,otherVendorNames:[]}),view=m.normalizeManagedProductHistory({otherSellers:raw}).otherSellers;assert.equal(view.matched,expected,raw);assert.equal(view.state,'valid');assert.equal(view.names.length,0);}
 assert.equal(m.normalizeManagedProductHistory({otherSellers:JSON.stringify({otherVendorNames:['회사']})}).otherSellers.matched,false);
 for(const raw of ['{broken','[]','"false"','1'])assert.deepEqual(JSON.parse(JSON.stringify(m.normalizeManagedProductHistory({otherSellers:raw}).otherSellers)),{state:'invalid',matched:null,names:[]});
 const raw=JSON.stringify({hasOtherSellers:true,otherVendorNames:['회사',0,null,'','  ',{name:'추정 금지'}]}),view=m.normalizeManagedProductHistory({otherSellers:raw});assert.deepEqual(Array.from(view.otherSellers.names),['회사']);
 }finally{h.close();}
});

test('latest recorded import date wins before price interpretation, retaining source zero/negative/unknown distinctions',()=>{
 const h=managedProductHarness();try{const m=h.load('app/managed-product-history.ts');for(const price of [undefined,null,false,'',' ',0]){const source=JSON.stringify([{date:'2026-10-11',매입가:25},{date:'2026-10-12',...(price===undefined?{}:{매입가:price})}]),result=m.normalizeManagedProductHistory({'매입정보':source}).sourceImportPrice;assert.equal(result.state,'valid');assert.equal(result.latest.date,'2026-10-12T00:00:00.000Z');assert.equal(result.latest.price,'0');assert.equal(result.value,0);assert.equal(result.noImport,true);}
 for(const [price,flag] of [['-2.50',true],['0012.500',false]]){const result=m.normalizeManagedProductHistory({'매입정보':JSON.stringify([{date:'2026-10-12',매입가:price}])}).sourceImportPrice;assert.equal(result.latest.price,price);assert.equal(result.noImport,flag);}
 for(const price of ['junk','NaN','미확인',true,{}]){const result=m.normalizeManagedProductHistory({'매입정보':JSON.stringify([{date:'2026-10-11',매입가:25},{date:'2026-10-12',매입가:price}])}).sourceImportPrice;assert.equal(result.state,'invalid');assert.equal(result.value,null);assert.equal(result.latest,null);assert.equal(result.noImport,false);}
 for(const raw of ['',null,'null','[]']){const view=m.normalizeManagedProductHistory({'매입정보':raw}).sourceImportPrice;assert.equal(view.noImport,true);assert.equal(view.value,0);assert.equal(view.latest,null);}
 for(const raw of ['{broken','{}','"string"','[{"date":"bad","매입가":1}]']){const result=m.normalizeManagedProductHistory({'매입정보':raw}).sourceImportPrice;assert.equal(result.state,'invalid');assert.equal(result.value,null);assert.equal(result.noImport,null);}
 }finally{h.close();}
});

test('missing, empty and malformed raw histories remain distinct and are never written back',()=>{
 const h=managedProductHarness();try{const m=h.load('app/managed-product-history.ts');for(const [input,state] of [[undefined,'missing'],['','empty'],['  ','empty'],['null','empty'],['[]','empty'],['{}','invalid'],['{broken','invalid'],['[{}]','invalid']]){const source={productIdHistory:input,priceHistory:input,unknown:{empty:'',zero:0,flag:false}},before=JSON.stringify(source),view=m.normalizeManagedProductHistory(source);assert.equal(view.productId.state,state);assert.equal(view.price.state,state);assert.equal(m.managedProductHistoryView(view,cutoff).productId.changedRecently,false);assert.equal(JSON.stringify(source),before);}
 }finally{h.close();}
});

for(const company of companies)test(`existing imports acquire source-bound read histories without reimport or price/source mutation (${company.code})`,async()=>{
 const h=managedProductHarness();prepare(h,company);try{const dates=[new Date(cutoff).toISOString(),new Date(cutoff-1).toISOString(),'Tue, 06 Oct 2026 05:30:00 GMT','2030-01-01','2026-10-06',cutoff,'bad'],bytes=managedFixture(18,rows=>{for(const [index,row]of rows.entries()){row.productIdHistory=JSON.stringify([{date:dates[index%dates.length]}]);row.priceHistory=JSON.stringify([{date:dates[index%dates.length],price:index}]);row.otherSellers=JSON.stringify({hasOtherSellers:index%3===0?'false':false});row['매입정보']='[]';}});await importFile(h,company,bytes);const before=raw(h);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_product_history').get().n,0);
 const all=await json(await list(h,{pageSize:'100'}));assert.equal(all.summary.productIdChanged,11);assert.equal(all.summary.priceChanged,11);assert.equal(all.summary.otherSellers,6);assert.equal(all.summary.noImport,18);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_product_history').get().n,18);for(const operator of ['eq','contains']){const zeros=await json(await list(h,{columnFilters:JSON.stringify([{column:'latestImportPrice',operator,value:'0'}]),pageSize:'100'}));assert.equal(zeros.total,18);assert.ok(zeros.products.every(row=>row.effectiveImportPrice==='0'&&row.history.sourceImportPrice.latest===null));}
 for(const [filter,count]of [['product-id-changed',11],['price-changed',11],['other-sellers',6]]){const first=await json(await list(h,{filter,pageSize:'10'}));assert.equal(first.total,count);const response=await exportFile(h,all.accountContext,{filter});assert.equal(response.status,200);const reader=h.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(await response.arrayBuffer()),{rowLimit:5001}).sheets[0];assert.equal(sheet.rows.length-1,count);}
 assert.equal(raw(h),before);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_import_prices').get().n,0);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM products').get().n,0);
 const current=h.state.user;h.state.user={...current,userId:'another-owner',membership:{...current.membership,id:'another-owner'}};h.syncMember();assert.equal((await json(await list(h))).total,0);h.state.user=current;Object.assign(h.state.user.membership,{companyCode:companies.find(c=>c.code!==company.code).code,companyName:companies.find(c=>c.code!==company.code).name});h.syncMember();assert.equal((await json(await list(h))).total,0);assert.equal(raw(h),before);
 }finally{h.close();}
});

for(const company of companies)test(`current source import prices, explicit manual zero, unavailable status and exposure fallback drive the same table predicates (${company.code})`,async()=>{
 const h=managedProductHarness();prepare(h,company);try{const prices=[undefined,'',null,false,0,-2,'0012.500','junk'],bytes=managedFixture(8,rows=>{for(const [index,row]of rows.entries()){row['매입정보']=JSON.stringify([{date:'2026-10-10',매입가:25},{date:'2026-10-12',...(prices[index]===undefined?{}:{매입가:prices[index]})}]);row.latestImportPrice='77777';row['발주가능상태']=['정상','품절','판매중지',''][index%4];row['노출ID']='';row.productId=String(43210+index);}});await importFile(h,company,bytes);const before=raw(h),all=await json(await list(h,{pageSize:'100'}));assert.deepEqual(all.products.map(row=>row.effectiveImportPrice),['0','0','0','0','0','-2','0012.500',null]);assert.equal(all.summary.noImport,6);assert.equal(all.summary.unavailable,6);assert.equal((await json(await list(h,{filter:'no-import'}))).total,6);assert.equal((await json(await list(h,{filter:'unavailable'}))).total,6);
 const table=h.load('app/managed-product-table.ts');assert.equal(table.managedCell(all.products[0],'latestImportPrice'),'0');assert.equal(table.managedCell(all.products[0],'노출ID'),'43210');
 const filtered=await json(await list(h,{columnFilters:JSON.stringify([{column:'노출ID',operator:'eq',value:'43216'}])}));assert.equal(filtered.products[0].skuId,sku(6));const sourcePrices=await json(await list(h,{sort:'latestImportPrice',direction:'ascending',columnFilters:JSON.stringify([{column:'latestImportPrice',operator:'gte',value:'0'}])}));assert.deepEqual(sourcePrices.products.map(row=>row.effectiveImportPrice),['0','0','0','0','0','0012.500']);
 const upload=importPriceFixture([[sku(6),'2026-10-11','0'],[sku(7),'2026-10-12','5.25']]),review=await json(await postImportPrices(h,upload));await json(await postImportPrices(h,upload,{action:'import',preview:review}),201);const overlay=priceRows(h),updated=await json(await list(h,{pageSize:'100'}));assert.equal(updated.products[6].effectiveImportPrice,'0');assert.equal(updated.products[7].effectiveImportPrice,'5.25');assert.equal(updated.summary.noImport,7);assert.equal((await json(await list(h,{filter:'no-import'}))).total,7);assert.equal(raw(h),before);assert.equal(priceRows(h),overlay);await json(await postImportPrices(h,importPriceFixture([[sku(0),'2026-10-13','-1']])),400);
 const output=await exportFile(h,updated.accountContext);assert.equal(output.status,200);const reader=h.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(await output.arrayBuffer()),{rowLimit:5001}).sheets[0],headers=sheet.rows[0].values;assert.equal(sheet.rows[7].values[headers.indexOf('latestImportPrice')],'77777');assert.equal(sheet.rows[7].values[headers.indexOf('YOOFAM 적용 매입가')],'0');assert.equal(raw(h),before);assert.equal(priceRows(h),overlay);
 }finally{h.close();}
});

for(const company of companies)test(`source/member changes reject cache commits and final list/export snapshots instead of returning false filtered rows (${company.code})`,async()=>{
 for(const phase of ['commit-source','commit-member','list-source','export-source']){const h=managedProductHarness();prepare(h,company);try{await importFile(h,company,managedFixture(2,rows=>{for(const row of rows)row.productIdHistory=JSON.stringify([{date:'2030-01-01'}]);}));let before,triggered=false;
 if(phase.startsWith('list')||phase.startsWith('export'))await json(await list(h));
 h.state.beforeBatch=queries=>{const hit=phase.startsWith('commit')?queries.some(q=>q.sql.startsWith('INSERT INTO managed_product_history')):queries.some(q=>q.sql.startsWith('SELECT COUNT(*) AS pending'));if(!hit)return;h.state.beforeBatch=null;triggered=true;if(phase==='commit-member')h.sqlite.prepare("UPDATE members SET status='suspended' WHERE id=?").run(h.state.user.userId);else h.sqlite.prepare("UPDATE managed_products SET source_payload=json_set(source_payload,'$.productIdHistory','[]') WHERE sku_id=?").run(sku(1));before=raw(h);};
 if(phase.startsWith('export')){const context=await h.load('app/managed-products.ts').managedProductAccountContext(h.state.user.userId,company);await json(await exportFile(h,context,{filter:'product-id-changed'}),409);}else await json(await list(h,{filter:'product-id-changed'}),409);assert.equal(triggered,true);assert.equal(raw(h),before);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_import_prices').get().n,0);if(phase.startsWith('commit'))assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_product_history WHERE sku_id=?').get(sku(1)).n,0);
 }finally{h.close();}}
});

for(const company of companies)test(`multiple valid imports accumulate beyond 5000 rows while bounded cache prefixes keep full counts and page/export membership (${company.code})`,async()=>{
 const h=managedProductHarness();prepare(h,company);try{for(let batch=0;batch<5;batch++)await importFile(h,company,managedFixture(1000,rows=>{for(const [index,row]of rows.entries()){row.SKUID=sku(batch*1000+index);row.productIdHistory='[]';row['매입정보']='[]';}}));await importFile(h,company,managedFixture(1,rows=>{rows[0].SKUID=sku(5000);rows[0].productIdHistory=JSON.stringify([{date:'2030-01-01'}]);rows[0]['매입정보']='[]';}));const before=raw(h),sizes=[];
 h.state.beforeBatch=queries=>{for(const query of queries)if(query.sql.includes('cumulative_bytes')){const original=query.execute;query.execute=()=>{const rows=original();sizes.push(rows.length);assert.ok(rows.length<=5000);assert.ok(rows.every(row=>row.cumulative_bytes<=8000000));return rows;};}};
 const all=await json(await list(h,{pageSize:'100'}));assert.equal(all.total,5001);assert.equal(all.summary.total,5001);assert.equal(all.summary.productIdChanged,1);assert.deepEqual(sizes,[5000,1,0]);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_product_history').get().n,5001);const selected=await json(await list(h,{filter:'product-id-changed'}));assert.equal(selected.products.length,1);assert.equal(selected.products[0].skuId,sku(5000));const page=await json(await list(h,{sort:'SKUID',direction:'ascending',page:'51',pageSize:'100'}));assert.equal(page.products[0].skuId,sku(5000));assert.equal(page.products.length,1);
 await json(await exportFile(h,all.accountContext),413);assert.equal((await exportFile(h,all.accountContext,{filter:'product-id-changed'})).status,200);assert.equal(raw(h),before);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM products').get().n,0);
 }finally{h.close();}
});
