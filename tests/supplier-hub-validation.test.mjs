import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {requestSupplierHubValidation} from '../extensions/supplier-hub/validate.mjs';

function fixture(options={}){
  let clicks=0;
  const dataset={yoofamAttachmentAttempt:JSON.stringify({state:'dispatched',files:['YOOFAM-test.xlsx','label.png']})};
  if(options.marker!==undefined)dataset.yoofamAttachmentAttempt=options.marker;
  const button={innerText:'파일 검증하기',disabled:!!options.disabled,getClientRects:()=>options.hidden?[]:[{}],getAttribute:()=>options.ariaDisabled?'true':null,click(){clicks++;if(options.clickError)throw Error('lost result');}};
  const document={documentElement:{dataset},body:{innerText:options.missing?'YOOFAM-test.xlsx':'YOOFAM-test.xlsx\nlabel.png'},querySelectorAll(selector){
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
