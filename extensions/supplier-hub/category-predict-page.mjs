/** Read the official recommendation endpoint without changing registration forms. */
export async function getRecommendations(productName,company){
  const origin='https://supplier.coupang.com';
  const allowedPage=()=>['/dashboard/KR','/qvt/registration','/qvt/wims','/sr/registration'].includes(location.pathname)||/^\/sr\/registration\/step\/(startPage|productPage|imagePage|legalPage|logisticsPage)$/.test(location.pathname);
  const companies={A01526306:'유앤채',A01464742:'와이홉'};
  if(typeof productName!=='string'||!productName.trim()||productName!==productName.trim()||productName.length>500||/[\u0000-\u001f\u007f]/.test(productName))throw Error('추천할 상품명을 확인해주세요.');
  if(!company||!Object.hasOwn(companies,company.code)||companies[company.code]!==company.name)throw Error('승인된 회사정보가 필요합니다.');
  if(location.origin!==origin||!allowedPage())throw Error('Supplier Hub 등록 또는 견적 조회 화면에서 카테고리를 추천해주세요.');
  const initialDocument=document,initialHref=location.href;
  const checkCompany=()=>{
    if(document!==initialDocument||location.href!==initialHref||location.origin!==origin||!allowedPage())throw Error('추천 조회 중 Supplier Hub 화면이 변경되었습니다.');
    const codes=Array.from((document.body?.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
    if(codes.length!==1||codes[0]!==company.code)throw Error('추천 조회 중 Supplier Hub 회사코드가 변경되었습니다.');
  };
  checkCompany();
  const url=origin+'/sr/category/api/predict?productName='+encodeURIComponent(productName);
  const controller=new AbortController();let reader,timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('카테고리 추천 조회 시간이 초과됐습니다.'));},14000);});
  try{
    const read=async()=>{
      const response=await fetch(url,{method:'GET',credentials:'include',redirect:'error',cache:'no-store',signal:controller.signal});
      checkCompany();
      if(!response.ok||response.redirected||response.url!==url||!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type')||''))throw Error('Supplier Hub 카테고리 추천 응답을 확인하지 못했습니다.');
      const contentLength=response.headers.get('content-length');
      if(contentLength!==null&&(!/^\d+$/.test(contentLength)||Number(contentLength)>512*1024))throw Error('카테고리 추천 응답이 허용 크기를 초과했습니다.');
      reader=response.body?.getReader();if(!reader)throw Error('카테고리 추천 목록을 읽지 못했습니다.');
      const parts=[];let size=0;
      for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>512*1024)throw Error('카테고리 추천 응답이 허용 크기를 초과했습니다.');parts.push(part.value);}
      checkCompany();if(controller.signal.aborted)throw Error('카테고리 추천 조회 시간이 초과됐습니다.');
      const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
      let rows;try{rows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('카테고리 추천 응답 JSON 형식이 올바르지 않습니다.');}
      if(!Array.isArray(rows)||rows.length>1000)throw Error('카테고리 추천 목록 형식이 올바르지 않습니다.');
      const ids=new Set(),codes=new Set();
      const items=rows.slice(0,3).map(row=>{
        if(!row||typeof row!=='object'||Array.isArray(row))throw Error('카테고리 추천 항목을 확인하지 못했습니다.');
        const id=typeof row.internalCategoryId==='number'&&Number.isSafeInteger(row.internalCategoryId)&&row.internalCategoryId>0?String(row.internalCategoryId):row.internalCategoryId;
        const code=typeof row.internalCategoryCode==='number'&&Number.isSafeInteger(row.internalCategoryCode)&&row.internalCategoryCode>0?String(row.internalCategoryCode):row.internalCategoryCode;
        if(row.fullPathName!==undefined&&row.fullPathName!==null&&typeof row.fullPathName!=='string')throw Error('추천 카테고리의 전체 경로 형식을 확인하지 못했습니다.');
        const fullPath=typeof row.fullPathName==='string'&&row.fullPathName.trim()?row.fullPathName:row.name;
        if(typeof id!=='string'||!id.trim()||id!==id.trim()||id.length>100||/[\u0000-\u001f\u007f]/.test(id)||ids.has(id)
          ||typeof code!=='string'||!/^[1-9]\d{0,19}$/.test(code)||codes.has(code)||typeof fullPath!=='string'||!fullPath.trim()||/[\u0000-\u001f\u007f]/.test(fullPath))throw Error('추천 카테고리의 코드·경로를 확인하지 못했습니다.');
        const path=fullPath.split('>').map(name=>name.trim());
        if(path.length<1||path.length>10||path.some(name=>!name||name.length>240))throw Error('추천 카테고리의 전체 경로를 확인하지 못했습니다.');
        ids.add(id);codes.add(code);return {id,code,path,label:path.join(' > ')};
      });
      checkCompany();if(controller.signal.aborted)throw Error('카테고리 추천 조회 시간이 초과됐습니다.');
      return {source:'supplier-hub-category-predict-api',company:{code:company.code,name:company.name},productName,observedAt:Date.now(),items};
    };
    return await Promise.race([read(),timeout]);
  }finally{
    clearTimeout(timer);controller.abort();if(reader)void Promise.resolve(reader.cancel()).catch(()=>{});
  }
}
