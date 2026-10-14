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
