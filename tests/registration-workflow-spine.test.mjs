import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {companies,json,manualSpineDraft,plain,sourceUrl,workflowSpineFixture} from './helpers/registration-workflow-spine.mjs';
import {createProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';
import {dispatchProductDocument,PRODUCT_DOCUMENT_LIVE_VERIFIED} from '../extensions/supplier-hub/product-document-dispatch.mjs';
import {SINGLE_SENDER} from './helpers/supplier-hub-single-document.mjs';

const traces=[],sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
test.after(()=>fs.writeFileSync(new URL('../outputs/step730-spine-proof.json',import.meta.url),JSON.stringify({format:'step730-registration-workflow-spine-v1',traces,boundary:'Actual category enqueue, recorded-source parser, source receipt, import, editable content/options/quotation handlers, local SQLite/R2 and whole-product document compiler. Source HTTP, translation and image bytes are local fixtures; form is a synthetic Single contract. No operating products, live seller requests, browser bridge, native Hub request or Hub receipt.',liveRequests:0,operatingProductWrites:0,hubWrites:0,actualReceiptVerified:false},null,2)+'\n'));

for(const company of companies)test(`category-selected recorded URL reaches exact edited full-group document without replacing source or category (${company.code})`,async()=>{
 const f=await workflowSpineFixture(company);try{
  const draft=await manualSpineDraft(f),{base,source,included,quotation}=draft;
  assert.equal(source.sourceUrl,sourceUrl);assert.equal(source.provider,'1688-public-mobile-v1');assert.equal(source.options.length,6);assert.equal(source.images.length,19);
  assert.equal(f.h.aiSources.length,1);assert.equal(f.h.stats.downloads,19);assert.equal(f.h.stats.maxDownloads,3);
  const savedOptions=draft.savedOptions.options;
  assert.deepEqual(plain(savedOptions.rows.filter(row=>row.included).map(row=>row.id)),included);
  for(let index=0;index<savedOptions.rows.length;index++){const row=savedOptions.rows[index],raw=source.options[index];assert.equal(row.supplierSku,raw.sku);assert.equal(row.unitCostCny,raw.unitPriceCny);assert.equal(row.minimumOrderQuantity,raw.minimumOrder);assert.equal(row.stock,raw.stock);}
  assert.equal(savedOptions.rows[2].unitsPerPack,3);assert.equal(savedOptions.rows[2].translatedName,'직접 확인한 두 번째 옵션');
  assert.equal(draft.savedContent.content.seo.title.value,draft.title);assert.equal(draft.savedContent.content.seo.description.value,'');assert.equal(draft.savedContent.content.seo.description.provenance,'manual');
  assert.equal(draft.savedContent.content.assets.main.value.length,1);assert.deepEqual(plain(draft.savedContent.content.assets.additional.value),[]);assert.equal(draft.savedContent.content.assets.detail.value.length,2);
  assert.equal(quotation.categoryContext.source,'collection');assert.equal(quotation.categoryContext.profileId,f.profile.id);assert.equal(quotation.categoryContext.categoryId,f.snapshot.categoryId);assert.deepEqual(plain(quotation.categoryContext.categoryPath),f.snapshot.categoryPath);
  const endpoint=base+'/supplier-hub-single-package',candidate=await json(await f.h.route(endpoint));
  assert.equal(candidate.requestedProfileId,null);assert.equal(candidate.review.canPrepare,true,JSON.stringify(candidate.review.issues.filter(issue=>issue.level==='error')));
  const prepared=await json(await f.h.route(endpoint,{method:'POST',body:{action:'prepare',expectedFingerprint:candidate.fingerprint}}));assert.equal(prepared.prepared,true);
  const currentBefore=f.state(),sourceBefore=JSON.stringify(source),requestsBefore=f.requests.length;
  const review=await f.h.load('app/supplier-hub-product-document.ts').reviewCurrentSupplierHubProductDocument({productId:f.product().id,packageView:prepared,quotationView:quotation,fetcher:f.request,signal:new AbortController().signal});
  assert.equal(review.identity.ownerId,'owner');assert.deepEqual(plain(review.identity.company),company);assert.equal(review.identity.categoryId,f.snapshot.categoryId);assert.equal(review.identity.requestedProfileId,null);
  assert.deepEqual(plain(review.members.map(member=>member.optionId)),included);assert.deepEqual(plain(review.members.map(member=>member.documentIndex)),[0,1]);assert.equal(review.body.jsonDocument.length,2);
  const[first,second]=review.body.jsonDocument;
  assert.equal(first.startPage.productName,'첫 옵션 견적서 전용 제목');assert.equal(second.startPage.productName,draft.title+', 직접 확인한 두 번째 옵션');
  for(const document of review.body.jsonDocument){assert.equal(document.startPage.categoryPath,'합성등록워크플로>기록원문연결시험 (997300)');assert.equal(document.productPage.commonAttributes.count,0);assert.equal(document.productPage.commonAttributes.booleanValue,false);assert.equal(document.imagePage.details.htmlProductDetailContent,'');}
  assert.equal(first.productPage.modelNumber,'');assert.equal(second.productPage.modelNumber,'MANUAL-MODEL-730');
  assert.equal(second.productPage.commonAttributes.purchasePrice,'3333');assert.equal(second.productPage.commonAttributes.coupangSalePrice,'4444');assert.equal(second.productPage.commonAttributes.msrp,'5555');
  const calculated=draft.savedOptions.pricing.rows.find(row=>row.optionId===included[0])?.calculation;assert.ok(calculated);assert.equal(first.productPage.commonAttributes.purchasePrice,String(calculated.supplyPrice));assert.equal(first.productPage.commonAttributes.coupangSalePrice,String(calculated.salePrice));assert.equal(first.productPage.commonAttributes.msrp,String(calculated.msrp));
  const readCalls=f.requests.slice(requestsBefore);assert.equal(readCalls.length,4);assert.ok(readCalls.every(call=>call.method==='GET'&&!call.url.includes('?profileId=')));
  const packet=await createProductDocumentPacket(review),preview=await dispatchProductDocument({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action:'preview',packet},SINGLE_SENDER);
  assert.deepEqual(plain(packet.review.body),plain(review.body));assert.deepEqual(plain(preview.members),plain(review.members));assert.equal(preview.preparedBodySha256,review.preparedBodySha256);
  assert.equal(preview.remoteWrites,false);assert.equal(preview.registered,false);assert.equal(preview.liveVerified,false);assert.equal(PRODUCT_DOCUMENT_LIVE_VERIFIED,false);
  await assert.rejects(dispatchProductDocument({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action:'start',packet},SINGLE_SENDER),error=>error.code==='PRODUCT_LIVE_CONTRACT_UNVERIFIED');
  assert.equal(f.state(),currentBefore);assert.equal(JSON.stringify(JSON.parse(f.h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get(f.job.id).payload)),sourceBefore);f.unchangedContext();
  assert.equal(review.registered,false);assert.equal(review.remoteWrites,false);assert.equal(review.submissionReady,false);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n,0);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_single_receipts').get().n,0);
  const requestsAtResume=f.sourceCalls.length,downloads=f.h.stats.downloads,beforeResume=f.state();await f.run();assert.equal(f.state(),beforeResume);assert.equal(f.sourceCalls.length,requestsAtResume);assert.equal(f.h.stats.downloads,downloads);assert.equal(f.h.aiSources.length,1);
  traces.push({company,productId:f.product().id,sourceReceiptSha256:sha(sourceBefore),capturedContextSha256:sha(f.context),includedOptionIds:included,excluded:4,sourceOptions:6,sourceImages:19,preparedDocuments:2,querylessReadCalls:readCalls.length,preservedManualBlanks:true,preservedStageTwoPrices:true,exactPacketPreview:true,startGateRejected:true,resumeDoesNotRecapture:true,nativeReceipt:false});
 }finally{f.close();}
});

for(const company of companies)test(`collected draft cannot be prepared under the other approved company (${company.code})`,async()=>{
 const f=await workflowSpineFixture(company);try{
  const draft=await manualSpineDraft(f),before=f.state(),objects=new Map([...f.h.objects].map(([key,bytes])=>[key,bytes.slice()]));
  f.h.setCompany(companies.find(value=>value.code!==company.code));
  const response=await f.h.route(draft.base+'/supplier-hub-single-package');assert.equal(response.status,409);const body=await response.json();assert.ok(typeof body.error==='string');
  assert.equal(f.state(),before);assert.equal(f.h.objects.size,objects.size);for(const[key,bytes]of objects)assert.deepEqual(f.h.objects.get(key),bytes);f.unchangedContext();
  traces.push({company,kind:'cross-company native package rejection',status:409,sourceAndDraftUnchanged:true,assetPublication:0,nativeReceipt:false});
 }finally{f.close();}
});
