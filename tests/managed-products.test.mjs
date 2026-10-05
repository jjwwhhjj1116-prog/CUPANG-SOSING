import test from 'node:test';
import assert from 'node:assert/strict';
import {managedProductHarness,managedFixture,managedHeaders} from './helpers/managed-products.mjs';
import {workbookArchive} from './helpers/quotation-workbook.mjs';
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};

test('explicit import row limits reject distant rows and formulas instead of silently dropping values',async()=>{
 const h=managedProductHarness();try{
  const reader=h.load('app/xlsx-template.ts'),files=await reader.readXlsxArchive(managedFixture(2).buffer),sheet='xl/worksheets/sheet1.xml',xml=new TextDecoder().decode(files.get(sheet));
  const distant=new Map(files);distant.set(sheet,new TextEncoder().encode(xml.replace(/r="([A-Z]*)3"/g,(_,column)=>`r="${column}5002"`)));
  assert.equal(reader.inspectXlsxArchive(distant).sheets[0].rows.length,2,'legacy 1000-row header inspection is unchanged');
  assert.equal((await h.submit(workbookArchive([...distant]))).status,400);
  const formula=new Map(files);formula.set(sheet,new TextEncoder().encode(xml.replace('<c r="U2" t="inlineStr">','<c r="U2" t="inlineStr"><f>1+1</f>')));
  const response=await h.submit(workbookArchive([...formula]));assert.equal(response.status,400);assert.match(await response.text(),/수식/);
  const wrongCompany=managedFixture(1,rows=>{rows[0].latestImportPrice='A01526306';}),foreign=await reader.readXlsxArchive(wrongCompany.buffer);
  foreign.set(sheet,new TextEncoder().encode(new TextDecoder().decode(foreign.get(sheet)).replace('latestImportPrice','회사코드')));
  const rejected=await h.submit(workbookArchive([...foreign]));assert.equal(rejected.status,400);assert.match(await rejected.text(),/회사코드/);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_products').get().n,0);
 }finally{h.close();}
});

test('actual API/SQLite imports all 1101 SKU rows after preview, retries idempotently and never edits existing drafts',async()=>{
 const h=managedProductHarness();try{
  h.sqlite.exec(`INSERT INTO products(id,owner_id,source_url,title,source_price_cny,exchange_rate,supply_margin,coupang_margin,supply_price,sale_price,msrp,created_at,updated_at)
   VALUES('manual','unari-test','https://detail.1688.com/offer/813724060928.html','수동 상품',25.6,350,50,40,17920,29870,38830,'2026-10-01','2026-10-01');
   INSERT INTO product_content VALUES('manual','unari-test',7,'{"seo":{"title":""},"assets":{"main":[]}}','2026-10-01');`);
  const before=JSON.stringify({products:h.sqlite.prepare('SELECT * FROM products').all(),content:h.sqlite.prepare('SELECT * FROM product_content').all()});
  const bytes=managedFixture(1101),preview=await json(await h.submit(bytes));assert.equal(preview.preview,true);assert.deepEqual(preview.counts,{total:1101,added:1101,updated:0,unchanged:0});assert.equal(preview.sample.length,5);assert.deepEqual(preview.headers,managedHeaders);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_products').get().n,0);
  const imported=await json(await h.submit(bytes,{action:'import',sha256:preview.sha256}),201);assert.deepEqual(imported.counts,preview.counts);
  const saved=JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products ORDER BY sku_id').all());
  const retry=await json(await h.submit(bytes,{action:'import',sha256:preview.sha256}),201);assert.deepEqual(retry.counts,{total:1101,added:0,updated:0,unchanged:1101});assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products ORDER BY sku_id').all()),saved);
  const result=await json(await h.fetcher('/api/managed-products?page=45&pageSize=25'));assert.equal(result.total,1101);assert.equal(result.products.length,1);assert.equal(result.products[0].sourceRow,1102);assert.equal(result.summary.unavailable,465);assert.equal(result.summary.loser,15);assert.equal(result.summary.noPurchase,1101);assert.equal(result.summary.priceDate,'2026-08-07');
  assert.equal(Object.keys(result.products[0].values).length,39);assert.equal(result.products[0].values['재고'],'0');assert.equal(result.products[0].values['구매링크'],'');
  assert.equal(JSON.stringify({products:h.sqlite.prepare('SELECT * FROM products').all(),content:h.sqlite.prepare('SELECT * FROM product_content').all()}),before);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM collection_jobs').get().n,0);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM supplier_hub_receipts').get().n,0);
 }finally{h.close();}
});

test('company and owner boundaries, preview file hash, duplicate SKUs and precise filters remain enforced',async()=>{
 const h=managedProductHarness();try{
  const bytes=managedFixture(),preview=await json(await h.submit(bytes));
  assert.equal((await h.submit(bytes,{action:'import',sha256:'a'.repeat(64)})).status,400);
  assert.equal((await h.submit(bytes,{action:'import',sha256:preview.sha256,confirmed:false})).status,400);
  assert.equal((await h.submit(bytes,{companyCode:'A01526306'})).status,400);
  assert.equal((await h.submit(managedFixture(2,rows=>{rows[1].SKUID=rows[0].SKUID;}))).status,400);
  await json(await h.submit(bytes,{action:'import',sha256:preview.sha256}),201);
  const changed=managedFixture(3,rows=>{rows[1]['공급가']='0';rows[1]['구매링크']='';}),next=await json(await h.submit(changed));assert.deepEqual(next.counts,{total:3,added:0,updated:1,unchanged:2});
  await json(await h.submit(changed,{action:'import',sha256:next.sha256}),201);
  const list=await json(await h.fetcher('/api/managed-products?search=1000000001'));assert.equal(list.total,1);assert.equal(list.products[0].values['공급가'],'0');
  assert.equal((await json(await h.fetcher('/api/managed-products?search=%25'))).total,0);
  const originalUser=h.state.user;h.state.user={...originalUser,userId:'other-owner',membership:{...originalUser.membership,id:'other-owner'}};
  assert.equal((await json(await h.fetcher('/api/managed-products'))).total,0);
  h.state.user={...originalUser,userId:'admin-test',membership:{...originalUser.membership,id:'admin-test',companyCode:'A01526306',companyName:'유앤채'}};
  const own=await json(await h.submit(bytes,{companyCode:'A01526306'}));await json(await h.submit(bytes,{companyCode:'A01526306',action:'import',sha256:own.sha256}),201);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_products').get().n,6);
  h.state.user=null;assert.equal((await h.fetcher('/api/managed-products')).status,403);assert.equal((await h.submit(bytes)).status,403);
 }finally{h.close();}
});

test('multi-chunk import rolls back entirely on storage failure and exposes no database error',async()=>{
 const h=managedProductHarness();try{
  const bytes=managedFixture(501),preview=await json(await h.submit(bytes));
  h.sqlite.exec(`CREATE TRIGGER fail_import BEFORE INSERT ON managed_products WHEN NEW.sku_id='1000000500' BEGIN SELECT RAISE(ABORT,'PRIVATE_DATABASE_ERROR'); END;`);
  const response=await h.submit(bytes,{action:'import',sha256:preview.sha256});assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/PRIVATE_DATABASE_ERROR/);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_products').get().n,0);
 }finally{h.close();}
});
