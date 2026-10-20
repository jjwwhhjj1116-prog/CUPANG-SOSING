import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {deflateSync,inflateSync} from 'node:zlib';
import {build} from 'esbuild';
import {mobileIntakeHarness} from '../tests/helpers/mobile-intake.mjs';

// Isolated UI QA. The existing helper supplies a temporary SQLite database,
// synthetic image bodies and Workers AI. It never uses production credentials
// or performs network I/O. Native/extension boundaries are disabled below.
const prepareOnly=process.argv.includes('--prepare-only'),root=process.cwd(),out=path.join(root,prepareOnly?'outputs/step757-browser-qa-prepare':'outputs/step757-browser-qa'),port=41757;
fs.mkdirSync(out,{recursive:true});
const h=mobileIntakeHarness({companyCode:'A01464742',companyName:'와이홉'}),requests=[],events=[],fixtureImageRequests=[],fixtureRangeReads=[],imageCache=new Map(),objectMetadata=new Map();
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const byteHash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function crc32(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0;}
function pngChunk(type,data){const name=Buffer.from(type),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([length,name,data,checksum]);}
function syntheticPng(source){
 if(imageCache.has(source))return imageCache.get(source);
 const width=1000,height=1000,stride=1+width*3,raw=Buffer.alloc(stride*height),shade=crypto.createHash('sha256').update(source).digest()[0];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const block=x>190&&x<810&&y>240&&y<730,bar=y>80&&y<140&&x>80&&x<920,foot=y>820&&y<900&&x>80&&x<920;
  const rgb=bar?[26,42,68]:block?[35+shade%90,130,190]:foot?[220,230,240]:[246,249,252],offset=y*stride+1+x*3;
  raw[offset]=rgb[0];raw[offset+1]=rgb[1];raw[offset+2]=rgb[2];
 }
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('tEXt',Buffer.from('Title\0Synthetic QA 757')),pngChunk('IDAT',deflateSync(raw)),pngChunk('IEND',Buffer.alloc(0))]);
 const inflated=[];let offset=8;
 while(offset<bytes.length){const length=bytes.readUInt32BE(offset),name=bytes.subarray(offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+length);if(crc32(Buffer.concat([name,data]))!==bytes.readUInt32BE(offset+8+length))throw Error('QA PNG chunk checksum mismatch');if(name.toString()==='IDAT')inflated.push(data);offset+=length+12;}
 if(offset!==bytes.length||!inflateSync(Buffer.concat(inflated)).equals(raw))throw Error('QA PNG decode mismatch');
 imageCache.set(source,bytes);return bytes;
}
// Replace only the injected provider before either synthetic product exists.
// Actual download/store handlers derive keys, dimensions and receipts normally.
const imageModule=h.load('app/collection-image.ts'),downloadImage=imageModule.downloadCollectionImage;
imageModule.downloadCollectionImage=(source,owner,_fetcher,role)=>downloadImage(source,owner,async target=>{const url=new URL(String(target));if(url.protocol!=='https:'||!url.hostname.endsWith('.alicdn.com'))throw Error('QA image provider only supports retained synthetic CDN URLs');const bytes=syntheticPng(url.href);fixtureImageRequests.push({source:url.href,sha256:byteHash(bytes),byteLength:bytes.length,width:1000,height:1000});return new Response(bytes,{headers:{'content-type':'image/png','content-length':String(bytes.length)}});},role);
const putObject=h.bindings.FILES.put,getObject=h.bindings.FILES.get;
h.bindings.FILES.put=async(key,bytes,options)=>{const customMetadata={...options?.customMetadata,sha256:byteHash(bytes)},next={...options,customMetadata},result=await putObject(key,bytes,next);if(result)objectMetadata.set(key,{httpMetadata:next.httpMetadata,customMetadata});return result;};
h.bindings.FILES.get=async(key,options)=>{
 const object=await getObject(key,options);if(!object)return null;
 const original=Buffer.from(await object.arrayBuffer()),range=options?.range;
 let offset=0,length=original.length;
 if(range){
  if(Object.keys(range).some(key=>!['offset','length','suffix'].includes(key))||range.suffix!==undefined&&(range.offset!==undefined||range.length!==undefined))throw Error('Unsupported QA object range');
  if(range.suffix!==undefined){if(!Number.isSafeInteger(range.suffix)||range.suffix<=0)throw Error('Invalid QA object suffix');offset=Math.max(0,original.length-range.suffix);}
  else{offset=range.offset??0;if(!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid QA object range offset');}
  if(range.length!==undefined&&(!Number.isSafeInteger(range.length)||range.length<=0))throw Error('Invalid QA object range length');
  const available=Math.max(0,original.length-offset);length=Math.min(range.length??available,available);
  fixtureRangeReads.push({key,requested:range,offset,length,objectSize:original.length});
 }
 const bytes=original.subarray(offset,offset+length);
 return{...object,size:original.length,...(range?{range:{offset,length}}:{}),body:new Response(bytes).body,arrayBuffer:async()=>Uint8Array.from(bytes).buffer};
};
if(!h.sqlite.prepare('PRAGMA table_info(products)').all().some(column=>column.name==='pricing_policy'))h.sqlite.exec('ALTER TABLE products ADD COLUMN pricing_policy TEXT');
await h.intake();
const oldId=h.latest.product_id;
function oldState(){
 const tables=h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
 return {tables:tables.flatMap(({name})=>{const columns=h.sqlite.prepare('PRAGMA table_info("'+name+'")').all().map(column=>column.name);
  const clauses=[],values=[];if(columns.includes('product_id')){clauses.push('product_id=?');values.push(oldId);}if(columns.includes('id')){clauses.push('id=?');values.push(oldId);}if(columns.includes('job_id')){clauses.push('job_id=?');values.push('job');}
  return clauses.length?[[name,h.sqlite.prepare('SELECT * FROM "'+name+'" WHERE '+clauses.join(' OR ')).all(...values)]]:[];}),
  job:h.sqlite.prepare("SELECT * FROM collection_jobs WHERE id='job'").get(),
  images:JSON.parse(h.sqlite.prepare('SELECT image_keys FROM products WHERE id=?').get(oldId).image_keys).map(key=>[key,byteHash(h.objects.get(key)??[]),objectMetadata.get(key)])};
}
const beforeOldSha256=hash(oldState()),sourceUrl='https://detail.1688.com/offer/700000000757.html',captureId='00000000-0000-4000-8000-000000000757';
const retained=await h.load('db/collection-results.ts').readCollectionResult('owner','job');
const images=['main','additional','detail'].map(role=>({...retained.result.images.find(image=>image.role===role)}));
const schema=h.load('app/quotation-schema.ts').getQuotationSchema('81452');
// Persist the selected profile before capture/intake, as the category picker
// does. The helper's unrelated legacy `cat` must not leak into the new draft.
const categoryInput={...h.context.category,name:'격리 검수용 저장 분류 81452',categoryId:schema.categoryId,categoryPath:schema.categoryPath};
const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',categoryInput,'cat757');
if(!profile)throw Error('QA category profile setup failed');
const category={...categoryInput,id:profile.id,revision:profile.revision};
const snapshot={format:'yoofam-page-source-v1',sourceUrl,offerId:'700000000757',collectedAt:new Date().toISOString(),title:'새 합성 757 단계 검수 상품',description:'격리 UI 검수를 위한 합성 상품 설명입니다. 실제 판매 상품이나 공급자 사양이 아닙니다.',
 options:[{key:'black',name:'검정 합성 옵션',supplierSku:null,unitPriceCny:7,currency:'CNY',minimumOrder:null,stock:null,imageUrl:images[0].url},{key:'white',name:'흰색 합성 옵션',supplierSku:null,unitPriceCny:9,currency:'CNY',minimumOrder:null,stock:null,imageUrl:images[0].url}],images,attributes:[{name:'재질',value:'검수용 합성 재질'}]};
const fingerprint=await h.load('app/source-inbox.ts').pageSourceFingerprint(snapshot);
const added=await h.load('app/api/source-inbox/route.ts').POST(new Request('http://localhost:'+port+'/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:'owner',expectedCompany:{code:'A01464742',name:'와이홉'},id:captureId,fingerprint,snapshot})}));
if(added.status!==200)throw Error('Synthetic capture setup failed: '+await added.text());
const now=new Date().toISOString(),newJobId='job757';
h.sqlite.prepare('INSERT INTO collection_jobs VALUES(?,?,?,?,?,?,?,?)').run(newJobId,'owner',snapshot.offerId,sourceUrl,'work','awaiting_connector',now,now);
h.sqlite.prepare('INSERT INTO collection_context VALUES(?,?)').run(newJobId,JSON.stringify({...h.context,category,keywords:'검수 상품',features:'합성 자료',capturedAt:now}));
const selection={format:'yoofam-saved-page-capture-v1',sourceUrl,captureId,fingerprint,revision:1};
const collected=await h.route('/api/collection-jobs/'+newJobId+'/collect',{method:'POST',body:{browserCapture:selection}});
if(collected.status!==200)throw Error('Synthetic collection failed: '+await collected.text());
await h.intake(newJobId);
const newId=h.latest.product_id;
if(!newId||newId===oldId)throw Error('QA must create a separate new product');
const content=await(await h.route('/api/products/'+newId+'/content')).json();
const renamed=await h.route('/api/products/'+newId+'/content',{method:'PATCH',body:{expectedRevision:content.content.revision,patch:{seo:{title:'새 합성 757 · 1~7단계 검수 상품',keywords:['검수 상품','합성 옵션']}}}});
if(renamed.status!==200)throw Error('Synthetic editable title setup failed: '+await renamed.text());
await h.load('db/queries.ts').saveSettings('owner',JSON.stringify(h.settings));
const bootstrap={workspaceOwnerId:'owner',company:{code:'A01464742',name:'와이홉'},oldProductId:oldId,newProductId:newId,sourceUrl,captureId,profileId:profile.id,categoryId:category.categoryId,categoryPath:category.categoryPath,entry:'새 합성 757 · 1~7단계 검수 상품',instructions:'목록의 새 합성 757 상품 → 옵션 보드의 SEO 설정 → 상단 1~7단계. 기존 합성 상품의 쓰기는 서버에서 차단합니다.'};
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import DashboardClient from '../../app/components/dashboard-client';import '../../app/globals.css';
const nativeFetch=window.fetch.bind(window),nativePostMessage=window.postMessage.bind(window),record=(type,detail)=>nativeFetch('/qa-event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,...detail})}).catch(()=>{});
window.fetch=(target,init)=>{const url=new URL(typeof target==='string'?target:target instanceof URL?target.href:target.url,location.href);if(url.origin!==location.origin){void record('blocked-external-fetch',{url:url.href});return Promise.reject(Error('격리 검수: 외부 요청은 금지됩니다.'));}return nativeFetch(target,init);};
window.postMessage=(message,...args)=>{if(message?.channel==='YOOFAM_SOURCE_INBOX'&&message.type==='FLUSH'){void record('blocked-source-inbox-flush',{channel:message.channel,type:message.type});return;}if(typeof message?.channel==='string'&&message.channel.startsWith('YOOFAM_')){void record('blocked-extension-message',{channel:message.channel,type:message.type});throw Error('격리 검수: 실제 확장 요청은 금지됩니다.');}return nativePostMessage(message,...args);};
window.open=(url)=>{void record('blocked-window-open',{url:String(url)});return null;};document.addEventListener('click',event=>{const anchor=event.target instanceof Element?event.target.closest('a'):null;if(anchor?.href&&new URL(anchor.href,location.href).origin!==location.origin){event.preventDefault();void record('blocked-external-navigation',{url:anchor.href});}},true);
window.addEventListener('error',event=>{void record('browser-error',{message:event.message});});window.addEventListener('unhandledrejection',event=>{void record('browser-rejection',{message:String(event.reason)});});
createRoot(document.getElementById('root')).render(<DashboardClient userName="격리 검수 계정 · 와이홉" workspaceOwnerId="owner"/>);`;
const csp="default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'none'; worker-src 'self' blob:; form-action 'self'; object-src 'none'; base-uri 'self'";
let buildCount=0,lastBuildAt=null;
async function rebuild(){
 await build({stdin:{contents:entry,resolveDir:out,sourcefile:'entry.tsx',loader:'tsx'},bundle:true,outfile:path.join(out,'client.js'),platform:'browser',conditions:['style'],format:'esm',jsx:'automatic',target:'chrome120',define:{'process.env.NODE_ENV':'"development"'},logLevel:'warning',plugins:[{name:'qa-boundaries-only',setup(builder){
  builder.onResolve({filter:/^@\/app\/browser-product-bridge$/},()=>({path:'saved-capture',namespace:'qa-boundary'}));
  builder.onResolve({filter:/^@\/app\/supplier-hub-handoff$/},()=>({path:'handoff',namespace:'qa-boundary'}));
  builder.onResolve({filter:/^\/fonts\//},args=>({path:args.path,external:true}));
  builder.onLoad({filter:/.*/,namespace:'qa-boundary'},args=>({loader:'ts',resolveDir:root,contents:args.path==='handoff'?
   fs.readFileSync(path.join(root,'app/supplier-hub-handoff.ts'),'utf8').replace(/export function exchange\([\s\S]*?\n}\nexport async function checkSupplierHubExtension/,'export async function exchange(){throw Error("격리 검수: 실제 확장과 Supplier Hub 요청은 금지됩니다.");}\nexport async function checkSupplierHubExtension'):
   `export async function probe1688FromChrome(sourceUrl,signal,selection){const selected=selection?.sourceCapture??selection;const query=new URLSearchParams({sourceUrl});if(selected?.captureId){query.set('captureId',selected.captureId);query.set('fingerprint',selected.fingerprint);query.set('revision',String(selected.revision));}const response=await fetch('/api/source-inbox/ready?'+query,{signal,cache:'no-store'}),body=await response.json();if(!response.ok||!body.capture)throw Error(body.error??'Only a saved synthetic capture is allowed');return body.capture;}export const capture1688FromChrome=probe1688FromChrome;`}));
 }}]});
 buildCount++;lastBuildAt=new Date().toISOString();
}
await rebuild();
function proof(){const currentOldSha256=hash(oldState()),value={...bootstrap,beforeOldSha256,currentOldSha256,oldProductAndReceiptUnchanged:beforeOldSha256===currentOldSha256,buildCount,lastBuildAt,products:h.sqlite.prepare('SELECT id,title,source_price_cny,options_count,updated_at FROM products').all(),requests,events,fixtureRequests:h.network,fixtureImageRequests,fixtureRangeReads,images:[...h.objects].map(([key,bytes])=>({key,sha256:byteHash(bytes),byteLength:bytes.length,metadata:objectMetadata.get(key)})),realSourceRequests:0,hubRequests:0,nativeRequests:0,note:'Actual full DashboardClient and actual app handlers/SQLite. Synthetic saved source, category context, valid generated 1000x1000 PNGs and Workers AI. Provider PNG chunks/CRC/zlib contents verified before collection; actual image handlers compute source keys and metadata. No real source/Hub/native/credential/production DB access. Not a receipt verification.'};fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify(value,null,2));return value;}
fs.writeFileSync(path.join(out,'bootstrap.json'),JSON.stringify(bootstrap,null,2));
const html='<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YOOFAM 스튜디오 · 격리 단계 검수757</title><link rel="stylesheet" href="/qa.css"></head><body><div id="root"></div><script type="module" src="/client.js"></script></body></html>';
function resolveRoute(url){const parts=url.pathname.split('/').filter(Boolean),params={};let file;if(parts[1]==='files'&&parts.length>=3){params.key=parts.slice(2).map(decodeURIComponent);file='app/api/files/[...key]/route.ts';}else if(['products','collection-jobs','category-profiles'].includes(parts[1])&&parts.length>=3){params.id=decodeURIComponent(parts[2]);file=['app/api/'+parts[1]+'/[id]',...parts.slice(3),'route.ts'].join('/');}else file=['app',...parts,'route.ts'].join('/');return{params,file};}
async function dispatch(url,method,body,headers={}){
 const {params,file}=resolveRoute(url);
 if(!fs.existsSync(path.join(root,file)))return Response.json({error:'Unknown local QA API '+url.pathname},{status:404});
 const handler=h.load(file)[method];if(typeof handler!=='function')return Response.json({error:'Unsupported local QA method'},{status:405});
 const request=new Request(url.href,{method,headers,...(body.length?{body}:{})});
 return handler(request,{params:Promise.resolve(params)});
}
// GET-only startup smoke against the same real handlers the browser will use.
for(const pathname of ['/api/products','/api/settings','/api/collection-jobs','/api/category-profiles','/api/products/'+newId+'/seo-workspace','/api/products/'+newId+'/quotation-fields']){
 const result=await dispatch(new URL(pathname,'http://localhost:'+port),'GET',Buffer.alloc(0));if(!result.ok)throw Error('QA startup '+pathname+': '+result.status+' '+await result.text());
 requests.push({method:'GET',path:pathname,status:result.status,startup:true});
}
const imageKeys=JSON.parse(h.sqlite.prepare('SELECT image_keys FROM products WHERE id=?').get(newId).image_keys);
for(const key of imageKeys){const response=await dispatch(new URL('/api/files/'+key.split('/').map(encodeURIComponent).join('/'),'http://localhost:'+port),'GET',Buffer.alloc(0)),bytes=Buffer.from(await response.arrayBuffer()),stored=h.objects.get(key),head=await h.bindings.FILES.head(key);
 if(!response.ok||response.headers.get('content-type')!=='image/png'||response.headers.get('content-length')!==String(stored.length)||!bytes.equals(stored)||!key.includes(byteHash(bytes))||head.customMetadata.sha256!==byteHash(bytes)||head.customMetadata.imageWidth!=='1000'||head.customMetadata.imageHeight!=='1000')throw Error('QA source/R2/API image integrity mismatch: '+key);
 requests.push({method:'GET',path:'/api/files/'+key,status:response.status,startup:true,sha256:byteHash(bytes),byteLength:bytes.length,width:1000,height:1000});
 const ranged=await h.bindings.FILES.get(key,{range:{offset:0,length:1024}}),prefix=Buffer.from(await h.load('app/request-body.ts').readBoundedStream(ranged.body,1024));
 if(ranged.size!==stored.length||ranged.range.offset!==0||ranged.range.length!==1024||prefix.length!==1024||!prefix.equals(Buffer.from(stored).subarray(0,1024))||h.load('app/image-files.ts').imageFileType(prefix).contentType!=='image/png')throw Error('QA R2 ranged header/body mismatch: '+key);
}
if(prepareOnly){
 const form=new FormData();form.set('file',new File([syntheticPng('qa757-label-smoke')],'qa757-label.png',{type:'image/png'}));
 const uploaded=await h.load('app/api/files/route.ts').POST(new Request('http://localhost:'+port+'/api/files',{method:'POST',body:form})),upload=await uploaded.json();
 if(uploaded.status!==201||typeof upload.key!=='string')throw Error('QA PNG upload smoke failed: '+JSON.stringify(upload));
 const product=h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(newId),content=await(await h.route('/api/products/'+newId+'/content')).json();
 const attached=await h.route('/api/products/'+newId+'/attachments',{method:'POST',body:{key:upload.key,role:'label',expectedVersion:product.updated_at,expectedContentRevision:content.content.revision}}),attachment=await attached.json();
 if(attached.status!==200)throw Error('QA ranged PNG attachment smoke failed: '+JSON.stringify(attachment));
 requests.push({method:'POST',path:'/api/files',status:uploaded.status,startup:true},{method:'POST',path:'/api/products/'+newId+'/attachments',status:attached.status,startup:true});
 proof();fs.writeFileSync(path.join(out,'synthetic-source.png'),h.objects.get(imageKeys[0]));console.log('STEP757_QA_PREPARED '+JSON.stringify({...bootstrap,images:imageKeys.length,rangedLabelAttachment:attached.status,outputDirectory:out}));h.close();
}
else{
 const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://'+(req.headers.host??'127.0.0.1:'+port)),headers={'cache-control':'no-store','content-security-policy':csp};
  try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)throw Error('QA request too large');chunks.push(chunk);}const body=Buffer.concat(chunks);
   if(url.pathname==='/qa-event'){events.push(JSON.parse(body));proof();res.writeHead(204,headers);return res.end();}
   if(url.pathname==='/qa-bootstrap'||url.pathname==='/qa-proof'){res.writeHead(200,{...headers,'content-type':'application/json'});return res.end(JSON.stringify(url.pathname==='/qa-proof'?proof():bootstrap,null,2));}
   if(url.pathname==='/qa-rebuild'&&req.method==='POST'){await rebuild();proof();res.writeHead(200,{...headers,'content-type':'application/json'});return res.end(JSON.stringify({buildCount,lastBuildAt,oldProductAndReceiptUnchanged:beforeOldSha256===hash(oldState())}));}
   if(url.pathname.startsWith('/api/')){
    let reply;
    if(!['GET','HEAD'].includes(req.method)&&(url.pathname.startsWith('/api/products/'+oldId)||body.includes(Buffer.from(oldId))))reply=Response.json({error:'격리 검수: 기존 합성 작업 상품은 읽기 전용입니다.'},{status:409});
    else if(!['GET','HEAD'].includes(req.method)&&(/supplier-hub|source-supplement|automation|image-generation/.test(url.pathname)||url.pathname==='/api/settings'||url.pathname.startsWith('/api/collection-jobs')))reply=Response.json({error:'격리 검수: 외부 실행·설정 변경·새 수집 요청은 차단했습니다.'},{status:403});
    else reply=await dispatch(url,req.method,body,req.headers);
    const bytes=Buffer.from(await reply.arrayBuffer());let error;if(reply.status>=400){try{error=JSON.parse(bytes.toString('utf8'));}catch{error={error:bytes.toString('utf8').slice(0,4096)};}}requests.push({method:req.method,path:url.pathname,query:url.search,status:reply.status,...(error?{error}:{})});proof();res.writeHead(reply.status,{...Object.fromEntries(reply.headers),...headers});return res.end(bytes);
   }
   if(url.pathname==='/'){res.writeHead(200,{...headers,'content-type':'text/html;charset=utf-8'});return res.end(html);}
   if(url.pathname==='/client.js'){res.writeHead(200,{...headers,'content-type':'application/javascript'});return fs.createReadStream(path.join(out,'client.js')).pipe(res);}
   if(url.pathname==='/qa.css'){res.writeHead(200,{...headers,'content-type':'text/css'});return fs.createReadStream(path.join(out,'client.css')).pipe(res);}
   const base=path.join(root,'public'),file=path.resolve(base,'.'+url.pathname);if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404,headers);return res.end();}
   const contentType=file.endsWith('.ttf')?'font/ttf':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.png')?'image/png':'application/octet-stream';res.writeHead(200,{...headers,'content-type':contentType});return fs.createReadStream(file).pipe(res);
  }catch(error){events.push({type:'server-error',path:url.pathname,message:String(error.stack??error)});requests.push({method:req.method,path:url.pathname,query:url.search,status:500,error:{error:String(error.message)}});proof();res.writeHead(500,{...headers,'content-type':'application/json'});res.end(JSON.stringify({error:String(error.message)}));}
 });
 server.listen(port,'127.0.0.1',()=>{proof();console.log('STEP757_QA_READY http://127.0.0.1:'+port+' new='+newId+' old='+oldId);});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{proof();server.close(()=>{h.close();process.exit(0);});});
}
