import {exchange} from '@/app/supplier-hub-handoff';

export type BrowserProductCapture={sourceUrl:string;scripts:string[]}|{sourceUrl:string;format:'1688-public-mobile-capture-v1';mobileHtml:string;skuPayload:object;detailSource:string}|{sourceUrl:string;format:'1688-public-sku-capture-v1';skuPayload:object};

/** Runs only after a user starts a URL import. The extension opens the URL
 * in that same Chrome window; it never reads cookies or another profile. */
export async function capture1688FromChrome(sourceUrl:string,signal:AbortSignal):Promise<BrowserProductCapture>{
 if(signal.aborted)throw Error('작업을 취소했습니다.');
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
   if(result.format==='1688-public-mobile-capture-v1'){
    let skuText:string|undefined;try{skuText=JSON.stringify(result.skuPayload);}catch{reject(Error('1688 모바일 옵션 원문이 올바른 JSON이 아닙니다.'));return;}
    if(typeof result.mobileHtml!=='string'||!result.mobileHtml.trim()||typeof result.detailSource!=='string'||!result.skuPayload||typeof result.skuPayload!=='object'||Array.isArray(result.skuPayload)
      ||typeof skuText!=='string'||[result.mobileHtml,result.detailSource,skuText].some(value=>new TextEncoder().encode(value).byteLength>2*1024*1024)){
      reject(Error('1688 모바일 상품 원문 형식 또는 크기를 확인하지 못했습니다.'));return;
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
