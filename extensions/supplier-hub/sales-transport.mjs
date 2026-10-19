const WING_ORIGIN='https://wing.coupang.com';
const CATALOG_URL=WING_ORIGIN+'/tenants/seller-web/pre-matching/search';
const MAX_BYTES=2*1024*1024;

const failure=(code,error)=>({ok:false,code,error});
const storeFailure=()=>failure('COOKIE_STORE','Wing 탭과 같은 로그인 저장소를 확인하지 못했습니다. 해당 Wing 탭에서 다시 조회해주세요.');

function rateLimitFailure(response) {
  const raw=(response.headers?.get('retry-after')||'').trim();
  const now=Date.now();
  let delay=60000;
  if(/^\d+$/.test(raw))delay=Number(raw)*1000;
  else if(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/i.test(raw)) {
    const date=Date.parse(raw);
    if(Number.isFinite(date)&&new Date(date).toUTCString().toLowerCase()===raw.toLowerCase())delay=date-now;
  }
  // Keep the server's full wait even when the UI stops automatic waiting after
  // fifteen minutes. Unrepresentably large waits remain manual-only cooldowns.
  const maxDelay=Number.MAX_SAFE_INTEGER-Math.max(0,now);
  const retryAfterOverflow=!Number.isFinite(delay)||delay>maxDelay;
  const retryAfterMs=Math.max(1000,retryAfterOverflow?maxDelay:delay);
  const error=retryAfterOverflow?'쿠팡이 매우 긴 조회 대기 시간을 지정했습니다. 자동 조회를 중지합니다.':`쿠팡 조회 제한입니다. ${Math.ceil(retryAfterMs/1000)}초 뒤 남은 상품을 이어서 조회해주세요.`;
  return {...failure('RATE_LIMIT',error),retryAfterMs,...(retryAfterOverflow?{retryAfterOverflow:true}:{})};
}

async function readBoundedText(response) {
  const length=response.headers?.get('content-length');
  if(length && /^\d+$/.test(length) && Number(length)>MAX_BYTES) throw new RangeError('response size');
  if(!response.body?.getReader) {
    const text=await response.text();
    if(new TextEncoder().encode(text).byteLength>MAX_BYTES) throw new RangeError('response size');
    return text;
  }
  const reader=response.body.getReader(), decoder=new TextDecoder();
  let bytes=0,text='';
  try {
    while(true) {
      const part=await reader.read();
      if(part.done)break;
      bytes+=part.value.byteLength;
      if(bytes>MAX_BYTES) {
        await reader.cancel().catch(()=>{});
        throw new RangeError('response size');
      }
      text+=decoder.decode(part.value,{stream:true});
    }
    return text+decoder.decode();
  } finally {reader.releaseLock();}
}

// This worker uses only its own browser-managed Wing session. A cookie store ID
// selects the XSRF cookie, not the fetch session, so reject a different context.
export async function fetchWingCatalogDirect(keyword,wingTabId,api=chrome,fetcher=fetch) {
  if(typeof keyword!=='string'||!keyword.trim()||keyword.length>250||!Number.isInteger(wingTabId)||wingTabId<0) {
    return failure('INPUT','상품 검색어와 Wing 탭을 확인해주세요.');
  }
  const headers={'content-type':'application/json','accept':'application/json, text/plain, */*'};
  try {
    const tab=await api.tabs.get(wingTabId);
    if(tab?.id!==wingTabId||new URL(tab.url).origin!==WING_ORIGIN||typeof tab.incognito!=='boolean')return storeFailure();
    if(tab.incognito!==(api.extension?.inIncognitoContext===true))return storeFailure();
    const stores=await api.cookies.getAllCookieStores();
    const owners=Array.isArray(stores)?stores.filter(store=>typeof store?.id==='string'&&store.id&&Array.isArray(store.tabIds)&&store.tabIds.includes(wingTabId)):[];
    if(owners.length!==1)return storeFailure();
    const storeId=owners[0].id;
    const cookie=await api.cookies.get({url:WING_ORIGIN+'/',name:'XSRF-TOKEN',storeId});
    if(cookie) {
      if(cookie.storeId!==storeId||cookie.name!=='XSRF-TOKEN'||typeof cookie.value!=='string')return storeFailure();
      let xsrf;
      try {xsrf=decodeURIComponent(cookie.value);} catch {return storeFailure();}
      if(xsrf.length>4096||/[\r\n\0]/.test(xsrf))return storeFailure();
      if(xsrf)headers['x-xsrf-token']=xsrf;
    }
  } catch {return storeFailure();}

  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),10000);
  try {
    const response=await fetcher(CATALOG_URL,{
      method:'POST',credentials:'include',redirect:'error',cache:'no-store',headers,signal:controller.signal,
      body:JSON.stringify({keyword:keyword.trim(),excludedProductIds:[],searchPage:0,searchOrder:'DEFAULT',sortType:'DEFAULT'})
    });
    if(response.status===401||response.status===403)return failure('LOGIN','Wing 로그인 또는 조회 권한을 확인해주세요. 보안 확인 화면이 있다면 직접 완료한 뒤 재조회하세요.');
    if(response.status===429)return rateLimitFailure(response);
    if(!response.ok)return failure('HTTP',`쿠팡 조회 응답 오류 (${response.status}). 잠시 후 다시 조회해주세요.`);
    if(response.redirected||response.url!==CATALOG_URL)return failure('LOGIN','Wing 조회 주소가 변경되었습니다. 로그인·보안 확인 화면을 확인해주세요.');
    const text=await readBoundedText(response);
    let body;
    try {body=JSON.parse(text.replace(/^\uFEFF/,''));} catch {
      if(/^\s*</.test(text))return failure('RESPONSE_TYPE','Wing이 판매량 데이터 대신 웹페이지를 응답했습니다. Wing의 상품 조회 화면을 확인해주세요.');
      return failure('SCHEMA','쿠팡 판매량 응답을 해석하지 못했습니다.');
    }
    if(!Array.isArray(body?.result))return failure('SCHEMA','쿠팡 판매량 응답 형식이 변경되었습니다.');
    const scalar=value=>(typeof value==='number'||typeof value==='string')?value:null;
    return {ok:true,rows:body.result.slice(0,200).filter(row=>row&&typeof row==='object'&&!Array.isArray(row)).map(row=>({
      productId:scalar(row.productId),itemId:scalar(row.itemId),vendorItemId:scalar(row.vendorItemId),
      salesLast28d:scalar(row.salesLast28d),pvLast28Day:scalar(row.pvLast28Day)
    }))};
  } catch(error) {
    if(error instanceof RangeError)return failure('SCHEMA','쿠팡 조회 응답이 허용 크기를 초과했습니다.');
    if(controller.signal.aborted||error?.name==='AbortError')return failure('TIMEOUT','쿠팡 조회 시간이 초과됐습니다. 재조회해주세요.');
    return failure('NETWORK','Wing 판매량 조회에 연결하지 못했습니다. 연결 상태를 확인한 뒤 재조회해주세요.');
  } finally {clearTimeout(timer);}
}
