import test from 'node:test';
import assert from 'node:assert/strict';
import {managedProductHarness,managedFixture} from './helpers/managed-products.mjs';

const company={code:'A01464742',name:'와이홉'};
const batchId='10000000-0000-4000-8000-000000000873',captureId='20000000-0000-4000-8000-000000000873';
const candidate=(offerId='700000000873')=>({offerId,sourceUrl:`https://detail.1688.com/offer/${offerId}.html`,title:'合成商品 '+offerId,thumbnail:`https://cbu01.alicdn.com/synthetic-listing-${offerId}.jpg`,displayPrice:'¥2.80 ~ ¥3.20 / 1件起批'});
const input=(patch={})=>({expectedOwnerId:'unari-test',expectedCompany:{...company},batchId,captureId,listingUrl:'https://s.1688.com/selloffer/offer_search.htm?keywords=synthetic',items:[candidate()],...patch});
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());assert.equal(response.headers.get('cache-control'),'no-store');return response.json();};
function api(){
 const h=managedProductHarness(),route=h.load('app/api/operations/listing-candidates/route.ts'),operations=h.load('app/api/operations/route.ts');
 const post=(body=input(),headers={})=>route.POST(new Request('https://app.test/api/operations/listing-candidates',{method:'POST',headers:{'content-type':'application/json',origin:'https://app.test',...headers},body:JSON.stringify(body)}));
 const get=()=>operations.GET(new Request('https://app.test/api/operations?year=2026'));
 const command=async(command)=>{const s=await (await get()).json();return operations.POST(new Request('https://app.test/api/operations?year=2026',{method:'POST',headers:{'content-type':'application/json',origin:'https://app.test'},body:JSON.stringify({expectedRevision:s.revision,accountContext:s.accountContext,command})}));};
 return {...h,post,get,command,stored:()=>h.sqlite.prepare('SELECT * FROM operations_workspaces ORDER BY owner_id,company_code').all()};
}
function workspace(h){return h.sqlite.prepare('SELECT revision,payload FROM operations_workspaces WHERE owner_id=? AND company_code=?').get('unari-test',company.code);}

test('comparison API stores only candidate evidence with raw display price and a verified scope receipt',async()=>{
 const h=api();try{
  const request=input({items:[candidate(),candidate('700000000874')]}),answer=await json(await h.post(request));
  assert.equal(answer.ok,true);const receipt=answer.receipt;assert.equal(receipt.ownerId,request.expectedOwnerId);assert.deepEqual(receipt.company,company);assert.equal(receipt.captureId,captureId);assert.equal(receipt.batchId,batchId);assert.equal(receipt.stored,true);assert.equal(receipt.revision,1);assert.equal(receipt.storedCount,2);assert.equal(receipt.existingCount,0);assert.deepEqual(receipt.itemOfferIds,request.items.map(row=>row.offerId));assert.match(receipt.payloadSha256,/^[a-f0-9]{64}$/);assert.ok(Number.isFinite(Date.parse(receipt.recordedAt)));
  const document=JSON.parse(workspace(h).payload);assert.equal(document.records.sourcingCandidates.length,2);
  const row=document.records.sourcingCandidates[0];assert.equal(row.id,'listing-offer:'+request.items[0].offerId);assert.equal(row.values.name,request.items[0].title);assert.equal(row.values.displayPrice,request.items[0].displayPrice);assert.equal(row.values.price,undefined);assert.equal(row.values.sourceBatchId,batchId);assert.equal(row.values.batchId,undefined);assert.equal(row.values.sourceCaptureId,captureId);assert.equal(row.values.source,'1688-listing-card');
  const marker=document.records.jobs[0];assert.equal(marker.values.resultVerified,true);assert.ok(Number.isFinite(Date.parse(marker.values.completedAt)));assert.equal(marker.values.sourceBatchId,batchId);assert.equal(marker.values.batchId,undefined);assert.deepEqual(JSON.parse(marker.values.receiptJson),receipt);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM products').get().n,0);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM collection_jobs').get().n,0);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM supplier_hub_receipts').get().n,0);
 }finally{h.close();}
});

test('same immutable capture returns its durable original receipt without a second workspace write',async()=>{
 const h=api();try{
  const first=await json(await h.post()),before=workspace(h);let writes=0;h.state.beforeBatch=queries=>{if(queries.some(q=>q.sql.includes('INSERT INTO operations_workspaces')))writes++;};
  const retry=await json(await h.post());assert.deepEqual(retry,first);assert.deepEqual(workspace(h),before);assert.equal(writes,0);
  // Object key order does not change the digest or durable idempotency key.
  const original=input(),reordered={items:original.items.map(row=>Object.fromEntries(Object.entries(row).reverse())),listingUrl:original.listingUrl,captureId,batchId,expectedCompany:{name:company.name,code:company.code},expectedOwnerId:original.expectedOwnerId};
  assert.deepEqual(await json(await h.post(reordered)),first);assert.equal(writes,0);
 }finally{h.close();}
});

for(const change of ['item','order','batch','listing'])test(`same capture with different ${change} conflicts without modifying prior rows or receipt`,async()=>{
 const h=api();try{
  const original=input({items:[candidate(),candidate('700000000874')]});await json(await h.post(original));const before=workspace(h),changed=structuredClone(original);
  if(change==='item')changed.items[0].title='changed source title';if(change==='order')changed.items.reverse();if(change==='batch')changed.batchId='10000000-0000-4000-8000-000000000874';if(change==='listing')changed.listingUrl+='&sortType=price';
  const rejected=await json(await h.post(changed),409);assert.equal(rejected.ok,false);assert.equal(rejected.code,'LISTING_CAPTURE_CONFLICT');assert.equal(rejected.uncertain,false);assert.deepEqual(workspace(h),before);
 }finally{h.close();}
});

test('new capture preserves reviewed candidates, SKU/accounting rows, managed products and registration drafts',async()=>{
 const h=api();try{
  const bytes=managedFixture(1),preview=await (await h.submit(bytes)).json();assert.equal((await h.submit(bytes,{action:'import',sha256:preview.sha256})).status,201);
  h.sqlite.exec(`INSERT INTO products(id,owner_id,source_url,title,source_price_cny,exchange_rate,supply_margin,coupang_margin,supply_price,sale_price,msrp,created_at,updated_at) VALUES('existing-draft','unari-test','https://detail.1688.com/offer/700000000899.html','보존 초안',25,310,50,45,15500,28180,30000,'2026-10-01','2026-10-01'); INSERT INTO product_content VALUES('existing-draft','unari-test',7,'{"seo":{"title":"검토한 제목"}}','2026-10-01');`);
  assert.equal((await h.command({type:'upsert',dataset:'sourcingCandidates',id:'reviewed-candidate',values:{offerId:'700000000873',name:'검토 완료한 후보',koName:'수정된 한글명',url:'https://detail.1688.com/offer/700000000873.html',status:'registered',notes:'직접 작성',price:7.9,displayPrice:'original raw price'}})).status,200);
  assert.equal((await h.command({type:'upsert',dataset:'skus',id:'reviewed-sku',values:{name:'보존 SKU',supplierSkuId:'000873',supplyPrice:15000}})).status,200);
  assert.equal((await h.command({type:'upsert',dataset:'sales',id:'ledger',values:{date:'2026-10-01',type:'other',price:11000}})).status,200);
  const before=JSON.parse(workspace(h).payload),products=JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products').all()),drafts=JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all()),content=JSON.stringify(h.sqlite.prepare('SELECT * FROM product_content').all());
  const result=await json(await h.post(input({items:[candidate(),candidate('700000000874')]})));assert.equal(result.receipt.storedCount,1);assert.equal(result.receipt.existingCount,1);
  const after=JSON.parse(workspace(h).payload);assert.deepEqual(after.records.sourcingCandidates.find(row=>row.id==='reviewed-candidate'),before.records.sourcingCandidates[0]);assert.deepEqual(after.records.skus,before.records.skus);assert.deepEqual(after.records.sales,before.records.sales);assert.equal(after.records.sourcingCandidates.length,2);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products').all()),products);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all()),drafts);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM product_content').all()),content);
 }finally{h.close();}
});

test('all-existing capture writes one receipt without overwriting candidate evidence',async()=>{
 const h=api();try{
  await json(await h.post());const original=JSON.parse(workspace(h).payload).records.sourcingCandidates;
  const next=input({captureId:'20000000-0000-4000-8000-000000000874'});next.items[0].title='later card title';const result=await json(await h.post(next));assert.equal(result.receipt.storedCount,0);assert.equal(result.receipt.existingCount,1);
  const document=JSON.parse(workspace(h).payload);assert.deepEqual(document.records.sourcingCandidates,original);assert.equal(document.records.jobs.length,2);
 }finally{h.close();}
});

test('colliding deterministic candidate ID fails closed rather than replacing an unrelated candidate',async()=>{
 const h=api();try{
  assert.equal((await h.command({type:'upsert',dataset:'sourcingCandidates',id:'listing-offer:700000000873',values:{name:'different source',offerId:'700000000899',notes:'keep me'}})).status,200);const before=workspace(h);
  assert.equal((await json(await h.post(),409)).ok,false);assert.deepEqual(workspace(h),before);
 }finally{h.close();}
});

test('member/company boundaries reject stale expected scope and never expose another workspace receipt',async()=>{
 const h=api();try{
  await json(await h.post());const original=h.state.user,first=h.stored();
  h.state.user={...original,userId:'different-owner',membership:{...original.membership,id:'different-owner'}};h.syncMember();const mismatch=await json(await h.post(),409);assert.equal(mismatch.code,'OPERATIONS_SCOPE_CHANGED');assert.equal(mismatch.uncertain,false);assert.deepEqual(h.stored(),first);
  const second=await json(await h.post(input({expectedOwnerId:'different-owner'})));assert.equal(second.receipt.ownerId,'different-owner');assert.equal(second.receipt.revision,1);assert.equal(h.stored().length,2);
  h.state.user={...original,membership:{...original.membership,companyCode:'A01526306',companyName:'유앤채'}};h.syncMember();await json(await h.post(),409);
  const third=await json(await h.post(input({expectedCompany:{code:'A01526306',name:'유앤채'}})));assert.equal(third.receipt.company.code,'A01526306');assert.equal(third.receipt.revision,1);assert.equal(h.stored().length,3);
  h.state.user=null;await json(await h.post(),403);assert.equal(h.stored().length,3);
 }finally{h.close();}
});

for(const mode of ['origin','auth','url','thumb','duplicate','oversized','extra','content-type','batch-array','capture-array'])test(`invalid ${mode} request cannot write a comparison workspace`,async()=>{
 const h=api();try{
  const body=input();let headers={},status=400;
  if(mode==='origin'){headers={origin:'https://foreign.example'};status=403;}
  if(mode==='auth'){h.state.user={...h.state.user,verifiedAccess:false};status=403;}
  if(mode==='url')body.items[0].sourceUrl='https://detail.1688.com/offer/700000000899.html';
  if(mode==='thumb')body.items[0].thumbnail='https://cbu01.alicdn.com.evil.example/picture.jpg';
  if(mode==='duplicate')body.items.push({...body.items[0]});
  if(mode==='oversized'){body.items[0].title='가'.repeat(100000);status=413;}
  if(mode==='extra')body.items[0].fullSource={skuModel:'not a source capture'};
  if(mode==='content-type')headers={'content-type':'text/plain'};
  if(mode==='batch-array')body.batchId=[batchId];if(mode==='capture-array')body.captureId=[captureId];
  const response=await json(await h.post(body,headers),status);assert.equal(response.ok,false);assert.equal(response.uncertain,false);assert.equal(h.stored().length,0);
 }finally{h.close();}
});

test('atomic CAS conflict preserves a concurrent review instead of overwriting it with the batch snapshot',async()=>{
 const h=api();try{
  await json(await h.post());let concurrent;
  h.state.beforeBatch=queries=>{if(!queries.some(q=>q.sql.includes('INSERT INTO operations_workspaces')))return;h.state.beforeBatch=null;const row=workspace(h),document=JSON.parse(row.payload);document.records.sourcingCandidates[0].values.notes='concurrent reviewed note';h.sqlite.prepare('UPDATE operations_workspaces SET revision=revision+1,payload=? WHERE owner_id=? AND company_code=?').run(JSON.stringify(document),'unari-test',company.code);concurrent=workspace(h);};
  const rejected=await json(await h.post(input({captureId:'20000000-0000-4000-8000-000000000874',items:[candidate('700000000874')]})),409);assert.equal(rejected.ok,false);assert.equal(rejected.code,'OPERATIONS_CONFLICT');assert.deepEqual(workspace(h),concurrent);assert.equal(JSON.parse(workspace(h).payload).records.sourcingCandidates.length,1);
 }finally{h.close();}
});

test('atomic membership suspension prevents an already prepared batch from committing',async()=>{
 const h=api();try{
  h.state.beforeBatch=queries=>{if(queries.some(q=>q.sql.includes('INSERT INTO operations_workspaces')))h.sqlite.prepare("UPDATE members SET status='suspended' WHERE id=?").run('unari-test');};
  const rejected=await json(await h.post(),409);assert.equal(rejected.ok,false);assert.equal(rejected.code,'OPERATIONS_CONFLICT');assert.equal(h.stored().length,0);
 }finally{h.close();}
});

test('member change before write blocks the batch and keeps the original workspace',async()=>{
 const h=api();try{
  await json(await h.post());const before=h.stored(),access=h.load('app/managed-product-access.ts'),read=access.managedProductAccess;let calls=0;
  access.managedProductAccess=async()=>{if(++calls===2)h.state.user={...h.state.user,userId:'different-owner',membership:{...h.state.user.membership,id:'different-owner'}};return read();};
  const result=await json(await h.post(input({captureId:'20000000-0000-4000-8000-000000000874'})),409);assert.equal(result.code,'OPERATIONS_SCOPE_CHANGED');assert.equal(result.uncertain,false);assert.deepEqual(h.stored(),before);
 }finally{h.close();}
});

test('lost post-write scope confirmation reports uncertainty, and exact retry recovers the original receipt without another save',async()=>{
 const h=api();try{
  const original=h.state.user,access=h.load('app/managed-product-access.ts'),read=access.managedProductAccess;let calls=0;
  access.managedProductAccess=async()=>{if(++calls===4)h.state.user={...original,userId:'different-owner',membership:{...original.membership,id:'different-owner'}};return read();};
  const lost=await json(await h.post(),409);assert.equal(lost.ok,false);assert.equal(lost.code,'OPERATIONS_SCOPE_CHANGED');assert.equal(lost.uncertain,true);
  const saved=workspace(h);assert.equal(saved.revision,1);assert.equal(JSON.parse(saved.payload).records.sourcingCandidates.length,1);
  h.state.user=original;access.managedProductAccess=read;const recovered=await json(await h.post());assert.equal(recovered.ok,true);assert.equal(recovered.receipt.revision,1);assert.equal(recovered.receipt.storedCount,1);assert.deepEqual(workspace(h),saved);
 }finally{h.close();}
});

test('unreadable stored state and broken receipt fail closed without overwriting saved evidence',async()=>{
 const h=api();try{
  await json(await h.post());let saved=workspace(h),document=JSON.parse(saved.payload);document.records.jobs[0].values.receiptJson='invalid-json';h.sqlite.prepare('UPDATE operations_workspaces SET payload=?').run(JSON.stringify(document));const brokenReceipt=workspace(h);
  const rejected=await json(await h.post(),503);assert.equal(rejected.ok,false);assert.equal(rejected.uncertain,false);assert.deepEqual(workspace(h),brokenReceipt);
  h.sqlite.prepare("UPDATE operations_workspaces SET payload='broken-state'").run();saved=workspace(h);const broken=await json(await h.post(),503);assert.equal(broken.ok,false);assert.equal(broken.uncertain,false);assert.deepEqual(workspace(h),saved);
 }finally{h.close();}
});
