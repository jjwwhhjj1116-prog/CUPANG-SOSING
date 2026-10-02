// This script only runs on the three explicitly listed app origins.
window.addEventListener('message',async event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='YOOFAM_HUB_HANDOFF'||!/^[a-f0-9-]{36}$/.test(event.data.requestId||''))return;
  const {requestId,type}=event.data;
  if(!['PING','PREPARE','RESULT','TRANSMIT','REFRESH','REGISTRATION','CATEGORIES','SCHEMA','TEMPLATE'].includes(type))return;
  let result;
  try{
    const commands={PREPARE:'YOOFAM_PREPARE_PACKAGE',RESULT:'YOOFAM_GET_RESULT',TRANSMIT:'YOOFAM_TRANSMIT_PACKAGE',REFRESH:'YOOFAM_REFRESH_RESULT',REGISTRATION:'YOOFAM_REFRESH_REGISTRATION',CATEGORIES:'YOOFAM_READ_CATEGORY_BRANCH',SCHEMA:'YOOFAM_READ_CATEGORY_SCHEMA',TEMPLATE:'YOOFAM_READ_CATEGORY_TEMPLATE'};
    result=type==='PING'?{ok:true,version:'0.2.38',categoryCatalog:true,categorySchema:true,categoryTemplate:true,legalDocumentAttachments:true,publicMobileCapture:true,companyBinding:true,directTransmission:true,latestSourceBinding:true,savedSubmission:true,durableAttachmentRecovery:true,imageIntegrityBinding:true,registrationLookup:true,registrationPages:true,serverReceiptRecovery:true,serverReceiptReplayProtection:true}:await chrome.runtime.sendMessage({...event.data.payload,type:commands[type]});
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
async function readCurrentQuotationReceipt(expected,acceptedOnly=true){
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
  await verifyCurrentQuotationSource({...identity,profileId:receipt.profileId,filename:result.filename,company,includedOptions:result.includedOptions});
  return {ok:true,...identity,checkedAt:Date.now(),receipt:{schemaVersion:1,evidence:'chrome-observation',profileId:receipt.profileId,
    categoryId:receipt.categoryId,fingerprint:receipt.fingerprint,result:{company,includedOptions:result.includedOptions,filename:result.filename,
      state:result.state,registered:false,observedAt:result.observedAt,
      ...Object.fromEntries(['submittedAt','status','detail','quotationId'].filter(field=>result[field]!==undefined).map(field=>[field,result[field]]))}}};
}
async function readCurrentCatalogContext(){
  const path='/api/supplier-hub/catalog-context',controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
    const response=await fetch(path,{method:'GET',cache:'no-store',credentials:'same-origin',redirect:'error',signal:controller.signal});
    if(!response.ok||response.redirected||response.url!==location.origin+path)throw Error('승인된 회원 회사정보를 확인하지 못했습니다.');
    const text=await response.text();if(text.length>4096)throw Error('회원 회사정보 응답이 올바르지 않습니다.');
    const result=JSON.parse(text);
    if(controller.signal.aborted)throw Error('회원 회사정보 확인 시간이 초과됐습니다.');
    return {ok:true,ownerId:result.ownerId,company:result.company};
  }finally{clearTimeout(timer);}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!['YOOFAM_VERIFY_QUOTATION_SOURCE','YOOFAM_READ_QUOTATION_RECEIPT','YOOFAM_READ_TRANSMISSION_RECEIPT','YOOFAM_READ_CATALOG_CONTEXT'].includes(message?.type)||sender?.id!==chrome.runtime.id)return;
  if(message.type==='YOOFAM_READ_CATALOG_CONTEXT'){void readCurrentCatalogContext().then(respond,error=>respond({ok:false,error:error?.message||'회원 회사정보 확인 실패'}));return true;}
  const read=message.type==='YOOFAM_READ_TRANSMISSION_RECEIPT'?expected=>readCurrentQuotationReceipt(expected,false)
    :message.type==='YOOFAM_READ_QUOTATION_RECEIPT'?readCurrentQuotationReceipt:verifyCurrentQuotationSource;
  void read(message.expected).then(respond,error=>respond({ok:false,error:error?.message||'견적서 저장본 확인 실패'}));
  return true;
});
window.addEventListener('message',async event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='YOOFAM_1688_CAPTURE'||!['CAPTURE','CANCEL'].includes(event.data?.type)||!/^[a-f0-9-]{36}$/.test(event.data.requestId||''))return;
  let result;
  try{result=await chrome.runtime.sendMessage({type:event.data.type==='CANCEL'?'YOOFAM_CANCEL_1688':'YOOFAM_CAPTURE_1688',requestId:event.data.requestId,sourceUrl:event.data.sourceUrl});}
  catch{result={ok:false,error:'상품 수집 확장을 다시 로드하고 앱 페이지를 새로고침해주세요.'};}
  if(event.data.type==='CAPTURE')window.postMessage({channel:'YOOFAM_1688_CAPTURE_RESULT',requestId:event.data.requestId,result},location.origin);
});
