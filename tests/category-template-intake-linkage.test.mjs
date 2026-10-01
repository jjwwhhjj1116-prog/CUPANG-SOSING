import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {categoryPickerUI} from './helpers/category-picker.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {submissionPackageUI} from './helpers/submission-package-ui.mjs';

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`fresh category selection retains the owner's template through intake, edits and handoff (${company.companyCode})`,async()=>{
 const h=mobileIntakeHarness(company);
 try{
  // 80719 is an observed form test contract, not this source's commercial category.
  const fields=['skuId','categoryId',...h.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id)];
  const workbook=quotationWorkbook(fields),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
  const ownProfile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 연결 검증 '+company.companyName,categoryId:'80719',categoryPath:h.context.category.categoryPath,
   template:{name:'synthetic-'+company.companyCode+'.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},
   mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  await h.load('db/category-profiles.ts').createCategoryProfile('another-owner',{name:'다른 회사 설정',categoryId:'80719',categoryPath:h.context.category.categoryPath,template:null,mappings:[]},'foreign');
  const beforeProfiles=JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles ORDER BY id').all());
  const api=h.load('app/api/category-profiles/route.ts');
  const picker=categoryPickerUI(async(path,init)=>{
   assert.equal(init?.method,undefined,'the existing owner profile should prevent any POST');
   return api.GET(new Request('https://app.test'+path));
  });
  await picker.chooseCode('80719');assert.equal(picker.selected.length,1);assert.equal(picker.calls.length,1);
  const selected=picker.selected[0];assert.equal(selected.id,ownProfile.id);assert.equal(selected.revision,ownProfile.revision);
  assert.equal(selected.template.storageKey,storageKey);assert.equal(selected.mappings.length,fields.length);
  assert.equal(selected.template.name,'synthetic-'+company.companyCode+'.xlsx');
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles ORDER BY id').all()),beforeProfiles);
  h.context.category=selected;h.sqlite.prepare("UPDATE collection_context SET payload=? WHERE job_id='job'").run(JSON.stringify(h.context));
  await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  const images=h.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(row=>row.object_key);
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{
   seo:{title:'검토한 상품명'},label:{model:'REVIEWED-MODEL',material:'검토 재질'},
   assets:{main:[images[0]],additional:[images[1]],detail:[images[2]],label:[images[3]]},
  }}}));
  let view=await json(await h.route(base+'/quotation-fields'));
  assert.equal(view.categoryContext.profileId,selected.id);assert.equal(view.categoryContext.categoryId,'80719');
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[
   {fieldKey:'handlingReason',optionId:null,value:'해당사항없음'},
   {fieldKey:'packagedWeightG',optionId:null,value:'420'},
   {fieldKey:'packagedDimensionsMm',optionId:null,value:'100*200*300'},
   // Clear this synthetic basket form's enum; do not classify the source sunglasses.
   {fieldKey:'storageMaterial',optionId:null,value:''},
   {fieldKey:'noticeMaterial',optionId:'collected-2',value:''},
  ]}}));
  view=await json(await h.route(base+'/quotation-fields'));
  assert.equal(view.resolved.rows.find(row=>row.optionId==='collected-2').fields.noticeMaterial.value,'');
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));
  assert.equal(preview.rows.length,6);assert.equal(preview.report.profileId,selected.id);
  assert.equal(preview.submissionReview.errorCount,0,JSON.stringify(preview.submissionReview.issues.filter(issue=>issue.kind==='error')));
  const bundle=await h.route(base+'/quotation',{method:'POST',body:{action:'export',fingerprint:preview.fingerprint}});
  assert.equal(bundle.status,200,await bundle.clone().text());
  const reader=h.load('app/xlsx-template.ts'),files=await reader.readXlsxArchive(await bundle.arrayBuffer());
  const plan=JSON.parse(new TextDecoder().decode(files.get('supplier-hub-upload-plan.json')));
  assert.deepEqual(plan.company,{code:company.companyCode,name:company.companyName});assert.equal(plan.profileId,selected.id);assert.equal(plan.categoryId,'80719');
  const output=reader.inspectXlsxArchive(await reader.readXlsxArchive(files.get(plan.quotation.file.filename)));
  for(let index=0;index<6;index++){
   const cells=reader.xlsxHeaders(output,'견적서',index+2),row=Object.fromEntries(fields.map((field,column)=>[field,cells[column]]));
   assert.equal(row.categoryId,'80719');assert.equal(row.title,'검토한 상품명');assert.equal(row.noticeMaterial,index===1?'':'검토 재질');
  }
  const ui=submissionPackageUI({route:h.route,productId:product.id});
  await ui.click('견적서 + 첨부 파일 준비');await ui.click('확장에 첨부 파일 준비');ui.choose();await ui.click('등록 전송');
  const handoff=ui.calls.find(call=>call.action==='transmit');assert.ok(handoff);assert.deepEqual(ui.alerts(),[]);
  assert.equal(handoff.files.profileId,selected.id);assert.deepEqual(handoff.files.company,plan.company);assert.equal(handoff.files.includedOptions,6);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles ORDER BY id').all()),beforeProfiles);
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{h.close();}
});
