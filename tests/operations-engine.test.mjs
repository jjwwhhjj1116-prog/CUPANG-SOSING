import test from 'node:test';
import assert from 'node:assert/strict';
import {managedProductHarness} from './helpers/managed-products.mjs';

const at='2026-10-30T10:00:00.000Z';
function engine(){const h=managedProductHarness(),e=h.load('app/operations/engine.ts');let doc=e.emptyOperationsDocument();return{...e,h,get doc(){return doc;},run(c,now=at){doc=e.applyOperationsCommand(doc,c,now);return doc;},add(ds,id,values){doc=e.applyOperationsCommand(doc,{type:'upsert',dataset:ds,id,values},at);return doc;},view(){return e.deriveOperations(doc,2026);}};}
const sku=(e,id='s',name='상품')=>e.add('skus',id,{name,supplierSkuId:'0001'+id,supplyPrice:8000,salePrice:11000,costPrice:5000});
const plain=x=>JSON.parse(JSON.stringify(x));

test('operations validates scalar values, dates and references before atomic import',()=>{
 const e=engine();try{sku(e);assert.equal(e.doc.records.skus[0].values.supplierSkuId,'0001s');
  for(const values of [{date:'2026-02-30',skuId:'s',qty:1},{date:'2026-13-01',skuId:'s',qty:1},{date:'2026-10-01',skuId:'missing',qty:1},{date:'2026-10-01',skuId:'s',qty:'Infinity'}])assert.throws(()=>e.add('inboundEvents','bad',values));
  const before=JSON.stringify(e.doc);assert.throws(()=>e.run({type:'import',dataset:'inboundEvents',rows:[{date:'2026-10-01',skuId:'s',qty:2},{date:'bad',skuId:'s',qty:2}]}));assert.equal(JSON.stringify(e.doc),before);
  assert.throws(()=>e.add('skus','weird',{name:'n',supplierSkuId:123}));
 }finally{e.h.close();}
});

test('workspace UTF-8 guard rejects documents before D1 row limits, including multibyte text',()=>{
 const e=engine();try{
  assert.equal(e.OPERATIONS_LIMIT,1_800_000);
  const command=(count,notes)=>({type:'import',dataset:'skus',rows:Array.from({length:count},(_,i)=>({id:'sku-'+i,name:'크기 시험 '+i,notes}))});
  e.run(command(90,'a'.repeat(19000)));
  const bytes=Buffer.byteLength(JSON.stringify(e.doc),'utf8');assert.ok(bytes<e.OPERATIONS_LIMIT&&bytes>1_700_000);
  const sizeError=error=>error.status===413&&error.code==='OPERATIONS_SIZE_LIMIT'&&/1,800,000/.test(error.message);
  const before=JSON.stringify(e.doc),extra=command(6,'a'.repeat(19000));extra.rows=extra.rows.map((r,i)=>({...r,id:'extra-'+i}));assert.throws(()=>e.run(extra),sizeError);assert.equal(JSON.stringify(e.doc),before);
  for(const [count,notes]of [[104,'a'.repeat(19000)],[106,'a'.repeat(19000)],[61,'가'.repeat(10000)]]){
   const input=command(count,notes);if(notes[0]==='가')assert.ok(JSON.stringify(input).length<e.OPERATIONS_LIMIT);
   assert.throws(()=>e.applyOperationsCommand(e.emptyOperationsDocument(),input,at),sizeError);
  }
 }finally{e.h.close();}
});

test('largest-remainder allocation preserves every won, sets and inspection target',()=>{
 const e=engine();try{sku(e,'a');sku(e,'b');e.add('importBatches','b',{date:'2026-01-10',fx:100,cnCost:1000,krCost:0,inspectionCost:500,extraCost:0});
  e.add('purchaseLines','a1',{batchId:'b',skuId:'a',qty:200,setQty:2,unitPrice:10,inspection:true});e.add('purchaseLines','b1',{batchId:'b',skuId:'b',qty:100,setQty:1,unitPrice:10});
  const rows=e.view().procurementCosts;assert.deepEqual(plain(rows.map(r=>r.allocatedChina)),[667,333]);assert.deepEqual(plain(rows.map(r=>r.allocatedInspection)),[500,0]);assert.equal(rows.reduce((a,r)=>a+r.totalCost,0),301500);assert.equal(rows[0].saleQty,100);
 }finally{e.h.close();}
});

test('monthly weighted average, full issue zero balance, subsidiary cogs exclusion and PNL linked',()=>{
 const e=engine();try{sku(e);e.add('openingBalances','o',{skuId:'s',year:2026,qty:10,amount:10000});e.add('importBatches','b',{date:'2026-01-10',fx:100});e.add('purchaseLines','p',{batchId:'b',skuId:'s',qty:10,setQty:1,unitPrice:20});
  e.add('sales','g',{date:'2026-01-20',type:'general',skuId:'s',qty:12,price:26400});e.add('sales','sub',{date:'2026-01-20',type:'subsidiary',skuId:'s',qty:3,price:4950});
  const jan=e.view().monthlyLedger[0];assert.equal(jan.unitCost,1500);assert.equal(jan.issueQty,15);assert.equal(jan.issueAmount,22500);assert.equal(jan.closingQty,5);assert.equal(jan.closingAmount,7500);assert.equal(jan.cogs,18000);assert.equal(e.view().pnl[0].revenue,24000);assert.equal(e.view().pnl[0].subsidiaryExcluded,4500);
  e.add('sales','last',{date:'2026-02-01',type:'general',skuId:'s',qty:5,price:11000});const feb=e.view().monthlyLedger[1];assert.equal(feb.closingQty,0);assert.equal(feb.closingAmount,0);assert.equal(feb.issueAmount,7500);
 }finally{e.h.close();}
});

test('observed stock zero and missing are distinct, inbound is scoped by SKU and channel',()=>{
 const e=engine();try{sku(e,'a');sku(e,'b');for(const [id,date]of [['before','2026-01-01'],['today','2026-01-02']])e.add('inventorySnapshots',id,{businessDate:date,complete:true});
  e.add('inventoryLines','l1',{snapshotId:'before',skuId:'a',stock:10});e.add('inventoryLines','l2',{snapshotId:'today',skuId:'a',stock:0});e.add('inventoryLines','l3',{snapshotId:'before',skuId:'b',stock:20});
  e.add('inboundEvents','i1',{date:'2026-01-02',skuId:'a',qty:5});e.add('inboundEvents','i2',{date:'2026-01-02',skuId:'b',qty:50});e.add('inboundEvents','warehouse',{date:'2026-01-02',skuId:'a',qty:100,kind:'purchase-receipt'});
  const rows=e.view().salesDaily.filter(r=>r.date==='2026-01-02');assert.equal(rows.find(r=>r.skuId==='a').estimatedSales,15);assert.equal(rows.find(r=>r.skuId==='b').estimatedSales,null);assert.equal(e.view().inventoryRows.find(r=>r.skuId==='b').stock,null);
 }finally{e.h.close();}
});

test('pending expenses are excluded, VAT exception and negative deductions affect PNL only once',()=>{
 const e=engine();try{e.add('expenses','x',{date:'2026-01-10',vendor:'A',categoryId:'cat-sga',total:11000});assert.equal(e.view().pnl[0].sga,0);e.run({type:'confirm-expenses',ids:['x']});assert.equal(e.view().pnl[0].sga,10000);
  e.add('expenses','x',{date:'2026-01-10',vendor:'A',categoryId:'cat-sga',total:11000,novat:true,status:'confirmed'});assert.equal(e.view().pnl[0].sga,11000);
  e.add('salesDeductions','d',{month:'2026-01',amount:-500});assert.equal(e.view().pnl[0].revenue,500);assert.equal(e.view().pnl[0].netProfit,-10500);
  e.add('expenses','pending',{date:'2026-01-11',vendor:'B',total:1100});assert.throws(()=>e.run({type:'confirm-expenses',ids:['pending']}),/항목/);
 }finally{e.h.close();}
});

test('approval-id import is idempotent and conflicting duplicate preserves confirmed row',()=>{
 const e=engine();try{const v={date:'2026-01-10',vendor:'A',categoryId:'cat-sga',total:11000,approvalNo:'A0001'};e.run({type:'import',dataset:'expenses',rows:[v]});const id=e.doc.records.expenses[0].id;e.run({type:'confirm-expenses',ids:[id]});e.run({type:'import',dataset:'expenses',rows:[v]});assert.equal(e.doc.records.expenses.length,1);assert.equal(e.doc.records.expenses[0].values.status,'confirmed');assert.throws(()=>e.run({type:'import',dataset:'expenses',rows:[{...v,total:22000}]}),/승인번호/);assert.equal(e.doc.records.expenses[0].values.total,11000);
 }finally{e.h.close();}
});

test('period close blocks move-in, move-out, delete, posting and opening balance changes',()=>{
 const e=engine();try{sku(e);e.add('sales','a',{date:'2026-01-10',type:'general',skuId:'s',qty:1,price:1100});e.run({type:'close-period',month:'2026-01'});
  assert.throws(()=>e.add('sales','a',{date:'2026-02-10',type:'general',skuId:'s',qty:1,price:1100}),/마감/);assert.throws(()=>e.run({type:'remove',dataset:'sales',id:'a'}),/마감/);assert.throws(()=>e.add('openingBalances','o',{skuId:'s',year:2026,qty:1,amount:100}),/마감/);
  assert.throws(()=>e.add('salesDeductions','d',{month:'2026-01',date:'2026-02-01',amount:100}),/마감/);
  assert.throws(()=>e.add('inventorySnapshots','snap',{businessDate:'2026-01-31',date:'2026-02-01',complete:true}),/마감/);
  assert.throws(()=>e.add('openingBalances','spoof',{skuId:'s',year:2026,date:'2027-01-01',qty:1,amount:100}),/마감/);
  e.run({type:'reopen-period',month:'2026-01'});e.run({type:'remove',dataset:'sales',id:'a'});assert.equal(e.doc.records.sales.length,0);
 }finally{e.h.close();}
});

test('partial order receipts preserve distinct events and retry idempotency',()=>{
 const e=engine();try{sku(e);e.add('purchaseOrders','p',{skuId:'s',orderDate:'2026-01-10',qty:10,status:'ordered'});
  const c={type:'receive-order',id:'p',values:{receivedDate:'2026-01-12',receivedQty:3,receiptId:'one'}};e.run(c);e.run(c);assert.equal(e.doc.records.inboundEvents.length,1);assert.equal(e.doc.records.purchaseOrders[0].values.receivedQty,3);assert.equal(e.doc.records.purchaseOrders[0].values.status,'partial');
  assert.throws(()=>e.run({type:'receive-order',id:'p',values:{receivedDate:'2026-01-13',receivedQty:8,receiptId:'bad'}}));e.run({type:'receive-order',id:'p',values:{receivedDate:'2026-01-13',receivedQty:7,receiptId:'two'}});assert.equal(e.doc.records.inboundEvents.length,2);assert.equal(e.doc.records.purchaseOrders[0].values.status,'received');
 }finally{e.h.close();}
});

test('candidate promotion links SKU and prevents duplicate creation, referenced master delete blocked',()=>{
 const e=engine();try{e.add('sourcingCandidates','c',{name:'원문',nameKo:'번역',offerId:'000123',url:'https://detail.1688.com/offer/123.html'});e.run({type:'promote-candidate',id:'c'});e.run({type:'promote-candidate',id:'c'});assert.equal(e.doc.records.skus.length,1);assert.equal(e.doc.records.skus[0].values.name,'번역');assert.equal(e.doc.records.sourcingCandidates[0].values.skuId,e.doc.records.skus[0].id);assert.throws(()=>e.run({type:'remove',dataset:'skus',id:e.doc.records.skus[0].id}),/사용 중/);
 }finally{e.h.close();}
});

test('campaign summaries use aggregate order CVR, weights cannot duplicate full SKU margin',()=>{
 const e=engine();try{sku(e);e.add('campaigns','c1',{name:'one'});e.add('campaigns','c2',{name:'two'});e.add('campaignSkus','l1',{campaignId:'c1',skuId:'s',weight:.6});assert.throws(()=>e.add('campaignSkus','l2',{campaignId:'c2',skuId:'s',weight:.5}),/배분/);e.add('campaignSkus','l2',{campaignId:'c2',skuId:'s',weight:.4});
  e.add('adMetrics','m1',{date:'2026-01-01',campaignId:'c1',skuId:'s',impressions:1000,clicks:100,cost:1000,revenue:5000,orders:10,units:20});e.add('adMetrics','m2',{date:'2026-01-02',campaignId:'c1',skuId:'s',impressions:1000,clicks:50,cost:500,revenue:2500,orders:5,units:10});const c=e.view().campaignSummaries.find(r=>r.id==='c1');assert.equal(c.cvr,10);assert.equal(c.roas,500);assert.equal(c.ctr,7.5);
 }finally{e.h.close();}
});

test('scheduled sales are excluded, dated SKU prices preserve previous history and jobs never pretend success',()=>{
 const e=engine();try{sku(e);e.add('sales','s',{date:'2026-01-01',type:'rocket',skuId:'s',qty:10,supply:1000,status:'scheduled'});assert.equal(e.view().pnl[0].revenue,0);
  e.add('skus','s',{name:'상품',supplierSkuId:'0001s',supplyPrice:9000,salePrice:11000,costPrice:5000,effectiveDate:'2026-11-01'});assert.equal(e.doc.records.skus[0].values.priceHistory.length,2);
  e.run({type:'queue-job',kind:'inventory',values:{date:'2026-10-30'}});assert.equal(e.doc.records.jobs[0].values.status,'queued');assert.throws(()=>e.run({type:'queue-job',kind:'inventory',values:{date:'2026-10-30'}}),/대기/);assert.throws(()=>e.add('jobs',e.doc.records.jobs[0].id,{kind:'inventory',status:'succeeded'}),/실제/);e.run({type:'cancel-job',id:e.doc.records.jobs[0].id});assert.equal(e.doc.records.jobs[0].values.status,'cancelled');
 }finally{e.h.close();}
});

test('collection snapshot and lines commit atomically, terminal retry never duplicates rows',()=>{
 const e=engine();try{sku(e);e.run({type:'queue-job',kind:'inventory',values:{businessDate:'2026-01-10'}});const id=e.doc.records.jobs[0].id;
  const bad={type:'ingest-collection',values:{kind:'inventory',jobId:id,resultStatus:'succeeded',datasets:{inventorySnapshots:[{id:'snap',businessDate:'2026-01-10',complete:true}],inventoryLines:[{snapshotId:'snap',skuId:'missing',stock:0}]}}};
  const before=JSON.stringify(e.doc);assert.throws(()=>e.run(bad),/연결/);assert.equal(JSON.stringify(e.doc),before);assert.equal(e.doc.records.jobs[0].values.status,'queued');
  const good={...bad,values:{...bad.values,datasets:{inventorySnapshots:[{id:'snap',businessDate:'2026-01-10',complete:true}],inventoryLines:[{snapshotId:'snap',skuId:'s',stock:0}]}}};e.run(good);e.run(good);assert.equal(e.doc.records.inventorySnapshots.length,1);assert.equal(e.doc.records.inventoryLines.length,1);assert.equal(e.doc.records.jobs[0].values.status,'succeeded');assert.equal(e.doc.records.jobs[0].values.resultVerified,true);assert.equal(e.view().inventoryRows[0].stock,0);
 }finally{e.h.close();}
});

test('collection kind boundary and result unknown cannot mutate business ledgers',()=>{
 const e=engine();try{e.run({type:'queue-job',kind:'reviews',values:{productId:'123'}});const jobId=e.doc.records.jobs[0].id;assert.throws(()=>e.run({type:'ingest-collection',values:{kind:'reviews',jobId,resultStatus:'succeeded',datasets:{expenses:[{date:'2026-01-01',vendor:'x',total:100}]}}}),/자료 종류/);assert.throws(()=>e.run({type:'ingest-collection',values:{kind:'reviews',jobId,resultStatus:'unknown',datasets:{reviews:[{productId:'123',rating:5}]}}}),/불명/);e.run({type:'ingest-collection',values:{kind:'reviews',jobId,resultStatus:'succeeded',datasets:{reviews:[]}}});assert.equal(e.doc.records.jobs[0].values.status,'succeeded');assert.equal(e.doc.records.reviews.length,0);
 }finally{e.h.close();}
});

test('blank optional tax columns infer supply, supplied tax takes precedence and keyword TTL scoped',()=>{
 const e=engine();try{e.add('expenses','total',{date:'2026-01-01',vendor:'A',total:11000,supply:'',vat:''});assert.equal(e.doc.records.expenses[0].values.supply,10000);e.add('expenses','provided-vat',{date:'2026-01-01',vendor:'B',total:11000,vat:500});assert.equal(e.doc.records.expenses[1].values.supply,10500);
  e.add('keywords','old',{seed:'x',keyword:'y',collectedAt:'2026-01-01T00:00:00Z'});assert.equal(e.doc.records.keywords.length,0);assert.equal(e.doc.records.expenses.length,2);
 }finally{e.h.close();}
});

test('UI inbound aliases preserve split event timestamps and outbound signs in actual sales estimation',()=>{
 const e=engine();try{sku(e);for(const [id,date,stock]of [['before','2026-01-01',10],['today','2026-01-02',10]]){e.add('inventorySnapshots',id,{businessDate:date,complete:true});e.add('inventoryLines',id,{snapshotId:id,skuId:'s',stock});}
  e.run({type:'import',dataset:'inboundEvents',rows:[{date:'2026-01-02',skuId:'s',type:'inbound',po:'P1',occurredAt:'2026-01-02T09:00:00',qty:5},{date:'2026-01-02',skuId:'s',type:'outbound',po:'P1',occurredAt:'2026-01-02T10:00:00',qty:2}]});
  assert.equal(e.doc.records.inboundEvents.length,2);assert.equal(e.doc.records.inboundEvents[1].values.kind,'return-out');assert.equal(e.doc.records.inboundEvents[1].values.poNumber,'P1');assert.equal(e.doc.records.inboundEvents[1].values.time,'2026-01-02T10:00:00');assert.equal(e.view().salesDaily.find(r=>r.date==='2026-01-02').estimatedSales,3);
  e.run({type:'import',dataset:'inboundEvents',rows:[{date:'2026-01-02',skuId:'s',type:'inbound',po:'P1',occurredAt:'2026-01-02T09:00:00',qty:5}]});assert.equal(e.doc.records.inboundEvents.length,2);
 }finally{e.h.close();}
});

test('plain candidate promotion carries YOOFAM sourceProductId without optional URL/offer fields',()=>{
 const e=engine();try{e.add('sourcingCandidates','candidate',{name:'수집 상품',sourceProductId:'managed-fixture-001'});e.run({type:'promote-candidate',id:'candidate'});assert.equal(e.doc.records.skus.length,1);assert.equal(e.doc.records.skus[0].values.sourceProductId,'managed-fixture-001');assert.equal(e.doc.records.skus[0].values.name,'수집 상품');
 }finally{e.h.close();}
});

test('financial ad aggregates prefer 14-day attribution without duplicating spend and retain fallback observations',()=>{
 const e=engine();try{sku(e);e.add('campaigns','c',{name:'광고'});e.add('campaignSkus','cs',{campaignId:'c',skuId:'s'});
  for(const [id,date,stock]of [['before','2026-01-01',10],['today','2026-01-02',8]]){e.add('inventorySnapshots',id,{businessDate:date,complete:true});e.add('inventoryLines',id,{snapshotId:id,skuId:'s',stock});}
  const metric={date:'2026-01-02',campaignId:'c',skuId:'s',placement:'search',keyword:'동일키워드',impressions:100,clicks:10,cost:100,orders:1,units:1};
  e.add('adMetrics','one',{...metric,attributionDays:1,revenue:1000});e.add('adMetrics','fourteen',{...metric,attributionDays:14,revenue:2000,orders:2});
  e.add('adMetrics','fallback',{...metric,keyword:'1일만존재',attributionDays:1,cost:50,revenue:500});e.add('adMetrics','legacy',{...metric,keyword:'귀속미지정',cost:25,revenue:250});
  assert.equal(e.doc.records.adMetrics.length,4);const view=e.view(),summary=view.campaignSummaries[0];assert.equal(summary.cost,175);assert.equal(summary.revenue,2750);assert.equal(summary.orders,4);assert.equal(summary.attributionPolicy,'14-day-preferred');
  assert.equal(view.salesDaily.find(r=>r.date==='2026-01-02').adCost,175);assert.equal(view.dailyMargins[0].adCost,175);assert.equal(view.dailyMargins[0].estimatedSales,2);
 }finally{e.h.close();}
});

test('inbound editor aliases replace retained canonical values while internal purchase receipts retain identity',()=>{
 const e=engine();try{sku(e);for(const [id,date]of [['before','2026-01-01'],['today','2026-01-02']]){e.add('inventorySnapshots',id,{businessDate:date,complete:true});e.add('inventoryLines',id,{snapshotId:id,skuId:'s',stock:10});}
  e.add('inboundEvents','event',{date:'2026-01-02',skuId:'s',type:'outbound',po:'P1',occurredAt:'2026-01-02T09:00:00',qty:2});
  assert.equal(e.view().salesDaily.find(r=>r.date==='2026-01-02').estimatedSales,-2);
  e.add('inboundEvents','event',{...e.doc.records.inboundEvents[0].values,type:'inbound',po:'P2',occurredAt:'2026-01-02T10:00:00'});
  const edited=e.doc.records.inboundEvents[0].values;assert.equal(edited.kind,'inbound');assert.equal(edited.poNumber,'P2');assert.equal(edited.time,'2026-01-02T10:00:00');assert.equal(e.view().salesDaily.find(r=>r.date==='2026-01-02').estimatedSales,2);
  e.add('inboundEvents','event',{...edited,occurredAt:''});assert.equal(e.doc.records.inboundEvents[0].values.time,'');
  e.add('purchaseOrders','order',{skuId:'s',orderDate:'2026-01-01',qty:3});e.run({type:'receive-order',id:'order',values:{receivedDate:'2026-01-02',receivedQty:3,receiptId:'one'}});
  const receipt=e.doc.records.inboundEvents.find(r=>r.values.kind==='purchase-receipt');e.add('inboundEvents',receipt.id,{...receipt.values,type:'outbound',po:'changed-visible-alias',occurredAt:'2026-01-02T12:00:00'});
  const kept=e.doc.records.inboundEvents.find(r=>r.id===receipt.id).values;assert.equal(kept.kind,'purchase-receipt');assert.equal(kept.poNumber,'order');assert.equal(kept.time,undefined);assert.equal(e.view().salesDaily.find(r=>r.date==='2026-01-02').estimatedSales,2);
 }finally{e.h.close();}
});
