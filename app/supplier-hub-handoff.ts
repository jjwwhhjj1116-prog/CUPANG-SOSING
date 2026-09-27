type PackageIdentity={productId:string;categoryId:string;fingerprint:string};
function exchange(type:'PING'|'PREPARE',payload:unknown,signal:AbortSignal):Promise<Record<string,unknown>>{
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new Error('작업을 취소했습니다.'));return;}
    const requestId=crypto.randomUUID();
    const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);signal.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();reject(new Error('작업을 취소했습니다.'));};
    const receive=(event:MessageEvent)=>{
      if(event.source!==window||event.origin!==window.location.origin||event.data?.channel!=='YOOFAM_HUB_HANDOFF_RESULT'||event.data.requestId!==requestId)return;
      cleanup();const result=event.data.result;
      if(!result||result.ok!==true)reject(new Error(typeof result?.error==='string'?result.error:'확장에 견적서를 전달하지 못했습니다.'));
      else resolve(result);
    };
    const timer=setTimeout(()=>{cleanup();reject(new Error(type==='PING'?'YOOFAM PLUS 첨부 확장 0.2 이상을 설치하고 이 페이지를 새로고침해주세요.':'확장 준비 응답을 확인하지 못했습니다. Supplier Hub 확장에서 준비된 파일을 확인해주세요.'));},type==='PING'?2000:20000);
    window.addEventListener('message',receive);signal.addEventListener('abort',abort,{once:true});
    window.postMessage({channel:'YOOFAM_HUB_HANDOFF',requestId,type,payload},window.location.origin);
  });
}
export async function checkSupplierHubExtension(signal:AbortSignal){await exchange('PING',null,signal);}
export async function prepareSupplierHubHandoff(blob:Blob,identity:PackageIdentity,signal:AbortSignal){
  if(blob.size>30*1024*1024)throw new Error('첨부 패키지는 30MB 이하여야 합니다.');
  const bytes=new Uint8Array(await blob.arrayBuffer());let text='';
  for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));
  const result=await exchange('PREPARE',{...identity,base64:btoa(text)},signal);
  if(result.fingerprint!==identity.fingerprint||result.registered!==false)throw new Error('검토한 견적서와 확장 준비 결과가 다릅니다.');
}
