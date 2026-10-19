import {validateProducts,validateSalesSender,selectMetrics,unavailable,SALES_SOURCE,WING_URL} from './sales-core.mjs';
import {fetchWingCatalog} from './sales-page.mjs';
import {fetchWingCatalogDirect} from './sales-transport.mjs';
import {createCatalogCache} from './sales-cache.mjs';

const busy=new Set();
const cancellations=new Map();
const BASE_QUERY_SPACING_MS=600;
const THROTTLE_SESSION_KEY='yfSalesThrottleV1';
const defaultTiming={now:()=>Date.now(),sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms))};
// Shared across all Wing/Coupang tabs in this extension worker context. Opening
// another Wing tab or starting another batch must not bypass server pacing.
let queryQueue=Promise.resolve();
let nextQueryAt=0;
let cooldownUntil=0;
let querySpacingMs=BASE_QUERY_SPACING_MS;
const throttleHydrations=new WeakMap();
const catalogCaches=new Set();
const cachesByTiming=new WeakMap();
const knownWingTabs=new Set();
const invalidationRegistrations=new WeakSet();
let cacheEpoch=0;

function hydrateThrottle(api) {
  let hydration=throttleHydrations.get(api);
  if(!hydration) {
    hydration=(async()=>{
      const saved=(await api.storage.session.get(THROTTLE_SESSION_KEY))?.[THROTTLE_SESSION_KEY];
      if(!saved||typeof saved!=='object'||Array.isArray(saved))return;
      if(Number.isSafeInteger(saved.cooldownUntil)&&saved.cooldownUntil>=0)cooldownUntil=Math.max(cooldownUntil,saved.cooldownUntil);
      if(Number.isSafeInteger(saved.querySpacingMs)&&saved.querySpacingMs>=BASE_QUERY_SPACING_MS&&saved.querySpacingMs<=3000)querySpacingMs=Math.max(querySpacingMs,saved.querySpacingMs);
    })();
    throttleHydrations.set(api,hydration);
  }
  return hydration;
}

async function persistThrottle(api) {
  // MV3 workers can stop during a server cooldown. Session storage survives
  // worker restarts, but contains only these two numbers, never catalog/auth data.
  await api.storage.session.set({[THROTTLE_SESSION_KEY]:{cooldownUntil,querySpacingMs}});
}

function cacheFor(timing) {
  let cache=cachesByTiming.get(timing);
  if(!cache) {cache=createCatalogCache({now:timing.now});cachesByTiming.set(timing,cache);catalogCaches.add(cache);}
  return cache;
}

function invalidateCatalog() {
  cacheEpoch++;
  for(const cache of catalogCaches)cache.invalidate();
}
function registerCatalogInvalidation(api) {
  if(invalidationRegistrations.has(api))return;
  invalidationRegistrations.add(api);
  api.tabs?.onUpdated?.addListener((tabId,change,tab)=>{
    const isWing=typeof tab?.url==='string'&&tab.url.startsWith('https://wing.coupang.com/');
    if((knownWingTabs.has(tabId)||isWing)&&(change.url||change.status==='loading'))invalidateCatalog();
  });
  api.tabs?.onRemoved?.addListener(tabId=>{
    if(knownWingTabs.delete(tabId))invalidateCatalog();
  });
  api.cookies?.onChanged?.addListener(change=>{
    // Domain metadata only. Cookie names and values are never read or logged.
    const domain=typeof change?.cookie?.domain==='string'?change.cookie.domain.replace(/^\./,'').toLowerCase():'';
    if(domain==='coupang.com'||domain.endsWith('.coupang.com'))invalidateCatalog();
  });
}

function checkCancellation(signal) {
  if(signal.aborted)throw Error('판매량 조회를 중지했습니다.');
}
function checkCooldown(timing) {
  const remaining=cooldownUntil-timing.now();
  if(remaining>0)throw Object.assign(Error(`쿠팡 요청 제한으로 조회를 쉬고 있습니다. ${Math.ceil(remaining/1000)}초 뒤 다시 조회해주세요.`),{code:'RATE_LIMIT',retryAfterMs:remaining});
}
function waitCancellable(promise,signal) {
  checkCancellation(signal);
  return new Promise((resolve,reject)=>{
    const stop=()=>reject(Error('판매량 조회를 중지했습니다.'));
    signal.addEventListener('abort',stop,{once:true});
    Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',stop);resolve(value);},error=>{signal.removeEventListener('abort',stop);reject(error);});
  });
}
async function dispatchWingQuery(wing,origin,api,timing,signal,request,readCached) {
  const previous=queryQueue;
  let release;
  const turn=new Promise(resolve=>{release=resolve;});
  // A cancelled queued caller releases its own ticket without letting later
  // callers jump ahead of the request that is still in flight.
  queryQueue=previous.then(()=>turn);
  try {
    await waitCancellable(previous,signal);
    checkCancellation(signal);
    const cached=readCached?.();
    if(cached)return cached;
    await waitCancellable(hydrateThrottle(api),signal);
    checkCancellation(signal);
    checkCooldown(timing);
    while(nextQueryAt>timing.now()) {
      await waitCancellable(timing.sleep(nextQueryAt-timing.now()),signal);
      checkCancellation(signal);
      checkCooldown(timing);
    }
    const current=await api.tabs.get(wing.id);
    if(current.windowId!==origin.windowId || new URL(current.url).origin!=='https://wing.coupang.com')throw Error('Wing 탭이 변경되었습니다. 다시 조회해주세요.');
    checkCancellation(signal);
    checkCooldown(timing);
    nextQueryAt=timing.now()+querySpacingMs;
    const response=await request();
    if(response?.code==='RATE_LIMIT') {
      querySpacingMs=Math.min(3000,Math.max(1500,querySpacingMs*2));
      const supplied=response.retryAfterMs;
      // Honor the server's actual wait. A missing duration uses the fallback;
      // an explicit short duration must not become another full minute.
      const delay=typeof supplied==='number'&&Number.isFinite(supplied)&&supplied>=0?Math.max(1000,supplied):60000;
      // A long server wait must not be shortened to our automatic-resume limit.
      const deadline=timing.now()+delay;
      cooldownUntil=Math.max(cooldownUntil,Number.isFinite(deadline)?Math.min(Number.MAX_SAFE_INTEGER,Math.ceil(deadline)):Number.MAX_SAFE_INTEGER);
      await persistThrottle(api);
    }
    return response;
  } finally {release();}
}

export async function lookupSales(message,sender,api=chrome,requestCatalog=fetchWingCatalogDirect,timing=defaultTiming) {
  const origin=validateSalesSender(sender,api.runtime.id);
  const products=validateProducts(message.products);
  if(busy.has(origin.id)) throw Error('이미 조회 중입니다. 현재 조회가 끝나면 다시 실행해주세요.');
  busy.add(origin.id);
  const cancellation=new AbortController();
  cancellations.set(origin.id,cancellation);
  const signal=cancellation.signal;
  const results=[];
  const requestId=typeof message.requestId==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(message.requestId)?message.requestId:null;
  const appendResult=result=>{
    results.push(result);
    if(requestId&&['ok','unavailable'].includes(result.status)&&typeof api.tabs.sendMessage==='function') {
      try {void Promise.resolve(api.tabs.sendMessage(origin.id,{type:'YF_SALES_PROGRESS',requestId,result})).catch(()=>{});} catch { /* The tab may have closed after the request. */ }
    }
  };
  try {
    const tabs=await api.tabs.query({windowId:origin.windowId,url:'https://wing.coupang.com/*'});
    const wing=tabs.filter(t=>t.id && t.status==='complete' && !/\/sso\/|\/login|\/logout/.test(new URL(t.url).pathname))
      .sort((a,b)=>Number(b.url.includes('/vendor-inventory/')||b.url.includes('/coupang-trends/'))-Number(a.url.includes('/vendor-inventory/')||a.url.includes('/coupang-trends/')))[0];
    if(!wing) throw Error('같은 Chrome 창에서 쿠팡 Wing에 로그인한 탭을 열어주세요. 아래 Wing 열기 버튼을 이용할 수 있습니다.');
    knownWingTabs.add(wing.id);
    registerCatalogInvalidation(api);
    let sourceDocument=null;
    const scope=`${wing.id}:${wing.windowId}`;
    const force=message.force===true;
    const catalogCache=cacheFor(timing);
    const requestRows=async query=>{
      checkCancellation(signal);
      if(!force) {
        const cached=catalogCache.get(scope,query);
        if(cached)return {ok:true,...cached};
      }
      const epoch=cacheEpoch;
      const readCached=()=>{
        const cached=!force?catalogCache.get(scope,query):null;
        return cached?{ok:true,...cached}:null;
      };
      const remember=response=>{
        if(!response.ok)return response;
        const asOf=new Date(timing.now()).toISOString();
        if(epoch===cacheEpoch)catalogCache.put(scope,query,response.rows,asOf);
        return {...response,asOf};
      };
        let response=await dispatchWingQuery(wing,origin,api,timing,signal,async()=>remember(await requestCatalog(query,wing.id,api)),readCached);
        if(!response.ok&&['NETWORK','COOKIE_STORE'].includes(response.code)) {
          response=await dispatchWingQuery(wing,origin,api,timing,signal,async()=>{
            const execution=await api.scripting.executeScript({target:{tabId:wing.id},world:'ISOLATED',func:fetchWingCatalog,args:[query]});
            const frame=execution.find(e=>e.frameId===0),value=frame?.result;
            if(!frame||!value||typeof frame.documentId!=='string'||!frame.documentId)throw Error('Wing 조회 결과를 받지 못했습니다. 탭을 새로고침해주세요.');
            if(sourceDocument&&frame.documentId!==sourceDocument)throw Error('조회 중 Wing 화면이 변경되었습니다. 재조회해주세요.');
            sourceDocument=frame.documentId;
            return remember(value);
          },readCached);
        }
        return response;
    };
    const haltFor=response=>({code:response.code||'LOOKUP',error:response.error||'판매량을 조회하지 못했습니다.',...(response.code==='RATE_LIMIT'?{retryAfterMs:Math.max(0,cooldownUntil-timing.now())}:{})});
    const sourceUrl=new URL(sender.url);
    const pageKeyword=sourceUrl.pathname==='/np/search'?(sourceUrl.searchParams.get('q')||'').trim():'';
    const keyword=typeof message.keyword==='string'?message.keyword.trim():'';
    // Prefetch only the actual search phrase on the initiating Coupang page.
    // Arbitrary message keywords cannot cause an extra catalog request.
    if(!force&&keyword&&keyword===pageKeyword&&keyword.length<=200&&!/[\u0000-\u001f\u007f]/.test(keyword)
      &&products.some(product=>!selectMetrics(catalogCache.getProduct(scope,product.productId)?.rows||[],product))) {
      const prefetched=await requestRows(keyword);
      if(!prefetched.ok)return {ok:true,results,halt:haltFor(prefetched)};
    }
    for(const product of products) {
      checkCancellation(signal);
      // Recheck that the user did not navigate or move this tab while a batch was in progress.
      const current=await api.tabs.get(wing.id);
      if(current.windowId!==origin.windowId || new URL(current.url).origin!=='https://wing.coupang.com') throw Error('Wing 탭이 변경되었습니다. 다시 조회해주세요.');
      const cachedProduct=!force?catalogCache.getProduct(scope,product.productId):null;
      let metrics=cachedProduct?selectMetrics(cachedProduct.rows,product):null;
      let asOf=metrics?cachedProduct.asOf:null;
      const queries=[...new Set([product.title,product.productId].filter(Boolean))];
      for(const query of queries) {
        if(metrics)break;
        checkCancellation(signal);
        // Start in the extension worker, where Wing's normal API request is made.
        // Only transport/context failures use the same signed-in Wing tab fallback.
        // Authentication, rate limits, HTML and invalid data do not trigger retries.
        const response=await requestRows(query);
        if(!response.ok) {
          if(response.code==='RATE_LIMIT')return {ok:true,results,halt:haltFor(response)};
          const {title,...identity}=product;
          const error=response.error || '판매량을 조회하지 못했습니다.';
          appendResult({...unavailable(identity,error),status:'error'});
          return {ok:true,results,halt:haltFor(response)};
        }
        metrics=selectMetrics(response.rows,product);
        if(metrics)asOf=response.asOf;
        if(metrics) break;
      }
      const {title,...identity}=product;
      appendResult(metrics ? {...identity,...metrics,status:'ok',periodDays:28,source:SALES_SOURCE,asOf} : unavailable(identity));
    }
    return {ok:true,results};
  } catch(error) {
    if(error.code==='RATE_LIMIT')return {ok:true,results,halt:{code:'RATE_LIMIT',error:error.message,retryAfterMs:error.retryAfterMs}};
    // Keep already completed products if the selected Wing tab closes or changes.
    if(results.length) return {ok:true,results,halt:{code:'INTERRUPTED',error:error.message || '조회 연결이 중단되었습니다.'}};
    throw error;
  } finally {busy.delete(origin.id);cancellations.delete(origin.id);}
}
export function cancelSales(sender,api=chrome) {
  const tab=validateSalesSender(sender,api.runtime.id);
  if(busy.has(tab.id)) cancellations.get(tab.id)?.abort();
  return {ok:true};
}
export async function openSalesWing(sender,api=chrome) {
  const tab=validateSalesSender(sender,api.runtime.id);
  const existing=(await api.tabs.query({windowId:tab.windowId,url:'https://wing.coupang.com/*'}))[0];
  if(existing) await api.tabs.update(existing.id,{active:true});
  else await api.tabs.create({windowId:tab.windowId,url:WING_URL,active:true});
  return {ok:true};
}
export function registerSalesListener(api=chrome) {
  registerCatalogInvalidation(api);
  api.runtime.onMessage.addListener((message,sender,respond)=>{
    if(!['YF_SALES_LOOKUP','YF_SALES_OPEN_WING','YF_SALES_CANCEL'].includes(message?.type))return;
    if(message.type==='YF_SALES_CANCEL') {try {respond(cancelSales(sender,api));} catch(error) {respond({ok:false,error:error.message});}return;}
    (message.type==='YF_SALES_LOOKUP'?lookupSales(message,sender,api):openSalesWing(sender,api))
      .then(respond,error=>respond({ok:false,error:error.message || '판매량 조회를 시작하지 못했습니다.'}));
    return true;
  });
}
