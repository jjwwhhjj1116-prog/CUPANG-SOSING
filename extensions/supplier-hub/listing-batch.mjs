import {pageSourceUrl,validatePageSourceForDelivery} from './page-source.mjs';
import {savePageSource,sourceInboxStore,sourceFingerprint,resolveSourceInboxReceiver,recheckSourceInboxReceiver,activateSourceInboxReceiver} from './source-inbox.mjs';

const FORMAT='yoofam-listing-batch-v1',UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const DESTINATIONS=['ai-registration','rocket-compare'];
const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const clone=value=>structuredClone(value),canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
const failure=(code,message)=>Object.assign(Error(message),{code});
const errorText=error=>(error instanceof Error?error.message:'상품 수집 결과를 확인하지 못했습니다.').slice(0,1000);
function listingUrl(value){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.hostname!=='s.1688.com'||url.port||url.username||url.password||url.pathname!=='/selloffer/offer_search.htm'||url.href.length>6000)throw failure('LISTING_SCOPE','현재 1688 검색 목록에서 선택해주세요.');
 url.hash='';return url.href;
}
function senderListing(sender){
 if(sender?.frameId!==0||!Number.isSafeInteger(sender.tab?.id)||!Number.isSafeInteger(sender.tab?.windowId)||sender.tab.id<0||sender.tab.windowId<0)throw failure('LISTING_SCOPE','현재 1688 검색 목록에서 선택해주세요.');
 return {tabId:sender.tab.id,windowId:sender.tab.windowId,listingUrl:listingUrl(sender.url)};
}
function candidate(value){
 if(!exact(value,['offerId','sourceUrl','title','thumbnail','displayPrice'])||typeof value.offerId!=='string'||!/^[1-9]\d{0,19}$/.test(value.offerId))throw failure('LISTING_ITEMS','선택한 상품의 원문 연결을 확인해주세요.');
 const source=pageSourceUrl(value.sourceUrl);
 if(source.offerId!==value.offerId||source.sourceUrl!==value.sourceUrl||typeof value.title!=='string'||!value.title.trim()||value.title!==value.title.trim()||value.title.length>500||/[\u0000-\u001f]/.test(value.title)
  ||typeof value.displayPrice!=='string'||value.displayPrice.length>120||value.displayPrice!==value.displayPrice.trim()||/[\u0000-\u001f]/.test(value.displayPrice)||typeof value.thumbnail!=='string'||value.thumbnail.length>2048)throw failure('LISTING_ITEMS','선택한 상품의 표시 정보가 올바르지 않습니다.');
 if(value.thumbnail){const image=new URL(value.thumbnail);if(image.protocol!=='https:'||image.username||image.password||image.port||image.hash||!(image.hostname==='alicdn.com'||image.hostname.endsWith('.alicdn.com')))throw failure('LISTING_ITEMS','선택한 상품의 이미지 출처가 올바르지 않습니다.');}
 return clone(value);
}
export function validateListingBatchStart(message,sender){
 const source=senderListing(sender),payload=message?.payload;
 if(!exact(message,['type','payload'])||message.type!=='YOOFAM_LISTING_BATCH_START'||!exact(payload,['version','batchId','listingUrl','items','destinations'])||payload.version!==1||typeof payload.batchId!=='string'||!UUID.test(payload.batchId)
  ||listingUrl(payload.listingUrl)!==source.listingUrl||!Array.isArray(payload.items)||payload.items.length<1||payload.items.length>60||Object.keys(payload.items).length!==payload.items.length
  ||!Array.isArray(payload.destinations)||payload.destinations.length<1||payload.destinations.length>2||new Set(payload.destinations).size!==payload.destinations.length||payload.destinations.some(value=>!DESTINATIONS.includes(value)))throw failure('LISTING_ITEMS','선택한 상품과 담을 위치를 확인해주세요. 한 번에 60개까지 담을 수 있습니다.');
 const items=payload.items.map(candidate);if(new Set(items.map(item=>item.offerId)).size!==items.length||new TextEncoder().encode(canonical(payload)).length>256*1024)throw failure('LISTING_ITEMS','중복되거나 너무 큰 선택 목록은 전송하지 않았습니다.');
 return {source,payload:{...clone(payload),items}};
}
function scopeKey(source,receiver){return canonical([source.windowId,receiver.scope.origin,receiver.scope.ownerId,receiver.scope.company.code,receiver.scope.company.name]);}
function latestKey(source,receiver){return 'latest:'+canonical([source.tabId,source.windowId,source.listingUrl,scopeKey(source,receiver)]);}
const batchKey=id=>'batch:'+id,laneKey=(source,receiver)=>'lane:'+scopeKey(source,receiver);
function sameReceiver(left,right){return left?.tab?.id===right?.tab?.id&&left?.tab?.windowId===right?.tab?.windowId&&canonical(left?.scope)===canonical(right?.scope);}
function itemActive(item){return ['opening','reading','saving'].includes(item.status);}
function unfinished(batch){return batch.items.some(item=>item.status==='queued'||itemActive(item)||item.status==='uncertain')||['queued','saving','uncertain'].includes(batch.comparison.status)&&batch.destinations.includes('rocket-compare');}
function computeStatus(batch){
 const ai=batch.destinations.includes('ai-registration'),compare=batch.destinations.includes('rocket-compare');
 if(batch.cancelRequested)return 'cancelled';
 if(batch.items.some(item=>item.status==='uncertain')||compare&&batch.comparison.status==='uncertain')return 'paused';
 if(ai&&batch.items.some(item=>item.status==='queued'||itemActive(item))||compare&&['queued','saving'].includes(batch.comparison.status))return 'running';
 if((!ai||batch.items.every(item=>item.status==='saved'))&&(!compare||batch.comparison.status==='saved'))return 'completed';
 return 'partial';
}
function receiptProjection(receipt){return receipt?{storedId:receipt.storedId,captureVersion:receipt.captureVersion,receivedAt:receipt.receivedAt}:undefined;}
function project(batch){
 return {batchId:batch.batchId,status:batch.status,destinations:clone(batch.destinations),items:batch.items.map(item=>({itemId:item.itemId,offerId:item.offerId,sourceUrl:item.sourceUrl,title:item.title,thumbnail:item.thumbnail,displayPrice:item.displayPrice,status:item.status,...(item.error?{error:item.error}:{}),...(item.storedReceipt?{storedReceipt:receiptProjection(item.storedReceipt)}:{})})),
  total:batch.items.length,saved:batch.items.filter(item=>item.status==='saved').length,failed:batch.items.filter(item=>item.status==='failed').length,uncertain:batch.items.filter(item=>item.status==='uncertain').length,queued:batch.items.filter(item=>item.status==='queued').length,
  ...(batch.destinations.includes('rocket-compare')?{comparison:clone(batch.comparison)}:{}),cancelRequested:batch.cancelRequested,createdAt:batch.createdAt,updatedAt:batch.updatedAt,...(batch.error?{error:batch.error}:{})};
}
/** Separate durable descriptors; snapshots stay in the existing source inbox. */
export function listingBatchStore(action,input){
 return new Promise((resolve,reject)=>{
  const open=indexedDB.open('yoofam-listing-batches',1);open.onupgradeneeded=()=>open.result.createObjectStore('records',{keyPath:'key'});open.onerror=()=>reject(failure('BATCH_STORAGE','다중 수집 기록을 열지 못했습니다.'));
  open.onsuccess=()=>{const db=open.result,tx=db.transaction('records',action==='get'?'readonly':'readwrite'),records=tx.objectStore('records'),request=action==='get'?records.get(input):records.put(input);let result;
   request.onsuccess=()=>{result=action==='get'?request.result?.value:undefined;};tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(failure('BATCH_STORAGE','다중 수집 기록 저장을 확인하지 못했습니다.'));};tx.onabort=tx.onerror;};
 });
}

/** Real tabs and the existing full-source saver are injected for isolated tests.
 * No source HTTP request, browser cookie or Supplier Hub action is used here. */
export function createListingBatchController({api=globalThis.chrome,store=listingBatchStore,sourceStore=sourceInboxStore,saveSource=savePageSource,resolveReceiver=resolveSourceInboxReceiver,recheckReceiver=recheckSourceInboxReceiver,activateReceiver=activateSourceInboxReceiver,
 now=Date.now,uuid=()=>crypto.randomUUID(),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),readyTimeoutMs=30000,leaseMs=60000}={}){
 const running=new Map(),saves=new Map(),startAttempts=new Map();let lock=Promise.resolve();
 const locked=run=>{const task=lock.then(run);lock=task.catch(()=>{});return task;};
 const read=id=>store('get',batchKey(id));
 const put=async batch=>{batch.updatedAt=now();await store('put',{key:batchKey(batch.batchId),value:clone(batch)});};
 const savePointer=(key,value)=>store('put',{key,value});
 const activeRecord=async(id,run)=>locked(async()=>{const batch=await read(id);if(!batch||!running.has(id))throw failure('BATCH_INTERRUPTED','다중 수집 실행 연결이 끝났습니다. 저장을 반복하지 않았습니다.');return run(batch);});
 async function bounded(run,timeoutMs,message){
  let timer;try{return await Promise.race([Promise.resolve().then(run),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('BATCH_TIMEOUT',message)),Math.max(1,timeoutMs));})]);}finally{clearTimeout(timer);}
 }
 async function currentReceiver(batch){await recheckReceiver(batch.receiver,api);return batch.receiver;}
 async function liveOwned(batch,item,{inactive=false,allowLoading=false}={}){
  if(!item.ownedTab||item.ownedTab.epoch!==batch.runEpoch)throw failure('BATCH_TAB','원래 상세 수집 탭을 확인하지 못했습니다.');
  const tab=await api.tabs.get(item.ownedTab.tabId);
  if(tab.windowId!==batch.source.windowId||inactive&&tab.active)throw failure('BATCH_TAB','상세 수집 탭이 변경됐거나 사용 중입니다.');
  if(allowLoading&&tab.pendingUrl&&pageSourceUrl(tab.pendingUrl).sourceUrl===item.sourceUrl&&(!tab.url||tab.url==='about:blank'||pageSourceUrl(tab.url).sourceUrl===item.sourceUrl))return tab;
  if(tab.pendingUrl||pageSourceUrl(tab.url).sourceUrl!==item.sourceUrl)throw failure('BATCH_TAB','상세 수집 탭이 변경됐거나 사용 중입니다.');
  return tab;
 }
 async function closeOwned(batch,item){
  try{const tab=await liveOwned(batch,item,{inactive:true});await api.tabs.remove(tab.id);}catch{/* A user-activated, changed or missing tab is never closed. */}
 }
 async function interrupted(batch){
  if(running.has(batch.batchId))return batch;
  let changed=false;
  for(const item of batch.items)if(itemActive(item)){
   const saving=item.status==='saving';item.status=saving?'uncertain':'failed';item.error=saving?'저장 응답을 확인하지 못했습니다. 같은 원문을 다시 전송하지 않았습니다.':'확장 실행이 중단되어 상세 수집을 완료하지 못했습니다. 저장은 요청하지 않았습니다.';changed=true;
  }
  if(batch.comparison.status==='saving'){batch.comparison.status='uncertain';batch.comparison.error='비교함 저장 응답을 확인하지 못했습니다. 저장을 반복하지 않았습니다.';changed=true;}
  if(changed||batch.status==='running'){
   batch.status=unfinished(batch)?'paused':computeStatus(batch);await put(batch);
  }
  return batch;
 }
 async function checkIngress(message,sender){
  const source=senderListing(sender);
  const receiver=await resolveReceiver(source.windowId,api),actual=await api.tabs.get(source.tabId);
  if(actual.windowId!==source.windowId||actual.pendingUrl||listingUrl(actual.url)!==source.listingUrl)throw failure('LISTING_SCOPE','검색 목록이 변경되었습니다. 현재 화면에서 다시 선택해주세요.');
  return {source,receiver};
 }
 async function forCaller(message,sender){
  const caller=await checkIngress(message,sender),id=message.batchId??await store('get',latestKey(caller.source,caller.receiver));
  if(id===undefined||id===null)return {...caller,batch:null};
  if(typeof id!=='string'||!UUID.test(id))throw failure('BATCH_ID','다중 수집 요청번호를 확인해주세요.');
  const batch=await read(id);
  if(!batch)return {...caller,batch:null};
  if(batch.format!==FORMAT||batch.source.tabId!==caller.source.tabId||batch.source.windowId!==caller.source.windowId||batch.source.listingUrl!==caller.source.listingUrl||!sameReceiver(batch.receiver,caller.receiver))throw failure('BATCH_SCOPE','수집 당시의 회원·회사·검색 창에서 확인해주세요.');
  return {...caller,batch};
 }
 async function waitReady(batch,item){
  const deadline=now()+readyTimeoutMs;let lastError;
  while(now()<deadline){
   await currentReceiver(batch);const tab=await liveOwned(batch,item,{inactive:true,allowLoading:true});
   try{const reply=tab.pendingUrl?null:await bounded(()=>api.tabs.sendMessage(tab.id,{type:'YOOFAM_BULK_PAGE_READY'},{frameId:0}),Math.min(2000,deadline-now()),'상세 수집기 응답이 없습니다.'),result=reply?.result;
    if(reply?.ok===true&&exact(result,['sourceUrl','offerId','version'])&&result.sourceUrl===item.sourceUrl&&result.offerId===item.offerId&&typeof result.version==='string'&&/^\d+\.\d+\.\d+$/.test(result.version))return;
   }catch(error){lastError=error;}
   const fresh=await read(batch.batchId);if(fresh?.cancelRequested)throw failure('BATCH_CANCELLED','남은 상품 수집을 중단했습니다.');
   await pause(250);
  }
  throw failure('BATCH_PAGE_TIMEOUT',lastError?'상세 수집기를 열지 못했습니다. 로그인·차단 화면 또는 탭 상태를 확인해주세요.':'상세 상품 정보 준비 시간이 초과되었습니다.');
 }
 async function comparison(batch){
  if(!batch.destinations.includes('rocket-compare')||batch.comparison.status!=='queued')return;
  await currentReceiver(batch);
  await activeRecord(batch.batchId,async fresh=>{if(fresh.cancelRequested)return;fresh.comparison.status='saving';await put(fresh);});
  const before=await read(batch.batchId);if(before.comparison.status!=='saving')return;
  const items=before.items.map(({offerId,sourceUrl,title,thumbnail,displayPrice})=>({offerId,sourceUrl,title,thumbnail,displayPrice}));
  const payload={batchId:before.batchId,captureId:before.comparison.captureId,listingUrl:before.source.listingUrl,items};
  let receipt;
  try{
   const result=await bounded(()=>api.tabs.sendMessage(before.receiver.tab.id,{type:'YOOFAM_SAVE_LISTING_COMPARISONS',...payload,expectedOwnerId:before.receiver.scope.ownerId,company:clone(before.receiver.scope.company)},{frameId:0}),30000,'비교함 저장 응답이 미확정입니다. 다시 저장하지 않았습니다.');
   receipt=result?.receipt;const expectedHash=await digest(payload);
   if(result?.ok!==true||!exact(receipt,['format','captureId','batchId','ownerId','company','stored','revision','storedCount','existingCount','itemOfferIds','payloadSha256','recordedAt'])||receipt.format!=='yoofam-listing-comparison-receipt-v1'
    ||receipt.captureId!==payload.captureId||receipt.batchId!==payload.batchId||receipt.ownerId!==before.receiver.scope.ownerId||canonical(receipt.company)!==canonical(before.receiver.scope.company)||receipt.stored!==true
    ||!Number.isSafeInteger(receipt.revision)||receipt.revision<1||![receipt.storedCount,receipt.existingCount].every(value=>Number.isSafeInteger(value)&&value>=0)||receipt.storedCount+receipt.existingCount!==items.length
    ||canonical(receipt.itemOfferIds)!==canonical(items.map(item=>item.offerId))||receipt.payloadSha256!==expectedHash||typeof receipt.recordedAt!=='string'||!Number.isFinite(Date.parse(receipt.recordedAt))||Date.parse(receipt.recordedAt)>now()+60000)throw failure('BATCH_COMPARE_ACK','비교함의 실제 저장 영수증을 확인하지 못했습니다.');
   await currentReceiver(before);
   await activeRecord(before.batchId,async fresh=>{fresh.comparison={...fresh.comparison,status:'saved',storedCount:receipt.storedCount,existingCount:receipt.existingCount,revision:receipt.revision,receipt:clone(receipt)};
    if(!fresh.destinations.includes('ai-registration'))for(const item of fresh.items)item.status='saved';await put(fresh);});
  }catch(error){await activeRecord(before.batchId,async fresh=>{fresh.comparison.status='uncertain';fresh.comparison.error=errorText(error);fresh.error='비교함 저장 결과가 미확정입니다. 저장을 반복하지 않았습니다.';fresh.status='paused';await put(fresh);});throw error;}
 }
 async function collectOne(batch,itemId){
  let current=await read(batch.batchId),item=current.items.find(value=>value.itemId===itemId);if(!item||item.status!=='queued'||current.cancelRequested)return;
  await currentReceiver(current);
  await activeRecord(current.batchId,async fresh=>{const next=fresh.items.find(value=>value.itemId===itemId);if(next.status!=='queued'||fresh.cancelRequested)return;next.status='opening';await put(fresh);});
  current=await read(current.batchId);item=current.items.find(value=>value.itemId===itemId);if(item.status!=='opening')return;
  let owned;
  try{
   owned=await api.tabs.create({windowId:current.source.windowId,url:item.sourceUrl,active:false});
   if(!Number.isSafeInteger(owned?.id)||owned.windowId!==current.source.windowId||owned.active===true)throw failure('BATCH_TAB','같은 창의 전용 상세 탭을 열지 못했습니다.');
   await activeRecord(current.batchId,async fresh=>{const next=fresh.items.find(value=>value.itemId===itemId);next.ownedTab={tabId:owned.id,epoch:fresh.runEpoch};next.status='reading';await put(fresh);});
   current=await read(current.batchId);item=current.items.find(value=>value.itemId===itemId);await waitReady(current,item);await currentReceiver(current);
   const nonce=uuid(),deadlineAt=now()+Math.max(1000,Math.min(60000,leaseMs));
   await activeRecord(current.batchId,async fresh=>{const next=fresh.items.find(value=>value.itemId===itemId);if(next.status!=='reading'||fresh.cancelRequested)throw failure('BATCH_CANCELLED','남은 상품 수집을 중단했습니다.');next.leaseNonce=nonce;next.deadlineAt=deadlineAt;await put(fresh);});
   current=await read(current.batchId);item=current.items.find(value=>value.itemId===itemId);
   const response=await bounded(()=>api.tabs.sendMessage(owned.id,{type:'YOOFAM_BULK_COLLECT_PAGE',payload:{batchId:current.batchId,itemId,leaseNonce:nonce,sourceUrl:item.sourceUrl,deadlineAt}},{frameId:0}),deadlineAt-now(),'상세 수집 응답 시간이 초과되었습니다. 저장 요청은 반복하지 않았습니다.');
   await activeRecord(current.batchId,async fresh=>{const next=fresh.items.find(value=>value.itemId===itemId);if(next.status==='saved')return;
    if(next.status==='saving'){next.status='uncertain';next.error='상세 수집의 저장 응답을 확인하지 못했습니다. 원문은 다시 전송하지 않았습니다.';}else if(next.status==='reading'){next.status='failed';next.error=errorText(response?.error?Error(response.error):Error('상세 수집 완료 응답이 없습니다.'));}await put(fresh);});
  }catch(error){
   await activeRecord(current.batchId,async fresh=>{const next=fresh.items.find(value=>value.itemId===itemId);if(next.status==='saved')return;next.status=next.status==='saving'?'uncertain':'failed';next.error=errorText(error);await put(fresh);});
  }finally{
   const latest=await read(current.batchId),last=latest?.items.find(value=>value.itemId===itemId);if(last?.ownedTab)await closeOwned(latest,last);
  }
 }
 async function drain(batchId){
  try{
   let batch=await read(batchId);await comparison(batch);
   batch=await read(batchId);
   if(batch.destinations.includes('ai-registration'))for(const item of batch.items){
    batch=await read(batchId);if(batch.cancelRequested||batch.comparison.status==='uncertain'||batch.items.some(value=>value.status==='uncertain'))break;
    if(item.status==='queued')await collectOne(batch,item.itemId);
   }
  }catch(error){await activeRecord(batchId,async batch=>{batch.error=errorText(error);batch.status='paused';await put(batch);});}
  finally{
   try{const result=await activeRecord(batchId,async batch=>{if(batch.cancelRequested)for(const item of batch.items)if(item.status==='queued')item.status='cancelled';batch.status=computeStatus(batch);if(batch.status==='running')batch.status='paused';await put(batch);return batch;});
    const listing=await api.tabs.get(result.source.tabId);if(listing.windowId===result.source.windowId&&listing.active===true&&listingUrl(listing.url)===result.source.listingUrl&&(result.items.some(item=>item.status==='saved')||result.comparison.status==='saved'))await activateReceiver(result.receiver,api);
   }catch{/* Stored observations survive a missing source tab or failed focus. */}
  }
 }
 function launch(batch){const task=Promise.resolve().then(()=>drain(batch.batchId));running.set(batch.batchId,task);void task.finally(()=>{if(running.get(batch.batchId)===task)running.delete(batch.batchId);}).catch(()=>{});}
 async function start(message,sender,attempt){
  const input=validateListingBatchStart(message,sender),caller=await checkIngress(message,sender),requestHash=await digest(input.payload);
  return locked(async()=>{
   const previous=await read(input.payload.batchId);
   if(previous){if(previous.requestHash!==requestHash||previous.source.tabId!==caller.source.tabId||!sameReceiver(previous.receiver,caller.receiver))throw failure('BATCH_CONFLICT','기존 다중 수집 요청번호의 내용이 다릅니다. 원래 기록을 유지했습니다.');return {ok:true,batch:project(await interrupted(previous))};}
   const lane=laneKey(caller.source,caller.receiver),previousId=await store('get',lane),prior=previousId&&await read(previousId);
   if(prior&&unfinished(prior))throw failure('BATCH_PENDING','이 창에 아직 끝나지 않은 다중 수집이 있습니다. 원래 작업 결과부터 확인해주세요.');
   const time=now(),batch={format:FORMAT,batchId:input.payload.batchId,requestHash,source:caller.source,receiver:clone(caller.receiver),destinations:clone(input.payload.destinations),runEpoch:uuid(),status:'running',cancelRequested:false,createdAt:time,updatedAt:time,
    comparison:{captureId:uuid(),status:input.payload.destinations.includes('rocket-compare')?'queued':'cancelled',storedCount:0,existingCount:0},items:input.payload.items.map(item=>({...item,itemId:uuid(),captureId:uuid(),status:'queued'}))};
   attempt.persistAttempted=true;
   await put(batch);await savePointer(lane,batch.batchId);await savePointer(latestKey(caller.source,caller.receiver),batch.batchId);launch(batch);return {ok:true,batch:project(batch)};
  });
 }
 async function startWithAcceptanceProof(message,sender){
  const requested=message?.payload?.batchId,id=typeof requested==='string'&&UUID.test(requested)?requested:null,attempt={persistAttempted:false};
  if(id)startAttempts.set(id,(startAttempts.get(id)??0)+1);
  try{return await start(message,sender,attempt);}
  catch(error){
   // Only a definite pre-persistence rejection can release the listing's
   // pending START. A put error, lost ACK, existing descriptor, overlapping
   // START or unavailable durable read leaves acceptance unknown.
   if(id&&!attempt.persistAttempted){
    try{const proof=await locked(async()=>{
     if(startAttempts.get(id)!==1)return null;
     const stored=await read(id);
     if(stored!==undefined&&stored!==null||startAttempts.get(id)!==1)return null;
     const code=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)?error.code:'LISTING_BATCH_REJECTED';
     return {ok:false,accepted:false,batchId:id,code,error:errorText(error)||'다중 수집 요청을 시작하지 않았습니다.'};
    });if(proof)return proof;}catch{/* An unreadable descriptor is not proof of absence. */}
   }
   throw error;
  }finally{if(id){const remaining=(startAttempts.get(id)??1)-1;if(remaining>0)startAttempts.set(id,remaining);else startAttempts.delete(id);}}
 }
 async function dispatch(message,sender){
  if(message?.type==='YOOFAM_LISTING_BATCH_START')return startWithAcceptanceProof(message,sender);
  if(!['YOOFAM_LISTING_BATCH_STATUS','YOOFAM_LISTING_BATCH_CANCEL','YOOFAM_LISTING_BATCH_RESUME'].includes(message?.type)||!object(message)||Object.keys(message).some(key=>!['type','batchId'].includes(key)))throw failure('BATCH_MESSAGE','다중 수집 요청을 확인해주세요.');
  const caller=await forCaller(message,sender);if(!caller.batch)return {ok:true,batch:null};
  return locked(async()=>{
   const batch=await interrupted(await read(caller.batch.batchId));
   if(message.type==='YOOFAM_LISTING_BATCH_CANCEL'){
    batch.cancelRequested=true;for(const item of batch.items)if(item.status==='queued')item.status='cancelled';if(batch.comparison.status==='queued')batch.comparison.status='cancelled';batch.status='cancelled';await put(batch);
   }else if(message.type==='YOOFAM_LISTING_BATCH_RESUME'){
    if(running.has(batch.batchId))return {ok:true,batch:project(batch)};
    if(batch.items.some(item=>item.status==='uncertain'||item.status==='saving')||batch.comparison.status==='uncertain'||batch.comparison.status==='saving')throw failure('BATCH_UNCERTAIN','미확정 저장이 있어 재개하지 않았습니다. 원래 저장 기록을 확인해주세요.');
    if(!batch.items.some(item=>item.status==='queued')&&batch.comparison.status!=='queued')throw failure('BATCH_FINISHED','아직 시작하지 않은 대기 상품이 없습니다.');
    batch.cancelRequested=false;batch.runEpoch=uuid();batch.status='running';delete batch.error;await put(batch);launch(batch);
   }
   return {ok:true,batch:project(batch)};
  });
 }
 async function validateLease(message,sender){
  const p=message?.payload??message?.bulk;
  if(!object(p)||typeof p.batchId!=='string'||!UUID.test(p.batchId)||typeof p.itemId!=='string'||!UUID.test(p.itemId)||typeof p.leaseNonce!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(p.leaseNonce)||sender?.frameId!==0||!Number.isSafeInteger(sender.tab?.id)||!Number.isSafeInteger(sender.tab?.windowId))throw failure('BATCH_LEASE','전용 상세 수집 요청을 확인하지 못했습니다.');
  const batch=await read(p.batchId),item=batch?.items.find(value=>value.itemId===p.itemId);
  if(!batch||!running.has(batch.batchId)||!item||!['reading','saving'].includes(item.status)||batch.cancelRequested||batch.source.windowId!==sender.tab.windowId||item.ownedTab?.tabId!==sender.tab.id||item.ownedTab.epoch!==batch.runEpoch
   ||item.leaseNonce!==p.leaseNonce||!Number.isSafeInteger(item.deadlineAt)||item.deadlineAt<=now()||pageSourceUrl(sender.url).sourceUrl!==item.sourceUrl
   ||p.sourceUrl!==undefined&&p.sourceUrl!==item.sourceUrl||p.deadlineAt!==undefined&&p.deadlineAt!==item.deadlineAt)throw failure('BATCH_LEASE','다중 수집의 원래 상품·탭·시간 연결이 만료되거나 변경됐습니다.');
  await currentReceiver(batch);await liveOwned(batch,item,{inactive:true});
  const latest=await read(batch.batchId),fresh=latest.items.find(value=>value.itemId===item.itemId);
  if(latest.cancelRequested||fresh.leaseNonce!==item.leaseNonce||fresh.status!==item.status||fresh.deadlineAt<=now())throw failure('BATCH_LEASE','다중 수집 연결이 변경됐습니다.');
  return {batch:latest,item:fresh,lease:{batchId:batch.batchId,itemId:item.itemId,leaseNonce:item.leaseNonce,sourceUrl:item.sourceUrl,deadlineAt:item.deadlineAt,ownerId:batch.receiver.scope.ownerId,company:clone(batch.receiver.scope.company),origin:batch.receiver.scope.origin,appTabId:batch.receiver.tab.id,windowId:batch.source.windowId,tabId:sender.tab.id}};
 }
 async function authenticate(message,sender){const value=await validateLease(message,sender);return {ok:true,lease:value.lease};}
 async function save(message,sender){
  const authorized=await validateLease(message,sender),{batch,item}=authorized,snapshot=validatePageSourceForDelivery(message.snapshot);
  if(snapshot.sourceUrl!==item.sourceUrl||snapshot.offerId!==item.offerId)throw failure('BATCH_SOURCE','선택한 상품과 상세 원문이 다릅니다.');
  const fingerprint=await sourceFingerprint(snapshot),key=batch.batchId+':'+item.itemId,existing=saves.get(key);
  if(existing){if(existing.fingerprint!==fingerprint)throw failure('BATCH_SOURCE','같은 수집 요청의 원문이 달라졌습니다.');return existing.promise;}
  await activeRecord(batch.batchId,async fresh=>{const value=fresh.items.find(row=>row.itemId===item.itemId);if(value.status!=='reading'||fresh.cancelRequested||value.deadlineAt<=now())throw failure('BATCH_UNCERTAIN','같은 상품의 저장을 반복하지 않았습니다.');value.status='saving';value.fingerprint=fingerprint;await put(fresh);});
  const promise=(async()=>{
   let result;
   try{result=await saveSource({type:'YOOFAM_SAVE_PAGE_SOURCE',snapshot},sender,api,sourceStore,{captureId:item.captureId,expectedReceiver:batch.receiver,activate:false,requireStoredReceipt:true,manualRetryOnly:true});
    const receipt=result?.storedReceipt;
    if(result?.ok!==true||result.delivered!==true||result.id!==item.captureId||result.fingerprint!==fingerprint||result.ownerId!==batch.receiver.scope.ownerId||canonical(result.company)!==canonical(batch.receiver.scope.company)
     ||!receipt||receipt.ownerId!==batch.receiver.scope.ownerId||canonical(receipt.company)!==canonical(batch.receiver.scope.company)||receipt.sourceUrl!==item.sourceUrl||receipt.fingerprint!==fingerprint||receipt.collectedAt!==snapshot.collectedAt
     ||typeof receipt.storedId!=='string'||!UUID.test(receipt.storedId)||!Number.isSafeInteger(receipt.captureVersion)||receipt.captureVersion<1||!Number.isFinite(Date.parse(receipt.receivedAt)))throw failure('BATCH_SAVE_ACK','실제 서버의 상품 저장 결과를 확인하지 못했습니다. 다시 전송하지 않았습니다.');
    await currentReceiver(batch);
    await activeRecord(batch.batchId,async fresh=>{const value=fresh.items.find(row=>row.itemId===item.itemId);if(value.status!=='saving'||value.fingerprint!==fingerprint)throw failure('BATCH_SAVE_ACK','다중 수집 저장 기록이 변경됐습니다.');value.status='saved';value.storedReceipt=clone(receipt);delete value.error;await put(fresh);});
    return result;
   }catch(error){await activeRecord(batch.batchId,async fresh=>{const value=fresh.items.find(row=>row.itemId===item.itemId);if(value.status!=='saved'){value.status='uncertain';value.error=errorText(error);fresh.status='paused';await put(fresh);}});return {ok:false,error:errorText(error),code:error?.code??'BATCH_SAVE_UNCONFIRMED'};}
  })();saves.set(key,{fingerprint,promise});try{return await promise;}finally{if(saves.get(key)?.promise===promise)saves.delete(key);}
 }
 return {dispatch,authenticate,save,waitIdle:async()=>{await Promise.allSettled([...running.values()]);},_read:read};
}

let controller;
const current=()=>controller??(controller=createListingBatchController());
export const dispatchListingBatch=(message,sender)=>current().dispatch(message,sender);
export const authenticateListingBulkPage=(message,sender)=>current().authenticate(message,sender);
export const saveListingBulkPage=(message,sender)=>current().save(message,sender);
