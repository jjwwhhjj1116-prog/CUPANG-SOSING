import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';
import {capture1688Product,validateCaptureRequest} from '../extensions/supplier-hub/capture-1688.mjs';

const url='https://detail.1688.com/offer/813724060928.html';
const source={'@type':'ProductGroup',url,name:'1688 상품',image:['https://cbu01.alicdn.com/a.jpg'],hasVariant:[{'@type':'Product',name:'검정',sku:'seller-sku',offers:{'@type':'Offer',price:'25.6',priceCurrency:'CNY',eligibleQuantity:{minValue:1}}}]};
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,Response,TextEncoder,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,process:{env:{NODE_ENV:'development'}},require:name=>deps[name]??(name==='parse5'?parse5:name==='next/server'?{NextResponse:Response}:load(name.slice(2)+'.ts',deps))});return exports;}
const sender={tab:{id:7,windowId:17},frameId:0,url:'https://sourceflow.jjwwhhjj1116.workers.dev/products'};

test('1688 capture is scoped to the calling app window and exact canonical offer URL',()=>{
 assert.equal(validateCaptureRequest({type:'YOOFAM_CAPTURE_1688',sourceUrl:url},sender).windowId,17);
 for(const bad of [url+'?next=login',url.replace('detail.1688.com','detail.1688.com.evil.test'),url.replace('813724060928','813724060928/other'),'http://detail.1688.com/offer/813724060928.html'])assert.throws(()=>validateCaptureRequest({type:'YOOFAM_CAPTURE_1688',sourceUrl:bad},sender));
 for(const bad of [{...sender,url:'https://evil.test/'},{...sender,frameId:1},{...sender,tab:{id:7}}])assert.throws(()=>validateCaptureRequest({type:'YOOFAM_CAPTURE_1688',sourceUrl:url},bad));
});

test('same-window product capture returns JSON-LD and closes only a successfully captured new tab',async()=>{
 const calls=[],events={addListener(){},removeListener(){}};
 const api={tabs:{query:async args=>{calls.push(['query',args]);return [];},create:async args=>{calls.push(['create',args]);return {id:9,status:'complete',url};},get:async()=>({status:'complete'}),remove:async id=>calls.push(['remove',id]),onUpdated:events,onRemoved:events},scripting:{executeScript:async args=>{calls.push(['execute',args.target.tabId]);return [{result:{pageUrl:url,scripts:[JSON.stringify(source)]}}];}}};
 const result=await capture1688Product({type:'YOOFAM_CAPTURE_1688',sourceUrl:url},sender,api);
 assert.equal(result.sourceUrl,url);assert.equal(result.scripts.length,1);assert.deepEqual(calls[1],['create',{windowId:17,url,active:false}]);assert.deepEqual(calls.at(-1),['remove',9]);
 api.scripting.executeScript=async()=>[{result:{pageUrl:'https://login.1688.com/',scripts:[]}}];calls.length=0;
 await assert.rejects(capture1688Product({type:'YOOFAM_CAPTURE_1688',sourceUrl:url},sender,api),/로그인/);
 assert.equal(calls.some(call=>call[0]==='remove'),false);
});

test('browser capture accepts only complete exact-offer SKU and CNY price evidence',()=>{
 const parse=load('app/browser-product-capture.ts').parseBrowserProductCapture;
 const result=parse({sourceUrl:url,scripts:[JSON.stringify(source)]},url);
 assert.equal(result.provider,'chrome-product-jsonld-v1');assert.equal(result.options[0].sku,'seller-sku');assert.equal(result.options[0].unitPriceCny,25.6);
 for(const bad of [{sourceUrl:url.replace('813724060928','111111111111'),scripts:[JSON.stringify(source)]},{sourceUrl:url,scripts:[JSON.stringify({...source,url:'https://detail.1688.com/offer/111111111111.html'})]},{sourceUrl:url,scripts:[JSON.stringify({...source,hasVariant:[{...source.hasVariant[0],offers:{'@type':'Offer',price:'25.6',priceCurrency:'USD'}}]})]},{sourceUrl:url,scripts:['not json']}])assert.throws(()=>parse(bad,url));
});

test('browser capture route stores only owner-scoped verified receipts and retries idempotently',async()=>{
 let writes=0;
 const parsed=load('app/browser-product-capture.ts');
 const body={sourceUrl:url,scripts:[JSON.stringify(source)]};
 const deps={'@/app/chatgpt-auth':{getChatGPTUser:async()=>null,getWorkspaceOwnerId:async()=>'owner'},'@/db/collection-jobs':{findCollectionJob:async(owner,id)=>{assert.equal(owner,'owner');assert.equal(id,'job');return {status:'awaiting_connector',source_url:url,offer_id:'813724060928'};}},'@/db/collection-results':{readCollectionResult:async()=>null,storeCollectionResult:async(_owner,_id,result)=>{writes++;return {status:'stored',result,receivedAt:'2026-09-30T00:00:00.000Z'};}},'@/app/browser-product-capture':parsed};
 const api=load('app/api/collection-jobs/[id]/browser-capture/route.ts',deps);
 const request=value=>new Request('http://localhost/api/collection-jobs/job/browser-capture',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
 const context={params:Promise.resolve({id:'job'})};
 let response=await api.POST(request(body),context);assert.equal(response.status,200);assert.equal((await response.json()).receipt.result.options[0].sku,'seller-sku');assert.equal(writes,1);
 response=await api.POST(request({...body,sourceUrl:'https://detail.1688.com/offer/111111111111.html'}),context);assert.equal(response.status,422);assert.equal(writes,1);
});

test('URL intake falls back to same-Chrome capture only after public fetch fails',async()=>{
 const receipt=load('app/browser-product-capture.ts').parseBrowserProductCapture({sourceUrl:url,scripts:[JSON.stringify(source)]},url);
 const calls=[],updates=[];
 const {collectIntakeProduct}=load('app/intake-collection.ts',{'@/app/collection-batch':{importReceivedJobs:async(jobs,options)=>{assert.equal(jobs[0].received_at,'2026-09-30T00:00:00Z');options.onResult('job',{status:'completed',productId:'draft',completedImages:1});}}});
 const job={id:'job',offer_id:'813724060928',source_url:url,status:'awaiting_connector',goal:'collect'};
 const result=await collectIntakeProduct(job,{signal:new AbortController().signal,fetcher:async(path,init)=>{
  calls.push(path);
  if(path.endsWith('/collect'))return Response.json({code:'SOURCE_NOT_COLLECTED',error:'공개 조회 실패'},{status:422});
  assert.equal(path,'/api/collection-jobs/job/browser-capture');assert.equal(JSON.parse(init.body).sourceUrl,url);
  return Response.json({jobId:'job',offerId:job.offer_id,receipt:{result:receipt,receivedAt:'2026-09-30T00:00:00Z'}});
 },captureFromBrowser:async(value)=>{assert.equal(value,url);calls.push('chrome');return {sourceUrl:url,scripts:[JSON.stringify(source)]};},onJob:value=>updates.push(value),onProgress:()=>{}});
 assert.deepEqual(calls,['/api/collection-jobs/job/collect','chrome','/api/collection-jobs/job/browser-capture']);
 assert.match(result,/상품 추가 완료/);assert.equal(updates.at(-1).product_id,'draft');
});
