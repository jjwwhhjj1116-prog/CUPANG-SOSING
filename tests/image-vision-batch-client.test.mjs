import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {imageVisionBatchFixture,completedVisionBatch} from './fixtures/image-vision-batch-fixture.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const modules=new Map(),calls=[];
 function load(file){if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,Date,URL,URLSearchParams,Response,Request,Headers,AbortController,AbortSignal,TextEncoder,TextDecoder,Uint8Array,Blob,File,FormData,DataView,structuredClone,crypto:webcrypto,setTimeout:fn=>setTimeout(fn,0),clearTimeout,fetch:()=>{throw Error('No live requests');},require:name=>load(name.slice(2)+'.ts')});return exports;}
 const client=load('app/free-image-translation-client.ts'),contract=load('app/image-text-vision.ts');
 const configuration={provider:'workers-ai-vision',model:contract.IMAGE_TEXT_VISION_MODEL,configured:true,paidAllowed:true,notice:contract.IMAGE_TEXT_VISION_NOTICE};
 const source={productId:'product',productVersion:'2026-11-04T00:00:00.000Z',contentRevision:2,sourceKey:'owner/source.png',sourceSha256:'a'.repeat(64),role:'additional',width:100,height:80};
 const attempt={requestId:'a1111111-1111-4111-8111-111111111111',source,sourceLanguage:'zh',configuration,inspectionPolicy:contract.IMAGE_TEXT_PRESERVATION_POLICY,transport:'workers-ai-batch-v1'};
 const result={provider:configuration.provider,model:configuration.model,requests:1,notice:configuration.notice,inspection:{policy:attempt.inspectionPolicy,decision:'foreign-text'},blocks:[{id:'vision-1',kind:'overlay',text:'黑色',translated:'검정',issue:null,box:{x:5,y:10,width:20,height:10}}]};
 const reply=(status='running',readOnly=false,requests=0,original=attempt)=>({format:'yoofam-image-vision-batch-v1',attempt:status==='not-found'?null:original,status,result:status==='completed'?result:null,failure:status==='uncertain'?'TIMEOUT':status==='failed'?'TEXT':null,execution:{requests},readOnly});
 const image={source,blob:new Blob(['owned']),canvas:{width:100,height:80},width:100,height:80,visionConfiguration:configuration,visionTransport:'workers-ai-batch-v1'};
 return{client,batch:load('app/image-vision-batch-client.ts'),contract,source,configuration,attempt,result,reply,image,calls,plain};
}

test('BODY style travels in the original immutable attempt while different-style discovery retains that UUID without resubmission',async()=>{
 for(const changed of [false,true,'forged']){const h=fixture();h.source.role='detail';h.attempt.source.role='detail';
  h.image.visionTextStyle=await h.contract.createImageTextStyle({addCopyright:true,translationPrompt:'간결하게'});
  const style=h.image.visionTextStyle;h.attempt.textStyle=changed==='forged'?{...style,guidance:'altered with the same hash'}:changed?await h.contract.createImageTextStyle({addCopyright:false,translationPrompt:''}):style;
  h.image.visionFetcher=async(url,init={})=>{h.calls.push({url,init});return Response.json(h.reply('completed',true));};
  if(changed){await assert.rejects(h.client.recognizeFreeImage(h.image,'zh',new AbortController().signal));assert.equal(h.image.visionPending.attempt.requestId,h.attempt.requestId);assert.equal(h.image.visionRequestId,h.attempt.requestId);assert.equal(h.image.visionResult,undefined);}
  else await h.client.recognizeFreeImage(h.image,'zh',new AbortController().signal);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].init.method,'GET');
 }
});

test('advertised Batch submits once then polls only the original job before using Korean regions',async()=>{
 const h=fixture();let original,polls=0;
 h.image.visionFetcher=async(url,init={})=>{h.calls.push({url,init});if(init.method==='GET')return Response.json(h.reply('not-found',true));const body=JSON.parse(init.body);if(body.action==='vision-batch'){original={...body};delete original.action;return Response.json(h.reply('running',false,1,original),{status:202});}assert.deepEqual(Object.keys(body).sort(),['action','requestId']);assert.equal(body.action,'vision-batch-poll');assert.equal(body.requestId,original.requestId);return Response.json(h.reply(++polls===1?'running':'completed',false,0,original));};
 const regions=await h.client.recognizeFreeImage(h.image,'zh',new AbortController().signal);
 assert.equal(regions[0].translated,'검정');assert.equal(h.image.visionResult.blocks[0].text,'黑色');assert.equal(h.image.visionExecution.requests,1);
 assert.equal(h.calls.filter(c=>c.init.body&&JSON.parse(c.init.body).action==='vision-batch').length,1);
 assert.equal(polls,2);assert.match(h.calls[0].url,/visionBatchSource=/);
});

test('only this invocation newly admitted batch may refine source ink; discovered old jobs and unknown ACK recovery do not',async()=>{
 for(const mode of ['new','discovered','unknown-ack']){
  const h=fixture();h.image.canvas={width:100,height:80,getContext:()=>({font:'',measureText:()=>({width:3}),getImageData(x,y,w,h){const data=new Uint8ClampedArray(w*h*4).fill(255);for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++)if(x+xx>=12&&x+xx<14&&y+yy>=7&&y+yy<15)data.set([35,35,35,255],(yy*w+xx)*4);return{data};}})};
  let submitted;
  h.image.visionFetcher=async(url,init={})=>{h.calls.push({url,init});if(init.method==='GET')return Response.json(mode==='new'?h.reply('not-found',true):h.reply('completed',true));
   const body=JSON.parse(init.body);submitted={...body};delete submitted.action;return Response.json(h.reply('completed',false,1,submitted));};
  if(mode==='unknown-ack'){h.image.visionPending=new h.client.FreeImageVisionError('ACK unknown','IMAGE_VISION_ACK_MISSING',true,h.attempt);h.image.visionRequestId=h.attempt.requestId;}
  const before=JSON.stringify(h.result),regions=await h.client.recognizeFreeImage(h.image,'zh',new AbortController().signal);
  assert.equal(regions[0].box.y,mode==='new'?6:10,mode);assert.equal(JSON.stringify(h.result),before);assert.equal(h.calls.filter(row=>row.init.method==='POST').length,mode==='new'?1:0);
 }
});

test('reload discovers persisted original job and keeps current-source CAS identity without resubmission',async()=>{
 const h=fixture();h.attempt.source={...h.source,productVersion:'2026-11-03T00:00:00.000Z',contentRevision:1};
 h.image.visionFetcher=async(url,init={})=>{h.calls.push({url,init});if(init.method==='GET')return Response.json(h.reply('running',true));assert.deepEqual(JSON.parse(init.body),{action:'vision-batch-poll',requestId:h.attempt.requestId});return Response.json(h.reply('completed'));};
 await h.client.recognizeFreeImage(h.image,'zh',new AbortController().signal);
 assert.equal(h.calls.length,2);assert.equal(h.image.visionExecution.requests,0);assert.deepEqual(h.plain(h.image.source),h.source);assert.equal(h.image.source.contentRevision,2);
});

test('reload of a job with a transient uncertain poll retrieves that same job before deciding it is pending',async()=>{
 const h=fixture();h.image.visionFetcher=async(url,init={})=>{h.calls.push({url,init});if(init.method==='GET')return Response.json(h.reply('uncertain',true));assert.deepEqual(JSON.parse(init.body),{action:'vision-batch-poll',requestId:h.attempt.requestId});return Response.json(h.reply('completed'));};
 const rows=await h.client.recognizeFreeImage(h.image,'zh',new AbortController().signal);assert.equal(rows[0].translated,'검정');assert.equal(h.calls.length,2);assert.equal(h.image.visionExecution.requests,0);
});

test('Batch discovery cannot borrow another image, company-model configuration, language or inspection policy',async()=>{
 for(const kind of ['product','key','bytes','width','configuration','language','policy','transport','extra']){
  const h=fixture(),body=h.plain(h.reply('completed',true));
  if(kind==='product')body.attempt.source.productId='other';if(kind==='key')body.attempt.source.sourceKey='owner/other.png';if(kind==='bytes')body.attempt.source.sourceSha256='b'.repeat(64);if(kind==='width')body.attempt.source.width=101;if(kind==='configuration')body.attempt.configuration.paidAllowed=false;if(kind==='language')body.attempt.sourceLanguage='en';if(kind==='policy')body.attempt.inspectionPolicy=h.contract.IMAGE_TEXT_INSPECTION_POLICY;if(kind==='transport')delete body.attempt.transport;if(kind==='extra')body.unsafe='unbound';
  h.image.visionFetcher=async(url,init)=>{h.calls.push({url,init});return Response.json(body);};
  await assert.rejects(h.client.recognizeFreeImage(h.image,'zh',new AbortController().signal));assert.equal(h.calls.length,1,kind);assert.equal(h.image.visionResult,undefined);
 }
});

test('unknown submission ACK is retained and next explicit attempt reads that UUID instead of submitting again',async()=>{
 const h=fixture();let submitted;
 h.image.visionFetcher=async(url,init={})=>{h.calls.push({url,init});if(init.method==='GET')return Response.json(h.reply('not-found',true));submitted=JSON.parse(init.body);throw Error('ACK lost');};
 await assert.rejects(h.client.recognizeFreeImage(h.image,'zh',new AbortController().signal),error=>error instanceof h.client.FreeImageVisionError&&error.uncertain&&error.attempt.transport==='workers-ai-batch-v1');
 assert.equal(h.image.visionRequestId,submitted.requestId);
 h.image.visionFetcher=async(url,init)=>{h.calls.push({url,init});assert.equal(init.method,'GET');assert.equal(new URL(url,'https://app.test').searchParams.get('visionBatchRequestId'),submitted.requestId);return Response.json(h.reply('not-found',true));};
 await assert.rejects(h.client.recognizeFreeImage(h.image,'zh',new AbortController().signal));
 assert.equal(h.calls.filter(c=>c.init.method==='POST').length,1);assert.equal(h.image.visionResult,undefined);
});

test('a retained pending attempt cannot read or apply another current source, language, configuration, policy or request identity',async()=>{
 for(const change of ['product','key','bytes','width','height','language','configuration','policy','requestId']){
  const h=fixture();h.image.visionPending=new h.client.FreeImageVisionError('Original ACK unknown','IMAGE_VISION_ACK_MISSING',true,h.attempt);h.image.visionRequestId=h.attempt.requestId;
  if(change==='product')h.image.source={...h.source,productId:'other'};if(change==='key')h.image.source={...h.source,sourceKey:'owner/other.png'};if(change==='bytes')h.image.source={...h.source,sourceSha256:'b'.repeat(64)};
  if(change==='width')h.image.source={...h.source,width:101};if(change==='height')h.image.source={...h.source,height:81};if(change==='configuration')h.image.visionConfiguration={...h.configuration,notice:'changed configuration'};
  if(change==='policy')h.image.visionPending=new h.client.FreeImageVisionError('Original ACK unknown','IMAGE_VISION_ACK_MISSING',true,{...h.attempt,inspectionPolicy:h.contract.IMAGE_TEXT_INSPECTION_POLICY});if(change==='requestId')h.image.visionRequestId='b2222222-2222-4222-8222-222222222222';
  const before=h.image.visionPending;h.image.visionFetcher=async(url,init)=>{h.calls.push({url,init});return Response.json(h.reply('completed',true));};
  await assert.rejects(h.batch.runImageVisionBatch(h.image,change==='language'?'en':'zh',new AbortController().signal,()=>{}),undefined,change);
  assert.equal(h.calls.length,0,change);assert.equal(h.image.visionResult,undefined,change);assert.equal(h.image.visionPending,before,change);
 }
});

test('a retained same-byte attempt from an older revision keeps the current CAS source and polls only the saved UUID',async()=>{
 const h=fixture();h.attempt.source={...h.source,productVersion:'2026-11-03T00:00:00.000Z',contentRevision:1};
 h.image.visionPending=new h.client.FreeImageVisionError('Original ACK unknown','IMAGE_VISION_ACK_MISSING',true,h.attempt);h.image.visionRequestId=h.attempt.requestId;
 h.image.visionFetcher=async(url,init)=>{h.calls.push({url,init});if(init.method==='GET'){assert.equal(new URL(url,'https://app.test').searchParams.get('visionBatchRequestId'),h.attempt.requestId);return Response.json(h.reply('running',true));}assert.deepEqual(JSON.parse(init.body),{action:'vision-batch-poll',requestId:h.attempt.requestId});return Response.json(h.reply('completed'));};
 const source=structuredClone(h.image.source),regions=await h.client.recognizeFreeImage(h.image,'zh',new AbortController().signal);assert.equal(regions[0].translated,'검정');assert.equal(h.calls.length,2);assert.deepEqual(h.plain(h.image.source),source);assert.equal(h.image.visionExecution.requests,0);assert.equal(h.image.visionPending,undefined);
});

test('pure status GET and explicit same-job observation retain separate ledger-write semantics',async()=>{
 const h=fixture(),signal=new AbortController().signal;
 const read=await h.client.readFreeImageVisionStatus(h.attempt,signal,async(url,init)=>{assert.equal(init.method,'GET');assert.match(url,/visionBatchRequestId=/);return Response.json(h.reply('running',true));});
 assert.equal(read.readOnly,true);assert.equal(read.execution.requests,0);
 const observation=await h.client.observeFreeImageVisionStatus(h.attempt,signal,async(url,init)=>{assert.equal(init.method,'POST');assert.deepEqual(JSON.parse(init.body),{action:'vision-batch-poll',requestId:h.attempt.requestId});return Response.json(h.reply('completed'));});
 assert.equal(observation.readOnly,false);assert.equal(observation.ledgerOnly,true);assert.equal(observation.execution.requests,0);assert.equal(observation.result.blocks[0].translated,'검정');
});

test('pending abort preserves its provider job and dispatches no image upload or follow-on inference',async()=>{
 const h=fixture(),abort=new AbortController();
 h.image.visionFetcher=async(url,init={})=>{h.calls.push({url,init});if(init.method==='GET')return Response.json(h.reply('running',true));abort.abort();return Response.json(h.reply('running'));};
 await assert.rejects(h.client.recognizeFreeImage(h.image,'zh',abort.signal));assert.equal(h.image.visionRequestId,h.attempt.requestId);assert.equal(h.calls.length,2);assert.equal(h.image.visionPending.uncertain,true);
});

test('polling rejects a different job ID or generated output before rendering, with no create fallback',async()=>{
 for(const change of ['requestId','source','result','execution','readOnly']){const h=fixture();h.image.visionFetcher=async(url,init={})=>{h.calls.push({url,init});if(init.method==='GET')return Response.json(h.reply('running',true));const body=h.plain(h.reply('completed'));if(change==='requestId')body.attempt.requestId='b2222222-2222-4222-8222-222222222222';if(change==='source')body.attempt.source.contentRevision=8;if(change==='result')body.result.blocks[0].box.width=900;if(change==='execution')body.execution.requests=1;if(change==='readOnly')body.readOnly=true;return Response.json(body);};await assert.rejects(h.client.recognizeFreeImage(h.image,'zh',new AbortController().signal));assert.equal(h.calls.length,2,change);assert.equal(h.image.visionResult,undefined);}
});

test('changed source during discovery is rejected before any potentially paid submission',async()=>{
 const h=fixture();h.image.visionFetcher=async(url,init)=>{h.calls.push({url,init});h.image.source={...h.source,sourceKey:'owner/changed.png'};return Response.json(h.reply('not-found',true));};
 await assert.rejects(h.client.recognizeFreeImage(h.image,'zh',new AbortController().signal));assert.equal(h.calls.length,1);assert.equal(h.image.visionRequestId,undefined);
});

test('confirmed concurrent non-admission releases its rejected UUID so the next explicit run discovers the original job',async()=>{
 const h=imageVisionBatchFixture();try{
  const batch=h.load('app/image-vision-batch-client.ts'),calls=[];let original;
  const image={source:h.source,visionConfiguration:h.configuration(),visionTransport:'workers-ai-batch-v1',visionFetcher:async(url,init={})=>{
   calls.push({url,init});
   if(init.method==='POST'&&JSON.parse(init.body).action==='vision-batch'&&!original)original=(await h.create()).body.attempt;
   return h.fetcher(url,init);
  }};
  await assert.rejects(batch.runImageVisionBatch(image,'zh',new AbortController().signal,()=>{}),error=>!error.uncertain&&error.code==='IMAGE_VISION_NOT_ADMITTED');
  assert.equal(calls.length,2);assert.equal(image.visionRequestId,undefined);assert.equal(image.visionPending,undefined);assert.equal(h.calls.length,1);
  h.controls.provider=()=>completedVisionBatch();
  const recovered=await batch.runImageVisionBatch(image,'zh',new AbortController().signal,()=>{});
  assert.equal(recovered.attempt.requestId,original.requestId);assert.equal(recovered.result.blocks[0].translated,'검정');assert.equal(recovered.requests,0);
  assert.equal(calls.length,4);assert.match(calls[2].url,/visionBatchSource=/);assert.deepEqual(JSON.parse(calls[3].init.body),{action:'vision-batch-poll',requestId:original.requestId});
  assert.equal(h.calls.length,2);assert.equal(h.calls.filter(call=>call.options?.queueRequest===true).length,1);assert.deepEqual(h.calls[1].input,{request_id:h.sqlite.prepare('SELECT provider_request_id FROM image_vision_batches').get().provider_request_id});
  assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM image_vision_requests').get().n,1);
 }finally{h.close();}
});
