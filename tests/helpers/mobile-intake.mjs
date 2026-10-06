import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';
import * as nodeCrypto from 'node:crypto';
import path from 'node:path';
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
// Faithful recorded-source translations, rather than Chinese passthrough
// counted as a completed attribute. Unknown source facts remain untranslated.
const genericTranslation=new Map(Object.entries({
 '是否偏光':'편광 여부','否':'아니요','抗UV等级':'UV 등급','镜片材质':'렌즈 재질','品牌':'브랜드','利翔':'리샹',
 '眼镜款式':'안경 형태','圆框':'원형 테','镜框材质':'테 재질','镜架材质':'안경테 재질',
 '是否支持近视镜':'근시용 렌즈 지원 여부','不支持近视镜':'근시용 렌즈 미지원','货号':'판매자 품번',
 '镜片颜色':'렌즈 색상','镜架颜色':'테 색상','黑色':'검정','透射比分类':'투과율 분류','2类/遮阳镜':'2등급/선글라스',
 '眼镜结构':'안경 구조','全框':'풀 테','适用场景':'사용 상황','防晒,出游,骑行,驾驶,派对聚会':'차광,외출,자전거 타기,운전,파티 모임',
 '上市年份/季节':'출시 연도/계절','2024年夏季':'2024년 여름','是否跨境出口专供货源':'수출 전용 상품 여부','是':'예',
 '颜色':'색상','亮黑,砂黑,砂灰':'유광 검정,무광 검정,무광 회색','尺码':'사이즈','太阳镜,太阳镜 加005 盒子':'선글라스,선글라스 + 005 케이스',
 '产地':'생산지','台州':'타이저우','风格':'스타일','可爱风,日韩风,甜美风,小清新':'귀여운 스타일,일본 한국 스타일,사랑스러운 스타일,산뜻한 스타일',
 '适用性别':'사용 성별','通用':'공용','风格分类':'스타일 분류','清新甜美':'산뜻하고 사랑스러운 스타일',
 '主要销售地区':'주요 판매 지역','非洲,欧洲,南美,东南亚,北美,东北亚,中东,其他':'아프리카,유럽,남미,동남아,북미,동북아,중동,기타',
 '流行元素分类':'유행 요소 분류','生活用品':'생활용품',
}));
const translated=pair=>pair.name.startsWith('option-color:')?color(pair.value):pair.name.startsWith('option-size:')?size(pair.value):pair.name.startsWith('option:')?pair.value.split(' / ').map((part,index)=>index?size(part):color(part)).join(' / '):genericTranslation.get(pair.value)??pair.value;
const translatedName=pair=>pair.name.startsWith('상품속성: ')?genericTranslation.get(pair.name.slice('상품속성: '.length))??pair.name:pair.name;

/** Real handlers and SQLite, recorded public supplier facts; auth, AI and image
 * bytes are fixtures. Never contacts Supplier Hub or alters a real product. */
export function mobileIntakeHarness({companyCode='A01464742',companyName='와이홉',sourceFetcher,translationFetcher,desktopStatus=200}={}){
 const sqlite=memoryDatabase();for(const statement of runtimeDDL())sqlite.exec(statement.sql);
 const db={prepare(sql){let args=[];const q={bind(...values){args=values;return q;},execute(){return sqlite.prepare(sql).all(...args);},async all(){return {results:q.execute()};},async first(){return q.execute()[0]??null;},async run(){return sqlite.prepare(sql).run(...args);}};return q;},async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(statement=>({results:statement.execute()}));sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const objects=new Map(),objectMetadata=new Map(),calls=[],network=[],cache=new Map(),aiSources=[];
 const stats={activeDownloads:0,maxDownloads:0,downloads:0,skuRequests:0,failImageIndex:null,cancelDuringDownload:false};
 const sourceUrl='https://detail.1688.com/offer/813724060928.html';
 const bindings={DB:db,FILES:{head:async key=>objects.has(key)?{size:objects.get(key).length,httpMetadata:{contentType:'image/png'},...objectMetadata.get(key)}:null,put:async(key,bytes,options)=>{if(options?.onlyIf?.get('if-none-match')==='*'&&objects.has(key))return null;objects.set(key,new Uint8Array(bytes));objectMetadata.set(key,{httpMetadata:options?.httpMetadata,customMetadata:options?.customMetadata});return {};},get:async key=>{const bytes=objects.get(key);return bytes?{size:bytes.byteLength,arrayBuffer:async()=>bytes.slice().buffer,...objectMetadata.get(key)}:null;}},ALIBABA_PRODUCT_API_ENABLED:'false',SOURCEFLOW_TEXT_PROVIDER:'workers-ai',SOURCEFLOW_TEXT_MODEL:'@cf/meta/llama-3.3-70b-instruct-fp8-fast',SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS:'4096',AI:{run:async(model,input)=>{assert.equal(model,bindings.SOURCEFLOW_TEXT_MODEL);const source=JSON.parse(input.messages[1].content);aiSources.push(source);return {response:{title:'우드 패턴 다리 선글라스',description:'상품 원문에 따른 검토용 설명',keywords:['선글라스'],warnings:[],attributes:source.attributes.map((pair,sourceIndex)=>({sourceIndex,name:translatedName(pair),value:translated(pair)}))}};}}};
 const deps={'cloudflare:workers':{env:bindings},'@/app/chatgpt-auth':{getChatGPTUser:async()=>({verifiedAccess:true,userId:'owner',membership:{id:'owner',status:'approved',companyCode,companyName}}),getWorkspaceOwnerId:async()=>'owner'},'next/server':{NextResponse:Response},parse5,'node:crypto':nodeCrypto,'@/extensions/supplier-hub/product-jsonld.mjs':{parseProductJsonLd}};
 async function externalFetch(target,init){
  const url=new URL(target);network.push(url.hostname);
  if(url.hostname==='translate.googleapis.com' && translationFetcher)return translationFetcher(target,init);
  if(['detail.1688.com','m.1688.com','h5api.m.1688.com','itemcdn.tmall.com'].includes(url.hostname)){
   if(sourceFetcher)return sourceFetcher(target,init);
   if(url.hostname==='detail.1688.com')return new Response('<html>No JSON-LD on the observed desktop page</html>',{status:desktopStatus,headers:{'content-type':'text/html',...(desktopStatus===302?{location:'https://login.1688.com/'}:{})}});
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
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,URLSearchParams,Date,Headers,Response,Request,File,FormData,Blob,CompressionStream,DecompressionStream,TextEncoder,TextDecoder,Uint8Array,DataView,AbortController,AbortSignal,setTimeout,clearTimeout,structuredClone,crypto:nodeCrypto.webcrypto,process:{env:{NODE_ENV:'production'}},fetch:externalFetch,require(name){if(name in deps)return deps[name];if(name.startsWith('./')||name.startsWith('../'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');assert.ok(name.startsWith('@/'),name);return load(name.slice(2)+'.ts');}});
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
  if(path.startsWith('/api/files?'))return load('app/api/files/route.ts')[method](new Request('https://app.test'+path,{method}));
  if(path.startsWith('/api/collection-jobs/job/')){file='app/api/collection-jobs/[id]/'+path.split('/').at(-1)+'/route.ts';params={id:'job'};}
  else{const parts=path.split('?')[0].split('/');file='app/api/products/[id]/'+parts.at(-1)+'/route.ts';params={id:parts[3]};}
  return load(file)[method](new Request('https://app.test'+path,{method,headers:{'content-type':'application/json'},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),{params:Promise.resolve(params)});
 };
 let latest;
 const intake=async()=>load('app/intake-collection.ts').collectIntakeProduct(await load('db/collection-jobs.ts').findCollectionJob('owner','job'),{signal:new AbortController().signal,fetcher:(path,init)=>route(path,{method:init?.method??'GET',body:init?.body}),onJob:job=>{latest=job;},onProgress:()=>{}});
 return {sqlite,db,objects,calls,network,aiSources,bindings,stats,settings,context,sourceUrl,load,route,intake,get latest(){return latest;},close(){sqlite.close();}};
}
