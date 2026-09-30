import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const prices=[[4260,7100,9230],[4930,8220,10690]];

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`recorded mobile source reaches editable six-SKU draft, manual review and XLSX (${company.companyCode})`,async()=>{
 const h=mobileIntakeHarness(company);
 try{
  assert.match(await h.intake(),/상품 초안 저장됨/);
  const product=h.sqlite.prepare('SELECT * FROM products').get();
  assert.match(product.title,/太阳眼镜/);assert.equal(product.source_price_cny,3.6);
  assert.equal(product.options_count,6);assert.equal(product.supplier_hub_status,'미전송');
  const receipt=await h.load('db/collection-results.ts').readCollectionResult('owner','job');
  assert.equal(receipt.result.provider,'1688-public-mobile-v1');assert.equal(receipt.result.attributes.length,24);
  assert.equal(receipt.result.images.length,19);assert.equal(h.stats.skuRequests,2);
  assert.equal(h.aiSources.length,1);assert.equal(h.aiSources[0].title,receipt.result.title);
  assert.equal(h.aiSources[0].category.id,'80719');assert.equal(h.aiSources[0].attributes.length,42);
  assert.equal(h.stats.maxDownloads,3);assert.equal(h.stats.downloads,19);
  assert.equal(h.calls.filter(path=>path.endsWith('/images-batch')).length,7);
  assert.equal(h.calls.filter(path=>path.endsWith('/images')).length,0);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_images').get().n,19);
  const base='/api/products/'+product.id,content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  assert.equal(content.seo.title.value,'우드 패턴 다리 선글라스');
  for(const role of ['main','additional','detail'])assert.deepEqual(content.assets[role].value,[]);
  const optionView=await json(await h.route(base+'/options'));
  assert.equal(optionView.options.rows.length,6);
  for(let index=0;index<6;index++){
   const row=optionView.options.rows[index],original=receipt.result.options[index];
   assert.equal(row.supplierSku,original.sku);assert.equal(row.unitCostCny,original.unitPriceCny);
   assert.equal(row.stock,original.stock);assert.equal(row.minimumOrderQuantity,1);assert.equal(row.unitsPerPack,1);
   assert.equal(row.color,['유광 검정','무광 검정','무광 회색'][Math.floor(index/2)]);
   assert.equal(row.size,index%2?'선글라스 + 005 케이스':'선글라스');assert.equal(row.imageKey,null);
  }
  let quote=await json(await h.route(base+'/quotation-fields'));
  assert.equal(quote.categoryContext.categoryId,'80719');assert.equal(quote.categoryContext.profileId,'cat');
  for(let index=0;index<6;index++){
   const fields=quote.resolved.rows.find(row=>row.optionId===`collected-${index+1}`).fields;
   for(const [column,offset] of [['supplyPrice',0],['salePrice',1],['msrp',2]])assert.equal(fields[column].value,String(prices[index%2][offset]));
   assert.equal(fields.barcodeMode.value,'request-coupang');assert.equal(fields.taxType.value,'과세');
   assert.equal(fields.kcMarkType.value,'해당사항없음');assert.equal(fields.shelfLifeDays.value,'0');
   assert.equal(fields.boxSkuQuantity.value,'50');assert.equal(fields.noticeServiceContact.value,'쿠팡 고객센터 1577-7011');
   for(const field of ['mainImage','additionalImages','detailImages','detailHtml','altText'])assert.equal(fields[field].value,'');
  }
  // Review stage inputs using actual API saves. Image bytes/labels and the
  // classification/template remain synthetic, so no Hub request follows.
  const keys=h.sqlite.prepare('SELECT image_index,object_key FROM collection_images ORDER BY image_index').all();
  const key=index=>keys.find(row=>row.image_index===index).object_key;
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'검토한 선글라스 이름',keywords:['선글라스','케이스']},detail:{description:'확인한 상세 설명',altText:'선택한 상품 이미지'},label:{material:'검토한 재질',countryOfOrigin:'중국'},assets:{main:[key(0)],additional:[key(1),key(2)],detail:[key(8)],label:[key(3)]}}}}));
  const editedOptions=h.load('app/product-options.ts').optionInputs(optionView.options);
  editedOptions.forEach((row,index)=>{row.imageKey=key(receipt.result.options[index].imageIndex);});
  editedOptions[0].translatedName='직접 검토한 첫 옵션';editedOptions[5].included=false;
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:optionView.options.revision,expectedProductVersion:(await json(await h.route(base+'/options'))).productVersion,rows:editedOptions}}));
  quote=await json(await h.route(base+'/quotation-fields'));
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:quote.revision,expectedInputFingerprint:quote.inputFingerprint,changes:[{fieldKey:'salePrice',optionId:'collected-2',value:'10000'},{fieldKey:'title',optionId:null,value:'최종 견적서 상품명'},{fieldKey:'additionalImages',optionId:'collected-1',value:''},{fieldKey:'packagedWeightG',optionId:null,value:'420'},{fieldKey:'packagedDimensionsMm',optionId:null,value:'100*200*300'}]}}));
  const networkBefore=h.network.length,writesBefore=h.objects.size;
  assert.match(await h.intake(),/저장된 SEO·옵션값/);
  assert.equal(h.network.length,networkBefore,'retry never recollects or redownloads confirmed originals');assert.equal(h.objects.size,writesBefore);
  assert.equal(h.aiSources.length,1,'reviewed SEO/option names are not generated again');
  const reviewed=await json(await h.route(base+'/quotation-fields'));
  assert.equal(reviewed.resolved.rows.find(row=>row.optionId==='collected-1').fields.additionalImages.value,'');assert.equal(reviewed.resolved.rows.find(row=>row.optionId==='collected-2').fields.salePrice.value,'10000');
  const optionsAfter=await json(await h.route(base+'/options'));
  assert.equal(optionsAfter.options.rows[0].translatedName,'직접 검토한 첫 옵션');assert.equal(optionsAfter.options.rows[5].included,false);
  assert.ok(optionsAfter.options.rows.every(row=>row.imageKey&&row.provenance.imageKey==='manual'));
  const fields=['skuId','skuName','sourceUrl','sourcePriceCny','categoryId','category','title','searchTags','supplyPrice','salePrice','msrp','mainImage','additionalImages','detailImages','labelImages','detailHtml','altText','noticeMaterial','noticeCountryOfOrigin','packagedWeightG','packagedDimensionsMm'];
  const workbook=quotationWorkbook(fields),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
  await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 양식 연결 시험',categoryId:'80719',categoryPath:h.context.category.categoryPath,template:{name:'synthetic.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));
  assert.equal(preview.rows.length,5);
  const download=await h.route(base+'/quotation',{method:'POST',body:{action:'download',fingerprint:preview.fingerprint}});
  assert.equal(download.status,200,await download.clone().text());
  const reader=h.load('app/xlsx-template.ts'),workbookArchive=await reader.readXlsxArchive(await download.arrayBuffer());
  for(let index=0;index<5;index++){
   const cells=reader.xlsxHeaders(reader.inspectXlsxArchive(workbookArchive),'견적서',index+2),row=Object.fromEntries(fields.map((field,column)=>[field,cells[column]]));
   assert.equal(row.skuId,receipt.result.options[index].sku);assert.equal(row.sourcePriceCny,String(receipt.result.options[index].unitPriceCny));
   assert.equal(row.title,'최종 견적서 상품명');assert.equal(row.categoryId,'80719');assert.equal(row.sourceUrl,h.sourceUrl);
   assert.equal(row.supplyPrice,String(prices[index%2][0]));assert.equal(row.salePrice,index===1?'10000':String(prices[index%2][1]));
   assert.equal(row.noticeMaterial,'검토한 재질');assert.equal(row.packagedWeightG,'420');assert.equal(row.packagedDimensionsMm,'100*200*300');
   assert.match(row.mainImage,/^image-\d+\.png$/);assert.equal(row.altText,'선택한 상품 이미지');
   if(index===0)assert.equal(row.additionalImages,'');
  }
  const bundleResponse=await h.route(base+'/quotation',{method:'POST',body:{action:'export',fingerprint:preview.fingerprint}});
  assert.equal(bundleResponse.status,200,await bundleResponse.clone().text());
  const bundle=await reader.readXlsxArchive(await bundleResponse.arrayBuffer()),plan=JSON.parse(new TextDecoder().decode(bundle.get('supplier-hub-upload-plan.json')));
  assert.deepEqual(plan.company,{code:company.companyCode,name:company.companyName});assert.equal(plan.categoryId,'80719');
  assert.ok(plan.productImages.every(image=>bundle.has(image.archivePath)));assert.ok(plan.labelImages.every(image=>bundle.has(image.archivePath)));
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{h.close();}
});

test('one failed source image retains all six drafts and retries only the missing file',async()=>{
 const h=mobileIntakeHarness();try{
  h.stats.failImageIndex=4;
  await assert.rejects(h.intake(),/원본 5번/);
  assert.equal(h.sqlite.prepare('SELECT options_count FROM products').get().options_count,6);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_images').get().n,18);
  assert.equal(h.aiSources.length,1);
  const downloads=h.stats.downloads;h.stats.failImageIndex=null;
  assert.match(await h.intake(),/상품 초안 저장됨/);
  assert.equal(h.stats.downloads-downloads,1);assert.equal(h.stats.skuRequests,2);assert.equal(h.aiSources.length,1);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_images').get().n,19);
 }finally{h.close();}
});

test('batch validates ownership, origin, exact bounded source indices before downloading',async()=>{
 const h=mobileIntakeHarness();try{
  await h.route('/api/collection-jobs/job/collect',{method:'POST'});await h.route('/api/collection-jobs/job/product',{method:'POST'});
  for(const body of [{indices:[]},{indices:[0,1,2,3]},{indices:[0,0]},{indices:[0,200]},{indices:[0],assignToStage:true}])assert.equal((await h.route('/api/collection-jobs/job/images-batch',{method:'POST',body})).status,400);
  assert.equal((await h.route('/api/collection-jobs/job/images-batch',{method:'POST',body:{indices:[19]}})).status,404);
  const api=h.load('app/api/collection-jobs/[id]/images-batch/route.ts');
  assert.equal((await api.POST(new Request('https://app.test/api/collection-jobs/job/images-batch',{method:'POST',headers:{origin:'https://other.test','content-type':'application/json'},body:'{"indices":[0]}'}),{params:Promise.resolve({id:'job'})})).status,400);
  h.sqlite.prepare("UPDATE collection_jobs SET owner_id='other' WHERE id='job'").run();
  assert.equal((await h.route('/api/collection-jobs/job/images-batch',{method:'POST',body:{indices:[0]}})).status,404);
  assert.equal(h.stats.downloads,0);assert.equal(h.objects.size,0);
 }finally{h.close();}
});

test('cancellation during parallel downloads cannot attach files or overwrite a draft',async()=>{
 const h=mobileIntakeHarness();try{
  await h.route('/api/collection-jobs/job/collect',{method:'POST'});await h.route('/api/collection-jobs/job/product',{method:'POST'});
  const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all());h.stats.cancelDuringDownload=true;
  const response=await json(await h.route('/api/collection-jobs/job/images-batch',{method:'POST',body:{indices:[0,1,2]}}));
  assert.ok(response.results.every(row=>row.status===409));assert.equal(h.objects.size,0);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_images').get().n,0);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all()),before);
 }finally{h.close();}
});

test('edits made while downloads are pending survive each serial batch commit',async()=>{
 const h=mobileIntakeHarness();try{
  await h.route('/api/collection-jobs/job/collect',{method:'POST'});const product=await json(await h.route('/api/collection-jobs/job/product',{method:'POST'}));
  const base='/api/products/'+product.productId;
  const manualKey='owner/manual.png';h.objects.set(manualKey,new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64')));
  h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([manualKey]),product.productId);
  const initial=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:initial.revision,patch:{assets:{main:[manualKey]}}}}));
  h.stats.onDownloadFinished=async()=>{
   h.stats.onDownloadFinished=null;
   const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
   await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'다운로드 중 수정한 이름'},assets:{main:[],detail:[]},detail:{description:'직접 확인한 설명'}}}}));
  };
  const response=await json(await h.route('/api/collection-jobs/job/images-batch',{method:'POST',body:{indices:[0,1,2]}}));
  assert.ok(response.results.every(row=>row.status===200));assert.equal(h.stats.maxDownloads,3);
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  assert.equal(content.seo.title.value,'다운로드 중 수정한 이름');assert.equal(content.detail.description.value,'직접 확인한 설명');
  assert.deepEqual(content.assets.main.value,[]);assert.equal(content.assets.main.provenance,'manual');
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_images').get().n,3);
  const downloads=h.stats.downloads;
  const repeated=await json(await h.route('/api/collection-jobs/job/images-batch',{method:'POST',body:{indices:[0,1,2]}}));
  assert.ok(repeated.results.every(row=>row.reused));assert.equal(h.stats.downloads,downloads);
 }finally{h.close();}
});
