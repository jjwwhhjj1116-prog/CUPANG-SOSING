import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mobileIntakeHarness} from './mobile-intake.mjs';
import {assetSnapshot,config,imageBytes} from './supplier-hub-single-assets.mjs';

export const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
export const plain=value=>JSON.parse(JSON.stringify(value));
export const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const recorded=name=>fs.readFileSync(new URL('../fixtures/'+name,import.meta.url),'utf8');
export const sourceUrl='https://detail.1688.com/offer/730000000001.html';

/** The supplier responses are retained test evidence, remapped to a synthetic
 * offer. All HTTP, translation and image bytes stay inside this local harness.
 * The form is a synthetic public Single contract, not a commercial category
 * classification or evidence of a native Supplier Hub receipt. */
export async function workflowSpineFixture(company=companies[0]){
 const sourceCalls=[],requests=[],progress=[];
 const mobile=JSON.parse(recorded('1688-mobile-813724060928.json').replaceAll('813724060928','730000000001'));
 const skus=JSON.parse(recorded('1688-skus-813724060928.json').replaceAll('813724060928','730000000001'));
 const detail=recorded('1688-description-813724060928.txt');
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,sourceFetcher:async(target,init)=>{
  const host=new URL(target).hostname;sourceCalls.push({host,method:init?.method??'GET'});
  if(host==='detail.1688.com')return new Response('<html>Retained desktop response without product metadata</html>',{headers:{'content-type':'text/html'}});
  if(host==='m.1688.com')return new Response('<script>window.__INIT_DATA='+JSON.stringify(mobile)+';</script>',{headers:{'content-type':'text/html'}});
  if(host==='h5api.m.1688.com')return Response.json(skus);
  if(host==='itemcdn.tmall.com')return new Response(detail);
  throw Error('Unexpected local recorded-source boundary');
 }});
 try{
  h.sqlite.exec('DELETE FROM collection_context; DELETE FROM collection_jobs;');
  await h.load('db/queries.ts').saveSettings('owner',JSON.stringify(h.settings));
  h.bindings.YOOFAM_DETAIL_IMAGE_SECRET=config.secret;h.bindings.YOOFAM_DETAIL_IMAGE_ORIGIN=config.origin;
  const put=h.bindings.FILES.put;
  h.bindings.FILES.put=async(...args)=>{const existed=h.objects.has(args[0]),result=await put(...args);return existed&&args[2]?.onlyIf?.get('if-none-match')==='*'?result:h.bindings.FILES.head(args[0]);};
  const snapshot=assetSnapshot(company);snapshot.categoryId='997300';snapshot.categoryPath=['합성 등록 워크플로','기록 원문 연결 시험'];
  const raw=JSON.parse(snapshot.schemaString);
  raw.properties.productPage.properties.searchTags={type:'string',title:'검색태그'};
  // The retained source has three black/gray variants. A synthetic form must
  // permit those source facts instead of coercing them to another form's enum.
  raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf[0].contains.properties.attributeValue={type:'string'};
  snapshot.schemaString=JSON.stringify(raw);
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'LOCAL RECORDED SOURCE TO NATIVE GROUP',categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,hubSchema:snapshot,template:null,mappings:[]});
  const response=await h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({urls:[sourceUrl],goal:'work',profileId:profile.id,expectedProfileRevision:profile.revision,expectedSettings:h.settings})}));
  const queued=await json(response),job=queued.jobs[0];assert.ok(job);
  const context=h.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get(job.id).payload;
  const request=async(url,init={})=>{requests.push({url,method:init.method??'GET'});if(url==='/api/supplier-hub/catalog-context')return h.load('app/api/supplier-hub/catalog-context/route.ts').GET();return h.route(url,{method:init.method??'GET',body:init.body});};
  const run=()=>h.load('app/intake-collection.ts').collectIntakeProduct(job,{signal:new AbortController().signal,fetcher:request,onJob(){},onProgress:value=>progress.push(value),captureFromBrowser:async()=>assert.fail('Complete retained source must not open a browser')});
  const product=()=>h.sqlite.prepare('SELECT * FROM products WHERE source_url=?').get(sourceUrl);
  const state=()=>JSON.stringify(['products','product_content','product_options','product_price_policy','product_quotation_fields','collection_context','collection_results','supplier_hub_receipts','supplier_hub_single_receipts'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
  const unchangedContext=()=>assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get(job.id).payload,context);
  return{h,company,profile,snapshot,job,context,sourceCalls,requests,progress,request,run,product,state,unchangedContext,close(){h.close();}};
 }catch(error){h.close();throw error;}
}

export async function manualSpineDraft(f){
 await f.run();const product=f.product();assert.ok(product);const base='/api/products/'+product.id;
 const beforeContent=await json(await f.h.route(base+'/content')),beforeOptions=await json(await f.h.route(base+'/options'));
 const source=JSON.parse(f.h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get(f.job.id).payload);
 const content=beforeContent.content,rows=f.h.load('app/product-options.ts').optionInputs(beforeOptions.options);
 const included=[rows[0].id,rows[2].id];
 rows.forEach((row,index)=>{row.included=included.includes(row.id);if(index===2){row.translatedName='직접 확인한 두 번째 옵션';row.unitsPerPack=3;}});
 const savedOptions=await json(await f.h.route(base+'/options',{method:'PATCH',body:{expectedRevision:beforeOptions.options.revision,expectedProductVersion:beforeOptions.productVersion,rows}}));
 const title=f.company.name+' 직접 검토한 상품명';
 // A local label-file boundary replaces image generation. No collected seller
 // photo is relabeled as a Korean product label, and no real label is asserted.
 const labelKey='owner/synthetic-workflow-label-730.png',latest=await f.h.load('db/queries.ts').findProduct('owner',product.id);
 await f.h.bindings.FILES.put(labelKey,imageBytes(230),{httpMetadata:{contentType:'image/png'}});
 await f.h.load('db/queries.ts').updateProduct('owner',product.id,{image_keys:JSON.stringify([...JSON.parse(latest.image_keys),labelKey])},latest.updated_at);
 const savedContent=await json(await f.h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title,description:'',keywords:['직접검토']},assets:{main:[content.assets.additional.value[0]],additional:[],detail:content.assets.detail.value.slice(1,3),label:[labelKey]},label:{material:''},labelClears:['material']}}}));
 let quotation=await json(await f.h.route(base+'/quotation-fields'));
 const byWire=(path,name)=>quotation.resolved.schema.fields.find(field=>JSON.stringify(field.hubWire?.path)===JSON.stringify(path)&&field.hubWire?.name===name)?.id;
 const changes=[
  {fieldKey:byWire(['startPage','productName']),optionId:included[0],value:'첫 옵션 견적서 전용 제목'},
  {fieldKey:byWire(['productPage','modelNumber']),optionId:included[0],value:''},
  {fieldKey:byWire(['productPage','modelNumber']),optionId:included[1],value:'MANUAL-MODEL-730'},
  {fieldKey:byWire(['productPage','commonAttributes','count']),optionId:null,value:'0'},
  {fieldKey:byWire(['productPage','commonAttributes','booleanValue']),optionId:null,value:'false'},
  {fieldKey:byWire(['imagePage','details','htmlProductDetailContent']),optionId:null,value:''},
  ...[['supplyPrice','3333','purchasePrice'],['salePrice','4444','coupangSalePrice'],['msrp','5555','msrp']].flatMap(([key,value,wire])=>[...new Set([key,byWire(['productPage','commonAttributes',wire])])].map(fieldKey=>({fieldKey,optionId:included[1],value}))),
 ];
 assert.ok(changes.every(change=>typeof change.fieldKey==='string'));
 quotation=await json(await f.h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:quotation.revision,expectedInputFingerprint:quotation.inputFingerprint,changes}}));
 return{base,source,rows,included,title,savedOptions,savedContent,quotation,byWire};
}
