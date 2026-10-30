import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {managedProductHarness} from './helpers/managed-products.mjs';

function collector(){const h=managedProductHarness(),{DATASETS}=h.load('app/operations/types.ts'),api=h.load('app/operations/collector.ts'),snapshot={document:{schemaVersion:1,records:Object.fromEntries(DATASETS.map(k=>[k,[]]))},revision:1,scope:{ownerId:'owner',companyCode:'A01464742',companyName:'와이홉'},accountContext:'ctx',derived:{},updatedAt:null};return{h,...api,snapshot,add(dataset,id,values){snapshot.document.records[dataset].push({id,values,createdAt:'2026-01-01',updatedAt:'2026-01-01'});}};}
const plain=value=>JSON.parse(JSON.stringify(value));
const owned=rows=>({ok:true,status:'succeeded',companyCode:'A01464742',rows});

test('collector capabilities accept the shipped boolean map and legacy arrays without treating false or unknown entries as supported',()=>{
 const c=collector();try{
  assert.equal(c.supportsCollection({ok:true,capabilities:{inventory:true,statementConfirm:false}},'inventory'),true);
  assert.equal(c.supportsCollection({ok:true,capabilities:{inventory:true,statementConfirm:false}},'statementConfirm'),false);
  assert.equal(c.supportsCollection({ok:true,capabilities:{inventory:true}},'unknown-kind'),false);
  for(const value of [false,0,1,'true',null])assert.equal(c.supportsCollection({ok:true,capabilities:{inventory:value}},'inventory'),false);
  assert.equal(c.supportsCollection({ok:true,capabilities:['inventory','reviews']},'inventory'),true);
  assert.equal(c.supportsCollection({ok:true,capabilities:['inventory','reviews']},'statementConfirm'),false);
  assert.equal(c.supportsCollection({ok:true},'inventory'),true);
 }finally{c.h.close();}
});

test('statement selection excludes successful or unresolved receipts and exact queued-job sequence IDs',()=>{
 const c=collector();try{
  const exports={},code=ts.transpileModule(fs.readFileSync(new URL('../app/operations/components/logistics.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports,require:name=>name==='../types'?c.h.load('app/operations/types.ts'):name==='react'||name==='react/jsx-runtime'||name==='./shared'?{}:(()=>{throw Error('Unexpected module '+name);})()});
  const record=(id,status,seq=id)=>({id,values:{status,purchaseOrderSeq:seq},createdAt:'',updatedAt:''});
  const rows=[record('success','succeeded'),record('unknown','unknown'),record('pending','pending'),record('running','running'),record('korean','결과 불명'),record('queued','requested','000123'),record('different','requested','123'),record('legacy','requested','000456'),record('safe','failed','000789')];
  const jobs=[{id:'q',values:{kind:'statementConfirm',status:'queued',params:{purchaseOrderSeqs:['000123']}},createdAt:'',updatedAt:''},{id:'u',values:{kind:'statementConfirm',status:'unknown',purchaseOrderSeqs:['000456']},createdAt:'',updatedAt:''},{id:'read-only',values:{kind:'statements',status:'running',params:{purchaseOrderSeqs:['000789']}},createdAt:'',updatedAt:''}];
  const state=exports.statementApprovalState(rows,jobs);assert.deepEqual(plain(state.completed.map(r=>r.id)),['success']);assert.deepEqual(plain(state.unresolved.map(r=>r.id)),['unknown','pending','running','korean','queued','legacy']);assert.deepEqual(plain(state.eligible.map(r=>r.id)),['different','safe']);
 }finally{c.h.close();}
});

test('external IDs link only one explicit SKU, ambiguous rows retain diagnostics without contaminating other SKUs',()=>{
 const c=collector();try{
  c.add('skus','a',{name:'a',supplierSkuId:'0001',optionId:'same-option',barcode:'B1'});c.add('skus','b',{name:'b',supplierSkuId:'0002',optionId:'same-option',barcode:'B2'});
  const r=c.collectorRows('inbound',owned([{externalSkuId:'0001',date:'2026-01-01',qty:0},{optionId:'same-option',date:'2026-01-01',qty:10},{externalSkuId:'0001',barcode:'B2',date:'2026-01-01',qty:99}]),c.snapshot,{});
  assert.equal(r.datasets.inboundEvents.length,1);assert.equal(r.datasets.inboundEvents[0].skuId,'a');assert.equal(r.datasets.inboundEvents[0].qty,0);assert.equal(r.rejectedRows.length,2);assert.match(r.warnings[0],/2건/);assert.equal(r.rejectedRows[1].barcode,'B2');
 }finally{c.h.close();}
});

test('all financial collectors fail closed on missing or different company evidence',()=>{
 const c=collector();try{
  for(const kind of ['inventory','inbound','rocketSales','adMetrics','statements','statementConfirm'])for(const companyCode of [undefined,'A01526306'])assert.throws(()=>c.collectorRows(kind,{ok:true,rows:[],companyCode},c.snapshot,{}),/회사/);
  const publicRows=c.collectorRows('reviews',{ok:true,rows:[{rating:5}]},c.snapshot,{productId:'000123'});assert.equal(publicRows.datasets.reviews[0].productId,'000123');
 }finally{c.h.close();}
});

test('inventory creates one parent/child bundle, keeps zero vs null, and marks partial when unmatched rows exist',()=>{
 const c=collector();try{
  c.add('skus','a',{optionId:'00001'});c.add('skus','b',{optionId:'00002'});
  const r=c.collectorRows('inventory',owned([{optionId:'00001',stock:0},{optionId:'00002',stock:null},{optionId:'unmatched',stock:100}]),c.snapshot,{businessDate:'2026-01-31'});
  const parent=r.datasets.inventorySnapshots[0];assert.equal(parent.businessDate,'2026-01-31');assert.equal(parent.complete,false);assert.equal(r.datasets.inventoryLines.length,2);assert.ok(r.datasets.inventoryLines.every(row=>row.snapshotId===parent.id));assert.equal(r.datasets.inventoryLines[0].stock,0);assert.equal(r.datasets.inventoryLines[1].stock,null);assert.equal(r.rejectedRows[0].optionId,'unmatched');
 }finally{c.h.close();}
});

test('ad metrics require explicit unique campaign and resolve SKU from every supported external identifier',()=>{
 const c=collector();try{
  c.add('skus','sku',{supplierSkuId:'0001',barcode:'0002'});c.add('campaigns','campaign',{name:'c',externalId:'EXTERNAL'});c.add('campaigns','no-code',{name:'withoutcode'});
  const r=c.collectorRows('adMetrics',owned([{externalCampaignId:'EXTERNAL',supplierSkuId:'0001',cost:0},{externalCampaignId:'EXTERNAL',barcode:'0002',cost:10},{cost:999}]),c.snapshot,{});
  assert.equal(r.datasets.adMetrics.length,2);assert.ok(r.datasets.adMetrics.every(row=>row.campaignId==='campaign'&&row.skuId==='sku'));assert.equal(r.rejectedRows.length,1);assert.equal(r.rejectedRows[0].cost,999);
  c.add('campaigns','duplicate',{externalId:'EXTERNAL'});const ambiguous=c.collectorRows('adMetrics',owned([{externalCampaignId:'EXTERNAL',cost:10}]),c.snapshot,{});assert.equal(ambiguous.datasets.adMetrics.length,0);assert.equal(ambiguous.rejectedRows.length,1);
 }finally{c.h.close();}
});

test('unknown or cross-kind datasets and oversized results are rejected, diagnostics remain bounded',()=>{
 const c=collector();try{
  assert.throws(()=>c.collectorRows('reviews',{ok:true,datasets:{notADataSet:[]}},c.snapshot,{}),/종류/);
  assert.throws(()=>c.collectorRows('reviews',{ok:true,datasets:{expenses:[]}},c.snapshot,{}),/종류|유형|허용/);
  assert.throws(()=>c.collectorRows('reviews',{ok:true,rows:Array.from({length:5001},(_,i)=>({productId:'p',rating:5,reviewId:String(i)}))},c.snapshot,{}),/5,000/);
  c.add('skus','s',{supplierSkuId:'1'});const r=c.collectorRows('inbound',owned(Array.from({length:250},(_,i)=>({externalSkuId:'missing-'+i,qty:1}))),c.snapshot,{});assert.equal(r.rejectedRows.length,200);assert.match(r.warnings[0],/250건/);assert.deepEqual(plain(r.datasets.inboundEvents),[]);
 }finally{c.h.close();}
});
