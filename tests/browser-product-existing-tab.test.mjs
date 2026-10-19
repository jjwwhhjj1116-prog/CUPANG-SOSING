import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {capture1688Product,cancel1688Capture,productSnapshotReady} from '../extensions/supplier-hub/capture-1688.mjs';

// Entirely inert, synthetic offer. All fetches below are local functions.
const sourceUrl='https://detail.1688.com/offer/628000000002.html';
const request={type:'YOOFAM_CAPTURE_1688',requestId:'00000000-0000-4000-8000-000000000729',sourceUrl};
const sender={tab:{id:7,windowId:17},frameId:0,url:'https://sourceflow.jjwwhhjj1116.workers.dev/products'};
const source={'@type':'ProductGroup',url:sourceUrl,name:'synthetic existing product',image:['https://cbu01.alicdn.com/synthetic.jpg'],hasVariant:[{'@type':'Product',name:'Black',sku:'synthetic-sku',offers:{'@type':'Offer',price:'12.5',priceCurrency:'CNY',eligibleQuantity:{minValue:1}}}]};
const publicSku=JSON.parse(fs.readFileSync(new URL('fixtures/1688-public-sku-813724060928.json',import.meta.url),'utf8').replaceAll('813724060928','628000000002'));

function harness({mobile=true,existing=true,snapshots=[source],onRead=()=>{},onWait=()=>{},fetcher:customFetcher}={}){
  const calls=[],tabs=new Map([[7,{...sender.tab,url:sender.url}],[9,{id:9,windowId:17,status:'complete',url:sourceUrl,active:true}]]);
  let reads=0;
  const api={tabs:{
    query:async value=>{calls.push(['query',value]);return existing?[{...tabs.get(9)}]:[];},
    get:async id=>{if(!tabs.has(id))throw Error('closed tab');return {...tabs.get(id)};},
    create:async()=>{calls.push(['create']);throw Error('must not create a product tab');},
    remove:async()=>{calls.push(['remove']);throw Error('must not close a product tab');},
  },scripting:{executeScript:async()=>{
    calls.push(['read',++reads]);const value=snapshots[Math.min(reads-1,snapshots.length-1)];
    await onRead({tabs,reads,calls});
    return [{frameId:0,result:{pageUrl:sourceUrl,scripts:value===null?[]:[JSON.stringify(value)]}}];
  }}};
  if(mobile)Object.assign(api,{runtime:{id:'a'.repeat(32)},webRequest:{onHeadersReceived:{addListener(){},removeListener(){}}},declarativeNetRequest:{getSessionRules:async()=>[],updateSessionRules:async()=>{}}});
  const fetcher=async(value,init)=>{
    const url=new URL(value);calls.push(['fetch',url.hostname]);
    if(customFetcher)return customFetcher(url,init);
    if(url.hostname==='m.1688.com')return new Response('<html>No mobile initial data</html>',{headers:{'content-type':'text/html'}});
    assert.equal(url.hostname,'h5api.m.1688.com');return Response.json(publicSku);
  };
  const run=()=>capture1688Product(request,sender,api,{fetcher,wait:async(ms,signal)=>{calls.push(['wait',ms]);await onWait({tabs,reads,calls,signal});}});
  return {api,tabs,calls,run};
}

test('a stable existing exact-offer tab wins before supported but unusable mobile transport',async()=>{
  const h=harness({fetcher:()=>{throw Error('mobile must not be called');}});
  const result=await h.run();
  assert.deepEqual(result,{ok:true,sourceUrl,scripts:[JSON.stringify(source)]});
  assert.deepEqual(h.calls.map(value=>value[0]),['query','read','wait','read','wait','read']);
  assert.deepEqual(h.calls.filter(value=>value[0]==='wait').map(value=>value[1]),[250,250]);
  assert.equal(h.tabs.size,2);assert.equal(h.tabs.get(9).active,true);
});

test('the existing-tab fast path also works without public mobile transport capabilities',async()=>{
  const h=harness({mobile:false});const result=await h.run();
  assert.equal(productSnapshotReady(result.scripts,sourceUrl).options[0].unitPriceCny,12.5);
  assert.equal(h.calls.filter(value=>value[0]==='read').length,3);
  assert.equal(h.calls.some(value=>['fetch','create','remove'].includes(value[0])),false);
});

test('incomplete existing JSON-LD gets only three probe reads before original mobile evidence is used',async()=>{
  const incomplete=structuredClone(source);delete incomplete.hasVariant[0].offers.eligibleQuantity;
  const h=harness({snapshots:[incomplete]});const result=await h.run();
  assert.equal(result.format,'1688-public-sku-capture-v1');assert.deepEqual(result.skuPayload,publicSku);
  assert.deepEqual(h.calls.map(value=>value[0]),['query','read','wait','read','wait','read','fetch','fetch']);
  assert.equal(h.tabs.size,2);
});

test('no matching existing tab keeps mobile collection ahead of all DOM reads and tab creation',async()=>{
  const h=harness({existing:false});const result=await h.run();
  assert.equal(result.format,'1688-public-sku-capture-v1');
  assert.deepEqual(h.calls.map(value=>value[0]),['query','fetch','fetch']);
});

test('an initially loading same-offer tab is retained while the original mobile collector runs',async()=>{
  const h=harness();h.tabs.get(9).status='loading';
  const result=await h.run();assert.equal(result.format,'1688-public-sku-capture-v1');
  assert.deepEqual(h.calls.map(value=>value[0]),['query','fetch','fetch']);
});

test('source window moves, login navigation, foreign pending navigation and app movement stop before mobile',async()=>{
  for(const change of [tabs=>tabs.get(9).windowId=18,tabs=>tabs.get(9).url='https://login.1688.com/',tabs=>tabs.get(9).pendingUrl='https://detail.1688.com/offer/999.html',tabs=>tabs.get(7).windowId=18]){
    const h=harness({onRead:({tabs})=>change(tabs)});
    await assert.rejects(h.run(),/Chrome 창|로그인|앱 탭/);
    assert.equal(h.calls.filter(value=>value[0]==='read').length,1);
    assert.equal(h.calls.some(value=>['fetch','create','remove'].includes(value[0])),false);
  }
  const h=harness();h.tabs.get(9).pendingUrl='https://login.1688.com/';
  await assert.rejects(h.run(),/로그인/);assert.deepEqual(h.calls.map(value=>value[0]),['query']);
});

test('same-URL reload discards the pre-reload snapshot rather than shortening the quiet requirement',async()=>{
  const final=structuredClone(source);final.hasVariant[0].offers.price='17.2';
  const h=harness({snapshots:[source,final],fetcher:()=>{throw Error('public source unavailable');},onRead:({tabs,reads})=>{if(reads===1)tabs.get(9).status='loading';},onWait:({tabs})=>{tabs.get(9).status='complete';}});
  const result=await h.run();
  assert.equal(productSnapshotReady(result.scripts,sourceUrl).options[0].unitPriceCny,17.2);
  assert.equal(h.calls.filter(value=>value[0]==='read').length,6);
  assert.equal(h.calls.filter(value=>value[0]==='query').length,1);
  assert.equal(h.calls.some(value=>['create','remove'].includes(value[0])),false);
});

test('request cancellation during the fast quiet period stops without mobile calls and releases the capture lane',async()=>{
  const h=harness({onWait:()=>{assert.equal(cancel1688Capture({...request,type:'YOOFAM_CANCEL_1688'},sender).cancelled,true);}});
  await assert.rejects(h.run(),/취소/);
  assert.equal(h.calls.filter(value=>value[0]==='read').length,1);
  assert.equal(h.calls.some(value=>['fetch','create','remove'].includes(value[0])),false);
  assert.equal((await harness().run()).ok,true);
});

test('a stalled existing DOM read cannot delay the mobile branch beyond the one-second probe limit or add late reads',async()=>{
  let release,entered=false;
  const h=harness({onRead:async()=>{entered=true;await new Promise(resolve=>{release=resolve;});}});
  const started=Date.now(),result=await h.run();
  assert.equal(entered,true);assert.equal(result.format,'1688-public-sku-capture-v1');
  assert.ok(Date.now()-started<2500,'the pending Chrome read must not consume the 12-second mobile deadline');
  assert.equal(h.calls.filter(value=>value[0]==='read').length,1);
  release();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(h.calls.filter(value=>value[0]==='read').length,1);
  assert.equal(h.calls.some(value=>['create','remove'].includes(value[0])),false);
});

test('a matching tab that changes while mobile evidence is pending cannot return that evidence',async()=>{
  const h=harness({snapshots:[null],fetcher:async(url)=>{
    h.tabs.get(9).windowId=18;
    return url.hostname==='m.1688.com'?new Response('<html>No data</html>',{headers:{'content-type':'text/html'}}):Response.json(publicSku);
  }});
  await assert.rejects(h.run(),/Chrome 창/);
  assert.equal(h.calls.filter(value=>value[0]==='fetch').length,1);
  assert.equal(h.calls.some(value=>['create','remove'].includes(value[0])),false);
});
