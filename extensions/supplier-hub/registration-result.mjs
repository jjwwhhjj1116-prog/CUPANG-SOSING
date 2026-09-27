// Read only the currently visible result page; never alter filters or products.
export function readSupplierHubRegistration(quotationId) {
  if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/qvt/wims')throw Error('Supplier Hub의 상품 등록 상태 확인 화면에서 실행해주세요.');
  if(typeof quotationId!=='string'||!quotationId.trim()||quotationId!==quotationId.trim()||quotationId.length>200)throw Error('파일 검증 결과의 견적서 ID가 필요합니다.');
  const normalize=value=>(value||'').replace(/\s+/g,' ').trim();
  const headings=['상품명','상품 등록일','카테고리','바코드','원본 견적서','견적서 ID','SKU ID','상태','등록 진행 단계'];
  const tables=Array.from(document.querySelectorAll('table')).filter(table=>table.getClientRects().length&&Array.from(table.querySelectorAll('thead th')).map(cell=>normalize(cell.innerText.replace(/\?/g,''))).join('|')===headings.join('|'));
  if(tables.length!==1)throw Error('상품 등록 결과 표를 확인하지 못했습니다.');
  const rows=Array.from(tables[0].querySelectorAll('tbody tr')).filter(row=>row.getClientRects().length).flatMap(row=>{
    const cells=Array.from(row.querySelectorAll('td'));
    if(cells.length!==9)return [];
    // Hub abbreviates visible IDs (xxxxxxxx...) but exposes the full ID on its copy button.
    // Read only this cell's rendered controls; never match a prefix or read the clipboard.
    const copyButtons=Array.from(cells[5].querySelectorAll('button[data-clipboard-text]')).filter(button=>button.getClientRects().length);
    const visibleId=normalize(cells[5].innerText);
    const fullId=copyButtons.length===1?copyButtons[0].getAttribute('data-clipboard-text'):visibleId;
    if(copyButtons.length>1||typeof fullId!=='string'||fullId!==quotationId)return [];
    if(copyButtons.length===1&&visibleId!==fullId&&visibleId!==`${fullId.slice(0,8)}...`)return [];
    return [cells.map(cell=>normalize(cell.innerText))];
  });
  if(rows.length>1000||rows.some(row=>row.some(value=>value.length>20000)))throw Error('상품 등록 결과가 너무 큽니다.');
  return {quotationId,scope:'visible-page',registered:false,rows:rows.map(([title,submittedAt,category,barcode,sourceQuotation,,skuId,status,stage])=>({title,submittedAt,category,barcode,sourceQuotation,skuId,status,stage}))};
}
