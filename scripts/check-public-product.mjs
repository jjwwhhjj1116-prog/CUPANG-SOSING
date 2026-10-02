import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';
import {parseProductJsonLd} from '../extensions/supplier-hub/product-jsonld.mjs';

// Read-only diagnosis of the fixed public offer through the production collector.
// No browser/session credentials, seller script execution or database writes.
// The collector's fresh anonymous MTop handshake cookies stay only in memory.
const offerId='813724060928';
const sourceUrl='https://detail.1688.com/offer/813724060928.html';
const mobileUrl=`https://m.1688.com/offer/${offerId}.html`;
const skuEndpoint='https://h5api.m.1688.com/h5/mtop.mbox.fc.common.gateway/1.0/';
const skuData=JSON.stringify({params:JSON.stringify({offerId}),fcName:'mini-od-cse',fcGroup:'cbu-offer',serviceName:'wirelessCoreOdService'});
const cache=new Map(),report={sourceUrl,checkedAt:new Date().toISOString(),requests:[]};
const requestCounts={desktop:0,mobile:0,sku:0,detail:0};
let allowedDetailUrl;
function requestKind(url,init){
 if(typeof url!=='string'||(init.method??'GET')!=='GET'||init.body!=null||init.credentials!=='omit'||init.redirect!=='manual'||init.cache!=='no-store')throw Error('Unexpected diagnostic request');
 const address=new URL(url);let kind;
 if(url===sourceUrl)kind='desktop';
 else if(url===mobileUrl)kind='mobile';
 else if(allowedDetailUrl&&url===allowedDetailUrl)kind='detail';
 else if(address.origin+address.pathname===skuEndpoint&&!address.username&&!address.password&&!address.hash){
  const fixed={jsv:'2.7.4',appKey:'12574478',api:'mtop.mbox.fc.common.gateway',v:'1.0',type:'originaljson',dataType:'json',data:skuData};
  const keys=[...Object.keys(fixed),'t','sign'];
  if([...address.searchParams.keys()].length!==keys.length||keys.some(key=>address.searchParams.getAll(key).length!==1)
   ||Object.entries(fixed).some(([key,value])=>address.searchParams.get(key)!==value)
   ||!/^\d{10,16}$/.test(address.searchParams.get('t')??'')||!/^[a-f0-9]{32}$/.test(address.searchParams.get('sign')??''))throw Error('Unexpected diagnostic SKU request');
  kind='sku';
 }
 if(!kind||requestCounts[kind]>=(kind==='sku'?2:1))throw Error('Unexpected diagnostic request scope');
 const headers=new Headers(init.headers);
 if([...headers.keys()].some(key=>key!=='accept'&&(key!=='cookie'||kind!=='sku')))throw Error('Unexpected diagnostic headers');
 if(headers.has('cookie')&&(requestCounts.sku!==1||!/^_m_h5_tk(?:_enc)?=[A-Za-z0-9_-]{1,512}(?:; _m_h5_tk(?:_enc)?=[A-Za-z0-9_-]{1,512})?$/.test(headers.get('cookie'))))throw Error('Unexpected diagnostic cookie source');
 requestCounts[kind]++;return kind;
}
async function inspectPage(response,entry,signal){
 const reader=response.body?.getReader();if(!reader)return;
 const charset=response.headers.get('content-type')?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]??'utf-8';
 const decoder=new TextDecoder(charset,{fatal:true});let text='',size=0;
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
 try{while(true){if(signal?.aborted)return;const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){cancel();entry.pageOverLimit=true;return;}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{signal?.removeEventListener('abort',cancel);reader.releaseLock();}
 if(signal?.aborted)return;
 const nodes=[parse5.parse(text)];let scripts=0,jsonLdScripts=0;
 while(nodes.length){const node=nodes.pop();if(node.childNodes)nodes.push(...node.childNodes);
  if(node.tagName!=='script')continue;
  scripts++;if(node.attrs.some(attr=>attr.name==='type'&&attr.value.trim().toLowerCase()==='application/ld+json'))jsonLdScripts++;
 }
 Object.assign(entry,{pageBytes:size,scripts,jsonLdScripts,exactOfferMentioned:text.includes(offerId)});
 if(entry.kind==='mobile'){
  const parser=load('app/alibaba-mobile-product.ts');
  try{allowedDetailUrl=parser.parseAlibabaMobilePage(text,sourceUrl).detailUrl;entry.mobileInitialData='validated';entry.detailReference=!!allowedDetailUrl;}
  catch(error){entry.mobileInitialData=error instanceof parser.AlibabaMobileInitialDataUnavailableError?'unavailable':'rejected';}
 }
}
function load(file){
 if(cache.has(file))return cache.get(file);
 const exports={};cache.set(file,exports);
 const code=ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,URL,URLSearchParams,Error,Response,TextEncoder,TextDecoder,AbortController,structuredClone,setTimeout,clearTimeout,require:name=>{
  if(name==='parse5')return parse5;
  if(name==='@/extensions/supplier-hub/product-jsonld.mjs')return {parseProductJsonLd};
  if(!name.startsWith('@/'))throw Error('Unexpected diagnostic dependency');
  return load(name.slice(2)+'.ts');
 }});return exports;
}
try{
 const result=await load('app/public-product-collector.ts').collectPublicProduct(sourceUrl,{fetcher:async(url,init)=>{
  const kind=requestKind(url,init),entry={kind};report.requests.push(entry);const started=Date.now();
  try{
   const response=await fetch(url,init);entry.status=response.status;
   const mediaType=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
   entry.contentType=['text/html','text/plain','application/json','application/javascript','text/javascript'].includes(mediaType)?mediaType:'other';
   if(response.ok&&entry.contentType==='text/html'&&(kind==='desktop'||kind==='mobile'))await inspectPage(response.clone(),entry,init.signal);
   return response;
  }catch{entry.failed=true;throw Error('Public diagnostic request failed');}
  finally{entry.elapsedMs=Date.now()-started;}
 }});
 report.collected=true;report.offerId=result.offerId;report.provider=result.provider;report.options=result.options.length;report.images=result.images.length;
 report.attributes=result.attributes?.length??0;report.descriptionCharacters=result.description.length;
}catch{report.collected=false;report.error='Production collector did not return a validated product.';process.exitCode=1;}
console.log(JSON.stringify(report,null,2));
