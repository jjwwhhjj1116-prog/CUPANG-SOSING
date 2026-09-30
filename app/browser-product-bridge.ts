export type BrowserProductCapture={sourceUrl:string;scripts:string[]};

/** Runs only after a user starts a URL import. The extension opens the URL
 * in that same Chrome window; it never reads cookies or another profile. */
export function capture1688FromChrome(sourceUrl:string,signal:AbortSignal):Promise<BrowserProductCapture>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(Error('작업을 취소했습니다.'));return;}
  const requestId=crypto.randomUUID();
  const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);signal.removeEventListener('abort',abort);};
  const abort=()=>{cleanup();reject(Error('작업을 취소했습니다.'));};
  const receive=(event:MessageEvent)=>{
   if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='YOOFAM_1688_CAPTURE_RESULT'||event.data.requestId!==requestId)return;
   cleanup();const result=event.data.result;
   if(result?.ok!==true){reject(Error(typeof result?.error==='string'?result.error:'1688 상품 페이지를 읽지 못했습니다.'));return;}
   if(result.sourceUrl!==sourceUrl||!Array.isArray(result.scripts)||!result.scripts.length||result.scripts.some((value:unknown)=>typeof value!=='string')){reject(Error('1688 상품 페이지의 응답이 요청 URL과 일치하지 않습니다.'));return;}
   resolve({sourceUrl,scripts:result.scripts});
  };
  const timer=setTimeout(()=>{cleanup();reject(Error('상품 수집 확장 0.2.22 이상을 설치·새로고침한 뒤 다시 시도해주세요.'));},30000);
  window.addEventListener('message',receive);signal.addEventListener('abort',abort,{once:true});
  window.postMessage({channel:'YOOFAM_1688_CAPTURE',requestId,type:'CAPTURE',sourceUrl},location.origin);
 });
}
