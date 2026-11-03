import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeSelectedWorkflowFixture,companies,stages,json} from './helpers/step922-native-workflow.mjs';
import {createProductDocumentPacket,validateProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const objectState=f=>JSON.stringify([...f.h.objects].map(([key,bytes])=>[key,sha(bytes)]));

for(const company of companies)test(`step922 ${company.code}: actual selected runner output passes native source and independent request payload validation`,async()=>{
 const f=await nativeSelectedWorkflowFixture(company);
 try{
  const result=await f.run(stages);assert.ok(result);for(const stage of result.stages)assert.ok(['draft','complete','skipped'].includes(stage.status),stage.id+': '+stage.message);
  const readsFrom=f.requests.length,models=f.boundaries.filter(row=>row.type==='workers-model').length,objects=objectState(f);
  const query='?profileId='+encodeURIComponent(f.profile.id),view=await json(await f.request(f.base+'/quotation-fields'+query)),plan=await json(await f.request(f.base+'/native-assets'+query));
  assert.equal(plan.metadataValid,true,JSON.stringify(plan.issues.filter(issue=>issue.level==='error')));
  const review=await f.h.load('app/supplier-hub-native-product-document.ts').reviewCurrentNativeSupplierHubProductDocument({productId:f.productId,profileId:f.profile.id,quotationView:view,sourcePlan:plan,ownerId:'owner',signal:new AbortController().signal,fetcher:f.request});
  const packet=await createProductDocumentPacket(JSON.parse(JSON.stringify(review))),validated=await validateProductDocumentPacket(packet);
  assert.equal(validated.packet.review.identity.fingerprint,plan.sourcePlanSha256);assert.equal(validated.preparedBody.docId,null);assert.equal(validated.preparedBody.jsonDocument.length,1);
  const body=validated.preparedBody,document=body.jsonDocument[0],row=view.resolved.rows.find(row=>row.included);
  assert.equal(packet.review.identity.ownerId,'owner');assert.deepEqual(JSON.parse(JSON.stringify(packet.review.identity.company)),company);
  assert.equal(packet.review.members[0].optionId,row.optionId);assert.equal(body.displayCategoryCode,f.snapshot.categoryId);assert.equal(body.scope,'Retail_Categorized_Single');assert.equal(body.categoryId,f.snapshot.metadata.kanCategoryId);
  assert.equal(body.productName,row.fields.title.value);assert.equal(document.startPage.productName,row.fields.title.value);assert.equal(document.startPage.categoryPath,body.categoryPath);
  assert.equal(document.productPage.manufacturer,'검토 제조사');assert.equal(document.productPage.businessType,'제조사');assert.equal(document.productPage.importType,'수입상품');assert.equal(document.productPage.taxationSchema,'과세');
  assert.equal(document.legalPage.kcMarkType,'해당사항없음');assert.equal(document.logisticsPage.daysToExpiration,0);assert.equal(document.logisticsPage.specialHandlingReason,'해당사항없음');
  assert.equal(document.logisticsPage.skuUnitBoxWeight,'40');assert.equal(document.logisticsPage.skuUnitBoxDimension,'60*80*15');
  for(const[key,field]of [['purchasePrice','supplyPrice'],['coupangSalePrice','salePrice'],['msrp','msrp']]){assert.equal(document.productPage.commonAttributes[key],row.fields[field].value);assert.ok(Number(document.productPage.commonAttributes[key])>0);}
  const files=Object.fromEntries(plan.images.map(image=>[image.imageType,image]));assert.deepEqual(Object.keys(files).sort(),['ADDITIONAL','DETAIL','LABEL','MAIN']);
  assert.equal(document.imagePage.images.mainImage,files.MAIN.transportName);assert.equal(document.imagePage.images.additionalImage,files.ADDITIONAL.transportName);assert.equal(document.imagePage.details.detailedImage,files.DETAIL.transportName);
  assert.deepEqual(document.imagePage.images.labelImages,[{labelImageType:'제품 한글 표시사항 라벨 또는 도안 이미지',labelImageFiles:files.LABEL.transportName}]);
  for(const file of plan.images){assert.equal(file.sha256,sha(f.h.objects.get(file.key)));assert.equal(file.byteLength,f.h.objects.get(file.key).length);assert.equal(file.references.length,1);assert.equal(file.references[0].optionId,row.optionId);assert.equal(file.references[0].slotIndex,0);}
  assert.equal(document.imagePage.msrpAgree,false);assert.equal(document.imagePage.labelContactAgreed,false);assert.equal(review.registered,false);assert.equal(review.remoteWrites,false);assert.equal(review.submissionReady,false);assert.equal(validated.registered,false);
  assert.equal(f.boundaries.filter(row=>row.type==='workers-model').length,models);assert.equal(objectState(f),objects);assert.ok(f.requests.slice(readsFrom).every(request=>request.method==='GET'),'native read/review/packet compilation performs no app writes or model calls');
  assert.equal(f.immutableSource(),f.sourceBefore);assert.equal(f.h.sqlite.prepare('SELECT count(*) AS n FROM supplier_hub_receipts').get().n,0);
  console.log('STEP922_PROOF '+JSON.stringify({company:company.code,syntheticOnly:true,initialInputs:f.initialInputs,stages:Array.from(result.stages,({id,status})=>({id,status})),nativeValid:plan.metadataValid,blockingIssues:[],roles:Object.keys(files),currentFileShasVerified:true,packetValidated:true,body:{scope:body.scope,displayCategoryCode:body.displayCategoryCode,categoryId:body.categoryId,productNoticeNumber:body.productNoticeNumber,version:body.version,members:body.jsonDocument.length,prices:document.productPage.commonAttributes,legal:document.legalPage,packaging:document.logisticsPage,agreements:{msrpAgree:document.imagePage.msrpAgree,labelContactAgreed:document.imagePage.labelContactAgreed}},counts:f.counts(),models:f.boundaries.filter(row=>row.type==='workers-model'),remoteWrites:false,submitted:false,receipts:0}));
  // A later real settings save must retire the retained plan, even when the
  // quotation revision itself did not change. Do not retag the original proof.
  const settings=await json(await f.request('/api/settings'));
  await json(await f.request('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({...settings.settings,handlingReason:'유리',expectedOwnerId:'owner'})}));
  const guardReads=f.requests.length;
  await assert.rejects(f.h.load('app/supplier-hub-native-product-document.ts').reviewCurrentNativeSupplierHubProductDocument({productId:f.productId,profileId:f.profile.id,quotationView:view,sourcePlan:plan,ownerId:'owner',signal:new AbortController().signal,fetcher:f.request}),/전송 자료|원본 조회/u);
  assert.ok(f.requests.slice(guardReads).every(request=>request.method==='GET'));assert.equal(f.boundaries.filter(row=>row.type==='workers-model').length,models);assert.equal(f.h.sqlite.prepare('SELECT count(*) AS n FROM supplier_hub_receipts').get().n,0);
 }finally{f.close();}
});

test('step922 a completed runner draft still cannot prepare native transport while legal applicability is unknown',async()=>{
 const f=await nativeSelectedWorkflowFixture(companies[0],{legalApplicability:false});
 try{
  const result=await f.run(stages);assert.equal(result.stages.at(-1).status,'draft');
  const query='?profileId='+encodeURIComponent(f.profile.id),view=await json(await f.request(f.base+'/quotation-fields'+query)),plan=await json(await f.request(f.base+'/native-assets'+query));
  assert.equal(plan.metadataValid,false);assert.ok(plan.issues.some(issue=>issue.code==='NATIVE_ASSET_LEGAL_UNCONFIRMED'));
  const before=f.requests.length;await assert.rejects(f.h.load('app/supplier-hub-native-product-document.ts').compileNativeSupplierHubProductDocument({productId:f.productId,profileId:f.profile.id,quotationView:view,sourcePlan:plan,ownerId:'owner'}),/필수 입력|서류 해당 여부/u);
  assert.equal(f.requests.length,before);assert.equal(f.h.sqlite.prepare('SELECT count(*) AS n FROM supplier_hub_receipts').get().n,0);
 }finally{f.close();}
});
