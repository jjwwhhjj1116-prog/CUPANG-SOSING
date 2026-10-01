import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {prepareAttachments,readPackageZip} from '../extensions/supplier-hub/package.mjs';
import {transmitSupplierHubPackage} from '../extensions/supplier-hub/transmit.mjs';

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const decode=bytes=>JSON.parse(new TextDecoder().decode(bytes));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test('edited URL draft binds actual exported Excel/product/label bytes before delivery ('+company.companyCode+')',async()=>{
 const h=mobileIntakeHarness(company);
 try{
  // Recorded source facts and observed 80719 form contract, not an actual
  // sunglasses category or production Hub submission. Auth/AI/media are fixtures.
  const fields=['skuId','categoryId',...h.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id)];
  const workbook=quotationWorkbook(fields),digest=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const storageKey=h.load('db/category-templates.ts').templateKey('owner',digest,'xlsx');h.objects.set(storageKey,workbook);
  await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'견적 첨부 바이트 대조 시험',categoryId:'80719',categoryPath:h.context.category.categoryPath,
   template:{name:'synthetic.xlsx',format:'xlsx',sha256:digest,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const images=h.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(row=>row.object_key);
  const content=await json(await h.route(base+'/content'));
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.content.revision,patch:{label:{model:'EDITED-MODEL'},assets:{main:[images[0]],additional:[images[1]],detail:[images[2]],label:[images[3]]}}}}));
  const view=await json(await h.route(base+'/quotation-fields'));
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[
   {fieldKey:'handlingReason',optionId:null,value:'해당사항없음'},{fieldKey:'packagedWeightG',optionId:null,value:'420'},
   {fieldKey:'packagedDimensionsMm',optionId:null,value:'100*200*300'},{fieldKey:'storageMaterial',optionId:null,value:''},
   {fieldKey:'salePrice',optionId:null,value:'20000'},
  ]}}));
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));
  assert.equal(preview.submissionReview.errorCount,0,JSON.stringify(preview.submissionReview.issues));
  const response=await h.route(base+'/quotation',{method:'POST',body:{action:'export',fingerprint:preview.fingerprint}});
  assert.equal(response.status,200,await response.clone().text());
  const bytes=new Uint8Array(await response.arrayBuffer()),files=readPackageZip(bytes),plan=decode(files.get('supplier-hub-upload-plan.json'));
  const prepared=await prepareAttachments(bytes);
  assert.deepEqual(prepared.company,{code:company.companyCode,name:company.companyName});assert.equal(prepared.includedOptions,6);
  assert.equal(plan.productImages.length,3);assert.equal(plan.labelImages.length,1);
  for(const item of [plan.quotation.file,...plan.productImages,...plan.labelImages]){
   const data=files.get(item.archivePath??item.filename);assert.equal(item.byteLength,data.byteLength);assert.equal(item.sha256,sha256(data));
  }
  for(const role of ['productImages','labelImages'])for(const item of plan[role]){
   assert.deepEqual(Buffer.from(prepared[role].find(file=>file.name===item.filename).base64,'base64'),Buffer.from(files.get(item.archivePath)));
  }
  const reader=h.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(files.get(plan.quotation.file.filename)));
  for(let index=0;index<6;index++)assert.equal(reader.xlsxHeaders(sheet,'견적서',index+2)[fields.indexOf('salePrice')],'20000');
  const archive=h.load('app/exports/zip.ts').zipFiles;
  const identity={productId:product.id,categoryId:'80719',fingerprint:preview.fingerprint};
  const sender={tab:{id:7,windowId:17},frameId:0,url:'https://sourceflow.jjwwhhjj1116.workers.dev/'};
  for(const role of ['productImages','labelImages']){
   const changed=files.get(plan[role][0].archivePath).slice();changed[changed.length-1]^=1;
   const substituted=new Uint8Array(archive([...files].map(([name,data])=>({name,data:name===plan[role][0].archivePath?changed:data}))));
   assert.ok(readPackageZip(substituted),'the repacked archive is structurally intact');
   const unexpected=()=>assert.fail('changed images must fail before any browser or transmission storage operation');
   await assert.rejects(transmitSupplierHubPackage({...identity,type:'YOOFAM_TRANSMIT_PACKAGE',base64:Buffer.from(substituted).toString('base64'),reviewedAgreements:{priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:true}},sender,
    {tabs:{get:unexpected,query:unexpected},scripting:{executeScript:unexpected}},unexpected),/이미지.*변경/);
  }
  // The archive check is read-only and does not invalidate or change the draft.
  const source=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'source'}}));assert.equal(source.fingerprint,preview.fingerprint);
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{h.close();}
});
