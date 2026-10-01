import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {submissionPackageUI} from './helpers/submission-package-ui.mjs';

const sourceUrl='https://detail.1688.com/offer/813724060928.html';
const fixture=name=>fs.readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8');
const mobile=JSON.parse(fixture('1688-mobile-813724060928.json'));
const skuPayload=JSON.parse(fixture('1688-skus-813724060928.json'));
const publicSkus=JSON.parse(fixture('1688-public-sku-813724060928.json'));
const detail=fixture('1688-description-813724060928.txt');
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};

/** Recorded public facts and synthetic network timing, never a live supplier
 * request, production AI result, official sunglass template or Hub acceptance. */
function transport(mode){
 const calls=[];let pcAborted=false,skuRequests=0;
 const fetcher=async(target,init)=>{
  const url=new URL(target);calls.push(url.hostname);
  assert.equal(init.credentials,'omit');assert.equal(init.redirect,'manual');assert.equal(init.cache,'no-store');
  if(url.hostname==='detail.1688.com'){
   assert.equal(url.href,sourceUrl);
   if(mode==='network'||mode==='sku')throw Error('isolated PC network failure');
   return new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>{pcAborted=true;reject(Error('losing PC request stopped'));},{once:true});});
  }
  if(url.hostname==='m.1688.com'){
   assert.equal(url.href,'https://m.1688.com/offer/813724060928.html');
   return new Response(mode==='sku'?'<html>No initial product JSON</html>':'<script>window.__INIT_DATA='+JSON.stringify(mobile)+';</script>',{headers:{'content-type':'text/html;charset=utf-8'}});
  }
  if(url.hostname==='itemcdn.tmall.com')return new Response(detail);
  assert.equal(url.hostname,'h5api.m.1688.com');
  assert.equal(JSON.parse(JSON.parse(url.searchParams.get('data')).params).offerId,'813724060928');
  skuRequests++;
  return skuRequests===1?Response.json({ret:['FAIL_SYS_TOKEN_EMPTY::fixture']},{headers:{'set-cookie':'_m_h5_tk=fixture123_9999999999999; Path=/, _m_h5_tk_enc=fixture456; Path=/'}}):Response.json(mode==='sku'?publicSkus:skuPayload);
 };
 return {fetcher,calls,get pcAborted(){return pcAborted;}};
}

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])for(const mode of ['network','slow','sku'])test(`PC ${mode} recovery preserves category, six SKU draft, manual edits and reviewed handoff (${company.companyCode})`,async()=>{
 const source=transport(mode),h=mobileIntakeHarness({...company,sourceFetcher:source.fetcher});
 try{
  const message=await h.intake();assert.match(message,/상품 초안 저장됨/);
  if(mode==='sku')assert.match(message,/상세 설명·상세 이미지·일반 상품 속성/);
  assert.deepEqual(source.calls,['detail.1688.com','m.1688.com','h5api.m.1688.com','h5api.m.1688.com',...(mode==='sku'?[]:['itemcdn.tmall.com'])]);
  if(mode==='slow')assert.equal(source.pcAborted,true);
  const receipt=await h.load('db/collection-results.ts').readCollectionResult('owner','job');
  assert.equal(receipt.result.offerId,'813724060928');assert.equal(receipt.result.provider,mode==='sku'?'1688-public-sku-v1':'1688-public-mobile-v1');
  assert.deepEqual(Array.from(receipt.result.options,row=>row.unitPriceCny),[3.6,5.5,3.6,5.5,3.6,5.5]);
  assert.equal(receipt.result.images.length,mode==='sku'?4:19);assert.equal(receipt.result.attributes?.length,mode==='sku'?undefined:24);
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  assert.equal(product.supplier_hub_status,'미전송');assert.equal(h.aiSources.length,1);
  assert.equal(h.aiSources[0].category.id,'80719');assert.equal(h.stats.downloads,mode==='sku'?4:19);
  const content=(await json(await h.route(base+'/content'))).content;
  const imageKeys=h.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(row=>row.object_key);
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{
   seo:{title:'사용자가 검토한 선글라스',description:'직접 확인한 설명'},label:{model:'REVIEWED-MODEL',material:'검토한 재질'},
   assets:{main:[imageKeys[0]],additional:[imageKeys[1]],detail:[imageKeys[2]],label:[imageKeys[3]]},
  }}}));
  const optionView=await json(await h.route(base+'/options'));
  const rows=h.load('app/product-options.ts').optionInputs(optionView.options);rows[0].translatedName='검토한 첫 옵션';rows[5].included=false;
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:optionView.options.revision,expectedProductVersion:optionView.productVersion,rows}}));
  let view=await json(await h.route(base+'/quotation-fields'));
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[
   {fieldKey:'salePrice',optionId:'collected-2',value:'10000'},
   {fieldKey:'additionalImages',optionId:'collected-1',value:''},
   {fieldKey:'handlingReason',optionId:null,value:'해당사항없음'},
   // 80719 is a synthetic observed basket form, not this item's sellable category.
   {fieldKey:'storageMaterial',optionId:null,value:''},
   {fieldKey:'packagedWeightG',optionId:null,value:'420'},
   {fieldKey:'packagedDimensionsMm',optionId:null,value:'100*200*300'},
  ]}}));
  const sourceCalls=source.calls.length,downloads=h.stats.downloads;
  assert.match(await h.intake(),/저장된 SEO·옵션값/);
  assert.equal(source.calls.length,sourceCalls);assert.equal(h.stats.downloads,downloads);assert.equal(h.aiSources.length,1);
  view=await json(await h.route(base+'/quotation-fields'));
  assert.equal(view.categoryContext.categoryId,'80719');assert.equal(view.categoryContext.profileId,'cat');
  const savedOptions=(await json(await h.route(base+'/options'))).options.rows;
  assert.equal(savedOptions.filter(row=>row.included).length,5);assert.equal(savedOptions[5].included,false);
  assert.equal(savedOptions[0].translatedName,'검토한 첫 옵션');
  const first=view.resolved.rows.find(row=>row.optionId==='collected-1').fields;
  const second=view.resolved.rows.find(row=>row.optionId==='collected-2').fields;
  assert.equal(first.title.value,'사용자가 검토한 선글라스');assert.equal(first.additionalImages.value,'');
  assert.equal(first.supplyPrice.value,'4260');assert.equal(first.salePrice.value,'7100');assert.equal(second.salePrice.value,'10000');
  assert.equal(first.noticeMaterial.value,'검토한 재질');assert.equal(first.kcMarkType.value,'해당사항없음');
  const fields=[...new Set([...view.resolved.schema.fields.map(field=>field.id),'skuId','sourcePriceCny','sourceUrl','categoryId'])],workbook=quotationWorkbook(fields);
  const sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
  await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'관찰 폼 계약 시험',categoryId:'80719',categoryPath:h.context.category.categoryPath,
   template:{name:'synthetic.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},
   mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));
  assert.equal(preview.rows.length,5);assert.equal(preview.submissionReview.errorCount,0,JSON.stringify(preview.submissionReview.issues.filter(issue=>issue.kind==='error')));
  assert.deepEqual(preview.report.company,{code:company.companyCode,name:company.companyName});
  const exported=await h.route(base+'/quotation',{method:'POST',body:{action:'download',fingerprint:preview.fingerprint}});
  assert.equal(exported.status,200,await exported.clone().text());const bytes=new Uint8Array(await exported.arrayBuffer());
  const xlsx=h.load('app/xlsx-template.ts'),archive=await xlsx.readXlsxArchive(bytes),sheet=xlsx.inspectXlsxArchive(archive);
  for(let index=0;index<5;index++){
   const cells=xlsx.xlsxHeaders(sheet,'견적서',index+2),row=Object.fromEntries(fields.map((field,column)=>[field,cells[column]]));
   assert.equal(row.skuId,receipt.result.options[index].sku);assert.equal(row.title,'사용자가 검토한 선글라스');assert.equal(row.sourceUrl,sourceUrl);
   assert.equal(row.categoryId,'80719');assert.equal(row.sourcePriceCny,String(receipt.result.options[index].unitPriceCny));
   assert.equal(row.salePrice,index===1?'10000':index%2?'8220':'7100');if(index===0)assert.equal(row.additionalImages,'');
  }
  const ui=submissionPackageUI({route:h.route,productId:product.id});
  await ui.click('견적서 + 첨부 파일 준비');assert.deepEqual(ui.alerts(),[]);
  assert.equal(ui.button('등록 전송').props.disabled,true);assert.equal(ui.calls.some(call=>call.action==='transmit'),false);
  ui.choose();await ui.click('등록 전송');assert.deepEqual(ui.alerts(),[]);
  const transfers=ui.calls.filter(call=>call.action==='transmit');assert.equal(transfers.length,1);
  assert.deepEqual(transfers[0].files.company,preview.report.company);assert.equal(transfers[0].files.includedOptions,5);
  assert.equal(transfers[0].files.categoryId,'80719');assert.equal(transfers[0].files.quotation[0].name,preview.filename);
  assert.deepEqual(Buffer.from(transfers[0].files.quotation[0].base64,'base64'),Buffer.from(bytes));
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);
 }finally{h.close();}
});
