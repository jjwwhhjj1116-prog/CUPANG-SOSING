// Serialized into a new, app-owned WIMS tab. All requests are read-only queries.
// Current QVT bundle: vendorSearch [357143,358300), response reducer [4216760,4217140),
// request/quotation distinction [3701260,3702400), dates [371511,371800).
export async function querySupplierHubNativeRegistrations(scope){
 const origin='https://supplier.coupang.com',companies={A01526306:'유앤채',A01464742:'와이홉'},hash=/^[a-f0-9]{64}$/;
 const identifier=value=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=200&&!/[\u0000-\u001f]|\.\.\.|…/.test(value)||Number.isSafeInteger(value)&&value>0;
 const check=()=>{const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);if(location.origin!==origin||location.pathname!=='/qvt/wims'||codes.length!==1||codes[0]!==scope?.company?.code||companies[codes[0]]!==scope.company.name)throw Error('등록 파일 조회 중 Supplier Hub 회사·화면이 변경되었습니다.');};
 if(!scope||!identifier(scope.qvtRequestId)||!identifier(scope.docId)||!hash.test(scope.identityDigest||'')||!hash.test(scope.preparedBodySha256||'')
  ||!Number.isSafeInteger(scope.membersCount)||scope.membersCount<1||scope.membersCount>200||!Number.isSafeInteger(scope.receiptObservedAt)||scope.receiptObservedAt<1||scope.receiptObservedAt>Date.now()+5000
  ||typeof scope.sourceProductVersion!=='string'||!Number.isFinite(Date.parse(scope.sourceProductVersion))||Date.parse(scope.sourceProductVersion)>scope.receiptObservedAt)throw Error('원래 문서의 등록 파일 조회 범위를 확인해주세요.');
 check();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000),limit=4*1024*1024;
 const read=async(path,body)=>{check();const url=origin+path,response=await fetch(url,{method:body===undefined?'GET':'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal,
  headers:{accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const contentType=response.headers.get('content-type')||'',vendor=path==='/qvt/vendor/id';
  if(!response.ok||response.status!==200||response.redirected||response.url!==url||!(vendor?/^(?:application\/json|text\/plain)(?:\s*;[^\r\n]*)?$/i:/^application\/json(?:\s*;[^\r\n]*)?$/i).test(contentType))throw Error('공식 등록 파일 조회의 JSON 응답을 확인하지 못했습니다.');
  const size=response.headers.get('content-length');if(size!==null&&(!/^\d+$/.test(size)||Number(size)>limit))throw Error('등록 파일 조회 응답이 너무 큽니다.');
  let text='';if(response.body?.getReader){const reader=response.body.getReader(),chunks=[];let bytes=0;try{for(;;){const item=await reader.read();if(item.done)break;bytes+=item.value.byteLength;if(bytes>limit)throw Error('등록 파일 조회 응답이 너무 큽니다.');chunks.push(item.value);}const joined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}text=new TextDecoder('utf-8',{fatal:true}).decode(joined);}finally{reader.releaseLock();}}
  else{text=await response.text();if(new TextEncoder().encode(text).length>limit)throw Error('등록 파일 조회 응답이 너무 큽니다.');}
  if(controller.signal.aborted)throw Error('등록 파일 조회 시간이 초과됐습니다.');check();
  // Browser-visible vendor text was observed. Header/raw serialization was not:
  // support only the same literal code, plain or JSON-string, never HTML/object.
  if(vendor){if(text.length>64)throw Error('현재 공급사 ID 응답 형식이 다릅니다.');if(text===scope.company.code)return text;const value=JSON.parse(text);if(value!==scope.company.code)throw Error('현재 공급사 ID와 승인 회사코드가 다릅니다.');return value;}
  return JSON.parse(text);
 };
 try{
  // This official GET returns the active vendor company code, not credentials.
  if(await read('/qvt/vendor/id')!==scope.company.code)throw Error('현재 공급사 ID와 승인 회사코드가 다릅니다.');
  const day=value=>new Date(value+9*60*60*1000).toISOString().slice(0,10),start=Date.parse(day(Date.parse(scope.sourceProductVersion))+'T00:00:00+09:00'),end=Date.parse(day(Date.now())+'T23:59:59+09:00');
  if(!Number.isFinite(start)||!Number.isFinite(end)||start>end)throw Error('원래 접수의 등록일 조회 범위를 확인해주세요.');
  const rows=[],seen=new Set(),seenRows=new Set(),knownStates=['INSPECTION','INSPECTION_COMPLETE','REJECTION'];let total=null,processed=0,pagesRead=0;
  const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  for(let page=1;page<=40;page++){
   const response=await read('/qvt/v2/wims/vendorSearch',{startDate:String(start),endDate:String(end),conditions:{vendorId:scope.company.code,state:'',skuId:'',sourcingChannelId:'',quotationId:'',estimationId:'',progress:'',productName:'',categoryCode:'',barcode:'',isReplyNeeded:false,imageAuthStatus:''},page,sizePerPage:50});
   const nav=response?.pageNavigator,items=response?.items;
   if(!response||typeof response!=='object'||Array.isArray(response)||!Array.isArray(items)||items.length>50||!nav||nav.currentPage!==page||nav.elementCountPerPage!==50||!Number.isSafeInteger(nav.totalElements)||nav.totalElements<0||nav.totalElements>2000||total!==null&&nav.totalElements!==total)throw Error('공식 등록 파일 조회의 페이지 형식·범위가 변경되었습니다.');
   total=nav.totalElements;processed+=items.length;pagesRead++;
   if(processed>total||items.length!==Math.min(50,total-(page-1)*50))throw Error('공식 등록 파일 조회의 페이지 결과가 누락·중복되었습니다.');
   for(const item of items){
    if(!item||typeof item!=='object'||Array.isArray(item))throw Error('공식 등록 파일 조회의 상품 행 형식이 변경되었습니다.');
    // Every queried row participates in coverage, including other requests.
    // A repeated non-target row can hide the target on a stale next page.
    const nativeId=Object.hasOwn(item,'uniqueItemId');if(nativeId&&!identifier(item.uniqueItemId))throw Error('공식 등록 파일 조회의 행 식별값을 확인하지 못했습니다.');
    const key=nativeId?'id:'+canonical([typeof item.uniqueItemId,item.uniqueItemId]):'row:'+canonical(item);
    if(seenRows.has(key))throw Error('공식 등록 파일 조회의 행이 페이지 사이에서 중복되었습니다. 전체 결과를 확인하지 못했습니다.');seenRows.add(key);
    if(item.qvtRequestId!==scope.qvtRequestId)continue;
    if(item.scope!=='SIMPLE_REGISTRATION'||typeof item.quotationId!=='string'||!/^CID-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(item.quotationId)||typeof item.productName!=='string'||!item.productName||item.productName!==item.productName.trim()||/[\u0000-\u001f]/.test(item.productName)||item.productName.length>2000||!knownStates.includes(item.state)
     ||item.skuId!==null&&(typeof item.skuId!=='string'||!/^[1-9]\d{0,29}$/.test(item.skuId)))throw Error('같은 등록 파일의 견적서·SKU·상태 원문 형식을 확인하지 못했습니다.');
    const quotationId=item.quotationId.slice(4),skuId=item.skuId;
    if(skuId!==null&&seen.has(skuId))throw Error('같은 등록 파일에서 SKU ID가 중복되었습니다.');if(skuId!==null)seen.add(skuId);
    rows.push({quotationId,skuId,productName:item.productName,status:item.state});if(rows.length>scope.membersCount)throw Error('등록 파일의 상품 수가 원래 포함 옵션 수보다 많습니다.');
   }
   if(processed===total)break;
  }
  if(processed!==total)throw Error('등록 파일의 전체 조회 페이지를 확인하지 못했습니다.');
  if(await read('/qvt/vendor/id')!==scope.company.code)throw Error('조회 중 현재 공급사 ID가 변경되었습니다.');check();
  return {source:'supplier-hub-native-registration-v1',ownerId:scope.ownerId,company:{...scope.company},productId:scope.productId,requestId:scope.requestId,docId:scope.docId,qvtRequestId:scope.qvtRequestId,
   categoryId:scope.categoryId,identityDigest:scope.identityDigest,preparedBodySha256:scope.preparedBodySha256,membersCount:scope.membersCount,observedAt:Date.now(),rows,total:rows.length,pagesRead,registered:false,mutated:false,optionMapping:'unverified'};
 }finally{clearTimeout(timer);}
}
