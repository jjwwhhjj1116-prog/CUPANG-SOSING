/** Serialize only into a trusted, same-window authenticated Hub document.
 * The caller must pin executeScript to browser.documentId and verify Chrome's
 * returned documentId. This reader has exactly one fixed GET and no DOM write,
 * record mutation, button click, file read, source compiler or submission path. */
export async function historicalProductReceiptReadPage(input){
  const anchor=input?.anchor,browser=input?.browser,target=anchor?.target,identity=anchor?.identity;
  const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
  const id=value=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=200&&!/[\u0000-\u001f]|\.\.\.|…/.test(value)||Number.isSafeInteger(value)&&value>0;
  const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
  const company={A01526306:'유앤채',A01464742:'와이홉'};
  if(!exact(input,['anchor','browser'])||anchor?.format!=='yoofam-historical-product-receipt-anchor-v1'||anchor.historicalRequestOnly!==true||anchor.currentBodyEqualityVerified!==false
    ||anchor.readOnly!==true||anchor.remoteWrites!==false||anchor.checkpointWrites!==false||anchor.canResume!==false||!identity||!target||!id(target.docId)||!id(target.qvtRequestId)
    ||!['identityDigest','packetDigest','originalBodySha256','preparedBodySha256'].every(key=>hash(anchor[key]))||!id(anchor.readId)
    ||!exact(browser,['tabId','windowId','documentId','selection','originalTabId','originalTabAbsent'])||!Number.isSafeInteger(browser.tabId)||browser.tabId<0||browser.windowId!==identity.windowId||typeof browser.documentId!=='string'||!browser.documentId||browser.documentId.length>200
    ||browser.originalTabId!==anchor.ownedTarget?.tabId||!(browser.selection==='original-owned-tab'&&browser.tabId===browser.originalTabId&&browser.originalTabAbsent===false||browser.selection==='existing-same-window-tab'&&browser.tabId!==browser.originalTabId&&browser.originalTabAbsent===true))
    throw Error('원래 문서의 읽기 전용 접수 범위를 확인해주세요.');
  const page=location.origin+location.pathname;
  const check=()=>{
    const codes=Array.from((document.body?.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
    const names=Array.from(document.querySelectorAll('button')).filter(node=>node.getClientRects().length&&!node.disabled&&(node.innerText||'').trim()===identity.company?.name);
    if(location.origin!=='https://supplier.coupang.com'||location.origin+location.pathname!==page
      ||!(['/dashboard/KR','/qvt/registration','/qvt/wims','/sr/registration'].includes(location.pathname)||/^\/sr\/registration\/step\/(startPage|productPage|imagePage|legalPage|logisticsPage)$/.test(location.pathname))
      ||codes.length!==1||names.length!==1||codes[0]!==identity.company?.code||company[codes[0]]!==identity.company?.name||target.company?.code!==codes[0]||target.company?.name!==company[codes[0]])
      throw Error('현재 Hub 회사·화면이 원래 요청과 다릅니다. 접수만 조회했습니다.');
  };
  check();
  const url='https://supplier.coupang.com/sr/draft/api/drafts/register-requested',controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(url,{method:'GET',cache:'no-store',credentials:'include',redirect:'error',signal:controller.signal});check();
    const contentType=response.headers.get('content-type')||'';
    if(response.ok!==true||response.status!==200||response.url!==url||response.redirected!==false||!/^application\/json(?:\s*;[^\r\n]*)?$/i.test(contentType.trim()))throw Error('공식 접수 JSON의 출처·응답을 확인하지 못했습니다.');
    const text=await response.text();check();if(controller.signal.aborted||text.length>6*1024*1024)throw Error('공식 접수 조회 시간이 만료되었거나 응답이 너무 큽니다.');
    let rows;try{rows=JSON.parse(text);}catch{throw Error('공식 접수 JSON을 확인하지 못했습니다.');}
    if(!Array.isArray(rows)||rows.length>10000||rows.some(row=>!object(row)||!id(row.docId))||new Set(rows.map(row=>String(row.docId))).size!==rows.length)throw Error('공식 접수 목록의 문서 식별값이 없거나 중복되었습니다.');
    const matches=rows.filter(row=>row.docId===target.docId),qvt=rows.filter(row=>row.qvtRequestId===target.qvtRequestId);
    if(matches.length!==1||qvt.length!==1||matches[0]!==qvt[0])throw Error('원래 문서번호와 정확한 QVT 접수의 유일한 연결을 확인하지 못했습니다.');
    const original=matches[0];
    if(!['SUBMITTED','FINISHED','REJECTED'].includes(original.status)||original.productName!==anchor.currentSource.productName||original.categoryPath!==anchor.currentSource.categoryPath)
      throw Error('원래 문서의 공식 접수 상태·상품명·카테고리를 확인하지 못했습니다.');
    const row={docId:original.docId,status:original.status,qvtRequestId:original.qvtRequestId,productName:original.productName,categoryPath:original.categoryPath,
      modifiedAt:original.modifiedAt??null,remark:original.remark??''};
    const observedAt=Date.now();check();
    return {format:'yoofam-historical-product-receipt-read-v1',readOnly:true,remoteWrites:false,row,
      provenance:{method:'GET',url,status:200,redirected:false,contentType,cache:'no-store',company:{code:identity.company.code,name:identity.company.name},docId:target.docId,qvtRequestId:target.qvtRequestId,
        identityDigest:anchor.identityDigest,packetDigest:anchor.packetDigest,requestId:target.requestId,tabId:browser.tabId,windowId:browser.windowId,documentId:browser.documentId,observedTab:{...browser},readId:anchor.readId,observedAt}};
  }finally{clearTimeout(timer);}
}
