import {resolveSourceInboxReceiver,recheckSourceInboxReceiver,savePageSource,sourceInboxStore,sourceFingerprint} from './source-inbox.mjs';
import {validatePageSourceForDelivery} from './page-source.mjs';
import {HANDOFF_ORIGINS} from './handoff-store.mjs';
import {parseProductJsonLd} from './product-jsonld.mjs';
import {collectAlibabaMobileCapture} from './mobile-public.mjs';
import {createMobileTransport,supportsMobileTransport} from './mobile-transport.mjs';

const captures=new Map();
const validId=value=>Number.isSafeInteger(value)&&value>=0;
const validRequestId=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);

export function validateCaptureRequest(message,sender){
  let origin,source;
  try{origin=new URL(sender?.url).origin;source=new URL(message?.sourceUrl);}catch{throw Error('앱 주소 또는 1688 상품 주소를 확인하지 못했습니다.');}
  if(!validId(sender?.tab?.id)||!validId(sender?.tab?.windowId)||sender.frameId!==0||!HANDOFF_ORIGINS.includes(origin))throw Error('허용된 앱 탭에서만 상품을 가져올 수 있습니다.');
  if(!['YOOFAM_CAPTURE_1688','YOOFAM_PROBE_1688','YOOFAM_CANCEL_1688'].includes(message?.type)||!validRequestId(message.requestId)||source.protocol!=='https:'||source.hostname!=='detail.1688.com'||source.port||source.username||source.password||source.search||source.hash||!/^\/offer\/[1-9]\d{0,29}\.html$/.test(source.pathname))throw Error('정확한 1688 상품 URL과 수집 요청을 확인해주세요.');
  return {sourceUrl:source.href,windowId:sender.tab.windowId,tabId:sender.tab.id,origin,requestId:message.requestId};
}

export function readProductJsonLd(){
  const scripts=[];let size=0;
  for(const element of document.querySelectorAll('script')){
    if(element.namespaceURI!=='http://www.w3.org/1999/xhtml'||element.getAttribute('type')?.trim().toLowerCase()!=='application/ld+json')continue;
    const value=element.textContent||'';
    size+=new TextEncoder().encode(value).byteLength;
    if(scripts.length>=30||size>1500000)throw Error('상품 구조화 데이터가 수집 한도를 초과했습니다.');
    if(value.trim())scripts.push(value);
  }
  return {pageUrl:location.href,scripts};
}

function sameProductUrl(value,sourceUrl){
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&url.href.split(/[?#]/,1)[0]===sourceUrl;}catch{return false;}
}

function checkTab(tab,identity,{loading=false}={}){
  if(!validId(tab?.id)||tab.windowId!==identity.windowId)throw Error('1688 상품 탭이 요청한 Chrome 창에서 이동하거나 닫혔습니다.');
  if(loading&&tab.status==='loading'&&(!tab.url||tab.url==='about:blank')&&sameProductUrl(tab.pendingUrl,identity.sourceUrl))return;
  if(!sameProductUrl(tab.url,identity.sourceUrl)||tab.pendingUrl&&!sameProductUrl(tab.pendingUrl,identity.sourceUrl))throw Error('1688 상품 페이지 대신 로그인·확인 페이지 또는 다른 상품이 열렸습니다.');
}

function stopped(signal){if(signal.aborted)throw Error('상품 수집을 취소했습니다.');}
function pause(milliseconds,signal){
  stopped(signal);
  return new Promise((resolve,reject)=>{
    const clean=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);};
    const abort=()=>{clean();reject(Error('상품 수집을 취소했습니다.'));};
    const timer=setTimeout(()=>{clean();resolve();},milliseconds);
    signal.addEventListener('abort',abort,{once:true});
  });
}

async function checkApp(api,identity,signal){
  stopped(signal);
  const app=await api.tabs.get(identity.tabId);
  stopped(signal);
  if(app.id!==identity.tabId||app.windowId!==identity.windowId||new URL(app.url).origin!==identity.origin||app.pendingUrl&&new URL(app.pendingUrl).origin!==identity.origin)throw Error('수집을 요청한 앱 탭이 이동하거나 닫혔습니다.');
}

async function waitForComplete(api,tabId,identity,signal,wait){
  // Rechecking also catches a tab moved to another window during navigation.
  const deadline=Date.now()+20000;
  for(let i=0;i<80;i++){
    await checkApp(api,identity,signal);
    const tab=await api.tabs.get(tabId);checkTab(tab,identity,{loading:true});
    if(tab.status==='complete')return;
    if(Date.now()>=deadline)break;
    await wait(250,signal);
  }
  throw Error('1688 상품 페이지 로딩 시간이 초과되었습니다.');
}

/** Readiness uses the same interpretation as the server. It is not a receipt:
 * the server still validates sizes, image sources and the exact job/owner. */
export function productSnapshotReady(scripts,sourceUrl){
  const nodes=[];
  for(const text of scripts){
    const parsed=JSON.parse(text);
    for(const entry of Array.isArray(parsed)?parsed:[parsed]){
      if(!entry||typeof entry!=='object'||Array.isArray(entry))continue;
      nodes.push(entry,...(Array.isArray(entry['@graph'])?entry['@graph']:entry['@graph']===undefined?[]:[entry['@graph']]));
    }
  }
  const product=parseProductJsonLd(nodes,sourceUrl),skus=new Set();
  for(const option of product.options){
    if(skus.has(option.sku.trim())||!Number.isFinite(option.unitPriceCny)||option.unitPriceCny<=0||option.unitPriceCny>100000000)throw Error('옵션 SKU·CNY 원가가 아직 완성되지 않았습니다.');
    skus.add(option.sku.trim());
  }
  return product;
}

async function readStableProductSnapshot(api,tabId,identity,signal,wait,{maxReads=40,maxDurationMs=10000}={}){
  let previous,lastError,stable=0;const deadline=Date.now()+maxDurationMs;
  // A load event can precede hydration. Require three identical, complete
  // SKU/price reads separated by the same 250 ms quiet checks on both paths.
  for(let i=0;i<maxReads;i++){
    await checkApp(api,identity,signal);
    const before=await api.tabs.get(tabId);stopped(signal);checkTab(before,identity);
    if(before.status!=='complete'){
      previous=undefined;stable=0;lastError=Error('상품 페이지가 다시 로딩 중입니다.');
    }else{
      const values=await api.scripting.executeScript({target:{tabId},func:readProductJsonLd});
      stopped(signal);
      const after=await api.tabs.get(tabId);stopped(signal);checkTab(after,identity);
      await checkApp(api,identity,signal);
      if(after.status!=='complete'){
        previous=undefined;stable=0;lastError=Error('상품 페이지가 다시 로딩 중입니다.');
      }else{
        const page=values?.[0]?.result;
        if(values?.length!==1||values[0].frameId!==0||!page||!sameProductUrl(page.pageUrl,identity.sourceUrl))throw Error('1688 상품 페이지 대신 로그인·확인 페이지 또는 다른 상품이 열렸습니다.');
        if(!Array.isArray(page.scripts)||page.scripts.length>30||page.scripts.some(value=>typeof value!=='string')||page.scripts.reduce((sum,value)=>sum+new TextEncoder().encode(value).byteLength,0)>1500000)throw Error('상품 구조화 데이터의 크기 또는 형식을 확인하지 못했습니다.');
        try{
          productSnapshotReady(page.scripts,identity.sourceUrl);
          const snapshot=JSON.stringify(page.scripts);
          stable=previous===snapshot?stable+1:1;previous=snapshot;
          if(stable>=3)return {page};
        }catch(error){lastError=error;previous=undefined;stable=0;}
      }
    }
    if(i+1>=maxReads||Date.now()>=deadline)break;
    await wait(250,signal);
  }
  return {lastError};
}

async function probeExistingProduct(api,tabId,identity,signal,wait){
  const probe=new AbortController();let timer,abort;
  // Chrome calls are not cancellable. Stop waiting after one second and abort
  // this read-only probe so a late response cannot schedule more DOM reads.
  const interrupted=new Promise((resolve,reject)=>{
    abort=()=>{probe.abort();reject(Error('상품 수집을 취소했습니다.'));};
    timer=setTimeout(()=>{probe.abort();resolve({});},1000);
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)abort();
  });
  try{
    return await Promise.race([readStableProductSnapshot(api,tabId,identity,probe.signal,wait,{maxReads:3,maxDurationMs:1000}),interrupted]);
  }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);probe.abort();}
}

export function cancel1688Capture(message,sender){
  const identity=validateCaptureRequest(message,sender);
  if(message.type!=='YOOFAM_CANCEL_1688')throw Error('수집 취소 요청을 확인해주세요.');
  const active=captures.get(identity.windowId);
  if(!active||active.tabId!==identity.tabId||active.origin!==identity.origin||active.requestId!==identity.requestId||active.sourceUrl!==identity.sourceUrl)return {ok:true,cancelled:false};
  active.controller.abort();return {ok:true,cancelled:true};
}

/** A bounded, read-only opportunity before server collection. Unlike CAPTURE,
 * this command cannot open, navigate, fetch, or fall through to mobile sources.
 * The complete inventory/app/DOM sequence shares one one-second deadline. */
export async function probe1688Product(message,sender,api=chrome,options={}){
  const identity=validateCaptureRequest(message,sender);
  if(message.type!=='YOOFAM_PROBE_1688'||Object.keys(message).some(key=>!['type','requestId','sourceUrl'].includes(key)))throw Error('열린 상품 원문 확인 요청을 확인해주세요.');
  const unavailable=()=>({ok:true,sourceUrl:identity.sourceUrl,available:false});
  if(captures.has(identity.windowId))return unavailable();
  const controller=new AbortController(),signal=controller.signal,active={...identity,controller};
  captures.set(identity.windowId,active);
  let timer,abort;
  const interrupted=new Promise((resolve,reject)=>{
    abort=()=>reject(Error('상품 원문 확인을 취소했습니다.'));
    signal.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>{resolve(unavailable());controller.abort();},1000);
  });
  const read=async()=>{
    await checkApp(api,identity,signal);
    const tabs=await api.tabs.query({windowId:identity.windowId});stopped(signal);
    await checkApp(api,identity,signal);
    const existing=tabs.find(tab=>validId(tab.id)&&tab.windowId===identity.windowId&&sameProductUrl(tab.url,identity.sourceUrl));
    if(!existing)return unavailable();
    const current=await api.tabs.get(existing.id);stopped(signal);checkTab(current,identity);
    if(current.status!=='complete')return unavailable();
    const {page}=await readStableProductSnapshot(api,existing.id,identity,signal,options.wait??pause,{maxReads:3,maxDurationMs:1000});
    stopped(signal);
    return page?{ok:true,sourceUrl:identity.sourceUrl,scripts:page.scripts}:unavailable();
  };
  try{return await Promise.race([read(),interrupted]);}
  finally{
    clearTimeout(timer);signal.removeEventListener('abort',abort);controller.abort();
    if(captures.get(identity.windowId)===active)captures.delete(identity.windowId);
  }
}

function contextWait(promise,active){
 stopped(active.controller.signal);const remaining=active.payload.deadlineAt-Date.now();if(remaining<=0)throw Error('URL 원문 수집 연결 시간이 초과되었습니다.');
 return new Promise((resolve,reject)=>{const clean=()=>{clearTimeout(timer);active.controller.signal.removeEventListener('abort',abort);};const abort=()=>{clean();reject(Error('상품 수집을 취소했습니다.'));};const timer=setTimeout(()=>{clean();reject(Error('URL 원문 수집 시간이 초과되었습니다. 수집함 저장 상태를 확인해주세요.'));},remaining);active.controller.signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(value=>{clean();if(active.controller.signal.aborted)reject(Error('상품 수집을 취소했습니다.'));else resolve(value);},error=>{clean();reject(error);});});
}
async function urlScope(active,api){
 if(captures.get(active.windowId)!==active||Date.now()>=active.payload.deadlineAt)throw Error('원래 URL 수집 연결이 종료되었습니다.');
 await checkApp(api,active,active.controller.signal);await recheckSourceInboxReceiver(active.receiver,api);stopped(active.controller.signal);
 const tab=await api.tabs.get(active.detailTabId);checkTab(tab,active);if(tab.active!==false||tab.status!=='complete'||tab.pendingUrl)throw Error('URL 수집 탭의 위치·활성 상태가 변경되었습니다.');
}
export async function authenticateUrlPage(message,sender,api=chrome){
 const active=captures.get(sender?.tab?.windowId),payload=message?.payload;
 if(!active?.payload||!api.runtime?.id||sender.id!==api.runtime.id||sender.frameId!==0||sender.tab.id!==active.detailTabId||!sameProductUrl(sender.url,active.sourceUrl)||!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length!==4||!['requestId','leaseNonce','sourceUrl','deadlineAt'].every(key=>payload[key]===active.payload[key]))throw Error('원래 URL 수집 요청·상품 탭을 확인하지 못했습니다.');
 await contextWait(urlScope(active,api),active);
 return {ok:true,lease:{...active.payload,ownerId:active.receiver.scope.ownerId,company:{...active.receiver.scope.company},origin:active.origin,appTabId:active.tabId,windowId:active.windowId,tabId:active.detailTabId}};
}
export async function saveUrlPage(message,sender,api=chrome,store=sourceInboxStore){
 await authenticateUrlPage({payload:message.urlCapture},sender,api);const active=captures.get(sender.tab.windowId),snapshot=validatePageSourceForDelivery(message.snapshot);
 if(snapshot.sourceUrl!==active.sourceUrl||!snapshot.pagePriceBasis||snapshot.pagePriceBasis.review)throw Error('URL 수집의 기본 원문·가격 근거를 확인하지 못했습니다.');
 const fingerprint=await sourceFingerprint(snapshot);await contextWait(urlScope(active,api),active);
 if(active.saveFingerprint&&active.saveFingerprint!==fingerprint)throw Error('URL 수집 중 원문이 변경되었습니다. 다시 전송하지 않았습니다.');
 if(!active.savePromise){active.saveFingerprint=fingerprint;active.savePromise=savePageSource({snapshot},sender,api,store,{captureId:active.requestId,expectedReceiver:active.receiver,activate:false,requireStoredReceipt:true,manualRetryOnly:true}).then(async result=>{await urlScope(active,api);if(result.delivered!==true||!result.storedReceipt)throw Error(result.message||'원문의 실제 저장 확인을 받지 못했습니다. 수집함을 확인해주세요.');active.saved=result;return result;});}
 return contextWait(active.savePromise,active);
}
async function captureContextProduct(active,api,wait){
 const resolved=await contextWait(resolveSourceInboxReceiver(active.windowId,api),active);active.receiver={...resolved,tab:{id:active.tabId,windowId:active.windowId,url:(await api.tabs.get(active.tabId)).url}};
 await contextWait(recheckSourceInboxReceiver(active.receiver,api),active);await contextWait(checkApp(api,active,active.controller.signal),active);
 const tab=await contextWait(api.tabs.create({windowId:active.windowId,url:active.sourceUrl,active:false}),active);active.detailTabId=tab.id;checkTab(tab,active,{loading:true});
 await contextWait(waitForComplete(api,tab.id,active,active.controller.signal,wait),active);await contextWait(urlScope(active,api),active);
 let ready=false;
 for(let read=0;read<20&&!ready;read++){
  await contextWait(urlScope(active,api),active);
  try{const answer=await contextWait(api.tabs.sendMessage(tab.id,{type:'YOOFAM_URL_PAGE_READY'},{frameId:0}),active);ready=answer?.ok===true&&answer.result?.sourceUrl===active.sourceUrl&&answer.result?.offerId===active.sourceUrl.match(/\/([1-9]\d*)\.html$/)?.[1]&&answer.result?.primaryContextCapture===true;}catch{stopped(active.controller.signal);}
  if(!ready)await contextWait(wait(250,active.controller.signal),active);
 }
 if(!ready)throw Error('이 상품 탭의 기본 원문 수집기가 준비되지 않았습니다. 최신 확장과 상품 페이지를 확인해주세요.');
 const reply=await contextWait(api.tabs.sendMessage(tab.id,{type:'YOOFAM_URL_COLLECT_PAGE',payload:active.payload},{frameId:0}),active);await contextWait(urlScope(active,api),active);
 const result=active.saved;if(reply?.ok!==true||!result||reply.fingerprint!==result.fingerprint||reply.id!==result.id)throw Error(reply?.error||'기본 원문의 정확한 저장 확인을 받지 못했습니다. 수집함을 확인해주세요.');
 try{await urlScope(active,api);await api.tabs.remove(tab.id);}catch{/* Preserve changed or user-activated tabs. */}
 return {ok:true,sourceUrl:active.sourceUrl,format:'yoofam-context-saved-v1',captureId:result.storedReceipt.storedId,fingerprint:result.fingerprint};
}

export async function capture1688Product(message,sender,api=chrome,options={}){
  const identity=validateCaptureRequest(message,sender);
  if(message.type!=='YOOFAM_CAPTURE_1688')throw Error('상품 수집 요청을 확인해주세요.');
  if(captures.has(identity.windowId))throw Error('이 Chrome 창에서 상품 정보를 가져오는 중입니다. 기존 수집이 끝난 뒤 다시 시도해주세요.');
  const controller=new AbortController(),signal=controller.signal;
  const active={...identity,controller};captures.set(identity.windowId,active);
  const wait=options.wait??pause;
  if(message.pageContext===true){active.payload={requestId:identity.requestId,leaseNonce:crypto.randomUUID().replaceAll('-',''),sourceUrl:identity.sourceUrl,deadlineAt:Date.now()+35000};try{return await captureContextProduct(active,api,wait);}finally{controller.abort();if(captures.get(identity.windowId)===active)captures.delete(identity.windowId);}}
  let existing,tab,captured=false;
  try{
    await checkApp(api,identity,signal);
    existing=(await api.tabs.query({windowId:identity.windowId})).find(tab=>validId(tab.id)&&tab.windowId===identity.windowId&&sameProductUrl(tab.url,identity.sourceUrl));
    await checkApp(api,identity,signal);
    if(existing){
      const current=await api.tabs.get(existing.id);stopped(signal);checkTab(current,identity);
      if(current.status==='complete'){
        const {page}=await probeExistingProduct(api,existing.id,identity,signal,wait);
        if(page){stopped(signal);return {ok:true,sourceUrl:identity.sourceUrl,scripts:page.scripts};}
      }
    }
    const checkScope=async()=>{
      await checkApp(api,identity,signal);
      if(existing){const current=await api.tabs.get(existing.id);stopped(signal);checkTab(current,identity);}
    };
    if(supportsMobileTransport(api)){
      const mobileController=new AbortController(),abort=()=>mobileController.abort();
      signal.addEventListener('abort',abort,{once:true});
      const timeout=setTimeout(abort,12000);
      const fetcher=createMobileTransport(api,identity.sourceUrl,checkScope,options.fetcher??fetch);
      try{
        const source=await collectAlibabaMobileCapture(identity.sourceUrl,{fetcher,signal:mobileController.signal});
        await checkScope();stopped(signal);
        return {ok:true,...source};
      }catch{
        stopped(signal);await checkScope();
      }finally{clearTimeout(timeout);signal.removeEventListener('abort',abort);mobileController.abort();await fetcher.dispose();}
    }
    await checkScope();
    tab=existing??await api.tabs.create({windowId:identity.windowId,url:identity.sourceUrl,active:false});
    checkTab(tab,identity,{loading:true});
    await waitForComplete(api,tab.id,identity,signal,wait);
    const {page,lastError}=await readStableProductSnapshot(api,tab.id,identity,signal,wait);
    if(page){captured=true;return {ok:true,sourceUrl:identity.sourceUrl,scripts:page.scripts};}
    throw Error(`1688 상품 데이터가 완성되지 않았습니다. ${lastError?.message??'상품 옵션·가격 정보가 계속 변경됩니다.'}`);
  }finally{
    // Existing tabs, failed/login pages and tabs moved by the user stay intact.
    if(!existing&&captured&&tab){
      try{stopped(signal);await checkApp(api,identity,signal);const current=await api.tabs.get(tab.id);checkTab(current,identity);if(current.active!==true)await api.tabs.remove(tab.id);}catch{/* Keep changed tabs intact. */}
    }
    if(captures.get(identity.windowId)===active)captures.delete(identity.windowId);
  }
}
