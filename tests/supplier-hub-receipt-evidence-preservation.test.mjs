import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {assetApiFixture,companies,plain,sha,module} from './helpers/supplier-hub-single-assets.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {submissionPackageUI} from './helpers/submission-package-ui.mjs';
import {supplierHubReceiptEvidenceRegression as extensionRegression,canObserveOriginalSupplierHubValidation,canObserveSupplierHubRegistration,resultKey} from '../extensions/supplier-hub/handoff-store.mjs';

const appPolicy=module('app/supplier-hub-receipt-evidence.ts');
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const fingerprint='a'.repeat(64),identity={origin:'http://localhost:3000',productId:'synthetic-evidence-716',categoryId:'81452',fingerprint};
const row=(skuId,patch={})=>({title:'합성 상품',submittedAt:'2026-10-01',category:'합성 계약',barcode:'',sourceQuotation:`YOOFAM-${fingerprint}.xlsx`,skuId,status:'검수중',stage:'검수',...patch});
function result(company=companies[0]){
 const observedAt=Date.now()-2000,quotationId='synthetic-evidence-quotation';
 return{...identity,state:'validation-complete',filename:`YOOFAM-${fingerprint}.xlsx`,company,includedOptions:2,quotationId,observedAt,registered:false,
  registration:{quotationId,scope:'queried-pages',pagesRead:1,hasMore:false,includedOptions:2,observedAt:observedAt+1,registered:false,rows:[row('known-sku-0'),row('known-sku-1')]}};
}
function regression(previous,kind){
 const next=structuredClone(previous);
 if(kind==='pending'){next.state='validation-pending';next.status='검증중';next.observedAt+=20;delete next.registration;}
 else{next.registration.observedAt+=20;next.registration.rows=kind==='missing'?next.registration.rows.slice(0,1):next.registration.rows.map(item=>({...item,skuId:'-'}));}
 return next;
}

for(const company of companies)test(`app/extension guards preserve known SKU evidence and retain explicit outcomes (${company.code})`,()=>{
 const previous=result(company),before=JSON.stringify(previous);
 for(const kind of ['pending','missing','placeholders']){
  const next=regression(previous,kind);assert.equal(appPolicy.supplierHubReceiptEvidenceRegression(previous,next),kind==='pending'?'pending':'sku-missing');
  assert.equal(extensionRegression(previous,next),appPolicy.supplierHubReceiptEvidenceRegression(previous,next));
  assert.throws(()=>appPolicy.assertSupplierHubReceiptEvidence(previous,next),/기존 결과를 유지/);
 }
 const pendingWithoutId=regression(previous,'pending');pendingWithoutId.quotationId='';
 assert.equal(extensionRegression(previous,pendingWithoutId),'pending');
 const rejected={...regression(previous,'pending'),state:'validation-rejected',detail:'명시적 파일 반려'};
 const changed=structuredClone(previous);changed.registration.observedAt+=20;changed.registration.rows[0].status='반려';changed.registration.rows[0].stage='상품 검수 반려';
 for(const next of [rejected,changed,{...regression(previous,'pending'),quotationId:'another-quotation'},
  {...regression(previous,'pending'),filename:`YOOFAM-${'b'.repeat(64)}.xlsx`},{...regression(previous,'pending'),company:companies.find(item=>item.code!==company.code)},
  {...regression(previous,'pending'),state:'not-found'}]){
  assert.equal(appPolicy.supplierHubReceiptEvidenceRegression(previous,next),null);assert.equal(extensionRegression(previous,next),null);
 }
 assert.equal(extensionRegression(previous,{...regression(previous,'pending'),fingerprint:'b'.repeat(64)}),null,'extension source identities never inherit evidence');
 const unissued={...previous,registration:{...previous.registration,rows:[row('-'),row('n/a')]}};
 assert.equal(appPolicy.supplierHubReceiptEvidenceRegression(unissued,regression(unissued,'pending')),null);
 assert.equal(JSON.stringify(previous),before);
});

// Run the actual extension's conditional writes in serialized inert IndexedDB
// transactions. This does not access Chrome or an installed extension profile.
function storeFixture(){
 const rows=new Map();let serial=Promise.resolve();
 const db={close(){},transaction(_name,mode){
  const operations=[],tx={objectStore:()=>({get(key){const request={};operations.push(()=>{request.result=structuredClone(rows.get(key));request.onsuccess?.();});return request;},put(value,key){assert.equal(mode,'readwrite');operations.push(()=>rows.set(key,structuredClone(value)));return{};}})};
  serial=serial.then(()=>{try{while(operations.length)operations.shift()();tx.oncomplete?.();}catch(error){tx.error=error;tx.onerror?.();}});return tx;
 }};
 const context=vm.createContext({Date,URL,TextEncoder,indexedDB:{open(){const request={};queueMicrotask(()=>{request.result=db;request.onsuccess?.();});return request;}}});
 vm.runInContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-store.mjs',import.meta.url),'utf8').replace(/export (const|async function|function) /g,'$1 '),context);
 return{record:(...args)=>context.transferRecord(...args),rows};
}
for(const company of companies)test(`extension transactions refuse pending and lost-SKU replacements but allow status/rejection (${company.code})`,async()=>{
 const f=storeFixture(),previous=result(company),key=resultKey(previous);await f.record('put',key,previous);
 for(const kind of ['pending','missing','placeholders']){
  const next=regression(previous,kind),action=kind==='pending'?'file-observe':'register';
  assert.equal(kind==='pending'?canObserveOriginalSupplierHubValidation(previous,next):canObserveSupplierHubRegistration(previous,next),false);
  await assert.rejects(f.record(action,key,{expected:previous,observation:next}));assert.deepEqual(plain(await f.record('get',key)),previous);
 }
 const changed=structuredClone(previous);changed.registration.observedAt+=25;changed.registration.rows[0].status='반려';
 assert.equal(await f.record('register',key,{expected:previous,observation:changed}),true);
 const stale={...previous,observedAt:previous.observedAt+30};
 assert.equal(await f.record('file-observe',key,{expected:previous,observation:stale}),false,'a stale file snapshot cannot erase a newer status receipt');
 const rejected={...regression(changed,'pending'),state:'validation-rejected',detail:'명시적 파일 반려'};
 assert.equal(await f.record('file-observe',key,{expected:changed,observation:rejected}),true);assert.equal((await f.record('get',key)).state,'validation-rejected');
});

async function fixture(company){
 const f=await assetApiFixture(company),{h}=f;
 const fields=(await json(await h.route(f.base+'/quotation-fields'+f.query))).resolved.schema.fields.map(field=>field.id),bytes=quotationWorkbook(fields),digest=sha(bytes),storageKey='owner/category-templates/'+digest+'.xlsx';
 h.objects.set(storageKey,bytes);
 await h.load('db/category-profiles.ts').updateCategoryProfile('owner',f.profile.id,f.profile.revision,{name:f.profile.name,categoryId:f.profile.categoryId,categoryPath:f.profile.categoryPath,hubSchema:f.snapshot,
  template:{name:'synthetic-evidence-716.xlsx',format:'xlsx',sha256:digest,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))});
 const source=await json(await h.route(f.base+'/quotation',{method:'POST',body:{action:'source',profileId:f.profile.id}}));
 const complete={...result(company),filename:source.filename};complete.registration.rows.forEach(item=>item.sourceQuotation=source.filename);
 const payload=value=>({profileId:f.profile.id,categoryId:f.profile.categoryId,fingerprint:source.fingerprint,result:value});
 const write=value=>h.route(f.base+'/supplier-hub-receipt',{method:'POST',body:payload(value)});
 const read=()=>h.route(f.base+'/supplier-hub-receipt?fingerprint='+source.fingerprint).then(json);
 const stable=()=>JSON.stringify(['products','product_content','product_options','product_quotation_fields','product_price_policy','collection_jobs','collection_context','category_profiles','workspace_settings'].map(name=>[name,h.sqlite.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));
 const snapshot=()=>h.load('app/exports/quotation-source.ts').readMappedQuotationSource('owner',f.id,f.profile.id);
 return{...f,source,complete,payload,write,read,stable,snapshot};
}

for(const company of companies)test(`current API preserves issued SKU receipts while explicit rejection and status changes remain writable (${company.code})`,async()=>{
 const f=await fixture(company),{h}=f;
 try{
  await json(await f.write(f.complete));const before=(await f.read()).receipt,source=f.stable(),files=JSON.stringify([...h.objects].map(([key,bytes])=>[key,sha(bytes)]));
  for(const kind of ['pending','missing','placeholders']){
   const response=await json(await f.write(regression(f.complete,kind)),400);assert.match(response.error,/기존 결과를 유지/);assert.deepEqual((await f.read()).receipt,before);
  }
  const equal=regression(f.complete,'missing');equal.registration.observedAt=f.complete.registration.observedAt;
  await json(await f.write(equal));assert.deepEqual((await f.read()).receipt,before,'equal-clock ignored observations keep existing idempotent acknowledgement');
  const changed=structuredClone(f.complete);changed.registration.observedAt+=40;changed.registration.rows[0].status='반려';changed.registration.rows[0].stage='검수 반려';
  await json(await f.write(changed));assert.equal((await f.read()).receipt.result.registration.rows[0].status,'반려');
  const rejected={...regression(changed,'pending'),state:'validation-rejected',detail:'명시적 파일 반려',observedAt:changed.registration.observedAt+10};
  await json(await f.write(rejected));assert.equal((await f.read()).receipt.result.state,'validation-rejected');
  assert.equal(f.stable(),source);assert.equal(JSON.stringify([...h.objects].map(([key,bytes])=>[key,sha(bytes)])),files);assert.equal(h.network.length,0);assert.equal(h.aiSources.length,0);
 }finally{f.close();}
});

for(const company of companies)for(const action of ['file','registration','track'])test(`UI ${action} lookup keeps the restored issued-SKU result when a fresh observation regresses (${company.code})`,async()=>{
 const f=await fixture(company),{h}=f;
 try{
  await json(await f.write(f.complete));const before=(await f.read()).receipt,next=regression(f.complete,action==='file'?'pending':'missing');
  const ui=submissionPackageUI({route:h.route,productId:f.id,profileId:f.profile.id,categoryId:f.profile.categoryId,...(action==='track'?{observations:[next]}:{lookupResults:[next]})});
  await ui.click('견적서 + 첨부 파일 준비');
  await ui.click(action==='file'?'Supplier Hub 검증 결과 불러오기':action==='registration'?'견적서 ID로 상품별 등록 상태 조회':'전송 결과 계속 확인');
  assert.match(JSON.stringify(ui.render()),/known-sku-1/);assert.ok(ui.alerts().some(message=>message.includes('기존 결과를 유지')));
  assert.deepEqual((await f.read()).receipt,before);assert.equal(ui.dispatches.length,0);assert.equal(h.network.length,0);
 }finally{f.close();}
});

for(const existing of [false,true])test(`SQLite receipt CAS cannot replace a ${existing?'changed':'newly inserted'} receipt after its snapshot read`,async()=>{
 const f=await fixture(companies[0]),{h}=f;
 try{
  const base=structuredClone(f.complete);base.registration.rows=base.registration.rows.slice(0,1);
  if(existing)await json(await f.write(base));
  const saved=await f.snapshot(),db=h.load('db/supplier-hub-receipts.ts'),candidate=existing?{...base,registration:{...base.registration,observedAt:base.registration.observedAt+50}}:regression(base,'pending');
  const competing={schemaVersion:1,evidence:'chrome-observation',profileId:f.profile.id,categoryId:f.profile.categoryId,fingerprint:f.source.fingerprint,productVersion:saved.product.updated_at,recordedAt:new Date().toISOString(),result:{...f.complete,registration:{...f.complete.registration,observedAt:f.complete.registration.observedAt+30}}};
  const original=h.bindings.DB.prepare;let raced=false;
  h.bindings.DB.prepare=sql=>{const query=original(sql),first=query.first;
   if(sql.includes('INSERT INTO supplier_hub_receipts'))query.first=async()=>{
    if(!raced){raced=true;h.sqlite.prepare('INSERT INTO supplier_hub_receipts VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,product_id,fingerprint) DO UPDATE SET observed_at=excluded.observed_at,evidence_order=excluded.evidence_order,payload=excluded.payload').run('owner',f.id,f.source.fingerprint,competing.result.registration.observedAt,500,JSON.stringify(competing));}
    return first();
   };return query;
  };
  const receipt={...competing,result:candidate};
  assert.equal(await db.saveSupplierHubReceipt('owner',f.id,receipt,saved.source,saved.state.revision),false);assert.equal(raced,true);
  assert.deepEqual((await f.read()).receipt,competing);assert.equal(h.network.length,0);
 }finally{f.close();}
});
