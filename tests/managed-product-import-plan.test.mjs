import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagedProductImportPlan} from '../scripts/prepare-managed-product-import.mjs';
import {managedFixture,managedProductHarness} from './helpers/managed-products.mjs';
const owner='11111111-1111-4111-8111-111111111111';
const target={ownerId:owner,companyCode:'A01464742',sourceName:'원본 상품 DB.xlsx'};
const buffer=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
function member(h,overrides={}){const row={id:owner,email:'unari8484@gmail.com',role:'member',status:'approved',companyCode:'A01464742',companyName:'와이홉',...overrides};h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(row.id,row.email,'not-a-secret',row.role,row.status,row.companyCode,row.companyName,'2026-10-01','2026-10-01');}
const snapshot=h=>JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products ORDER BY owner_id,company_code,sku_id').all());

test('generated SQL reuses the full 1101-row parser/import contract, preserves quoted original values and retries idempotently',async()=>{
 const h=managedProductHarness();try{
  member(h);const bytes=managedFixture(1101,rows=>{rows[0]['상품명']="원문 '); DELETE FROM products; --\n공란 보존";rows[0]['priceHistory']='[{"값":"원문\\n줄"}]';}),source=await h.load('app/managed-products.ts').parseManagedProductWorkbook(bytes,{code:'A01464742',name:'와이홉'});
  const plan=await createManagedProductImportPlan(buffer(bytes),target);assert.equal(plan.total,1101);assert.equal(plan.columns,39);assert.equal(plan.sha256,source.sha256);assert.ok(plan.chunks>1);
  h.sqlite.exec("INSERT INTO products(id,owner_id,source_url,title,source_price_cny,exchange_rate,supply_margin,coupang_margin,supply_price,sale_price,msrp,created_at,updated_at) VALUES('existing','other-owner','https://detail.1688.com/offer/813724060928.html','기존 수동 원문',25.6,350,50,40,17920,29870,38830,'2026-10-01','2026-10-01')");
  const original=JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all());h.sqlite.exec(plan.previewSql);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_products').get().n,0);
  h.sqlite.exec(plan.importSql);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_products').get().n,1101);const saved=snapshot(h);
  for(const entry of [source.rows[0],source.rows.at(-1)]){const row=h.sqlite.prepare('SELECT * FROM managed_products WHERE owner_id=? AND sku_id=?').get(owner,entry.skuId);assert.deepEqual(JSON.parse(row.source_payload),JSON.parse(JSON.stringify(entry.values)));assert.equal(row.source_row,entry.sourceRow);assert.equal(row.source_sha256,source.sha256);assert.equal(row.source_name,target.sourceName);assert.equal(row.company_code,target.companyCode);}
  h.sqlite.exec(plan.importSql);h.sqlite.exec(plan.verifySql);assert.equal(snapshot(h),saved);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all()),original);
  for(const table of ['collection_jobs','supplier_hub_receipts'])assert.equal(h.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
  for(const line of plan.importSql.split(/;\n(?=INSERT INTO managed_products)/).slice(1))assert.ok(Buffer.byteLength(line)<=80001);
 }finally{h.close();}
});

test('generated INSERT independently guards the exact current owner, approved member, email and company pair',async()=>{
 const plan=await createManagedProductImportPlan(buffer(managedFixture(1)),target);
 for(const overrides of [{id:'22222222-2222-4222-8222-222222222222'},{email:'other@example.test'},{role:'admin'},{status:'suspended'},{companyCode:'A01526306'},{companyName:'다른 회사'}]){
  const h=managedProductHarness();try{member(h,overrides);h.sqlite.exec(plan.importSql);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_products').get().n,0);}finally{h.close();}
 }
 const h=managedProductHarness();try{member(h);h.sqlite.exec(plan.previewSql);h.sqlite.exec("UPDATE members SET status='suspended'");h.sqlite.exec(plan.importSql);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_products').get().n,0);}finally{h.close();}
 await assert.rejects(()=>createManagedProductImportPlan(buffer(managedFixture(1)),{...target,companyCode:'UNKNOWN'}));
});
