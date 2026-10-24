import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule as load} from './helpers/provided-option-quotation.mjs';
import {aiFixture} from './helpers/quotation-ai.mjs';
import {answerPackagingPlan,packagingItem,packagingResponse} from './helpers/quotation-packaging-provider.mjs';

const weight=load('app/quotation-packaged-weight.ts'),draft=load('app/quotation-packaging-draft.ts'),schema=load('app/quotation-schema.ts');
const basis=load('app/quotation-packaging-basis.ts'),plain=value=>JSON.parse(JSON.stringify(value));
const facts={title:'硅胶后跟贴',description:'',attributes:[{name:'材质',value:'硅胶'}]};
function fixture(){
 const f=aiFixture({count:3});for(const option of f.options.rows){option.weightKg=0.01;option.provenance.weightKg='manual';}
 const view=()=>{
  const resolved=schema.resolveQuotationFields({categoryId:f.profile.categoryId,categoryPath:f.profile.categoryPath,product:f.product,content:f.content,
   settings:f.saved.settings,options:f.options,overrides:f.state.overrides,hubSchema:f.snapshot,...(f.packagingBasis?{packagingBasis:f.packagingBasis}:{})});
  return{revision:0,inputFingerprint:'a'.repeat(64),overrides:f.state.overrides,resolved,automatic:resolved,categoryContext:f.saved.categoryContext,
   productVersion:f.product.updated_at,contentRevision:f.content.revision,optionRevision:f.options.revision,imageKeys:[],submissionReady:false,
   optionPackQuantities:Object.fromEntries(f.options.rows.map(option=>[option.id,option.unitsPerPack])),...(f.packagingBasis?{packagingBasis:f.packagingBasis}:{})};
 };
 return{f,view,plan:()=>draft.buildQuotationPackagingDraftPlan(view(),f.options,facts,f.scope)};
}

test('all three 10g sale units reject a 5g package estimate without clamping, writing, or discarding valid dimensions',()=>{
 const {f,view,plan}=fixture(),before=JSON.stringify(f),prepared=plan();
 const result=draft.completeQuotationPackagingDraft(prepared,answerPackagingPlan(prepared,()=>({weightG:5,widthMm:40,lengthMm:60,heightMm:10})),1);
 assert.equal(result.proposals.length,3);assert.ok(result.proposals.every(item=>item.value==='40*60*10'&&item.origin==='ai-estimate'&&item.measured===false));
 assert.equal(result.warnings.filter(message=>/5g.*10g.*초안으로 제안하지/u.test(message)).length,3);
 assert.equal(draft.quotationPackagingDraftChanges(view(),result,f.product.id,f.scope).length,3);
 assert.equal(JSON.stringify(f),before);
});

test('sale-unit source weight reaches the model with provenance and is never multiplied by pack quantity',async()=>{
 const {f,plan}=fixture();for(const option of f.options.rows)option.unitsPerPack=3;
 const before=JSON.stringify(f);let calls=0;
 const result=await draft.executeQuotationPackagingDraft(plan(),{run:async(_model,input)=>{
  calls++;const request=JSON.parse(input.messages[1].content.slice(0,-'\n/no_think'.length));
  assert.match(input.messages[0].content,/saleUnitWeight.*entire selling unit.*already including its unitsPerPack/);
  assert.ok(request.packages.every(item=>item.unitsPerPack===3));
  for(const item of request.packages)assert.deepEqual(item.saleUnitWeight,{weightG:10,source:'manual',measured:false});
  return packagingResponse(request.packages.map(item=>packagingItem(item,{weightG:10,widthMm:40,lengthMm:60,heightMm:10})));
 }},new AbortController().signal);
 assert.equal(calls,1);assert.equal(result.proposals.filter(item=>item.value==='10').length,3);
 assert.equal(JSON.stringify(f),before);
});

test('saved 5g AI estimates retain values and provenance while final field and submission reviews flag each 10g contradiction',()=>{
 const {f,view,plan}=fixture(),fields=view().resolved.schema.fields,wire=fields.find(field=>field.hubInput==='packagedWeightG');
 const quantities=view().optionPackQuantities;
 const changes=f.options.rows.map(option=>({optionId:option.id,fieldKey:wire.id,value:'5'}));
 const metadata=changes.map(change=>({...change,fieldSignature:JSON.stringify(wire),unitsPerPack:1,origin:'ai-estimate',measured:false}));
 f.packagingBasis=basis.applyQuotationPackagingBasis(undefined,fields,quantities,changes,metadata);
 for(const change of changes)f.state.overrides.options[change.optionId]={[wire.id]:change.value};
 const before=JSON.stringify(f),saved=view(),prepared=plan();
 for(const row of saved.resolved.rows.filter(row=>row.included)){
  for(const id of ['packagedWeightG',wire.id]){
   assert.equal(row.fields[id].value,'5');assert.match(row.fields[id].validationIssues.join(' '),/포장 무게 5g.*판매 단위 무게 10g/u);
   assert.match(row.fields[id].reviewMessages.join(' '),/실측값이 아닙니다/u);
  }
  assert.deepEqual(plain(f.packagingBasis.options[row.optionId][wire.id].nonMeasuredDraft),{origin:'ai-estimate',measured:false});
 }
 assert.ok(prepared.targets.every(target=>target.weightField===null&&target.reviewedPackage.weight===undefined));
 assert.equal(prepared.preserved.filter(item=>item.value==='5'&&/판매 단위 무게 10g/u.test(item.reason)).length,3);
 const review=load('app/submission-review.ts').inspectSubmission(saved.resolved,[]);
 assert.equal(review.issues.filter(issue=>issue.kind==='error'&&issue.code==='FIELD_INVALID'&&issue.fieldId===wire.id&&/포장 무게 5g/u.test(issue.message)).length,3);
 assert.equal(JSON.stringify(f),before);
});

test('saved option package values stay protected but conflicting collected weight is not passed as valid AI context',()=>{
 for(const provenance of ['manual','collected']){
  const {f,plan}=fixture();for(const option of f.options.rows){option.packagedWeightG=5;option.packagingUnitsPerPack=1;option.provenance.packagedWeightG=provenance;}
  const before=JSON.stringify(f),prepared=plan();
  assert.ok(prepared.targets.every(target=>target.weightField===null&&target.reviewedPackage.weight===undefined&&target.collected.weightG===undefined));
  assert.ok(prepared.preserved.every(item=>item.value==='5'&&/판매 단위 무게 10g/u.test(item.reason)));
  assert.equal(JSON.stringify(f),before);
 }
});

test('only exact positive g fields compare against finite sale-unit kg; equality, unknown weights, and intentional blanks remain unchanged',()=>{
 const {view}=fixture(),fields=view().resolved.schema.fields,wire=fields.find(field=>field.hubInput==='packagedWeightG');
 for(const id of ['packagedWeightG',wire.id]){
  assert.equal(weight.quotationPackagedWeightSourceIssues(fields,id,'5',0.01).length,1);
  assert.equal(weight.quotationPackagedWeightSourceIssues(fields,id,'10',0.01).length,0);
  assert.equal(weight.quotationPackagedWeightSourceIssues(fields,id,'11',0.01).length,0);
  assert.equal(weight.quotationPackagedWeightSourceIssues(fields,id,'1',0.001001).length,1);
  for(const source of [undefined,null,0,-1,NaN,Infinity])assert.equal(weight.quotationPackagedWeightSourceIssues(fields,id,'5',source).length,0);
  for(const value of ['', ' ', 'invalid'])assert.equal(weight.quotationPackagedWeightSourceIssues(fields,id,value,0.01).length,0);
 }
 assert.equal(weight.quotationPackagedWeightSourceIssues(fields,'supplyPrice','5',0.01).length,0);
 assert.equal(weight.quotationPackagedWeightSourceIssue(10,10+Number.EPSILON*10),null);
 assert.equal(weight.quotationSaleUnitWeightG(0.01),10);
});
