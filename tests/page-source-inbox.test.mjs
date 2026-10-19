import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {extractPageSource,validatePageSource,pageSourceIssues,pageJsonProperty} from '../extensions/supplier-hub/page-source.mjs';
import {savePageSource,flushPageSources} from '../extensions/supplier-hub/source-inbox.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const url='https://detail.1688.com/offer/700000000001.html',id='00000000-0000-4000-8000-000000000747';
const company={code:'A01464742',name:'와이홉'},origin='http://localhost:3000';
test('shipped page button captures only a trusted click and sends no source requests',async()=>{
 const elements=[],messages=[];const create=tag=>{const node={tag,id:'',style:{},textContent:'',hidden:false,disabled:false,setAttribute(){},append(){},attachShadow(){return {append(){}};},addEventListener(type,listener){if(type==='click')node.click=listener;}};elements.push(node);return node;};
 const document={getElementById:()=>null,createElement:create,documentElement:{append(){}},title:'合成测试商品',scripts:[{textContent:JSON.stringify({skuModel:{offerId:'700000000001',skuInfoMap:{black:{specAttrs:'黑色',skuId:'supplier-black',price:'5.3'}}},offerImgList:['https://cbu01.alicdn.com/synthetic.jpg']})}],querySelector(selector){return selector.startsWith('meta')?{content:'合成测试商品'}:selector==='.price-container'?{textContent:'¥5.30 1件起批'}:null;},querySelectorAll:()=>[]};
 const window={};window.top=window;
 vm.runInNewContext(fs.readFileSync(new URL('../extensions/supplier-hub/page-collector.js',import.meta.url),'utf8'),{window,document,location:{href:url},URL,Date,Error,chrome:{runtime:{sendMessage:async message=>{messages.push(message);return {ok:true,delivered:true};}}},fetch:()=>assert.fail('The product button must not fetch a source endpoint')});
 const button=elements.find(node=>node.tag==='button');await button.click({isTrusted:false});assert.equal(messages.length,0);
 await button.click({isTrusted:true});assert.equal(messages.length,1);assert.equal(messages[0].type,'YOOFAM_SAVE_PAGE_SOURCE');assert.equal(messages[0].snapshot.options[0].supplierSku,'supplier-black');assert.equal(button.textContent,'수집 완료');
});
function capture({complete=true,image='https://cbu01.alicdn.com/synthetic.jpg'}={}){
 const skuModel={offerId:'700000000001',skuInfoMap:{'颜色:黑色':{specAttrs:'黑色',price:'5.30',...(complete?{skuId:'supplier-black'}:{})},'颜色:灰色':{specAttrs:'灰色',price:'5.00',...(complete?{skuId:700002}:{})}}};
 return extractPageSource({sourceUrl:url+'?spm=inert-fixture',title:'合成测试商品',description:'合成商品原文',scripts:['neverExecute(); window.fixture='+JSON.stringify({subject:'合成测试商品',skuModel,offerImgList:[image]})+';'],priceText:complete?'¥5.00 ~ ¥5.30':'',minimumOrderText:complete?'1件起批':''});
}
test('inert SKU JSON uses real IDs, exact option prices and visible currency/minimum; code never executes',()=>{
 const source=capture();assert.equal(source.sourceUrl,url);assert.equal(source.options.length,2);assert.equal(source.options[0].supplierSku,'supplier-black');assert.equal(source.options[1].supplierSku,'700002');assert.equal(source.options[0].unitPriceCny,5.3);assert.equal(source.options[1].unitPriceCny,5);assert.equal(source.options[0].currency,'CNY');assert.equal(source.options[0].minimumOrder,1);assert.deepEqual(pageSourceIssues(source),[]);
 const nested='preamble "skuModel": {"skuInfoMap":{"key":{"specAttrs":"brace } and \\\"quoted\\\"","price":"5"}}}; execute()';
 assert.equal(pageJsonProperty(nested,'skuModel').skuInfoMap.key.price,'5');assert.equal(pageJsonProperty('"skuModel": (()=>{throw Error()})()','skuModel'),undefined);
});
test('missing facts remain null and cannot be replaced by a map key / range / implicit MOQ',()=>{
 const source=capture({complete:false});assert.deepEqual(pageSourceIssues(source),['공급자 SKU','위안(CNY) 통화','최소 주문 수량']);assert.equal(source.options[0].supplierSku,null);assert.equal(source.options[0].minimumOrder,null);assert.equal(source.options[0].currency,null);
 const bad=structuredClone(source);bad.options[0].unitPriceCny='5-8';assert.throws(()=>validatePageSource(bad));
 assert.throws(()=>extractPageSource({sourceUrl:url,title:'상품',scripts:['"skuModel":{"offerId":"700000000002"}'],gallery:['https://cbu01.alicdn.com/synthetic.jpg']}),/상품 번호/);
 assert.throws(()=>extractPageSource({sourceUrl:url,title:'상품',scripts:['"skuModel":{"skuInfoMap":{}}','"skuModel":{"skuInfoMap":{"other":{}}}'],gallery:['https://cbu01.alicdn.com/synthetic.jpg']}),/여러 개/);
 for(const invalid of ['https://evil.test/offer/700000000001.html','https://detail.1688.com.evil.test/offer/700000000001.html'])assert.throws(()=>extractPageSource({sourceUrl:invalid,scripts:[]}));
 const remote=structuredClone(source);remote.images[0].url='https://evil.test/picture';assert.throws(()=>validatePageSource(remote));
});
function extension({ack=true,changeCompany=false,multiple=false}={}){
 const records=new Map(),calls=[];let currentCompany=company;
 const store=async(action,value)=>{calls.push(action);if(action==='list')return [...records.values()];if(action==='put')records.set(value.id,structuredClone(value));if(action==='delete')records.delete(value);};
 const tab={id:20,windowId:3,url:origin+'/'},source={frameId:0,url,tab:{id:21,windowId:3}};
 const api={tabs:{query:async input=>{assert.equal(input.windowId,3);return multiple?[tab,{...tab,id:22}]:[tab];},get:async()=>tab,sendMessage:async(tabId,message)=>{
  calls.push(message.type);if(message.type==='YOOFAM_READ_CATALOG_CONTEXT')return {ok:true,ownerId:multiple&&tabId===22?'second-owner':'owner',company:currentCompany};
  if(changeCompany)currentCompany={code:'A01526306',name:'유앤채'};
  if(!ack)throw Error('lost app ACK');const record=message.record;return {ok:true,id:record.id,fingerprint:record.fingerprint,ownerId:record.ownerId,company:record.company};
 }}};
 return {records,calls,api,store,source,flush:()=>flushPageSources({}, {frameId:0,url:tab.url,tab},api,store)};
}
test('same-window company binding retains a lost save ACK and clears only after durable matching ACK',async()=>{
 const h=extension({ack:false}),first=await savePageSource({snapshot:capture()},h.source,h.api,h.store);assert.equal(first.delivered,false);assert.equal(h.records.size,1);
 const old=[...h.records.values()][0];assert.equal(old.company.code,company.code);assert.equal(old.ownerId,'owner');
 h.api.tabs.sendMessage=async(_id,message)=>message.type==='YOOFAM_READ_CATALOG_CONTEXT'?{ok:true,ownerId:'owner',company}:{ok:true,id:message.record.id,fingerprint:message.record.fingerprint,ownerId:'owner',company};
 assert.equal((await h.flush()).delivered,1);assert.equal(h.records.size,0);assert.equal(h.calls.filter(value=>value==='put').length,1);
});
test('company change, conflicting app identities and foreign sender never clear or route to another company',async()=>{
 const changed=extension({changeCompany:true});assert.equal((await savePageSource({snapshot:capture()},changed.source,changed.api,changed.store)).delivered,false);assert.equal(changed.records.size,1);assert.equal(changed.calls.includes('delete'),false);
 const multiple=extension({multiple:true});await assert.rejects(savePageSource({snapshot:capture()},multiple.source,multiple.api,multiple.store),/서로 다릅니다/);assert.equal(multiple.records.size,0);
 const h=extension();for(const sender of [{...h.source,frameId:1},{...h.source,url:url.replace('700000000001','700000000002')}])await assert.rejects(savePageSource({snapshot:capture()},sender,h.api,h.store));
 await assert.rejects(flushPageSources({}, {frameId:0,url:'https://evil.test',tab:{id:20,windowId:3}},h.api,h.store));assert.equal(h.records.size,0);
});

const request=(method,body)=>new Request('https://app.test/api/source-inbox',{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
async function addToInbox(h,snapshot=capture()){
 const fingerprint=await h.load('app/source-inbox.ts').pageSourceFingerprint(snapshot),api=h.load('app/api/source-inbox/route.ts');
 const input={expectedOwnerId:'owner',expectedCompany:company,id,fingerprint,snapshot};const response=await api.POST(request('POST',input));assert.equal(response.status,200,await response.clone().text());return {input,ack:await response.json(),api};
}
test('real inbox routes + SQLite deduplicate, keep original/review separate and enforce owner/company/revision',async()=>{
 const h=mobileIntakeHarness();try{
  const {input,api}=await addToInbox(h,capture({complete:false}));
  const original=h.sqlite.prepare('SELECT payload FROM source_inbox').get().payload;
  const same=await api.POST(request('POST',input));assert.equal(same.status,200);
  const other=structuredClone(input);other.id='00000000-0000-4000-8000-000000000748';other.snapshot.title='later capture';other.fingerprint=await h.load('app/source-inbox.ts').pageSourceFingerprint(other.snapshot);
  const duplicate=await api.POST(request('POST',other));assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM source_inbox').get().n,1);assert.equal(h.sqlite.prepare('SELECT payload FROM source_inbox').get().payload,original);
  const ready=h.load('app/api/source-inbox/ready/route.ts');assert.equal((await ready.GET(new Request('https://app.test/api/source-inbox/ready?sourceUrl='+encodeURIComponent(url)))).status,409);
  const complete=capture();const review={expectedOwnerId:'owner',id,expectedRevision:1,review:{title:complete.title,options:complete.options.map(({key,name,supplierSku,unitPriceCny,currency,minimumOrder})=>({key,name,supplierSku,unitPriceCny,currency,minimumOrder}))}};
  assert.equal((await api.PUT(request('PUT',review))).status,200);assert.equal((await api.PUT(request('PUT',review))).status,409);
  assert.equal(h.sqlite.prepare('SELECT payload FROM source_inbox').get().payload,original);const response=await ready.GET(new Request('https://app.test/api/source-inbox/ready?sourceUrl='+encodeURIComponent(url)));assert.equal(response.status,200);assert.equal((await response.json()).capture.revision,2);
  assert.equal((await api.DELETE(request('DELETE',{expectedOwnerId:'owner',id,expectedRevision:1}))).status,409);
  assert.equal((await api.DELETE(request('DELETE',{expectedOwnerId:'owner',id,expectedRevision:2}))).status,200);assert.equal((await (await api.GET()).json()).items.length,0);
  assert.equal(h.sqlite.prepare('SELECT payload FROM source_inbox').get().payload,original);assert.equal((await api.POST(request('POST',other))).status,200);assert.equal((await (await api.GET()).json()).items.length,1);
  assert.equal((await api.POST(request('POST',{...input,expectedOwnerId:'foreign'}))).status,409);
  h.setCompany({code:'A01526306',name:'유앤채'});assert.equal((await ready.GET(new Request('https://app.test/api/source-inbox/ready?sourceUrl='+encodeURIComponent(url)))).status,409);
  assert.equal(h.network.length,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);
 }finally{h.close();}
});
test('saved inbox source creates a separate editable draft through the real intake without any 1688 network access',async()=>{
 const h=mobileIntakeHarness();try{
  await h.intake();const existing=h.sqlite.prepare('SELECT * FROM products').get(),oldProduct=JSON.stringify(existing),oldContent=h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(existing.id).payload;
  const receipt=await h.load('db/collection-results.ts').readCollectionResult('owner','job'),snapshot=capture({image:receipt.result.images[0].url});snapshot.images.push({...receipt.result.images.find(row=>row.role==='detail')});
  await addToInbox(h,snapshot);const stored=await h.load('db/source-inbox.ts').readSourceInbox('owner',id),browserCapture={format:'yoofam-saved-page-capture-v1',sourceUrl:url,captureId:id,fingerprint:stored.fingerprint,revision:stored.revision};
  const now=new Date().toISOString();h.sqlite.prepare('INSERT INTO collection_jobs VALUES(?,?,?,?,?,?,?,?)').run('new-job','owner','700000000001',url,'work','awaiting_connector',now,now);h.sqlite.prepare('INSERT INTO collection_context VALUES(?,?)').run('new-job',JSON.stringify(h.context));
  const beforeSourceRequests=h.network.filter(host=>host.includes('1688')||host==='itemcdn.tmall.com').length,sourceRead=h.stats.skuRequests;
  const job=await h.load('db/collection-jobs.ts').findCollectionJob('owner','new-job');let imported;
  const message=await h.load('app/intake-collection.ts').collectIntakeProduct(job,{signal:new AbortController().signal,fetcher:(path,init)=>h.route(path,{method:init?.method??'GET',body:init?.body}),probeExistingFromBrowser:async()=>browserCapture,captureFromBrowser:async()=>assert.fail('A saved page source must never reopen 1688'),onJob:row=>{imported=row;},onProgress(){}});
  assert.match(message,/상품 초안/);assert.notEqual(imported.product_id,existing.id);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,2);
  assert.equal(h.stats.skuRequests,sourceRead);assert.equal(h.network.filter(host=>host.includes('1688')||host==='itemcdn.tmall.com').length,beforeSourceRequests);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(existing.id)),oldProduct);assert.equal(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(existing.id).payload,oldContent);
  const result=await h.load('db/collection-results.ts').readCollectionResult('owner','new-job');assert.equal(result.result.provider,'chrome-current-page-v1');assert.deepEqual(Array.from(result.result.options,row=>row.sku),['supplier-black','700002']);
  const base='/api/products/'+imported.product_id,options=await (await h.route(base+'/options')).json();assert.equal(options.options.rows.length,2);assert.equal(options.options.rows[0].supplierSku,'supplier-black');
  const fields=await (await h.route(base+'/quotation-fields')).json();assert.equal(fields.categoryContext.categoryId,'80719');assert.equal(fields.resolved.rows[0].fields.kcMarkType.value,'해당사항없음');assert.equal(fields.resolved.rows[0].fields.boxSkuQuantity.value,'50');
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products WHERE id=?').get(imported.product_id).supplier_hub_status,'미전송');assert.ok(!h.calls.some(path=>path.includes('supplier-hub-receipt')));
 }finally{h.close();}
});
test('owned saved capture rejects wrong owner, URL, fingerprint or revision before producing a receipt',async()=>{
 const h=mobileIntakeHarness();try{
  await addToInbox(h);const item=await h.load('db/source-inbox.ts').readSourceInbox('owner',id),parse=h.load('app/owned-page-capture.ts').parseOwnedPageCapture,body={format:'yoofam-saved-page-capture-v1',sourceUrl:url,captureId:id,fingerprint:item.fingerprint,revision:1};
  for(const [owner,input,source] of [['other',body,url],['owner',{...body,fingerprint:'0'.repeat(64)},url],['owner',{...body,revision:2},url],['owner',body,url.replace('700000000001','700000000002')]])await assert.rejects(parse(owner,input,source));
  assert.equal(h.network.length,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_results').get().n,0);
 }finally{h.close();}
});
