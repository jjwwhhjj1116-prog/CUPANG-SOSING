// Read only the currently visible result page; never alter filters or products.
export function readSupplierHubRegistration(quotationId, pageRequest) {
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
    const values=cells.map(cell=>normalize(cell.innerText));
    const skuCopies=Array.from(cells[6].querySelectorAll('button[data-clipboard-text]')).filter(button=>button.getClientRects().length);
    if(skuCopies.length>1)throw Error('SKU ID 복사 버튼이 중복되어 결과를 확인하지 못했습니다.');
    if(skuCopies.length===1){
      const fullSku=skuCopies[0].getAttribute('data-clipboard-text');
      if(typeof fullSku!=='string'||!fullSku||fullSku!==fullSku.trim()||fullSku.length>20000
        ||values[6]!==fullSku&&values[6]!==`${fullSku.slice(0,8)}...`)throw Error('표시된 SKU ID와 복사 버튼의 SKU ID가 다릅니다.');
      values[6]=fullSku;
    }
    return [values];
  });
  if(rows.length>1000||rows.some(row=>row.some(value=>value.length>20000)))throw Error('상품 등록 결과가 너무 큽니다.');
  const result={quotationId,scope:'visible-page',registered:false,rows:rows.map(([title,submittedAt,category,barcode,sourceQuotation,,skuId,status,stage])=>({title,submittedAt,category,barcode,sourceQuotation,skuId,status,stage}))};
  if(pageRequest===undefined)return result;
  // Pagination is used only in the app-owned quotation search tab. Infer no hidden
  // page count or endpoint: require rendered current-page and successor controls.
  const visible=element=>element.getClientRects().length>0;
  const company=pageRequest?.company;
  if(!company||({A01526306:'유앤채',A01464742:'와이홉'})[company.code]!==company.name)throw Error('조회할 회사정보를 확인해주세요.');
  const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
  const inputs=Array.from(document.querySelectorAll('input[id="quotationFile"][name="quotationFile"][type="text"]')).filter(visible);
  // Clicking outside the company dropdown can hide its code. During the wait
  // only, retain the exact visible company name; the caller reopens and verifies
  // the full code immediately after this operation, before accepting any rows.
  const closedMenu=pageRequest.afterMove===true&&codes.length===0&&Array.from(document.querySelectorAll('button'))
    .filter(button=>visible(button)&&!button.disabled&&normalize(button.innerText)===company.name).length===1;
  if(!closedMenu&&(codes.length!==1||codes[0]!==company.code)||inputs.length!==1||inputs[0].value!==quotationId)
    throw Error('페이지 조회 중 회사코드 또는 견적서 ID가 변경되었습니다.');
  for(const selector of ['input#productName','input#barcode','input#skuId','input#sourcingChannelId','select#state','select#progress','input#isReplyNeeded']){
    const controls=Array.from(document.querySelectorAll(selector)).filter(visible);
    if(controls.length!==1||(controls[0].type==='checkbox'?controls[0].checked:controls[0].value!==''))throw Error('견적서 외 검색 조건이 변경되었습니다.');
  }
  const pagers=Array.from(document.querySelectorAll('.pagination,nav[aria-label],[role="navigation"][aria-label]')).filter(element=>visible(element)
    &&(element.matches('.pagination')||/pagination|페이지/i.test(element.getAttribute('aria-label')||'')));
  const roots=pagers.filter(element=>!pagers.some(other=>other!==element&&element.contains(other)));
  let current=null,hasNext=null,next;
  if(roots.length===1){
    const pager=roots[0];
    const selected=Array.from(pager.querySelectorAll('[aria-current="page"],.active')).filter(visible).map(element=>normalize(element.innerText));
    if(selected.length&&selected.every(value=>/^[1-9]\d{0,2}$/.test(value))&&new Set(selected).size===1){
      current=Number(selected[0]);
      const controls=Array.from(pager.querySelectorAll('button,a,[role="button"]')).filter(visible);
      const disabled=element=>element.disabled||element.getAttribute('aria-disabled')==='true'||Boolean(element.closest('[aria-disabled="true"],.disabled'));
      const successors=controls.filter(element=>normalize(element.innerText)===String(current+1));
      const named=controls.filter(element=>/^(다음(?: 페이지)?|next(?: page)?)$/i.test(normalize(element.getAttribute('aria-label')||element.innerText)));
      if(successors.length>1||named.length>1)throw Error('다음 페이지 버튼이 중복되어 조회를 중단했습니다.');
      if(successors.length&&named.length&&disabled(named[0]))throw Error('다음 페이지와 마지막 페이지 표시가 일치하지 않습니다.');
      next=successors[0]||named[0];
      if(next){hasNext=!disabled(next);}
    }
  }
  const page={current,hasNext,signature:JSON.stringify(result.rows)};
  if(page.signature.length>4*1024*1024)throw Error('페이지 결과가 너무 큽니다.');
  if(!pageRequest.advanceFrom)return {...result,page};
  if(current===null||hasNext!==true||!next||pageRequest.advanceFrom.current!==current||pageRequest.advanceFrom.signature!==page.signature)
    throw Error('다음 페이지를 읽기 전 현재 조회 결과가 변경되었습니다.');
  const href=next.getAttribute('href');
  if(href){const target=new URL(href,location.href);if(target.origin!==location.origin||target.pathname!==location.pathname)throw Error('같은 상품 등록 결과의 페이지 이동인지 확인하지 못했습니다.');}
  const observed=tables[0];
  return new Promise((resolve,reject)=>{
    let changed=false,timer;
    const cleanup=()=>{observer.disconnect();clearTimeout(timer);clearTimeout(deadline);};
    const finish=()=>{
      try{
        const fresh=readSupplierHubRegistration(quotationId,{company,afterMove:true});
        if(fresh.page.current!==current&&fresh.page.current!==current+1)throw Error('조회 페이지가 순서대로 이동하지 않았습니다.');
        if(changed&&fresh.page.current===current+1){cleanup();resolve(fresh);}
      }catch(error){cleanup();reject(error);}
    };
    const observer=new MutationObserver(records=>{
      if(records.some(record=>record.type!=='attributes'&&(observed.contains(record.target)
        ||Array.from(record.addedNodes||[]).some(node=>node===observed||node.contains?.(observed)||node.matches?.('table')||node.querySelector?.('table'))))){changed=true;}
      clearTimeout(timer);timer=setTimeout(finish,350);
    });
    const deadline=setTimeout(()=>{cleanup();reject(Error('다음 페이지 결과의 갱신을 확인하지 못했습니다. 잠시 후 다시 조회해주세요.'));},8000);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true});
    try{next.click();}catch(error){cleanup();reject(error);}
  });
}
