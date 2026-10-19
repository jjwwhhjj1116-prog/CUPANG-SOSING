import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchWingCatalogDirect} from '../../extensions/supplier-hub/sales-transport.mjs';

const endpoint='https://wing.coupang.com/tenants/seller-web/pre-matching/search';
const row={productId:'123',itemId:'456',vendorItemId:'789',salesLast28d:0,pvLast28Day:12};
function fixture({tab={id:8,incognito:false,url:'https://wing.coupang.com/tenants/vendor-sign-up'},workerIncognito=false,stores=[{id:'normal-store',tabIds:[8]},{id:'other-store',tabIds:[88]}],cookie}={}) {
  const calls={cookies:[],requests:[],stores:0,tabs:[]};
  const api={
    extension:{inIncognitoContext:workerIncognito},
    tabs:{get:async id=>{calls.tabs.push(id);return tab;}},
    cookies:{
      getAllCookieStores:async()=>{calls.stores++;return stores;},
      get:async request=>{calls.cookies.push(request);return cookie===undefined?{name:'XSRF-TOKEN',storeId:request.storeId,value:'xsrf%2Ffixture'}:cookie;}
    }
  };
  return {api,calls};
}
function reply(body={result:[row]},options={}) {
  return new Response(options.text??JSON.stringify(body),{status:options.status??200,headers:{'content-type':options.type??'application/json',...(options.headers??{})}});
}
function withUrl(response,{url=endpoint,redirected=false}={}) {
  Object.defineProperties(response,{url:{value:url},redirected:{value:redirected}});
  return response;
}
async function lookup(options={},response=withUrl(reply()),keyword='  겨울 넥워머  ') {
  const {api,calls}=fixture(options);
  const result=await fetchWingCatalogDirect(keyword,8,api,async(url,init)=>{
    calls.requests.push({url,init});
    if(response instanceof Error)throw response;
    return response;
  });
  return {result,calls};
}

test('direct lookup binds XSRF to selected normal-store tab and emits only catalog metrics',async()=>{
  const {result,calls}=await lookup({},withUrl(reply({result:[{...row,sellerName:'private',accessToken:'private-secret'}]})));
  assert.deepEqual(result,{ok:true,rows:[row]});
  assert.deepEqual(calls.cookies,[{url:'https://wing.coupang.com/',name:'XSRF-TOKEN',storeId:'normal-store'}]);
  assert.equal(calls.requests.length,1);
  const {url,init}=calls.requests[0];
  assert.equal(url,endpoint);
  assert.equal(init.method,'POST');
  assert.equal(init.credentials,'include');
  assert.equal(init.redirect,'error');
  assert.equal(init.cache,'no-store');
  assert.equal(init.headers['x-xsrf-token'],'xsrf/fixture');
  assert.equal(init.headers.cookie,undefined);
  assert.equal(init.headers.authorization,undefined);
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(init.body),{keyword:'겨울 넥워머',excludedProductIds:[],searchPage:0,searchOrder:'DEFAULT',sortType:'DEFAULT'});
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.ok(!JSON.stringify(result).includes('xsrf'));
});

test('store ownership uses tab IDs instead of default store or list order',async()=>{
  const {result,calls}=await lookup({stores:[{id:'normal-store',tabIds:[10]},{id:'selected-store',tabIds:[8]}]});
  assert.equal(result.ok,true);
  assert.equal(calls.cookies[0].storeId,'selected-store');
});

test('split incognito worker can use its own incognito tab but spanning worker cannot mix sessions',async()=>{
  const tab={id:8,incognito:true,url:'https://wing.coupang.com/'};
  const own=await lookup({tab,workerIncognito:true,stores:[{id:'incognito-store',tabIds:[8]}]});
  assert.equal(own.result.ok,true);
  assert.equal(own.calls.cookies[0].storeId,'incognito-store');
  for(const options of [{tab,workerIncognito:false},{workerIncognito:true}]) {
    const {result,calls}=await lookup(options);
    assert.equal(result.code,'COOKIE_STORE');
    assert.equal(calls.cookies.length,0);
    assert.equal(calls.requests.length,0);
  }
});

test('unknown or ambiguous store, moved tab, and cookie from a different store fail without a request',async()=>{
  for(const options of [
    {stores:[]},{stores:[{id:'other',tabIds:[9]}]},
    {stores:[{id:'a',tabIds:[8]},{id:'b',tabIds:[8]}]},
    {tab:{id:8,url:'https://wing.coupang.com/',incognito:undefined}},
    {tab:{id:8,url:'https://evil.example/',incognito:false}},
    {tab:{id:9,url:'https://wing.coupang.com/',incognito:false}},
    {cookie:{name:'XSRF-TOKEN',storeId:'other-store',value:'other-account'}},
    {cookie:{name:'XSRF-TOKEN',storeId:'normal-store',value:'bad%0d%0aheader'}},
    {cookie:{name:'XSRF-TOKEN',storeId:'normal-store',value:'%invalid'}}
  ]) {
    const {result,calls}=await lookup(options);
    assert.equal(result.code,'COOKIE_STORE');
    assert.equal(calls.requests.length,0);
    assert.ok(!JSON.stringify(result).includes('other-account'));
  }
});

test('absent XSRF still uses browser-managed session without fabricating cookie headers',async()=>{
  const {result,calls}=await lookup({cookie:null});
  assert.equal(result.ok,true);
  assert.equal(calls.requests[0].init.headers['x-xsrf-token'],undefined);
  assert.equal(calls.requests[0].init.headers.cookie,undefined);
});

test('HTTP auth, rate limit, unexpected URL and HTML are failures, not zero metrics or retries',async()=>{
  for(const [response,code] of [
    [withUrl(reply({}, {status:401})),'LOGIN'],[withUrl(reply({}, {status:403})),'LOGIN'],
    [withUrl(reply({}, {status:429})),'RATE_LIMIT'],[withUrl(reply({}, {status:503})),'HTTP'],
    [withUrl(reply(),{redirected:true}),'LOGIN'],[withUrl(reply(),{url:'https://wing.coupang.com/login'}),'LOGIN'],
    [withUrl(reply(),{url:'https://evil.example/'}),'LOGIN'],
    [withUrl(reply({}, {type:'text/html',text:'<!doctype html><html>private-session</html>'})),'RESPONSE_TYPE'],
    [withUrl(reply({}, {text:'not JSON'})),'SCHEMA']
  ]) {
    const {result,calls}=await lookup({},response);
    assert.equal(result.code,code);
    assert.equal(result.rows,undefined);
    assert.equal(calls.requests.length,1);
    assert.ok(!JSON.stringify(result).includes('private-session'));
  }
});

test('valid body supports non-JSON MIME, empty result, zero and missing metric values',async()=>{
  const {result}=await lookup({},withUrl(reply({result:[row,{productId:'2',salesLast28d:null,pvLast28Day:null}]},{type:'text/plain'})));
  assert.deepEqual(result.rows,[row,{productId:'2',itemId:null,vendorItemId:null,salesLast28d:null,pvLast28Day:null}]);
  assert.deepEqual((await lookup({},withUrl(reply({result:[]})))).result,{ok:true,rows:[]});
  for(const body of [{},{result:null},{result:{}},[]])assert.equal((await lookup({},withUrl(reply(body)))).result.code,'SCHEMA');
});

test('rate-limit Retry-After seconds honor short waits and preserve long waits without automatic retry',async()=>{
  for(const [header,expected] of [['120',120000],[' 90 ',90000],['0',1000],['1',1000],['15',15000],['900',900000],['3600',3600000],['86400',86400000]]) {
    const {result,calls}=await lookup({},withUrl(reply({}, {status:429,headers:{'retry-after':header}})));
    assert.equal(result.code,'RATE_LIMIT');
    assert.equal(result.retryAfterMs,expected);
    assert.ok(result.error.includes(`${Math.ceil(expected/1000)}초`));
    assert.equal(result.rows,undefined);
    assert.equal(calls.requests.length,1);
    assert.equal(result.retryAfterOverflow,undefined);
  }
});

test('unrepresentably large Retry-After retains a safe manual-only cooldown instead of retrying early',async t=>{
  const now=Date.UTC(2026,9,5,12,0,0);
  t.mock.method(Date,'now',()=>now);
  for(const header of ['9'.repeat(400),'10000000000000']) {
    const {result,calls}=await lookup({},withUrl(reply({}, {status:429,headers:{'retry-after':header}})));
    assert.equal(result.code,'RATE_LIMIT');
    assert.equal(result.retryAfterOverflow,true);
    assert.equal(result.retryAfterMs,Number.MAX_SAFE_INTEGER-now);
    assert.ok(Number.isSafeInteger(result.retryAfterMs));
    assert.equal(now+result.retryAfterMs,Number.MAX_SAFE_INTEGER);
    assert.ok(result.retryAfterMs>900000);
    assert.equal(calls.requests.length,1);
  }
});

test('rate-limit Retry-After honors HTTP dates with a one-second guard but defaults malformed headers to sixty seconds',async t=>{
  const now=Date.UTC(2026,9,5,12,0,0);
  t.mock.method(Date,'now',()=>now);
  for(const [header,expected] of [
    [new Date(now+120000).toUTCString(),120000],
    [new Date(now+15000).toUTCString(),15000],
    [new Date(now+1000).toUTCString(),1000],
    [new Date(now+3600000).toUTCString(),3600000],
    [new Date(now).toUTCString(),1000],
    [new Date(now-60000).toUTCString(),1000],
    ['',60000],['not a date',60000],['NaN',60000],['-1',60000],['1.5',60000],['9999.5',60000],
    ['2026-10-05T12:05:00Z',60000],['Mon, 99 Oct 2026 12:05:00 GMT',60000]
  ]) {
    const {result,calls}=await lookup({},withUrl(reply({}, {status:429,headers:{'retry-after':header}})));
    assert.equal(result.retryAfterMs,expected,header);
    assert.equal(result.code,'RATE_LIMIT');
    assert.equal(calls.requests.length,1);
  }
  assert.equal((await lookup({},withUrl(reply({}, {status:429})))).result.retryAfterMs,60000);
});

test('response rows are bounded and unrequested source fields or metric aliases are not returned',async()=>{
  const result=(await lookup({},withUrl(reply({result:Array.from({length:250},()=>({productId:'1',salesCount:55,pageView:88,account:'private'}))})))).result;
  assert.equal(result.rows.length,200);
  assert.deepEqual(result.rows[0],{productId:'1',itemId:null,vendorItemId:null,salesLast28d:null,pvLast28Day:null});
});

test('UTF-8 response bytes above 2 MiB are rejected, including misleading content length',async()=>{
  const payload={result:[],padding:'가'.repeat(750000)};
  const {result}=await lookup({},withUrl(reply(payload,{headers:{'content-length':'2'}})));
  assert.equal(result.code,'SCHEMA');
  const declared=await lookup({},withUrl(reply({result:[]},{headers:{'content-length':'2097153'}})));
  assert.equal(declared.result.code,'SCHEMA');
});

test('network and abort errors are classified without exposing exception details or retrying',async()=>{
  for(const [error,code] of [[new Error('private-network-secret'),'NETWORK'],[new DOMException('private-timeout','AbortError'),'TIMEOUT']]) {
    const {result,calls}=await lookup({},error);
    assert.equal(result.code,code);
    assert.equal(calls.requests.length,1);
    assert.ok(!JSON.stringify(result).includes('private-'));
  }
});

test('ten-second deadline aborts the request and releases its timer',async t=>{
  let deadline,delay,cleared,started;
  const ready=new Promise(resolve=>{started=resolve;});
  t.mock.method(globalThis,'setTimeout',(callback,milliseconds)=>{deadline=callback;delay=milliseconds;return 123;});
  t.mock.method(globalThis,'clearTimeout',id=>{cleared=id;});
  const {api}=fixture();
  const pending=fetchWingCatalogDirect('test',8,api,async(_url,{signal})=>new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
    started();
  }));
  await ready;
  assert.equal(delay,10000);
  deadline();
  assert.equal((await pending).code,'TIMEOUT');
  assert.equal(cleared,123);
});

test('invalid inputs and unavailable cookie permission make no network request',async()=>{
  const {api,calls}=fixture();
  const fetcher=async()=>{calls.requests.push(true);throw Error('must not run');};
  for(const keyword of ['',null,'x'.repeat(251)])assert.equal((await fetchWingCatalogDirect(keyword,8,api,fetcher)).code,'INPUT');
  assert.equal((await fetchWingCatalogDirect('test',-1,api,fetcher)).code,'INPUT');
  api.cookies.getAllCookieStores=async()=>{throw Error('private permission detail');};
  assert.equal((await fetchWingCatalogDirect('test',8,api,fetcher)).code,'COOKIE_STORE');
  assert.equal(calls.requests.length,0);
});
