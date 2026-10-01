import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';
import {parseProductJsonLd} from '../extensions/supplier-hub/product-jsonld.mjs';

const sourceUrl='https://detail.1688.com/offer/813724060928.html';
const originalTitle='太阳眼镜木纹腿男女复古墨镜高级感潮遮阳防紫外线太阳镜复古墨镜';
const plain=value=>JSON.parse(JSON.stringify(value));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

function harness(mobileSource){
 const timers=new Map(),cache=new Map();let timerId=0;
 const deps={parse5,'@/extensions/supplier-hub/product-jsonld.mjs':{parseProductJsonLd}};
 if(mobileSource)deps['@/app/alibaba-mobile-collector']={collectAlibabaMobileProduct:mobileSource};
 const load=file=>{
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
   {exports,Error,URL,URLSearchParams,Headers,Response,TextEncoder,TextDecoder,AbortController,structuredClone,Date,
    setTimeout:(callback,milliseconds)=>{const id=++timerId;timers.set(id,{callback,milliseconds});return id;},clearTimeout:id=>timers.delete(id),
    require:name=>deps[name]??load(name.slice(2)+'.ts')});
  return exports;
 };
 return {load,timers,fire(milliseconds){const selected=[...timers].find(([,timer])=>timer.milliseconds===milliseconds);assert.ok(selected,`timer ${milliseconds} must exist`);timers.delete(selected[0]);selected[1].callback();}};
}
function mobileFixture(){
 const h=harness();
 const page=JSON.parse(fs.readFileSync(new URL('./fixtures/1688-mobile-813724060928.json',import.meta.url),'utf8'));
 const skus=JSON.parse(fs.readFileSync(new URL('./fixtures/1688-skus-813724060928.json',import.meta.url),'utf8'));
 const detail=fs.readFileSync(new URL('./fixtures/1688-description-813724060928.txt',import.meta.url),'utf8');
 const parser=h.load('app/alibaba-mobile-product.ts');
 return parser.parseAlibabaMobileProduct(parser.parseAlibabaMobilePage('<script>window.__INIT_DATA='+JSON.stringify(page)+';</script>',sourceUrl),skus,parser.parseAlibabaMobileDescription(detail));
}
const mobile=mobileFixture();
const desktopHtml=()=>'<script type="application/ld+json">'+JSON.stringify({'@type':'Product',url:sourceUrl,name:'Original PC product',sku:'pc-sku',image:'https://cbu01.alicdn.com/pc.jpg',offers:{'@type':'Offer',price:'3.6',priceCurrency:'CNY',eligibleQuantity:{minValue:1}}})+'</script>';
function hangingRequest(signal,onAbort=()=>{}){
 return new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>{onAbort();reject(Error('request stopped'));},{once:true});});
}

test('PC network and unusable HTTP responses recover through the same offer mobile source',async()=>{
 for(const failure of ['network',429,500,503,'mime']){
  const calls=[];
  const h=harness(async(url,options)=>{calls.push('mobile');assert.equal(url,sourceUrl);assert.equal(options.signal.aborted,false);return structuredClone(mobile);});
  const result=await h.load('app/public-product-collector.ts').collectPublicProduct(sourceUrl+'?tracking=ignored',{fetcher:async(url,init)=>{
   calls.push('pc');assert.equal(url,sourceUrl);assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');
   if(failure==='network')throw Error('PC unreachable');
   return failure==='mime'?Response.json({loginRequired:true}):new Response('unavailable',{status:failure});
  }});
  assert.equal(result.offerId,'813724060928');assert.equal(result.title,originalTitle);
  assert.deepEqual(plain(result.options.map(row=>row.unitPriceCny)),[3.6,5.5,3.6,5.5,3.6,5.5]);
  assert.deepEqual(calls,['pc','mobile']);assert.equal(h.timers.size,0);
 }
});

test('slow PC response cannot hold a complete mobile receipt and the losing PC request is stopped',async()=>{
 let pcAborted=false,mobileStarted=0,mobileSignal;const outer=new AbortController();
 const h=harness(async(url,options)=>{mobileStarted++;assert.equal(url,sourceUrl);mobileSignal=options.signal;return structuredClone(mobile);});
 const running=h.load('app/public-product-collector.ts').collectPublicProduct(sourceUrl,{signal:outer.signal,fetcher:async(_url,init)=>hangingRequest(init.signal,()=>{pcAborted=true;})});
 try{
  await flush();assert.equal(mobileStarted,0);
  h.fire(750);await flush();
  const result=await running;assert.equal(result.options.length,6);assert.equal(pcAborted,true);
  assert.equal(mobileStarted,1);assert.equal(mobileSignal.aborted,true);assert.equal(h.timers.size,0);
 }finally{outer.abort();await running.catch(()=>{});}
});

test('fast valid PC product avoids the extra mobile request',async()=>{
 let mobileStarted=0;const h=harness(async()=>{mobileStarted++;throw Error('unneeded mobile request');});
 const result=await h.load('app/public-product-collector.ts').collectPublicProduct(sourceUrl,{fetcher:async()=>new Response(desktopHtml(),{headers:{'content-type':'text/html'}})});
 assert.equal(result.options[0].sku,'pc-sku');assert.equal(mobileStarted,0);assert.equal(h.timers.size,0);
});

test('explicit PC authentication or access denial stops the other branch even when it already started',async()=>{
 for(const status of [401,403])for(const speculative of [false,true]){
  const response=deferred();let started=0,mobileAborted=false;
  const h=harness(async(_url,options)=>{started++;return hangingRequest(options.signal,()=>{mobileAborted=true;});});
  const running=h.load('app/public-product-collector.ts').collectPublicProduct(sourceUrl,{fetcher:()=>response.promise});
  const rejected=assert.rejects(running,/인증·접근 확인/);await flush();
  if(speculative){h.fire(750);await flush();}
  response.resolve(new Response('access required',{status}));await rejected;
  assert.equal(started,speculative?1:0);assert.equal(mobileAborted,speculative);assert.equal(h.timers.size,0);
 }
});

test('failed speculative mobile source leaves the PC path able to produce the exact product',async()=>{
 const response=deferred();let mobileStarted=0;const outer=new AbortController();
 const h=harness(async()=>{mobileStarted++;throw Error('mobile check required');});
 const running=h.load('app/public-product-collector.ts').collectPublicProduct(sourceUrl,{signal:outer.signal,fetcher:()=>response.promise});
 try{
  await flush();h.fire(750);await flush();assert.equal(mobileStarted,1);
  response.resolve(new Response(desktopHtml(),{headers:{'content-type':'text/html'}}));
  assert.equal((await running).options[0].sku,'pc-sku');assert.equal(h.timers.size,0);
 }finally{response.resolve(new Response(''));outer.abort();await running.catch(()=>{});}
});

test('cancelling before or during speculation stops sources and cannot start a replacement request',async()=>{
 for(const when of ['before','pc','both']){
  const outer=new AbortController();let pc=0,started=0,aborted=0;
  const h=harness(async(_url,options)=>{started++;return hangingRequest(options.signal,()=>{aborted++;});});
  if(when==='before')outer.abort();
  const running=h.load('app/public-product-collector.ts').collectPublicProduct(sourceUrl,{signal:outer.signal,fetcher:async(_url,init)=>{pc++;return hangingRequest(init.signal,()=>{aborted++;});}});
  // Handle the rejection before yielding so a pre-aborted request cannot leak.
  const rejected=assert.rejects(running,/취소|초과/);
  await flush();if(when==='both'){h.fire(750);await flush();}
  outer.abort();await rejected;
  assert.equal(pc,when==='before'?0:1);assert.equal(started,when==='both'?1:0);
  assert.equal(aborted,pc+started);assert.equal(h.timers.size,0);
 }
});

test('the one shared deadline stops both source requests without a fake receipt or a further retry',async()=>{
 let started=0,aborted=0;const h=harness(async(_url,options)=>{started++;return hangingRequest(options.signal,()=>{aborted++;});});
 const running=h.load('app/public-product-collector.ts').collectPublicProduct(sourceUrl,{fetcher:async(_url,init)=>hangingRequest(init.signal,()=>{aborted++;})});
 const rejected=assert.rejects(running,/취소|초과/);await flush();
 h.fire(750);await flush();h.fire(30000);await rejected;
 assert.equal(started,1);assert.equal(aborted,2);assert.equal(h.timers.size,0);
});

test('a mobile success cancels a partially streamed PC page, with no late competing receipt',async()=>{
 let readerCancelled=false;const outer=new AbortController();
 const h=harness(async()=>structuredClone(mobile));
 const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('<html>'));},cancel(){readerCancelled=true;}});
 const running=h.load('app/public-product-collector.ts').collectPublicProduct(sourceUrl,{signal:outer.signal,fetcher:async(_url,init)=>{
  init.signal.addEventListener('abort',()=>void body.cancel().catch(()=>{}),{once:true});
  return new Response(body,{headers:{'content-type':'text/html'}});
 }});
 try{
  await flush();h.fire(750);const result=await running;await flush();
  assert.equal(result.title,originalTitle);assert.equal(readerCancelled,true);assert.equal(h.timers.size,0);
 }finally{outer.abort();}
});
