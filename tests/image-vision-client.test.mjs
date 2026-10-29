import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(){const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,Date,URL,URLSearchParams,Blob,File,FormData,Response,Request,Headers,AbortController,AbortSignal,TextEncoder,TextDecoder,Uint8Array,DataView,crypto:webcrypto,setTimeout,clearTimeout,fetch:()=>{throw Error('No live network');},require:name=>load(name.slice(2)+'.ts')});return exports;}const client=load('app/free-image-translation-client.ts'),contract=load('app/image-text-vision.ts'),calls=[];
 const config={provider:'workers-ai-vision',model:contract.IMAGE_TEXT_VISION_MODEL,configured:true,paidAllowed:true,notice:contract.IMAGE_TEXT_VISION_NOTICE};
 const source={productId:'product',productVersion:'2026-10-29T00:00:00.000Z',contentRevision:2,sourceKey:'owner/source.png',sourceSha256:'a'.repeat(64),role:'detail',width:100,height:80};
 const result={provider:config.provider,model:config.model,requests:1,notice:config.notice,blocks:[{id:'vision-1',text:'黑色',translated:'검정',issue:null,box:{x:5,y:10,width:20,height:10}}]};
 const image={source,blob:new Blob(['owned']),canvas:{width:100,height:80},width:100,height:80,visionConfiguration:config,visionFetcher:async(url,init)=>{const body=JSON.parse(init.body);calls.push({url,body});return Response.json({source,configuration:config,requestId:body.requestId,result,replayed:false,execution:{requests:1,cached:false}});}};
 return{client,image,result,config,calls};}
test('Vision client uses owned-source request once and retains exact generated Korean/box for existing renderer',async()=>{
 const h=fixture(),rows=await h.client.recognizeFreeImage(h.image,'zh',new AbortController().signal);assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.action,'vision');assert.equal(h.calls[0].body.source.sourceKey,'owner/source.png');assert.ok(!('bytes'in h.calls[0].body));assert.equal(rows[0].translated,'검정');assert.equal(rows[0].translationProvenance,'generated');assert.equal(rows[0].confidence,0);assert.deepEqual(plain(rows[0].box),h.result.blocks[0].box);assert.equal(h.image.visionResult.provider,'workers-ai-vision');
 const request=h.calls[0].body.requestId;await h.client.recognizeFreeImage(h.image,'zh',new AbortController().signal);assert.equal(h.calls[1].body.requestId,request,'a repeat can only replay the same durable request');
});
test('unknown/off configuration, changed source/model or out-of-bounds Vision rows never fall back to Google/local OCR',async()=>{
 const off=fixture();off.image.visionConfiguration.configured=false;await assert.rejects(off.client.recognizeFreeImage(off.image,'zh',new AbortController().signal),/설정/);assert.equal(off.calls.length,0);
 for(const kind of ['source','model','box','extra','execution']){const h=fixture();h.image.visionFetcher=async(_url,init)=>{h.calls.push(init);const body={source:plain(h.image.source),configuration:h.config,requestId:JSON.parse(init.body).requestId,result:plain(h.result),replayed:false,execution:{requests:1,cached:false}};if(kind==='source')body.source.productId='other';if(kind==='model')body.result.model='other';if(kind==='box')body.result.blocks[0].box.width=1000;if(kind==='extra')body.rawSecret='private';if(kind==='execution')body.execution={requests:1,cached:true};return Response.json(body);};await assert.rejects(h.client.recognizeFreeImage(h.image,'zh',new AbortController().signal),/응답 연결/);assert.equal(h.calls.length,1);assert.equal(h.image.visionResult,undefined);}
});
test('cache metadata records zero new inference while preserving original generation evidence',async()=>{
 const h=fixture();h.image.visionFetcher=async(_url,init)=>Response.json({source:h.image.source,configuration:h.config,requestId:JSON.parse(init.body).requestId,result:h.result,replayed:false,execution:{requests:0,cached:true}});
 const progress=[];await h.client.recognizeFreeImage(h.image,'zh',new AbortController().signal,message=>progress.push(message));assert.equal(h.image.visionExecution.requests,0);assert.equal(h.image.visionResult.requests,1);assert.match(progress.at(-1),/추가 AI 요청은 0회/);
});
test('partial Vision translations remain visible issues, not fabricated or repaired text; empty result is no foreign text',async()=>{
 const h=fixture();h.result.blocks[0].translated=null;h.result.blocks[0].issue='번역 검증을 통과하지 못했습니다. 원문과 영역을 확인해주세요.';const rows=await h.client.recognizeFreeImage(h.image,'zh',new AbortController().signal);assert.equal(rows[0].translated,'');assert.equal(rows[0].translationProvenance,'empty');assert.ok(rows[0].issue);assert.equal(h.calls.length,1);
 const a=fixture();a.result.blocks=[];await assert.rejects(a.client.recognizeFreeImage(a.image,'zh',new AbortController().signal),/읽을 수 있는 문구/);assert.equal(a.calls.length,1);
});
