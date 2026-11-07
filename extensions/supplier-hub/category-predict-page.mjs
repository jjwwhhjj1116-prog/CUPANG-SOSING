/** Read the official category lookup without changing registration forms. */
export async function getRecommendations(productName,company,search=false){
  const origin='https://supplier.coupang.com';
  const allowedPage=()=>['/dashboard/KR','/qvt/registration','/qvt/wims','/sr/registration'].includes(location.pathname)||/^\/sr\/registration\/step\/(startPage|productPage|imagePage|legalPage|logisticsPage)$/.test(location.pathname);
  const companies={A01526306:'유앤채',A01464742:'와이홉'};
  const action=search?'이름 검색':'추천';
  if(typeof productName!=='string'||!productName.trim()||productName!==productName.trim()||productName.length>(search?120:500)||/[\u0000-\u001f\u007f]/.test(productName))throw Error(search?'검색할 카테고리 이름을 확인해주세요.':'추천할 상품명을 확인해주세요.');
  if(!company||!Object.hasOwn(companies,company.code)||companies[company.code]!==company.name)throw Error('승인된 회사정보가 필요합니다.');
  if(location.origin!==origin||!allowedPage())throw Error('Supplier Hub 등록 또는 견적 조회 화면을 열고 카테고리를 다시 조회해주세요.');
  const initialDocument=document,initialHref=location.href;
  const checkCompany=()=>{
    if(document!==initialDocument||location.href!==initialHref||location.origin!==origin||!allowedPage())throw Error(`카테고리 ${action} 중 Supplier Hub 화면이 변경되었습니다.`);
    const codes=Array.from((document.body?.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
    if(codes.length!==1||codes[0]!==company.code)throw Error(`카테고리 ${action} 중 Supplier Hub 회사코드가 변경되었습니다.`);
  };
  checkCompany();
  const url=origin+(search?'/sr/category/api/find-by-keyword?keyword=':'/sr/category/api/predict?productName=')+encodeURIComponent(productName);
  const controller=new AbortController();let reader,timer;
  const timeoutMessage=`카테고리 ${action} 조회 시간이 초과됐습니다.`;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error(timeoutMessage));},14000);});
  try{
    const read=async()=>{
      const response=await fetch(url,{method:'GET',credentials:'include',redirect:'error',cache:'no-store',signal:controller.signal,
        ...(search?{headers:{accept:'application/json, text/plain, */*'}}:{})});
      checkCompany();
      if(!response.ok||response.redirected||response.url!==url||!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type')||''))throw Error(`Supplier Hub 카테고리 ${action} 응답을 확인하지 못했습니다.`);
      const contentLength=response.headers.get('content-length');
      if(contentLength!==null&&(!/^\d+$/.test(contentLength)||Number(contentLength)>512*1024))throw Error('카테고리 추천 응답이 허용 크기를 초과했습니다.');
      reader=response.body?.getReader();if(!reader)throw Error('카테고리 추천 목록을 읽지 못했습니다.');
      const parts=[];let size=0;
      for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>512*1024)throw Error('카테고리 추천 응답이 허용 크기를 초과했습니다.');parts.push(part.value);}
      checkCompany();if(controller.signal.aborted)throw Error(timeoutMessage);
      const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
      let rows;try{rows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('카테고리 추천 응답 JSON 형식이 올바르지 않습니다.');}
      if(!Array.isArray(rows)||rows.length>1000)throw Error('카테고리 추천 목록 형식이 올바르지 않습니다.');
      const ids=new Set(),codes=new Set();
      const candidates=search?rows.filter(row=>{
        if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.leafCategory!=='boolean')throw Error('검색한 카테고리의 최종 분류 여부를 확인하지 못했습니다.');
        return row.leafCategory;
      }):rows.slice(0,3);
      const items=candidates.map(row=>{
        if(!row||typeof row!=='object'||Array.isArray(row))throw Error('카테고리 추천 항목을 확인하지 못했습니다.');
        const code=typeof row.internalCategoryCode==='number'&&Number.isSafeInteger(row.internalCategoryCode)&&row.internalCategoryCode>0?String(row.internalCategoryCode):row.internalCategoryCode;
        const id=search?code:typeof row.internalCategoryId==='number'&&Number.isSafeInteger(row.internalCategoryId)&&row.internalCategoryId>0?String(row.internalCategoryId):row.internalCategoryId;
        if(row.fullPathName!==undefined&&row.fullPathName!==null&&typeof row.fullPathName!=='string')throw Error('추천 카테고리의 전체 경로 형식을 확인하지 못했습니다.');
        const fullPath=search||typeof row.fullPathName==='string'&&row.fullPathName.trim()?row.fullPathName:row.name;
        if(typeof id!=='string'||!id.trim()||id!==id.trim()||id.length>100||/[\u0000-\u001f\u007f]/.test(id)||ids.has(id)
          ||typeof code!=='string'||!/^[1-9]\d{0,19}$/.test(code)||codes.has(code)||typeof fullPath!=='string'||!fullPath.trim()||/[\u0000-\u001f\u007f]/.test(fullPath))throw Error('추천 카테고리의 코드·경로를 확인하지 못했습니다.');
        const parsed=fullPath.split('>').map(name=>name.trim());
        const parents=search&&Array.isArray(row.parentList)&&row.parentList.length?row.parentList.map(parent=>parent?.name):null;
        const structured=parents?[...parents,row.name]:null;
        const normalizeSeparators=value=>value.trim().replace(/\s*([>\/])\s*/g,'$1');
        const path=structured&&structured.every(name=>typeof name==='string'&&name===name.trim()&&name)
          &&['>', '/'].some(separator=>normalizeSeparators(structured.join(separator))===normalizeSeparators(fullPath))?structured:parsed;
        if(search&&typeof row.name==='string'&&path.at(-1)!==row.name.trim())throw Error('검색한 최종 카테고리의 이름과 전체 경로가 다릅니다.');
        if(path.length<1||path.length>10||path.some(name=>!name||name.length>240))throw Error('추천 카테고리의 전체 경로를 확인하지 못했습니다.');
        ids.add(id);codes.add(code);return {id,code,path,label:path.join(' > ')};
      });
      checkCompany();if(controller.signal.aborted)throw Error(timeoutMessage);
      const identity=search?{source:'supplier-hub-category-keyword-api',keyword:productName}:{source:'supplier-hub-category-predict-api',productName};
      return {...identity,company:{code:company.code,name:company.name},observedAt:Date.now(),items};
    };
    return await Promise.race([read(),timeout]);
  }finally{
    clearTimeout(timer);controller.abort();if(reader)void Promise.resolve(reader.cancel()).catch(()=>{});
  }
}
