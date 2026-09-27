import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../extensions/supplier-hub/popup.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
async function popup(outcome){
 const nodes=new Map();const puts=[];
 const saved={origin:'http://localhost:3000',productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64),createdAt:Date.now(),base64:'UEs='};
 const context=vm.createContext({Date,URL,Uint8Array,atob,prepareAttachments:async()=>({productId:saved.productId,categoryId:saved.categoryId,quotation:[{name:`YOOFAM-${saved.fingerprint}.xlsx`}],productImages:[],labelImages:[]}),pendingPackage:async action=>action==='get'?saved:true,transferRecord:async(action,key,value)=>{if(action==='put')puts.push({key,value});},resultKey:()=>'',attachToSupplierHub(){},requestSupplierHubValidation(){},readSupplierHubValidation(){},document:{querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{disabled:false,files:[],value:'',addEventListener(event,handler){this[event]=handler;}});return nodes.get(selector);}},chrome:{tabs:{query:async()=>[{id:123,url:'https://supplier.coupang.com/qvt/registration'}]},scripting:{executeScript:async()=>{if(outcome==='rejected')throw Error('existing attachment');return [{result:{state:outcome,dispatched:[],registered:false}}];}}}});
 vm.runInContext(source,context);await context.loadPending();await nodes.get('#attach').click();return puts;
}
test('a rejected or partial attachment cannot overwrite the previous product identity',async()=>{
 for(const outcome of ['rejected','partial'])assert.equal((await popup(outcome)).length,0);
});
test('only confirmed dispatch saves the exact app product identity for reload recovery',async()=>{
 const puts=await popup('dispatched');assert.equal(puts.length,1);assert.equal(puts[0].key,'attempt:123');assert.equal(puts[0].value.productId,'p');assert.equal(puts[0].value.origin,'http://localhost:3000');assert.equal(puts[0].value.base64,undefined);
});
