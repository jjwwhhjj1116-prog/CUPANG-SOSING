import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {webcrypto} from 'node:crypto';

const native=createRequire(import.meta.url),root=fileURLToPath(new URL('../../',import.meta.url));
export const plain=value=>JSON.parse(JSON.stringify(value)),now=Date.now(),origin='http://localhost:3000',company={code:'A01526306',name:'유앤채'},requestId='11111111-1111-4111-8111-111111111111',amendmentId='22222222-2222-4222-8222-222222222222';
export const lookup={origin,ownerId:'owner',company,productId:'product',requestId,docId:2362997,parentIdentityDigest:'1'.repeat(64),parentPacketDigest:'2'.repeat(64),parentReviewDigest:'3'.repeat(64),parentSourcePlanSha256:'4'.repeat(64),parentOriginalBodySha256:'5'.repeat(64),parentPreparedBodySha256:'6'.repeat(64)};
export const anchor={...lookup,parentCheckpointSequence:15,parentCheckpointSha256:'7'.repeat(64)},descriptor={format:'yoofam-native-draft-detail-amendment-descriptor-v1',amendmentId,anchor},reserved={format:'yoofam-native-draft-detail-amendment-begin-v1',amendmentId,lookup},scope={identity:{ownerId:'owner',company,productId:'product'}};
export function observation(extra={}){return{format:'yoofam-native-draft-detail-amendment-v1',amendmentId,anchor:plain(anchor),state:'editing',sequence:1,observedAt:now,previewDigest:null,latest:null,validatedSteps:[],needsRecovery:false,capabilities:{appendDetail:true},execution:{create:0,upload:0,update:0,validate:0,submit:0},readOnly:true,registered:false,...extra};}
export const review={format:'yoofam-supplier-hub-product-document-v1',type:'YOOFAM_PRODUCT_DOCUMENT_REVIEW',identity:{ownerId:'owner',company,productId:'product',fingerprint:'9'.repeat(64)},members:[{optionId:'red',optionLabel:'빨강',documentIndex:0}],body:{},originalBodySha256:'a'.repeat(64),preparedBodySha256:'b'.repeat(64),reviewDigest:'8'.repeat(64),registered:false,remoteWrites:false,submissionReady:false};
export const latest={reviewDigest:review.reviewDigest,sourcePlanSha256:review.identity.fingerprint,originalBodySha256:review.originalBodySha256,preparedBodySha256:review.preparedBodySha256,identityDigest:'c'.repeat(64),packetDigest:'d'.repeat(64)};
export function fixture(options={}){
 const stored=options.stored??new Map(),listeners=new Set(),timers=new Map(),sent=[],modules=new Map();let timerId=0;
 const parent={format:'yoofam-product-document-pending-v1',origin,ownerId:'owner',companyCode:company.code,companyName:company.name,productId:'product',requestId,createdAt:now-1000,reviewDigest:lookup.parentReviewDigest,originalBodySha256:lookup.parentOriginalBodySha256,preparedBodySha256:lookup.parentPreparedBodySha256,identityDigest:lookup.parentIdentityDigest,appTabId:1,windowId:2};
 const parentKey='yoofam-product-document-pending:'+JSON.stringify([origin,'owner',company.code,company.name,'product']);if(!stored.has(parentKey))stored.set(parentKey,JSON.stringify(parent));
 const h={stored,sent,parentKey,parent,actor:{ownerId:'owner',company:plain(company)},reply:null,capability:{ok:true,version:'2.1.88',nativeDraftDetailAmendment:true}};
 const window={location:{origin},localStorage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value),removeItem:()=>assert.fail('amendment never deletes pending')},navigator:{locks:{request:async(_key,_options,run)=>run()}},
  addEventListener:(type,callback)=>{if(type==='message')listeners.add(callback);},removeEventListener:(type,callback)=>{if(type==='message')listeners.delete(callback);},
  postMessage(message,target){assert.equal(target,origin);assert.ok(['PRODUCT_DOCUMENT_DETAIL_AMENDMENT','PING'].includes(message.type));sent.push(plain(message));
   if(message.type==='PING')void Promise.resolve().then(()=>{for(const callback of [...listeners])callback({source:window,origin,data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:message.requestId,result:h.capability}});});
   else if(h.reply)void Promise.resolve().then(()=>h.reply(message));}};
 h.window=window;h.emit=(message,value,overrides={})=>{for(const callback of [...listeners])callback({source:window,origin,data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:message.requestId,result:{ok:true,result:value}},...overrides});};
 const load=file=>{if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports,Error,Date,URL,TextEncoder,TextDecoder,Uint8Array,AbortController,structuredClone,crypto:webcrypto,window,fetch:async()=>Response.json(h.actor),setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),require:name=>name.endsWith('.css')?{}:options.modules&&Object.hasOwn(options.modules,name)?options.modules[name]:name.startsWith('@/')?load(name.slice(2)+(name.includes('/components/')?'.tsx':'.ts')):native(name.startsWith('.')?path.resolve(root,path.dirname(file),name):name)},{filename:file});return exports;};
 h.load=load;h.advance=()=>{for(const[id,timer]of [...timers]){timers.delete(id);timer.callback();}};return h;
}
