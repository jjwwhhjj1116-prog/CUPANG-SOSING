import test from 'node:test';
import assert from 'node:assert/strict';
import {quotationAiApiFixture} from './helpers/quotation-ai-api.mjs';
import {mockProvider,aiFixture,aiModule} from './helpers/quotation-ai.mjs';
import {providedOptionModule as load} from './helpers/provided-option-quotation.mjs';
import {quotationAiUI} from './helpers/quotation-ai-ui.mjs';
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const read=f=>f.h.route(f.base+'/quotation-fields'+f.query).then(json);
const generate=async f=>{const state=await json(await f.request(undefined,'GET'));return(await json(await f.request(f.requestBody(state)))).job;};
const adopt=(f,view,proof)=>f.h.route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,...proof}});

test('interactive review confirms a different exact second job replacing an already generated target',async()=>{
 const f=await quotationAiApiFixture();try{
  const confirmation=f.h.load('app/quotation-fields-confirmation.ts'),client=f.h.load('app/quotation-ai-client.ts');
  const firstJob=await generate(f),before=await read(f),proposal=firstJob.result.changes.find(change=>['empty','schema','couplus-default'].includes(before.resolved.rows.find(row=>row.optionId===change.optionId)?.fields[change.fieldKey]?.source)&&!before.resolved.schema.fields.find(field=>field.id===change.fieldKey)?.choices);assert.ok(proposal);
  const first=await json(await adopt(f,before,client.quotationGeneratedSave([proposal],{jobId:firstJob.id,proposals:[proposal]})));
  confirmation.confirmGeneratedQuotationSave(before,first,[],[proposal],firstJob.id);
  f.setProvider(mockProvider({mutate(result){for(const change of result.changes??[])if(change.fieldKey===proposal.fieldKey)change.value='면';for(const row of result.options??[])for(const change of row.changes??[])if(change.fieldKey===proposal.fieldKey)change.value='면';return{response:JSON.stringify(result)};}}));
  const secondJob=await generate(f),previous=await read(f),state=await json(await f.request(undefined,'GET')),replacement=secondJob.result.changes.find(change=>change.fieldKey===proposal.fieldKey&&change.optionId===proposal.optionId);assert.ok(replacement);assert.notEqual(replacement.value,proposal.value);assert.notEqual(secondJob.id,firstJob.id);
  let reviewed;const ui=quotationAiUI({productId:f.id,profileId:f.profile.id,view:previous,optionId:proposal.optionId,disabled:false,onApply:(proposals,fingerprint,jobId)=>{reviewed={proposals,fingerprint,jobId};}},async()=>Response.json(state));
  try{await ui.idle();await ui.click('검토한 초안 입력란에 적용');}finally{ui.unmount();}
  assert.equal(reviewed.jobId,secondJob.id);assert.ok(reviewed.proposals.some(change=>change.fieldKey===replacement.fieldKey&&change.value===replacement.value));
  const proof=client.quotationGeneratedSave([replacement],{jobId:reviewed.jobId,proposals:reviewed.proposals}),saved=await json(await adopt(f,previous,proof));
  assert.equal(saved.resolved.rows.find(row=>row.optionId===replacement.optionId).fields[replacement.fieldKey].value,'면');
  assert.equal(confirmation.confirmGeneratedQuotationSave(previous,saved,[],[replacement],secondJob.id),saved);
  assert.equal((await read(f)).generatedAdoption.entries.find(entry=>entry.fieldKey===replacement.fieldKey&&entry.optionId===replacement.optionId).jobId,secondJob.id);
  const wrong=structuredClone(previous);wrong.automatic.rows.find(row=>row.optionId===replacement.optionId).fields[replacement.fieldKey].source='content';
  assert.throws(()=>confirmation.confirmGeneratedQuotationSave(wrong,saved,[],[replacement],secondJob.id),'unreplaceable live source cannot be confirmed as generated replacement');
  const manual=structuredClone(previous),manualSaved=structuredClone(saved);for(const view of [manual,manualSaved]){view.overrides.options[replacement.optionId]={[replacement.fieldKey]:''};view.resolved.rows.find(row=>row.optionId===replacement.optionId).fields[replacement.fieldKey]={value:'',source:'manual-option'};}
  assert.throws(()=>confirmation.confirmGeneratedQuotationSave(manual,manualSaved,[],[replacement],secondJob.id),'an underlying generated automatic cell does not authorize invisible adoption under a manual blank');
 }finally{f.close();}
});

for(const mode of ['common blank','option blank','deleted','common value','option value'])test(`raw ${mode} material is protected by plan and rejects invisible generated adoption`,async()=>{
 const f=await quotationAiApiFixture();try{
  const source=f.h.load('app/exports/quotation-source.ts'),labels=f.h.load('db/product-labels.ts'),saved=await source.readMappedQuotationSource('owner',f.id,f.profile.id),state=await labels.readProductLabels('owner',f.id);
  const value=mode.includes('value')?'수동 표시 소재':'',overrides=mode.startsWith('option')?{common:{},options:{'synthetic-one':{material:value}}}:{common:{material:value},options:{}};
  const structure=mode==='deleted'?f.h.load('app/product-label.ts').productLabelStructure().filter(field=>field.id!=='material'):undefined;
  assert.ok(await labels.saveProductLabels('owner',f.id,overrides,state.revision,{...saved.source,quotationRevision:saved.state.revision},structure));
  const current=await source.readMappedQuotationSource('owner',f.id,f.profile.id),plan=f.h.load('app/quotation-ai.ts').buildQuotationAiPlan(current,{optionId:null,applyToAllOptions:true}),view=await read(f),field=view.resolved.schema.fields.find(field=>field.section==='legal'&&field.label==='소재');
  assert.ok(!plan.targets[0].writableFieldIds.includes(field.id));assert.ok(plan.targets[0].protectedValues.some(value=>value.fieldKey===field.id));
  const job=await generate(f);assert.ok(!job.result.changes.some(change=>change.fieldKey===field.id));
  const forged={...job.result,changes:[...job.result.changes,{optionId:'synthetic-one',fieldKey:field.id,value:'실리콘'}]};
  f.h.sqlite.prepare('UPDATE quotation_ai_jobs SET result=? WHERE id=?').run(JSON.stringify(forged),job.id);
  const before=f.h.sqlite.prepare('SELECT * FROM product_quotation_fields WHERE product_id=?').get(f.id),calls=f.provider.calls.length;
  await json(await adopt(f,view,{changes:[],generatedAdoption:{jobId:job.id,targets:[{optionId:'synthetic-one',fieldKey:field.id}]}}),400);
  assert.deepEqual(f.h.sqlite.prepare('SELECT * FROM product_quotation_fields WHERE product_id=?').get(f.id),before);assert.equal(f.provider.calls.length,calls);
  assert.equal((await read(f)).resolved.rows.find(row=>row.optionId==='synthetic-one').fields[field.id].value,mode==='deleted'?'':value);
 }finally{f.close();}
});

test('exact live sources are protected without excluding an unrelated same-label hidden placeholder',async()=>{
 const f=aiFixture(),raw=JSON.parse(f.snapshot.schemaString);
 raw.properties.productPage.properties.unexposedAttributes.allOf.push({contains:{type:'object',properties:{attributeName:{type:'string',enum:['소재']},attributeValue:{type:['string','null']}},required:['attributeName','attributeValue']}});
 f.snapshot.schemaString=JSON.stringify(raw);f.options.rows[0].color='검정';f.options.rows[0].provenance.color='collected';
 f.saved.labelsState={schemaVersion:1,productId:f.product.id,revision:1,updatedAt:f.product.updated_at,overrides:{common:{material:''},options:{}}};
 const plan=aiModule().buildQuotationAiPlan(f.saved,f.scope),target=plan.targets[0],notice=plan.fields.find(field=>field.section==='legal'&&field.label==='소재'),hidden=plan.fields.find(field=>field.visibility==='hidden'&&field.label==='소재'),color=plan.fields.find(field=>field.visibility==='exposed'&&field.label==='색상');
 assert.ok(notice&&hidden&&color);assert.ok(target.protectedValues.some(value=>value.fieldKey===notice.id&&value.value===''));assert.ok(target.protectedValues.some(value=>value.fieldKey===color.id));assert.ok(target.writableFieldIds.includes(hidden.id));
 const q=load('app/quotation-schema.ts'),resolved=q.resolveQuotationFields({...f.saved,categoryId:f.snapshot.categoryId,categoryPath:f.snapshot.categoryPath,hubSchema:f.snapshot}),view={revision:0,inputFingerprint:'a'.repeat(64),overrides:f.state.overrides,resolved,automatic:resolved,categoryContext:f.saved.categoryContext,productVersion:f.product.updated_at,contentRevision:f.content.revision,optionRevision:f.options.revision,imageKeys:[]};
 const result=await aiModule().executeQuotationAi(plan,mockProvider()),job={id:'exact-owned-test',status:'completed',fingerprint:'b'.repeat(64),quotationRevision:0,profileId:f.profile.id,scope:f.scope,result,error:null};
 const client=load('app/quotation-ai-client.ts');assert.ok(client.quotationAiProposalChanges(view,job,job.fingerprint).some(change=>change.fieldKey===hidden.id));
 const bad={...job,result:{...result,changes:[{optionId:f.options.rows[0].id,fieldKey:notice.id,value:'면'}]}};assert.throws(()=>client.quotationAiProposalChanges(view,bad,job.fingerprint));
 const manual=structuredClone(view);manual.resolved.rows.find(row=>row.optionId===f.options.rows[0].id).fields[hidden.id].source='manual-option';
 const manualJob={...job,result:{...result,changes:[{optionId:f.options.rows[0].id,fieldKey:hidden.id,value:'면'}]}};assert.throws(()=>client.quotationAiProposalChanges(manual,manualJob,job.fingerprint));
});
