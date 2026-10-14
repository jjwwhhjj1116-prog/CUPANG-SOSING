import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {singlePacket,SINGLE_SENDER,SINGLE_COMPANIES} from './helpers/supplier-hub-single-document.mjs';
import {singleDocumentIdentity} from '../extensions/supplier-hub/single-document.mjs';

const version='2026-10-01T00:00:00.000Z',observedAt=Date.parse('2026-10-14T01:00:00.000Z');
async function fixture(company=SINGLE_COMPANIES[0]){
  const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
  await h.load('db/queries.ts').insertProduct({id:'product',owner_id:'owner',source_url:h.sourceUrl,title:'기존 작업 유지',source_price_cny:1,exchange_rate:350,supply_margin:50,coupang_margin:40,supply_price:3000,sale_price:5000,msrp:6500,options_count:1,
    seo_status:'대기',image_status:'대기',quote_status:'대기',registration_status:'검토 중',supplier_hub_status:'미전송',image_keys:'[]',goal_stage:'price',created_at:version,updated_at:version});
  const model=h.load('db/product-removals.ts');await model.readProductRemovalPolicies('owner',[{id:'product'}]);
  return {h,model,company,close:()=>h.close()};
}
async function nativeRow(f,state='rejected',requestId='native-request',changes={}){
  const packet=singlePacket(f.company);packet.ownerId='owner';packet.productId='product';packet.requestId=requestId;packet.source.productVersion=version;
  packet.accountContext=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['sourceflow-managed-product-account-v1','owner',f.company.code,f.company.name])))).toString('hex');
  const ctx=await singleDocumentIdentity(packet,SINGLE_SENDER),docId='owned-doc-'+requestId,sourceStatus={pending:'SUBMITTED',accepted:'FINISHED',rejected:'REJECTED'}[state];
  const receipt={state,docId,company:f.company,identityDigest:ctx.identityDigest,preparedBodySha256:ctx.bodySha256,observedAt,receiptId:'raw-qvt-'+requestId,qvtRequestId:'raw-qvt-'+requestId,sourceStatus,evidence:'document-receipt',registered:false};
  const record={format:'yoofam-single-receipt-v1',evidence:'chrome-observation',productId:'product',profileId:packet.profileId,optionId:packet.optionId,categoryId:packet.categoryId,fingerprint:packet.fingerprint,schemaSha256:packet.schemaSha256,
    source:packet.source,company:f.company,requestId,docId,identity:ctx.identity,identityDigest:ctx.identityDigest,packetDigest:ctx.packetDigest,originalBodySha256:ctx.originalBodySha256,preparedBodySha256:ctx.bodySha256,receipt,registered:false,recordedAt:new Date(observedAt+1).toISOString(),...changes};
  f.h.load('app/supplier-hub-single-receipt.ts').parseStoredSingleReceipt(JSON.stringify(record));
  return {owner_id:'owner',product_id:'product',request_id:requestId,observed_at:receipt.observedAt,payload:JSON.stringify(record),created_at:record.recordedAt};
}
function insert(f,row){f.h.sqlite.prepare('INSERT INTO supplier_hub_single_receipts(owner_id,product_id,request_id,observed_at,payload,created_at) VALUES(?,?,?,?,?,?)')
  .run(row.owner_id,row.product_id,row.request_id,row.observed_at,row.payload,row.created_at);}
const policies=async f=>(await f.model.readProductRemovalPolicies('owner',[{id:'product'}])).product;
const snapshot=f=>JSON.stringify(Object.fromEntries(f.h.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'product_removals' ORDER BY name").all()
  .map(({name})=>[name,f.h.sqlite.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()])));
function beforeRemoval(f,callback){const original=f.h.db.prepare;f.h.db.prepare=sql=>{const query=original(sql),first=query.first;
  if(sql.trim().startsWith('INSERT INTO product_removals'))query.first=async()=>{f.h.db.prepare=original;await callback();return first.call(query);};return query;};}

for(const state of ['pending','accepted'])test(`stored native ${state} blocks removal independently of the latest draft or legacy bulk summary`,async()=>{
  for(const company of SINGLE_COMPANIES){const f=await fixture(company);try{insert(f,await nativeRow(f,state));const before=snapshot(f),policy=await policies(f);
    assert.equal(policy.blocked,true);assert.equal(policy.code,'PRODUCT_HUB_TRANSMITTED');assert.equal(policy.receipt,null);assert.equal(policy.singleReceipt.state,state);
    assert.equal(f.h.load('app/product-removal-policy.ts').productRemovalDecision({removal_policy:policy}).code,'PRODUCT_HUB_TRANSMITTED');assert.equal(await f.model.removeProduct('owner','product',version),null);assert.equal(snapshot(f),before);
  }finally{f.close();}}
});

test('only fully validated rejected native history allows soft removal and preserves every source/receipt byte',async()=>{
  const f=await fixture();try{insert(f,await nativeRow(f));const before=snapshot(f),policy=await policies(f);assert.equal(policy.blocked,false);assert.equal(policy.singleReceipt.state,'rejected');
    const removed=await f.model.removeProduct('owner','product',version);assert.ok(removed);assert.equal(snapshot(f),before);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM product_removals').get().n,1);
  }finally{f.close();}
});

test('later native rejection cannot erase an earlier accepted transmission in all-history removal evidence',async()=>{
  const f=await fixture();try{insert(f,await nativeRow(f,'accepted','native-old'));insert(f,await nativeRow(f,'rejected','native-new'));
    const before=snapshot(f),policy=await policies(f);assert.equal(policy.blocked,true);assert.equal(policy.singleReceipt.state,'accepted');assert.equal(await f.model.removeProduct('owner','product',version),null);assert.equal(snapshot(f),before);
  }finally{f.close();}
});

for(const state of ['pending','accepted','malformed'])test(`atomic removal refuses native ${state} inserted after an empty verified snapshot`,async()=>{
  const f=await fixture();try{assert.equal((await policies(f)).blocked,false);const row=state==='malformed'?{owner_id:'owner',product_id:'product',request_id:'native-bad',observed_at:1,payload:'{}',created_at:version}:await nativeRow(f,state);let after;
    beforeRemoval(f,()=>{insert(f,row);after=snapshot(f);});assert.equal(await f.model.removeProduct('owner','product',version),null);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM product_removals').get().n,0);assert.equal(snapshot(f),after);assert.equal((await policies(f)).blocked,true);
  }finally{f.close();}
});

test('a reviewed rejected tuple cannot delete after the same request becomes pending',async()=>{
  const f=await fixture();try{const rejected=await nativeRow(f),pending=await nativeRow(f,'pending');insert(f,rejected);assert.equal((await policies(f)).blocked,false);let after;
    beforeRemoval(f,()=>{f.h.sqlite.prepare('UPDATE supplier_hub_single_receipts SET observed_at=?,payload=? WHERE owner_id=? AND product_id=? AND request_id=?').run(pending.observed_at,pending.payload,'owner','product',rejected.request_id);after=snapshot(f);});
    assert.equal(await f.model.removeProduct('owner','product',version),null);assert.equal(snapshot(f),after);assert.equal((await policies(f)).code,'PRODUCT_HUB_TRANSMITTED');
  }finally{f.close();}
});

test('cross-owner native evidence is not read or included in the owned atomic removal guard',async()=>{
  const f=await fixture();try{const row=await nativeRow(f,'accepted');row.owner_id='another-owner';insert(f,row);assert.equal((await policies(f)).blocked,false);const before=snapshot(f);assert.ok(await f.model.removeProduct('owner','product',version));assert.equal(snapshot(f),before);
  }finally{f.close();}
});

test('malformed payloads and mismatched native storage metadata never grant deletion',async()=>{
  for(const change of [row=>{row.payload='{}';},row=>{row.request_id='different-request';},row=>{row.observed_at+=1;},row=>{row.created_at='invalid-date';}]){const f=await fixture();try{const row=await nativeRow(f);change(row);insert(f,row);const before=snapshot(f);assert.equal((await policies(f)).code,'PRODUCT_HUB_EVIDENCE_UNCONFIRMED');assert.equal(await f.model.removeProduct('owner','product',version),null);assert.equal(snapshot(f),before);}finally{f.close();}}
});

test('native history read failure fails closed instead of becoming an empty removable history',async()=>{
  const f=await fixture();try{const original=f.h.db.prepare;f.h.db.prepare=sql=>{if(sql.includes('FROM supplier_hub_single_receipts'))throw Error('synthetic native read unavailable');return original(sql);};
    assert.equal((await policies(f)).code,'PRODUCT_HUB_EVIDENCE_UNCONFIRMED');await assert.rejects(f.model.removeProduct('owner','product',version));assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM product_removals').get().n,0);f.h.db.prepare=original;
  }finally{f.close();}
});

test('more than 200 valid rejected native rows exceeds the full-history permission bound',async()=>{
  const f=await fixture();try{for(let index=0;index<201;index++)insert(f,await nativeRow(f,'rejected','native-history-'+index));const before=snapshot(f);assert.equal((await policies(f)).code,'PRODUCT_HUB_EVIDENCE_UNCONFIRMED');assert.equal(await f.model.removeProduct('owner','product',version),null);assert.equal(snapshot(f),before);
  }finally{f.close();}
});

test('native positive summary protects consumers even without a policy, while malformed summaries cannot grant permission',async()=>{
  const h=mobileIntakeHarness(),f={h,company:SINGLE_COMPANIES[0]};try{
    const row=await nativeRow(f,'accepted'),model=h.load('app/supplier-hub-single-receipt.ts'),single=model.singleReceiptSummary(model.parseStoredSingleReceipt(row.payload),row.created_at),policy=h.load('app/product-removal-policy.ts');
    assert.equal(policy.productRemovalDecision({hub_single_receipt:single}).code,'PRODUCT_HUB_TRANSMITTED');
    assert.equal(policy.productRemovalDecision({hub_single_receipt:single,removal_policy:{blocked:false,code:null,reason:'',receipt:null}}).code,'PRODUCT_HUB_TRANSMITTED');
    assert.equal(policy.productRemovalDecision({removal_policy:{blocked:true,code:'PRODUCT_HUB_TRANSMITTED',reason:policy.PRODUCT_HUB_REMOVAL_REASON,receipt:null,singleReceipt:single}}).code,'PRODUCT_HUB_TRANSMITTED');
    assert.equal(policy.productRemovalDecision({removal_policy:{blocked:false,code:null,reason:'',receipt:null,singleReceipt:{...single,state:'rejected'}}}).code,'PRODUCT_HUB_EVIDENCE_UNCONFIRMED');
  }finally{h.close();}
});
