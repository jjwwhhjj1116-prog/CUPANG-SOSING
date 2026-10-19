import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {probe1688Product,capture1688Product,cancel1688Capture,productSnapshotReady} from '../extensions/supplier-hub/capture-1688.mjs';

// Synthetic offer only. Chrome APIs and page metadata are inert local values.
const sourceUrl='https://detail.1688.com/offer/628000000730.html';
const request={type:'YOOFAM_PROBE_1688',requestId:'00000000-0000-4000-8000-000000000730',sourceUrl};
const sender={tab:{id:7,windowId:17},frameId:0,url:'https://sourceflow.jjwwhhjj1116.workers.dev/products'};
const source={'@type':'ProductGroup',url:sourceUrl,name:'synthetic existing product',image:['https://cbu01.alicdn.com/synthetic.jpg'],hasVariant:[{'@type':'Product',name:'Black',sku:'synthetic-sku',offers:{'@type':'Offer',price:'12.5',priceCurrency:'CNY',eligibleQuantity:{minValue:1}}}]};
const plain=value=>JSON.parse(JSON.stringify(value));
const turn=()=>new Promise(resolve=>setImmediate(resolve));

function extension({existing=true,snapshots=[source],onRead=()=>{},onWait=()=>{}}={}){
 const calls=[],tabs=new Map([[7,{...sender.tab,url:sender.url}],[9,{id:9,windowId:17,status:'complete',url:sourceUrl,active:true}]]);let reads=0;
 const api={tabs:{query:async value=>{calls.push(['query',value]);return existing?[{...tabs.get(9)}]:[];},get:async id=>{calls.push(['get',id]);return{...tabs.get(id)};},
  create:async()=>assert.fail('probe must not create a tab'),update:async()=>assert.fail('probe must not navigate a tab'),remove:async()=>assert.fail('probe must not remove a tab')},
  scripting:{executeScript:async()=>{calls.push(['read',++reads]);const value=snapshots[Math.min(reads-1,snapshots.length-1)];await onRead({tabs,reads,calls});return[{frameId:0,result:{pageUrl:sourceUrl,scripts:value===null?[]:[JSON.stringify(value)]}}];}},
  runtime:{id:'a'.repeat(32)},webRequest:{onHeadersReceived:{addListener(){assert.fail('no mobile headers');},removeListener(){assert.fail('no mobile headers');}}},declarativeNetRequest:{getSessionRules:async()=>assert.fail('no mobile transport'),updateSessionRules:async()=>assert.fail('no mobile transport')}};
 return{api,tabs,calls,run:()=>probe1688Product(request,sender,api,{fetcher:()=>assert.fail('probe must not fetch'),wait:async(ms,signal)=>{calls.push(['wait',ms]);await onWait({tabs,reads,calls,signal});}})};
}
function assertReadOnly(h){assert.ok(h.calls.every(([kind])=>['get','query','read','wait'].includes(kind)));assert.equal(h.tabs.size,2);assert.equal(h.tabs.get(9).active,true);}

test('existing-only probe returns three stable complete same-window reads without mobile or tab mutation',async()=>{
 const h=extension(),result=await h.run();assert.deepEqual(result,{ok:true,sourceUrl,scripts:[JSON.stringify(source)]});
 assert.equal(productSnapshotReady(result.scripts,sourceUrl).options[0].unitPriceCny,12.5);
 assert.equal(h.calls.filter(([kind])=>kind==='read').length,3);assert.deepEqual(h.calls.filter(([kind])=>kind==='wait').map(([,ms])=>ms),[250,250]);assertReadOnly(h);
});

for(const kind of ['missing','loading','incomplete','changing'])test(kind+' existing page returns unavailable and never enters the ordinary capture fallback',async()=>{
 const incomplete=structuredClone(source);delete incomplete.hasVariant[0].offers.eligibleQuantity;
 const changed=structuredClone(source);changed.hasVariant[0].offers.price='17.2';
 const h=extension({existing:kind!=='missing',snapshots:kind==='incomplete'?[incomplete]:kind==='changing'?[source,changed,source]:[source]});
 if(kind==='loading')h.tabs.get(9).status='loading';
 assert.deepEqual(await h.run(),{ok:true,sourceUrl,available:false});assertReadOnly(h);
 assert.equal(h.calls.filter(([type])=>type==='read').length,['missing','loading'].includes(kind)?0:3);
});

test('moving the source or app window, foreign pending URL and post-read navigation cannot return source evidence',async()=>{
 for(const change of [tabs=>tabs.get(9).windowId=18,tabs=>tabs.get(9).url='https://login.example.test/',tabs=>tabs.get(9).pendingUrl='https://detail.1688.com/offer/999.html',tabs=>tabs.get(7).windowId=18]){
  const h=extension({onRead:({tabs})=>change(tabs)});await assert.rejects(h.run(),/Chrome 창|로그인|앱 탭/);
  assert.equal(h.calls.filter(([kind])=>kind==='read').length,1);assertReadOnly(h);
 }
});

test('cancelling a probe immediately stops its quiet proof and leaves normal capture lane usable',async()=>{
 const h=extension({onWait:()=>{assert.equal(cancel1688Capture({...request,type:'YOOFAM_CANCEL_1688'},sender).cancelled,true);}});
 await assert.rejects(h.run(),/취소/);assert.equal(h.calls.filter(([kind])=>kind==='read').length,1);assertReadOnly(h);
 const next=extension();const result=await capture1688Product({...request,type:'YOOFAM_CAPTURE_1688'},sender,next.api,{wait:async()=>{}});
 assert.equal(result.ok,true);assert.equal(next.calls.filter(([kind])=>kind==='read').length,3);assertReadOnly(next);
});

test('the whole probe deadline bounds a stalled inventory before any DOM read and late inventory cannot revive it',async()=>{
 const h=extension();let release;h.api.tabs.query=()=>new Promise(resolve=>{release=resolve;});
 const started=Date.now(),result=await h.run();assert.deepEqual(result,{ok:true,sourceUrl,available:false});assert.ok(Date.now()-started<2500);
 release([{...h.tabs.get(9)}]);await turn();assert.equal(h.calls.filter(([kind])=>kind==='read').length,0);assertReadOnly(h);
});

test('stalled DOM is bounded, does not block another probe afterward and cannot schedule late reads',async()=>{
 let release;const h=extension({onRead:()=>new Promise(resolve=>{release=resolve;})});
 const started=Date.now(),result=await h.run();assert.deepEqual(result,{ok:true,sourceUrl,available:false});assert.ok(Date.now()-started<2500);
 assert.equal(h.calls.filter(([kind])=>kind==='read').length,1);assert.equal((await extension().run()).ok,true);
 release();await turn();assert.equal(h.calls.filter(([kind])=>kind==='read').length,1);assertReadOnly(h);
});

test('another active capture receives no cancellation or overlapping Chrome read from the probe',async()=>{
 let release,entered;const ready=new Promise(resolve=>{entered=resolve;});
 const busy=extension({onRead:async({reads})=>{if(reads===1){entered();await new Promise(resolve=>{release=resolve;});}}}),pending=busy.run();
 await ready;const other=extension();assert.deepEqual(await other.run(),{ok:true,sourceUrl,available:false});assert.equal(other.calls.length,0);
 release();await pending;assertReadOnly(busy);assertReadOnly(other);
});

test('wrong URL, frame, sender window and unknown probe fields stop before any Chrome API is called',async()=>{
 for(const [message,scope]of [
  [{...request,sourceUrl:'https://detail.1688.com/offer/628000000730.html?offerId=628000000730'},sender],
  [{...request,sourceUrl:'https://foreign.example/offer/628000000730.html'},sender],
  [{...request,type:'YOOFAM_CAPTURE_1688'},sender],
  [{...request,receipt:{registered:true}},sender],
  [request,{...sender,frameId:1}],
  [request,{...sender,tab:{id:7,windowId:-1}}],
  [request,{...sender,url:'https://foreign.example'}],
 ]){
  const h=extension();await assert.rejects(probe1688Product(message,scope,h.api));assert.equal(h.calls.length,0);
 }
});

function bridge({respond=true,capability={ok:true,version:'0.2.81',existingProductProbe:true}}={}){
 const events=new Map(),sent=[],timers=new Map(),cache=new Map();let timerId=0,request=0;
 const location={origin:'https://sourceflow.jjwwhhjj1116.workers.dev'};
 const window={location,addEventListener:(type,fn)=>events.set(type,fn),removeEventListener:(type,fn)=>{if(events.get(type)===fn)events.delete(type);},postMessage(value,target){sent.push({value,target});if(respond&&value.type==='PING')queueMicrotask(()=>events.get('message')?.({source:window,origin:target,data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:value.requestId,result:capability}}));}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,window,location,AbortController,TextEncoder,Error,queueMicrotask,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++request).padStart(12,'0')}`},setTimeout:(callback,delay)=>{timers.set(++timerId,{callback,delay});return timerId;},clearTimeout:id=>timers.delete(id),require:name=>load(name.slice(2)+'.ts')});return exports;}
 const client=load('app/browser-product-bridge.ts');
 return{client,events,sent,timers,async begin(signal=new AbortController().signal){const promise=client.probe1688FromChrome(sourceUrl,signal);void promise.catch(()=>{});for(let i=0;i<6;i++)await Promise.resolve();return{promise};},receive(result,overrides={}){const message=sent.find(item=>item.value.type==='PROBE')?.value;events.get('message')?.({source:window,origin:location.origin,data:{channel:'YOOFAM_1688_CAPTURE_RESULT',requestId:message?.requestId,result},...overrides});}};
}

test('bridge gates a distinct probe command and forwards only bounded raw JSON-LD evidence',async()=>{
 const h=bridge(),{promise}=await h.begin();assert.deepEqual(h.sent.map(item=>item.value.type),['PING','PROBE']);
 h.receive({ok:true,sourceUrl,scripts:[JSON.stringify(source)]});assert.deepEqual(plain(await promise),{sourceUrl,scripts:[JSON.stringify(source)]});assert.equal(h.events.size,0);assert.equal(h.timers.size,0);
});

test('missing, old and non-supporting extensions fall back without sending a new or ordinary capture command',async()=>{
 for(const capability of [{ok:true,version:'0.2.72'},{ok:true,version:'0.2.80',existingProductProbe:false},{ok:false,error:'extension unavailable'}]){
  const h=bridge({capability}),{promise}=await h.begin();assert.equal(await promise,null);assert.deepEqual(h.sent.map(item=>item.value.type),['PING']);assert.equal(h.events.size,0);assert.equal(h.timers.size,0);
 }
 const h=bridge({respond:false}),{promise}=await h.begin();const deadline=[...h.timers.values()].find(timer=>timer.delay===750);assert.ok(deadline);deadline.callback();assert.equal(await promise,null);
 assert.deepEqual(h.sent.map(item=>item.value.type),['PING']);assert.equal(h.events.size,0);assert.equal(h.timers.size,0);
});

test('unavailable or invalid probe replies safely return null rather than pretending receipt success',async()=>{
 for(const result of [{ok:true,sourceUrl,available:false},{ok:false,error:'read failed'},{ok:true,sourceUrl:sourceUrl.replace('628000000730','999'),scripts:['{}']},
  {ok:true,sourceUrl,scripts:[]},{ok:true,sourceUrl,scripts:['']},{ok:true,sourceUrl,scripts:[true]},{ok:true,sourceUrl,scripts:['가'.repeat(800000)]},
  {ok:true,sourceUrl,scripts:['{}'],receipt:{registered:true}},{ok:true,sourceUrl,format:'1688-public-sku-capture-v1',skuPayload:{}}]){
  const h=bridge(),{promise}=await h.begin();h.receive(result);assert.equal(await promise,null);assert.equal(h.events.size,0);assert.equal(h.timers.size,0);assert.deepEqual(h.sent.map(item=>item.value.type),['PING','PROBE']);
 }
});

test('probe timeout cancels only its raw read and same-window identity checks ignore foreign replies',async()=>{
 const h=bridge(),{promise}=await h.begin();h.receive({ok:true,sourceUrl,scripts:['{}']},{origin:'https://foreign.example'});h.receive({ok:true,sourceUrl,scripts:['{}']},{source:{}});
 assert.equal(h.events.size,1);const timer=[...h.timers.values()].find(timer=>timer.delay===1500);assert.ok(timer);timer.callback();assert.equal(await promise,null);
 assert.deepEqual(h.sent.map(item=>item.value.type),['PING','PROBE','CANCEL']);assert.equal(h.sent[1].value.requestId,h.sent[2].value.requestId);assert.equal(h.events.size,0);assert.equal(h.timers.size,0);
 h.receive({ok:true,sourceUrl,scripts:['{}']});assert.equal(h.sent.length,3);
});

test('caller cancellation throws during presence or probe without falling through to another capture',async()=>{
 for(const presence of [true,false]){
  const h=bridge({respond:!presence}),controller=new AbortController(),{promise}=await h.begin(controller.signal);controller.abort();await assert.rejects(promise,/취소/);
  assert.deepEqual(h.sent.map(item=>item.value.type),presence?['PING']:['PING','PROBE','CANCEL']);assert.equal(h.events.size,0);assert.equal(h.timers.size,0);
 }
 const h=bridge(),controller=new AbortController();controller.abort();await assert.rejects(h.client.probe1688FromChrome(sourceUrl,controller.signal),/취소/);assert.equal(h.sent.length,0);
});

test('content capability follows installed manifest, and PROBE has its own strict worker mapping',async()=>{
 for(const version of ['0.2.72','0.2.80','0.2.81','0.3.0','1.0.0']){
  const handlers=[],responses=[],messages=[],location={origin:'http://localhost:3000'},window={addEventListener:(_type,fn)=>handlers.push(fn),postMessage:value=>responses.push(value)};
  const chrome={runtime:{getManifest:()=>({version}),onMessage:{addListener(){}},sendMessage:async message=>{messages.push(message);return{ok:true,sourceUrl,available:false};}}};
  vm.runInNewContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8'),{window,location,chrome});
  const event={source:window,origin:location.origin,data:{channel:'YOOFAM_HUB_HANDOFF',requestId:request.requestId,type:'PING'}};await handlers[0](event);
  assert.equal(responses[0].result.existingProductProbe,!['0.2.72','0.2.80'].includes(version));
  await handlers[1]({...event,data:{channel:'YOOFAM_1688_CAPTURE',requestId:request.requestId,type:'PROBE',sourceUrl}});
  assert.deepEqual(plain(messages),[{type:'YOOFAM_PROBE_1688',requestId:request.requestId,sourceUrl}]);assert.equal(responses.length,2);
 }
});

test('actual worker routes the probe to the existing-only implementation without invoking ordinary capture',async()=>{
 const calls=[];let listener;
 const chrome={runtime:{onMessage:{addListener(fn){listener=fn;}}}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-worker.mjs',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {chrome,Error,exports:{},require:name=>name==='./capture-1688.mjs'?{
   async probe1688Product(message,scope){calls.push({message:plain(message),scope:plain(scope)});return{ok:true,sourceUrl:message.sourceUrl,available:false};},
   capture1688Product(){assert.fail('probe cannot use ordinary capture');},cancel1688Capture(){assert.fail('no implicit cancellation');},
  }:{}});
 const result=await new Promise(resolve=>{assert.equal(listener(request,sender,resolve),true);});
 assert.deepEqual(plain(result),{ok:true,sourceUrl,available:false});assert.deepEqual(calls,[{message:request,scope:sender}]);
});

test('non-browser probe returns unavailable before creating listeners, timers or extension requests',async()=>{
 const exports={};let requests=0,timers=0;
 const code=ts.transpileModule(fs.readFileSync(new URL('../app/browser-product-bridge.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,Error,setTimeout(){timers++;assert.fail('no browser means no timer');},require(){return{exchange(){requests++;assert.fail('no browser means no extension request');}};}});
 assert.equal(await exports.probe1688FromChrome(sourceUrl,new AbortController().signal),null);
 const controller=new AbortController();controller.abort();await assert.rejects(exports.probe1688FromChrome(sourceUrl,controller.signal),/취소/);
 assert.equal(requests,0);assert.equal(timers,0);
});
