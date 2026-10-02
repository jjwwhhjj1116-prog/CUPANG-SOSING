import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {readPackageZip,prepareAttachments} from '../extensions/supplier-hub/package.mjs';
import {attachToSupplierHub} from '../extensions/supplier-hub/attach.mjs';
import {requestSupplierHubValidation} from '../extensions/supplier-hub/validate.mjs';
import {transmitSupplierHubPackage} from '../extensions/supplier-hub/transmit.mjs';

// Synthetic binary PDF with non-UTF8 bytes. It proves exact bytes and transport,
// never a certification, authentic account, commercial category or Hub receipt.
const pdf=Buffer.concat([Buffer.from('%PDF-1.7\n%'),Buffer.from([255,254,253]),Buffer.from('\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n')]);
const plain=value=>JSON.parse(JSON.stringify(value));
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
async function setup(company={companyCode:'A01464742',companyName:'와이홉'}){
 const h=mobileIntakeHarness(company);h.bindings.FILES.delete=async key=>h.objects.delete(key);
 const fields=['skuId','categoryId',...h.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id)],workbook=quotationWorkbook(fields),digest=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex'),storageKey=h.load('db/category-templates.ts').templateKey('owner',digest,'xlsx');h.objects.set(storageKey,workbook);
 await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'서류 전송 시험',categoryId:'80719',categoryPath:h.context.category.categoryPath,template:{name:'synthetic.xlsx',format:'xlsx',sha256:digest,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
 await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
 const images=h.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(row=>row.object_key),content=await json(await h.route(base+'/content'));
 await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.content.revision,patch:{label:{model:'EDITED-MODEL'},assets:{main:[images[0]],additional:[images[1]],detail:[images[2]],label:[images[3]]}}}}));
 const view=await json(await h.route(base+'/quotation-fields'));
 await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:'handlingReason',optionId:null,value:'해당사항없음'},{fieldKey:'packagedWeightG',optionId:null,value:'420'},{fieldKey:'packagedDimensionsMm',optionId:null,value:'100*200*300'},{fieldKey:'storageMaterial',optionId:null,value:''},{fieldKey:'salePrice',optionId:null,value:'20000'}]}}));
 const api=h.load('app/api/products/[id]/legal-documents/route.ts'),context={params:Promise.resolve({id:product.id})};
 const request=(method,body,origin)=>api[method](new Request('https://app.test'+base+'/legal-documents',{method,...(body instanceof FormData?{body}:{...(body?{body:JSON.stringify(body)}:{}),headers:{'content-type':'application/json',...(origin?{origin}:{})}})}),context);
 const upload=(revision,bytes=pdf,name='시험 인증서.pdf')=>{const form=new FormData();form.set('expectedRevision',String(revision));form.set('file',new File([bytes],name));return request('POST',form);};
 return {h,base,product,api,context,request,upload};
}
function page(company,{selected=false,occupied=false}={}){
 const events=[],dataset={},titles=['작성이 완료된 견적서 Excel 파일을 업로드하십시오.','상품 이미지를 업로드하십시오.','제품 필수 표시사항을 업로드하십시오.'];
 const inputs=titles.map((title,index)=>({files:[],isConnected:true,disabled:false,closest:()=>null,parentElement:{innerText:title,querySelectorAll:()=>[{}]},dispatchEvent(){events.push(index);}}));
 const legalFile={files:occupied?[{name:'existing.pdf'}]:[],isConnected:true,disabled:false,closest:()=>null,dispatchEvent(){events.push('legal-file');}};
 const area={get innerText(){return '상품 개별법령에 따른 필수 서류\n'+Array.from(legalFile.files,file=>file.name).join('\n');},parentElement:null,querySelectorAll(selector){return selector.includes('radio')?[radio,{}]:radio.checked?[legalFile]:[];}};
 const radio={checked:selected,disabled:false,labels:[{innerText:'해당함'}],parentElement:area,click(){events.push('legal-yes');this.checked=true;}};
 const checkboxes=[{checked:false,disabled:false,labels:[{innerText:'제공된 권장소비자가격 또는 공식 판매처 가격 데이터에 대한 쿠팡 약관에 동의합니다.'}],click(){this.checked=true;events.push('price');}},{checked:false,disabled:false,labels:[{innerText:'상품 라벨 내 기재된 (010 이하) 연락처는 법인 명의 개통 번호이거나, 해당 브랜드의 공식 대외 창구로 지정된 업무용 연락처에 해당함을 확인하며, 당사는 해당 정보가 대외적으로 공개됨에 동의합니다.'}],click(){this.checked=true;events.push('contact');}}];
 const button={innerText:'파일 검증하기',disabled:false,getClientRects:()=>[{}],getAttribute:()=>null,click(){events.push('validate');}};
 const document={body:{get innerText(){return `Company Code: ${company.code}\n`+[...inputs,legalFile].flatMap(input=>Array.from(input.files,file=>file.name)).join('\n');}},documentElement:{dataset},querySelectorAll(selector){if(selector==='input[type="file"]')return [...inputs,...(radio.checked?[legalFile]:[])];if(selector.includes('undefined-Y'))return [radio];if(selector.includes('msrpAgreement'))return [checkboxes[0]];if(selector.includes('labelContactAgreement'))return [checkboxes[1]];if(selector==='button')return [button];return [];}};
 class Transfer{constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}}
 const context={document,location:{origin:'https://supplier.coupang.com',pathname:'/qvt/registration'},DataTransfer:Transfer,File,Event,Uint8Array,atob,setTimeout};
 const run=(func,args)=>vm.runInNewContext(`(${func.toString()})(...args)`,{...context,args});
 return {run,events,inputs,legalFile,radio,area,dataset};
}
for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test('reviewed 6-option URL draft carries private original legal PDF through real export and extension dispatch: '+company.companyCode,async()=>{
 const f=await setup(company),{h}=f;try{
  const before=await json(await h.route(f.base+'/quotation',{method:'POST',body:{action:'preview'}})),list=await json(await f.request('GET'));
  const saved=await json(await f.upload(list.revision),201);assert.equal(saved.documents.applicability,'required');assert.equal(saved.documents.files.length,1);assert.equal(saved.revision,list.revision+1);
  const file=saved.documents.files[0];assert.deepEqual(Buffer.from(h.objects.get(file.key)),pdf);assert.ok(file.key.startsWith('owner/legal/'+f.product.id+'/'));
  const download=await f.api.GET(new Request('https://app.test'+f.base+'/legal-documents?key='+encodeURIComponent(file.key)),f.context);assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),pdf);assert.match(download.headers.get('content-disposition'),/attachment/);
  assert.equal((await h.route(f.base+'/quotation',{method:'POST',body:{action:'export',fingerprint:before.fingerprint}})).status,409);
  const preview=await json(await h.route(f.base+'/quotation',{method:'POST',body:{action:'preview'}}));assert.notEqual(preview.fingerprint,before.fingerprint);assert.equal(preview.submissionReview.errorCount,0);assert.deepEqual(preview.report.legalDocuments,{applicability:'required',count:1});
  const exportResponse=await h.route(f.base+'/quotation',{method:'POST',body:{action:'export',fingerprint:preview.fingerprint}});assert.equal(exportResponse.status,200);const zip=new Uint8Array(await exportResponse.arrayBuffer()),files=readPackageZip(zip),prepared=await prepareAttachments(zip),plan=JSON.parse(new TextDecoder().decode(files.get('supplier-hub-upload-plan.json')));
  assert.equal(prepared.legalDocumentsRequired,true);assert.equal(prepared.includedOptions,6);assert.deepEqual(Buffer.from(prepared.legalDocuments[0].base64,'base64'),pdf);assert.deepEqual(Buffer.from(files.get(plan.legalDocuments.files[0].archivePath)),pdf);
  const snapshot=JSON.stringify(h.sqlite.prepare('SELECT * FROM product_quotation_fields').all()),p=page(prepared.company),records=new Map(),identity={productId:f.product.id,categoryId:'80719',fingerprint:preview.fingerprint},sender={tab:{id:7,windowId:17},frameId:0,url:'https://sourceflow.jjwwhhjj1116.workers.dev/'};
  const api={tabs:{query:async()=>[{id:123,windowId:17,url:'https://supplier.coupang.com/qvt/registration'}],get:async id=>({id,windowId:17,url:id===7?sender.url:'https://supplier.coupang.com/qvt/registration'}),sendMessage:async(_id,message)=>({ok:true,...message.expected,...(message.type==='YOOFAM_READ_TRANSMISSION_RECEIPT'?{receipt:null}:{}),checkedAt:Date.now()})},scripting:{executeScript:async({func,args})=>[{result:await p.run(func,args)}]}};
  const store=async(action,key,value)=>{if(action==='get')return records.get(key)??null;if(action==='claim'){if(records.has(key))return false;records.set(key,value);return true;}records.set(key,value);return value;};
  const message={...identity,type:'YOOFAM_TRANSMIT_PACKAGE',base64:Buffer.from(zip).toString('base64'),reviewedAgreements:{priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:false,legalDocumentsRequired:true}};
  const result=await transmitSupplierHubPackage(message,sender,api,store);assert.equal(result.state,'validation-requested');assert.equal(result.registered,false);assert.deepEqual(p.events,['legal-yes',0,1,2,'legal-file','price','contact','validate']);assert.deepEqual(Buffer.from(await p.legalFile.files[0].arrayBuffer()),pdf);assert.equal(p.legalFile.files[0].type,'application/pdf');
  await assert.rejects(transmitSupplierHubPackage(message,sender,api,store),/이미 전송/);assert.equal(p.events.filter(event=>event==='validate').length,1);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM product_quotation_fields').all()),snapshot);assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');assert.equal(h.network.some(url=>url.includes('supplier.coupang.com')),false);
 }finally{h.close();}
});
test('legal evidence edits are revision-bound, owner scoped, preserve stored files and invalidate old review',async()=>{
 const f=await setup(),{h}=f;try{
  const initial=await json(await f.request('GET')),one=await json(await f.upload(initial.revision),201),key=one.documents.files[0].key;
  const size=h.objects.size;await json(await f.upload(initial.revision),409);assert.equal(h.objects.size,size);
  await json(await f.request('PATCH',{expectedRevision:one.revision,removeKey:'other/legal/evidence.pdf'}),404);
  await json(await f.request('PATCH',{expectedRevision:one.revision,applicability:'required'},'https://evil.test'),403);
  await json(await f.upload(one.revision,Buffer.from('<script>bad</script>'),'bad.pdf'),400);
  const missing=await f.api.GET(new Request('https://app.test'+f.base+'/legal-documents?key='+encodeURIComponent('another/legal/'+f.product.id+'/file.pdf')),f.context);assert.equal(missing.status,404);
  const removed=await json(await f.request('PATCH',{expectedRevision:one.revision,removeKey:key}));assert.equal(removed.documents.applicability,'required');assert.equal(removed.documents.files.length,0);assert.deepEqual(Buffer.from(h.objects.get(key)),pdf);
  const preview=await json(await h.route(f.base+'/quotation',{method:'POST',body:{action:'preview'}}));assert.ok(preview.submissionReview.issues.some(issue=>issue.code==='LEGAL_DOCUMENT_MISSING'));
  await json(await f.request('PATCH',{expectedRevision:removed.revision,applicability:'not-applicable'}));
  const exempt=await json(await h.route(f.base+'/quotation',{method:'POST',body:{action:'preview'}}));assert.equal(exempt.submissionReview.issues.some(issue=>issue.code==='LEGAL_DOCUMENT_MISSING'),false);
 }finally{h.close();}
});

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test('registration precheck and workbook preview retain the same explicit required-document error: '+company.companyCode,async()=>{
 const f=await setup(company),{h}=f;try{
  const initial=await json(await f.request('GET'));
  const required=await json(await f.request('PATCH',{expectedRevision:initial.revision,applicability:'required'}));
  const snapshot=JSON.stringify(h.sqlite.prepare('SELECT * FROM product_content').all());
  const review=await json(await h.route(f.base+'/submission-review'));
  const preview=await json(await h.route(f.base+'/quotation',{method:'POST',body:{action:'preview'}}));
  const missing=preview.submissionReview.issues.filter(issue=>issue.code==='LEGAL_DOCUMENT_MISSING');
  assert.equal(missing.length,1);assert.equal(missing[0].kind,'error');assert.equal(preview.submissionReview.errorCount,1);
  assert.deepEqual(review.issues.filter(issue=>issue.code==='LEGAL_DOCUMENT_MISSING'),missing);
  assert.equal(review.errorCount,1);assert.equal(review.submissionReady,false);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM product_content').all()),snapshot,'inspection preserves manually reviewed content and document choice');
  const uploaded=await json(await f.upload(required.revision),201);
  const complete=await json(await h.route(f.base+'/submission-review'));
  assert.equal(complete.issues.some(issue=>issue.code==='LEGAL_DOCUMENT_MISSING'),false);
  assert.equal(complete.errorCount,0);assert.notEqual(complete.fingerprint,review.fingerprint);
  const removed=await json(await f.request('PATCH',{expectedRevision:uploaded.revision,removeKey:uploaded.documents.files[0].key}));
  assert.equal((await json(await h.route(f.base+'/submission-review'))).issues.filter(issue=>issue.code==='LEGAL_DOCUMENT_MISSING').length,1);
  await json(await f.request('PATCH',{expectedRevision:removed.revision,applicability:'not-applicable'}));
  const exempt=await json(await h.route(f.base+'/submission-review'));
  assert.equal(exempt.issues.some(issue=>issue.code==='LEGAL_DOCUMENT_MISSING'),false);assert.equal(exempt.errorCount,0);
  assert.deepEqual(Buffer.from(h.objects.get(uploaded.documents.files[0].key)),pdf,'excluding a reference preserves original evidence bytes');
 }finally{h.close();}
});
test('required evidence rejects changed bytes and exemption choice before any Chrome request or storage claim',async()=>{
 const f=await setup(),{h}=f;try{
  const saved=await json(await f.upload((await json(await f.request('GET'))).revision),201),key=saved.documents.files[0].key;
  const preview=await json(await h.route(f.base+'/quotation',{method:'POST',body:{action:'preview'}})),response=await h.route(f.base+'/quotation',{method:'POST',body:{action:'export',fingerprint:preview.fingerprint}}),zip=new Uint8Array(await response.arrayBuffer()),files=readPackageZip(zip),plan=JSON.parse(new TextDecoder().decode(files.get('supplier-hub-upload-plan.json'))),documentPath=plan.legalDocuments.files[0].archivePath;
  const changed=files.get(documentPath).slice();changed[12]^=1;
  const repacked=new Uint8Array(h.load('app/exports/zip.ts').zipFiles([...files].map(([name,data])=>({name,data:name===documentPath?changed:data}))));assert.ok(readPackageZip(repacked));await assert.rejects(prepareAttachments(repacked),/서류.*변경/);
  const fail=()=>assert.fail('No Chrome request or claim before evidence review passes'),sender={tab:{id:7,windowId:17},frameId:0,url:'https://sourceflow.jjwwhhjj1116.workers.dev/'},message={type:'YOOFAM_TRANSMIT_PACKAGE',productId:f.product.id,categoryId:'80719',fingerprint:preview.fingerprint,base64:Buffer.from(zip).toString('base64'),reviewedAgreements:{priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:true}};
  await assert.rejects(transmitSupplierHubPackage(message,sender,{tabs:{get:fail,query:fail},scripting:{executeScript:fail}},fail),/해당 여부/);
  h.objects.set(key,changed);assert.equal((await h.route(f.base+'/quotation',{method:'POST',body:{action:'preview'}})).status,409);
 }finally{h.close();}
});
test('required document preflight preserves occupied form and validation rejects wrong section or missing uploaded evidence',async()=>{
 const payload={company:{code:'A01464742',name:'와이홉'},quotation:[{name:'a.xlsx',base64:Buffer.from('PK').toString('base64')}],productImages:[],labelImages:[],legalDocumentsRequired:true,legalDocuments:[{name:'legal-001.pdf',base64:pdf.toString('base64')}]};
 const occupied=page(payload.company,{selected:true,occupied:true});assert.equal(occupied.run(attachToSupplierHub,[payload,true]).state,'occupied');assert.deepEqual(occupied.events,[]);assert.equal(occupied.legalFile.files[0].name,'existing.pdf');
 const p=page(payload.company);assert.equal(p.run(attachToSupplierHub,[payload,true]).state,'ready');assert.equal(p.radio.checked,false);assert.deepEqual(p.events,[]);
 assert.equal((await p.run(attachToSupplierHub,[payload])).state,'dispatched');p.legalFile.files=[];
 assert.throws(()=>p.run(requestSupplierHubValidation,[{priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:false,legalDocumentsRequired:true}]),/파일.*표시/);assert.ok(!p.events.includes('validate'));
});
test('original evidence cannot be bound to another product or forged by generic content patches',async()=>{
 const f=await setup(),{h}=f;try{
  const saved=await json(await f.upload((await json(await f.request('GET'))).revision),201),model=h.load('app/legal-documents.ts');
  assert.throws(()=>model.readLegalDocuments(plain(saved.documents),'another',f.product.id),/소유자/);assert.throws(()=>model.readLegalDocuments(plain(saved.documents),'owner','other'),/소유자/);
  const nested=plain(saved.documents);nested.files[0].key=nested.files[0].key.replace('/legal/'+f.product.id+'/','/legal/'+f.product.id+'/../other/');assert.throws(()=>model.readLegalDocuments(nested,'owner',f.product.id),/소유자/);
  const generic=await h.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:saved.revision,patch:{legalDocuments:saved.documents}}});assert.equal(generic.status,400);
  assert.equal((await f.api.GET(new Request('https://app.test/api/products/other/legal-documents'),{params:Promise.resolve({id:'other'})})).status,404);
 }finally{h.close();}
});

test('concurrent content editing rejects stale legal upload, removes only its uncommitted bytes and preserves manual data',async()=>{
 const f=await setup(),{h}=f;try{
  const one=await json(await f.upload((await json(await f.request('GET'))).revision),201),original=one.documents.files[0],put=h.bindings.FILES.put;
  h.bindings.FILES.put=async(...args)=>{const result=await put(...args);await json(await h.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:one.revision,patch:{label:{model:'CONCURRENT-MODEL'}}}}));return result;};
  await json(await f.upload(one.revision,pdf,'second.pdf'),409);
  const content=(await json(await h.route(f.base+'/content'))).content;
  assert.equal(content.label.model.value,'CONCURRENT-MODEL');assert.equal(content.label.model.provenance,'manual');assert.deepEqual(content.legalDocuments.files,[original]);
  assert.deepEqual([...h.objects.keys()].filter(key=>key.startsWith('owner/legal/')),[original.key]);assert.deepEqual(Buffer.from(h.objects.get(original.key)),pdf);
 }finally{h.close();}
});

test('unknown database acknowledgement preserves committed original evidence while storage failures remain generic',async()=>{
 const f=await setup(),{h}=f;try{
  const initial=await json(await f.request('GET')),batch=h.db.batch;
  h.db.batch=async statements=>{const result=await batch(statements);if([...h.objects.keys()].some(key=>key.startsWith('owner/legal/')))throw Error('private database detail');return result;};
  const failed=await json(await f.upload(initial.revision),503);assert.doesNotMatch(failed.error,/private/);h.db.batch=batch;
  const recovered=await json(await f.request('GET'));assert.equal(recovered.documents.files.length,1);assert.deepEqual(Buffer.from(h.objects.get(recovered.documents.files[0].key)),pdf);
  h.bindings.FILES.put=async()=>{throw Error('private storage detail');};
  const unavailable=await json(await f.upload(recovered.revision,pdf,'next.pdf'),503);assert.doesNotMatch(unavailable.error,/private/);
  assert.deepEqual((await json(await f.request('GET'))).documents,recovered.documents);
 }finally{h.close();}
});
