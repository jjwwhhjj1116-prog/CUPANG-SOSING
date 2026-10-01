import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateAppHubRequest} from '../extensions/supplier-hub/app-request.mjs';
import {resultKey} from '../extensions/supplier-hub/handoff-store.mjs';
const code=fs.readFileSync(new URL('../extensions/supplier-hub/handoff-worker.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
const identity={productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64)};
const sender={frameId:0,url:'http://localhost:3000/',tab:{id:7,windowId:17}};
function fixture({claimed=false,storeFails=false,transmitError=false,records=new Map()}={}){
 let handler;const calls=[];
 vm.runInNewContext(code,{validateAppHubRequest,resultKey,URL,chrome:{runtime:{onMessage:{addListener(callback){handler=callback;}}}},
  refreshSupplierHubRegistration:async(message,who)=>{calls.push(['registration',message,who]);return {quotationId:'quote-123'};},
  capture1688Product:async(message,who)=>{calls.push(['capture',message,who]);return {ok:true};},
  cancel1688Capture:(message,who)=>{calls.push(['cancel-capture',message,who]);return {ok:true,cancelled:true};},
  transmitSupplierHubPackage:async()=>{if(transmitError)throw Error('회사코드 불일치');return {state:'validation-requested',registered:false};},
  transferRecord:async(action,key)=>{calls.push(['store',action,key]);if(storeFails)throw Error('record read failure');return claimed?{state:'started'}:records.get(key);}
 });
 return {calls,run(type,who=sender){return new Promise(resolve=>assert.equal(handler({...identity,type},who,resolve),true));}};
}

test('worker routes collection cancellation to its initiating app identity',async()=>{
 const h=fixture();const result=await h.run('YOOFAM_CANCEL_1688');
 assert.equal(result.cancelled,true);assert.equal(h.calls[0][0],'cancel-capture');assert.equal(h.calls[0][2],sender);
});
test('worker routes app registration lookup and returns its record without requiring the popup',async()=>{
 const h=fixture();const result=await h.run('YOOFAM_REFRESH_REGISTRATION');
 assert.equal(h.calls[0][0],'registration');assert.equal(result.record.quotationId,'quote-123');assert.equal(result.fingerprint,identity.fingerprint);assert.equal(result.registered,false);
});
test('worker only permits transmission retry when it proves there is no persisted upload claim',async()=>{
 const h=fixture({transmitError:true});const retry=await h.run('YOOFAM_TRANSMIT_PACKAGE');
 assert.equal(retry.ok,true);assert.equal(retry.result.state,'not-started');assert.equal(retry.result.registered,false);assert.equal(retry.result.error,'회사코드 불일치');
 for(const options of [{claimed:true},{storeFails:true}]){
  const uncertain=fixture({...options,transmitError:true});const result=await uncertain.run('YOOFAM_TRANSMIT_PACKAGE');assert.equal(result.ok,false);assert.equal(result.result,undefined);
 }
 const untrusted=fixture({transmitError:true});const result=await untrusted.run('YOOFAM_TRANSMIT_PACKAGE',{...sender,frameId:1});assert.equal(result.ok,false);assert.equal(untrusted.calls.length,0);
});
test('a server-restored receipt cannot be advertised as an upload that never started',async()=>{
 const key=resultKey({origin:new URL(sender.url).origin,...identity}),records=new Map([[key,{state:'validation-complete',quotationId:'quote-123',receiptRecovered:true}]]);
 const h=fixture({transmitError:true,records}),result=await h.run('YOOFAM_TRANSMIT_PACKAGE');
 assert.equal(result.ok,false);assert.equal(result.result,undefined);assert.equal(records.size,1);
 assert.equal(h.calls.at(-1)[2],key);
});

test('cache recovery reads only the exact origin/product/category/fingerprint records across worker restarts',async()=>{
 const key=`${new URL(sender.url).origin}:${identity.productId}:${identity.categoryId}:${identity.fingerprint}`;
 const attempt={...identity,state:'attached',registered:false},record={...identity,quotationId:'123',registered:false};
 const records=new Map([[`transmission:${key}`,attempt],[`result:${key}`,record],[`transmission:https://foreign.example:p:80719:${identity.fingerprint}`,{state:'unconfirmed'}]]);
 for(let restart=0;restart<2;restart++){
  const h=fixture({records}),result=await h.run('YOOFAM_GET_RESULT');
  assert.equal(result.attempt,attempt);assert.equal(result.record,record);assert.equal(result.registered,false);
  assert.deepEqual(h.calls,[['store','get',`result:${key}`],['store','get',`transmission:${key}`]]);
  assert.equal(records.size,3);
 }
 const empty=await fixture().run('YOOFAM_GET_RESULT');assert.equal(empty.attempt,null);assert.equal(empty.record,null);
 const partial=await fixture({records:new Map([[`transmission:${key}`,attempt]])}).run('YOOFAM_GET_RESULT');assert.equal(partial.attempt,attempt);assert.equal(partial.record,null);
});

test('untrusted or incomplete app sender cannot read persisted upload records',async()=>{
 for(const patch of [{url:'https://foreign.example/'},{frameId:1},{tab:{id:7}},{tab:{id:-1,windowId:17}},{tab:{id:7,windowId:-1}}]){
  const h=fixture(),result=await h.run('YOOFAM_GET_RESULT',{...sender,...patch});assert.equal(result.ok,false);assert.equal(h.calls.length,0);
 }
 const h=fixture({storeFails:true}),result=await h.run('YOOFAM_GET_RESULT');assert.equal(result.ok,false);assert.equal(result.attempt,undefined);
});
