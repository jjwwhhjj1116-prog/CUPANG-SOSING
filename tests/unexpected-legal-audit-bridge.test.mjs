import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {readAppLegalAuditSchema,normalizeSourceReadFailure} from '../extensions/supplier-hub/product-document-source.mjs';
import {unexpectedLegalAuditSchemaPage} from '../extensions/supplier-hub/unexpected-legal-audit.mjs';

const copy=value=>structuredClone(value),origin='https://sourceflow.jjwwhhjj1116.workers.dev';
function fixture({replacement=false}={}){
 const identity={origin,appTabId:7,windowId:2,ownerId:'owner',productId:'product',source:{contentRevision:1},company:{code:'A01526306',name:'유앤채'},requestedProfileId:null,categoryId:'68183',schemaSha256:'a'.repeat(64)};
 const body={jsonDocument:Array.from({length:3},()=>({legalPage:{certificates:[]}}))},target=replacement?8:7;
 const tabs=new Map([[target,{id:target,windowId:2,url:origin+'/',status:'complete'}]]),gets=[],messages=[],http=[],scripts=[];let listener;
 const app=vm.createContext({location:new URL(origin),AbortController,TextEncoder,URL,setTimeout,clearTimeout,
  fetch:async(url,init)=>{http.push({url,init});assert.equal(init.method,'GET');assert.equal(Object.hasOwn(init,'body'),false);
   const value=url.endsWith('/catalog-context')?{ownerId:identity.ownerId,company:copy(identity.company)}:{revision:1,documents:{applicability:'not-applicable',files:[]},native:{schemaSha256:identity.schemaSha256,categoryId:identity.categoryId,company:copy(identity.company),targets:[],issues:[],files:[]}};
   const response=Response.json(value);Object.defineProperty(response,'url',{value:url});return response;
  }});
 const content={exports:{},chrome:{runtime:{id:'own-extension',onMessage:{addListener:value=>listener=value}}},require:name=>{
  if(name==='./native-product-assets.mjs')return{nativeProductDocumentAppSourcePage:()=>assert.fail('Schema message must not run image-byte/native source APIs')};
  if(name==='./single-document-adapter.mjs')return{singleDocumentAppSourcePage:()=>assert.fail('Schema message must not invoke legacy source logic')};
  if(name==='./product-document-source.mjs')return{normalizeSourceReadFailure};
  assert.equal(name,'./unexpected-legal-audit.mjs');return{unexpectedLegalAuditSchemaPage:input=>{app.input=copy(input);return vm.runInContext('('+unexpectedLegalAuditSchemaPage.toString()+')(input)',app);}};
 }};
 const source=fs.readFileSync(new URL('../extensions/supplier-hub/native-source-content-entry.mjs',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,content);
 let afterMessage;
 const api={tabs:{get:async id=>{gets.push(id);if(!tabs.has(id))throw Error('No such tab');return copy(tabs.get(id));},query:async()=>[...tabs.values()].map(copy),sendMessage:async(id,message,options)=>{
  assert.equal(id,target);assert.deepEqual(options,{frameId:0});messages.push(copy(message));
  const result=await new Promise(resolve=>listener(copy(message),{id:'own-extension'},resolve));afterMessage?.();return copy(result);
 }},scripting:{executeScript:async request=>{scripts.push(request);throw Error('Cannot access app origin: missing scripting host permission');}}};
 return{identity,body,target,tabs,gets,messages,http,scripts,listener,api,afterMessage:value=>afterMessage=value,run:()=>readAppLegalAuditSchema(api,identity,body,replacement?8:undefined)};
}

for(const replacement of [false,true])test('manifest content bridge reads the same app schema with scripting host access denied '+(replacement?'after exact closed-tab rebinding':'in the original app tab'),async()=>{
 const f=fixture({replacement}),manifest=JSON.parse(fs.readFileSync(new URL('../extensions/supplier-hub/manifest.json',import.meta.url),'utf8'));
 assert.equal(manifest.host_permissions.some(pattern=>pattern.startsWith(origin+'/')),false);assert.ok(manifest.content_scripts.some(row=>row.matches.includes(origin+'/*')&&row.js.includes('native-source-content.js')));
 assert.deepEqual(copy(await f.run()),{complete:true,bindings:[]});assert.deepEqual(f.gets,[f.target,f.target]);assert.deepEqual(f.scripts,[]);
 assert.equal(f.messages.length,1);assert.equal(f.messages[0].type,'YOOFAM_READ_UNEXPECTED_LEGAL_AUDIT_SCHEMA');assert.deepEqual(f.messages[0].expected,{identity:f.identity,expectedBody:f.body});
 assert.deepEqual(f.http.map(call=>new URL(call.url).pathname),['/api/supplier-hub/catalog-context','/api/products/product/legal-documents','/api/supplier-hub/catalog-context']);
 assert.ok(f.http.every(call=>call.init.credentials==='same-origin'&&call.init.cache==='no-store'&&call.init.redirect==='error'));
});

test('schema content dispatch accepts only this extension and its exact read message envelope',async()=>{
 const f=fixture();let replies=0;const message={type:'YOOFAM_READ_UNEXPECTED_LEGAL_AUDIT_SCHEMA',expected:{identity:f.identity,expectedBody:f.body}};
 for(const sender of [{id:'another-extension'},{},null])assert.equal(f.listener(copy(message),sender,()=>replies++),undefined);
 assert.equal(f.listener({...message,type:'YOOFAM_WRITE_LEGAL'}, {id:'own-extension'},()=>replies++),undefined);
 assert.equal(replies,0);assert.equal(f.http.length,0);
 for(const malformed of [{...message,permission:'expand'},{...message,expected:{...message.expected,path:'/private-api'}},{...message,expected:[]}]){
  let result;assert.equal(f.listener(copy(malformed),{id:'own-extension'},value=>result=value),undefined);assert.deepEqual(copy(result),{ok:false,sourceFailure:{code:'SOURCE_CHANGED'}});
 }
 assert.equal(f.http.length,0);
});

test('the legal bridge does not accept an open old source tab, another window/origin or a post-read target change',async()=>{
 const openOld=fixture({replacement:true});openOld.tabs.set(7,{id:7,windowId:2,url:origin+'/'});await assert.rejects(openOld.run(),error=>error.code==='SOURCE_CHANGED');assert.equal(openOld.messages.length,0);
 for(const patch of [{windowId:3},{url:'https://other.invalid/'},{pendingUrl:origin+'/login'}]){
  const f=fixture();Object.assign(f.tabs.get(7),patch);await assert.rejects(f.run(),error=>error.code==='SOURCE_CHANGED');assert.equal(f.messages.length,0);
 }
 const changed=fixture();changed.afterMessage(()=>{changed.tabs.get(7).url='https://other.invalid/';});await assert.rejects(changed.run(),error=>error.code==='SOURCE_CHANGED');assert.equal(changed.messages.length,1);assert.equal(changed.scripts.length,0);
});

test('missing content connection and malformed replies remain failures without another GET or fallback injection',async()=>{
 for(const response of [null,{ok:true},{ok:true,result:null},{ok:true,result:[],extra:'PRIVATE'},{ok:false,sourceFailure:{code:'SOURCE_CHANGED'}}]){
  const f=fixture();f.api.tabs.sendMessage=async()=>response;await assert.rejects(f.run(),error=>error.code===(response?.ok===false?'SOURCE_CHANGED':'SOURCE_READ_RESPONSE')&&!error.message.includes('PRIVATE'));assert.equal(f.http.length,0);assert.equal(f.scripts.length,0);
 }
 const disconnected=fixture();disconnected.api.tabs.sendMessage=async()=>{throw Error('PRIVATE_BROWSER_ERROR');};await assert.rejects(disconnected.run(),error=>error.code==='SOURCE_BRIDGE_UNAVAILABLE'&&!error.message.includes('PRIVATE'));assert.equal(disconnected.http.length,0);assert.equal(disconnected.scripts.length,0);
});
