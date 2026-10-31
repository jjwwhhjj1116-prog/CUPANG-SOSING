import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {readPageSourceDescriptionReference} from '../extensions/supplier-hub/page-source.mjs';
import {PAGE_DESCRIPTION_LIMIT,pageDescriptionUrl,parsePageDescriptionImages,readPageDescriptionDocument,readPageDescription} from '../extensions/supplier-hub/page-description.mjs';

// Synthetic addresses are data only. Every request below uses a supplied mock;
// no browser, real product, vendor endpoint or global fetch is used.
const offerId='700000000001',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const detailUrl='https://itemcdn.tmall.com/1688offer/SYNTHETICONLY';
const first='https://cbu01.alicdn.com/img/ibank/SYNTHETIC-1.jpg',second='https://cbu01.alicdn.com/img/ibank/SYNTHETIC-2.jpg';
const primary=(url=detailUrl)=>({offerId,skuModel:{offerId,skuProps:[],skuInfoMap:{}},detailUrl:url});
const literal=(value=primary())=>JSON.stringify(value);
const request=()=>({type:'YOOFAM_READ_PAGE_DESCRIPTION',sourceUrl});
const sender=()=>({id:'synthetic-extension',frameId:0,documentId:'synthetic-document-1',documentLifecycle:'active',origin:'https://detail.1688.com',url:sourceUrl,tab:{id:7,windowId:9,url:sourceUrl}});
const reply=(html=`<div><img src="${first}"><img data-src="${second}"></div>`,options={})=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'},...options});
function harness({scripts=[literal()],fetcher=async()=>reply(),tab,execution}={}){
 const calls={tabs:[],scripts:[],fetch:[]};let reads=0;
 const api={runtime:{id:'synthetic-extension'},tabs:{get:async id=>{calls.tabs.push(id);return tab?tab(calls.tabs.length):{id,windowId:9,url:sourceUrl};}},scripting:{executeScript:async specification=>{
  calls.scripts.push(specification);reads++;
  return execution?execution(reads):[{frameId:0,documentId:'synthetic-document-1',result:{available:true,sourceUrl,scripts:typeof scripts==='function'?scripts(reads):scripts}}];
 }}};
 const run=(message=request(),from=sender(),options={})=>readPageDescription(message,from,api,{fetcher:async(url,init)=>{calls.fetch.push({url,init});return fetcher(url,init);},...options});
 return {calls,api,run};
}

test('only literal primary SKU records or the fixed initial-data detail slot bind a description link',()=>{
 assert.deepEqual(readPageSourceDescriptionReference(sourceUrl,[literal()]),{sourceUrl,offerId,detailUrl});
 const envelope={globalData:{offerBaseInfo:{offerId},tempModel:{offerId},detailModel:{offerId,detailUrl},isPicPrivate:false,isPricePrivate:false}};
 assert.deepEqual(readPageSourceDescriptionReference(sourceUrl,['window.__INIT_DATA = '+literal(envelope)+';']),{sourceUrl,offerId,detailUrl});
 for(const value of [
  {recommendations:[primary()]},{shop:primary()},{offerId,detailUrl},{offerId,skuModel:primary().skuModel,recommendations:[{offerId,detailUrl}]},
 ])assert.equal(readPageSourceDescriptionReference(sourceUrl,[literal(value)]),null);
 for(const code of [`function later(){window.__INIT_DATA=${literal(envelope)};}`,`/* window.__INIT_DATA=${literal(envelope)}; */`,`other = window.__INIT_DATA=${literal(envelope)};`,`const value=${JSON.stringify(literal())};`,`const value=/; window.__INIT_DATA=${literal(envelope)};/;`])assert.equal(readPageSourceDescriptionReference(sourceUrl,[code]),null);
 for(const value of [
  {...primary(),offerId:'700000000002'}, {...primary(),productId:'700000000002'}, {...primary(),skuModel:{offerId:'700000000002',skuProps:[]}},
  {...primary(),isPicPrivate:true}, {...primary(),isPricePrivate:true}, {...primary(),isDetailForbidden:true},
  {globalData:{...envelope.globalData,detailModel:{offerId:'700000000002',detailUrl}}},
  {globalData:{...envelope.globalData,tempModel:{offerId:'700000000002'}}},
  {globalData:{...envelope.globalData,offerSigns:{isDetailForbidden:true}}},
 ])assert.throws(()=>readPageSourceDescriptionReference(sourceUrl,[literal(value)]));
 for(const code of [
  literal().replace('"offerId":',`"offerId":"700000000002","offerId":`),
  literal().replace('"detailUrl":',`"detailUrl":"https://itemcdn.tmall.com/1688offer/OTHER","detailUrl":`),
  literal().replace('"detailUrl":',String.raw`"detail\u0055rl":"https://itemcdn.tmall.com/1688offer/OTHER","detailUrl":`),
 ])assert.throws(()=>readPageSourceDescriptionReference(sourceUrl,[code]));
 assert.throws(()=>readPageSourceDescriptionReference(sourceUrl,[literal(),literal()]));
 assert.throws(()=>readPageSourceDescriptionReference(sourceUrl,[literal(),literal(primary(detailUrl+'OTHER'))]));
});

test('the description destination accepts only exact, bounded, current-offer CDN references',()=>{
 assert.equal(pageDescriptionUrl(detailUrl,offerId),detailUrl);
 assert.equal(pageDescriptionUrl(detailUrl+'?offerId='+offerId,offerId),detailUrl+'?offerId='+offerId);
 for(const url of [
  detailUrl.replace('https:','http:'),detailUrl.replace('itemcdn.tmall.com','itemcdn.tmall.com.evil.test'),detailUrl.replace('itemcdn.tmall.com','itemcdn.tmall.com:444'),detailUrl.replace('itemcdn.tmall.com','itemcdn.tmall.com:443'),
  detailUrl.replace('itemcdn.tmall.com','name:secret@itemcdn.tmall.com'),detailUrl+'#fragment',detailUrl+'?offerId=700000000002',detailUrl+'?offerId='+offerId+'&offerId='+offerId,
  detailUrl+'?url=https://evil.test',detailUrl.replace('/1688offer/','/other/'),detailUrl+'/extra',detailUrl+'?token=secret',detailUrl+'?productId=700000000002',
  'https://detail.1688.com/offer/description/offer_detail.htm?offerId='+offerId,
  'https://air.1688.com/pages/od/app-desc/index.html?url='+encodeURIComponent(detailUrl)+'&offerId='+offerId,
 ])assert.throws(()=>pageDescriptionUrl(url,offerId));
});

test('the recorded mobile wrapper resolves only its explicit CDN destination and exact outer offer',()=>{
 const recorded=JSON.parse(readFileSync(new URL('./fixtures/1688-mobile-813724060928.json',import.meta.url),'utf8'));
 const boundSource='https://detail.1688.com/offer/813724060928.html',reference=readPageSourceDescriptionReference(boundSource,['window.__INIT_DATA = '+JSON.stringify(recorded)+';']);
 assert.equal(reference.offerId,'813724060928');assert.equal(reference.detailUrl,recorded.globalData.detailModel.detailUrl);
 assert.equal(pageDescriptionUrl(reference.detailUrl,reference.offerId),new URL(reference.detailUrl).searchParams.get('url'));
 const wrapper=(inner=detailUrl,extra='')=>'https://air.1688.com/pages/od/app-desc/d7p56fw2w/index.html?url='+encodeURIComponent(inner)+'&offerId='+offerId+extra;
 assert.equal(pageDescriptionUrl(wrapper(),offerId),detailUrl);
 for(const url of [
  wrapper().replace('https:','http:'),wrapper().replace('air.1688.com','air.1688.com.evil.test'),wrapper().replace('air.1688.com','air.1688.com:443'),
  wrapper().replace('air.1688.com','user:pass@air.1688.com'),wrapper()+'#fragment',wrapper().replace('/d7p56fw2w/','/unobserved/'),
  wrapper().replace('offerId='+offerId,'offerId=700000000002'),wrapper(detailUrl,'&offerId='+offerId),wrapper(detailUrl,'&%6fferId='+offerId),wrapper(detailUrl,'&url='+encodeURIComponent(detailUrl)),wrapper(detailUrl,'&extra=1'),
  wrapper(detailUrl.replace('itemcdn.tmall.com','evil.test')),wrapper(detailUrl.replace('itemcdn.tmall.com','user:pass@itemcdn.tmall.com')),wrapper(detailUrl.replace('itemcdn.tmall.com','itemcdn.tmall.com:443')),
  wrapper(detailUrl+'#fragment'),wrapper(detailUrl+'?offerId=700000000002'),wrapper(detailUrl+'?offerId='+offerId+'&offerId='+offerId),wrapper(wrapper()),wrapper(encodeURIComponent(detailUrl)),
 ])assert.throws(()=>pageDescriptionUrl(url,offerId));
});

test('the bound wrapper causes one inner CDN GET, never an outer wrapper request',async()=>{
 const wrapper='https://air.1688.com/pages/od/app-desc/d7p56fw2w/index.html?url='+encodeURIComponent(detailUrl)+'&offerId='+offerId;
 const h=harness({scripts:[literal(primary(wrapper))]});const result=await h.run();
 assert.equal(result.available,true);assert.deepEqual(result.detailImages,[first,second]);assert.equal(h.calls.fetch.length,1);assert.equal(h.calls.fetch[0].url,detailUrl);
 assert.equal(h.calls.scripts.length,2,'the original document and exact wrapper are rechecked after the response');
 const wrong=harness({scripts:[literal(primary(wrapper.replace('offerId='+offerId,'offerId=700000000002')))]});
 assert.equal((await wrong.run()).available,false);assert.equal(wrong.calls.fetch.length,0);
});

test('static HTML extraction skips executable strings, foreign subtrees, comments and invalid CDN sources',()=>{
 const html=`<!doctype html><!-- <img src="${second}"> --><script>globalThis.executed=true;"<img src='${second}'>"</script><style>x{content:"<img src='${second}'>"}</style><iframe><img src="${second}"></iframe><template><img src="${second}"></template><svg><img src="${second}"></svg><math><img src="${second}"></math><div title="<img src='${second}'>"><img src="https://evil.test/image.jpg"><img src="data:image/png,xx"><img data-src="//cbu01.alicdn.com/img/ibank/SYNTHETIC-1.jpg"><img src="${first}"><img src="${second}?a=1&amp;b=2"></div>`;
 assert.deepEqual(parsePageDescriptionImages(html),[first,second+'?a=1&b=2']);
 assert.deepEqual(parsePageDescriptionImages('var offer_details='+JSON.stringify({content:`<img src="${first}">`})),[first]);
 assert.throws(()=>parsePageDescriptionImages(`<img src="${first}" src="${second}">`));
 assert.throws(()=>parsePageDescriptionImages(Array.from({length:81},(_,index)=>`<img src="https://cbu01.alicdn.com/SYNTHETIC-${index}.jpg">`).join('')));
 assert.throws(()=>parsePageDescriptionImages('<div>'+'a'.repeat(PAGE_DESCRIPTION_LIMIT)));
 assert.deepEqual(parsePageDescriptionImages(`<textarea><img src="${first}"></textarea>`),[]);
});

test('literal offer_details content reuses the HTML tokenizer without evaluating script, strings or metadata',()=>{
 const content=`<div>中文商品详情 { } [ ] \\ &amp;</div><script>globalThis.__yoofamExecuted=true;"<img src='${second}'>";</script><img data-original="${first}"><img src="${first}">`;
 const wrapped=' \nvar\t offer_details \n = '+JSON.stringify({content,metadata:{ignoredImage:second,rows:[1,null,true]}})+' ; \n';
 assert.deepEqual(parsePageDescriptionImages(wrapped),[first]);
 assert.deepEqual(parsePageDescriptionImages('var offer_details = {"con\\u0074ent":'+JSON.stringify(`<img src="${second}">`)+'};'),[second]);
 assert.equal(Object.hasOwn(globalThis,'__yoofamExecuted'),false);
 for(const content of [`<script>"<img src='${first}'>"</script>`,`<iframe><img src="${first}"></iframe>`,`<template><img src="${first}"></template>`])assert.deepEqual(parsePageDescriptionImages('var offer_details='+JSON.stringify({content})+';'),[]);
});

test('only one complete strict JSON offer_details assignment is accepted, with no JSONP, executable tail or alternate binding',()=>{
 const json=JSON.stringify({content:`<img src="${first}">`});
 for(const body of [
  `offer_details=${json};`,`let offer_details=${json};`,`const offer_details=${json};`,`window.offer_details=${json};`,`callback(${json});`,
  `var offer_details=JSON.parse(${JSON.stringify(json)});`,`var offer_details=(${json});`,`var offer_details=${json};globalThis.__yoofamExecuted=true;`,
  `var offer_details=${json};var offer_details=${json};`,`var offer_details=${json};/* trailing comment */`,`/* prefix */var offer_details=${json};`,
  `var offer_details={content:"<img src='${first}'>"};`,`var offer_details={'content':"<img src='${first}'>"};`,
  `var offer_details={"content":${JSON.stringify(`<img src="${first}">`)},};`,`var offer_details={"content":(()=>"x")()};`,
  `var offer_details=${json.slice(0,-1)}];`,`var offer_details=${json.slice(0,-1)};`,`var offer_details=[${json}];`,
  'var offer_details={"content":42};','var offer_details={"nested":{"content":"<img>"}};',
 ])assert.throws(()=>parsePageDescriptionImages(body),/상세 원문/);
 assert.equal(Object.hasOwn(globalThis,'__yoofamExecuted'),false);
});

test('literal wrappers reject duplicate decoded keys, prototype keys and excessive structural work',()=>{
 const content=JSON.stringify(`<img src="${first}">`);
 for(const body of [
  `var offer_details={"content":${content},"content":${content}};`,
  `var offer_details={"content":${content},"con\\u0074ent":${content}};`,
  `var offer_details={"content":${content},"meta":{"same":1,"sa\\u006de":2}};`,
  ...['__proto__','constructor','prototype','__pro\\u0074o__'].map(key=>`var offer_details={"content":${content},"meta":{"${key}":{"polluted":true}}};`),
  `var offer_details={"content":${content},"meta":`+'['.repeat(41)+'0'+']'.repeat(41)+'};',
  `var offer_details={"content":${content},"meta":{`+Array.from({length:10001},(_,index)=>`"p${index}":0`).join(',')+'}};',
  'var offer_details={"content":"'+'a'.repeat(PAGE_DESCRIPTION_LIMIT)+'"};',
 ])assert.throws(()=>parsePageDescriptionImages(body),/상세 원문/);
 assert.equal(Object.hasOwn(Object.prototype,'polluted'),false);
 // JSON brackets inside strings do not consume structural depth.
 assert.deepEqual(parsePageDescriptionImages('var offer_details='+JSON.stringify({content:`<p>${'[]{}'.repeat(1000)}</p><img src="${first}">`})+';'),[first]);
});

test('static detail HTML retains allowlisted lazy image attributes when src is an unsafe placeholder',()=>{
 for(const attribute of ['data-original','data-original-src','data-lazy-src','data-lazyload']){
  assert.deepEqual(parsePageDescriptionImages(`<img src="data:image/png;base64,AA" ${attribute}="${first}"><img ${attribute}="https://evil.test/image.jpg">`),[first]);
  assert.deepEqual(parsePageDescriptionImages(`<img src="${second}" ${attribute}="${first}">`),[first],'explicit lazy product image precedes a CDN-hosted placeholder');
 }
});

test('spaces after tag openers never turn text or script literals into static images',()=>{
 for(const prefix of ['< img','< /img','<\nimg'])assert.deepEqual(parsePageDescriptionImages(`${prefix} src="${second}"><img src="${first}">`),[first]);
 for(const closing of ['< /script>','</ script>','<\n/script>'])assert.deepEqual(parsePageDescriptionImages(`<script>const literal="${closing}<img src='${second}'>";</script><img src="${first}">`),[first]);
 assert.deepEqual(parsePageDescriptionImages(`<svg/><math/><img src="${first}">`),[first]);
});

test('document injection reads only inline script text in its own top-level product document',()=>{
 const script=(text,attributes={},namespaceURI='http://www.w3.org/1999/xhtml')=>({namespaceURI,textContent:text,hasAttribute:name=>Object.hasOwn(attributes,name),getAttribute:name=>attributes[name]??null});
 const window={};window.top=window;
 const context={window,location:{href:sourceUrl+'?tracking=synthetic'},document:{scripts:[script(literal()),script(literal(),{src:'ignored.js'}),script(literal(),{type:'application/ld+json'}),script(literal(),{},'foreign')]},URL};
 const output=vm.runInNewContext('('+readPageDescriptionDocument.toString()+')('+JSON.stringify(sourceUrl)+')',context);
 assert.deepEqual(JSON.parse(JSON.stringify(output)),{available:true,sourceUrl,scripts:[literal()]});
 context.window.top={};assert.equal(vm.runInNewContext('('+readPageDescriptionDocument.toString()+')('+JSON.stringify(sourceUrl)+')',context).available,false);
});

test('one mocked read returns only validated detail URLs and binds every injection to the sender document',async()=>{
 const h=harness(),result=await h.run();
 assert.deepEqual(result,{ok:true,available:true,sourceUrl,offerId,detailImages:[first,second]});
 assert.equal(h.calls.fetch.length,1);assert.equal(h.calls.scripts.length,2);assert.equal(h.calls.tabs.length,5);
 for(const specification of h.calls.scripts){assert.deepEqual(specification.target,{tabId:7,documentIds:['synthetic-document-1']});assert.equal(specification.world,'ISOLATED');assert.equal(specification.func,readPageDescriptionDocument);assert.deepEqual(specification.args,[sourceUrl]);}
 const {url,init}=h.calls.fetch[0];assert.equal(url,detailUrl);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.method,'GET');assert.equal(init.cache,'no-store');assert.equal(init.referrerPolicy,'no-referrer');assert.ok(init.signal instanceof AbortSignal);assert.deepEqual(init.headers,{accept:'text/html,text/plain;q=0.9'});
 assert.equal(JSON.stringify(result).includes('SYNTHETICONLY'),false);assert.equal(Object.hasOwn(result,'html'),false);assert.equal(Object.hasOwn(result,'scripts'),false);
});

test('one bound detail GET can read the observed offer_details wrapper and still rechecks the original document',async()=>{
 const h=harness({fetcher:async()=>reply('var offer_details = '+JSON.stringify({content:`<img data-src="${first}"><img src="${second}">`})+';')});
 assert.deepEqual(await h.run(),{ok:true,available:true,sourceUrl,offerId,detailImages:[first,second]});
 assert.equal(h.calls.fetch.length,1);assert.equal(h.calls.scripts.length,2);assert.equal(h.calls.tabs.length,5);
 for(const read of h.calls.scripts)assert.deepEqual(read.target,{tabId:7,documentIds:['synthetic-document-1']});
});

test('foreign, framed, inactive, unbound and malformed callers cannot read scripts or fetch',async()=>{
 const cases=[
  s=>s.id='foreign-extension',s=>s.frameId=1,s=>delete s.documentId,s=>s.documentId='bad document',s=>s.documentLifecycle='cached',s=>s.origin='https://evil.test',
  s=>s.url='https://evil.test/',s=>s.tab.url='https://detail.1688.com/offer/700000000002.html',s=>s.tab.windowId=-1,s=>delete s.tab.id,
 ];
 for(const change of cases){const h=harness(),from=sender();change(from);const result=await h.run(request(),from);assert.equal(result.available,false);assert.equal(h.calls.tabs.length,0);assert.equal(h.calls.scripts.length,0);assert.equal(h.calls.fetch.length,0);}
 for(const message of [{...request(),url:detailUrl},{...request(),sourceUrl:sourceUrl+'?x=1'},{...request(),type:'OTHER'}]){const h=harness();assert.equal((await h.run(message)).available,false);assert.equal(h.calls.fetch.length,0);}
});

test('unproven identity, recommendations, duplicate links and unfamiliar wrappers never fetch',async()=>{
 for(const scripts of [[],[literal({recommendations:[primary()]})],[literal({...primary(),offerId:'700000000002'})],[literal(),literal()],['window.context = '+literal()+';'],[literal(primary('https://air.1688.com/?url='+encodeURIComponent(detailUrl)))]]){
  const h=harness({scripts}),result=await h.run();assert.equal(result.available,false);assert.equal(h.calls.fetch.length,0);assert.ok(['link-unavailable','identity-unproven'].includes(result.reason));
 }
});

test('changed tab, window, pending navigation, frame, document or post-await link is rejected',async()=>{
 for(const tab of [()=>({id:7,windowId:10,url:sourceUrl}),()=>({id:7,windowId:9,url:sourceUrl,pendingUrl:sourceUrl}),()=>({id:7,windowId:9,url:'https://detail.1688.com/offer/700000000002.html'})]){
  const h=harness({tab});assert.equal((await h.run()).available,false);assert.equal(h.calls.fetch.length,0);
 }
 for(const execution of [()=>[{frameId:1,documentId:'synthetic-document-1',result:{available:true,sourceUrl,scripts:[literal()]}}],()=>[{frameId:0,documentId:'new-document',result:{available:true,sourceUrl,scripts:[literal()]}}],()=>[]]){
  const h=harness({execution});assert.equal((await h.run()).available,false);assert.equal(h.calls.fetch.length,0);
 }
 const h=harness({scripts:read=>[literal(primary(read===1?detailUrl:detailUrl+'CHANGED'))]});assert.equal((await h.run()).reason,'document-changed');assert.equal(h.calls.fetch.length,1);
 const moved=harness({tab:read=>({id:7,windowId:read<3?9:10,url:sourceUrl})});assert.equal((await moved.run()).available,false);assert.equal(moved.calls.fetch.length,1);
 const reloaded=harness({execution:read=>[{frameId:0,documentId:read===1?'synthetic-document-1':'new-document',result:{available:true,sourceUrl,scripts:[literal()]}}]});assert.equal((await reloaded.run()).reason,'document-changed');
});

test('HTTP, redirects, final URL, content type, executable body and byte bounds fail closed without retries',async()=>{
 const responseCases=[
  ()=>reply('failure',{status:403}),()=>reply('',{status:302}),()=>({status:200,ok:true,redirected:true}),()=>({status:200,ok:true,redirected:false,url:'https://evil.test/'}),
  ()=>reply(`<img src="${first}">`,{headers:{'content-type':'application/javascript'}}),
  ()=>reply(`<img src="${first}">`,{headers:{'content-type':'text/html','content-length':String(PAGE_DESCRIPTION_LIMIT+1)}}),
  ()=>reply('<div>'+'a'.repeat(PAGE_DESCRIPTION_LIMIT)),()=>reply(`<script>"<img src='${first}'>"</script>`),
  ()=>reply('var offer_details='+JSON.stringify({content:`<img src="${first}">`})+'; globalThis.__yoofamExecuted=true;'),
  ()=>reply(`<img src="${first}">`,{headers:{'content-type':'text/html; charset=synthetic-unsupported'}}),
  ()=>new Response(new Uint8Array([60,100,105,118,62,255]),{headers:{'content-type':'text/html; charset=utf-8'}}),
 ];
 for(const fetcher of responseCases){const h=harness({fetcher});assert.equal((await h.run()).available,false);assert.equal(h.calls.fetch.length,1);}
 const broken=harness({fetcher:async()=>{throw Error('mock transport failure');}});assert.equal((await broken.run()).reason,'network-unavailable');assert.equal(broken.calls.fetch.length,1);
});

test('a bounded deadline covers fetch, body streaming and browser reads without late follow-up requests',async()=>{
 const fetchWait=harness({fetcher:()=>new Promise(()=>{})});let started=Date.now();assert.equal((await fetchWait.run(request(),sender(),{timeoutMs:10})).reason,'timeout');assert.ok(Date.now()-started<500);assert.equal(fetchWait.calls.fetch.length,1);
 const bodyWait=harness({fetcher:async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){return new Promise(()=>{});}}),{headers:{'content-type':'text/html'}})});
 started=Date.now();assert.equal((await bodyWait.run(request(),sender(),{timeoutMs:10})).reason,'timeout');assert.ok(Date.now()-started<500);assert.equal(bodyWait.calls.fetch.length,1);
 const late=harness();let release;late.api.tabs.get=()=>new Promise(resolve=>{release=resolve;});
 assert.equal((await late.run(request(),sender(),{timeoutMs:10})).reason,'timeout');release({id:7,windowId:9,url:sourceUrl});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(late.calls.scripts.length,0);assert.equal(late.calls.fetch.length,0);
});

test('an overlapping read cannot start a second request for the same product document',async()=>{
 let release;const h=harness({fetcher:()=>new Promise(resolve=>{release=resolve;})});const firstRead=h.run();
 while(!release)await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal((await h.run()).reason,'read-in-progress');assert.equal(h.calls.fetch.length,1);release(reply());assert.equal((await firstRead).available,true);
});
