import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../extensions/supplier-hub/observe.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');
function setup({kind='validation',senderChanges={},tabChanges={},resultChanges={},onExecute,missing=false,savedChanges={},identityChanges={},companyCodes,legacy=false}={}){
 const identity={company:{code:'A01464742',name:'와이홉'},origin:'http://localhost:3000',productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64),includedOptions:3,...identityChanges};
 const saved={...identity,filename:`YOOFAM-${identity.fingerprint}.xlsx`,quotationId:'quote-1',state:'validation-complete',registered:false,...savedChanges};
 const result=kind==='validation'?{...saved,...resultChanges}:{quotationId:'quote-1',scope:'visible-page',rows:[{title:'상품',skuId:'sku-1'}],registered:false,...resultChanges};
 if(legacy)delete identity.company;
 const puts=[],scripts=[];let companyChecks=0;
 const context=vm.createContext({Date,URL,verifySupplierHubCompany(){},openSupplierHubRegistrationStatus:async()=>{},searchSupplierHubRegistration(){},readSupplierHubValidation(){},readSupplierHubRegistration(){},resultKey:()=> 'result:key',
  transferRecord:async(action,key,value)=>{if(action==='put')puts.push(value);else return key==='attempt:123'?(missing?null:identity):saved;},
  chrome:{runtime:{id:'extension',getURL:name=>`chrome-extension://extension/${name}`},tabs:{query:async()=>[{id:123,url:'https://supplier.coupang.com'+(kind==='validation'?'/qvt/registration':'/qvt/wims'),...tabChanges}]},scripting:{executeScript:async input=>{if(input.func===context.verifySupplierHubCompany){const code=companyCodes?.[companyChecks++]??'A01464742';return [{result:{code}}];}scripts.push(input);await onExecute?.();return [{result}];}}}
 });
 vm.runInContext(source,context);
 return {puts,scripts,run:()=>context.observeSupplierHubResult({tabId:123,kind},{id:'extension',url:'chrome-extension://extension/popup.html',...senderChanges})};
}
test('worker persists validation and SKU observations without a popup callback',async()=>{
 for(const kind of ['validation','registration']){
  let finish;const pending=new Promise(resolve=>{finish=resolve;});const h=setup({kind,onExecute:()=>pending});
  const job=h.run();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.puts.length,0);
  await assert.rejects(h.run(),/확인 중/);assert.equal(h.scripts.length,1);
  finish();await job;assert.equal(h.puts.length,1);assert.equal(h.puts[0].productId,'p');
  assert.equal(h.puts[0].registered,false);if(kind==='registration'){assert.equal(h.puts[0].registration.quotationId,'quote-1');assert.equal(h.puts[0].registration.includedOptions,3);assert.equal(h.puts[0].registration.rows.length,1);}
  await h.run();assert.equal(h.puts.length,2,'lock released after successful observation');
 }
});
test('only own popup can observe the selected matching Hub screen',async()=>{
 for(const opts of [{senderChanges:{id:'other'}},{senderChanges:{url:'https://app.test'}},{senderChanges:{tab:{id:123}}},{tabChanges:{id:456}},{tabChanges:{url:'https://supplier.coupang.com/qvt/wims'}}]){
  const h=setup(opts);await assert.rejects(h.run());assert.equal(h.scripts.length,0);assert.equal(h.puts.length,0);
 }
});
test('mismatched or invalid results never become saved registration evidence',async()=>{
 for(const opts of [{kind:'registration',missing:true},{kind:'registration',resultChanges:{quotationId:'different'}},{kind:'registration',resultChanges:{scope:'all'}},{kind:'registration',resultChanges:{registered:true}},{resultChanges:{registered:true}},{resultChanges:{state:'unknown'}}]){
  const h=setup(opts);await assert.rejects(h.run());assert.equal(h.puts.length,0);
  await assert.rejects(h.run(),error=>!error.message.includes('확인 중'),'failed requests release the lock');
 }
 const h=setup({resultChanges:{filename:'other.xlsx'}});await h.run();assert.equal(h.puts.length,0);
});
test('invalid option count cannot be attached to a validation or registration result',async()=>{
 for(const options of [{kind:'validation',identityChanges:{includedOptions:0}},{kind:'registration',savedChanges:{includedOptions:0}}]){
  const h=setup(options);await assert.rejects(h.run(),/옵션 수/);assert.equal(h.puts.length,0);
 }
});


test('registration search uses only the saved validated ID and does not save search as a result',async()=>{
 const h=setup({kind:'registration-search',resultChanges:{state:'search-requested'}});
 const result=await h.run();assert.equal(result.state,'search-requested');assert.equal(h.puts.length,0);
 assert.equal(h.scripts[0].args[0],'quote-1');
 for(const opts of [{missing:true},{savedChanges:{state:'validation-pending'}},{savedChanges:{filename:'other.xlsx'}},{resultChanges:{state:'unknown'}},{resultChanges:{state:'search-requested',quotationId:'other'}},{resultChanges:{state:'search-requested',registered:true}},{senderChanges:{id:'other'}}]){
  const bad=setup({kind:'registration-search',...opts});await assert.rejects(bad.run());assert.equal(bad.puts.length,0);
 }
});


test('validated search may start on the same upload tab, but missing validation never navigates',async()=>{
 const h=setup({kind:'registration-search',tabChanges:{url:'https://supplier.coupang.com/qvt/registration'},resultChanges:{state:'search-requested'}});
 assert.equal((await h.run()).state,'search-requested');assert.equal(h.scripts.length,1);
 const missing=setup({kind:'registration-search',missing:true,tabChanges:{url:'https://supplier.coupang.com/qvt/registration'}});
 await assert.rejects(missing.run());assert.equal(missing.scripts.length,0);
});

test('company switches cannot read or save another company result',async()=>{
 for(const kind of ['validation','registration','registration-search']){
  const before=setup({kind,companyCodes:['A01526306']});
  await assert.rejects(before.run(),/회사/);assert.equal(before.scripts.length,0);assert.equal(before.puts.length,0);
  const during=setup({kind,companyCodes:['A01464742','A01526306'],resultChanges:kind==='registration-search'?{state:'search-requested'}:{}});
  await assert.rejects(during.run(),/회사/);assert.equal(during.puts.length,0);
  if(kind==='registration-search')assert.equal(during.scripts.length,0,'company rechecked after navigation before searching');
 }
});

test('legacy attempts and company-mismatched validation cannot initiate a registration search',async()=>{
 for(const options of [{legacy:true},{savedChanges:{company:{code:'A01526306',name:'유앤채'}}},{savedChanges:{company:undefined}}]){
  const h=setup({kind:'registration-search',...options});await assert.rejects(h.run(),/회사/);
  assert.equal(h.scripts.length,0);assert.equal(h.puts.length,0);
 }
});
