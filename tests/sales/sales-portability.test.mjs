import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {relative,sep} from 'node:path';
import {lookupSales,registerSalesListener} from '../../extensions/supplier-hub/sales-service.mjs';

const root=new URL('../../extensions/supplier-hub/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
function filesIn(directory,prefix='') {
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()
    ?filesIn(new URL(`${entry.name}/`,directory),`${prefix}${entry.name}/`)
    :[`${prefix}${entry.name}`]);
}
const files=new Set(filesIn(root));
function assetExists(asset,owner='manifest') {
  assert.equal(typeof asset,'string',`${owner} asset must be a bundled path`);
  assert.ok(!asset.includes('\\')&&!asset.startsWith('/')&&!asset.includes(':'),`${owner}: ${asset} must be portable and relative`);
  assert.ok(files.has(asset),`${owner}: bundled asset ${asset} missing or filename case differs`);
}

test('portable package contains every manifest and popup resource with exact filename case',()=>{
  assert.equal(manifest.manifest_version,3);
  assert.ok(Number(manifest.minimum_chrome_version)>=120);
  assetExists(manifest.background.service_worker);
  assert.equal(manifest.background.type,'module');
  assetExists(manifest.action.default_popup);
  for(const script of manifest.content_scripts) for(const asset of [...(script.js??[]),...(script.css??[])]) assetExists(asset);
  for(const icons of [manifest.icons,manifest.action.default_icon]) {
    for(const asset of typeof icons==='string'?[icons]:Object.values(icons??{})) assetExists(asset);
  }
  const popup=readFileSync(new URL(manifest.action.default_popup,root),'utf8');
  for(const match of popup.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/g)) assetExists(match[1],'popup');
  assert.ok(!manifest.permissions.includes('nativeMessaging'));
});

test('runtime module imports stay within package and contain no machine-only dependency',()=>{
  for(const name of files) {
    if(name.startsWith('tests/')||!/\.(?:mjs|js)$/.test(name))continue;
    const moduleUrl=new URL(name,root);
    const source=readFileSync(moduleUrl,'utf8');
    assert.ok(!/(?:[A-Z]:\\\\|[A-Z]:\/Users\/|\/Users\/[^/]+\/|\/home\/[^/]+\/|\b(?:connectNative|sendNativeMessage)\s*\()/i.test(source),`${name}: machine-specific runtime dependency`);
    for(const match of source.matchAll(/\b(?:from\s*|import\s*\(?\s*)["']([^"']+)["']/g)) {
      const specifier=match[1];
      assert.match(specifier,/^\.\.?\//,`${name}: runtime dependency must be bundled`);
      const target=new URL(specifier,moduleUrl);
      const resolved=relative(fileURLToPath(root),fileURLToPath(target)).split(sep).join('/');
      assert.ok(!resolved.startsWith('../'),`${name}: module escapes extension folder`);
      assetExists(resolved,name);
    }
  }
});

test('sales hooks are installed on Coupang with first-party Wing host permission',()=>{
  assert.ok(manifest.host_permissions.includes('https://www.coupang.com/*'));
  assert.ok(manifest.host_permissions.includes('https://wing.coupang.com/*'));
  const sales=manifest.content_scripts.find(item=>item.js?.includes('sales-content.js'));
  assert.ok(sales);
  assert.ok(sales.matches.includes('https://www.coupang.com/np/search*'));
  for(const name of [...files].filter(name=>/^sales-.*\.(?:mjs|js)$/.test(name))) {
    const source=readFileSync(new URL(name,root),'utf8');
    assert.ok(!/(?:localhost|127\.0\.0\.1|sourceflow\.|A01526306|A01464742|jbfdblccnofegmdfhdceabhlmfbjepge)/.test(source),`${name}: sales must not require original machine, original company, or RS installation`);
  }
});

test('sales works with differing extension IDs and browser tab IDs on separate installations',async()=>{
  for(const [extensionId,tabId,wingId,windowId] of [
    ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',17,18,6],
    ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',817,818,99],
  ]) {
    const wing={id:wingId,windowId,status:'complete',url:'https://wing.coupang.com/tenants/rfm/coupang-trends/popularity-search'};
    let calls=0;
    const api={runtime:{id:extensionId},storage:{session:{get:async()=>({}),set:async()=>{}}},tabs:{
      query:async request=>{assert.equal(request.windowId,windowId);return [wing];},
      get:async id=>{assert.equal(id,wingId);return wing;},
    },scripting:{executeScript:async request=>{
      calls++;assert.equal(request.target.tabId,wingId);
      return [{frameId:0,documentId:`document-${wingId}`,result:{ok:true,rows:[{productId:'111',itemId:'222',vendorItemId:'333',salesLast28d:0,pvLast28Day:7}]}}];
    }}};
    const sender={id:extensionId,frameId:0,url:'https://www.coupang.com/np/search?q=test',tab:{id:tabId,windowId}};
    const result=await lookupSales({products:[{productId:'111',itemId:'222',vendorItemId:'333',title:'넥워머'}]},sender,api);
    assert.equal(result.ok,true);
    assert.equal(result.results[0].monthlySales,0);
    assert.equal(calls,1);
  }
});

test('one extension carries sales and source collection with only the union of owned scopes',()=>{
 assert.deepEqual([...manifest.permissions].sort(),['activeTab','cookies','declarativeNetRequestWithHostAccess','scripting','storage','tabs','webRequest']);
 assert.equal(manifest.version,'2.1.3');assert.equal(manifest.background.service_worker,'handoff-worker.mjs');
 assert.equal(manifest.externally_connectable,undefined);
 assert.ok(manifest.content_scripts.some(script=>script.js.includes('page-collector.js')&&script.matches.includes('https://detail.1688.com/offer/*.html*')));
 assert.ok(manifest.content_scripts.some(script=>script.js.includes('handoff-content.js')));
 assert.ok(manifest.content_scripts.some(script=>script.js.includes('sales-content.js')));
});

test('direct worker lookup binds to the local installation tab and API without page injection',async()=>{
  for(const [extensionId,tabId,wingId,windowId] of [
    ['first-installation',104,105,21],['second-installation',909,910,83],
  ]) {
    const wing={id:wingId,windowId,status:'complete',url:'https://wing.coupang.com/tenants/rfm/coupang-trends/popularity-search'};
    let requests=0;
    const api={runtime:{id:extensionId},storage:{session:{get:async()=>({}),set:async()=>{}}},tabs:{
      query:async input=>{assert.equal(input.windowId,windowId);return [wing];},
      get:async id=>{assert.equal(id,wingId);return wing;},
    },scripting:{executeScript:async()=>assert.fail('successful worker transport must not inject a page')}};
    const sender={id:extensionId,frameId:0,url:'https://www.coupang.com/np/search?q=test',tab:{id:tabId,windowId}};
    const result=await lookupSales({products:[{productId:'111',itemId:'222',vendorItemId:'333',title:'넥워머'}]},sender,api,
      async(keyword,targetWingId,targetApi)=>{
        requests++;
        assert.equal(keyword,'넥워머');assert.equal(targetWingId,wingId);assert.equal(targetApi,api);
        return {ok:true,rows:[{productId:'111',itemId:'999',vendorItemId:'888',salesLast28d:28,pvLast28Day:140}]};
      });
    assert.equal(result.results[0].monthlySales,28);
    assert.equal(result.results[0].matchedBy,'product');
    assert.equal(result.results[0].itemId,'222');
    assert.equal(result.results[0].sourceItemId,'999');
    assert.equal(requests,1);
  }
});

function reachableRuntimeSources() {
  const popup=readFileSync(new URL(manifest.action.default_popup,root),'utf8');
  const queue=[manifest.background.service_worker,...manifest.content_scripts.flatMap(script=>script.js??[])];
  for(const match of popup.matchAll(/<script\b[^>]*src=["']([^"']+)["']/g))queue.push(match[1]);
  const sources=new Map();
  while(queue.length) {
    const name=queue.shift();
    if(sources.has(name))continue;
    assetExists(name,'runtime graph');
    const moduleUrl=new URL(name,root);
    const source=readFileSync(moduleUrl,'utf8');
    sources.set(name,source);
    for(const match of source.matchAll(/\b(?:from\s*|import\s*\(?\s*)["']([^"']+)["']/g)) {
      const target=new URL(match[1],moduleUrl);
      queue.push(relative(fileURLToPath(root),fileURLToPath(target)).split(sep).join('/'));
    }
  }
  return sources;
}

test('combined runtime includes both modules with one sales listener registration and no external listener',()=>{
 const sources=reachableRuntimeSources();
 for(const name of ['handoff-worker.mjs','sales-service.mjs','sales-popup.mjs','page-collector.js','source-inbox.mjs'])assert.ok(sources.has(name),name);
 const worker=sources.get('sales-worker.mjs');assert.equal((worker.match(/registerSalesListener\(\)/g)??[]).length,1);
 for(const [name,source] of sources)assert.ok(!/onMessageExternal|onConnectExternal|connectNative|sendNativeMessage/.test(source),name);
});

test('sales listener ignores legacy PLUS messages without returning duplicate app responses',async()=>{
  const listeners=[];
  let privilegedCalls=0,responses=0;
  const api={runtime:{id:'sales-extension',onMessage:{addListener:listener=>listeners.push(listener)}},
    tabs:{query:async()=>{privilegedCalls++;throw Error('must not query');}}};
  registerSalesListener(api);
  assert.equal(listeners.length,1);
  const types=['YOOFAM_HUB_HANDOFF','YOOFAM_PREPARE_PACKAGE','YOOFAM_GET_RESULT','YOOFAM_DISPATCH_PACKAGE',
    'YOOFAM_OBSERVE_RESULT','YOOFAM_VALIDATE_PACKAGE','YOOFAM_CAPTURE_1688','YOOFAM_CANCEL_1688',
    'YOOFAM_TRANSMIT_PACKAGE','YOOFAM_RESUME_VALIDATION','YOOFAM_REFRESH_RESULT','YOOFAM_REFRESH_REGISTRATION',
    'YOOFAM_READ_CATEGORY_BRANCH','YOOFAM_READ_CATEGORY_SCHEMA','YOOFAM_READ_CATEGORY_TEMPLATE'];
  for(const id of ['sales-extension','existing-plus-extension'])for(const type of types) {
    assert.equal(listeners[0]({type},{id,frameId:0,url:'https://www.coupang.com/np/search',tab:{id:1,windowId:2}},()=>{responses++;}),undefined);
  }
  await Promise.resolve();
  assert.equal(responses,0);
  assert.equal(privilegedCalls,0);
});

test('foreign extension identity cannot use the sales protocol to query Wing',async()=>{
  let listener,privilegedCalls=0;
  const api={runtime:{id:'sales-extension',onMessage:{addListener:fn=>{listener=fn;}}},
    tabs:{query:async()=>{privilegedCalls++;throw Error('must not query');}}};
  registerSalesListener(api);
  const sender={id:'existing-plus-extension',frameId:0,url:'https://www.coupang.com/np/search',tab:{id:1,windowId:2}};
  for(const type of ['YF_SALES_LOOKUP','YF_SALES_OPEN_WING','YF_SALES_CANCEL']) {
    const result=await new Promise(resolve=>listener({type,products:[{productId:'111'}]},sender,resolve));
    assert.equal(result.ok,false);
  }
  assert.equal(privilegedCalls,0);
});

