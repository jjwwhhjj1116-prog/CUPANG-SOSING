import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/cli-bridge-client.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,URLSearchParams,Response,Request,Headers,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,Date,fetch:()=>{throw Error('Unexpected real network');}});
const {parseCliLink,parseCliScope,createCliBridge}=exports;
const sessionId='00000000-0000-4000-8000-000000000789',jobId='00000000-0000-4000-8000-000000000790';
const owner={ownerId:'synthetic-owner-a',company:{code:'A01526306',name:'유앤채'}},other={ownerId:'synthetic-owner-b',company:{code:'A01464742',name:'와이홉'}};
const link={port:49831,token:'a'.repeat(64),sessionId};
const sourceUrl='https://detail.1688.com/offer/700000000789.html';
const json=(value,status=200)=>Response.json(value,{status});
const service={format:'yoofam-product-query-service-v1',provider:'public-page',configured:true,liveVerified:false,queryPath:'/api/product-query'};
async function until(predicate){for(let n=0;n<200;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,1));}throw Error('Timed out waiting for synthetic bridge');}
function harness({approved=false,jobCommand='product-query',payload={sourceUrl},jobScope=owner,jobDeadline,interval=60000}={}){
 const calls=[],states=[],jobs=[{jobId,command:jobCommand,payload,scope:jobScope,createdAt:Date.now(),deadline:jobDeadline??Date.now()+60000}];let scope=owner,sourceGate,scopeReads=0,handler;
 const fetcher=async(url,init={})=>{
  calls.push({url,...init,body:init.body?JSON.parse(init.body):undefined});
  if(url==='/api/supplier-hub/catalog-context'){scopeReads++;return scope?json(scope):json({error:'logged out'},401);}
  if(url.startsWith('http://127.0.0.1:49831/')){
   if(url.endsWith('/pair'))return json({ok:true,protocolVersion:'1.0',sessionId,scope:owner,expiresAt:Date.now()+14*60000});
   if(url.includes('/next?')){if(jobs.length)return json({ok:true,job:jobs.shift()});return new Promise((resolve,reject)=>{if(init.signal.aborted){reject(new DOMException('aborted','AbortError'));return;}init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});});}
   if(url.endsWith('/result'))return handler?handler(url,init):json({ok:true});
   if(url.endsWith('/disconnect'))return json({ok:true});
   if(url.endsWith('/abort'))return json({ok:true});
   throw Error('Unapproved loopback path');
  }
  if(url==='/api/product-query'){
   if(sourceGate)await sourceGate;
   return handler?handler(url,init):json(init.method==='POST'?{...owner,offerId:'700000000789',source:{sourceUrl,offerId:'700000000789',title:'Synthetic only',options:[{name:'example'}]},provider:'public-page',sourceStored:false,draftCreated:false}:{...owner,service});
  }
  if(url==='/api/cli-read?resource=category-profiles')return handler?handler(url,init):json({...owner,profiles:[],nextCursor:null});
  if(url.startsWith('/api/cli-read?resource=collection-job'))return handler?handler(url,init):json({...owner,job:{id:jobId,status:'pending'}});
  throw Error('Unexpected external request '+url);
 };
 let permission=approved;
 const bridge=createCliBridge({link,scope:owner,queryApproved:()=>permission,fetcher,onState:state=>states.push(state),contextIntervalMs:interval});
 return{bridge,calls,states,scope(value){scope=value;},permission(value){permission=value;},sourceGate(value){sourceGate=value;},handler(value){handler=value;},get scopeReads(){return scopeReads;},results:()=>calls.filter(call=>call.url.endsWith('/result'))};
}
test('one-time link accepts only one port/token/session and never an arbitrary local host',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(parseCliLink('#port=49831&token='+link.token+'&session='+sessionId))),link);
 for(const hash of ['','#port=80&token='+link.token+'&session='+sessionId,'#port=65536&token='+link.token+'&session='+sessionId,'#port=49831&token=secret&session='+sessionId,'#port=49831&token='+link.token+'&session='+sessionId+'&host=evil.test','#port=49831&port=49832&token='+link.token+'&session='+sessionId])assert.throws(()=>parseCliLink(hash),/CLI/);
 assert.throws(()=>parseCliScope({...owner,company:{code:owner.company.code,name:'와이홉'}}));
});
test('default query permission fails closed without sending a product-query API request',async()=>{
 const h=harness();try{await h.bridge.start();await until(()=>h.results().length===1);assert.equal(h.results()[0].body.error.code,'QUERY_NOT_APPROVED');assert.equal(h.calls.filter(call=>call.url==='/api/product-query').length,0);assert.ok(h.calls.every(call=>!call.url.includes('1688.com')));}finally{h.bridge.stop();}
});
test('approved synthetic query forwards owner/company and returns unpersisted result once',async()=>{
 const h=harness({approved:true});try{await h.bridge.start();await until(()=>h.results().length===1);const request=h.calls.find(call=>call.url==='/api/product-query');assert.deepEqual(request.body,{sourceUrl,expectedOwnerId:owner.ownerId,expectedCompany:owner.company});assert.equal(request.credentials,'same-origin');assert.equal(request.redirect,'manual');assert.equal(h.results()[0].body.ok,true);assert.equal(h.results()[0].body.result.sourceStored,false);assert.ok(h.scopeReads>=5);for(const call of h.calls.filter(call=>call.url.startsWith('http:'))){assert.equal(call.credentials,'omit');assert.equal(call.headers.authorization,'Bearer '+link.token);}assert.ok(h.states.some(state=>state.lastResult?.optionCount===1));}finally{h.bridge.stop();}
});
for(const [command,payload,path] of [['status',{},'/api/product-query'],['category-profiles/list',{},'/api/cli-read?resource=category-profiles'],['collection-job/status',{jobId},'/api/cli-read?resource=collection-job&jobId='+jobId]])test(`read-only command ${command} uses a fixed same-origin endpoint`,async()=>{
 const h=harness({jobCommand:command,payload});try{await h.bridge.start();await until(()=>h.results().length===1);const request=h.calls.find(call=>call.url===path);assert.equal(request.method,'GET');assert.equal(request.body,undefined);assert.deepEqual(JSON.parse(decodeURIComponent(request.headers['x-yoofam-cli-scope'])),owner);assert.equal(h.results()[0].body.ok,true);}finally{h.bridge.stop();}
});
for(const [command,payload] of [['fetch',{url:'https://evil.test'}],['product-query',{sourceUrl:'https://evil.test/offer/700000000789.html'}],['product-query',{sourceUrl:'https://detail.1688.com@evil.test/offer/700000000789.html'}],['product-query',{sourceUrl,method:'POST'}],['category-profiles/list',{after:'../secret'}],['collection-job/status',{id:'other/123'}]])test(`untrusted command ${command} cannot expand endpoint or payload access`,async()=>{
 const h=harness({approved:true,jobCommand:command,payload});try{await h.bridge.start();await until(()=>h.results().length===1);assert.equal(h.results()[0].body.ok,false);assert.equal(h.calls.filter(call=>call.url.startsWith('/api/')&&call.url!=='/api/supplier-hub/catalog-context').length,0);}finally{h.bridge.stop();}
});
test('job for a different company terminates without first-party query or local result',async()=>{
 const h=harness({approved:true,jobScope:other});try{await h.bridge.start();await until(()=>h.states.at(-1)?.phase==='stopped');assert.equal(h.results().length,0);assert.equal(h.calls.filter(call=>call.url==='/api/product-query').length,0);}finally{h.bridge.stop();}
});
test('owner switch during an in-flight read prevents late result and cannot revive after returning',async()=>{
 let release;const h=harness({approved:true});h.sourceGate(new Promise(resolve=>{release=resolve;}));try{await h.bridge.start();await until(()=>h.calls.some(call=>call.url==='/api/product-query'));h.scope(other);release();await until(()=>h.states.at(-1)?.phase==='stopped');h.scope(owner);assert.equal(h.results().length,0);await assert.rejects(h.bridge.start(),/새 CLI 연결/);assert.equal(h.results().length,0);}finally{release?.();h.bridge.stop();}
});
test('observed logout stops long poll permanently and sends no job result',async()=>{
 const h=harness({jobCommand:'status',payload:{},interval:2});try{await h.bridge.start();await until(()=>h.results().length===1);h.scope(null);await until(()=>h.states.at(-1)?.phase==='stopped');const results=h.results().length;h.scope(owner);await new Promise(resolve=>setTimeout(resolve,8));assert.equal(h.results().length,results);}finally{h.bridge.stop();}
});
test('disconnect aborts an in-flight request and only sends local revocation',async()=>{
 let release;const h=harness({approved:true});h.sourceGate(new Promise(resolve=>{release=resolve;}));try{await h.bridge.start();await until(()=>h.calls.some(call=>call.url==='/api/product-query'));await h.bridge.disconnect();release();await new Promise(resolve=>setTimeout(resolve,8));assert.equal(h.results().length,0);assert.equal(h.calls.filter(call=>call.url.endsWith('/disconnect')).length,1);assert.equal(h.states.at(-1).phase,'stopped');}finally{release?.();h.bridge.stop();}
});
test('withdrawing product-query approval aborts the fetch and discards the local job without a result',async()=>{
 let release;const h=harness({approved:true});h.sourceGate(new Promise(resolve=>{release=resolve;}));try{await h.bridge.start();await until(()=>h.calls.some(call=>call.url==='/api/product-query'));const request=h.calls.find(call=>call.url==='/api/product-query');h.permission(false);h.bridge.cancelProductQuery();assert.equal(request.signal.aborted,true);release();await until(()=>h.calls.some(call=>call.url.endsWith('/abort')));assert.equal(h.results().length,0);assert.ok(h.states.every(state=>!state.lastResult));const abort=h.calls.find(call=>call.url.endsWith('/abort'));assert.equal(abort.body.jobId,jobId);assert.deepEqual(abort.body.scope,owner);}finally{release?.();h.bridge.stop();}
});
test('wrong owner response is never returned as successful query result',async()=>{
 const h=harness({approved:true});h.handler(url=>url==='/api/product-query'?json({...other,sourceStored:false,draftCreated:false}):json({ok:true}));try{await h.bridge.start();await until(()=>h.results().length===1);assert.equal(h.results()[0].body.ok,false);}finally{h.bridge.stop();}
});
test('HTML redirects, oversized JSON and malformed successful query flags fail closed',async()=>{
 for(const response of [new Response('<html>login</html>',{headers:{'content-type':'text/html'}}),new Response('{}',{headers:{'content-type':'application/json','content-length':String(2*1024*1024+1)}}),json({...owner,sourceStored:true,draftCreated:true})]){
  const h=harness({approved:true});h.handler(url=>url==='/api/product-query'?response:json({ok:true}));try{await h.bridge.start();await until(()=>h.results().length===1);assert.equal(h.results()[0].body.ok,false);assert.equal(h.states.some(state=>state.lastResult),false);}finally{h.bridge.stop();}
 }
});
test('uncertain result acknowledgement is never replayed as another result',async()=>{
 const h=harness({approved:true});h.handler(url=>url.endsWith('/result')?new Response('not-json',{headers:{'content-type':'text/plain'}}):json({...owner,sourceStored:false,draftCreated:false}));try{await h.bridge.start();await until(()=>h.states.at(-1)?.phase==='stopped');assert.equal(h.results().length,1);}finally{h.bridge.stop();}
});
test('server provider failure code is preserved while arbitrary upstream message is not copied',async()=>{
 const h=harness({approved:true});h.handler(url=>url==='/api/product-query'?json({code:'SOURCE_CONFIGURATION_REQUIRED',error:'private signed token must not appear'},503):json({ok:true}));try{await h.bridge.start();await until(()=>h.results().length===1);assert.equal(h.results()[0].body.error.code,'SOURCE_CONFIGURATION_REQUIRED');assert.doesNotMatch(JSON.stringify(h.results()[0].body),/private signed/);}finally{h.bridge.stop();}
});
test('server observed scope change is terminal even if context has returned to the original owner',async()=>{
 const h=harness({approved:true});h.handler(()=>json({code:'QUERY_SCOPE_CHANGED',error:'changed'},409));try{await h.bridge.start();await until(()=>h.states.at(-1)?.phase==='stopped');assert.equal(h.results().length,0);}finally{h.bridge.stop();}
});
test('different returned offer or forged live-verification status is not forwarded as success',async()=>{
 for(const [command,payload,response] of [['product-query',{sourceUrl},{...owner,offerId:'700000000999',source:{sourceUrl:'https://detail.1688.com/offer/700000000999.html',offerId:'700000000999'},sourceStored:false,draftCreated:false}],['status',{}, {...owner,service:{...service,liveVerified:true}}]]){
  const h=harness({approved:true,jobCommand:command,payload});h.handler(url=>url==='/api/product-query'?json(response):json({ok:true}));try{await h.bridge.start();await until(()=>h.results().length===1);assert.equal(h.results()[0].body.ok,false);}finally{h.bridge.stop();}
 }
});
test('wire deadline must be future epoch milliseconds rather than an ISO string',async()=>{
 for(const jobDeadline of [new Date(Date.now()+60000).toISOString(),Date.now()-1]){const h=harness({approved:true,jobDeadline});try{await h.bridge.start();await until(()=>h.states.at(-1)?.phase==='stopped');assert.equal(h.results().length,0);assert.equal(h.calls.filter(call=>call.url==='/api/product-query').length,0);}finally{h.bridge.stop();}}
});
test('category and collection-job reads require response ownership proof even after original owner is restored',async()=>{
 for(const [command,payload] of [['category-profiles/list',{}],['collection-job/status',{jobId}]]){const h=harness({jobCommand:command,payload});h.handler(()=>json({...other,profiles:[{id:'other-company-private'}],job:{id:jobId}}));try{await h.bridge.start();await until(()=>h.results().length===1);assert.equal(h.results()[0].body.ok,false);assert.doesNotMatch(JSON.stringify(h.results()[0].body),/other-company-private/);}finally{h.bridge.stop();}}
});
