import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadBridge(timers={setTimeout,clearTimeout,setInterval,clearInterval}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/cli-bridge-client.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,URLSearchParams,Response,Request,Headers,TextDecoder,Uint8Array,AbortController,...timers,Date,fetch:()=>{throw Error('Unexpected real network');}});return exports;}
const exports=loadBridge();
const {parseCliLink,parseCliScope,createCliBridge}=exports;
const sessionId='00000000-0000-4000-8000-000000000789',jobId='00000000-0000-4000-8000-000000000790';
const owner={ownerId:'synthetic-owner-a',company:{code:'A01526306',name:'유앤채'}},other={ownerId:'synthetic-owner-b',company:{code:'A01464742',name:'와이홉'}};
const link={port:49831,token:'a'.repeat(64),sessionId};
const sourceUrl='https://detail.1688.com/offer/700000000789.html';
const json=(value,status=200)=>Response.json(value,{status});
const service={format:'yoofam-product-query-service-v1',provider:'public-page',configured:true,liveVerified:false,queryPath:'/api/product-query'};
async function until(predicate){for(let n=0;n<200;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,1));}throw Error('Timed out waiting for synthetic bridge');}
function harness({approved=false,jobCommand='product-query',payload={sourceUrl},jobScope=owner,jobDeadline,interval=60000,diagnosticObserver}={}){
 const calls=[],states=[],diagnostics=[],jobs=[{jobId,command:jobCommand,payload,scope:jobScope,createdAt:Date.now(),deadline:jobDeadline??Date.now()+60000}];let scope=owner,sourceGate,scopeReads=0,handler;
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
 const bridge=createCliBridge({link,scope:owner,queryApproved:()=>permission,fetcher,onState:state=>states.push(state),onDiagnostic:event=>{diagnostics.push(event);diagnosticObserver?.(event);},contextIntervalMs:interval});
 return{bridge,calls,states,diagnostics,scope(value){scope=value;},permission(value){permission=value;},sourceGate(value){sourceGate=value;},handler(value){handler=value;},get scopeReads(){return scopeReads;},results:()=>calls.filter(call=>call.url.endsWith('/result'))};
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
 const h=harness({approved:true});try{await h.bridge.start();await until(()=>h.results().length===1);const request=h.calls.find(call=>call.url==='/api/product-query');assert.deepEqual(request.body,{sourceUrl,expectedOwnerId:owner.ownerId,expectedCompany:owner.company});assert.equal(request.credentials,'same-origin');assert.equal(request.targetAddressSpace,undefined);assert.equal(request.redirect,'manual');assert.equal(h.results()[0].body.ok,true);assert.equal(h.results()[0].body.result.sourceStored,false);assert.ok(h.scopeReads>=5);for(const call of h.calls.filter(call=>call.url.startsWith('http:'))){assert.equal(call.credentials,'omit');assert.equal(call.targetAddressSpace,'loopback');assert.equal(call.headers.authorization,'Bearer '+link.token);}assert.ok(h.states.some(state=>state.lastResult?.optionCount===1));}finally{h.bridge.stop();}
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

function panelHarness({hash='',search='',readError,connectError,disconnectGate,startGate}={}){
 const slots=[],effects=[],listeners=new Map(),clients=[],infoLogs=[],otherLogs=[],location={hash,pathname:'/cli',search};let cursor=0,cleanup,tree;
 const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return[slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];},useEffect(setup){const index=cursor++;if(!(index in slots)){slots[index]=true;effects.push(setup);}}};
 const window={location,history:{replaceState(_state,_unused,url){assert.equal(url,'/cli'+search);location.hash='';}},addEventListener(type,callback){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(callback);},removeEventListener(type,callback){listeners.get(type)?.delete(callback);}};
 const bridgeModule={...exports,async readCliScope(_fetcher,_signal,diagnostic){diagnostic?.onDiagnostic?.({stage:'scope',target:'app',outcome:'start'});if(readError)throw readError;return owner;},createCliBridge(options){const client={options,stops:0,disconnections:0,async start(){options.onDiagnostic?.({stage:'pair',target:'localhost',outcome:'response',status:200});options.onState({phase:'connecting',message:'Synthetic connecting'});if(startGate)await startGate;if(connectError){options.onState({phase:'stopped',message:'로컬 CLI 연결을 확인하지 못했습니다. 실행 상태를 확인해주세요.'});throw connectError;}options.onState({phase:'connected',message:'Synthetic connected'});},stop(){client.stops++;},async disconnect(){client.disconnections++;client.stop();if(disconnectGate)await disconnectGate;},cancelProductQuery(){}};clients.push(client);return client;}};
 const output={};
 const jsx=(type,props)=>({type,props});
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/cli-connection-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports:output,window,queueMicrotask,Promise,Error,URLSearchParams,console:{info(...values){infoLogs.push(values);},log(...values){otherLogs.push(values);},warn(...values){otherLogs.push(values);},error(...values){otherLogs.push(values);}},require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='next/link')return()=>null;if(name==='@/app/components/cli-install-guide')return{CliInstallGuide:()=>null};if(name==='@/app/components/cli-browser-status')return{CliBrowserStatus:()=>null};if(name==='@/app/cli-bridge-client')return bridgeModule;throw Error('Unexpected panel dependency '+name);}});
 const render=()=>{cursor=0;tree=output.CliConnectionPanel({initialScope:owner,displayName:'Synthetic'});return tree;};
 function find(predicate,node=tree){if(!node||typeof node!=='object')return null;if(predicate(node))return node;const children=node.props?.children;for(const child of Array.isArray(children)?children:[children]){const match=find(predicate,child??null);if(match)return match;}return null;}
 const text=(node=tree)=>{if(node===undefined||node===null||typeof node==='boolean')return'';if(typeof node!=='object')return String(node);return(Array.isArray(node.props?.children)?node.props.children:[node.props?.children]).map(child=>text(child??null)).join(' ');};
 return{clients,location,render,text,find,infoLogs,otherLogs,mount(strict=false){render();cleanup=effects[0]();if(strict){cleanup();cleanup=effects[0]();}},unmount(){cleanup?.();},navigate(next){location.hash=next;for(const listener of listeners.get('hashchange')??[])listener();},button:()=>find(node=>node.type==='button'&&node.props.className==='btn primary'),listeners};
}
const syntheticHash=(digit='a',session=sessionId)=>'#port=49831&token='+digit.repeat(64)+'&session='+session;
const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};
test('existing /cli document accepts hash-only connection navigation and immediately removes the token',async()=>{
 const h=panelHarness();try{h.mount();await flush();h.render();assert.equal(h.button().props.disabled,true);h.navigate(syntheticHash());assert.equal(h.location.hash,'');await flush();h.render();assert.equal(h.button().props.disabled,false);assert.match(h.text(),/127\.0\.0\.1:49831/);assert.equal(h.clients.length,0,'a fragment must not automatically pair');}finally{h.unmount();}
});
test('React StrictMode cleanup and effect replay retain an initial one-time link after hash removal',async()=>{
 const h=panelHarness({hash:syntheticHash()});try{h.mount(true);assert.equal(h.location.hash,'');await flush();h.render();assert.equal(h.button().props.disabled,false);assert.equal(h.listeners.get('hashchange').size,1);assert.equal(h.clients.length,0);}finally{h.unmount();assert.equal(h.listeners.get('hashchange').size,0);}
});
test('new hash revokes the connected session, rejects its late state, resets permission, and awaits a fresh explicit connect',async()=>{
 let release;const h=panelHarness({hash:syntheticHash(),disconnectGate:new Promise(resolve=>{release=resolve;})});try{
  h.mount();await flush();h.render();h.find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:true}});h.render();h.button().props.onClick();await flush();h.render();assert.equal(h.clients.length,1);assert.equal(h.clients[0].options.queryApproved(),true);
  h.navigate(syntheticHash('b','00000000-0000-4000-8000-000000000791'));assert.equal(h.location.hash,'');await flush();h.render();assert.equal(h.clients[0].disconnections,1);assert.equal(h.clients[0].options.queryApproved(),false);assert.equal(h.button().props.disabled,true);
  h.clients[0].options.onState({phase:'connected',message:'stale secret result must not appear'});h.render();assert.doesNotMatch(h.text(),/stale secret/);
  release();await flush();h.render();assert.equal(h.button().props.disabled,false);assert.equal(h.clients.length,1);assert.equal(h.find(node=>node.type==='input'&&node.props.type==='checkbox').props.checked,false);
  h.button().props.onClick();await flush();assert.equal(h.clients.length,2);
 }finally{release?.();h.unmount();}
});
test('malformed replacement fragment also revokes an active session and leaves no usable old link',async()=>{
 const h=panelHarness({hash:syntheticHash()});try{h.mount();await flush();h.render();h.button().props.onClick();await flush();h.navigate('#token=invalid');assert.equal(h.location.hash,'');await flush();h.render();assert.equal(h.clients[0].disconnections,1);assert.equal(h.button().props.disabled,true);assert.match(h.text(),/새 연결 주소/);}finally{h.unmount();}
});
test('panel keeps the friendly bridge stopped notice instead of raw AbortError text',async()=>{
 const h=panelHarness({hash:syntheticHash(),connectError:new DOMException('signal is aborted without reason','AbortError')});try{h.mount();await flush();h.render();h.button().props.onClick();await flush();h.render();assert.match(h.text(),/실행 상태를 확인/);assert.doesNotMatch(h.text(),/signal is aborted/);}finally{h.unmount();}
});
test('panel maps raw scope-check network failures to a fixed user message',async()=>{
 const h=panelHarness({hash:syntheticHash(),readError:new TypeError('fetch failed private transport detail')});try{h.mount();await flush();h.render();h.button().props.onClick();await flush();h.render();assert.match(h.text(),/로컬 네트워크 권한/);assert.doesNotMatch(h.text(),/private transport/);assert.equal(h.clients.length,0);}finally{h.unmount();}
});
test('replacement link while connecting invalidates a late successful pair notice',async()=>{
 let release;const h=panelHarness({hash:syntheticHash(),startGate:new Promise(resolve=>{release=resolve;})});try{h.mount();await flush();h.render();h.button().props.onClick();await flush();assert.equal(h.clients.length,1);h.navigate(syntheticHash('c','00000000-0000-4000-8000-000000000792'));await flush();h.render();assert.equal(h.clients[0].disconnections,1);assert.equal(h.button().props.disabled,false);release();await flush();h.render();assert.doesNotMatch(h.text(),/Synthetic connected/);assert.equal(h.button().props.disabled,false);assert.equal(h.clients.length,1);}finally{release?.();h.unmount();}
});
test('rapid replacement links all wait for the original revocation and accept only the newest session',async()=>{
 let release;const h=panelHarness({hash:syntheticHash(),disconnectGate:new Promise(resolve=>{release=resolve;})});try{h.mount();await flush();h.render();h.button().props.onClick();await flush();h.navigate(syntheticHash('b','00000000-0000-4000-8000-000000000791'));h.navigate(syntheticHash('c','00000000-0000-4000-8000-000000000792'));await flush();h.render();assert.equal(h.button().props.disabled,true);assert.equal(h.clients[0].disconnections,1);release();await flush();h.render();assert.equal(h.button().props.disabled,false);h.button().props.onClick();await flush();assert.equal(h.clients.length,2);assert.equal(h.clients[1].options.link.sessionId,'00000000-0000-4000-8000-000000000792');}finally{release?.();h.unmount();}
});

function virtualTimers(){let next=0;const timers=new Map();return{setTimeout(callback,ms){const id=++next;timers.set(id,{callback,ms});return id;},clearTimeout(id){timers.delete(id);},setInterval(callback,ms){const id=++next;timers.set(id,{callback,ms,interval:true});return id;},clearInterval(id){timers.delete(id);},fire(ms){for(const[id,value]of [...timers])if(!value.interval&&value.ms===ms){timers.delete(id);value.callback();}},get pending(){return timers.size;}};}
test('scope diagnostics identify the app request and force its deadline even if fetch ignores AbortSignal',async()=>{
 const timers=virtualTimers(),api=loadBridge(timers),events=[];let signal;
 const request=api.readCliScope(async(_url,init)=>{signal=init.signal;return new Promise(()=>{});},undefined,{onDiagnostic:event=>events.push(event)});await flush();timers.fire(10000);
 await assert.rejects(request,error=>error.code==='APP_SCOPE_TIMEOUT'&&!/로컬|권한/.test(error.message));assert.equal(signal.aborted,true);assert.deepEqual(events.map(event=>JSON.parse(JSON.stringify(event))),[{stage:'scope',target:'app',outcome:'start'},{stage:'scope',target:'app',outcome:'timeout'}]);assert.equal(timers.pending,0);
});
test('scope deadline also bounds a response body that never completes',async()=>{
 const timers=virtualTimers(),api=loadBridge(timers),events=[];
 const request=api.readCliScope(async()=>new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}}),undefined,{stage:'verify',onDiagnostic:event=>events.push(event)});await flush();timers.fire(10000);await assert.rejects(request,error=>error.code==='APP_SCOPE_TIMEOUT');assert.ok(events.some(event=>event.stage==='verify'&&event.target==='app'&&event.outcome==='response'&&event.status===200));assert.ok(events.some(event=>event.outcome==='timeout'));assert.equal(timers.pending,0);
});
test('an app scope network rejection uses a fixed safe app error rather than a local permission explanation',async()=>{
 const api=loadBridge();await assert.rejects(api.readCliScope(async()=>{throw new TypeError('synthetic-private-raw-transport-detail');}),error=>error.code==='APP_SCOPE_NETWORK'&&!/synthetic-private|로컬|권한/.test(error.message));
});
test('initial scope timeout never reaches pair and reports its app stage',async()=>{
 const timers=virtualTimers(),api=loadBridge(timers),events=[],calls=[],states=[];
 const bridge=api.createCliBridge({link,scope:owner,queryApproved:()=>false,onDiagnostic:event=>events.push(event),onState:state=>states.push(state),fetcher:async(url)=>{calls.push(url);return new Promise(()=>{});}});
 const started=bridge.start();await flush();timers.fire(10000);await assert.rejects(started,error=>error.code==='APP_SCOPE_TIMEOUT');assert.equal(calls.length,1);assert.equal(calls[0],'/api/supplier-hub/catalog-context');assert.equal(events.some(event=>event.target==='localhost'),false);assert.equal(states.at(-1).phase,'stopped');assert.doesNotMatch(states.at(-1).message,/로컬|권한/);assert.equal(timers.pending,0);
});
test('pair timeout is distinct from app scope timeout and a late pair cannot resume polling',async()=>{
 const timers=virtualTimers(),api=loadBridge(timers),events=[],calls=[],states=[];let release,signal;
 const bridge=api.createCliBridge({link,scope:owner,queryApproved:()=>false,onDiagnostic:event=>events.push(event),onState:state=>states.push(state),fetcher:async(url,init)=>{calls.push(url);if(url==='/api/supplier-hub/catalog-context')return json(owner);signal=init.signal;return new Promise(resolve=>{release=resolve;});}});
 const started=bridge.start();await until(()=>calls.length===2);timers.fire(30000);await assert.rejects(started,error=>error.code==='LOCAL_CLI_TIMEOUT');assert.equal(signal.aborted,true);assert.ok(events.some(event=>event.stage==='pair'&&event.target==='localhost'&&event.outcome==='timeout'));assert.match(states.at(-1).message,/내 컴퓨터 CLI/);
 release(json({ok:true,protocolVersion:'1.0',sessionId,scope:owner,expiresAt:Date.now()+14*60000}));await flush();assert.equal(calls.length,2);assert.equal(states.some(state=>state.phase==='connected'),false);assert.equal(timers.pending,0);
});
test('diagnostic payloads contain only safe phase, target, outcome and response status fields',async()=>{
 const h=harness({approved:true});try{await h.bridge.start();await until(()=>h.results().length===1);assert.ok(h.diagnostics.some(event=>event.stage==='pair'&&event.target==='localhost'&&event.status===200));assert.ok(h.diagnostics.some(event=>event.stage==='verify'&&event.target==='app'));assert.ok(h.diagnostics.some(event=>event.stage==='command'&&event.target==='app'));assert.ok(h.diagnostics.some(event=>event.stage==='result'&&event.target==='localhost'));for(const event of h.diagnostics)assert.ok(Object.keys(event).every(key=>['stage','target','outcome','status'].includes(key)));const serialized=JSON.stringify(h.diagnostics);for(const value of [link.token,sessionId,owner.ownerId,owner.company.code,owner.company.name,sourceUrl,'Bearer','Synthetic only'])assert.equal(serialized.includes(value),false);}finally{h.bridge.stop();}
});
test('diagnostic observer failures cannot stop an otherwise valid transport',async()=>{
 const h=harness({jobCommand:'status',payload:{},diagnosticObserver(){throw Error('observer failed');}});try{await h.bridge.start();await until(()=>h.results().length===1);assert.equal(h.results()[0].body.ok,true);}finally{h.bridge.stop();}
});
test('normal CLI panel connection never writes diagnostics to the console',async()=>{
 const h=panelHarness({hash:syntheticHash()});try{h.mount();await flush();h.render();h.button().props.onClick();await flush();assert.equal(h.clients.length,1);assert.equal(h.infoLogs.length,0);assert.equal(h.otherLogs.length,0);}finally{h.unmount();}
});
test('explicit diagnostics=1 logs only safe transport events and preserves the query while scrubbing the token',async()=>{
 const h=panelHarness({hash:syntheticHash(),search:'?diagnostics=1'});try{h.mount();assert.equal(h.location.hash,'');assert.equal(h.location.search,'?diagnostics=1');await flush();h.render();h.button().props.onClick();await flush();assert.equal(h.infoLogs.length,2);assert.equal(h.otherLogs.length,0);for(const [prefix,serialized]of h.infoLogs){assert.equal(prefix,'[YOOFAM CLI]');const event=JSON.parse(serialized);assert.ok(Object.keys(event).every(key=>['stage','target','outcome','status'].includes(key)));}const logs=JSON.stringify(h.infoLogs);for(const secret of [link.token,sessionId,owner.ownerId,owner.company.name,owner.company.code,'Bearer'])assert.equal(logs.includes(secret),false);}finally{h.unmount();}
});

test('localhost compatibility is an exact opt-in alias and never an arbitrary host or silent retry',async()=>{
 const hash='#port=49831&token='+link.token+'&session='+sessionId;
 assert.equal(parseCliLink(hash+'&host=localhost').host,'localhost');
 assert.equal(parseCliLink(hash+'&host=127.0.0.1').host,'127.0.0.1');
 for(const value of ['localhost.evil.test','localhost:49831','localhost.','LOCALHOST','127.0.0.2','[::1]','','localhost&host=localhost'])assert.throws(()=>parseCliLink(hash+'&host='+value));
 const calls=[];
 const bridge=createCliBridge({link:{...link,host:'localhost'},scope:owner,queryApproved:()=>false,fetcher:async(url,init)=>{
  calls.push(url);
  if(url==='/api/supplier-hub/catalog-context')return json(owner);
  assert.ok(url.startsWith('http://localhost:49831/'));assert.equal(init.targetAddressSpace,'loopback');assert.equal(init.credentials,'omit');assert.equal(init.headers.authorization,'Bearer '+link.token);
  if(url.endsWith('/pair'))return json({ok:true,protocolVersion:'1.0',sessionId,scope:owner,expiresAt:Date.now()+14*60000});
  return new Promise((resolve,reject)=>{if(init.signal.aborted)reject(Error('cancelled'));else init.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});});
 }});
 try{await bridge.start();assert.ok(calls.includes('http://localhost:49831/pair'));assert.equal(calls.some(value=>value.startsWith('http://127.')),false);}finally{bridge.stop();}
 for(const host of ['evil.test','localhost.evil.test','127.0.0.2'])assert.throws(()=>createCliBridge({link:{...link,host},scope:owner,queryApproved:()=>false,fetcher:()=>assert.fail('no network')}));
});

test('CLI host choice is explicit before pairing and cannot change a connected session',async()=>{
 const h=panelHarness({hash:syntheticHash()});try{
  h.mount();await flush();h.render();
  const local=h.find(node=>node.type==='button'&&h.text(node)==='localhost 주소 사용');assert.ok(local);assert.equal(local.props.disabled,false);local.props.onClick();h.render();
  assert.match(h.text(),/localhost:49831/);assert.equal(h.clients.length,0);h.button().props.onClick();await flush();h.render();
  assert.equal(h.clients.length,1);assert.equal(h.clients[0].options.link.host,'localhost');assert.equal(h.clients[0].options.link.token,link.token);assert.deepEqual(h.clients[0].options.scope,owner);assert.equal(h.clients[0].options.queryApproved(),false);
  const other=h.find(node=>node.type==='button'&&h.text(node)==='127.0.0.1 주소 사용');assert.equal(other.props.disabled,true);
 }finally{h.unmount();}
});

test('an explicit browser denial blocks pairing while an unknown permission state never masquerades as denial',async()=>{
 const h=panelHarness({hash:syntheticHash()});try{
  h.mount();await flush();h.render();
  const update=value=>{h.find(node=>node.type?.name==='CliBrowserStatus').props.onChange({secureContext:true,visibility:'visible',loopbackPermission:value});h.render();};
  update('denied');assert.equal(h.button().props.disabled,true);h.button().props.onClick();await flush();assert.equal(h.clients.length,0);
  for(const state of ['prompt','unsupported','unavailable','timeout','granted']){update(state);assert.equal(h.button().props.disabled,false);}
  h.find(node=>node.type?.name==='CliBrowserStatus').props.onChange({secureContext:false,visibility:'visible',loopbackPermission:'unavailable'});h.render();assert.equal(h.button().props.disabled,true);h.button().props.onClick();await flush();assert.equal(h.clients.length,0);
 }finally{h.unmount();}
});

test('an effective document policy denial prevents pairing even if permission was granted',async()=>{
 const h=panelHarness({hash:syntheticHash()});try{
  h.mount();await flush();h.render();
  const status=h.find(node=>node.type?.name==='CliBrowserStatus');
  status.props.onChange({secureContext:true,visibility:'visible',loopbackPermission:'granted',loopbackPolicy:'blocked',documentContext:'embedded'});h.render();
  assert.equal(h.button().props.disabled,true);h.button().props.onClick();await flush();assert.equal(h.clients.length,0);
  status.props.onChange({secureContext:true,visibility:'visible',loopbackPermission:'granted',loopbackPolicy:'allowed',documentContext:'top-level'});h.render();
  assert.equal(h.button().props.disabled,false);assert.equal(h.clients.length,0);
 }finally{h.unmount();}
});
