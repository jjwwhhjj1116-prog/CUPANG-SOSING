const endpoint='https://h5api.m.1688.com/h5/mtop.mbox.fc.common.gateway/1.0/';
let sequence=1000000000;
const initialized=new WeakMap();
const stopped=signal=>{if(signal.aborted)throw Error('상품 수집을 취소했습니다.');};

function allowedSource(target,sourceUrl){
  const url=new URL(target),source=new URL(sourceUrl),offerId=source.pathname.match(/^\/offer\/([1-9]\d{0,29})\.html$/)?.[1];
  if(source.origin!=='https://detail.1688.com'||source.username||source.password||source.search||source.hash)throw Error('1688 원본 상품 주소를 확인해주세요.');
  if(!offerId||url.protocol!=='https:'||url.username||url.password||url.port||url.hash)throw Error('공개 상품 조회 주소가 일치하지 않습니다.');
  if(url.href===`https://m.1688.com/offer/${offerId}.html`)return 'page';
  if(url.hostname==='itemcdn.tmall.com'&&!url.search&&/^\/1688offer\/[A-Za-z0-9]+$/.test(url.pathname))return 'detail';
  if(url.origin+url.pathname===endpoint){
    const fixed={jsv:'2.7.4',appKey:'12574478',api:'mtop.mbox.fc.common.gateway',v:'1.0',type:'originaljson',dataType:'json'};
    if([...url.searchParams].length!==9||Object.entries(fixed).some(([key,value])=>url.searchParams.getAll(key).length!==1||url.searchParams.get(key)!==value)
      ||!/^\d{10,16}$/.test(url.searchParams.get('t')??'')||!/^[a-f0-9]{32}$/.test(url.searchParams.get('sign')??''))throw Error('공개 옵션 조회 형식을 확인하지 못했습니다.');
    const data=JSON.parse(url.searchParams.get('data'));
    if(JSON.stringify(data)!==JSON.stringify({params:JSON.stringify({offerId}),fcName:'mini-od-cse',fcGroup:'cbu-offer',serviceName:'wirelessCoreOdService'}))throw Error('공개 옵션 조회 상품번호가 일치하지 않습니다.');
    return 'sku';
  }
  throw Error('공개 상품 조회 주소가 허용 범위를 벗어났습니다.');
}

export function supportsMobileTransport(api){
  return typeof api?.runtime?.id==='string'&&/^[a-p]{32}$/.test(api.runtime.id)
    &&typeof api.webRequest?.onHeadersReceived?.addListener==='function'
    &&typeof api.declarativeNetRequest?.updateSessionRules==='function'
    &&typeof api.declarativeNetRequest?.getSessionRules==='function';
}

function prepareTransport(api){
  if(!initialized.has(api))initialized.set(api,(async()=>{
    // A worker interrupted between request and finally must not retain even
    // anonymous transport values. No other extension's rules are accessible.
    const stale=(await api.declarativeNetRequest.getSessionRules()).filter(rule=>rule.id>1000000000&&rule.id<2000000000
      &&rule.condition?.initiatorDomains?.length===1&&rule.condition.initiatorDomains[0]===api.runtime.id).map(rule=>rule.id);
    if(stale.length)await api.declarativeNetRequest.updateSessionRules({removeRuleIds:stale,addRules:[]});
  })());
  return initialized.get(api);
}

/** Anonymous requests from this service worker only. Chrome fetch hides
 * Set-Cookie and forbids Cookie; observe only fresh public mtop responses and
 * apply their two anonymous transport values to the exact next request.
 * No cookies API, browser credentials, profile data or persistent rules. */
export function createMobileTransport(api,sourceUrl,checkApp,fetcher=fetch){
  if(!supportsMobileTransport(api))throw Error('공개 상품 수집 확장을 갱신해주세요.');
  const initiator=`chrome-extension://${api.runtime.id}`;
  const issued=new Set(),ownedRules=new Set();
  const transport=async(target,init)=>{
    const kind=allowedSource(target,sourceUrl),url=String(target),signal=init?.signal;
    if(!signal||init.redirect!=='manual'||init.credentials!=='omit'||init.cache!=='no-store'||(init.method&&init.method!=='GET'))throw Error('익명 공개 상품 조회 조건을 확인해주세요.');
    stopped(signal);await checkApp();stopped(signal);await prepareTransport(api);stopped(signal);
    const headers=new Headers(init.headers),cookie=headers.get('cookie');headers.delete('cookie');
    if(cookie&&(kind!=='sku'||!issued.has(cookie)))throw Error('이 익명 조회에서 발급되지 않은 값은 사용하지 않습니다.');
    let ruleId,observed=false,fresh=[];
    const receive=details=>{
      if(details.url!==url||details.initiator!==initiator||details.tabId!==-1||details.method!=='GET'||details.statusCode!==200)return;
      if(observed){fresh=[];return;} observed=true;
      fresh=(details.responseHeaders??[]).filter(header=>header.name.toLowerCase()==='set-cookie'&&typeof header.value==='string')
        .filter(header=>/^_m_h5_tk(?:_enc)?=[A-Za-z0-9_-]{1,512}(?:;|$)/.test(header.value)).map(header=>header.value);
    };
    try{
      if(kind==='sku')api.webRequest.onHeadersReceived.addListener(receive,{urls:[endpoint+'*']},['responseHeaders','extraHeaders']);
      if(cookie){
        ruleId=++sequence;
        ownedRules.add(ruleId);
        await api.declarativeNetRequest.updateSessionRules({removeRuleIds:[],addRules:[{id:ruleId,priority:1,action:{type:'modifyHeaders',requestHeaders:[{header:'cookie',operation:'set',value:cookie}]},
          condition:{urlFilter:'|'+url+'|',isUrlFilterCaseSensitive:true,initiatorDomains:[api.runtime.id],resourceTypes:['xmlhttprequest'],requestMethods:['get']}}]});
      }
      stopped(signal);await checkApp();stopped(signal);
      const response=await fetcher(url,{...init,headers});
      stopped(signal);await checkApp();stopped(signal);
      const outputHeaders=new Headers(response.headers);outputHeaders.delete('set-cookie');
      if(kind==='sku'&&response.status===200&&observed){
        const values=new Map();let valid=true;
        for(const value of fresh){
          const match=/^(_m_h5_tk(?:_enc)?)=([A-Za-z0-9_-]{1,512})(?:;|$)/.exec(value);
          if(values.has(match[1])&&values.get(match[1])!==match[2])valid=false;
          values.set(match[1],match[2]);
        }
        if(valid&&/^[A-Za-z0-9]+_\d{10,16}$/.test(values.get('_m_h5_tk')??'')){
          issued.add([...values].map(([name,value])=>`${name}=${value}`).join('; '));
          for(const [name,value]of values)outputHeaders.append('set-cookie',`${name}=${value}; Path=/`);
        }
      }
      if(!response.status)return response;
      // Response constructors also guard Set-Cookie in Chromium. Supply only
      // the four fields used by the bounded collector, with inert Headers.
      return {ok:response.ok,status:response.status,headers:outputHeaders,body:response.body};
    }finally{
      if(kind==='sku')api.webRequest.onHeadersReceived.removeListener(receive);
      if(ruleId!==undefined){await api.declarativeNetRequest.updateSessionRules({removeRuleIds:[ruleId],addRules:[]});ownedRules.delete(ruleId);}
    }
  };
  transport.dispose=async()=>{
    issued.clear();
    if(ownedRules.size){await api.declarativeNetRequest.updateSessionRules({removeRuleIds:[...ownedRules],addRules:[]});ownedRules.clear();}
  };
  return transport;
}
