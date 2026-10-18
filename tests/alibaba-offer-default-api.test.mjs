import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {offerDefaultApiHarness,offerId,sourceUrl,originalTitle,json,plain} from './helpers/alibaba-offer-default.mjs';
import {schemaCompanies} from './helpers/hub-schema.mjs';

const receiptBody=receipt=>{const {offerId:identity,...body}=plain(receipt);assert.equal(identity,offerId);return body;};
const snapshot=h=>JSON.stringify(Object.fromEntries(['products','product_content','product_options','product_quotation_fields','collection_results','collection_context','collection_images','translation_jobs'].map(table=>[table,h.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])));

for(const company of schemaCompanies)test(`offer default survives actual receipt/import/SEO/image/quotation handlers and manual replay (${company.code})`,async t=>{
 const h=offerDefaultApiHarness(company);
 try{
  const parsed=h.load('app/alibaba-product-result.ts').parseAlibabaProduct(h.payload,sourceUrl),body=receiptBody(parsed);
  const posted=await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body}));
  assert.equal(posted.productCreated,false);assert.equal(posted.executionStarted,false);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);assert.equal(h.objects.size,0);assert.equal(h.aiSources.length,0);
  assert.deepEqual(posted.receipt.result.offerDefault,plain(parsed.offerDefault));
  const received=await json(await h.route('/api/collection-jobs/job/result'));
  const revalidated=h.load('app/collection-receipt-response.ts').validateCollectionReceiptResponse(received,'job',offerId);
  assert.deepEqual(plain(revalidated),plain(parsed));
  const message=await h.intake();assert.match(message,/상품 초안 저장됨/);assert.doesNotMatch(message,/미일치|SKU.*연결.*실패/);
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  assert.equal(product.source_url,sourceUrl);assert.equal(product.source_price_cny,4.5);assert.equal(product.options_count,1);assert.equal(product.supplier_hub_status,'미전송');
  const optionView=await json(await h.route(base+'/options')),option=optionView.options.rows[0];
  assert.equal(option.id,'collected-1');assert.equal(option.supplierSku,'');assert.equal(option.provenance.supplierSku,'unverified');
  assert.equal(option.originalName,originalTitle);assert.equal(option.provenance.originalName,'collected');
  assert.equal(option.translatedName,'기본 보호대');assert.equal(option.unitCostCny,4.5);assert.equal(option.minimumOrderQuantity,2);assert.equal(option.stock,0);
  assert.equal(option.imageKey,null);assert.equal(option.provenance.imageKey,'unverified');assert.deepEqual(optionView.sourceImageKeys,{});
  const content=(await json(await h.route(base+'/content'))).content;
  assert.equal(content.seo.title.value,'검토 브랜드 단일 수납 보호대');assert.equal(content.seo.title.provenance,'manual','canonical translation adoption uses the existing saved-content provenance contract');
  assert.equal(content.label.material.value,'PP');assert.equal(content.label.importer.value,company.name);
  for(const role of ['main','additional','detail']){assert.equal(content.assets[role].value.length,1);assert.equal(content.assets[role].provenance,'collected');}
  assert.equal(h.objects.size,3);assert.equal(h.stats.downloads,3);assert.equal(h.aiSources.length,1);
  assert.ok(h.network.length>0);assert.ok(h.network.every(host=>host==='cbu01.alicdn.com'),'saved receipt imports only isolated synthetic CDN replies');
  const canonical=h.sqlite.prepare("SELECT * FROM translation_jobs WHERE idempotency_key='intake-auto-v1'").get();assert.equal(canonical.status,'completed');
  const view=await json(await h.route(base+'/quotation-fields')),row=view.resolved.rows.find(value=>value.optionId===option.id),fields=row.fields;
  assert.equal(view.categoryContext.categoryId,'80719');assert.equal(fields.title.value,'검토 브랜드 단일 수납 보호대','canonical explicit SEO save retains its exact document title');
  assert.deepEqual(['supplyPrice','salePrice','msrp'].map(key=>fields[key].value),['4580','7630','9920']);
  assert.equal(fields.mainImage.value,content.assets.main.value[0],'anonymous default inherits common selected main image');
  assert.equal(fields.additionalImages.value,content.assets.additional.value[0]);assert.equal(fields.detailImages.value,content.assets.detail.value[0]);
  assert.match(fields.detailHtml.value,/수집 원문에 따른 단일 상품 설명/);
  assert.equal(fields.noticeMaterial.value,'PP');assert.equal(fields.noticeServiceContact.value,'쿠팡 고객센터 1577-7011');assert.equal(fields.kcMarkType.value,'해당사항없음');assert.equal(fields.shelfLifeDays.value,'0');
  const source=h.load('app/exports/quotation-source.ts'),saved=await source.readQuotationExportSource('owner',product.id,null),resolved=source.resolveQuotationExport(saved);
  const assets=[...h.objects.keys()].map((key,index)=>({key,name:`assets/synthetic-${index}.png`,bytes:h.objects.get(key)}));
  const exported=h.load('app/exports/quotation-fields.ts').resolvedQuotationRows(saved,resolved,assets)[0];
  assert.equal(exported.skuId,'');assert.equal(exported.skuName,'기본 보호대');assert.equal(exported.sourceUrl,sourceUrl);assert.equal(exported.sourcePriceCny,4.5);
  assert.match(exported.mainImage,/^synthetic-\d+\.png$/);assert.equal(exported.supplyPrice,4580);
  const immutableReceipt=h.sqlite.prepare('SELECT * FROM collection_results').get();
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'직접 검토한 기본 보호대'},label:{material:'직접 확인한 PP'},assets:{additional:[]}}}}));
  const currentOptions=await json(await h.route(base+'/options')),inputs=h.load('app/product-options.ts').optionInputs(currentOptions.options);
  inputs[0].translatedName='직접 확인한 기본 옵션';
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:currentOptions.options.revision,expectedProductVersion:currentOptions.productVersion,rows:inputs}}));
  const reviewed=await json(await h.route(base+'/quotation-fields'));
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:reviewed.revision,expectedInputFingerprint:reviewed.inputFingerprint,changes:[{fieldKey:'salePrice',optionId:option.id,value:'9000'},{fieldKey:'detailHtml',optionId:null,value:'<p>직접 검토한 상세 설명</p>'}]}}));
  const before=snapshot(h),downloads=h.stats.downloads,requests=h.network.length,generations=h.aiSources.length,files=[...h.objects].map(([key,value])=>[key,Buffer.from(value).toString('hex')]);
  await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body}));
  await h.intake();
  assert.equal(snapshot(h),before,'same receipt replay cannot overwrite any saved content/options/quotation/history/source state');
  assert.equal(h.stats.downloads,downloads);assert.equal(h.network.length,requests);assert.equal(h.aiSources.length,generations);
  assert.deepEqual([...h.objects].map(([key,value])=>[key,Buffer.from(value).toString('hex')]),files);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM collection_results').get(),immutableReceipt);
  const finalView=await json(await h.route(base+'/quotation-fields')),final=finalView.resolved.rows.find(value=>value.optionId===option.id).fields;
  assert.equal(final.title.value,'직접 검토한 기본 보호대, 직접 확인한 기본 옵션','a later independent title writer retains the existing option-name fallback');assert.equal(final.salePrice.value,'9000');assert.equal(final.detailHtml.value,'<p>직접 검토한 상세 설명</p>');assert.equal(final.noticeMaterial.value,'직접 확인한 PP');assert.equal(final.additionalImages.value,'');
  const finalReceipt=(await json(await h.route('/api/collection-jobs/job/result'))).receipt.result;
  assert.deepEqual(finalReceipt.offerDefault,plain(parsed.offerDefault));assert.equal(finalReceipt.options[0].sku,'');
  assert.ok(h.calls.every(path=>!path.includes('supplier-hub')&&!path.includes('submission')&&!path.includes('/attach')),'synthetic draft flow never submits to Supplier Hub');
  const imageReplies=h.requests.filter(request=>request.response);assert.ok(imageReplies.length>0);
  for(const request of imageReplies)for(const image of request.response.results??[request.response])assert.deepEqual(image.warnings,[],'anonymous source must not produce a false unmatched SKU image warning');
  const sourceFiles=['app/alibaba-offer-default.ts','app/alibaba-product-result.ts','app/collection-result.ts','app/collection-product.ts','app/collection-image-store.ts','app/collection-source-supplement.ts','app/components/collection-price-basis-panel.tsx'];
  t.diagnostic(JSON.stringify({company,receiptOffer:finalReceipt.offerId,defaultEvidence:finalReceipt.offerDefault,
   sourceHashes:Object.fromEntries(sourceFiles.map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')])),
   requestCount:h.requests.length,requests:h.requests.map(({path,method,status})=>({path,method,status})),
   savedRows:Object.fromEntries(['products','collection_results','collection_images','product_options','product_content','product_quotation_fields','translation_jobs'].map(table=>[table,h.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n])),
   downloads:h.stats.downloads,mediaObjects:h.objects.size,canonicalGenerations:h.aiSources.length,replaySnapshotUnchanged:true,supplierSku:option.supplierSku,supplierSkuProvenance:option.provenance.supplierSku,
   sourceEndpointRequests:0,supplierHubRequests:0,nativeBrowser:false}));
 }finally{h.close();}
});

test('forged default provider or mismatched source evidence is rejected by the actual result route without writes',async()=>{
 const h=offerDefaultApiHarness(schemaCompanies[0]);
 try{
  const body=receiptBody(h.load('app/alibaba-product-result.ts').parseAlibabaProduct(h.payload,sourceUrl));
  for(const mutate of [r=>r.provider='chrome-public-mobile-v1',r=>r.offerDefault.offerId='90000000692',r=>r.offerDefault.stock=9,r=>delete r.offerDefault,r=>r.options[0].sku='default-691',r=>r.options[0].imageIndex=1]){
   const invalid=structuredClone(body);mutate(invalid);
   await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body:invalid}),400);
   assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_results').get().n,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);assert.equal(h.objects.size,0);assert.equal(h.network.length,0);assert.equal(h.aiSources.length,0);
  }
 }finally{h.close();}
});

test('unknown-stock default receipt remains importable with source gaps and never invokes an incompatible mobile SKU recapture',async()=>{
 const h=offerDefaultApiHarness(schemaCompanies[0]);
 try{
  const product=h.payload.result.result;product.description='';product.productAttribute=[];delete product.productSaleInfo.amountOnSale;
  h.sqlite.prepare("UPDATE collection_jobs SET goal='collect' WHERE id='job'").run();
  const parsed=h.load('app/alibaba-product-result.ts').parseAlibabaProduct(h.payload,sourceUrl);
  await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body:receiptBody(parsed)}));
  let captures=0;
  const message=await h.load('app/intake-collection.ts').collectIntakeProduct(await h.load('db/collection-jobs.ts').findCollectionJob('owner','job'),{
   signal:new AbortController().signal,fetcher:(path,init)=>h.route(path,{method:init?.method??'GET',body:init?.body}),onJob(){},onProgress(){},
   captureFromBrowser:async()=>{captures++;assert.fail('A no-SKU default cannot be repaired by a mobile collector that requires actual SKU identity');},
  });
  assert.match(message,/상품 추가 완료/);assert.equal(captures,0);assert.equal(h.aiSources.length,0);
  const saved=h.sqlite.prepare('SELECT * FROM products').get(),option=(await json(await h.route('/api/products/'+saved.id+'/options'))).options.rows[0];
  assert.equal(option.stock,null);assert.equal(option.supplierSku,'');assert.equal(option.provenance.supplierSku,'unverified');assert.equal(option.translatedName,'');
  const receipt=(await json(await h.route('/api/collection-jobs/job/result'))).receipt.result;
  assert.equal(receipt.offerDefault.stock,null);assert.equal(receipt.description,'');assert.deepEqual(receipt.attributes,[]);
  const source=await json(await h.route('/api/products/'+saved.id+'/translation-source'));
  assert.deepEqual(source.sourceGaps.map(gap=>gap.fieldId),['detailHtml','detailImages','noticeMaterial']);
  assert.ok(h.network.every(host=>host==='cbu01.alicdn.com'));assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_source_supplements').get().n,0);
 }finally{h.close();}
});
