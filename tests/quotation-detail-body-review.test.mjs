import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
import {projectionFixture} from './helpers/supplier-hub-single-projection.mjs';
const {quotationDetailBodyIssues:review}=providedOptionModule('app/quotation-detail-body-review.ts');
const {projectSupplierHubSingleDocument:project}=providedOptionModule('app/supplier-hub-single-projection.ts');
const detail=['imagePage','details','detailedImage'],html=['imagePage','details','htmlProductDetailContent'];
async function fixture(keys='owner/top.png',body=''){
 const f=projectionFixture();f.set(detail,undefined,keys);f.set(html,undefined,body);
 return{...f,projection:await project(f.input)};
}
test('configured banners alone block the exact included native document without mutating its payload',async()=>{
 const f=await fixture('owner/top.png\nowner/bottom.png'),before=JSON.stringify(f.projection);
 const issues=review(f.projection,['owner/top.png','owner/bottom.png']);
 assert.equal(issues.length,1);assert.equal(issues[0].kind,'error');assert.equal(issues[0].code,'DETAIL_BODY_MISSING');assert.equal(issues[0].optionId,'synthetic-one');
 assert.equal(JSON.stringify(f.projection),before);
});
test('a selected body image qualifies while an unused candidate or shadow canonical cell does not',async()=>{
 const f=await fixture();f.projection.review.fields.push({optionId:'excluded',fieldId:'detailImages',path:detail,savedValue:'owner/body.png',projected:false});
 assert.equal(review(f.projection,['owner/top.png']).length,1);
 const body=await fixture('owner/top.png\nowner/body.png\nowner/bottom.png');assert.equal(review(body.projection,['owner/top.png','owner/bottom.png']).length,0);
});
test('safe direct HTML with product text qualifies without images, and entities decode as text',async()=>{
 for(const value of ['<p>저장한 상품 설명</p>','<div><strong>뒤꿈치 보호 패드</strong><p>1개입</p></div>','<p>&#49345;&#54408;</p>']){
  const f=await fixture('',value);assert.equal(review(f.projection,[]).length,0,value);
 }
});
test('empty, image-only, hidden, raw/inert or unsafe HTML cannot disguise an absent product body',async()=>{
 for(const value of ['', '글만 입력', '<p>&nbsp;\u200b</p>','<!-- 상품 설명 -->','<img src="banner.png">','<script>상품설명</script>', '<template><p>상품설명</p></template>','<p hidden>상품설명</p>','<p style="display:none">상품설명</p>','<p onclick="alert(1)">상품설명</p>','<iframe src="https://example.test">상품설명</iframe>']){
  const f=await fixture('owner/top.png',value);assert.equal(review(f.projection,['owner/top.png']).length,1,value);
 }
});
test('existing validation errors prevent an invalid HTML value from supplying the missing body',async()=>{
 const f=await fixture('owner/top.png','<p>설명</p>'),field=f.projection.review.fields.find(field=>JSON.stringify(field.path)===JSON.stringify(html));
 f.projection.review.issues.push({code:'VALUE_INVALID',level:'error',optionId:field.optionId,fieldId:field.fieldId,message:'invalid saved HTML'});
 assert.equal(review(f.projection,['owner/top.png']).length,1);
});
