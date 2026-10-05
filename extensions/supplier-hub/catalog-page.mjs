/** Read-only official category API observed in public /sr frontend 2026-10-02. */
export async function readSupplierHubCategoryBranch(trail,company){
  const origin='https://supplier.coupang.com';
  const allowedPage=()=>['/dashboard/KR','/qvt/registration','/qvt/wims','/sr/registration'].includes(location.pathname)||/^\/sr\/registration\/step\/(startPage|productPage|imagePage|legalPage|logisticsPage)$/.test(location.pathname);
  if(location.origin!==origin||!allowedPage())throw Error('Supplier Hub 등록 또는 견적 조회 화면에서 카테고리를 읽어주세요.');
  if(!company||!Object.hasOwn({A01526306:'유앤채',A01464742:'와이홉'},company.code)||({A01526306:'유앤채',A01464742:'와이홉'})[company.code]!==company.name)throw Error('승인된 회사정보가 필요합니다.');
  if(!Array.isArray(trail)||trail.length>10||trail.some(node=>!node||typeof node.categoryId!=='string'||!/^[1-9]\d{0,19}$/.test(node.categoryId)||typeof node.name!=='string'||!node.name.trim()||node.name!==node.name.trim()||node.name.length>240||node.isLeaf!==false)
    ||new Set(trail.map(node=>node.categoryId)).size!==trail.length)throw Error('카테고리 상위 경로를 확인해주세요.');
  const checkCompany=()=>{
    if(location.origin!==origin||!allowedPage())throw Error('Supplier Hub 화면이 변경되었습니다.');
    const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
    if(codes.length!==1||codes[0]!==company.code)throw Error('카테고리 조회 중 Supplier Hub 회사코드가 변경되었습니다.');
  };
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
    let children=[];
    // Verify every ancestor with the API rather than trusting a client breadcrumb.
    for(let depth=0;depth<=trail.length;depth++){
      checkCompany();
      const parent=depth?trail[depth-1].categoryId:null;
      const path=parent?`/sr/category/api/find-by-parent-category-code?categoryCode=${parent}`:'/sr/category/api/';
      const response=await fetch(origin+path,{method:'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal});
      if(!response.ok||response.redirected||response.url!==origin+path||!/\bapplication\/json\b/i.test(response.headers.get('content-type')||''))throw Error('Supplier Hub 카테고리 응답을 확인하지 못했습니다.');
      const reader=response.body?.getReader();if(!reader)throw Error('카테고리 목록을 읽지 못했습니다.');
      const parts=[];let total=0;
      try{for(;;){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>512*1024)throw Error('카테고리 목록이 허용 크기를 초과했습니다.');parts.push(part.value);}}
      finally{await reader.cancel();}
      const data=new Uint8Array(total);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.byteLength;}
      let raw;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));}catch{throw Error('카테고리 목록 형식이 올바르지 않습니다.');}
      if(!Array.isArray(raw)||raw.length>1000)throw Error('카테고리 목록 형식이 올바르지 않습니다.');
      const seen=new Set();
      children=raw.map(node=>{
        const dto=node?.displayItemCategoryDto,value=dto?.displayItemCategoryCode;
        const categoryId=typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):value;
        if(typeof categoryId!=='string'||!/^[1-9]\d{0,19}$/.test(categoryId)||seen.has(categoryId)
          ||typeof dto?.name!=='string'||!dto.name.trim()||dto.name.length>240||/[\u0000-\u001f\u007f]/.test(dto.name)||typeof node.leaf!=='boolean')throw Error('카테고리 이름·코드·최종 분류 여부를 확인하지 못했습니다.');
        seen.add(categoryId);return {categoryId,name:dto.name.trim(),isLeaf:node.leaf};
      });
      checkCompany();if(controller.signal.aborted)throw Error('카테고리 조회 시간이 초과됐습니다.');
      if(depth<trail.length){const expected=trail[depth],found=children.find(node=>node.categoryId===expected.categoryId);
        if(!found||found.name!==expected.name||found.isLeaf)throw Error('Supplier Hub의 실제 상위 분류와 선택 경로가 다릅니다.');}
    }
    if(!children.length)throw Error('하위 카테고리 목록이 없습니다. 상위 분류를 다시 확인해주세요.');
    return {trail:trail.map(node=>({...node})),children,company:{...company},observedAt:Date.now(),source:'supplier-hub-category-api',fullCatalogVerified:false};
  }finally{clearTimeout(timer);}
}
