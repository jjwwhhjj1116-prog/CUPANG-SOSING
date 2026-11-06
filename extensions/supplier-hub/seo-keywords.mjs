import {HANDOFF_ORIGINS} from './handoff-store.mjs';
import {SEO_KEYWORD_CAPABILITY,readSeoKeywordsInPage} from './seo-keywords-page.mjs';
let lastSearchAt=0,queue=Promise.resolve();
const active=new Map();
const key=(sender,id)=>`${new URL(sender.url).origin}:${sender.tab.id}:${id}`;
export function cancelSeoKeywords(message,sender){
 validateSeoKeywordRequest({type:'YOOFAM_SEO_KEYWORDS',capability:SEO_KEYWORD_CAPABILITY,requestId:message.requestId,query:'cancel'},sender);
 if(Object.keys(message).sort().join(',')!=='requestId,type'||message.type!=='YOOFAM_SEO_KEYWORDS_CANCEL')throw Error('invalid cancellation');
 active.get(key(sender,message.requestId))?.();return {ok:true};
}
export function validateSeoKeywordRequest(message,sender){
 let origin;try{origin=new URL(sender?.url).origin;}catch{throw Error('origin');}
 if(sender?.frameId!==0||!HANDOFF_ORIGINS.includes(origin)||!Number.isSafeInteger(sender?.tab?.id)||sender.tab.id<0||!Number.isSafeInteger(sender.tab.windowId)||sender.tab.windowId<0
  ||!message||Object.keys(message).sort().join(',')!=='capability,query,requestId,type'||message.type!=='YOOFAM_SEO_KEYWORDS'
  ||message.capability!==SEO_KEYWORD_CAPABILITY||!/^[a-f0-9-]{36}$/.test(message.requestId||'')||typeof message.query!=='string'||!message.query.trim()||message.query.length>200||/[\u0000-\u001f\u007f]/.test(message.query))throw Error('invalid SEO keyword request');
 return {query:message.query,requestId:message.requestId,windowId:sender.tab.windowId};
}
export async function dispatchSeoKeywords(message,sender,api=chrome){
 const scope=validateSeoKeywordRequest(message,sender),started=Date.now();let owned=null,timer,expired=false,cancelReject;
 const cancellation=new Promise((_,reject)=>{cancelReject=reject;});
 const activeKey=key(sender,scope.requestId);if(active.has(activeKey))throw Error('duplicate request');
 active.set(activeKey,()=>{expired=true;cancelReject(Error('cancelled'));if(owned!==null)void api.tabs.remove(owned).catch(()=>{});});
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('deadline'));},30000);});
 const work=async()=>{
  const wait=Math.max(0,6000-(Date.now()-lastSearchAt));if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  if(expired||Date.now()-started>=29000)throw Error('deadline');lastSearchAt=Date.now();
  const tab=await api.tabs.create({windowId:scope.windowId,url:'https://www.coupang.com/np/search?q='+encodeURIComponent(scope.query),active:false});owned=tab.id;
  if(expired){await api.tabs.remove(owned).catch(()=>{});owned=null;throw Error('deadline');}
  if(expired||Date.now()-started>=29000)throw Error('deadline');
  while((await api.tabs.get(owned)).status!=='complete'){await new Promise(resolve=>setTimeout(resolve,100));if(expired||Date.now()-started>=29000)throw Error('deadline');}
  const result=await api.scripting.executeScript({target:{tabId:owned,frameIds:[0]},world:'ISOLATED',func:readSeoKeywordsInPage,args:[scope.query]});
  if(expired)throw Error('cancelled or expired');
  const value=result?.[0]?.result;
  if(!value||!Array.isArray(value.keywords)||value.keywords.length>1000||value.keywords.some(word=>typeof word!=='string'||word.length>200||/[\u0000-\u001f\u007f]/.test(word))||!Array.isArray(value.warnings)||value.warnings.length>4||JSON.stringify(value).length>64000)throw Error('invalid result');
  return {ok:true,capability:SEO_KEYWORD_CAPABILITY,query:scope.query,requestId:scope.requestId,keywords:value.keywords,warnings:value.warnings.length?['자동완성 일부를 확인하지 못했습니다.']:[],observedAt:new Date().toISOString()};
 };
 const pending=queue.then(work),bounded=Promise.race([pending,deadline,cancellation]);queue=bounded.catch(()=>{});
 try{return await bounded;}finally{expired=true;active.delete(activeKey);clearTimeout(timer);if(owned!==null)await api.tabs.remove(owned).catch(()=>{});}
}
