import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateAppHubRequest} from '../extensions/supplier-hub/app-request.mjs';
const code=fs.readFileSync(new URL('../extensions/supplier-hub/handoff-worker.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
const identity={productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64)};
const sender={frameId:0,url:'http://localhost:3000/',tab:{id:7,windowId:17}};
function fixture({claimed=false,storeFails=false,transmitError=false}={}){
 let handler;const calls=[];
 vm.runInNewContext(code,{validateAppHubRequest,URL,chrome:{runtime:{onMessage:{addListener(callback){handler=callback;}}}},
  refreshSupplierHubRegistration:async(message,who)=>{calls.push(['registration',message,who]);return {quotationId:'quote-123'};},
  capture1688Product:async(message,who)=>{calls.push(['capture',message,who]);return {ok:true};},
  cancel1688Capture:(message,who)=>{calls.push(['cancel-capture',message,who]);return {ok:true,cancelled:true};},
  transmitSupplierHubPackage:async()=>{if(transmitError)throw Error('회사코드 불일치');return {state:'validation-requested',registered:false};},
  transferRecord:async(action,key)=>{calls.push(['store',action,key]);if(storeFails)throw Error('record read failure');return claimed?{state:'started'}:undefined;}
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
