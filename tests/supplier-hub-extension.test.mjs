import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {readPackageZip,prepareAttachments} from '../extensions/supplier-hub/package.mjs';
import {attachToSupplierHub} from '../extensions/supplier-hub/attach.mjs';
import {validateHandoff,HANDOFF_ORIGINS} from '../extensions/supplier-hub/handoff-store.mjs';

const code=ts.transpileModule(fs.readFileSync(new URL('../app/exports/zip.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports={};vm.runInNewContext(code,{exports,TextEncoder,Uint8Array,Uint32Array,DataView});
const zip=files=>new Uint8Array(exports.zipFiles(files));
const title='YOOFAM-'+ 'a'.repeat(64)+'.xlsx';
const workbook=new Uint8Array([80,75,3,4,0,1]); // Digest plumbing fixture, not an official Excel workbook.
const image=new Uint8Array([137,80,78,71]);
async function fixture(change=()=>{}){
  const digest=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const plan={format:'sourceflow-supplier-hub-upload-plan-v1',destination:'https://supplier.coupang.com/qvt/registration',categoryId:'80719',quotation:{file:{filename:title,byteLength:workbook.length,sha256:digest}},productImages:[{archivePath:'assets/photo.png',filename:'photo.png'}],labelImages:[{archivePath:'assets/label.png',filename:'label.png'}],missingLabels:[]};
  const files=[{name:title,data:workbook},{name:'assets/photo.png',data:image},{name:'assets/label.png',data:image},{name:'assets/unused.png',data:image}];change(plan,files);
  return zip([...files,{name:'supplier-hub-upload-plan.json',data:JSON.stringify(plan)}]);
}
test('app-produced ZIP resolves exact workbook and only manifest-referenced attachments',async()=>{
  const result=await prepareAttachments(await fixture());
  assert.equal(result.categoryId,'80719');assert.deepEqual(result.quotation,[{name:title,base64:Buffer.from(workbook).toString('base64')}]);
  assert.deepEqual(result.productImages.map(f=>f.name),['photo.png']);assert.deepEqual(result.labelImages.map(f=>f.name),['label.png']);
});
test('corrupted, truncated and inconsistent ZIP entries are rejected',async()=>{
  const original=await fixture();
  for(const edit of [b=>b.slice(0,-1),b=>{b[30]^=1;return b;},b=>{b[8]=8;return b;},b=>{b[b.length-6]^=1;return b;}])assert.throws(()=>readPackageZip(edit(original.slice())));
  assert.throws(()=>readPackageZip(new Uint8Array(31*1024*1024)));
});
test('manifest digest, image names, completeness and destination must match',async()=>{
  for(const change of [p=>p.quotation.file.sha256='b'.repeat(64),p=>p.quotation.file.byteLength++,p=>p.destination='https://example.com',p=>p.productImages[0].filename='different.png',p=>p.missingLabels.push({optionId:'one'}),p=>p.labelImages=[],(p,f)=>f.splice(2,1),p=>p.productImages.push({...p.productImages[0]}),p=>p.quotation.file.filename='quotation.csv'])await assert.rejects(()=>fixture(change).then(prepareAttachments));
});

function dom({duplicate=false,existing=false,visibleFilename=false,disabled=false,detach=false,wrong=false}={}){
  const titles=['작성이 완료된 견적서 Excel 파일을 업로드하십시오.','상품 이미지를 업로드하십시오.','제품 필수 표시사항을 업로드하십시오.','법적 필수서류를 업로드하십시오.'];
  const events=[];
  const inputs=titles.map((text,index)=>({files:existing&&index===3?[{}]:[],disabled:disabled&&index===2,isConnected:true,closest:()=>null,parentElement:{innerText:text,querySelectorAll:()=>[{}]},dispatchEvent(e){events.push(index);if(detach&&index===0)inputs[1].isConnected=false;}}));
  if(duplicate)inputs.push({...inputs[1]});
  class Transfer{constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}}
  const document={body:{innerText:visibleFilename?'상품이미지 existing.png':''},documentElement:{dataset:{}},querySelectorAll:()=>inputs};
  const context={document,location:{origin:wrong?'https://example.com':'https://supplier.coupang.com',pathname:'/qvt/registration'},DataTransfer:Transfer,File,Event,Uint8Array,atob};
  return {run:payload=>vm.runInNewContext(`(${attachToSupplierHub.toString()})(payload)`,{...context,payload}),inputs,events};
}
test('observed UI sections receive named files and change events with no registration claim',async()=>{
  const h=dom(),payload=await prepareAttachments(await fixture()),result=h.run(payload);
  assert.equal(result.state,'dispatched');assert.equal(result.registered,false);assert.deepEqual(h.events,[0,1,2]);
  assert.equal(h.inputs[0].files[0].name,title);assert.equal(h.inputs[1].files[0].type,'image/png');assert.equal(h.inputs[3].files.length,0);
  assert.throws(()=>h.run(payload),/이미 파일/);assert.deepEqual(h.events,[0,1,2]);
});
test('existing files, ambiguous sections, disabled controls and wrong hosts never dispatch',async()=>{
  const payload=await prepareAttachments(await fixture());
  for(const options of [{existing:true},{visibleFilename:true},{duplicate:true},{disabled:true},{wrong:true}]){const h=dom(options);assert.throws(()=>h.run(payload));assert.deepEqual(h.events,[]);}
});
test('decode all files before upload and report a partial attempt without automatic retry',async()=>{
  const payload=await prepareAttachments(await fixture()),bad=structuredClone(payload);bad.labelImages[0].base64='!invalid!';
  const pristine=dom();assert.throws(()=>pristine.run(bad));assert.deepEqual(pristine.events,[]);
  const h=dom({detach:true}),result=h.run(payload);assert.equal(result.state,'partial');assert.equal(result.registered,false);assert.deepEqual(h.events,[0]);assert.equal(result.dispatched.length,1);assert.throws(()=>h.run(payload));
});
test('extension limits permissions to explicit active-tab actions',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../extensions/supplier-hub/manifest.json',import.meta.url),'utf8'));
  assert.deepEqual(manifest.permissions,['activeTab','scripting']);assert.equal(manifest.host_permissions,undefined);
  assert.equal(manifest.background.service_worker,'handoff-worker.mjs');
  assert.deepEqual(manifest.content_scripts[0].matches,HANDOFF_ORIGINS.map(origin=>origin+'/*'));
});
test('web handoff accepts only top-frame app senders and bounded product-specific packages',()=>{
  const request={type:'YOOFAM_PREPARE_PACKAGE',productId:'product-1',categoryId:'80719',fingerprint:'a'.repeat(64),base64:'UEs='};
  const sender={tab:{id:1},frameId:0,url:HANDOFF_ORIGINS[0]+'/products'};
  assert.equal(validateHandoff(request,sender).fingerprint,request.fingerprint);
  for(const bad of [{...sender,url:'https://evil.example/'},{...sender,url:HANDOFF_ORIGINS[0]+'.evil.example/'},{...sender,frameId:1},{...sender,tab:null}])assert.throws(()=>validateHandoff(request,bad));
  for(const change of [{productId:'../other'},{fingerprint:'wrong'},{categoryId:''},{base64:'!'},{base64:'x'.repeat(40*1024*1024+1)}])assert.throws(()=>validateHandoff({...request,...change},sender));
});

test('stored results are scoped to app origin, product, category and fingerprint',async()=>{
  const {validateResultRequest,resultKey}=await import('../extensions/supplier-hub/handoff-store.mjs');
  const request={type:'YOOFAM_GET_RESULT',productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64)};
  const sender={tab:{id:1},frameId:0,url:HANDOFF_ORIGINS[0]+'/products'};
  const identity=validateResultRequest(request,sender);
  for(const change of [{origin:HANDOFF_ORIGINS[1]},{productId:'q'},{categoryId:'999'},{fingerprint:'b'.repeat(64)}])assert.notEqual(resultKey(identity),resultKey({...identity,...change}));
  for(const change of [{frameId:1},{tab:null},{url:'https://evil.example'}])assert.throws(()=>validateResultRequest(request,{...sender,...change}));
  for(const change of [{type:'YOOFAM_PREPARE_PACKAGE'},{productId:'../p'},{fingerprint:'x'},{categoryId:''}])assert.throws(()=>validateResultRequest({...request,...change},sender));
});
