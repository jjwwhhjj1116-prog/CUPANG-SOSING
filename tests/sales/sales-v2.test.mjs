import test from 'node:test';
import assert from 'node:assert/strict';
import {
  count, numericId, productKey, unavailable,
  validateProducts, validateSalesSender, selectMetrics,
} from '../../extensions/supplier-hub/sales-core.mjs';
import {fetchWingCatalog} from '../../extensions/supplier-hub/sales-page.mjs';
import {lookupSales,openSalesWing,registerSalesListener,cancelSales} from '../../extensions/supplier-hub/sales-service.mjs';

const EXTENSION_ID = 'yoofam-test-extension';
const product = {productId:'123456789',itemId:'345678901',vendorItemId:'567890123',title:'겨울 넥워머'};
const sender = {
  id:EXTENSION_ID,frameId:0,url:'https://www.coupang.com/np/search?q=%EB%84%A5%EC%9B%8C%EB%A8%B8',
  tab:{id:11,windowId:5,url:'https://www.coupang.com/np/search?q=test'},
};

test('counts preserve legitimate zero and reject missing, fractional, and unsafe values', () => {
  for (const value of [0,'0']) assert.equal(count(value),0);
  for (const value of [1234,'1234','1,234']) assert.equal(count(value),1234);
  assert.equal(count('123,456,789'),123456789);
  for (const value of [null,undefined,'',true,false,-1,'-1',1.5,'1.5','1e3','1,23','1234,567',NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'9007199254740992']) {
    assert.equal(count(value),null,`must not count ${String(value)}`);
  }
});

test('IDs are preserved as decimal strings without unsafe numeric coercion', () => {
  assert.equal(numericId('12345678901234567890'),'12345678901234567890');
  assert.equal(numericId(123456789),'123456789');
  assert.equal(numericId(undefined),null);
  assert.equal(numericId(''),null);
  for (const value of [undefined,null,'']) assert.throws(() => numericId(value,true));
  for (const value of ['abc','123/456','1e5','-2',0,'0','0123',1.2,Number.MAX_SAFE_INTEGER+1,'123456789012345678901',{},true]) {
    assert.throws(() => numericId(value),`must reject ID ${String(value)}`);
  }
});

test('batch validation restricts requests and never sends arbitrary page properties', () => {
  for (const value of [null,{},[],Array.from({length:11},()=>product)]) assert.throws(() => validateProducts(value));
  for (const value of [{...product,productId:undefined},{...product,itemId:'abc'}]) assert.throws(() => validateProducts([value]));
  const [clean] = validateProducts([{...product,title:'  겨울 넥워머  ',cookie:'secret',account:'private',accessToken:'token'}]);
  assert.equal(clean.productId,product.productId);
  assert.equal(clean.itemId,product.itemId);
  assert.equal(clean.vendorItemId,product.vendorItemId);
  assert.equal(clean.title,'겨울 넥워머');
  assert.equal(clean.cookie,undefined);
  assert.equal(clean.account,undefined);
  assert.equal(clean.accessToken,undefined);
});

test('product keys distinguish product, item, and vendor variants', () => {
  const variants = [product,{...product,productId:'2'},{...product,itemId:'2'},{...product,vendorItemId:'2'},{productId:product.productId}];
  assert.equal(new Set(variants.map(productKey)).size,variants.length);
  assert.equal(productKey({...product,title:'different title'}),productKey(product));
});

test('lookup messages are accepted only from own extension in top-level Coupang product/search pages', () => {
  assert.deepEqual(validateSalesSender(sender,EXTENSION_ID),sender.tab);
  for (const url of ['https://www.coupang.com/vp/products/123456','https://www.coupang.com/np/categories/12345']) {
    assert.deepEqual(validateSalesSender({...sender,url},EXTENSION_ID),sender.tab);
  }
  for (const override of [
    {id:'another-extension'}, {frameId:1}, {tab:{id:'11'}}, {tab:{id:11}}, {tab:{id:11,windowId:'5'}}, {tab:undefined},
    {url:'http://www.coupang.com/np/search'},
    {url:'https://www.coupang.com.evil.example/np/search'},
    {url:'https://wing.coupang.com/np/search'},
    {url:'https://www.coupang.com/np/search-evil'},
    {url:'https://www.coupang.com/login'}, {url:'not a URL'},
  ]) assert.throws(() => validateSalesSender({...sender,...override},EXTENSION_ID));
});

test('unavailable means null rather than zero and keeps the actual 28-day source period', () => {
  const result = unavailable(product,'해당 옵션 없음');
  assert.equal(result.status,'unavailable');
  assert.equal(result.monthlySales,null);
  assert.equal(result.views,null);
  assert.equal(result.periodDays,28);
  assert.equal(result.productId,product.productId);
  assert.equal(result.error,'해당 옵션 없음');
  assert.ok(Number.isFinite(Date.parse(result.asOf)));
});

const row = (overrides={}) => ({productId:product.productId,itemId:product.itemId,vendorItemId:product.vendorItemId,salesLast28d:40,pvLast28Day:200,...overrides});

test('matching requires product ID and prefers exact item and vendor when available', () => {
  assert.equal(selectMetrics([row({productId:'999',title:product.title})],product),null);
  assert.equal(selectMetrics([row({productId:'999',itemId:product.productId})],product),null);
  assert.equal(selectMetrics([row({itemId:'999'}),row({salesLast28d:12})],product)?.monthlySales,12);
  assert.equal(selectMetrics([row({vendorItemId:'999',salesLast28d:999}),row()],product)?.monthlySales,40);
  assert.throws(() => selectMetrics({},product));
});

test('unambiguous exact-product fallback retains source IDs without claiming requested-option statistics', () => {
  const source=row({itemId:'999',vendorItemId:'888'});
  const fallback=selectMetrics([source],product);
  assert.equal(fallback.monthlySales,40);
  assert.equal(fallback.sourceItemId,'999');
  assert.equal(fallback.sourceVendorItemId,'888');
  assert.equal(fallback.matchedBy,'product');
  assert.equal(fallback.scope,'source-defined');
  const consistent=selectMetrics([source,row({itemId:undefined,vendorItemId:undefined})],product);
  assert.equal(consistent.monthlySales,40);
  assert.equal(consistent.matchedBy,'product');
  assert.equal(selectMetrics([row()],{productId:product.productId}).matchedBy,'product');
  assert.equal(selectMetrics([row({itemId:'',vendorItemId:''})],product).matchedBy,'product');
});

test('conflicting product fallback or duplicate exact-vendor rows remain ambiguous', () => {
  assert.equal(selectMetrics([
    row({itemId:'991',vendorItemId:'881',salesLast28d:10}),
    row({itemId:'992',vendorItemId:'882',salesLast28d:20}),
  ],product),null);
  assert.equal(selectMetrics([
    row({itemId:'991',vendorItemId:'881',pvLast28Day:100}),
    row({itemId:'992',vendorItemId:'882',pvLast28Day:200}),
  ],product),null);
  assert.equal(selectMetrics([row({salesLast28d:10}),row({salesLast28d:20})],product),null);
  assert.equal(selectMetrics([
    row({itemId:'991',vendorItemId:'881',salesLast28d:999}),
    row({itemId:'992',salesLast28d:25}),
  ],product).monthlySales,25);
});

test('matching distinguishes missing, zero, ambiguous variants, and product-level data', () => {
  const noVendor = {...product,vendorItemId:null};
  assert.equal(selectMetrics([row({salesLast28d:1}),row({salesLast28d:2})],noVendor),null);
  assert.equal(selectMetrics([row({salesLast28d:0,pvLast28Day:0})],product)?.monthlySales,0);
  assert.equal(selectMetrics([row({salesLast28d:null,pvLast28Day:null})],product),null);
  assert.equal(selectMetrics([row({salesLast28d:undefined})],product)?.monthlySales,null);
  assert.equal(selectMetrics([row({pvLast28Day:undefined})],product)?.views,null);
  const aggregate = selectMetrics([row({itemId:undefined,vendorItemId:undefined})],product);
  assert.equal(aggregate?.scope,'source-defined');
  assert.equal(aggregate?.matchedBy,'product');
  assert.equal(selectMetrics([row()],product)?.matchedBy,'item');
  assert.equal(aggregate?.sourceItemId,null);
});

test('unsafe server-side identifiers cannot accidentally match the requested decimal ID', () => {
  assert.equal(selectMetrics([row({productId:Number.MAX_SAFE_INTEGER+1})],{productId:'9007199254740992'}),null);
  const source=selectMetrics([row({itemId:'invalid',vendorItemId:'invalid'})],product);
  assert.equal(source.monthlySales,40);
  assert.equal(source.matchedBy,'product');
  assert.equal(source.sourceItemId,null);
  assert.equal(source.sourceVendorItemId,null);
  assert.equal(selectMetrics([row({productId:'invalid'})],product),null);
});

async function withGlobals(values, action) {
  const previous = new Map(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(values)) Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  try { return await action(); }
  finally { for(const [key,descriptor] of previous) descriptor ? Object.defineProperty(globalThis,key,descriptor) : delete globalThis[key]; }
}
const endpoint = 'https://wing.coupang.com/tenants/seller-web/pre-matching/search';
const wingLocation = {origin:'https://wing.coupang.com',pathname:'/tenants/rfm/coupang-trends/popularity-search'};
function response({status=200,type='application/json',body={result:[row()]},url=endpoint,redirected=false,text,retryAfter=null}={}) {
  return {status,ok:status>=200&&status<300,url,redirected,headers:{get:key=>key==='content-type'?type:key==='retry-after'?retryAfter:null},text:async()=>text??JSON.stringify(body)};
}
async function runPage(res=response(),cookie='',keyword=product.title) {
  const requests=[];
  const result = await withGlobals({location:wingLocation,document:{cookie},fetch:async(url,options)=>{requests.push({url,options});if(res instanceof Error)throw res;return res;}},()=>fetchWingCatalog(keyword));
  return {result,requests};
}

test('Wing lookup uses the observed first-party POST and returns aggregate fields only', async () => {
  const {result,requests} = await runPage(response({body:{result:[{...row(),sellerName:'private seller',accessToken:'secret',cookie:'private'}]}}),'other=private; XSRF-TOKEN=abc%2F123');
  assert.equal(result.ok,true);
  assert.equal(requests.length,1);
  const {url,options}=requests[0];
  assert.equal(url,'/tenants/seller-web/pre-matching/search');
  assert.equal(options.method,'POST');
  assert.equal(options.credentials,'same-origin');
  assert.equal(options.redirect,'error');
  assert.equal(options.cache,'no-store');
  assert.equal(options.headers['x-xsrf-token'],'abc/123');
  assert.deepEqual(JSON.parse(options.body),{keyword:product.title,excludedProductIds:[],searchPage:0,searchOrder:'DEFAULT',sortType:'DEFAULT'});
  assert.deepEqual(result.rows,[row()]);
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.ok(!JSON.stringify(result).includes('private'));
});

test('Wing valid JSON body is accepted under plain, missing, and vendor JSON MIME types', async () => {
  for(const type of ['text/plain','text/plain; charset=utf-8','','application/vnd.coupang+json',null]) {
    const {result,requests}=await runPage(response({type,body:{result:[row({salesLast28d:0,pvLast28Day:12})]}}));
    assert.equal(result.ok,true,`valid JSON must be accepted when Content-Type is ${String(type)}`);
    assert.deepEqual(result.rows,[row({salesLast28d:0,pvLast28Day:12})]);
    assert.equal(requests.length,1);
  }
});

test('Wing HTTP-200 HTML is a response-type error without declaring a login failure or exposing HTML', async () => {
  for(const type of ['text/html; charset=utf-8','text/plain','','application/json']) {
    const {result}=await runPage(response({type,text:'  \n<!doctype html><html><title>Wing</title><body>private-session-marker</body></html>'}));
    assert.equal(result.ok,false);
    assert.equal(result.code,'RESPONSE_TYPE');
    assert.equal(result.rows,undefined);
    assert.ok(!JSON.stringify(result).includes('private-session-marker'));
    assert.ok(!JSON.stringify(result).includes('<html>'));
  }
});

test('Wing login, redirect, rate-limit, and server errors cannot become zero sales', async () => {
  const cases=[
    [response({status:401}),'LOGIN'],[response({status:403}),'LOGIN'],
    [response({status:429}),'RATE_LIMIT'],[response({status:500}),'HTTP'],
    [response({redirected:true}),'LOGIN'],[response({url:'https://wing.coupang.com/login'}),'LOGIN'],
    [response({url:'https://evil.example/catalog'}),'LOGIN'],
  ];
  for(const [res,code] of cases) {
    const {result}=await runPage(res);
    assert.equal(result.ok,false);
    assert.equal(result.code,code);
    assert.equal(result.rows,undefined);
  }
});

test('Wing page fallback respects short Retry-After waits and preserves unknown-duration fallback', async () => {
  const clockNow=Date.parse('2026-10-06T00:20:00Z');
  class FixedDate extends Date {static now(){return clockNow;}}
  await withGlobals({Date:FixedDate},async()=>{
    for(const [retryAfter,expected] of [
      ['15',15000],['1',1000],['0',1000],
      [new FixedDate(clockNow+15000).toUTCString(),15000],
      [new FixedDate(clockNow-1000).toUTCString(),1000],
      [null,60000],['invalid',60000],['-1',60000],['3600',3600000],
    ]) {
      const {result,requests}=await runPage(response({status:429,retryAfter}));
      assert.equal(result.code,'RATE_LIMIT');
      assert.equal(result.retryAfterMs,expected);
      assert.equal(requests.length,1,'fallback must return the wait without early network retries');
    }
  });
});

test('Wing schema errors and transport failure are explicit, with no fabricated counts', async () => {
  for(const res of [response({body:{data:[]}}),response({body:{result:null}}),response({body:{result:{}}}),response({text:'{broken json'}),response({text:'x'.repeat(2*1024*1024+1)})]) {
    const {result}=await runPage(res);
    assert.equal(result.ok,false);
    assert.equal(result.code,'SCHEMA');
  }
  assert.deepEqual((await runPage(response({body:{result:[]}}))).result,{ok:true,rows:[]});
  assert.equal((await runPage(new Error('fetch failed'))).result.code,'NETWORK');
  assert.equal((await runPage(Object.assign(new Error('aborted'),{name:'AbortError'}))).result.code,'TIMEOUT');
});

test('Wing rejects wrong origin, login pages, and empty or oversized query before network', async () => {
  let calls=0;
  for(const location of [{origin:'https://www.coupang.com',pathname:'/'},{...wingLocation,pathname:'/login'},{...wingLocation,pathname:'/sso/login'}]) {
    const result=await withGlobals({location,document:{cookie:''},fetch:()=>{calls++;}},()=>fetchWingCatalog('test'));
    assert.equal(result.code,'LOGIN');
  }
  assert.equal(calls,0);
  for(const keyword of ['',null,'  ','a'.repeat(251)]) {
    const {result,requests}=await runPage(response(),'',keyword);
    assert.equal(result.code,'INPUT');
    assert.equal(requests.length,0);
  }
});

test('Wing sanitization cannot return nested private data in allowed field names', async () => {
  const {result}=await runPage(response({body:{result:[row({itemId:{private:'secret'},salesLast28d:{token:'secret'},pvLast28Day:true})]}}));
  assert.equal(result.ok,true);
  assert.equal(result.rows[0].itemId,null);
  assert.equal(result.rows[0].salesLast28d,null);
  assert.equal(result.rows[0].pvLast28Day,null);
  assert.ok(!JSON.stringify(result).includes('secret'));
});

let nextTabId=100;
let fakeNow=1000000000000;
const fastTiming={now:()=>fakeNow,sleep:async ms=>{fakeNow+=ms;}};
function fakeChrome({rows=[row()],responses,wingOverrides={},execute,sessionData={}}={}) {
  // Each independent fixture begins beyond any prior test's maximum cooldown.
  // Concurrent/gate tests construct all fixtures before starting their requests.
  fakeNow+=901000;
  const wing={id:nextTabId++,windowId:sender.tab.windowId,status:'complete',url:wingLocation.origin+wingLocation.pathname,...wingOverrides};
  const calls={queries:[],gets:[],executions:[],updates:[],creates:[],listeners:[],sessionReads:[],sessionWrites:[]};
  let index=0;
  const api={
    runtime:{id:EXTENSION_ID,onMessage:{addListener:fn=>calls.listeners.push(fn)}},
    tabs:{
      query:async request=>{calls.queries.push(request);return [wing];},
      get:async id=>{calls.gets.push(id);return {...wing};},
      update:async(...args)=>{calls.updates.push(args);},
      create:async arg=>{calls.creates.push(arg);},
    },
    scripting:{executeScript:async request=>{
      calls.executions.push(request);
      if(execute)return execute(request,calls.executions.length);
      return [{frameId:0,documentId:'wing-document-A',result:responses?.[index++]??{ok:true,rows}}];
    }},
    storage:{session:{
      get:async key=>{calls.sessionReads.push(key);return structuredClone(sessionData);},
      set:async values=>{calls.sessionWrites.push(structuredClone(values));Object.assign(sessionData,structuredClone(values));},
    }},
  };
  for(const area of ['local','sync'])Object.defineProperty(api.storage,area,{get(){throw Error('Sales must not use local/sync storage');}});
  return {api,wing,calls,sessionData};
}
const lookup = (api,products=[product],source=sender,requestCatalog,timing=fastTiming,options={})=>lookupSales({type:'YF_SALES_LOOKUP',products,force:true,...options},source,api,requestCatalog,timing);

test('healthy requests start 600ms apart and rate limits adapt spacing to 1500ms then at most 3000ms', async () => {
  const {api}=fakeChrome();
  const starts=[];
  let limited=false;
  const request=async()=>{
    starts.push(fastTiming.now());
    return limited?{ok:false,code:'RATE_LIMIT',error:'limited'}:{ok:true,rows:[row()]};
  };
  await lookup(api,[product],sender,request);
  await lookup(api,[product],sender,request);
  assert.equal(starts[1]-starts[0],600);
  limited=true;
  const firstLimit=await lookup(api,[product],sender,request);
  assert.equal(firstLimit.halt.retryAfterMs,60000);
  fakeNow+=60000;limited=false;
  await lookup(api,[product],sender,request);
  await lookup(api,[product],sender,request);
  assert.equal(starts.at(-1)-starts.at(-2),1500);
  for(let attempt=0;attempt<2;attempt++) {
    limited=true;await lookup(api,[product],sender,request);
    fakeNow+=60000;limited=false;
    await lookup(api,[product],sender,request);
    await lookup(api,[product],sender,request);
    assert.equal(starts.at(-1)-starts.at(-2),3000);
  }
});

test('service uses direct worker transport without injecting a page when it succeeds', async () => {
  const {api,wing,calls}=fakeChrome();
  const requests=[];
  const direct=async(...args)=>{requests.push(args);return {ok:true,rows:[row({salesLast28d:63})]};};
  const result=await lookup(api,[product],sender,direct);
  assert.equal(result.ok,true);
  assert.equal(result.results[0].monthlySales,63);
  assert.equal(result.results[0].periodDays,28);
  assert.equal(result.halt,undefined);
  assert.equal(requests.length,1);
  assert.equal(requests[0][0],product.title);
  assert.equal(requests[0][1],wing.id);
  assert.equal(requests[0][2],api);
  assert.equal(calls.executions.length,0);
});

test('only network and cookie-context transport failures fall back to the bound Wing page', async () => {
  for(const code of ['NETWORK','COOKIE_STORE']) {
    const {api,wing,calls}=fakeChrome();
    let requests=0;
    const result=await lookup(api,[product],sender,async()=>{requests++;return {ok:false,code,error:'transport context unavailable'};});
    assert.equal(result.results[0].status,'ok');
    assert.equal(requests,1);
    assert.equal(calls.executions.length,1);
    assert.equal(calls.executions[0].target.tabId,wing.id);
  }
});

test('HTML, 401, 403, and 429 direct responses halt without page fallback or product-ID retries', async () => {
  for(const [code,error] of [
    ['RESPONSE_TYPE','HTTP 200 HTML'],['LOGIN','HTTP 401'],['LOGIN','HTTP 403'],['RATE_LIMIT','HTTP 429'],
    ['SCHEMA','invalid JSON schema'],
  ]) {
    const {api,calls}=fakeChrome();
    let requests=0;
    const result=await lookup(api,[product,{...product,productId:'111111111',itemId:'222222222',vendorItemId:'333333333'}],sender,
      async()=>{requests++;return {ok:false,code,error};});
    assert.equal(result.ok,true);
    assert.deepEqual(result.halt,{code,error,...(code==='RATE_LIMIT'?{retryAfterMs:60000}:{})});
    assert.equal(result.results.length,code==='RATE_LIMIT'?0:1);
    if(code!=='RATE_LIMIT') {
      assert.equal(result.results[0].productId,product.productId);
      assert.equal(result.results[0].status,'error');
      assert.equal(result.results[0].monthlySales,null);
      assert.equal(result.results[0].views,null);
    }
    assert.equal(requests,1);
    assert.equal(calls.executions.length,0);
  }
});

test('partial batch keeps completed products and marks exactly the failed attempted product', async () => {
  const {api,calls}=fakeChrome();
  const second={...product,productId:'222222222',itemId:'333333333',vendorItemId:'444444444',title:'두 번째 상품'};
  const third={...product,productId:'555555555',itemId:'666666666',vendorItemId:'777777777',title:'조회하지 않을 상품'};
  const requests=[];
  const result=await lookup(api,[product,second,third],sender,async keyword=>{
    requests.push(keyword);
    return requests.length===1 ? {ok:true,rows:[row({salesLast28d:42})]} : {ok:false,code:'RESPONSE_TYPE',error:'Wing HTML 응답'};
  });
  assert.equal(result.ok,true);
  assert.deepEqual(result.results.map(r=>r.productId),[product.productId,second.productId]);
  assert.equal(result.results[0].status,'ok');
  assert.equal(result.results[0].monthlySales,42);
  assert.equal(result.results[1].status,'error');
  assert.equal(result.results[1].itemId,second.itemId);
  assert.equal(result.results[1].monthlySales,null);
  assert.deepEqual(result.halt,{code:'RESPONSE_TYPE',error:'Wing HTML 응답'});
  assert.deepEqual(requests,[product.title,second.title]);
  assert.equal(calls.executions.length,0);
});

test('closing or navigating Wing after one success retains it without inventing a failed product', async () => {
  for(const reason of ['closed','moved']) {
    const {api,wing}=fakeChrome();
    let finished=false,requests=0;
    api.tabs.get=async()=>{
      if(finished && reason==='closed')throw Error('Wing tab closed');
      return finished?{...wing,url:'https://example.com/'}:wing;
    };
    const second={...product,productId:'222222222',title:'두 번째 상품'};
    const result=await lookup(api,[product,second],sender,async()=>{
      requests++;finished=true;return {ok:true,rows:[row()]};
    });
    assert.equal(result.results.length,1);
    assert.equal(result.results[0].productId,product.productId);
    assert.equal(result.results[0].status,'ok');
    assert.equal(result.results[0].monthlySales,40);
    assert.equal(result.halt.code,'INTERRUPTED');
    assert.equal(requests,1);
  }
});

test('concurrent Coupang tabs share serialized starts across the same or different Wing tabs', async () => {
  for(const sameWing of [true,false]) {
    const firstApi=fakeChrome();
    const secondApi=fakeChrome({wingOverrides:sameWing?{id:firstApi.wing.id}:{}});
    let release,started;
    const held=new Promise(resolve=>{release=resolve;});
    const ready=new Promise(resolve=>{started=resolve;});
    const starts=[];
    let inFlight=0,maxInFlight=0;
    const firstRequest=async()=>{
      starts.push(fastTiming.now());inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
      started();await held;inFlight--;return {ok:true,rows:[row()]};
    };
    const secondRequest=async()=>{
      starts.push(fastTiming.now());inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
      inFlight--;return {ok:true,rows:[row()]};
    };
    const first=lookup(firstApi.api,[product],sender,firstRequest);
    await ready;
    const otherSender={...sender,tab:{...sender.tab,id:sender.tab.id+1}};
    const second=lookup(secondApi.api,[product],otherSender,secondRequest);
    await Promise.resolve();await Promise.resolve();
    assert.equal(starts.length,1);
    release();
    const results=await Promise.all([first,second]);
    assert.equal(results.every(value=>value.results[0].status==='ok'),true);
    assert.equal(maxInFlight,1);
    assert.equal(starts.length,2);
    assert.ok(starts[1]-starts[0]>=600);
  }
});

test('pacing covers title fallback and separate batches without a redundant product delay', async () => {
  const {api}=fakeChrome();
  const starts=[],queries=[];
  const request=async keyword=>{
    starts.push(fastTiming.now());queries.push(keyword);
    return {ok:true,rows:queries.length===1?[]:[row()]};
  };
  assert.equal((await lookup(api,[product],sender,request)).results[0].status,'ok');
  assert.equal((await lookup(api,[product],sender,request)).results[0].status,'ok');
  assert.deepEqual(queries,[product.title,product.productId,product.title]);
  const gaps=starts.slice(1).map((start,index)=>start-starts[index]);
  assert.equal(gaps[0],gaps[1]);
  assert.ok(gaps.every(gap=>gap>=600&&gap<=3000));
});

test('cancellation interrupts a pacing wait before another query starts', async () => {
  const {api}=fakeChrome();
  let requests=0,waitStarted,releaseWait;
  const request=async()=>{requests++;return {ok:true,rows:[row()]};};
  await lookup(api,[product],sender,request);
  const started=new Promise(resolve=>{waitStarted=resolve;});
  const timing={now:fastTiming.now,sleep:ms=>{waitStarted();return new Promise(resolve=>{releaseWait=()=>{fakeNow+=ms;resolve();};});}};
  const waiting=lookup(api,[product],sender,request,timing);
  await started;
  cancelSales(sender,api);
  await assert.rejects(waiting,/중지/);
  assert.equal(requests,1);
  releaseWait();
  assert.equal((await lookup(api,[product],sender,request)).results[0].status,'ok');
  assert.equal(requests,2);
});

test('cancellation of a queued tab does not let another tab overlap the in-flight request', async () => {
  const {api}=fakeChrome();
  let release,started;
  const held=new Promise(resolve=>{release=resolve;});
  const ready=new Promise(resolve=>{started=resolve;});
  let requests=0;
  const first=lookup(api,[product],sender,async()=>{requests++;started();await held;return {ok:true,rows:[row()]};});
  await ready;
  const otherSender={...sender,tab:{...sender.tab,id:sender.tab.id+1}};
  const waiting=lookup(api,[product],otherSender,async()=>{requests++;return {ok:true,rows:[row()]};});
  await Promise.resolve();await Promise.resolve();
  cancelSales(otherSender,api);
  await assert.rejects(waiting,/중지/);
  assert.equal(requests,1);
  release();await first;
});

test('Retry-After cooldown is shared by Wing tabs, honors long server waits, and never retries automatically', async () => {
  for(const [retryAfterMs,expected] of [[undefined,60000],[0,1000],[1000,1000],[15000,15000],[-1,60000],[120000,120000],[Infinity,60000],[3600000,3600000]]) {
    const firstApi=fakeChrome(),otherApi=fakeChrome();
    let requests=0;
    const request=async()=>{requests++;return requests===1?{ok:false,code:'RATE_LIMIT',error:'limited',retryAfterMs}:{ok:true,rows:[row()]};};
    const stopped=await lookup(firstApi.api,[product],sender,request);
    assert.equal(stopped.halt.retryAfterMs,expected);
    const otherSender={...sender,tab:{...sender.tab,id:sender.tab.id+1}};
    const cooldown=await lookup(otherApi.api,[product],otherSender,request);
    assert.equal(cooldown.halt.code,'RATE_LIMIT');assert.deepEqual(cooldown.results,[]);
    assert.equal(requests,1);
    fakeNow+=expected-1;
    const almost=await lookup(firstApi.api,[product],sender,request);
    assert.equal(almost.halt.code,'RATE_LIMIT');assert.equal(almost.halt.retryAfterMs,1);assert.deepEqual(almost.results,[]);
    assert.equal(requests,1);
    fakeNow++;
    assert.equal((await lookup(otherApi.api,[product],otherSender,request)).results[0].status,'ok');
    assert.equal(requests,2);
  }
});

test('worker restart restores session cooldown and adaptive spacing before any network query', async () => {
  const {api,calls,sessionData}=fakeChrome();
  const firstWorker=await import('../../extensions/supplier-hub/sales-service.mjs?session-worker-before-restart');
  const message={type:'YF_SALES_LOOKUP',products:[product],force:true};
  let requests=0,releaseWrite,writeStarted,settled=false;
  const starts=[];
  const writing=new Promise(resolve=>{writeStarted=resolve;});
  const heldWrite=new Promise(resolve=>{releaseWrite=resolve;});
  const save=api.storage.session.set;
  api.storage.session.set=async value=>{writeStarted();await heldWrite;await save(value);};
  const request=async()=>{requests++;starts.push(fastTiming.now());return requests===1?{ok:false,code:'RATE_LIMIT',error:'limited',retryAfterMs:60000}:{ok:true,rows:[row()]};};
  const first=firstWorker.lookupSales(message,sender,api,request,fastTiming).then(value=>{settled=true;return value;});
  await writing;
  assert.equal(settled,false,'rate halt must wait until session state has been saved');
  releaseWrite();
  assert.equal((await first).halt.retryAfterMs,60000);
  assert.deepEqual(Object.keys(sessionData),['yfSalesThrottleV1']);
  assert.deepEqual(Object.keys(sessionData.yfSalesThrottleV1).sort(),['cooldownUntil','querySpacingMs']);
  assert.equal(sessionData.yfSalesThrottleV1.querySpacingMs,1500);

  fakeNow+=30000;
  const restartedWorker=await import('../../extensions/supplier-hub/sales-service.mjs?session-worker-after-restart');
  restartedWorker.registerSalesListener(api);
  assert.equal(calls.listeners.length,1,'worker message listener is registered synchronously');
  const cooling=await restartedWorker.lookupSales(message,sender,api,request,fastTiming);
  assert.equal(cooling.halt.retryAfterMs,30000);
  assert.deepEqual(cooling.results,[]);
  assert.equal(requests,1,'restarting a worker cannot skip the server cooldown');
  fakeNow+=30000;
  assert.equal((await restartedWorker.lookupSales(message,sender,api,request,fastTiming)).results[0].status,'ok');
  await restartedWorker.lookupSales(message,sender,api,request,fastTiming);
  assert.equal(starts.at(-1)-starts.at(-2),1500);
  assert.deepEqual(calls.sessionReads,['yfSalesThrottleV1','yfSalesThrottleV1']);
  assert.equal(calls.sessionWrites.length,1);
});

test('session hydration accepts only bounded numeric throttle state and fails before network when unreadable', async () => {
  const {api,calls}=fakeChrome({sessionData:{yfSalesThrottleV1:{cooldownUntil:'9999999999999999',querySpacingMs:999999,cookie:'must never be read'}}});
  const worker=await import('../../extensions/supplier-hub/sales-service.mjs?invalid-session-state');
  const message={type:'YF_SALES_LOOKUP',products:[product],force:true};
  const starts=[];
  const request=async()=>{starts.push(fastTiming.now());return {ok:true,rows:[row()]};};
  await worker.lookupSales(message,sender,api,request,fastTiming);
  await worker.lookupSales(message,sender,api,request,fastTiming);
  assert.equal(starts[1]-starts[0],600);
  assert.equal(calls.sessionWrites.length,0);
  const unreadable=fakeChrome();
  unreadable.api.storage.session.get=async()=>{throw Error('session unavailable');};
  await assert.rejects(worker.lookupSales(message,sender,unreadable.api,async()=>assert.fail('network must wait for session hydration'),fastTiming),/session unavailable/);
});

test('product fallback preserves requested tuple separately from original catalog IDs', async () => {
  const {api,calls}=fakeChrome();
  const result=await lookup(api,[product],sender,async()=>({ok:true,rows:[row({itemId:'999',vendorItemId:'888'})]}));
  const found=result.results[0];
  assert.equal(found.status,'ok');
  assert.equal(found.productId,product.productId);
  assert.equal(found.itemId,product.itemId);
  assert.equal(found.vendorItemId,product.vendorItemId);
  assert.equal(found.sourceItemId,'999');
  assert.equal(found.sourceVendorItemId,'888');
  assert.equal(found.matchedBy,'product');
  assert.equal(found.scope,'source-defined');
  assert.equal(calls.executions.length,0);
});

test('service targets current window Wing and reports 28-day aggregate provenance', async () => {
  const {api,wing,calls}=fakeChrome();
  const response=await lookup(api);
  assert.equal(response.ok,true);
  assert.deepEqual(calls.queries,[{windowId:sender.tab.windowId,url:'https://wing.coupang.com/*'}]);
  assert.equal(calls.executions[0].target.tabId,wing.id);
  assert.equal(calls.executions[0].world,'ISOLATED');
  assert.equal(calls.executions[0].func,fetchWingCatalog);
  assert.deepEqual(calls.executions[0].args,[product.title]);
  assert.equal(response.results[0].monthlySales,40);
  assert.equal(response.results[0].views,200);
  assert.equal(response.results[0].periodDays,28);
  assert.equal(response.results[0].title,undefined);
  assert.equal(response.results[0].status,'ok');
});

test('service falls back to product ID query and never accepts title-only matches', async () => {
  const {api,calls}=fakeChrome({responses:[{ok:true,rows:[row({productId:'999',title:product.title})]},{ok:true,rows:[row({salesLast28d:22})]}]});
  assert.equal((await lookup(api)).results[0].monthlySales,22);
  assert.deepEqual(calls.executions.map(item=>item.args),[[product.title],[product.productId]]);
  const miss=fakeChrome({rows:[row({productId:'999'})]});
  const result=(await lookup(miss.api)).results[0];
  assert.equal(result.status,'unavailable');
  assert.equal(result.monthlySales,null);
});

test('explicit force performs fresh reads across calls', async () => {
  const {api,calls}=fakeChrome({responses:[{ok:true,rows:[row({salesLast28d:5})]},{ok:true,rows:[row({salesLast28d:9})]}]});
  assert.equal((await lookup(api)).results[0].monthlySales,5);
  assert.equal((await lookup(api)).results[0].monthlySales,9);
  assert.equal(calls.executions.length,2);
});

test('actual search keyword prefetch covers multiple products and preserves original cache timestamps', async () => {
  const {api}=fakeChrome();
  const second={...product,productId:'222222222',title:'두 번째 상품'};
  const queries=[];
  const request=async query=>{queries.push(query);return {ok:true,rows:[row(),row({productId:second.productId,salesLast28d:12})]};};
  const options={force:false,keyword:'넥워머'};
  const first=await lookup(api,[product,second],sender,request,fastTiming,options);
  assert.deepEqual(queries,['넥워머']);
  assert.deepEqual(first.results.map(result=>result.monthlySales),[40,12]);
  const original=first.results[0].asOf;
  fakeNow+=10000;
  const repeated=await lookup(api,[second],sender,request,fastTiming,options);
  assert.equal(repeated.results[0].asOf,original);
  assert.equal(queries.length,1);
});

test('mismatched or malformed keyword never creates a prefetch, and force skips prefetch', async () => {
  for(const options of [{force:false,keyword:'다른 검색어'},{force:false,keyword:'넥워머\n악성'},{force:true,keyword:'넥워머'}]) {
    const {api}=fakeChrome();const queries=[];
    await lookup(api,[product],sender,async query=>{queries.push(query);return {ok:true,rows:[row()]};},fastTiming,options);
    assert.deepEqual(queries,[product.title]);
  }
});

test('force bypasses cache reads but replaces cached metrics for subsequent ordinary lookups', async () => {
  const {api}=fakeChrome();let requests=0;
  const request=async()=>({ok:true,rows:[row({salesLast28d:++requests*10})]});
  const first=await lookup(api,[product],sender,request,fastTiming,{force:false});
  fakeNow+=1000;
  const refreshed=await lookup(api,[product],sender,request);
  fakeNow+=1000;
  const cached=await lookup(api,[product],sender,request,fastTiming,{force:false});
  assert.equal(first.results[0].monthlySales,10);
  assert.equal(refreshed.results[0].monthlySales,20);
  assert.equal(cached.results[0].monthlySales,20);
  assert.equal(cached.results[0].asOf,refreshed.results[0].asOf);
  assert.notEqual(cached.results[0].asOf,first.results[0].asOf);
  assert.equal(requests,2);
});

test('concurrent same-query lookups coalesce inside the shared dispatch gate', async () => {
  const {api}=fakeChrome();let release,started,requests=0;
  const held=new Promise(resolve=>{release=resolve;});
  const ready=new Promise(resolve=>{started=resolve;});
  const request=async()=>{requests++;started();await held;return {ok:true,rows:[row()]};};
  const first=lookup(api,[product],sender,request,fastTiming,{force:false});
  await ready;
  const other={...sender,tab:{...sender.tab,id:sender.tab.id+1}};
  const second=lookup(api,[product],other,request,fastTiming,{force:false});
  await Promise.resolve();await Promise.resolve();release();
  const values=await Promise.all([first,second]);
  assert.equal(requests,1);
  assert.equal(values[0].results[0].asOf,values[1].results[0].asOf);
  assert.equal(values[1].results[0].monthlySales,40);
});

test('account cookie, Wing navigation and tab removal invalidate cached statistics without reading cookie values', async () => {
  const {api,wing}=fakeChrome();const hooks={};let requests=0;
  api.tabs.onUpdated={addListener:fn=>{hooks.updated=fn;}};
  api.tabs.onRemoved={addListener:fn=>{hooks.removed=fn;}};
  api.cookies={onChanged:{addListener:fn=>{hooks.cookie=fn;}}};
  const request=async()=>({ok:true,rows:[row({salesLast28d:++requests})]});
  const get=()=>lookup(api,[product],sender,request,fastTiming,{force:false});
  await get();await get();assert.equal(requests,1);
  hooks.cookie({cookie:{domain:'.example.com',get value(){throw Error('value read');}}});
  await get();assert.equal(requests,1);
  hooks.cookie({cookie:{domain:'.coupang.com',get value(){throw Error('value read');}}});
  assert.equal((await get()).results[0].monthlySales,2);
  hooks.updated(wing.id,{status:'loading'},wing);
  assert.equal((await get()).results[0].monthlySales,3);
  hooks.removed(wing.id);
  assert.equal((await get()).results[0].monthlySales,4);
});

test('in-flight results cannot repopulate cache after an account change', async () => {
  const {api}=fakeChrome();let changed,release,started,requests=0;
  api.cookies={onChanged:{addListener:fn=>{changed=fn;}}};
  const held=new Promise(resolve=>{release=resolve;});
  const ready=new Promise(resolve=>{started=resolve;});
  const request=async()=>{requests++;if(requests===1){started();await held;}return {ok:true,rows:[row()]};};
  const first=lookup(api,[product],sender,request,fastTiming,{force:false});
  await ready;changed({cookie:{domain:'wing.coupang.com'}});release();await first;
  await lookup(api,[product],sender,request,fastTiming,{force:false});
  assert.equal(requests,2);
});

test('rate halt retains only completed products, while cached products remain usable during cooldown', async () => {
  const {api}=fakeChrome();let requests=0;
  const second={...product,productId:'222222222',title:'두 번째 상품'};
  const request=async()=>++requests===1?{ok:true,rows:[row()]}:{ok:false,code:'RATE_LIMIT',error:'limited',retryAfterMs:60000};
  const stopped=await lookup(api,[product,second],sender,request,fastTiming,{force:false});
  assert.equal(stopped.results.length,1);
  assert.equal(stopped.results[0].status,'ok');
  assert.equal(stopped.halt.code,'RATE_LIMIT');
  const cached=await lookup(api,[product],sender,request,fastTiming,{force:false});
  assert.equal(cached.halt,undefined);assert.equal(cached.results[0].monthlySales,40);
  const pending=await lookup(api,[second],sender,request,fastTiming,{force:false});
  assert.deepEqual(pending.results,[]);assert.equal(pending.halt.code,'RATE_LIMIT');
  assert.equal(requests,2);
});

test('incremental progress is scoped to the initiating tab and includes completed cache hits only', async () => {
  const {api}=fakeChrome();const progress=[];
  api.tabs.sendMessage=async(tabId,message)=>{progress.push({tabId,message});};
  const request=async()=>({ok:true,rows:[row()]});
  const options={force:false,requestId:'page-nonce:run_1.seq-2'};
  await lookup(api,[product],sender,request,fastTiming,options);
  await lookup(api,[product],sender,request,fastTiming,options);
  assert.equal(progress.length,2);
  assert.equal(progress.every(entry=>entry.tabId===sender.tab.id&&entry.message.type==='YF_SALES_PROGRESS'&&entry.message.requestId===options.requestId),true);
  assert.equal(progress[1].message.result.status,'ok');
  assert.equal(progress[1].message.result.asOf,progress[0].message.result.asOf);
  await lookup(api,[product],sender,request,fastTiming,{force:false,requestId:'invalid id'});
  await assert.rejects(lookup(api,[product],{...sender,id:'foreign'},request,fastTiming,options));
  assert.equal(progress.length,2);
});

test('unavailable progress is sent, error and rate rows are excluded, and a closed progress port does not lose results', async () => {
  for(const response of [{ok:true,rows:[]},{ok:false,code:'LOGIN',error:'login'},{ok:false,code:'RATE_LIMIT',error:'limited'}]) {
    const {api}=fakeChrome();const progress=[];
    api.tabs.sendMessage=async(_tab,message)=>{progress.push(message);throw Error('port closed');};
    const result=await lookup(api,[product],sender,async()=>response,fastTiming,{requestId:'nonce:1'});
    assert.equal(progress.length,response.ok?1:0);
    if(response.ok)assert.equal(result.results[0].status,'unavailable');
    else assert.equal(result.halt.code,response.code);
  }
});

test('service refuses navigation during lookup or a moved Wing tab', async () => {
  const navigation=fakeChrome({execute:async(_request,n)=>[{frameId:0,documentId:`document-${n}`,result:{ok:true,rows:[]}}]});
  await assert.rejects(lookup(navigation.api),/Wing.*변경/);
  const moved=fakeChrome({wingOverrides:{windowId:999}});
  await assert.rejects(lookup(moved.api),/Wing.*변경/);
  assert.equal(moved.calls.executions.length,0);
  const unbound=fakeChrome({execute:async()=>[{frameId:0,result:{ok:true,rows:[row()]}}]});
  await assert.rejects(lookup(unbound.api));
});

test('service enforces one in-flight lookup and releases lock after completion', async () => {
  let release,start;
  const started=new Promise(resolve=>{start=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const {api}=fakeChrome({execute:async()=>{start();await gate;return [{frameId:0,documentId:'stable',result:{ok:true,rows:[row()]}}];}});
  const first=lookup(api);
  await started;
  await assert.rejects(lookup(api),/이미 조회/);
  release();
  assert.equal((await first).ok,true);
  assert.equal((await lookup(api)).ok,true);
});

test('cancellation stops subsequent queries and releases the tab lock', async () => {
  let release,start;
  const started=new Promise(resolve=>{start=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const {api,calls}=fakeChrome({execute:async(_request,n)=>{
    if(n===1){start();await gate;return [{frameId:0,documentId:'stable',result:{ok:true,rows:[]}}];}
    return [{frameId:0,documentId:'stable',result:{ok:true,rows:[row()]}}];
  }});
  const first=lookup(api);
  await started;
  assert.throws(()=>cancelSales({...sender,id:'foreign-extension'},api));
  assert.deepEqual(cancelSales(sender,api),{ok:true});
  release();
  await assert.rejects(first,/중지/);
  assert.equal(calls.executions.length,1);
  assert.equal((await lookup(api)).ok,true);
});

test('rate-limit response imposes a cooldown and does not execute repeated network requests', async () => {
  const {api,calls}=fakeChrome({responses:[{ok:false,code:'RATE_LIMIT',error:'too many requests'},{ok:true,rows:[row()]}]});
  const stopped=await lookup(api);
  assert.equal(stopped.ok,true);
  assert.equal(stopped.results.length,0);
  assert.deepEqual(stopped.halt,{code:'RATE_LIMIT',error:'too many requests',retryAfterMs:60000});
  const cooling=await lookup(api);
  assert.equal(cooling.halt.code,'RATE_LIMIT');assert.deepEqual(cooling.results,[]);
  assert.equal(calls.executions.length,1);
  fakeNow+=61000;
  assert.equal((await lookup(api)).ok,true);
  assert.equal(calls.executions.length,2);
});

test('sender rejection runs before querying any privileged Wing state', async () => {
  const {api,calls}=fakeChrome();
  await assert.rejects(lookup(api,[product],{...sender,url:'https://evil.example/np/search'}));
  assert.equal(calls.queries.length,0);
  assert.equal(calls.executions.length,0);
});

test('Wing open reuses same-window tab, otherwise creates first-party Wing tab', async () => {
  const {api,wing,calls}=fakeChrome();
  await openSalesWing(sender,api);
  assert.deepEqual(calls.updates,[[wing.id,{active:true}]]);
  api.tabs.query=async()=>[];
  await openSalesWing(sender,api);
  assert.equal(calls.creates.length,1);
  assert.equal(calls.creates[0].windowId,sender.tab.windowId);
  assert.equal(new URL(calls.creates[0].url).origin,'https://wing.coupang.com');
});

test('listener ignores unrelated messages and returns errors through asynchronous response', async () => {
  const {api,calls}=fakeChrome();
  registerSalesListener(api);
  assert.equal(calls.listeners.length,1);
  const listener=calls.listeners[0];
  assert.equal(listener({type:'UNRELATED'},sender,()=>assert.fail('unrelated response')),undefined);
  let respond;
  const received=new Promise(resolve=>{respond=resolve;});
  assert.equal(listener({type:'YF_SALES_LOOKUP',products:[]},sender,respond),true);
  const result=await received;
  assert.equal(result.ok,false);
  assert.match(result.error,/1~10/);
});

