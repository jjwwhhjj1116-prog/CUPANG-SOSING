// Standalone function serialized by chrome.scripting; no imported or closed-over values.
// Uses only the user's existing first-party Wing session. No token leaves Wing.
export async function fetchWingCatalog(keyword) {
  if (location.origin !== 'https://wing.coupang.com' || /\/sso\/|\/login|\/logout/.test(location.pathname)) return {ok:false,code:'LOGIN',error:'쿠팡 Wing에 로그인한 뒤 다시 조회해주세요.'};
  if (typeof keyword !== 'string' || !keyword.trim() || keyword.length > 250) return {ok:false,code:'INPUT',error:'상품 검색어를 확인해주세요.'};
  const path='/tenants/seller-web/pre-matching/search';
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);
  try {
    const headers={'content-type':'application/json','accept':'application/json, text/plain, */*'};
    const token=document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('XSRF-TOKEN='));
    if(token) { try { headers['x-xsrf-token']=decodeURIComponent(token.slice('XSRF-TOKEN='.length)); } catch { /* Session will return its normal auth error. */ } }
    const response=await fetch(path,{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',headers,
      signal:controller.signal,body:JSON.stringify({keyword:keyword.trim(),excludedProductIds:[],searchPage:0,searchOrder:'DEFAULT',sortType:'DEFAULT'})});
    if(response.status===401 || response.status===403) return {ok:false,code:'LOGIN',error:'Wing 로그인 또는 조회 권한을 확인해주세요. 보안 확인 화면이 있다면 직접 완료한 뒤 재조회하세요.'};
    if(response.status===429) {
      // Kept inside this function because executeScript serializes it alone.
      const raw=(response.headers?.get('retry-after')||'').trim(),now=Date.now();
      let delay=60000;
      if(/^\d+$/.test(raw))delay=Number(raw)*1000;
      else if(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/i.test(raw)) {
        const date=Date.parse(raw);
        if(Number.isFinite(date)&&new Date(date).toUTCString().toLowerCase()===raw.toLowerCase())delay=date-now;
      }
      const maxDelay=Number.MAX_SAFE_INTEGER-Math.max(0,now);
      const retryAfterOverflow=!Number.isFinite(delay)||delay>maxDelay;
      const retryAfterMs=Math.max(1000,retryAfterOverflow?maxDelay:delay);
      const error=retryAfterOverflow?'쿠팡이 매우 긴 조회 대기 시간을 지정했습니다. 자동 조회를 중지합니다.':`쿠팡 조회 제한입니다. ${Math.ceil(retryAfterMs/1000)}초 뒤 남은 상품을 이어서 조회해주세요.`;
      return {ok:false,code:'RATE_LIMIT',error,retryAfterMs,...(retryAfterOverflow?{retryAfterOverflow:true}:{})};
    }
    if(!response.ok) return {ok:false,code:'HTTP',error:`쿠팡 조회 응답 오류 (${response.status}). 잠시 후 다시 조회해주세요.`};
    const finalUrl=new URL(response.url || location.origin+path);
    if(response.redirected || finalUrl.origin!==location.origin || finalUrl.pathname!==path) return {ok:false,code:'LOGIN',error:'Wing 로그인이 필요합니다.'};
    const text=await response.text();
    if(text.length>2*1024*1024) return {ok:false,code:'SCHEMA',error:'쿠팡 조회 응답이 허용 크기를 초과했습니다.'};
    let body;
    // Wing can return JSON with a non-JSON MIME. Validate the actual body instead.
    // Never return the raw response, cookies, or an HTML login page to Coupang.
    try {body=JSON.parse(text.replace(/^\uFEFF/,''));} catch {
      if(/^\s*</.test(text)) return {ok:false,code:'RESPONSE_TYPE',error:'Wing이 판매량 데이터 대신 웹페이지를 응답했습니다. Wing에서 상품 관리 → 쿠팡 인기 상품 검색을 연 뒤 다시 조회해주세요.'};
      return {ok:false,code:'SCHEMA',error:'쿠팡 판매량 응답을 해석하지 못했습니다.'};
    }
    if(!Array.isArray(body?.result)) return {ok:false,code:'SCHEMA',error:'쿠팡 판매량 응답 형식이 변경되었습니다.'};
    // Only catalog identifiers and aggregate metrics are returned to the extension.
    const scalar=v=>(typeof v==='number'||typeof v==='string')?v:null;
    return {ok:true,rows:body.result.slice(0,200).filter(row=>row && typeof row==='object').map(row=>({
      productId:scalar(row.productId),itemId:scalar(row.itemId),vendorItemId:scalar(row.vendorItemId),
      salesLast28d:scalar(row.salesLast28d),pvLast28Day:scalar(row.pvLast28Day)
    }))};
  } catch(error) {
    return {ok:false,code:error?.name==='AbortError'?'TIMEOUT':'NETWORK',error:error?.name==='AbortError'?'쿠팡 조회 시간이 초과됐습니다. 재조회해주세요.':'Wing 연결이 끊어졌거나 로그인이 만료됐습니다. Wing 화면을 확인해주세요.'};
  } finally {clearTimeout(timer);}
}
