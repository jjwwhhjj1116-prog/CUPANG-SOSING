import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import { aiFixture } from './helpers/quotation-ai.mjs';
import {providedOptionModule as load} from './helpers/provided-option-quotation.mjs';
import { quotationAiApiFixture } from './helpers/quotation-ai-api.mjs';
if(process.env.TASK3_BASELINE==='1'){
 const read=fs.readFileSync;fs.readFileSync=function(file,...args){
  const name=String(file).startsWith('file:')?fileURLToPath(file):path.resolve(String(file)),root=process.cwd()+path.sep,relative=name.startsWith(root)?name.slice(root.length):'';
  const baseline=path.join(process.cwd(),'work/task3-baseline',relative);
  return read.call(this,relative&&!relative.startsWith('work')&&fs.existsSync(baseline)&&fs.statSync(baseline).isFile()?baseline:file,...args);
 };
}
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const row=view=>view.resolved.rows.find(row=>row.optionId==='synthetic-one');
test('raw labels advance automatic quotation/export while manual blanks and deleted structure stay protected',async()=>{
 const f=await quotationAiApiFixture();try{
  const sourceModule=f.h.load('app/exports/quotation-source.ts'),labels=f.h.load('db/product-labels.ts');
  const read=()=>f.h.route(f.base+'/quotation-fields'+f.query).then(json);
  async function write(value,structure){const saved=await sourceModule.readMappedQuotationSource('owner',f.id,f.profile.id),state=await labels.readProductLabels('owner',f.id);
   const result=await labels.saveProductLabels('owner',f.id,{common:{material:value},options:{}},state.revision,{...saved.source,quotationRevision:saved.state.revision},structure);assert.ok(result,'label own-write must retain its CAS without self-rejecting');}
  await write('소재 버전 하나');let view=await read();const field=view.resolved.schema.fields.find(field=>field.section==='legal'&&field.label==='소재');
  assert.equal(row(view).fields[field.id].value,'소재 버전 하나');assert.equal(row(view).fields[field.id].source,'content');
  const stale=await sourceModule.readMappedQuotationSource('owner',f.id,f.profile.id);
  await write('소재 버전 둘');view=await read();assert.equal(row(view).fields[field.id].value,'소재 버전 둘');
  assert.equal(await f.h.load('db/quotation-fields.ts').quotationSourcesCurrent('owner',f.id,stale.source),false);
  const current=await sourceModule.readMappedQuotationSource('owner',f.id,f.profile.id);assert.equal(row({resolved:sourceModule.resolveQuotationExport(current)}).fields[field.id].value,'소재 버전 둘');
  view=await json(await f.h.route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:'synthetic-one',fieldKey:field.id,value:''}]}}));
  await write('소재 버전 셋');view=await read();assert.equal(row(view).fields[field.id].value,'');assert.equal(row(view).fields[field.id].source,'manual-option');
  await write('부활 금지',f.h.load('app/product-label.ts').productLabelStructure().filter(field=>field.id!=='material'));
  view=await read();assert.equal(view.automatic.rows.find(row=>row.optionId==='synthetic-one').fields[field.id].value,'');
  assert.equal(f.provider.calls.length,0);
 }finally{f.close();}
});
test('exact completed job adoption persists generated origin through own clock, manual edit/reset and source retirement',async()=>{
 const f=await quotationAiApiFixture();try{
  const state=await json(await f.request(undefined,'GET')),generated=await json(await f.request(f.requestBody(state))),job=generated.job;
  assert.equal(job.status,'completed');const view=await json(await f.h.route(f.base+'/quotation-fields'+f.query));
  const candidates=job.result.changes.filter(change=>['empty','schema','couplus-default'].includes(row(view).fields[change.fieldKey]?.source));assert.ok(candidates.length,'fixture needs an automatic placeholder target');
  const proposal=candidates[0],payload={expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[],generatedAdoption:{jobId:job.id,targets:[{optionId:proposal.optionId,fieldKey:proposal.fieldKey}]}};
  await json(await f.h.route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:{...payload,generatedAdoption:{...payload.generatedAdoption,jobId:'00000000-0000-0000-0000-000000000000'}}}),409);
  let saved=await json(await f.h.route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:payload}));
  assert.equal(row(saved).fields[proposal.fieldKey].source,'generated');assert.equal(row(saved).fields[proposal.fieldKey].value,proposal.value);
  saved=await json(await f.h.route(f.base+'/quotation-fields'+f.query));assert.equal(row(saved).fields[proposal.fieldKey].source,'generated');
  const edit=async value=>json(await f.h.route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:{expectedRevision:saved.revision,expectedInputFingerprint:saved.inputFingerprint,changes:[{optionId:proposal.optionId,fieldKey:proposal.fieldKey,value}]}}));
  saved=await edit('');assert.equal(row(saved).fields[proposal.fieldKey].source,'manual-option');
  saved=await edit(null);assert.equal(row(saved).fields[proposal.fieldKey].source,'generated');
  const contentStore=f.h.load('db/product-content.ts');let content=await contentStore.readProductContent('owner',f.id);
  content.assets.main.value=['owner/new-image.png'];content.revision++;assert.ok(await contentStore.saveProductContent('owner',content,content.revision-1));
  saved=await json(await f.h.route(f.base+'/quotation-fields'+f.query));assert.equal(row(saved).fields[proposal.fieldKey].source,'generated','asset-only source revision preserves independent generated facts');
  content=await contentStore.readProductContent('owner',f.id);content.label.material.value='새 사실';content.revision++;assert.ok(await contentStore.saveProductContent('owner',content,content.revision-1));
  saved=await json(await f.h.route(f.base+'/quotation-fields'+f.query));assert.notEqual(row(saved).fields[proposal.fieldKey].source,'generated');
  assert.equal(f.provider.calls.length,generated.job.result.steps.length);
 }finally{f.close();}
});

for(const categoryId of ['80715','78255'])test(`recorded ${categoryId} minimal exact notice wires stay live in automatic, download and native values`,async()=>{
 const snapshot=JSON.parse(fs.readFileSync(new URL(`./fixtures/task3-${categoryId}-notice-schema.json`,import.meta.url),'utf8'));
 const f=aiFixture({company:snapshot.company,count:1}),q=load('app/quotation-schema.ts'),schema=q.getQuotationSchema(categoryId,snapshot.categoryPath,snapshot);
 f.content.initialLegalNotices=load('app/initial-legal-notices.ts').createInitialLegalNotices(schema,f.saved.settings,f.product.created_at);
 const labels={schemaVersion:1,productId:f.product.id,revision:1,updatedAt:f.product.updated_at,overrides:{common:{material:'시험 소재 하나',netContents:'1쌍'},options:{}}};
 f.content.label.components={value:'시험 구성 목록',provenance:'manual',updatedAt:f.product.updated_at};
 const input={categoryId,categoryPath:snapshot.categoryPath,product:f.product,content:f.content,options:f.options,settings:f.saved.settings,hubSchema:snapshot,labelsState:labels};
 const material=schema.fields.find(field=>field.section==='legal'&&['재질','제품 소재'].includes(field.label));assert.ok(material);
 let resolved=q.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields[material.id].value,'시험 소재 하나');
 labels.overrides.common.material='시험 소재 둘';labels.revision++;resolved=q.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields[material.id].value,'시험 소재 둘');assert.equal(resolved.rows[1].fields[material.id].source,'content');
 const exportRows=load('app/exports/quotation-fields.ts').resolvedQuotationRows({...f.saved,hubSchema:snapshot,categoryContext:{...f.saved.categoryContext,categoryId,categoryPath:snapshot.categoryPath}},resolved,[]);
 assert.equal(exportRows[0][material.id],'시험 소재 둘');
 const projection=await load('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument({snapshot,company:snapshot.company,categoryId,categoryPath:snapshot.categoryPath,resolved});
 const notice=projection.payload.jsonDocument[0].legalPage.notices.find(notice=>notice[material.hubWire.nameKey]===material.label);assert.equal(notice[material.hubWire.valueKey],'시험 소재 둘');
 const components=schema.fields.find(field=>field.label==='제품구성');if(components)assert.equal(resolved.rows[1].fields[components.id].value,'시험 구성 목록');
 const optionId=f.options.rows[0].id;
 labels.overrides.options[optionId]={material:'옵션 표시 소재'};resolved=q.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields[material.id].value,'옵션 표시 소재');
 labels.overrides.options[optionId].material='';resolved=q.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields[material.id].value,'');assert.equal(resolved.rows[1].fields[material.id].source,'content');
 delete labels.overrides.options[optionId];
 const quantity=schema.fields.find(field=>field.hubWire?.name==='수량'&&field.hubWire?.path.join('.')==='productPage.commonAttributes.exposedAttributes');
 if(quantity){resolved=q.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields[quantity.id].value,'1쌍');labels.overrides.common.netContents='';resolved=q.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields[quantity.id].value,'');labels.overrides.common.netContents='1쌍';}
 const color=schema.fields.find(field=>field.hubWire?.name==='색상'&&field.hubWire?.path.join('.')==='productPage.commonAttributes.exposedAttributes');
 if(color&&!color.choices){f.options.rows[0].color='검정';f.options.rows[0].provenance.color='manual';resolved=q.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields[color.id].value,'검정');f.options.rows[0].color='흰색';resolved=q.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields[color.id].value,'흰색');}
 const common=q.resolveQuotationFields({...input,overrides:{common:{[material.id]:'이전 수동 견적'},options:{}}});assert.equal(common.rows[1].fields[material.id].value,'이전 수동 견적');assert.equal(common.rows[1].fields[material.id].source,'manual-common');
 const changes=[{optionId:f.options.rows[0].id,fieldKey:material.id,value:''}];const manual=q.resolveQuotationFields({...input,overrides:q.applyQuotationChanges(q.emptyQuotationOverrides(),changes)});assert.equal(manual.rows[1].fields[material.id].source,'manual-option');assert.equal(manual.rows[1].fields[material.id].value,'');
});

test('adoption rejects foreign, changed-policy, stale, protected and duplicate exact-job proof without product writes',async()=>{
 const f=await quotationAiApiFixture();try{
  const state=await json(await f.request(undefined,'GET')),out=await json(await f.request(f.requestBody(state))),job=out.job,view=await json(await f.h.route(f.base+'/quotation-fields'+f.query));
  const proposal=job.result.changes[0],body={expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[],generatedAdoption:{jobId:job.id,targets:[{optionId:proposal.optionId,fieldKey:proposal.fieldKey}]}};
  const db=f.h.sqlite,original=db.prepare('SELECT * FROM quotation_ai_jobs WHERE id=?').get(job.id),count=f.provider.calls.length;
  for(const mode of ['foreign','company','member','profile','policy','stale','scope','protected','duplicate']){
    db.prepare('UPDATE quotation_ai_jobs SET owner_id=?,review=?,result=? WHERE id=?').run('owner',original.review,original.result,job.id);
    const review=JSON.parse(original.review),payload=structuredClone(body);let status=409;
    if(mode==='foreign')db.prepare('UPDATE quotation_ai_jobs SET owner_id=? WHERE id=?').run('another-owner',job.id);
    else if(mode==='protected'){payload.generatedAdoption.targets=[{optionId:proposal.optionId,fieldKey:'mainImage'}];status=400;}
    else if(mode==='duplicate'){payload.generatedAdoption.targets.push({...payload.generatedAdoption.targets[0]});status=400;}
    else {if(mode==='company')review.company.code='foreign';if(mode==='member')review.member.id='foreign';if(mode==='profile')review.profileId='foreign';if(mode==='policy')review.executionPolicy={policy:'forged'};if(mode==='stale')review.quotationRevision++;if(mode==='scope')review.scope={optionId:'missing',applyToAllOptions:false};db.prepare('UPDATE quotation_ai_jobs SET review=? WHERE id=?').run(JSON.stringify(review),job.id);}
    const before=db.prepare('SELECT * FROM product_quotation_fields WHERE product_id=?').get(f.id);
    await json(await f.h.route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:payload}),status);
    assert.deepEqual(db.prepare('SELECT * FROM product_quotation_fields WHERE product_id=?').get(f.id),before,mode);assert.equal(f.provider.calls.length,count);
  }
 }finally{f.close();}
});
