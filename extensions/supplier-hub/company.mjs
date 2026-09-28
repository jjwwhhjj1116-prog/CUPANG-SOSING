// Only the observed visible company menu is read. No cookies or app internals.
export async function verifySupplierHubCompany(company) {
 if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/qvt/registration')throw Error('Supplier Hub 등록 화면에서 실행해주세요.');
 if(company===undefined){try{company=JSON.parse(document.documentElement.dataset.yoofamAttachmentAttempt||'').company;}catch{throw Error('이 탭에서 전달한 회사정보가 없습니다.');}}
 if(!company||!Object.hasOwn({A01526306:'유앤채',A01464742:'와이홉'},company.code)||({A01526306:'유앤채',A01464742:'와이홉'})[company.code]!==company.name)throw Error('승인된 회사정보가 필요합니다.');
 const codes=()=>Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
 if(!codes().length){
  const buttons=Array.from(document.querySelectorAll('button')).filter(button=>button.getClientRects().length&&!button.disabled&&(button.innerText||'').trim()===company.name);
  if(buttons.length!==1)throw Error('회원 회사와 현재 Supplier Hub 회사가 다르거나 회사 메뉴를 확인할 수 없습니다.');
  buttons[0].click();
 }
 for(let attempt=0;attempt<20;attempt++){
  const found=codes();
  if(found.length){if(found.length!==1||found[0]!==company.code)throw Error('회원 회사코드와 Supplier Hub 로그인 회사코드가 다릅니다. 전송하지 않았습니다.');return {code:company.code};}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 throw Error('Supplier Hub 회사코드를 확인하지 못했습니다.');
}
