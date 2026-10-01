import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {submissionPackageUI} from './helpers/submission-package-ui.mjs';

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const categories=[
 {id:'81452',field:'brace_size',path:['스포츠/레져','헬스/요가','헬스기구/용품','헬스보호대'],binding:false},
 {id:'81221',field:'glove_fashionSize',path:['스포츠/레져','스포츠 잡화','스포츠 장갑'],binding:true},
];
const companies=[{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];

// Recorded sunglasses source and synthetic translation/image/workbook fixtures;
// these are observed form contracts, not commercial classifications or Hub uploads.
for(const company of companies)for(const category of categories)test(`${category.id} conflicting SKU size requires review before the company handoff (${company.companyCode})`,async()=>{
 const h=mobileIntakeHarness(company);
 try{
  h.context.category={...h.context.category,name:category.path.at(-1),categoryId:category.id,categoryPath:category.path};
  h.sqlite.prepare("UPDATE collection_context SET payload=? WHERE job_id='job'").run(JSON.stringify(h.context));
  await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const source=await json(await h.route(base+'/options')),rows=h.load('app/product-options.ts').optionInputs(source.options);
  const sizes=['Medium','M','L','XL','Free Size','S'];
  rows.forEach((row,index)=>{row.size=sizes[index];row.color='검정';});rows[5].included=false;
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:source.options.revision,expectedProductVersion:source.productVersion,rows}}));
  const repository=h.load('db/product-content.ts'),stored=await repository.readProductContent('owner',product.id);
  const images=h.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(row=>row.object_key);
  const next=h.load('app/product-content.ts').applyContentPatch(stored,{label:{model:'REVIEWED-MODEL'},assets:{main:[images[0]],additional:[images[1]],detail:[images[2]],label:[images[3]]}},new Date().toISOString());
  const definition=h.load('app/quotation-schema.ts').getQuotationSchema(category.id).fields.find(field=>field.id===category.field);
  // Persisted product-level translation state; deliberately distinct from SKU facts.
  next.categoryAttributes={categoryId:category.id,jobId:'synthetic-translation',hiddenAttributes:true,values:[{name:'패션잡화 사이즈',value:'M'}],
   ...(category.binding?{bindings:[{fieldId:category.field,fieldSignature:JSON.stringify(definition),value:'M'}]}:{})};
  assert.ok(await repository.saveProductContent('owner',next,stored.revision));
  let view=await json(await h.route(base+'/quotation-fields'));
  const fields=['skuId','categoryId',...view.resolved.schema.fields.map(field=>field.id)],workbook=quotationWorkbook(fields);
  const sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
  await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 사이즈 충돌 시험',categoryId:category.id,categoryPath:category.path,
   template:{name:'synthetic.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},
   mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  view=await json(await h.route(base+'/quotation-fields'));
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[
   {fieldKey:'taxType',optionId:null,value:'과세'},{fieldKey:'kcMarkType',optionId:null,value:'해당사항없음'},
   {fieldKey:'shelfLifeDays',optionId:null,value:'0'},{fieldKey:'handlingReason',optionId:null,value:'해당사항없음'},
   {fieldKey:'packagedWeightG',optionId:null,value:'420'},{fieldKey:'packagedDimensionsMm',optionId:null,value:'100*200*300'},
  ]}}));
  view=await json(await h.route(base+'/quotation-fields'));
  const unresolved=view.resolved.rows.find(row=>row.optionId==='collected-1').fields;
  assert.equal(unresolved.size.value,'Medium');assert.equal(unresolved[category.field].value,'');assert.equal(unresolved[category.field].source,'empty');
  assert.ok(unresolved[category.field].validationIssues.some(issue=>issue.includes('선택지')));
  const bad=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));
  const errors=bad.submissionReview.issues.filter(issue=>issue.kind==='error');assert.equal(errors.length,1,JSON.stringify(errors));
  assert.equal(errors[0].fieldId,category.field);assert.equal(errors[0].optionId,'collected-1');
  const ui=submissionPackageUI({route:h.route,productId:product.id,categoryId:category.id});
  await ui.click('견적서 + 첨부 파일 준비');ui.choose();assert.equal(ui.button('등록 전송').props.disabled,true);
  assert.equal(ui.calls.filter(call=>call.action==='transmit').length,0);
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[
   {fieldKey:category.field,optionId:'collected-1',value:'L'},
   {fieldKey:category.field,optionId:'collected-2',value:''},
  ]}}));
  const savedContent=JSON.stringify(h.sqlite.prepare('SELECT payload FROM product_content').get().payload),requests=h.network.length;
  assert.match(await h.intake(),/저장된 SEO·옵션값/);assert.equal(h.network.length,requests);assert.equal(h.aiSources.length,1);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT payload FROM product_content').get().payload),savedContent);
  const good=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));
  assert.equal(good.submissionReview.errorCount,0);assert.equal(good.rows.length,5);
  const response=await h.route(base+'/quotation',{method:'POST',body:{action:'export',fingerprint:good.fingerprint}});
  assert.equal(response.status,200,await response.clone().text());
  const reader=h.load('app/xlsx-template.ts'),files=await reader.readXlsxArchive(await response.arrayBuffer());
  const plan=JSON.parse(new TextDecoder().decode(files.get('supplier-hub-upload-plan.json')));
  const sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(files.get(plan.quotation.file.filename)));
  for(let index=0;index<5;index++){
   const cells=reader.xlsxHeaders(sheet,'견적서',index+2),row=Object.fromEntries(fields.map((field,column)=>[field,cells[column]]));
   assert.equal(row.categoryId,category.id);assert.equal(row.size,sizes[index]);assert.equal(row[category.field],index===0?'L':index===1?'':sizes[index]);
  }
  ui.remount();await ui.click('견적서 + 첨부 파일 준비');await ui.click('확장에 첨부 파일 준비');ui.choose();await ui.click('등록 전송');
  const handoff=ui.calls.find(call=>call.action==='transmit');assert.ok(handoff);assert.deepEqual(ui.alerts(),[]);
  assert.equal(handoff.files.categoryId,category.id);assert.equal(handoff.files.includedOptions,5);
  assert.deepEqual(handoff.files.company,{code:company.companyCode,name:company.companyName});
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{h.close();}
});
