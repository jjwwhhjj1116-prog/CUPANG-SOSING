// Reads the visible Supplier Hub validation table, never private application state.
export async function readSupplierHubValidation(expectedFilename) {
  if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/qvt/registration')throw Error('현재 Supplier Hub 대량 상품 등록 탭에서 실행해주세요.');
  let filename;
  if(expectedFilename!==undefined){
    if(typeof expectedFilename!=='string'||!/^YOOFAM-[a-f0-9]{64}\.xlsx$/.test(expectedFilename))throw Error('저장된 견적서 식별값을 확인해주세요.');
    filename=expectedFilename;
  }else{
    let attempt;
    try{attempt=JSON.parse(document.documentElement.dataset.yoofamAttachmentAttempt||'');}catch{throw Error('이 화면에서 전달한 견적서가 없습니다.');}
    const files=attempt.files?.filter(name=>/^YOOFAM-[a-f0-9]{64}\.xlsx$/.test(name));
    if(attempt.state!=='validation-requested'||files?.length!==1)throw Error('이 화면에서 파일 검증을 요청한 견적서만 확인할 수 있습니다.');
    filename=files[0];
  }
  const headings=['견적서 명','견적서 등록일','검증 상태','검증 결과','견적서 ID'];
  const normalize=value=>(value||'').replace(/\?/g,'').replace(/\s+/g,' ').trim();
  const table=()=>Array.from(document.querySelectorAll('table')).filter(element=>element.getClientRects().length&&Array.from(element.querySelectorAll('thead th')).map(cell=>normalize(cell.innerText)).join('|')===headings.join('|'));
  const existing=table();
  if(existing.length>1)throw Error('검증 결과 표가 중복되어 있습니다.');
  if(existing.length===1){
    const refresh=Array.from(document.querySelectorAll('button')).filter(button=>normalize(button.innerText).replace(/^refresh\s*/,'')==='새로고침'&&button.getClientRects().length);
    if(refresh.length!==1||refresh[0].disabled||refresh[0].getAttribute('aria-disabled')==='true')throw Error('검증 결과 새로고침 버튼을 확인해주세요.');
    // Observe before clicking so a synchronous redraw cannot be missed. Wait
    // for table redraws to settle; unchanged results retain their visible state.
    await new Promise((resolve,reject)=>{
      let quiet;
      const finish=()=>{clearTimeout(timer);clearTimeout(quiet);observer.disconnect();resolve();};
      const observer=new MutationObserver(records=>{
        if(records.some(record=>existing[0].contains(record.target)||!existing[0].isConnected)){
          clearTimeout(quiet);quiet=setTimeout(finish,250);
        }
      });
      const timer=setTimeout(finish,6000);
      observer.observe(document.body,{childList:true,subtree:true,characterData:true});
      try{refresh[0].click();}catch(error){clearTimeout(timer);observer.disconnect();reject(error);}
    });
  }
  if(!existing.length){
    const buttons=Array.from(document.querySelectorAll('button')).filter(button=>normalize(button.innerText)==='검증 진행상태 확인하기'&&button.getClientRects().length&&!button.disabled);
    if(buttons.length!==1)throw Error('Supplier Hub 검증 진행상태 버튼을 찾지 못했습니다.');
    buttons[0].click();
    await new Promise(resolve=>{
      const observer=new MutationObserver(()=>{if(table().length){clearTimeout(timer);observer.disconnect();resolve();}});
      const timer=setTimeout(()=>{observer.disconnect();resolve();},6000);
      observer.observe(document.body,{childList:true,subtree:true});
      if(table().length){clearTimeout(timer);observer.disconnect();resolve();}
    });
  }
  const tables=table();if(tables.length!==1)throw Error('검증 결과 표가 아직 표시되지 않았습니다.');
  const rows=Array.from(tables[0].querySelectorAll('tbody tr')).map(row=>Array.from(row.querySelectorAll('td')).map(cell=>normalize(cell.innerText)));
  const matches=rows.filter(cells=>cells.length===5&&cells[0]===filename);
  if(matches.length>1)throw Error('같은 파일명의 결과가 여러 개입니다. 견적서 ID를 직접 확인해주세요.');
  if(!matches.length)return {state:'not-found',filename,registered:false};
  const [,submittedAt,status,detail,quotationId]=matches[0];
  return {state:status==='완료'?'validation-complete':status==='반려'?'validation-rejected':'validation-pending',filename,submittedAt,status,detail,quotationId,registered:false};
}
