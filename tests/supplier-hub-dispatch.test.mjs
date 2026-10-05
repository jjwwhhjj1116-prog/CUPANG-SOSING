import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {claimSupplierHubTransmissionWindow} from '../extensions/supplier-hub/transmission-window.mjs';
import {resultKey} from '../extensions/supplier-hub/handoff-store.mjs';
import {attachToSupplierHub} from '../extensions/supplier-hub/attach.mjs';
import {verifySupplierHubCompany} from '../extensions/supplier-hub/company.mjs';
import {isHubRegistrationTab} from '../extensions/supplier-hub/app-request.mjs';
const source=fs.readFileSync(new URL('../extensions/supplier-hub/dispatch.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');
function setup({outcome='dispatched',savedChanges={},senderChanges={},consume=true,tabChanges={},onExecute,sourceChangedAt,company={code:'A01464742',name:'와이홉'},occupied=false,bindingError=false,serverReceiptAt,onSource,onReceipt,onBinding,serialized=false}={}){
  const fingerprint='a'.repeat(64),calls=[],puts=[],records=new Map();
  const tab={id:123,windowId:17,url:'https://supplier.coupang.com/qvt/registration',...tabChanges},events=[];
  const inputs=['작성이 완료된 견적서 Excel 파일을 업로드하십시오.','상품 이미지를 업로드하십시오.','제품 필수 표시사항을 업로드하십시오.'].map(title=>({files:[],isConnected:true,disabled:false,closest:()=>null,parentElement:{innerText:title,querySelectorAll:()=>[{}]},dispatchEvent(){events.push(...this.files.map(file=>file.name));}}));
  const document={documentElement:{dataset:{}},body:{get innerText(){return 'Company Code: '+company.code+'\n'+inputs.flatMap(input=>input.files.map(file=>file.name)).join('\n');}},querySelectorAll:selector=>selector==='input[type="file"]'?inputs:[]};
  class Transfer{constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}}
  const executeSerialized=(func,args)=>vm.runInNewContext(`(${func.toString()})(...args)`,{document,args,location:new URL(tab.url),DataTransfer:Transfer,File,Event,Uint8Array,atob});
  const saved={origin:'http://localhost:3000',productId:'p',categoryId:'80719',fingerprint,createdAt:Date.now(),base64:'UEs=',appTabId:7,windowId:17,...savedChanges};let sourceChecks=0,receiptChecks=0;
  const sender={id:'extension',url:'chrome-extension://extension/popup.html',...senderChanges};
  const context=vm.createContext({Date,URL,Uint8Array,atob,claimSupplierHubTransmissionWindow,resultKey,isHubRegistrationTab,
    verifySupplierHubCompany,prepareAttachments:async()=>({company,productId:'p',categoryId:'80719',includedOptions:3,quotation:[{name:`YOOFAM-${fingerprint}.xlsx`,base64:'UEs='}],productImages:[{name:'photo.png',base64:'aW1hZ2U='}],labelImages:[{name:'label.png',base64:'bGFiZWw='}]}),attachToSupplierHub,
    verifyAppQuotationSource:async()=>{calls.push('verify-source');if(++sourceChecks===sourceChangedAt)throw Error('최신 저장본 변경');onSource?.(sourceChecks,tab);},
    assertAppSupplierHubNotSubmitted:async()=>{if(++receiptChecks===serverReceiptAt)throw Error('서버 전송 기록 확인');onReceipt?.(receiptChecks,tab);},
    pendingPackage:async action=>{calls.push(action);return action==='get'?saved:consume;},
    transferRecord:async(action,key,value)=>{
      if(action==='get')return records.get(key);
      if(action==='claim'){if(records.has(key))return false;records.set(key,value);return true;}
      if(key.startsWith('attempt:')&&bindingError)throw Error('tab binding storage unavailable');
      if(key.startsWith('attempt:'))onBinding?.(tab);
      puts.push({key,value});records.set(key,value);
    },
    chrome:{runtime:{id:'extension',getURL:name=>`chrome-extension://extension/${name}`},tabs:{query:async()=>[{...tab}],get:async id=>{assert.equal(id,tab.id);return {...tab};}},
      scripting:{executeScript:async(input)=>{if(input.func===context.verifySupplierHubCompany)return [{result:serialized?await executeSerialized(input.func,input.args):{code:company.code}}];
        if(input.args[1]===true){calls.push('preflight');return [{result:serialized?await executeSerialized(input.func,input.args):{state:occupied?'occupied':'ready',registered:false}}];}
        calls.push('execute');await onExecute?.();if(outcome==='rejected')throw Error('lost upload response');return [{result:serialized?await executeSerialized(input.func,input.args):{state:outcome,registered:false}}];}}},
  });
  vm.runInContext(source,context);
  return {calls,puts,records,saved,events,inputs,tab,run:()=>context.dispatchPendingPackage({tabId:123,fingerprint},sender)};
}

test('popup rechecks its Hub window after source or receipt waits before any serialized file change',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])for(const point of ['source-1','source-2','receipt-1','receipt-2']){
  const move=(phase,index,tab)=>{if(point===`${phase}-${index}`)tab.windowId=18;};
  const h=setup({company,serialized:true,onSource:(index,tab)=>move('source',index,tab),onReceipt:(index,tab)=>move('receipt',index,tab)});
  const failure=await h.run().then(()=>null,error=>error);
  assert.deepEqual(h.events,[],'moving to a different window must not dispatch real file change events');assert.match(failure?.message??'',/Chrome 창|탭.*이동/);assert.equal(h.inputs.every(input=>input.files.length===0),true);
  assert.equal(h.calls.includes('delete'),false);assert.equal(h.calls.includes('execute'),false);assert.equal(h.records.size,0);
 }
});

test('moving the popup target during durable binding prevents upload and keeps the consumed attempt sealed',async()=>{
 const h=setup({serialized:true,onBinding:tab=>{tab.windowId=18;}});
 const failure=await h.run().then(()=>null,error=>error);
 assert.deepEqual(h.events,[]);assert.match(failure?.message??'',/Chrome 창|탭.*이동/);
 const key=`transmission:${h.saved.origin}:p:80719:${h.saved.fingerprint}`;
 assert.equal(h.records.get(key).state,'unconfirmed');assert.equal(h.calls.filter(value=>value==='delete').length,1);
 h.tab.windowId=17;await assert.rejects(h.run(),/이미 전송/);assert.deepEqual(h.events,[]);assert.equal(h.calls.includes('execute'),false);
});

test('same-window popup dispatch still delivers the exact original files once for both companies',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}]){
  const h=setup({company,serialized:true}),before={...h.saved};assert.equal((await h.run()).state,'dispatched');
  assert.deepEqual(h.events,[`YOOFAM-${h.saved.fingerprint}.xlsx`,'photo.png','label.png']);
  assert.deepEqual(await Promise.all(h.inputs.map(async input=>Buffer.from(await input.files[0].arrayBuffer()).toString('base64'))),['UEs=','aW1hZ2U=','bGFiZWw=']);
  assert.deepEqual(h.saved,before);assert.equal(h.records.get('attempt:123').company.code,company.code);
  await assert.rejects(h.run(),/이미 전송/);assert.equal(h.events.length,3);
 }
});
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
test('server receipt checks happen before popup preflight and again before package consumption',async()=>{
 for(const serverReceiptAt of [1,2]){
  const h=setup({serverReceiptAt});await assert.rejects(h.run(),/서버 전송 기록/);
  assert.equal(h.calls.includes('delete'),false);assert.equal(h.calls.includes('execute'),false);assert.equal(h.puts.length,0);
  assert.equal(h.calls.includes('preflight'),serverReceiptAt===2);
 }
});
