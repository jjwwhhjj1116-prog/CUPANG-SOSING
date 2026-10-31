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
const deferred=()=>{let resolve,reject;return{promise:new Promise((yes,no)=>{resolve=yes;reject=no;}),resolve:value=>resolve(value),reject:error=>reject(error)};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
 const calls=[],ledger=new Map(),cache=new Map(),background=[],events=[];let bytes=new Uint8Array([1,2,3]),claims=0,reads=0;
 const controls={owner:'owner',company:{...company},verified:true,provider:null,afterClaim:null,afterFinish:null,afterRead:null,claimAckLost:false,finishAckLost:false,finishBeforeCommitFailure:false};
 const product={id:'new-product',owner_id:'owner',updated_at:'2026-10-29T00:00:00.000Z',image_keys:'["owner/source.png"]'},content={revision:2,assets:{detail:{value:['owner/source.png']},additional:{value:['owner/source.png']},main:{value:['owner/source.png']}}};
 const env={SOURCEFLOW_IMAGE_TEXT_PROVIDER:'workers-ai-vision',SOURCEFLOW_IMAGE_TEXT_MODEL:'@cf/qwen/qwen3.8-27b',SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED:'true',AI:{async run(model,input,runOptions){calls.push({model,input:plain(input),options:runOptions&&plain(runOptions)});return controls.provider?controls.provider(model,input):chat({blocks:[block()]});}},FILES:{async get(){return{size:bytes.length,body:new Response(bytes).body};},put(){throw Error('No image writes');}},...options.env};
 const notUsed=class extends Error{};
 const stubs={'cloudflare:workers':{env,...(options.background?{waitUntil(task){if(options.background==='throw')throw Error('background unavailable');background.push(task);}}:{})},'next/server':{NextResponse:Response},parse5,
  '@/app/chatgpt-auth':{getChatGPTUser:async()=>({userId:controls.owner,email:'fixture@example.test',verifiedAccess:controls.verified,membership:{id:controls.owner,email:'fixture@example.test',role:'admin',status:'approved',companyCode:controls.company.code,companyName:controls.company.name}}),getWorkspaceOwnerId:async()=>controls.owner},
  '@/db/queries':{findProduct:async(owner,id)=>owner==='owner'&&id==='new-product'?product:null},'@/db/product-content':{readProductContent:async()=>content},'@/db/product-options':{},'@/db/product-attachments':{},'@/db/product-image-translation':{},'@/db/quotation-fields':{},
  '@/app/quotation-fields-snapshot':{QuotationFieldsSnapshotError:notUsed},'@/app/quotation-seo-targets':{},'@/app/quotation-image-targets':{},'@/app/quotation-schema':{},'@/app/quotation-public-detail':{PublicDetailError:notUsed},
  '@/app/product-content':{productImageKeys:JSON.parse},'@/app/automation/image-edit':{inspectImage:()=>({width:100,height:80,mime:'image/png'})},
  '@/app/image-files':{MAX_IMAGE_BYTES:10*1024*1024,MAX_IMAGE_MULTIPART_BYTES:11*1024*1024,PRODUCT_IMAGE_POOL_LIMIT:200,isOwnedImageKey:(owner,key)=>key.startsWith(owner+'/')},
  '@/app/free-image-edit-document':{MAX_FREE_IMAGE_EDIT_BYTES:65536},'@/app/free-image-edit-record':{FreeImageEditRecordError:notUsed},
  '@/db/image-vision-requests':{
   async readImageVisionRequest(scope){reads++;const row=ledger.get(scope.requestId),matched=row&&row.scope.owner===scope.owner&&row.scope.productId===scope.productId&&row.scope.fingerprint===scope.fingerprint&&row.scope.sourceScope===scope.sourceScope&&row.scope.model===scope.model&&JSON.stringify(row.scope.company)===JSON.stringify(scope.company);await controls.afterRead?.();return matched?row:null;},
   async claimImageVisionRequest(scope){claims++;let row=ledger.get(scope.requestId);if(row)return{claimed:false,record:row};if([...ledger.values()].some(row=>[scope.sourceScope,scope.legacySourceScope].includes(row.scope.sourceScope)&&['running','uncertain'].includes(row.status)))return{claimed:false,record:null};row={scope:plain(scope),status:'running',request_fingerprint:scope.fingerprint,result:null,failure:null};ledger.set(scope.requestId,row);await controls.afterClaim?.();if(controls.claimAckLost)throw Error('lost claim acknowledgement');return{claimed:true,record:row};},
   async finishImageVisionRequest(scope,value){const row=ledger.get(scope.requestId);if(row.status!=='running')throw Error('CAS');if(controls.finishBeforeCommitFailure)throw Error('before commit');Object.assign(row,value,{result:value.result?JSON.stringify(value.result):null,provider_requests:value.requests});events.push('finish:'+value.status);await controls.afterFinish?.();if(controls.finishAckLost)throw Error('lost finish acknowledgement');},
   async finishLateImageVisionRequest(scope,value){const row=ledger.get(scope.requestId);if(!row||!['running','uncertain'].includes(row.status)||row.scope.fingerprint!==scope.fingerprint||row.scope.sourceScope!==scope.sourceScope||scope.owner!==controls.owner||JSON.stringify(scope.company)!==JSON.stringify(controls.company)||!controls.verified)return false;Object.assign(row,value,{result:value.result?JSON.stringify(value.result):null,provider_requests:1});events.push('late:'+value.status);return true;},
   async completedImageVisionResult(scope){return[...ledger.values()].find(row=>row.status==='completed'&&row.scope.requestId!==scope.requestId&&row.scope.owner===scope.owner&&row.scope.productId===scope.productId&&row.scope.model===scope.model&&row.scope.sourceScope===scope.sourceScope&&JSON.stringify(row.scope.company)===JSON.stringify(scope.company))??null;},
  },'@/db/image-no-text-receipts':{async readImageNoTextReceipts(owner,products){const output={};for(const row of ledger.values()){const result=row.result&&JSON.parse(row.result),s=row.scope;if(row.status==='completed'&&s.inspection&&result.inspection?.decision==='no-foreign-text'&&owner===s.owner&&products.some(product=>product.id===s.productId))output[s.productId]=[{policy:'foreign-text-inspection-v1',productId:s.productId,requestId:s.requestId,verifiedAt:'2026-10-30T00:00:00.000Z',...s.inspection}];}return output;}}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,Error,URL,URLSearchParams,Request,Response,File,Blob,FormData,Headers,TextEncoder,TextDecoder,ReadableStream,Uint8Array,DataView,AbortController,AbortSignal,Date,crypto:webcrypto,btoa:value=>Buffer.from(value,'binary').toString('base64'),process:{env:{NODE_ENV:'production'}},
   setTimeout:(fn,ms)=>options.timeout&&ms===60000?(queueMicrotask(fn),1):setTimeout(fn,ms),clearTimeout,fetch:()=>{throw Error('No external HTTP');},require(name){if(name in stubs)return stubs[name];if(name.startsWith('@/app/'))return load(name.slice(2)+'.ts');throw Error('Unexpected dependency '+name);}}, {filename:file});return exports;}
 const source={productId:product.id,productVersion:product.updated_at,contentRevision:2,sourceKey:'owner/source.png',sourceSha256:createHash('sha256').update(bytes).digest('hex'),role:'detail',width:100,height:80};
 const helper=load('app/automation/workers-image-vision.ts'),contract=load('app/image-text-vision.ts'),route=load('app/api/products/[id]/image-text/route.ts');
 return{calls,ledger,controls,source,env,helper,contract,content,product,background,events,get claims(){return claims;},get reads(){return reads;},changeBytes(){bytes=new Uint8Array([9,8,7]);},
  async sourceGet(){const response=await route.GET(new Request('https://app.test/api/products/new-product/image-text?sourceKey=owner%2Fsource.png&role=detail'),{params:Promise.resolve({id:'new-product'})});return{status:response.status,body:await response.json()};},
  async status(overrides={},headers={}){const params=new URLSearchParams({visionRequestId:'12345678-1234-4123-8123-123456789abc',source:JSON.stringify(source),sourceLanguage:'zh',...overrides});const response=await route.GET(new Request('https://app.test/api/products/new-product/image-text?'+params,{headers}),{params:Promise.resolve({id:'new-product'})});return{status:response.status,body:await response.json()};},
  async post(overrides={},signal,headers={}){const body={action:'vision',source:plain(source),sourceLanguage:'zh',configuration:helper.imageVisionConfiguration(env),requestId:'12345678-1234-4123-8123-123456789abc',...overrides};const response=await route.POST(new Request('https://app.test/api/products/new-product/image-text',{method:'POST',headers:{'content-type':'application/json',origin:'https://app.test',...headers},body:JSON.stringify(body),signal}),{params:Promise.resolve({id:'new-product'})});return{status:response.status,body:await response.json()};},load};
}
test('owned bytes use exact Vision model, low reasoning, schema and one request, completed UUID replays without writes',async()=>{
 const h=fixture(),before=JSON.stringify([h.source,h.product,h.content]);const result=await h.post();assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(h.calls.length,1);assert.equal(result.body.result.blocks[0].translated,'검정');
 const call=h.calls[0];assert.equal(call.model,'@cf/qwen/qwen3.8-27b');assert.equal(call.input.reasoning_effort,'low');assert.equal(call.input.max_completion_tokens,4096);assert.equal(call.input.stream,false);assert.equal(call.input.tool_choice,'none');assert.equal(call.input.response_format.type,'json_schema');
 assert.deepEqual(call.options,{rejectIfBusy:true});assert.equal(Object.hasOwn(call.input,'rejectIfBusy'),false);
 assert.equal(call.input.messages[1].content[1].image_url.url,'data:image/png;base64,AQID');assert.ok(!JSON.stringify(call.input).includes('owner/source.png'));assert.equal(JSON.stringify([h.source,h.product,h.content]),before);
  assert.equal((await h.post()).body.replayed,true);assert.equal(h.calls.length,1);
});

test('only exact documented capacity rejections return 429 with a confirmed failure and one binding attempt',async()=>{
 const message='Capacity temporarily exceeded, please try again.';
 for(const error of [{code:3040,message},{code:3040,message,status:429},{message:'3040: '+message,statusCode:429},{message:'AI_ERROR: 3040: '+message}]){
  const h=fixture({background:true}),before=JSON.stringify([h.product,h.content]);h.controls.provider=()=>Promise.reject(error);
  const response=await h.post();assert.equal(response.status,429);assert.equal(response.body.code,'IMAGE_VISION_CAPACITY');assert.equal(response.body.uncertain,false);
  const row=[...h.ledger.values()][0];assert.equal(row.status,'failed');assert.equal(row.failure,'CAPACITY');assert.equal(row.provider_requests,1);assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].options,{rejectIfBusy:true});assert.equal(h.background.length,0);
  assert.equal((await h.post()).status,409);assert.equal(h.calls.length,1,'the original failed UUID is not dispatched again');assert.equal(JSON.stringify([h.product,h.content]),before);
 }
});

test('general 429, contradictory codes, inherited/accessor details and near capacity messages remain uncertain',async()=>{
 const message='Capacity temporarily exceeded, please try again.';let getterReads=0;
 const errors=[{status:429,message},{code:'3040',message},{code:3041,message:'3040: '+message},{code:3040,status:503,message},{code:3040,status:429,statusCode:503,message},
  {code:3040,message:message+' '},{code:3040,message:'private prefix: '+message},{message:'AI_ERROR: 3040: '+message+' retry now'},Object.create({code:3040,message}),
  Object.assign(Object.create({status:503}),{code:3040,message}),Object.assign(Object.create({code:3041}),{message:'3040: '+message}),Object.assign(Object.create({statusCode:429}),{code:3040,message}),
  Object.defineProperty({message},'code',{get(){getterReads++;return 3040;}})];
 for(const error of errors){const h=fixture({background:true});h.controls.provider=()=>Promise.reject(error);const response=await h.post();assert.equal(response.status,409);assert.equal(response.body.code,'IMAGE_VISION_PROVIDER');assert.equal(response.body.uncertain,true);assert.equal(h.calls.length,1);assert.equal([...h.ledger.values()][0].status,'uncertain');assert.equal(h.background.length,0);assert.equal((await h.post()).status,409);assert.equal(h.calls.length,1);}
 assert.equal(getterReads,0);
});

test('original Vision status reads never claim or infer, including missing, uncertain and completed original requests',async()=>{
 const empty=fixture(),first=await empty.status();assert.equal(first.status,200);assert.equal(first.body.status,'not-found');assert.equal(first.body.readOnly,true);assert.equal(first.body.execution.requests,0);assert.equal(empty.claims,0);assert.equal(empty.calls.length,0);assert.equal(empty.ledger.size,0);
 const pending=fixture({timeout:true});pending.controls.provider=()=>new Promise(()=>{});assert.equal((await pending.post()).body.uncertain,true);const before=JSON.stringify([...pending.ledger]);const observed=await pending.status();assert.equal(observed.status,200,JSON.stringify(observed.body));assert.equal(observed.body.status,'uncertain');assert.equal(observed.body.failure,'TIMEOUT');assert.equal(observed.body.result,null);assert.equal(pending.claims,1);assert.equal(pending.calls.length,1);assert.equal(JSON.stringify([...pending.ledger]),before);
 const done=fixture();await done.post();const completed=await done.status();assert.equal(completed.status,200);assert.equal(completed.body.status,'completed');assert.equal(completed.body.result.blocks[0].translated,'검정');assert.equal(completed.body.execution.requests,0);assert.equal(done.claims,1);assert.equal(done.calls.length,1);
});

test('Vision status scope, source, configuration and approved company are exact; historical observation does not mutate products',async()=>{
 const h=fixture();await h.post();const before=JSON.stringify([...h.ledger]);
 for(const overrides of [{visionRequestId:'12345678-1234-4123-8123-123456789abd'},{source:JSON.stringify({...h.source,sourceSha256:'b'.repeat(64)})},{sourceLanguage:'en'},{source:JSON.stringify({...h.source,role:'additional'})}]){const r=await h.status(overrides);assert.equal(r.status,200);assert.equal(r.body.status,'not-found');}
 assert.equal((await h.status({source:JSON.stringify({...h.source,sourceKey:'other/private.png'})})).status,400);assert.equal((await h.status({unknown:'x'})).status,400);assert.equal((await h.status({}, {'sec-fetch-site':'cross-site'})).status,400);
 h.product.updated_at='2026-10-30T00:00:00.000Z';assert.equal((await h.status()).body.status,'completed','read-only original status does not rewrite a newer saved product');
 h.controls.company={code:'A01464742',name:'와이홉'};assert.equal((await h.status()).body.status,'not-found');h.controls.company={...company};h.controls.afterRead=()=>{h.controls.company={code:'A01464742',name:'와이홉'};};assert.equal((await h.status()).status,409);
 assert.equal(h.claims,1);assert.equal(h.calls.length,1);assert.equal(JSON.stringify([...h.ledger]),before);
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

test('late valid response finishes the same uncertain claim before status read and UUID replay with no second AI call',async()=>{
 const h=fixture({timeout:true,background:true}),provider=deferred();h.controls.provider=()=>provider.promise;
 const before=JSON.stringify([h.source,h.product,h.content]),timed=await h.post();assert.equal(timed.status,409);assert.equal(timed.body.code,'IMAGE_VISION_TIMEOUT');assert.deepEqual(Object.keys(timed.body).sort(),['code','error','uncertain']);assert.equal(h.background.length,1);assert.equal([...h.ledger.values()][0].status,'uncertain');
 provider.resolve(chat({blocks:[block()]}));await Promise.all(h.background);assert.deepEqual(h.events,['finish:uncertain','late:completed']);assert.equal(h.ledger.size,1);assert.equal(h.claims,1);assert.equal(h.calls.length,1);assert.equal([...h.ledger.values()][0].provider_requests,1);
 const status=await h.status();assert.equal(status.body.status,'completed');assert.equal(status.body.execution.requests,0);assert.equal(status.body.result.blocks[0].translated,'검정');
 const replay=await h.post();assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.execution.requests,0);assert.equal(h.calls.length,1);assert.equal(JSON.stringify([h.source,h.product,h.content]),before);
});

test('late semantic rejection is a confirmed failure, late transport rejection remains uncertain, and unavailable background never writes',async()=>{
 for(const mode of ['semantic','transport','missing-background','throw-background']){
  const h=fixture({timeout:true,...(mode==='missing-background'?{}:{background:mode==='throw-background'?'throw':true})}),provider=deferred();h.controls.provider=()=>provider.promise;await h.post();
  if(mode==='transport')provider.reject(Error('private upstream detail'));else provider.resolve(mode==='semantic'?chat({invalid:'not blocks'}):chat({blocks:[block()]}));
  await Promise.all(h.background);await tick();const row=[...h.ledger.values()][0];assert.equal(row.status,mode==='semantic'?'failed':'uncertain',mode);assert.equal(h.calls.length,1);assert.equal(h.claims,1);assert.equal(h.ledger.size,1);assert.equal(h.events.filter(event=>event.startsWith('late:')).length,mode==='semantic'?1:0,mode);
  assert.ok(!JSON.stringify(await h.status()).includes('private upstream detail'));
 }
});

test('late observation respects member/company boundaries and cannot overwrite a terminal record; foreground ACK loss is safe',async()=>{
 for(const mode of ['company','owner','terminal','lost-ack','pre-commit-loss']){
  const h=fixture({timeout:true,background:true}),provider=deferred();h.controls.provider=()=>provider.promise;if(mode==='lost-ack')h.controls.finishAckLost=true;if(mode==='pre-commit-loss')h.controls.finishBeforeCommitFailure=true;
  await h.post();const row=[...h.ledger.values()][0];if(mode==='company')h.controls.company={code:'A01464742',name:'와이홉'};if(mode==='owner')h.controls.owner='other';if(mode==='terminal'){row.status='failed';row.failure='BLOCKS';}
  provider.resolve(chat({blocks:[block()]}));await Promise.all(h.background);assert.equal(row.status,['lost-ack','pre-commit-loss'].includes(mode)?'completed':mode==='terminal'?'failed':'uncertain',mode);assert.equal(h.claims,1);assert.equal(h.calls.length,1);assert.equal(h.ledger.size,1);if(mode==='terminal')assert.equal(row.failure,'BLOCKS');
 }
});

test('a synchronously throwing provider binding is one uncertain invocation and cannot bypass the original claim fence',async()=>{
 const h=fixture({background:true});h.env.AI.run=(model,input)=>{h.calls.push({model,input:plain(input)});throw Error('private sync binding failure');};
 const first=await h.post();assert.equal(first.status,409);assert.equal(first.body.code,'IMAGE_VISION_PROVIDER');assert.equal(first.body.uncertain,true);assert.equal(h.calls.length,1);assert.equal([...h.ledger.values()][0].status,'uncertain');assert.equal(h.background.length,0);assert.ok(!JSON.stringify(first).includes('private sync binding failure'));
 assert.equal((await h.post()).status,409);assert.equal(h.calls.length,1);
});

test('inspection version separates new provider schema and cache identity while legacy request/status remain recoverable',async()=>{
 const h=fixture(),before=JSON.stringify([h.product,h.content]);h.controls.provider=()=>chat({blocks:[]});const legacy=await h.post();assert.equal(legacy.status,200);assert.equal(legacy.body.result.inspection,undefined);const old=[...h.ledger.values()][0].scope;
 h.controls.provider=()=>chat({decision:'no-foreign-text',blocks:[]});const requestId='12345678-1234-4123-8123-123456789abd',inspectionPolicy=h.contract.IMAGE_TEXT_INSPECTION_POLICY;
 const fresh=await h.post({requestId,inspectionPolicy});assert.equal(fresh.status,200,JSON.stringify(fresh.body));assert.equal(h.calls.length,2,'legacy empty cache is never a no-op proof');assert.equal(fresh.body.result.inspection.decision,'no-foreign-text');
 const next=h.ledger.get(requestId).scope;assert.notEqual(next.fingerprint,old.fingerprint);assert.notEqual(next.sourceScope,old.sourceScope);assert.equal(next.legacySourceScope,old.sourceScope);assert.deepEqual(h.calls[1].input.response_format.json_schema.required,['blocks','decision']);assert.match(h.calls[1].input.messages[0].content,/unreadable/);
 assert.equal((await h.status()).body.result.inspection,undefined,'old status lookup keeps exact old identity');assert.equal((await h.status({visionRequestId:requestId,inspectionPolicy})).body.result.inspection.decision,'no-foreign-text');assert.equal((await h.status({visionRequestId:requestId})).body.status,'not-found','policy cannot be dropped during recovery');
 const source=await h.sourceGet();assert.equal(source.status,200,JSON.stringify(source.body));assert.equal(source.body.noTextProof.sourceSha256,h.source.sourceSha256);h.changeBytes();assert.equal((await h.sourceGet()).body.noTextProof,undefined,'same key changed bytes invalidates receipt before any new inference');assert.equal(h.calls.length,2);assert.equal(JSON.stringify([h.product,h.content]),before);
});
test('legacy and versioned running or uncertain inference fence each other; new contract missing decision is rejected',async()=>{
 for(const versioned of [false,true]){const h=fixture({timeout:true}),inspectionPolicy=h.contract.IMAGE_TEXT_INSPECTION_POLICY;h.controls.provider=()=>new Promise(()=>{});assert.equal((await h.post(versioned?{inspectionPolicy}:{})).body.uncertain,true);
  const next=await h.post({requestId:'12345678-1234-4123-8123-123456789abd',...(versioned?{}:{inspectionPolicy})});assert.equal(next.status,409);assert.equal(h.calls.length,1);assert.equal(h.ledger.size,1);
 }
 const h=fixture();h.controls.provider=()=>chat({blocks:[]});const failed=await h.post({inspectionPolicy:h.contract.IMAGE_TEXT_INSPECTION_POLICY});assert.equal(failed.status,409);assert.equal(failed.body.code,'IMAGE_VISION_BLOCKS');assert.equal([...h.ledger.values()][0].status,'failed');assert.equal(h.calls.length,1);
});
