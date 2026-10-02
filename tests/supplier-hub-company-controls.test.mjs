import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {attachToSupplierHub} from '../extensions/supplier-hub/attach.mjs';
import {requestSupplierHubValidation} from '../extensions/supplier-hub/validate.mjs';

const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
const terms=['제공된 권장소비자가격 또는 공식 판매처 가격 데이터에 대한 쿠팡 약관에 동의합니다.','상품 라벨 내 기재된 (010 이하) 연락처는 법인 명의 개통 번호이거나, 해당 브랜드의 공식 대외 창구로 지정된 업무용 연락처에 해당함을 확인하며, 당사는 해당 정보가 대외적으로 공개됨에 동의합니다.'];
function page(company,{attachment=false,closeOn='price',failure,delay=0,waitForButton=false}={}){
 let open=true,pending=0,waits=0,manualFilename='';
 const manualFile={name:'owner-work.png'};
 const events=[],dataset={},location={origin:'https://supplier.coupang.com',pathname:'/qvt/registration'};
 const titles=['작성이 완료된 견적서 Excel 파일을 업로드하십시오.','상품 이미지를 업로드하십시오.','제품 필수 표시사항을 업로드하십시오.'];
 const filenames=['a.xlsx','photo.png','label.png'];
 const inputs=titles.map((title,index)=>({files:attachment?[]:[{name:filenames[index]}],isConnected:true,disabled:false,closest:()=>null,
  parentElement:{innerText:title,querySelectorAll:()=>[{}]},dispatchEvent(){events.push('upload-'+index);}}));
 const legalFile={files:[],isConnected:true,disabled:false,closest:()=>null,dispatchEvent(){events.push('upload-legal');}};
 const close=name=>{events.push(name);if(name===closeOn)open=false;};
 const legal={checked:false,disabled:false,labels:[{innerText:attachment?'해당함':'해당없음'}],click(){this.checked=true;close(attachment?'legal-yes':'legal-no');}};
 const section={parentElement:null,get innerText(){return '상품 개별법령에 따른 필수 서류\n'+legalFile.files.map(file=>file.name).join('\n');},querySelectorAll(selector){return selector.includes('radio')?[legal,{}]:(attachment&&legal.checked?[legalFile]:[]);}};
 legal.parentElement=section;
 const checks=terms.map((text,index)=>({checked:closeOn!==(index?'contact':'price'),disabled:false,labels:[{innerText:text}],click(){this.checked=true;close(index?'contact':'price');}}));
 const button={innerText:'파일 검증하기',disabled:waitForButton,getClientRects:()=>[{}],getAttribute:()=>null,click(){events.push('validate');}};
 const menu={innerText:company.name,disabled:false,getClientRects:()=>[{}],click(){events.push('company-menu');pending=delay;if(!delay)open=true;if(failure==='marker')dataset.yoofamAttachmentAttempt='changed';if(failure==='location')location.pathname='/qvt/wims';if(failure==='file')inputs[0].files=[];if(failure==='agreement')checks[0].checked=false;}};
 if(!attachment)dataset.yoofamAttachmentAttempt=JSON.stringify({state:'dispatched',company,files:filenames});
 const document={documentElement:{dataset},body:{get innerText(){return [company.name,manualFilename,...(open?['Company Code: '+(failure==='switched'&&events.includes('company-menu')?companies.find(value=>value.code!==company.code).code:company.code),...(failure==='duplicate'&&events.includes('company-menu')?['Company Code: '+company.code]:[])]:[]),...[...inputs,legalFile].flatMap(input=>input.files.map(file=>file.name))].join('\n');}},querySelectorAll(selector){
  if(selector==='button')return [button,...(failure==='missing'?[]:failure==='ambiguous'?[menu,menu]:[menu])];
  if(selector==='input[type="file"]')return [...inputs,...(attachment&&legal.checked?[legalFile]:[])];
  if(selector.includes(attachment?'undefined-Y':'undefined-N'))return [legal];
  if(selector.includes('msrpAgreement'))return [checks[0]];
  if(selector.includes('labelContactAgreement'))return [checks[1]];
  return [];
 }};
 class Transfer{constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}}
 const context={document,location,File,Event,Uint8Array,atob,DataTransfer:Transfer,setTimeout(callback){waits++;if(waitForButton)button.disabled=false;if(events.includes('company-menu')){if(failure==='manual-file')inputs[1].files=[manualFile];if(failure==='manual-filename')manualFilename=manualFile.name;}if(pending>0&&--pending===0&&failure!=='timeout')open=true;queueMicrotask(callback);}};
 const payload={company,quotation:[{name:filenames[0],base64:'UEs='}],productImages:[{name:filenames[1],base64:'aW1hZ2U='}],labelImages:[{name:filenames[2],base64:'bGFiZWw='}],legalDocumentsRequired:true,legalDocuments:[{name:'legal-001.pdf',base64:'JVBERi0='}]};
 const reviewed={priceData:true,labelBusinessContact:true,...(closeOn==='legal-no'?{legalDocumentsNotApplicable:true}:{})};
 return {events,inputs,legalFile,dataset,payload,reviewed,manualFile,get manualFilename(){return manualFilename;},get waits(){return waits;},run(func,args){return vm.runInNewContext(`(${func.toString()})(...args)`,{...context,args});}};
}

for(const company of companies)test(`validation rechecks the closed company menu after each reviewed control (${company.code})`,async()=>{
 for(const closeOn of ['legal-no','price','contact']){
  const p=page(company,{closeOn,delay:2});
  const result=await p.run(requestSupplierHubValidation,[p.reviewed]);
  assert.equal(result.state,'validation-requested');assert.equal(result.validated,false);assert.equal(result.registered,false);
  assert.deepEqual(p.events,[closeOn,'company-menu','validate']);assert.equal(p.waits,2);
  assert.throws(()=>p.run(requestSupplierHubValidation,[p.reviewed]),/이미 요청/);
 }
});

for(const company of companies)test(`required-document selection rechecks the closed menu before any upload (${company.code})`,async()=>{
 const p=page(company,{attachment:true,closeOn:'legal-yes',delay:2});
 assert.equal(p.run(attachToSupplierHub,[p.payload,true]).state,'ready');assert.deepEqual(p.events,[]);
 const result=await p.run(attachToSupplierHub,[p.payload]);
 assert.equal(result.state,'dispatched');assert.equal(result.registered,false);assert.equal(result.dispatched.length,4);
 assert.deepEqual(p.events,['legal-yes','company-menu','upload-0','upload-1','upload-2','upload-legal']);
 assert.equal(p.legalFile.files[0].name,'legal-001.pdf');assert.equal(JSON.parse(p.dataset.yoofamAttachmentAttempt).company.code,company.code);
 assert.throws(()=>p.run(attachToSupplierHub,[p.payload]),/이미 파일/);
});

test('closed-menu validation rejects changed identity, context, files or agreements before a click',async()=>{
 for(const failure of ['switched','duplicate','missing','ambiguous','marker','location','file','agreement','timeout']){
  const p=page(companies[0],{failure,delay:failure==='timeout'?1:0,waitForButton:true});
  await assert.rejects(async()=>p.run(requestSupplierHubValidation,[p.reviewed,true]));
  assert.equal(p.events.includes('validate'),false);assert.equal(p.events.filter(event=>event==='company-menu').length,failure==='missing'||failure==='ambiguous'?0:1);
  assert.notEqual(p.dataset.yoofamAttachmentAttempt,undefined);
 }
});

test('closed-menu required-document attachment rejects changed or unavailable company before any upload',async()=>{
 for(const failure of ['switched','duplicate','missing','ambiguous','marker','location','timeout']){
  const p=page(companies[0],{attachment:true,closeOn:'legal-yes',failure,delay:failure==='timeout'?1:0});
  const result=await p.run(attachToSupplierHub,[p.payload]);
  assert.equal(result.state,'partial');assert.equal(result.dispatched.length,0);assert.ok(result.error);
  assert.equal(p.events.some(event=>event.startsWith('upload')),false);assert.equal(p.inputs.every(input=>input.files.length===0),true);
  assert.throws(()=>p.run(attachToSupplierHub,[p.payload]));
 }
});

test('a manual upload appearing during company-menu recovery is preserved before any file event',async()=>{
 for(const failure of ['manual-file','manual-filename']){
  const p=page(companies[0],{attachment:true,closeOn:'legal-yes',failure,delay:2});
  assert.equal(p.run(attachToSupplierHub,[p.payload,true]).state,'ready');
  const result=await p.run(attachToSupplierHub,[p.payload]);
  assert.equal(result.state,'partial');assert.equal(result.dispatched.length,0);assert.match(result.error,/기존.*첨부|파일/);
  assert.deepEqual(p.events,['legal-yes','company-menu']);assert.equal(p.waits,2);
  assert.equal(p.inputs[0].files.length,0);assert.equal(p.inputs[2].files.length,0);assert.equal(p.legalFile.files.length,0);
  if(failure==='manual-file')assert.equal(p.inputs[1].files[0],p.manualFile);
  else{assert.equal(p.inputs[1].files.length,0);assert.equal(p.manualFilename,p.manualFile.name);}
  assert.equal(p.dataset.yoofamAttachmentAttempt,'started');assert.throws(()=>p.run(attachToSupplierHub,[p.payload]));
 }
});
