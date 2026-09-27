// Runs only through an explicit active-tab extension action.
export function requestSupplierHubValidation() {
  if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/qvt/registration')throw Error('현재 Supplier Hub 대량 상품 등록 탭에서 실행해주세요.');
  const data=document.documentElement.dataset;
  let attempt;
  try{attempt=JSON.parse(data.yoofamAttachmentAttempt||'');}catch{throw Error('이 화면에서 확장으로 전달한 파일이 없습니다.');}
  if(attempt.state!=='dispatched'||!Array.isArray(attempt.files)||!attempt.files.length)throw Error('파일 전달이 완료되지 않았거나 검증을 이미 요청했습니다. Supplier Hub에서 진행 상태를 확인해주세요.');
  const visible=document.body.innerText||'';
  const filenames=visible.split(/[\s<>"'(),;]+/);
  if(attempt.files.some(name=>typeof name!=='string'||!filenames.includes(name)))throw Error('전달한 파일이 모두 첨부 목록에 표시되는지 확인해주세요. 아직 검증하지 않았습니다.');
  const agreements=['msrpAgreement','labelContactAgreement'].map(id=>document.querySelectorAll(`input[type="checkbox"][id="${id}"]`));
  if(agreements.some(matches=>matches.length!==1||!matches[0].checked||matches[0].disabled))throw Error('Supplier Hub의 가격 정보 약관과 라벨 연락처 확인 내용을 읽고 해당하는 동의 항목을 체크해주세요.');
  const buttons=Array.from(document.querySelectorAll('button')).filter(button=>(button.innerText||'').trim()==='파일 검증하기'&&button.getClientRects().length);
  if(buttons.length!==1||buttons[0].disabled||buttons[0].getAttribute('aria-disabled')==='true')throw Error('파일 업로드와 필수 항목을 확인해주세요. 파일 검증 버튼이 아직 활성화되지 않았습니다.');
  // Mark before clicking: losing the popup must not repeat a server-side request.
  data.yoofamAttachmentAttempt=JSON.stringify({...attempt,state:'validation-requested'});
  buttons[0].click();
  return {state:'validation-requested',validated:false,registered:false};
}
