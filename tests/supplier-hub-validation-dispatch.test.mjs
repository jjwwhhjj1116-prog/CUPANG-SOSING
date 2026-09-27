import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../extensions/supplier-hub/validation-dispatch.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');
function setup({sender={},tab={},result={state:'validation-requested',validated:false,registered:false},execute}={}){
 const scripts=[];
 const context=vm.createContext({URL,requestSupplierHubValidation(){},chrome:{runtime:{id:'ext',getURL:name=>'chrome-extension://ext/'+name},tabs:{query:async()=>[{id:123,url:'https://supplier.coupang.com/qvt/registration',...tab}]},scripting:{executeScript:async input=>{scripts.push(input);await execute?.();return [{result}];}}}});
 vm.runInContext(source,context);
 return {scripts,run:()=>context.dispatchSupplierHubValidation({tabId:123},{id:'ext',url:'chrome-extension://ext/popup.html',...sender})};
}
test('validation survives missing popup callback and rejects concurrent requests',async()=>{
 let release;const pending=new Promise(r=>release=r);const h=setup({execute:()=>pending});
 const task=h.run();await new Promise(r=>setImmediate(r));
 await assert.rejects(h.run(),/처리 중/);assert.equal(h.scripts.length,1);
 release();const result=await task;assert.equal(result.state,'validation-requested');assert.equal(result.registered,false);
});
test('validation requires own popup and exact active Hub tab',async()=>{
 for(const opts of [{sender:{id:'other'}},{sender:{url:'https://app.test'}},{sender:{tab:{id:123}}},{tab:{id:456}},{tab:{url:'https://supplier.coupang.com/qvt/wims'}},{tab:{url:'https://other.test/qvt/registration'}}]){
  const h=setup(opts);await assert.rejects(h.run());assert.equal(h.scripts.length,0);
 }
});
test('uncertain or falsely completed validation responses never report success',async()=>{
 for(const result of [undefined,null,{state:'validation-requested'},{state:'validation-requested',validated:true,registered:false},{state:'validation-requested',validated:false,registered:true},{state:'other',validated:false,registered:false}]){
  const h=setup({result:result??null});await assert.rejects(h.run(),/확인하지 못/);
  await assert.rejects(h.run(),/확인하지 못/);
 }
 const h=setup({execute:()=>{throw Error('tab closed');}});await assert.rejects(h.run(),/tab closed/);
});
