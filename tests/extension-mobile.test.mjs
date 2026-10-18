import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {collectAlibabaMobileCapture} from '../extensions/supplier-hub/mobile-public.mjs';
import {capture1688Product,cancel1688Capture} from '../extensions/supplier-hub/capture-1688.mjs';
import {createMobileTransport} from '../extensions/supplier-hub/mobile-transport.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const read=name=>fs.readFileSync(new URL('fixtures/'+name,import.meta.url),'utf8');
const mobile=JSON.parse(read('1688-mobile-813724060928.json')),skus=JSON.parse(read('1688-skus-813724060928.json')),detail=read('1688-description-813724060928.txt');
const sourceUrl='https://detail.1688.com/offer/813724060928.html';
const html='<script>window.__INIT_DATA='+JSON.stringify(mobile)+';</script>';
const request={type:'YOOFAM_CAPTURE_1688',requestId:'00000000-0000-4000-8000-000000000091',sourceUrl};
const sender={tab:{id:7,windowId:17},frameId:0,url:'https://sourceflow.jjwwhhjj1116.workers.dev/products'};
const raw=()=>({format:'1688-public-mobile-capture-v1',sourceUrl,mobileHtml:html,skuPayload:structuredClone(skus),detailSource:detail});

function fixture({onFetch=()=>{},headerChange=value=>value,failSigned=false,mobileBody=html,skuPayload=skus,detailResponse,sourceUrlOverride=sourceUrl}={}){
 const listeners=new Set(),rules=new Map(),calls=[],app={id:7,windowId:17,url:sender.url},id='a'.repeat(32);
 let skuRequests=0;
 const api={runtime:{id},tabs:{get:async()=>({...app}),query:async()=>{calls.push('tab-query');throw Error('unexpected product tab');}},
  webRequest:{onHeadersReceived:{addListener(fn,filter,extra){assert.deepEqual(extra,['responseHeaders','extraHeaders']);listeners.add(fn);},removeListener:fn=>listeners.delete(fn)}},
  declarativeNetRequest:{async getSessionRules(){return [...rules.values()];},async updateSessionRules({addRules,removeRuleIds}){for(const id of removeRuleIds)rules.delete(id);for(const rule of addRules)rules.set(rule.id,rule);calls.push({add:addRules.length,remove:removeRuleIds.length});}}};
 const fetcher=async(target,init)=>{
  const url=new URL(target);calls.push(url.hostname);await onFetch({url,init,app,rules,listeners});
  assert.equal(init.credentials,'omit');assert.equal(init.redirect,'manual');assert.equal(init.headers.get('cookie'),null);
  if(url.hostname==='m.1688.com')return new Response(mobileBody,{headers:{'content-type':'text/html;charset=utf-8'}});
  if(url.hostname==='itemcdn.tmall.com')return detailResponse?detailResponse():new Response(detail);
  assert.equal(url.hostname,'h5api.m.1688.com');
  const rule=[...rules.values()].find(value=>value.condition.urlFilter==='|'+url.href+'|');
  const token=rule?'anonymousOnly':'undefined';
  assert.equal(url.searchParams.get('sign'),createHash('md5').update(`${token}&${url.searchParams.get('t')}&12574478&${url.searchParams.get('data')}`).digest('hex'));
  if(skuRequests++===0){
   const event={url:url.href,initiator:`chrome-extension://${id}`,tabId:-1,method:'GET',statusCode:200,responseHeaders:[
    {name:'Set-Cookie',value:'_m_h5_tk=anonymousOnly_1700000000000; Path=/; HttpOnly'},
    {name:'Set-Cookie',value:'_m_h5_tk_enc=anonymousEncrypted; Path=/'},
    {name:'Set-Cookie',value:'sessionid=neverRead; Path=/'}]};
   for(const fn of listeners)fn(headerChange(event));
   return Response.json({ret:['FAIL_SYS_TOKEN_EMPTY::empty']}); // Chrome hides response cookies from fetch.
  }
  assert.ok(rule);assert.equal(rule.action.requestHeaders[0].value,'_m_h5_tk=anonymousOnly_1700000000000; _m_h5_tk_enc=anonymousEncrypted');
  assert.deepEqual(rule.condition.initiatorDomains,[id]);assert.equal(rule.condition.isUrlFilterCaseSensitive,true);
  if(failSigned)throw Error('network unavailable');
  return Response.json(skuPayload);
 };
 return {api,app,rules,listeners,calls,fetcher,run:()=>capture1688Product({...request,sourceUrl:sourceUrlOverride},sender,api,{fetcher}),transport:()=>createMobileTransport(api,sourceUrlOverride,async()=>{},fetcher)};
}

test('generated Chrome collector preserves synthetic page and SKU bytes on transient optional-detail failures and cleans its transport',async()=>{
 const url='https://detail.1688.com/offer/628000000001.html',page=JSON.parse(JSON.stringify(mobile).replaceAll('813724060928','628000000001')),payload=JSON.parse(JSON.stringify(skus).replaceAll('813724060928','628000000001')),body='<script>window.__INIT_DATA='+JSON.stringify(page)+';</script>';
 const api=mobileIntakeHarness();try{for(const status of [502,503,504]){
  const h=fixture({mobileBody:body,skuPayload:payload,sourceUrlOverride:url,detailResponse:()=>new Response('temporary optional detail outage',{status})}),result=await h.run();assert.equal(result.ok,true,result.error);assert.equal(result.format,'1688-public-mobile-partial-capture-v1');assert.equal(result.sourceUrl,url);assert.equal(result.mobileHtml,body);assert.deepEqual(result.skuPayload,payload);assert.deepEqual(result.detailUnavailable,{status});assert.equal(result.detailSource,'');assert.equal(h.rules.size,0);assert.equal(h.listeners.size,0);assert.ok(!h.calls.includes('tab-query'));
  const parsed=api.load('app/browser-product-capture.ts').parseBrowserProductCapture(result,url);assert.equal(parsed.provider,'chrome-public-mobile-partial-v1');assert.equal(parsed.options.length,6);assert.equal(parsed.images.length,8);assert.equal(parsed.attributes.length,24);assert.ok(!parsed.images.some(image=>image.role==='detail'));
 }}finally{api.close();}
});

test('generated Chrome collector cannot treat optional detail authentication or malformed successful content as a partial source',async()=>{
 for(const detailResponse of [()=>new Response('denied',{status:401}),()=>new Response('denied',{status:403}),()=>new Response('unsupported detail content')]){
  const h=fixture({detailResponse}),transport=h.transport();try{await assert.rejects(collectAlibabaMobileCapture(sourceUrl,{fetcher:transport,signal:new AbortController().signal}));}finally{await transport.dispose();}assert.equal(h.rules.size,0);assert.equal(h.listeners.size,0);assert.ok(!h.calls.includes('tab-query'));
 }
});

test('public mtop checksum matches RFC vectors and UTF-8 Node crypto across padding boundaries',()=>{
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/public-mtop-md5.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,TextEncoder});
 for(const text of ['', 'a','abc','message digest','abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789','1234567890'.repeat(8),'한국어 中文 😀','x'.repeat(55),'x'.repeat(56),'x'.repeat(63),'x'.repeat(64),'가'.repeat(1000)])assert.equal(exports.publicMtopMd5(text),createHash('md5').update(text).digest('hex'));
});

test('Chrome anonymous public transport collects six real SKUs without creating or querying product tabs',async()=>{
 const h=fixture(),capture=await h.run();
 assert.equal(capture.format,'1688-public-mobile-capture-v1');assert.equal(capture.sourceUrl,sourceUrl);
 assert.deepEqual(h.calls.filter(value=>typeof value==='string'),['m.1688.com','h5api.m.1688.com','h5api.m.1688.com','itemcdn.tmall.com']);
 assert.equal(h.rules.size,0);assert.equal(h.listeners.size,0);assert.equal(JSON.stringify(capture).includes('anonymousOnly'),false);
 const server=mobileIntakeHarness();try{
  const parsed=server.load('app/browser-product-capture.ts').parseBrowserProductCapture(capture,sourceUrl);
  assert.equal(parsed.provider,'chrome-public-mobile-v1');assert.deepEqual(Array.from(parsed.options,row=>row.unitPriceCny),[3.6,5.5,3.6,5.5,3.6,5.5]);
  assert.equal(parsed.images.length,19);assert.equal(parsed.attributes.length,24);
 }finally{server.close();}
});

for(const mode of ['full-mobile','sku-only'])test(`generated Chrome collection retains one explicit SKU without variant axes before server draft creation (${mode})`,async()=>{
 // A synthetic no-variant contract, not a live claim about this fixture offer.
 const skuPayload=JSON.parse(read('1688-public-sku-813724060928.json')),data=skuPayload.data.result.data;
 data.skuModel.skuProps=[];data.skuModel.skuInfoMap={'':{skuId:'622000000010',specAttrs:'',price:'12.5',canBookCount:0}};data.orderParamModel.orderParam.beginNum=3;data.orderParamModel.orderParam.skuParam.skuPriceType='skuPrice';
 const chrome=fixture({skuPayload,mobileBody:mode==='full-mobile'?html:'<html>No initial data</html>'}),capture=await chrome.run();
 assert.equal(capture.format,mode==='full-mobile'?'1688-public-mobile-capture-v1':'1688-public-sku-capture-v1');assert.equal(capture.sourceUrl,sourceUrl);assert.deepEqual(capture.skuPayload,skuPayload);assert.equal(capture.receipt,undefined);
 assert.deepEqual(chrome.calls.filter(value=>typeof value==='string'),['m.1688.com','h5api.m.1688.com','h5api.m.1688.com',...(mode==='full-mobile'?['itemcdn.tmall.com']:[])]);assert.equal(chrome.rules.size,0);assert.equal(chrome.listeners.size,0);assert.ok(!JSON.stringify(capture).includes('anonymousOnly'));
 const h=mobileIntakeHarness({sourceFetcher:async()=>{throw Error('accepted browser source cannot recollect');}});try{
  const parsed=h.load('app/browser-product-capture.ts').parseBrowserProductCapture(capture,sourceUrl);assert.equal(parsed.provider,mode==='full-mobile'?'chrome-public-mobile-v1':'chrome-public-sku-v1');assert.equal(parsed.options.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.options[0])),{sku:'622000000010',name:data.offerBaseInfo.title,unitPriceCny:12.5,minimumOrder:3,stock:0,imageIndex:0});assert.equal(parsed.images.length,mode==='full-mobile'?16:1,'gallery and detail remain, while removed variant axes cannot supply three extra SKU images');
  const saved=await h.route('/api/collection-jobs/job/browser-capture',{method:'POST',body:capture});assert.equal(saved.status,200,await saved.clone().text());const productResponse=await h.route('/api/collection-jobs/job/product',{method:'POST'});assert.equal(productResponse.status,200,await productResponse.clone().text());const productId=(await productResponse.json()).productId;
  const options=(await (await h.route(`/api/products/${productId}/options`)).json()).options.rows;assert.equal(options.length,1);assert.equal(options[0].supplierSku,'622000000010');assert.equal(options[0].unitCostCny,12.5);assert.equal(options[0].minimumOrderQuantity,3);assert.equal(options[0].stock,0);
  const view=await (await h.route(`/api/products/${productId}/quotation-fields`)).json(),fields=view.resolved.rows.find(row=>row.optionId===options[0].id).fields;assert.deepEqual(['supplyPrice','salePrice','msrp'].map(key=>fields[key].value),['8750','14580','18950']);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');assert.deepEqual(h.network,[]);
 }finally{h.close();}
});

test('bundled Chrome collector sends raw SKU-only evidence through server validation into one editable draft',async()=>{
 const skuPayload=JSON.parse(read('1688-public-sku-813724060928.json'));
 const chrome=fixture({mobileBody:'<html>No initial product data</html>',skuPayload}),capture=await chrome.run();
 assert.equal(capture.format,'1688-public-sku-capture-v1');assert.deepEqual(Object.keys(capture).sort(),['ok','sourceUrl','format','skuPayload'].sort());
 assert.deepEqual(chrome.calls.filter(value=>typeof value==='string'),['m.1688.com','h5api.m.1688.com','h5api.m.1688.com']);
 assert.equal(chrome.rules.size,0);assert.equal(chrome.listeners.size,0);assert.ok(!JSON.stringify(capture).includes('anonymousOnly'));
 const h=mobileIntakeHarness({sourceFetcher:async()=>{throw Error('stored receipt must not recollect');}});
 try{
  const parse=h.load('app/browser-product-capture.ts').parseBrowserProductCapture;
  const result=parse(capture,sourceUrl);assert.equal(result.provider,'chrome-public-sku-v1');assert.equal(result.description,'');assert.equal(result.attributes,undefined);
  for(const mutate of [body=>body.sourceUrl=sourceUrl.replace('813724060928','999'),body=>body.skuPayload.data.result.data.offerBaseInfo.offerId=999,
    body=>body.skuPayload.data.result.data.offerBaseInfo.isPicPrivate=true,body=>body.receipt={title:'invented'},
    body=>body.mobileHtml='<html>invented</html>',body=>body.skuPayload.padding='가'.repeat(700000)]){
   const value=structuredClone(capture);mutate(value);assert.throws(()=>parse(value,sourceUrl));
   assert.equal((await h.route('/api/collection-jobs/job/browser-capture',{method:'POST',body:value})).status,422);
  }
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_results').get().n,0);
  const saved=await h.route('/api/collection-jobs/job/browser-capture',{method:'POST',body:capture});assert.equal(saved.status,200,await saved.clone().text());
  assert.match(await h.intake(),/상품 초안 저장됨.*상세 설명·상세 이미지·일반 상품 속성/);
  assert.equal(h.stats.downloads,4);assert.equal(h.aiSources.length,1);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
  assert.equal(h.network.some(host=>host==='supplier.coupang.com'),false);
 }finally{h.close();}
});

test('only the exact anonymous worker response supplies transport values; user tabs and other initiators cannot',async()=>{
 for(const change of [e=>({...e,initiator:'https://m.1688.com'}),e=>({...e,tabId:90}),e=>({...e,url:e.url+'&other=1'}),e=>({...e,statusCode:302}),
  e=>({...e,responseHeaders:[...e.responseHeaders,{name:'Set-Cookie',value:'_m_h5_tk=conflict_1700000000000; Path=/'}]})]){
  const h=fixture({headerChange:change});await assert.rejects(collectAlibabaMobileCapture(sourceUrl,{fetcher:h.transport(),signal:new AbortController().signal}),/공개 옵션/);
  assert.equal(h.rules.size,0);assert.equal(h.listeners.size,0);assert.equal(h.calls.filter(value=>value==='h5api.m.1688.com').length,1);
 }
});

test('a failed signed public request removes its exact transient rule and response listener',async()=>{
 const h=fixture({failSigned:true});await assert.rejects(collectAlibabaMobileCapture(sourceUrl,{fetcher:h.transport(),signal:new AbortController().signal}),/옵션 조회 서버/);
 assert.equal(h.rules.size,0);assert.equal(h.listeners.size,0);assert.equal(h.calls.some(value=>value==='itemcdn.tmall.com'),false);
});

test('a restarted worker removes only its own interrupted anonymous transport rules',async()=>{
 const h=fixture(),own={id:1000000001,condition:{initiatorDomains:[h.api.runtime.id]}},unrelated={id:91,condition:{initiatorDomains:['example.test']}};
 h.rules.set(own.id,own);h.rules.set(unrelated.id,unrelated);
 await h.run();assert.equal(h.rules.has(own.id),false);assert.deepEqual(h.rules.get(unrelated.id),unrelated);
});

test('transient rule cleanup failure never returns source evidence or falls back to product-tab capture',async()=>{
 const h=fixture(),update=h.api.declarativeNetRequest.updateSessionRules;
 h.api.declarativeNetRequest.updateSessionRules=async value=>{if(value.removeRuleIds.length)throw Error('transient cleanup failed');return update(value);};
 await assert.rejects(h.run(),/cleanup/);assert.equal(h.calls.includes('tab-query'),false);assert.equal(h.listeners.size,0);
});

test('public mobile capture cancellation and app movement cannot trigger the DOM fallback',async()=>{
 for(const mode of ['cancel','move','navigate']){
  const h=fixture({onFetch:({url,app})=>{if(url.hostname!=='h5api.m.1688.com')return;
   if(mode==='cancel')assert.equal(cancel1688Capture({...request,type:'YOOFAM_CANCEL_1688'},sender).cancelled,true);
   if(mode==='move')app.windowId=18;if(mode==='navigate')app.url='https://other.test/';
  }});
  await assert.rejects(h.run(),/취소|Chrome|앱 탭/);assert.equal(h.calls.includes('tab-query'),false);assert.equal(h.rules.size,0);assert.equal(h.listeners.size,0);
 }
 assert.equal((await fixture().run()).ok,true);
});

test('transport refuses unauthorized destinations, cookie replay, foreign offer and credentialed fetch',async()=>{
 const h=fixture(),fetcher=h.transport(),init={redirect:'manual',credentials:'omit',cache:'no-store',signal:new AbortController().signal,headers:{accept:'text/html'}};
 for(const url of ['https://m.1688.com/offer/999.html','https://m.1688.com/offer/813724060928.html?next=login','https://itemcdn.tmall.com.evil.test/1688offer/abc','https://supplier.coupang.com/'])await assert.rejects(fetcher(url,init));
 await assert.rejects(fetcher('https://m.1688.com/offer/813724060928.html',{...init,credentials:'include'}));
 await assert.rejects(fetcher('https://m.1688.com/offer/813724060928.html',{...init,headers:{cookie:'_m_h5_tk=notIssued_1700000000000'}}));
 assert.equal(h.calls.length,0);
});

test('server reparses bounded mobile raw sources and rejects wrong identity, private flags and invented receipt fields',()=>{
 const h=mobileIntakeHarness();try{
  const parse=h.load('app/browser-product-capture.ts').parseBrowserProductCapture;
  for(const mutate of [body=>body.sourceUrl=sourceUrl.replace('813724060928','999'),body=>body.skuPayload.data.result.data.offerBaseInfo.offerId=999,
   body=>body.mobileHtml=body.mobileHtml.replace('"isPricePrivate":false','"isPricePrivate":true'),body=>body.detailSource='',body=>body.receipt={options:[]},body=>body.format='unknown',
   body=>body.detailSource='x'.repeat(2*1024*1024+1)]){
   const value=raw();mutate(value);assert.throws(()=>parse(value,sourceUrl));
  }
  const noDetail=structuredClone(mobile);delete noDetail.globalData.detailModel;
  assert.throws(()=>parse({...raw(),mobileHtml:'<script>window.__INIT_DATA='+JSON.stringify(noDetail)+';</script>'},sourceUrl));
  assert.equal(parse({...raw(),mobileHtml:'<script>window.__INIT_DATA='+JSON.stringify(noDetail)+';</script>',detailSource:''},sourceUrl).images.length,8);
 }finally{h.close();}
});

test('Cloudflare source failure -> Chrome public raw capture -> owner receipt -> editable SEO and prices uses one job',async()=>{
 const h=mobileIntakeHarness({sourceFetcher:async()=>new Response('',{status:302,headers:{location:'https://login.1688.com/'}})});
 try{
  let captured=0,latest;
  const result=await h.load('app/intake-collection.ts').collectIntakeProduct(await h.load('db/collection-jobs.ts').findCollectionJob('owner','job'),{
   signal:new AbortController().signal,fetcher:(path,init)=>h.route(path,{method:init?.method??'GET',body:init?.body}),onJob:job=>{latest=job;},onProgress:()=>{},
   captureFromBrowser:async()=>{captured++;return fixture().run();}
  });
  assert.match(result,/상품 초안 저장됨/);assert.equal(captured,1);assert.ok(latest.product_id);
  const receipt=await h.load('db/collection-results.ts').readCollectionResult('owner','job');assert.equal(receipt.result.provider,'chrome-public-mobile-v1');assert.equal(receipt.result.options.length,6);
  const options=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(latest.product_id).payload).rows;assert.equal(options.length,6);
  assert.deepEqual(options.map(row=>row.unitCostCny),[3.6,5.5,3.6,5.5,3.6,5.5]);
  assert.equal(h.stats.maxDownloads,3);assert.equal(h.stats.downloads,19);
  assert.equal(h.calls.filter(path=>path.endsWith('/images-batch')).length,7);
  assert.equal(h.calls.filter(path=>path.endsWith('/images')).length,0);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_images').get().n,19);
  assert.ok(h.aiSources.length>0);assert.equal(h.network.some(host=>host==='supplier.coupang.com'),false);
  const repeated=await h.route('/api/collection-jobs/job/browser-capture',{method:'POST',body:raw()});assert.equal(repeated.status,200);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);
 }finally{h.close();}
});

test('Chrome mobile draft retries a failed image without recollection, duplicate files or lost manual edits',async()=>{
 const h=mobileIntakeHarness({sourceFetcher:async()=>new Response('',{status:302})});
 let captured=0;
 const run=async()=>h.load('app/intake-collection.ts').collectIntakeProduct(await h.load('db/collection-jobs.ts').findCollectionJob('owner','job'),{
  signal:new AbortController().signal,fetcher:(path,init)=>h.route(path,{method:init?.method??'GET',body:init?.body}),onJob:()=>{},onProgress:()=>{},
  captureFromBrowser:async()=>{captured++;return fixture().run();},
 });
 try{
  h.stats.failImageIndex=4;await assert.rejects(run(),/원본 5번/);assert.equal(captured,1,'the first full raw Chrome receipt must not recapture its image-only description');
  const product=h.sqlite.prepare('SELECT * FROM products').get();assert.equal(product.options_count,6);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_images').get().n,18);
  const base='/api/products/'+product.id,content=await (await h.route(base+'/content')).json();
  assert.equal((await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.content.revision,patch:{seo:{title:'직접 확인한 상품명'},detail:{description:'수동 상세 설명'},assets:{main:[],additional:[],detail:[]}}}})).status,200);
  const quote=await (await h.route(base+'/quotation-fields')).json();
  const updatedQuote=await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:quote.revision,expectedInputFingerprint:quote.inputFingerprint,changes:[{fieldKey:'salePrice',optionId:'collected-1',value:'9900'}]}});
  assert.equal(updatedQuote.status,200);assert.equal((await updatedQuote.json()).resolved.rows.find(row=>row.optionId==='collected-1').fields.salePrice.value,'9900');
  const downloads=h.stats.downloads,sourceRequests=h.network.filter(host=>host==='detail.1688.com').length;
  h.stats.failImageIndex=null;assert.match(await run(),/상품 초안 저장됨/);
  assert.equal(captured,1,'image retry must reuse the full saved source without another Chrome capture');
  assert.equal(h.stats.downloads-downloads,1);assert.equal(h.stats.maxDownloads,3);
  assert.equal(h.network.filter(host=>host==='detail.1688.com').length,sourceRequests);
  assert.equal(h.aiSources.length,1);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_images').get().n,19);
  const saved=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  assert.equal(saved.seo.title.value,'직접 확인한 상품명');assert.equal(saved.detail.description.value,'수동 상세 설명');assert.deepEqual(saved.assets.main.value,[]);
  const reviewed=await (await h.route(base+'/quotation-fields')).json();assert.equal(reviewed.resolved.rows.find(row=>row.optionId==='collected-1').fields.salePrice.value,'9900');
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{h.close();}
});
