import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {curtain} from './helpers/quotation-generation-semantics.mjs';
import {aiModule,plain} from './helpers/quotation-ai.mjs';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
const root=process.env.QUOTATION_COMMON_LEGAL_PRIVATE_DIR;
test('actual captured 78255 schema and six-option values qualify native only after new v4 shared-legal generation',{skip:!root},async()=>{
 const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8').replace(/^\uFEFF/,''));
 const captured=read('yoofam-step984-ten-new-drafts.json'),snapshot=captured.cases[0].evidence.r5CurrentCollectionJob.context.category.hubSchema;
 assert.equal(createHash('sha256').update(snapshot.schemaString).digest('hex'),'d1c3eba09a8b0ebe8992b6b1b404f5409f2ad683dda55e1878db185777929f06');
 const stored=read('yoofam-step984-r8-curtain-saved-readback.json'),view=stored['quotation-fields'].body,job=stored['quotation-ai'].body.jobs.find(j=>j.id==='7012a5f4-263f-49fe-979f-1b0a18219d37'),before=JSON.stringify(stored);
 const project=providedOptionModule('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument,args={snapshot,company:snapshot.company,categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,nativeSerializationPolicy:'supplier-hub-native-required-form-v1'};
 await assert.rejects(project({...args,resolved:view.resolved}),e=>e.code==='SINGLE_NATIVE_SERIALIZATION_UNCONFIRMED');
 const f=curtain();f.saved.hubSchema=f.snapshot=snapshot;Object.assign(f.profile,{hubSchema:snapshot,categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath});f.saved.categoryContext={source:'profile',profileId:f.profile.id,categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath};
 f.options.rows.forEach((r,i)=>{const source=job.generationFacts.options[i];r.id=source.optionId;r.color=source.color;r.originalName=source.originalName;r.translatedName=source.translatedName;});
 f.saved.collectionSourceFacts={jobId:'private-receipt',offerId:'920067392251',fingerprint:'a'.repeat(64),attributes:[{name:'material',value:'涤纶（聚酯纤维）',sourceName:'材质'}]};
 const m=aiModule(),plan=m.buildQuotationAiPlan(f.saved,f.scope,undefined,'couplus-common-legal-material-evidence-v4'),calls=[],provider={async run(_model,input){const r=JSON.parse(input.messages[1].content);calls.push(r);const changes=(fields,optionId)=>fields.flatMap(field=>{const saved=job.result.changes.find(c=>c.fieldKey===field.id&&(optionId===undefined||c.optionId===optionId));return saved?[{fieldKey:field.id,value:saved.value}]:[];});const out=r.task==='ANALYZE_SCHEMA_ATTRIBUTES'?{differentiatedFieldIds:r.fields.map(f=>f.id)}:r.task.startsWith('GET_DIFFERENTIATED')?{options:r.targets.map(t=>({optionId:t.optionId,changes:changes(r.fields,t.optionId)}))}:{changes:changes(r.fields)};return{response:JSON.stringify(out)};}};
 const result=await m.executeQuotationAi(plan,provider),resolved=structuredClone(view.resolved);for(const c of result.changes){const cell=resolved.rows.find(r=>r.optionId===c.optionId)?.fields[c.fieldKey];if(cell)Object.assign(cell,{value:c.value,source:'generated'});}
 const legal=plan.fields.find(f=>f.group==='notice'&&f.label==='색상');assert.equal(result.changes.filter(c=>c.fieldKey===legal.id).length,6);assert.equal(new Set(result.changes.filter(c=>c.fieldKey===legal.id).map(c=>c.value)).size,1);
 const native=await project({...args,resolved});assert.ok(native.payload.jsonDocument.length);assert.equal(JSON.stringify(stored),before);assert.ok(calls.filter(r=>r.task.startsWith('GET_DIFFERENTIATED')).every(r=>r.fields.every(f=>f.group!=='notice')));assert.equal(plain(result.changes).length,36);
});
