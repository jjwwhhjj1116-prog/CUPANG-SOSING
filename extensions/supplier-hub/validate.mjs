// Runs only for a user-requested extension or app transmission.
export function requestSupplierHubValidation(reviewedAgreements = {}, waitForButton = false) {
  if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/qvt/registration')throw Error('현재 Supplier Hub 대량 상품 등록 탭에서 실행해주세요.');
  const data=document.documentElement.dataset;
  const attemptMarker=data.yoofamAttachmentAttempt;
  let attempt;
  try{attempt=JSON.parse(data.yoofamAttachmentAttempt||'');}catch{throw Error('이 화면에서 확장으로 전달한 파일이 없습니다.');}
  if(attempt.state!=='dispatched'||!Array.isArray(attempt.files)||!attempt.files.length)throw Error('파일 전달이 완료되지 않았거나 검증을 이미 요청했습니다. Supplier Hub에서 진행 상태를 확인해주세요.');
  const visible=document.body.innerText||'';
  const companyCodes=Array.from(visible.matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
  if(!attempt.company||!Object.hasOwn({A01526306:'유앤채',A01464742:'와이홉'},attempt.company.code)||({A01526306:'유앤채',A01464742:'와이홉'})[attempt.company.code]!==attempt.company.name||companyCodes.length!==1||companyCodes[0]!==attempt.company.code)throw Error('파일 전달 시 회사와 현재 Supplier Hub 회사가 다릅니다.');
  const filenames=visible.split(/[\s<>"'(),;]+/);
  if(attempt.files.some(name=>typeof name!=='string'||!filenames.includes(name)))throw Error('전달한 파일이 모두 첨부 목록에 표시되는지 확인해주세요. 아직 검증하지 않았습니다.');
  const definitions=[
    ['priceData','msrpAgreement','제공된 권장소비자가격 또는 공식 판매처 가격 데이터에 대한 쿠팡 약관에 동의합니다.'],
    ['labelBusinessContact','labelContactAgreement','상품 라벨 내 기재된 (010 이하) 연락처는 법인 명의 개통 번호이거나, 해당 브랜드의 공식 대외 창구로 지정된 업무용 연락처에 해당함을 확인하며, 당사는 해당 정보가 대외적으로 공개됨에 동의합니다.'],
  ];
  if(!reviewedAgreements||typeof reviewedAgreements!=='object'||Array.isArray(reviewedAgreements)
    ||Object.keys(reviewedAgreements).some(key=>(!definitions.some(([name])=>name===key)&&key!=='legalDocumentsNotApplicable')||typeof reviewedAgreements[key]!=='boolean'))throw Error('동의 선택값을 확인해주세요.');
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
  // supplied by the user's current form selections, never by package content.
  const legalChoice=()=>{
    const candidates=Array.from(document.querySelectorAll('input[type="radio"][id="undefined-N"]')).filter(input=>{
      if(!Array.from(input.labels||[]).some(label=>(label.innerText||'').trim()==='해당없음'))return false;
      let section=input.parentElement;
      for(let depth=0;section&&depth<8;depth++,section=section.parentElement){
        if(section.querySelectorAll('input[type="radio"]').length>2)return false;
        if((section.innerText||'').includes('상품 개별법령에 따른 필수 서류')){
          if(Array.from(section.querySelectorAll('input[type="file"]')).some(file=>file.files?.length)
            ||/[^\s<>]+\.(?:pdf|xlsx|xls|jpe?g|png|webp|gif|avif)\b/i.test(section.innerText||''))throw Error('법적 서류가 이미 첨부되어 있습니다. 기존 첨부를 유지하고 Supplier Hub에서 확인해주세요.');
          return true;
        }
      }return false;
    });
    if(candidates.length!==1||candidates[0].disabled)throw Error('법적 서류 해당없음 항목을 확인하지 못했습니다.');
    return candidates[0];
  };
  definitions.forEach(args=>agreement(...args));
  if(reviewedAgreements.legalDocumentsNotApplicable===true)legalChoice();
  const validationButton=()=>{
    const buttons=Array.from(document.querySelectorAll('button')).filter(button=>(button.innerText||'').trim()==='파일 검증하기'&&button.getClientRects().length);
    if(buttons.length!==1)throw Error('파일 검증 버튼을 확인해주세요.');
    return buttons[0];
  };
  validationButton();
  if(reviewedAgreements.legalDocumentsNotApplicable===true){
    const input=legalChoice();if(!input.checked)input.click();
    if(!legalChoice().checked)throw Error('법적 서류 선택이 반영되지 않았습니다. Supplier Hub에서 확인해주세요.');
  }
  for(const args of definitions){const input=agreement(...args);if(!input.checked)input.click();}
  if(definitions.some(args=>!agreement(...args).checked))throw Error('동의 선택이 화면에 반영되지 않았습니다. Supplier Hub에서 확인해주세요.');
  const clickOnce=()=>{
    if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/qvt/registration'
      ||data.yoofamAttachmentAttempt!==attemptMarker)throw Error('첨부 화면이 변경되었거나 검증을 이미 요청했습니다.');
    const current=document.body.innerText||'';
    const codes=Array.from(current.matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
    if(codes.length!==1||codes[0]!==attempt.company.code||attempt.files.some(name=>!current.split(/[\s<>"'(),;]+/).includes(name)))throw Error('검증 요청 전 회사와 첨부 파일을 확인하지 못했습니다.');
    if(definitions.some(args=>!agreement(...args).checked)||(reviewedAgreements.legalDocumentsNotApplicable===true&&!legalChoice().checked))throw Error('필수 선택값이 변경되었습니다.');
    const button=validationButton();
    if(button.disabled||button.getAttribute('aria-disabled')==='true')throw Error('파일 업로드와 필수 항목을 확인해주세요. 파일 검증 버튼이 아직 활성화되지 않았습니다.');
    // Mark before clicking: losing the caller must not repeat a remote request.
    data.yoofamAttachmentAttempt=JSON.stringify({...attempt,state:'validation-requested'});
    button.click();
    return {state:'validation-requested',validated:false,registered:false};
  };
  if(waitForButton)return (async()=>{
    for(let index=0;index<40;index++){
      if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/qvt/registration')throw Error('Supplier Hub 등록 화면이 변경되었습니다.');
      const button=validationButton();
      if(!button.disabled&&button.getAttribute('aria-disabled')!=='true')return clickOnce();
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw Error('검증 버튼이 아직 활성화되지 않았습니다. Supplier Hub 업로드 및 필수 서류를 확인해주세요.');
  })();
  return clickOnce();
}
