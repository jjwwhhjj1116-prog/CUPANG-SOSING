import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../extensions/supplier-hub/dispatch.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');
function setup({outcome='dispatched',savedChanges={},senderChanges={},consume=true,tabChanges={},onExecute}={}){
  const fingerprint='a'.repeat(64),calls=[],puts=[];
  const saved={origin:'http://localhost:3000',productId:'p',categoryId:'80719',fingerprint,createdAt:Date.now(),base64:'UEs=',...savedChanges};
  const sender={id:'extension',url:'chrome-extension://extension/popup.html',...senderChanges};
  const context=vm.createContext({Date,URL,Uint8Array,atob,
    prepareAttachments:async()=>({productId:'p',categoryId:'80719',quotation:[{name:`YOOFAM-${fingerprint}.xlsx`}]}),attachToSupplierHub(){},
    pendingPackage:async action=>{calls.push(action);return action==='get'?saved:consume;},
    transferRecord:async(action,key,value)=>{puts.push({key,value});},
    chrome:{runtime:{id:'extension',getURL:name=>`chrome-extension://extension/${name}`},tabs:{query:async()=>[{id:123,url:'https://supplier.coupang.com/qvt/registration',...tabChanges}]},
      scripting:{executeScript:async()=>{calls.push('execute');await onExecute?.();if(outcome==='rejected')throw Error('existing attachment');return [{result:{state:outcome,registered:false}}];}}},
  });
  vm.runInContext(source,context);
  return {calls,puts,run:()=>context.dispatchPendingPackage({tabId:123,fingerprint},sender)};
}
test('worker saves confirmed dispatch identity without a popup response callback',async()=>{
  let finish;const execution=new Promise(resolve=>{finish=resolve;});
  const run=setup({onExecute:()=>execution});const pending=run.run();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(run.puts.length,0);
  finish();assert.equal((await pending).state,'dispatched');
  assert.deepEqual(run.calls,['get','delete','execute']);
  assert.equal(run.puts[0].key,'attempt:123');assert.equal(run.puts[0].value.productId,'p');
  assert.deepEqual(Object.keys(run.puts[0].value).sort(),['categoryId','fingerprint','origin','productId']);
});
test('partial or rejected dispatch preserves previous identity and is not retried',async()=>{
  for(const outcome of ['partial','rejected']){
    const run=setup({outcome});if(outcome==='partial')assert.equal((await run.run()).state,'partial');else await assert.rejects(run.run());
    assert.equal(run.puts.length,0);assert.deepEqual(run.calls,['get','delete','execute']);
  }
});
test('only own popup can dispatch into the selected current Hub tab',async()=>{
  for(const options of [{senderChanges:{id:'other'}},{senderChanges:{url:'http://localhost:3000/'}},{senderChanges:{tab:{id:123}}},{tabChanges:{id:456}},{tabChanges:{url:'https://supplier.coupang.com/qvt/wims'}}]){
    const run=setup(options);await assert.rejects(run.run());assert.equal(run.calls.length,0);
  }
});
test('expired, mismatched or already consumed package never executes',async()=>{
  for(const options of [{savedChanges:{createdAt:Date.now()-16*60*1000}},{savedChanges:{createdAt:Date.now()+120000}},{savedChanges:{fingerprint:'b'.repeat(64)}},{savedChanges:{productId:'other'}},{savedChanges:{categoryId:'999'}},{consume:false}]){
    const run=setup(options);await assert.rejects(run.run());assert.ok(!run.calls.includes('execute'));assert.equal(run.puts.length,0);
  }
});
