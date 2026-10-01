import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {submissionPackageUI} from './helpers/submission-package-ui.mjs';

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const cleared=['manufacturer','importer','countryOfOrigin','contact'];
for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test('removed first-entry defaults survive label save, URL retry, quotation edits and exact transmitted Excel ('+company.companyCode+')',async()=>{
 const h=mobileIntakeHarness(company);
 try{
  // Recorded sunglasses source; 80719 is an observed form test contract only.
  // This workbook and final Hub transport are synthetic, never a real upload.
  const fields=['skuId','categoryId',...h.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id)];
  const workbook=quotationWorkbook(fields),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
  await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'표시사항 연동 시험',categoryId:'80719',categoryPath:h.context.category.categoryPath,
   template:{name:'synthetic.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const original=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  // Model a supported legacy record with empty labels and captured settings:
  // initial label autofill changes the draft, not the stored document.
  for(const key of cleared)original.label[key]={value:'',provenance:'unverified',updatedAt:null};
  h.sqlite.prepare('UPDATE product_content SET payload=?').run(JSON.stringify(original));
  const registration=await json(await h.route(base+'/registration-settings'));
  const autofill=h.load('app/label-autofill.ts').fillLabelDraft(Object.fromEntries(Object.entries(original.label).map(([key,field])=>[key,field.value])),original,product.title,registration.settings,registration.categoryId);
  assert.ok(cleared.every(key=>autofill.label[key]));for(const key of cleared)autofill.label[key]='';
  const images=h.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(row=>row.object_key);
  let saved=await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:original.revision,patch:{label:{...autofill.label,model:'REVIEWED-MODEL'},labelClears:cleared,
   assets:{main:[images[0]],additional:[images[1]],detail:[images[2]],label:[images[3]]}}}}));
  for(const key of cleared){assert.equal(saved.content.label[key].value,'');assert.equal(saved.content.label[key].provenance,'manual');}
  let view=await json(await h.route(base+'/quotation-fields'));
  for(const row of view.resolved.rows)for(const id of ['manufacturer','noticeManufacturerImporter','noticeCountryOfOrigin','noticeServiceContact'])assert.equal(row.fields[id].value,'',id);
  assert.ok(view.resolved.rows.find(row=>row.included).fields.manufacturer.validationIssues.length,'required manufacturer must be reviewed, never restored silently');
  const previewBefore=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));assert.ok(previewBefore.submissionReview.issues.some(issue=>issue.kind==='error'&&issue.fieldId==='manufacturer'));
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[
   {fieldKey:'manufacturer',optionId:null,value:'7단계 확인 제조사'},
   {fieldKey:'noticeCountryOfOrigin',optionId:'collected-2',value:'7단계 개별 제조국'},
   {fieldKey:'handlingReason',optionId:null,value:'해당사항없음'},
   {fieldKey:'packagedWeightG',optionId:null,value:'420'},{fieldKey:'packagedDimensionsMm',optionId:null,value:'100*200*300'},
   {fieldKey:'storageMaterial',optionId:null,value:''},
  ]}}));
  assert.equal((await h.route(base+'/quotation',{method:'POST',body:{action:'export',fingerprint:previewBefore.fingerprint}})).status,409);
  const requests=h.network.length;await h.intake();assert.equal(h.network.length,requests);assert.equal(h.aiSources.length,1);
  saved=await json(await h.route(base+'/content'));for(const key of cleared)assert.equal(saved.content.label[key].provenance,'manual');
  const refill=h.load('app/label-autofill.ts').fillLabelDraft(Object.fromEntries(Object.entries(saved.content.label).map(([key,field])=>[key,field.value])),saved.content,product.title,registration.settings,registration.categoryId);
  for(const key of cleared)assert.equal(refill.label[key],'');
  view=await json(await h.route(base+'/quotation-fields'));const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));
  assert.equal(preview.submissionReview.errorCount,0,JSON.stringify(preview.submissionReview.issues.filter(issue=>issue.kind==='error')));
  const bundle=await h.route(base+'/quotation',{method:'POST',body:{action:'export',fingerprint:preview.fingerprint}});assert.equal(bundle.status,200,await bundle.clone().text());
  const reader=h.load('app/xlsx-template.ts'),files=await reader.readXlsxArchive(await bundle.arrayBuffer());
  const plan=JSON.parse(new TextDecoder().decode(files.get('supplier-hub-upload-plan.json'))),document=JSON.parse(new TextDecoder().decode(files.get('quotation-fields.json')));
  const sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(files.get(plan.quotation.file.filename)));
  assert.deepEqual(plan.company,{code:company.companyCode,name:company.companyName});assert.equal(preview.rows.length,6);
  for(let index=0;index<6;index++){
   const cells=reader.xlsxHeaders(sheet,'견적서',index+2),row=Object.fromEntries(fields.map((field,column)=>[field,cells[column]]));
   assert.equal(row.manufacturer,'7단계 확인 제조사');assert.equal(row.noticeCountryOfOrigin,index===1?'7단계 개별 제조국':'');
   for(const id of ['noticeManufacturerImporter','noticeServiceContact'])assert.equal(row[id],'');
   for(const id of ['manufacturer','noticeManufacturerImporter','noticeCountryOfOrigin','noticeServiceContact'])assert.equal(row[id],document.rows[index].fields[id].value);
  }
  const ui=submissionPackageUI({route:h.route,productId:product.id});await ui.click('견적서 + 첨부 파일 준비');await ui.click('확장에 첨부 파일 준비');ui.choose();await ui.click('등록 전송');
  const handoff=ui.calls.find(call=>call.action==='transmit');assert.ok(handoff);assert.deepEqual(ui.alerts(),[]);assert.deepEqual(handoff.files.company,plan.company);assert.equal(handoff.files.includedOptions,6);
  assert.deepEqual(Buffer.from(handoff.files.quotation[0].base64,'base64'),Buffer.from(files.get(plan.quotation.file.filename)));
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{h.close();}
});
