import test from 'node:test';
import assert from 'node:assert/strict';
import {module,plain} from './helpers/supplier-hub-single-size-chart.mjs';
const contentModel=module('app/product-content.ts'),model=module('app/translation-label-reuse.ts'),now='2026-10-18T00:00:00.000Z';
function fixture(){const content=contentModel.emptyProductContent('synthetic709'),labels={productId:content.productId,overrides:{common:{},options:{}}},job={id:'job709',productId:content.productId,productVersion:'2024-01-01T00:00:00Z',status:'completed',review:{source:{reference:'same recorded source',category:{id:'81452',path:['합성']},attributes:[{name:'상품속성: 材质',value:'硅胶'},{name:'상품속성: 用途',value:'运动'}]}},result:{draft:{attributes:[{sourceIndex:0,name:'재질',value:'실리콘'},{sourceIndex:1,name:'사용 기준',value:'운동용'}]}}};return{content,labels,job,productVersion:now,categoryId:'81452',categoryPath:['합성'],inputFingerprint:'a'.repeat(64)};}
test('label-only reuse keeps the actual historical job clock and selects existing source-index values only',()=>{
 const f=fixture(),before=JSON.stringify(f),view=model.translationLabelReuseView(f),plan=model.translationLabelReusePlan(view,[{sourceIndex:1,field:'usageStandard'}]);assert.deepEqual(plain(plan),{label:{usageStandard:'운동용'},applied:1});assert.equal(JSON.stringify(f),before);assert.equal(f.job.productVersion,'2024-01-01T00:00:00Z');
 assert.throws(()=>model.translationLabelReusePlan(view,[{sourceIndex:9,field:'usageStandard'}]));assert.throws(()=>model.translationLabelReusePlan(view,[{sourceIndex:1,field:'usageStandard'},{sourceIndex:1,field:'material'}]));
});
test('content manual blanks and primary common overrides stay protected; other-option values remain independent',()=>{
 const f=fixture();f.content.label.material={value:'',provenance:'manual',updatedAt:now};f.labels.overrides.common.usageStandard='';f.labels.overrides.options.one={material:'옵션 직접값'};const view=model.translationLabelReuseView(f);
 for(const field of ['material','usageStandard'])assert.equal(view.fields.find(item=>item.field===field).eligible,false);
 assert.throws(()=>model.translationLabelReusePlan(view,[{sourceIndex:0,field:'material'}]));assert.equal(f.labels.overrides.options.one.material,'옵션 직접값');
});
test('conflicting original material columns and duplicate translated headings never get a first-wins suggestion',()=>{
 for(const rawName of ['material','직접 속성']){const f=fixture();f.job.review.source.attributes.push({name:'상품속성: '+rawName,value:'棉'});f.job.result.draft.attributes.push({sourceIndex:2,name:'재질',value:'면'});const view=model.translationLabelReuseView(f);assert.equal(view.suggestions.some(mapping=>mapping.field==='material'),false);assert.ok(view.skipped.some(value=>value.includes('후보')));const plan=model.translationLabelReusePlan(view,[{sourceIndex:2,field:'material'}]);assert.equal(plan.label.material,'면');}
});
test('changed category, option-only scope, duplicate result index and unchanged mapping are rejected',()=>{
 for(const change of [f=>{f.categoryId='80719';},f=>{f.job.review.optionsRetry={};},f=>{f.job.result.draft.attributes.push({...f.job.result.draft.attributes[0]});}]){const f=fixture();change(f);assert.throws(()=>model.translationLabelReuseView(f));}
 const f=fixture();f.content.label.material.value='실리콘';assert.throws(()=>model.translationLabelReusePlan(model.translationLabelReuseView(f),[{sourceIndex:0,field:'material'}]),/이미 같은/);
});
