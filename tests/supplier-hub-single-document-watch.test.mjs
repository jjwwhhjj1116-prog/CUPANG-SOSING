import test from 'node:test';
import assert from 'node:assert/strict';
import {createSingleDocumentWatch} from '../extensions/supplier-hub/single-document-watch.mjs';
import {SingleDocumentError} from '../extensions/supplier-hub/single-document.mjs';

const origin='https://supplier.coupang.com',documentId='11111111-2222-3333-4444-555555555555';
const base={tabId:42,windowId:7,documentId,docId:'new-657',packetDigest:'a'.repeat(64),identityDigest:'b'.repeat(64),company:{code:'A01526306',name:'유앤채'}};
const webNames=['onBeforeRequest','onCompleted','onErrorOccurred','onBeforeRedirect'],tabNames=['onUpdated','onDetached','onRemoved','onReplaced'];
const navNames=['onCommitted','onHistoryStateUpdated','onReferenceFragmentUpdated'];
const invalid=error=>error instanceof SingleDocumentError&&error.code==='DOCUMENT_WATCH_INVALID';
const ownedUrl=origin+'/sr/draft/api/get-by-id/'+encodeURIComponent(base.docId);
const request=(overrides={})=>({tabId:42,frameId:0,documentId,documentLifecycle:'active',frameType:'outermost_frame',initiator:origin,method:'GET',type:'xmlhttprequest',url:ownedUrl,requestId:'request-one',timeStamp:10000,...overrides});
const completion=(overrides={})=>({...request(),timeStamp:10001,statusCode:200,...overrides});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

/** In-memory browser event model. No Chrome, Hub request, body or headers are
 * read. Filters/callback identities are retained only for cleanup assertions. */
function bus({navigation=false,failAdd,afterAdd=false,failRemove}={}){
  const sets=new Map(),adds=[],removes=[],api={};
  for(const [group,names] of [['webRequest',webNames],['tabs',tabNames],...(navigation?[['webNavigation',navNames]]:[])]){
    api[group]={};for(const name of names){const key=group+'.'+name,set=new Set();sets.set(key,set);
      api[group][name]={addListener(callback,...args){adds.push({key,callback,args:structuredClone(args)});if(key===failAdd&&!afterAdd)throw Error('registration failed');set.add(callback);if(key===failAdd)throw Error('registration failed after subscribing');},
        removeListener(callback){removes.push({key,callback});set.delete(callback);if(key===failRemove)throw Error('cleanup failed');}};
    }
  }
  return {api,adds,removes,emit(group,name,...args){for(const callback of [...sets.get(group+'.'+name)??[]])callback(...args);},count(){return [...sets.values()].reduce((count,set)=>count+set.size,0);}};
}
function start(b,options={}){return createSingleDocumentWatch({...base,company:{...base.company},api:b.api,...options});}
function current(watch){return watch.assertCurrent(watch.getStatus().binding);}
function finish(b,watch){watch.close();assert.equal(b.count(),0);assert.equal(watch.getStatus().active,false);assert.throws(()=>current(watch),invalid);}
function good(b,id='request-one') {b.emit('webRequest','onBeforeRequest',request({requestId:id}));b.emit('webRequest','onCompleted',completion({requestId:id}));}

test('exact owned GETs keep a frozen live binding and request metadata never includes headers/body',()=>{
  const b=bus(),watch=start(b),initial=current(watch);assert.equal(initial.active,true);assert.equal(b.count(),8);
  assert.match(watch.token,/^[a-f0-9-]{36}$/);assert.equal(initial.binding.token,watch.token);assert.equal(initial.binding.frameId,0);
  assert.ok(Object.isFrozen(watch)&&Object.isFrozen(initial)&&Object.isFrozen(initial.binding)&&Object.isFrozen(initial.binding.company));
  const before=request(),after=completion();for(const details of [before,after])for(const key of ['requestBody','requestHeaders','responseBody','responseHeaders'])Object.defineProperty(details,key,{get(){throw Error('sensitive metadata must never be inspected');}});
  b.emit('webRequest','onBeforeRequest',before);b.emit('webRequest','onCompleted',after);good(b,'request-two');assert.equal(current(watch).active,true);
  assert.deepEqual(Object.keys(initial),['active','reason','cleanupFailed','createdAt','expiresAt','binding']);assert.equal(initial.expiresAt-initial.createdAt,600000);
  assert.deepEqual(b.adds.filter(value=>value.key.startsWith('webRequest')).map(value=>value.args),webNames.map(()=>[{urls:[origin+'/sr/*'],tabId:42}]));
  assert.ok(b.adds.every(value=>value.args.length<=1));finish(b,watch);assert.deepEqual(b.removes.map(value=>value.key),b.adds.map(value=>value.key).reverse());
});

test('encoded and numeric document identifiers match only their exact URLs',()=>{
  for(const docId of [657,'own doc/with separator']){const b=bus(),watch=start(b,{docId}),url=origin+'/sr/draft/api/get-by-id/'+encodeURIComponent(String(docId));
    b.emit('webRequest','onBeforeRequest',request({url}));b.emit('webRequest','onCompleted',completion({url}));assert.equal(current(watch).binding.docId,docId);finish(b,watch);
  }
});

test('other tabs, child frames, and unrelated non-sr requests cannot poison a watch',()=>{
  const b=bus({navigation:true}),watch=start(b);
  for(const override of [{tabId:99},{frameId:1},{tabId:99,frameId:1},{url:'https://other.test/sr/draft/api/get-by-id/other'},{url:origin+'/assets/other'}])
    for(const name of webNames)b.emit('webRequest',name,request({...override,documentId:'different',url:override.url??origin+'/sr/draft/api/get-by-id/other'}));
  for(const name of navNames)b.emit('webNavigation',name,{tabId:99,frameId:0,documentId:'different',url:origin+'/sr/registration/step/startPage'});
  b.emit('tabs','onUpdated',99,{status:'loading'},{windowId:8});b.emit('tabs','onDetached',99);b.emit('tabs','onRemoved',99);b.emit('tabs','onReplaced',99,100);
  good(b);assert.equal(current(watch).active,true);finish(b,watch);
});

test('opaque native draft update is ignored and never serves as ownership evidence',()=>{
  const b=bus(),watch=start(b);const details=request({url:origin+'/sr/draft/api/update',method:'POST',requestId:'opaque-update'});
  Object.defineProperty(details,'requestBody',{get(){throw Error('the update body cannot be read');}});
  for(const name of webNames)b.emit('webRequest',name,details);
  assert.equal(current(watch).active,true);good(b);finish(b,watch);
});

for(const [name,details,reason] of [
  ['different document',request({url:origin+'/sr/draft/api/get-by-id/existing-other'}),'foreign-document'],
  ['own URL with query',request({url:ownedUrl+'?docId=other'}),'foreign-document'],
  ['new create',request({url:origin+'/sr/draft/api/create',method:'POST'}),'create-requested'],
  ['other outer document UUID',request({documentId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'}),'document-changed'],
  ['missing UUID',request({documentId:undefined}),'document-changed'],
  ['cached document',request({documentLifecycle:'cached'}),'document-changed'],
  ['not outermost',request({frameType:'sub_frame'}),'document-changed'],
  ['changed UUID on unrelated sr API',request({url:origin+'/sr/qvt/api/other',documentId:'different'}),'document-changed'],
  ['wrong method',request({method:'POST'}),'request-invalid'],['wrong request type',request({type:'main_frame'}),'request-invalid'],
  ['wrong initiator',request({initiator:'https://other.test'}),'request-invalid'],['malformed request ID',request({requestId:'bad.id'}),'request-invalid'],
  ['invalid timestamp',request({timeStamp:NaN}),'request-invalid'],
])test(`${name} invalidates before another action and cleans every listener`,()=>{
  const b=bus(),notifications=[],watch=start(b,{onInvalid:status=>notifications.push(status)});b.emit('webRequest','onBeforeRequest',details);
  assert.equal(watch.getStatus().reason,reason);assert.equal(b.count(),0);assert.throws(()=>current(watch),invalid);assert.equal(notifications.length,1);
  watch.invalid('foreign-document');watch.close();assert.equal(notifications.length,1);assert.equal(watch.getStatus().reason,reason);
});

for(const [name,details,reason] of [
  ['missing start',completion(),'request-invalid'],['different response request',completion({requestId:'other'}),'request-invalid'],
  ['preceding response time',completion({timeStamp:9999}),'request-invalid'],['failed response',completion({statusCode:500}),'request-failed'],
  ['redirect status',completion({statusCode:302}),'request-failed'],['response UUID changed',completion({documentId:'different'}),'document-changed'],
])test(`${name} invalidates the passive GET watch`,()=>{
  const b=bus(),watch=start(b);if(name!=='missing start')b.emit('webRequest','onBeforeRequest',request());b.emit('webRequest','onCompleted',details);
  assert.equal(watch.getStatus().reason,reason);assert.equal(b.count(),0);assert.throws(()=>current(watch),invalid);
});

for(const [event,reason] of [['onErrorOccurred','request-failed'],['onBeforeRedirect','request-redirected']])test(`${event} invalidates even if its destination is the owned URL`,()=>{
  const b=bus(),watch=start(b);b.emit('webRequest','onBeforeRequest',request());b.emit('webRequest',event,request({redirectUrl:ownedUrl}));
  assert.equal(watch.getStatus().reason,reason);assert.equal(b.count(),0);
});

test('duplicate request events and excess simultaneous requests fail closed with bounded memory',()=>{
  for(const kind of ['start','completion','overflow']){const b=bus(),watch=start(b);
    if(kind==='start'){b.emit('webRequest','onBeforeRequest',request());b.emit('webRequest','onBeforeRequest',request());}
    if(kind==='completion'){good(b);b.emit('webRequest','onCompleted',completion());}
    if(kind==='overflow')for(let index=0;index<33;index++)b.emit('webRequest','onBeforeRequest',request({requestId:'request-'+index}));
    assert.equal(watch.getStatus().reason,kind==='overflow'?'request-overflow':'request-invalid');assert.equal(b.count(),0);
  }
});

test('sequential owned reads are bounded without imposing a fixed request lifetime limit',()=>{
  const b=bus(),watch=start(b);for(let index=0;index<300;index++)good(b,'read-'+index);assert.equal(current(watch).active,true);finish(b,watch);
});

for(const [event,args,reason] of [
  ['onUpdated',[42,{status:'loading'},{windowId:7,url:origin+'/sr/registration/step/productPage'}],'tab-reloaded'],
  ['onUpdated',[42,{},{windowId:8}],'tab-detached'],
  ['onUpdated',[42,{url:origin+'/sr/registration/step/startPage'},{windowId:7}],'navigation-changed'],
  ['onUpdated',[42,{url:origin+'/sr/registration/step/imagePage?docId=other'},{windowId:7}],'navigation-changed'],
  ['onUpdated',[42,{url:'https://other.test/'},{windowId:7}],'navigation-changed'],
  ['onUpdated',[42,{},{windowId:7,pendingUrl:origin+'/sr/registration/step/productPage'}],'navigation-changed'],
  ['onDetached',[42,{oldWindowId:7}],'tab-detached'],['onRemoved',[42,{windowId:7}],'tab-removed'],
  ['onReplaced',[99,42],'tab-replaced'],['onReplaced',[42,99],'tab-replaced'],
])test(`tab ${event} ${reason} invalidates its exact document watch`,()=>{
  const b=bus(),watch=start(b);b.emit('tabs',event,...args);assert.equal(watch.getStatus().reason,reason);assert.equal(b.count(),0);
});

test('native SPA stage navigation and unrelated title updates preserve the same document watch',()=>{
  const b=bus(),watch=start(b);
  b.emit('tabs','onUpdated',42,{title:'loaded start document'},{windowId:7,url:origin+'/sr/registration/step/startPage'});
  for(const page of ['productPage','imagePage','legalPage','logisticsPage'])b.emit('tabs','onUpdated',42,{url:origin+'/sr/registration/step/'+page},{windowId:7,url:origin+'/sr/registration/step/'+page});
  assert.equal(current(watch).active,true);finish(b,watch);
});

test('optional webNavigation detects committed reloads and changed SPA browser UUID',()=>{
  for(const [event,details,reason] of [
    ['onCommitted',{tabId:42,frameId:0,documentId,url:origin+'/sr/registration/step/productPage'},'tab-reloaded'],
    ['onHistoryStateUpdated',{tabId:42,frameId:0,documentId:'different',url:origin+'/sr/registration/step/imagePage'},'document-changed'],
    ['onReferenceFragmentUpdated',{tabId:42,frameId:0,documentId,url:origin+'/sr/registration/step/imagePage#other'},'navigation-changed'],
  ]){const b=bus({navigation:true}),watch=start(b);assert.equal(b.count(),11);b.emit('webNavigation',event,details);assert.equal(watch.getStatus().reason,reason);assert.equal(b.count(),0);}
  const b=bus({navigation:true}),watch=start(b);b.emit('webNavigation','onHistoryStateUpdated',{tabId:42,frameId:0,documentId,url:origin+'/sr/registration/step/imagePage'});assert.equal(current(watch).active,true);finish(b,watch);
});

for(const [key,value] of [['token','replayed-token'],['tabId',99],['windowId',99],['frameId',1],['documentId','different'],['docId','existing'],['packetDigest','c'.repeat(64)],['identityDigest','c'.repeat(64)],['company',{code:'A01464742',name:'와이홉'}]])test(`assertCurrent exact ${key} binding cannot be swapped`,()=>{
  const b=bus(),watch=start(b),expected={...watch.getStatus().binding,[key]:value};assert.throws(()=>watch.assertCurrent(expected),invalid);assert.equal(watch.getStatus().reason,'binding-mismatch');assert.equal(b.count(),0);
});

test('a saved token cannot restore a restarted or closed in-memory observer',()=>{
  const b=bus(),first=start(b),saved=structuredClone(first.getStatus().binding);finish(b,first);const second=start(b);assert.notEqual(second.token,saved.token);
  assert.throws(()=>second.assertCurrent(saved),invalid);assert.equal(b.count(),0);assert.throws(()=>first.assertCurrent(saved),invalid);
});

test('mutating caller company data cannot change the bound company snapshot',()=>{
  const b=bus(),company={...base.company},watch=start(b,{company});company.name='changed';assert.deepEqual(current(watch).binding.company,base.company);finish(b,watch);
});

test('external invalidation sanitizes arbitrary reasons and callbacks cannot prevent cleanup',()=>{
  const b=bus();let calls=0;const watch=start(b,{onInvalid(status){calls++;assert.equal(status.active,false);assert.equal(b.count(),0);throw Error('caller callback failure');}});
  const result=watch.invalid('cookie-or-arbitrary-private-text');assert.equal(result.reason,'external-invalid');assert.equal(JSON.stringify(result).includes('cookie'),false);assert.equal(calls,1);watch.invalid('foreign-document');assert.equal(calls,1);assert.equal(b.count(),0);
});

test('an asynchronous invalidation callback rejection cannot keep authorization or leak an unhandled rejection',async()=>{
  const b=bus(),watch=start(b,{onInvalid:async()=>{throw Error('async callback failure');}});watch.invalid('foreign-document');await wait(0);
  assert.equal(b.count(),0);assert.throws(()=>current(watch),invalid);
});

test('explicit close/dispose is idempotent and does not notify a failure callback',()=>{
  const b=bus();let calls=0;const watch=start(b,{onInvalid(){calls++;}});watch.dispose();watch.close();assert.equal(calls,0);assert.equal(watch.getStatus().reason,'closed');assert.equal(b.count(),0);
});

test('the absolute maximum age expires without further browser events',async()=>{
  const b=bus();let notifications=0;const watch=start(b,{maxAgeMs:5,onInvalid(){notifications++;}});await wait(12);
  assert.equal(watch.getStatus().reason,'expired');assert.equal(notifications,1);assert.equal(b.count(),0);assert.throws(()=>current(watch),invalid);
});

test('assert/read detect expiry, rollback and invalid clocks without requiring a timer',()=>{
  for(const next of [1601,999,NaN]){let now=1000;const b=bus(),watch=start(b,{now:()=>now,maxAgeMs:600});now=next;
    assert.equal(watch.getStatus().reason,next===1601?'expired':'clock-invalid');assert.equal(b.count(),0);assert.throws(()=>current(watch),invalid);
  }
  let throws=false;const b=bus(),watch=start(b,{now:()=>{if(throws)throw Error('clock failure');return 1000;}});throws=true;assert.equal(watch.getStatus().reason,'clock-invalid');assert.equal(b.count(),0);
});

test('expiry during listener installation cleans all listeners before a token can be returned',()=>{
  let reads=0;const b=bus();assert.throws(()=>start(b,{maxAgeMs:600,now:()=>++reads===1?1000:1601}),invalid);assert.equal(b.count(),0);assert.equal(b.removes.length,8);
});

for(const group of ['webRequest','tabs'])for(const name of group==='webRequest'?webNames:tabNames)test(`missing ${group}.${name} fails before any listener is installed`,()=>{
  const b=bus();delete b.api[group][name];assert.throws(()=>start(b),invalid);assert.equal(b.adds.length,0);assert.equal(b.count(),0);
});

for(const afterAdd of [false,true])for(const key of [...webNames.map(name=>'webRequest.'+name),...tabNames.map(name=>'tabs.'+name),...navNames.map(name=>'webNavigation.'+name)])test(`partial registration ${key} ${afterAdd?'after':'before'} subscription removes all attempted callbacks`,()=>{
  const b=bus({navigation:true,failAdd:key,afterAdd});assert.throws(()=>start(b),invalid);assert.equal(b.count(),0);assert.deepEqual(b.removes.map(value=>value.key),b.adds.map(value=>value.key).reverse());
});

test('cleanup removal errors never skip the remaining listener removals',()=>{
  const b=bus({failRemove:'tabs.onReplaced'}),watch=start(b);watch.invalid('foreign-document');assert.equal(b.count(),0);assert.equal(b.removes.length,8);assert.equal(watch.getStatus().cleanupFailed,true);assert.throws(()=>current(watch),invalid);
});

for(const [key,value] of [['tabId',-1],['windowId',-1],['documentId','not-a-browser-UUID'],['docId',''],['docId','existing…'],['packetDigest','bad'],['identityDigest','bad'],['company',{code:'A01464742',name:'유앤채'}],['maxAgeMs',0],['maxAgeMs',600001],['onInvalid',true],['now',()=>NaN],['now',()=>Number.MAX_SAFE_INTEGER]])test(`invalid constructor ${key} rejects without listeners`,()=>{
  const b=bus();assert.throws(()=>start(b,{[key]:value}),invalid);assert.equal(b.count(),0);assert.equal(b.adds.length,0);
});
