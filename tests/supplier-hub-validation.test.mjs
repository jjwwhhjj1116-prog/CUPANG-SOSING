import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {requestSupplierHubValidation} from '../extensions/supplier-hub/validate.mjs';

const agreementTexts=['제공된 권장소비자가격 또는 공식 판매처 가격 데이터에 대한 쿠팡 약관에 동의합니다.','상품 라벨 내 기재된 (010 이하) 연락처는 법인 명의 개통 번호이거나, 해당 브랜드의 공식 대외 창구로 지정된 업무용 연락처에 해당함을 확인하며, 당사는 해당 정보가 대외적으로 공개됨에 동의합니다.'];
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];

function fixture(options={}){
  let clicks=0;const company=options.company??companies[0];
  const inputs=agreementTexts.map(text=>({checked:!options.unchecked,disabled:false,labels:[{innerText:text}],click(){throw Error('existing manual choices must not be clicked again');}}));
  const dataset={yoofamAttachmentAttempt:JSON.stringify({state:'dispatched',company,files:['YOOFAM-test.xlsx','label.png']})};
  if(options.marker!==undefined)dataset.yoofamAttachmentAttempt=options.marker;
  const button={innerText:'파일 검증하기',disabled:!!options.disabled,getClientRects:()=>options.hidden?[]:[{}],getAttribute:()=>options.ariaDisabled?'true':null,click(){clicks++;if(options.clickError)throw Error('lost result');}};
  const document={documentElement:{dataset},body:{innerText:`Company Code: ${company.code}\nYOOFAM-test.xlsx${options.missing?'':'\nlabel.png'}`},querySelectorAll(selector){
    if(selector==='button')return options.duplicate?[button,button]:[button];
    return options.missingAgreement?[]:[inputs[selector.includes('msrpAgreement')?0:1]];
  }};
  const context={document,location:{origin:options.wrong?'https://example.com':'https://supplier.coupang.com',pathname:'/qvt/registration'}};
  return {run:(reviewed={},waitForButton=false)=>vm.runInNewContext(`(${requestSupplierHubValidation.toString()})(reviewed,waitForButton)`,{...context,reviewed,waitForButton}),
    setWait(callback){context.setTimeout=callback;},inputs,button,dataset,get clicks(){return clicks;}};
}
test('explicit validation action clicks once only after attached filenames and agreements are present',()=>{
  const f=fixture(),result=f.run();assert.equal(f.clicks,1);assert.equal(result.state,'validation-requested');assert.equal(result.validated,false);assert.equal(result.registered,false);
  assert.throws(()=>f.run(),/이미 요청/);assert.equal(f.clicks,1);
});
test('unrelated, partial, missing-upload, disabled and unacknowledged forms remain untouched',()=>{
  for(const options of [{marker:''},{marker:'started'},{marker:JSON.stringify({state:'partial',files:['a']})},{missing:true},{unchecked:true},{missingAgreement:true},{disabled:true},{ariaDisabled:true},{hidden:true},{duplicate:true},{wrong:true}]){
    const f=fixture(options);assert.throws(()=>f.run());assert.equal(f.clicks,0);
  }
});
test('lost click result cannot silently trigger a second remote validation request',()=>{
  const f=fixture({clickError:true});assert.throws(()=>f.run(),/lost result/);assert.throws(()=>f.run(),/이미 요청/);assert.equal(f.clicks,1);
});


test('only explicitly reviewed matching agreements are clicked before validation',()=>{
 const texts=['제공된 권장소비자가격 또는 공식 판매처 가격 데이터에 대한 쿠팡 약관에 동의합니다.','상품 라벨 내 기재된 (010 이하) 연락처는 법인 명의 개통 번호이거나, 해당 브랜드의 공식 대외 창구로 지정된 업무용 연락처에 해당함을 확인하며, 당사는 해당 정보가 대외적으로 공개됨에 동의합니다.'];
 for(const mode of ['success','partial','changed','not-applied','invalid']){
  const clicks=[];
  const inputs=texts.map((text,index)=>({checked:false,disabled:false,labels:[{innerText:mode==='changed'&&index===1?'changed terms':text}],click(){clicks.push(index);if(mode!=='not-applied')this.checked=true;}}));
  const button={innerText:'파일 검증하기',get disabled(){return inputs.some(input=>!input.checked);},getClientRects:()=>[{}],getAttribute:()=>null,click(){clicks.push('validate');}};
  const dataset={yoofamAttachmentAttempt:JSON.stringify({state:'dispatched',company:{code:'A01464742',name:'와이홉'},files:['a.xlsx']})};
  const document={documentElement:{dataset},body:{innerText:'Company Code: A01464742\na.xlsx'},querySelectorAll(selector){return selector==='button'?[button]:[inputs[selector.includes('msrpAgreement')?0:1]];}};
  const reviewed=mode==='invalid'?{priceData:'yes',labelBusinessContact:true}:{priceData:true,labelBusinessContact:mode!=='partial'};
  const run=()=>vm.runInNewContext('('+requestSupplierHubValidation.toString()+')(reviewed)',{document,reviewed,location:{origin:'https://supplier.coupang.com',pathname:'/qvt/registration'}});
  if(mode==='success'){assert.equal(run().state,'validation-requested');assert.deepEqual(clicks,[0,1,'validate']);assert.throws(run);}
  else {assert.throws(run);assert.ok(!clicks.includes('validate'));assert.equal(JSON.parse(dataset.yoofamAttachmentAttempt).state,'dispatched');if(mode!=='not-applied')assert.deepEqual(clicks,[]);}
 }
});


test('legal exemption requires explicit choice and preserves existing legal attachments',()=>{
 for(const mode of ['confirmed','unchecked','existing-file','uploaded-name','changed-section','duplicate','disabled','not-applied']){
  const clicks=[];const dataset={yoofamAttachmentAttempt:JSON.stringify({state:'dispatched',company:{code:'A01464742',name:'와이홉'},files:['a.xlsx']})};
  const section={innerText:mode==='changed-section'?'다른 구역':'상품 개별법령에 따른 필수 서류'+(mode==='uploaded-name'?' evidence.pdf':''),parentElement:null,querySelectorAll(selector){return selector.includes('radio')?[{},{}]:[{files:mode==='existing-file'?[{}]:[]}];}};
  const input={checked:false,disabled:mode==='disabled',labels:[{innerText:'해당없음'}],parentElement:section,click(){clicks.push('legal');if(mode!=='not-applied')this.checked=true;}};
  const button={innerText:'파일 검증하기',disabled:false,getClientRects:()=>[{}],getAttribute:()=>null,click(){clicks.push('validate');}};
  const document={documentElement:{dataset},body:{innerText:'Company Code: A01464742\na.xlsx'},querySelectorAll(selector){if(selector==='button')return [button];if(selector.includes('radio'))return mode==='duplicate'?[input,input]:[input];return [{checked:true,disabled:false,labels:[{innerText:agreementTexts[selector.includes('msrpAgreement')?0:1]}]}];}};
  const run=()=>vm.runInNewContext('('+requestSupplierHubValidation.toString()+')(reviewed)',{document,reviewed:{legalDocumentsNotApplicable:mode!=='unchecked'},location:{origin:'https://supplier.coupang.com',pathname:'/qvt/registration'}});
  if(['confirmed','unchecked'].includes(mode)){run();assert.deepEqual(clicks,mode==='confirmed'?['legal','validate']:['validate']);}
  else{assert.throws(run);assert.deepEqual(clicks,mode==='not-applied'?['legal']:[]);assert.equal(JSON.parse(dataset.yoofamAttachmentAttempt).state,'dispatched');}
 }
});

test('validation rejects a company switch after attachment without clicking',()=>{
 const f=fixture();const attempt=JSON.parse(f.dataset.yoofamAttachmentAttempt);
 attempt.company={code:'A01526306',name:'유앤채'};f.dataset.yoofamAttachmentAttempt=JSON.stringify(attempt);
 assert.throws(()=>f.run(),/회사/);assert.equal(f.clicks,0);
});

test('app validation waits for an asynchronously enabled button and rechecks identity before clicking once',async()=>{
 for(const mode of ['success','company-switch','other-validation','timeout']){
   let clicks=0,waits=0;
   const dataset={yoofamAttachmentAttempt:JSON.stringify({state:'dispatched',company:{code:'A01464742',name:'와이홉'},files:['a.xlsx']})};
   const button={innerText:'파일 검증하기',disabled:true,getClientRects:()=>[{}],getAttribute:()=>null,click(){clicks++;}};
   const document={documentElement:{dataset},body:{innerText:'Company Code: A01464742 a.xlsx'},querySelectorAll(selector){return selector==='button'?[button]:[{checked:true,disabled:false,labels:[{innerText:agreementTexts[selector.includes('msrpAgreement')?0:1]}]}];}};
   const result=vm.runInNewContext(`(${requestSupplierHubValidation.toString()})({},true)`,{document,location:{origin:'https://supplier.coupang.com',pathname:'/qvt/registration'},setTimeout(callback){waits++;if(mode!=='timeout')button.disabled=false;if(mode==='company-switch')document.body.innerText='Company Code: A01526306 a.xlsx';if(mode==='other-validation')dataset.yoofamAttachmentAttempt='already requested';queueMicrotask(callback);}});
   if(mode==='success'){assert.equal((await result).state,'validation-requested');assert.equal(clicks,1);assert.equal(waits,1);}else {await assert.rejects(result);assert.equal(clicks,0);}
 }
});

for(const company of companies){
 test(`prechecked agreements with missing or changed text never request validation (${company.code})`,()=>{
  for(const index of [0,1])for(const mode of ['missing','changed']){
   const f=fixture({company}),marker=f.dataset.yoofamAttachmentAttempt;
   if(mode==='missing')delete f.inputs[index].labels;else f.inputs[index].labels[0].innerText='변경된 동의 내용';
   assert.throws(()=>f.run({priceData:true,labelBusinessContact:true}),/동의|약관|연락처/);
   assert.equal(f.clicks,0);assert.equal(f.dataset.yoofamAttachmentAttempt,marker);
   assert.deepEqual(f.inputs.map(input=>input.checked),[true,true]);
  }
 });
 test(`exact prechecked agreements reuse existing manual choices without new consent clicks (${company.code})`,()=>{
  const f=fixture({company}),result=f.run();
  assert.equal(result.state,'validation-requested');assert.equal(result.validated,false);assert.equal(result.registered,false);assert.equal(f.clicks,1);
  assert.deepEqual(f.inputs.map(input=>input.checked),[true,true]);
  assert.throws(()=>f.run(),/이미 요청/);assert.equal(f.clicks,1);
 });
 test(`waiting validation rechecks prechecked agreement text before marking or clicking (${company.code})`,async()=>{
  for(const index of [0,1])for(const mode of ['missing','changed']){
   const f=fixture({company,disabled:true}),marker=f.dataset.yoofamAttachmentAttempt;let waits=0;
   f.setWait(callback=>{waits++;f.button.disabled=false;
    if(mode==='missing')delete f.inputs[index].labels;else f.inputs[index].labels[0].innerText='대기 중 변경된 동의 내용';
    queueMicrotask(callback);
   });
   await assert.rejects(f.run({priceData:true,labelBusinessContact:true},true),/동의|약관|연락처/);
   assert.equal(waits,1);assert.equal(f.clicks,0);assert.equal(f.dataset.yoofamAttachmentAttempt,marker);
   assert.deepEqual(f.inputs.map(input=>input.checked),[true,true]);
  }
 });
}
