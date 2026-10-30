import test from 'node:test';
import assert from 'node:assert/strict';
import {managedProductHarness,managedFixture} from './helpers/managed-products.mjs';

function api(){const h=managedProductHarness(),route=h.load('app/api/operations/route.ts');return{...h,get:(path='/api/operations?year=2026')=>route.GET(new Request('https://app.test'+path)),post:(body,extra={})=>route.POST(new Request('https://app.test/api/operations?year=2026',{method:'POST',headers:{'content-type':'application/json',origin:'https://app.test',...extra},body:JSON.stringify(body)}))};}
const json=async(r,status=200)=>{assert.equal(r.status,status,await r.clone().text());return r.json();};
const put=(s,command)=>({expectedRevision:s.revision,accountContext:s.accountContext,command});

test('initial GET returns defaults without persisting a workspace or changing managed products',async()=>{
 const h=api();try{
  const originals=JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products').all());
  const first=await json(await h.get()),second=await json(await h.get());
  assert.equal(first.revision,0);assert.deepEqual(second,first);assert.equal(first.document.records.skus.length,0);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM operations_workspaces').get().n,0);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products').all()),originals);
 }finally{h.close();}
});

test('API rejects oversized UTF-8 requests and accumulated workspace before persistence with 413',async()=>{
 const h=api();try{
  let s=await json(await h.get());
  const command=(count,notes,prefix)=>({type:'import',dataset:'skus',rows:Array.from({length:count},(_,i)=>({id:prefix+i,name:'크기 시험 '+i,notes}))});
  s=await json(await h.post(put(s,command(90,'a'.repeat(19000),'saved-'))));
  const before=h.sqlite.prepare('SELECT revision,payload FROM operations_workspaces').get();
  const overflow=await json(await h.post(put(s,command(6,'a'.repeat(19000),'extra-'))),413);assert.equal(overflow.code,'OPERATIONS_SIZE_LIMIT');assert.match(overflow.error,/1,800,000/);
  const oversized=put(s,command(106,'a'.repeat(19000),'ascii-'));assert.ok(Buffer.byteLength(JSON.stringify(oversized),'utf8')>2_000_000);await json(await h.post(oversized),413);
  const korean=put(s,command(61,'가'.repeat(10000),'korean-'));assert.ok(JSON.stringify(korean).length<1_800_000);assert.ok(Buffer.byteLength(JSON.stringify(korean),'utf8')>1_800_000);await json(await h.post(korean),413);
  assert.deepEqual(h.sqlite.prepare('SELECT revision,payload FROM operations_workspaces').get(),before);
 }finally{h.close();}
});

test('real API/SQLite server CAS, read-back and stale revision preserve latest document',async()=>{
 const h=api();try{const s=await json(await h.get());assert.equal(s.revision,0);assert.equal(s.scope.companyCode,'A01464742');const next=await json(await h.post(put(s,{type:'upsert',dataset:'skus',id:'a',values:{name:'실제 SKU',supplierSkuId:'0000123'}})));assert.equal(next.revision,1);assert.equal(next.document.records.skus[0].values.supplierSkuId,'0000123');
  await json(await h.post(put(s,{type:'upsert',dataset:'skus',id:'b',values:{name:'낡은 창'}})),409);const current=await json(await h.get());assert.equal(current.revision,1);assert.equal(current.document.records.skus.length,1);assert.equal(h.sqlite.prepare('SELECT revision FROM operations_workspaces').get().revision,1);
 }finally{h.close();}
});

test('owner/company isolation and context changes reject cross-scope writes',async()=>{
 const h=api();try{const s=await json(await h.get());await json(await h.post(put(s,{type:'upsert',dataset:'skus',id:'private',values:{name:'owner A'}})));const original=h.state.user;h.state.user={...original,userId:'second-owner',membership:{...original.membership,id:'second-owner'}};h.syncMember();const second=await json(await h.get());assert.equal(second.document.records.skus.length,0);await json(await h.post(put(s,{type:'upsert',dataset:'skus',id:'intrude',values:{name:'wrong context'}})),409);
  h.state.user={...original,membership:{...original.membership,companyCode:'A01526306',companyName:'유앤채'}};h.syncMember();const company=await json(await h.get());assert.equal(company.document.records.skus.length,0);assert.notEqual(company.accountContext,s.accountContext);h.state.user=null;await json(await h.get(),403);
 }finally{h.close();}
});

test('atomic member authorization rejects suspension between read and write',async()=>{
 const h=api();try{const s=await json(await h.get());h.state.beforeBatch=queries=>{if(queries.some(q=>q.sql.includes('INSERT INTO operations_workspaces')))h.sqlite.prepare("UPDATE members SET status='suspended' WHERE id=?").run(h.state.user.userId);};await json(await h.post(put(s,{type:'upsert',dataset:'skus',id:'a',values:{name:'blocked'}})),409);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM operations_workspaces').get().n,0);
 }finally{h.close();}
});

test('source product synchronization reads company-owned managed rows and never changes originals',async()=>{
 const h=api();try{h.sqlite.prepare('INSERT INTO managed_products(owner_id,company_code,sku_id,title,source_payload,source_name,source_sha256,source_row,first_imported_at,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('unari-test','A01464742','000123','연결 상품',JSON.stringify({'바코드':'0000001','공급가':'8,000','판매가':'11,000','매입단가':'5000','옵션ID':'99999999999999999'}),'source','hash',2,'a','b');
  h.sqlite.prepare('INSERT INTO managed_products(owner_id,company_code,sku_id,title,source_payload,source_name,source_sha256,source_row,first_imported_at,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('unari-test','A01526306','000456','다른 회사','{}','source','hash',2,'a','b');const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products ORDER BY sku_id').all()),s=await json(await h.get()),next=await json(await h.post(put(s,{type:'sync-products',rows:[{name:'client spoof'}]})));assert.equal(next.document.records.skus.length,1);const sku=next.document.records.skus[0].values;assert.equal(sku.supplierSkuId,'000123');assert.equal(sku.optionId,'99999999999999999');assert.equal(sku.supplyPrice,8000);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products ORDER BY sku_id').all()),before);
 }finally{h.close();}
});

test('real managed workbook re-sync preserves unknown prices and links, applies explicit zero and canonical ID fallbacks',async()=>{
 const h=api();try{
  const importSource=async mutate=>{const bytes=managedFixture(1,mutate),preview=await json(await h.submit(bytes));await json(await h.submit(bytes,{action:'import',sha256:preview.sha256}),201);};
  await importSource(rows=>{Object.assign(rows[0],{'공급가':'','판매가':'가격 미정','매입단가':'','바코드':'','옵션ID':'','vendorItemId':'','노출ID':'','productId':'','구매링크':''});});
  let s=await json(await h.get());
  s=await json(await h.post(put(s,{type:'upsert',dataset:'skus',id:'reviewed',values:{name:'검토한 SKU',supplierSkuId:'1000000000',supplyPrice:8000,salePrice:11000,costPrice:5000,barcode:'000001',optionId:'000002',productId:'000003',sourceUrl:'https://source.example.test/reviewed'}})));
  const sync=async()=>{const originals=JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products').all());s=await json(await h.post(put(s,{type:'sync-products'})));assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products').all()),originals);assert.equal(s.document.records.skus.length,1);assert.equal(s.document.records.skus[0].id,'reviewed');return s.document.records.skus[0].values;};
  let values=await sync();
  for(const [key,value]of Object.entries({supplyPrice:8000,salePrice:11000,costPrice:5000,barcode:'000001',optionId:'000002',productId:'000003',sourceUrl:'https://source.example.test/reviewed'}))assert.equal(values[key],value,key);
  assert.equal(values.priceHistory,undefined,'unknown source cells do not fabricate price changes');
  await importSource(rows=>{Object.assign(rows[0],{'공급가':'0','판매가':'₩ 0','매입단가':'0','옵션ID':'000004',vendorItemId:'wrong-option','노출ID':'000005',productId:'wrong-product'});});
  values=await sync();
  for(const key of ['supplyPrice','salePrice','costPrice'])assert.equal(values[key],0,key);
  assert.equal(values.optionId,'000004');assert.equal(values.productId,'000005');assert.ok(values.priceHistory.length);
  await importSource(rows=>{Object.assign(rows[0],{'공급가':'','판매가':'','매입단가':'','옵션ID':'',vendorItemId:'000006','노출ID':'',productId:'000007'});});
  values=await sync();assert.equal(values.optionId,'000006');assert.equal(values.productId,'000007');assert.equal(values.costPrice,0);
 }finally{h.close();}
});

test('invalid requests, cross-origin, closed period and broken stored JSON fail without overwrite',async()=>{
 const h=api();try{await json(await h.get('/api/operations?year=20'),400);const s=await json(await h.get());await json(await h.post(put(s,{type:'upsert',dataset:'skus',values:{name:'wrong origin'}}),{origin:'https://other.test'}),403);await json(await h.post({...put(s,{type:'upsert',dataset:'skus',values:{name:'a'}}),expectedRevision:-1}),400);
  const closed=await json(await h.post(put(s,{type:'close-period',month:'2026-01'})));await json(await h.post(put(closed,{type:'upsert',dataset:'sales',values:{date:'2026-01-01',type:'other',price:1100}})),409);assert.equal((await json(await h.get())).revision,1);
  h.sqlite.prepare("UPDATE operations_workspaces SET payload='bad-json'").run();await json(await h.get(),503);await json(await h.post(put(closed,{type:'upsert',dataset:'skus',values:{name:'do not erase'}})),503);assert.equal(h.sqlite.prepare('SELECT payload FROM operations_workspaces').get().payload,'bad-json');
 }finally{h.close();}
});

test('full editor payload persists edited inbound aliases instead of stale hidden canonical values',async()=>{
 const h=api();try{let s=await json(await h.get());
  const send=async command=>{s=await json(await h.post(put(s,command)));};
  await send({type:'upsert',dataset:'skus',id:'sku',values:{name:'입출고 시험'}});
  await send({type:'upsert',dataset:'inboundEvents',id:'event',values:{date:'2026-01-02',skuId:'sku',qty:3,type:'outbound',po:'000123',occurredAt:'2026-01-02T09:00:00'}});
  const original=s.document.records.inboundEvents[0];assert.equal(original.values.kind,'return-out');
  await send({type:'upsert',dataset:'inboundEvents',id:'event',values:{...original.values,type:'inbound',po:'000456',occurredAt:'2026-01-02T10:00:00'}});
  const saved=(await json(await h.get())).document.records.inboundEvents[0];assert.equal(saved.id,'event');assert.equal(saved.values.kind,'inbound');assert.equal(saved.values.poNumber,'000456');assert.equal(saved.values.time,'2026-01-02T10:00:00');assert.equal(saved.values.type,'inbound');
 }finally{h.close();}
});
