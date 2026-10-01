import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {claimSupplierHubTransmissionWindow} from '../extensions/supplier-hub/transmission-window.mjs';
import {resultKey} from '../extensions/supplier-hub/handoff-store.mjs';
const source=fs.readFileSync(new URL('../extensions/supplier-hub/dispatch.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');
function setup({outcome='dispatched',savedChanges={},senderChanges={},consume=true,tabChanges={},onExecute,sourceChangedAt,company={code:'A01464742',name:'와이홉'},occupied=false,bindingError=false}={}){
  const fingerprint='a'.repeat(64),calls=[],puts=[],records=new Map();
  const saved={origin:'http://localhost:3000',productId:'p',categoryId:'80719',fingerprint,createdAt:Date.now(),base64:'UEs=',appTabId:7,windowId:17,...savedChanges};let sourceChecks=0;
  const sender={id:'extension',url:'chrome-extension://extension/popup.html',...senderChanges};
  const context=vm.createContext({Date,URL,Uint8Array,atob,claimSupplierHubTransmissionWindow,resultKey,
    verifySupplierHubCompany(){},prepareAttachments:async()=>({company,productId:'p',categoryId:'80719',includedOptions:3,quotation:[{name:`YOOFAM-${fingerprint}.xlsx`}]}),attachToSupplierHub(){},
    verifyAppQuotationSource:async()=>{calls.push('verify-source');if(++sourceChecks===sourceChangedAt)throw Error('최신 저장본 변경');},
    pendingPackage:async action=>{calls.push(action);return action==='get'?saved:consume;},
    transferRecord:async(action,key,value)=>{
      if(action==='get')return records.get(key);
      if(action==='claim'){if(records.has(key))return false;records.set(key,value);return true;}
      if(key.startsWith('attempt:')&&bindingError)throw Error('tab binding storage unavailable');
      puts.push({key,value});records.set(key,value);
    },
    chrome:{runtime:{id:'extension',getURL:name=>`chrome-extension://extension/${name}`},tabs:{query:async()=>[{id:123,windowId:17,url:'https://supplier.coupang.com/qvt/registration',...tabChanges}]},
      scripting:{executeScript:async(input)=>{if(input.func===context.verifySupplierHubCompany)return [{result:{code:company.code}}];
        if(input.args[1]===true){calls.push('preflight');return [{result:{state:occupied?'occupied':'ready',registered:false}}];}
        calls.push('execute');await onExecute?.();if(outcome==='rejected')throw Error('lost upload response');return [{result:{state:outcome,registered:false}}];}}},
  });
  vm.runInContext(source,context);
  return {calls,puts,records,saved,run:()=>context.dispatchPendingPackage({tabId:123,fingerprint},sender)};
}
test('worker binds dispatch before upload without a popup response callback',async()=>{
  let finish;const execution=new Promise(resolve=>{finish=resolve;});
  const run=setup({onExecute:()=>execution});const pending=run.run();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(run.puts.length,1);
  finish();assert.equal((await pending).state,'dispatched');
  assert.deepEqual(run.calls,['get','verify-source','preflight','verify-source','delete','execute']);
  assert.equal(run.puts[0].value.company.code,'A01464742');assert.equal(run.puts[0].key,'attempt:123');assert.equal(run.puts[0].value.productId,'p');
  assert.equal(run.puts[0].value.includedOptions,3);
  assert.deepEqual(Object.keys(run.puts[0].value).sort(),['categoryId','company','fingerprint','includedOptions','origin','productId']);
});
test('partial or uncertain dispatch preserves its lookup binding and is not retried',async()=>{
  for(const outcome of ['partial','rejected']){
    const run=setup({outcome});if(outcome==='partial')assert.equal((await run.run()).state,'partial');else await assert.rejects(run.run());
    assert.equal(run.puts.length,2);assert.deepEqual(run.calls,['get','verify-source','preflight','verify-source','delete','execute']);
    assert.equal(run.puts[0].key,'attempt:123');await assert.rejects(run.run(),/이미 전송/);
  }
});

test('old prepared packages and changed source stay unconsumed without an upload',async()=>{
 for(const options of [{sourceChangedAt:1},{sourceChangedAt:2},{savedChanges:{windowId:undefined}},{tabChanges:{windowId:18}}]){
  const run=setup(options);await assert.rejects(run.run());assert.equal(run.calls.includes('delete'),false);assert.equal(run.calls.includes('execute'),false);assert.equal(run.puts.length,0);
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

test('both companies preserve one shared claim and lookup binding even when popup upload acknowledgement fails',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}]){
  for(const outcome of ['dispatched','partial','rejected']){
   let beforeUpload;
   const h=setup({company,outcome,onExecute:()=>{beforeUpload=h.records.get('attempt:123');}});
   if(outcome==='rejected')await assert.rejects(h.run(),/lost upload response/);else assert.equal((await h.run()).state,outcome);
   assert.ok(beforeUpload,'popup dispatch must be recoverable before files can be uploaded');
   assert.equal(beforeUpload.company.code,company.code);assert.equal(beforeUpload.company.name,company.name);
   assert.equal(beforeUpload.includedOptions,3);assert.equal(beforeUpload.fingerprint,h.saved.fingerprint);
   const key=`transmission:${h.saved.origin}:p:80719:${h.saved.fingerprint}`;
   assert.equal(h.records.get(key).state,outcome==='dispatched'?'attached':outcome==='partial'?'partial':'unconfirmed');
   assert.equal(h.records.get(key).registered,false);
   await assert.rejects(h.run(),/이미 전송/);
   assert.equal(h.calls.filter(value=>value==='execute').length,1);
  }
 }
});

test('popup dispatch cannot consume or overwrite a package already claimed by app transmission',async()=>{
 const h=setup(),key=`transmission:${h.saved.origin}:p:80719:${h.saved.fingerprint}`;
 const previous={state:'unconfirmed',company:{code:'A01464742',name:'와이홉'},includedOptions:3};h.records.set(key,previous);
 await assert.rejects(h.run(),/이미 전송/);
 assert.equal(h.records.get(key),previous);assert.equal(h.puts.length,0);
 assert.equal(h.calls.includes('delete'),false);assert.equal(h.calls.includes('execute'),false);
});

test('popup preflight protects work in progress and failed binding never starts an upload',async()=>{
 const occupied=setup({occupied:true});await assert.rejects(occupied.run(),/기존 작업/);
 assert.equal(occupied.calls.includes('delete'),false);assert.equal(occupied.calls.includes('execute'),false);assert.equal(occupied.records.size,0);
 const failed=setup({bindingError:true});await assert.rejects(failed.run(),/binding storage/);
 assert.equal(failed.calls.includes('execute'),false);
 await assert.rejects(failed.run(),/이미 전송/);
});
test('a recovered accepted receipt blocks popup attachment before preflight or package consumption',async()=>{
 const h=setup(),key=resultKey(h.saved),receipt={state:'validation-complete',quotationId:'quote-123',receiptRecovered:true};h.records.set(key,receipt);
 await assert.rejects(h.run(),/이미 접수/);assert.equal(h.records.get(key),receipt);assert.equal(h.puts.length,0);
 for(const action of ['preflight','delete','execute'])assert.equal(h.calls.includes(action),false);
});
