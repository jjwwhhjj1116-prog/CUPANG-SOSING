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

for(const missingColor of [false,true])test(`saved Korean option colors allow common legal color generation, adoption and native compilation (${missingColor?'one recognized color':'all recognized'})`,async()=>{
 const {quotationAiApiFixture}=await import('./helpers/quotation-ai-api.mjs'),f=await quotationAiApiFixture();
 const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
 try{
  const source=fixture(),snapshot=source.snapshot,raw=source.raw;
  const common=raw.properties.productPage.properties.commonAttributes.properties,logistics=raw.properties.logisticsPage.properties;
  delete common.count;delete common.booleanValue;delete logistics.skuUnitBoxDimension;delete logistics.skuUnitBoxWeight;
  const otherNotice='관리 시 참고사항';
  raw.properties.legalPage.properties.notices.allOf.push({contains:{type:'object',properties:{noticeItemName:{type:'string',enum:[otherNotice]},noticeItemValue:{type:'string'}}}});
  raw.properties.imagePage.properties.images.properties.labelImages.allOf[0].contains.properties.labelImageType.enum=['제품 한글표시사항 라벨 또는 도안 이미지'];
  function nativeExamples(node){
   if(node.properties){node.required=Object.keys(node.properties);Object.values(node.properties).forEach(nativeExamples);}
   else if(node.allOf){
    node.allOf.forEach(entry=>nativeExamples(entry.contains));
    const [nameKey,valueKey]=Object.keys(node.allOf[0].contains.properties);
    node.examples=[node.allOf.map(entry=>({[nameKey]:entry.contains.properties[nameKey].enum[0],[valueKey]:''}))];
   }else if(!node.enum)node.examples=[node.default??(node.type==='integer'?7:node.type==='boolean'?false:'')];
  }
  nativeExamples(raw);source.syncSchema();
  snapshot.nativeSerializationPolicy=f.h.load('app/supplier-hub-native-form-projection.ts').NATIVE_FORM_SERIALIZATION_POLICY;
  const profiles=f.h.load('db/category-profiles.ts'),profile=await profiles.getCategoryProfile('owner',f.profile.id);
  assert.ok(await profiles.updateCategoryProfile('owner',profile.id,profile.revision,{...profile,hubSchema:snapshot}));
  const now=new Date().toISOString(),optionStore=f.h.load('db/product-options.ts'),previous=await optionStore.readProductOptions('owner',f.id);
  const optionColors=missingColor?colors.map((value,index)=>index===1?value:''):colors;
  const rows=source.options.rows.map((row,index)=>({...row,color:optionColors[index]}));
  rows.push({...rows[0],id:'excluded-color',included:false});
  const options=f.h.load('app/product-options.ts').applyOptionRows(previous,rows,now);
  for(const row of options.rows)row.provenance.color='translated';
  const productVersion=f.h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(f.id).updated_at;
  assert.ok(await optionStore.saveProductOptions('owner',options,previous.revision,productVersion));
  const contentStore=f.h.load('db/product-content.ts'),beforeContent=await contentStore.readProductContent('owner',f.id);
  const content=f.h.load('app/product-content.ts').applyContentPatch(beforeContent,{seo:{description:'합성 견적 참고 자료'}},now);
  const schema=f.h.load('app/quotation-schema.ts').getQuotationSchema(snapshot.categoryId,snapshot.categoryPath,snapshot);
  const legal=schema.fields.find(field=>field.section==='legal'&&field.label==='색상');
  content.initialLegalNotices=f.h.load('app/initial-legal-notices.ts').createInitialLegalNotices(schema,{},now);
  assert.equal(content.initialLegalNotices.fields.find(field=>field.fieldId===legal.id).value,'해당사항없음');
  assert.ok(await contentStore.saveProductContent('owner',content,beforeContent.revision));
  const endpoint=f.base+'/quotation-fields'+f.query,read=()=>f.h.route(endpoint).then(json);
  const save=(view,body)=>f.h.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,...body}}).then(json);
  let before=await save(await read(),{changes:[{optionId:null,fieldKey:'title',value:'검토한 공통 커튼'},{optionId:'excluded-color',fieldKey:legal.id,value:''}]});
  const {readMappedQuotationSource,resolveQuotationExport}=f.h.load('app/exports/quotation-source.ts');
  const savedSource=await readMappedQuotationSource('owner',f.id,f.profile.id);
  const legalCells=input=>plain(resolveQuotationExport(input).rows.filter(row=>row.included).map(row=>[row.fields[legal.id].value,row.fields[legal.id].source]));
  const originalCells=optionColors.map(value=>[value||'해당사항없음',value?'option':'couplus-default']);
  if(missingColor){
   const oldEntries=options.rows.filter(row=>row.included&&!row.color).map(row=>({optionId:row.id,fieldKey:legal.id,value:'샴페인',jobId:'existing-synthetic-job'}));
   const oldAdoption={policy:'owned-job-facts-v1',sourceBasis:'a'.repeat(64),entries:oldEntries};
   const expected=optionColors.map(value=>['샴페인',value?'option':'generated']);
   assert.deepEqual(legalCells({...savedSource,generatedAdoption:oldAdoption}),expected);
   const differentJob={optionId:options.rows[1].id,fieldKey:legal.id,value:'검정',jobId:'different-synthetic-job'};
   assert.deepEqual(legalCells({...savedSource,generatedAdoption:{...oldAdoption,entries:[...oldEntries,differentJob]}}),expected);
   const legacyPartial=legalCells({...savedSource,generatedAdoption:{...oldAdoption,entries:[oldEntries[0],differentJob]}});
   assert.deepEqual(legacyPartial,[['샴페인','generated'],...originalCells.slice(1)]);
  }else{
   const unmarked={...snapshot};delete unmarked.nativeSerializationPolicy;
   assert.deepEqual(legalCells({...savedSource,hubSchema:unmarked}),originalCells);
   const uncaptured={...savedSource.content};delete uncaptured.initialLegalNotices;
   assert.deepEqual(legalCells({...savedSource,content:uncaptured}),originalCells);
   const optionalRaw=structuredClone(raw);optionalRaw.properties.legalPage.required=[];
   const optionalSnapshot={...snapshot,schemaString:JSON.stringify(optionalRaw)};
   const optionalSchema=f.h.load('app/quotation-schema.ts').getQuotationSchema(snapshot.categoryId,snapshot.categoryPath,optionalSnapshot);
   const optionalContent={...savedSource.content,initialLegalNotices:f.h.load('app/initial-legal-notices.ts').createInitialLegalNotices(optionalSchema,{},now)};
   assert.deepEqual(legalCells({...savedSource,hubSchema:optionalSnapshot,content:optionalContent}),originalCells);
   const selectRaw=structuredClone(raw);
   const selectNotice=selectRaw.properties.legalPage.properties.notices.allOf.find(row=>row.contains.properties.noticeItemName.enum[0]==='색상');
   Object.assign(selectNotice.contains.properties.noticeItemValue,{type:['string','null'],enum:[null,...colors]});
   const selectSnapshot={...snapshot,schemaString:JSON.stringify(selectRaw)};
   const selectSchema=f.h.load('app/quotation-schema.ts').getQuotationSchema(snapshot.categoryId,snapshot.categoryPath,selectSnapshot);
   assert.equal(selectSchema.fields.find(field=>field.id===legal.id).type,'select');
   const selectContent={...savedSource.content,initialLegalNotices:f.h.load('app/initial-legal-notices.ts').createInitialLegalNotices(selectSchema,{},now)};
   assert.deepEqual(legalCells({...savedSource,hubSchema:selectSnapshot,content:selectContent}),originalCells);
   const uniform={...options,rows:options.rows.map(row=>({...row,color:'샴페인'}))};
   assert.deepEqual(legalCells({...savedSource,options:uniform}),Array.from({length:6},()=>['샴페인','option']));
   const overrides=structuredClone(savedSource.state.overrides);
   overrides.options[rows[0].id]={[legal.id]:''};
   assert.deepEqual(legalCells({...savedSource,state:{...savedSource.state,overrides}}),[['','manual-option'],...originalCells.slice(1)]);
  }
  const requests=[];
  f.setProvider({async run(_model,input){
   const request=JSON.parse(input.messages[1].content);requests.push(request);
   if(request.task==='ANALYZE_SCHEMA_ATTRIBUTES')return {response:JSON.stringify({differentiatedFieldIds:[]})};
   const changes=request.fields.filter(field=>field.id===legal.id||field.label===otherNotice).map(field=>({fieldKey:field.id,value:field.id===legal.id?'샴페인':'상세설명 참조'}));
   return {response:JSON.stringify({changes})};
  }});
  const project=f.h.load('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument;
  const compile=view=>project({snapshot,company:snapshot.company,categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,resolved:view.resolved});
  if(!missingColor){
   const selectedIndex=1,optionId=options.rows[selectedIndex].id;
   const request=f.requestBody(await json(await f.request(undefined,'GET')));
   const {job:selected}=await json(await f.request({...request,optionId,applyToAllOptions:false}));
   assert.deepEqual(selected.result.changes.filter(change=>change.fieldKey===legal.id),[{optionId,fieldKey:legal.id,value:'샴페인'}]);
   const adopted=await save(before,{changes:[],generatedAdoption:{jobId:selected.id,targets:selected.result.changes.map(({optionId,fieldKey})=>({optionId,fieldKey}))}});
   const readback=await read();
   f.h.load('app/quotation-fields-confirmation.ts').confirmGeneratedQuotationSave(before,adopted,[],selected.result.changes,selected.id,readback);
   const values=readback.resolved.rows.filter(row=>row.included).map(row=>[row.fields[legal.id].value,row.fields[legal.id].source]);
   assert.deepEqual(values,optionColors.map((_,index)=>index===selectedIndex?['샴페인','generated']:['해당사항없음','couplus-default']));
   await assert.rejects(compile(readback),error=>error.code==='SINGLE_NATIVE_SERIALIZATION_UNCONFIRMED');
   before=readback;requests.length=0;
  }
  const {job}=await json(await f.request(f.requestBody(await json(await f.request(undefined,'GET')))));
  assert.equal(job.generationPolicy,policy);
  await save(before,{changes:[],generatedAdoption:{jobId:job.id,targets:job.result.changes.map(({optionId,fieldKey})=>({optionId,fieldKey}))}});
  const saved=await read(),compiled=await compile(saved);
  const included=saved.resolved.rows.filter(row=>row.included),documents=compiled.payload.jsonDocument;
  assert.deepEqual(included.map(row=>[row.fields[legal.id].value,row.fields[legal.id].source]),Array.from({length:6},()=>['샴페인','generated']));
  assert.deepEqual(plain(documents.map(doc=>doc.legalPage.notices.find(row=>row.noticeItemName==='색상').noticeItemValue)),Array(6).fill('샴페인'));
  assert.deepEqual(plain(documents.map(doc=>doc.productPage.commonAttributes.exposedAttributes.find(row=>row.attributeName==='색상').attributeValue)),optionColors.map(value=>value||'해당사항없음'));
  const excluded=saved.resolved.rows.find(row=>row.optionId==='excluded-color').fields[legal.id];
  assert.equal(excluded.value,'');assert.equal(excluded.source,'manual-option');
  assert.deepEqual(requests.filter(request=>request.fields.some(field=>field.id===legal.id)).map(request=>request.task),['GET_COMMON_OTHER_ATTRIBUTES']);
  if(!missingColor){
   const edited=await save(saved,{changes:[{optionId:included[0].optionId,fieldKey:legal.id,value:''}]});
   const values=edited.resolved.rows.filter(row=>row.included).map(row=>[row.fields[legal.id].value,row.fields[legal.id].source]);
   assert.deepEqual(values,[['','manual-option'],...Array.from({length:5},()=>['샴페인','generated'])]);
  }
  assert.deepEqual(f.h.network,[]);
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
