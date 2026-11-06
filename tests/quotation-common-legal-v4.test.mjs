import {historicalGeneration} from './helpers/quotation-historical-generation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {curtain,provider,colors,rawColors} from './helpers/quotation-generation-semantics.mjs';
import {aiModule,plain} from './helpers/quotation-ai.mjs';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
const policy='couplus-common-legal-material-evidence-v4';
function fixture(){const f=curtain();f.options.rows.forEach((r,i)=>{r.originalName=rawColors[i]+' / 100*200cm';});return f;}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
for(const color of ['연보라','샴페인','검정'])test('v4 generates one source-supported common legal color '+color+' while product colors stay differentiated',async()=>{
 const f=fixture(),m=aiModule(),plan=m.buildQuotationAiPlan(f.saved,f.scope,undefined,policy),p=provider({commonColor:color}),before=JSON.stringify(f.saved),result=await m.executeQuotationAi(plan,p);
 const legal=plan.fields.find(x=>x.group==='notice'&&x.label==='색상'),exposed=plan.fields.find(x=>x.group==='exposed'&&x.label==='색상');
 assert.equal(result.changes.filter(c=>c.fieldKey===legal.id).length,6);assert.deepEqual([...new Set(result.changes.filter(c=>c.fieldKey===legal.id).map(c=>c.value))],[color]);
 assert.deepEqual(plain(result.changes.filter(c=>c.fieldKey===exposed.id).map(c=>c.value)),colors);
 assert.ok(p.requests.filter(r=>r.task.startsWith('GET_DIFFERENTIATED')).every(r=>r.fields.every(f=>f.group!=='notice')));
 assert.equal(p.requests.filter(r=>r.fields?.some(f=>f.id===legal.id)).length,1);assert.equal(JSON.stringify(f.saved),before);
});
for(const color of ['연보라, 검정','검정 흰색','빨강','샴페인 / 검정'])test('v4 does not admit combined or unsupported representative '+color,async()=>{
 const f=fixture(),m=aiModule(),plan=m.buildQuotationAiPlan(f.saved,f.scope,undefined,policy),legal=plan.fields.find(x=>x.group==='notice'&&x.label==='색상');
 const result=await m.executeQuotationAi(plan,provider({commonColor:color}));assert.ok(result.changes.every(c=>c.fieldKey!==legal.id));
});
test('v4 server and client reject divergent shared legal results before adoption; protected blanks remain protected',async()=>{
 const f=fixture(),m=aiModule(),plan=m.buildQuotationAiPlan(f.saved,f.scope,undefined,policy),result=await m.executeQuotationAi(plan,provider({commonColor:'검정'}));
 const legal=plan.fields.find(x=>x.group==='notice'&&x.label==='색상'),bad=plain(result.changes);bad.find(c=>c.fieldKey===legal.id).value='샴페인';assert.throws(()=>m.validateCurrentQuotationResult(plan,bad),/공통|고시/);
 const schema=providedOptionModule('app/quotation-schema.ts'),client=providedOptionModule('app/quotation-ai-client.ts'),resolved=schema.resolveQuotationFields({categoryId:f.snapshot.categoryId,categoryPath:f.snapshot.categoryPath,product:f.product,content:f.content,options:f.options,settings:f.saved.settings,hubSchema:f.snapshot,overrides:f.state.overrides});
 const view={revision:0,categoryContext:f.saved.categoryContext,resolved,overrides:f.state.overrides},job={id:'owned',status:'completed',fingerprint:'basis',quotationRevision:0,profileId:f.profile.id,scope:f.scope,generationPolicy:policy,generationFacts:client.quotationAiGenerationFacts(plan.facts),result:{...result,changes:bad}};
 assert.throws(()=>client.quotationAiProposalChanges(view,job,'basis'),/공통|고시/);
 f.state.overrides.options[f.options.rows[0].id]={[legal.id]:''};const protectedPlan=m.buildQuotationAiPlan(f.saved,f.scope,undefined,policy);assert.ok(!protectedPlan.targets[0].writableFieldIds.includes(legal.id));assert.equal(protectedPlan.targets[0].protectedValues.find(v=>v.fieldKey===legal.id).value,'');
});
test('existing v3 plan/request/result bytes and per-option legal colors remain exact',async()=>{
 const f=curtain();f.snapshot.observedAt=1791244800000;f.saved.source.productVersion=f.product.updated_at='2026-10-06T00:00:00.000Z';const m=aiModule(),p=provider(),plan=m.buildQuotationAiPlan(f.saved,f.scope,undefined,'option-notice-material-evidence-v3'),result=await m.executeQuotationAi(plan,p);
 assert.equal(hash({...plan,createdAt:null}),'5c9c20214a3c300e791aeba9347bc555580ea98e2ae567c800052779dc0dab57');assert.equal(hash(p.requests),'073b217affba167edd827454751731b1b72b76c04b0299428d1cba8634c212c6');assert.equal(hash({...result,generatedAt:null}),'11de49b0d33ce5feb75f25902a6a94585fe0d5afb99ebfeeea56eee2e0a58369');
});

test('actual saved multicolor job shares legal notices through apply without rewriting product colors',async()=>{
 const {quotationAiApiFixture}=await import('./helpers/quotation-ai-api.mjs');const f=await quotationAiApiFixture();const json=async(r,status=200)=>{assert.equal(r.status,status,await r.clone().text());return r.json();};
 try{
  const source=fixture(),profiles=f.h.load('db/category-profiles.ts'),profile=await profiles.getCategoryProfile('owner',f.profile.id);
  assert.ok(await profiles.updateCategoryProfile('owner',profile.id,profile.revision,{...profile,hubSchema:source.snapshot}));
  const store=f.h.load('db/product-options.ts'),before=await store.readProductOptions('owner',f.id),model=f.h.load('app/product-options.ts'),options=model.applyOptionRows(before,source.options.rows,new Date().toISOString());options.rows.forEach(r=>r.provenance.color='collected');
  assert.ok(await store.saveProductOptions('owner',options,before.revision,f.h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(f.id).updated_at));
  const p=provider({commonColor:'샴페인'});f.setProvider(p);const state=await json(await f.request(undefined,'GET')),nativeRequest=f.request;historicalGeneration(f,'option-notice-material-evidence-v3');const oldBody=f.requestBody(state),oldJob=await json(await f.request(oldBody)),oldSaved=f.jobs().find(j=>j.id===oldJob.job.id);assert.equal(oldJob.job.generationPolicy,'option-notice-material-evidence-v3');f.request=nativeRequest;
  const callCount=p.requests.length,retry=await json(await f.request(oldBody));assert.equal(retry.reused,true);assert.equal(retry.job.id,oldJob.job.id);assert.equal(p.requests.length,callCount);
  const current=await json(await f.request(undefined,'GET'));assert.equal(current.fingerprint,state.fingerprint);const body=f.requestBody(current),out=await json(await f.request(body));assert.equal(out.job.generationPolicy,policy);assert.notEqual(out.job.id,oldJob.job.id);assert.deepEqual(f.jobs().find(j=>j.id===oldJob.job.id),oldSaved);
  const view=await json(await f.h.route(f.base+'/quotation-fields'+f.query)),legal=view.resolved.schema.fields.find(x=>x.section==='legal'&&x.label==='색상'),exposed=view.resolved.schema.fields.find(x=>x.section==='product'&&x.label==='색상');
  assert.equal(out.job.result.changes.filter(c=>c.fieldKey===legal.id).length,6);
  const bad=structuredClone(out.job.result);bad.changes.find(c=>c.fieldKey===legal.id).value='검정';const original=f.jobs().find(j=>j.id===out.job.id),beforeWrite=f.state();f.h.sqlite.prepare('UPDATE quotation_ai_jobs SET result=? WHERE id=?').run(JSON.stringify(bad),out.job.id);
  await json(await f.h.route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[],generatedAdoption:{jobId:out.job.id,targets:[{optionId:bad.changes[0].optionId,fieldKey:bad.changes[0].fieldKey}]}}}),400);assert.equal(f.state(),beforeWrite);
  f.h.sqlite.prepare('UPDATE quotation_ai_jobs SET result=? WHERE id=?').run(original.result,out.job.id);
  const saved=await json(await f.h.route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[],generatedAdoption:{jobId:out.job.id,targets:out.job.result.changes.map(({optionId,fieldKey})=>({optionId,fieldKey}))}}}));
  const rows=saved.resolved.rows.filter(r=>r.included);assert.deepEqual(rows.map(r=>r.fields[legal.id].value),Array(6).fill('샴페인'));assert.deepEqual(rows.map(r=>r.fields[exposed.id].value),colors);
  assert.equal(f.h.network.length,0);
 }finally{f.close();}
});

test('v4 rejects raw Chinese and unbound whole translated names as a legal representative',()=>{
 const m=aiModule(),client=providedOptionModule('app/quotation-ai-client.ts'),f=fixture(),plan=m.buildQuotationAiPlan(f.saved,f.scope,undefined,policy),field=plan.fields.find(x=>x.group==='notice'&&x.label==='색상'),facts=client.quotationAiGenerationFacts(plan.facts);
 assert.ok(client.quotationAiGenerationIssue(field,facts.options[0].optionId,'浅紫',facts,policy));
 const unbound=plain(facts);unbound.options[0].originalName='浅紫窗帘';unbound.options[0].translatedName='연보라 커튼';assert.ok(client.quotationAiGenerationIssue(field,unbound.options[0].optionId,'연보라 커튼',unbound,policy));
});

test('saved translated color-axis linkage cannot authorize a known extra foreign color',()=>{
 const m=aiModule(),client=providedOptionModule('app/quotation-ai-client.ts'),f=fixture(),plan=m.buildQuotationAiPlan(f.saved,f.scope,undefined,policy),field=plan.fields.find(x=>x.group==='notice'&&x.label==='색상'),facts=plain(client.quotationAiGenerationFacts(plan.facts));
 facts.options[0].translatedName='연보라 검정 / 100*200cm';assert.ok(client.quotationAiGenerationIssue(field,facts.options[0].optionId,'연보라 검정',facts,policy));
});

for(const extra of ['빨강','레드'])test('unselected known color '+extra+' cannot be laundered through a saved translated axis',async()=>{
 const f=fixture(),m=aiModule();f.options.rows[0].translatedName='연보라 '+extra+' / 100*200cm';const plan=m.buildQuotationAiPlan(f.saved,f.scope,undefined,policy),field=plan.fields.find(x=>x.group==='notice'&&x.label==='색상'),client=providedOptionModule('app/quotation-ai-client.ts'),facts=client.quotationAiGenerationFacts(plan.facts),value='연보라 '+extra;
 const result=await m.executeQuotationAi(plan,provider({commonColor:value}));assert.ok(result.changes.every(c=>c.fieldKey!==field.id),'unsupported joined legal color must not be emitted for any option');
 assert.ok(client.quotationAiGenerationIssue(field,facts.options[0].optionId,value,facts,policy));
});

for(const [raw,translated] of [['红色','빨강'],['玫瑰金','로즈 골드']])test('global known-color rejection preserves whole own-source synonym '+translated,async()=>{
 const f=fixture();Object.assign(f.options.rows[0],{color:raw,originalName:raw+' / 100*200cm',translatedName:translated+' / 100*200cm'});const m=aiModule(),plan=m.buildQuotationAiPlan(f.saved,f.scope,undefined,policy),field=plan.fields.find(x=>x.group==='notice'&&x.label==='색상'),result=await m.executeQuotationAi(plan,provider({commonColor:translated}));
 assert.equal(result.changes.filter(c=>c.fieldKey===field.id&&c.value===translated).length,6);
});
