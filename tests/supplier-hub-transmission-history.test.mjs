import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const companies=[{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];
async function setup(company=companies[0]){
 const h=mobileIntakeHarness(company);
 const fields=['skuId','categoryId',...h.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id)];
 const workbook=quotationWorkbook(fields),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
 const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
 const selected=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 이력 검수',categoryId:'80719',categoryPath:h.context.category.categoryPath,
  template:{name:'synthetic-history.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
 h.context.category=selected;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
 const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
 const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload),images=h.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(row=>row.object_key);
 await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{model:'SYNTHETIC-HISTORY',material:'합성 검수'},assets:{main:[images[0]],additional:[images[1]],detail:[images[2]],label:[images[3]]}}}}));
 const fieldsView=await json(await h.route(base+'/quotation-fields'));
 await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:fieldsView.revision,expectedInputFingerprint:fieldsView.inputFingerprint,changes:[
  {fieldKey:'handlingReason',optionId:null,value:'해당사항없음'},{fieldKey:'packagedWeightG',optionId:null,value:'420'},
  {fieldKey:'packagedDimensionsMm',optionId:null,value:'100*200*300'},{fieldKey:'storageMaterial',optionId:null,value:''},
 ]}}));
 const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));assert.equal(preview.submissionReview.errorCount,0);
 const observedAt=Date.now(),pending={state:'validation-pending',filename:preview.filename,company:preview.report.company,includedOptions:6,observedAt,registered:false};
 const body=result=>({profileId:'cat',categoryId:'80719',fingerprint:preview.fingerprint,result});
 await json(await h.route(base+'/supplier-hub-receipt',{method:'POST',body:body(pending)}));
 const snapshot=()=>JSON.stringify(Object.fromEntries(['products','product_options','product_content','product_quotation_fields','collection_jobs','collection_context','collection_products'].map(table=>[table,h.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])));
 const change=async()=>{const next=await json(await h.route(base+'/content'));await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:next.content.revision,patch:{seo:{title:'수정한 초안 B — 수동 값'}}}}));return json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));};
 return {...h,product,base,preview,pending,body,snapshot,change};
}
// Recorded public source and real handlers/SQLite; no operating product or Hub upload.
for(const company of companies)test(`edited draft retains the prior pending receipt and only refreshes its history (${company.companyCode})`,async()=>{
 const h=await setup(company);try{
  const beforeReceipt=await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+h.preview.fingerprint));
  const edited=await h.change();assert.notEqual(edited.fingerprint,h.preview.fingerprint);
  const history=await json(await h.route(h.base+'/supplier-hub-receipt?mode=history'));assert.equal(history.history.blocked,true);assert.equal(history.history.receipts.length,1);
  const before=h.snapshot(),objects=[...h.objects].map(([key,bytes])=>[key,Buffer.from(bytes).toString('hex')]);
  const result={...h.pending,state:'validation-complete',quotationId:'fixture-quote-'+company.companyCode,observedAt:h.pending.observedAt+1000};
  const stored=await json(await h.route(h.base+'/supplier-hub-receipt',{method:'POST',body:{...h.body(result),action:'observe-history'}}));assert.equal(stored.historical,true);
  assert.equal(h.snapshot(),before);assert.deepEqual([...h.objects].map(([key,bytes])=>[key,Buffer.from(bytes).toString('hex')]),objects);
  const refreshed=await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+h.preview.fingerprint));assert.equal(refreshed.receipt.productVersion,beforeReceipt.receipt.productVersion);assert.equal(refreshed.receipt.result.quotationId,result.quotationId);
  assert.equal((await json(await h.route(h.base+'/supplier-hub-receipt?mode=history'))).history.blocked,true);
  assert.equal((await h.route(h.base+'/supplier-hub-receipt',{method:'POST',body:h.body({...result,observedAt:result.observedAt+1})})).status,409,'ordinary current-source writes remain pinned to draft B');
 }finally{h.close();}
});
test('only a proven file rejection without assigned IDs permits a new draft transmission',async()=>{
 const h=await setup();try{
  await h.change();const rejected={...h.pending,state:'validation-rejected',detail:'합성 파일 검증 반려',observedAt:h.pending.observedAt+1000};
  await json(await h.route(h.base+'/supplier-hub-receipt',{method:'POST',body:{...h.body(rejected),action:'observe-history'}}));
  const history=(await json(await h.route(h.base+'/supplier-hub-receipt?mode=history'))).history;assert.equal(history.blocked,false);
  const helper=h.load('app/supplier-hub-transmission-history.ts');assert.equal(helper.validateSupplierHubTransmissionHistory(history,h.product.id).blocked,false);
  assert.throws(()=>helper.validateSupplierHubTransmissionHistory({...history,blocked:true},h.product.id));
  assert.equal(helper.supplierHubReceiptAllowsNewTransmission({...history.receipts[0],result:{...rejected,quotationId:'assigned'}}),false);
 }finally{h.close();}
});
test('a newer rejected identity cannot hide an older pending identity; other owners remain isolated',async()=>{
 const h=await setup();try{
  const original=(await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+h.preview.fingerprint))).receipt;
  const fp='b'.repeat(64),rejected={...original,fingerprint:fp,result:{...original.result,state:'validation-rejected',filename:`YOOFAM-${fp}.xlsx`,observedAt:original.result.observedAt+1000}};
  h.sqlite.prepare('INSERT INTO supplier_hub_receipts VALUES(?,?,?,?,?,?)').run('owner',h.product.id,fp,rejected.result.observedAt,1000,JSON.stringify(rejected));
  h.sqlite.prepare('INSERT INTO supplier_hub_receipts VALUES(?,?,?,?,?,?)').run('other-owner',h.product.id,'c'.repeat(64),rejected.result.observedAt,1000,JSON.stringify({...rejected,fingerprint:'c'.repeat(64),result:{...rejected.result,filename:`YOOFAM-${'c'.repeat(64)}.xlsx`}}));
  const history=(await json(await h.route(h.base+'/supplier-hub-receipt?mode=history'))).history;assert.equal(history.blocked,true);assert.equal(history.receipts.length,2);
  assert.equal((await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+'c'.repeat(64)))).receipt,null);
 }finally{h.close();}
});
test('historical observations reject unknown identity, company changes, lost SKU evidence and changed product CAS',async()=>{
 const h=await setup();try{
  await h.change();let receipt=(await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+h.preview.fingerprint))).receipt;
  const base=h.snapshot(),stored=JSON.stringify(h.sqlite.prepare('SELECT * FROM supplier_hub_receipts').all());
  for(const patch of [{fingerprint:'d'.repeat(64)},{profileId:'wrong'},{categoryId:'wrong'},{result:{...h.pending,company:{code:'A01526306',name:'유앤채'}}},{result:{...h.pending,includedOptions:5}}]){
   const response=await h.route(h.base+'/supplier-hub-receipt',{method:'POST',body:{...h.body(h.pending),action:'observe-history',...patch}});assert.ok([400,409].includes(response.status));
  }
  assert.equal(h.snapshot(),base);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM supplier_hub_receipts').all()),stored);
  const complete={...h.pending,state:'validation-complete',quotationId:'history-quote',observedAt:h.pending.observedAt+1000,registration:{quotationId:'history-quote',scope:'visible-page',observedAt:h.pending.observedAt+1000,includedOptions:6,registered:false,rows:[{title:'합성 SKU',submittedAt:'2026-10-07',category:'합성 검수',barcode:'',sourceQuotation:h.pending.filename,skuId:'known-sku',status:'상품 검수중',stage:'검수'}]}};
  await json(await h.route(h.base+'/supplier-hub-receipt',{method:'POST',body:{...h.body(complete),action:'observe-history'}}));
  assert.equal((await h.route(h.base+'/supplier-hub-receipt',{method:'POST',body:{...h.body({...complete,observedAt:complete.observedAt+1,registration:{...complete.registration,observedAt:complete.registration.observedAt+1,rows:[]}}),action:'observe-history'}})).status,400);
  receipt=(await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+h.preview.fingerprint))).receipt;
  const current=h.sqlite.prepare('SELECT updated_at FROM products').get().updated_at;await h.change();
  const db=h.load('db/supplier-hub-receipts.ts');assert.equal(await db.saveHistoricalSupplierHubReceipt('owner',h.product.id,{...receipt,result:{...receipt.result,observedAt:receipt.result.observedAt+2000,registration:{...receipt.result.registration,observedAt:receipt.result.registration.observedAt+2000}}},receipt,current),false);
  const after=(await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+h.preview.fingerprint))).receipt;assert.equal(after.result.registration.rows[0].skuId,'known-sku');
 }finally{h.close();}
});
test('an invalid history row never appears as an empty permissive history',async()=>{
 const h=await setup();try{
  h.sqlite.prepare('UPDATE supplier_hub_receipts SET payload=?').run('{broken');
  const response=await h.route(h.base+'/supplier-hub-receipt?mode=history');assert.equal(response.status,503);
  const body=await response.json();assert.equal(body.history,undefined);
 }finally{h.close();}
});

for(const company of companies)test(`historical SKU placeholders can become issued IDs while preserving assigned IDs (${company.companyCode})`,async()=>{
 const h=await setup(company);try{
  const original=(await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+h.preview.fingerprint))).receipt;
  await h.change();const sources=h.snapshot();
  const quotationId='placeholder-quote-'+company.companyCode,observedAt=h.pending.observedAt+1000;
  const placeholders=['-','—','n/a','미표시','해당사항없음','partial…'];
  const row=skuId=>({title:'합성 SKU',submittedAt:'2026-10-07',category:'합성 검수',barcode:'',sourceQuotation:h.pending.filename,skuId,status:'상품 검수중',stage:'검수'});
  const complete={...h.pending,state:'validation-complete',quotationId,observedAt,registration:{quotationId,scope:'visible-page',observedAt,includedOptions:6,registered:false,rows:placeholders.map(row)}};
  const observe=result=>h.route(h.base+'/supplier-hub-receipt',{method:'POST',body:{...h.body(result),action:'observe-history'}});
  await json(await observe(complete));
  const issued={...complete,observedAt:observedAt+1000,registration:{...complete.registration,observedAt:observedAt+1000,rows:placeholders.map((_,index)=>row('issued-sku-'+index))}};
  await json(await observe(issued));
  const refreshed=(await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+h.preview.fingerprint))).receipt;
  assert.deepEqual(refreshed.result.registration.rows.map(row=>row.skuId),issued.registration.rows.map(row=>row.skuId));
  assert.equal(refreshed.productVersion,original.productVersion);assert.equal(refreshed.fingerprint,original.fingerprint);assert.equal(h.snapshot(),sources);
  const lost={...issued,observedAt:issued.observedAt+1000,registration:{...issued.registration,observedAt:issued.registration.observedAt+1000,rows:issued.registration.rows.map((value,index)=>index===0?{...value,skuId:'-'}:value)}};
  assert.equal((await observe(lost)).status,400);
  assert.deepEqual((await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+h.preview.fingerprint))).receipt,refreshed);
 }finally{h.close();}
});

for(const company of companies)test(`receipt key A with payload B cannot read or refresh B through A (${company.companyCode})`,async()=>{
 const h=await setup(company);try{
  const original=(await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+h.preview.fingerprint))).receipt;
  const edited=await h.change();assert.notEqual(edited.fingerprint,h.preview.fingerprint);
  const pendingB={...original,fingerprint:edited.fingerprint,productVersion:h.sqlite.prepare('SELECT updated_at FROM products').get().updated_at,
   result:{...original.result,filename:edited.filename,observedAt:original.result.observedAt+1000}};
  const payloadB=JSON.stringify(pendingB);
  h.sqlite.prepare('INSERT INTO supplier_hub_receipts VALUES(?,?,?,?,?,?)').run('owner',h.product.id,pendingB.fingerprint,pendingB.result.observedAt,0,payloadB);
  h.sqlite.prepare('UPDATE supplier_hub_receipts SET payload=? WHERE owner_id=? AND product_id=? AND fingerprint=?').run(payloadB,'owner',h.product.id,h.preview.fingerprint);
  const receipts=JSON.stringify(h.sqlite.prepare('SELECT * FROM supplier_hub_receipts ORDER BY fingerprint').all()),sources=h.snapshot();
  const objects=[...h.objects].map(([key,bytes])=>[key,Buffer.from(bytes).toString('hex')]);
  const read=await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+h.preview.fingerprint),503);assert.equal(read.receipt,undefined);
  const result={...pendingB.result,state:'validation-complete',quotationId:'must-not-attach-to-B',observedAt:pendingB.result.observedAt+1000};
  const refresh=await json(await h.route(h.base+'/supplier-hub-receipt',{method:'POST',body:{...h.body(result),action:'observe-history'}}),503);
  assert.equal(refresh.saved,undefined);assert.equal(refresh.fingerprint,undefined);
  const untouchedB=await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+pendingB.fingerprint));assert.deepEqual(untouchedB.receipt,pendingB);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM supplier_hub_receipts ORDER BY fingerprint').all()),receipts,'both original A and valid B rows remain byte-for-byte unchanged');
  assert.equal(h.snapshot(),sources);assert.deepEqual([...h.objects].map(([key,bytes])=>[key,Buffer.from(bytes).toString('hex')]),objects);
 }finally{h.close();}
});
