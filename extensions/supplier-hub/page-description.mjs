import {pageSourceUrl,readPageSourceDescriptionReference} from './page-source.mjs';

export const PAGE_DESCRIPTION_LIMIT=1024*1024;
const active=new Set();
const fail=reason=>{const error=Error('현재 상품의 상세 원문을 확인하지 못했습니다.');error.reason=reason;throw error;};
const index=value=>Number.isSafeInteger(value)&&value>=0;
const documentId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/u.test(value);
const source=value=>{try{return pageSourceUrl(value);}catch{return fail('source-unproven');}};

/** Exact allowlist only. No general URL/proxy request, inferred path, auth,
 * fragments, ports, redirects or opaque tokens without a bound primary record. */
export function pageDescriptionUrl(value,offerId){
 let url;try{url=new URL(value);}catch{return fail('link-unavailable');}
 if(typeof value!=='string'||!value.startsWith('https://itemcdn.tmall.com/')||value.length>2048||/[\u0000-\u0020\u007f]/u.test(value)||url.protocol!=='https:'||url.hostname!=='itemcdn.tmall.com'
  ||url.username||url.password||url.port||url.hash||!/^\/1688offer\/[A-Za-z0-9]{1,200}$/u.test(url.pathname))fail('link-unavailable');
 for(const [key,id] of url.searchParams){if(!['offerId','productId'].includes(key)||id!==offerId||url.searchParams.getAll(key).length!==1)fail('link-unavailable');}
 return url.href;
}

// Runs in Chrome's isolated world, targeted to the sender's exact document.
// It only reads this document's URL and inert inline script text.
export function readPageDescriptionDocument(expectedSourceUrl){
 if(window!==window.top)return {available:false};
 let url;try{url=new URL(location.href);}catch{return {available:false};}
 if(url.protocol!=='https:'||url.hostname!=='detail.1688.com'||url.username||url.password||url.port||!/^\/offer\/[1-9]\d{0,29}\.html$/u.test(url.pathname)
  ||url.origin+url.pathname!==expectedSourceUrl)return {available:false};
 const scripts=[];let size=0;
 for(const script of document.scripts){
  if(script.namespaceURI!=='http://www.w3.org/1999/xhtml'||script.hasAttribute('src'))continue;
  const type=script.getAttribute('type')?.trim().toLowerCase();if(type&&!['application/json','text/javascript','application/javascript'].includes(type))continue;
  const text=script.textContent??'';if(!/"detailUrl"\s*:/u.test(text))continue;
  size+=text.length;if(scripts.length>=100||size>4*1024*1024)return {available:false};scripts.push(text);
 }
 return {available:true,sourceUrl:expectedSourceUrl,scripts};
}

function imageUrl(value){
 try{
  const absolute=value.startsWith('//')?'https:'+value:value,url=new URL(absolute);
  return /^https:\/\/[^/:?#]+\//u.test(absolute)&&value.length<=2048&&!/[\u0000-\u0020\u007f]/u.test(value)&&url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.hash
   &&(url.hostname==='alicdn.com'||url.hostname.endsWith('.alicdn.com'))?url.href:null;
 }catch{return null;}
}
function decodeAttribute(value){
 const decoded=value.replace(/&(?:amp|quot|apos|lt|gt|#\d{1,7}|#x[a-f0-9]{1,6});/giu,entity=>{
  const known={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'},lower=entity.toLowerCase();if(known[lower])return known[lower];
  const hex=lower.startsWith('&#x'),number=Number.parseInt(entity.slice(hex?3:2,-1),hex?16:10);return number>0&&number<=0x10ffff&&!(number>=0xd800&&number<=0xdfff)?String.fromCodePoint(number):'\u0000';
 });
 return /&(?:[A-Za-z][A-Za-z0-9]*|#[^;\s]*);/u.test(decoded)?'':decoded;
}

/** Small conservative HTML tokenizer. It never creates a DOM or requests an
 * image. Only explicit attributes of static HTML img tags can leave it; raw
 * script/style/iframe text and foreign/template subtrees are skipped. */
export function parsePageDescriptionImages(html){
 if(typeof html!=='string'||new TextEncoder().encode(html).byteLength>PAGE_DESCRIPTION_LIMIT)fail('response-too-large');
 if(!/^\s*</u.test(html))fail('html-unavailable');
 const images=[],blocked=[],raw=new Set(['script','style','iframe','xmp','textarea','title','noscript','plaintext']),excluded=new Set([...raw,'template','object','embed','svg','math']);
 let cursor=0,tokens=0;
 while(cursor<html.length){
  const start=html.indexOf('<',cursor);if(start<0)break;cursor=start;
  if(++tokens>100000)fail('html-unavailable');
  if(html.startsWith('<!--',cursor)){const end=html.indexOf('-->',cursor+4);if(end<0)fail('html-unavailable');cursor=end+3;continue;}
  if(html.startsWith('<![CDATA[',cursor)){const end=html.indexOf(']]>',cursor+9);if(end<0)fail('html-unavailable');cursor=end+3;continue;}
  if(html.startsWith('<!',cursor)||html.startsWith('<?',cursor)){const end=html.indexOf('>',cursor+2);if(end<0)fail('html-unavailable');cursor=end+1;continue;}
  const head=/^<(\/?)([A-Za-z][A-Za-z0-9:-]*)/u.exec(html.slice(cursor));
  if(!head){cursor++;continue;}
  const closing=!!head[1],tag=head[2].toLowerCase(),attrs=new Map();let position=cursor+head[0].length,ended=false,selfClosing=false;
  while(position<html.length){
   while(/\s/u.test(html[position]??'')&&position<html.length)position++;
   if(html[position]==='>'){position++;ended=true;break;}
   if(html[position]==='/'&&html[position+1]==='>'){position+=2;ended=true;selfClosing=true;break;}
   const name=/^[^\s=<>/"'\x00-\x1f]+/u.exec(html.slice(position));if(!name)fail('html-unavailable');position+=name[0].length;
   const key=name[0].toLowerCase();while(/\s/u.test(html[position]??'')&&position<html.length)position++;
   let value='';
   if(html[position]==='='){
    position++;while(/\s/u.test(html[position]??'')&&position<html.length)position++;
    const quote=html[position];if(quote==='"'||quote==="'"){const end=html.indexOf(quote,++position);if(end<0)fail('html-unavailable');value=html.slice(position,end);position=end+1;}
    else{const match=/^[^\s<>"'`=]+/u.exec(html.slice(position));if(!match)fail('html-unavailable');value=match[0];position+=value.length;}
   }
   if(attrs.has(key)&&tag==='img')fail('html-unavailable');attrs.set(key,value);
  }
  if(!ended)fail('html-unavailable');cursor=position;
  if(closing){if(blocked.at(-1)===tag)blocked.pop();continue;}
  if(raw.has(tag)){
   if(tag==='plaintext')break;
   const end=new RegExp('</'+tag+'\\s*>','ig');end.lastIndex=cursor;const match=end.exec(html);if(!match)break;cursor=end.lastIndex;continue;
  }
  if(excluded.has(tag)){if(tag!=='embed'&&!(selfClosing&&['svg','math'].includes(tag)))blocked.push(tag);continue;}
  if(blocked.length||tag!=='img')continue;
  for(const key of ['data-src','src','data-lazyload-src','data-ks-lazyload']){
   const candidate=imageUrl(decodeAttribute(attrs.get(key)??''));if(!candidate)continue;
   if(!images.includes(candidate)){if(images.length>=80)fail('image-limit');images.push(candidate);}break;
  }
 }
 return images;
}

/** Only the isolated content collector's explicit click invokes this route.
 * All dependencies are injectable for offline tests; no startup listener exists. */
export async function readPageDescription(message,sender,api=chrome,options={}){
 let identity;
 try{
  if(!message||Object.keys(message).sort().join(',')!=='sourceUrl,type'||message.type!=='YOOFAM_READ_PAGE_DESCRIPTION')fail('sender-unproven');
  identity=source(message.sourceUrl);
  if(identity.sourceUrl!==message.sourceUrl||typeof api.runtime?.id!=='string'||!api.runtime.id||sender?.id!==api.runtime.id||sender.frameId!==0||!index(sender.tab?.id)||!index(sender.tab?.windowId)||!documentId(sender.documentId)
   ||source(sender.url).sourceUrl!==identity.sourceUrl||source(sender.tab.url).sourceUrl!==identity.sourceUrl||sender.origin!==undefined&&sender.origin!=='https://detail.1688.com'
   ||sender.documentLifecycle!==undefined&&sender.documentLifecycle!=='active')fail('sender-unproven');
 }catch{return {ok:true,available:false,...(identity??{}),detailImages:[],reason:'sender-unproven'};}
 const unavailable=reason=>({ok:true,available:false,...identity,detailImages:[],reason});
 const key=sender.tab.id+':'+sender.documentId;if(active.has(key))return unavailable('read-in-progress');active.add(key);
 const controller=new AbortController(),timeoutMs=Number.isFinite(options.timeoutMs)?Math.max(1,Math.min(10000,options.timeoutMs)):8000;
 let timer,reader,response,settled=false;
 const interrupted=new Promise((_,reject)=>{timer=setTimeout(()=>{settled=true;controller.abort();try{reader?.cancel()?.catch(()=>{});response?.body?.cancel()?.catch(()=>{});}catch{}const error=Error('상세 원문 확인 시간이 초과되었습니다.');error.reason='timeout';reject(error);},timeoutMs);});
 const live=()=>{if(settled||controller.signal.aborted){try{response?.body?.cancel()?.catch(()=>{});}catch{}fail('timeout');}};
 const checkTab=async()=>{
  live();const tab=await api.tabs.get(sender.tab.id);live();
  if(tab?.id!==sender.tab.id||tab.windowId!==sender.tab.windowId||tab.pendingUrl||source(tab.url).sourceUrl!==identity.sourceUrl)fail('document-changed');
 };
 const readReference=async()=>{
  await checkTab();live();
  const results=await api.scripting.executeScript({target:{tabId:sender.tab.id,documentIds:[sender.documentId]},world:'ISOLATED',func:readPageDescriptionDocument,args:[identity.sourceUrl]});live();
  if(!Array.isArray(results)||results.length!==1||results[0]?.frameId!==0||results[0].documentId!==sender.documentId||results[0].result?.available!==true||results[0].result.sourceUrl!==identity.sourceUrl)fail('document-changed');
  await checkTab();live();
  let reference;try{reference=readPageSourceDescriptionReference(identity.sourceUrl,results[0].result.scripts);}catch{return fail('identity-unproven');}
  if(!reference)fail('link-unavailable');
  return pageDescriptionUrl(reference.detailUrl,identity.offerId);
 };
 const run=async()=>{
  const detailUrl=await readReference();live();
  try{response=await (options.fetcher??fetch)(detailUrl,{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,headers:{accept:'text/html,text/plain;q=0.9'}});}catch{return fail(controller.signal.aborted?'timeout':'network-unavailable');}
  live();await checkTab();live();
  if(!response||response.status!==200||response.ok!==true||response.redirected||response.type==='opaqueredirect'||response.url&&response.url!==detailUrl)fail('http-unavailable');
  const contentType=response.headers?.get('content-type')??'';
  if(!/^text\/(?:html|plain)(?:\s*;|\s*$)/iu.test(contentType))fail('content-type-unavailable');
  const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/u.test(length)||Number(length)>PAGE_DESCRIPTION_LIMIT))fail('response-too-large');
  reader=response.body?.getReader();if(!reader)fail('response-unavailable');
  let decoder;try{decoder=new TextDecoder(contentType.match(/charset\s*=\s*["']?([\w-]+)/iu)?.[1]??'utf-8',{fatal:true});}catch{return fail('encoding-unavailable');}
  let size=0,html='';
  for(;;){const chunk=await reader.read();live();if(chunk.done)break;if(!(chunk.value instanceof Uint8Array))fail('response-unavailable');size+=chunk.value.byteLength;if(size>PAGE_DESCRIPTION_LIMIT)fail('response-too-large');html+=decoder.decode(chunk.value,{stream:true});}
  html+=decoder.decode();live();
  const detailImages=parsePageDescriptionImages(html);if(!detailImages.length)fail('images-unavailable');
  if(await readReference()!==detailUrl)fail('document-changed');live();
  return {ok:true,available:true,...identity,detailImages};
 };
 try{return await Promise.race([run(),interrupted]);}
 catch(error){return unavailable(['source-unproven','link-unavailable','identity-unproven','document-changed','timeout','network-unavailable','http-unavailable','content-type-unavailable','response-too-large','response-unavailable','encoding-unavailable','images-unavailable','html-unavailable','image-limit'].includes(error?.reason)?error.reason:'read-unavailable');}
 finally{settled=true;clearTimeout(timer);controller.abort();try{reader?.cancel()?.catch(()=>{});}catch{}try{reader?.releaseLock();}catch{}try{response?.body?.cancel()?.catch(()=>{});}catch{}active.delete(key);}
}
