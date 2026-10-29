import {extractPageSource,pageSourceUrl,readPageSourceDomOptions,readPageSourceDomFacts,readPageSourceElementImage,readPageSourceDescriptionReference,validatePageSourceForDelivery} from '../extensions/supplier-hub/page-source.mjs';
import {readPageDomDetails,waitForPageDomDetails} from '../extensions/supplier-hub/page-dom-details.mjs';
import {hydratePageForCapture} from '../extensions/supplier-hub/page-hydration.mjs';
import {createPageCaptureObservations} from '../extensions/supplier-hub/page-capture-observations.mjs';
import {readProductSectionLinks,readProductSectionStructure} from '../extensions/supplier-hub/page-dom-sections.mjs';
// This identifies the injected script itself, even when an older open page
// outlives an extension update. The runtime manifest is not that proof.
const COLLECTOR_SCRIPT_VERSION='2.1.55';
const COLLECTOR_HOST_ID='yoofam-page-collector',COLLECTOR_OWNER='yoofam-studio';
const OWNER_ATTRIBUTE='data-yoofam-collector-owner',VERSION_ATTRIBUTE='data-yoofam-collector-version',LEASE_ATTRIBUTE='data-yoofam-collector-capture';
const CAPTURE_LEASE_MS=60000;
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
// Only an actual click in the top-level product document starts a capture.
// No background source request or page/global code execution is used.
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
 const root=host.attachShadow({mode:'closed'}),style=document.createElement('style');style.textContent='button{border:0;border-radius:12px;background:#2563eb;color:white;padding:14px 20px;font:600 14px system-ui;cursor:pointer;box-shadow:0 4px 16px #0003}button:disabled{opacity:.65;cursor:wait}small{display:block;text-align:right;color:#172554;background:white;border-radius:6px;padding:2px 6px;margin-bottom:4px;font:12px system-ui}p{background:white;color:#172554;border:1px solid #cbd5e1;padding:10px;border-radius:8px;max-width:300px;font:13px/1.5 system-ui}';
 const badge=document.createElement('small'),button=document.createElement('button'),status=document.createElement('p');badge.textContent=`수집기 ${COLLECTOR_SCRIPT_VERSION}`;button.type='button';button.textContent='YOOFAM 스튜디오 상품 수집';button.title=`YOOFAM 상품 수집기 ${COLLECTOR_SCRIPT_VERSION}`;status.setAttribute('role','status');status.hidden=true;root.append(style,badge,button,status);document.documentElement.append(host);
 const showStatus=message=>{status.textContent=`수집기 ${COLLECTOR_SCRIPT_VERSION} · ${message}`;};
 const isCurrent=()=>host.isConnected&&document.getElementById(COLLECTOR_HOST_ID)===host;
 let pending=false,retrySnapshot=null,sequence=0;
 button.addEventListener('click',async event=>{
  if(!event.isTrusted||pending||!isCurrent())return;
  const leaseRoot=document.documentElement;
  const previousLease=leaseRoot.getAttribute(LEASE_ATTRIBUTE),started=Date.now(),deadline=started+CAPTURE_LEASE_MS;
  if(previousLease!==null){
   const prior=captureLease(previousLease,started);
   if(!prior){status.hidden=false;showStatus('이전 수집기 연결 상태를 확인하지 못했습니다. 상품 페이지를 새로고침한 뒤 다시 눌러주세요. 새 수집은 시작하지 않았습니다.');return;}
   if(prior.expires>started){status.hidden=false;showStatus('이전 수집 응답을 기다리고 있습니다. 완료하거나 최대 60초 후 상품 수집을 다시 눌러주세요. 새 수집은 시작하지 않았습니다.');return;}
  }
  const lease=`${COLLECTOR_OWNER}:${COLLECTOR_SCRIPT_VERSION}:${started}:${deadline}:${++sequence}`;leaseRoot.setAttribute(LEASE_ATTRIBUTE,lease);
  const assertActive=()=>{if(!isCurrent()||document.documentElement!==leaseRoot||leaseRoot.getAttribute(LEASE_ATTRIBUTE)!==lease)throw Error('수집기가 교체되어 이전 수집을 중단했습니다. 현재 수집기에서 다시 확인해주세요.');if(Date.now()>=deadline)throw Error('수집 확인 시간이 60초를 초과했습니다. 자동으로 다시 수집하지 않았습니다. 앱 저장본을 확인한 뒤 다시 눌러주세요.');};
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
    const observed=await hydratePageForCapture(document,window,{assertCurrent:()=>{assertActive();if(pageSourceUrl(location.href).sourceUrl!==before)throw Error('상품 페이지가 변경되었습니다. 다시 수집해주세요.');},observe:checked=>{
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
   const result=await chrome.runtime.sendMessage({type:'YOOFAM_SAVE_PAGE_SOURCE',snapshot});
   assertActive();
   if(result?.ok!==true)throw Error(result?.error||'수집 결과를 확인하지 못했습니다. 다시 누르면 저장 결과를 확인합니다.');
   const deliveryMessage=typeof result.message==='string'&&result.message.trim()?result.message:'앱의 저장 확인 응답을 받지 못했습니다.';
   if(pageSourceUrl(location.href).sourceUrl!==before){
    retrySnapshot=null;const previous=result.delivered===true?'이전 상품은 앱 수집함에 저장되었습니다.':result.delivered===false?'이전 상품은 확장에 보관했습니다. '+deliveryMessage:'이전 상품의 앱 저장 결과를 확인하지 못했습니다.';
    throw Error(previous+' 상품 페이지가 변경되어 현재 상품은 아직 수집하지 않았습니다. 상품 수집 버튼을 다시 눌러주세요.');
   }
   if(result.delivered===true){
    const receiptSummary=storedReceiptSummary(result,snapshot),savedDetail=receiptSummary??'서버 수집본 상세 미확인. 앱 목록에서 저장본을 확인해주세요.';
    retrySnapshot=null;
    if(result.pendingSnapshotReplayed===true&&result.newCaptureStored===false){showStatus('이전에 전송 확인을 받지 못한 수집본의 저장을 확인했습니다. 방금 읽은 새 상품정보는 아직 저장하지 않았습니다. ‘현재 상품 다시 수집’을 한 번 눌러 새 수집본으로 보관하세요. 기존 작업과 이전 검토값은 유지됩니다. '+savedDetail);button.textContent='현재 상품 다시 수집';}
    else{showStatus((receiptSummary?(result.duplicate===true?'이미 수집함에 담긴 원문과 검토 내용을 유지했습니다. ':'YOOFAM 스튜디오 AI상품등록 목록에 담았습니다. 앱에서 카테고리를 선택하고 초안을 작성하세요. '):'앱 저장 확인 응답을 받았습니다. ')+savedDetail+' '+(receiptSummary?'':'현재 페이지 읽기 결과 · 서버 저장본의 항목 수는 미확인. ')+captureSummary(snapshot)+' '+captureDiagnosticSummary(snapshot));button.textContent='수집 완료';}
   }else if(result.delivered===false){
    // Keep the first click's payload even if the visible page data changes.
    retrySnapshot=snapshot;showStatus((result.pendingSnapshotReplayed===true&&result.newCaptureStored===false?'이전에 보관한 수집본의 전송 확인을 다시 기다리고 있습니다. 방금 읽은 새 상품정보는 아직 저장하지 않았습니다. ':'확장에 보관했습니다. 앱 수집함의 저장을 확인하지 못했습니다. ')+deliveryMessage+' 같은 창의 YOOFAM 앱에서 상태를 확인한 뒤 이 버튼으로 다시 시도하거나 수집함에서 불러오세요.');button.textContent='앱 전송 다시 시도';
   }else throw Error('앱 수집함의 저장 결과를 확인하지 못했습니다. 다시 누르면 저장 결과를 확인합니다.');
  }catch(error){if(isCurrent()){showStatus(error?.message||'상품 수집 실패');button.textContent=retrySnapshot?'앱 전송 다시 시도':'YOOFAM 스튜디오 상품 수집';}}
  finally{if(leaseRoot.getAttribute(LEASE_ATTRIBUTE)===lease)leaseRoot.removeAttribute(LEASE_ATTRIBUTE);pending=false;if(isCurrent())button.disabled=false;}
 });
}
if(window===window.top)installPageCollector();
