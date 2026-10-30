import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createListingBatchController,validateListingBatchStart} from '../extensions/supplier-hub/listing-batch.mjs';
import {flushPageSources,sourceFingerprint,savePageSource} from '../extensions/supplier-hub/source-inbox.mjs';
import {validateListingBatchReply,listingStartNotCreated} from '../extensions/supplier-hub/listing-candidates.mjs';

const origin='https://sourceflow.jjwwhhjj1116.workers.dev',listingUrl='https://s.1688.com/selloffer/offer_search.htm?keywords=synthetic';
const company={code:'A01526306',name:'유앤채'},otherCompany={code:'A01464742',name:'와이홉'};
const clone=value=>structuredClone(value),canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const candidate=(index=1)=>({offerId:String(700000900000+index),sourceUrl:`https://detail.1688.com/offer/${700000900000+index}.html`,title:'카드에만 있는 요약 '+index,thumbnail:'https://cbu01.alicdn.com/synthetic-card-'+index+'.jpg',displayPrice:'¥0.28~0.55'});
const snapshot=item=>({format:'yoofam-page-source-v1',sourceUrl:item.sourceUrl,offerId:item.offerId,collectedAt:new Date(Date.now()-1000).toISOString(),title:'실제 상세문서 제목',description:'상세 본문',
 attributes:[{name:'소재',value:'면'}],options:[{key:'black',name:'黑色',supplierSku:'real-sku-'+item.offerId,unitPriceCny:0.28,currency:'CNY',minimumOrder:1,stock:25,imageUrl:'https://cbu01.alicdn.com/synthetic-option.jpg'}],
 images:[{url:'https://cbu01.alicdn.com/synthetic-main.jpg',role:'main'},{url:'https://cbu01.alicdn.com/synthetic-option.jpg',role:'additional'},{url:'https://cbu01.alicdn.com/synthetic-detail.jpg',role:'detail'}]});
let nextWindow=91000;
function harness(options={}){
 const windowId=++nextWindow,listing={id:windowId*10,windowId,url:listingUrl,active:true},app={id:windowId*10+1,windowId,url:origin+'/',active:false},hub={id:windowId*10+2,windowId,url:'https://supplier.coupang.com/',active:false};
 const tabs=new Map([listing,app,hub].map(tab=>[tab.id,clone(tab)])),records=new Map(),pending=new Map(),server=new Map(),events=[],created=[],closed=[],activated=[],saveOptions=[],rawSources=[];
 let detailId=windowId*10+3,controller;
 const x={ownerId:'owner-'+windowId,company:clone(company),tabs,records,pending,server,events,created,closed,activated,app,listing,hub,saveOptions,rawSources,beforeCollect:null,beforeSave:null,afterSave:null,sourceAck:null,comparisonAck:null,throwSourceAck:false,throwComparisonAck:false};
 const store=async(action,input)=>{if(action==='get')return clone(records.get(input));assert.equal(action,'put');records.set(input.key,clone(input.value));};
 const sourceStore=async(action,input)=>{if(action==='list')return [...pending.values()].map(clone);if(action==='put')pending.set(input.id,clone(input));else if(action==='delete')pending.delete(input);};
 const api={tabs:{
  query:async({windowId:requested})=>[...tabs.values()].filter(tab=>tab.windowId===requested).map(clone),
  get:async id=>{if(!tabs.has(id))throw Error('Synthetic tab closed');return clone(tabs.get(id));},
  create:async value=>{assert.equal(value.windowId,windowId);assert.equal(value.active,false);const tab={id:detailId++,windowId,url:value.url,active:false};tabs.set(tab.id,tab);created.push(clone(tab));events.push(['open',tab.id]);return clone(tab);},
  remove:async id=>{assert.ok(created.some(tab=>tab.id===id),'only engine-created tabs may close');assert.equal(tabs.get(id).active,false);closed.push(id);events.push(['close',id]);tabs.delete(id);},
  update:async(id,value)=>{assert.equal(id,app.id);assert.deepEqual(value,{active:true});for(const tab of tabs.values())tab.active=tab.id===id;activated.push(id);return clone(tabs.get(id));},
  sendMessage:async(id,message,frame)=>{
   assert.deepEqual(frame,{frameId:0});
   if(message.type==='YOOFAM_READ_CATALOG_CONTEXT'){assert.equal(id,app.id);return{ok:true,ownerId:x.ownerId,company:clone(x.company)};}
   if(message.type==='YOOFAM_SAVE_SOURCE_CAPTURE'){
    assert.equal(id,app.id);const record=clone(message.record);events.push(['source-post',record.id]);rawSources.push(record);
    if(server.has(record.id))assert.deepEqual(server.get(record.id),record);else server.set(record.id,record);
    if(x.throwSourceAck)throw Error('Synthetic ACK lost after server stored');
    const result={ok:true,id:record.id,fingerprint:record.fingerprint,ownerId:record.ownerId,company:clone(record.company),storedReceipt:{ownerId:record.ownerId,company:clone(record.company),sourceUrl:record.snapshot.sourceUrl,fingerprint:record.fingerprint,storedId:record.id,captureVersion:1,receivedAt:new Date().toISOString(),collectedAt:record.snapshot.collectedAt}};
    return x.sourceAck?x.sourceAck(result):result;
   }
   if(message.type==='YOOFAM_SAVE_LISTING_COMPARISONS'){
    assert.equal(id,app.id);events.push(['comparison-post',message.captureId]);
    if(x.throwComparisonAck)throw Error('Synthetic comparison ACK lost');
    const payload={batchId:message.batchId,captureId:message.captureId,listingUrl:message.listingUrl,items:message.items};
    const result={ok:true,receipt:{format:'yoofam-listing-comparison-receipt-v1',captureId:message.captureId,batchId:message.batchId,ownerId:x.ownerId,company:clone(x.company),stored:true,revision:1,storedCount:message.items.length,existingCount:0,itemOfferIds:message.items.map(item=>item.offerId),payloadSha256:hash(payload),recordedAt:new Date().toISOString()}};
    return x.comparisonAck?x.comparisonAck(result):result;
   }
   assert.ok(created.some(tab=>tab.id===id));const tab=tabs.get(id),offerId=new URL(tab.url).pathname.match(/\/(\d+)\.html$/)?.[1];
   if(message.type==='YOOFAM_BULK_PAGE_READY')return{ok:true,result:{sourceUrl:tab.url,offerId,version:'2.1.62'}};
   assert.equal(message.type,'YOOFAM_BULK_COLLECT_PAGE');events.push(['collect',id]);
   const detailSender={frameId:0,url:tab.url,tab:{id,windowId}},authMessage={type:'YOOFAM_VALIDATE_BULK_PAGE',payload:clone(message.payload)};
   if(x.beforeCollect)await x.beforeCollect({id,message,detailSender,authMessage,controller});
   const auth=await controller.authenticate(authMessage,detailSender);assert.equal(auth.ok,true);assert.equal(auth.lease.ownerId,x.ownerId);assert.equal(auth.lease.tabId,id);
   const value=snapshot({sourceUrl:tab.url,offerId});
   if(x.beforeSave)await x.beforeSave({id,message,detailSender,value,controller});
   const result=await controller.save({type:'YOOFAM_SAVE_PAGE_SOURCE',snapshot:value,bulk:{batchId:message.payload.batchId,itemId:message.payload.itemId,leaseNonce:message.payload.leaseNonce}},detailSender);
   if(x.afterSave)return x.afterSave(result);return result;
  },
 }};
 const save=async(message,sender,passedApi,passedStore,opts)=>{saveOptions.push(clone(opts));const persisted=await controller._read(message.bulk?.batchId??x.batchId);assert.equal(persisted.items.find(item=>item.sourceUrl===sender.url).status,'saving','saving intent is durable before POST');return savePageSource(message,sender,passedApi,passedStore,opts);};
 const config={api,store,sourceStore,saveSource:save,readyTimeoutMs:20,...options};
 x.newController=()=>createListingBatchController(config);controller=x.newController();x.controller=controller;x.api=api;x.store=store;x.sourceStore=sourceStore;
 x.sender={frameId:0,url:listingUrl,tab:{id:listing.id,windowId}};
 x.message=(count=3,destinations=['ai-registration'])=>({type:'YOOFAM_LISTING_BATCH_START',payload:{version:1,batchId:randomUUID(),listingUrl,destinations,items:Array.from({length:count},(_,index)=>candidate(index+1))}});
 x.start=async(message=x.message())=>{x.batchId=message.payload.batchId;const result=await controller.dispatch(message,x.sender);return{message,result};};
 x.status=(active=controller,id=x.batchId)=>active.dispatch({type:'YOOFAM_LISTING_BATCH_STATUS',batchId:id},x.sender);
 x.finish=async()=>{await controller.waitIdle();return(await x.status()).batch;};return x;
}

test('START accepts only loaded-card summaries, canonical search/detail URLs and explicit destination subset',()=>{
 const x=harness(),message=x.message();assert.equal(validateListingBatchStart(message,x.sender).payload.items.length,3);
 const bad=[value=>{value.payload.items=[];},value=>{value.payload.items=Array.from({length:61},(_,i)=>candidate(i+1));},value=>{value.payload.items[1]=clone(value.payload.items[0]);},value=>{value.payload.items[0].unitPriceCny=0.28;},value=>{value.payload.items[0].thumbnail='https://attacker.example/a.jpg';},value=>{value.payload.items[0].sourceUrl+='?tracking=bad';},value=>{value.payload.listingUrl='https://www.1688.com/';},value=>{value.payload.destinations=[];},value=>{value.payload.destinations=['ai-registration','ai-registration'];},value=>{value.payload.destinations=['supplier-hub'];},value=>{value.payload.batchId='not-uuid';}];
 for(const mutate of bad){const input=clone(message);mutate(input);assert.throws(()=>validateListingBatchStart(input,x.sender));}
 assert.throws(()=>validateListingBatchStart(message,{...x.sender,frameId:1}));assert.throws(()=>validateListingBatchStart(message,{...x.sender,url:listingUrl.replace('s.1688.com','evil.1688.com')}));
});

test('three selected URLs run real full-source saver serially, retain actual detail sender and activate the app once after actual ACK',async()=>{
 const x=harness(),{message,result}=await x.start();assert.equal(result.ok,true);assert.equal(result.batch.status,'running');assert.equal(result.batch.saved,0);assert.equal(x.server.size,0);
 const final=await x.finish();assert.equal(final.status,'completed',JSON.stringify(final));assert.equal(final.saved,3);assert.equal(final.queued,0);assert.equal(x.server.size,3);assert.equal(x.pending.size,0);assert.equal(x.created.length,3);assert.equal(x.closed.length,3);assert.equal(x.activated.length,1);assert.ok(x.tabs.has(x.hub.id));
 assert.deepEqual(x.events.map(event=>event[0]),['open','collect','source-post','close','open','collect','source-post','close','open','collect','source-post','close']);
 const persisted=await x.controller._read(message.payload.batchId);
 for(let i=0;i<3;i++){
  assert.equal(x.rawSources[i].id,persisted.items[i].captureId);assert.equal(x.rawSources[i].snapshot.sourceUrl,message.payload.items[i].sourceUrl);assert.notEqual(x.rawSources[i].snapshot.title,message.payload.items[i].title);
  assert.equal(x.rawSources[i].snapshot.options[0].supplierSku,'real-sku-'+message.payload.items[i].offerId);assert.equal(x.rawSources[i].snapshot.images.some(image=>image.role==='detail'),true);
  assert.equal(x.rawSources[i].manualRetryOnly,true);assert.equal(x.saveOptions[i].activate,false);assert.equal(x.saveOptions[i].requireStoredReceipt,true);assert.equal(x.saveOptions[i].expectedReceiver.scope.ownerId,x.ownerId);
  assert.equal(final.items[i].storedReceipt.storedId,persisted.items[i].captureId);assert.equal(final.items[i].storedReceipt.captureVersion,1);
 }
 assert.equal((await x.controller.dispatch({type:'YOOFAM_LISTING_BATCH_STATUS'},x.sender)).batch.batchId,x.batchId,'listing F5 can recover its latest batch without a page-stored ID');
});

test('60-item serial drain never fills the 40-record source inbox because each real ACK clears just its immutable record',async()=>{
 const x=harness();await x.start(x.message(60));const result=await x.finish();assert.equal(result.status,'completed');assert.equal(result.saved,60);assert.equal(x.pending.size,0);assert.equal(x.server.size,60);assert.equal(x.activated.length,1);
});

test('comparison-only records actual comparison ACK and never opens detail tabs or invents an AI source receipt',async()=>{
 const x=harness();await x.start(x.message(3,['rocket-compare']));const final=await x.finish();assert.equal(final.status,'completed');assert.equal(final.comparison.status,'saved');assert.equal(final.comparison.storedCount,3);assert.equal(final.saved,3);assert.equal(x.created.length,0);assert.equal(x.server.size,0);assert.equal(x.events[0][0],'comparison-post');assert.equal(final.items.every(item=>item.storedReceipt===undefined),true);
});

test('both destinations keep independent real receipts and compare ACK precedes full detail collection',async()=>{
 const x=harness();await x.start(x.message(2,['ai-registration','rocket-compare']));const final=await x.finish();assert.equal(final.status,'completed');assert.equal(final.comparison.status,'saved');assert.equal(final.saved,2);assert.equal(final.items.every(item=>item.storedReceipt),true);assert.equal(x.events[0][0],'comparison-post');assert.equal(x.events.filter(event=>event[0]==='comparison-post').length,1);
});

test('lost source ACK stops the remainder, preserves the immutable snapshot and never re-POSTs after duplicate START, restart, RESUME or generic FLUSH',async()=>{
 const x=harness();x.throwSourceAck=true;const{message}=await x.start();const final=await x.finish();assert.equal(final.status,'paused');assert.equal(final.uncertain,1);assert.equal(final.queued,2);assert.equal(x.server.size,1);assert.equal(x.rawSources.length,1);assert.equal(x.pending.size,1);
 const retained=JSON.stringify([...x.pending.values()]);assert.equal([...x.pending.values()][0].manualRetryOnly,true);
 await x.controller.dispatch(message,x.sender);const restarted=x.newController();assert.equal((await x.status(restarted)).batch.uncertain,1);await assert.rejects(restarted.dispatch({type:'YOOFAM_LISTING_BATCH_RESUME',batchId:x.batchId},x.sender),/미확정/);
 const flush=await flushPageSources({}, {frameId:0,url:x.app.url,tab:x.app},x.api,x.sourceStore);assert.equal(flush.delivered,0);assert.equal(flush.pending,1);assert.equal(x.rawSources.length,1);assert.equal(JSON.stringify([...x.pending.values()]),retained);
});

test('source inbox capacity fails closed before POST and leaves every existing pending source unchanged',async()=>{
 const x=harness();for(let i=0;i<40;i++)x.pending.set('old-'+i,{id:'old-'+i,ownerId:'foreign',company:clone(otherCompany),windowId:0,snapshot:{offerId:'0'},fingerprint:'old'});const before=JSON.stringify([...x.pending.values()]);
 await x.start();const final=await x.finish();assert.equal(final.status,'paused');assert.equal(final.uncertain,1);assert.equal(final.queued,2);assert.equal(x.server.size,0);assert.equal(JSON.stringify([...x.pending.values()]),before);
});

test('late collector error cannot downgrade an already durably saved actual server receipt',async()=>{
 const x=harness();x.afterSave=()=>({ok:false,error:'Synthetic visibility changed after actual ACK'});await x.start(x.message(2));const final=await x.finish();assert.equal(final.status,'completed');assert.equal(final.saved,2);assert.equal(x.server.size,2);
});

test('scope change before source SAVE blocks the real saver and retains unstarted queued items',async()=>{
 const x=harness();x.beforeSave=()=>{x.company=clone(otherCompany);};await x.start();await x.controller.waitIdle();assert.equal(x.server.size,0);const final=await x.controller._read(x.batchId);assert.equal(final.status,'paused');assert.equal(final.items[0].status,'failed');assert.equal(final.items[1].status,'queued');assert.equal(x.created.length,1);await assert.rejects(x.status(),/회사|회원|창/);
});

test('forged detail sender, alternate window/source and wrong nonce cannot authenticate or save',async()=>{
 const x=harness();x.beforeCollect=async({authMessage,detailSender,controller})=>{
  const variants=[{...detailSender,tab:{...detailSender.tab,id:x.hub.id}},{...detailSender,frameId:1},{...detailSender,tab:{...detailSender.tab,windowId:x.listing.windowId+1}},{...detailSender,url:candidate(8).sourceUrl}];
  for(const sender of variants)await assert.rejects(controller.authenticate(authMessage,sender));
  await assert.rejects(controller.authenticate({...authMessage,payload:{...authMessage.payload,leaseNonce:randomUUID()}},detailSender));
  await assert.rejects(controller.authenticate({...authMessage,payload:{...authMessage.payload,deadlineAt:Date.now()+99999}},detailSender));
 };await x.start(x.message(1));assert.equal((await x.finish()).saved,1);
});

test('a user-activated owned detail tab is never collected or closed, and existing Hub/listing tabs remain intact',async()=>{
 const x=harness();x.beforeCollect=({id})=>{x.tabs.get(id).active=true;x.tabs.get(x.listing.id).active=false;};await x.start(x.message(1));const final=await x.finish();assert.equal(final.saved,0);assert.equal(final.failed,1);assert.equal(x.server.size,0);assert.equal(x.closed.length,0);assert.ok(x.tabs.has(x.created[0].id));assert.ok(x.tabs.has(x.hub.id));assert.equal(x.activated.length,0);
});

test('navigation of owned detail tab to another product blocks collection and preserves that changed tab',async()=>{
 const x=harness();x.beforeCollect=({id})=>{x.tabs.get(id).url=candidate(99).sourceUrl;};await x.start(x.message(1));const final=await x.finish();assert.equal(final.saved,0);assert.equal(x.closed.length,0);assert.equal(x.server.size,0);
});

test('concurrent duplicate START shares only the existing durable request and does not create a second detail run',async()=>{
 const x=harness(),message=x.message(2);x.batchId=message.payload.batchId;await Promise.all([x.controller.dispatch(message,x.sender),x.controller.dispatch(clone(message),x.sender)]);const final=await x.finish();assert.equal(final.saved,2);assert.equal(x.created.length,2);assert.equal(x.rawSources.length,2);const changed=clone(message);changed.payload.items[0].title+=' changed';await assert.rejects(x.controller.dispatch(changed,x.sender),/내용이 다릅니다/);assert.equal(x.created.length,2);
});

test('restart marks saving uncertain without replay; reading is failed and only explicitly resumed unstarted queued items can run',async()=>{
 const x=harness();const{message}=await x.start(x.message(2));await x.finish();const saved=await x.controller._read(x.batchId);
 const uncertain=clone(saved);uncertain.status='running';uncertain.items[0].status='saving';delete uncertain.items[0].storedReceipt;uncertain.items[1].status='queued';delete uncertain.items[1].storedReceipt;await x.store('put',{key:'batch:'+x.batchId,value:uncertain});
 const restarted=x.newController(),opened=x.created.length;const status=await x.status(restarted);assert.equal(status.batch.status,'paused');assert.equal(status.batch.uncertain,1);assert.equal(status.batch.queued,1);assert.equal(x.created.length,opened);await assert.rejects(restarted.dispatch({type:'YOOFAM_LISTING_BATCH_RESUME',batchId:x.batchId},x.sender),/미확정/);
 const interrupted=clone(saved);interrupted.status='running';interrupted.items[0].status='reading';delete interrupted.items[0].storedReceipt;interrupted.items[1].status='queued';delete interrupted.items[1].storedReceipt;x.server.delete(interrupted.items[1].captureId);await x.store('put',{key:'batch:'+x.batchId,value:interrupted});
 const third=x.newController();assert.equal((await x.status(third)).batch.failed,1);
 // The resumed controller receives its own actual collector callback.
 const original=x.controller;x.controller=third;
 const originalSend=x.api.tabs.sendMessage;x.api.tabs.sendMessage=async(id,msg,frame)=>{
  if(msg.type!=='YOOFAM_BULK_COLLECT_PAGE')return originalSend(id,msg,frame);
  const tab=x.tabs.get(id),sender={frameId:0,url:tab.url,tab:{id,windowId:tab.windowId}};await third.authenticate({type:'YOOFAM_VALIDATE_BULK_PAGE',payload:msg.payload},sender);
  const source=snapshot({sourceUrl:tab.url,offerId:new URL(tab.url).pathname.match(/\/(\d+)\.html$/)[1]});
  return third.save({type:'YOOFAM_SAVE_PAGE_SOURCE',snapshot:source,bulk:{batchId:msg.payload.batchId,itemId:msg.payload.itemId,leaseNonce:msg.payload.leaseNonce}},sender);
 };
 await third.dispatch({type:'YOOFAM_LISTING_BATCH_RESUME',batchId:message.payload.batchId},x.sender);await third.waitIdle();assert.equal((await x.status(third)).batch.status,'partial');assert.equal((await x.status(third)).batch.saved,1);assert.equal(x.created.length,opened+1);x.controller=original;
});

for(const[label,mutate]of[
 ['hash',value=>{value.receipt.payloadSha256='0'.repeat(64);}],['order',value=>{value.receipt.itemOfferIds.reverse();}],['counts',value=>{value.receipt.storedCount=1;}],['scope',value=>{value.receipt.company=clone(otherCompany);}],['extra receipt field',value=>{value.receipt.extra=true;}],['missing receipt',value=>{delete value.receipt;}],
])test('invalid comparison '+label+' retains uncertainty, does not open AI detail tabs and cannot be retried by duplicate START',async()=>{
 const x=harness();x.comparisonAck=value=>{mutate(value);return value;};const{message}=await x.start(x.message(2,['ai-registration','rocket-compare']));const final=await x.finish();assert.equal(final.comparison.status,'uncertain');assert.equal(final.status,'paused');assert.equal(final.queued,2);assert.equal(x.created.length,0);await x.controller.dispatch(message,x.sender);assert.equal(x.events.filter(event=>event[0]==='comparison-post').length,1);
});

test('no stored source receipt is never accepted as success and the exact source remains pending',async()=>{
 const x=harness();x.sourceAck=value=>{delete value.storedReceipt;return value;};await x.start(x.message(1));const final=await x.finish();assert.equal(final.saved,0);assert.equal(final.uncertain,1);assert.equal(x.pending.size,1);assert.equal(x.rawSources.length,1);
});

test('stable source capture ID rejects a changed immutable snapshot without another POST',async()=>{
 const x=harness();x.throwSourceAck=true;await x.start(x.message(1));await x.finish();const before=clone([...x.pending.values()][0]),changed=clone(before.snapshot);changed.title+=' changed';
 await assert.rejects(savePageSource({snapshot:changed},{frameId:0,url:before.snapshot.sourceUrl,tab:{id:x.listing.id+400,windowId:x.listing.windowId}},x.api,x.sourceStore,{captureId:before.id,expectedReceiver:{tab:x.app,scope:{ownerId:x.ownerId,company:clone(x.company),origin}},activate:false,requireStoredReceipt:true,manualRetryOnly:true}),/원래 수집 요청번호/);
 assert.deepEqual([...x.pending.values()][0],before);assert.equal(x.rawSources.length,1);assert.equal(await sourceFingerprint(before.snapshot),before.fingerprint);
});

for(const destinations of [['ai-registration'],['rocket-compare'],['ai-registration','rocket-compare']])test('worker → listing UI reply contract accepts actual START and final receipts for '+destinations.join('+'),async()=>{
 const x=harness(),{message,result}=await x.start(x.message(2,destinations));assert.equal(validateListingBatchReply(result,{batchId:message.payload.batchId,destinations}).status,'running');
 const final=await x.finish();assert.equal(validateListingBatchReply({ok:true,batch:final},{batchId:message.payload.batchId,destinations}).status,'completed');
});

test('pre-persistence validation and login rejections explicitly prove the requested batch was not accepted',async()=>{
 const x=harness(),invalid=x.message();invalid.payload.items[0].unitPriceCny=0.28;
 const rejected=await x.controller.dispatch(invalid,x.sender);assert.equal(rejected.ok,false);assert.equal(rejected.accepted,false);assert.equal(rejected.batchId,invalid.payload.batchId);assert.equal(rejected.code,'LISTING_ITEMS');assert.equal(listingStartNotCreated(rejected,invalid.payload.batchId),true);assert.equal(x.records.size,0);assert.equal(x.created.length,0);
 const login=harness({resolveReceiver:async()=>{throw Object.assign(Error('Synthetic login required'),{code:'YOOFAM_LOGIN_REQUIRED'});}}),request=login.message();
 const auth=await login.controller.dispatch(request,login.sender);assert.deepEqual(auth,{ok:false,accepted:false,batchId:request.payload.batchId,code:'YOOFAM_LOGIN_REQUIRED',error:'Synthetic login required'});assert.equal(listingStartNotCreated(auth,request.payload.batchId),true);assert.equal(login.records.size,0);assert.equal(login.created.length,0);
});

test('a different pending batch rejects only the new requested ID with an absence proof while preserving the original work',async()=>{
 const x=harness();let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 x.beforeCollect=async()=>{entered();await gate;};
 try{
  const first=await x.start(x.message(1));await started;const second=x.message(1);const rejected=await x.controller.dispatch(second,x.sender);
  assert.equal(rejected.accepted,false);assert.equal(rejected.batchId,second.payload.batchId);assert.equal(rejected.code,'BATCH_PENDING');assert.equal(await x.controller._read(second.payload.batchId),undefined);assert.equal((await x.status()).batch.batchId,first.message.payload.batchId);assert.equal(x.created.length,1);
 }finally{release();await x.controller.waitIdle();}
 assert.equal(x.server.size,1);
});

test('a descriptor put with a lost commit ACK never emits accepted:false and never starts a second run',async()=>{
 const x=harness(),request=x.message(1),engine=createListingBatchController({api:x.api,sourceStore:x.sourceStore,store:async(action,input)=>{const result=await x.store(action,input);if(action==='put'&&input.key.startsWith('batch:'))throw Error('Synthetic descriptor commit ACK lost');return result;}});
 await assert.rejects(engine.dispatch(request,x.sender),/commit ACK lost/);assert.ok(await x.controller._read(request.payload.batchId));assert.equal(x.created.length,0);
 const restored=await x.controller.dispatch({type:'YOOFAM_LISTING_BATCH_STATUS',batchId:request.payload.batchId},x.sender);assert.equal(restored.batch.status,'paused');assert.equal(restored.batch.queued,1);assert.equal(x.server.size,0);
});

test('lost START response recovers its original persisted batch rather than returning non-acceptance proof or replaying saved source',async()=>{
 const x=harness(),{message}=await x.start(x.message(1));await x.finish();
 // Simulate transport dropping the returned START ACK; status and the same
 // original request still observe the one durable source save.
 const duplicate=await x.controller.dispatch(message,x.sender);assert.equal(duplicate.ok,true);assert.equal(duplicate.accepted,undefined);assert.equal(duplicate.batch.saved,1);assert.equal(x.rawSources.length,1);assert.equal(x.created.length,1);
 const corrupt=clone(message);corrupt.payload.items=[];await assert.rejects(x.controller.dispatch(corrupt,x.sender));assert.equal(x.rawSources.length,1);
});

test('an unavailable absence check does not become accepted:false',async()=>{
 const x=harness(),invalid=x.message();invalid.payload.items=[];const engine=createListingBatchController({api:x.api,store:async()=>{throw Error('Synthetic durable store unavailable');}});
 await assert.rejects(engine.dispatch(invalid,x.sender),/선택한 상품/);assert.equal(x.created.length,0);
});

test('array/object identifiers cannot be coerced to valid UUIDs at START, controls or detail leases',async()=>{
 const x=harness(),valid=x.message(1),bad=clone(valid);bad.payload.batchId=[valid.payload.batchId];assert.throws(()=>validateListingBatchStart(bad,x.sender));await assert.rejects(x.controller.dispatch(bad,x.sender));assert.equal(x.records.size,0);assert.equal(x.created.length,0);
 for(const type of ['YOOFAM_LISTING_BATCH_STATUS','YOOFAM_LISTING_BATCH_CANCEL','YOOFAM_LISTING_BATCH_RESUME'])await assert.rejects(x.controller.dispatch({type,batchId:[valid.payload.batchId]},x.sender));
 x.beforeCollect=async({authMessage,detailSender,controller})=>{for(const field of ['batchId','itemId'])await assert.rejects(controller.authenticate({...authMessage,payload:{...authMessage.payload,[field]:[authMessage.payload[field]]}},detailSender));};
 await x.start(valid);assert.equal((await x.finish()).saved,1);
});

test('overlapping same-ID START remains unknown until the other acceptance attempt resolves',async()=>{
 const x=harness(),request=x.message(1,['rocket-compare']);let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 const engine=createListingBatchController({api:x.api,sourceStore:x.sourceStore,store:x.store,resolveReceiver:async()=>{entered();await gate;return{tab:x.app,scope:{ownerId:x.ownerId,company:clone(x.company),origin}};}});
 const first=engine.dispatch(request,x.sender);
 try{await started;const malformed=clone(request);malformed.payload.items=[];await assert.rejects(engine.dispatch(malformed,x.sender),/선택한 상품/);assert.equal(await engine._read(request.payload.batchId),undefined);}
 finally{release();await first;await engine.waitIdle();}
 assert.equal((await engine._read(request.payload.batchId)).status,'completed');assert.equal(x.events.filter(event=>event[0]==='comparison-post').length,1);
});
