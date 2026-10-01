import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {submissionPackageUI} from './helpers/submission-package-ui.mjs';

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const companies=[{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];
async function setup(company=companies[0]){
 const h=mobileIntakeHarness(company);
 const fields=['skuId','categoryId',...h.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id)];
 const workbook=quotationWorkbook(fields),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
 const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
 const selected=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 전송 결과 시험',categoryId:'80719',categoryPath:h.context.category.categoryPath,
  template:{name:'synthetic.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
 // Recorded 813724 facts + observed 80719 form contract only: no commercial classification or remote Hub write.
 h.context.category=selected;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
 const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
 const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload),images=h.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(row=>row.object_key);
 await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{model:'TEST-MODEL',material:'나일론'},assets:{main:[images[0]],additional:[images[1]],detail:[images[2]],label:[images[3]]}}}}));
 const view=await json(await h.route(base+'/quotation-fields'));
 await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[
  {fieldKey:'handlingReason',optionId:null,value:'해당사항없음'},{fieldKey:'packagedWeightG',optionId:null,value:'420'},
  {fieldKey:'packagedDimensionsMm',optionId:null,value:'100*200*300'},{fieldKey:'storageMaterial',optionId:null,value:''},
 ]}}));
 const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));assert.equal(preview.submissionReview.errorCount,0);
 const observedAt=Date.now(),result={state:'validation-complete',filename:preview.filename,company:preview.report.company,includedOptions:6,quotationId:'local-quote-'+company.companyCode,observedAt,registered:false};
 const rows=Array.from({length:6},(_,i)=>({title:'검토 상품 '+i,submittedAt:'2026-10-01',category:'합성 폼 시험',barcode:'',sourceQuotation:preview.filename,skuId:'sku-'+i,status:'상품 검수중',stage:'가격/정책'}));
 const registration={quotationId:result.quotationId,scope:'queried-pages',pagesRead:2,hasMore:false,includedOptions:6,observedAt,registered:false,rows};
 const payload=value=>({profileId:'cat',categoryId:'80719',fingerprint:preview.fingerprint,result:value});
 const write=value=>h.route(base+'/supplier-hub-receipt',{method:'POST',body:payload(value)});
 return {...h,product,base,preview,result,registration,write,payload};
}
function renderBoard(products){
 const native=createRequire(import.meta.url),exports={};
 function load(file){const value={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:value,require:name=>name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name)});return value;}
 Object.assign(exports,load('app/components/registration-board.tsx'));
 return renderToStaticMarkup(createElement(exports.RegistrationBoard,{products,selected:new Set(),onSelected(){},onOpen(){},loading:false,error:'',onArchive(){}}));
}
for(const company of companies)test(`reviewed URL draft → transmission → persisted receipt → refresh preserves all six SKU results (${company.companyCode})`,async()=>{
 const h=await setup(company);
 try{
  const before=h.sqlite.prepare('SELECT * FROM products').get(),fingerprint=h.preview.fingerprint;
  const ui=submissionPackageUI({route:h.route,productId:h.product.id,observations:[h.result,{...h.result,registration:h.registration}]});
  await ui.click('견적서 + 첨부 파일 준비');ui.choose();await ui.click('등록 전송');assert.deepEqual(ui.alerts(),[]);
  assert.equal(ui.calls.filter(call=>call.action==='transmit').length,1);
  const stored=await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+fingerprint));
  assert.equal(stored.receipt.evidence,'chrome-observation');assert.equal(stored.receipt.result.registered,false);assert.equal(stored.receipt.result.registration.rows.length,6);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM products').get(),before,'receipt cannot rewrite any editable draft/version/status');
  const current=await json(await h.route(h.base+'/quotation',{method:'POST',body:{action:'source'}}));assert.equal(current.fingerprint,fingerprint);
  const listed=await json(await h.load('app/api/products/route.ts').GET()),summary=listed.products[0].hub_receipt;
  assert.equal(summary.label,'SKU ID 확인');assert.equal(summary.issuedSkus,6);assert.equal(summary.company.code,company.companyCode);assert.equal(summary.quotationId,h.result.quotationId);
  const html=renderBoard(listed.products);assert.match(html,/최근 전송한 견적서 기준/);assert.match(html,/SKU ID 확인/);assert.match(html,/SKU 6\/6개/);assert.ok(html.includes(h.result.quotationId));assert.ok(!html.includes('등록완료'));
  ui.remount();await ui.click('견적서 + 첨부 파일 준비');assert.equal(ui.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);assert.equal(ui.calls.filter(call=>call.action==='transmit').length,1);
  const detail=await json(await h.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test'+h.base),{params:Promise.resolve({id:h.product.id})}));assert.deepEqual(detail.product.hub_receipt,summary);
 }finally{h.close();}
});
for(const company of companies)test(`server outage and failed refresh preserve the six-SKU receipt without another upload (${company.companyCode})`,async()=>{
 const h=await setup(company);try{
  let unavailable=false;
  const route=async(path,init)=>unavailable&&path.includes('/supplier-hub-receipt')?Response.json({error:'시험 서버 일시 저장 실패'},{status:503}):h.route(path,init);
  const ui=submissionPackageUI({route,productId:h.product.id,observations:[h.result,{...h.result,registration:h.registration}]});
  await ui.click('견적서 + 첨부 파일 준비');ui.choose();await ui.click('등록 전송');
  const before=h.sqlite.prepare('SELECT * FROM products').get(),payload=h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts').get().payload;
  unavailable=true;ui.remount();await ui.click('견적서 + 첨부 파일 준비');
  assert.equal(ui.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);
  assert.equal(ui.button('견적서 ID로 상품별 등록 상태 조회').props.disabled,false);
  assert.ok(JSON.stringify(ui.render()).includes('sku-5'));
  ui.setLookupError(true);await ui.click('견적서 ID로 상품별 등록 상태 조회');
  assert.ok(JSON.stringify(ui.render()).includes('sku-5'));assert.ok(ui.alerts().includes('SKU 조회 응답 유실'));
  assert.equal(ui.button('견적서 ID로 상품별 등록 상태 조회').props.disabled,false);
  unavailable=false;ui.setLookupError(false);await ui.click('견적서 ID로 상품별 등록 상태 조회');assert.deepEqual(ui.alerts(),[]);
  const stored=await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+h.preview.fingerprint));
  assert.equal(stored.receipt.result.registration.rows.length,6);assert.equal(stored.receipt.result.registered,false);
  assert.equal(h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts').get().payload,payload);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM products').get(),before);
  assert.equal(ui.calls.filter(call=>call.action==='transmit').length,1);
  assert.equal(ui.calls.filter(call=>call.action==='export').length,1);
  assert.equal(ui.calls.filter(call=>call.action==='prepare').length,0);
 }finally{h.close();}
});

test('older responses and equal-clock partial rows cannot erase issued SKUs, rejection or the quotation identity',async()=>{
 const h=await setup();try{
  await json(await h.write(h.result));await json(await h.write({...h.result,registration:h.registration}));
  await json(await h.write({...h.result,registration:{...h.registration,rows:h.registration.rows.map(row=>({...row,skuId:''}))}}));
  let stored=await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+h.preview.fingerprint));assert.equal(stored.receipt.result.registration.rows[0].skuId,'sku-0');
  const badId=await h.write({...h.result,quotationId:'another-quote',observedAt:h.result.observedAt+1});assert.equal(badId.status,409);
  const rejected={...h.result,registration:{...h.registration,rows:h.registration.rows.map((row,i)=>i?row:{...row,status:'반려'})}};
  await json(await h.write(rejected));await json(await h.write({...h.result,registration:h.registration}));
  const list=await json(await h.load('app/api/products/route.ts').GET());assert.equal(list.products[0].hub_receipt.label,'상품 반려');
 }finally{h.close();}
});
test('wrong company, row count, duplicate or abbreviated IDs and fabricated approval do not become final completion',async()=>{
 const h=await setup();try{
  const patches=[{registered:true},{company:{code:'A01526306',name:'유앤채'}},{includedOptions:5},{filename:'other.xlsx'},{quotationId:''},
   {registration:{...h.registration,registered:true}},{registration:{...h.registration,includedOptions:5}},
   {registration:{...h.registration,rows:[...h.registration.rows,h.registration.rows[0]]}},
   {registration:{...h.registration,rows:h.registration.rows.map(row=>({...row,skuId:'same'}))}}];
  for(const patch of patches)assert.equal((await h.write({...h.result,...patch})).status,400,JSON.stringify(patch));
  const omitted={...h.result,registration:{...h.registration,rows:h.registration.rows.map(row=>({...row,skuId:'12345678…'}))}};
  await json(await h.write(omitted));const list=await json(await h.load('app/api/products/route.ts').GET());assert.equal(list.products[0].hub_receipt.label,'견적서 접수');assert.equal(list.products[0].hub_receipt.issuedSkus,0);
 }finally{h.close();}
});
test('changing reviewed content or quotation overrides before/during receipt storage preserves the existing receipt',async()=>{
 const h=await setup();try{
  await json(await h.write(h.result));const stored=h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts').get().payload;
  const source=h.load('app/exports/quotation-source.ts'),snapshot=await source.readMappedQuotationSource('owner',h.product.id,'cat');
  h.sqlite.prepare('UPDATE product_quotation_fields SET revision=revision+1 WHERE product_id=?').run(h.product.id);
  const receipt=JSON.parse(stored),save=h.load('db/supplier-hub-receipts.ts').saveSupplierHubReceipt;
  assert.equal(await save('owner',h.product.id,{...receipt,result:{...h.result,registration:h.registration}},snapshot.source,snapshot.state.revision),false);
  assert.equal(h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts').get().payload,stored);
  h.sqlite.prepare('UPDATE product_quotation_fields SET revision=revision-1 WHERE product_id=?').run(h.product.id);
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  await json(await h.route(h.base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'수정 후 상품'}}}}));
  assert.equal((await h.write({...h.result,registration:h.registration})).status,409);assert.equal(h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts').get().payload,stored);
  const list=await json(await h.load('app/api/products/route.ts').GET());assert.equal(list.products[0].hub_receipt.label,'견적서 접수');assert.equal(list.products[0].content_summary.seoTitle,'수정 후 상품');
 }finally{h.close();}
});
test('owner-scoped batch summaries and reads do not expose another member and body-only status writes are rejected',async()=>{
 const h=await setup();try{
  await json(await h.write(h.result));const db=h.load('db/supplier-hub-receipts.ts');
  assert.equal(await db.readSupplierHubReceipt('foreign',h.product.id,h.preview.fingerprint),null);assert.deepEqual(JSON.parse(JSON.stringify(await db.readSupplierHubReceiptSummaries('foreign',[h.product]))),{});
  h.sqlite.prepare('UPDATE products SET owner_id=? WHERE id=?').run('foreign',h.product.id);
  const reply=await h.route(h.base+'/supplier-hub-receipt?fingerprint='+h.preview.fingerprint);assert.equal(reply.status,404);
  const patch=await h.load('app/api/products/[id]/route.ts').PATCH(new Request('https://app.test'+h.base,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({supplier_hub_status:'등록완료'})}),{params:Promise.resolve({id:h.product.id})});assert.equal(patch.status,400);
 }finally{h.close();}
});

test('unauthenticated receipt readers and writers stop before any database or request body access',async()=>{
 const exports={};let touched=0;
 const code=ts.transpileModule(fs.readFileSync(new URL('../app/api/products/[id]/supplier-hub-receipt/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,process:{env:{NODE_ENV:'production'}},require(name){
  if(name==='next/server')return {NextResponse:Response};
  if(name==='@/app/chatgpt-auth')return {getChatGPTUser:async()=>null,getWorkspaceOwnerId:async()=>{touched++;throw Error('auth gate bypassed');}};
  return new Proxy({},{get(){return ()=>{touched++;throw Error('storage/body gate bypassed');};}});
 }});
 const context={params:Promise.resolve({id:'p'})};for(const method of ['GET','POST']){const response=await exports[method]({},context);assert.equal(response.status,503);assert.equal((await response.json()).code,'AUTH_REQUIRED');}assert.equal(touched,0);
});
test('corrupted stored receipts fail closed per product instead of breaking the registration board',async()=>{
 const h=await setup();try{
  await json(await h.write(h.result));const db=h.load('db/supplier-hub-receipts.ts');
  h.sqlite.prepare('UPDATE supplier_hub_receipts SET payload=?').run(JSON.stringify({schemaVersion:1,result:{state:'validation-complete',registered:true}}));
  const summaries=await db.readSupplierHubReceiptSummaries('owner',[h.product]);assert.equal(summaries[h.product.id],null);
  assert.equal((await h.route(h.base+'/supplier-hub-receipt?fingerprint='+h.preview.fingerprint)).status,503);
  const list=await json(await h.load('app/api/products/route.ts').GET());assert.equal(list.products[0].hub_receipt,null);assert.equal(list.products[0].title,h.product.title);
 }finally{h.close();}
});
