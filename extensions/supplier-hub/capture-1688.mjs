import {HANDOFF_ORIGINS} from './handoff-store.mjs';
import {parseProductJsonLd} from './product-jsonld.mjs';

const captures=new Map();
const validId=value=>Number.isSafeInteger(value)&&value>=0;
const validRequestId=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);

export function validateCaptureRequest(message,sender){
  let origin,source;
  try{origin=new URL(sender?.url).origin;source=new URL(message?.sourceUrl);}catch{throw Error('앱 주소 또는 1688 상품 주소를 확인하지 못했습니다.');}
  if(!validId(sender?.tab?.id)||!validId(sender?.tab?.windowId)||sender.frameId!==0||!HANDOFF_ORIGINS.includes(origin))throw Error('허용된 앱 탭에서만 상품을 가져올 수 있습니다.');
  if(!['YOOFAM_CAPTURE_1688','YOOFAM_CANCEL_1688'].includes(message?.type)||!validRequestId(message.requestId)||source.protocol!=='https:'||source.hostname!=='detail.1688.com'||source.port||source.username||source.password||source.search||source.hash||!/^\/offer\/[1-9]\d{0,29}\.html$/.test(source.pathname))throw Error('정확한 1688 상품 URL과 수집 요청을 확인해주세요.');
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

export function cancel1688Capture(message,sender){
  const identity=validateCaptureRequest(message,sender);
  if(message.type!=='YOOFAM_CANCEL_1688')throw Error('수집 취소 요청을 확인해주세요.');
  const active=captures.get(identity.windowId);
  if(!active||active.tabId!==identity.tabId||active.origin!==identity.origin||active.requestId!==identity.requestId||active.sourceUrl!==identity.sourceUrl)return {ok:true,cancelled:false};
  active.controller.abort();return {ok:true,cancelled:true};
}

export async function capture1688Product(message,sender,api=chrome,options={}){
  const identity=validateCaptureRequest(message,sender);
  if(message.type!=='YOOFAM_CAPTURE_1688')throw Error('상품 수집 요청을 확인해주세요.');
  if(captures.has(identity.windowId))throw Error('이 Chrome 창에서 상품 정보를 가져오는 중입니다. 기존 수집이 끝난 뒤 다시 시도해주세요.');
  const controller=new AbortController(),signal=controller.signal;
  const active={...identity,controller};captures.set(identity.windowId,active);
  const wait=options.wait??pause;
  let existing,tab,captured=false;
  try{
    await checkApp(api,identity,signal);
    existing=(await api.tabs.query({windowId:identity.windowId})).find(tab=>validId(tab.id)&&tab.windowId===identity.windowId&&sameProductUrl(tab.url,identity.sourceUrl)&&(!tab.pendingUrl||sameProductUrl(tab.pendingUrl,identity.sourceUrl)));
    await checkApp(api,identity,signal);
    tab=existing??await api.tabs.create({windowId:identity.windowId,url:identity.sourceUrl,active:false});
    checkTab(tab,identity,{loading:true});
    await waitForComplete(api,tab.id,identity,signal,wait);
    let previous,lastError;const deadline=Date.now()+10000;
    // The load event may precede hydration. Wait up to ten seconds for complete
    // SKU/price evidence, then require three identical reads (500 ms quiet).
    let stable=0;
    for(let i=0;i<40;i++){
      await checkApp(api,identity,signal);
      const before=await api.tabs.get(tab.id);checkTab(before,identity);
      if(before.status!=='complete'){
        previous=undefined;stable=0;lastError=Error('상품 페이지가 다시 로딩 중입니다.');
        if(Date.now()>=deadline)break;
        await wait(250,signal);continue;
      }
      const values=await api.scripting.executeScript({target:{tabId:tab.id},func:readProductJsonLd});
      stopped(signal);
      const after=await api.tabs.get(tab.id);checkTab(after,identity);
      await checkApp(api,identity,signal);
      if(after.status!=='complete'){
        previous=undefined;stable=0;lastError=Error('상품 페이지가 다시 로딩 중입니다.');
        if(Date.now()>=deadline)break;
        await wait(250,signal);continue;
      }
      const page=values?.[0]?.result;
      if(values?.length!==1||values[0].frameId!==0||!page||!sameProductUrl(page.pageUrl,identity.sourceUrl))throw Error('1688 상품 페이지 대신 로그인·확인 페이지 또는 다른 상품이 열렸습니다.');
      if(!Array.isArray(page.scripts)||page.scripts.length>30||page.scripts.some(value=>typeof value!=='string')||page.scripts.reduce((sum,value)=>sum+new TextEncoder().encode(value).byteLength,0)>1500000)throw Error('상품 구조화 데이터의 크기 또는 형식을 확인하지 못했습니다.');
      try{
        productSnapshotReady(page.scripts,identity.sourceUrl);
        const snapshot=JSON.stringify(page.scripts);
        stable=previous===snapshot?stable+1:1;previous=snapshot;
        if(stable>=3){captured=true;return {ok:true,sourceUrl:identity.sourceUrl,scripts:page.scripts};}
      }catch(error){lastError=error;previous=undefined;stable=0;}
      if(Date.now()>=deadline)break;
      await wait(250,signal);
    }
    throw Error(`1688 상품 데이터가 완성되지 않았습니다. ${lastError?.message??'상품 옵션·가격 정보가 계속 변경됩니다.'}`);
  }finally{
    // Existing tabs, failed/login pages and tabs moved by the user stay intact.
    if(!existing&&captured&&tab){
      try{stopped(signal);await checkApp(api,identity,signal);const current=await api.tabs.get(tab.id);checkTab(current,identity);if(current.active!==true)await api.tabs.remove(tab.id);}catch{/* Keep changed tabs intact. */}
    }
    if(captures.get(identity.windowId)===active)captures.delete(identity.windowId);
  }
}
