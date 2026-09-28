import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {requestSupplierHubValidation} from '../extensions/supplier-hub/validate.mjs';

function fixture(options={}){
  let clicks=0;
  const dataset={yoofamAttachmentAttempt:JSON.stringify({state:'dispatched',company:{code:'A01464742',name:'와이홉'},files:['YOOFAM-test.xlsx','label.png']})};
  if(options.marker!==undefined)dataset.yoofamAttachmentAttempt=options.marker;
  const button={innerText:'파일 검증하기',disabled:!!options.disabled,getClientRects:()=>options.hidden?[]:[{}],getAttribute:()=>options.ariaDisabled?'true':null,click(){clicks++;if(options.clickError)throw Error('lost result');}};
  const document={documentElement:{dataset},body:{innerText:options.missing?'Company Code: A01464742\nYOOFAM-test.xlsx':'Company Code: A01464742\nYOOFAM-test.xlsx\nlabel.png'},querySelectorAll(selector){
    if(selector==='button')return options.duplicate?[button,button]:[button];
    return options.missingAgreement?[]:[{checked:!options.unchecked,disabled:false}];
  }};
  const context={document,location:{origin:options.wrong?'https://example.com':'https://supplier.coupang.com',pathname:'/qvt/registration'}};
  return {run:()=>vm.runInNewContext(`(${requestSupplierHubValidation.toString()})()`,context),dataset,get clicks(){return clicks;}};
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
  const document={documentElement:{dataset},body:{innerText:'Company Code: A01464742\na.xlsx'},querySelectorAll(selector){if(selector==='button')return [button];if(selector.includes('radio'))return mode==='duplicate'?[input,input]:[input];return [{checked:true,disabled:false}];}};
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
