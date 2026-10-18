import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {mobileImageApiHarness,mobileImageOfferId,mobileImageSourceUrl,mobileImageTitle,mixedRet,json,plain} from './helpers/mobile-option-image-fallback.mjs';
import {schemaCompanies} from './helpers/hub-schema.mjs';

const sourceFiles=['app/alibaba-mobile-product.ts','app/alibaba-mobile-collector.ts','app/alibaba-mobile-response.ts','app/browser-product-capture.ts','app/collection-image-store.ts','app/collection-image-draft.ts','db/collection-images.ts','db/collection-image-draft.ts'];
const hashes=()=>Object.fromEntries(sourceFiles.map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]));
const snapshot=h=>JSON.stringify(Object.fromEntries(['products','product_content','product_options','product_quotation_fields','collection_results','collection_context','collection_images','translation_jobs'].map(table=>[table,h.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])));
const product=h=>h.sqlite.prepare('SELECT * FROM products').get();
const content=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
const options=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);

for(const company of schemaCompanies)for(const mode of ['server-mobile','browser-capture'])test(`mobile URL source image selection reaches editable quotation and survives review/reimport (${company.code}, ${mode})`,async t=>{
 const h=mobileImageApiHarness(company),sourceBefore=hashes();
 try{
  const rawBefore=JSON.stringify(h.fixture);
  if(mode==='browser-capture')await json(await h.route('/api/collection-jobs/job/browser-capture',{method:'POST',body:h.fixture.capture}));
  assert.match(await h.intake(),/상품 초안 저장됨/);assert.equal(JSON.stringify(h.fixture),rawBefore,'source JSON/HTML remain inert and unchanged');
  const saved=product(h),base='/api/products/'+saved.id,receipt=(await json(await h.route('/api/collection-jobs/job/result'))).receipt.result;
  assert.equal(receipt.offerId,mobileImageOfferId);assert.equal(receipt.sourceUrl,mobileImageSourceUrl);assert.equal(receipt.title,mobileImageTitle);
  assert.equal(receipt.provider,mode==='server-mobile'?'1688-public-mobile-v1':'chrome-public-mobile-v1');assert.equal(receipt.offerDefault,undefined);
  assert.deepEqual(receipt.options.map(option=>[option.sku,option.name,option.imageIndex,option.unitPriceCny,option.minimumOrder,option.stock]),[
   ['69310001','Black / M / Basic',0,4.5,2,0],['69310002','Green / L / Basic',1,6,2,8],['69310003','Blue / S / Compact',2,9.1,2,null],
  ]);
  assert.equal(receipt.images.length,5);assert.ok(receipt.options.every(option=>option.imageIndex!==3),'second nonselected image remains a separate editable candidate');
  const originals=new Map(h.sqlite.prepare('SELECT image_index,object_key FROM collection_images ORDER BY image_index').all().map(row=>[row.image_index,row.object_key]));
  const optionView=await json(await h.route(base+'/options')),savedContent=content(h);
  for(let i=0;i<3;i++){
   const row=optionView.options.rows[i];assert.equal(row.supplierSku,receipt.options[i].sku);assert.equal(row.provenance.supplierSku,'collected');assert.equal(row.imageKey,originals.get(receipt.options[i].imageIndex));assert.equal(row.provenance.imageKey,'collected');
   assert.equal(optionView.sourceImageKeys[row.id],row.imageKey);assert.equal(row.provenance.translatedName,'translated');
  }
  assert.deepEqual(savedContent.assets.main.value,[originals.get(0)]);assert.deepEqual(savedContent.assets.additional.value,[originals.get(1),originals.get(2),originals.get(3)]);assert.deepEqual(savedContent.assets.detail.value,[originals.get(4)]);
  assert.ok(h.objects.has(originals.get(3)),'valid unselected second-axis media is retained rather than discarded');
  assert.equal(h.stats.downloads,5);assert.equal(h.objects.size,5);assert.equal(h.aiSources.length,1);assert.equal(saved.supplier_hub_status,'미전송');
  assert.ok(!h.network.includes('outside.example'));
  if(mode==='server-mobile')assert.deepEqual(h.sources.map(source=>source.host),['detail.1688.com','m.1688.com','h5api.m.1688.com','itemcdn.tmall.com']);else assert.deepEqual(h.sources,[]);
  const sourcePreview=await json(await h.route(base+'/translation-source'));
  assert.equal(sourcePreview.title,mobileImageTitle);assert.equal(sourcePreview.jobId,'job');assert.equal(sourcePreview.sourceUrl,mobileImageSourceUrl);assert.equal(sourcePreview.requestContext.categoryId,'80719');assert.match(sourcePreview.description,/原文三轴说明/);assert.equal(sourcePreview.attributes[0].value,'PP');
  const quote=await json(await h.route(base+'/quotation-fields'));assert.equal(quote.categoryContext.categoryId,'80719');
  for(const row of quote.resolved.rows.filter(row=>row.optionId!==null))assert.equal(row.fields.mainImage.value,optionView.options.rows.find(option=>option.id===row.optionId).imageKey);
  const source=h.load('app/exports/quotation-source.ts'),exporter=h.load('app/exports/quotation-fields.ts'),exportSource=await source.readQuotationExportSource('owner',saved.id,null),resolved=source.resolveQuotationExport(exportSource);
  const assets=exporter.quotationAttachmentKeys(exportSource,resolved,'quotation').map((key,index)=>({key,name:`assets/mobile-${index}.png`,bytes:h.objects.get(key)}));
  const exported=exporter.resolvedQuotationRows(exportSource,resolved,assets);
  for(let i=0;i<3;i++){assert.equal(exported[i].skuId,receipt.options[i].sku);assert.equal(exported[i].mainImage,assets.find(asset=>asset.key===optionView.options.rows[i].imageKey).name.split('/').at(-1));}
  const inputs=h.load('app/product-options.ts').optionInputs(optionView.options);inputs[0].imageKey=null;inputs[1].imageKey=originals.get(0);inputs[2].translatedName='직접 검토한 파랑 모바일 옵션';
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:optionView.options.revision,expectedProductVersion:optionView.productVersion,rows:inputs}}));
  // Only preservation is tested here: this local fixture models an already
  // translated image; it does not run or claim an image translation provider.
  const translated=options(h);translated.rows[2].provenance.imageKey='translated';h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(translated),saved.id);
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content(h).revision,patch:{assets:{main:[originals.get(4)],detail:[]},label:{material:'수동 검토한 모바일 소재'}}}}));
  const review=await json(await h.route(base+'/quotation-fields'));
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:review.revision,expectedInputFingerprint:review.inputFingerprint,changes:[{fieldKey:'mainImage',optionId:inputs[1].id,value:''}]}}));
  const immutableReceipt=h.sqlite.prepare('SELECT * FROM collection_results').get(),before=snapshot(h),files=[...h.objects].map(([key,value])=>[key,Buffer.from(value).toString('hex')]),network=h.network.length,generations=h.aiSources.length;
  await json(await h.route('/api/collection-jobs/job/browser-capture',{method:'POST',body:h.fixture.capture}));
  const {offerId,...receiptBody}=receipt;assert.equal(offerId,mobileImageOfferId);await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body:receiptBody}));
  const reapplied=await json(await h.route('/api/collection-jobs/job/image-draft',{method:'POST',body:{productId:saved.id}}));assert.equal(reapplied.changedRoles,0);assert.equal(reapplied.changedOptions,0);
  await h.intake();assert.equal(snapshot(h),before);assert.deepEqual(h.sqlite.prepare('SELECT * FROM collection_results').get(),immutableReceipt);
  assert.equal(h.network.length,network);assert.equal(h.aiSources.length,generations);assert.equal(h.stats.downloads,5);assert.deepEqual([...h.objects].map(([key,value])=>[key,Buffer.from(value).toString('hex')]),files);
  const finalOptions=options(h),finalQuote=await json(await h.route(base+'/quotation-fields'));
  assert.equal(finalOptions.rows[0].imageKey,null);assert.equal(finalOptions.rows[0].provenance.imageKey,'manual');assert.equal(finalOptions.rows[1].imageKey,originals.get(0));assert.equal(finalOptions.rows[1].provenance.imageKey,'manual');
  assert.equal(finalOptions.rows[2].imageKey,originals.get(2));assert.equal(finalOptions.rows[2].provenance.imageKey,'translated');assert.equal(finalOptions.rows[2].translatedName,'직접 검토한 파랑 모바일 옵션');
  assert.deepEqual(finalQuote.resolved.rows.filter(row=>row.optionId!==null).map(row=>row.fields.mainImage.value),[originals.get(4),'',originals.get(2)]);
  assert.ok(h.calls.every(path=>!path.includes('supplier-hub')&&!path.includes('/attach')&&!path.includes('submission')));assert.deepEqual(hashes(),sourceBefore);
  t.diagnostic(JSON.stringify({company,mode,offerId,mappedIndices:receipt.options.map(option=>option.imageIndex),sourceHashes:sourceBefore,sourceFrozen:true,
   requests:h.requests,requestCount:h.requests.length,sourceTransportReplies:h.sources.length,mediaObjects:h.objects.size,downloads:h.stats.downloads,canonicalGenerations:h.aiSources.length,
   savedRows:Object.fromEntries(['products','collection_results','collection_images','product_options','product_content','product_quotation_fields','translation_jobs'].map(table=>[table,h.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n])),
   nonselectedSecondCandidatePreserved:true,replaySnapshotUnchanged:true,manualBlankAndCommonFallbackPreserved:true,translatedImageProvenance:'isolated existing-work seed, not translation execution',externalNetwork:0,supplierHub:0,nativeBrowser:false}));
 }finally{h.close();}
});

test('mixed success/failure capture cannot save mobile or public-SKU source or create a product',async()=>{
 const h=mobileImageApiHarness(schemaCompanies[0]);
 try{
  const invalid=structuredClone(h.fixture.skuPayload);invalid.ret=[...mixedRet];
  for(const capture of [{...h.fixture.capture,skuPayload:invalid},{format:'1688-public-sku-capture-v1',sourceUrl:mobileImageSourceUrl,skuPayload:invalid}]){
   await json(await h.route('/api/collection-jobs/job/browser-capture',{method:'POST',body:capture}),422);
   for(const table of ['products','collection_results','collection_source_supplements'])assert.equal(h.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
   assert.equal(h.objects.size,0);assert.equal(h.aiSources.length,0);assert.equal(h.network.length,0);
  }
 }finally{h.close();}
});

test('mixed source response stops the default URL collector before details, source storage or product creation',async()=>{
 const h=mobileImageApiHarness(schemaCompanies[0],{mixed:true});
 try{
  const failure=await json(await h.route('/api/collection-jobs/job/collect',{method:'POST'}),422);assert.equal(failure.code,'SOURCE_NOT_COLLECTED');
  assert.deepEqual(h.sources.map(source=>source.host),['detail.1688.com','m.1688.com','h5api.m.1688.com']);
  for(const table of ['products','collection_results','collection_source_supplements'])assert.equal(h.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  assert.equal(h.objects.size,0);assert.equal(h.aiSources.length,0);assert.equal(h.stats.downloads,0);
 }finally{h.close();}
});

test('mixed failure cannot append a supplement or alter the immutable valid SKU-only receipt',async()=>{
 const h=mobileImageApiHarness(schemaCompanies[0]);
 try{
  const original=h.load('app/alibaba-mobile-product.ts').parseAlibabaPublicSkuProduct(h.fixture.skuPayload,mobileImageSourceUrl),{offerId,...body}=plain(original);assert.equal(offerId,mobileImageOfferId);
  await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body}));
  const before=snapshot(h),invalid=structuredClone(h.fixture.skuPayload);invalid.ret=[...mixedRet];
  await json(await h.route('/api/collection-jobs/job/source-supplement',{method:'POST',body:{capture:{...h.fixture.capture,skuPayload:invalid}}}),422);
  assert.equal(snapshot(h),before);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_source_supplements').get().n,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);assert.equal(h.objects.size,0);assert.equal(h.aiSources.length,0);assert.equal(h.network.length,0);
 }finally{h.close();}
});
