import test from 'node:test';import assert from 'node:assert/strict';
import {providedOptionModule as load} from './helpers/provided-option-quotation.mjs';
import {aiFixture} from './helpers/quotation-ai.mjs';
const helper=load('app/quotation-packaging-draft.ts'),schema=load('app/quotation-schema.ts'),plain=value=>JSON.parse(JSON.stringify(value));
const facts={title:'硅胶后跟贴',description:'后跟贴 包装信息',attributes:[{name:'材质',value:'硅胶'}]};
const qwen=packages=>({choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({packages})}}]});
function fixture(input){const f=aiFixture(input),resolve=()=>schema.resolveQuotationFields({categoryId:f.profile.categoryId,categoryPath:f.profile.categoryPath,product:f.product,content:f.content,settings:f.saved.settings,options:f.options,overrides:f.state.overrides,hubSchema:f.snapshot});
 const view=()=>({revision:0,inputFingerprint:'a'.repeat(64),overrides:f.state.overrides,resolved:resolve(),automatic:resolve(),categoryContext:f.saved.categoryContext,productVersion:f.product.updated_at,contentRevision:f.content.revision,optionRevision:f.options.revision,updatedAt:null,imageKeys:[],submissionReady:false,optionPackQuantities:Object.fromEntries(f.options.rows.map(row=>[row.id,row.unitsPerPack]))});
 const plan=()=>helper.buildQuotationPackagingDraftPlan(view(),f.options,facts,f.scope);return{...f,view,plan};}
test('missing packaging receives reviewed fallback proposals only, without modifying products or source facts',()=>{
 const f=fixture(),before=JSON.stringify(f.saved),plan=f.plan(),result=helper.completeQuotationPackagingDraft(plan);
 assert.equal(plan.targets.length,2);assert.equal(result.proposals.length,4);assert.equal(result.aiRequests,0);assert.equal(result.model,null);
 for(const item of result.proposals){assert.equal(item.origin,'couplus-fallback');assert.equal(item.measured,false);assert.equal(item.unitsPerPack,1);assert.ok(['100','100*100*100'].includes(item.value));}
 assert.equal(JSON.stringify(f.saved),before);assert.equal(JSON.stringify(facts),JSON.stringify(plan.facts));
 assert.equal(helper.quotationPackagingDraftChanges(f.view(),result,f.product.id,f.scope).length,4);
});
test('collected ten grams always wins over AI/default weight while only missing dimensions are proposed',()=>{
 const f=fixture();for(const row of f.options.rows){row.packagedWeightG=10;row.packagingUnitsPerPack=1;row.provenance.packagedWeightG='collected';}
 const plan=f.plan(),result=helper.completeQuotationPackagingDraft(plan,qwen(plan.targets.map((_,index)=>({index,weightG:999,widthMm:80,lengthMm:50,heightMm:12}))),1);
 assert.ok(result.proposals.every(item=>item.value!=='999'&&!/무게/.test(item.label)));assert.equal(result.proposals.length,2);assert.ok(result.preserved.every(item=>item.value==='10'));
 assert.ok(result.proposals.every(item=>item.value==='80*50*12'&&item.origin==='ai-estimate'));
});
test('explicit common/option blanks and underlying option manual blank are preserved independently',()=>{
 const f=fixture(),fields=f.view().resolved.schema.fields,weight=fields.find(field=>field.id==='packagedWeightG'),dimensions=fields.find(field=>field.id==='packagedDimensionsMm');
 f.state.overrides.common[weight.id]='';f.state.overrides.options[f.options.rows[0].id]={[dimensions.id]:''};
 f.options.rows[1].provenance.packagedHeightMm='manual';f.options.rows[1].packagedHeightMm=null;
 const result=helper.completeQuotationPackagingDraft(f.plan());assert.equal(result.proposals.length,0);assert.ok(result.preserved.every(item=>/직접 수정/.test(item.reason)));
});
test('partial collected dimensions stay fixed and inferred thin axes are never enlarged',()=>{
 const f=fixture();for(const row of f.options.rows){row.packagingUnitsPerPack=1;row.packagedWidthMm=50;row.provenance.packagedWidthMm='collected';}
 const plan=f.plan(),result=helper.completeQuotationPackagingDraft(plan,qwen(plan.targets.map((_,index)=>({index,weightG:30,widthMm:999,lengthMm:80,heightMm:3}))),1);
 assert.ok(result.proposals.filter(item=>item.value.includes('*')).every(item=>item.value==='50*80*3'&&item.origin==='ai-estimate'));
});

test('valid AI abstention leaves missing fields untouched instead of supplying fallback measurements',()=>{
 for(const packages of [[],[{index:0}],[{index:0,widthMm:80,lengthMm:50}]]){
  const f=fixture(),plan=f.plan(),before=JSON.stringify({saved:f.saved,plan});
  const result=helper.completeQuotationPackagingDraft(plan,qwen(packages),1);
  assert.equal(result.proposals.length,0);assert.equal(result.aiRequests,1);
  assert.ok(result.warnings.some(message=>message.includes('근거가 부족')));
  assert.equal(JSON.stringify({saved:f.saved,plan}),before);
  assert.equal(helper.quotationPackagingDraftChanges(f.view(),result,f.product.id,f.scope).length,0);
 }
});

test('generic all-minimum and too-small AI dimensions are withheld without clamping or replacement',()=>{
 for(const size of [10,1,9]){
  const f=fixture(),plan=f.plan();
  const result=helper.completeQuotationPackagingDraft(plan,qwen(plan.targets.map((_,index)=>({index,weightG:30,widthMm:size,lengthMm:size,heightMm:size}))),1);
  assert.equal(result.proposals.length,plan.targets.length);
  assert.ok(result.proposals.every(item=>item.value==='30'&&item.origin==='ai-estimate'));
  assert.ok(result.warnings.some(message=>message.includes('추정값으로 제안하지 않았습니다')));
  assert.equal(result.proposals.some(item=>item.origin==='couplus-fallback'),false);
 }
});

test('saved and collected small package dimensions stay unchanged even at the former generic boundary',()=>{
 for(const size of [10,1])for(const provenance of ['collected','manual']){
  const f=fixture();for(const row of f.options.rows){
   Object.assign(row,{packagingUnitsPerPack:1,packagedWeightG:10,packagedWidthMm:size,packagedLengthMm:size,packagedHeightMm:size});
   for(const key of ['packagedWeightG','packagedWidthMm','packagedLengthMm','packagedHeightMm'])row.provenance[key]=provenance;
  }
  const before=JSON.stringify(f.options),plan=f.plan(),result=helper.completeQuotationPackagingDraft(plan);
  assert.equal(plan.targets.length,0);assert.equal(result.proposals.length,0);
  assert.ok(result.preserved.some(item=>item.value===[size,size,size].join('*')));
  assert.ok(result.preserved.some(item=>item.value==='10'));assert.equal(JSON.stringify(f.options),before);
 }
});
test('old or unknown sale-pack basis cannot be borrowed or overwritten by estimates',()=>{
 for(const basis of [1,undefined]){const f=fixture();for(const row of f.options.rows){row.unitsPerPack=3;row.packagedWeightG=10;row.packagingUnitsPerPack=basis;row.provenance.packagedWeightG='collected';}
  const plan=f.plan();assert.equal(plan.targets.length,0);assert.equal(helper.completeQuotationPackagingDraft(plan).proposals.length,0);assert.ok(plan.preserved.every(item=>item.reason.includes('현재 3개입')));
 }
});
test('numeric limits, duplicate/foreign indices and model-specific malformed output give clearly marked fallback only',()=>{
 const f=fixture(),plan=f.plan();
 for(const raw of [qwen([{index:0,weightG:-1,widthMm:20,lengthMm:20,heightMm:20}]),qwen([{index:99,weightG:10}]),qwen([{index:0,weightG:20},{index:0,weightG:30}]),
  qwen([{index:0,weightG:1.5,widthMm:20,lengthMm:20,heightMm:20}]),qwen([{index:0,weightG:10,widthMm:1000001,lengthMm:20,heightMm:20}]),{response:{packages:[]}},
 ]){const result=helper.completeQuotationPackagingDraft(plan,raw,1);assert.ok(result.proposals.every(item=>item.origin==='couplus-fallback'));assert.equal(result.aiRequests,1);assert.ok(result.warnings.some(item=>item.includes('응답')));}
});
test('plan scope excludes nonincluded options and validates exact current pack quantities',()=>{
 const f=fixture();f.options.rows[1].included=false;const plan=f.plan();assert.equal(plan.targets.length,1);assert.equal(plan.targets[0].optionId,f.options.rows[0].id);
 assert.throws(()=>helper.buildQuotationPackagingDraftPlan(f.view(),f.options,facts,{optionId:f.options.rows[1].id,applyToAllOptions:false}));
 const view=f.view();view.optionPackQuantities[f.options.rows[0].id]=4;assert.throws(()=>helper.buildQuotationPackagingDraftPlan(view,f.options,facts,f.scope));
});
test('stale option quantity/category/schema/manual edits cannot stage a previously generated proposal',()=>{
 const f=fixture(),result=helper.completeQuotationPackagingDraft(f.plan()),before=f.view();
 for(const mutate of [view=>view.optionRevision++,view=>view.revision++,view=>view.inputFingerprint='b'.repeat(64),view=>view.categoryContext.profileId='other',view=>view.optionPackQuantities[f.options.rows[0].id]=2,
  view=>{const item=result.proposals[0];view.resolved.rows.find(row=>row.optionId===item.optionId).fields[item.fieldKey]={value:'',source:'manual-option',issues:[],needsReview:true};},
 ]){const changed=plain(before);mutate(changed);assert.throws(()=>helper.quotationPackagingDraftChanges(changed,result,f.product.id,f.scope));}
});
test('provider request uses public product text/local option indices without invented numeric package context',async()=>{
 const f=fixture(),plan=f.plan(),calls=[];
 const result=await helper.executeQuotationPackagingDraft(plan,{run:async(model,input)=>{calls.push({model,input});const source=JSON.parse(input.messages[1].content.slice(0,-'\n/no_think'.length));
  assert.equal(source.packages[0].index,0);assert.equal(source.packages[0].unitsPerPack,1);assert.equal(Object.hasOwn(source.packages[0],'shippingContext'),false);
  assert.deepEqual(plain(source.packages[0].collectedPackage),{});assert.deepEqual(plain(source.packages[0].reviewedPackage),{});
  assert.doesNotMatch(input.messages[0].content,/weightG["']?\s*:\s*100|widthMm["']?\s*:\s*100|lengthMm["']?\s*:\s*100|heightMm["']?\s*:\s*100/u);
  assert.doesNotMatch(input.messages[0].content,/\b10\b|\b1000\b/u);
  assert.match(input.messages[0].content,/omit that field/);
  assert.match(input.messages[0].content,/too ambiguous for a realistic estimate/);
  assert.deepEqual(plain(input.response_format.json_schema.properties.packages.items.required),['index']);
  for(const privateValue of [f.product.id,f.product.owner_id,f.profile.id,f.options.rows[0].id,f.saved.company.code])assert.ok(!JSON.stringify(source).includes(privateValue));
  return qwen(source.packages.map(({index})=>({index,weightG:20,widthMm:30,lengthMm:40,heightMm:5})));}},new AbortController().signal);
 assert.equal(calls.length,1);assert.equal(calls[0].model,'@cf/qwen/qwen3-30b-a3b-fp8');assert.equal(calls[0].input.max_tokens,2048);assert.equal(calls[0].input.temperature,0);assert.ok(result.proposals.some(item=>item.value==='30*40*5'));
});

test('missing dimensions request type-based estimates for each exact sale pack while protected weight remains context',async()=>{
 const f=fixture();for(const [index,option]of f.options.rows.entries()){
  option.unitsPerPack=index===0?3:1;option.packagingUnitsPerPack=option.unitsPerPack;option.packagedWeightG=index===0?30:10;
  option.provenance.packagedWeightG='manual';option.originalName=index===0?'\u7845\u80f6\u540e\u8ddf\u8d34 \u4e09\u5bf9':'\u7845\u80f6\u540e\u8ddf\u8d34 \u4e00\u5bf9';
 }
 const plan=f.plan(),before=JSON.stringify({options:f.options,plan}),calls=[];
 const result=await helper.executeQuotationPackagingDraft(plan,{run:async(_model,input)=>{
  const instructions=input.messages[0].content,source=JSON.parse(input.messages[1].content.slice(0,-'\n/no_think'.length));calls.push(source);
  assert.match(instructions,/infer a realistic final shipping package from the product type, material and form/);
  assert.match(instructions,/each original option and size, and its exact unitsPerPack/);
  assert.match(instructions,/Exact supplier measurements are not required for an estimate/);
  assert.match(instructions,/sale-pack contents and protective packaging/);
  assert.match(instructions,/each option independently without borrowing other options' specifications/);
  assert.match(instructions,/protected saved package weight.*consistency constraint.*do not replace that weight or multiply it again by unitsPerPack/);
  assert.match(instructions,/Do not omit a field solely because explicit packaging measurements are absent/);
  assert.match(instructions,/Never invent supplier statements or collected measurements/);
  assert.match(instructions,/never claim inferred estimates as measured/);
  assert.match(instructions,/Preserve thin package dimensions/);
  assert.match(instructions,/never substitute generic numeric defaults/);
  assert.deepEqual(plain(source.product),facts);
  assert.deepEqual(source.packages.map(item=>item.unitsPerPack),[3,1]);
  assert.deepEqual(source.packages.map(item=>item.originalName),f.options.rows.map(item=>item.originalName));
  for(const [index,item]of source.packages.entries()){
   assert.deepEqual(plain(item.collectedPackage),{});
   assert.deepEqual(plain(item.reviewedPackage.weight),{origin:'saved-quotation',source:'option',measured:false,values:{weightG:index===0?30:10}});
  }
  return qwen(source.packages.map(({index})=>({index,weightG:999,widthMm:60,lengthMm:80,heightMm:index===0?12:4})));
 }},new AbortController().signal);
 assert.equal(calls.length,1);assert.equal(JSON.stringify({options:f.options,plan}),before);
 assert.equal(result.proposals.length,2);assert.ok(result.proposals.every(item=>item.origin==='ai-estimate'&&item.measured===false&&item.value.includes('*')));
 assert.deepEqual(plain(result.proposals.map(item=>item.value)),['60*80*12','60*80*4']);
 assert.deepEqual(plain(result.proposals.map(item=>item.unitsPerPack)),[3,1]);
});

test('a current sealed common10g quotation value reaches size-only AI as reviewed context, never collected',async()=>{
 const f=fixture({count:3}),basis=load('app/quotation-packaging-basis.ts'),before=f.view(),field=before.resolved.schema.fields.find(item=>item.hubInput==='packagedWeightG')??before.resolved.schema.fields.find(item=>item.id==='packagedWeightG');
 f.state.overrides.common[field.id]='10';const view=f.view();view.packagingBasis=basis.applyQuotationPackagingBasis(undefined,view.resolved.schema.fields,view.optionPackQuantities,[{optionId:null,fieldKey:field.id,value:'10'}]);
 const plan=helper.buildQuotationPackagingDraftPlan(view,f.options,facts,f.scope),snapshot=JSON.stringify({view,options:f.options}),calls=[];
 assert.equal(plan.targets.length,3);assert.ok(plan.targets.every(target=>target.weightField===null&&target.dimensionsField!==null));
 await helper.executeQuotationPackagingDraft(plan,{run:async(_model,input)=>{const source=JSON.parse(input.messages[1].content.slice(0,-'\n/no_think'.length));calls.push(source);
  for(const item of source.packages){assert.deepEqual(plain(item.collectedPackage),{});assert.deepEqual(plain(item.reviewedPackage.weight),{origin:'saved-quotation',source:'manual-common',measured:false,values:{weightG:10}});assert.equal(Object.hasOwn(item,'shippingContext'),false);}
  return qwen(source.packages.map(({index})=>({index,weightG:99,widthMm:40,lengthMm:60,heightMm:10})));}},new AbortController().signal);
 assert.equal(calls.length,1);assert.equal(JSON.stringify({view,options:f.options}),snapshot);
});

test('reviewed context preserves estimate markers and exact weight aliases but excludes blanks, stale seals and unconfirmed legacy values',()=>{
 const f=fixture(),basis=load('app/quotation-packaging-basis.ts'),weightModel=load('app/quotation-packaged-weight.ts'),field=f.view().resolved.schema.fields.find(item=>item.hubInput==='packagedWeightG');
 assert.ok(field);const peer=weightModel.quotationPackagedWeightPeer(f.view().resolved.schema.fields,field.id);assert.ok(peer);
 f.state.overrides.common[peer]='10';const view=f.view(),fields=view.resolved.schema.fields,quantities=view.optionPackQuantities;
 view.packagingBasis=basis.applyQuotationPackagingBasis(undefined,fields,quantities,[{optionId:null,fieldKey:peer,value:'10'}]);
 const mark=view.packagingBasis.common[peer];mark.nonMeasuredDraft={origin:'ai-estimate',measured:false};
 const good=helper.buildQuotationPackagingDraftPlan(view,f.options,facts,f.scope);
 assert.ok(good.targets.every(target=>target.reviewedPackage.weight.values.weightG===10&&target.reviewedPackage.weight.previousEstimateOrigin==='ai-estimate'));
 for(const mutate of [changed=>delete changed.packagingBasis,changed=>{changed.packagingBasis.common[peer].unitsPerPack[f.options.rows[0].id]=2;},
  changed=>{changed.packagingBasis.common[peer].fieldSignature='changed';},changed=>{changed.packagingBasis.common[peer].value='999';},
  changed=>{changed.resolved.rows.find(row=>row.optionId===f.options.rows[0].id).fields[field.id].validationIssues=['not current'];},
 ]){const changed=plain(view);mutate(changed);const plan=helper.buildQuotationPackagingDraftPlan(changed,f.options,facts,f.scope);assert.equal(plan.targets[0].reviewedPackage.weight,undefined);assert.equal(plan.targets[0].weightField,null,'Unusable context must never unprotect the saved value');}
 const blank=f.view();blank.overrides.common[peer]='';for(const row of blank.resolved.rows)if(row.optionId)row.fields[field.id]={value:'',source:'manual-common',issues:[],validationIssues:[],needsReview:true};
 const blankPlan=helper.buildQuotationPackagingDraftPlan(blank,f.options,facts,f.scope);assert.ok(blankPlan.targets.every(target=>target.reviewedPackage.weight===undefined&&target.weightField===null));
});

test('manual option physical values remain reviewed context while only explicitly collected current-basis values are supplier context',()=>{
 const f=fixture();for(const option of f.options.rows){option.packagingUnitsPerPack=1;option.packagedWeightG=10;option.provenance.packagedWeightG='manual';}
 let plan=f.plan();assert.ok(plan.targets.every(target=>target.collected.weightG===undefined&&target.reviewedPackage.weight.values.weightG===10&&target.reviewedPackage.weight.source==='option'));
 for(const option of f.options.rows)option.provenance.packagedWeightG='collected';
 plan=f.plan();assert.ok(plan.targets.every(target=>target.collected.weightG===10));
 for(const option of f.options.rows){option.unitsPerPack=3;option.packagingUnitsPerPack=1;}
 plan=f.plan();assert.equal(plan.targets.length,0);assert.ok(plan.preserved.length>0);
});
test('current sealed saved dimensions are reviewed context for weight-only estimation, retaining non-measured origin',()=>{
 const f=fixture(),basis=load('app/quotation-packaging-basis.ts'),field=f.view().resolved.schema.fields.find(item=>item.hubInput==='packagedDimensionsMm');
 f.state.overrides.common[field.id]='40*60*10';const view=f.view();
 view.packagingBasis=basis.applyQuotationPackagingBasis(undefined,view.resolved.schema.fields,view.optionPackQuantities,[{optionId:null,fieldKey:field.id,value:'40*60*10'}]);
 view.packagingBasis.common[field.id].nonMeasuredDraft={origin:'couplus-fallback',measured:false};
 const plan=helper.buildQuotationPackagingDraftPlan(view,f.options,facts,f.scope);
 assert.ok(plan.targets.every(target=>target.weightField!==null&&target.dimensionsField===null));
 for(const target of plan.targets)assert.deepEqual(plain(target.reviewedPackage.dimensions),{origin:'saved-quotation',source:'manual-common',measured:false,previousEstimateOrigin:'couplus-fallback',values:{widthMm:40,lengthMm:60,heightMm:10}});
 assert.ok(helper.completeQuotationPackagingDraft(plan).proposals.every(item=>!item.value.includes('*')));
});
