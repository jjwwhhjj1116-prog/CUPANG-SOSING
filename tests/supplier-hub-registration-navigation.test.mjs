import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../extensions/supplier-hub/registration-navigation.mjs',import.meta.url),'utf8').replace('export async function','async function');
function setup({path='/qvt/registration',ready=true,switched=false,redirect=false}={}){
 let tab={id:12,url:'https://supplier.coupang.com'+path,status:'complete'},updates=[],reads=0;
 const context=vm.createContext({URL,setTimeout:fn=>{fn();},chrome:{tabs:{query:async()=>[tab],update:async(id,value)=>{updates.push({id,...value});tab={...tab,id:switched?99:id,url:redirect?'https://supplier.coupang.com/login':value.url};}},scripting:{executeScript:async()=>{reads++;return[{result:ready}];}}}});
 vm.runInContext(source,context);return{run:()=>context.openSupplierHubRegistrationStatus(12),updates,get reads(){return reads;}};
}
test('navigation reuses the same tab and waits for the observed search input',async()=>{
 const h=setup();await h.run();assert.deepEqual(h.updates,[{id:12,url:'https://supplier.coupang.com/qvt/wims'}]);assert.equal(h.reads,1);
 const existing=setup({path:'/qvt/wims'});await existing.run();assert.equal(existing.updates.length,0);
});
test('changed tab, login redirect and unready form stop without search',async()=>{
 for(const config of [{switched:true},{redirect:true},{path:'/dashboard'},{ready:false}]){const h=setup(config);await assert.rejects(h.run());assert.ok(h.reads<=20);}
});
