import test from 'node:test';
import assert from 'node:assert/strict';
import {aiModule,aiFixture,mockProvider,companies} from './helpers/quotation-ai.mjs';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
import {quotationAiUI,nodes} from './helpers/quotation-ai-ui.mjs';
const client=providedOptionModule('app/quotation-ai-client.ts'),schema=providedOptionModule('app/quotation-schema.ts');
async function fixture(company=companies[0]){
  const f=aiFixture({company}),plan=aiModule().buildQuotationAiPlan(f.saved,f.scope),result=await aiModule().executeQuotationAi(plan,mockProvider());
  const resolved=schema.resolveQuotationFields({...f.saved,categoryId:f.snapshot.categoryId,categoryPath:f.snapshot.categoryPath,hubSchema:f.snapshot,overrides:f.state.overrides});
  const view={revision:0,inputFingerprint:'a'.repeat(64),overrides:f.state.overrides,resolved,automatic:resolved,categoryContext:f.saved.categoryContext,productVersion:f.product.updated_at,contentRevision:f.content.revision,optionRevision:f.options.revision,imageKeys:[],submissionReady:false};
  const job={id:'synthetic-job',status:'completed',fingerprint:'b'.repeat(64),quotationRevision:0,profileId:f.profile.id,scope:f.scope,result,error:null};
  const state={configuration:{configured:true,provider:'fixture',model:result.model,freeOnly:true,notice:''},fingerprint:job.fingerprint,productId:f.product.id,productVersion:view.productVersion,contentRevision:view.contentRevision,optionRevision:view.optionRevision,quotationRevision:0,profileId:f.profile.id,jobs:[]};
  return {f,view,job,state};
}
for(const company of companies)test(company.name+': reviewed proposals reach only unsaved permitted targets; manual blank stays protected',async()=>{
  const x=await fixture(company),before=JSON.stringify(x.view),changes=client.quotationAiProposalChanges(x.view,x.job,x.state.fingerprint);assert.ok(changes.length);assert.equal(JSON.stringify(x.view),before);
  const first=changes[0],row=x.view.resolved.rows.find(r=>r.optionId===first.optionId);row.fields[first.fieldKey].source='manual-option';row.fields[first.fieldKey].value='';assert.throws(()=>client.quotationAiProposalChanges(x.view,x.job,x.state.fingerprint));
});
test('stale revision/profile/fingerprint, excluded option, duplicate and unsafe raw wire cannot enter the editor',async()=>{
  for(const kind of ['revision','profile','fingerprint','excluded','duplicate','price','certificate']){const x=await fixture();
    if(kind==='revision')x.view.revision++;if(kind==='profile')x.job.profileId='foreign';if(kind==='fingerprint')x.job.fingerprint='c'.repeat(64);if(kind==='excluded')x.view.resolved.rows.find(row=>row.optionId===x.job.result.changes[0].optionId).included=false;
    if(kind==='duplicate')x.job.result.changes.push({...x.job.result.changes[0]});
    if(kind==='price'||kind==='certificate'){const field=x.view.resolved.schema.fields.find(f=>kind==='price'?f.hubInput==='supplyPrice':f.hubWire?.name==='KC 인증정보');assert.ok(field);x.job.result.changes=[{optionId:x.f.options.rows[0].id,fieldKey:field.id,value:'123'}];}
    assert.throws(()=>client.quotationAiProposalChanges(x.view,x.job,x.state.fingerprint),kind);
  }
});
test('UI defaults to whole-product scope; mount is read-only; turning it off requires an option; generation applies only on review',async()=>{
  const x=await fixture(),applied=[],busy=[];const ui=quotationAiUI({productId:x.f.product.id,profileId:x.f.profile.id,view:x.view,optionId:null,disabled:false,onBusyChange:v=>busy.push(v),onApply:v=>applied.push(v)},async(_url,init)=>Response.json(init?.method==='POST'?{job:x.job,sourceCurrent:true}:x.state));
  await ui.idle();assert.equal(ui.calls.filter(c=>c.method==='POST').length,0);assert.equal(ui.checkbox().props.checked,true);assert.equal(ui.button('AI 처리').props.disabled,false);
  ui.checkbox().props.onChange({target:{checked:false}});assert.equal(ui.button('AI 처리').props.disabled,true);
  ui.checkbox().props.onChange({target:{checked:true}});await ui.click('AI 처리');assert.equal(ui.calls.filter(c=>c.method==='POST').length,1);assert.equal(applied.length,0);assert.deepEqual(busy,[true,false]);
  await ui.click('검토한 초안 입력란에 적용');assert.ok(applied[0].length);assert.deepEqual(ui.calls.map(c=>c.method),['GET','POST']);ui.unmount();
});

for(const company of companies)test(company.name+': existing whole-product AI draft reopens on either option without another provider call and can apply only the selected option',async()=>{
  const x=await fixture(company);x.state.jobs=[x.job];const original=JSON.stringify(x.view);
  for(const option of x.f.options.rows){
    const applied=[],ui=quotationAiUI({productId:x.f.product.id,profileId:x.f.profile.id,view:x.view,optionId:option.id,disabled:false,onApply:v=>applied.push(v)},async()=>Response.json(x.state));
    await ui.idle();assert.equal(ui.checkbox().props.checked,true);assert.equal(ui.button('검토한 초안 입력란에 적용').props.disabled,false);
    ui.checkbox().props.onChange({target:{checked:false}});await ui.click('검토한 초안 입력란에 적용');
    assert.ok(applied[0].length);assert.ok(applied[0].every(change=>change.optionId===option.id));
    assert.deepEqual(ui.calls.map(call=>call.method),['GET']);assert.equal(JSON.stringify(x.view),original);ui.unmount();
  }
});

test('scope selection prefers an exact individual job, rejects stale/profiles, and never widens an individual proposal to all options',async()=>{
  const x=await fixture(),optionId=x.f.options.rows[0].id;
  const individual={...x.job,id:'individual',scope:{optionId,applyToAllOptions:false},result:{...x.job.result,changes:x.job.result.changes.filter(change=>change.optionId===optionId)}};
  x.state.jobs=[{...x.job,id:'old',fingerprint:'c'.repeat(64)},{...x.job,id:'foreign',profileId:'foreign'},individual,x.job];
  assert.equal(client.quotationAiJobForScope(x.state,x.view,x.f.product.id,optionId,false).id,'individual');
  assert.equal(client.quotationAiJobForScope(x.state,x.view,x.f.product.id,optionId,true).id,x.job.id);
  assert.throws(()=>client.quotationAiScopedProposalChanges(x.view,individual,x.state.fingerprint,optionId,true));
  assert.throws(()=>client.quotationAiScopedProposalChanges(x.view,x.job,x.state.fingerprint,null,false));
  assert.equal(client.quotationAiJobForScope({...x.state,quotationRevision:1},x.view,x.f.product.id,optionId,true),null);
});

test('a current-profile unresolved request remains visible across source edits and option scopes and cannot be bypassed by changing scope',async()=>{
  const x=await fixture(),optionId=x.f.options.rows[0].id;
  x.state.jobs=[{...x.job,status:'uncertain',fingerprint:'c'.repeat(64),quotationRevision:9,scope:{optionId:x.f.options.rows[1].id,applyToAllOptions:false},result:null,error:{code:'TIMEOUT',message:'확인 필요',uncertain:true}},x.job];
  const ui=quotationAiUI({productId:x.f.product.id,profileId:x.f.profile.id,view:x.view,optionId,disabled:false,onApply:()=>assert.fail('No apply')},async()=>Response.json(x.state));
  await ui.idle();assert.equal(ui.button('AI 처리').props.disabled,true);assert.equal(ui.checkbox().props.disabled,true);assert.ok(ui.button('불확실한 이전 실행 종료'));
  assert.ok(!ui.button('검토한 초안 입력란에 적용'));assert.deepEqual(ui.calls.map(call=>call.method),['GET']);ui.unmount();
});
test('AI result after saved source changed is neither applied nor reused',async()=>{
  const x=await fixture(),applied=[];const ui=quotationAiUI({productId:x.f.product.id,profileId:x.f.profile.id,view:x.view,optionId:x.f.options.rows[0].id,disabled:false,onApply:v=>applied.push(v)},async(_url,init)=>Response.json(init?.method==='POST'?{job:{...x.job,scope:{optionId:x.f.options.rows[0].id,applyToAllOptions:false}},sourceCurrent:false}:x.state));
  await ui.idle();await ui.click('AI 처리');assert.equal(applied.length,0);assert.equal(ui.button('AI 처리').props.disabled,true);assert.ok(ui.alerts().some(a=>a.includes('바뀌었습니다')));ui.unmount();
});
test('uncertain job is recovered by GET and cannot implicitly execute again; close requires explicit confirmation',async()=>{
  const x=await fixture();x.state.jobs=[{...x.job,status:'uncertain',scope:{optionId:x.f.options.rows[0].id,applyToAllOptions:false},result:null,error:{code:'TIMEOUT',message:'결과 확인 필요',uncertain:true}}];
  const ui=quotationAiUI({productId:x.f.product.id,profileId:x.f.profile.id,view:x.view,optionId:x.f.options.rows[0].id,disabled:false,onApply:()=>assert.fail('No apply')},async(_url,init)=>Response.json(init?.method==='POST'?{job:{...x.state.jobs[0],status:'failed'}}:x.state));
  await ui.idle();assert.equal(ui.button('AI 처리').props.disabled,true);await ui.click('실행 결과 조회');assert.equal(ui.calls.filter(c=>c.method==='POST').length,0);assert.equal(ui.button('불확실한 이전 실행 종료').props.disabled,true);
  ui.checkbox(1).props.onChange({target:{checked:true}});await ui.click('불확실한 이전 실행 종료');assert.equal(ui.calls.at(-1).body.action,'close-uncertain');assert.equal(ui.calls.filter(c=>c.body?.action==='generate').length,0);ui.unmount();
});
test('source change aborts a late GET, clears old review and rebalances generation busy callbacks',async()=>{
  const x=await fixture();let release;const held=new Promise(r=>{release=r;});let post=false;const balances=[];
  const props={productId:x.f.product.id,profileId:x.f.profile.id,view:x.view,optionId:x.f.options.rows[0].id,disabled:false,onBusyChange:v=>balances.push(v),onApply:()=>assert.fail('No stale apply')};
  const ui=quotationAiUI(props,async(_url,init)=>{if(init?.method==='POST'){post=true;await held;return Response.json({job:x.job,sourceCurrent:true});}return Response.json(x.state);});
  await ui.idle();ui.button('AI 처리').props.onClick();for(let i=0;i<20&&!post;i++)await new Promise(r=>setTimeout(r,1));assert.equal(post,true);
  ui.render({...props,view:{...x.view,revision:1},disabled:true});release();await new Promise(r=>setTimeout(r,1));assert.deepEqual(balances,[true,false]);assert.ok(!nodes(ui.render()).some(n=>n.props?.children==='검토한 초안 입력란에 적용'));ui.unmount();
});

async function knownFixture(){
 const x=await fixture(),field={id:'saved-contact',label:'소비자상담 관련 전화번호',section:'legal',visibility:'common',type:'text',required:true,
  hubWire:{path:['legalPage','notices'],name:'소비자상담 관련 전화번호',nameKey:'noticeItemName',valueKey:'noticeItemValue'}};
 x.view.resolved.schema.fields.push(field);
 for(const row of x.view.resolved.rows)row.fields[field.id]={value:'해당사항없음',source:'couplus-default',issues:[]};
 x.state.knownChanges=x.view.resolved.rows.filter(row=>row.included).map(row=>({optionId:row.optionId,fieldKey:field.id,value:'02-1234-5678'}));
 return {...x,field};
}
test('explicit editor previews known saved facts without calling AI and applies only after the existing review button',async()=>{
 const x=await knownFixture(),applied=[],before=JSON.stringify(x.view),ui=quotationAiUI({productId:x.f.product.id,view:x.view,optionId:null,disabled:false,onApply:v=>applied.push(v)},async()=>Response.json(x.state));
 await ui.idle();assert.deepEqual(applied,[]);assert.ok(nodes(ui.render()).some(node=>node.props.children==='저장 정보'));
 await ui.click('검토한 초안 입력란에 적용');assert.equal(applied[0].length,2);assert.ok(applied[0].every(change=>change.fieldKey===x.field.id));
 assert.deepEqual(ui.calls.map(call=>call.method),['GET']);assert.equal(JSON.stringify(x.view),before);ui.unmount();
 // The model itself remains prohibited from manufacturing contact/origin facts.
 x.job.result.changes=x.state.knownChanges;assert.throws(()=>client.quotationAiProposalChanges(x.view,x.job,x.state.fingerprint));
});
test('known sources keep exact scope, stale revisions and manual N/A/blank protected',async()=>{
 for(const mutate of [x=>{x.state.optionRevision++;},x=>{x.state.productId='foreign';},x=>{x.view.overrides.common[x.field.id]='';},
  x=>{x.view.overrides.options[x.state.knownChanges[0].optionId]={[x.field.id]:'해당사항없음'};},x=>{x.state.knownChanges.push({...x.state.knownChanges[0]});},x=>{x.field.hubWire.path=['legalPage','certificates'];}]){
  const x=await knownFixture();mutate(x);assert.throws(()=>client.quotationSavedSourceChanges(x.state,x.view,x.f.product.id,null,true));
 }
 const x=await knownFixture(),id=x.state.knownChanges[1].optionId;
 assert.deepEqual(JSON.parse(JSON.stringify(client.quotationSavedSourceChanges(x.state,x.view,x.f.product.id,id,false))),[x.state.knownChanges[1]]);
 assert.throws(()=>client.quotationSavedSourceChanges(x.state,x.view,x.f.product.id,'foreign',false));
});
test('saved-source values win a conflicting model proposal without widening model permissions',async()=>{
 const x=await fixture(),field=x.view.resolved.schema.fields.find(field=>field.label==='소재'&&field.section==='legal');assert.ok(field);
 for(const row of x.view.resolved.rows)row.fields[field.id]={value:'해당사항없음',source:'couplus-default',issues:[]};
 x.state.knownChanges=x.view.resolved.rows.filter(row=>row.included).map(row=>({optionId:row.optionId,fieldKey:field.id,value:'직접 저장한 소재'}));
 const changes=client.quotationReviewedProposalChanges(x.state,x.view,x.f.product.id,x.job,null,true);
 assert.ok(changes.filter(change=>change.fieldKey===field.id).every(change=>change.value==='직접 저장한 소재'));
 assert.equal(new Set(changes.map(change=>JSON.stringify([change.optionId,change.fieldKey]))).size,changes.length);
});
test('physical quantity proposal copies an exact saved unit only to an unedited text quantity with matching count',async()=>{
 const x=await knownFixture();Object.assign(x.field,{label:'수량',section:'product',visibility:'exposed',hubWire:{path:['productPage','commonAttributes','exposedAttributes'],name:'수량',nameKey:'attributeName',valueKey:'attributeValue'}});
 for(const row of x.view.resolved.rows)row.fields[x.field.id]={value:'1',source:'option'};
 for(const change of x.state.knownChanges)change.value='1쌍';
 assert.equal(client.quotationSavedSourceChanges(x.state,x.view,x.f.product.id,null,true).length,2);
 x.state.knownChanges[0].value='2쌍';assert.throws(()=>client.quotationSavedSourceChanges(x.state,x.view,x.f.product.id,null,true));
 x.state.knownChanges[0].value='1쌍';x.field.type='number';assert.throws(()=>client.quotationSavedSourceChanges(x.state,x.view,x.f.product.id,null,true));
});

async function stageSixSourceFixture(company=companies[0]){
 const x=await fixture(company),field=x.view.resolved.schema.fields.find(field=>field.label==='소재'&&field.section==='legal');assert.ok(field);
 const optionId=x.f.options.rows[0].id,labels={schemaVersion:1,productId:x.f.product.id,revision:1,updatedAt:x.f.product.updated_at,
  overrides:{common:{},options:{[optionId]:{material:'면'}}}};
 const propose=()=>providedOptionModule('app/quotation-known-notice-proposals.ts').quotationKnownNoticeProposals(x.f.product.id,x.view,x.f.content,x.f.scope,x.f.options,labels);
 x.state.knownChanges=propose();return {...x,field,optionId,labels,propose};
}
for(const company of companies)test(company.name+': saved stage-six option material supersedes only its unchanged automatic quotation source',async()=>{
 const x=await stageSixSourceFixture(company),before=JSON.stringify([x.f.content,x.f.options,x.labels,x.view]);
 const stageSix=providedOptionModule('app/product-label.ts').resolveProductLabels({productId:x.f.product.id,state:x.labels,content:x.f.content,options:x.f.options,quotation:x.view,settings:x.f.saved.settings});
 assert.equal(stageSix.find(row=>row.optionId===x.optionId).values.material,'면');
 assert.equal(x.view.resolved.rows.find(row=>row.optionId===x.optionId).fields[x.field.id].value,'실리콘');
 const proposal=x.state.knownChanges.find(change=>change.fieldKey===x.field.id);assert.deepEqual(JSON.parse(JSON.stringify(proposal)),{optionId:x.optionId,fieldKey:x.field.id,value:'면',savedLabel:{revision:1,previousValue:'실리콘'}});
 const changes=client.quotationReviewedProposalChanges(x.state,x.view,x.f.product.id,null,null,true);
 assert.deepEqual(JSON.parse(JSON.stringify(changes)),[{optionId:x.optionId,fieldKey:x.field.id,value:'면'}],'source proof never enters the ordinary quotation save payload');
 const checked=schema.validateQuotationChanges(changes,{schema:x.view.resolved.schema,optionIds:x.f.options.rows.map(row=>row.id),overrides:x.view.overrides});
 const overrides=schema.applyQuotationChanges(x.view.overrides,checked),resolved=schema.resolveQuotationFields({...x.f.saved,categoryId:x.f.snapshot.categoryId,categoryPath:x.f.snapshot.categoryPath,hubSchema:x.f.snapshot,overrides});
 assert.equal(resolved.rows.find(row=>row.optionId===x.optionId).fields[x.field.id].value,'면');
 assert.equal(resolved.rows.find(row=>row.optionId!==x.optionId).fields[x.field.id].value,'실리콘');
 assert.equal(JSON.stringify([x.f.content,x.f.options,x.labels,x.view]),before,'review and proposal reads never alter their sources');
});
test('saved stage-six source proof rejects changed automatic cells, manual quotation blanks and malformed authority',async()=>{
 for(const mutate of [
  x=>{x.view.resolved.rows.find(row=>row.optionId===x.optionId).fields[x.field.id].value='변경된 자동 소재';},
  x=>{x.view.resolved.rows.find(row=>row.optionId===x.optionId).fields[x.field.id].source='manual-option';},
  x=>{x.view.overrides.common[x.field.id]='';},
  x=>{x.view.overrides.options[x.optionId]={[x.field.id]:''};},
  x=>{x.state.knownChanges[0].savedLabel.previousValue='다른 원본';},
  x=>{x.state.knownChanges[0].savedLabel.revision=0;},
  x=>{x.state.knownChanges[0].savedLabel.extra='unexpected';},
  x=>{delete x.state.knownChanges[0].savedLabel;},
  x=>{x.field.hubWire.path=['legalPage','certificates'];},
  x=>{x.view.categoryContext.categoryId='other';},
  x=>{x.view.categoryContext.categoryPath=['다른 카테고리'];},
  x=>{x.view.contentRevision++;},
  x=>{x.view.resolved.rows.find(row=>row.optionId===x.optionId).included=false;},
 ]){
  const x=await stageSixSourceFixture();mutate(x);assert.throws(()=>client.quotationSavedSourceChanges(x.state,x.view,x.f.product.id,null,true));
 }
});
test('stage-six automatic-source replacement requires an explicit active saved label and exact verified lower content',async()=>{
 for(const mutate of [
  x=>{x.labels.overrides.options={};},
  x=>{x.labels.revision=0;},
  x=>{x.labels.overrides.options[x.optionId].material='';},
  x=>{x.labels.overrides.options[x.optionId].material='해당사항없음';},
  x=>{x.labels.structure=providedOptionModule('app/product-label.ts').productLabelStructure().filter(field=>field.id!=='material');},
  x=>{x.f.content.label.material.provenance='generated';},
  x=>{x.f.content.label.material.value='다른 하위 원문';},
  x=>{x.view.overrides.common[x.field.id]='';},
  x=>{x.view.resolved.rows.find(row=>row.optionId===x.optionId).included=false;x.f.options.rows[0].included=false;},
 ]){
  const x=await stageSixSourceFixture();mutate(x);assert.ok(x.propose().every(change=>change.optionId!==x.optionId||change.fieldKey!==x.field.id));
 }
 const x=await stageSixSourceFixture();x.labels.overrides={common:{material:'면'},options:{[x.optionId]:{material:''}}};
 const proposals=x.propose();assert.ok(proposals.every(change=>change.optionId!==x.optionId||change.fieldKey!==x.field.id));
 assert.ok(proposals.some(change=>change.optionId!==x.optionId&&change.fieldKey===x.field.id&&change.value==='면'));
});
