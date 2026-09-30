import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const url='https://detail.1688.com/offer/813724060928.html';
const requestId='00000000-0000-4000-8000-000000000001';
function fixture(){
 const events=new Map(),sent=[],timers=new Map(),exports={};let id=0;
 const window={addEventListener:(type,handler)=>events.set(type,handler),removeEventListener:(type,handler)=>{if(events.get(type)===handler)events.delete(type);},postMessage:(value,origin)=>sent.push({value,origin})};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/browser-product-bridge.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,window,TextEncoder,crypto:{randomUUID:()=>requestId},location:{origin:'https://sourceflow.jjwwhhjj1116.workers.dev'},setTimeout:(callback,delay)=>{timers.set(++id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),Error,
 });
 return {exports,sent,timers,events,receive(data,origin='https://sourceflow.jjwwhhjj1116.workers.dev',source=window){events.get('message')?.({source,origin,data});}};
}
test('bridge cancellation stops exactly its capture and removes listeners before a late result',async()=>{
 const h=fixture(),controller=new AbortController();const pending=h.exports.capture1688FromChrome(url,controller.signal);
 assert.equal(h.sent.length,1);assert.equal(h.sent[0].value.type,'CAPTURE');assert.equal([...h.timers.values()][0].delay,45000);
 controller.abort();await assert.rejects(pending,/취소/);
 assert.equal(h.sent[1].value.type,'CANCEL');assert.equal(h.sent[1].value.requestId,requestId);assert.equal(h.sent[1].value.sourceUrl,url);
 assert.equal(h.events.size,0);assert.equal(h.timers.size,0);
 h.receive({channel:'YOOFAM_1688_CAPTURE_RESULT',requestId,result:{ok:true,sourceUrl:url,scripts:['{}']}});assert.equal(h.sent.length,2);
 const stopped=fixture();await assert.rejects(stopped.exports.capture1688FromChrome(url,controller.signal),/취소/);assert.equal(stopped.sent.length,0);
});
test('bridge timeout sends cancellation and accepts only its own same-window result',async()=>{
 const h=fixture(),controller=new AbortController();const pending=h.exports.capture1688FromChrome(url,controller.signal);
 const data={channel:'YOOFAM_1688_CAPTURE_RESULT',requestId,result:{ok:true,sourceUrl:url,scripts:['{}']}};
 h.receive(data,'https://other.example');h.receive(data,undefined,{});h.receive({...data,requestId:'unrelated'});assert.equal(h.events.size,1);
 [...h.timers.values()][0].callback();await assert.rejects(pending,/0.2.29/);
 assert.equal(h.sent.at(-1).value.type,'CANCEL');assert.equal(h.events.size,0);assert.equal(h.timers.size,0);
 const done=fixture(),other=new AbortController(),success=done.exports.capture1688FromChrome(url,other.signal);done.receive(data);
 assert.equal((await success).sourceUrl,url);other.abort();assert.equal(done.sent.length,1);assert.equal(done.events.size,0);
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
 const h=fixture(),pending=h.exports.capture1688FromChrome(url,new AbortController().signal);
 const source={sourceUrl:url,format:'1688-public-mobile-capture-v1',mobileHtml:'<script>window.__INIT_DATA={}</script>',skuPayload:{ret:['SUCCESS']},detailSource:'',ok:true,untrustedReceipt:{title:'ignored'}};
 h.receive({channel:'YOOFAM_1688_CAPTURE_RESULT',requestId,result:source});
 const result=await pending;assert.deepEqual(Object.keys(result).sort(),['sourceUrl','format','mobileHtml','skuPayload','detailSource'].sort());assert.equal(result.mobileHtml,source.mobileHtml);
 assert.equal(h.events.size,0);assert.equal(h.timers.size,0);
});

test('bridge rejects mobile source mismatches, cyclic JSON and byte limits without hanging',async()=>{
 for(const change of [s=>s.sourceUrl=url.replace('813724060928','999'),s=>s.mobileHtml='',s=>s.mobileHtml='가'.repeat(700000),s=>s.skuPayload=[],s=>s.skuPayload.self=s.skuPayload,s=>s.format='unknown']){
  const h=fixture(),pending=h.exports.capture1688FromChrome(url,new AbortController().signal);
  const source={sourceUrl:url,format:'1688-public-mobile-capture-v1',mobileHtml:'<script>window.__INIT_DATA={}</script>',skuPayload:{ret:['SUCCESS']},detailSource:'',ok:true};change(source);
  h.receive({channel:'YOOFAM_1688_CAPTURE_RESULT',requestId,result:source});await assert.rejects(pending,/1688/);assert.equal(h.events.size,0);assert.equal(h.timers.size,0);
 }
});
