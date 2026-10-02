// Serialized by chrome.scripting; keep this function self-contained.
// Select by observed visible section wording, never private application state.
export function attachToSupplierHub(payload,checkOnly=false) {
  if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/qvt/registration')throw Error('현재 Supplier Hub 대량 상품 등록 탭에서 실행해주세요.');
  const company=payload?.company;
  const companyCodes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
  if(!company||!Object.hasOwn({A01526306:'유앤채',A01464742:'와이홉'},company.code)||({A01526306:'유앤채',A01464742:'와이홉'})[company.code]!==company.name||companyCodes.length!==1||companyCodes[0]!==company.code)throw Error('회원 회사와 Supplier Hub 회사코드가 일치하지 않습니다.');
  const definitions=[['quotation','작성이 완료된 견적서 Excel 파일을 업로드하십시오.'],['productImages','상품 이미지를 업로드하십시오.'],['labelImages','제품 필수 표시사항을 업로드하십시오.']];
  const required=payload.legalDocumentsRequired===true;
  if(required&&(!Array.isArray(payload.legalDocuments)||!payload.legalDocuments.length)||!required&&payload.legalDocuments?.length)throw Error('법적 서류 해당 여부와 첨부 목록을 확인해주세요.');
  const legalArea=()=>{
    const choices=Array.from(document.querySelectorAll('input[type="radio"][id="undefined-Y"]')).filter(input=>Array.from(input.labels||[]).some(label=>(label.innerText||'').trim()==='해당함'));
    const found=[];
    for(const input of choices){let section=input.parentElement;for(let depth=0;section&&depth<8;depth++,section=section.parentElement){if(section.querySelectorAll('input[type="radio"]').length>2)break;if((section.innerText||'').includes('상품 개별법령에 따른 필수 서류')){found.push({input,section});break;}}}
    if(found.length!==1||found[0].input.disabled)throw Error('법적 서류 해당함 영역을 확인하지 못했습니다.');
    return found[0];
  };
  const findTarget=(key,title,all)=>{
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
  };
  const all=Array.from(document.querySelectorAll('input[type="file"]'));
  const targets=definitions.map(([key,title])=>findTarget(key,title,all));
  // A pristine form only: avoid replacing files of a user's work in progress.
  if(document.documentElement.dataset.yoofamAttachmentAttempt||all.some(input=>input.files?.length)||document.body.innerText.match(/[^\s<>]+\.(?:xlsx|xls|csv|tsv|jpe?g|png|webp|gif|avif|pdf)\b/i)){
    if(checkOnly===true)return {state:'occupied',registered:false};
    throw Error('이미 파일이 있거나 전달을 시도한 등록 화면입니다. 기존 작업 보호를 위해 중단했습니다.');
  }
  if(new Set(targets.map(t=>t.input)).size!==3)throw Error('업로드 구역이 중복됩니다.');
  if(required)legalArea();
  // Decode every group before any change event can start a remote upload.
  const prepared=[...targets,...(required?[{key:'legalDocuments',input:null}]:[])].map(({key,input})=>{
    const entries=payload?.[key];if(!Array.isArray(entries)||entries.length>(key==='legalDocuments'?10:200)||(key==='quotation'&&entries.length!==1))throw Error('첨부 파일 목록을 확인해주세요.');
    const transfer=new DataTransfer();
    for(const entry of entries){
      if(!entry||typeof entry.base64!=='string'||!(key==='legalDocuments'?/^legal-\d{3}\.(pdf|png|jpg)$/i:/^[A-Za-z0-9_-][A-Za-z0-9._-]*\.(xlsx|png|jpg|jpeg|webp|gif|avif)$/i).test(entry.name))throw Error('첨부 파일명을 확인해주세요.');
      const bytes=Uint8Array.from(atob(entry.base64),c=>c.charCodeAt(0));
      const types={xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',avif:'image/avif',pdf:'application/pdf'};
      transfer.items.add(new File([bytes],entry.name,{type:types[entry.name.split('.').at(-1).toLowerCase()]}));
    }
    return {key,input,transfer};
  });
  const dispatched=[];
  const legalTarget=()=>{
    const area=legalArea(),files=Array.from(area.section.querySelectorAll('input[type="file"]'));
    if(!area.input.checked||files.length!==1||files[0].disabled||files[0].closest('[aria-disabled="true"]')||targets.some(target=>target.input===files[0]))throw Error('법적 서류 첨부 영역이 준비되지 않았습니다.');
    return files[0];
  };
  if(required&&legalArea().input.checked)legalTarget();
  if(checkOnly===true)return {state:'ready',registered:false};
  document.documentElement.dataset.yoofamAttachmentAttempt='started';
  let nextGroup=0;
  const checkPending=()=>{
    if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/qvt/registration'||document.documentElement.dataset.yoofamAttachmentAttempt!=='started')throw Error('첨부 화면이 변경되었습니다.');
    const current=Array.from(document.querySelectorAll('input[type="file"]'));
    const completed=prepared.slice(0,nextGroup),names=new Set(completed.flatMap(({transfer})=>Array.from(transfer.files,file=>file.name)));
    // A controlled input may clear or remount after its change event. Only our
    // already-delivered File objects/names may remain; pending groups stay empty.
    if(current.some(input=>{
      const files=Array.from(input.files||[]);if(!files.length)return false;
      const sent=completed.find(item=>item.input===input),expected=sent&&Array.from(sent.transfer.files);
      return !expected||files.length!==expected.length||files.some((file,index)=>file!==expected[index]);
    })||Array.from((document.body.innerText||'').matchAll(/[^\s<>"'(),;]+\.(?:xlsx|xls|csv|tsv|jpe?g|png|webp|gif|avif|pdf)\b/gi),match=>match[0]).some(name=>!names.has(name)))throw Error('전달 중 다른 파일이 첨부되었습니다. 기존 첨부를 유지하고 중단했습니다.');
    for(const item of prepared.slice(nextGroup)){
      if(!item.transfer.files.length)continue;
      const input=item.key==='legalDocuments'?legalTarget():findTarget(item.key,definitions.find(([key])=>key===item.key)[1],current).input;
      if(item.input===null)item.input=input;
      if(item.input!==input||!input.isConnected||input.disabled||input.closest('[aria-disabled="true"]'))throw Error('파일 전달 중 등록 화면이 변경되었습니다.');
    }
  };
  const dispatch=(reopenCompany=true)=>{try{
    for(;;){
    checkPending();
    const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
    // Controls and upload rerenders can close the menu. Recover the actual code
    // at this cursor, without replaying a completed group's change event.
    if(!codes.length&&reopenCompany){
      const menus=Array.from(document.querySelectorAll('button')).filter(button=>button.getClientRects().length&&!button.disabled&&(button.innerText||'').trim()===company.name);
      if(menus.length!==1)throw Error('첨부 전 회사 메뉴를 확인하지 못했습니다.');
      menus[0].click();
      return (async()=>{try{
        for(let index=0;index<20;index++){
          checkPending();
          if(/Company Code:\s*A\d+\b/.test(document.body.innerText||''))return dispatch(false);
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        throw Error('첨부 전 회사코드를 확인하지 못했습니다.');
      }catch(error){return {state:'partial',dispatched,registered:false,error:String(error?.message||error)};}})();
    }
    if(codes.length!==1||codes[0]!==company.code)throw Error('첨부 전 회사코드가 변경되었습니다.');
    if(nextGroup===prepared.length)break;
    const {key,input,transfer}=prepared[nextGroup];
    if(transfer.files.length){
      input.files=transfer.files;
      input.dispatchEvent(new Event('change',{bubbles:true}));
      dispatched.push({group:key,count:transfer.files.length});
    }
    nextGroup++;reopenCompany=true;
    }
    document.documentElement.dataset.yoofamAttachmentAttempt=JSON.stringify({state:'dispatched',company,files:prepared.flatMap(({transfer})=>Array.from(transfer.files,file=>file.name)),...(required?{legalDocuments:payload.legalDocuments.map(file=>file.name),legalDocumentsRequired:true}:{})});
    return {state:'dispatched',dispatched,registered:false};
  }catch(error){return {state:'partial',dispatched,registered:false,error:String(error?.message||error)};}};
  if(required&&!legalArea().input.checked)return (async()=>{
    try{legalArea().input.click();for(let count=0;count<40;count++){try{legalTarget();return dispatch();}catch{await new Promise(resolve=>setTimeout(resolve,50));}}throw Error('법적 서류 첨부 영역이 활성화되지 않았습니다.');}
    catch(error){return {state:'partial',dispatched,registered:false,error:String(error?.message||error)};}
  })();
  return dispatch();
}
