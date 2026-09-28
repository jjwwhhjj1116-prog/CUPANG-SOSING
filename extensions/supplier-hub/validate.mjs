// Runs only through an explicit active-tab extension action.
export function requestSupplierHubValidation(reviewedAgreements = {}) {
  if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/qvt/registration')throw Error('현재 Supplier Hub 대량 상품 등록 탭에서 실행해주세요.');
  const data=document.documentElement.dataset;
  let attempt;
  try{attempt=JSON.parse(data.yoofamAttachmentAttempt||'');}catch{throw Error('이 화면에서 확장으로 전달한 파일이 없습니다.');}
  if(attempt.state!=='dispatched'||!Array.isArray(attempt.files)||!attempt.files.length)throw Error('파일 전달이 완료되지 않았거나 검증을 이미 요청했습니다. Supplier Hub에서 진행 상태를 확인해주세요.');
  const visible=document.body.innerText||'';
  const filenames=visible.split(/[\s<>"'(),;]+/);
  if(attempt.files.some(name=>typeof name!=='string'||!filenames.includes(name)))throw Error('전달한 파일이 모두 첨부 목록에 표시되는지 확인해주세요. 아직 검증하지 않았습니다.');
  const definitions=[
    ['priceData','msrpAgreement','제공된 권장소비자가격 또는 공식 판매처 가격 데이터에 대한 쿠팡 약관에 동의합니다.'],
    ['labelBusinessContact','labelContactAgreement','상품 라벨 내 기재된 (010 이하) 연락처는 법인 명의 개통 번호이거나, 해당 브랜드의 공식 대외 창구로 지정된 업무용 연락처에 해당함을 확인하며, 당사는 해당 정보가 대외적으로 공개됨에 동의합니다.'],
  ];
  if(!reviewedAgreements||typeof reviewedAgreements!=='object'||Array.isArray(reviewedAgreements)
    ||Object.keys(reviewedAgreements).some(key=>!definitions.some(([name])=>name===key)||typeof reviewedAgreements[key]!=='boolean'))throw Error('동의 선택값을 확인해주세요.');
  const agreement=(key,id,text)=>{
    const matches=document.querySelectorAll('input[type="checkbox"][id="'+id+'"]');
    if(matches.length!==1||matches[0].disabled)throw Error('Supplier Hub의 동의 항목을 확인해주세요.');
    const input=matches[0];
    if(!input.checked){
      const labels=Array.from(input.labels||[]).map(label=>(label.innerText||'').replace(/\s+/g,' ').trim());
      if(reviewedAgreements[key]!==true||!labels.includes(text))throw Error('Supplier Hub의 가격 정보 약관과 라벨 연락처 확인 내용을 읽고 해당하는 동의 항목을 체크해주세요.');
    }
    return input;
  };
  // Check every required choice before changing any checkbox. Values are only
  // supplied by the user's current popup selections, never by package content.
  definitions.forEach(args=>agreement(...args));
  const validationButton=()=>{
    const buttons=Array.from(document.querySelectorAll('button')).filter(button=>(button.innerText||'').trim()==='파일 검증하기'&&button.getClientRects().length);
    if(buttons.length!==1)throw Error('파일 검증 버튼을 확인해주세요.');
    return buttons[0];
  };
  validationButton();
  for(const args of definitions){const input=agreement(...args);if(!input.checked)input.click();}
  if(definitions.some(args=>!agreement(...args).checked))throw Error('동의 선택이 화면에 반영되지 않았습니다. Supplier Hub에서 확인해주세요.');
  const button=validationButton();
  if(button.disabled||button.getAttribute('aria-disabled')==='true')throw Error('파일 업로드와 필수 항목을 확인해주세요. 파일 검증 버튼이 아직 활성화되지 않았습니다.');
  // Mark before clicking: losing the popup must not repeat a server-side request.
  data.yoofamAttachmentAttempt=JSON.stringify({...attempt,state:'validation-requested'});
  button.click();
  return {state:'validation-requested',validated:false,registered:false};
}
