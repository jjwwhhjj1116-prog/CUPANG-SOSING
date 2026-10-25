/** One explicitly approved retry of an old unobserved create. Both complete
 * remote lists are checked in the same owned document immediately before the
 * POST. A persisted in-page attempt marker prevents a second dispatch. */
export async function singleDocumentRetryCreatePage(input){
 const origin='https://supplier.coupang.com',root=document.documentElement,data=root.dataset;
 const canon=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canon).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}';
 const same=(a,b)=>canon(a)===canon(b),id=v=>Number.isSafeInteger(v)&&v>0||typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=200&&!/[\u0000-\u001f]|\.\.\.|…/.test(v);
 const binding=input?.binding,approval=input?.retryCreateApproval;
 if(!input||Object.keys(input).sort().join(',')!=='baselineDocIds,binding,body,method,operationId,path,retryCreateApproval')throw Error('원래 생성 재시도 요청 항목을 확인해주세요.');
 const readJson=async(response,signal)=>{
  const reader=response.body?.getReader();if(!reader)throw Error('중복 확인·생성 응답이 없습니다.');
  const chunks=[];let size=0;try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>6*1024*1024)throw Error('중복 확인·생성 응답이 너무 큽니다.');chunks.push(part.value);}}finally{await reader.cancel();}
  if(signal.aborted)throw Error('중복 확인·생성 응답 시간이 초과됐습니다.');
  const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 };
 const check=()=>{
  const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),m=>m[1]);
  if(document.documentElement!==root||location.origin!==origin||location.pathname!=='/dashboard/KR'||location.search||location.hash
   ||!binding||!binding.nativeAssetSourcePlanSha256||codes.length!==1||codes[0]!==binding.identity?.company?.code
   ||({A01526306:'유앤채',A01464742:'와이홉'})[codes[0]]!==binding.identity.company.name
   ||!['identityDigest','packetDigest','preparedBodySha256','originalBodySha256','nativeAssetSourcePlanSha256'].every(k=>/^[a-f0-9]{64}$/.test(binding[k]||''))
   ||input.method!=='POST'||input.path!=='/sr/draft/api/create'||input.operationId!==binding.requestId+':create'
   ||!approval||Object.keys(approval).sort().join(',')!=='approvedAt,attempt,originalRequestedAt,originalSequence'||approval.attempt!==1
   ||![approval.approvedAt,approval.originalRequestedAt,approval.originalSequence].every(v=>Number.isSafeInteger(v)&&v>0)
   ||approval.originalRequestedAt+60000>approval.approvedAt||approval.approvedAt>Date.now()+5000||Date.now()>approval.approvedAt+120000)
   throw Error('원래 생성 요청의 1회 재시도 승인·회사·탭 연결을 확인해주세요.');
  const records=JSON.parse(data.yoofamSingleDocumentRecords||'{}');
  if(!records||typeof records!=='object'||Array.isArray(records)||Object.keys(records).length>1000||Object.hasOwn(records,binding.packetDigest))
   throw Error('원래 전송 탭에 생성 요청 기록이 있습니다. 다시 생성하지 않았습니다.');
  if(Array.from(document.querySelectorAll('.rsc-text-input input')).some(n=>(n.value||'').trim()))throw Error('현재 작업 중인 Supplier Hub 입력을 보존했습니다.');
 };
 check();
 const baseline=input.baselineDocIds,body=input.body,members=binding.identity.members;
 if(!Array.isArray(baseline)||baseline.length>10000||baseline.some(v=>!id(v))||new Set(baseline.map(canon)).size!==baseline.length
  ||body?.docId!==null||body.scope!=='Retail_Categorized_Single'||!Array.isArray(members)||members.length<1||members.length>200
  ||!Array.isArray(body.jsonDocument)||body.jsonDocument.length!==members.length||members.some((v,i)=>v.documentIndex!==i)
  ||typeof body.productName!=='string'||!body.productName.trim())throw Error('원래 견적 본문·포함 옵션·중간저장 기준 목록을 확인해주세요.');
 const bytes=new TextEncoder().encode(canon(body)),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==binding.preparedBodySha256)throw Error('승인한 원래 견적서 본문과 다릅니다.');
 const fetchJson=async(path,method='GET',value)=>{
  check();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
   const url=origin+path,response=await fetch(url,{method,credentials:'include',cache:'no-store',redirect:'error',signal:controller.signal,
    headers:{accept:'application/json',...(method==='POST'?{'content-type':'application/json;charset=UTF-8'}:{})},...(method==='POST'?{body:JSON.stringify(value)}:{})});
   if(response.redirected||response.url!==url||!/\bapplication\/json\b/i.test(response.headers.get('content-type')||''))throw Error('중복 확인·생성 응답의 출처 또는 형식이 다릅니다.');
   return{ok:response.ok,status:response.status,json:await readJson(response,controller.signal)};
  }finally{clearTimeout(timer);}
 };
 const lists=[];
 for(const path of ['/sr/draft/api/drafts','/sr/draft/api/drafts/register-requested']){
  const response=await fetchJson(path),rows=response.json;
  if(!response.ok||response.status!==200||!Array.isArray(rows)||rows.length>10000||rows.some(r=>!r||!id(r.docId)||typeof r.productName!=='string'||typeof r.modifiedAt!=='string'||!Number.isFinite(Date.parse(r.modifiedAt)))
   ||new Set(rows.map(r=>canon(r.docId))).size!==rows.length)throw Error('전체 중간저장·제출요청 목록을 확인하지 못해 재생성하지 않았습니다.');
  if(rows.some(r=>r.productName===body.productName||Date.parse(r.modifiedAt)>=approval.originalRequestedAt))throw Error('동일 상품 또는 원래 요청 이후의 원격 문서가 있습니다. 중복 방지를 위해 재생성하지 않았습니다.');
  lists.push(rows);
 }
 if(!same(lists[0].map(r=>r.docId).sort((a,b)=>canon(a).localeCompare(canon(b))),baseline.slice().sort((a,b)=>canon(a).localeCompare(canon(b)))))
  throw Error('원래 중간저장 목록이 변경돼 재생성하지 않았습니다.');
 check();
 const records=JSON.parse(data.yoofamSingleDocumentRecords||'{}');
 const record={binding,docId:null,createOperationId:input.operationId,state:'create-requested',baselineDocIds:baseline,
  createRetry:{...approval,duplicateCheckedAt:Date.now(),unfinishedCount:lists[0].length,requestedCount:lists[1].length}};
 records[binding.packetDigest]=record;data.yoofamSingleDocumentRecords=JSON.stringify(records);
 // The marker is installed before dispatch. The ordinary check deliberately
 // rejects it, so the final POST uses the already-verified document directly.
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{
  const url=origin+input.path,response=await fetch(url,{method:'POST',credentials:'include',cache:'no-store',redirect:'error',signal:controller.signal,
   headers:{accept:'application/json','content-type':'application/json;charset=UTF-8'},body:JSON.stringify(body)});
  if(response.redirected||response.url!==url||!/\bapplication\/json\b/i.test(response.headers.get('content-type')||''))throw Error('재시도 생성 응답의 출처·형식이 다릅니다. 저장 결과만 조회해주세요.');
  const json=await readJson(response,controller.signal),currentRecords=JSON.parse(data.yoofamSingleDocumentRecords||'{}'),current=currentRecords[binding.packetDigest];
  const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),m=>m[1]);
  if(document.documentElement!==root||location.origin!==origin||location.pathname!=='/dashboard/KR'||location.search||location.hash||codes.length!==1||codes[0]!==binding.identity.company.code||!same(current,record))
   throw Error('재시도 중 원래 탭·회사·생성 기록이 변경됐습니다. 저장 결과만 조회해주세요.');
  const ok=response.ok&&!(json&&typeof json==='object'&&json.errorCode!==undefined&&json.errorCode!==null&&json.errorCode!=='')&&!(json&&typeof json==='object'&&json.code!==undefined&&json.code!==200);
  if(ok){if(!id(json?.docId)||baseline.some(v=>same(v,json.docId)))throw Error('새 문서번호를 확인하지 못했습니다. 다시 생성하지 마세요.');record.docId=json.docId;record.state='created';currentRecords[binding.packetDigest]=record;data.yoofamSingleDocumentRecords=JSON.stringify(currentRecords);}
  return{ok,status:response.status,json,ownedRecord:record};
 }finally{clearTimeout(timer);}
}
