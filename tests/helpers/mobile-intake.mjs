import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';
import * as nodeCrypto from 'node:crypto';
import assert from 'node:assert/strict';
import {memoryDatabase,runtimeDDL} from '../../scripts/check-db-schema.mjs';
import {parseProductJsonLd} from '../../extensions/supplier-hub/product-jsonld.mjs';

const read=name=>fs.readFileSync(new URL('../fixtures/'+name,import.meta.url),'utf8');
const mobile=JSON.parse(read('1688-mobile-813724060928.json'));
const skus=JSON.parse(read('1688-skus-813724060928.json'));
const detail=read('1688-description-813724060928.txt');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64');
const color=value=>({'亮黑':'유광 검정','砂黑':'무광 검정','砂灰':'무광 회색'}[value]??value);
const size=value=>value==='太阳镜'?'선글라스':value==='太阳镜 加005 盒子'?'선글라스 + 005 케이스':value;
const translated=pair=>pair.name.startsWith('option-color:')?color(pair.value):pair.name.startsWith('option-size:')?size(pair.value):pair.name.startsWith('option:')?pair.value.split(' / ').map((part,index)=>index?size(part):color(part)).join(' / '):pair.value;

/** Real handlers and SQLite, recorded public supplier facts; auth, AI and image
 * bytes are fixtures. Never contacts Supplier Hub or alters a real product. */
export function mobileIntakeHarness({companyCode='A01464742',companyName='와이홉',sourceFetcher}={}){
 const sqlite=memoryDatabase();for(const statement of runtimeDDL())sqlite.exec(statement.sql);
 const db={prepare(sql){let args=[];const q={bind(...values){args=values;return q;},execute(){return sqlite.prepare(sql).all(...args);},async all(){return {results:q.execute()};},async first(){return q.execute()[0]??null;},async run(){return sqlite.prepare(sql).run(...args);}};return q;},async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(statement=>({results:statement.execute()}));sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const objects=new Map(),calls=[],network=[],cache=new Map(),aiSources=[];
 const stats={activeDownloads:0,maxDownloads:0,downloads:0,skuRequests:0,failImageIndex:null,cancelDuringDownload:false};
 const sourceUrl='https://detail.1688.com/offer/813724060928.html';
 const bindings={DB:db,FILES:{head:async key=>objects.has(key)?{size:objects.get(key).length,httpMetadata:{contentType:'image/png'}}:null,put:async(key,bytes)=>{objects.set(key,new Uint8Array(bytes));return {};},get:async key=>{const bytes=objects.get(key);return bytes?{size:bytes.byteLength,arrayBuffer:async()=>bytes.slice().buffer}:null;}},ALIBABA_PRODUCT_API_ENABLED:'false',SOURCEFLOW_TEXT_PROVIDER:'workers-ai',SOURCEFLOW_TEXT_MODEL:'@cf/meta/llama-3.1-8b-instruct',SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS:'4096',AI:{run:async(model,input)=>{assert.equal(model,bindings.SOURCEFLOW_TEXT_MODEL);const source=JSON.parse(input.messages[1].content);aiSources.push(source);return {response:{title:'우드 패턴 다리 선글라스',description:'상품 원문에 따른 검토용 설명',keywords:['선글라스'],warnings:[],attributes:source.attributes.map((pair,sourceIndex)=>({sourceIndex,name:pair.name,value:translated(pair)}))}};}}};
 const deps={'cloudflare:workers':{env:bindings},'@/app/chatgpt-auth':{getChatGPTUser:async()=>({verifiedAccess:true,userId:'owner',membership:{id:'owner',status:'approved',companyCode,companyName}}),getWorkspaceOwnerId:async()=>'owner'},'next/server':{NextResponse:Response},parse5,'node:crypto':nodeCrypto,'@/extensions/supplier-hub/product-jsonld.mjs':{parseProductJsonLd}};
 async function externalFetch(target,init){
  const url=new URL(target);network.push(url.hostname);
  if(['detail.1688.com','m.1688.com','h5api.m.1688.com','itemcdn.tmall.com'].includes(url.hostname)){
   if(sourceFetcher)return sourceFetcher(target,init);
   if(url.hostname==='detail.1688.com')return new Response('<html>No JSON-LD on the observed desktop page</html>',{headers:{'content-type':'text/html'}});
   if(url.hostname==='m.1688.com')return new Response('<script>window.__INIT_DATA='+JSON.stringify(mobile)+';</script>',{headers:{'content-type':'text/html;charset=utf-8'}});
   if(url.hostname==='itemcdn.tmall.com')return new Response(detail);
   stats.skuRequests++;
   if(stats.skuRequests===1)return Response.json({ret:['FAIL_SYS_TOKEN_EMPTY::fixture']},{headers:{'set-cookie':'_m_h5_tk=fixture123_9999999999999; Path=/, _m_h5_tk_enc=fixture456; Path=/'}});
   return Response.json(skus);
  }
  assert.equal(url.hostname,'cbu01.alicdn.com');
  const urls=load('app/alibaba-mobile-product.ts').parseAlibabaMobileProduct(load('app/alibaba-mobile-product.ts').parseAlibabaMobilePage('<script>window.__INIT_DATA='+JSON.stringify(mobile)+';</script>',sourceUrl),skus,load('app/alibaba-mobile-product.ts').parseAlibabaMobileDescription(detail)).images;
  const index=urls.findIndex(image=>image.url===url.href);assert.ok(index>=0);
  stats.activeDownloads++;stats.downloads++;stats.maxDownloads=Math.max(stats.maxDownloads,stats.activeDownloads);
  try{
   await new Promise(resolve=>setTimeout(resolve,3));
   if(stats.onDownloadFinished)await stats.onDownloadFinished();
   if(stats.cancelDuringDownload)sqlite.prepare("UPDATE collection_jobs SET status='cancelled' WHERE id='job'").run();
   if(stats.failImageIndex===index)throw Error('fixture CDN interruption');
   // Unique valid PNG headers model different files without storing seller media.
   return new Response(Buffer.concat([png,Buffer.from([index])]),{headers:{'content-type':'image/png'}});
  }finally{stats.activeDownloads--;}
 }
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,URLSearchParams,Date,Response,Request,Blob,CompressionStream,DecompressionStream,TextEncoder,TextDecoder,Uint8Array,DataView,AbortController,AbortSignal,setTimeout,clearTimeout,structuredClone,crypto:nodeCrypto.webcrypto,process:{env:{NODE_ENV:'production'}},fetch:externalFetch,require(name){if(name in deps)return deps[name];assert.ok(name.startsWith('@/'),name);return load(name.slice(2)+'.ts');}});
  return exports;
 }
 const now=new Date().toISOString(),settings=load('app/observed-price-preset.ts').applyObservedPricePreset({...load('app/workspace-settings.ts').defaultSettings,brand:'검토 브랜드',manufacturer:'검토 제조사',importer:companyName,boxSkuQuantity:50,tradeType:'제조사',importType:'수입상품',serviceContact:'쿠팡 고객센터 1577-7011'});
 // 80719 is an observed form contract only, deliberately not the commercial
 // classification for these sunglasses. No test performs a Hub submission.
 const context={category:{id:'cat',name:'바스켓',categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓'],mappings:[],template:null},settings,features:'',keywords:'선글라스',capturedAt:now};
 sqlite.prepare('INSERT INTO collection_jobs VALUES(?,?,?,?,?,?,?,?)').run('job','owner','813724060928',sourceUrl,'price','awaiting_connector',now,now);
 sqlite.prepare('INSERT INTO collection_context VALUES(?,?)').run('job',JSON.stringify(context));
 const route=async(path,{method='GET',body}={})=>{
  calls.push(path);let file,params;
  if(path.startsWith('/api/collection-jobs/job/')){file='app/api/collection-jobs/[id]/'+path.split('/').at(-1)+'/route.ts';params={id:'job'};}
  else{const parts=path.split('/');file='app/api/products/[id]/'+parts.at(-1)+'/route.ts';params={id:parts[3]};}
  return load(file)[method](new Request('https://app.test'+path,{method,headers:{'content-type':'application/json'},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),{params:Promise.resolve(params)});
 };
 let latest;
 const intake=async()=>load('app/intake-collection.ts').collectIntakeProduct(await load('db/collection-jobs.ts').findCollectionJob('owner','job'),{signal:new AbortController().signal,fetcher:(path,init)=>route(path,{method:init?.method??'GET',body:init?.body}),onJob:job=>{latest=job;},onProgress:()=>{}});
 return {sqlite,db,objects,calls,network,aiSources,bindings,stats,settings,context,sourceUrl,load,route,intake,get latest(){return latest;},close(){sqlite.close();}};
}
