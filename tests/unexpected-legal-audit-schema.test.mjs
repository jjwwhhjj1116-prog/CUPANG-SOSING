import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {unexpectedLegalAuditSchemaPage} from '../extensions/supplier-hub/unexpected-legal-audit.mjs';

const copy=value=>structuredClone(value),flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
 const identity={origin:'https://sourceflow.jjwwhhjj1116.workers.dev',ownerId:'owner',productId:'product',requestedProfileId:null,categoryId:'68183',schemaSha256:'a'.repeat(64),company:{code:'A01526306',name:'유앤채'},source:{contentRevision:3}};
 const bindings=[0,1].map(schemaIndex=>({schemaIndex,nameKey:'certificateType',valueKey:'certificateNumber',name:'인증 '+schemaIndex,value:'해당사항없음'}));
 const expectedBody={jsonDocument:Array.from({length:3},()=>({legalPage:{certificates:bindings.map(row=>({[row.nameKey]:row.name,[row.valueKey]:row.value}))}}))};
 const catalog={ownerId:identity.ownerId,company:identity.company},view={revision:3,documents:{applicability:'not-applicable',files:[]},native:{schemaSha256:identity.schemaSha256,categoryId:identity.categoryId,company:identity.company,issues:[],files:[],targets:bindings.map(row=>({binding:{format:'supplier-hub-native-legal-binding-v1',schemaSha256:identity.schemaSha256,categoryId:identity.categoryId,nativeType:'certificate',certificate:{...row,path:['legalPage','certificates']}}}))}};
 let time=0,next=0;const timers=new Map(),calls=[];
 const setTimer=(fn,ms)=>{const id=++next;timers.set(id,{at:time+ms,fn,ms});return id;},clearTimer=id=>timers.delete(id);
 const response=(url,value,init={})=>{const reply=new Response(typeof value==='string'?value:JSON.stringify(value),{status:init.status??200,headers:{'content-type':init.type??'application/json',...init.headers}});Object.defineProperty(reply,'url',{value:init.url??url});if(init.redirected)Object.defineProperty(reply,'redirected',{value:true});return reply;};
 const context=vm.createContext({location:new URL(identity.origin),AbortController,TextEncoder,URL,setTimeout:setTimer,clearTimeout:clearTimer,
  fetch:async(url,init)=>{
   calls.push({url,init});assert.equal(init.method,'GET');assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(Object.hasOwn(init,'body'),false);
   const index=calls.length-1;if(options.fetch)return options.fetch({url,init,index,catalog:copy(catalog),view:copy(view),response,setTimer});
   if(options.delay)await new Promise(resolve=>setTimer(resolve,options.delay));
   return response(url,index===1?view:catalog);
  }});
 context.input={identity:copy(identity),expectedBody:copy(expectedBody)};
 if(options.input)options.input(context.input);
 return{input:context.input,context,calls,timers,bindings,run:()=>vm.runInContext('('+unexpectedLegalAuditSchemaPage.toString()+')(input)',context),async advance(ms){const end=time+ms;for(;;){const due=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!due)break;time=due[1].at;timers.delete(due[0]);due[1].fn();await flush();}time=end;await flush();}};
}

test('three slow independent schema GETs receive separate complete 30 second budgets',async()=>{
 const f=fixture({delay:11000}),pending=f.run();await flush();assert.equal(f.calls.length,1);
 await f.advance(11000);assert.equal(f.calls.length,2);
 await f.advance(11000);assert.equal(f.calls.length,3);
 await f.advance(11000);const result=copy(await pending);
 assert.deepEqual(result,{complete:true,bindings:f.bindings});assert.equal(f.timers.size,0);
 assert.equal(new Set(f.calls.map(call=>call.init.signal)).size,3);assert.ok(f.calls.every(call=>call.init.signal.aborted));
 assert.deepEqual(f.calls.map(call=>new URL(call.url).pathname),['/api/supplier-hub/catalog-context','/api/products/product/legal-documents','/api/supplier-hub/catalog-context']);
});

test('schema GET timeout bounds a fetch ignoring abort and does not begin later reads',async()=>{
 let resolveFetch;const f=fixture({fetch:({url,response})=>new Promise(resolve=>{resolveFetch=()=>resolve(response(url,{ownerId:'owner',company:{code:'A01526306',name:'유앤채'}}));})}),pending=f.run();await flush();
 await f.advance(30000);assert.deepEqual(copy(await pending),{schemaReadFailure:{format:'yoofam-unexpected-legal-schema-read-failure-v1',phase:'catalog-before',code:'http-timeout'}});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.signal.aborted,true);assert.equal(f.timers.size,0);
 resolveFetch();await flush();assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);
});

test('legal response body timeout owns a fresh budget even when text ignores abort',async()=>{
 let resolveBody;const f=fixture({fetch:async({url,index,catalog,view,response})=>{if(index===1)return{ok:true,status:200,url,headers:new Headers({'content-type':'application/json'}),text:()=>new Promise(resolve=>{resolveBody=()=>resolve(JSON.stringify(view));})};return response(url,catalog);}}),pending=f.run();await flush();assert.equal(f.calls.length,2);
 await f.advance(30000);assert.deepEqual(copy(await pending),{schemaReadFailure:{format:'yoofam-unexpected-legal-schema-read-failure-v1',phase:'legal-documents',code:'http-timeout'}});assert.equal(f.calls.length,2);assert.equal(f.timers.size,0);
 resolveBody();await flush();assert.equal(f.calls.length,2);assert.equal(f.timers.size,0);
});

for(const scenario of ['http-401','http-500','http-status','http-network','http-json','http-type','http-size','http-redirect','http-response'])test('schema failure '+scenario+' is bounded to its exact legal GET phase',async()=>{
 const privateValue='PRIVATE_PASSWORD_TOKEN_BODY';
 const f=fixture({fetch:async({url,index,catalog,response})=>{
  if(index!==1)return response(url,catalog);
  if(scenario==='http-network')throw Error(privateValue);
  if(scenario==='http-json')return response(url,'{"'+privateValue+'":');
  if(scenario==='http-type')return response(url,privateValue,{type:'text/html'});
  if(scenario==='http-size')return response(url,privateValue,{headers:{'content-length':String(6*1024*1024+1)}});
  if(scenario==='http-redirect')return response(url,privateValue,{redirected:true});
  if(scenario==='http-response')return response(url,privateValue,{url:'https://private.invalid/'+privateValue});
  return response(url,privateValue,{status:scenario==='http-status'?418:Number(scenario.slice(5))});
 }});
 const result=copy(await f.run());assert.deepEqual(result,{schemaReadFailure:{format:'yoofam-unexpected-legal-schema-read-failure-v1',phase:'legal-documents',code:scenario}});
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|password|token|invalid/i);assert.equal(f.calls.length,2);assert.equal(f.timers.size,0);
});

test('closing account fence and original revision remain mandatory after all separate reads',async()=>{
 for(const mode of ['company','revision']){
  const f=fixture({fetch:async({url,index,catalog,view,response})=>{if(mode==='company'&&index===2)catalog.company={code:'A01464742',name:'와이홉'};if(mode==='revision')view.revision++;return response(url,index===1?view:catalog);}});
  assert.deepEqual(copy(await f.run()),{schemaReadFailure:{format:'yoofam-unexpected-legal-schema-read-failure-v1',phase:'catalog-after',code:'source-changed'}});assert.equal(f.calls.length,3);assert.equal(f.timers.size,0);
 }
});

test('missing original schema coverage stays incomplete and malformed input does not start a GET',async()=>{
 const incomplete=fixture({input:value=>{value.expectedBody.jsonDocument[2].legalPage.certificates[1].certificateNumber='';}});
 assert.deepEqual(copy(await incomplete.run()),{complete:false,bindings:[]});assert.equal(incomplete.calls.length,3);
 const malformed=fixture({input:value=>{delete value.identity.source;}});
 assert.deepEqual(copy(await malformed.run()),{schemaReadFailure:{format:'yoofam-unexpected-legal-schema-read-failure-v1',phase:'input',code:'input'}});assert.equal(malformed.calls.length,0);
});
