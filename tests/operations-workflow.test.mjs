import test from 'node:test';
import assert from 'node:assert/strict';
import {managedProductHarness} from './helpers/managed-products.mjs';

// Private synthetic records only: execute the real route and its D1 SQL against SQLite.
// The harness has no remote fetch implementation, so these journeys cannot call suppliers.
async function workspace() {
 const h=managedProductHarness(),route=h.load('app/api/operations/route.ts');
 let current;
 const read=async response=>{
  assert.equal(response.status,200,await response.clone().text());
  return response.json();
 };
 const get=async()=>read(await route.GET(new Request('https://app.test/api/operations?year=2026')));
 const post=command=>route.POST(new Request('https://app.test/api/operations?year=2026',{
  method:'POST',headers:{'content-type':'application/json',origin:'https://app.test'},
  body:JSON.stringify({expectedRevision:current.revision,accountContext:current.accountContext,command}),
 }));
 current=await get();
 return {
  ...h,
  get snapshot(){return current;},
  async command(command){current=await read(await post(command));return current;},
  async add(dataset,id,values){return this.command({type:'upsert',dataset,id,values});},
  rows(dataset){return current.document.records[dataset];},
  value(dataset,id){const found=this.rows(dataset).find(row=>row.id===id);assert.ok(found,`${dataset}/${id} exists`);return found.values;},
  month(view,month='2026-01'){const found=current.derived[view].find(row=>row.month===month);assert.ok(found,`${view}/${month} exists`);return found;},
  async reject(command,status=409){
   const before=JSON.stringify(current.document),revision=current.revision;
   const persisted=this.sqlite.prepare('SELECT payload FROM operations_workspaces').get().payload;
   const response=await post(command);
   assert.equal(response.status,status,await response.clone().text());
   const latest=await get();
   assert.equal(latest.revision,revision,'rejected write does not consume a revision');
   assert.equal(JSON.stringify(latest.document),before,'rejected write leaves all source records intact');
   assert.equal(this.sqlite.prepare('SELECT payload FROM operations_workspaces').get().payload,persisted,'rejected transaction does not change stored JSON');
   current=latest;
  },
  async verifyReadBack(){
   const readBack=await get();
   assert.deepEqual(readBack,current,'GET recomputes the same views from saved SQLite data');
   const stored=this.sqlite.prepare('SELECT revision,payload FROM operations_workspaces').get();
   assert.equal(stored.revision,current.revision);
   assert.deepEqual(JSON.parse(stored.payload),current.document);
   assert.equal(this.state.calls.length,0,'no external collection or submission occurs');
  },
 };
}

test('candidate → shared SKU → procurement → reviewed expense → P&L and close/reopen persist together',async()=>{
 const w=await workspace();
 try {
  assert.equal(w.rows('skus').length,0,'fresh workspace contains no sample business records');
  await w.add('sourcingCandidates','candidate-001',{
   name:'Synthetic source item',nameKo:'검증 전용 상품',offerId:'000012345',
   sourceProductId:'managed-fixture-001',url:'https://source.example.test/offer/000012345',
   price:10,status:'제안 후보',memo:'Private workflow fixture; never submit externally.',
  });
  await w.command({type:'promote-candidate',id:'candidate-001'});
  const skuId=w.value('sourcingCandidates','candidate-001').skuId;
  assert.equal(typeof skuId,'string');
  assert.equal(w.value('skus',skuId).name,'검증 전용 상품','UI nameKo survives promotion');
  assert.equal(w.value('skus',skuId).sourceProductId,'managed-fixture-001','existing YOOFAM product link survives promotion');
  await w.command({type:'promote-candidate',id:'candidate-001'});
  assert.equal(w.rows('skus').length,1,'retrying candidate promotion reuses the shared SKU');
  await w.add('skus',skuId,{...w.value('skus',skuId),supplierSkuId:'00000001',barcode:'000000000001',optionId:'99999999999999999',costPrice:9999});
  assert.equal(w.value('skus',skuId).optionId,'99999999999999999','long marketplace IDs retain text precision');
  await w.add('openingBalances','opening-zero',{skuId,year:2026,qty:0,amount:0});
  await w.add('importBatches','january-import',{name:'검증 묶음',date:'2026-01-10',fx:100,cnCost:0,krCost:0,inspectionCost:0,extraCost:0});
  await w.add('purchaseLines','purchase-20',{batchId:'january-import',skuId,qty:20,setQty:1,unitPrice:10,agentFee:0,localShipping:0,inspection:false});
  const cost=w.snapshot.derived.procurementCosts.find(row=>row.id==='purchase-20');
  assert.equal(cost.buyAmount,20000);
  assert.equal(cost.saleQty,20);
  assert.equal(cost.totalCost,20000);
  assert.equal(cost.unitCost,1000,'accounting cost uses procurement, not the editable master estimate');

  await w.add('sales','general-five',{date:'2026-01-20',type:'general',skuId,qty:5,price:16500,supply:'',status:'confirmed'});
  await w.add('sales','subsidiary-two',{date:'2026-01-20',type:'subsidiary',skuId,qty:2,price:2200,company:'검증 자회사',status:'confirmed'});
  await w.add('expenses','review-first',{date:'2026-01-21',vendor:'검증 거래처',categoryId:'cat-sga',supply:2000,vat:200,total:2200,status:'pending',source:'manual'});
  assert.equal(w.month('pnl').sga,0,'unconfirmed expenses remain out of financial statements');
  assert.equal(w.month('pnl').netProfit,10000);
  await w.command({type:'confirm-expenses',ids:['review-first']});
  assert.equal(w.month('pnl').netProfit,8000,'15000 revenue − 5000 COGS − 2000 confirmed expense');
  await w.add('salesDeductions','refund',{month:'2026-01',code:'TEST-REFUND',name:'검증 환입',amount:-100});
  const pnl=w.month('pnl'),ledger=w.month('monthlyLedger');
  assert.equal(pnl.general,15000);
  assert.equal(pnl.subsidiaryExcluded,2000,'subsidiary supply is disclosed separately');
  assert.equal(pnl.revenue,15100);
  assert.equal(pnl.cogs,5000,'subsidiary physical issue is excluded from P&L COGS');
  assert.equal(pnl.sga,2000);
  assert.equal(pnl.netProfit,8100,'negative deduction is a refund, applied exactly once');
  assert.equal(ledger.buyQty,20);
  assert.equal(ledger.buyAmount,20000);
  assert.equal(ledger.issueQty,7);
  assert.equal(ledger.issueAmount,7000);
  assert.equal(ledger.closingQty,13);
  assert.equal(ledger.closingAmount,13000);
  assert.equal(ledger.cogs,pnl.cogs,'P&L and inventory ledger share the same cost source');
  assert.equal(w.snapshot.derived.costDetails.find(row=>row.categoryId==='cat-sga'&&row.month==='2026-01').amount,pnl.sga);
  await w.verifyReadBack();

  await w.command({type:'close-period',month:'2026-01'});
  await w.reject({type:'upsert',dataset:'sales',id:'general-five',values:{date:'2026-02-01',type:'general',skuId,qty:6,price:19800}});
  await w.reject({type:'import',dataset:'sales',rows:[
   {date:'2026-02-01',type:'other',name:'원자성 검증',qty:1,price:1100},
   {date:'2026-01-31',type:'other',name:'마감월 검증',qty:1,price:1100},
  ]});
  await w.reject({type:'upsert',dataset:'purchaseLines',id:'purchase-20',values:{batchId:'january-import',skuId,qty:20,setQty:1,unitPrice:11}});
  await w.reject({type:'remove',dataset:'expenses',id:'review-first'});
  assert.equal(w.month('pnl').netProfit,8100,'failed edits and partially valid imports cannot change a closed result');
  assert.equal(w.month('pnl','2026-02').revenue,0,'atomic import did not retain its valid first row');
  await w.command({type:'reopen-period',month:'2026-01'});
  await w.add('sales','general-five',{date:'2026-01-20',type:'general',skuId,qty:6,price:19800,status:'confirmed'});
  assert.equal(w.month('pnl').netProfit,10100,'reopened source correction recalculates financial statements');
  await w.verifyReadBack();
 } finally {w.close();}
});

test('sales sets, foreign/local costs and all four channels reconcile without counting cancelled or scheduled sales',async()=>{
 const w=await workspace();
 try {
  const skuId='set-sku';
  await w.add('skus',skuId,{name:'검증 2개 세트',supplierSkuId:'00000002'});
  await w.add('importBatches','set-batch',{name:'검증 세트 묶음',date:'2026-03-01',fx:100,cnCost:1000,krCost:2000,inspectionCost:500,extraCost:500});
  await w.add('purchaseLines','set-line',{batchId:'set-batch',skuId,qty:20,setQty:2,unitPrice:10,agentFee:10,localShipping:10,inspection:true});
  const cost=w.snapshot.derived.procurementCosts[0];
  assert.equal(cost.saleQty,10,'twenty pieces make ten saleable two-piece sets');
  assert.equal(cost.buyAmount,22000,'foreign agent and local shipping charges convert with the batch FX');
  assert.equal(cost.allocatedChina,1000);
  assert.equal(cost.allocatedDomestic,2000);
  assert.equal(cost.allocatedInspection,500);
  assert.equal(cost.allocatedExtra,500);
  assert.equal(cost.totalCost,26000);
  assert.equal(cost.unitCost,2600,'shared expenses allocate over saleable sets');
  await w.command({type:'import',dataset:'sales',rows:[
   {date:'2026-03-10',type:'general',skuId,qty:2,price:11000,status:'confirmed',externalId:'general-synthetic'},
   {date:'2026-03-10',type:'rocket',skuId,qty:3,supply:3000,status:'received',externalId:'rocket-synthetic'},
   {date:'2026-03-10',type:'subsidiary',skuId,qty:1,price:3300,company:'검증 자회사',externalId:'subsidiary-synthetic'},
   {date:'2026-03-10',type:'other',name:'검증 기타수입',qty:100,price:2200,externalId:'other-synthetic'},
   {date:'2026-03-10',type:'rocket',skuId,qty:99,supply:3000,status:'scheduled',externalId:'scheduled-synthetic'},
   {date:'2026-03-10',type:'rocket',skuId,qty:99,supply:3000,status:'cancelled',externalId:'cancelled-synthetic'},
  ]});
  await w.add('salesDeductions','march-deduction',{month:'2026-03',amount:1000,code:'TEST',name:'검증 공제'});
  await w.add('expenses','sga',{date:'2026-03-11',vendor:'검증 판관비',categoryId:'cat-sga',total:1100});
  await w.add('expenses','income',{date:'2026-03-11',vendor:'검증 영업외수익',categoryId:'cat-income',total:550});
  await w.add('expenses','nonvat',{date:'2026-03-11',vendor:'검증 환급미적용',categoryId:'cat-other',total:220,novat:true});
  await w.add('expenses','tax',{date:'2026-03-11',vendor:'검증 세금',categoryId:'cat-tax',total:110});
  await w.add('expenses','ignore',{date:'2026-03-11',vendor:'검증 제외경비',categoryId:'cat-sga',total:110000,status:'excluded'});
  await w.command({type:'confirm-expenses',ids:['sga','income','nonvat','tax']});
  const pnl=w.month('pnl','2026-03'),ledger=w.month('monthlyLedger','2026-03');
  assert.equal(pnl.general,10000,'general gross is a line total, not a unit price');
  assert.equal(pnl.rocket,9000,'rocket supply is per set and multiplies by received quantity');
  assert.equal(pnl.other,2000,'other gross is a line total regardless of displayed quantity');
  assert.equal(pnl.subsidiaryExcluded,3000);
  assert.equal(pnl.revenue,20000);
  assert.equal(ledger.issueQty,6,'only physical fulfilled SKU sales issue inventory');
  assert.equal(ledger.issueAmount,15600);
  assert.equal(ledger.closingQty,4);
  assert.equal(ledger.closingAmount,10400);
  assert.equal(pnl.cogs,13000,'five commercial sets count, one subsidiary set does not');
  assert.equal(pnl.grossProfit,7000);
  assert.equal(pnl.sga,1000);
  assert.equal(pnl.nonOperatingIncome,500);
  assert.equal(pnl.nonOperatingExpense,220,'VAT non-refund expense uses the gross total');
  assert.equal(pnl.tax,100);
  assert.equal(pnl.netProfit,6180);
  const actual=w.snapshot.derived.salesRows;
  assert.equal(actual.length,4,'pending and cancelled rocket records stay in source data but out of posted views');
  assert.equal(w.rows('sales').length,6);
  assert.equal(actual.filter(row=>row.type!=='subsidiary').reduce((sum,row)=>sum+row.netSupply,0)-pnl.deductions,pnl.revenue);
  assert.equal(w.snapshot.derived.monthlyLedger.filter(row=>row.month==='2026-03').reduce((sum,row)=>sum+row.cogs,0),pnl.cogs);
  await w.verifyReadBack();
 } finally {w.close();}
});

test('purchase receipts stay separate from supplier stock, outbound aliases and missing observations survive API persistence',async()=>{
 const w=await workspace();
 try {
  await w.add('skus','observed',{name:'검증 관측상품'});
  await w.add('skus','missing',{name:'검증 미수집상품'});
  await w.add('purchaseOrders','local-order',{skuId:'observed',orderDate:'2026-04-01',paymentDate:'2026-04-02',qty:20,receivedQty:0,status:'주문',unitPrice:10,fx:100});
  const receipt={type:'receive-order',id:'local-order',values:{receivedDate:'2026-04-10',receivedQty:20,receiptId:'synthetic-receipt-1'}};
  await w.command(receipt);
  await w.command(receipt);
  assert.equal(w.rows('inboundEvents').length,1,'the same physical receipt retry cannot double count');
  assert.equal(w.value('purchaseOrders','local-order').receivedQty,20);
  for(const [id,businessDate] of [['before','2026-04-09'],['after','2026-04-10']])
   await w.add('inventorySnapshots',id,{date:businessDate,businessDate,complete:true});
  await w.add('inventoryLines','before-observed',{snapshotId:'before',skuId:'observed',stock:10});
  await w.add('inventoryLines','after-observed',{snapshotId:'after',skuId:'observed',stock:0});
  await w.add('inventoryLines','before-missing',{snapshotId:'before',skuId:'missing',stock:10});
  // Use the manual UI contract, including aliases, rather than only engine-native fields.
  const outbound={date:'2026-04-10',skuId:'observed',type:'outbound',po:'PO-SYNTHETIC',occurredAt:'2026-04-10T10:00:00+09:00',qty:2};
  await w.command({type:'import',dataset:'inboundEvents',rows:[outbound]});
  await w.command({type:'import',dataset:'inboundEvents',rows:[outbound]});
  assert.equal(w.rows('inboundEvents').length,2,'supplier outbound aliases form a stable reimport identity');
  const observed=w.snapshot.derived.salesDaily.find(row=>row.date==='2026-04-10'&&row.skuId==='observed');
  assert.equal(observed.stock,0,'observed zero stock remains a real value');
  assert.equal(observed.inbound,-2,'outbound reduces supplier stock flow');
  assert.equal(observed.estimatedSales,8,'10 previous − 0 current − 2 outbound; local receipt is out of scope');
  const missing=w.snapshot.derived.salesDaily.find(row=>row.date==='2026-04-10'&&row.skuId==='missing');
  assert.equal(missing.estimatedSales,null,'an absent stock observation cannot become zero sales');
  assert.equal(w.snapshot.derived.inventoryRows.find(row=>row.skuId==='missing').stock,null);
  assert.equal(w.month('pnl','2026-04').revenue,0,'stock-based estimates and local receipts cannot post financial revenue');
  await w.verifyReadBack();
 } finally {w.close();}
});
