import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {sizeChartApiFixture,companies,json,plain,allTables} from './supplier-hub-single-size-chart.mjs';
export {companies,json,plain};
export const source={productId:'synthetic-size708',productVersion:'2026-10-18T00:00:00.000Z',contentRevision:1,sourceKey:'owner/source708.png',sourceSha256:'a'.repeat(64),role:'detail',width:800,height:600};
export const lines=(texts=['单位 cm','尺码 S M','胸围 40.5 44','衣长 60'])=>texts.map((text,index)=>({id:'line-'+index,text,box:{x:10,y:index*50+10,width:700,height:35},confidence:93}));
export const request=(texts)=>({source:structuredClone(source),language:'zh',display:{width:800,height:600},lines:lines(texts)});
export function selection(tokens){
 const ref=(line,text)=>{const token=tokens.find(token=>token.lineId==='line-'+line&&token.text===text);if(!token)throw Error('Missing fixture token '+line+':'+text);return[token.id];};
 return{hasSizeChart:true,unit:ref(0,'cm'),sizes:[ref(1,'S'),ref(1,'M')],measurements:[{name:ref(2,'胸围'),values:[ref(2,'40.5'),ref(2,'44')]},{name:ref(3,'衣长'),values:[ref(3,'60'),null]}]};
}
const sha=value=>createHash('sha256').update(value).digest('hex');
export async function extractionApiFixture(company=companies[0]){
 const f=await sizeChartApiFixture(company),{h}=f,sourceKey='owner/synthetic-size-ocr708.png',pixels=await sharp({create:{width:800,height:600,channels:4,background:'#eeeeee'}}).png().toBuffer();
 const product=h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.id);h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([...JSON.parse(product.image_keys),sourceKey]),f.id);await h.bindings.FILES.put(sourceKey,pixels,{httpMetadata:{contentType:'image/png'}});
 h.bindings.SOURCEFLOW_QUOTATION_AI_PROVIDER='workers-ai';h.bindings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY='true';
 const auth={owner:'owner',company:{...company},verified:true},calls=[],google=[],requests=[];let provider=async(_model,input)=>({response:JSON.stringify(selection(JSON.parse(input.messages[1].content).tokens))}),translation=null;
 h.bindings.AI.run=async(model,input)=>{calls.push({model,input:plain(input)});return provider(model,input);};
 const fetcher=async target=>{const url=new URL(target);google.push({host:url.hostname,text:url.searchParams.get('q')});if(url.hostname!=='translate.googleapis.com')throw Error('Unexpected local fixture request');if(translation)return translation(url);
  const translated=url.searchParams.get('q').replaceAll('胸围','가슴둘레').replaceAll('衣长','옷길이');return Response.json([[[translated]],null,'zh-CN']);};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../app/api/products/[id]/size-chart-draft/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,Error,URL,Response,Request,Uint8Array,TextEncoder,TextDecoder,crypto,fetch:fetcher,
  require(name){if(name==='next/server')return{NextResponse:Response};if(name==='cloudflare:workers')return{env:h.bindings};if(name==='@/app/chatgpt-auth')return{getWorkspaceOwnerId:async()=>auth.owner,getChatGPTUser:async()=>({userId:auth.owner,verifiedAccess:auth.verified,membership:{id:auth.owner,email:'synthetic708@example.test',role:'member',status:'approved',companyCode:auth.company.code,companyName:auth.company.name}})};return h.load(name.slice(2)+'.ts');}
 });
 const endpoint=f.base+'/size-chart-draft',route=async(url=endpoint,{method='GET',body,headers={}}={})=>{const response=await exports[method](new Request('https://app.test'+url,{method,headers:{'content-type':'application/json',...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),{params:Promise.resolve({id:url.split('/')[3]})});requests.push({url,method,status:response.status});return response;};
 const getSource=()=>route(endpoint+'?'+new URLSearchParams({sourceKey})).then(json).then(value=>value.source);
 const body=async()=>({...request(),source:await getSource()});
 const state=()=>({db:JSON.stringify(JSON.parse(allTables(f)).filter(([table])=>table!=='quotation_ai_daily')),objects:JSON.stringify([...h.objects].map(([key,bytes])=>[key,sha(bytes)]))});
 const quota=()=>h.sqlite.prepare('SELECT COALESCE(SUM(requests),0) n FROM quotation_ai_daily').get().n;
 return{...f,company,sourceKey,pixels,auth,calls,google,requests,endpoint,route,getSource,body,state,quota,setProvider(value){provider=value;},setTranslation(value){translation=value;}};
}
