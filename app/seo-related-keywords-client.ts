import {SEO_COMPOSITION_VERSION,SEO_KEYWORD_CAPABILITY,validateSeoCompositionPolicy,type SeoCompositionPolicy,type SeoRelatedPreferences} from '@/app/seo-current-policy';
function exchange(type:string,payload:unknown,signal:AbortSignal,timeout:number):Promise<Record<string,unknown>>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(Error('cancelled'));return;}if(typeof window==='undefined'){reject(Error('extension unavailable'));return;}
  const requestId=crypto.randomUUID(),origin=window.location.origin;
  const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);signal.removeEventListener('abort',abort);};
  const abort=()=>{cleanup();if(type==='SEO_KEYWORDS')window.postMessage({channel:'YOOFAM_HUB_HANDOFF',requestId:crypto.randomUUID(),type:'SEO_KEYWORDS_CANCEL',payload:{requestId}},origin);reject(Error('cancelled'));};
  const receive=(event:MessageEvent)=>{if(event.source!==window||event.origin!==origin||event.data?.channel!=='YOOFAM_HUB_HANDOFF_RESULT'||event.data.requestId!==requestId)return;const result=event.data.result;cleanup();if(!result||result.ok!==true)reject(Error('keyword unavailable'));else if(type==='SEO_KEYWORDS'&&(result.requestId!==requestId||result.query!==(payload as {query:string}).query||result.capability!==SEO_KEYWORD_CAPABILITY))reject(Error('keyword scope'));else resolve(result);};
  const timer=setTimeout(()=>{cleanup();reject(Error('keyword timeout'));},timeout);
  window.addEventListener('message',receive);signal.addEventListener('abort',abort,{once:true});window.postMessage({channel:'YOOFAM_HUB_HANDOFF',requestId,type,payload},origin);
 });
}
/** Preferences are immutable review input, never added to supplier source facts. */
export async function acquireSeoComposition(memo:SeoCompositionPolicy['memo'],signal:AbortSignal,isCurrent:()=>boolean,provided?:string[]):Promise<SeoCompositionPolicy>{
 const check=()=>{if(signal.aborted||!isCurrent())throw Error('SEO 상품·참고 입력이 변경되어 중단했습니다.');};check();
 const target=memo.keywords.trim(),query=target.length<=200?target:'';let related:SeoRelatedPreferences={source:'none',query,keywords:[],warnings:target.length>200?['타겟 검색어가 조회 한도를 넘어 관련어 조회를 생략했습니다.']:[]};
 if(provided?.length)related={...related,source:'provided',keywords:[...new Set(provided.filter(value=>typeof value==='string'&&value.trim()))]};
 else if(query)try{const ping=await exchange('PING',null,signal,2000);check();if(ping.seoKeywords!==SEO_KEYWORD_CAPABILITY)throw Error('old extension');const response=await exchange('SEO_KEYWORDS',{capability:SEO_KEYWORD_CAPABILITY,query},signal,31000);check();related=validateSeoCompositionPolicy({version:SEO_COMPOSITION_VERSION,memo,related:{source:'consumer',query,keywords:response.keywords,warnings:response.warnings,...(response.observedAt!==undefined?{observedAt:response.observedAt}:{})}}).related;}
 catch{check();related={source:'unavailable',query,keywords:[],warnings:['현재 확장에서 연관어를 확인하지 못했습니다. 입력한 선호와 상품 원문으로 계속합니다.']};}
 check();return validateSeoCompositionPolicy({version:SEO_COMPOSITION_VERSION,memo:{...memo},related});
}
