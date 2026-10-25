import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {nativeRecoveryFixture} from './helpers/native-product-recovery.mjs';
import {createVerifiedProductDocumentBrowserAdapter} from '../extensions/supplier-hub/product-document-adapter.mjs';
import {normalizeSourceReadFailure,sourceReadError,readAppDocumentSource} from '../extensions/supplier-hub/product-document-source.mjs';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../extensions/supplier-hub/native-source-content-entry.mjs',import.meta.url))],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120'});
const copy=value=>JSON.parse(JSON.stringify(value));
const privateMarker='private-source-token-do-not-expose';
const proofFor=f=>({identity:f.context.identity,bodySha256:f.context.originalBodySha256,preparedBodySha256:f.context.bodySha256,packetDigest:f.context.packetDigest,requestId:f.packet.requestId,docId:null});
function contentFixture(f,{failure}={}){
 const calls=[],timers=new Map(),handlers=[],origin=f.context.identity.origin;let timerId=0;
 const setTimer=(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;};
 const reply=(url,value,status=200,contentType='application/json')=>{const response=new Response(typeof value==='string'?value:JSON.stringify(value),{status,headers:{'content-type':contentType}});Object.defineProperty(response,'url',{value:url});return response;};
 const fetch=async(url,init)=>{
  const parsed=new URL(url,origin);calls.push({path:parsed.pathname,query:parsed.search,method:init.method??'GET'});
  assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.method??'GET','GET');
  if(parsed.pathname.endsWith('/catalog-context'))return reply(parsed.href,{ownerId:f.context.identity.ownerId,company:f.context.identity.company});
  assert.equal(parsed.pathname,'/api/products/'+f.context.identity.productId+'/native-assets');
  if(failure==='http')return reply(parsed.href,'<html>'+privateMarker+'</html>',503,'text/html');
  if(failure==='network')throw new TypeError('Failed to fetch https://private.invalid/'+privateMarker);
  if(failure==='timeout')return new Promise((resolve,reject)=>{
   init.signal.addEventListener('abort',()=>reject(new DOMException(privateMarker,'AbortError')),{once:true});
   queueMicrotask(()=>{assert.equal(timers.size,1);for(const {callback,delay}of timers.values()){assert.equal(delay,30000);callback();}});
  });
  if(failure==='invalid-json')return reply(parsed.href,'{'+privateMarker);
  if(failure==='changed')return reply(parsed.href,{...copy(f.state.source),identity:{...copy(f.state.source.identity),productId:'changed-product'}});
  return reply(parsed.href,f.state.source);
 };
 const context=vm.createContext({location:new URL(origin),fetch,crypto:webcrypto,AbortController,DOMException,TextEncoder,TextDecoder,Uint8Array,URL,Response,structuredClone,btoa,atob,Date,setTimeout:setTimer,clearTimeout:id=>timers.delete(id),document:{visibilityState:'visible'},chrome:{runtime:{id:'source-bridge-fixture',onMessage:{addListener:handler=>handlers.push(handler)}}}});
 vm.runInContext(bundle.outputFiles[0].text,context);
 assert.equal(handlers.length,1);
 const dispatch=(message,sender={id:'source-bridge-fixture'})=>new Promise((resolve,reject)=>{
  try{const kept=handlers[0](copy(message),sender,value=>resolve(copy(value)));if(kept!==true)resolve(undefined);}catch(error){reject(error);}
 });
 return{calls,timers,dispatch};
}
async function withFixture(run){const f=await nativeRecoveryFixture();try{await run(f);}finally{f.close();}}
const nativeMessage=expected=>({type:'YOOFAM_READ_NATIVE_PRODUCT_DOCUMENT_SOURCE',expected});
const noPrivateText=value=>assert.doesNotMatch(JSON.stringify(value),/private-source-token|private\.invalid|<html>|Failed to fetch|changed-product/);

test('actual bundled source handler ignores foreign senders and unrelated messages before fetching',async()=>{
 await withFixture(async f=>{
  const h=contentFixture(f),message=nativeMessage(proofFor(f));
  assert.equal(await h.dispatch(message,{id:'foreign-extension'}),undefined);
  assert.equal(await h.dispatch(message,{}),undefined);
  assert.equal(await h.dispatch({...message,type:'YOOFAM_UNRELATED'}),undefined);
  assert.deepEqual(h.calls,[]);assert.equal(h.timers.size,0);
 });
});

test('actual bundled native reader proves the complete source through a top-frame message without app script injection',async()=>{
 await withFixture(async f=>{
  const h=contentFixture(f),messages=[];let injections=0;
  const api={tabs:{sendMessage:async(tabId,message,frame)=>{messages.push({tabId,type:message.type,frame});return h.dispatch(message);}},scripting:{executeScript:async()=>{injections++;throw Error('No app scripting permission');}}};
  const result=await readAppDocumentSource(api,f.context.identity,proofFor(f));
  assert.equal(result.current,true);assert.deepEqual(result.identity,f.context.identity);
  assert.equal(result.bodySha256,f.context.originalBodySha256);assert.equal(result.preparedBodySha256,f.context.bodySha256);
  assert.deepEqual(result.sourcePlan,f.state.source);assert.equal(injections,0);
  assert.deepEqual(messages,[{tabId:f.context.identity.appTabId,type:'YOOFAM_READ_NATIVE_PRODUCT_DOCUMENT_SOURCE',frame:{frameId:0}}]);
  assert.deepEqual(h.calls.map(row=>row.path),['/api/supplier-hub/catalog-context','/api/products/'+f.context.identity.productId+'/native-assets','/api/supplier-hub/catalog-context']);
  assert.equal(new URLSearchParams(h.calls[1].query).get('profileId'),f.context.identity.requestedProfileId);
  assert.equal(h.timers.size,0);
 });
});

for(const [failure,code]of [['http','SOURCE_READ_HTTP'],['network','SOURCE_READ_NETWORK'],['timeout','SOURCE_READ_TIMEOUT'],['invalid-json','SOURCE_READ_RESPONSE']]){
 test('actual bundled native reader reports bounded '+failure+' evidence without response or exception text',async()=>{
  await withFixture(async f=>{
   const h=contentFixture(f,{failure}),response=await h.dispatch(nativeMessage(proofFor(f)));
   assert.deepEqual(response,{ok:false,sourceFailure:{code,resource:'native-assets',...(failure==='http'?{status:503}:{})}});
   noPrivateText(response);assert.equal(h.calls.length,2);assert.equal(h.timers.size,0);
   const error=sourceReadError(response.sourceFailure);assert.equal(error.code,code);noPrivateText({message:error.message});
   if(failure==='http'){assert.match(error.message,/HTTP 503/);assert.match(error.message,/\/api\/products\/:id\/native-assets/);}
  });
 });
}

test('a changed native source remains a failed proof and does not expose rejected source fields',async()=>{
 await withFixture(async f=>{
  const h=contentFixture(f,{failure:'changed'}),response=await h.dispatch(nativeMessage(proofFor(f)));
  assert.deepEqual(response,{ok:false,sourceFailure:{code:'SOURCE_CHANGED'}});
  noPrivateText(response);assert.equal(h.timers.size,0);
 });
});

test('bridge sanitizes malformed failures, unavailable receivers and malformed success envelopes',async()=>{
 const identity={appTabId:17},input={identity};
 const invalid=[null,[],{code:privateMarker},{code:'SOURCE_READ_HTTP',resource:'native-assets',status:200},{code:'SOURCE_READ_HTTP',resource:'https://private.invalid/'+privateMarker,status:503},{code:'SOURCE_READ_NETWORK',status:503},{code:'SOURCE_READ_HTTP',resource:'native-assets',status:503,error:privateMarker}];
 for(const value of invalid){
  assert.equal(normalizeSourceReadFailure(value),null);
  await assert.rejects(readAppDocumentSource({tabs:{sendMessage:async()=>({ok:false,sourceFailure:value,error:privateMarker})}},identity,input),error=>{assert.equal(error.code,'SOURCE_CHANGED');noPrivateText({message:error.message});return true;});
 }
 await assert.rejects(readAppDocumentSource({tabs:{sendMessage:async()=>{throw Error(privateMarker);}}},identity,input),error=>{assert.equal(error.code,'SOURCE_BRIDGE_UNAVAILABLE');noPrivateText({message:error.message});return true;});
 for(const result of [null,[],privateMarker])await assert.rejects(readAppDocumentSource({tabs:{sendMessage:async()=>({ok:true,result})}},identity,input),error=>{assert.equal(error.code,'SOURCE_READ_RESPONSE');noPrivateText({message:error.message});return true;});
 const failure={code:'SOURCE_READ_HTTP',resource:'native-assets',status:503},normalized=normalizeSourceReadFailure(failure);assert.deepEqual(normalized,failure);assert.notEqual(normalized,failure);
});

test('legacy source requests use their explicit message kind and the same top-frame bridge',async()=>{
 const calls=[],identity={appTabId:18},input={identity,bodySha256:'a'.repeat(64)},result={current:true};
 const api={tabs:{sendMessage:async(tabId,message,frame)=>{calls.push({tabId,message,frame});message.expected.bodySha256='mutated';return{ok:true,result};}}};
 assert.equal(await readAppDocumentSource(api,identity,input,'legacy'),result);
 assert.equal(input.bodySha256,'a'.repeat(64));assert.equal(calls[0].message.type,'YOOFAM_READ_LEGACY_PRODUCT_DOCUMENT_SOURCE');assert.deepEqual(calls[0].frame,{frameId:0});
});

test('native adapter selection and source proof need no app executeScript permission',async()=>{
 await withFixture(async f=>{
  const h=contentFixture(f),send=f.api.tabs.sendMessage,execute=f.api.scripting.executeScript,messages=[];let appInjections=0,selected;
  f.api.tabs.sendMessage=async(tabId,message,frame)=>{messages.push(message.type);if(message.type==='YOOFAM_READ_NATIVE_PRODUCT_DOCUMENT_SOURCE'){assert.equal(tabId,f.context.identity.appTabId);assert.deepEqual(frame,{frameId:0});return h.dispatch(message);}return send(tabId,message,frame);};
  f.api.scripting.executeScript=async request=>{if(request.target.tabId===f.context.identity.appTabId){appInjections++;throw Error('No app activeTab permission');}return execute(request);};
  try{
   selected=await createVerifiedProductDocumentBrowserAdapter(f.context,{api:f.api});assert.equal(selected.nativeAssets,true);
   const proof=await selected.adapter.readSource(proofFor(f));assert.equal(proof.current,true);assert.deepEqual(proof.identity,f.context.identity);
   assert.equal(appInjections,0);assert.ok(messages.filter(type=>type==='YOOFAM_READ_NATIVE_PRODUCT_DOCUMENT_SOURCE').length>=2);assert.equal(messages.includes('YOOFAM_READ_LEGACY_PRODUCT_DOCUMENT_SOURCE'),false);
  }finally{selected?.adapter.dispose();}
 });
});

for(const failure of ['missing-receiver','http','changed']){
 test('native adapter selection fails closed on '+failure+' without falling back to legacy',async()=>{
  await withFixture(async f=>{
   const h=contentFixture(f,{failure}),messages=[];let injections=0;
   f.api.tabs.sendMessage=async(tabId,message,frame)=>{messages.push(message.type);assert.equal(tabId,f.context.identity.appTabId);assert.deepEqual(frame,{frameId:0});if(failure==='missing-receiver')throw Error(privateMarker);return h.dispatch(message);};
   f.api.scripting.executeScript=async()=>{injections++;throw Error('No app activeTab permission');};
   await assert.rejects(createVerifiedProductDocumentBrowserAdapter(f.context,{api:f.api}),error=>{assert.equal(error.code,failure==='http'?'SOURCE_READ_HTTP':failure==='changed'?'SOURCE_CHANGED':'SOURCE_BRIDGE_UNAVAILABLE');noPrivateText({message:error.message});return true;});
   assert.deepEqual(messages,['YOOFAM_READ_NATIVE_PRODUCT_DOCUMENT_SOURCE']);assert.equal(injections,0);
  });
 });
}
