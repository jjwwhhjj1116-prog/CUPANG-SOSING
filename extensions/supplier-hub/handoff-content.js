// This script only runs on the three explicitly listed app origins.
window.addEventListener('message',async event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='YOOFAM_HUB_HANDOFF'||!/^[a-f0-9-]{36}$/.test(event.data.requestId||''))return;
  const {requestId,type}=event.data;
  if(!['PING','PREPARE','RESULT','TRANSMIT','REFRESH','REGISTRATION'].includes(type))return;
  let result;
  try{
    const commands={PREPARE:'YOOFAM_PREPARE_PACKAGE',RESULT:'YOOFAM_GET_RESULT',TRANSMIT:'YOOFAM_TRANSMIT_PACKAGE',REFRESH:'YOOFAM_REFRESH_RESULT',REGISTRATION:'YOOFAM_REFRESH_REGISTRATION'};
    result=type==='PING'?{ok:true,version:'0.2.26',companyBinding:true,directTransmission:true,registrationLookup:true,registrationPages:true}:await chrome.runtime.sendMessage({...event.data.payload,type:commands[type]});
  }catch{result={ok:false,error:'확장 연결을 새로고침한 뒤 다시 준비해주세요.'};}
  window.postMessage({channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId,result},location.origin);
});
window.addEventListener('message',async event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='YOOFAM_1688_CAPTURE'||!['CAPTURE','CANCEL'].includes(event.data?.type)||!/^[a-f0-9-]{36}$/.test(event.data.requestId||''))return;
  let result;
  try{result=await chrome.runtime.sendMessage({type:event.data.type==='CANCEL'?'YOOFAM_CANCEL_1688':'YOOFAM_CAPTURE_1688',requestId:event.data.requestId,sourceUrl:event.data.sourceUrl});}
  catch{result={ok:false,error:'상품 수집 확장을 다시 로드하고 앱 페이지를 새로고침해주세요.'};}
  if(event.data.type==='CAPTURE')window.postMessage({channel:'YOOFAM_1688_CAPTURE_RESULT',requestId:event.data.requestId,result},location.origin);
});
