import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';
import {parseProductJsonLd} from '../extensions/supplier-hub/product-jsonld.mjs';

// Read-only diagnosis of the user-specified public URL. No credentials, API
// keys, cookies, seller scripts, browser/profile control or database writes.
const sourceUrl='https://detail.1688.com/offer/813724060928.html';
const cache=new Map(),report={sourceUrl,checkedAt:new Date().toISOString(),requests:[]};
async function inspectPage(response){
 const reader=response.body?.getReader();if(!reader)return;
 const decoder=new TextDecoder();let text='',size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel();report.pageOverLimit=true;return;}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
 const nodes=[parse5.parse(text)],scripts=[];
 while(nodes.length){const node=nodes.pop();if(node.childNodes)nodes.push(...node.childNodes);
  if(node.tagName==='title')report.pageTitle=node.childNodes.map(child=>child.value??'').join('').slice(0,150);
  if(node.tagName!=='script')continue;
  const attrs=Object.fromEntries(node.attrs.map(attr=>[attr.name,attr.value]));const body=node.childNodes.map(child=>child.value??'').join('');
  // Only structural indicators leave this diagnostic, never raw script values.
  scripts.push({id:attrs.id??null,type:attrs.type??null,external:!!attrs.src,length:body.length,exactOfferMentioned:body.includes('813724060928'),dataAssignments:[...body.matchAll(/(?:window\.)?([A-Za-z_$][\w$]{0,60})\s*=\s*[{[]/g)].slice(0,20).map(match=>match[1])});
 }
 report.pageBytes=size;report.scripts=scripts;
}
function load(file){
 if(cache.has(file))return cache.get(file);
 const exports={};cache.set(file,exports);
 const code=ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,URL,Error,Response,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,require:name=>{
  if(name==='parse5')return parse5;
  if(name==='@/extensions/supplier-hub/product-jsonld.mjs')return {parseProductJsonLd};
  if(!name.startsWith('@/'))throw Error('Unexpected diagnostic dependency');
  return load(name.slice(2)+'.ts');
 }});return exports;
}
try{
 const result=await load('app/public-product-collector.ts').collectPublicProduct(sourceUrl,{fetcher:async(url,init)=>{
  if(url!==sourceUrl||init.credentials!=='omit'||init.redirect!=='manual')throw Error('Unexpected diagnostic request');
  const response=await fetch(url,init);
  report.requests.push({status:response.status,contentType:response.headers.get('content-type')});await inspectPage(response.clone());return response;
 }});
 report.collected=true;report.offerId=result.offerId;report.options=result.options.length;report.images=result.images.length;
}catch(error){report.collected=false;report.error=error.message;process.exitCode=1;}
console.log(JSON.stringify(report,null,2));
