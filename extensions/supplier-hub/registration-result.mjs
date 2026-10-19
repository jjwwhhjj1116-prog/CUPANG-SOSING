// Read only the currently visible result page; never alter filters or products.
export function readSupplierHubRegistration(quotationId, pageRequest) {
  if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/qvt/wims')throw Error('Supplier Hub의 상품 등록 상태 확인 화면에서 실행해주세요.');
  if(typeof quotationId!=='string'||!quotationId.trim()||quotationId!==quotationId.trim()||quotationId.length>200)throw Error('파일 검증 결과의 견적서 ID가 필요합니다.');
  const normalize=value=>(value||'').replace(/\s+/g,' ').trim();
  // QVT renders its quotation UUID and an optional parenthesized estimation ID.
  // The estimation ID is not the quotation UUID and must never match it.
  function quotationIdentity(cell) {
    const text = normalize(cell.innerText);
    const copies = Array.from(cell.querySelectorAll('button[data-clipboard-text]')).filter(node => node.getClientRects().length > 0);
    const valid = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && value === value.trim();
    if (!copies.length) return /\.\.\.|…/.test(text) ? null : text;
    if (copies.length === 1) {
      const id = copies[0].getAttribute('data-clipboard-text');
      return valid(id) && (text === id || text === id.slice(0, 8) + '...') ? id : null;
    }
    if (copies.length !== 2) return null;
    const [primary, legacy] = copies;
    const id = primary.getAttribute('data-clipboard-text'), estimation = legacy.getAttribute('data-clipboard-text');
    if (!valid(id) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)
      || !valid(estimation) || !/^[1-9]\d{0,19}$/.test(estimation)) return null;
    const has = (node, token) => normalize(node?.getAttribute('class')).split(' ').includes(token);
    const only = (parent, child) => parent && Array.from(parent.children).length === 1 && parent.children[0] === child;
    const mainClip = primary.parentElement, legacyClip = legacy.parentElement;
    const color = legacyClip?.parentElement, suffix = color?.parentElement, root = mainClip?.parentElement;
    if (mainClip?.tagName !== 'DIV' || !has(mainClip, 'wims-list__clip') || !only(mainClip, primary)
      || legacyClip?.tagName !== 'SPAN' || !has(legacyClip, 'wims-list__clip') || !only(legacyClip, legacy)
      || color?.tagName !== 'SPAN' || !has(color, 'text-success') || !only(color, legacyClip)
      || suffix?.tagName !== 'DIV' || !only(suffix, color) || root?.tagName !== 'DIV'
      || !only(cell, root) || root.children.length !== 2 || root.children[0] !== mainClip || root.children[1] !== suffix
      || normalize(primary.innerText) !== id.slice(0, 8) + '...' || normalize(legacy.innerText) !== estimation
      || normalize(suffix.innerText).replace(/\s/g, '') !== '(' + estimation + ')'
      || text.replace(/\s/g, '') !== id.slice(0, 8) + '...(' + estimation + ')') return null;
    return id;
  }
  // A rejection-history button is an action, not the current review status.
  function reviewStatus(cell) {
    const text = normalize(cell.innerText);
    const labels = { '상품 검수중': '', '상품 검수 완료': 'text-success', '상품 검수 반려': 'text-danger' };
    const children = Array.from(cell.children ?? []);
    const controls = Array.from(cell.querySelectorAll('button,a,input,select,textarea,[role="button"]'));
    // Text-only rendered cells are also used by the standard table contract.
    if (!children.length && !controls.length) return Object.hasOwn(labels, text) ? text : null;
    if (children.length !== 1 || children[0].tagName !== 'DIV') return null;
    const root = children[0], parts = Array.from(root.children), label = parts[0];
    const status = normalize(label?.innerText);
    if (!Object.hasOwn(labels, status) || label?.tagName !== 'DIV' || label.children.length
      || normalize(label.getAttribute('class')) !== labels[status] || parts.length < 1 || parts.length > 2) return null;
    const history = parts[1];
    if (history) {
      const classes = normalize(history.getAttribute('class')).split(' ').sort().join(' ');
      if (history.tagName !== 'BUTTON' || history.getAttribute('type') !== null || history.children.length
        || classes !== 'btn btn-block btn-default btn-xs mt-1' || normalize(history.innerText) !== '반려내역'
        || controls.length !== 1 || controls[0] !== history || !history.getClientRects().length) return null;
    } else if (controls.length) return null;
    return text.replace(/\s/g, '') === (status + (history ? '반려내역' : '')).replace(/\s/g, '') ? status : null;
  }
  const headings=['상품명','상품 등록일','카테고리','바코드','원본 견적서','견적서 ID','SKU ID','상태','등록 진행 단계'];
  const tables=Array.from(document.querySelectorAll('table')).filter(table=>table.getClientRects().length&&Array.from(table.querySelectorAll('thead th')).map(cell=>normalize(cell.innerText.replace(/\?/g,''))).join('|')===headings.join('|'));
  if(tables.length!==1)throw Error('상품 등록 결과 표를 확인하지 못했습니다.');
  const rows=Array.from(tables[0].querySelectorAll('tbody tr')).filter(row=>row.getClientRects().length).flatMap(row=>{
    const cells=Array.from(row.querySelectorAll('td'));
    if(cells.length!==9)return [];
    // Hub abbreviates visible IDs (xxxxxxxx...) but exposes the full ID on its copy button.
    // Read only this cell's rendered controls; never match a prefix or read the clipboard.
    const fullId = quotationIdentity(cells[5]);
    if (fullId === null || fullId !== quotationId) return [];
    const values=cells.map(cell=>normalize(cell.innerText));
    const status = reviewStatus(cells[7]);
    if (status === null) throw Error('현재 상품 검수 상태와 부가 버튼을 구분하지 못했습니다.');
    values[7] = status;
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

  // QVT's shipped CSS-module pager has no aria-current/.active (Step742).
  // Recognize its complete rendered controls; never infer a page from row count.
  function nativePager(pager) {
    const classes = node => normalize(node?.getAttribute('class')).split(' ');
    if (!classes(pager).includes('_2rJmZwpWK6AkvdeVOL1bZs')) return null;
    const has = (node, token) => classes(node).includes(token);
    const disabled = node => node.disabled || node.getAttribute('aria-disabled') === 'true'
      || Boolean(node.closest('.disabled,[aria-disabled="true"],._1H2KZYPdwpNDFms8Cnn5Jq'));
    const controls = Array.from(pager.querySelectorAll('a[data-page]')).filter(visible);
    const number = node => {
      const value = node?.getAttribute('data-page');
      if (typeof value !== 'string' || !/^[1-9]\d{0,2}$/.test(value)) throw Error('공식 조회 페이지 번호를 확인하지 못했습니다.');
      return Number(value);
    };
    const numbered = controls.filter(node => has(node.parentElement, '_3oMgfdzXLjxSxO_d0iK9z5'));
    const selected = numbered.filter(node => has(node.parentElement, '_2pdnZ_VjGkLzJF5y1X3O-4'));
    if (!numbered.length || numbered.length > 10 || selected.length !== 1
      || numbered.some((node, index) => normalize(node.innerText) !== String(number(node))
        || index > 0 && number(node) !== number(numbered[index - 1]) + 1 || disabled(node)))
      throw Error('공식 조회 페이지의 선택·순서를 확인하지 못했습니다.');
    const current = number(selected[0]);
    const standard = Array.from(pager.querySelectorAll('[aria-current="page"],.active')).filter(visible);
    if (standard.some(node => normalize(node.innerText) !== String(current))) throw Error('현재 조회 페이지 표시가 일치하지 않습니다.');
    const one = (token, label) => {
      const found = controls.filter(node => has(node.parentElement, token) && normalize(node.innerText) === label);
      if (found.length !== 1) throw Error('공식 조회 페이지 이동 버튼이 변경되었습니다.');
      return found[0];
    };
    const first = one('_1GYxV0xthnO8RlMLUrpvLd', '<<'), last = one('V0kzo79OFKevPhLFGB8kc', '>>');
    const end = number(last);
    if (number(first) !== 1 || current > end || number(numbered.at(-1)) > end
      || Boolean(disabled(first)) !== (current === 1) || Boolean(disabled(last)) !== (current === number(numbered.at(-1))))
      throw Error('공식 조회 페이지 범위가 일치하지 않습니다.');
    const forward = one('tOfUlMHROQa_ehrySEQmm', '>');
    let next = numbered.find(node => number(node) === current + 1) ?? null;
    if (current === end) {
      if (next || !disabled(forward) || forward.getAttribute('data-page') !== '0') throw Error('마지막 조회 페이지 표시가 일치하지 않습니다.');
    } else if (!next) {
      const candidates = [forward, last].filter(node => !disabled(node) && node.getAttribute('data-page') === String(current + 1));
      if (number(numbered.at(-1)) !== current || candidates.length !== 1)
        throw Error('연속된 다음 조회 페이지를 확인하지 못했습니다.');
      next = candidates[0];
    }
    return { current, next, hasNext: current < end };
  }
  const pagers=Array.from(document.querySelectorAll('.pagination,nav[aria-label],[role="navigation"][aria-label]')).filter(element=>visible(element)
    &&(element.matches('.pagination')||/pagination|페이지/i.test(element.getAttribute('aria-label')||'')));
  const roots=pagers.filter(element=>!pagers.some(other=>other!==element&&element.contains(other)));
  let current=null,hasNext=null,next;
  if(roots.length===1){
    const pager=roots[0];
    const native=nativePager(pager);
    if(native){current=native.current;hasNext=native.hasNext;next=native.next;}
    else {
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
