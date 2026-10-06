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
import {refreshSupplierHubRegistration} from '../extensions/supplier-hub/app-registration.mjs';
import {verifySupplierHubCompany} from '../extensions/supplier-hub/company.mjs';
import {supplierHubStatusReady} from '../extensions/supplier-hub/hub-tab.mjs';
import {searchSupplierHubRegistration} from '../extensions/supplier-hub/registration-search.mjs';
import {readSupplierHubRegistration} from '../extensions/supplier-hub/registration-result.mjs';
import {assertAppSupplierHubNotSubmitted} from '../extensions/supplier-hub/receipt-recovery.mjs';
import {readSupplierHubValidation} from '../extensions/supplier-hub/result.mjs';

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
const bundleKeys=['bundleCriterion','bundleMinimumSupplyMargin','bundleMinimumCoupangMargin'];
const oldSettings=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!bundleKeys.includes(key)));
async function legacyBundleSource(h){
 // Model a previously persisted request without rewriting its original facts.
 const context=JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_context').get().payload);
 context.settings=oldSettings(context.settings);
 h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(context));
 return h.load('app/exports/quotation-source.ts').readMappedQuotationSource('owner',h.product.id,'cat');
}
for(const company of companies)test(`new bundle defaults preserve legacy accepted quotation identity and explicit pack edits still change it (${company.companyCode})`,async()=>{
 const h=await setup(company);try{
  const source=await legacyBundleSource(h),model=h.load('app/automation/model.ts');
  const legacy={...source,settings:oldSettings(source.settings)},dataStartRow=h.load('app/category-profiles.ts').quotationStartRow(source.profile.template);
  // Exact pre-bundle deployment fingerprint contract, with no new normalized keys.
  const fingerprint=await model.fingerprint({format:'sourceflow-quotation-fields-v1',saved:legacy,dataStartRow,
   schema:h.load('app/quotation-schema.ts').getQuotationSchema(source.categoryContext.categoryId,source.categoryContext.categoryPath,source.hubSchema),
   ...h.load('app/product-options.ts').optionPriceCalculationRevision(source.product,source.options.rows,legacy.settings,source.state.overrides)});
  const result={...h.result,filename:`YOOFAM-${fingerprint}.xlsx`,registration:{...h.registration,rows:h.registration.rows.map(row=>({...row,sourceQuotation:`YOOFAM-${fingerprint}.xlsx`}))}};
  const receipt={schemaVersion:1,evidence:'chrome-observation',profileId:'cat',categoryId:'80719',fingerprint,productVersion:source.product.updated_at,recordedAt:new Date().toISOString(),result};
  assert.equal(await h.load('db/supplier-hub-receipts.ts').saveSupplierHubReceipt('owner',h.product.id,receipt,source.source,source.state.revision),true);
  const before={product:h.sqlite.prepare('SELECT * FROM products').get(),options:h.sqlite.prepare('SELECT * FROM product_options').get(),content:h.sqlite.prepare('SELECT * FROM product_content').get(),context:h.sqlite.prepare('SELECT * FROM collection_context').get()};
  const preview=await json(await h.route(h.base+'/quotation',{method:'POST',body:{action:'preview'}}));
  assert.equal(preview.fingerprint,fingerprint,'deployment-only criteria must not create a new transmission identity');
  assert.equal(preview.filename,result.filename);assert.deepEqual(preview.rows,h.preview.rows);
  const preserved=await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+preview.fingerprint));
  assert.equal(preserved.receipt.result.quotationId,result.quotationId);assert.equal(preserved.receipt.result.registration.rows.length,6);
  await json(await h.route(h.base+'/supplier-hub-receipt',{method:'POST',body:{profileId:'cat',categoryId:'80719',fingerprint,result}}));
  const ui=submissionPackageUI({route:h.route,productId:h.product.id});await ui.click('견적서 + 첨부 파일 준비');ui.remount();await ui.click('견적서 + 첨부 파일 준비');
  assert.equal(ui.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);assert.ok(JSON.stringify(ui.render()).includes('sku-5'));
  assert.equal(ui.calls.some(call=>['transmit','prepare','export'].includes(call.action)),false);
  for(const [key,table] of [['product','products'],['options','product_options'],['content','product_content'],['context','collection_context']])assert.deepEqual(h.sqlite.prepare(`SELECT * FROM ${table}`).get(),before[key]);
  const rows=h.load('app/product-options.ts').optionInputs(source.options);rows[0].unitsPerPack=3;
  await json(await h.route(h.base+'/options',{method:'PATCH',body:{expectedRevision:source.options.revision,expectedProductVersion:source.product.updated_at,rows}}));
  const changed=await json(await h.route(h.base+'/quotation',{method:'POST',body:{action:'preview'}}));assert.notEqual(changed.fingerprint,fingerprint);
  assert.equal(changed.rows[0][changed.headers.indexOf('quantity')], '3');
  assert.notEqual(changed.rows[0][changed.headers.indexOf('supplyPrice')],preview.rows[0][preview.headers.indexOf('supplyPrice')]);
  assert.equal((await h.route(h.base+'/quotation',{method:'POST',body:{action:'export',fingerprint}})).status,409);
  const old=await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+fingerprint));assert.equal(old.receipt.result.quotationId,result.quotationId);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n,1);
 }finally{h.close();}
});
for(const company of companies)test(`bundle criteria do not stale legacy quotation edits or local pricing workflows (${company.companyCode})`,async()=>{
 const h=await setup(company);try{
  await legacyBundleSource(h);
  const exporter=h.load('app/exports/quotation-source.ts'),source=await exporter.readQuotationExportSource('owner',h.product.id,null),model=h.load('app/automation/model.ts');
  const settings=oldSettings(source.settings),view=await json(await h.route(h.base+'/quotation-fields'));
  const inputs={categoryId:source.categoryContext.categoryId,categoryPath:source.categoryContext.categoryPath,product:source.product,content:source.content,options:source.options,settings,...(source.hubSchema?{hubSchema:source.hubSchema}:{})};
  const legacyFingerprint=await model.fingerprint({inputs,schema:view.automatic.schema,categoryContext:source.categoryContext,profileRevision:null,settingsPayload:source.source.settingsPayload,collection:source.source.collection,
   ...h.load('app/product-options.ts').optionPriceCalculationRevision(source.product,source.options.rows,settings)});
  assert.equal(view.inputFingerprint,legacyFingerprint,'an unchanged stage-seven editor remains saveable across deployment');
  const quotation=await h.load('db/quotation-fields.ts').readQuotationFields('owner',h.product.id);
  const currentSettings=h.load('app/workspace-settings.ts').savedRegistrationSettings(null),legacySettings=oldSettings(currentSettings);
  const workflow=await model.planAutomation(source.product,legacySettings,null,source.content,null,undefined,source.options,quotation);
  const command={action:'run',expectedVersion:source.product.updated_at,idempotencyKey:crypto.randomUUID(),stages:['pricing']};
  const completed=model.executeLocalAutomation(workflow,source.product,legacySettings,command,workflow.updatedAt,source.options);
  const saved=await h.load('db/automation.ts').saveAutomation('owner',completed,null,command,await model.fingerprint(command),{optionRevision:source.options.revision,quotationRevision:quotation.revision,settingsPayload:source.source.settingsPayload});assert.ok(saved);
  const observed=await json(await h.route(h.base+'/automation'));assert.equal(observed.stale,false);
  for(const settings of [currentSettings,{...currentSettings,bundleCriterion:'coupangMargin',bundleMinimumSupplyMargin:9000,bundleMinimumCoupangMargin:7000}]){
   const planned=await model.planAutomation(source.product,settings,completed,source.content,null,completed.updatedAt,source.options,quotation);
   assert.equal(planned.inputFingerprint,completed.inputFingerprint);assert.equal(JSON.stringify(planned.stages.find(stage=>stage.id==='pricing')),JSON.stringify(completed.stages.find(stage=>stage.id==='pricing')));
  }
  await json(await h.route(h.base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:legacyFingerprint,changes:[{fieldKey:'storageMaterial',optionId:null,value:''}]}}));
  // Raw settings and the immutable collection context still participate in CAS.
  const before=await exporter.readMappedQuotationSource('owner',h.product.id,'cat'),original=await exporter.quotationExportFingerprint(before,2);
  const payload=JSON.stringify({...legacySettings,bundleCriterion:'supplyMargin',bundleMinimumSupplyMargin:3000,bundleMinimumCoupangMargin:3000});
  await h.load('db/queries.ts').saveSettings('owner',payload);
  assert.equal(await h.load('db/quotation-fields.ts').quotationSourcesCurrent('owner',h.product.id,before.source),false);
  assert.notEqual(await exporter.quotationExportFingerprint(await exporter.readMappedQuotationSource('owner',h.product.id,'cat'),2),original);
 }finally{h.close();}
});
for(const company of companies)test(`serialized pending row advances through a full copy ID and exact search to a pinned receipt that survives reload (${company.companyCode})`,async()=>{
 const h=await setup(company);try{
  const before={product:h.sqlite.prepare('SELECT * FROM products').get(),content:h.sqlite.prepare('SELECT * FROM product_content').all()};
  let cells=[h.preview.filename,'2026-10-05','검증중','',''],notify;
  const table={isConnected:true,getClientRects:()=>[{}],contains:node=>node===table,querySelectorAll:selector=>selector==='thead th'?['견적서 명','견적서 등록일','검증 상태','검증 결과','견적서 ID'].map(innerText=>({innerText})):[{querySelectorAll:()=>cells.map(value=>({innerText:typeof value==='string'?value:value.text,querySelectorAll:()=>typeof value==='string'?[]:value.copies.map(id=>({getClientRects:()=>[{}],getAttribute:()=>id}))}))}]};
  const refresh={innerText:'새로고침',getClientRects:()=>[{}],getAttribute:()=>null,click:()=>notify([{target:table}])};
  const document={body:{},querySelectorAll:selector=>selector==='table'?[table]:[refresh]};
  const read=async()=>vm.runInNewContext(`(${readSupplierHubValidation.toString()})(filename)`,{filename:h.preview.filename,document,location:{origin:'https://supplier.coupang.com',pathname:'/qvt/registration'},setTimeout,clearTimeout,MutationObserver:class{constructor(callback){notify=callback;}observe(){}disconnect(){}}});
  const pending={...h.result,...await read()};assert.equal(pending.state,'validation-pending');assert.equal(pending.quotationId,'');
  await json(await h.write(pending));
  cells=[h.preview.filename,'2026-10-05','완료','검증 완료',{text:`${h.result.quotationId.slice(0,8)}...`,copies:[h.result.quotationId]}];
  const complete={...h.result,...await read(),observedAt:pending.observedAt};
  assert.equal(complete.quotationId,h.result.quotationId);
  class Input {get value(){return this.current??'';}set value(value){this.current=value;}}
  const input=new Input();Object.assign(input,{isConnected:true,getClientRects:()=>[{}],dispatchEvent(){}});
  const label={innerText:'견적서 ID',getClientRects:()=>[{}]},filters=new Map(['input#productName','input#barcode','input#skuId','input#sourcingChannelId','select#state','select#progress','input#isReplyNeeded'].map(selector=>[selector,{value:'',type:selector.endsWith('isReplyNeeded')?'checkbox':'text',checked:false,getClientRects:()=>[{}]}]));
  let searches=0;
  const button={innerText:'검색',isConnected:true,getClientRects:()=>[{}],getAttribute:()=>null,click(){searches++;}},reset={innerText:'재설정',getClientRects:()=>[{}],getAttribute:()=>null,click(){input.value='';}};
  const searched=await vm.runInNewContext(`(${searchSupplierHubRegistration.toString()})(quotationId)`,{quotationId:complete.quotationId,HTMLInputElement:Input,Event:class{constructor(type){this.type=type;}},location:{origin:'https://supplier.coupang.com',pathname:'/qvt/wims'},document:{querySelectorAll:selector=>selector==='button'?[button,reset]:filters.has(selector)?[filters.get(selector)]:selector.startsWith('input[id=')?[input]:selector.startsWith('label')?[label]:[]}});
  assert.equal(searched.quotationId,h.result.quotationId);assert.equal(input.value,h.result.quotationId);assert.equal(searches,1);assert.equal(searched.registered,false);
  assert.equal((await h.write({...complete,quotationId:`${complete.quotationId.slice(0,8)}...`})).status,400,'an unresolved display value cannot replace the stored pending receipt');
  await json(await h.write(complete));
  await json(await h.write({...complete,registration:{...h.registration,observedAt:complete.observedAt+1}}));
  const receipt=await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+h.preview.fingerprint));
  assert.equal(receipt.receipt.result.quotationId,h.result.quotationId);assert.equal(receipt.receipt.result.registration.rows.length,6);
  const pinned=h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts').get().payload;
  for(const value of [{...complete,quotationId:'another-quote'},{...pending,quotationId:''}])assert.equal((await h.write({...value,observedAt:complete.observedAt+2})).status,409);
  assert.equal(h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts').get().payload,pinned,'a real quotation ID stays pinned after assignment');
  const ui=submissionPackageUI({route:h.route,productId:h.product.id});await ui.click('견적서 + 첨부 파일 준비');ui.remount();await ui.click('견적서 + 첨부 파일 준비');
  assert.ok(JSON.stringify(ui.render()).includes('sku-5'));assert.equal(ui.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);assert.equal(ui.calls.some(call=>['transmit','prepare','export'].includes(call.action)),false);
  assert.deepEqual({product:h.sqlite.prepare('SELECT * FROM products').get(),content:h.sqlite.prepare('SELECT * FROM product_content').all()},before);
  const source=await json(await h.route(h.base+'/quotation',{method:'POST',body:{action:'source'}}));assert.equal(source.fingerprint,h.preview.fingerprint);
 }finally{h.close();}
});
for(const company of companies)test(`actual owner-scoped API blocks server-only receipt replay for complete, pending and rejected states (${company.companyCode})`,async()=>{
 const h=await setup(company);try{
  const origin='http://localhost:3000',identity={origin,productId:h.product.id,categoryId:'80719',fingerprint:h.preview.fingerprint};
  const prepared={profileId:'cat',company:h.result.company,includedOptions:6},binding={appTabId:7,windowId:17},before=h.sqlite.prepare('SELECT * FROM products').get();
  const records=new Map(),calls=[];let listener,unavailable=false;
  const content={URL,Date,AbortController,setTimeout,clearTimeout,location:{origin},window:{addEventListener(){},postMessage(){}},
   chrome:{runtime:{id:'extension',onMessage:{addListener(value){listener=value;}}}},fetch:async(path,init)=>{
    calls.push([path,init.method]);const response=unavailable?Response.json({error:'시험 조회 실패'},{status:503}):await h.route(path,{method:init.method,...(init.body?{body:JSON.parse(init.body)}:{})});
    Object.defineProperty(response,'url',{value:origin+path});return response;
   }};
  vm.runInNewContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8'),content);
  const api={tabs:{get:async id=>{assert.equal(id,7);return {id,windowId:17,url:origin+'/'};},sendMessage:async(id,message,frame)=>{
   assert.equal(id,7);assert.deepEqual(frame,{frameId:0});return new Promise(resolve=>assert.equal(listener(message,{id:'extension'},resolve),true));
  }}};
  const store=async(action,key,value)=>{assert.equal(action,'claim');assert.ok(key.startsWith('result:'));if(records.has(key))return false;records.set(key,value);return true;};
  const preflight=()=>assertAppSupplierHubNotSubmitted(identity,prepared,binding,api,store);
  assert.equal(await preflight(),true);assert.equal(records.size,0);
  unavailable=true;await assert.rejects(preflight(),error=>error.code==='SUPPLIER_HUB_RECEIPT_UNCONFIRMED');assert.equal(records.size,0);unavailable=false;
  for(const [index,state] of ['validation-pending','validation-rejected','validation-complete'].entries()){
   // Independent stored states: the receipt merger intentionally preserves a
   // rejection over later complete observations. Reset only this temporary DB.
   h.sqlite.prepare('DELETE FROM supplier_hub_receipts WHERE product_id=?').run(h.product.id);
   const result={...h.result,state,observedAt:h.result.observedAt+index,...(state!=='validation-complete'?{quotationId:undefined}:{})};
   await json(await h.write(result));records.clear();
   await assert.rejects(preflight(),error=>error.code==='SUPPLIER_HUB_ALREADY_SUBMITTED');assert.equal(records.size,1);
   const restored=[...records.values()][0];assert.equal(restored.state,state);assert.equal(restored.company.code,company.companyCode);assert.equal(restored.includedOptions,6);
   assert.equal(restored.quotationId,result.quotationId);assert.equal(restored.registered,false);assert.equal(restored.registration,undefined);
   assert.equal([...records.keys()].some(key=>/^(attempt|transmission):/.test(key)),false);
  }
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM products').get(),before);
  assert.ok(calls.every(([path])=>/\/supplier-hub-receipt\?|\/quotation$/.test(path)));
 }finally{h.close();}
});
for(const company of companies)for(const noHubTabs of [false,true])test(`actual receipt/source APIs recover a closed-tab six-SKU lookup with the original draft untouched (${company.companyCode}, no Hub tabs: ${noHubTabs})`,async()=>{
 const h=await setup(company);try{
  await json(await h.write(h.result));const before=h.sqlite.prepare('SELECT * FROM products').get();
  const origin='http://localhost:3000',identity={origin,productId:h.product.id,categoryId:'80719',fingerprint:h.preview.fingerprint};
  const calls=[],records=new Map(),tabs=noHubTabs?[]:[{id:999,windowId:17,url:'https://supplier.coupang.com/qvt/registration',status:'complete'}];let listener;
  const content={URL,Date,AbortController,setTimeout,clearTimeout,location:{origin},window:{addEventListener(){},postMessage(){}},
   chrome:{runtime:{id:'extension',onMessage:{addListener(value){listener=value;}}}},fetch:async(path,init)=>{
    calls.push(['api',path,init.method]);const response=await h.route(path,{method:init.method,...(init.body?{body:JSON.parse(init.body)}:{})});
    Object.defineProperty(response,'url',{value:origin+path});return response;
   }};
  vm.runInNewContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8'),content);
  const api={tabs:{query:async query=>{assert.deepEqual(query,{windowId:17,url:['https://supplier.coupang.com/qvt/registration*','https://supplier.coupang.com/qvt/wims*']});return tabs;},
   get:async id=>id===7?{id:7,windowId:17,url:origin+'/'}:tabs.find(tab=>tab.id===id),
   sendMessage:async(id,message,frame)=>{assert.equal(id,7);assert.deepEqual(frame,{frameId:0});return new Promise(resolve=>assert.equal(listener(message,{id:'extension'},resolve),true));},
   create:async value=>{calls.push(['create',value]);const tab={id:124,status:'complete',...value};tabs.push(tab);return tab;}},
   scripting:{executeScript:async request=>{
    calls.push(['script',request.func.name,request.target.tabId]);
    if(request.func===verifySupplierHubCompany)return [{result:{code:company.companyCode}}];
    if(request.func===supplierHubStatusReady)return [{result:true}];
    if(request.func===searchSupplierHubRegistration){assert.equal(request.target.tabId,124);assert.deepEqual(request.args,[h.result.quotationId,true]);return [{result:{state:'search-complete',quotationId:h.result.quotationId,registered:false}}];}
    if(request.func===readSupplierHubRegistration)return [{result:{quotationId:h.result.quotationId,scope:'visible-page',registered:false,rows:h.registration.rows,page:{current:1,hasNext:false,signature:JSON.stringify(h.registration.rows)}}}];
    throw Error('unexpected write to Supplier Hub');
   }}};
  const store=async(action,key,value)=>{if(action==='get')return records.get(key);if(action==='claim'){if(records.has(key))return false;records.set(key,value);return true;}records.set(key,value);};
  const record=await refreshSupplierHubRegistration({...identity,type:'YOOFAM_REFRESH_REGISTRATION'},{frameId:0,url:origin+'/',tab:{id:7,windowId:17}},api,store);
  assert.equal(record.registration.rows.length,6);assert.equal(record.quotationId,h.result.quotationId);assert.equal(record.company.code,company.companyCode);assert.equal(record.receiptRecovered,true);
  assert.equal(records.has('attempt:999'),false);assert.equal([...records.keys()].some(key=>key.startsWith('transmission:')),false);
  const current=await json(await h.route(h.base+'/quotation',{method:'POST',body:{action:'source',profileId:'cat'}}));assert.equal(current.report.rowCount,6);assert.equal(current.fingerprint,h.preview.fingerprint);
  await json(await h.write(record));const saved=await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+h.preview.fingerprint));
  assert.equal(saved.receipt.result.registration.rows.length,6);assert.equal(saved.receipt.result.registered,false);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM products').get(),before);
  assert.equal(calls.filter(([name])=>name==='create').length,1);assert.equal(calls.some(([name,path])=>name==='api'&&/export|content|collection/.test(path)),false);
 }finally{h.close();}
});
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
  const confirmed='전송한 옵션 수와 동일한 수의 고유 SKU ID가 조회됐습니다. 상품 검수 결과는 아래 상태를 기준으로 확인하세요.';
  assert.ok(JSON.stringify(ui.render()).includes(confirmed),'server receipt restores the same SKU summary as a fresh lookup');
  const lookups=ui.calls.filter(call=>call.action==='lookup').length;
  ui.setLookupError(true);await ui.click('전송 결과 계속 확인');
  assert.ok(JSON.stringify(ui.render()).includes(confirmed));assert.ok(JSON.stringify(ui.render()).includes('sku-5'));
  assert.deepEqual(ui.alerts(),['SKU 조회 응답 유실']);
  ui.setLookupError(false);await ui.click('전송 결과 계속 확인');assert.deepEqual(ui.alerts(),[]);
  assert.deepEqual(ui.calls.filter(call=>call.action==='lookup').slice(lookups).map(call=>call.mode),['registration','registration']);
  assert.equal(ui.calls.filter(call=>call.action==='export').length,1);assert.equal(ui.calls.filter(call=>call.action==='transmit').length,1);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM products').get(),before);
  const detail=await json(await h.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test'+h.base),{params:Promise.resolve({id:h.product.id})}));assert.deepEqual(detail.product.hub_receipt,summary);
 }finally{h.close();}
});
for(const company of companies)for(const cached of ['missing','older'])test(`file-only refresh keeps a newer server-restored SKU receipt when Chrome rows are ${cached} (${company.companyCode})`,async()=>{
 const h=await setup(company);try{
  await json(await h.write({...h.result,registration:h.registration}));
  const before=h.sqlite.prepare('SELECT * FROM products').get();
  const fileOnly={...h.result,observedAt:h.result.observedAt+10,...(cached==='older'?{registration:{...h.registration,observedAt:h.registration.observedAt-1,rows:[]}}:{})};
  const freshEmpty={...h.result,registration:{...h.registration,observedAt:h.registration.observedAt+20,rows:[]}};
  const ui=submissionPackageUI({route:h.route,productId:h.product.id,lookupResults:[fileOnly,freshEmpty]});
  await ui.click('견적서 + 첨부 파일 준비');assert.ok(JSON.stringify(ui.render()).includes('sku-5'));
  await ui.click('Supplier Hub 검증 결과 불러오기');assert.deepEqual(ui.alerts(),[]);
  assert.ok(JSON.stringify(ui.render()).includes('sku-5'),'file validation cannot erase a newer server SKU observation');
  assert.ok(JSON.stringify(ui.render()).includes(new Date(h.registration.observedAt).toLocaleString('ko-KR')),'SKU observation keeps its original time');
  let stored=await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+h.preview.fingerprint));
  assert.equal(stored.receipt.result.registration.observedAt,h.registration.observedAt);assert.equal(stored.receipt.result.registration.rows.length,6);
  await ui.click('견적서 ID로 상품별 등록 상태 조회');assert.deepEqual(ui.alerts(),[]);
  assert.equal(JSON.stringify(ui.render()).includes('sku-5'),false,'a fresh SKU lookup must still replace previous rows');
  stored=await json(await h.route(h.base+'/supplier-hub-receipt?fingerprint='+h.preview.fingerprint));
  assert.equal(stored.receipt.result.registration.observedAt,freshEmpty.registration.observedAt);assert.equal(stored.receipt.result.registration.rows.length,0);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM products').get(),before);
  const current=await json(await h.route(h.base+'/quotation',{method:'POST',body:{action:'source'}}));assert.equal(current.fingerprint,h.preview.fingerprint);
  assert.equal(ui.calls.some(call=>['transmit','prepare','export'].includes(call.action)),false);
  assert.deepEqual(ui.calls.filter(call=>call.action==='lookup').map(call=>call.mode),[true,'registration']);
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
