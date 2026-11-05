import test from 'node:test';
import assert from 'node:assert/strict';
import {imageVisionBatchFixture,batchRequestId,batchNextRequestId,providerRequestId,completedVisionBatch} from './fixtures/image-vision-batch-fixture.mjs';

test('saved BODY style is immutable server-verified data and a changed style cannot borrow an old result or bypass its pending job',async()=>{
 const h=imageVisionBatchFixture();try{
  const contract=h.load('app/image-text-vision.ts');h.controls.settings={addCopyright:true,translationPrompt:'짧고 자연스러운 한국어'};
  const textStyle=await contract.createImageTextStyle(h.controls.settings),created=await h.create({textStyle});
  assert.equal(created.status,202,JSON.stringify(created.body));assert.deepEqual(created.body.attempt.textStyle,JSON.parse(JSON.stringify(textStyle)));
  assert.deepEqual(JSON.parse(h.calls[0].input.requests[0].messages[1].content[0].text).textStyle,JSON.parse(JSON.stringify(textStyle)));
  h.controls.settings.translationPrompt='다른 표현';const nextStyle=await contract.createImageTextStyle(h.controls.settings),before=JSON.stringify(h.sqlite.prepare('SELECT * FROM image_vision_requests').all());
  const denied=await h.create({requestId:batchNextRequestId,textStyle:nextStyle});assert.equal(denied.status,409);assert.equal(h.calls.length,1);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM image_vision_requests').all()),before);
  const original=await h.read();assert.equal(original.body.attempt.textStyle.fingerprint,textStyle.fingerprint,'historical descriptor survives current setting changes');
  h.controls.provider=()=>completedVisionBatch();await h.poll();const next=await h.create({requestId:batchNextRequestId,textStyle:nextStyle});assert.equal(next.status,202);assert.equal(next.body.execution.requests,1,'different style does not reuse old completed Korean');
  assert.equal(h.calls.filter(call=>call.options?.queueRequest).length,2);
 }finally{h.close();}
});

test('a forged, stale or cleanup text style stops before provider admission',async()=>{
 for(const kind of ['hash','guidance','main']){const h=imageVisionBatchFixture();try{
  const textStyle=await h.load('app/image-text-vision.ts').createImageTextStyle(h.controls.settings);
  if(kind==='hash')textStyle.fingerprint='f'.repeat(64);if(kind==='guidance')textStyle.guidance='other';if(kind==='main')h.source.role='main';
  const response=await h.create({textStyle});assert.equal(response.status,409,JSON.stringify(response.body));assert.equal(h.calls.length,0);assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='image_vision_requests'").get().n,0);
 }finally{h.close();}}
});

test('a style change before admission is confirmed unsent instead of stranding the batch client behind a nonexistent UUID',async()=>{
 const h=imageVisionBatchFixture();try{
  const client=h.load('app/image-vision-batch-client.ts'),textStyle=await h.load('app/image-text-vision.ts').createImageTextStyle(h.controls.settings);
  const image={source:h.source,visionConfiguration:h.configuration(),visionTextStyle:textStyle,visionTransport:'workers-ai-batch-v1',visionFetcher:async(url,init)=>{
   if(init.method==='POST')h.controls.settings.translationPrompt='설정 변경';return h.fetcher(url,init);
  }};
  await assert.rejects(client.runImageVisionBatch(image,'zh',new AbortController().signal,()=>{}),cause=>cause.code==='IMAGE_VISION_NOT_ADMITTED'&&cause.uncertain===false);
  assert.equal(image.visionRequestId,undefined);assert.equal(image.visionPending,undefined);assert.equal(h.calls.length,0);
 }finally{h.close();}
});

test('batch submission stores exact original attempt and provider job before 202; reload GET and discovery are pure D1 reads',async()=>{
 const h=imageVisionBatchFixture();try{
  const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all()),created=await h.create();
  assert.equal(created.status,202,JSON.stringify(created.body));assert.equal(created.body.format,'yoofam-image-vision-batch-v1');assert.equal(created.body.status,'running');assert.deepEqual(created.body.execution,{requests:1});
  assert.equal(created.body.attempt.requestId,batchRequestId);assert.deepEqual(created.body.attempt.source,h.source);
  const original=JSON.stringify(h.sqlite.prepare('SELECT * FROM image_vision_batches').all());assert.equal(h.calls.length,1);
  h.sqlite.exec("UPDATE products SET updated_at='2026-10-30T00:00:00.000Z';UPDATE product_content SET revision=3");h.reload();
  const mutationStart=h.queries.length;
  for(const read of [await h.read(),await h.discover()]){assert.equal(read.status,200,JSON.stringify(read.body));assert.equal(read.body.status,'running');assert.deepEqual(read.body.attempt,created.body.attempt);assert.deepEqual(read.body.execution,{requests:0});assert.equal(read.body.readOnly,true);}
  assert.ok(h.queries.slice(mutationStart).every(sql=>/^SELECT\b/i.test(sql)),h.queries.slice(mutationStart));assert.equal(h.calls.length,1);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM image_vision_batches').all()),original);
  assert.equal(h.sqlite.prepare('SELECT image_keys FROM products').get().image_keys,JSON.parse(before)[0].image_keys);
 }finally{h.close();}
});

test('empty batch discovery and by UUID read do not initialize storage or infer',async()=>{
 const h=imageVisionBatchFixture();try{for(const value of [await h.discover(),await h.read()]){assert.equal(value.status,200);assert.equal(value.body.status,'not-found');assert.equal(value.body.attempt,null);assert.equal(value.body.readOnly,true);assert.equal(value.body.execution.requests,0);}assert.equal(h.calls.length,0);assert.ok(h.queries.every(sql=>/^SELECT\b/i.test(sql)));assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='image_vision_batches'").get().n,0);}finally{h.close();}
});

test('real batch client and server agree on submission descriptor and reload discovery never submits a replacement',async()=>{
 for(const reload of [false,true]){
  const h=imageVisionBatchFixture();try{
   let original=null;if(reload){original=(await h.create()).body.attempt;h.reload();}
   h.controls.provider=(_model,input)=>input.request_id?completedVisionBatch():{request_id:providerRequestId,model:h.configuration().model,status:'queued'};
   const client=h.load('app/image-vision-batch-client.ts'),image={source:h.source,visionConfiguration:h.configuration(),visionTransport:'workers-ai-batch-v1',visionFetcher:h.fetcher};
   const result=await client.runImageVisionBatch(image,'zh',new AbortController().signal,()=>{});
   assert.equal(result.result.blocks[0].translated,'검정');assert.equal(result.requests,reload?0:1);if(original)assert.deepEqual(JSON.parse(JSON.stringify(result.attempt)),original);
   assert.equal(h.calls.filter(call=>call.options?.queueRequest===true).length,1);assert.equal(h.calls.length,2);assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM image_vision_requests').get().n,1);
  }finally{h.close();}
 }
});

test('source-read transport flag routes recognizeFreeImage through the real batch server and returns safe generated OCR regions',async()=>{
 const h=imageVisionBatchFixture();try{
  const client=h.load('app/free-image-translation-client.ts'),signal=new AbortController().signal;
  const proof=await client.readFreeImageSourceProof(h.source.productId,h.source.productVersion,h.source.sourceKey,'detail',signal,h.fetcher);assert.equal(proof.visionTransport,'workers-ai-batch-v1');
  h.controls.provider=(_model,input)=>input.request_id?completedVisionBatch():{request_id:providerRequestId,model:h.configuration().model,status:'queued'};
  const context={font:'12px Arial',measureText(text){return{width:Array.from(text).length*Number(/([0-9.]+)px/u.exec(this.font)?.[1]??12)*0.5};},getImageData(_x,_y,width,height){return{data:new Uint8ClampedArray(width*height*4).fill(255),width,height};}};
  const image={...proof,canvas:{getContext:()=>context},blob:new Blob(['original']),width:100,height:80};
  const regions=await client.recognizeFreeImage(image,'zh',signal);
  assert.equal(regions.length,1);assert.equal(regions[0].text,'黑色');assert.equal(regions[0].translated,'검정');assert.equal(regions[0].translationProvenance,'generated');assert.equal(regions[0].selected,true);assert.equal(regions[0].issue,null);assert.ok(regions[0].fontSize>=8);assert.deepEqual(JSON.parse(JSON.stringify(image.visionExecution)),{requests:1,cached:false});
  assert.equal(h.calls.length,2);assert.equal(h.calls[0].options.queueRequest,true);assert.deepEqual(h.calls[1].input,{request_id:providerRequestId});assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM image_vision_requests').get().n,1);
 }finally{h.close();}
});

test('a duplicate admitted UUID before descriptor persistence reports uncertainty and never starts a second submission',async()=>{
 const h=imageVisionBatchFixture();let release;try{
  let enter;const entered=new Promise(resolve=>{enter=resolve;}),hold=new Promise(resolve=>{release=resolve;});
  h.controls.beforeRead=async sql=>{if(/^INSERT INTO image_vision_batches\(/.test(sql)){h.controls.beforeRead=null;enter();await hold;}};
  const first=h.create();await entered;const duplicate=await h.create();assert.equal(duplicate.status,409);assert.equal(duplicate.body.code,'IMAGE_VISION_ACK_MISSING');assert.equal(duplicate.body.uncertain,true);assert.equal(h.calls.length,0);release();assert.equal((await first).status,202);assert.equal(h.calls.length,1);
 }finally{release?.();h.close();}
});

test('descriptor exists before the only provider submit and the acknowledged provider ID is durable before reply',async()=>{
 const h=imageVisionBatchFixture();try{
  h.controls.provider=()=>{const row=h.sqlite.prepare('SELECT * FROM image_vision_batches').get(),claim=h.sqlite.prepare('SELECT * FROM image_vision_requests').get();assert.equal(JSON.parse(row.attempt).transport,'workers-ai-batch-v1');assert.equal(row.provider_request_id,null);assert.equal(claim.status,'running');assert.equal(claim.provider_requests,null);return{request_id:providerRequestId,model:h.configuration().model,status:'queued'};};
  assert.equal((await h.create()).status,202);assert.equal(h.sqlite.prepare('SELECT provider_request_id FROM image_vision_batches').get().provider_request_id,providerRequestId);assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].options,{queueRequest:true});
 }finally{h.close();}
});

test('encoded batch input rejected before provider dispatch reports zero new inference',async()=>{
 const h=imageVisionBatchFixture({bytes:new Uint8Array(7_500_000)});try{const result=await h.create();assert.equal(result.body.status,'failed',JSON.stringify(result.body));assert.equal(result.body.failure,'INPUT');assert.equal(result.body.execution.requests,0);assert.equal(h.calls.length,0);assert.equal(h.sqlite.prepare('SELECT provider_requests FROM image_vision_requests').get().provider_requests,0);}finally{h.close();}
});

test('poll retrieves the same saved provider job once and completion settles the original claim after revisions advance',async()=>{
 const h=imageVisionBatchFixture();try{
  const created=await h.create(),original=created.body.attempt;h.reload();
  const pending=await h.poll();assert.equal(pending.status,200);assert.equal(pending.body.status,'running');assert.equal(pending.body.execution.requests,0);assert.equal(pending.body.readOnly,false);assert.equal(h.calls.length,2);assert.deepEqual(h.calls[1].input,{request_id:providerRequestId});assert.equal(h.calls[1].options,undefined);
  h.sqlite.exec("UPDATE products SET updated_at='2026-10-30T00:00:00.000Z';UPDATE product_content SET revision=3");h.controls.provider=()=>completedVisionBatch();
  const done=await h.poll();assert.equal(done.status,200,JSON.stringify(done.body));assert.equal(done.body.status,'completed');assert.deepEqual(done.body.attempt,original);assert.equal(done.body.result.blocks[0].translated,'검정');assert.equal(done.body.result.requests,1);assert.deepEqual(done.body.execution,{requests:0});
  const claim=h.sqlite.prepare('SELECT * FROM image_vision_requests').get();assert.equal(claim.status,'completed');assert.equal(claim.provider_requests,1);assert.equal(h.calls.length,3);assert.deepEqual(h.calls[2].input,{request_id:providerRequestId});
  for(const replay of [await h.poll(),await h.read()]){assert.equal(replay.body.status,'completed');assert.deepEqual(replay.body.attempt,original);assert.equal(replay.body.execution.requests,0);}assert.equal(h.calls.length,3);
  assert.ok(!h.queries.some(sql=>/\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+(?:products|product_content|product_options|quotation)/i.test(sql)));
 }finally{h.close();}
});

test('a fresh batch UUID reuses an existing completed validated result with zero new inference',async()=>{
 const h=imageVisionBatchFixture();try{await h.create();h.controls.provider=()=>completedVisionBatch();await h.poll();const next=await h.create({requestId:batchNextRequestId});assert.equal(next.status,200,JSON.stringify(next.body));assert.equal(next.body.status,'completed');assert.equal(next.body.execution.requests,0);assert.equal(next.body.result.requests,1);assert.equal(next.body.attempt.requestId,batchNextRequestId);assert.equal(h.calls.length,2);assert.deepEqual(h.sqlite.prepare('SELECT provider_requests FROM image_vision_requests ORDER BY request_id').all().map(row=>row.provider_requests),[1,0]);assert.equal((await h.poll(batchNextRequestId)).body.status,'completed');assert.equal(h.calls.length,2);}finally{h.close();}
});

test('unknown submit acknowledgement stays uncertain without provider ID and cannot be submitted or polled again',async()=>{
 const h=imageVisionBatchFixture();try{h.controls.provider=()=>{throw Error('private unknown delivery');};const created=await h.create();assert.equal(created.status,202,JSON.stringify(created.body));assert.equal(created.body.status,'uncertain');assert.equal(created.body.failure,'PROVIDER');assert.equal(created.body.execution.requests,1);assert.equal(h.sqlite.prepare('SELECT provider_request_id FROM image_vision_batches').get().provider_request_id,null);assert.equal((await h.create()).body.execution.requests,0);assert.equal((await h.create({requestId:batchNextRequestId})).status,409);h.reload();assert.equal((await h.discover()).body.status,'uncertain');assert.equal((await h.poll()).body.status,'uncertain');assert.equal(h.calls.length,1);assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM image_vision_requests').get().n,1);}finally{h.close();}
});

test('lost provider-ID storage acknowledgement retains that ID and an uncertain original can finish only through it',async()=>{
 const h=imageVisionBatchFixture();try{
  h.controls.afterRead=sql=>{if(/^UPDATE image_vision_batches SET provider_request_id=/.test(sql)){h.controls.afterRead=null;throw Error('lost write acknowledgement');}};
  const created=await h.create();assert.equal(created.body.status,'uncertain');assert.equal(h.sqlite.prepare('SELECT provider_request_id FROM image_vision_batches').get().provider_request_id,providerRequestId);assert.equal(h.sqlite.prepare('SELECT status FROM image_vision_requests').get().status,'uncertain');h.reload();h.controls.provider=()=>completedVisionBatch();
  const recovered=await h.poll();assert.equal(recovered.body.status,'completed',JSON.stringify(recovered.body));assert.equal(recovered.body.execution.requests,0);assert.equal(h.calls.length,2);assert.deepEqual(h.calls[1].input,{request_id:providerRequestId});assert.equal(h.sqlite.prepare('SELECT status FROM image_vision_requests').get().status,'completed');
 }finally{h.close();}
});

test('malformed or mismatched provider polls retain uncertainty and the same ID until a matched terminal outcome',async()=>{
 for(const reply of [{status:'running',request_id:'other'},{responses:[{id:9,success:true,result:{response:{blocks:[]}}}]}]){
  const h=imageVisionBatchFixture();try{await h.create();h.controls.provider=()=>reply;const uncertain=await h.poll();assert.equal(uncertain.body.status,'uncertain');assert.equal(uncertain.body.execution.requests,0);assert.equal(h.sqlite.prepare('SELECT provider_request_id FROM image_vision_batches').get().provider_request_id,providerRequestId);assert.equal((await h.create({requestId:batchNextRequestId})).status,409);h.controls.provider=()=>completedVisionBatch();assert.equal((await h.poll()).body.status,'completed');assert.equal(h.calls.length,3);assert.ok(h.calls.slice(1).every(call=>JSON.stringify(call.input)===JSON.stringify({request_id:providerRequestId})&&call.options===undefined));}finally{h.close();}
 }
});

test('confirmed matched provider failure settles once and terminal replay never polls again',async()=>{
 const h=imageVisionBatchFixture();try{await h.create();h.controls.provider=()=>({responses:[{id:0,success:false,error:'private diagnostics'}]});const failed=await h.poll();assert.equal(failed.body.status,'failed');assert.equal(failed.body.failure,'PROVIDER');assert.equal(failed.body.result,null);assert.equal(failed.body.execution.requests,0);assert.ok(!JSON.stringify(failed.body).includes('private'));assert.equal((await h.poll()).body.status,'failed');assert.equal((await h.read()).body.status,'failed');assert.equal(h.calls.length,2);assert.equal(h.sqlite.prepare('SELECT status FROM image_vision_requests').get().status,'failed');}finally{h.close();}
});

test('current company, member email, role, approval, owner and model bind historical reads and polls',async()=>{
 for(const mutate of [h=>h.sqlite.exec("UPDATE members SET company_code='A01464742',company_name='와이홉'"),h=>h.sqlite.exec("UPDATE members SET email='changed@example.test'"),h=>h.sqlite.exec("UPDATE members SET role='member'"),h=>h.sqlite.exec("UPDATE members SET status='suspended'"),h=>{h.controls.owner='another';},h=>{h.env.SOURCEFLOW_IMAGE_TEXT_MODEL='wrong-model';}]){
  const h=imageVisionBatchFixture();try{await h.create();const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM image_vision_batches').all());mutate(h);const queryStart=h.queries.length;for(const value of [await h.read(),await h.discover(),await h.poll()]){assert.ok(value.status!==200||value.body.status==='not-found',JSON.stringify(value));}assert.equal(h.calls.length,1);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM image_vision_batches').all()),before);assert.ok(h.queries.slice(queryStart).every(sql=>/^SELECT\b/i.test(sql)));}finally{h.close();}
 }
});

test('discovery matches exact source key, hash, dimensions, language and policy but returns the original revision',async()=>{
 const h=imageVisionBatchFixture();try{const created=await h.create();for(const patch of [{sourceKey:'owner/other.png'},{sourceSha256:'b'.repeat(64)},{width:99},{height:79}])assert.equal((await h.discover({visionBatchSource:JSON.stringify({...h.source,...patch})})).body.status,'not-found');for(const patch of [{sourceLanguage:'en'},{inspectionPolicy:'foreign-text-inspection-v1'}])assert.equal((await h.discover(patch)).body.status,'not-found');assert.equal((await h.discover({visionBatchSource:JSON.stringify({...h.source,sourceKey:'other/private.png'})})).status,400);const read=await h.discover({visionBatchSource:JSON.stringify({...h.source,productVersion:'2026-10-31T00:00:00.000Z',contentRevision:20})});assert.deepEqual(read.body.attempt,created.body.attempt);assert.equal(h.calls.length,1);}finally{h.close();}
});

test('poll rejects client source, provider identity or duplicate query fields before any provider call',async()=>{
 const h=imageVisionBatchFixture();try{await h.create();for(const extra of [{source:h.source},{providerRequestId},{configuration:h.configuration()},{inspectionPolicy:'product-text-preservation-v2'}])assert.equal((await h.poll(batchRequestId,extra)).status,400);assert.equal((await h.read(batchRequestId,{source:JSON.stringify(h.source)})).status,400);assert.equal((await h.create({transport:'different'})).status,400);assert.equal(h.calls.length,1);}finally{h.close();}
});

test('retained legacy uncertainty and all collected source aliases still fence new batch submissions',async()=>{
 const legacy=imageVisionBatchFixture();try{legacy.controls.provider=()=>{throw Error('unknown delivery');};const original=await legacy.create({action:'vision',transport:undefined});assert.equal(original.body.uncertain,true);assert.equal((await legacy.discover()).body.status,'not-found');assert.equal((await legacy.create({requestId:batchNextRequestId})).status,409);assert.equal(legacy.calls.length,1);}finally{legacy.close();}
 const h=imageVisionBatchFixture();try{const keys=['','main-','additional-','detail-'].map(role=>`owner/collected-${role}${h.source.sourceSha256}.png`);h.sqlite.prepare('UPDATE products SET image_keys=?').run(JSON.stringify(keys));h.source.sourceKey=keys[3];await h.create();assert.equal((await h.create({requestId:batchNextRequestId,source:{...h.source,sourceKey:keys[2],role:'additional'}})).status,409);assert.equal(h.calls.length,1);assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM image_vision_requests').get().n,1);}finally{h.close();}
});

test('tampered immutable descriptor, fingerprint or completed result cannot be published or trigger a replacement call',async()=>{
 for(const corrupt of [h=>h.sqlite.exec("UPDATE image_vision_batches SET request_fingerprint='wrong'"),h=>h.sqlite.exec("UPDATE image_vision_batches SET attempt='{}'"),h=>{const row=h.sqlite.prepare('SELECT attempt FROM image_vision_batches').get(),value=JSON.parse(row.attempt);value.source.sourceSha256='f'.repeat(64);h.sqlite.prepare('UPDATE image_vision_batches SET attempt=?').run(JSON.stringify(value));}]){
  const h=imageVisionBatchFixture();try{await h.create();corrupt(h);const result=await h.read();assert.ok(result.body.status==='not-found'||result.status!==200);await h.poll();assert.equal(h.calls.length,1);}finally{h.close();}
 }
 const h=imageVisionBatchFixture();try{await h.create();h.controls.provider=()=>completedVisionBatch();await h.poll();const value=JSON.parse(h.sqlite.prepare('SELECT result FROM image_vision_requests').get().result);value.blocks[0].box.width=1000;h.sqlite.prepare('UPDATE image_vision_requests SET result=?').run(JSON.stringify(value));assert.equal((await h.read()).status,409);assert.equal((await h.poll()).status,409);assert.equal(h.calls.length,2);}finally{h.close();}
});
