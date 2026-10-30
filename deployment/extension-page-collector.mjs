import {extractPageSource,pageSourceUrl,readPageSourceDomOptions,readPageSourceDomFacts,readPageSourceElementImage,readPageSourceDescriptionReference,validatePageSourceForDelivery} from '../extensions/supplier-hub/page-source.mjs';
import {readPageDomDetails,waitForPageDomDetails} from '../extensions/supplier-hub/page-dom-details.mjs';
import {hydratePageForCapture} from '../extensions/supplier-hub/page-hydration.mjs';
import {createPageCaptureObservations} from '../extensions/supplier-hub/page-capture-observations.mjs';
import {readProductSectionLinks,readProductSectionStructure} from '../extensions/supplier-hub/page-dom-sections.mjs';
// This identifies the injected script itself, even when an older open page
// outlives an extension update. The runtime manifest is not that proof.
const COLLECTOR_SCRIPT_VERSION='2.1.66';
const COLLECTOR_HOST_ID='yoofam-page-collector',COLLECTOR_OWNER='yoofam-studio';
const OWNER_ATTRIBUTE='data-yoofam-collector-owner',VERSION_ATTRIBUTE='data-yoofam-collector-version',LEASE_ATTRIBUTE='data-yoofam-collector-capture';
// Existing extensions/supplier-hub/icons/yoofam.svg, embedded to keep the
// launcher self-contained without an additional host or asset permission.
const COLLECTOR_ICON='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><defs><linearGradient id="yf-blue" x1="16" y1="8" x2="110" y2="126" gradientUnits="userSpaceOnUse"><stop stop-color="#6576FF"/><stop offset=".48" stop-color="#3A56EC"/><stop offset="1" stop-color="#2539B7"/></linearGradient><linearGradient id="yf-mint" x1="73" y1="36" x2="96" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#C7FFE8"/><stop offset="1" stop-color="#70E9CA"/></linearGradient></defs><rect x="4" y="4" width="120" height="120" rx="32" fill="url(#yf-blue)"/><rect x="5" y="5" width="118" height="118" rx="31" stroke="white" stroke-opacity=".16" stroke-width="2"/><path d="M37 43C37 38 43 35 47 39L68 61C71 64 73 68 73 73V91C73 96 69 99 64 99C59 99 55 96 55 91V76C55 73 54 71 52 69L40 54C38 51 37 48 37 43Z" fill="white"/><path d="M70 56C69 46 75 36 86 34L96 32L94 42C92 53 83 59 73 59C71 59 70 58 70 56Z" fill="url(#yf-mint)"/></svg>');
const CAPTURE_LEASE_MS=60000;
const BULK_UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const BULK_ORIGINS=['https://sourceflow.jjwwhhjj1116.workers.dev','http://localhost:3000','http://127.0.0.1:3000'];
const bulkObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const bulkExact=(value,keys)=>bulkObject(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function bulkPayload(value){
 if(!bulkExact(value,['batchId','itemId','leaseNonce','sourceUrl','deadlineAt'])||!BULK_UUID.test(value.batchId)||!BULK_UUID.test(value.itemId)
  ||typeof value.leaseNonce!=='string'||!/^[A-Za-z0-9_-]{16,128}$/u.test(value.leaseNonce)||!Number.isSafeInteger(value.deadlineAt)||value.deadlineAt<=Date.now()||value.deadlineAt>Date.now()+CAPTURE_LEASE_MS
  ||pageSourceUrl(value.sourceUrl).sourceUrl!==value.sourceUrl||pageSourceUrl(location.href).sourceUrl!==value.sourceUrl)throw Error('현재 상품의 일괄 수집 연결을 확인하지 못했습니다.');
 return Object.freeze({...value});
}
async function verifyBulkLease(payload){
 const answer=await chrome.runtime.sendMessage({type:'YOOFAM_VALIDATE_BULK_PAGE',payload});
 const lease=answer?.lease;
 if(!bulkExact(answer,['ok','lease'])||answer.ok!==true||!bulkExact(lease,['batchId','itemId','leaseNonce','sourceUrl','deadlineAt','ownerId','company','origin','appTabId','windowId','tabId'])
  ||!['batchId','itemId','leaseNonce','sourceUrl','deadlineAt'].every(key=>lease[key]===payload[key])||!Number.isSafeInteger(lease.deadlineAt)||lease.deadlineAt<=Date.now()
  ||typeof lease.ownerId!=='string'||!/^\w[\w-]{0,99}$/u.test(lease.ownerId)||!bulkExact(lease.company,['code','name'])||({A01526306:'유앤채',A01464742:'와이홉'})[lease.company.code]!==lease.company.name
  ||!BULK_ORIGINS.includes(lease.origin)||!['appTabId','windowId','tabId'].every(key=>Number.isSafeInteger(lease[key])&&lease[key]>=0)
  ||pageSourceUrl(location.href).sourceUrl!==payload.sourceUrl||document.visibilityState!=='hidden')throw Error('현재 회원·회사와 일괄 수집 탭의 연결을 확인하지 못했습니다.');
 return Object.freeze({...lease,company:Object.freeze({...lease.company})});
}
function sameBulkLease(left,right){
 return ['batchId','itemId','leaseNonce','sourceUrl','deadlineAt','ownerId','origin','appTabId','windowId','tabId'].every(key=>left[key]===right[key])&&left.company.code===right.company.code&&left.company.name===right.company.name;
}
function collectorVersion(value){
 if(typeof value!=='string'||!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/u.test(value))return null;
 return value.split('.').map(Number);
}
function knownLegacyCollector(host){
 // Pre-marker releases created exactly this empty, closed-shadow DIV. An
 // unrelated same-ID element is left alone rather than removed by a guess.
 return host.localName==='div'&&host.shadowRoot===null&&host.childNodes.length===0&&Array.from(host.attributes,attribute=>attribute.name).sort().join(',')==='id,style'
  &&host.style.length===4&&host.style.position==='fixed'&&host.style.right==='22px'&&host.style.bottom==='86px'&&host.style.zIndex==='2147483646';
}
function captureLease(value,now){
 if(typeof value!=='string')return null;
 const match=/^yoofam-studio:(\d{1,6}\.\d{1,6}\.\d{1,6}):(\d{13}):(\d{13}):(\d{1,10})$/u.exec(value);
 if(!match)return null;
 const created=Number(match[2]),expires=Number(match[3]);
 return expires>created&&expires-created<=CAPTURE_LEASE_MS&&created<=now+CAPTURE_LEASE_MS?{expires}:null;
}
function storedReceiptSummary(result,snapshot){
 if(result.storedReceipt===undefined)return null;
 const receipt=result.storedReceipt,object=value=>!!value&&typeof value==='object'&&!Array.isArray(value),timestamp=value=>typeof value==='string'&&value.length<=30&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(value)&&Number.isFinite(Date.parse(value));
 if(!object(receipt)||Object.keys(receipt).sort().join(',')!=='captureVersion,collectedAt,company,fingerprint,ownerId,receivedAt,sourceUrl,storedId'
  ||!object(receipt.company)||Object.keys(receipt.company).sort().join(',')!=='code,name'||({A01526306:'유앤채',A01464742:'와이홉'})[receipt.company.code]!==receipt.company.name
  ||typeof receipt.ownerId!=='string'||!/^\w[\w-]{0,99}$/u.test(receipt.ownerId)||receipt.ownerId!==result.ownerId||receipt.company.code!==result.company?.code||receipt.company.name!==result.company?.name
  ||typeof receipt.fingerprint!=='string'||!/^[a-f0-9]{64}$/u.test(receipt.fingerprint)||receipt.fingerprint!==result.fingerprint||typeof receipt.storedId!=='string'||!/^[a-f0-9-]{36}$/u.test(receipt.storedId)
  ||receipt.sourceUrl!==snapshot.sourceUrl||!Number.isSafeInteger(receipt.captureVersion)||receipt.captureVersion<1||!timestamp(receipt.receivedAt)||!timestamp(receipt.collectedAt)
  ||!(result.pendingSnapshotReplayed===true&&result.newCaptureStored===false)&&receipt.collectedAt!==snapshot.collectedAt)throw Error('서버 수집본 상세 응답이 전달한 원문과 일치하지 않습니다. 앱의 수집함에서 저장본을 확인해주세요.');
 const format=value=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value));
 return `서버 수집본 ${receipt.captureVersion} · 저장 ${format(receipt.receivedAt)} (KST) · 원문 수집 ${format(receipt.collectedAt)} (KST).`;
}
function captureSummary(snapshot){
 const attributes=snapshot.attributes.length,packaging=snapshot.options.filter(option=>option.packaging&&['weightG','widthMm','lengthMm','heightMm'].some(key=>typeof option.packaging[key]==='number'&&option.packaging[key]>0)).length;
 const details=snapshot.images.filter(image=>image.role==='detail').length,missing=[];
 if(!attributes)missing.push('제품속성');
 if(packaging<snapshot.options.length)missing.push(packaging?`포장정보 ${snapshot.options.length-packaging}옵션`:'포장정보');
 if(!details)missing.push('상세이미지');
 return `수집 내용: 제품속성 ${attributes}개 · 포장정보 ${packaging}/${snapshot.options.length}옵션 · 상세이미지 ${details}장.${missing.length?` 미수집·미확인: ${missing.join(' · ')}. 누락 항목을 자동으로 채우지 않았습니다.`:''}`;
}
function captureDiagnosticSummary(snapshot){
 const diagnostics=snapshot.captureDiagnostics;if(!diagnostics)return '';
 const sections=diagnostics.sections,titles=diagnostics.bodyTitles;
 const note=`현재 문서 영역: 탭 ${sections.tabCount}개 · 상품정보 탭 ${sections.knownTabCount}개 · 본문 패널 ${sections.panelCount}개 · 연결 확인 ${sections.linkedKnownPanelCount}개 · 연결 미확인 ${sections.unlinkedKnownTabCount}개.`;
 const descriptions={'not-needed':'','reference-missing':'상세문서 연결: 현재 상품에 연결된 주소가 확인되지 않았습니다.','reference-invalid':'상세문서 연결: 현재 상품과 일치하는 원문을 확인하지 못했습니다.',unavailable:'상세문서 연결: 원문을 확인하지 못했습니다. 현재 본문에서 읽은 자료만 보관합니다.',captured:'상세문서 연결: 현재 상품의 상세사진을 확인했습니다.'};
 return note+(titles?` 일반 본문: 속성 제목 ${titles.attributes}개 · 포장 제목 ${titles.packaging}개 · 상세 제목 ${titles.detail}개.`:'')+' '+descriptions[diagnostics.description];
}
// An actual single-page click or an authenticated worker-owned bulk tab may
// capture this exact top-level product. No page/global code is executed.
function installPageCollector(){
 try{pageSourceUrl(location.href);}catch{throw Error('Not a product document');}
 const previous=document.getElementById(COLLECTOR_HOST_ID);
 if(previous){
  if(previous.getAttribute(OWNER_ATTRIBUTE)===COLLECTOR_OWNER){
   if(previous.localName!=='div')return;
   const raw=previous.getAttribute(VERSION_ATTRIBUTE),version=collectorVersion(raw),current=collectorVersion(COLLECTOR_SCRIPT_VERSION);
   if(raw!==null&&!version)return;
   if(version){let order=0;for(let i=0;i<3&&!order;i++)order=version[i]-current[i];if(order>=0)return;}
  }else if(!knownLegacyCollector(previous))return;
  previous.remove();
 }
 const host=document.createElement('div');host.id=COLLECTOR_HOST_ID;host.setAttribute(OWNER_ATTRIBUTE,COLLECTOR_OWNER);host.setAttribute(VERSION_ATTRIBUTE,COLLECTOR_SCRIPT_VERSION);host.style.cssText='position:fixed;right:22px;bottom:86px;z-index:2147483646;';
 const root=host.attachShadow({mode:'closed'}),style=document.createElement('style');style.textContent=':host{display:flex;flex-direction:column;align-items:flex-end;gap:7px;font:13px/1.5 system-ui;color:#172554}*{box-sizing:border-box}[hidden]{display:none!important}button{font:600 14px system-ui;cursor:pointer;transition:transform .15s,box-shadow .15s}button:focus-visible{outline:3px solid #67e8f9;outline-offset:3px}.collect{order:2;min-width:112px;max-width:min(240px,calc(100vw - 44px));border:1px solid #ffffff70;border-radius:12px;background:linear-gradient(130deg,#13b8dc,#2865ed 76%);color:#fff;padding:11px 17px;box-shadow:0 5px 18px #1d4ed835}.collect::before{content:"↓";display:inline-block;margin-right:7px;font-size:16px;font-weight:800}.collect:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 7px 20px #1d4ed847}.collect:disabled{opacity:.72;cursor:wait}.launcher{order:3;position:relative;display:grid;place-items:center;width:66px;height:66px;padding:3px;border:2px solid #fff;border-radius:50%;background:#fff;box-shadow:0 4px 18px #17255433,0 0 0 1px #dce8ff}.launcher:hover{transform:translateY(-2px);box-shadow:0 6px 22px #1d4ed84d}.launcher img{display:block;width:56px;height:56px;border-radius:50%}.launcher span{position:absolute;bottom:6px;left:17px;right:17px;border-radius:5px;background:#fff;color:#2445be;font:800 10px/14px system-ui;letter-spacing:.8px;text-align:center;box-shadow:0 1px 3px #1e40af22}small{order:1;margin:0 1px 0 0;padding:2px 6px;border:1px solid #e4ebf9;border-radius:5px;color:#617292;background:#fff;font:10px/1.4 system-ui;white-space:nowrap}p{order:0;margin:0 0 3px;max-width:min(320px,calc(100vw - 44px));max-height:min(280px,45vh);overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #d9e5f8;border-radius:12px;background:#fff;padding:12px 14px;color:#172554;box-shadow:0 5px 22px #1725541a;font:12px/1.6 system-ui}@media(prefers-reduced-motion:reduce){button{transition:none}}';
 const badge=document.createElement('small'),button=document.createElement('button'),status=document.createElement('p'),launcher=document.createElement('button'),icon=document.createElement('img'),wordmark=document.createElement('span');
 badge.id='yoofam-collector-version';badge.textContent=`수집기 ${COLLECTOR_SCRIPT_VERSION}`;button.id='yoofam-collector-action';button.type='button';button.className='collect';button.textContent='상품 수집';button.title=`YOOFAM 상품 수집기 ${COLLECTOR_SCRIPT_VERSION}`;
 status.id='yoofam-collector-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.hidden=true;
 launcher.type='button';launcher.className='launcher';launcher.setAttribute('aria-label','YFS 상품 수집 메뉴 접기');launcher.setAttribute('aria-expanded','true');launcher.setAttribute('aria-controls','yoofam-collector-action yoofam-collector-version yoofam-collector-status');launcher.title='YOOFAM 스튜디오';icon.src=COLLECTOR_ICON;icon.alt='';icon.setAttribute('aria-hidden','true');wordmark.textContent='YFS';wordmark.setAttribute('aria-hidden','true');launcher.append(icon,wordmark);
 root.append(style,badge,button,status,launcher);document.documentElement.append(host);
 let expanded=true;
 const syncWidget=()=>{button.hidden=!expanded;badge.hidden=!expanded;status.hidden=!expanded||!status.textContent;launcher.setAttribute('aria-expanded',String(expanded));launcher.setAttribute('aria-label',`YFS 상품 수집 메뉴 ${expanded?'접기':'펼치기'}`);};
 const showStatus=message=>{status.textContent=`수집기 ${COLLECTOR_SCRIPT_VERSION} · ${message}`;status.hidden=!expanded;};
 const isCurrent=()=>host.isConnected&&document.getElementById(COLLECTOR_HOST_ID)===host;
 launcher.addEventListener('click',event=>{if(!event.isTrusted||!isCurrent())return;expanded=!expanded;syncWidget();});
 for(const control of [launcher,button])control.addEventListener('keydown',event=>{if(!event.isTrusted||!isCurrent()||event.key!=='Escape'||!expanded)return;expanded=false;syncWidget();event.preventDefault?.();event.stopPropagation?.();launcher.focus?.();});
 let pending=false,retrySnapshot=null,sequence=0,bulkAttempt=null;
 async function collect(bulk=null){
  if(pending||!isCurrent()){if(bulk)throw Error('현재 상품 수집기가 이미 작업 중이거나 교체됐습니다.');return;}
  if(bulk&&retrySnapshot)throw Error('이 상품 탭의 이전 보관본이 남아 있습니다. 일괄 수집을 다시 시작하지 않았습니다.');
  const leaseRoot=document.documentElement;
  const previousLease=leaseRoot.getAttribute(LEASE_ATTRIBUTE),started=Date.now(),deadline=bulk?Math.min(started+CAPTURE_LEASE_MS,bulk.payload.deadlineAt):started+CAPTURE_LEASE_MS;
  if(previousLease!==null){
   const prior=captureLease(previousLease,started);
   if(!prior){status.hidden=false;showStatus('이전 수집기 연결 상태를 확인하지 못했습니다. 상품 페이지를 새로고침한 뒤 다시 눌러주세요. 새 수집은 시작하지 않았습니다.');if(bulk)throw Error('이전 수집기 연결 상태를 확인하지 못했습니다.');return;}
   if(prior.expires>started){status.hidden=false;showStatus('이전 수집 응답을 기다리고 있습니다. 완료하거나 최대 60초 후 상품 수집을 다시 눌러주세요. 새 수집은 시작하지 않았습니다.');if(bulk)throw Error('이전 상품 수집 응답이 미확정입니다.');return;}
  }
  const lease=`${COLLECTOR_OWNER}:${COLLECTOR_SCRIPT_VERSION}:${started}:${deadline}:${++sequence}`;leaseRoot.setAttribute(LEASE_ATTRIBUTE,lease);
  let ownedPageUnloaded=false;
  const onOwnedPageHide=()=>{ownedPageUnloaded=true;};
  if(bulk&&typeof window.addEventListener==='function')window.addEventListener('pagehide',onOwnedPageHide,{capture:true});
  const assertOwnedBulkScope=()=>{
   if(!bulk||ownedPageUnloaded||document.visibilityState!=='hidden'||pageSourceUrl(location.href).sourceUrl!==bulk.payload.sourceUrl||Date.now()>=bulk.payload.deadlineAt)throw Error('일괄 수집 탭의 상품·활성 상태 또는 연결 시간이 변경되어 중단했습니다.');
   const title=typeof document.title==='string'?document.title.trim():'';
   if(/^(?:请完成)?(?:安全验证|滑动验证|访问验证|验证码)/u.test(title))throw Error('1688 보안 확인 화면입니다. 일괄 수집을 중단했고 자동 재시도하지 않았습니다.');
   if(/^(?:1688|阿里巴巴)?(?:会员)?(?:登录|登入)(?:\s|[-_—]|$)/u.test(title))throw Error('1688 로그인 화면입니다. 일괄 수집을 중단했고 자동 재시도하지 않았습니다.');
  };
  const assertActive=()=>{if(!isCurrent()||document.documentElement!==leaseRoot||leaseRoot.getAttribute(LEASE_ATTRIBUTE)!==lease)throw Error('수집기가 교체되어 이전 수집을 중단했습니다. 현재 수집기에서 다시 확인해주세요.');if(Date.now()>=deadline)throw Error('수집 확인 시간이 60초를 초과했습니다. 자동으로 다시 수집하지 않았습니다. 앱 저장본을 확인한 뒤 다시 눌러주세요.');if(bulk)assertOwnedBulkScope();};
  pending=true;button.disabled=true;button.textContent=retrySnapshot?'앱 전송 중…':'수집 중…';status.hidden=false;showStatus(retrySnapshot?'처음 보관한 원문을 앱에 다시 전달합니다.':'현재 페이지의 상품정보를 확인합니다.');
  try{
   assertActive();
   const before=pageSourceUrl(location.href).sourceUrl;
   if(retrySnapshot&&retrySnapshot.sourceUrl!==before){retrySnapshot=null;throw Error('상품 페이지가 변경되었습니다. 이전 보관본은 확장에 유지됩니다. 현재 상품은 아직 수집하지 않았습니다. 상품 수집 버튼을 다시 눌러주세요.');}
   let snapshot=retrySnapshot;
   if(!snapshot){
    showStatus('화면을 잠시 내려 상품정보를 확인한 뒤 원래 위치로 돌아갑니다. 화면을 조작하면 수집을 중단합니다.');
    const views=createPageCaptureObservations(before);
    const pageScripts=()=>{const scripts=[],descriptionScripts=[];let size=0;for(const script of document.scripts){const raw=script.textContent??'',sourceData=/"(?:skuModel|subject|offerTitle|offerSubject|productTitle|productName|offerBaseInfo|tempModel|offerImgList|mainImageList|propsList)"\s*:/.test(raw),descriptionData=/"detailUrl"\s*:/.test(raw);if(!sourceData&&!descriptionData)continue;size+=raw.length;if(size>4*1024*1024)throw Error('상품 데이터가 수집 크기를 초과했습니다.');if(sourceData)scripts.push(raw);if(descriptionData)descriptionScripts.push(raw);}return {scripts,descriptionScripts};};
    const observed=await hydratePageForCapture(document,window,{...(bulk?{assertOwnedBulkScope}:{}),assertCurrent:()=>{assertActive();if(pageSourceUrl(location.href).sourceUrl!==before)throw Error('상품 페이지가 변경되었습니다. 다시 수집해주세요.');},observe:checked=>{
     checked();const {scripts}=pageScripts();const facts=scripts.length?readPageSourceDomFacts(document,before,scripts):null;views.add(facts,readPageDomDetails(document,before));checked();
    },capture:async assertCurrent=>{
    const ready=waitForPageDomDetails(document,before,{assertCurrent});
    assertActive();
    const detail=ready&&typeof ready.then==='function'?await ready:ready;
    assertActive();
    const text=selector=>document.querySelector(selector)?.textContent?.trim()??'';
    const urls=selector=>[...document.querySelectorAll(selector)].slice(0,200).map(node=>readPageSourceElementImage(node,{preferDataSource:true})).filter(Boolean);
    const {scripts,descriptionScripts}=pageScripts();
    views.add(readPageSourceDomFacts(document,before,scripts),detail);const collected=views.result();
    const productTitle=text('h1.d-title,.detail-title h1,.offer-title,[data-module-name="title"] h1,[data-plg-name="title"] h1');
    const snapshot=extractPageSource({sourceUrl:before,scripts,domOptions:readPageSourceDomOptions(document,before,scripts),domFacts:collected.facts,title:productTitle||document.querySelector('meta[property="og:title"]')?.content||document.title,
     description:collected.detail.description,
     gallery:urls('.detail-gallery img,.gallery img,[class*="gallery"] img'),detailImages:collected.detail.detailImages,
     priceText:text('.price-container')||text('[class*="price-module"]')||text('[class*="price-component"]'),
     minimumOrderText:text('.price-container')||text('[class*="price-module"]')||text('[class*="price-component"]')});
    const sections=readProductSectionLinks(document).diagnostics;
    const captureDiagnostics={format:'yoofam-page-capture-diagnostics-v1',collectorVersion:COLLECTOR_SCRIPT_VERSION,sections,description:'not-needed'};
    if(!snapshot.attributes.length||!snapshot.images.some(image=>image.role==='detail')||snapshot.options.some(option=>!option.packaging)){
     // Diagnostic shape only; never expose page text, identities or addresses.
     const structure=readProductSectionStructure(document);
     const counts=['attributes','packaging','detail'].map(kind=>structure.labels.filter(row=>row.kind===kind&&!row.excluded).length);
     captureDiagnostics.bodyTitles={attributes:counts[0],packaging:counts[1],detail:counts[2]};
    }
    assertCurrent();return{snapshot,captureDiagnostics,descriptionScripts};
    }});
    snapshot=observed.snapshot;
    const {captureDiagnostics,descriptionScripts}=observed;
    if(!snapshot.images.some(image=>image.role==='detail')){
     let reference=null;try{reference=readPageSourceDescriptionReference(before,descriptionScripts);}catch{captureDiagnostics.description='reference-invalid';}
     if(reference){
      assertActive();
      const descriptionResult=await chrome.runtime.sendMessage({type:'YOOFAM_READ_PAGE_DESCRIPTION',sourceUrl:before});
      assertActive();if(pageSourceUrl(location.href).sourceUrl!==before)throw Error('상품 페이지가 변경되었습니다. 다시 수집해주세요.');
      if(descriptionResult?.ok===true&&descriptionResult.available===true){
       if(descriptionResult.sourceUrl!==before||descriptionResult.offerId!==snapshot.offerId||!Array.isArray(descriptionResult.detailImages)||!descriptionResult.detailImages.length||descriptionResult.detailImages.length>80)throw Error('상세문서 응답이 현재 상품과 다릅니다.');
       const known=new Set(snapshot.images.map(image=>image.url)),images=[...snapshot.images];
       for(const url of descriptionResult.detailImages){if(typeof url!=='string')throw Error('상세문서 이미지 응답을 확인하지 못했습니다.');if(!known.has(url)){images.push({url,role:'detail'});known.add(url);}}
       snapshot=validatePageSourceForDelivery({...snapshot,images});
       captureDiagnostics.description='captured';
      }else captureDiagnostics.description='unavailable';
     }else if(captureDiagnostics.description!=='reference-invalid')captureDiagnostics.description='reference-missing';
    }
    // Bind the observed diagnostics to this immutable capture before its
    // existing fingerprint/storage path. Exact retries retain this same data.
    snapshot=validatePageSourceForDelivery({...snapshot,captureDiagnostics});
   }
   assertActive();
   if(pageSourceUrl(location.href).sourceUrl!==before)throw Error('상품 페이지가 변경되었습니다. 다시 수집해주세요.');
   if(bulk){const currentLease=await verifyBulkLease(bulk.payload);assertActive();if(!sameBulkLease(currentLease,bulk.lease))throw Error('일괄 수집 중 회원·회사 연결이 변경됐습니다. 원문을 전송하지 않았습니다.');}
   const result=await chrome.runtime.sendMessage({type:'YOOFAM_SAVE_PAGE_SOURCE',snapshot,...(bulk?{bulk:{batchId:bulk.payload.batchId,itemId:bulk.payload.itemId,leaseNonce:bulk.payload.leaseNonce}}:{})});
   assertActive();
   if(result?.ok!==true)throw Error(result?.error||'수집 결과를 확인하지 못했습니다. 다시 누르면 저장 결과를 확인합니다.');
   const deliveryMessage=typeof result.message==='string'&&result.message.trim()?result.message:'앱의 저장 확인 응답을 받지 못했습니다.';
   if(pageSourceUrl(location.href).sourceUrl!==before){
    retrySnapshot=null;const previous=result.delivered===true?'이전 상품은 앱 수집함에 저장되었습니다.':result.delivered===false?'이전 상품은 확장에 보관했습니다. '+deliveryMessage:'이전 상품의 앱 저장 결과를 확인하지 못했습니다.';
    throw Error(previous+' 상품 페이지가 변경되어 현재 상품은 아직 수집하지 않았습니다. 상품 수집 버튼을 다시 눌러주세요.');
   }
   if(result.delivered===true){
    const receiptSummary=storedReceiptSummary(result,snapshot),savedDetail=receiptSummary??'서버 수집본 상세 미확인. 앱 목록에서 저장본을 확인해주세요.';
    if(bulk&&(!receiptSummary||result.pendingSnapshotReplayed===true||result.newCaptureStored===false||result.ownerId!==bulk.lease.ownerId||result.company?.code!==bulk.lease.company.code||result.company?.name!==bulk.lease.company.name||result.storedReceipt.collectedAt!==snapshot.collectedAt))throw Error('일괄 수집 원문의 정확한 서버 저장 확인을 받지 못했습니다. 자동 재전송하지 않았습니다.');
    retrySnapshot=null;
    if(result.pendingSnapshotReplayed===true&&result.newCaptureStored===false){showStatus('이전에 전송 확인을 받지 못한 수집본의 저장을 확인했습니다. 방금 읽은 새 상품정보는 아직 저장하지 않았습니다. ‘현재 상품 다시 수집’을 한 번 눌러 새 수집본으로 보관하세요. 기존 작업과 이전 검토값은 유지됩니다. '+savedDetail);button.textContent='현재 상품 다시 수집';}
    else{showStatus((receiptSummary?(result.duplicate===true?'이미 수집함에 담긴 원문과 검토 내용을 유지했습니다. ':'YOOFAM 스튜디오 AI상품등록 목록에 담았습니다. 앱에서 카테고리를 선택하고 초안을 작성하세요. '):'앱 저장 확인 응답을 받았습니다. ')+savedDetail+' '+(receiptSummary?'':'현재 페이지 읽기 결과 · 서버 저장본의 항목 수는 미확인. ')+captureSummary(snapshot)+' '+captureDiagnosticSummary(snapshot));button.textContent='수집 완료';}
   }else if(result.delivered===false){
    // Keep the first click's payload even if the visible page data changes.
    if(!bulk)retrySnapshot=snapshot;showStatus((result.pendingSnapshotReplayed===true&&result.newCaptureStored===false?'이전에 보관한 수집본의 전송 확인을 다시 기다리고 있습니다. 방금 읽은 새 상품정보는 아직 저장하지 않았습니다. ':'확장에 보관했습니다. 앱 수집함의 저장을 확인하지 못했습니다. ')+deliveryMessage+' 같은 창의 YOOFAM 앱에서 상태를 확인한 뒤 이 버튼으로 다시 시도하거나 수집함에서 불러오세요.');button.textContent=bulk?'일괄 저장 결과 미확정':'앱 전송 다시 시도';
   }else throw Error('앱 수집함의 저장 결과를 확인하지 못했습니다. 다시 누르면 저장 결과를 확인합니다.');
   return result;
  }catch(error){if(isCurrent()){showStatus(error?.message||'상품 수집 실패');button.textContent=retrySnapshot?'앱 전송 다시 시도':'상품 수집';}if(bulk)throw error;}
  finally{if(bulk&&typeof window.removeEventListener==='function')window.removeEventListener('pagehide',onOwnedPageHide,{capture:true});if(leaseRoot.getAttribute(LEASE_ATTRIBUTE)===lease)leaseRoot.removeAttribute(LEASE_ATTRIBUTE);pending=false;if(isCurrent())button.disabled=false;}
 }
 button.addEventListener('click',async event=>{
  if(!event.isTrusted||pending||!isCurrent())return;
  if(bulkAttempt){status.hidden=false;showStatus('일괄 수집 요청은 이 탭에서 한 번만 처리합니다. 목록의 저장 결과를 확인해주세요. 새 수집은 시작하지 않았습니다.');return;}
  await collect();
 });
 if(typeof chrome.runtime.onMessage?.addListener==='function')chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(!['YOOFAM_BULK_PAGE_READY','YOOFAM_BULK_COLLECT_PAGE'].includes(message?.type)||!isCurrent())return;
  if(typeof chrome.runtime.id!=='string'||!chrome.runtime.id||sender?.id!==chrome.runtime.id||sender.tab!==undefined||sender.frameId!==undefined)return;
  if(message.type==='YOOFAM_BULK_PAGE_READY'){
   if(!bulkExact(message,['type'])){sendResponse({ok:false,error:'일괄 수집 준비 요청을 확인하지 못했습니다.'});return;}
   try{const source=pageSourceUrl(location.href);sendResponse({ok:true,result:{sourceUrl:source.sourceUrl,offerId:source.offerId,version:COLLECTOR_SCRIPT_VERSION}});}catch(error){sendResponse({ok:false,error:error?.message||'상품 페이지가 아닙니다.'});}return;
  }
  let payload;
  try{if(!bulkExact(message,['type','payload']))throw Error('일괄 수집 요청 형식을 확인하지 못했습니다.');payload=bulkPayload(message.payload);}catch(error){sendResponse({ok:false,error:error?.message||'일괄 수집 요청을 확인하지 못했습니다.'});return;}
  const key=JSON.stringify(['batchId','itemId','leaseNonce','sourceUrl','deadlineAt'].map(name=>payload[name]));
  if(bulkAttempt&&bulkAttempt.key!==key){sendResponse({ok:false,error:'이 탭에서 원래 일괄 수집 요청을 이미 처리했습니다. 다시 수집하지 않았습니다.'});return;}
  if(!bulkAttempt){
   const promise=(async()=>{const lease=await verifyBulkLease(payload);if(!isCurrent())throw Error('일괄 수집기가 교체됐습니다.');return collect({payload,lease});})();
   bulkAttempt={key,promise};
  }
  bulkAttempt.promise.then(result=>sendResponse(result),error=>sendResponse({ok:false,error:typeof error?.message==='string'?error.message.slice(0,1000):'일괄 수집 실패'}));return true;
 });
}
if(window===window.top)installPageCollector();
