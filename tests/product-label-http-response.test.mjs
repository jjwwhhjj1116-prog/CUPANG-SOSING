import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const parser=providedOptionModule('app/product-label-read-response.ts').productLabelResponseJson;
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
const html=()=>new Response('<!DOCTYPE html>private_token_body',{status:503,headers:{'content-type':'text/html; charset=utf-8'}});

test('label response diagnostics identify only method, route template, status and format before parsing',async()=>{
 for(const [url,method,route] of [['/api/files?labelUploadId=private_hash','POST','/api/files'],['/api/products/private-product/product-labels?profileId=private_profile','GET','/api/products/:id/product-labels'],['/api/products/p/quotation-fields','PUT','/api/products/:id/quotation-fields'],['/api/products/p/attachments','POST','/api/products/:id/attachments']]){
  const response=html();response.json=()=>assert.fail('HTML must not be parsed');
  await assert.rejects(parser(response,url,method),error=>{assert.ok(error.message.includes(`${method} ${route}`));assert.match(error.message,/HTTP 503 · HTML 응답/);assert.doesNotMatch(error.message,/private_|DOCTYPE|Unexpected|</);return true;});
 }
 const malformed=new Response('<!DOCTYPE html>private_secret',{headers:{'content-type':'application/json'}});
 await assert.rejects(parser(malformed,'/api/files'),error=>{assert.match(error.message,/JSON 응답.*HTTP 200|HTTP 200.*JSON 응답/);assert.doesNotMatch(error.message,/private_|DOCTYPE|Unexpected|</);return true;});
 assert.deepEqual(await parser(Response.json({key:null}),'/api/files'),{key:null});
});

test('file route authentication exceptions are contained in JSON for both GET and POST before any storage access',async()=>{
 const exports={};let ownerReads=0;
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/api/files/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,Error,process:{env:{NODE_ENV:'production'}},require(name){
   if(name==='next/server')return{NextResponse:Response};
   if(name==='cloudflare:workers')return{env:{FILES:new Proxy({},{get(){assert.fail('No storage access');}})}};
   if(name==='@/app/chatgpt-auth')return{getChatGPTUser:async()=>{throw Error('private_session_failure');},getWorkspaceOwnerId:async()=>{ownerReads++;return'owner';}};
   if(name==='@/app/request-body')return{RequestBodyError:class extends Error{}};
   return{};
  }});
 for(const method of ['GET','POST']){
  const response=await exports[method](new Request('https://app.test/api/files?labelUploadId='+'a'.repeat(64),{method}));
  assert.equal(response.status,503);assert.match(response.headers.get('content-type'),/application\/json/);
  assert.doesNotMatch(JSON.stringify(await response.json()),/private_session_failure/);
 }
 assert.equal(ownerReads,0);
});

async function fixture(intercept){
 const h=mobileIntakeHarness();await h.intake();
 const get=h.bindings.FILES.get;h.bindings.FILES.get=async(key,options)=>{const object=await get(key),bytes=h.objects.get(key);if(!object||!bytes)return object;const offset=options?.range?.offset??0,end=options?.range?.length===undefined?bytes.length:offset+options.range.length;return{...object,body:new Response(bytes.slice(offset,end)).body};};
 const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,endpoint=base+'/product-labels',quotationEndpoint=base+'/quotation-fields';
 const view=await(await h.route(endpoint)).json(),optionId=view.rows.find(row=>row.optionId&&row.included).optionId,calls=[];
 const request=async(url,init={})=>{
  calls.push({url,method:init.method??'GET'});
  const send=()=>url==='/api/files'?h.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:init.body})):h.route(url,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});
  return intercept?intercept(url,init,send):send();
 };
 const input={productId:product.id,endpoint,quotationEndpoint,optionId,view,cache:new Map(),assertCurrent(){},render:async()=>({blob:new Blob([png],{type:'image/png'}),width:1,height:1})};
 return{h,calls,input,run:()=>h.load('app/product-label-save.ts').completeProductLabelSave(input,request),
  result:()=>h.load('app/product-label-result.ts').readCurrentProductLabelResult(input,request),close:()=>h.close()};
}

test('each real PNG save stage reports safe endpoint diagnostics and stops instead of parsing HTML',async()=>{
 for(const phase of ['label','lookup','upload','pool','reference']){
  const f=await fixture((url,init,send)=>{
   const fail=phase==='label'?url.endsWith('/product-labels'):phase==='lookup'?url.startsWith('/api/files?'):phase==='upload'?url==='/api/files':phase==='pool'?url.endsWith('/attachments'):url.endsWith('/quotation-fields')&&init.method==='PUT';
   return fail?html():send();
  });
  try{
   await assert.rejects(f.run(),error=>{assert.match(error.message,/HTTP 503 · HTML 응답/);assert.doesNotMatch(error.message,/private_|DOCTYPE|Unexpected|</);return true;});
   assert.ok(f.calls.filter(call=>call.url==='/api/files').length<=1);assert.equal(f.calls.some(call=>call.url.endsWith('/product-label-draft')),false);
  }finally{f.close();}
 }
});

test('HTML after committed file, pool and reference writes recovers by exact GET receipts without repeating writes',async()=>{
 const f=await fixture(async(url,init,send)=>{const response=await send();return init.method==='POST'||init.method==='PUT'?html():response;});
 try{
  const saved=await f.run();assert.ok(saved.key);assert.equal(f.calls.filter(call=>call.url==='/api/files').length,1);
  assert.equal(f.calls.filter(call=>call.url.endsWith('/attachments')).length,1);
  assert.equal(f.calls.filter(call=>call.url.endsWith('/quotation-fields')&&call.method==='PUT').length,1);
  const boundary=f.calls.length,result=await f.result();assert.equal(result.result?.key,saved.key);assert.equal(result.reason,null);
  assert.ok(f.calls.slice(boundary).every(call=>call.method==='GET'),'Recovery reads never upload, regenerate, or attach');
 }finally{f.close();}
});
