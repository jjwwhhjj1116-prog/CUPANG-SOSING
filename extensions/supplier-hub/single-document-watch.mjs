import {SingleDocumentError} from './single-document.mjs';

const ORIGIN='https://supplier.coupang.com';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const COMPANIES=Object.freeze({A01526306:'유앤채',A01464742:'와이홉'});
const REASONS=new Set(['closed','expired','clock-invalid','binding-mismatch','foreign-document','create-requested','document-changed','request-invalid','request-failed','request-redirected','request-overflow','tab-detached','tab-removed','tab-replaced','tab-reloaded','navigation-changed','listener-unavailable','external-invalid']);
const fail=message=>new SingleDocumentError('DOCUMENT_WATCH_INVALID',message);
const identifier=value=>Number.isSafeInteger(value)&&value>0||typeof value==='string'&&value.length>0&&value.length<=200&&value===value.trim()&&!/[\u0000-\u001f]|\.\.\.|…/.test(value);
const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));

/** Passive continuity evidence for one already loaded, owned Single document.
 * Tokens are useful only while this in-memory listener instance is alive. No
 * request/response headers, cookies or request bodies are requested or retained.
 * /draft/api/update is opaque and deliberately ignored: native NEXT also saves
 * the owned draft there. Its timing/path cannot identify the document. A root
 * adapter's isolated input watcher and exact current UI checks complement this
 * limited evidence; this observer does not establish a live submission contract. */
export function createSingleDocumentWatch({api,tabId,windowId,documentId,docId,packetDigest,identityDigest,company,maxAgeMs=600000,onInvalid,now=Date.now}={}){
  const webNames=['onBeforeRequest','onCompleted','onErrorOccurred','onBeforeRedirect'],tabNames=['onUpdated','onDetached','onRemoved','onReplaced'];
  const available=event=>typeof event?.addListener==='function'&&typeof event.removeListener==='function';
  if(!Number.isSafeInteger(tabId)||tabId<0||!Number.isSafeInteger(windowId)||windowId<0||!UUID.test(documentId||'')||!identifier(docId)
    ||!HASH.test(packetDigest||'')||!HASH.test(identityDigest||'')||!object(company)||Object.keys(company).length!==2
    ||!Object.hasOwn(COMPANIES,company.code)||COMPANIES[company.code]!==company.name||typeof now!=='function'
    ||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<1||maxAgeMs>600000||onInvalid!==undefined&&typeof onInvalid!=='function'
    ||webNames.some(name=>!available(api?.webRequest?.[name]))||tabNames.some(name=>!available(api?.tabs?.[name]))
    ||typeof globalThis.crypto?.randomUUID!=='function')throw fail('현재 새 문서의 브라우저 관찰을 설치할 수 없습니다. 다음 단계는 실행하지 않았습니다.');
  const createdAt=now();if(!Number.isSafeInteger(createdAt)||createdAt<=0)throw fail('문서 관찰 시작 시각을 확인하지 못했습니다.');
  const expiresAt=createdAt+maxAgeMs;if(!Number.isSafeInteger(expiresAt))throw fail('문서 관찰 만료 시각을 확인하지 못했습니다.');
  const token=crypto.randomUUID(),binding=Object.freeze({token,tabId,windowId,frameId:0,documentId,docId,packetDigest,identityDigest,company:Object.freeze({code:company.code,name:company.name})});
  const ownedUrl=ORIGIN+'/sr/draft/api/get-by-id/'+encodeURIComponent(String(docId)),installed=[],pending=new Map(),recent=new Set();
  let active=true,reason=null,timer,cleanupFailed=false,lastClock=createdAt;
  const status=()=>Object.freeze({active,reason,cleanupFailed,createdAt,expiresAt,binding});
  const cleanup=()=>{
    clearTimeout(timer);pending.clear();recent.clear();
    for(const [event,callback] of installed.splice(0).reverse())try{event.removeListener(callback);}catch{cleanupFailed=true;}
  };
  const invalid=(cause='external-invalid',notify=true)=>{
    if(!active)return status();active=false;reason=REASONS.has(cause)?cause:'external-invalid';cleanup();
    if(notify&&onInvalid)try{const notification=onInvalid(status());if(notification&&typeof notification.then==='function')Promise.resolve(notification).catch(()=>{});}catch{/* Cleanup and sticky invalidation must survive a caller's notification error. */}
    return status();
  };
  const current=()=>{
    if(active){let time;try{time=now();}catch{return invalid('clock-invalid');}
      if(!Number.isSafeInteger(time)||time<lastClock)return invalid('clock-invalid');
      lastClock=time;if(time>=expiresAt)return invalid('expired');
    }
    return status();
  };
  const scope=details=>details?.tabId===tabId&&details.frameId===0;
  const path=details=>{try{const url=new URL(details.url);return url.origin===ORIGIN&&!url.username&&!url.password?url.pathname:null;}catch{return null;}};
  const relevant=details=>{
    if(!active||!scope(details))return false;
    const pathname=path(details);
    if(!pathname?.startsWith('/sr/'))return false;
    // A new top-frame browser document also invalidates this watch even if its
    // request was an unrelated sr endpoint; child frames remain out of scope.
    if(details.documentId!==documentId||details.documentLifecycle!=='active'||details.frameType!=='outermost_frame'){invalid('document-changed');return false;}
    if(pathname==='/sr/draft/api/create'){invalid('create-requested');return false;}
    if(!pathname?.startsWith('/sr/draft/api/get-by-id/'))return false;
    if(details.url!==ownedUrl){invalid('foreign-document');return false;}
    return true;
  };
  const valid=details=>details.method==='GET'&&details.type==='xmlhttprequest'&&details.initiator===ORIGIN
    &&typeof details.requestId==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(details.requestId)&&Number.isFinite(details.timeStamp)&&details.timeStamp>0;
  const before=details=>{
    if(!current().active||!relevant(details))return;
    if(!valid(details)||pending.has(details.requestId)||recent.has(details.requestId)){invalid('request-invalid');return;}
    if(pending.size>=32){invalid('request-overflow');return;}
    pending.set(details.requestId,details.timeStamp);
  };
  const completed=details=>{
    if(!current().active||!relevant(details))return;
    const started=pending.get(details.requestId);
    if(!valid(details)||started===undefined||details.timeStamp<started){invalid('request-invalid');return;}
    if(details.statusCode!==200){invalid('request-failed');return;}
    pending.delete(details.requestId);recent.add(details.requestId);if(recent.size>64)recent.delete(recent.values().next().value);
  };
  const failed=details=>{if(current().active&&relevant(details))invalid('request-failed');};
  const redirected=details=>{if(current().active&&relevant(details))invalid('request-redirected');};
  const registrationUrl=value=>{
    try{const url=new URL(value);return url.origin===ORIGIN&&!url.username&&!url.password&&!url.search&&!url.hash
      &&/^\/sr\/registration\/step\/(productPage|imagePage|legalPage|logisticsPage)$/.test(url.pathname);}catch{return false;}
  };
  const updated=(id,changeInfo,tab)=>{
    if(!current().active||id!==tabId)return;
    if(tab?.windowId!==undefined&&tab.windowId!==windowId){invalid('tab-detached');return;}
    if(changeInfo?.status==='loading'){invalid('tab-reloaded');return;}
    if(changeInfo?.url!==undefined&&!registrationUrl(changeInfo.url)){invalid('navigation-changed');return;}
    if(tab?.pendingUrl||changeInfo?.url!==undefined&&tab?.url!==undefined&&!registrationUrl(tab.url))invalid('navigation-changed');
  };
  const detached=id=>{if(current().active&&id===tabId)invalid('tab-detached');};
  const removed=id=>{if(current().active&&id===tabId)invalid('tab-removed');};
  const replaced=(added,removedId)=>{if(current().active&&(added===tabId||removedId===tabId))invalid('tab-replaced');};
  const committed=details=>{if(current().active&&scope(details))invalid('tab-reloaded');};
  const history=details=>{
    if(!current().active||!scope(details))return;
    if(details.documentId!==documentId){invalid('document-changed');return;}
    if(!registrationUrl(details.url))invalid('navigation-changed');
  };
  const install=(event,callback,...args)=>{installed.push([event,callback]);event.addListener(callback,...args);};
  try{
    const filter={urls:[ORIGIN+'/sr/*'],tabId};
    for(const [index,name] of webNames.entries())install(api.webRequest[name],[before,completed,failed,redirected][index],filter);
    for(const [index,name] of tabNames.entries())install(api.tabs[name],[updated,detached,removed,replaced][index]);
    // Current shipping permissions do not require webNavigation. When a host
    // supplies it, observe its document/SPA metadata too, without extra scopes.
    for(const [name,callback] of [['onCommitted',committed],['onHistoryStateUpdated',history],['onReferenceFragmentUpdated',history]]){
      const event=api.webNavigation?.[name];if(event!==undefined){if(!available(event))throw Error('navigation observer unavailable');install(event,callback);}
    }
    if(!current().active)throw Error('watch expired during registration');
    timer=setTimeout(()=>invalid('expired'),Math.max(0,expiresAt-lastClock));
  }catch{invalid('listener-unavailable',false);throw fail('문서 관찰 설치와 정리를 확인하지 못했습니다. 다음 단계는 실행하지 않았습니다.');}
  const close=()=>invalid('closed',false);
  return Object.freeze({token,getStatus:current,invalid,close,dispose:close,assertCurrent(expected){
    const state=current();
    if(state.active&&(!object(expected)||Object.keys(binding).some(key=>key==='company'
      ?!object(expected.company)||Object.keys(expected.company).length!==2||expected.company.code!==binding.company.code||expected.company.name!==binding.company.name
      :expected[key]!==binding[key])))invalid('binding-mismatch');
    if(!active||cleanupFailed)throw fail('현재 탭에서 원래 새 문서의 관찰 연결이 유지되지 않습니다. 다시 진행하지 않았습니다.');
    return status();
  }});
}
