(()=>{
 const [jobId,nonce]=location.hash.slice(1).split(':'),company=document.getElementById('company'),items=document.getElementById('items'),status=document.getElementById('status'),approve=document.getElementById('approve'),cancel=document.getElementById('cancel'),understood=document.getElementById('understood');let binding,busy=false;
 const call=type=>chrome.runtime.sendMessage({type,jobId,nonce,...binding,...(type==='YOOFAM_OPS_APPROVAL_ACK'?{userGesture:true}:{})});
 // The initial state bootstrap contains no acknowledgement; the worker binds all later messages.
 chrome.runtime.sendMessage({type:'YOOFAM_OPS_APPROVAL_STATE',jobId,nonce}).then(result=>{
  if(!result?.ok)throw Error(result?.error??'승인 자료가 만료되었습니다.');binding={requestId:result.requestId,companyCode:result.companyCode,seqHash:result.seqHash};company.textContent=result.companyCode;
  for(const row of result.rows){const li=document.createElement('li');li.textContent=`발주 ${row.purchaseOrderSeq} · ${row.firstSkuName??''} · ${row.centerName??''} · 입고금액 ${row.receivedAmount??'미확인'}`;items.append(li);}
  understood.disabled=false;cancel.disabled=false;status.textContent=`승인 대기 · ${new Date(result.expiresAt).toLocaleTimeString('ko-KR')}까지 유효`;
 }).catch(error=>{status.textContent=error.message;});
 understood.addEventListener('change',event=>{if(event.isTrusted&&!busy)approve.disabled=!understood.checked;});
 cancel.addEventListener('click',async event=>{if(!event.isTrusted||busy||!binding)return;busy=true;approve.disabled=true;cancel.disabled=true;try{await call('YOOFAM_OPS_APPROVAL_CANCEL');status.textContent='취소했습니다. 외부 승인을 실행하지 않았습니다.';}catch{status.textContent='취소 응답을 확인하지 못했습니다. 승인을 실행하지 말고 이 창을 닫으세요.';}});
 approve.addEventListener('click',async event=>{if(!event.isTrusted||busy||!binding||!understood.checked)return;busy=true;approve.disabled=true;cancel.disabled=true;understood.disabled=true;status.textContent='승인 처리 중입니다. 창을 닫아도 이미 전송된 승인은 취소되지 않습니다.';try{const result=await call('YOOFAM_OPS_APPROVAL_ACK');if(!result)throw Error();status.textContent=(result.error??(result.status==='succeeded'?'선택한 거래명세서 승인을 확인했습니다.':'승인 처리를 완료하지 못했습니다.'))+'\n'+(result.rows??[]).map(row=>`${row.purchaseOrderSeq}: ${row.status}`).join('\n');}catch{status.textContent='승인 응답이 불명입니다. 다시 승인하지 말고 Supplier Hub에서 실제 상태를 확인하세요.';}});
})();
