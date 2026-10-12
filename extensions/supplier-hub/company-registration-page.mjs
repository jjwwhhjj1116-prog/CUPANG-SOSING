// Serialized into a dedicated, app-created read-only Hub query tab.
// It changes only search/date/page controls. Never accepts agreements or edits products.
export async function querySupplierHubCompanyRegistrations(query,company){
 const normalize=value=>(value||'').replace(/\s+/g,' ').trim(),visible=node=>node.getClientRects().length>0;
 const states={'전체':'','상품 검수중':'INSPECTION','상품 검수 완료':'INSPECTION_COMPLETE','상품 검수 반려':'REJECTION'};
 const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
 if(!query||!validDate(query.startDate)||!validDate(query.endDate)||query.startDate>query.endDate||!Object.hasOwn(states,query.status)
  ||typeof query.title!=='string'||query.title!==query.title.trim()||query.title.length>200||/[\u0000-\u001f]/.test(query.title)
  ||({A01526306:'유앤채',A01464742:'와이홉'})[company?.code]!==company?.name)throw Error('상품 등록 상태의 회사·조회 조건을 확인해주세요.');
 const dates=()=>Array.from(document.querySelectorAll('input[type="text"][placeholder="date"]')).filter(visible);
 const one=selector=>{const found=Array.from(document.querySelectorAll(selector)).filter(visible);if(found.length!==1)throw Error('공식 상품 등록 상태 양식을 확인하지 못했습니다.');return found[0];};
 const button=text=>{const found=Array.from(document.querySelectorAll('button')).filter(node=>visible(node)&&normalize(node.innerText).replace(/^\S*\s+(?=재설정$)/,'')===text);if(found.length!==1||found[0].disabled)throw Error('공식 조회 버튼을 확인하지 못했습니다.');return found[0];};
 const verify=afterMove=>{
  if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/qvt/wims')throw Error('상품 등록 상태 조회 화면이 변경되었습니다.');
  const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
  const closed=afterMove&&codes.length===0&&Array.from(document.querySelectorAll('button')).filter(node=>visible(node)&&normalize(node.innerText)===company.name).length===1;
  if(!closed&&(codes.length!==1||codes[0]!==company.code))throw Error('조회 중 Supplier Hub 회사가 변경되었습니다.');
 };
 verify(false);
 const headings=['상품명','상품 등록일','카테고리','바코드','원본 견적서','견적서 ID','SKU ID','상태','등록 진행 단계'];
 const table=()=>{const found=Array.from(document.querySelectorAll('table')).filter(node=>visible(node)&&Array.from(node.querySelectorAll('thead th')).map(cell=>normalize(cell.innerText.replace(/\?/g,''))).join('|')===headings.join('|'));if(found.length!==1)throw Error('공식 등록 상태 표를 확인하지 못했습니다.');return found[0];};
 table();
 const set=(node,value)=>{if(node.disabled||node.readOnly)throw Error('조회 입력이 비활성화되었습니다.');const prototype=node.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));if(node.tagName!=='SELECT')node.dispatchEvent(new Event('blur',{bubbles:true}));};
 button('재설정').click();await Promise.resolve();
 for(const selector of ['input#quotationFile','input#barcode','input#skuId','input#sourcingChannelId','select#progress'])if(one(selector).value!=='')throw Error('기존 조회 조건이 초기화되지 않았습니다.');
 if(one('input#isReplyNeeded').checked)throw Error('기존 반려 회신 조건이 남아 있습니다.');
 const dateInputs=dates();if(dateInputs.length!==2)throw Error('공식 등록일 조회 양식을 확인하지 못했습니다.');
 set(one('input#productName'),query.title);set(one('select#state'),states[query.status]);set(dateInputs[0],query.startDate);set(dateInputs[1],query.endDate);
 const queryMatches=()=>{verify(true);const current=dates();if(current.length!==2||current[0].value!==query.startDate||current[1].value!==query.endDate||one('input#productName').value!==query.title||one('select#state').value!==states[query.status]
  ||['input#quotationFile','input#barcode','input#skuId','input#sourcingChannelId','select#progress'].some(selector=>one(selector).value!=='')||one('input#isReplyNeeded').checked)throw Error('조회 중 입력한 검색 조건이 변경되었습니다.');};
 const read=()=>{
  queryMatches();const source=table(),counts=Array.from((document.body.innerText||'').matchAll(/([\d,]+)개\s*검색됨/g),match=>Number(match[1].replace(/,/g,'')));
  if(counts.length!==1||!Number.isSafeInteger(counts[0])||counts[0]<0||counts[0]>2000)throw Error('검색 결과 수를 확인하지 못했거나 2000개를 초과했습니다. 기간·상품명으로 범위를 줄여주세요.');
  const rows=[];
  for(const tr of Array.from(source.querySelectorAll('tbody tr')).filter(visible)){
   const cells=Array.from(tr.querySelectorAll('td'));if(cells.length!==9){if(counts[0]===0)continue;throw Error('조회 결과 열이 변경되었습니다.');}
   const values=cells.map(cell=>normalize(cell.innerText));
   for(const index of [5,6]){const copies=Array.from(cells[index].querySelectorAll('button[data-clipboard-text]')).filter(visible);if(copies.length>1)throw Error('결과 식별값이 중복되었습니다.');if(copies.length===1){const full=copies[0].getAttribute('data-clipboard-text');if(typeof full!=='string'||!full||full!==full.trim()||full.length>200||values[index]!==full&&values[index]!==`${full.slice(0,8)}...`)throw Error('표시된 결과 식별값이 다릅니다.');values[index]=full;}else if(/\.\.\.|…/.test(values[index]))throw Error('생략된 결과 식별값의 원문을 확인하지 못했습니다.');}
   if(values.some(value=>value.length>20000)||!values[0])throw Error('상품 등록 결과 크기 또는 이름을 확인해주세요.');
   const submittedDate=values[1].match(/^(\d{4})[/-](\d{2})[/-](\d{2})\b/);if(!submittedDate)throw Error('공식 상품 등록일을 확인하지 못했습니다.');const day=submittedDate.slice(1).join('-');
   if(!validDate(day)||day<query.startDate||day>query.endDate||query.status!=='전체'&&values[7]!==query.status||query.title&&!values[0].toLowerCase().includes(query.title.toLowerCase()))throw Error('입력한 조회 범위와 상품 결과가 다릅니다.');
   rows.push({title:values[0],submittedAt:values[1],category:values[2],barcode:values[3],sourceQuotation:values[4],quotationId:values[5],skuId:values[6],status:values[7],stage:values[8]});
  }
  if(rows.length>100||rows.length>counts[0])throw Error('조회 페이지의 행 수가 다릅니다.');
  const pagers=Array.from(document.querySelectorAll('.pagination')).filter(visible),roots=pagers.filter(node=>!pagers.some(other=>other!==node&&node.contains(other)));
  let current=1,next=null;
  if(roots.length){if(roots.length!==1)throw Error('상품 조회 페이지가 중복되었습니다.');const selected=Array.from(roots[0].querySelectorAll('[aria-current="page"],.active')).filter(visible).map(node=>normalize(node.innerText));if(!selected.length||selected.some(value=>!/^[1-9]\d{0,2}$/.test(value))||new Set(selected).size!==1)throw Error('현재 조회 페이지를 확인하지 못했습니다.');current=Number(selected[0]);const successors=Array.from(roots[0].querySelectorAll('button,a,[role="button"]')).filter(node=>visible(node)&&normalize(node.innerText)===String(current+1));if(successors.length>1)throw Error('다음 조회 페이지가 중복되었습니다.');if(successors[0]&&!successors[0].disabled&&successors[0].getAttribute('aria-disabled')!=='true'&&!successors[0].closest('.disabled,[aria-disabled="true"]'))next=successors[0];}
  return {rows,total:counts[0],current,next,signature:JSON.stringify(rows)};
 };
 const move=async(action,expectedPage)=>{
  const observed=table();await new Promise((resolve,reject)=>{let changed=false,timer;const cleanup=()=>{observer.disconnect();clearTimeout(timer);clearTimeout(deadline);};
   const finish=()=>{try{const searches=Array.from(document.querySelectorAll('button')).filter(node=>visible(node)&&normalize(node.innerText)==='검색');if(!changed||searches.length!==1||searches[0].disabled)return;const fresh=read();if(fresh.current!==expectedPage)return;cleanup();resolve();}catch(error){cleanup();reject(error);}};
   const observer=new MutationObserver(records=>{if(records.some(record=>record.type!=='attributes'&&(observed.contains(record.target)||Array.from(record.addedNodes||[]).some(node=>node===observed||node.contains?.(observed)||node.matches?.('table')||node.querySelector?.('table')))))changed=true;clearTimeout(timer);timer=setTimeout(finish,350);});
   const deadline=setTimeout(()=>{cleanup();reject(Error('새 조회 결과의 갱신을 확인하지 못했습니다. 다시 조회해주세요.'));},10000);observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true});try{action();}catch(error){cleanup();reject(error);}
  });return read();
 };
 queryMatches();let page=await move(()=>button('검색').click(),1),total=page.total,rows=[],pagesRead=0;const signatures=new Set(),issued=new Set(),placeholder=value=>!value||/^(?:-|—|n\/a|미표시|해당사항없음)$/i.test(value);
  while(true){if(page.total!==total||page.current!==pagesRead+1||signatures.has(page.signature)&&page.rows.length)throw Error('조회 결과의 수·순서가 변경되었습니다.');signatures.add(page.signature);for(const row of page.rows){if(!placeholder(row.quotationId)&&!placeholder(row.skuId)){const identity=JSON.stringify([row.quotationId,row.skuId]);if(issued.has(identity))throw Error('페이지 사이에 같은 견적서·SKU가 중복되었습니다. 다시 조회해주세요.');issued.add(identity);}}rows.push(...page.rows);pagesRead++;if(rows.length>total||new TextEncoder().encode(JSON.stringify(rows)).length>4*1024*1024||pagesRead>200)throw Error('조회 결과의 범위를 초과했습니다.');
  if(rows.length===total)break;if(!page.next||!page.rows.length)throw Error('남은 조회 결과 페이지를 확인하지 못했습니다.');const next=page.next,href=next.getAttribute('href');if(href){const target=new URL(href,location.href);if(target.origin!==location.origin||target.pathname!==location.pathname)throw Error('공식 조회 페이지의 이동 경로가 다릅니다.');}page=await move(()=>next.click(),page.current+1);
 }
 queryMatches();return {source:'supplier-hub-company-registration-v1',scope:'queried-pages',mutated:false,company,query:{startDate:query.startDate,endDate:query.endDate,status:query.status,title:query.title},rows,total,pagesRead,observedAt:Date.now()};
}
