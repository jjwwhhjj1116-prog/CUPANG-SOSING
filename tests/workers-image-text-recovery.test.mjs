import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';
import {createHash,webcrypto} from 'node:crypto';

const company={code:'A01526306',name:'유앤채'},other={code:'A01464742',name:'와이홉'};
const plain=value=>JSON.parse(JSON.stringify(value));
const qwen=value=>({choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}]});
const providerSource=input=>{assert.ok(input.messages[1].content.endsWith('\n/no_think'));return JSON.parse(input.messages[1].content.slice(0,-'\n/no_think'.length));};
function fixture(options={}){
 const cache=new Map(),calls=[],network=[];let reservations=0;
 const controls={owner:'owner',company:{...company},verified:true,suspended:false,google:null,reserve:null,provider:null};
 let bytes=new Uint8Array([1,2,3]);
 const product={id:'new-product',owner_id:'owner',updated_at:'2026-10-22T00:00:00.000Z',image_keys:'["owner/new-image.png"]'};
 const content={revision:2,assets:{detail:{value:['owner/new-image.png']}}};
 const env={SOURCEFLOW_QUOTATION_AI_PROVIDER:'workers-ai',SOURCEFLOW_QUOTATION_AI_FREE_ONLY:'true',AI:{run:async(model,input)=>{
  calls.push({model,input:plain(input)});if(controls.provider)return controls.provider(model,input);
  const source=providerSource(input);return qwen({regions:source.regions.map(({index,text})=>({index,translatedText:text==='黑色'?'검정':'너비 10 cm'}))});
 }},FILES:{get:async()=>({size:bytes.length,body:new Response(bytes).body}),put:()=>{throw Error('Translation must not write images');}},...options.settings};
 const NotUsedError=class extends Error{};
 const stubs={
  'cloudflare:workers':{env},'next/server':{NextResponse:Response},parse5,
  '@/app/chatgpt-auth':{getChatGPTUser:async()=>({userId:controls.owner,verifiedAccess:controls.verified,membership:{status:controls.suspended?'suspended':'approved',companyCode:controls.company.code,companyName:controls.company.name}}),getWorkspaceOwnerId:async()=>controls.owner},
  '@/db/queries':{findProduct:async(owner,id)=>owner==='owner'&&id==='new-product'?product:null},
  '@/db/product-content':{readProductContent:async()=>content},'@/db/product-options':{},'@/db/product-attachments':{},'@/db/product-image-translation':{},'@/db/quotation-fields':{},
  '@/db/quotation-ai-jobs':{reserveQuotationAiRequest:async()=>{reservations++;await controls.reserve?.();return options.reserve!==false;}},
  '@/app/quotation-fields-snapshot':{QuotationFieldsSnapshotError:NotUsedError},'@/app/quotation-seo-targets':{},'@/app/quotation-image-targets':{},'@/app/quotation-schema':{},
  '@/app/quotation-public-detail':{PublicDetailError:NotUsedError},'@/app/product-content':{productImageKeys:raw=>JSON.parse(raw)},
  '@/app/automation/image-edit':{inspectImage:()=>({width:3,height:2,mime:'image/png'})},
  '@/app/image-files':{MAX_IMAGE_BYTES:10*1024*1024,MAX_IMAGE_MULTIPART_BYTES:10*1024*1024+65536,PRODUCT_IMAGE_POOL_LIMIT:200,isOwnedImageKey:(owner,key)=>typeof key==='string'&&key.startsWith(owner+'/')},
  '@/app/free-image-edit-document':{MAX_FREE_IMAGE_EDIT_BYTES:65536},'@/app/free-image-edit-record':{FreeImageEditRecordError:NotUsedError},
 };
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
   exports,Error,URL,URLSearchParams,Request,Response,File,Blob,FormData,Headers,TextEncoder,TextDecoder,ReadableStream,Uint8Array,DataView,AbortController,AbortSignal,Date,crypto:webcrypto,process:{env:{NODE_ENV:'production'}},
   setTimeout:(callback,ms)=>options.timeout&&ms===20_000?(queueMicrotask(callback),1):setTimeout(callback,ms),clearTimeout,
   fetch:async(url,init)=>{network.push({url,init});assert.equal(new URL(url).origin,'https://translate.googleapis.com');if(controls.google)return controls.google(url,init);return new Response('',{status:options.googleStatus??429});},
   require:name=>{if(name in stubs)return stubs[name];if(name.startsWith('@/app/'))return load(name.slice(2)+'.ts');throw Error('Unexpected dependency '+name);},
  },{filename:file});return exports;
 }
 const route=load('app/api/products/[id]/image-text/route.ts'),helper=load('app/automation/workers-image-text-recovery.ts');
 const source={productId:product.id,productVersion:product.updated_at,contentRevision:content.revision,sourceKey:'owner/new-image.png',sourceSha256:createHash('sha256').update(bytes).digest('hex'),role:'detail',width:3,height:2};
 return{controls,calls,network,env,source,helper,load,product,content,get reservations(){return reservations;},changeImage(){bytes=new Uint8Array([9,8,7]);},
  async post(regions=[{id:'user-region-private-id',text:'黑色'}],language='zh',signal){const before=JSON.stringify({source,product,content}),response=await route.POST(new Request('https://studio.test/api/products/new-product/image-text',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'translate',source,sourceLanguage:language,regions}),signal,
  }),{params:Promise.resolve({id:product.id})});assert.equal(JSON.stringify({source,product,content}),before,'translation never mutates stored fields or source');return{response,body:await response.json()};},
 };
}
test('actual image route recovers certain429 with public text/index only and one bounded free request',async()=>{
 const f=fixture(),result=await f.post();assert.equal(result.response.status,200);assert.equal(result.body.regions[0].translated,'검정');assert.equal(result.body.stoppedHttpStatus,429);assert.equal(result.body.requests,1);
 assert.deepEqual(result.body.workersRecovery,{provider:'workers-ai',status:'completed',requests:1,sourceRegions:1,translatedRegions:1});
 assert.equal(f.network.length,1);assert.equal(f.reservations,1);assert.equal(f.calls.length,1);
 const {model,input}=f.calls[0];assert.equal(model,'@cf/qwen/qwen3-30b-a3b-fp8');assert.equal(input.max_tokens,2048);assert.equal(input.temperature,0);assert.equal(input.stream,false);
 assert.deepEqual(providerSource(input),{sourceLanguage:'zh',regions:[{index:0,text:'黑色'}]});
 for(const sensitive of ['user-region-private-id','new-product','owner/new-image.png',company.code,company.name,f.source.sourceSha256])assert.ok(!JSON.stringify(input).includes(sensitive));
 assert.match(input.messages[0].content,/untrusted product text/);assert.equal(input.response_format.json_schema.additionalProperties,false);
 assert.equal(input.response_format.json_schema.properties.regions.minItems,1);assert.equal(input.response_format.json_schema.properties.regions.items.properties.translatedText.maxLength,2000);
});
test('unconfigured or unconfirmed Free provider retains original Google429 failure without quota/model use',async()=>{
 for(const settings of [{SOURCEFLOW_QUOTATION_AI_PROVIDER:'other'},{SOURCEFLOW_QUOTATION_AI_FREE_ONLY:'false'},{AI:undefined}]){
  const f=fixture({settings}),result=await f.post();assert.equal(result.response.status,200);assert.equal(result.body.regions[0].translated,null);assert.equal(result.body.workersRecovery,undefined);assert.equal(f.reservations,0);assert.equal(f.calls.length,0);
 }
});
test('other HTTP and network failures never start Workers or use daily quota',async()=>{
 for(const status of [400,403,500,503]){const f=fixture({googleStatus:status}),out=await f.post();assert.equal(out.body.regions[0].translated,null);assert.equal(out.body.workersRecovery,undefined);assert.equal(f.reservations,0);}
 const f=fixture();f.controls.google=async()=>{throw Error('connection reset');};const out=await f.post();assert.equal(out.body.workersRecovery,undefined);assert.equal(f.reservations,0);
});
test('Google successful regions survive a later429 and only unresolved exact IDs reach Workers',async()=>{
 const f=fixture(),rows=Array.from({length:8},(_,i)=>({id:'r'+i,text:`颜色${i} ${'文'.repeat(900)}`}));let count=0;
 f.controls.google=async url=>{if(++count===2)return new Response('',{status:429});const q=new URL(url).searchParams.get('q');return Response.json([[[q.split('\n').map(line=>{const match=/^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line);return`${match[1]} 색상 ${rows.findIndex(row=>row.text===match[2])}`;}).join('\n')]],null,'zh-CN']);};
 f.controls.provider=async(_model,input)=>{const source=providerSource(input);assert.equal(source.regions.length,3);assert.ok(source.regions[0].text.startsWith('颜色5 '));return qwen({regions:source.regions.map(({index,text})=>({index,translatedText:'다른 색상 '+/^颜色(\d)/.exec(text)[1]}))});};
 const out=await f.post(rows);assert.equal(out.response.status,200);assert.deepEqual(out.body.regions.slice(0,5).map(row=>row.translated),['색상 0','색상 1','색상 2','색상 3','색상 4']);assert.equal(out.body.workersRecovery.translatedRegions,3);assert.equal(f.calls.length,1);
});
test('duplicates and reordered provider output remain bound to each exact OCR region including partial failures',async()=>{
 const f=fixture();f.controls.provider=async()=>qwen({regions:[{index:1,translatedText:'검정 99'},{index:0,translatedText:'검정'}]});
 const out=await f.post([{id:'a',text:'黑色'},{id:'b',text:'黑色'},{id:'c',text:'한국어 유지'}]);
 assert.deepEqual(out.body.regions.map(row=>row.translated),['검정',null,null]);assert.equal(out.body.workersRecovery.status,'partial');assert.equal(out.body.workersRecovery.sourceRegions,2);assert.equal(out.body.workersRecovery.translatedRegions,1);
});
test('shared limit and 30 region/5000 character bounds retain source without making a model request',async()=>{
 const limited=fixture({reserve:false}),a=await limited.post();assert.equal(a.body.workersRecovery.status,'limited');assert.equal(a.body.workersRecovery.requests,0);assert.equal(limited.reservations,1);assert.equal(limited.calls.length,0);
 for(const rows of [Array.from({length:31},(_,i)=>({id:'r'+i,text:'黑色'})),[{id:'a',text:'文'.repeat(3000)},{id:'b',text:'文'.repeat(2001)}]]){
  const f=fixture(),out=await f.post(rows);assert.equal(out.response.status,200);assert.equal(out.body.workersRecovery.status,'input-limit');assert.equal(out.body.workersRecovery.sourceRegions,rows.length);assert.equal(out.body.workersRecovery.requests,0);assert.equal(f.reservations,0);assert.equal(f.calls.length,0);
 }
});
test('provider uncertain error and timeout consume one reservation with no retry or paid fallback',async()=>{
 for(const timeout of [false,true]){const f=fixture({timeout});f.controls.provider=timeout?()=>new Promise(()=>{}):async()=>{throw Error('unknown provider outcome');};
  const out=await f.post();assert.equal(out.response.status,200);assert.equal(out.body.workersRecovery.status,timeout?'timeout':'failed');assert.equal(out.body.workersRecovery.requests,1);assert.equal(out.body.regions[0].translated,null);assert.equal(f.calls.length,1);assert.equal(f.reservations,1);
 }
});
test('company, owner or membership changes before reservation/after reservation/after model cannot publish stale translations',async()=>{
 for(const moment of ['google','reserve','provider'])for(const field of ['owner','company','suspended']){
  const f=fixture(),mutate=()=>{if(field==='owner')f.controls.owner='foreign';else if(field==='company')f.controls.company=other;else f.controls.suspended=true;};
  if(moment==='google')f.controls.google=async()=>{mutate();return new Response('',{status:429});};
  if(moment==='reserve')f.controls.reserve=async()=>mutate();
  if(moment==='provider')f.controls.provider=async()=>{mutate();return qwen({regions:[{index:0,translatedText:'검정'}]});};
  const out=await f.post();assert.equal(out.response.status,409,`${moment}/${field}`);assert.equal(out.body.regions,undefined);assert.equal(f.calls.length,moment==='provider'?1:0);
 }
});
test('image bytes changed during model or request cancellation reject the stale reply',async()=>{
 const f=fixture();f.controls.provider=async()=>{f.changeImage();return qwen({regions:[{index:0,translatedText:'검정'}]});};
 const out=await f.post();assert.equal(out.response.status,409);assert.equal(out.body.regions,undefined);
 const cancelled=fixture(),controller=new AbortController();cancelled.controls.provider=async()=>{controller.abort();return qwen({regions:[{index:0,translatedText:'검정'}]});};
 const abort=await cancelled.post(undefined,'zh',controller.signal);assert.equal(abort.response.status,503);assert.equal(abort.body.regions,undefined);assert.equal(cancelled.calls.length,1);
});
test('strict response rejects foreign/duplicate indices or envelope fields and validates each number/unit/model code',()=>{
 const f=fixture(),rows=[{id:'r',text:'型号 AB-123 宽度10 cm 容量 500ml'}],verify=raw=>f.helper.verifyImageTextRecovery(rows,qwen(raw));
 assert.equal(verify({regions:[{index:0,translatedText:'모델 AB-123 너비 10 cm 용량 500 ml'}]}).regions[0].translated,'모델 AB-123 너비 10 cm 용량 500 ml');
 for(const text of ['모델 AB-124 너비10 cm 용량500ml','모델 AB-123 너비10 mm 용량500ml','모델 AB-123 너비10 cm 용량500ml 2개','모델 AB-123 너비10 cm 容量500ml','모델 AB-123 너비10 cm 용량500ml\u200b'])assert.equal(verify({regions:[{index:0,translatedText:text}]}).regions[0].translated,null);
 for(const raw of [{regions:[{index:1,translatedText:'검정'}]},{regions:[{index:0,translatedText:'검정'},{index:0,translatedText:'검정'}]},{regions:[],company:'private'},{regions:[{index:0,translatedText:'검정',other:'field'}]},'not json'])assert.throws(()=>verify(raw));
});
test('English text uses same isolated recovery and selected-language exclusions are never sent',async()=>{
 const f=fixture();f.controls.provider=async(_model,input)=>{const data=providerSource(input);assert.deepEqual(data,{sourceLanguage:'en',regions:[{index:0,text:'Waterproof IPX6 10 cm'}]});return qwen({regions:[{index:0,translatedText:'방수 IPX6 10 cm'}]});};
 const out=await f.post([{id:'a',text:'Waterproof IPX6 10 cm'},{id:'b',text:'黑色'},{id:'c',text:'12.5'}],'en');assert.deepEqual(out.body.regions.map(row=>row.translated),['방수 IPX6 10 cm',null,null]);assert.equal(out.body.workersRecovery.sourceRegions,1);
});
test('measurement numbers remain bound to their own units and unsupported functional claims never count as success',()=>{
 const f=fixture(),verify=(text,translatedText)=>f.helper.verifyImageTextRecovery([{id:'r',text}],qwen({regions:[{index:0,translatedText}]}));
 for(const [text,translatedText]of [
  ['长度10 cm 宽度20 mm','길이 10 mm 너비 20 cm'],['功率10 W 电压20 V','전력 10 V 전압 20 W'],
  ['产品说明','방수 방습 제품 설명'],['产品说明','항균 무독성 친환경 제품 설명'],['SIZE 10 cm','방수 사이즈 10 cm'],
  ['不防水','방수 제품'],['not waterproof','방수 제품'],
 ]){const result=verify(text,translatedText);assert.equal(result.regions[0].translated,null);assert.equal(result.workersRecovery.translatedRegions,0);}
 assert.equal(verify('防水 IPX6 10 cm','방수 IPX6 10 cm').workersRecovery.status,'completed');
 assert.equal(verify('不防水','방수가 되지 않습니다').workersRecovery.status,'invalid-response');
});

test('abrasion protection cannot invent heat resistance and a heel is not a hook without source evidence',()=>{
 const f=fixture(),verify=(text,translatedText)=>f.helper.verifyImageTextRecovery([{id:'r',text}],qwen({regions:[{index:0,translatedText}]})).regions[0];
 for(const [source,value]of [
  ['ANTI ABRASION AND ANTI FALLING HEEL','내열성 및 낙하 방지 후크'],
  ['ANTI ABRASION AND ANTI FALLING HEEL','내열성 및 뒤꿈치 벗겨짐 방지'],
  ['SHOE SIZE HEEL PATCH','신발 크기 후크 패치'],
  ['HEEL PATCH','훅 패치'],['HEEL PATCH','갈고리 패치'],
  ['not heat resistant heel patch','내열성 뒤꿈치 패치'],
 ]){const row=verify(source,value);assert.equal(row.translated,null,source);assert.match(row.issue,/원문에 없는 성능·주장|원문 부위·부품 연결/);}
 for(const [source,value]of [
  ['ANTI ABRASION AND ANTI FALLING HEEL','마찰 및 뒤꿈치 벗겨짐 방지'],['SHOE SIZE HEEL PATCH','신발 사이즈 뒤꿈치 패치'],
  ['Heat resistant heel patch','내열성 뒤꿈치 패치'],['Thermal resistant heel patch','내열 뒤꿈치 패치'],['耐高温后跟贴','내열성 뒤꿈치 패치'],
  ['Climbing heel hook','클라이밍 힐 후크'],['Heel hook-and-loop patch','뒤꿈치 후크 앤 루프 패치'],
  ['HEEL PATCH WITH HOOKS','후크가 있는 뒤꿈치 패치'],['HEELED HOOK','굽 있는 후크'],
 ])assert.equal(verify(source,value).translated,value,source);
});

for(const provider of ['google','workers'])test(`actual ${provider} image translation retains good regions and issues for unsupported heat/heel substitutions`,async()=>{
 const f=fixture(),rows=[{id:'heat',text:'ANTI ABRASION AND ANTI FALLING HEEL'},{id:'heel',text:'SHOE SIZE HEEL PATCH'},{id:'valid',text:'SOFT HEEL PATCH'}],
  texts=['내열성 및 낙하 방지 후크','신발 크기 후크 패치','부드러운 뒤꿈치 패치'];
 if(provider==='workers')f.controls.provider=async()=>qwen({regions:texts.map((translatedText,index)=>({index,translatedText}))});
 else f.controls.google=async url=>{
  const q=new URL(url).searchParams.get('q'),translated=q.split('\n').map(line=>{const match=/^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line);return match?`${match[1]} ${texts[rows.findIndex(row=>row.text===match[2])]}`:texts[rows.findIndex(row=>row.text===line)];}).join('\n');
  return Response.json([[[translated]],null,'en']);
 };
 const out=await f.post(rows,'en');assert.equal(out.response.status,200);
 assert.deepEqual(out.body.regions.map(row=>[row.id,row.original,row.translated]),rows.map((row,index)=>[row.id,row.text,index===2?texts[index]:null]));
 for(const row of out.body.regions.slice(0,2))assert.match(row.issue,/원문.*(?:성능·주장|부위·부품 연결)/);
 assert.equal(out.body.regions[2].issue,null);assert.equal(f.network.length,1);assert.equal(f.calls.length,provider==='workers'?1:0);
 assert.equal(f.reservations,provider==='workers'?1:0);
 if(provider==='workers'){assert.equal(out.body.workersRecovery.status,'partial');assert.equal(out.body.workersRecovery.translatedRegions,1);}else assert.equal(out.body.workersRecovery,undefined);
});
test('model-specific Qwen content never accepts response strings, thinking text or a truncated completion',async()=>{
 for(const raw of [
  {response:JSON.stringify({regions:[{index:0,translatedText:'검정'}]})},
  {choices:[{message:{role:'assistant',content:'<think>reasoning</think>{"regions":[{"index":0,"translatedText":"검정"}]}'}}]},
  {choices:[{message:{role:'assistant',content:'```json\n{"regions":[]}\n```'}}]},
  {choices:[{finish_reason:'length',message:{role:'assistant',content:'{"regions":[{"index":0,"translatedText":"검정"}]}'}}]},
  {choices:[{message:{role:'assistant',content:'',reasoning_content:'{"regions":[{"index":0,"translatedText":"검정"}]}'}}]},
 ]){
  const f=fixture();f.controls.provider=async()=>raw;const out=await f.post();assert.equal(out.response.status,200);assert.equal(out.body.workersRecovery.status,'invalid-response');assert.equal(out.body.regions[0].translated,null);assert.equal(f.calls.length,1);
 }
});

test('image-only JSON mode accepts its documented response object with exact regions while shared Qwen stays strict',async()=>{
 const value={regions:[{index:1,translatedText:'너비 10 cm'},{index:0,translatedText:'검정'}]},rows=[{id:'exact-a',text:'黑色'},{id:'exact-b',text:'宽度10 cm'}];
 for(const raw of [{response:value},{response:value,model:'@cf/qwen/qwen3-30b-a3b-fp8',usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}},{...qwen(value),response:{regions:value.regions.map(row=>({translatedText:row.translatedText,index:row.index}))}},{...qwen(value),response:undefined}]){
  const f=fixture();f.controls.provider=async()=>raw;const out=await f.post(rows);assert.equal(out.response.status,200);assert.equal(out.body.workersRecovery.status,'completed');assert.deepEqual(out.body.regions.map(row=>[row.id,row.translated]),[['exact-a','검정'],['exact-b','너비 10 cm']]);assert.equal(f.calls.length,1);assert.equal(f.reservations,1);assert.equal(f.network.length,1);
 }
 const f=fixture();assert.throws(()=>f.load('app/automation/workers-qwen-contract.ts').parseWorkersQwenJson({response:value}));
});

test('chat transport metadata does not reject valid content or repair failed provider content',async()=>{
 const value={regions:[{index:0,translatedText:'검정'}]};
 const f=fixture();f.controls.provider=async()=>({...qwen(value),system_fingerprint:'opaque',service_tier:'default',request_id:'opaque-id',metrics:{latency:1}});
 const out=await f.post();assert.equal(out.body.workersRecovery.status,'completed');assert.equal(out.body.regions[0].translated,'검정');assert.equal(f.calls.length,1);
 for(const marker of [{error:{message:'PRIVATE_ERROR'}},{errors:[{message:'PRIVATE_ERROR'}]},{success:false},{refusal:'PRIVATE_REFUSAL'},{status:'in_progress'}]){
  const blocked=fixture();blocked.controls.provider=async()=>({...qwen(value),...marker});const result=await blocked.post();assert.equal(result.body.workersRecovery.status,'invalid-response');assert.match(result.body.regions[0].issue,/IMAGE_PROVIDER_STATUS/);assert.ok(!result.body.regions[0].issue.includes('PRIVATE_'));
 }
 const incomplete=fixture();incomplete.controls.provider=async()=>({...qwen(value),system_fingerprint:'opaque',choices:[{finish_reason:'length',message:{role:'assistant',content:JSON.stringify(value)}}]});
 const stopped=await incomplete.post();assert.equal(stopped.body.regions[0].translated,null);assert.match(stopped.body.regions[0].issue,/OUTPUT_TRUNCATED/);
});

test('response-only mode rejects undocumented envelopes, declared foreign metadata, missing indices and mismatched dual content',()=>{
 const f=fixture(),value={regions:[{index:0,translatedText:'검정'}]},rows=[{id:'exact-a',text:'黑色'}],verify=raw=>f.helper.verifyImageTextRecovery(rows,raw);
 for(const raw of [null,[],{response:null},{response:[]},{response:'PRIVATE_BODY'},
  {response:value,model:'@cf/meta/llama-3.3-70b-instruct-fp8-fast'},{response:value,model:'PRIVATE_MODEL'},
  {response:value,object:'chat.completion'},{response:value,finish_reason:'length'},{response:value,request_id:'PRIVATE_ASYNC'},
  {response:value,unknown:'PRIVATE_UNKNOWN'},{response:value,tool_calls:[]},{response:value,usage:{total_tokens:-1}},
  {response:{regions:[]}},{response:{regions:[{index:1,translatedText:'검정'}]}},
  {response:{regions:[{index:0,translatedText:'검정'},{index:0,translatedText:'검정'}]}},
  {...qwen(value),response:{regions:[{index:0,translatedText:'흰색'}]}},
  {...qwen(value),response:JSON.stringify(value)},
 ])assert.throws(()=>verify(raw),error=>error.status==='invalid-response'&&!error.message.includes('PRIVATE_'));
 const accessor={};Object.defineProperty(accessor,'response',{enumerable:true,get(){throw Error('must not read');}});assert.throws(()=>verify(accessor),error=>error.status==='invalid-response');
});

test('API exposes bounded contract diagnostics and per-region quality reasons without copying provider text or retrying',async()=>{
 for(const [raw,code]of [[{choices:[{finish_reason:'length',message:{role:'assistant',content:'PRIVATE_PROVIDER_OUTPUT'}}]},'OUTPUT_TRUNCATED'],[{response:{regions:[]}},'IMAGE_REGION_COUNT'],[{choices:[{finish_reason:'stop',message:{role:'assistant',content:'PRIVATE_PROVIDER_OUTPUT'}}]},'JSON_SYNTAX']]){
  const f=fixture();f.controls.provider=async()=>raw;const out=await f.post();assert.equal(out.body.workersRecovery.status,'invalid-response');assert.match(out.body.regions[0].issue,new RegExp(code));assert.ok(!out.body.regions[0].issue.includes('PRIVATE_'));assert.equal(f.calls.length,1);assert.equal(f.reservations,1);
 }
 const f=fixture();f.controls.provider=async()=>({response:{regions:[{index:0,translatedText:'너비 11 cm'}]}});const out=await f.post([{id:'exact-region',text:'宽度10 cm'}]);assert.equal(out.body.workersRecovery.status,'invalid-response');assert.match(out.body.regions[0].issue,/영역 1 검증 실패: 원문 숫자/);assert.ok(!out.body.regions[0].issue.includes('너비'));assert.equal(f.calls.length,1);
});
