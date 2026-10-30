(()=>{
 if(window.top!==window||window.__yoofamOperationsConnector)return;
 window.__yoofamOperationsConnector=true;
 const origin=location.origin,pending=new Set();
 const allowed=origin==='https://sourceflow.jjwwhhjj1116.workers.dev'||location.protocol==='http:'&&['localhost','127.0.0.1'].includes(location.hostname);
 if(!allowed)return;
 window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==origin||event.data?.source!=='YOOFAM_OPS_PAGE')return;
  const request=event.data,id=request.requestId;
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(id)||JSON.stringify(request).length>24000||pending.has(id))return;
  pending.add(id);let done=false;
  const finish=result=>{if(done)return;done=true;pending.delete(id);window.postMessage({source:'YOOFAM_OPS_EXTENSION',requestId:id,result},origin);};
  const timer=setTimeout(()=>finish({ok:false,status:'unknown',rows:[],kind:request.kind,version:'1.0.0',error:'확장 응답 시간이 초과되었습니다. 실제 수집 상태를 확인한 후 다시 요청해주세요.'}),request.kind==='statementConfirm'?440000:140000);
  chrome.runtime.sendMessage({type:'YOOFAM_OPS_COLLECT',request},result=>{clearTimeout(timer);if(chrome.runtime.lastError)finish({ok:false,status:request.kind==='statementConfirm'?'unknown':'failed',rows:[],kind:request.kind,version:'1.0.0',error:request.kind==='statementConfirm'?'승인 연결이 끊겨 결과를 확인하지 못했습니다. 재승인하지 말고 Supplier Hub에서 상태를 확인하세요.':'확장 연결이 끊겼습니다. YOOFAM 화면을 새로고침해주세요.'});else finish(result??{ok:false,status:request.kind==='statementConfirm'?'unknown':'failed',rows:[],kind:request.kind,version:'1.0.0',error:'확장 응답이 없습니다.'});});
 });
})();
