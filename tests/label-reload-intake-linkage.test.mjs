import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {quotationLabelFormUI} from './helpers/quotation-label-form-ui.mjs';
import {submissionPackageUI} from './helpers/submission-package-ui.mjs';

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64');
for(const flow of ['upload-response','attached-response','saved-response','complete'])for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test('persisted option labels survive page reopening ('+flow+' / '+company.companyCode+')',async()=>{
 const h=mobileIntakeHarness(company);let ui;
 try{
  // Recorded sunglasses facts; 80719 is an observed form contract, not their
  // commercial classification. Workbook, PNG rendering and Hub transport are fixtures.
  const fields=['skuId','categoryId',...h.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id)];
  const workbook=quotationWorkbook(fields),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
  await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'페이지 재접속 라벨 연동 시험',categoryId:'80719',categoryPath:h.context.category.categoryPath,
   template:{name:'synthetic.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,endpoint=base+'/quotation-fields';
  const images=h.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(row=>row.object_key);
  const content=await json(await h.route(base+'/content'));
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.content.revision,patch:{label:{model:'LABEL-MODEL'},assets:{main:[images[0]],additional:[images[1]],detail:[images[2]],label:[images[3]]}}}}));
  let view=await json(await h.route(endpoint));
  await json(await h.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[
   {fieldKey:'handlingReason',optionId:null,value:'해당사항없음'},
   {fieldKey:'packagedWeightG',optionId:null,value:'420'},{fieldKey:'packagedDimensionsMm',optionId:null,value:'100*200*300'},
   {fieldKey:'storageMaterial',optionId:null,value:''},
  ]}}));
  const get=h.bindings.FILES.get;
  h.bindings.FILES.get=async(key,options)=>{const object=await get(key);if(!object)return null;const bytes=new Uint8Array(await object.arrayBuffer());return{...object,body:new Response(bytes.slice(0,options?.range?.length??bytes.length)).body};};


  const calls=[],plans=[];let failed=false;
  const request=async(path,init={})=>{
   const response=path==='/api/files'?await h.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:init.body})):await h.route(path,{method:init.method??'GET',...(typeof init.body==='string'?{body:JSON.parse(init.body)}:{})});
   const body=typeof init.body==='string'?JSON.parse(init.body):null;calls.push({path,method:init.method??'GET',status:response.status,body});
   if(!failed&&((flow==='upload-response'&&path==='/api/files')||(flow==='attached-response'&&path.endsWith('/attachments'))||(flow==='saved-response'&&path===endpoint&&init.method==='PUT'&&body.changes[0].fieldKey==='labelImages'))){failed=true;throw Error('reload label response lost');}
   return response;
  };
  const open=()=>quotationLabelFormUI({productId:product.id,load:h.load,request,renderDocument:async plan=>{plans.push(plan);return{blob:new Blob([png,JSON.stringify(plan)],{type:'image/png'}),width:1200,height:1200};}});
  ui=open();await ui.idle();
  await ui.click('저장된 견적 값으로 PNG 미리보기');await ui.click('PNG 업로드·선택 옵션 견적에 연결');
  assert.equal(failed,flow!=='complete');
  ui.close();ui=open();await ui.idle();await ui.click('전체 포함 옵션 라벨 생성·연결');
  assert.equal(calls.filter(call=>call.path==='/api/files').length,6,'reopening loses memory but recovers the persisted first upload');
  assert.equal(plans.length,6,'reopening a partial label does not render its saved PNG again in the batch');
  const initialLabels=ui.view.resolved.rows.filter(row=>row.included).map(row=>row.fields.labelImages.value.split('\n'));
  assert.ok(initialLabels.every(keys=>keys.length===2&&keys[0]===images[3]));assert.equal(new Set(initialLabels.map(keys=>keys[1])).size,6);
  ui.close();ui=open();await ui.idle();
  const price=ui.field('salePrice');price.props.onChange({target:{value:'20000'}});await ui.click('견적 입력 저장');await ui.click('전체 포함 옵션 라벨 생성·연결');
  assert.equal(calls.filter(call=>call.path==='/api/files').length,6);assert.equal(plans.length,6,'fresh form and price edit reuse all six server files');
  const model=ui.field('model');model.props.onChange({target:{value:'REVISED-LABEL'}});await ui.click('견적 입력 저장');await ui.click('전체 포함 옵션 라벨 생성·연결');
  assert.equal(calls.filter(call=>call.path==='/api/files').length,7);assert.equal(plans.length,7,'changed option only gets a new persisted file');
  ui.close();ui=open();await ui.idle();await ui.click('전체 포함 옵션 라벨 생성·연결');
  assert.equal(calls.filter(call=>call.path==='/api/files').length,7);assert.equal(plans.length,7);
  const labels=ui.view.resolved.rows.filter(row=>row.included).map(row=>row.fields.labelImages.value.split('\n'));
  assert.deepEqual(labels[0].slice(0,2),initialLabels[0]);assert.equal(labels[0].length,3);assert.deepEqual(labels.slice(1),initialLabels.slice(1));
  assert.deepEqual(ui.alerts(),[]);assert.equal(calls.some(call=>call.status===409),false);
  const sourceRequests=h.network.length;await h.intake();assert.equal(h.network.length,sourceRequests);assert.equal(h.aiSources.length,1);
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));
  assert.equal(preview.submissionReview.errorCount,0,JSON.stringify(preview.submissionReview.issues.filter(issue=>issue.kind==='error')));
  const bundle=await h.route(base+'/quotation',{method:'POST',body:{action:'export',fingerprint:preview.fingerprint}});assert.equal(bundle.status,200,await bundle.clone().text());
  const reader=h.load('app/xlsx-template.ts'),files=await reader.readXlsxArchive(await bundle.arrayBuffer());
  const plan=JSON.parse(new TextDecoder().decode(files.get('supplier-hub-upload-plan.json')));
  const document=JSON.parse(new TextDecoder().decode(files.get('quotation-fields.json')));
  const sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(files.get(plan.quotation.file.filename)));
  for(let index=0;index<6;index++){
   const cells=reader.xlsxHeaders(sheet,'견적서',index+2),row=Object.fromEntries(fields.map((field,column)=>[field,cells[column]]));
   assert.equal(row.labelImages,labels[index].map(key=>document.uploadFilenames[key]).join('\n'));
   if(index===0)assert.equal(row.salePrice,'20000');
  }
  const submission=submissionPackageUI({route:h.route,productId:product.id});await submission.click('견적서 + 첨부 파일 준비');submission.choose();await submission.click('등록 전송');
  const sent=submission.calls.find(call=>call.action==='transmit');assert.ok(sent);assert.deepEqual(submission.alerts(),[]);
  assert.deepEqual(sent.files.company,{code:company.companyCode,name:company.companyName});assert.equal(sent.files.includedOptions,6);
  assert.deepEqual(Buffer.from(sent.files.quotation[0].base64,'base64'),Buffer.from(files.get(plan.quotation.file.filename)));
  assert.equal(sent.files.labelImages.length,8,'one existing label, six initial option labels and one changed option label');
  assert.deepEqual(sent.files.labelImages.map(file=>file.name).sort(),plan.labelImages.map(file=>file.filename).sort());
  for(const image of sent.files.labelImages)assert.deepEqual(Buffer.from(image.base64,'base64'),Buffer.from(files.get(plan.labelImages.find(item=>item.filename===image.name).archivePath)));
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{ui?.close();h.close();}
});
