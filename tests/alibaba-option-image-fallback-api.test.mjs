import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {optionImageApiHarness,optionImageOfferId,optionImageSourceUrl,json,plain,unusedThirdImage} from './helpers/alibaba-option-image-fallback.mjs';
import {schemaCompanies} from './helpers/hub-schema.mjs';

const sourceFiles=['app/alibaba-product-result.ts','app/collection-result.ts','app/collection-image-store.ts','app/collection-image-draft.ts','app/collection-image.ts','db/collection-images.ts','db/collection-image-draft.ts'];
const hashes=()=>Object.fromEntries(sourceFiles.map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]));
const snapshot=h=>JSON.stringify(Object.fromEntries(['products','product_content','product_options','product_quotation_fields','collection_results','collection_context','collection_images','translation_jobs'].map(table=>[table,h.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])));
const getContent=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
const getOptions=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);
const getProduct=h=>h.sqlite.prepare('SELECT * FROM products').get();

for(const company of schemaCompanies)test(`actual SKU image priorities reach stage seven and preserve reviewed work through source replay (${company.code})`,async t=>{
 const h=optionImageApiHarness(company),sourceBefore=hashes();
 try{
  const immutableInput=JSON.stringify(h.payload),parsed=h.load('app/alibaba-product-result.ts').parseAlibabaProduct(h.payload,optionImageSourceUrl);
  const {offerId,...body}=plain(parsed);assert.equal(offerId,optionImageOfferId);assert.equal(JSON.stringify(h.payload),immutableInput);
  assert.equal(parsed.offerDefault,undefined);assert.deepEqual(Array.from(parsed.options,option=>option.imageIndex),[0,1,3]);
  assert.equal(parsed.images.length,5);assert.ok(parsed.images.every(image=>image.url!==unusedThirdImage&&!image.url.includes('not-selected.example')));
  assert.ok(!parsed.options.some(option=>option.imageIndex===2),'unselected second image must remain a source candidate without becoming an option representative');
  await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body}));
  assert.equal(h.objects.size,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);
  assert.match(await h.intake(),/상품 초안 저장됨/);
  const product=getProduct(h),base='/api/products/'+product.id,options=await json(await h.route(base+'/options')),content=getContent(h);
  const originals=new Map(h.sqlite.prepare('SELECT image_index,object_key FROM collection_images ORDER BY image_index').all().map(row=>[row.image_index,row.object_key]));
  assert.equal(options.options.rows.length,3);
  for(let i=0;i<3;i++){
   const row=options.options.rows[i];assert.equal(row.supplierSku,parsed.options[i].sku);assert.equal(row.provenance.supplierSku,'collected');
   assert.equal(row.imageKey,originals.get(parsed.options[i].imageIndex));assert.equal(row.provenance.imageKey,'collected');
   assert.equal(options.sourceImageKeys[row.id],row.imageKey);assert.equal(row.provenance.translatedName,'translated');
  }
  assert.deepEqual(plain(parsed.sourceGallery),{format:'1688-openapi-gallery-v1',imageIndices:[0,1]});
  assert.deepEqual(content.assets.main.value,[originals.get(0)]);assert.deepEqual(content.assets.additional.value,[originals.get(1)]);assert.deepEqual(content.assets.detail.value,[originals.get(4)]);
  assert.ok(h.objects.has(originals.get(2)),'nonselected valid second candidate is downloaded and remains editable');
  assert.equal(h.stats.downloads,5);assert.equal(h.objects.size,5);assert.equal(h.aiSources.length,1);assert.equal(product.supplier_hub_status,'미전송');
  assert.ok(h.network.every(host=>host==='cbu01.alicdn.com'),'only synthetic allowlisted CDN media is served; unselected attribute URLs are never fetched');
  const quote=await json(await h.route(base+'/quotation-fields'));
  for(const row of quote.resolved.rows)assert.equal(row.fields.mainImage.value,row.optionId===null?content.assets.main.value[0]:options.options.rows.find(option=>option.id===row.optionId).imageKey);
  const exportSource=h.load('app/exports/quotation-source.ts'),fieldExport=h.load('app/exports/quotation-fields.ts');
  const saved=await exportSource.readQuotationExportSource('owner',product.id,null),resolved=exportSource.resolveQuotationExport(saved);
  const attachments=fieldExport.quotationAttachmentKeys(saved,resolved,'quotation').map((key,index)=>({key,name:`assets/priority-${index}.png`,bytes:h.objects.get(key)}));
  const exported=fieldExport.resolvedQuotationRows(saved,resolved,attachments);
  for(let i=0;i<3;i++){
   assert.equal(exported[i].skuId,parsed.options[i].sku);assert.equal(exported[i].mainImage,attachments.find(asset=>asset.key===options.options.rows[i].imageKey).name.split('/').at(-1));
  }
  const edits=h.load('app/product-options.ts').optionInputs(options.options);edits[0].imageKey=null;edits[1].imageKey=originals.get(0);edits[2].translatedName='직접 검토한 파랑 옵션';
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows:edits}}));
  // Seed already translated image provenance in the isolated fixture. This
  // tests preservation only; no image translation service is called or claimed.
  const translated=getOptions(h);translated.rows[2].provenance.imageKey='translated';
  h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(translated),product.id);
  const current=getContent(h);
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:current.revision,patch:{assets:{main:[originals.get(4)],detail:[]},label:{material:'직접 검토한 소재'}}}}));
  const reviewed=await json(await h.route(base+'/quotation-fields'));
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:reviewed.revision,expectedInputFingerprint:reviewed.inputFingerprint,changes:[{fieldKey:'mainImage',optionId:edits[1].id,value:''}]}}));
  const oldReceipt=h.sqlite.prepare('SELECT * FROM collection_results').get(),before=snapshot(h),fileBytes=[...h.objects].map(([key,value])=>[key,Buffer.from(value).toString('hex')]),requests=h.network.length,generations=h.aiSources.length;
  await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body}));
  const imageDraft=await json(await h.route('/api/collection-jobs/job/image-draft',{method:'POST',body:{productId:product.id}}));
  assert.equal(imageDraft.changedOptions,0);assert.equal(imageDraft.changedRoles,0);
  await h.intake();
  assert.equal(snapshot(h),before,'receipt reimport/image draft cannot overwrite manually cleared, chosen or translated work');
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM collection_results').get(),oldReceipt);assert.equal(h.stats.downloads,5);assert.equal(h.network.length,requests);assert.equal(h.aiSources.length,generations);
  assert.deepEqual([...h.objects].map(([key,value])=>[key,Buffer.from(value).toString('hex')]),fileBytes);
  const finalOptions=getOptions(h),finalContent=getContent(h),finalQuote=await json(await h.route(base+'/quotation-fields'));
  assert.equal(finalOptions.rows[0].imageKey,null);assert.equal(finalOptions.rows[0].provenance.imageKey,'manual');
  assert.equal(finalOptions.rows[1].imageKey,originals.get(0));assert.equal(finalOptions.rows[1].provenance.imageKey,'manual');
  assert.equal(finalOptions.rows[2].imageKey,originals.get(3));assert.equal(finalOptions.rows[2].provenance.imageKey,'translated');assert.equal(finalOptions.rows[2].translatedName,'직접 검토한 파랑 옵션');
  assert.deepEqual(finalContent.assets.main.value,[originals.get(4)]);assert.deepEqual(finalContent.assets.detail.value,[]);assert.equal(finalContent.label.material.value,'직접 검토한 소재');
  assert.deepEqual(finalQuote.resolved.rows.filter(row=>row.optionId!==null).map(row=>row.fields.mainImage.value),[originals.get(4),'',originals.get(3)],'null option follows current common image while explicit quotation blank stays blank');
  assert.ok(h.calls.every(path=>!path.includes('supplier-hub')&&!path.includes('/attach')&&!path.includes('submission')));assert.deepEqual(hashes(),sourceBefore);
  t.diagnostic(JSON.stringify({company,sourceOffer:offerId,selectedReceiptIndices:Array.from(parsed.options,option=>option.imageIndex),sourceHashes:sourceBefore,sourceFrozen:true,
   requests:h.requests.map(({path,method,status})=>({path,method,status})),requestCount:h.requests.length,
   savedRows:Object.fromEntries(['products','collection_results','collection_images','product_options','product_content','product_quotation_fields','translation_jobs'].map(table=>[table,h.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n])),
   downloads:h.stats.downloads,mediaObjects:h.objects.size,canonicalGenerations:h.aiSources.length,manualAndTranslatedImagePreserved:true,manualBlankAndCommonFallbackPreserved:true,replaySnapshotUnchanged:true,
   externalSourceRequests:0,supplierHubRequests:0,nativeBrowser:false,translatedImageProvenance:'isolated existing-work seed, not a translation execution'}));
 }finally{h.close();}
});
