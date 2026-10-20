/** A captured page row key identifies an option in that source receipt. It is
 * never a supplier SKU, a remote Supplier Hub SKU or a product-level default. */
export type PageOptionIdentity={format:'yoofam-page-option-identity-v1';offerId:string;sourceKeys:string[]};
export function validatePageOptionIdentity(value:unknown,provider:string,offerId:string,optionCount:number,hasOfferDefault=false,hasPriceBasis=false):PageOptionIdentity{
 if(!['chrome-current-page-v1','chrome-reviewed-page-v1'].includes(provider)||hasOfferDefault||hasPriceBasis||!value||typeof value!=='object'||Array.isArray(value))
  throw Error('현재 상품 페이지의 옵션 원문 연결을 확인해주세요.');
 const input=value as Record<string,unknown>;
 if(Object.keys(input).length!==3||Object.keys(input).some(key=>!['format','offerId','sourceKeys'].includes(key))||input.format!=='yoofam-page-option-identity-v1'
  ||input.offerId!==offerId||!Array.isArray(input.sourceKeys)||input.sourceKeys.length!==optionCount||optionCount<1||optionCount>200
  ||input.sourceKeys.some(key=>typeof key!=='string'||!key.trim()||key!==key.trim()||key.length>200||/[\u0000-\u001f\u007f]/.test(key))
  ||new Set(input.sourceKeys).size!==input.sourceKeys.length)throw Error('중복되지 않은 현재 상품의 옵션 원문 키가 필요합니다.');
 return {format:'yoofam-page-option-identity-v1',offerId,sourceKeys:[...input.sourceKeys] as string[]};
}
