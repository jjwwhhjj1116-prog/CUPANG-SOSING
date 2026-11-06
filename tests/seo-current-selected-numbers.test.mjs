import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
const p=providedOptionModule('app/seo-current-policy.ts'),t=providedOptionModule('app/automation/translation.ts'),seo=providedOptionModule('app/seo-generation.ts');
const source={title:'양말',description:'',attributes:[{name:'재질',value:'면'}],provenance:'manual',reference:'synthetic',category:{id:'1',path:['양말']}};
const policy=()=>p.validateSeoCompositionPolicy({version:'couplus-current-composition-v1',memo:{brand:'',features:'',keywords:''},related:{source:'provided',query:'',keywords:['20cm양말'],warnings:[]}});
const selected=patch=>({optionRevision:1,bundleQuantity:null,selectedOptions:[{id:'owned-900',name:'양말',nameTrans:'양말',color:'',size:'',bundleQuantity:1,manualName:false,manualColor:false,manualSize:false,...patch}]});
const draft=()=>({title:'양말',description:'',keywords:['20cm양말','99cm양말','양말'],attributes:[],warnings:[]});
for(const [label,patch]of [['name',{name:'20cm 양말'}],['nameTrans-only',{nameTrans:'20cm 양말'}],['size',{size:'20cm'}]])test('selected '+label+' numeric keyword survives early guard and both generation validators',async()=>{
 const context=selected(patch),composition=policy();assert.deepEqual(Array.from(p.guardCurrentSeoDraft(draft(),source,composition,context).keywords),['20cm양말','양말']);
 const qwen=t.validateQwenTranslationDraft(draft(),source,'commerce-exact-option-colors-v6','couplus-generated-v1',composition,context);assert.deepEqual(Array.from(qwen.keywords),['20cm양말','양말']);
 const configuration=seo.seoGenerationConfiguration({SOURCEFLOW_QUOTATION_AI_PROVIDER:'workers-ai',SOURCEFLOW_QUOTATION_AI_FREE_ONLY:'true',AI:{run:async()=>({})}}),proof={purpose:'seo-generation',version:1,sourceFingerprint:'a'.repeat(64),optionRevision:1,company:{code:'A01526306',name:'유앤채'},memo:composition.memo};
 const review=await seo.prepareSeoGenerationReview(source,proof,configuration,composition,context),result=seo.validateSeoGenerationDraft(draft(),review,true);assert.deepEqual(Array.from(result.keywords),['20cm양말','양말']);
});
test('no context, related/target-only and unselected outside cohort never authorize numeric keywords',()=>{
 for(const context of [undefined,selected({name:'10cm 양말',size:'10cm'})])assert.deepEqual(Array.from(p.guardCurrentSeoDraft(draft(),source,policy(),context).keywords),['양말']);
 const outsideCohort={id:'unselected-20',name:'20cm 양말',size:'20cm'};assert.equal(outsideCohort.size,'20cm');const composition=policy();composition.memo.keywords='20cm양말';composition.related.query='20cm양말';assert.deepEqual(Array.from(p.guardCurrentSeoDraft(draft(),source,composition,selected({name:'10cm 양말'})).keywords),['양말']);
});
test('actual dedicated prepare/approve/execute retains a selected-only numeric keyword in persisted job',async()=>{
 let code=fs.readFileSync('./tests/seo-generation-api.test.mjs','utf8');code=code.slice(0,code.indexOf('\nfor(const company')).replace("'./helpers/mobile-intake.mjs'",JSON.stringify(new URL('./helpers/mobile-intake.mjs',import.meta.url).href));code+='\nexport {fixture};';const {fixture}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64')),f=await fixture({companyCode:'A01464742',companyName:'와이홉'},'work'),{h}=f;
 try{const options=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id).payload);for(let i=0;i<options.rows.length;i++)options.rows[i].included=i===0;Object.assign(options.rows[0],{originalName:'123cm太阳镜',translatedName:'123cm 선글라스',size:'123cm',color:''});Object.assign(options.rows[0].provenance,{translatedName:'collected',size:'collected',color:'collected'});options.revision++;h.sqlite.prepare('UPDATE product_options SET revision=?,payload=? WHERE product_id=?').run(options.revision,JSON.stringify(options),f.id);
 const initial=await(await f.get()).json();assert.ok(!JSON.stringify([initial.source.title,initial.source.description,...initial.source.attributes.map(v=>v.value)]).includes('123cm'));
 const composition={version:'couplus-current-composition-v1',memo:initial.memo,related:{source:'none',query:initial.memo.keywords.trim(),keywords:[],warnings:[]}};let calls=0;h.bindings.AI={run:async(_model,input)=>{calls++;const data=JSON.parse(input.messages[1].content);return {response:JSON.stringify(data.validationDraft??{...f.good,keywords:['123cm선글라스','선글라스'],seoOptions:data.seoOptionTargets.map(target=>({optionId:target.id,name:'123cm 선글라스',size:'123cm'}))})};}};
 const response=await f.post({action:'prepare',expectedVersion:initial.productVersion,expectedContentRevision:initial.contentRevision,expectedOptionRevision:initial.optionRevision,expectedSourceFingerprint:initial.sourceFingerprint,memo:initial.memo,idempotencyKey:crypto.randomUUID(),seoComposition:composition});assert.equal(response.status,201,await response.clone().text());const job=(await response.json()).job;await f.approve(job);const completed=await f.execute(job);assert.equal(completed.job.status,'completed');assert.deepEqual(completed.job.result.draft.keywords,['123cm선글라스','선글라스']);assert.equal(calls,2);const persisted=JSON.parse(h.sqlite.prepare('SELECT result FROM translation_jobs WHERE id=?').get(job.id).result);assert.deepEqual(persisted.draft.keywords,['123cm선글라스','선글라스']);
 }finally{h.close();}
});
