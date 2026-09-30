import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {submissionPackageUI} from './helpers/submission-package-ui.mjs';

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const companies=[{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];

// Exercises the observed 81221 form contract using recorded supplier facts,
// synthetic image bytes/template and locally captured transport. The source is
// sunglasses, not gloves: this is no commercial classification or Hub upload.
for(const company of companies)test(`81221 stage edits survive intake retry, XLSX and the reviewed handoff (${company.companyCode})`,async()=>{
 const h=mobileIntakeHarness(company);
 try{
  h.context.category={...h.context.category,name:'스포츠 장갑',categoryId:'81221',categoryPath:['스포츠/레져','스포츠 잡화','스포츠 장갑']};
  h.sqlite.prepare("UPDATE collection_context SET payload=? WHERE job_id='job'").run(JSON.stringify(h.context));
  await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  assert.equal(h.aiSources[0].category.id,'81221');
  let view=await json(await h.route(base+'/quotation-fields'));
  assert.equal(view.categoryContext.categoryId,'81221');assert.equal(view.categoryContext.profileId,'cat');
  const sourceOptions=await json(await h.route(base+'/options'));
  const rows=h.load('app/product-options.ts').optionInputs(sourceOptions.options);
  const colors=['검정','하양','회색','파랑','빨강','초록'],sizes=['S','M','L','XL','Free Size','XXL이상'];
  rows.forEach((row,index)=>{row.color=colors[index];row.size=sizes[index];row.translatedName=`검토 옵션 ${index+1}`;});
  rows[5].included=false;
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:sourceOptions.options.revision,expectedProductVersion:sourceOptions.productVersion,rows}}));
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  const images=h.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(row=>row.object_key);
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{
   label:{model:'REVIEWED-MODEL',dimensions:'장갑 길이 23cm, 중량 80g',kcInformation:'직접 확인한 KC 정보',specifications:'직접 확인한 장갑 세부 사양'},
   assets:{main:[images[0]],additional:[images[1]],detail:[images[2]],label:[images[3]]},
  }}}));
  view=await json(await h.route(base+'/quotation-fields'));
  for(let index=0;index<5;index++){
   const fields=view.resolved.rows.find(row=>row.optionId===`collected-${index+1}`).fields;
   assert.equal(fields.glove_noticeColor.value,colors[index]);assert.equal(fields.glove_fashionSize.value,sizes[index]);
   assert.equal(fields.size.value,sizes[index]);assert.equal(fields.glove_noticeSizeWeight.value,'장갑 길이 23cm, 중량 80g');
   assert.equal(fields.glove_noticeKc.value,'직접 확인한 KC 정보');assert.equal(fields.glove_noticeSpecifications.value,'직접 확인한 장갑 세부 사양');
  }
  // Explicitly reviewed legal/logistics values, not an invented 81221 preset.
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[
   {fieldKey:'taxType',optionId:null,value:'과세'},
   {fieldKey:'kcMarkType',optionId:null,value:'해당사항없음'},
   {fieldKey:'shelfLifeDays',optionId:null,value:'0'},
   {fieldKey:'handlingReason',optionId:null,value:'해당사항없음'},
   {fieldKey:'packagedWeightG',optionId:null,value:'420'},
   {fieldKey:'packagedDimensionsMm',optionId:null,value:'100*200*300'},
   {fieldKey:'glove_noticeColor',optionId:'collected-2',value:'직접 검토한 색상'},
   {fieldKey:'glove_noticeSpecifications',optionId:'collected-2',value:''},
  ]}}));
  const savedContent=JSON.stringify(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  const networkBefore=h.network.length;
  assert.match(await h.intake(),/저장된 SEO·옵션값/);
  assert.equal(h.network.length,networkBefore);assert.equal(h.aiSources.length,1);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT payload FROM product_content').get().payload),savedContent);
  const savedOptions=await json(await h.route(base+'/options'));
  assert.equal(savedOptions.options.rows.length,6);assert.equal(savedOptions.options.rows[5].included,false);
  view=await json(await h.route(base+'/quotation-fields'));
  const fields=['skuId','categoryId','sourceUrl',...view.resolved.schema.fields.map(field=>field.id)],workbook=quotationWorkbook(fields);
  const sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
  await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 스포츠장갑 연동 시험',categoryId:'81221',categoryPath:h.context.category.categoryPath,
   template:{name:'synthetic.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},
   mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));
  assert.equal(preview.rows.length,5);assert.equal(preview.report.categoryId,'81221');assert.equal(preview.report.profileId,'cat');
  assert.deepEqual(preview.report.company,{code:company.companyCode,name:company.companyName});
  assert.equal(preview.submissionReview.errorCount,0,JSON.stringify(preview.submissionReview.issues.filter(issue=>issue.kind==='error')));
  const bundleResponse=await h.route(base+'/quotation',{method:'POST',body:{action:'export',fingerprint:preview.fingerprint}});
  assert.equal(bundleResponse.status,200,await bundleResponse.clone().text());
  const reader=h.load('app/xlsx-template.ts'),bundle=await reader.readXlsxArchive(await bundleResponse.arrayBuffer());
  const plan=JSON.parse(new TextDecoder().decode(bundle.get('supplier-hub-upload-plan.json')));
  assert.deepEqual(plan.company,{code:company.companyCode,name:company.companyName});assert.equal(plan.categoryId,'81221');
  const review=JSON.parse(new TextDecoder().decode(bundle.get('submission-review.json')));
  assert.equal(review.includedOptions,5);assert.equal(review.inputFingerprint,preview.fingerprint);
  const exported=reader.inspectXlsxArchive(await reader.readXlsxArchive(bundle.get(plan.quotation.file.filename)));
  for(let index=0;index<5;index++){
   const cells=reader.xlsxHeaders(exported,'견적서',index+2),row=Object.fromEntries(fields.map((field,column)=>[field,cells[column]]));
   assert.equal(row.skuId,sourceOptions.options.rows[index].supplierSku);assert.equal(row.categoryId,'81221');
   assert.equal(row.glove_noticeColor,index===1?'직접 검토한 색상':colors[index]);
   assert.equal(row.glove_noticeSizeWeight,'장갑 길이 23cm, 중량 80g');assert.equal(row.glove_noticeKc,'직접 확인한 KC 정보');
   assert.equal(row.glove_noticeSpecifications,index===1?'':'직접 확인한 장갑 세부 사양');
   assert.equal(row.glove_fashionSize,sizes[index]);assert.equal(row.size,sizes[index]);
  }
  const ui=submissionPackageUI({route:h.route,productId:product.id,categoryId:'81221'});
  await ui.click('견적서 + 첨부 파일 준비');
  await ui.click('확장에 첨부 파일 준비');ui.choose();await ui.click('등록 전송');
  assert.deepEqual(ui.alerts(),[]);
  const handoff=ui.calls.find(call=>call.action==='transmit');
  assert.ok(handoff);assert.equal(handoff.files.categoryId,'81221');
  assert.deepEqual(handoff.files.company,{code:company.companyCode,name:company.companyName});
  assert.equal(handoff.files.includedOptions,5);
  assert.deepEqual(JSON.parse(JSON.stringify(handoff.agreements)),{priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:true});
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{h.close();}
});
