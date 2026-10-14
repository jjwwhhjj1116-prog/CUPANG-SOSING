/** The public Hub history table is an ordered projection, not a DOM docId.
 * Only an unambiguous complete projection can nominate a read-only load.
 * Its separate Chrome request observation must prove the actual docId before
 * this function marks the page as owned or any next-step button is clicked. */
export async function singleDocumentLoadPage(input){
  const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
  const same=(a,b)=>canon(a)===canon(b),visible=node=>Boolean(node&&node.getClientRects().length),data=document.documentElement.dataset;
  if(typeof input.attemptId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.attemptId))throw Error('새 문서 불러오기 요청을 확인해주세요.');
  const records=()=>JSON.parse(data.yoofamSingleDocumentRecords||'{}');
  let companyVerified=false;
  const check=()=>{
    const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),m=>m[1]),record=records()[input.binding.packetDigest];
    // Opening/loading the modal closes the company menu. The injection first
    // requires its visible code; within this same document, a closed menu must
    // retain exactly the approved company's visible header button.
    const nameButtons=Array.from(document.querySelectorAll('button')).filter(node=>visible(node)&&!node.disabled&&(node.innerText||'').trim()===input.binding.identity.company.name);
    if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/sr/registration/step/startPage'||codes.length>1||codes.length===1&&codes[0]!==input.binding.identity.company.code||!codes.length&&(!companyVerified||nameButtons.length!==1)
      ||!record||!same(record.binding,input.binding)||!same(record.docId,input.docId)||!(Number(input.docId)>0))throw Error('소유한 새 문서의 시작 화면을 확인해주세요.');
    if(codes.length===1)companyVerified=true;
    return record;
  };
  const save=record=>{const all=records();all[input.binding.packetDigest]=record;data.yoofamSingleDocumentRecords=JSON.stringify(all);};
  const format=value=>{
    if(!(Number.isSafeInteger(value)&&value>0||typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)))throw Error('저장 시각의 원문 형식을 확인하지 못했습니다.');
    if(typeof value==='string'){
      const [y,m,d,h,min,s]=value.match(/^\d{4}|\d{2}/g).slice(0,6).map(Number),days=[31,y%4===0&&(y%100!==0||y%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
      if(m<1||m>12||d<1||d>days[m-1]||h>23||min>59||s>59)throw Error('저장 시각을 확인해주세요.');
    }
    const date=new Date(value);if(!Number.isFinite(date.getTime())||date.getFullYear()<1000||date.getFullYear()>9999)throw Error('저장 시각을 확인해주세요.');
    const pad=n=>String(n).padStart(2,'0');return date.getFullYear()+'.'+pad(date.getMonth()+1)+'.'+pad(date.getDate())+' '+pad(date.getHours())+':'+pad(date.getMinutes());
  };
  const projection=row=>{
    if(!row||typeof row.productName!=='string'||!row.productName.trim()||typeof row.categoryPath!=='string'||!row.categoryPath.trim()||typeof row.remark!=='boolean')throw Error('원문 문서 목록의 표시 항목을 확인해주세요.');
    return {productName:row.productName,categoryPath:row.categoryPath,date:format(row.modifiedAt),rejected:row.remark};
  };
  if(!Array.isArray(input.drafts)||!input.drafts.length||input.drafts.length>1000||new Set(input.drafts.map(row=>canon(row.docId))).size!==input.drafts.length)throw Error('전체 문서 목록을 확인해주세요.');
  const source=input.drafts.map(projection),index=input.drafts.findIndex(row=>same(row.docId,input.docId));
  if(index<0||input.drafts.filter(row=>same(row.docId,input.docId)).length!==1||source.filter(row=>same(row,source[index])).length!==1)throw Error('새 문서를 표시 항목으로 구분할 수 없습니다. 기존 문서는 선택하지 않았습니다.');
  const modalVisible=()=>Array.from(document.querySelectorAll('.modal-title')).some(node=>visible(node)&&(node.innerText||'').includes('중간 저장 불러오기'));
  const candidate=()=>{
    if(!modalVisible())return null;
    const rows=Array.from(document.querySelectorAll('.sr-contents__table-draft tbody > tr')).filter(visible);
    if(rows.length!==source.length)return null;
    const projected=[];
    for(const row of rows){
      const cells=Array.from(row.querySelectorAll('td'));if(cells.length!==5)return null;
      const names=Array.from(cells[0].querySelectorAll('span')).filter(node=>!node.classList.contains('badge')),badges=Array.from(cells[0].querySelectorAll('.badge'));
      if(names.length!==1||badges.length>1)return null;
      projected.push({productName:names[0].textContent,categoryPath:cells[1].textContent,date:cells[2].textContent,rejected:badges.length===1});
    }
    if(!same(projected,source))return null;
    const cell=Array.from(rows[index].querySelectorAll('td'))[3],buttons=Array.from(cell.querySelectorAll('.btn-outline-primary')).filter(node=>visible(node)&&!node.disabled&&node.getAttribute('type')==='button');
    return buttons.length===1?buttons[0]:null;
  };
  const wait=async predicate=>{for(let n=0;n<80;n++){check();if(predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('새 문서의 전체 표시 목록 또는 불러오기 결과를 확인하지 못했습니다.');};
  const record=check();
  if(input.action==='prepare'){
    if(record.loadedDocId!==undefined||record.loadClickAttempt!==undefined||modalVisible())throw Error('다른 문서 선택 작업을 보존했습니다.');
    if(Array.from(document.querySelectorAll('.rsc-text-input input')).some(node=>(node.value||'').trim()))throw Error('작성 중인 기존 상품을 보존했습니다.');
    const buttons=Array.from(document.querySelectorAll('.btn-outline-secondary')).filter(node=>visible(node)&&!node.disabled&&(node.innerText||'').includes('중간 저장 불러오기'));
    if(buttons.length!==1)throw Error('중간 저장 목록 버튼을 확인해주세요.');
    buttons[0].click();await wait(()=>Boolean(candidate()));
    record.loadAttempt=input.attemptId;save(record);return {prepared:true,docId:input.docId};
  }
  if(record.loadAttempt!==input.attemptId)throw Error('현재 새 문서 불러오기 확인이 아닙니다.');
  if(input.action==='load'){
    if(record.loadClickAttempt!==undefined)throw Error('불러오기는 이미 요청했습니다. 다시 클릭하지 않았습니다.');
    const button=candidate();if(!button)throw Error('문서 목록이 변경되었습니다. 기존 문서는 선택하지 않았습니다.');
    record.loadClickAttempt=input.attemptId;save(record);button.click();
    await wait(()=>!modalVisible()&&Array.from(document.querySelectorAll('.rsc-text-input input')).some(node=>node.value===input.productName));
    return {loaded:true,docId:input.docId,productName:input.productName};
  }
  if(input.action==='confirm'){
    const proof=input.observation;
    if(record.loadClickAttempt!==input.attemptId||!proof||!same(proof.docId,input.docId)||proof.frameId!==0||proof.statusCode!==200||proof.fromCache!==false
      ||proof.url!=='https://supplier.coupang.com/sr/draft/api/get-by-id/'+encodeURIComponent(String(input.docId))||typeof proof.requestId!=='string'||typeof proof.documentId!=='string'
      ||modalVisible()||!Array.from(document.querySelectorAll('.rsc-text-input input')).some(node=>node.value===input.productName))throw Error('새 문서번호에 연결된 실제 불러오기를 확인하지 못했습니다.');
    record.loadedDocId=input.docId;record.loadObservation=proof;save(record);return {loaded:true,docId:input.docId};
  }
  throw Error('알 수 없는 불러오기 작업입니다.');
}
