import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';

const owner='title-owner',company={code:'A01526306',name:'유앤채'},other={code:'A01464742',name:'와이홉'};
const source='不锈钢304保温杯500ml',translated='스테인리스 304 보온컵 500ml';
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(options={}){
 const calls=[],googleCalls=[];let reservations=0,currentOwner=owner,currentCompany=company;
 const controls={google:null,reserve:null,provider:null};
 const settings={SOURCEFLOW_QUOTATION_AI_PROVIDER:'workers-ai',SOURCEFLOW_QUOTATION_AI_FREE_ONLY:'true',AI:{run:async(model,input)=>{
  calls.push({model,input:clone(input)});if(controls.provider)return controls.provider(model,input);
  return {response:{translatedText:translated}};
 }},...options.settings};
 const cache=new Map(),timerCallbacks=[];
 function load(file){
  if(cache.has(file))return cache.get(file);
  const exports={};cache.set(file,exports);
  const text=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
  vm.runInNewContext(ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
   exports,Request,Response,URL,TextEncoder,TextDecoder,ReadableStream,Uint8Array,AbortController,Error,
   setTimeout:options.immediateTimeout?callback=>{timerCallbacks.push(callback);queueMicrotask(callback);return 1;}:setTimeout,
   clearTimeout:options.immediateTimeout?()=>{}:clearTimeout,
   fetch:()=>{throw Error('No arbitrary network request allowed');},
   require:name=>{
    if(name==='cloudflare:workers')return {env:settings};
    if(name==='@/app/chatgpt-auth')return {getChatGPTUser:async()=>({verifiedAccess:true,membership:currentCompany?{status:'approved',companyCode:currentCompany.code,companyName:currentCompany.name}:undefined}),getWorkspaceOwnerId:async()=>currentOwner};
    if(name==='@/app/automation/google-free-translation')return {translateGoogleFree:async(text,opts)=>{
     googleCalls.push({text,opts});if(controls.google)return controls.google(text,opts);
     opts.onFailure(options.failure??{reason:'http',status:429});return null;
    }};
    if(name==='@/db/quotation-ai-jobs')return {reserveQuotationAiRequest:async(...args)=>{
     assert.equal(args.length,0,'Use the existing shared default daily cap');reservations++;
     if(controls.reserve)await controls.reserve();return options.reserveFn?options.reserveFn():options.reserve!==false;
    }};
    if(['@/app/request-body','@/app/supplier-hub-company','@/app/category-title-workers-recovery'].includes(name))return load(name.slice(2)+'.ts');
    throw Error('Unexpected dependency '+name);
   },
  },{filename:file});return exports;
 }
 const route=load('app/api/category-recommendation-title/route.ts'),helper=load('app/category-title-workers-recovery.ts');
 return {calls,googleCalls,settings,controls,helper,timerCallbacks,get reservations(){return reservations;},
  changeCompany(value=other){currentCompany=value;},changeOwner(value='other-owner'){currentOwner=value;},
  async post(productName=source,signal){const response=await route.POST(new Request('https://studio.test/api/category-recommendation-title',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:owner,productName}),signal,
  }));return{response,body:await response.json()};},
 };
}
test('certain Google HTTP429 uses exactly one fixed free model with only public source text and strict schema',async()=>{
 const f=fixture(),result=await f.post();assert.equal(result.response.status,200);assert.equal(result.response.headers.get('cache-control'),'no-store');
 assert.equal(result.body.productName,source);assert.equal(result.body.queryProductName,translated);assert.equal(result.body.translationProvider,'workers-ai');assert.match(result.body.caution,/상품명만/);
 assert.equal(f.googleCalls.length,1);assert.equal(f.reservations,1);assert.equal(f.calls.length,1);
 const {model,input}=f.calls[0];assert.equal(model,'@cf/meta/llama-3.3-70b-instruct-fp8-fast');
 assert.equal(input.max_tokens,512);assert.equal(input.temperature,0);assert.equal(input.stream,false);
 assert.deepEqual(JSON.parse(input.messages[1].content),{sourceProductName:source});
 assert.match(input.messages[0].content,/untrusted product text/);assert.match(input.messages[0].content,/Do not infer or add/);
 assert.deepEqual(input.response_format,{type:'json_schema',json_schema:{type:'object',properties:{translatedText:{type:'string'}},required:['translatedText'],additionalProperties:false}});
 const external=JSON.stringify(input);for(const privateValue of [owner,company.code,company.name,'cookie','password','expectedOwnerId'])assert.ok(!external.includes(privateValue));
});
test('Google success and Korean input do not load or reserve the fallback',async()=>{
 const f=fixture();f.controls.google=async()=>({translatedText:translated});
 assert.equal((await f.post()).body.queryProductName,translated);assert.equal(f.calls.length,0);assert.equal(f.reservations,0);
 const korean=await f.post('직접 입력한 상품');assert.equal(korean.body.queryProductName,'직접 입력한 상품');assert.equal(f.googleCalls.length,1);
});
test('network, timeout, malformed response and non429 HTTP failures never trigger another provider',async()=>{
 for(const failure of [{reason:'network'},{reason:'timeout'},{reason:'invalid-response'},{reason:'http',status:403},{reason:'http',status:500},{reason:'network',status:429}]){
  const f=fixture({failure}),result=await f.post();assert.equal(result.response.status,502);assert.equal(f.reservations,0);assert.equal(f.calls.length,0);assert.equal(result.body.queryProductName,undefined);
 }
});
test('missing or unconfirmed Free provider configuration blocks model reservation and preserves source',async()=>{
 for(const settings of [{SOURCEFLOW_QUOTATION_AI_PROVIDER:'openai'},{SOURCEFLOW_QUOTATION_AI_FREE_ONLY:'false'},{SOURCEFLOW_QUOTATION_AI_FREE_ONLY:undefined},{AI:undefined}]){
  const f=fixture({settings}),result=await f.post();assert.equal(result.response.status,503);assert.equal(result.body.code,'CATEGORY_TITLE_RECOVERY_NOT_CONFIGURED');assert.equal(f.reservations,0);assert.equal(f.calls.length,0);
 }
});
test('shared daily limit refusal cannot run a model or return a translated category query',async()=>{
 const f=fixture({reserve:false}),result=await f.post();assert.equal(result.response.status,429);assert.equal(result.body.code,'CATEGORY_TITLE_RECOVERY_LIMIT');assert.equal(f.reservations,1);assert.equal(f.calls.length,0);assert.equal(result.body.queryProductName,undefined);
});
test('actual shared SQLite reservation permits only the final remaining request across concurrent title calls',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 const db={prepare(sql){let values=[];return{bind(...args){values=args;return this;},first:async()=>sqlite.prepare(sql).get(...values)??null,run:async()=>sqlite.prepare(sql).run(...values)};},async batch(items){return Promise.all(items.map(item=>item.run()));}};
 const exports={};
 try{
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../db/quotation-ai-jobs.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
   exports,Date,Error,require:name=>{if(name==='cloudflare:workers')return{env:{DB:db}};if(name==='@/db/quotation-fields')return{};throw Error('Unexpected reservation dependency '+name);},
  });
  for(let index=0;index<39;index++)assert.equal(await exports.reserveQuotationAiRequest(),true);
  const a=fixture({reserveFn:exports.reserveQuotationAiRequest}),b=fixture({reserveFn:exports.reserveQuotationAiRequest});
  const answers=await Promise.all([a.post(),b.post()]);assert.deepEqual(answers.map(item=>item.response.status).sort(),[200,429]);
  assert.equal(a.calls.length+b.calls.length,1);assert.equal(sqlite.prepare('SELECT requests FROM quotation_ai_daily').get().requests,40);
  assert.equal(await exports.reserveQuotationAiRequest(),false);assert.equal(sqlite.prepare('SELECT requests FROM quotation_ai_daily').get().requests,40);
 }finally{sqlite.close();}
});
test('owner/company change after Google, during reservation or during AI rejects stale output',async()=>{
 for(const moment of ['google','reserve','provider'])for(const field of ['owner','company','suspended']){
  const f=fixture();const mutate=()=>field==='owner'?f.changeOwner():f.changeCompany(field==='company'?other:null);
  if(moment==='google')f.controls.google=async(_text,opts)=>{opts.onFailure({reason:'http',status:429});mutate();return null;};
  if(moment==='reserve')f.controls.reserve=async()=>{mutate();};
  if(moment==='provider')f.controls.provider=async()=>{mutate();return{response:{translatedText:translated}};};
  const result=await f.post();assert.equal(result.response.status,409,`${moment}/${field}`);assert.equal(result.body.queryProductName,undefined);
  assert.equal(f.calls.length,moment==='provider'?1:0);assert.equal(f.reservations,moment==='google'?0:1);
 }
});
test('provider failure is attempted once with no retry or paid fallback',async()=>{
 const f=fixture();f.controls.provider=async()=>{throw Error('uncertain response');};
 const result=await f.post();assert.equal(result.response.status,503);assert.equal(f.calls.length,1);assert.equal(f.reservations,1);assert.equal(result.body.queryProductName,undefined);
});
test('bounded provider timeout returns504 with its shared daily reservation retained',async()=>{
 const f=fixture({immediateTimeout:true});f.controls.provider=()=>new Promise(()=>{});
 const result=await f.post();assert.equal(result.response.status,504);assert.equal(result.body.code,'CATEGORY_TITLE_RECOVERY_TIMEOUT');assert.equal(f.calls.length,1);assert.equal(f.reservations,1);assert.equal(f.timerCallbacks.length,1);
});
test('cancellation during Google or provider prevents stale title publication and retries',async()=>{
 for(const phase of ['google','provider']){
  const f=fixture(),controller=new AbortController();
  if(phase==='google')f.controls.google=async(_text,opts)=>{opts.onFailure({reason:'http',status:429});controller.abort();return null;};
  else f.controls.provider=async()=>{controller.abort();return{response:{translatedText:translated}};};
  const result=await f.post(source,controller.signal);assert.equal(result.response.status,503);assert.equal(result.body.queryProductName,undefined);assert.equal(f.calls.length,phase==='google'?0:1);
 }
});
test('model JSON is plain Korean title only and preserves source numeric tokens',()=>{
 const f=fixture(),verify=f.helper.verifyCategoryTitleTranslation;
 assert.equal(verify(source,{response:JSON.stringify({translatedText:translated})}),translated);
 for(const response of [null,{},[],{translatedText:''},{translatedText:'Cup 304 500ml'},{translatedText:'스테인리스304保温컵500ml'},
  {translatedText:'스테인리스304 컵500ml\u0000'},{translatedText:'스테인리스304 컵500ml\u200b'},
  {translatedText:'<b>스테인리스304 컵500ml</b>'},{translatedText:'스테인리스304 컵500ml https://invalid.test'},
  {translatedText:'스테인리스304 컵500ml',company:'private'},{translatedText:'컵304'},
  {translatedText:'스테인리스305 컵500ml'},{translatedText:'스테인리스304 컵500ml 2개'},
  {translatedText:'가'.repeat(501)},'not json','```json\n{}\n```',
 ])assert.throws(()=>verify(source,{response}));
 assert.throws(()=>verify(source,{translatedText:translated}));
});
test('invalid or private request fields cannot reach Google, AI or a daily reservation',async()=>{
 for(const value of ['帽'.repeat(501),'帽\u0000','']){
  const f=fixture(),result=await f.post(value);assert.equal(result.response.status,400);assert.equal(f.googleCalls.length,0);assert.equal(f.calls.length,0);assert.equal(f.reservations,0);
 }
});
