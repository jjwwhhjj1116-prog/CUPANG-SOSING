// This script only runs on the three explicitly listed app origins.
window.addEventListener('message',async event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='YOOFAM_HUB_HANDOFF'||!/^[a-f0-9-]{36}$/.test(event.data.requestId||''))return;
  const {requestId,type}=event.data;
  if(!['PING','PREPARE','RESULT','TRANSMIT','REFRESH','REGISTRATION'].includes(type))return;
  let result;
  try{
    const commands={PREPARE:'YOOFAM_PREPARE_PACKAGE',RESULT:'YOOFAM_GET_RESULT',TRANSMIT:'YOOFAM_TRANSMIT_PACKAGE',REFRESH:'YOOFAM_REFRESH_RESULT',REGISTRATION:'YOOFAM_REFRESH_REGISTRATION'};
    result=type==='PING'?{ok:true,version:'0.2.30',publicMobileCapture:true,companyBinding:true,directTransmission:true,latestSourceBinding:true,savedSubmission:true,durableAttachmentRecovery:true,registrationLookup:true,registrationPages:true}:await chrome.runtime.sendMessage({...event.data.payload,type:commands[type]});
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
    ||({A01526306:'유앤채',A01464742:'와이홉'})[expected.company.code]!==expected.company.name)
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
      ||body.report.company?.code!==expected.company.code||body.report.company?.name!==expected.company.name)
      throw Error('견적서 준비 이후 저장값 또는 회사정보가 변경되었습니다. 앱에서 다시 준비해주세요.');
    return {ok:true,productId:expected.productId,categoryId:expected.categoryId,profileId:expected.profileId,
      fingerprint:expected.fingerprint,filename:expected.filename,company:{code:body.report.company.code,name:body.report.company.name},checkedAt:Date.now()};
  }finally{clearTimeout(timer);}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=='YOOFAM_VERIFY_QUOTATION_SOURCE'||sender?.id!==chrome.runtime.id)return;
  void verifyCurrentQuotationSource(message.expected).then(respond,error=>respond({ok:false,error:error?.message||'견적서 저장본 확인 실패'}));
  return true;
});
window.addEventListener('message',async event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='YOOFAM_1688_CAPTURE'||!['CAPTURE','CANCEL'].includes(event.data?.type)||!/^[a-f0-9-]{36}$/.test(event.data.requestId||''))return;
  let result;
  try{result=await chrome.runtime.sendMessage({type:event.data.type==='CANCEL'?'YOOFAM_CANCEL_1688':'YOOFAM_CAPTURE_1688',requestId:event.data.requestId,sourceUrl:event.data.sourceUrl});}
  catch{result={ok:false,error:'상품 수집 확장을 다시 로드하고 앱 페이지를 새로고침해주세요.'};}
  if(event.data.type==='CAPTURE')window.postMessage({channel:'YOOFAM_1688_CAPTURE_RESULT',requestId:event.data.requestId,result},location.origin);
});
