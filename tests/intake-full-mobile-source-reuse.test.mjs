import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const profileFile=new URL('../outputs/step604-unand-profile-read.json',import.meta.url);
const originalFile=new URL('../outputs/step603-official-unand-2624.xlsx',import.meta.url);
const available=fs.existsSync(profileFile)&&fs.existsSync(originalFile);
const read=name=>fs.readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8');
const recordedGallery=new Set(Object.values(JSON.parse(read('1688-mobile-813724060928.json')).data).find(value=>value?.data?.offerImgList).data.offerImgList);
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};

/** Recorded supplier responses are remapped to a synthetic offer. Every route,
 * receipt, draft, price and export uses the actual API and SQLite. HTTP/Chrome/
 * model/image bytes are local fixtures. The original workbook belongs to Unand;
 * Waihop is an isolated reuse of its public contract, not a fresh Hub capture. */
export async function fullMobileReuseFixture(company=companies[0],{partial=false,browserFallback=false}={}){
 const sourceUrl='https://detail.1688.com/offer/643000000001.html';
 const mobile=JSON.parse(read('1688-mobile-813724060928.json').replaceAll('813724060928','643000000001'));
 const skus=JSON.parse(read('1688-skus-813724060928.json').replaceAll('813724060928','643000000001'));
 const detail=read('1688-description-813724060928.txt'),sourceRequests=[],requests=[],progress=[],updates=[];
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,sourceFetcher:async(target,init)=>{
  const host=new URL(target).hostname;sourceRequests.push({host,signal:init?.signal});
  if(browserFallback)return new Response('',{status:302});
  if(host==='detail.1688.com')return new Response('<html>Recorded desktop has no product metadata</html>',{headers:{'content-type':'text/html'}});
  if(host==='m.1688.com')return new Response('<script>window.__INIT_DATA='+JSON.stringify(mobile)+';</script>',{headers:{'content-type':'text/html'}});
  if(host==='h5api.m.1688.com')return Response.json(skus);
  if(host==='itemcdn.tmall.com')return new Response(partial?'temporary optional detail outage':detail,{status:partial?503:200});
  throw Error('Unexpected local source host');
 }});
 try{
  await h.load('db/queries.ts').saveSettings('owner',JSON.stringify(h.settings));
  const recorded=JSON.parse(JSON.parse(fs.readFileSync(profileFile,'utf8'))[0].results[0].payload);
  const hubSchema=structuredClone(recorded.hubSchema),bytes=new Uint8Array(fs.readFileSync(originalFile));hubSchema.company={...company};
  const form=new FormData();form.set('file',new File([bytes],'recorded-original.xlsx'));form.set('schema',JSON.stringify(hubSchema));form.set('action','workbook');
  const linked=await json(await h.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test/api/category-profiles/official-template',{method:'POST',body:form})),201);
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'LOCAL FULL MOBILE REUSE',categoryId:recorded.categoryId,categoryPath:recorded.categoryPath,hubSchema,template:linked.template,mappings:linked.mappings});
  const queued=await json(await h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({urls:[sourceUrl],goal:'work',profileId:profile.id,expectedProfileRevision:profile.revision,expectedSettings:h.settings})})));
  const job=queued.jobs[0],context=h.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get(job.id).payload;
  let captures=0,amend=null;
  const capture=()=>({format:'1688-public-mobile-capture-v1',sourceUrl,mobileHtml:'<script>window.__INIT_DATA='+JSON.stringify(mobile)+';</script>',skuPayload:skus,detailSource:detail});
  const request=async(path,init={})=>{requests.push({path,method:init.method??'GET',body:init.body?JSON.parse(init.body):null});const response=await h.route(path,{method:init.method??'GET',body:init.body});return amend?await amend(path,response)??response:response;};
  const run=(current=job,signal=new AbortController().signal)=>h.load('app/intake-collection.ts').collectIntakeProduct(current,{signal,fetcher:request,onJob:value=>updates.push(value),onProgress:value=>progress.push(value),captureFromBrowser:async()=>{captures++;return capture();}});
  const product=()=>h.sqlite.prepare('SELECT * FROM products WHERE source_url=?').get(sourceUrl);
  const content=()=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(product().id).payload);
  const options=()=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(product().id).payload);
  const receipt=()=>h.sqlite.prepare('SELECT * FROM collection_results WHERE job_id=?').get(job.id);
  const retained=()=>JSON.stringify({product:product(),content:content(),options:options(),pricing:h.sqlite.prepare('SELECT * FROM product_price_policy WHERE product_id=?').get(product().id),receipt:receipt(),translation:h.sqlite.prepare('SELECT * FROM translation_jobs WHERE product_id=?').all(product().id)});
  const verifyScope=()=>{assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get(job.id).payload,context);assert.equal(h.sqlite.prepare('SELECT payload FROM workspace_settings WHERE owner_id=?').get('owner').payload,JSON.stringify(h.settings));assert.deepEqual(Buffer.from(h.objects.get(profile.template.storageKey)),Buffer.from(bytes));assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n,0);};
  const verifyWorkbook=async()=>{
   const base='/api/products/'+product().id,preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));
   const downloaded=await h.route(base+'/quotation',{method:'POST',body:{action:'download',fingerprint:preview.fingerprint}});assert.equal(downloaded.status,200,await downloaded.clone().text());
   const reader=h.load('app/xlsx-template.ts'),book=reader.inspectXlsxArchive(await reader.readXlsxArchive(await downloaded.arrayBuffer()));assert.equal(preview.rows.length,6);
   for(let index=0;index<6;index++){const cells=reader.xlsxHeaders(book,profile.template.sheetName,9+index);for(const column of [1,2,5,6,7,23,24,25,29,30,31])assert.equal(cells[column],preview.rows[index][column],`original row ${index}, column ${column}`);}
   return preview;
  };
  return{h,company,profile,job,sourceUrl,sourceRequests,requests,progress,updates,run,product,content,options,receipt,retained,verifyScope,verifyWorkbook,capture,get captures(){return captures;},setAmend(value){amend=value;},close(){h.close();}};
 }catch(error){h.close();throw error;}
}

for(const company of companies)test(`fresh full server receipt with image-only details goes directly to 1–7 drafts and original export (${company.code})`,{skip:!available},async()=>{
 const f=await fullMobileReuseFixture(company);try{
  const message=await f.run(),source=JSON.parse(f.receipt().payload),content=f.content(),options=f.options();
  assert.equal(source.provider,'1688-public-mobile-v1');assert.equal(source.description,'');assert.equal(source.attributes.length,24);assert.equal(source.images.length,19);
  assert.deepEqual(f.sourceRequests.map(value=>value.host),['detail.1688.com','m.1688.com','h5api.m.1688.com','itemcdn.tmall.com']);assert.equal(f.captures,0,'the complete mobile/detail fetch must not be repeated just because seller text is empty');
  assert.ok(f.progress.every(value=>!value.includes('현재 Chrome')));assert.doesNotMatch(message,/상세 원문 보완 미완료/);assert.match(message,/상세 설명.*수집 원문에 없어/);
  assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM collection_source_supplements').get().n,0);assert.equal(f.requests.filter(value=>value.path.endsWith('/source-supplement')).length,0);
  const keys=new Map(f.h.sqlite.prepare('SELECT image_index,object_key FROM collection_images WHERE job_id=? ORDER BY image_index').all(f.job.id).map(row=>[row.image_index,row.object_key]));
  assert.deepEqual(source.sourceGallery,{format:'1688-public-mobile-gallery-v1',imageIndices:[...recordedGallery].map((_,index)=>index)});
  for(const role of ['main','additional','detail'])assert.deepEqual(content.assets[role].value,source.images.flatMap((image,index)=>image.role===role&&(role!=='additional'||recordedGallery.has(image.url))?[keys.get(index)]:[]));
  for(let index=0;index<options.rows.length;index++){const row=options.rows[index],raw=source.options[index];assert.equal(row.supplierSku,raw.sku);assert.equal(row.unitCostCny,raw.unitPriceCny);assert.equal(row.minimumOrderQuantity,raw.minimumOrder);assert.equal(row.stock,raw.stock);assert.equal(row.imageKey,keys.get(raw.imageIndex));}
  assert.equal(content.seo.title.value,'검토 브랜드 우드 패턴 다리 선글라스');assert.ok(options.rows.every(row=>row.provenance.translatedName==='translated'));assert.equal(f.h.aiSources.length,1);assert.equal(f.h.stats.downloads,19);assert.equal(f.h.stats.maxDownloads,3);assert.equal(f.product().supplier_hub_status,'미전송');assert.equal(f.product().image_status,'대기');
  const quote=await f.verifyWorkbook();assert.equal(quote.report.company.code,company.code);assert.equal(quote.report.categoryId,'69900');f.verifyScope();
  const raw=f.receipt(),base='/api/products/'+f.product().id;
  await json(await f.h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'직접 확인한 제목',description:'',keywords:[]},assets:{main:[],detail:[]},label:{material:''},labelClears:['material']}}}));
  const saved=await json(await f.h.route(base+'/options')),inputs=f.h.load('app/product-options.ts').optionInputs(saved.options);inputs[0].included=false;inputs[1].translatedName='직접 확인한 옵션';inputs[1].unitsPerPack=3;
  await json(await f.h.route(base+'/options',{method:'PATCH',body:{expectedRevision:saved.options.revision,expectedProductVersion:saved.productVersion,rows:inputs}}));
  const before=f.retained(),sourceRequests=f.sourceRequests.length;await f.run();assert.equal(f.retained(),before,'even the original stale job input must recover saved edits without recapture');assert.equal(f.captures,0);assert.equal(f.sourceRequests.length,sourceRequests);assert.deepEqual(f.receipt(),raw);assert.equal(f.h.aiSources.length,1);assert.equal(f.h.stats.downloads,19);assert.equal(f.content().seo.description.provenance,'manual');assert.deepEqual(f.content().assets.main.value,[]);assert.deepEqual(f.content().assets.detail.value,[]);f.verifyScope();
 }finally{f.close();}
});

for(const company of companies)test(`a partial mobile detail failure retains gaps and proceeds without another Chrome capture (${company.code})`,{skip:!available},async()=>{
 const f=await fullMobileReuseFixture(company,{partial:true});try{
  const message=await f.run(),source=JSON.parse(f.receipt().payload);assert.equal(source.provider,'1688-public-mobile-partial-v1');assert.equal(source.images.length,8);assert.equal(source.attributes.length,24);assert.equal(f.captures,0);assert.match(message,/상세 설명·상세 이미지.*수집 원문에 없어/);assert.deepEqual(f.content().assets.detail.value,[]);assert.equal(f.content().assets.main.value.length,1);assert.equal(f.content().assets.additional.value.length,recordedGallery.size-1);assert.equal(f.options().rows.length,6);assert.equal(f.h.aiSources.length,1);
  const before=f.retained(),count=f.sourceRequests.length;await f.run(await f.h.load('db/collection-jobs.ts').findCollectionJob('owner',f.job.id));assert.equal(f.retained(),before);assert.equal(f.sourceRequests.length,count);assert.equal(f.captures,0);assert.equal(f.h.aiSources.length,1);f.verifyScope();
 }finally{f.close();}
});

for(const company of companies)test(`a genuine server source failure still permits one validated full Chrome capture (${company.code})`,{skip:!available},async()=>{
 const f=await fullMobileReuseFixture(company,{browserFallback:true});try{
  await f.run();assert.equal(JSON.parse(f.receipt().payload).provider,'chrome-public-mobile-v1');assert.equal(f.captures,1);assert.equal(f.requests.filter(value=>value.path.endsWith('/browser-capture')).length,1);assert.equal(f.requests.filter(value=>value.path.endsWith('/source-supplement')).length,0);assert.equal(f.h.stats.downloads,19);assert.equal(f.options().rows.length,6);assert.equal(f.content().assets.detail.value.length,11);assert.equal(f.h.aiSources.length,1);f.verifyScope();
 }finally{f.close();}
});

test('a full provider label cannot bypass receipt job, source, option, CDN or timestamp validation',{skip:!available},async()=>{
 for(const variant of ['job','offer','source','price','image','time']){const f=await fullMobileReuseFixture();try{
  f.setAmend(async(path,response)=>{if(!path.endsWith('/collect'))return null;const value=await response.json();value.receipt.result.provider='1688-public-mobile-v1';if(variant==='job')value.jobId='different-job';else if(variant==='offer')value.receipt.result.offerId='643000000099';else if(variant==='source')value.receipt.result.sourceUrl='https://detail.1688.com/offer/643000000099.html';else if(variant==='price')value.receipt.result.options[0].unitPriceCny=-1;else if(variant==='image')value.receipt.result.images[0].url='https://untrusted.invalid/image.png';else value.receipt.receivedAt='invalid';return Response.json(value);});
  await assert.rejects(f.run());assert.equal(f.captures,0);assert.equal(f.product(),undefined);assert.equal(f.h.aiSources.length,0);assert.equal(f.h.stats.downloads,0);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM collection_source_supplements').get().n,0);f.verifyScope();
 }finally{f.close();}}
});

test('explicit source repair remains available after a full image-only receipt and preserves saved manual values',{skip:!available},async()=>{
 const f=await fullMobileReuseFixture();try{
  await f.run();const base='/api/products/'+f.product().id,content=f.content(),raw=f.receipt();
  await json(await f.h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'사용자가 확인한 제목',description:''},detail:{description:'직접 쓴 설명'},assets:{detail:[]}}}}));
  const before=f.product(),history=JSON.stringify(f.h.sqlite.prepare('SELECT * FROM translation_jobs WHERE product_id=?').all(before.id));let captures=0;
  const message=await f.h.load('app/collection-supplement-client.ts').completeCollectionSupplement({jobId:f.job.id,offerId:f.job.offer_id,sourceUrl:f.sourceUrl,productId:before.id,productVersion:before.updated_at,provider:'1688-public-mobile-v1'},{fetcher:(path,init)=>f.h.route(path,{method:init?.method??'GET',body:init?.body}),signal:new AbortController().signal,onProgress(){},captureFromBrowser:async()=>{captures++;const capture=f.capture();const description=f.h.load('app/alibaba-mobile-product.ts').parseAlibabaMobileDescription(capture.detailSource);capture.detailSource='var offer_details='+JSON.stringify({content:'<p>用户确认的新增商品说明</p>'+description})+';';return capture;}});
  assert.match(message,/보완했습니다/);assert.equal(captures,1);assert.equal(f.captures,0);assert.deepEqual(f.receipt(),raw);assert.equal(f.h.aiSources.length,1);assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM translation_jobs WHERE product_id=?').all(before.id)),history);assert.equal(f.content().seo.title.value,'사용자가 확인한 제목');assert.equal(f.content().seo.description.value,'');assert.equal(f.content().detail.description.value,'직접 쓴 설명');assert.deepEqual(f.content().assets.detail.value,[]);for(const key of ['source_price_cny','supply_price','sale_price','msrp'])assert.equal(f.product()[key],before[key]);f.verifyScope();
 }finally{f.close();}
});

test('a cancelled caller cannot collect, recapture, promote or generate an initial mobile draft',{skip:!available},async()=>{
 const f=await fullMobileReuseFixture();try{const controller=new AbortController();controller.abort();assert.equal(await f.run(f.job,controller.signal),undefined);assert.equal(f.requests.length,0);assert.equal(f.sourceRequests.length,0);assert.equal(f.captures,0);assert.equal(f.product(),undefined);assert.equal(f.h.aiSources.length,0);assert.equal(f.h.stats.downloads,0);f.verifyScope();}finally{f.close();}
});
