import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto,createHash} from 'node:crypto';
import * as parse5 from 'parse5';
const plain=value=>JSON.parse(JSON.stringify(value));
const company={code:'A01526306',name:'유앤채'};
const chat=value=>({model:'@cf/qwen/qwen3.8-27b',object:'chat.completion',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}]});
const block=(original='黑色',translated='검정',box={x:10,y:12,width:30,height:15})=>({original,translated,box});
function fixture(options={}){
 const calls=[],ledger=new Map(),cache=new Map();let bytes=new Uint8Array([1,2,3]),claims=0;
 const controls={owner:'owner',company:{...company},verified:true,provider:null,afterClaim:null,afterFinish:null,claimAckLost:false,finishAckLost:false};
 const product={id:'new-product',owner_id:'owner',updated_at:'2026-10-29T00:00:00.000Z',image_keys:'["owner/source.png"]'},content={revision:2,assets:{detail:{value:['owner/source.png']},additional:{value:['owner/source.png']},main:{value:['owner/source.png']}}};
 const env={SOURCEFLOW_IMAGE_TEXT_PROVIDER:'workers-ai-vision',SOURCEFLOW_IMAGE_TEXT_MODEL:'@cf/qwen/qwen3.8-27b',SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED:'true',AI:{async run(model,input){calls.push({model,input:plain(input)});return controls.provider?controls.provider(model,input):chat({blocks:[block()]});}},FILES:{async get(){return{size:bytes.length,body:new Response(bytes).body};},put(){throw Error('No image writes');}},...options.env};
 const notUsed=class extends Error{};
 const stubs={'cloudflare:workers':{env},'next/server':{NextResponse:Response},parse5,
  '@/app/chatgpt-auth':{getChatGPTUser:async()=>({userId:controls.owner,email:'fixture@example.test',verifiedAccess:controls.verified,membership:{id:controls.owner,email:'fixture@example.test',role:'admin',status:'approved',companyCode:controls.company.code,companyName:controls.company.name}}),getWorkspaceOwnerId:async()=>controls.owner},
  '@/db/queries':{findProduct:async(owner,id)=>owner==='owner'&&id==='new-product'?product:null},'@/db/product-content':{readProductContent:async()=>content},'@/db/product-options':{},'@/db/product-attachments':{},'@/db/product-image-translation':{},'@/db/quotation-fields':{},
  '@/app/quotation-fields-snapshot':{QuotationFieldsSnapshotError:notUsed},'@/app/quotation-seo-targets':{},'@/app/quotation-image-targets':{},'@/app/quotation-schema':{},'@/app/quotation-public-detail':{PublicDetailError:notUsed},
  '@/app/product-content':{productImageKeys:JSON.parse},'@/app/automation/image-edit':{inspectImage:()=>({width:100,height:80,mime:'image/png'})},
  '@/app/image-files':{MAX_IMAGE_BYTES:10*1024*1024,MAX_IMAGE_MULTIPART_BYTES:11*1024*1024,PRODUCT_IMAGE_POOL_LIMIT:200,isOwnedImageKey:(owner,key)=>key.startsWith(owner+'/')},
  '@/app/free-image-edit-document':{MAX_FREE_IMAGE_EDIT_BYTES:65536},'@/app/free-image-edit-record':{FreeImageEditRecordError:notUsed},
  '@/db/image-vision-requests':{
   async claimImageVisionRequest(scope){claims++;let row=ledger.get(scope.requestId);if(row)return{claimed:false,record:row};if([...ledger.values()].some(row=>row.scope.sourceScope===scope.sourceScope&&['running','uncertain'].includes(row.status)))return{claimed:false,record:null};row={scope:plain(scope),status:'running',request_fingerprint:scope.fingerprint,result:null,failure:null};ledger.set(scope.requestId,row);await controls.afterClaim?.();if(controls.claimAckLost)throw Error('lost claim acknowledgement');return{claimed:true,record:row};},
   async finishImageVisionRequest(scope,value){const row=ledger.get(scope.requestId);if(row.status!=='running')throw Error('CAS');Object.assign(row,value,{result:value.result?JSON.stringify(value.result):null});await controls.afterFinish?.();if(controls.finishAckLost)throw Error('lost finish acknowledgement');},
   async completedImageVisionResult(scope){return[...ledger.values()].find(row=>row.status==='completed'&&row.scope.requestId!==scope.requestId&&row.scope.owner===scope.owner&&row.scope.productId===scope.productId&&row.scope.model===scope.model&&row.scope.sourceScope===scope.sourceScope&&JSON.stringify(row.scope.company)===JSON.stringify(scope.company))??null;},
  }};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,Error,URL,URLSearchParams,Request,Response,File,Blob,FormData,Headers,TextEncoder,TextDecoder,ReadableStream,Uint8Array,DataView,AbortController,AbortSignal,Date,crypto:webcrypto,btoa:value=>Buffer.from(value,'binary').toString('base64'),process:{env:{NODE_ENV:'production'}},
   setTimeout:(fn,ms)=>options.timeout&&ms===60000?(queueMicrotask(fn),1):setTimeout(fn,ms),clearTimeout,fetch:()=>{throw Error('No external HTTP');},require(name){if(name in stubs)return stubs[name];if(name.startsWith('@/app/'))return load(name.slice(2)+'.ts');throw Error('Unexpected dependency '+name);}}, {filename:file});return exports;}
 const source={productId:product.id,productVersion:product.updated_at,contentRevision:2,sourceKey:'owner/source.png',sourceSha256:createHash('sha256').update(bytes).digest('hex'),role:'detail',width:100,height:80};
 const helper=load('app/automation/workers-image-vision.ts'),contract=load('app/image-text-vision.ts'),route=load('app/api/products/[id]/image-text/route.ts');
 return{calls,ledger,controls,source,env,helper,contract,content,product,get claims(){return claims;},changeBytes(){bytes=new Uint8Array([9,8,7]);},
  async post(overrides={},signal,headers={}){const body={action:'vision',source:plain(source),sourceLanguage:'zh',configuration:helper.imageVisionConfiguration(env),requestId:'12345678-1234-4123-8123-123456789abc',...overrides};const response=await route.POST(new Request('https://app.test/api/products/new-product/image-text',{method:'POST',headers:{'content-type':'application/json',origin:'https://app.test',...headers},body:JSON.stringify(body),signal}),{params:Promise.resolve({id:'new-product'})});return{status:response.status,body:await response.json()};},load};
}
test('owned bytes use exact Vision model, low reasoning, schema and one request, completed UUID replays without writes',async()=>{
 const h=fixture(),before=JSON.stringify([h.source,h.product,h.content]);const result=await h.post();assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(h.calls.length,1);assert.equal(result.body.result.blocks[0].translated,'검정');
 const call=h.calls[0];assert.equal(call.model,'@cf/qwen/qwen3.8-27b');assert.equal(call.input.reasoning_effort,'low');assert.equal(call.input.max_completion_tokens,4096);assert.equal(call.input.stream,false);assert.equal(call.input.tool_choice,'none');assert.equal(call.input.response_format.type,'json_schema');
 assert.equal(call.input.messages[1].content[1].image_url.url,'data:image/png;base64,AQID');assert.ok(!JSON.stringify(call.input).includes('owner/source.png'));assert.equal(JSON.stringify([h.source,h.product,h.content]),before);
  assert.equal((await h.post()).body.replayed,true);assert.equal(h.calls.length,1);
});
test('fresh UUID for the same owned image reuses completed artifact without another AI call, with truthful zero-call metadata',async()=>{
 const h=fixture();assert.equal((await h.post()).body.execution.requests,1);
 const reused=await h.post({requestId:'12345678-1234-4123-8123-123456789abd',source:{...h.source,role:'additional'}});assert.equal(reused.status,200);assert.equal(reused.body.replayed,false);assert.deepEqual(reused.body.execution,{requests:0,cached:true});assert.equal(reused.body.result.requests,1,'original generation proof remains separate');assert.equal(h.calls.length,1);assert.equal(h.ledger.size,2);assert.ok([...h.ledger.values()].every(row=>row.status==='completed'));
 const different=await h.post({requestId:'12345678-1234-4123-8123-123456789abe',sourceLanguage:'en'});assert.equal(different.status,200);assert.equal(different.body.execution.requests,1);assert.equal(h.calls.length,2);
});
test('a different image SHA or company never borrows an earlier completed artifact; CSRF stops before claim',async()=>{
 for(const change of [h=>{h.changeBytes();h.source.sourceSha256=createHash('sha256').update(new Uint8Array([9,8,7])).digest('hex');},h=>{h.controls.company={code:'A01464742',name:'와이홉'};}]){const h=fixture();await h.post();change(h);const result=await h.post({requestId:'12345678-1234-4123-8123-123456789abd'});assert.equal(result.status,200);assert.equal(result.body.execution.requests,1);assert.equal(h.calls.length,2);}
 for(const headers of [{origin:''},{origin:'https://foreign.test'},{'sec-fetch-site':'cross-site'}]){const h=fixture();assert.notEqual((await h.post({},undefined,headers)).status,200);assert.equal(h.claims,0);assert.equal(h.calls.length,0);}
});
test('malformed or semantically unsafe completed cache fails without another inference; current source/company still fences reuse',async()=>{
 for(const corrupt of [row=>{row.result='bad JSON';},row=>{const result=JSON.parse(row.result);result.blocks[0].translated='방수 검정';row.result=JSON.stringify(result);},row=>{const result=JSON.parse(row.result);result.blocks[0].box.width=1000;row.result=JSON.stringify(result);}]){const h=fixture();await h.post();corrupt([...h.ledger.values()][0]);assert.equal((await h.post({requestId:'12345678-1234-4123-8123-123456789abd'})).status,409);assert.equal(h.calls.length,1);}
 const h=fixture();await h.post();h.controls.afterClaim=()=>{h.changeBytes();};assert.equal((await h.post({requestId:'12345678-1234-4123-8123-123456789abd'})).status,409);assert.equal(h.calls.length,1);
});
test('schema/model/truncation/coordinates/malformed text fail closed; no raw provider output leaks',()=>{
 const h=fixture();for(const mutate of [value=>{value.model='@cf/qwen/qwen3-30b-a3b-fp8';},value=>{value.choices[0].finish_reason='length';},value=>{value.choices[0].message.content='secret-token <think>reasoning</think>';},value=>{value.choices[0].message.tool_calls=[{}];},value=>{value.choices[0].message.content=JSON.stringify({blocks:[block('黑色','검정',{x:99,y:0,width:2,height:1})]});},value=>{value.response={blocks:[]};}]){
  const value=chat({blocks:[block()]});mutate(value);assert.throws(()=>h.helper.parseImageVisionResponse(value,100,80),error=>!error.message.includes('secret-token'));
 }
 assert.throws(()=>h.helper.parseImageVisionResponse(chat({blocks:[block('private https://secret.test','검정')]}),100,80));
 const truncated=chat({blocks:[block()]});truncated.choices[0].finish_reason='length';assert.throws(()=>h.helper.parseImageVisionResponse(truncated,100,80),error=>error.reason==='TRUNCATED');
});
test('documented JSON Mode object envelope works without weakening malformed choices or accepting response strings',()=>{
 const h=fixture(),value={blocks:[block()]};assert.equal(h.helper.parseImageVisionResponse({response:value},100,80).blocks[0].translated,'검정');
 const dual=chat(value);dual.response={blocks:[{box:value.blocks[0].box,translated:'검정',original:'黑色'}]};assert.equal(h.helper.parseImageVisionResponse(dual,100,80).blocks.length,1);
 for(const bad of [{response:JSON.stringify(value)},{response:value,choices:null},{response:value,finish_reason:'length'},{response:value,model:'wrong'},{response:value,error:'private'}])assert.throws(()=>h.helper.parseImageVisionResponse(bad,100,80));
});
test('unsupported numeric/claim translations stay unselected proposals with issue, not repaired or retried',async()=>{
 const h=fixture();h.controls.provider=()=>chat({blocks:[block('宽10cm','너비 12cm'),block('黑色','방수 검정',{x:10,y:35,width:30,height:15})]});const result=await h.post();assert.equal(result.status,200);assert.equal(h.calls.length,1);assert.ok(result.body.result.blocks.every(row=>row.translated===null&&row.issue));
});
test('wrong owner/company/source/config and client-injected bytes never invoke provider',async()=>{
 for(const mutate of [h=>{h.controls.owner='another';},h=>{h.controls.company={code:'WRONG',name:'wrong'};},h=>{h.changeBytes();},h=>{h.source.productVersion='2026-10-28T00:00:00.000Z';},h=>{h.env.SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED='false';}]){const h=fixture();mutate(h);assert.notEqual((await h.post()).status,200);assert.equal(h.calls.length,0);}
 const h=fixture();assert.equal((await h.post({bytes:'untrusted'})).status,400);assert.equal(h.calls.length,0);
});
test('after-claim drift consumes claim without inference; during inference drift discards result',async()=>{
 const a=fixture();a.controls.afterClaim=()=>{a.content.revision++;};assert.equal((await a.post()).status,409);assert.equal(a.calls.length,0);assert.equal([...a.ledger.values()][0].status,'failed');
 for(const mutate of [h=>{h.changeBytes();},h=>{h.controls.company={code:'A01464742',name:'와이홉'};},h=>{h.controls.owner='another';}]){const h=fixture();h.controls.provider=()=>{mutate(h);return chat({blocks:[block()]});};assert.equal((await h.post()).status,409);assert.equal(h.calls.length,1);assert.equal([...h.ledger.values()][0].status,'uncertain');}
});
test('provider timeout/rejection/abort preserve uncertain and block both UUID replay and a new UUID',async()=>{
 for(const mode of ['timeout','reject','abort']){const h=fixture({timeout:mode==='timeout'}),controller=new AbortController();h.controls.provider=()=>mode==='reject'?Promise.reject(Error('private credential')):mode==='abort'?(controller.abort(),Promise.resolve(chat({blocks:[block()]}))):new Promise(()=>{});
  const result=await h.post({},controller.signal);assert.equal(result.status,409);assert.ok(!JSON.stringify(result).includes('private credential'));assert.equal([...h.ledger.values()][0].status,'uncertain');assert.equal((await h.post()).status,409);assert.equal((await h.post({requestId:'12345678-1234-4123-8123-123456789abd'})).status,409);assert.equal(h.calls.length,1);
 }
});
test('lost claim ACK never starts inference; lost finish ACK may replay only the completed result',async()=>{
 const h=fixture();h.controls.claimAckLost=true;assert.equal((await h.post()).status,503);h.controls.claimAckLost=false;assert.equal((await h.post()).status,409);assert.equal(h.calls.length,0);
 const a=fixture();a.controls.finishAckLost=true;assert.equal((await a.post()).status,503);a.controls.finishAckLost=false;assert.equal((await a.post()).status,200);assert.equal(a.calls.length,1);
});
