// This script only runs on the three explicitly listed app origins.
window.addEventListener('message',async event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='YOOFAM_HUB_HANDOFF'||!/^[a-f0-9-]{36}$/.test(event.data.requestId||''))return;
  const {requestId,type}=event.data;
  if(!['PING','PREPARE','RESULT'].includes(type))return;
  let result;
  try{
    result=type==='PING'?{ok:true,version:'0.2.6'}:await chrome.runtime.sendMessage({...event.data.payload,type:type==='RESULT'?'YOOFAM_GET_RESULT':'YOOFAM_PREPARE_PACKAGE'});
  }catch{result={ok:false,error:'확장 연결을 새로고침한 뒤 다시 준비해주세요.'};}
  window.postMessage({channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId,result},location.origin);
});
