import fs from 'node:fs';import vm from 'node:vm';import path from 'node:path';import ts from 'typescript';import {createRequire} from 'node:module';
import {managedProductHarness,managedFixture} from './managed-products.mjs';
const native=createRequire(import.meta.url);
export {managedFixture};
export function managedBarcodeHarness(company={code:'A01464742',name:'와이홉'}){
 const h=managedProductHarness();Object.assign(h.state.user.membership,{companyCode:company.code,companyName:company.name});h.syncMember();
 const sql=[],writes=[],cache=new Map(),controls={beforeRead:null},db={prepare(statement){let args=[];const q={bind(...values){args=values;return q;},async first(){sql.push(statement);controls.beforeRead?.(statement,args);return h.sqlite.prepare(statement).get(...args)??null;},async all(){sql.push(statement);controls.beforeRead?.(statement,args);return {results:h.sqlite.prepare(statement).all(...args)};},async run(){writes.push(statement);throw Error('Barcode API must not execute a write or DDL');}};return q;},async batch(){throw Error('Barcode API must not execute a batch');}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,Error,RangeError,Date,URL,URLSearchParams,Response,Request,File,FormData,Blob,DecompressionStream,TextEncoder,TextDecoder,Uint8Array,DataView,crypto,process:{env:{NODE_ENV:'production'}},require(name){
  if(name==='cloudflare:workers')return {env:{DB:db}};if(name==='next/server')return {NextResponse:Response};if(name==='@/app/chatgpt-auth')return {getChatGPTUser:async()=>h.state.user};if(name==='jsbarcode')return native(name);
  return load(name.startsWith('@/')?name.slice(2)+'.ts':path.posix.join(path.posix.dirname(file),name)+'.ts');
 }});return exports;}
 const account=()=>load('app/managed-products.ts').managedProductAccountContext(h.state.user?.userId??'',company);
 const request=async(skuId='1000000000',params={})=>{const query=new URLSearchParams({expectedAccountContext:await account(),...params});return load('app/api/managed-products/[skuId]/barcode/route.ts').GET(new Request('https://app.test/api/managed-products/'+encodeURIComponent(skuId)+'/barcode?'+query),{params:Promise.resolve({skuId})});};
 const importRows=async(count=2,mutate)=>{const bytes=managedFixture(count,rows=>{rows.forEach((row,index)=>row['바코드']='00'+String(1000+index));mutate?.(rows);});const preview=await h.submit(bytes,{companyCode:company.code}),body=await preview.json();if(preview.status!==200)throw Error(JSON.stringify(body));const response=await h.submit(bytes,{action:'import',sha256:body.sha256,accountContext:body.accountContext,companyCode:company.code});if(response.status!==201)throw Error(await response.text());return body;};
 const snapshot=()=>JSON.stringify(h.sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all().map(table=>({schema:table,rows:h.sqlite.prepare('SELECT * FROM "'+table.name.replaceAll('"','""')+'"').all()})));
 return {...h,load,company,account,request,importRows,snapshot,sql,writes,controls};
}
