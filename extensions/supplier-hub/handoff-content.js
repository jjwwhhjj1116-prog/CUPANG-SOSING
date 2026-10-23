// This script only runs on the three explicitly listed app origins.
window.addEventListener('message',async event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='YOOFAM_HUB_HANDOFF'||!/^[a-f0-9-]{36}$/.test(event.data.requestId||''))return;
  const {requestId,type}=event.data;
  if(!['PING','PREPARE','RESULT','TRANSMIT','VALIDATE','REFRESH','REGISTRATION','COMPANY_REGISTRATIONS','NATIVE_REGISTRATIONS','HISTORY','RECOMMEND_CATEGORIES','CATEGORIES','SCHEMA','TEMPLATE','SINGLE_DOCUMENT','PRODUCT_DOCUMENT'].includes(type))return;
  let result;
  try{
    const commands={PREPARE:'YOOFAM_PREPARE_PACKAGE',RESULT:'YOOFAM_GET_RESULT',TRANSMIT:'YOOFAM_TRANSMIT_PACKAGE',VALIDATE:'YOOFAM_RESUME_VALIDATION',REFRESH:'YOOFAM_REFRESH_RESULT',REGISTRATION:'YOOFAM_REFRESH_REGISTRATION',COMPANY_REGISTRATIONS:'YOOFAM_QUERY_COMPANY_REGISTRATIONS',NATIVE_REGISTRATIONS:'YOOFAM_QUERY_NATIVE_REGISTRATIONS',HISTORY:'YOOFAM_GET_PRODUCT_TRANSMISSIONS',RECOMMEND_CATEGORIES:'YOOFAM_RECOMMEND_CATEGORIES',CATEGORIES:'YOOFAM_READ_CATEGORY_BRANCH',SCHEMA:'YOOFAM_READ_CATEGORY_SCHEMA',TEMPLATE:'YOOFAM_READ_CATEGORY_TEMPLATE',SINGLE_DOCUMENT:'YOOFAM_SINGLE_DOCUMENT_REQUEST',PRODUCT_DOCUMENT:'YOOFAM_PRODUCT_DOCUMENT_REQUEST'};
    const version=type==='PING'?chrome.runtime.getManifest().version:'';
    const [major,minor,patch]=version.split('.').map(Number);
    // An app reload may inject updated disk content while the old unpacked
    // worker is still loaded. Do not advertise the new store action until the
    // installed manifest has been reloaded to its actual supporting release.
    const originalFileObservationCas=major>0||major===0&&(minor>2||minor===2&&patch>=64);
    const productDocumentPreview=major>0||major===0&&(minor>2||minor===2&&patch>=79);
    const existingProductProbe=major>0||major===0&&(minor>2||minor===2&&patch>=81);
    const categoryRecommendations=major>2||major===2&&(minor>1||minor===1&&patch>=1);
    const nativeRegistrationStatus=major>2||major===2&&(minor>1||minor===1&&patch>=4);
    result=type==='PING'?{ok:true,version,categoryCatalog:true,categoryRecommendations,categorySchema:true,categoryTemplate:true,categoryExcelSchema:true,legalDocumentAttachments:true,validationResume:true,companyMenuRecovery:true,attachmentLifecycleRecovery:true,exactAgreementLabels:true,acceptedReceiptRefreshRecovery:true,pendingReceiptRefreshRecovery:true,registrationObservationCas:true,originalFileObservationCas,productDocumentPreview,existingProductProbe,nativeRegistrationStatus,productTransmissionHistory:true,historicalReceiptLookup:true,resultTableRefreshObservation:true,popupWindowBinding:true,publicMobileCapture:true,publicSingleSkuCapture:true,companyRegistrationStatus:true,companyBinding:true,directTransmission:true,latestSourceBinding:true,savedSubmission:true,durableAttachmentRecovery:true,imageIntegrityBinding:true,registrationLookup:true,registrationPages:true,serverReceiptRecovery:true,serverReceiptReplayProtection:true}:await chrome.runtime.sendMessage({...event.data.payload,type:commands[type]});
  }catch{result={ok:false,error:'확장 연결을 새로고침한 뒤 다시 준비해주세요.'};}
  window.postMessage({channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId,result},location.origin);
});
async function verifyCurrentQuotationSource(expected){
  const allowed=['https://sourceflow.jjwwhhjj1116.workers.dev','http://localhost:3000','http://127.0.0.1:3000'];
  if(!allowed.includes(location.origin)||expected?.origin!==location.origin
    ||!/^\w[\w-]{0,99}$/.test(expected.productId||'')||!/^\d{1,20}$/.test(expected.categoryId||'')
    ||!/^\w[\w-]{0,99}$/.test(expected.profileId||'')||!/^[a-f0-9]{64}$/.test(expected.fingerprint||'')
    ||expected.filename!==`YOOFAM-${expected.fingerprint}.xlsx`
    ||!Object.hasOwn({A01526306:'유앤채',A01464742:'와이홉'},expected.company?.code)
    ||({A01526306:'유앤채',A01464742:'와이홉'})[expected.company.code]!==expected.company.name
    ||(expected.includedOptions!==undefined&&(!Number.isSafeInteger(expected.includedOptions)||expected.includedOptions<1||expected.includedOptions>200)))
    throw Error('현재 앱의 견적서 저장본 요청인지 확인하지 못했습니다.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
    const path=`/api/products/${encodeURIComponent(expected.productId)}/quotation`;
    const response=await fetch(path,{method:'POST',cache:'no-store',credentials:'same-origin',redirect:'error',signal:controller.signal,
      headers:{'content-type':'application/json'},body:JSON.stringify({action:'source',profileId:expected.profileId})});
    if(!response.ok)throw Error('최신 견적서 저장본을 확인하지 못했습니다. 앱에서 다시 준비해주세요.');
    const responseUrl=new URL(response.url);
    if(response.redirected||responseUrl.origin!==location.origin||responseUrl.pathname!==path)
      throw Error('앱의 견적서 확인 화면이 변경되었습니다.');
    const text=await response.text();if(text.length>64000)throw Error('견적서 확인 응답이 허용 크기를 초과했습니다.');
    let body;try{body=JSON.parse(text);}catch{throw Error('견적서 확인 응답을 읽지 못했습니다.');}
    if(controller.signal.aborted)throw Error('견적서 저장본 확인 시간이 초과됐습니다.');
    if(body?.fingerprint!==expected.fingerprint||body.filename!==expected.filename
      ||body.report?.productId!==expected.productId||body.report.categoryId!==expected.categoryId
      ||body.report.profileId!==expected.profileId||body.report.submissionReady!==false
      ||body.report.company?.code!==expected.company.code||body.report.company?.name!==expected.company.name
      ||(expected.includedOptions!==undefined&&body.report.rowCount!==expected.includedOptions))
      throw Error('견적서 준비 이후 저장값 또는 회사정보가 변경되었습니다. 앱에서 다시 준비해주세요.');
    return {ok:true,productId:expected.productId,categoryId:expected.categoryId,profileId:expected.profileId,
      fingerprint:expected.fingerprint,filename:expected.filename,company:{code:body.report.company.code,name:body.report.company.name},
      ...(expected.includedOptions!==undefined?{includedOptions:body.report.rowCount}:{}),checkedAt:Date.now()};
  }finally{clearTimeout(timer);}
}
async function readCurrentQuotationReceipt(expected,acceptedOnly=true,historical=false){
  const allowed=['https://sourceflow.jjwwhhjj1116.workers.dev','http://localhost:3000','http://127.0.0.1:3000'];
  if(!allowed.includes(location.origin)||expected?.origin!==location.origin||!/^\w[\w-]{0,99}$/.test(expected.productId||'')
    ||!/^\d{1,20}$/.test(expected.categoryId||'')||!/^[a-f0-9]{64}$/.test(expected.fingerprint||''))
    throw Error('현재 앱의 접수 결과 요청을 확인하지 못했습니다.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);let receipt;
  try{
    const path=`/api/products/${encodeURIComponent(expected.productId)}/supplier-hub-receipt`,search=`?fingerprint=${expected.fingerprint}`;
    const response=await fetch(path+search,{method:'GET',cache:'no-store',credentials:'same-origin',redirect:'error',signal:controller.signal});
    if(!response.ok)throw Error('보관된 접수 결과를 읽지 못했습니다.');
    const url=new URL(response.url);
    if(response.redirected||url.origin!==location.origin||url.pathname!==path||url.search!==search)throw Error('접수 결과 확인 화면이 변경되었습니다.');
    const text=await response.text();if(text.length>1024*1024)throw Error('접수 결과 응답이 허용 크기를 초과했습니다.');
    let body;try{body=JSON.parse(text);}catch{throw Error('접수 결과 응답을 읽지 못했습니다.');}
    if(controller.signal.aborted)throw Error('접수 결과 확인 시간이 초과됐습니다.');
    receipt=body?.receipt;
  }finally{clearTimeout(timer);}
  const identity={origin:expected.origin,productId:expected.productId,categoryId:expected.categoryId,fingerprint:expected.fingerprint};
  if(receipt===null)return {ok:true,...identity,receipt:null,checkedAt:Date.now()};
  const result=receipt?.result;
  if(receipt?.schemaVersion!==1||receipt.evidence!=='chrome-observation'||!/^\w[\w-]{0,99}$/.test(receipt.profileId||'')
    ||receipt.categoryId!==expected.categoryId||receipt.fingerprint!==expected.fingerprint
    ||result?.filename!==`YOOFAM-${expected.fingerprint}.xlsx`||!['validation-complete','validation-pending','validation-rejected'].includes(result.state)||result.registered!==false
    ||(acceptedOnly&&result.state!=='validation-complete')
    ||(result.state==='validation-complete'&&(typeof result.quotationId!=='string'||!result.quotationId.trim()||result.quotationId!==result.quotationId.trim()||result.quotationId.length>200))
    ||['submittedAt','status','detail','quotationId'].some(field=>result[field]!==undefined&&(typeof result[field]!=='string'||result[field].length>20000))
    ||!Number.isSafeInteger(result.includedOptions)||result.includedOptions<1||result.includedOptions>200
    ||!Number.isSafeInteger(result.observedAt)||result.observedAt<=0||result.observedAt>Date.now()+60000
    ||!Object.hasOwn({A01526306:'유앤채',A01464742:'와이홉'},result.company?.code)
    ||({A01526306:'유앤채',A01464742:'와이홉'})[result.company.code]!==result.company.name)
    throw Error('완료된 파일 검증 결과와 접수 ID를 확인하지 못했습니다.');
  const company={code:result.company.code,name:result.company.name};
  if(historical){
    if(!Number.isFinite(Date.parse(receipt.productVersion))||!Number.isFinite(Date.parse(receipt.recordedAt)))throw Error('원래 전송의 저장 버전을 확인하지 못했습니다.');
    const member=await readCurrentCatalogContext();
    if(member.company?.code!==company.code||member.company?.name!==company.name)throw Error('원래 견적서를 전송한 회사로 로그인한 앱에서 결과를 확인해주세요.');
  }else await verifyCurrentQuotationSource({...identity,profileId:receipt.profileId,filename:result.filename,company,includedOptions:result.includedOptions});
  return {ok:true,...identity,checkedAt:Date.now(),receipt:{schemaVersion:1,evidence:'chrome-observation',profileId:receipt.profileId,
    categoryId:receipt.categoryId,fingerprint:receipt.fingerprint,...(historical?{productVersion:receipt.productVersion,recordedAt:receipt.recordedAt}:{}),result:{company,includedOptions:result.includedOptions,filename:result.filename,
      state:result.state,registered:false,observedAt:result.observedAt,
      ...Object.fromEntries(['submittedAt','status','detail','quotationId'].filter(field=>result[field]!==undefined).map(field=>[field,result[field]]))}}};
}
async function readCurrentProductTransmissionHistory(expected){
  if(expected?.origin!==location.origin||!/^\w[\w-]{0,99}$/.test(expected.productId||''))throw Error('상품 전송 이력 요청을 확인해주세요.');
  const path=`/api/products/${encodeURIComponent(expected.productId)}/supplier-hub-receipt?mode=history`,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
    const response=await fetch(path,{method:'GET',cache:'no-store',credentials:'same-origin',redirect:'error',signal:controller.signal});
    if(!response.ok||response.redirected||response.url!==location.origin+path)throw Error('상품의 전체 전송 이력을 읽지 못했습니다.');
    const text=await response.text();if(text.length>512*1024)throw Error('상품의 전송 이력이 허용 크기를 초과했습니다.');
    const history=JSON.parse(text)?.history;
    if(controller.signal.aborted||!history||history.schemaVersion!==1||history.productId!==expected.productId||typeof history.blocked!=='boolean'||!Array.isArray(history.receipts)||history.receipts.length>200
        ||new Set(history.receipts.map(receipt=>receipt?.fingerprint)).size!==history.receipts.length
        ||history.receipts.some(receipt=>receipt?.schemaVersion!==1||receipt.evidence!=='chrome-observation'||!/^[a-f0-9]{64}$/.test(receipt.fingerprint||'')
        ||!/^\d{1,20}$/.test(receipt.categoryId||'')||!/^\w[\w-]{0,99}$/.test(receipt.profileId||'')||!Number.isFinite(Date.parse(receipt.productVersion))
          ||!Number.isFinite(Date.parse(receipt.recordedAt))||receipt.result?.filename!==`YOOFAM-${receipt.fingerprint}.xlsx`||receipt.result.registered!==false||!['validation-pending','validation-complete','validation-rejected'].includes(receipt.result.state)
          ||!Number.isSafeInteger(receipt.result.includedOptions)||receipt.result.includedOptions<1||receipt.result.includedOptions>200
          ||!Number.isSafeInteger(receipt.result.observedAt)||receipt.result.observedAt<=0||receipt.result.observedAt>Date.now()+60000
          ||!Object.hasOwn({A01464742:'와이홉',A01526306:'유앤채'},receipt.result.company?.code)||({A01464742:'와이홉',A01526306:'유앤채'})[receipt.result.company.code]!==receipt.result.company.name
          ||['submittedAt','status','detail','quotationId'].some(key=>receipt.result[key]!==undefined&&(typeof receipt.result[key]!=='string'||receipt.result[key].length>20000))
          ||receipt.result.state==='validation-complete'&&(typeof receipt.result.quotationId!=='string'||!receipt.result.quotationId.trim()||receipt.result.quotationId!==receipt.result.quotationId.trim()||receipt.result.quotationId.length>200||/\.\.\.|…/.test(receipt.result.quotationId)))
      ||history.blocked!==history.receipts.some(receipt=>receipt.result.state!=='validation-rejected'||Boolean(receipt.result.quotationId)||receipt.result.registration!==undefined))throw Error('상품의 전송 이력과 상태가 일치하지 않습니다.');
    return {ok:true,origin:location.origin,productId:expected.productId,history,checkedAt:Date.now()};
  }finally{clearTimeout(timer);}
}
async function readCurrentCatalogContext(){
  const path='/api/supplier-hub/catalog-context',controller=new AbortController();let timer;
  const failure=(code,message)=>Object.assign(Error(message),{code});
  try{
    // Keep every authorization fence fresh. A request started before another
    // capture's ACK must not be shared with its post-ACK identity check.
    return await Promise.race([(async()=>{
      const response=await fetch(path,{method:'GET',cache:'no-store',credentials:'same-origin',redirect:'error',signal:controller.signal});
      if(response.redirected||response.url!==location.origin+path)throw failure('YOOFAM_CONTEXT_INVALID','회원 회사정보 응답의 앱 출처가 다릅니다.');
      if(response.status===401)throw failure('YOOFAM_LOGIN_REQUIRED','YOOFAM 회원 로그인이 필요합니다.');
      if(response.status===403)throw failure('YOOFAM_COMPANY_REQUIRED','계정 관리에서 승인된 회사코드·회사명을 확인해주세요.');
      if(!response.ok)throw failure('YOOFAM_CONTEXT_SERVICE_ERROR','YOOFAM 서버의 회원 회사정보 요청에 실패했습니다.');
      const contentType=response.headers?.get('content-type');
      if(contentType&&!/^application\/json(?:\s*;|$)/i.test(contentType))throw failure('YOOFAM_CONTEXT_INVALID','회원 회사정보 응답 형식이 올바르지 않습니다.');
      const text=await response.text();if(text.length>4096)throw failure('YOOFAM_CONTEXT_INVALID','회원 회사정보 응답이 올바르지 않습니다.');
      let result;try{result=JSON.parse(text);}catch{throw failure('YOOFAM_CONTEXT_INVALID','회원 회사정보 응답을 읽지 못했습니다.');}
      const companies={A01526306:'유앤채',A01464742:'와이홉'};
      if(!/^\w[\w-]{0,99}$/.test(result?.ownerId||'')||typeof result.ownerId!=='string'||!Object.hasOwn(companies,result.company?.code)||companies[result.company.code]!==result.company.name)throw failure('YOOFAM_CONTEXT_INVALID','회원 회사정보 응답이 올바르지 않습니다.');
      if(controller.signal.aborted)throw failure('YOOFAM_CONTEXT_TIMEOUT','회원 회사정보 확인 시간이 초과됐습니다.');
      return {ok:true,ownerId:result.ownerId,company:{code:result.company.code,name:result.company.name}};
    })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(failure('YOOFAM_CONTEXT_TIMEOUT','회원 회사정보 확인 시간이 초과됐습니다.'));},10000);})]);
  }catch(error){
    if(typeof error?.code==='string'&&error.code.startsWith('YOOFAM_'))throw error;
    if(controller.signal.aborted)throw failure('YOOFAM_CONTEXT_TIMEOUT','회원 회사정보 확인 시간이 초과됐습니다.');
    throw failure('YOOFAM_CONTEXT_SERVICE_ERROR','YOOFAM 서버에 연결하지 못했습니다. 앱 연결 상태를 확인해주세요.');
  }finally{clearTimeout(timer);}
}
/** Resolves an exact stored native document through authenticated app GETs.
 * Caller-supplied request IDs or bodies alone never authorize Hub queries. */
async function readCurrentNativeReceiptScope(expected){
 const identifier=value=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=200&&!/[\u0000-\u001f]|\.\.\.|…/.test(value)||Number.isSafeInteger(value)&&value>0;
 if(expected?.origin!==location.origin||!/^(?:https:\/\/sourceflow\.jjwwhhjj1116\.workers\.dev|http:\/\/(?:localhost|127\.0\.0\.1):3000)$/.test(location.origin)||!/^\w[\w-]{0,99}$/.test(expected.productId||'')
  ||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(expected.requestId||'')||!/^[a-f0-9]{64}$/.test(expected.identityDigest||'')||!/^[a-f0-9]{64}$/.test(expected.preparedBodySha256||''))throw Error('원래 문서 접수 기록 선택값을 확인해주세요.');
 const before=await readCurrentCatalogContext(),path='/api/products/'+encodeURIComponent(expected.productId)+'/supplier-hub-product-receipt',controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch(path,{method:'GET',cache:'no-store',credentials:'same-origin',redirect:'error',signal:controller.signal,headers:{accept:'application/json'}});
  if(!response.ok||response.redirected||response.url!==location.origin+path||!/^application\/json(?:\s*;[^\r\n]*)?$/i.test(response.headers.get('content-type')||''))throw Error('보관된 원래 문서 접수 JSON을 읽지 못했습니다.');
  const text=await response.text();if(new TextEncoder().encode(text).length>6*1024*1024)throw Error('문서 접수 이력이 너무 큽니다.');const history=JSON.parse(text);
  if(history?.format!=='yoofam-native-receipt-history-v1'||history.productId!==expected.productId||!Array.isArray(history.receipts)||history.receipts.length>200)throw Error('보관된 문서 접수 이력 형식이 다릅니다.');
  const matches=history.receipts.filter(row=>row?.requestId===expected.requestId);if(matches.length!==1)throw Error('선택한 원래 문서 접수 기록이 없거나 중복되었습니다.');
  const row=matches[0],identity=row.identity,receipt=row.receipt,company=before.company,members=row.members;
  if(row.format!=='yoofam-product-document-receipt-v1'||row.recordType!=='product-document'||row.evidence!=='chrome-observation'||row.registered!==false||row.productId!==expected.productId||row.identityDigest!==expected.identityDigest||row.preparedBodySha256!==expected.preparedBodySha256
   ||identity?.ownerId!==before.ownerId||identity.origin!==location.origin||identity.productId!==row.productId||identity.categoryId!==row.categoryId||!/^\d{1,20}$/.test(row.categoryId||'')||row.categoryId==='0'
   ||!/^\w[\w-]{0,99}$/.test(before.ownerId||'')||({A01526306:'유앤채',A01464742:'와이홉'})[company?.code]!==company?.name||row.company?.code!==company.code||row.company?.name!==company.name||identity.company?.code!==company.code||identity.company?.name!==company.name
   ||!Array.isArray(members)||members.length<1||members.length>200||JSON.stringify(members)!==JSON.stringify(identity.members)||new Set(members.map(member=>member?.optionId)).size!==members.length||members.some((member,index)=>!/^\w[\w-]{0,99}$/.test(member?.optionId||'')||typeof member.optionLabel!=='string'||member.documentIndex!==index)
   ||!identifier(row.docId)||receipt?.docId!==row.docId||!identifier(receipt.qvtRequestId)||receipt.receiptId!==receipt.qvtRequestId||receipt.evidence!=='document-receipt'||receipt.registered!==false||!['SUBMITTED','FINISHED','REJECTED'].includes(receipt.sourceStatus)
   ||receipt.state!==({SUBMITTED:'pending',FINISHED:'accepted',REJECTED:'rejected'})[receipt.sourceStatus]||receipt.company?.code!==company.code||receipt.company?.name!==company.name||receipt.identityDigest!==row.identityDigest||receipt.preparedBodySha256!==row.preparedBodySha256
   ||!Number.isSafeInteger(receipt.observedAt)||receipt.observedAt<1||receipt.observedAt>Date.now()+5000||typeof row.recordedAt!=='string'||!Number.isFinite(Date.parse(row.recordedAt))||Date.parse(row.recordedAt)>Date.now()+5000
   ||typeof row.source?.productVersion!=='string'||!Number.isFinite(Date.parse(row.source.productVersion))||Date.parse(row.source.productVersion)>receipt.observedAt||JSON.stringify(row.source)!==JSON.stringify(identity.source))throw Error('원래 문서 접수의 회원·회사·본문·포함 옵션 연결이 다릅니다.');
  const after=await readCurrentCatalogContext();if(controller.signal.aborted||JSON.stringify(after)!==JSON.stringify(before))throw Error('문서 접수 조회 중 로그인 회원·회사가 변경되었습니다.');
  return {ok:true,scope:{productId:row.productId,requestId:row.requestId,docId:row.docId,qvtRequestId:receipt.qvtRequestId,sourceStatus:receipt.sourceStatus,company:{code:company.code,name:company.name},ownerId:before.ownerId,categoryId:row.categoryId,membersCount:members.length,
   recordedAt:row.recordedAt,receiptObservedAt:receipt.observedAt,sourceProductVersion:row.source.productVersion,identityDigest:row.identityDigest,preparedBodySha256:row.preparedBodySha256}};
 }finally{clearTimeout(timer);}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type==='YOOFAM_READ_NATIVE_RECEIPT_SCOPE'&&sender?.id===chrome.runtime.id){void readCurrentNativeReceiptScope(message.expected).then(respond,error=>respond({ok:false,error:error?.message||'원래 문서 접수 확인 실패'}));return true;}
  if(message?.type==='YOOFAM_SAVE_SOURCE_CAPTURE'&&sender?.id===chrome.runtime.id){
    void savePageSourceInApp(message.record).then(respond,error=>respond({ok:false,error:error?.message||'웹 수집함 저장 확인 실패'}));return true;
  }
  if(!['YOOFAM_VERIFY_QUOTATION_SOURCE','YOOFAM_READ_QUOTATION_RECEIPT','YOOFAM_READ_TRANSMISSION_RECEIPT','YOOFAM_READ_CATALOG_CONTEXT','YOOFAM_READ_HISTORICAL_TRANSMISSION_RECEIPT','YOOFAM_READ_PRODUCT_TRANSMISSION_HISTORY'].includes(message?.type)||sender?.id!==chrome.runtime.id)return;
  if(message.type==='YOOFAM_READ_CATALOG_CONTEXT'){void readCurrentCatalogContext().then(respond,error=>respond({ok:false,error:error?.message||'회원 회사정보 확인 실패',code:error?.code||'YOOFAM_CONTEXT_SERVICE_ERROR'}));return true;}
  if(message.type==='YOOFAM_READ_PRODUCT_TRANSMISSION_HISTORY'){void readCurrentProductTransmissionHistory(message.expected).then(respond,error=>respond({ok:false,error:error?.message||'전체 전송 이력 확인 실패'}));return true;}
  if(message.type==='YOOFAM_READ_HISTORICAL_TRANSMISSION_RECEIPT'){void readCurrentQuotationReceipt(message.expected,false,true).then(respond,error=>respond({ok:false,error:error?.message||'원래 전송 결과 확인 실패'}));return true;}
  const read=message.type==='YOOFAM_READ_TRANSMISSION_RECEIPT'?expected=>readCurrentQuotationReceipt(expected,false)
    :message.type==='YOOFAM_READ_QUOTATION_RECEIPT'?readCurrentQuotationReceipt:verifyCurrentQuotationSource;
  void read(message.expected).then(respond,error=>respond({ok:false,error:error?.message||'견적서 저장본 확인 실패'}));
  return true;
});
function sourceStoredReceipt(result,record){
  // Older app servers did not advertise storage diagnostics. Never invent a
  // receipt from the echoed request identity or a local clock in that case.
  if(!['receivedAt','collectedAt','sourceUrl'].some(key=>Object.hasOwn(result,key)))return undefined;
  const timestamp=value=>{
    if(typeof value!=='string'||value.length>40||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value))return null;
    const time=Date.parse(value),canonical=value.replace(/(?:\.(\d{1,3}))?Z$/,(_match,decimal)=>'.'+(decimal||'').padEnd(3,'0')+'Z');
    return Number.isFinite(time)&&time>0&&time<=Date.now()+60000&&new Date(time).toISOString()===canonical?time:null;
  };
  const received=timestamp(result.receivedAt),collected=timestamp(result.collectedAt);let source;
  try{source=new URL(result.sourceUrl);}catch{throw Error('실제 저장된 수집본의 주소를 확인하지 못했습니다.');}
  if(!/^https:\/\/detail\.1688\.com\/offer\/\d{1,20}\.html$/.test(result.sourceUrl)||source.href!==result.sourceUrl||result.sourceUrl!==record.snapshot?.sourceUrl
    ||!/^[a-f0-9-]{36}$/.test(result.storedId||'')||result.storedFingerprint!==record.fingerprint
    ||!Number.isSafeInteger(result.captureVersion)||result.captureVersion<1||received===null||collected===null||received<collected-60000
    ||result.collectedAt!==record.snapshot?.collectedAt)throw Error('실제 저장된 수집본의 버전·시각·원문 확인값이 다릅니다.');
  return {ownerId:record.ownerId,company:{code:record.company.code,name:record.company.name},sourceUrl:result.sourceUrl,fingerprint:result.storedFingerprint,
    storedId:result.storedId,captureVersion:result.captureVersion,receivedAt:result.receivedAt,collectedAt:result.collectedAt};
}
async function savePageSourceInApp(record){
  if(record?.origin!==location.origin||!/^[a-f0-9-]{36}$/.test(record?.id||'')||!/^[a-f0-9]{64}$/.test(record?.fingerprint||''))throw Error('수집 원문 전달 요청을 확인해주세요.');
  const before=await readCurrentCatalogContext();
  if(before.ownerId!==record.ownerId||before.company?.code!==record.company?.code||before.company?.name!==record.company?.name)throw Error('수집 당시 로그인 회원·회사가 다릅니다.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    const path='/api/source-inbox',response=await fetch(path,{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:record.ownerId,expectedCompany:record.company,id:record.id,fingerprint:record.fingerprint,snapshot:record.snapshot})});
    if(response.redirected||response.url!==location.origin+path)throw Error('수집함 저장 화면이 변경되었습니다.');
    const raw=await response.text();if(raw.length>600000)throw Error('수집함 저장 응답이 너무 큽니다.');const result=JSON.parse(raw);
    if(!response.ok||result.ok!==true)throw Error(result.error||'웹 수집함 저장을 확인하지 못했습니다.');
    if(result.id!==record.id||result.fingerprint!==record.fingerprint||result.ownerId!==record.ownerId||result.company?.code!==record.company.code||result.company?.name!==record.company.name)throw Error('수집함 저장 결과가 요청과 다릅니다.');
    const storedReceipt=sourceStoredReceipt(result,record);
    window.postMessage({channel:'YOOFAM_SOURCE_INBOX_UPDATED'},location.origin);
    return {ok:true,id:result.id,fingerprint:result.fingerprint,ownerId:result.ownerId,company:result.company,duplicate:result.duplicate===true,...(storedReceipt?{storedReceipt}:{})};
  }finally{clearTimeout(timer);}
}
window.addEventListener('message',async event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='YOOFAM_1688_CAPTURE'||!['CAPTURE','PROBE','CANCEL'].includes(event.data?.type)||!/^[a-f0-9-]{36}$/.test(event.data.requestId||''))return;
  let result;
  try{result=await chrome.runtime.sendMessage({type:event.data.type==='CANCEL'?'YOOFAM_CANCEL_1688':event.data.type==='PROBE'?'YOOFAM_PROBE_1688':'YOOFAM_CAPTURE_1688',requestId:event.data.requestId,sourceUrl:event.data.sourceUrl});}
  catch{result={ok:false,error:'상품 수집 확장을 다시 로드하고 앱 페이지를 새로고침해주세요.'};}
  if(event.data.type!=='CANCEL')window.postMessage({channel:'YOOFAM_1688_CAPTURE_RESULT',requestId:event.data.requestId,result},location.origin);
});
window.addEventListener('message',async event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='YOOFAM_SOURCE_INBOX'||event.data.type!=='FLUSH'||!/^[a-f0-9-]{36}$/.test(event.data.requestId||''))return;
  let result;try{result=await chrome.runtime.sendMessage({type:'YOOFAM_FLUSH_PAGE_SOURCES'});}catch{result={ok:false,error:'현재 Chrome의 YOOFAM 확장을 확인해주세요.'};}
  window.postMessage({channel:'YOOFAM_SOURCE_INBOX_RESULT',requestId:event.data.requestId,result},location.origin);
});
