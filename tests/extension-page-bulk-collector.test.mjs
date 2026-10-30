import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {pageCollectorDom} from './helpers/page-collector-dom.mjs';
import {productDocument} from './helpers/product-document.mjs';

// Execute the actual isolated entry and real source parser against inert,
// synthetic product markup. No vendor requests or executable page globals.
const bundle=await build({entryPoints:['deployment/extension-page-collector.mjs'],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120'});
const offerId='700000000873',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const image=name=>`https://cbu01.alicdn.com/synthetic-bulk-${name}.jpg`;
const batchId='10000000-0000-4000-8000-000000000001',itemId='20000000-0000-4000-8000-000000000001',storedId='30000000-0000-4000-8000-000000000001';
const company={code:'A01526306',name:'유앤채'},workerSender={id:'synthetic-own-extension'};
const markup=`<section><h2>商品属性</h2><div><span>材质</span><span>海绵</span></div></section>
 <section><h2>包装信息</h2><table><tr><th>颜色</th><th>重量(g)</th></tr><tr data-sku-id="synthetic-black"><td>黑色</td><td>10</td></tr></table></section>
 <section><h2>商品详情</h2><p>当前合成商品详情</p><img data-original="${image('detail')}"></section>`;

function harness({validate,save,visibility='hidden',body=markup}={}){
 let now=Date.parse('2026-10-30T03:00:00.000Z');
 const page=productDocument(body),source={subject:'合成商品',skuModel:{offerId,skuInfoMap:{black:{skuId:'synthetic-black',specAttrs:'黑色',price:'0.28'}}},offerImgList:[image('main'),image('additional')]};
 const {document,elements}=pageCollectorDom({scripts:[{textContent:JSON.stringify(source)}],querySelectorAll:selector=>page.querySelectorAll(selector),querySelector:selector=>selector==='.price-container'?{textContent:'¥0.28 1件起批'}:page.querySelector(selector)});
 document.visibilityState=visibility;
 const events=new Map(),view={addEventListener(type,listener){const set=events.get(type)??new Set();set.add(listener);events.set(type,set);},removeEventListener(type,listener){events.get(type)?.delete(listener);},fire(type){for(const listener of events.get(type)??[])listener({isTrusted:true});}},location={href:sourceUrl},messages=[],listeners=[];view.top=view;
 class ClockDate extends Date{static now(){return now;}}
 const api={document,view,location,messages,advance(ms){now+=ms;},now:()=>now};
 const context={document,window:view,location,URL,Date:ClockDate,Error,TextEncoder,
  setTimeout(callback,ms){now+=ms;queueMicrotask(callback);return 1;},
  chrome:{runtime:{id:workerSender.id,onMessage:{addListener:listener=>listeners.push(listener)},sendMessage:async message=>{
   messages.push(structuredClone(message));
   if(message.type==='YOOFAM_VALIDATE_BULK_PAGE'){
    const lease={...message.payload,ownerId:'synthetic-owner',company:{...company},origin:'https://sourceflow.jjwwhhjj1116.workers.dev',appTabId:10,windowId:20,tabId:30};
    return validate?validate(messages.filter(row=>row.type===message.type).length,lease,api):{ok:true,lease};
   }
   if(message.type==='YOOFAM_SAVE_PAGE_SOURCE'){
    const fingerprint='ab'.repeat(32),result={ok:true,delivered:true,id:storedId,fingerprint,ownerId:'synthetic-owner',company:{...company},storedReceipt:{storedId,fingerprint,ownerId:'synthetic-owner',company:{...company},sourceUrl,captureVersion:1,collectedAt:message.snapshot.collectedAt,receivedAt:new Date(now).toISOString()}};
    return save?save(message,result,api):result;
   }
   assert.fail(`unexpected request ${message.type}`);
  }}},fetch:()=>assert.fail('Bulk collector never fetches source data directly')};
 vm.runInNewContext(bundle.outputFiles[0].text,context);
 const request=(message,sender=workerSender)=>new Promise(resolve=>{
  let async=false,replied=false;
  for(const listener of listeners){const result=listener(message,sender,value=>{replied=true;resolve(structuredClone(value));});if(result===true)async=true;}
  if(!async&&!replied)resolve(undefined);
 });
 return {...api,request,button:elements.find(node=>node.tag==='button'),status:elements.find(node=>node.tag==='p'),payload:()=>({batchId,itemId,leaseNonce:'synthetic_owned_nonce_873',sourceUrl,deadlineAt:now+60000}),count:type=>messages.filter(row=>row.type===type).length};
}
const command=payload=>({type:'YOOFAM_BULK_COLLECT_PAGE',payload});

test('worker-only READY reports this canonical offer and installed script without collecting',async()=>{
 const h=harness();const answer=await h.request({type:'YOOFAM_BULK_PAGE_READY'});
 assert.equal(answer.ok,true);assert.equal(answer.result.sourceUrl,sourceUrl);assert.equal(answer.result.offerId,offerId);assert.match(answer.result.version,/^\d+\.\d+\.\d+$/);
 assert.equal(h.messages.length,0);
 for(const sender of [{},{id:'another-extension'},{...workerSender,tab:{id:30}},{...workerSender,frameId:0}])assert.equal(await h.request({type:'YOOFAM_BULK_PAGE_READY'},sender),undefined);
 assert.equal((await h.request({type:'YOOFAM_BULK_PAGE_READY',extra:true})).ok,false);assert.equal(h.messages.length,0);
});

test('foreign, tab, or frame senders cannot request owned hidden capture',async()=>{
 const h=harness();for(const sender of [{},{id:'another-extension'},{...workerSender,tab:{id:30}},{...workerSender,frameId:0}])assert.equal(await h.request(command(h.payload()),sender),undefined);
 assert.equal(h.messages.length,0);
});

test('malformed, expired, too-long or foreign-source commands never reach authorization or SAVE',async()=>{
 const h=harness(),base=h.payload();
 for(const payload of [{...base,unexpected:true},{...base,batchId:'bad'},{...base,itemId:'bad'},{...base,leaseNonce:'short'},{...base,deadlineAt:h.now()},{...base,deadlineAt:h.now()+60001},{...base,sourceUrl:'https://detail.1688.com/offer/700000000874.html'},{...base,sourceUrl:sourceUrl+'?tracking=1'}]){
  assert.equal((await h.request(command(payload))).ok,false);
 }
 assert.equal((await h.request({...command(base),extra:true})).ok,false);assert.equal(h.messages.length,0);
});

for(const mode of ['rejected','extra','company','origin','expired','wrong-payload'])test(`initial ${mode} authorization blocks capture and save`,async()=>{
 const h=harness({validate(_index,lease){
  if(mode==='rejected')return {ok:false,error:'not owned'};
  if(mode==='extra')return {ok:true,lease,credentials:'never accepted'};
  if(mode==='company')lease.company={code:'A01526306',name:'와이홉'};
  if(mode==='origin')lease.origin='https://foreign.example';
  if(mode==='expired')lease.deadlineAt=0;
  if(mode==='wrong-payload')lease.itemId='20000000-0000-4000-8000-000000000002';
  return {ok:true,lease};
 }});
 assert.equal((await h.request(command(h.payload()))).ok,false);assert.equal(h.count('YOOFAM_VALIDATE_BULK_PAGE'),1);assert.equal(h.count('YOOFAM_SAVE_PAGE_SOURCE'),0);
});

test('authorized hidden capture preserves real options, images, facts and package; duplicate command shares one immutable save',async()=>{
 const h=harness(),payload=h.payload();const [first,duplicate]=await Promise.all([h.request(command(payload)),h.request(command(payload))]);
 assert.deepEqual(first,duplicate);assert.equal(first.ok,true);assert.equal(first.delivered,true);assert.equal(first.storedReceipt.storedId,storedId);
 assert.equal(h.count('YOOFAM_VALIDATE_BULK_PAGE'),2);assert.equal(h.count('YOOFAM_SAVE_PAGE_SOURCE'),1);
 const saved=h.messages.find(row=>row.type==='YOOFAM_SAVE_PAGE_SOURCE');
 assert.deepEqual(saved.bulk,{batchId,itemId,leaseNonce:payload.leaseNonce});assert.equal(saved.snapshot.offerId,offerId);
 assert.deepEqual(saved.snapshot.attributes,[{name:'材质',value:'海绵'}]);assert.deepEqual(saved.snapshot.options[0].packaging,{source:'package-table',weightG:10});
 assert.equal(saved.snapshot.options[0].name,'黑色');assert.equal(saved.snapshot.options[0].unitPriceCny,0.28);assert.equal(saved.snapshot.description,'当前合成商品详情');
 assert.ok(saved.snapshot.images.some(row=>row.role==='detail'&&row.url===image('detail')));assert.ok(saved.snapshot.images.some(row=>row.url===image('additional')));
 assert.deepEqual(await h.request(command(payload)),first);assert.equal(h.count('YOOFAM_SAVE_PAGE_SOURCE'),1);
 assert.equal((await h.request(command({...payload,leaseNonce:'different_owned_nonce_873'}))).ok,false);assert.equal(h.count('YOOFAM_SAVE_PAGE_SOURCE'),1);
 // Activating an already processed worker-owned tab must not turn its regular
 // button into a second source/save attempt after an uncertain result.
 h.document.visibilityState='visible';await h.button.click({isTrusted:true});assert.equal(h.count('YOOFAM_SAVE_PAGE_SOURCE'),1);
});

test('partial source omissions remain explicit and are never populated from card summaries',async()=>{
 const h=harness({body:'<p>未加载详情</p>'});const result=await h.request(command(h.payload()));
 assert.equal(result.ok,true);const snapshot=h.messages.find(row=>row.type==='YOOFAM_SAVE_PAGE_SOURCE').snapshot;
 assert.deepEqual(snapshot.attributes,[]);assert.equal(snapshot.options[0].packaging,undefined);assert.equal(snapshot.images.filter(row=>row.role==='detail').length,0);
 assert.match(h.status.textContent,/미수집·미확인/);
});

for(const mode of ['member','tab','activation','navigation','expiry','unload'])test(`scope ${mode} change before save blocks delivery`,async()=>{
 const h=harness({validate(index,lease,api){
  if(index===2){if(mode==='member')lease.ownerId='different-owner';if(mode==='tab')lease.tabId=31;if(mode==='activation')api.document.visibilityState='visible';if(mode==='navigation')api.location.href='https://detail.1688.com/offer/700000000874.html';if(mode==='expiry')api.advance(60001);if(mode==='unload')api.view.fire('pagehide');}
  return {ok:true,lease};
 }});
 assert.equal((await h.request(command(h.payload()))).ok,false);assert.equal(h.count('YOOFAM_SAVE_PAGE_SOURCE'),0);
});

test('visible tabs cannot use owned capture despite a worker lease',async()=>{
 const h=harness({visibility:'visible'});assert.equal((await h.request(command(h.payload()))).ok,false);assert.equal(h.count('YOOFAM_SAVE_PAGE_SOURCE'),0);
});

for(const title of ['安全验证 - 1688','请完成滑动验证','1688登录 - 阿里巴巴'])test(`explicit gate ${title} stops before source delivery without retry`,async()=>{
 const h=harness();h.document.title=title;const result=await h.request(command(h.payload()));
 assert.equal(result.ok,false);assert.match(result.error,/보안 확인|로그인/);assert.equal(h.count('YOOFAM_SAVE_PAGE_SOURCE'),0);
});

for(const mode of ['missing-receipt','wrong-source','wrong-owner','replayed','wrong-time'])test(`unproven ${mode} ACK is never reported as bulk success or automatically saved again`,async()=>{
 const h=harness({save(_message,result){
  if(mode==='missing-receipt')delete result.storedReceipt;
  if(mode==='wrong-source')result.storedReceipt.sourceUrl='https://detail.1688.com/offer/700000000874.html';
  if(mode==='wrong-owner'){result.ownerId='different-owner';result.storedReceipt.ownerId='different-owner';}
  if(mode==='replayed'){result.pendingSnapshotReplayed=true;result.newCaptureStored=false;}
  if(mode==='wrong-time')result.storedReceipt.collectedAt='2026-10-29T03:00:00.000Z';
  return result;
 }}),payload=h.payload();
 assert.equal((await h.request(command(payload))).ok,false);assert.equal((await h.request(command(payload))).ok,false);assert.equal(h.count('YOOFAM_SAVE_PAGE_SOURCE'),1);
});

for(const failure of ['transport','pending'])test(`${failure} save response does not trigger a second capture or retry`,async()=>{
 const h=harness({save(){if(failure==='transport')throw Error('synthetic ACK lost');return {ok:true,delivered:false,message:'synthetic uncertain receipt'};}}),payload=h.payload();
 const first=await h.request(command(payload));assert.equal(first.ok,failure==='pending');if(failure==='pending')assert.equal(first.delivered,false);
 assert.deepEqual(await h.request(command(payload)),first);assert.equal(h.count('YOOFAM_SAVE_PAGE_SOURCE'),1);assert.equal(h.count('YOOFAM_VALIDATE_BULK_PAGE'),2);
});
