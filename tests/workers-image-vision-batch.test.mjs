import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const plain=value=>JSON.parse(JSON.stringify(value)),providerRequestId='768f15b7-4fd6-4498-906e-ad94ffc7f8d2';
const source={width:100,height:80},bytes=new Uint8Array([1,2,3]),policy='product-text-preservation-v2';
const completion=()=>({model:'@cf/qwen/qwen3.8-27b',object:'chat.completion',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({decision:'foreign-text',blocks:[{original:'黑色',translated:'검정',kind:'overlay',box:{x:10,y:10,width:40,height:20}}]})}}]});
const completed=()=>({responses:[{id:0,success:true,result:completion()}],usage:{prompt_tokens:120,completion_tokens:50,total_tokens:170}});
function fixture({imageSource=source}={}){
 const calls=[],diagnostics=[],cache=new Map(),timers=new Map();let nextTimer=0,diagnosticFailure=false,reply=()=>({status:'queued',model:'@cf/qwen/qwen3.8-27b',request_id:providerRequestId});
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
   {exports,Error,Date,TextEncoder,Uint8Array,DataView,btoa,AbortController,AbortSignal,console:{warn(...args){if(diagnosticFailure)throw Error('diagnostic sink unavailable');diagnostics.push(args);}},setTimeout:(callback,ms)=>{const id=++nextTimer;timers.set(id,{callback,ms});return id;},clearTimeout:id=>timers.delete(id),require(name){
    if(name==='@/app/automation/image-edit')return{inspectImage:()=>({...imageSource,mime:'image/png'})};
    assert.ok(name.startsWith('@/'),name);return load(name.slice(2)+'.ts');
   }});return exports;
 }
 const model=load('app/automation/workers-image-vision.ts'),env={SOURCEFLOW_IMAGE_TEXT_PROVIDER:'workers-ai-vision',SOURCEFLOW_IMAGE_TEXT_MODEL:'@cf/qwen/qwen3.8-27b',SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED:'true',AI:{run(model,input,options){calls.push({model,input:plain(input),options:options&&plain(options)});return reply();}}};
 return{...model,env,calls,diagnostics,timers,failDiagnostics(){diagnosticFailure=true;},reply(value){reply=typeof value==='function'?value:()=>value;},expire(ms){for(const timer of [...timers.values()])if(timer.ms===ms)timer.callback();},submit:(signal)=>model.submitImageVisionBatch(bytes,imageSource,'zh',env,signal,policy),poll:(signal)=>model.pollImageVisionBatch(providerRequestId,imageSource,env,signal,policy)};
}

test('new queued batches request explicit normalized endpoints while the synchronous legacy input remains in original pixels',async()=>{
 const h=fixture();h.reply(completion());await h.readImageVision(bytes,source,'zh',h.env,undefined,policy);const legacy=plain(h.calls[0].input);
 h.reply({status:'queued',model:'@cf/qwen/qwen3.8-27b',request_id:providerRequestId});const result=await h.submit();
 assert.deepEqual(plain(result),{providerRequestId,status:'queued'});assert.equal(h.calls[1].model,'@cf/qwen/qwen3.8-27b');assert.deepEqual(h.calls[1].options,{queueRequest:true});assert.equal(h.calls[1].input.requests.length,1);assert.equal(h.calls.length,2);assert.equal(h.timers.size,0);
 assert.equal(legacy.stream,false);assert.equal(legacy.reasoning_effort,'low');assert.equal(legacy.response_format.type,'json_schema');
 const queued=h.calls[1].input.requests[0],schema=queued.response_format.json_schema,box=schema.properties.blocks.items.properties.box;
 assert.ok(schema.required.includes('coordinateSpace'));assert.deepEqual(schema.properties.coordinateSpace,{type:'string',enum:['normalized-1000-xyxy-v1']});assert.deepEqual(box.required,['x1','y1','x2','y2']);assert.equal(box.additionalProperties,false);for(const field of Object.values(box.properties))assert.deepEqual(field,{type:'integer',minimum:0,maximum:1000});
 assert.match(queued.messages[0].content,/x1 < x2/u);assert.match(queued.messages[0].content,/y1 < y2/u);assert.match(queued.messages[0].content,/non-overlapping/u);assert.equal(JSON.parse(queued.messages[1].content[0].text).coordinateSpace,'normalized-1000-xyxy-v1');
 for(const guidance of ['every visible glyph stroke','punctuation','antialiased edge pixels','full visible bounds','Exclude nearby icons, outlines and product markings','nominal font metrics or a partial text band']){assert.ok(queued.messages[0].content.includes(guidance),guidance);assert.ok(!legacy.messages[0].content.includes(guidance),guidance+' must remain batch-only');}
 assert.equal(JSON.parse(legacy.messages[1].content[0].text).coordinates,'integer original-image pixels; x/y top-left; width/height positive');assert.equal(legacy.response_format.json_schema.properties.coordinateSpace,undefined);assert.deepEqual(legacy.response_format.json_schema.properties.blocks.items.properties.box.required,['x','y','width','height']);
 assert.deepEqual(queued.messages[1].content[1],legacy.messages[1].content[1]);for(const key of ['reasoning_effort','max_completion_tokens','temperature','stream','tool_choice'])assert.deepEqual(queued[key],legacy[key]);
});

test('explicit normalized endpoints map outward to non-square original pixels and produce the unchanged canonical result',async()=>{
 const imageSource={width:750,height:590},h=fixture({imageSource}),data={coordinateSpace:'normalized-1000-xyxy-v1',decision:'foreign-text',blocks:[
  {original:'高含棉量',translated:'고함량 면',kind:'overlay',box:{x1:127,y1:190,x2:427,y2:238}},
  {original:'舒适',translated:'편안함',kind:'overlay',box:{x1:900,y1:980,x2:1000,y2:1000}},
 ]},before=plain(data);
 h.reply({results:[{index:0,success:true,result:{response:data}}],usage:{}});const result=await h.poll();assert.equal(result.status,'completed');assert.deepEqual(plain(result.result.blocks.map(row=>row.box)),[{x:95,y:112,width:226,height:29},{x:675,y:578,width:75,height:12}]);assert.deepEqual(data,before);
 const chat=completion();chat.choices[0].message.content=JSON.stringify(data);h.reply({results:[{index:0,success:true,result:chat}],usage:{}});assert.deepEqual(plain((await h.poll()).result),plain(result.result));
 assert.equal(result.result.coordinateSpace,undefined);assert.deepEqual(plain(h.readStoredImageVisionResult(result.result,750,590)),plain(result.result));
 for(const [box,expected]of [[{x1:0,y1:0,x2:1,y2:1},{x:0,y:0,width:1,height:1}],[{x1:999,y1:999,x2:1000,y2:1000},{x:749,y:589,width:1,height:1}]]){
  const parsed=h.parseImageVisionResponse({response:{...data,blocks:[{...data.blocks[0],box}]}},750,590,policy);assert.deepEqual(plain(parsed.blocks[0].box),expected);
 }
 const noText=h.parseImageVisionResponse({response:{coordinateSpace:data.coordinateSpace,decision:'no-foreign-text',blocks:[]}},750,590,policy);assert.equal(noText.inspection.decision,'no-foreign-text');assert.equal(noText.blocks.length,0);
 assert.ok(h.calls.every(call=>JSON.stringify(call.input)===JSON.stringify({request_id:providerRequestId})&&call.options===undefined));
});

test('normalized coordinates require the exact explicit contract and reject mixed, unbounded, fractional, reversed or overlapping endpoints',async()=>{
 const h=fixture({imageSource:{width:750,height:590}}),block={original:'中文',translated:'한국어',kind:'overlay',box:{x1:100,y1:100,x2:300,y2:200}},data={coordinateSpace:'normalized-1000-xyxy-v1',decision:'foreign-text',blocks:[block]},missing={...data};delete missing.coordinateSpace;
 const invalid=[missing,{...data,coordinateSpace:'pixels'},{...data,coordinateSpace:null},...[
  {x:10,y:10,width:40,height:20},{...block.box,x:100},{...block.box,x1:-1},{...block.box,x2:1001},{...block.box,y1:2.5},{...block.box,x1:300},{...block.box,x1:301},{...block.box,y1:201},
 ].map(box=>({...data,blocks:[{...block,box}]})),{...data,blocks:[block,{...block,original:'第二行',box:{x1:105,y1:105,x2:295,y2:195}}]}];
 for(const value of invalid){const before=plain(value);assert.throws(()=>h.parseImageVisionResponse({response:value},750,590,policy),error=>error instanceof h.ImageVisionError);assert.deepEqual(value,before);}
 const touching={...data,blocks:[block,{...block,original:'第二行',box:{x1:300,y1:100,x2:400,y2:200}}]};assert.equal(h.parseImageVisionResponse({response:touching},750,590,policy).blocks.length,2);
 const minor={...data,blocks:[block,{...block,original:'第二行',box:{x1:299,y1:199,x2:400,y2:250}}]};assert.equal(h.parseImageVisionResponse({response:minor},750,590,policy).blocks.length,2);
 const old={response:{decision:'foreign-text',blocks:[{...block,box:{x:700,y:580,width:100,height:20}}]}},before=plain(old);h.reply({results:[{index:0,success:true,result:old}]});assert.deepEqual(plain(await h.poll()),{status:'failed',failure:'COORDINATES'});assert.deepEqual(old,before);
 const legacy=h.parseImageVisionResponse(completion(),750,590,policy);assert.deepEqual(plain(legacy.blocks[0].box),{x:10,y:10,width:40,height:20});
});

test('polling queued or running jobs sends only the stored provider ID without inference input or queue admission',async()=>{
 const h=fixture();for(const status of ['queued','running'])for(const identity of [false,true]){
  h.reply({status,...(identity?{model:'@cf/qwen/qwen3.8-27b',request_id:providerRequestId}:{})});assert.deepEqual(plain(await h.poll()),{status});
 }
 assert.ok(h.calls.every(call=>JSON.stringify(call.input)===JSON.stringify({request_id:providerRequestId})&&call.options===undefined));assert.equal(h.timers.size,0);
});

test('a completed single-index batch reuses the strict Vision parser while no-text and product-marking decisions remain distinct',async()=>{
 const h=fixture();h.reply(completed());const result=await h.poll();assert.equal(result.status,'completed');assert.equal(result.result.blocks[0].translated,'검정');assert.equal(result.result.inspection.policy,policy);
 for(const decision of ['no-foreign-text','product-markings-only']){
  h.reply({responses:[{id:0,success:true,result:{response:{decision,blocks:decision==='no-foreign-text'?[]:[{original:'YOGA',translated:'YOGA',kind:'product-marking',box:{x:10,y:10,width:40,height:20}}]}}}]});
  const next=await h.poll();assert.equal(next.status,'completed');assert.equal(next.result.inspection.decision,decision);assert.equal(next.result.requests,1);
 }
 assert.ok(h.calls.every(call=>Object.keys(call.input).join(',')==='request_id'));
});

test('the observed binding results/index wrapper completes the same provider job while mixed aliases and wrong indices remain uncertain',async()=>{
 const h=fixture(),result={...completion(),service_tier:null,prompt_logprobs:null,prompt_text:null,kv_transfer_params:null,ec_transfer_params:null,metrics:null},observed={results:[{index:0,success:true,result}],usage:{prompt_tokens:120,completion_tokens:50,total_tokens:170}};
 h.reply(observed);const finished=await h.poll();assert.equal(finished.status,'completed');assert.equal(finished.result.blocks[0].translated,'검정');assert.equal(finished.result.inspection.policy,policy);
 h.reply({results:[{index:0,success:false,error:'private provider error'}],usage:{}});assert.deepEqual(plain(await h.poll()),{status:'failed',failure:'PROVIDER'});
 for(const value of [
  {...observed,responses:[{id:0,success:true,result}]},{results:[{id:0,success:true,result}]},{results:[{index:0,id:0,success:true,result}]},
  {results:[{index:1,success:true,result}]},{results:[{index:1,success:false}]},{results:[{index:0,success:true,result},{index:0,success:true,result}]},
  {responses:[{index:0,success:true,result}]},{responses:[{id:0,index:0,success:true,result}]},result,
 ]){h.reply(value);await assert.rejects(h.poll(),error=>error.reason==='ENVELOPE'&&error.uncertain);}
 assert.ok(h.calls.every(call=>JSON.stringify(call.input)===JSON.stringify({request_id:providerRequestId})&&call.options===undefined));
});

test('only a matched terminal batch member can establish provider or semantic failure',async()=>{
 const h=fixture();h.reply({responses:[{id:0,success:false,error:'private provider diagnostics'}]});assert.deepEqual(plain(await h.poll()),{status:'failed',failure:'PROVIDER'});
 const invalid=completed();invalid.responses[0].result.choices[0].finish_reason='length';h.reply(invalid);assert.deepEqual(plain(await h.poll()),{status:'failed',failure:'TRUNCATED'});
 h.reply({responses:[{id:0,success:true,result:{response:{blocks:[]}}}]});assert.deepEqual(plain(await h.poll()),{status:'failed',failure:'DECISION'});
});

test('malformed, foreign, oversized or ambiguous batch envelopes stay uncertain instead of becoming a completed or confirmed failure',async()=>{
 const h=fixture(),malformed=[null,[],{}, {status:'completed'}, {status:'failed',error:'not a documented batch result'}, {status:'running',request_id:'other'}, {status:'queued',model:'wrong-model'},
  {responses:[]},{responses:[{id:9,success:true,result:completion()}]},{responses:[{id:0,success:true}]},{responses:[{id:0,success:true,result:null}]},
  {responses:[{id:0,success:true,result:completion(),error:'contradictory provider diagnostics'}]},
  {responses:[{id:0,success:true,result:{...completion(),model:'wrong-model'}}]},{responses:[{id:0,success:true,result:completion()},{id:0,success:true,result:completion()}]},
  {...completed(),model:'wrong-model'},{...completed(),request_id:'foreign'},{...completed(),private:'x'.repeat(130*1024)}];
 for(const value of malformed){h.reply(value);await assert.rejects(h.poll(),error=>error instanceof h.ImageVisionError&&error.uncertain===true);}
 for(const value of [null,{status:'queued',request_id:providerRequestId},{status:'queued',request_id:'../foreign',model:'@cf/qwen/qwen3.8-27b'},{status:'queued',request_id:'x'.repeat(201),model:'@cf/qwen/qwen3.8-27b'},{status:'failed',request_id:providerRequestId,model:'@cf/qwen/qwen3.8-27b'}]){
  h.reply(value);await assert.rejects(h.submit(),error=>error instanceof h.ImageVisionError&&error.uncertain===true);
 }
});

test('invalid source, provider ID, configuration or pre-abort never reaches the binding',async()=>{
 const h=fixture();for(const id of ['', '../foreign','x'.repeat(201)])await assert.rejects(h.pollImageVisionBatch(id,source,h.env,undefined,policy),error=>error.reason==='INPUT'&&!error.uncertain);
 await assert.rejects(h.submitImageVisionBatch(bytes,{width:101,height:80},'zh',h.env,undefined,policy),error=>error.reason==='INPUT');
 h.env.SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED='false';await assert.rejects(h.submit(),error=>error.reason==='NOT_CONFIGURED');h.env.SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED='true';
 const signal=new AbortController();signal.abort();await assert.rejects(h.submit(signal.signal));await assert.rejects(h.poll(signal.signal));assert.equal(h.calls.length,0);
});

test('batch admission is bounded by encoded payload bytes before any provider call',async()=>{
 const h=fixture();for(const size of [7_500_000,8*1024*1024])await assert.rejects(h.submitImageVisionBatch(new Uint8Array(size),source,'zh',h.env,undefined,policy),error=>error.reason==='INPUT'&&!error.uncertain);assert.equal(h.calls.length,0);
});

test('submit timeout, abort and unknown delivery remain one uncertain admission without a retry',async()=>{
 for(const mode of ['timeout','abort','transport']){
  const h=fixture(),controller=new AbortController();let resolve;
  h.reply(()=>mode==='transport'?Promise.reject(Error('private upstream')):new Promise(yes=>{resolve=yes;}));const pending=h.submit(controller.signal);
  for(let tick=0;tick<4;tick++)await Promise.resolve();if(mode==='timeout')h.expire(60000);if(mode==='abort')controller.abort();
  await assert.rejects(pending,error=>error instanceof h.ImageVisionError&&error.uncertain===true);assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
  resolve?.({status:'queued',request_id:providerRequestId,model:'@cf/qwen/qwen3.8-27b'});await Promise.resolve();assert.equal(h.calls.length,1);
 }
});

test('poll timeout or transport failure never dispatches a replacement batch and can be observed again by the same provider ID',async()=>{
 const h=fixture();h.reply(()=>new Promise(()=>{}));const pending=h.poll();for(let tick=0;tick<4;tick++)await Promise.resolve();h.expire(20000);
 await assert.rejects(pending,error=>error.reason==='TIMEOUT'&&error.uncertain);h.reply(()=>Promise.reject(Error('private transport')));await assert.rejects(h.poll(),error=>error.reason==='PROVIDER'&&error.uncertain);
 h.reply(completed());assert.equal((await h.poll()).status,'completed');assert.ok(h.calls.every(call=>JSON.stringify(call.input)===JSON.stringify({request_id:providerRequestId})&&call.options===undefined));
});

test('rejected batch envelopes log one bounded structural diagnostic without payload text, image data, identities or unknown key names',async()=>{
 const h=fixture(),secret='private-user-secret-'.repeat(2000),value={status:'completed',model:secret,request_id:secret,response:secret,messages:[secret],
  responses:[{id:secret,success:true,result:{choices:[{message:{content:secret}}],response:secret,[secret]:secret}}],[secret]:secret};
 h.reply(value);await assert.rejects(h.poll(),error=>error.reason==='ENVELOPE'&&error.uncertain);
 assert.equal(h.diagnostics.length,1);const [tag,json]=h.diagnostics[0];assert.equal(tag,'IMAGE_VISION_BATCH_SHAPE');assert.equal(typeof json,'string');assert.ok(json.length<=2048);assert.ok(!json.includes('private-user-secret'));assert.ok(!json.includes(providerRequestId));
 const summary=JSON.parse(json);assert.equal(summary.reason,'ENVELOPE');assert.equal(summary.value.type,'object');assert.equal(summary.value.constructor,'Object');assert.equal(summary.status,'completed');assert.equal(summary.responsesCount,1);
 assert.ok(summary.value.keys.includes('responses'));assert.equal(summary.value.unknownKeys,1);assert.equal(summary.entry.idType,'string');assert.equal(summary.entry.result.type,'object');assert.ok(summary.entry.result.keys.includes('choices'));assert.equal(summary.entry.result.unknownKeys,1);
 h.reply({status:'running',model:'wrong-private-model'});await assert.rejects(h.poll(),error=>error.reason==='MODEL'&&error.uncertain);assert.equal(JSON.parse(h.diagnostics[1][1]).reason,'MODEL');assert.ok(!h.diagnostics[1][1].includes('wrong-private-model'));
});

test('stream-shaped envelopes remain uncertain and diagnostics never consume the stream or change failure when logging is unavailable',async()=>{
 const h=fixture();let reads=0;class ReadableStream{getReader(){reads++;throw Error('must not consume provider payload');}}
 h.reply(new ReadableStream());await assert.rejects(h.poll(),error=>error.reason==='ENVELOPE'&&error.uncertain);const summary=JSON.parse(h.diagnostics[0][1]);assert.equal(summary.value.constructor,'ReadableStream');assert.equal(summary.getReader,true);assert.equal(reads,0);
 h.failDiagnostics();await assert.rejects(h.poll(),error=>error.reason==='ENVELOPE'&&error.uncertain);assert.equal(reads,0);
 h.reply(completed());assert.equal((await h.poll()).status,'completed');assert.equal(h.diagnostics.length,1);
});

test('batch diagnostics identify output wrappers and JSON-text structure without logging generated values or accepting an unknown result',async()=>{
 const h=fixture(),secret='never-log-generated-text',payload={output:JSON.stringify({choices:[{message:{content:secret}}],decision:secret,blocks:[],[secret]:secret}),usage:{total_tokens:19}};
 h.reply(payload);await assert.rejects(h.poll(),error=>error.reason==='ENVELOPE'&&error.uncertain);const json=h.diagnostics[0][1],summary=JSON.parse(json);assert.ok(!json.includes(secret));assert.ok(json.length<=2048);
 assert.deepEqual(summary.value.keys,['output','usage']);assert.equal(summary.value.unknownKeys,0);assert.equal(summary.payloads.output.type,'string');assert.equal(summary.payloads.output.stringLength,payload.output.length);assert.deepEqual(summary.payloads.output.json.keys,['blocks','choices','decision']);assert.equal(summary.payloads.output.json.unknownKeys,1);
 h.reply({response:secret,result:{choices:[]},data:{object:secret,id:secret,created:17},results:[secret],usage:{}});await assert.rejects(h.poll());const more=h.diagnostics[1][1],next=JSON.parse(more);assert.ok(!more.includes(secret));assert.equal(next.payloads.response.type,'string');assert.equal(next.payloads.response.json,null);assert.deepEqual(next.payloads.result.keys,['choices']);assert.deepEqual(next.payloads.data.keys,['created','id','object']);assert.equal(next.payloads.results.type,'array');
 h.reply({outputs:[{id:secret,result:{response:JSON.stringify({decision:secret,blocks:[]})}}],usage:{}});await assert.rejects(h.poll());const arrayJson=h.diagnostics[2][1],array=JSON.parse(arrayJson);assert.ok(!arrayJson.includes(secret));assert.deepEqual(array.value.keys,['outputs','usage']);assert.equal(array.payloads.outputs.arrayLength,1);assert.equal(array.payloads.outputs.first.idType,'string');assert.deepEqual(array.payloads.outputs.first.keys,['id','result']);assert.equal(array.payloads.outputs.first.result.response.type,'string');assert.deepEqual(array.payloads.outputs.first.result.response.json.keys,['blocks','decision']);
 h.reply({usage:{},generated_text:secret,traceData:{private:secret},apiToken:secret,password:secret,'user@example.test':secret,...Object.fromEntries(Array.from({length:12},(_,index)=>['extraField'+index,secret]))});await assert.rejects(h.poll());const unknownJson=h.diagnostics[3][1],unknown=JSON.parse(unknownJson);assert.ok(!unknownJson.includes(secret));assert.ok(!/apiToken|password|user@example/u.test(unknownJson));assert.equal(unknown.value.unknownFields.length,8);assert.ok(unknown.value.unknownFields.some(field=>field.name==='generated_text'&&field.type==='string'));assert.ok(unknown.value.unknownFields.some(field=>field.name==='traceData'&&field.type==='object'));
});
