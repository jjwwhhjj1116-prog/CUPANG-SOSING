import {parseProductJsonLd} from '../extensions/supplier-hub/product-jsonld.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';
import {capture1688Product,cancel1688Capture,validateCaptureRequest,readProductJsonLd,productSnapshotReady} from '../extensions/supplier-hub/capture-1688.mjs';

const url='https://detail.1688.com/offer/813724060928.html';
const source={'@type':'ProductGroup',url,name:'1688 상품',image:['https://cbu01.alicdn.com/a.jpg'],hasVariant:[{'@type':'Product',name:'검정',sku:'seller-sku',offers:{'@type':'Offer',price:'25.6',priceCurrency:'CNY',eligibleQuantity:{minValue:1}}}]};
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,Response,TextEncoder,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,process:{env:{NODE_ENV:'development'}},require:name=>deps[name]??(name==='@/extensions/supplier-hub/product-jsonld.mjs'?{parseProductJsonLd}:name==='parse5'?parse5:name==='next/server'?{NextResponse:Response}:load(name.slice(2)+'.ts',deps))});return exports;}
const requestId='00000000-0000-4000-8000-000000000001';
const sender={tab:{id:7,windowId:17},frameId:0,url:'https://sourceflow.jjwwhhjj1116.workers.dev/products'};

test('1688 capture is scoped to the calling app window and exact canonical offer URL',()=>{
 assert.equal(validateCaptureRequest({type:'YOOFAM_CAPTURE_1688',requestId,sourceUrl:url},sender).windowId,17);
 for(const bad of [url+'?next=login',url.replace('detail.1688.com','detail.1688.com.evil.test'),url.replace('813724060928','813724060928/other'),'http://detail.1688.com/offer/813724060928.html'])assert.throws(()=>validateCaptureRequest({type:'YOOFAM_CAPTURE_1688',requestId,sourceUrl:bad},sender));
 for(const bad of [{...sender,url:'https://evil.test/'},{...sender,frameId:1},{...sender,tab:{id:7}}])assert.throws(()=>validateCaptureRequest({type:'YOOFAM_CAPTURE_1688',requestId,sourceUrl:url},bad));
});

test('same-window product capture returns JSON-LD and closes only a successfully captured new tab',async()=>{
 const calls=[],events={addListener(){},removeListener(){}};
 const api={tabs:{query:async args=>{calls.push(['query',args]);return [];},create:async args=>{calls.push(['create',args]);return {id:9,windowId:17,status:'complete',url,active:false};},get:async id=>id===7?{id:7,windowId:17,url:sender.url}:{id:9,windowId:17,status:'complete',url,active:false},remove:async id=>calls.push(['remove',id]),onUpdated:events,onRemoved:events},scripting:{executeScript:async args=>{calls.push(['execute',args.target.tabId]);return [{frameId:0,result:{pageUrl:url,scripts:[JSON.stringify(source)]}}];}}};
 const result=await capture1688Product({type:'YOOFAM_CAPTURE_1688',requestId,sourceUrl:url},sender,api,{wait:async()=>{}});
 assert.equal(result.sourceUrl,url);assert.equal(result.scripts.length,1);assert.deepEqual(calls.find(call=>call[0]==='create'),['create',{windowId:17,url,active:false}]);assert.deepEqual(calls.at(-1),['remove',9]);
 api.scripting.executeScript=async()=>[{frameId:0,result:{pageUrl:'https://login.1688.com/',scripts:[]}}];calls.length=0;
 await assert.rejects(capture1688Product({type:'YOOFAM_CAPTURE_1688',requestId,sourceUrl:url},sender,api),/로그인/);
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

function captureFixture({snapshots=[source],existing=false,onRead=()=>{}}={}){
 const calls=[],tabs=new Map([[7,{id:7,windowId:17,url:sender.url}],[9,{id:9,windowId:17,status:'complete',url,active:false}]]);
 let reads=0;
 const api={tabs:{
  get:async id=>{calls.push(['get',id]);if(!tabs.has(id))throw Error('closed');return {...tabs.get(id)};},
  query:async()=>{calls.push(['query']);return existing?[{...tabs.get(9)}]:[];},
  create:async args=>{calls.push(['create',args]);return {...tabs.get(9)};},
  remove:async id=>{calls.push(['remove',id]);tabs.delete(id);},
 },scripting:{executeScript:async args=>{
  calls.push(['read',args.target.tabId]);const item=snapshots[Math.min(reads++,snapshots.length-1)];
  onRead({tabs,reads});return [{frameId:0,result:{pageUrl:url,scripts:(Array.isArray(item)?item:[item]).map(value=>typeof value==='string'?value:JSON.stringify(value))}}];
 }}};
 return {api,calls,tabs,run:(options={})=>capture1688Product({type:'YOOFAM_CAPTURE_1688',requestId,sourceUrl:url},sender,api,{wait:async()=>{},...options})};
}

test('capture waits for hydrated complete prices and the final stable SKU snapshot',async()=>{
 const partial=structuredClone(source);delete partial.hasVariant[0].offers.eligibleQuantity;
 const final=structuredClone(source);final.hasVariant[0].offers.price='5.23';
 const h=captureFixture({snapshots:[[],partial,source,final,final,final]});
 const captured=await h.run();
 assert.equal(h.calls.filter(call=>call[0]==='read').length,6);
 assert.equal(load('app/browser-product-capture.ts').parseBrowserProductCapture(captured,url).options[0].unitPriceCny,5.23);
 assert.equal(h.calls.filter(call=>call[0]==='remove').length,1);
});

test('shared interpretation waits for local offer references and does not accept ranges or wrong currencies',async()=>{
 const p={...source,hasVariant:[{'@id':'#sku'}]};
 const graph=[p,{'@id':'#sku','@type':'Product',name:'검정',sku:'reference-sku',offers:{'@id':'#offer'}},
  {'@id':'#offer','@type':'Offer',priceSpecification:{'@id':'#price'},eligibleQuantity:{'@id':'#qty'}},
  {'@id':'#price','@type':'PriceSpecification',price:'5.23',priceCurrency:'CNY'},
  {'@id':'#qty','@type':'QuantitativeValue',minValue:2}];
 const h=captureFixture({snapshots:[{'@graph':graph.slice(0,-1)},{'@graph':graph}]});
 const captured=await h.run();
 const browser=productSnapshotReady(captured.scripts,url),server=load('app/browser-product-capture.ts').parseBrowserProductCapture(captured,url);
 assert.equal(browser.options[0].unitPriceCny,server.options[0].unitPriceCny);assert.equal(server.options[0].minimumOrder,2);
 for(const value of ['1-5',0,-1,'abc']){
  const bad=structuredClone(source);bad.hasVariant[0].offers.price=value;assert.throws(()=>productSnapshotReady([JSON.stringify(bad)],url));
 }
 const bad=structuredClone(source);bad.hasVariant[0].offers.priceCurrency='USD';assert.throws(()=>productSnapshotReady([JSON.stringify(bad)],url),/CNY/);
 assert.throws(()=>productSnapshotReady([JSON.stringify(source),'invalid JSON'],url));
});

test('incomplete hydration is bounded, preserves its tab and releases the capture lock',async()=>{
 const partial=structuredClone(source);delete partial.hasVariant[0].sku;
 const h=captureFixture({snapshots:[partial]});
 await assert.rejects(h.run(),/SKU/);
 assert.equal(h.calls.filter(call=>call[0]==='read').length,40);assert.equal(h.calls.some(call=>call[0]==='remove'),false);
 assert.equal((await captureFixture().run()).ok,true);
});

test('tab moves or navigation during capture abort without returning evidence or closing the changed tab',async()=>{
 for(const change of [tab=>tab.windowId=18,tab=>tab.url='https://login.1688.com/',tab=>tab.pendingUrl='https://detail.1688.com/offer/999.html']){
  const h=captureFixture({onRead:({tabs})=>change(tabs.get(9))});
  await assert.rejects(h.run(),/Chrome 창|로그인/);assert.equal(h.calls.filter(call=>call[0]==='read').length,1);assert.equal(h.calls.some(call=>call[0]==='remove'),false);
 }
 const h=captureFixture();h.tabs.get(7).pendingUrl='https://other.example/';
 await assert.rejects(h.run(),/앱 탭/);assert.equal(h.calls.some(call=>call[0]==='create'||call[0]==='read'),false);
});

test('existing and user-activated product tabs are preserved on successful capture',async()=>{
 const existing=captureFixture({existing:true});await existing.run();
 assert.equal(existing.calls.some(call=>call[0]==='create'||call[0]==='remove'),false);
 const activated=captureFixture({onRead:({tabs})=>{tabs.get(9).active=true;}});await activated.run();
 assert.equal(activated.calls.some(call=>call[0]==='remove'),false);
});

test('only the initiating app and request can cancel its capture; concurrent capture cannot open a second tab',async()=>{
 const h=captureFixture({snapshots:[[]]});let release,started;
 const entered=new Promise(resolve=>{started=resolve;});
 const pending=h.run({wait:async()=>{started();await new Promise(resolve=>{release=resolve;});}});
 await entered;
 await assert.rejects(h.run(),/가져오는 중/);assert.equal(h.calls.filter(call=>call[0]==='create').length,1);
 const cancel={type:'YOOFAM_CANCEL_1688',requestId,sourceUrl:url};
 assert.equal(cancel1688Capture({...cancel,requestId:'00000000-0000-4000-8000-000000000002'},sender).cancelled,false);
 assert.equal(cancel1688Capture(cancel,{...sender,tab:{...sender.tab,id:8}}).cancelled,false);
 assert.equal(cancel1688Capture(cancel,sender).cancelled,true);release();
 await assert.rejects(pending,/취소/);assert.equal(h.calls.some(call=>call[0]==='remove'),false);
 assert.equal((await captureFixture().run()).ok,true);
});

test('capture rejects invalid frame/window identities and invalid request IDs before tab operations',()=>{
 const message={type:'YOOFAM_CAPTURE_1688',requestId,sourceUrl:url};
 for(const id of [-1,1.5,NaN,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>validateCaptureRequest(message,{...sender,tab:{id,windowId:17}}));
  assert.throws(()=>validateCaptureRequest(message,{...sender,tab:{id:7,windowId:id}}));
 }
 assert.equal(validateCaptureRequest(message,{...sender,tab:{id:0,windowId:0}}).tabId,0);
 for(const bad of [undefined,'bad',42])assert.throws(()=>validateCaptureRequest({...message,requestId:bad},sender));
});

test('JSON-LD DOM reads are UTF-8 bounded and exclude foreign-namespace metadata',()=>{
 const run=scripts=>vm.runInNewContext(`(${readProductJsonLd.toString()})()`,{TextEncoder,location:{href:url},document:{querySelectorAll:()=>scripts}});
 const script=(value,namespaceURI='http://www.w3.org/1999/xhtml')=>({namespaceURI,textContent:value,getAttribute:()=> 'application/ld+json'});
 assert.equal(run([script('ignored','http://www.w3.org/2000/svg'),script(JSON.stringify(source))]).scripts.length,1);
 assert.throws(()=>run([script('가'.repeat(500001))]),/한도/);
});

test('a same-URL page reload discards the earlier snapshot and waits for the new complete page',async()=>{
 const final=structuredClone(source);final.hasVariant[0].offers.price='3.42';
 const h=captureFixture({snapshots:[source,final],onRead:({tabs,reads})=>{if(reads===1)tabs.get(9).status='loading';}});
 let waits=0;
 const captured=await h.run({wait:async()=>{if(++waits===2)h.tabs.get(9).status='complete';}});
 assert.equal(productSnapshotReady(captured.scripts,url).options[0].unitPriceCny,3.42);
 assert.equal(h.calls.filter(call=>call[0]==='read').length,4);
});

test('unexpected iframe results never supply product evidence',async()=>{
 const h=captureFixture();h.api.scripting.executeScript=async()=>[{frameId:4,result:{pageUrl:url,scripts:[JSON.stringify(source)]}}];
 await assert.rejects(h.run(),/상품/);assert.equal(h.calls.some(call=>call[0]==='remove'),false);
 assert.throws(()=>cancel1688Capture({type:'YOOFAM_CAPTURE_1688',requestId,sourceUrl:url},sender),/취소 요청/);
});
