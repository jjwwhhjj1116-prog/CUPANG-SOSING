// Serialized by chrome.scripting; keep this function self-contained.
// Select by observed visible section wording, never private application state.
export function attachToSupplierHub(payload) {
  if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/qvt/registration')throw Error('현재 Supplier Hub 대량 상품 등록 탭에서 실행해주세요.');
  const definitions=[['quotation','작성이 완료된 견적서 Excel 파일을 업로드하십시오.'],['productImages','상품 이미지를 업로드하십시오.'],['labelImages','제품 필수 표시사항을 업로드하십시오.']];
  const all=Array.from(document.querySelectorAll('input[type="file"]'));
  const targets=definitions.map(([key,title])=>{
    const candidates=all.filter(input=>{
      let section=input.parentElement;
      for(let depth=0;section&&depth<12;depth++,section=section.parentElement){
        if(section.querySelectorAll('input[type="file"]').length!==1)return false;
        if((section.innerText||'').includes(title))return true;
      }return false;
    });
    if(candidates.length!==1)throw Error('Supplier Hub 업로드 구역이 바뀌었습니다. 파일은 전달하지 않았습니다.');
    const input=candidates[0];
    if(input.disabled||input.closest('[aria-disabled="true"]'))throw Error('파일 첨부가 비활성화되어 있습니다.');
    return {key,input};
  });
  // A pristine form only: avoid replacing files of a user's work in progress.
  if(document.documentElement.dataset.yoofamAttachmentAttempt||all.some(input=>input.files?.length)||document.body.innerText.match(/[^\s<>]+\.(?:xlsx|xls|csv|tsv|jpe?g|png|webp|gif|avif|pdf)\b/i))throw Error('이미 파일이 있거나 전달을 시도한 등록 화면입니다. 기존 작업 보호를 위해 중단했습니다.');
  if(new Set(targets.map(t=>t.input)).size!==3)throw Error('업로드 구역이 중복됩니다.');
  // Decode every group before any change event can start a remote upload.
  const prepared=targets.map(({key,input})=>{
    const entries=payload?.[key];if(!Array.isArray(entries)||entries.length>200||(key==='quotation'&&entries.length!==1))throw Error('첨부 파일 목록을 확인해주세요.');
    const transfer=new DataTransfer();
    for(const entry of entries){
      if(!entry||typeof entry.base64!=='string'||!/^[A-Za-z0-9_-][A-Za-z0-9._-]*\.(xlsx|png|jpg|jpeg|webp|gif|avif)$/i.test(entry.name))throw Error('첨부 파일명을 확인해주세요.');
      const bytes=Uint8Array.from(atob(entry.base64),c=>c.charCodeAt(0));
      const types={xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',avif:'image/avif'};
      transfer.items.add(new File([bytes],entry.name,{type:types[entry.name.split('.').at(-1).toLowerCase()]}));
    }
    return {key,input,transfer};
  });
  const dispatched=[];
  document.documentElement.dataset.yoofamAttachmentAttempt='started';
  try{
    for(const {key,input,transfer} of prepared){
      if(!transfer.files.length)continue;
      if(!input.isConnected||input.disabled)throw Error('파일 전달 중 등록 화면이 변경되었습니다.');
      input.files=transfer.files;
      input.dispatchEvent(new Event('change',{bubbles:true}));
      dispatched.push({group:key,count:transfer.files.length});
    }
    document.documentElement.dataset.yoofamAttachmentAttempt=JSON.stringify({state:'dispatched',files:prepared.flatMap(({transfer})=>Array.from(transfer.files,file=>file.name))});
    return {state:'dispatched',dispatched,registered:false};
  }catch(error){return {state:'partial',dispatched,registered:false,error:String(error?.message||error)};}
}
