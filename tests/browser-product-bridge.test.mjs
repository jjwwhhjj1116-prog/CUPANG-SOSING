import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const url='https://detail.1688.com/offer/813724060928.html';
const requestId='00000000-0000-4000-8000-000000000001';
function fixture({respond=true,capability={ok:true,publicMobileCapture:true}}={}){
 const events=new Map(),sent=[],timers=new Map(),cache=new Map();let id=0,requests=0;
 const location={origin:'https://sourceflow.jjwwhhjj1116.workers.dev'};
 const window={location,addEventListener:(type,handler)=>events.set(type,handler),removeEventListener:(type,handler)=>{if(events.get(type)===handler)events.delete(type);},postMessage(value,origin){sent.push({value,origin});if(respond&&value.type==='PING')queueMicrotask(()=>events.get('message')?.({source:window,origin,data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:value.requestId,result:capability}}));}};
 function load(file){const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,window,TextEncoder,crypto:{randomUUID:()=>requests++===0?'00000000-0000-4000-8000-000000000002':requestId},location,queueMicrotask,setTimeout:(callback,delay)=>{timers.set(++id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),Error,require:name=>cache.get(name.slice(2)+'.ts')??load(name.slice(2)+'.ts'),
 });return exports;}
 const exports=load('app/browser-product-bridge.ts');
 return {exports,sent,timers,events,async begin(signal=new AbortController().signal){const pending=exports.capture1688FromChrome(url,signal);void pending.catch(()=>{});for(let i=0;i<4;i++)await Promise.resolve();return{pending};},receive(data,origin=location.origin,source=window){events.get('message')?.({source,origin,data});}};
}
test('bridge accepts bounded SKU-only raw evidence and rejects malformed, oversized or invented receipt fields',async()=>{
 const source={ok:true,sourceUrl:url,format:'1688-public-sku-capture-v1',skuPayload:JSON.parse(fs.readFileSync(new URL('fixtures/1688-public-sku-813724060928.json',import.meta.url),'utf8'))};
 const h=fixture(),{pending}=await h.begin();
 h.receive({channel:'YOOFAM_1688_CAPTURE_RESULT',requestId,result:source});
 assert.deepEqual(Object.keys(await pending).sort(),['sourceUrl','format','skuPayload'].sort());assert.equal(h.events.size,0);assert.equal(h.timers.size,0);
 for(const mutate of [value=>value.skuPayload=null,value=>value.skuPayload=[],value=>value.skuPayload.self=value.skuPayload,
  value=>value.skuPayload.padding='가'.repeat(700000),value=>value.receipt={title:'invented'},value=>value.sourceUrl=url.replace('813724060928','999')]){
  const h=fixture(),{pending}=await h.begin(),value=structuredClone(source);mutate(value);
  h.receive({channel:'YOOFAM_1688_CAPTURE_RESULT',requestId,result:value});await assert.rejects(pending,/1688/);assert.equal(h.events.size,0);assert.equal(h.timers.size,0);
 }
});
test('bridge cancellation stops exactly its capture and removes listeners before a late result',async()=>{
 const h=fixture(),controller=new AbortController();const {pending}=await h.begin(controller.signal);
 assert.equal(h.sent.length,2);assert.equal(h.sent[0].value.type,'PING');assert.equal(h.sent[1].value.type,'CAPTURE');assert.equal([...h.timers.values()][0].delay,45000);
 controller.abort();await assert.rejects(pending,/취소/);
 assert.equal(h.sent[2].value.type,'CANCEL');assert.equal(h.sent[2].value.requestId,requestId);assert.equal(h.sent[2].value.sourceUrl,url);
 assert.equal(h.events.size,0);assert.equal(h.timers.size,0);
 h.receive({channel:'YOOFAM_1688_CAPTURE_RESULT',requestId,result:{ok:true,sourceUrl:url,scripts:['{}']}});assert.equal(h.sent.length,3);
 const stopped=fixture();await assert.rejects(stopped.exports.capture1688FromChrome(url,controller.signal),/취소/);assert.equal(stopped.sent.length,0);
});
test('bridge timeout sends cancellation and accepts only its own same-window result',async()=>{
 const h=fixture(),controller=new AbortController();const {pending}=await h.begin(controller.signal);
 const data={channel:'YOOFAM_1688_CAPTURE_RESULT',requestId,result:{ok:true,sourceUrl:url,scripts:['{}']}};
 h.receive(data,'https://other.example');h.receive(data,undefined,{});h.receive({...data,requestId:'unrelated'});assert.equal(h.events.size,1);
 [...h.timers.values()][0].callback();await assert.rejects(pending,/1688 원문 수집 응답/);
 assert.equal(h.sent.at(-1).value.type,'CANCEL');assert.equal(h.events.size,0);assert.equal(h.timers.size,0);
 const done=fixture(),other=new AbortController(),{pending:success}=await done.begin(other.signal);done.receive(data);
 assert.equal((await success).sourceUrl,url);other.abort();assert.equal(done.sent.length,2);assert.equal(done.events.size,0);
});
test('content script forwards capture identity and cancellation without creating a stale response',async()=>{
 const handlers=[],messages=[],responses=[];
 const window={addEventListener:(_type,fn)=>handlers.push(fn),postMessage:message=>responses.push(message)};
 vm.runInNewContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8'),{window,location:{origin:'http://localhost:3000'},chrome:{runtime:{onMessage:{addListener(){}},sendMessage:async message=>{messages.push(message);return {ok:true};}}}});
 const event=type=>({source:window,origin:'http://localhost:3000',data:{channel:'YOOFAM_1688_CAPTURE',requestId,type,sourceUrl:url}});
 await handlers[1](event('CAPTURE'));await handlers[1](event('CANCEL'));
 assert.deepEqual(JSON.parse(JSON.stringify(messages)),[
  {type:'YOOFAM_CAPTURE_1688',requestId,sourceUrl:url},{type:'YOOFAM_CANCEL_1688',requestId,sourceUrl:url},
 ]);
 assert.equal(responses.length,1);assert.equal(responses[0].requestId,requestId);
 await handlers[1]({...event('CAPTURE'),source:{}});assert.equal(messages.length,2);
});

test('bridge forwards only bounded public mobile source fields for server revalidation',async()=>{
 const h=fixture(),{pending}=await h.begin();
 const source={sourceUrl:url,format:'1688-public-mobile-capture-v1',mobileHtml:'<script>window.__INIT_DATA={}</script>',skuPayload:{ret:['SUCCESS']},detailSource:'',ok:true,untrustedReceipt:{title:'ignored'}};
 h.receive({channel:'YOOFAM_1688_CAPTURE_RESULT',requestId,result:source});
 const result=await pending;assert.deepEqual(Object.keys(result).sort(),['sourceUrl','format','mobileHtml','skuPayload','detailSource'].sort());assert.equal(result.mobileHtml,source.mobileHtml);
 assert.equal(h.events.size,0);assert.equal(h.timers.size,0);
});

test('bridge rejects mobile source mismatches, cyclic JSON and byte limits without hanging',async()=>{
 for(const change of [s=>s.sourceUrl=url.replace('813724060928','999'),s=>s.mobileHtml='',s=>s.mobileHtml='가'.repeat(700000),s=>s.skuPayload=[],s=>s.skuPayload.self=s.skuPayload,s=>s.format='unknown']){
  const h=fixture(),{pending}=await h.begin();
  const source={sourceUrl:url,format:'1688-public-mobile-capture-v1',mobileHtml:'<script>window.__INIT_DATA={}</script>',skuPayload:{ret:['SUCCESS']},detailSource:'',ok:true};change(source);
  h.receive({channel:'YOOFAM_1688_CAPTURE_RESULT',requestId,result:source});await assert.rejects(pending,/1688/);assert.equal(h.events.size,0);assert.equal(h.timers.size,0);
 }
});

test('missing or unsupported extension stops before capture instead of waiting for the 45s source deadline',async()=>{
 const missing=fixture({respond:false}),{pending}=await missing.begin();
 assert.equal([...missing.timers.values()][0].delay,2000);assert.deepEqual(missing.sent.map(item=>item.value.type),['PING']);
 [...missing.timers.values()][0].callback();await assert.rejects(pending,/현재 Chrome의 상품 수집 확장 응답/);assert.equal(missing.events.size,0);assert.equal(missing.timers.size,0);
 for(const capability of [{ok:false,error:'fixture failure'},{ok:true},{ok:true,publicMobileCapture:false}]){
  const h=fixture({capability}),{pending}=await h.begin();await assert.rejects(pending,/수집/);assert.deepEqual(h.sent.map(item=>item.value.type),['PING']);assert.equal(h.events.size,0);assert.equal(h.timers.size,0);
 }
});

test('aborting the presence check never starts or cancels a source capture and ignores late replies',async()=>{
 const h=fixture({respond:false}),controller=new AbortController(),{pending}=await h.begin(controller.signal);
 const ping=h.sent[0].value;controller.abort();await assert.rejects(pending,/취소/);assert.equal(h.events.size,0);assert.equal(h.timers.size,0);
 h.receive({channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:ping.requestId,result:{ok:true,publicMobileCapture:true}});
 assert.deepEqual(h.sent.map(item=>item.value.type),['PING']);
});

test('actual content script answers bridge presence and forwards one source capture with distinct identities',async()=>{
 const handlers=new Set(),sent=[],commands=[],cache=new Map(),location={origin:'https://sourceflow.jjwwhhjj1116.workers.dev'};
 const manifest=JSON.parse(fs.readFileSync(new URL('../extensions/supplier-hub/manifest.json',import.meta.url),'utf8'));
 const window={location,addEventListener:(_type,fn)=>handlers.add(fn),removeEventListener:(_type,fn)=>handlers.delete(fn),postMessage(data,origin){
  sent.push({data,origin});queueMicrotask(()=>{for(const handler of [...handlers])void handler({source:window,origin,data});});
 }};
 const chrome={runtime:{getManifest:()=>manifest,onMessage:{addListener(){}},sendMessage:async command=>{
  commands.push(command);assert.equal(command.type,'YOOFAM_CAPTURE_1688');assert.equal(command.sourceUrl,url);
  return {ok:true,sourceUrl:url,format:'1688-public-sku-capture-v1',skuPayload:{ret:['SUCCESS'],data:{offerId:'813724060928'}}};
 }}};
 vm.runInNewContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8'),{window,location,chrome});
 let requests=0;
 function load(file){const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,window,location,TextEncoder,setTimeout,clearTimeout,Error,crypto:{randomUUID:()=>requests++===0?'00000000-0000-4000-8000-000000000002':requestId},require:name=>cache.get(name.slice(2)+'.ts')??load(name.slice(2)+'.ts'),
 });return exports;}
 const result=await load('app/browser-product-bridge.ts').capture1688FromChrome(url,new AbortController().signal);
 assert.equal(result.sourceUrl,url);assert.equal(result.format,'1688-public-sku-capture-v1');assert.equal(commands.length,1);
 assert.deepEqual(sent.map(item=>item.data.type||item.data.channel),['PING','YOOFAM_HUB_HANDOFF_RESULT','CAPTURE','YOOFAM_1688_CAPTURE_RESULT']);
 assert.equal(sent[1].data.result.version,manifest.version);assert.notEqual(sent[0].data.requestId,sent[2].data.requestId);
 assert.equal(sent[2].data.requestId,commands[0].requestId);assert.equal(handlers.size,2);assert.ok(sent.every(item=>item.origin===location.origin));
});
