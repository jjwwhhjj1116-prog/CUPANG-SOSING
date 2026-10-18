import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {aiModule,aiFixture,companies,mockProvider,plain} from './helpers/quotation-ai.mjs';

const path='app/quotation-ai.ts',sha=()=>createHash('sha256').update(fs.readFileSync(new URL('../'+path,import.meta.url))).digest('hex'),frozen=sha(),proofs=[];
const attribute=(name,value,sourceName)=>({name,value,...(sourceName===undefined?{}:{sourceName})});
function source(f,values){f.content.categoryAttributes={categoryId:f.snapshot.categoryId,jobId:'synthetic-source-706',values};}
function compatibility(f){
 f.raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf.push({contains:{type:'object',required:['attributeName','attributeValue'],properties:{
  attributeName:{type:'string',enum:['호환 기종'],requirement:'필수'},attributeValue:{type:'string',maxLength:100}}}});f.syncSchema();
}
after(()=>{assert.equal(sha(),frozen);fs.writeFileSync(new URL('../outputs/step706-category-facts-unit-proof.json',import.meta.url),JSON.stringify({sourceHashes:{[path]:frozen},cases:proofs,
 boundary:'Actual pure plan/provider contract; all product/schema/AI data synthetic. No live collection or model calls.',externalRequests:0,databaseWrites:0,browserActions:0,supplierHubWrites:0},null,2)+'\n');});

for(const company of companies)test(company.name+': saved category source attributes reach every quotation AI request without altering source or binding authority',async()=>{
 const m=aiModule(),f=aiFixture({company,count:21});compatibility(f);source(f,[attribute('호환 기종','전용기기-706A','상품속성: 适用机型'),attribute('결합 방식','잠금식')]);
 const before=JSON.stringify(f.saved),plan=m.buildQuotationAiPlan(f.saved,f.scope),field=plan.fields.find(item=>item.hubWire.name==='호환 기종');
 assert.ok(field);assert.ok(plan.targets.every(target=>target.writableFieldIds.includes(field.id)));
 assert.deepEqual(plain(plan.facts.attributes.filter(item=>item.provenance==='category-source-translation')),[
  {name:'호환 기종',value:'전용기기-706A',sourceName:'상품속성: 适用机型',provenance:'category-source-translation'},
  {name:'결합 방식',value:'잠금식',provenance:'category-source-translation'}]);
 const provider=mockProvider(),result=await m.executeQuotationAi(plan,provider);
 assert.equal(JSON.stringify(f.saved),before);assert.ok(result.changes.length);
 assert.ok(provider.calls.length>=4);assert.ok(provider.calls.every(call=>call.request.facts.attributes.some(item=>item.name==='호환 기종'&&item.value==='전용기기-706A')));
 for(const call of provider.calls.filter(call=>call.request.task.startsWith('GET_DIFFERENTIATED')))
  assert.deepEqual(call.request.facts.options.map(item=>item.optionId),call.request.targets.map(item=>item.optionId));
 proofs.push({company,sourceAttributes:2,providerRequests:provider.calls.length,allRequestsRetainFacts:true,savedSourceUnchanged:true});
});

test('foreign-category metadata cannot enter a current plan, while legacy sources keep their prior facts',()=>{
 const m=aiModule(),f=aiFixture(),original=plain(m.buildQuotationAiPlan(f.saved,f.scope).facts);
 source(f,[attribute('호환 기종','다른분류-706B')]);f.content.categoryAttributes.categoryId='80719';
 assert.deepEqual(plain(m.buildQuotationAiPlan(f.saved,f.scope).facts),original);
 source(f,[]);assert.deepEqual(plain(m.buildQuotationAiPlan(f.saved,f.scope).facts),original);
 delete f.content.categoryAttributes;assert.deepEqual(plain(m.buildQuotationAiPlan(f.saved,f.scope).facts),original);
 proofs.push({kind:'category and legacy',foreignCategoryOmitted:true,legacyFactsUnchanged:true});
});

test('same-name source facts retain their provenance and never replace manual blanks or current label facts',async()=>{
 const m=aiModule(),f=aiFixture();source(f,[attribute('material','다른 참고 재질','상품속성: 材质'),attribute('material','두번째 참고 재질')]);
 f.content.label.material={value:'직접 검토 재질',provenance:'manual',updatedAt:f.product.updated_at};
 const initial=m.buildQuotationAiPlan(f.saved,f.scope),material=initial.fields.find(field=>field.hubWire.name==='소재').id;
 f.state.overrides.common[material]='';const before=JSON.stringify(f.saved),plan=m.buildQuotationAiPlan(f.saved,f.scope);
 assert.deepEqual(plain(plan.facts.attributes.filter(item=>item.name==='material').map(item=>[item.value,item.provenance])),[
  ['직접 검토 재질','manual'],['다른 참고 재질','category-source-translation'],['두번째 참고 재질','category-source-translation']]);
 assert.ok(plan.targets.every(target=>target.protectedValues.some(item=>item.fieldKey===material&&item.value==='')));
 const result=await m.executeQuotationAi(plan,mockProvider());assert.ok(!result.changes.some(change=>change.fieldKey===material));assert.equal(JSON.stringify(f.saved),before);
 proofs.push({kind:'manual and duplicate names',sourceOrderAndProvenancePreserved:true,manualBlankProtected:true});
});

test('sourceName is descriptive only; stale bindings and reserved fields never grant new write authority',()=>{
 const m=aiModule(),f=aiFixture();compatibility(f);source(f,[attribute('호환 기종','전용기기-706A','option:foreign')]);
 const first=m.buildQuotationAiPlan(f.saved,f.scope),field=first.fields.find(item=>item.hubWire.name==='호환 기종');
 f.content.categoryAttributes.bindings=[{fieldId:field.id,fieldSignature:'stale-definition',value:'stale-value'}];f.content.categoryAttributes.reservedFields=[field.id];
 const before=JSON.stringify(f.saved),plan=m.buildQuotationAiPlan(f.saved,f.scope);
 assert.deepEqual(plain(plan.targets),plain(first.targets));assert.equal(plan.facts.attributes.at(-1).value,'전용기기-706A');
 assert.equal(plan.facts.attributes.at(-1).sourceName,'option:foreign');assert.ok(!JSON.stringify(plan.facts).includes('stale-value'));assert.equal(JSON.stringify(f.saved),before);
 proofs.push({kind:'descriptive source name',bindingsNotReinterpreted:true});
});

test('malformed current-category reference data fails before any provider call',async()=>{
 const m=aiModule();const mutations=[attrs=>{attrs.jobId='';},attrs=>{attrs.jobId='x'.repeat(101);},attrs=>{attrs.values={};},attrs=>{attrs.values=Array(51).fill(attribute('항목','내용'));},
  attrs=>{attrs.values=[null];},attrs=>{attrs.values[0].name='';},attrs=>{attrs.values[0].name=1;},attrs=>{attrs.values[0].name='항'.repeat(201);},
  attrs=>{attrs.values[0].value='';},attrs=>{attrs.values[0].value=false;},attrs=>{attrs.values[0].value='내'.repeat(2001);},attrs=>{attrs.values[0].value='값\u0001';},
  attrs=>{attrs.values[0].sourceName=3;},attrs=>{attrs.values[0].sourceName=' ';},attrs=>{attrs.values[0].sourceName='원'.repeat(201);}];
 for(const mutate of mutations){const f=aiFixture();source(f,[attribute('항목','내용')]);mutate(f.content.categoryAttributes);const before=JSON.stringify(f.saved);
  assert.throws(()=>m.buildQuotationAiPlan(f.saved,f.scope),error=>error.code==='AI_SOURCE'&&error.uncertain===false);assert.equal(JSON.stringify(f.saved),before);}
 proofs.push({kind:'invalid source',cases:mutations.length,providerCalls:0});
});

test('large but valid source facts retain the existing per-request bound and never send a partial prompt',async()=>{
 const m=aiModule(),f=aiFixture();source(f,Array.from({length:50},(_,index)=>attribute('항목 '+index,'값'.repeat(2000))));
 const plan=m.buildQuotationAiPlan(f.saved,f.scope),provider=mockProvider();await assert.rejects(m.executeQuotationAi(plan,provider),error=>error.code==='AI_LIMIT'&&error.uncertain===false);
 assert.equal(provider.calls.length,0);assert.equal(plan.facts.attributes.filter(item=>item.provenance==='category-source-translation').length,50);
 proofs.push({kind:'prompt bound',providerCalls:0,noSilentTruncation:true});
});
