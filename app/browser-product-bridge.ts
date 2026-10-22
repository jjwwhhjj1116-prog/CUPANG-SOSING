import {exchange} from '@/app/supplier-hub-handoff';

export type BrowserProductCapture={sourceUrl:string;scripts:string[]}|{sourceUrl:string;format:'1688-public-mobile-capture-v1';mobileHtml:string;skuPayload:object;detailSource:string}|{sourceUrl:string;format:'1688-public-mobile-partial-capture-v1';mobileHtml:string;skuPayload:object;detailSource:string;detailUnavailable:{status:502|503|504}}|{sourceUrl:string;format:'1688-public-sku-capture-v1';skuPayload:object}|{sourceUrl:string;format:'yoofam-saved-page-capture-v1';captureId:string;fingerprint:string;revision:number}|{sourceUrl:string;format:'yoofam-saved-query-capture-v1';captureId:string;fingerprint:string;revision:number};

/** Prefer an explicitly collected, durable inbox source. This reads our own
 * server only, and never opens the 1688 URL. Account checks run again on import. */
async function savedPageCapture(sourceUrl:string,signal:AbortSignal):Promise<BrowserProductCapture|null>{
 const controller=new AbortController();let interrupt:(error:Error)=>void=()=>{};
 const stopped=new Promise<never>((_resolve,reject)=>{interrupt=reject;});
 const abort=()=>{controller.abort();interrupt(Error(signal.aborted?'작업을 취소했습니다.':'수집함 확인 시간이 초과됐습니다. 저장 상태를 확인한 뒤 다시 시도해주세요.'));};
 const timer=setTimeout(abort,3000);signal.addEventListener('abort',abort,{once:true});
 try{
  if(signal.aborted){abort();return await stopped;}
  const read=async()=>{
   const response=await fetch('/api/source-inbox/ready?'+new URLSearchParams({sourceUrl}),{cache:'no-store',signal:controller.signal,credentials:'same-origin',redirect:'error'});
   const body=await response.json() as {code?:string;error?:string;capture?:Extract<BrowserProductCapture,{format:'yoofam-saved-page-capture-v1'}>|null};
   if(body?.code==='PAGE_SOURCE_REVIEW_REQUIRED')throw Object.assign(Error(body.error),{code:'PAGE_SOURCE_REVIEW_REQUIRED'});
   if(!response.ok)throw Error(body?.error||'수집함 원문을 확인하지 못했습니다.');
   const value=body.capture;if(value===null)return null;
   if(value?.format!=='yoofam-saved-page-capture-v1'||value.sourceUrl!==sourceUrl||typeof value.captureId!=='string'||!/^[a-f0-9-]{36}$/.test(value.captureId)||!/^[a-f0-9]{64}$/.test(value.fingerprint)||!Number.isSafeInteger(value.revision)||value.revision<1)throw Error('수집함 원문 응답이 올바르지 않습니다.');
   return value;
  };
  return await Promise.race([read(),stopped]);
 }catch(error){if((error as {code?:unknown})?.code==='PAGE_SOURCE_REVIEW_REQUIRED')throw error;throw Object.assign(error instanceof Error?error:Error('수집함 원문을 확인하지 못했습니다.'),{code:'PAGE_SOURCE_LOOKUP_UNCERTAIN'});}
 finally{clearTimeout(timer);signal.removeEventListener('abort',abort);controller.abort();}
}

/** Opportunistic existing-tab read only. Old/missing extensions, incomplete
 * metadata and uncertain read replies all fall back without a receipt write. */
export async function probe1688FromChrome(sourceUrl:string,signal:AbortSignal):Promise<BrowserProductCapture|null>{
 if(signal.aborted)throw Error('작업을 취소했습니다.');
 if(typeof window==='undefined'||typeof location==='undefined')return null;
 if(!/^https:\/\/detail\.1688\.com\/offer\/[1-9]\d{0,29}\.html$/.test(sourceUrl))return null;
 const saved=await savedPageCapture(sourceUrl,signal);if(saved)return saved;
 const presence=new AbortController(),abortPresence=()=>presence.abort();
 signal.addEventListener('abort',abortPresence,{once:true});
 const presenceTimer=setTimeout(abortPresence,750);
 try{
  const capability=await exchange('PING',null,presence.signal);
  if(signal.aborted)throw Error('작업을 취소했습니다.');
  if(capability.existingProductProbe!==true)return null;
 }catch(cause){if(signal.aborted)throw cause;return null;}
 finally{clearTimeout(presenceTimer);signal.removeEventListener('abort',abortPresence);presence.abort();}
 if(signal.aborted)throw Error('작업을 취소했습니다.');
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(Error('작업을 취소했습니다.'));return;}
  const requestId=crypto.randomUUID();
  const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);signal.removeEventListener('abort',abort);};
  const cancel=()=>window.postMessage({channel:'YOOFAM_1688_CAPTURE',requestId,type:'CANCEL',sourceUrl},location.origin);
  const abort=()=>{cancel();cleanup();reject(Error('작업을 취소했습니다.'));};
  const receive=(event:MessageEvent)=>{
   if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='YOOFAM_1688_CAPTURE_RESULT'||event.data.requestId!==requestId)return;
   cleanup();const result=event.data.result;
   if(!result||typeof result!=='object'||Array.isArray(result)||result.ok!==true||result.sourceUrl!==sourceUrl){resolve(null);return;}
   if(result.available===false){resolve(null);return;}
   if(Object.keys(result).some(key=>!['ok','sourceUrl','scripts'].includes(key))||!Array.isArray(result.scripts)||!result.scripts.length||result.scripts.length>30
    ||result.scripts.some((value:unknown)=>typeof value!=='string'||!value.trim())
    ||result.scripts.reduce((sum:number,value:string)=>sum+new TextEncoder().encode(value).byteLength,0)>1500000){resolve(null);return;}
   resolve({sourceUrl,scripts:result.scripts});
  };
  const timer=setTimeout(()=>{cancel();cleanup();resolve(null);},1500);
  window.addEventListener('message',receive);signal.addEventListener('abort',abort,{once:true});
  window.postMessage({channel:'YOOFAM_1688_CAPTURE',requestId,type:'PROBE',sourceUrl},location.origin);
 });
}

/** Runs only after a user starts a URL import. The extension opens the URL
 * in that same Chrome window; it never reads cookies or another profile. */
export async function capture1688FromChrome(sourceUrl:string,signal:AbortSignal):Promise<BrowserProductCapture>{
 if(signal.aborted)throw Error('작업을 취소했습니다.');
 const saved=await savedPageCapture(sourceUrl,signal);if(saved)return saved;
 let capability:Record<string,unknown>;
 try{capability=await exchange('PING',null,signal);}
 catch(cause){if(signal.aborted)throw cause;throw Error('현재 Chrome의 상품 수집 확장 응답을 확인하지 못했습니다. 확장과 앱 페이지를 새로고침한 뒤 다시 시도해주세요.');}
 if(signal.aborted)throw Error('작업을 취소했습니다.');
 if(capability.publicMobileCapture!==true)throw Error('현재 Chrome 확장이 1688 원문 수집을 지원하지 않습니다. 최신 상품 수집 확장을 적용하고 앱 페이지를 새로고침해주세요.');
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(Error('작업을 취소했습니다.'));return;}
  const requestId=crypto.randomUUID();
  const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);signal.removeEventListener('abort',abort);};
  const cancel=()=>window.postMessage({channel:'YOOFAM_1688_CAPTURE',requestId,type:'CANCEL',sourceUrl},location.origin);
  const abort=()=>{cancel();cleanup();reject(Error('작업을 취소했습니다.'));};
  const receive=(event:MessageEvent)=>{
   if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='YOOFAM_1688_CAPTURE_RESULT'||event.data.requestId!==requestId)return;
   cleanup();const result=event.data.result;
   if(result?.ok!==true){reject(Error(typeof result?.error==='string'?result.error:'1688 상품 페이지를 읽지 못했습니다.'));return;}
   if(result.sourceUrl!==sourceUrl){reject(Error('1688 상품 페이지의 응답이 요청 URL과 일치하지 않습니다.'));return;}
   if(result.format==='1688-public-sku-capture-v1'){
    let skuText:string|undefined;try{skuText=JSON.stringify(result.skuPayload);}catch{reject(Error('1688 옵션 원문이 올바른 JSON이 아닙니다.'));return;}
    if(!result.skuPayload||typeof result.skuPayload!=='object'||Array.isArray(result.skuPayload)||typeof skuText!=='string'||new TextEncoder().encode(skuText).byteLength>2*1024*1024
      ||Object.keys(result).some(key=>!['ok','format','sourceUrl','skuPayload'].includes(key))){reject(Error('1688 옵션 원문 형식 또는 크기를 확인하지 못했습니다.'));return;}
    resolve({sourceUrl,format:result.format,skuPayload:result.skuPayload});return;
   }
   if(result.format==='1688-public-mobile-capture-v1'||result.format==='1688-public-mobile-partial-capture-v1'){
    let skuText:string|undefined;try{skuText=JSON.stringify(result.skuPayload);}catch{reject(Error('1688 모바일 옵션 원문이 올바른 JSON이 아닙니다.'));return;}
    if(typeof result.mobileHtml!=='string'||!result.mobileHtml.trim()||typeof result.detailSource!=='string'||!result.skuPayload||typeof result.skuPayload!=='object'||Array.isArray(result.skuPayload)
      ||typeof skuText!=='string'||[result.mobileHtml,result.detailSource,skuText].some(value=>new TextEncoder().encode(value).byteLength>2*1024*1024)){
      reject(Error('1688 모바일 상품 원문 형식 또는 크기를 확인하지 못했습니다.'));return;
    }
    if(result.format==='1688-public-mobile-partial-capture-v1'){
     const missing=result.detailUnavailable;
     if(result.detailSource!==''||!missing||typeof missing!=='object'||Array.isArray(missing)||Object.keys(missing).length!==1||![502,503,504].includes(missing.status)
       ||Object.keys(result).some(key=>!['ok','format','sourceUrl','mobileHtml','skuPayload','detailSource','detailUnavailable'].includes(key))){reject(Error('1688 부분 원문의 일시 오류 상태를 확인하지 못했습니다.'));return;}
     resolve({sourceUrl,format:result.format,mobileHtml:result.mobileHtml,skuPayload:result.skuPayload,detailSource:result.detailSource,detailUnavailable:{status:missing.status}});return;
    }
    resolve({sourceUrl,format:result.format,mobileHtml:result.mobileHtml,skuPayload:result.skuPayload,detailSource:result.detailSource});return;
   }
   if(result.format!==undefined||!Array.isArray(result.scripts)||!result.scripts.length||result.scripts.length>30||result.scripts.some((value:unknown)=>typeof value!=='string')
      ||result.scripts.reduce((sum:number,value:string)=>sum+new TextEncoder().encode(value).byteLength,0)>1500000){reject(Error('1688 상품 페이지의 응답이 요청 URL과 일치하지 않습니다.'));return;}
   resolve({sourceUrl,scripts:result.scripts});
  };
  const timer=setTimeout(()=>{cancel();cleanup();reject(Error('1688 원문 수집 응답을 확인하지 못했습니다. 현재 상품 페이지를 확인한 뒤 다시 시도해주세요.'));},45000);
  window.addEventListener('message',receive);signal.addEventListener('abort',abort,{once:true});
  window.postMessage({channel:'YOOFAM_1688_CAPTURE',requestId,type:'CAPTURE',sourceUrl},location.origin);
 });
}
