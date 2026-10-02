/** Public QVT CategoryDownloader contract. Fetches a blank workbook only; never submits a quotation. */
export async function readSupplierHubTemplate(snapshot){
 const origin='https://supplier.coupang.com',company=snapshot?.company,meta=snapshot?.metadata;
 const kan=String(meta?.kanCategoryId??meta?.categoryId??'');
 if(snapshot?.format!=='supplier-hub-schema-v1'||!/^[1-9]\d{0,19}$/.test(snapshot.categoryId||'')||!/^[1-9]\d{0,19}$/.test(kan)
  ||meta?.kanCategoryId!==undefined&&meta?.categoryId!==undefined&&String(meta.kanCategoryId)!==String(meta.categoryId)
  ||!company||!Object.hasOwn({A01464742:'와이홉',A01526306:'유앤채'},company.code)||({A01464742:'와이홉',A01526306:'유앤채'})[company.code]!==company.name)throw Error('상세 양식에서 공식 Excel의 칸 카테고리 코드를 확인하지 못했습니다.');
 const check=()=>{
  if(location.origin!==origin||!(['/qvt/registration','/qvt/wims','/sr/registration'].includes(location.pathname)||/^\/sr\/registration\/step\/(startPage|productPage|imagePage|legalPage|logisticsPage)$/.test(location.pathname)))throw Error('공식 양식을 읽는 Supplier Hub 화면이 변경되었습니다.');
  const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
  if(codes.length!==1||codes[0]!==company.code)throw Error('공식 양식을 읽는 회사코드가 다릅니다.');
 };
 check();const url=`${origin}/qvt/v3/kan-categories/download-quotation?leafKanCategoryIds=${kan}&locale=ko`;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35000);
 try{
  const response=await fetch(url,{method:'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal});
  if(!response.ok||response.redirected||response.url!==url||!/^application\/(?:vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|octet-stream)(?:;|$)/i.test(response.headers.get('content-type')||''))throw Error('선택한 카테고리의 공식 Excel을 읽지 못했습니다.');
  const declared=response.headers.get('content-length');if(declared&&/^\d+$/.test(declared)&&Number(declared)>5000000)throw Error('공식 Excel은 5MB 이하만 지원합니다.');
  const reader=response.body?.getReader();if(!reader)throw Error('공식 Excel 응답이 없습니다.');
  const parts=[];let size=0;try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>5000000)throw Error('공식 Excel은 5MB 이하만 지원합니다.');parts.push(part.value);}}finally{await reader.cancel();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  if(size<22||bytes[0]!==80||bytes[1]!==75||bytes[2]!==3||bytes[3]!==4)throw Error('다운로드 응답이 Excel 원본이 아닙니다.');
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  check();if(controller.signal.aborted)throw Error('공식 Excel 조회 시간이 초과됐습니다.');
  return {format:'supplier-hub-template-v1',categoryId:snapshot.categoryId,categoryPath:[...snapshot.categoryPath],company:{code:company.code,name:company.name},kanCategoryId:kan,
   sourceUrl:url,observedAt:Date.now(),name:`SupplierHub-${company.code}-Kan${kan}.xlsx`,sha256,size,base64:btoa(binary),registered:false};
 }finally{clearTimeout(timer);}
}
