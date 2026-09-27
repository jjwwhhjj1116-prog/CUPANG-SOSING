// Serialized into the active Hub tab; only changes the observed search control.
export async function searchSupplierHubRegistration(quotationId) {
 if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/qvt/wims')throw Error('Supplier Hub 상품 등록 상태 확인 화면에서 실행해주세요.');
 if(typeof quotationId!=='string'||!quotationId.trim()||quotationId!==quotationId.trim()||quotationId.length>200)throw Error('검증 완료된 견적서 ID가 필요합니다.');
 const visible=element=>element.getClientRects().length>0;
 const inputs=Array.from(document.querySelectorAll('input[id="quotationFile"][name="quotationFile"][type="text"]')).filter(visible);
 const labels=Array.from(document.querySelectorAll('label[for="quotationFile"]')).filter(visible);
 const buttons=Array.from(document.querySelectorAll('button')).filter(button=>visible(button)&&(button.innerText||'').trim()==='검색');
 if(inputs.length!==1||labels.length!==1||(labels[0].innerText||'').trim()!=='견적서 ID'||buttons.length!==1)throw Error('견적서 ID 검색 양식을 확인하지 못했습니다.');
 const input=inputs[0],button=buttons[0];
 if(input.disabled||input.readOnly||button.disabled||button.getAttribute('aria-disabled')==='true')throw Error('검색 입력 또는 버튼이 비활성화되어 있습니다.');
 if(input.value.trim()&&input.value!==quotationId)throw Error('다른 견적서 ID가 입력되어 있습니다. 기존 검색값을 비운 뒤 다시 실행해주세요.');
 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,quotationId);
 input.dispatchEvent(new Event('input',{bubbles:true}));
 input.dispatchEvent(new Event('change',{bubbles:true}));
 await Promise.resolve();
 if(!input.isConnected||!button.isConnected||input.value!==quotationId||button.disabled||button.getAttribute('aria-disabled')==='true')throw Error('검색 양식이 변경되었습니다. 아직 검색하지 않았습니다.');
 button.click();
 return {state:'search-requested',quotationId,registered:false};
}
