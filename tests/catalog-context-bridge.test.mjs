import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const origin='https://sourceflow.jjwwhhjj1116.workers.dev',path='/api/supplier-hub/catalog-context';
const member={ownerId:'synthetic_owner',company:{code:'A01464742',name:'와이홉'}};
const bundle=fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function reply(body=member,status=200,{url=origin+path,type='application/json',redirected=false}={}){
 return {ok:status>=200&&status<300,status,url,redirected,headers:{get:()=>type},text:async()=>typeof body==='string'?body:JSON.stringify(body)};
}
function bridge(fetcher){
 let listener,serial=0;const timers=new Map(),calls=[];
 const context={window:{addEventListener(){},postMessage(){assert.fail('Context reads cannot publish a source update');}},location:{origin},URL,AbortController,
  chrome:{runtime:{id:'synthetic_extension',onMessage:{addListener:value=>{listener=value;}}}},
  setTimeout:(callback,delay)=>{assert.equal(delay,10000);const id=++serial;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),
  fetch:async(url,options)=>{assert.equal(url,path);assert.equal(options.method,'GET');assert.equal(options.cache,'no-store');assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');calls.push(options);return fetcher(calls.length,options);}};
 vm.runInNewContext(bundle,context);
 return {calls,timers,read:()=>new Promise(resolve=>{assert.equal(listener({type:'YOOFAM_READ_CATALOG_CONTEXT'},{id:'synthetic_extension'},resolve),true);})};
}

for(const [label,fetcher,code] of [
 ['HTTP 401',()=>reply({},401),'YOOFAM_LOGIN_REQUIRED'],['HTTP 403',()=>reply({},403),'YOOFAM_COMPANY_REQUIRED'],
 ['HTTP 503',()=>reply({},503),'YOOFAM_CONTEXT_SERVICE_ERROR'],['network failure',()=>{throw TypeError('Failed to fetch');},'YOOFAM_CONTEXT_SERVICE_ERROR'],
 ['invalid JSON',()=>reply('{broken'),'YOOFAM_CONTEXT_INVALID'],['HTML login content',()=>reply('<html>login</html>',200,{type:'text/html'}),'YOOFAM_CONTEXT_INVALID'],
 ['foreign response URL',()=>reply({},401,{url:'https://unrelated.invalid/'}),'YOOFAM_CONTEXT_INVALID'],
 ['redirect',()=>reply(member,200,{redirected:true}),'YOOFAM_CONTEXT_INVALID'],['missing company',()=>reply({ownerId:'owner'}),'YOOFAM_CONTEXT_INVALID'],
 ['unapproved company',()=>reply({...member,company:{code:'unknown',name:'unknown'}}),'YOOFAM_CONTEXT_INVALID'],
])test('context bridge classifies '+label+' without exposing an invented login state',async()=>{
 const h=bridge(fetcher),result=await h.read();assert.equal(result.ok,false);assert.equal(result.code,code);assert.equal(h.timers.size,0);assert.equal(h.calls.length,1);
});

test('context bridge bounds both headers and body even when the synthetic transport ignores abort',async()=>{
 for(const waitingBody of [false,true]){
  const h=bridge(()=>waitingBody?{...reply(),text:()=>new Promise(()=>{})}:new Promise(()=>{})),reading=h.read();await turn();
  assert.equal(h.timers.size,1);[...h.timers.values()][0]();const result=await reading;
  assert.equal(result.ok,false);assert.equal(result.code,'YOOFAM_CONTEXT_TIMEOUT');assert.equal(h.calls[0].signal.aborted,true);assert.equal(h.timers.size,0);
 }
});

test('context authorization fences never reuse a pending request or a settled old owner',async()=>{
 let release;const held=new Promise(resolve=>{release=resolve;});
 const other={ownerId:'next_owner',company:{code:'A01526306',name:'유앤채'}},h=bridge(index=>index===1?held:reply(other));
 const first=h.read();await turn();const second=await h.read();assert.equal(second.ownerId,other.ownerId);assert.equal(h.calls.length,2);
 release(reply());assert.equal((await first).ownerId,member.ownerId);
 const third=await h.read();assert.equal(third.ownerId,other.ownerId);assert.equal(h.calls.length,3);assert.equal(h.timers.size,0);
});
