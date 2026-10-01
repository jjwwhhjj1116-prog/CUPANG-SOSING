import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {quotationLabelFormUI} from './helpers/quotation-label-form-ui.mjs';
import {submissionPackageUI} from './helpers/submission-package-ui.mjs';

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64');
for(const failure of ['saved-response','attached-response','attachment-rejected','read-recovery'])for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test('single option label recovery keeps the reviewed PNG across saved-view remounts ('+failure+' / '+company.companyCode+')',async()=>{
 const h=mobileIntakeHarness(company);let ui;
 try{
  // Recorded sunglasses facts; 80719 is an observed form contract, not their
  // commercial classification. Workbook, PNG rendering and Hub transport are fixtures.
  const fields=['skuId','categoryId',...h.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id)];
  const workbook=quotationWorkbook(fields),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
  await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'단일 라벨 복구 연동 시험',categoryId:'80719',categoryPath:h.context.category.categoryPath,
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
  const calls=[],plans=[];let failed=false,recoveryReadFailures=0;
  const request=async(path,init={})=>{
   if(path===endpoint&&!init.method&&failed&&failure==='read-recovery'&&recoveryReadFailures<2){recoveryReadFailures++;return Response.json({error:'single recovery read unavailable'},{status:503});}
   if(!failed&&path.endsWith('/attachments')&&failure==='attachment-rejected'){failed=true;calls.push({path,method:'POST',status:503,body:JSON.parse(init.body)});return Response.json({error:'single attachment rejected'},{status:503});}
   const response=path==='/api/files'?await h.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:init.body})):await h.route(path,{method:init.method??'GET',...(typeof init.body==='string'?{body:JSON.parse(init.body)}:{})});
   const body=typeof init.body==='string'?JSON.parse(init.body):null;calls.push({path,method:init.method??'GET',status:response.status,body});
   if(!failed&&((path===endpoint&&init.method==='PUT'&&body.changes[0].fieldKey==='labelImages'&&failure!=='attached-response')||(path.endsWith('/attachments')&&failure==='attached-response'))){failed=true;throw new Error('single saved response lost');}
   return response;
  };
  ui=quotationLabelFormUI({productId:product.id,load:h.load,request,renderDocument:async plan=>{plans.push(plan);return{blob:new Blob([png,JSON.stringify(plan)],{type:'image/png'}),width:1200,height:1200};}});
  await ui.idle();const before=ui.view;
  await ui.click('저장된 견적 값으로 PNG 미리보기');await ui.click('PNG 업로드·선택 옵션 견적에 연결');
  assert.equal(failed,true);assert.equal(ui.savedNotifications,1,'single failure also invalidates stale quotation previews');
  assert.ok(ui.alerts().some(message=>message.includes(failure==='attachment-rejected'?'single attachment rejected':'single saved response lost')));
  if(failure==='read-recovery'){
   assert.equal(recoveryReadFailures,1);assert.equal(ui.view.revision,before.revision);assert.equal(ui.fieldDisabled('salePrice'),true);
   await ui.click('기본값 다시 반영');assert.equal(recoveryReadFailures,2);assert.equal(ui.fieldDisabled('salePrice'),true);
   assert.ok(ui.alerts().some(message=>message.includes('single saved response lost')&&message.includes('single recovery read unavailable')));
   await ui.click('기본값 다시 반영');
  }
  assert.equal(ui.view.revision,before.revision+(['attached-response','attachment-rejected'].includes(failure)?0:1));
  if(failure==='attachment-rejected')assert.equal(ui.view.inputFingerprint,before.inputFingerprint);else assert.notEqual(ui.view.inputFingerprint,before.inputFingerprint);
  const price=ui.field('salePrice');price.props.onChange({target:{value:'20000'}});await ui.click('견적 입력 저장');assert.deepEqual(ui.alerts(),[]);
  await ui.click('저장된 견적 값으로 PNG 미리보기');await ui.click('PNG 업로드·선택 옵션 견적에 연결');
  assert.equal(plans.length,1,'reviewed PNG is reused after an unrelated price edit and panel remount');
  assert.equal(calls.filter(call=>call.path==='/api/files').length,1);assert.equal(calls.filter(call=>call.path.endsWith('/attachments')).length,failure==='attachment-rejected'?2:1);
  assert.equal(calls.filter(call=>call.method==='PUT'&&call.body.changes[0].fieldKey==='labelImages').length,1);
  const oldLabel=ui.view.resolved.rows.find(row=>row.optionId==='collected-1').fields.labelImages.value.split('\n')[1];assert.ok(oldLabel);
  const model=ui.field('model');model.props.onChange({target:{value:'REVISED-LABEL'}});await ui.click('견적 입력 저장');
  await ui.click('저장된 견적 값으로 PNG 미리보기');await ui.click('PNG 업로드·선택 옵션 견적에 연결');
  assert.equal(plans.length,2,'changed PNG contents invalidate the old reviewed file');
  assert.equal(calls.filter(call=>call.path==='/api/files').length,2);assert.equal(calls.filter(call=>call.path.endsWith('/attachments')).length,failure==='attachment-rejected'?3:2);
  assert.equal(calls.some(call=>call.status===409),false);
  const labels=ui.view.resolved.rows.filter(row=>row.included).map(row=>row.fields.labelImages.value.split('\n'));
  assert.equal(labels[0].length,3);assert.equal(labels[0][0],images[3]);assert.equal(labels[0][1],oldLabel);assert.notEqual(labels[0][2],oldLabel);
  assert.ok(labels.slice(1).every(keys=>keys.length===1&&keys[0]===images[3]));
  await ui.click('저장된 견적 값으로 PNG 미리보기');await ui.click('PNG 업로드·선택 옵션 견적에 연결');
  assert.equal(plans.length,2);assert.equal(calls.filter(call=>call.path==='/api/files').length,2);assert.deepEqual(ui.alerts(),[]);
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
  assert.equal(sent.files.labelImages.length,3,'one existing label and exactly two reviewed versions of the first option');
  assert.deepEqual(sent.files.labelImages.map(file=>file.name).sort(),plan.labelImages.map(file=>file.filename).sort());
  for(const image of sent.files.labelImages)assert.deepEqual(Buffer.from(image.base64,'base64'),Buffer.from(files.get(plan.labelImages.find(item=>item.filename===image.name).archivePath)));
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{ui?.close();h.close();}
});
