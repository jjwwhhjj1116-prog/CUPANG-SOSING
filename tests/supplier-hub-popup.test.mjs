import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const observation=fs.readFileSync(new URL('../extensions/supplier-hub/observe.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');
const source=fs.readFileSync(new URL('../extensions/supplier-hub/popup.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
async function popup(outcome,action='#attach'){
 const nodes=new Map();const puts=[];const messages=[];
 const saved={origin:'http://localhost:3000',productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64),createdAt:Date.now(),base64:'UEs='};
 const context=vm.createContext({Date,URL,Uint8Array,atob,prepareAttachments:async()=>({productId:saved.productId,categoryId:saved.categoryId,quotation:[{name:`YOOFAM-${saved.fingerprint}.xlsx`}],productImages:[],labelImages:[]}),pendingPackage:async action=>action==='get'?saved:true,transferRecord:async(action,key,value)=>{if(action==='put')puts.push({key,value});},resultKey:()=>'',attachToSupplierHub(){},requestSupplierHubValidation(){},readSupplierHubValidation(){},document:{querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{disabled:false,files:[],value:'',addEventListener(event,handler){this[event]=handler;}});return nodes.get(selector);}},chrome:{runtime:{sendMessage:async message=>{messages.push(message);return outcome==='rejected'?{ok:false,error:'existing attachment'}:{ok:true,result:{state:outcome,registered:false}};}},tabs:{query:async()=>[{id:123,url:'https://supplier.coupang.com/qvt/registration'}]},scripting:{executeScript:async()=>{if(outcome==='rejected')throw Error('existing attachment');return [{result:{state:outcome,dispatched:[],registered:false}}];}}}});
 vm.runInContext(source,context);await context.loadPending();await nodes.get(action).click();return {puts,messages};
}
test('a rejected or partial attachment cannot overwrite the previous product identity',async()=>{
 for(const outcome of ['rejected','partial'])assert.equal((await popup(outcome)).puts.length,0);
});
test('app package dispatch is delegated to worker without passing files or writing popup identity',async()=>{
 const {puts,messages}=await popup('dispatched');assert.equal(puts.length,0);assert.equal(messages.length,1);assert.equal(messages[0].type,'YOOFAM_DISPATCH_PACKAGE');assert.equal(messages[0].tabId,123);assert.equal(messages[0].fingerprint,'a'.repeat(64));assert.equal(messages[0].base64,undefined);
});

async function refreshValidation(previousChanges={},resultChanges={}){
 const identity={origin:'http://localhost:3000',productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64)};
 const result={filename:`YOOFAM-${identity.fingerprint}.xlsx`,state:'validation-complete',quotationId:'quotation-123',registered:false,...resultChanges};
 const registration={quotationId:'quotation-123',scope:'visible-page',registered:false,observedAt:1234,rows:[{title:'상품',skuId:'SKU1',status:'상품 검수중'}]};
 const previous={...identity,...result,state:'validation-complete',quotationId:'quotation-123',observedAt:1200,registration,...previousChanges};
 const nodes=new Map(),puts=[];
 const context=vm.createContext({Date,URL,Uint8Array,atob,pendingPackage:async()=>null,
  transferRecord:async(action,key,value)=>{if(action==='put')puts.push(value);else return key==='attempt:123'?identity:previous;},resultKey:()=> 'result:key',
  readSupplierHubValidation(){},document:{querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{disabled:false,addEventListener(event,handler){this[event]=handler;}});return nodes.get(selector);}},
  chrome:{runtime:{id:'extension',getURL:name=>`chrome-extension://extension/${name}`},tabs:{query:async()=>[{id:123,url:'https://supplier.coupang.com/qvt/registration'}]},scripting:{executeScript:async()=>[{result}]}}});
 vm.runInContext(observation,context);context.chrome.runtime.sendMessage=async message=>({ok:true,result:await context.observeSupplierHubResult(message,{id:'extension',url:'chrome-extension://extension/popup.html'})});
 vm.runInContext(source,context);await nodes.get('#result').click();return{saved:puts[0],previous,registration};
}

test('refreshing the same completed validation preserves SKU rows and their original observation time',async()=>{
 const {saved,registration}=await refreshValidation();
 assert.equal(saved.registration,registration);assert.equal(saved.registration.observedAt,1234);
 assert.ok(saved.observedAt>1234);assert.equal(saved.registered,false);
});

test('changed quotation, validation status or app identity cannot inherit previously observed SKU rows',async()=>{
 for(const result of [{quotationId:'other'},{quotationId:''},{state:'validation-rejected'},{state:'validation-pending'},{state:'not-found'}]){
  const {saved}=await refreshValidation({},result);assert.equal(saved.registration,undefined);assert.equal(saved.state,result.state??'validation-complete');
 }
 for(const previous of [{productId:'other'},{categoryId:'999'},{origin:'http://127.0.0.1:3000'},{fingerprint:'b'.repeat(64)},{filename:'other.xlsx'},{state:'validation-pending'},{registration:{quotationId:'other'}}]){
  assert.equal((await refreshValidation(previous)).saved.registration,undefined);
 }
});

test('validation delegates to worker with active tab identity and explicit unchecked agreement choices',async()=>{
 const {messages,puts}=await popup('validation-requested','#validate');
 assert.equal(messages.length,1);assert.equal(messages[0].type,'YOOFAM_VALIDATE_PACKAGE');assert.equal(messages[0].tabId,123);assert.equal(Object.keys(messages[0]).length,3);assert.deepEqual(JSON.parse(JSON.stringify(messages[0].reviewedAgreements)),{priceData:false,labelBusinessContact:false,legalDocumentsNotApplicable:false});assert.equal(puts.length,0);
});
