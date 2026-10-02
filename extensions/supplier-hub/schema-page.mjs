/** Read-only schema GET contract in the public Supplier Hub frontend. */
export async function readSupplierHubSchema(categoryId,categoryPath,company){
 const origin='https://supplier.coupang.com',allowed=()=>['/qvt/registration','/qvt/wims','/sr/registration'].includes(location.pathname)||/^\/sr\/registration\/step\/(startPage|productPage|imagePage|legalPage|logisticsPage)$/.test(location.pathname);
 if(typeof categoryId!=='string'||!/^[1-9]\d{0,19}$/.test(categoryId)||!Array.isArray(categoryPath)||!categoryPath.length||categoryPath.length>10||categoryPath.some(name=>typeof name!=='string'||!name.trim()||name!==name.trim()||name.length>120))throw Error('상세 양식의 최종 분류를 확인해주세요.');
 if(!company||!Object.hasOwn({A01464742:'와이홉',A01526306:'유앤채'},company.code)||({A01464742:'와이홉',A01526306:'유앤채'})[company.code]!==company.name)throw Error('승인된 회사정보가 필요합니다.');
 const check=()=>{if(location.origin!==origin||!allowed())throw Error('상세 양식을 읽는 Supplier Hub 화면이 변경되었습니다.');const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);if(codes.length!==1||codes[0]!==company.code)throw Error('상세 양식을 읽는 회사코드가 다릅니다.');};
 check();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{
  const url=`${origin}/sr/schema/api/get-default-schemaform?internalDisplayCode=${categoryId}&useCustomizedJsonSchema=true`;
  const response=await fetch(url,{method:'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal});
  if(!response.ok||response.redirected||response.url!==url||!/\bapplication\/json\b/i.test(response.headers.get('content-type')||''))throw Error('카테고리 상세 양식을 읽지 못했습니다.');
  const reader=response.body?.getReader();if(!reader)throw Error('상세 양식 응답이 없습니다.');
  const parts=[];let size=0;try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>512*1024)throw Error('상세 양식 응답이 너무 큽니다.');parts.push(part.value);}}finally{await reader.cancel();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('상세 양식 응답 형식이 올바르지 않습니다.');}
  if(!data||typeof data.schemaString!=='string'||!data.schemaString.length||new TextEncoder().encode(data.schemaString).length>200000)throw Error('상세 양식 원문이 없거나 저장 한도를 초과했습니다.');
  let schema;try{schema=JSON.parse(data.schemaString);}catch{throw Error('상세 양식 JSON을 확인하지 못했습니다.');}
  if(!schema?.properties?.productPage||!schema?.properties?.legalPage)throw Error('상품·법적 정보 상세 양식이 없습니다.');
  const metadata={};for(const key of ['categoryId','kanCategoryId','displayCategoryCode','scope','scopeType','noticeNumber','productNoticeNumber','version']){
   const value=data[key];if(value===undefined||value===null)continue;
   if(!(typeof value==='string'&&value.length<=500&&!/[\u0000-\u001f]/.test(value)||typeof value==='number'&&Number.isSafeInteger(value)&&value>=0))throw Error('상세 양식 분류·버전정보가 올바르지 않습니다.');metadata[key]=value;
  }
  if(metadata.displayCategoryCode!==undefined&&String(metadata.displayCategoryCode)!==categoryId)throw Error('상세 양식 표시코드가 선택한 카테고리와 다릅니다.');
  check();if(controller.signal.aborted)throw Error('상세 양식 조회 시간이 초과됐습니다.');
  return {format:'supplier-hub-schema-v1',categoryId,categoryPath:[...categoryPath],company:{...company},observedAt:Date.now(),schemaString:data.schemaString,metadata};
 }finally{clearTimeout(timer);}
}
