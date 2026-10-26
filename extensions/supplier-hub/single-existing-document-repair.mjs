/** Inspect/rebind only an accepted-create document from the durable checkpoint.
 * Missing page state never proves that an earlier update was not dispatched.
 * Binding requires a durable one-attempt reservation after explicit approval.
 * It preserves that uncertainty and performs no remote write itself.
 */
export async function singleExistingDocumentRepairPage(input){
 if(typeof input==='string')input=JSON.parse(input);
 const origin='https://supplier.coupang.com',root=document.documentElement;
 const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
 const same=(a,b)=>canon(a)===canon(b),hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canon(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
 const fail=message=>{throw Error(message);},binding=input?.binding,docId=input?.docId,body=input?.expectedBody,baseline=input?.baselineDocIds;
 const identifier=value=>Number.isSafeInteger(value)&&value>0||typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
 if(!['inspect','bind'].includes(input?.mode)||!binding||!identifier(docId)||!body||!same(body.docId,docId)||body.scope!=='Retail_Categorized_Single'
  ||input.operationId!==binding.requestId+':update'||!Array.isArray(baseline)||baseline.some(id=>String(id)===String(docId))
  ||!['identityDigest','packetDigest','preparedBodySha256','nativeAssetSourcePlanSha256'].every(key=>/^[a-f0-9]{64}$/.test(binding[key]||'')))fail('원래 생성된 문서의 복구 연결이 다릅니다.');
 const normalized=JSON.parse(JSON.stringify(body));normalized.docId=null;
 if(await hash(normalized)!==binding.preparedBodySha256)fail('원래 요청의 견적 본문이 변경되었습니다.');
 const check=()=>{
  if(location.origin!==origin||location.pathname!=='/dashboard/KR')fail('원래 전용 Supplier Hub 대시보드에서 복구해주세요.');
  const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
  if(codes.length!==1||codes[0]!==binding.identity?.company?.code||({A01526306:'유앤채',A01464742:'와이홉'})[codes[0]]!==binding.identity.company.name)fail('복구 문서의 승인 회사가 다릅니다.');
  let records;try{records=JSON.parse(root.dataset.yoofamSingleDocumentRecords||'{}');}catch{fail('현재 문서 기록을 확인할 수 없습니다.');}
  if(!records||Array.isArray(records)||Object.keys(records).length>1000||records[binding.packetDigest]||Object.values(records).some(record=>record?.binding?.requestId===binding.requestId||String(record?.docId)===String(docId)))fail('이 문서의 다른 작업 기록이 있어 덮어쓰지 않았습니다.');
  return records;
 };
 check();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
 const read=async(path,legal=false,allowBodyFailure=false)=>{
  check();const url=origin+path,response=await fetch(url,{method:legal?'POST':'GET',credentials:'include',redirect:'error',cache:'no-store',signal:controller.signal,
   headers:{accept:'application/json',...(legal?{'content-type':'application/json;charset=UTF-8'}:{})},...(legal?{body:'{}'}:{})});
  if(response.redirected||response.url!==url||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))fail('원래 문서 조회 응답의 출처를 확인하지 못했습니다.');
  const text=await response.text();if(text.length>6*1024*1024)fail('원래 문서 조회 응답이 너무 큽니다.');const json=JSON.parse(text);check();
  if(!response.ok){if(allowBodyFailure&&response.status===500&&json?.errorCode==='INTERNAL_SERVER_ERROR')return{unreadable:true,status:500,errorCode:json.errorCode};fail('원래 문서 조회에 실패했습니다. HTTP '+response.status);}
  return{unreadable:false,json};
 };
 try{
  const rows=(await read('/sr/draft/api/drafts')).json;
  if(!Array.isArray(rows)||rows.length>10000)fail('중간저장 문서 목록을 확인하지 못했습니다.');
  const matches=rows.filter(row=>same(row?.docId,docId));if(matches.length!==1||matches[0].status!=='UNFINISHED')fail('원래 문서가 중간저장 상태인지 확인해주세요.');
  const requested=(await read('/sr/draft/api/drafts/register-requested')).json;
  if(!Array.isArray(requested)||requested.length>10000)fail('제출요청 문서 목록을 확인하지 못했습니다.');
  if(rows.some(row=>!same(row.docId,docId)&&row.productName===body.productName)||requested.some(row=>String(row.docId)===String(docId)||row.productName===body.productName))fail('동일 상품의 다른 문서 또는 제출 기록이 있어 다시 저장하지 않았습니다.');
  const row=matches[0],fields=['productName','categoryPath','categoryId','displayCategoryCode','scope','productNoticeNumber','version','remark'].filter(key=>Object.hasOwn(body,key));
  if(fields.some(key=>!Object.hasOwn(row,key)||(['categoryId','displayCategoryCode','productNoticeNumber'].includes(key)?String(row[key])!==String(body[key]):!same(row[key],body[key]))))fail('원래 문서의 상품·카테고리·양식이 변경되어 복구하지 않았습니다.');
  const doc=encodeURIComponent(String(docId)),remoteBody=await read('/sr/draft/api/get-by-id/'+doc,false,true);
  if(!remoteBody.unreadable){const value=remoteBody.json,keys=Object.keys(body);if(!value||!same(value.docId,docId)||value.status!=='UNFINISHED'||!same(Object.fromEntries(keys.map(key=>[key,value[key]])),body))fail('서버 문서 본문이 원래 요청과 달라 덮어쓰지 않았습니다.');}
  const images=(await read('/sr/draft/api/get-images-by-id/'+doc)).json;
  if(!Array.isArray(images)||images.length)fail('원래 문서에 파일이 있어 자동으로 다시 업로드하지 않았습니다.');
  const legalTypes=['import_type','certificate','additional','categoryCert','adCert','msds'];
  for(const type of legalTypes){const files=(await read('/sr/draft/api/get-files-by-type/'+doc+'?fileType='+type,true)).json;if(!Array.isArray(files)||files.length)fail('원래 문서에 증빙 파일이 있어 덮어쓰지 않았습니다.');}
  const proof={format:'yoofam-existing-document-inspection-v1',requestId:binding.requestId,operationId:input.operationId,docId,identityDigest:binding.identityDigest,packetDigest:binding.packetDigest,
   preparedBodySha256:binding.preparedBodySha256,sourcePlanSha256:binding.nativeAssetSourcePlanSha256,metadataSha256:await hash(row),bodyState:remoteBody.unreadable?'server-unreadable':'original-exact',
   emptyImages:true,emptyLegalTypes:legalTypes,duplicateMatches:0,readOnly:true,remoteWrites:false,priorUpdateOutcome:'unknown',checkedAt:Date.now()};
  if(input.mode==='inspect')return JSON.stringify({proof,record:null});
  const audit=input.repair,prior=input.inspection;
  const retry=audit?.format==='yoofam-existing-document-repair-retry-v1';
  if(!audit||Object.keys(audit).sort().join(',')!==(retry?'attempt,docId,format,inspectionSha256,priorOperationId,priorRepair,priorSequence,startedAt':'attempt,docId,format,inspectionSha256,priorOperationId,priorSequence,startedAt')
   ||(retry?audit.attempt!==2||!audit.priorRepair||Object.keys(audit.priorRepair).sort().join(',')!=='attempt,docId,format,inspectionSha256,priorOperationId,priorSequence,startedAt'
      ||audit.priorRepair.format!=='yoofam-existing-document-repair-v1'||audit.priorRepair.attempt!==1||!same(audit.priorRepair.docId,docId)||audit.priorRepair.priorOperationId!==input.operationId
      ||!Number.isSafeInteger(audit.priorRepair.priorSequence)||audit.priorRepair.priorSequence<1||audit.priorRepair.priorSequence>=audit.priorSequence
      ||!Number.isSafeInteger(audit.priorRepair.startedAt)||audit.priorRepair.startedAt<1||audit.priorRepair.startedAt>audit.startedAt||!/^[a-f0-9]{64}$/.test(audit.priorRepair.inspectionSha256||'')
     :audit.format!=='yoofam-existing-document-repair-v1'||audit.attempt!==1)||!same(audit.docId,docId)
   ||audit.priorOperationId!==input.operationId||!Number.isSafeInteger(audit.priorSequence)||audit.priorSequence<1||!Number.isSafeInteger(audit.startedAt)||audit.startedAt>Date.now()+5000||Date.now()-audit.startedAt>180000
   ||!prior||await hash(prior)!==audit.inspectionSha256||prior.metadataSha256!==proof.metadataSha256||prior.bodyState!==proof.bodyState||prior.docId!==docId||prior.packetDigest!==proof.packetDigest
   ||prior.identityDigest!==proof.identityDigest||prior.requestId!==proof.requestId||prior.operationId!==proof.operationId||prior.sourcePlanSha256!==proof.sourcePlanSha256
   ||prior.preparedBodySha256!==proof.preparedBodySha256||prior.emptyImages!==true||!same(prior.emptyLegalTypes,legalTypes)||prior.priorUpdateOutcome!=='unknown')fail('원래 문서 복구 예약 또는 현재 파일 상태가 변경됐습니다.');
  const records=check(),record={binding,docId,createOperationId:binding.requestId+':create',state:'created',baselineDocIds:baseline,
   recoveryRepair:{...audit,priorUpdateOutcome:'unknown',emptyFilesObservedAt:proof.checkedAt}};
  records[binding.packetDigest]=record;root.dataset.yoofamSingleDocumentRecords=JSON.stringify(records);
  return JSON.stringify({proof,record});
 }finally{clearTimeout(timer);}
}
