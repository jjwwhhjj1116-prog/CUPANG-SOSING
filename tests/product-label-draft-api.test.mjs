import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {sizeChartApiFixture,companies,json,plain,allTables} from './helpers/supplier-hub-single-size-chart.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const proofs=[];
const files=['app/product-label-draft.ts','app/api/products/[id]/product-label-draft/route.ts','app/quotation-ai.ts','app/quotation-ai-client.ts','tests/product-label-draft-api.test.mjs'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,sha(fs.readFileSync(file))]));
let frozenHashes;
const fields={content:'2개',material:'실리콘',type:'생활용품'};
const values={netContents:'2개',material:'실리콘',productType:'생활용품'};
const option='synthetic-one';

// All source/category facts and PNGs are synthetic. Real handlers, SQLite,
// ownership and source guards run; only the Workers AI binding is mocked.
async function fixture(company){
 const f=await sizeChartApiFixture(company),{h}=f;
 h.bindings.SOURCEFLOW_QUOTATION_AI_PROVIDER='workers-ai';h.bindings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY='true';
 const copied={...h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.id),id:'other-owned-source',owner_id:'other-owner'};
 const columns=Object.keys(copied);h.sqlite.prepare(`INSERT INTO products(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(key=>copied[key]));
 const context={...plain(h.context),category:{id:f.profile.id,name:f.profile.name,categoryId:f.profile.categoryId,categoryPath:plain(f.profile.categoryPath),mappings:plain(f.profile.mappings),template:null,hubSchema:plain(f.snapshot)},company:plain(company)};
 h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(context),'job');
 h.sqlite.prepare('UPDATE products SET source_url=? WHERE id=?').run(h.sourceUrl,f.id);
 const now=new Date().toISOString();
 const receipt={schemaVersion:1,sourceUrl:h.sourceUrl,offerId:'813724060928',provider:'synthetic-step704',collectedAt:now,title:'合成硅胶收纳用品',description:'合成测试原文',
  attributes:[{name:'材质',value:'硅胶'},{name:'数量',value:'2个'}],options:[{sku:'SYNTHETIC-652',name:'黑色',unitPriceCny:7.1,minimumOrder:1,stock:12}],images:[]};
 await h.load('db/collection-results.ts').storeCollectionResult('owner','job',receipt);
 h.sqlite.prepare('INSERT INTO collection_products VALUES(?,?,?,?)').run('job','owner',f.id,now);
 const contentDB=h.load('db/product-content.ts'),content=await contentDB.readProductContent('owner',f.id);
 const seeded={...content,revision:content.revision+1,updatedAt:now,label:{...content.label,material:{value:'硅胶',provenance:'collected',updatedAt:now},netContents:{value:'2个',provenance:'collected',updatedAt:now}}};
 assert.ok(await contentDB.saveProductContent('owner',seeded,content.revision));
 const labels=f.base+'/product-labels'+f.query,endpoint=f.base+'/product-label-draft'+f.query;
 const read=()=>f.route(labels).then(json);
 const save=async(changes,structure)=>{const view=await read();return json(await f.route(labels,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes,...(structure===undefined?{}:{structure})}}));};
 const calls=[];let provider=async()=>({response:JSON.stringify(fields)});
 h.bindings.AI.run=async(model,input)=>{assert.equal(model,h.load('app/quotation-ai.ts').QUOTATION_AI_MODEL);calls.push({model,input:plain(input)});return provider(model,input);};
 const generate=(view,optionId=option,overrides={})=>f.route(endpoint,{method:'POST',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,optionId,...overrides}});
 // Shared free-provider quota is the sole allowed mutation. Its exact count is
 // asserted separately; every business table and every object stays untouched.
 const state=()=>({db:JSON.stringify(JSON.parse(allTables(f)).filter(([table])=>table!=='quotation_ai_daily')),objects:JSON.stringify([...h.objects].map(([key,bytes])=>[key,sha(bytes)]))});
 const quota=()=>h.sqlite.prepare('SELECT COALESCE(SUM(requests),0) AS n FROM quotation_ai_daily').get().n;
 await read();
 return{...f,labels,endpoint,read,save,generate,calls,state,quota,receipt,setProvider(value){provider=value;}};
}

for(const company of companies)test(`Stage6 Workers draft proposes only three active nonmanual values without saving (${company.code})`,async()=>{
 frozenHashes??=hashes();const f=await fixture(company);
 try{
  const {h}=f,model=h.load('app/product-label-draft.ts');let view=await f.read();
  assert.equal(view.rows.find(row=>row.optionId===option).values.material,'硅胶');
  const before=f.state(),result=await json(await f.generate(view));
  assert.deepEqual(result.values,values);assert.equal(result.productId,f.id);assert.equal(result.optionId,option);assert.equal(result.profileId,f.profile.id);
  assert.equal(result.labelRevision,view.revision);assert.equal(result.inputFingerprint,view.inputFingerprint);assert.equal(result.productVersion,view.productVersion);
  assert.equal(result.provider,'Cloudflare Workers AI');assert.equal(result.model,h.load('app/quotation-ai.ts').QUOTATION_AI_MODEL);assert.ok(Number.isFinite(Date.parse(result.generatedAt)));
  assert.ok(Array.isArray(result.warnings));assert.equal(f.calls.length,1);assert.equal(f.quota(),1);model.verifyProductLabelDraftResult(view,option,result);
  const prompt=JSON.parse(f.calls[0].input.messages[1].content);assert.equal(prompt.task,'KOREAN_LABELS');
  assert.equal(prompt.facts.productName,view.rows.find(row=>row.optionId===option).values.productName);assert.equal(prompt.facts.originalTitle,f.receipt.title);assert.deepEqual(prompt.facts.attributes,f.receipt.attributes);
  assert.equal(prompt.facts.option.optionId,option);assert.equal(prompt.facts.option.originalName,'黑色');assert.equal(prompt.facts.option.unitsPerPack,1);
  assert.deepEqual(prompt.editableFields.map(field=>field.key),['netContents','material','productType']);
  const afterFirst=f.state();assert.deepEqual(afterFirst,before,'AI proposal never writes a label, source, quotation, job, settings or R2 file');
  assert.equal((await f.read()).rows.find(row=>row.optionId===option).values.material,'硅胶','collected value stays original until explicit review/save');
  const common=await json(await f.generate(view,null));assert.deepEqual(common.values,values);assert.equal(common.optionId,null);assert.deepEqual(f.state(),before);
  assert.equal(JSON.parse(f.calls.at(-1).input.messages[1].content).facts.productName,view.rows.find(row=>row.optionId===null).values.productName);
  for(const forged of [{...result,optionId:'synthetic-two'},{...result,inputFingerprint:'0'.repeat(64)},{...result,values:{...result.values,manufacturer:'invented'}},{...result,profileId:'other-profile'}])assert.throws(()=>model.verifyProductLabelDraftResult(view,option,forged));
  const quotation=await json(await f.route(f.base+'/quotation-fields'+f.query));
  const title=h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(quotation.resolved.schema.fields,'title');
  for(const value of ['직접 검토한 옵션 제목','']){
   await f.edit(title.linked.map(fieldKey=>({fieldKey,optionId:option,value})));view=await f.read();const editedState=f.state();
   await json(await f.generate(view));const facts=JSON.parse(f.calls.at(-1).input.messages[1].content).facts;
   assert.equal(facts.productName,value,'the selected saved SEO title, including blank, is the prompt name');assert.equal(facts.originalTitle,f.receipt.title);assert.deepEqual(f.state(),editedState);
  }
  view=await f.save([{optionId:null,fieldKey:'netContents',value:'공통 확인 수량'},{optionId:option,fieldKey:'material',value:''},{optionId:'synthetic-two',fieldKey:'material',value:'수동 재질'},{optionId:'synthetic-excluded',fieldKey:'material',value:'제외 옵션 보존'}]);
  const protectedState=f.state(),partial=await json(await f.generate(view));assert.deepEqual(partial.values,{productType:values.productType});assert.ok(partial.warnings.length);assert.deepEqual(f.state(),protectedState);
  const second=await json(await f.generate(view,'synthetic-two'));assert.deepEqual(second.values,{productType:values.productType});assert.deepEqual(f.state(),protectedState);
  const content=await json(await f.route(f.base+'/content'));
  await json(await f.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:content.content.revision,patch:{label:{productType:''},labelClears:['productType']}}}));
  view=await f.read();let beforeBlocked=f.state(),count=f.calls.length;
  await json(await f.generate(view),409);assert.equal(f.calls.length,count);assert.deepEqual(f.state(),beforeBlocked,'explicit content blank also prevents proposals');
  const structure=h.load('app/product-label.ts').productLabelStructure(view).filter(field=>field.id!=='productType');
  view=await f.save([],structure);beforeBlocked=f.state();await json(await f.generate(view),409);assert.equal(f.calls.length,count);assert.deepEqual(f.state(),beforeBlocked);
  view=await f.save([{optionId:option,fieldKey:'material',value:null}]);
  const deletedState=f.state(),deleted=await json(await f.generate(view));assert.deepEqual(deleted.values,{material:values.material});assert.deepEqual(f.state(),deletedState);
  assert.equal((await f.read()).rows.find(row=>row.optionId==='synthetic-excluded').values.material,'제외 옵션 보존');
  // Valid older manually entered documents omit the optional detail object.
  // The new generator must use their existing SEO description, without a GET
  // backfill or invented collection attributes.
  h.sqlite.prepare('DELETE FROM collection_products WHERE product_id=?').run(f.id);
  h.sqlite.prepare('UPDATE products SET source_url=? WHERE id=?').run('synthetic://legacy-label-draft',f.id);
  const legacyContent=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.id).payload);delete legacyContent.detail;
  h.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(legacyContent),f.id);
  view=await f.read();const legacyState=f.state(),legacy=await json(await f.generate(view));assert.equal(legacy.values.material,'상세정보참조');assert.deepEqual(f.state(),legacyState);
  const legacyFacts=JSON.parse(f.calls.at(-1).input.messages[1].content).facts;assert.deepEqual(legacyFacts.attributes,[]);assert.equal(legacyFacts.description,legacyContent.seo.description.value);
  assert.deepEqual(h.network,[]);assert.equal(f.storage.privatePutAttempts,0);assert.equal(f.storage.publicPutAttempts,0);assert.equal(f.quota(),f.calls.length);
  proofs.push({company,kind:'proposals',syntheticSource:true,proposal:result.values,manualBlankProtected:true,commonValueProtected:true,contentManualProtected:true,deletedFieldOmitted:true,exactOptionSeoAndBlank:true,legacyMissingMaterialEvidenceBlocked:true,
   businessDataAndR2ReadOnly:true,quotaReservations:f.quota(),providerCalls:f.calls.length,apiRequests:f.requests.length,sourceBeforeSha256:sha(before.db),sourceAfterFirstDraftSha256:sha(afterFirst.db)});
 }finally{f.close();}
});

for(const company of companies)test(`Stage6 rejects invented label facts with no business writes and permits original cotton (${company.code})`,async()=>{
 frozenHashes??=hashes();const f=await fixture(company);
 try{
  const {h}=f,receipt={...plain(f.receipt),title:'海绵清洁块',description:'海绵商品说明',attributes:[{name:'材质',value:'海绵'},{name:'包装数量',value:'2个'}]};
  h.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(JSON.stringify(receipt),'job');
  for(const [output,reason]of [[{content:'2개',material:'면 소재',type:'세척 블록'},/면 재질/],[{content:'2쌍',material:'스펀지',type:'세척 블록'},/포장·판매 단위/],[{content:'2개',material:'스펀지',type:'항균 세척 블록'},/항균/]]){
   f.setProvider(async()=>({response:JSON.stringify(output)}));const view=await f.read(),before=f.state(),count=f.calls.length,result=await json(await f.generate(view));
   const rejected=output.material==='면 소재'?'material':output.content==='2쌍'?'netContents':'productType';assert.notEqual(result.values[rejected],output[rejected==='netContents'?'content':rejected==='productType'?'type':'material']);assert.match(result.warnings.join(' '),reason);assert.equal(f.calls.length,count+1);assert.deepEqual(f.state(),before);assert.equal(f.storage.privatePutAttempts,0);assert.equal(f.storage.publicPutAttempts,0);
  }
  receipt.title='纯棉清洁块';receipt.attributes[0].value='纯棉';h.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(JSON.stringify(receipt),'job');
  f.setProvider(async()=>({response:JSON.stringify({content:'2개',material:'순면 소재',type:'세척 블록'})}));let view=await f.read(),before=f.state();assert.equal((await json(await f.generate(view))).values.material,'순면 소재');assert.deepEqual(f.state(),before);
  view=await f.save([{optionId:null,fieldKey:'netContents',value:''},{optionId:option,fieldKey:'material',value:''}]);before=f.state();f.setProvider(async()=>({response:JSON.stringify({content:'999개',material:'실리콘',type:'세척 블록'})}));
  assert.deepEqual((await json(await f.generate(view))).values,{productType:'세척 블록'});assert.deepEqual(f.state(),before);assert.equal((await f.read()).rows.find(row=>row.optionId===option).values.material,'');assert.equal((await f.read()).rows.find(row=>row.optionId===option).values.netContents,'');
  assert.deepEqual(h.network,[]);assert.equal(f.quota(),f.calls.length);
 }finally{f.close();}
});

for(const company of companies)test(`Stage6 draft rejects stale/auth/provider failures and never partially applies (${company.code})`,async()=>{
 frozenHashes??=hashes();const f=await fixture(company);
 try{
  const {h}=f;let view=await f.read(),before=f.state();
  for(const body of [{action:'generate'},{expectedRevision:view.revision+1},{expectedInputFingerprint:'0'.repeat(64)},{optionId:'foreign-option'},{optionId:'synthetic-excluded'}]){
   const response=await f.generate(view,option,body);assert.ok([400,409].includes(response.status),await response.clone().text());assert.equal(f.calls.length,0);assert.deepEqual(f.state(),before);
  }
  for(const config of [{SOURCEFLOW_QUOTATION_AI_PROVIDER:'openai'},{SOURCEFLOW_QUOTATION_AI_FREE_ONLY:'false'}]){
   const saved=Object.fromEntries(Object.keys(config).map(key=>[key,h.bindings[key]]));Object.assign(h.bindings,config);await json(await f.generate(view),503);Object.assign(h.bindings,saved);assert.equal(f.calls.length,0);assert.deepEqual(f.state(),before);
  }
  await json(await f.route(f.endpoint.replace(f.id,'other-owned-source'),{method:'POST',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,optionId:option}}),404);
  await json(await f.route(f.base+'/product-label-draft?profileId=foreign-profile',{method:'POST',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,optionId:option}}),404);
  h.setCompany(companies.find(item=>item.code!==company.code));const wrongCompany=await f.generate(view);assert.ok([403,409].includes(wrongCompany.status));h.setCompany(company);assert.equal(f.calls.length,0);assert.deepEqual(f.state(),before);
  const savedProfile=h.sqlite.prepare('SELECT payload FROM category_profiles WHERE id=?').get(f.profile.id).payload,changedProfile=JSON.parse(savedProfile);
  changedProfile.hubSchema.company=plain(companies.find(item=>item.code!==company.code));
  h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(JSON.stringify(changedProfile),f.profile.id);
  const wrongSchema=f.state();await json(await f.generate(view),409);assert.equal(f.calls.length,0);assert.deepEqual(f.state(),wrongSchema);
  h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(savedProfile,f.profile.id);assert.deepEqual(f.state(),before);
  for(const bad of [{response:'{"content":"2개","material":"실리콘"}'},{response:'{"content":"2개","material":"실리콘","type":"생활용품","country":"KR"}'},{response:'{"content":"2개","material":"실리콘","type":"생활용품","type":"새 값"}'},{response:JSON.stringify({...fields,material:42})}]){
   f.setProvider(async()=>bad);const response=await f.generate(view);assert.ok([422,502,503].includes(response.status),await response.clone().text());assert.deepEqual(f.state(),before);
  }
  f.setProvider(async()=>{throw Error('private upstream token must not escape');});const failed=await f.generate(view);assert.ok([502,503].includes(failed.status));assert.doesNotMatch(await failed.text(),/private upstream token/);assert.deepEqual(f.state(),before);
  f.setProvider(async()=>({response:JSON.stringify({...fields,material:''})}));const empty=await json(await f.generate(view));assert.equal(empty.values.material,'상세정보참조');assert.deepEqual(f.state(),before);
  // A real concurrent manual save advances the label source while inference is
  // in flight. Only that explicit save may remain; the late AI response is stale.
  let concurrent;
  f.setProvider(async()=>{await f.save([{optionId:option,fieldKey:'material',value:'동시 수동 재질'}]);concurrent=f.state();return{response:JSON.stringify(fields)};});
  await json(await f.generate(view),409);assert.deepEqual(f.state(),concurrent);view=await f.read();assert.equal(view.rows.find(row=>row.optionId===option).values.material,'동시 수동 재질');
  before=f.state();const count=f.calls.length;await json(await f.generate(view,option,{expectedInputFingerprint:'0'.repeat(64)}),409);assert.equal(f.calls.length,count);assert.deepEqual(f.state(),before);
  assert.equal(f.quota(),f.calls.length);const counted=f.quota();
  h.sqlite.prepare('UPDATE quotation_ai_daily SET requests=40 WHERE day=?').run(new Date().toISOString().slice(0,10));
  await json(await f.generate(view),429);assert.equal(f.calls.length,count);assert.equal(f.quota(),40);assert.deepEqual(f.state(),before);
  assert.deepEqual(h.network,[]);assert.equal(f.storage.privatePutAttempts,0);assert.equal(f.storage.publicPutAttempts,0);
  proofs.push({company,kind:'guards',malformedResponseRejected:true,providerFailureReadOnly:true,wrongCompanyAndOwnerRejected:true,staleDuringProviderRejected:true,
   concurrentManualSavePreserved:true,freeOnlyBinding:true,quotaReservationsBeforeExhaustion:counted,quotaExhaustedNoProviderCall:true,providerCalls:f.calls.length,apiRequests:f.requests.length});
 }finally{f.close();}
});

test('Stage6 and v4 quotation save the same material from agreeing whole receipt synonyms',async()=>{
 frozenHashes??=hashes();
 const {fixture:receiptFixture}=await import('./helpers/quotation-receipt-source.mjs');
 const material={name:'材质',value:'涤纶'}, {f,h,receipt}=await receiptFixture([material]);
 try{
  const profiles=h.load('db/category-profiles.ts'),profile=await profiles.getCategoryProfile('owner',f.profile.id);
  const raw=JSON.parse(profile.hubSchema.schemaString);
  raw.properties.legalPage.properties.notices.allOf.find(entry=>entry.contains.properties.noticeItemName.enum.includes('소재')).contains.properties.noticeItemName.enum=['제품 소재'];
  delete raw.properties.productPage.properties.unexposedAttributes;
  h.context.category=await profiles.updateCategoryProfile('owner',profile.id,profile.revision,{...profile,hubSchema:{...profile.hubSchema,schemaString:JSON.stringify(raw)}});
  assert.ok(h.context.category);
  h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  const quote=f.base+'/quotation-fields'+f.query, labels=f.base+'/product-labels'+f.query,draft=f.base+'/product-label-draft'+f.query;
  const read=endpoint=>h.route(endpoint).then(json), row=view=>view.rows.find(item=>item.optionId===option);
  const save=(endpoint,view,body,status=200)=>h.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,...body}}).then(response=>json(response,status));
  const q0=await read(quote),field=q0.resolved.schema.fields.find(item=>item.label==='제품 소재');
  const quoteMaterial=view=>row(view.resolved).fields[field.id];
  assert.deepEqual(field.hubWire,{path:['legalPage','notices'],nameKey:'noticeItemName',valueKey:'noticeItemValue',name:'제품 소재'});
  let reply={content:'',material:'상세정보참조',type:'상세정보참조'};
  const labelProvider=()=>f.setProvider({async run(){return {response:JSON.stringify(reply)};}});
  const generate=view=>h.route(draft,{method:'POST',body:{optionId:option,expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint}}).then(json);
  const source=(attributes,description='')=>h.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(JSON.stringify({...receipt,attributes,description}),'job');
  labelProvider();
  for(const [attributes,description] of [[[material,{name:'面料',value:'棉'}],''],[[{...material,value:'100D 涤纶'}],''],[[material],'재질: 폴리에스테르\n재질: 면'],[[material],'재질: 폴리에스테르 80%']]){
   source(attributes,description);
   assert.equal((await generate(await read(labels))).values.material,'상세정보참조');
  }
  source([material,{name:'재질',value:'나일론'}]);
  assert.equal((await generate(await read(labels))).values.material,'나일론');
  const manual=await save(quote,q0,{changes:[{optionId:option,fieldKey:field.id,value:'검토한 재질'}]});
  assert.equal((await generate(await read(labels))).values.material,'검토한 재질');
  const cleared=await save(quote,manual,{changes:[{optionId:option,fieldKey:field.id,value:null}]});
  source([material,{name:'面料',value:'聚酯纤维'}]);
  f.setProvider({async run(_model,input){
   const request=JSON.parse(input.messages[1].content),changes=request.fields.filter(item=>item.id===field.id).map(item=>({fieldKey:item.id,value:'涤纶'}));
   return {response:JSON.stringify(request.task==='ANALYZE_SCHEMA_ATTRIBUTES'?{differentiatedFieldIds:[]}:{changes})};
  }});
  const job=(await json(await f.request(f.requestBody(await json(await f.request(undefined,'GET')))))).job;
  const client=h.load('app/quotation-ai-client.ts'),generationFacts=job.generationFacts;
  assert.equal(job.generationPolicy,client.QUOTATION_GENERATION_POLICY);
  assert.deepEqual(generationFacts.material.map(pair=>pair.value),['涤纶','聚酯纤维']);
  assert.match(client.quotationAiGenerationIssue(field,option,'폴리에스테르',generationFacts,client.CANONICAL_QUOTATION_GENERATION_POLICY),/상충/);
  const issue=(value,facts=generationFacts,target=field)=>client.quotationAiGenerationIssue(target,option,value,facts,job.generationPolicy);
  assert.ok(issue('涤纶'));
  assert.ok(issue('폴리에스테르',generationFacts,{...field,type:'select',choices:[{value:'면',label:'면'}]}));
  for(const [raw,conflict,value] of [['涤纶','棉','폴리에스테르'],['80% 涤纶','90% 聚酯纤维','폴리에스테르 80%']]){
   const material=generationFacts.material.map((pair,index)=>({...pair,value:index?conflict:raw}));
   assert.match(issue(value,{...generationFacts,material}),/상충/);
  }
  const adopted=await save(quote,await read(quote),{changes:[],generatedAdoption:{jobId:job.id,targets:[{optionId:option,fieldKey:field.id}]}});
  assert.equal(adopted.revision,cleared.revision+1);
  assert.equal(quoteMaterial(adopted).source,'generated');
  assert.equal(quoteMaterial(adopted).value,'폴리에스테르');
  labelProvider();reply={...reply,material:'不明材质'};
  const before=await read(labels),proposal=await generate(before);
  assert.equal(proposal.values.material,'폴리에스테르');
  assert.equal(proposal.classifications.material,'suggestion');
  const processing={optionId:option,values:proposal.values,candidates:proposal.candidates};
  await save(labels,before,{changes:[],automaticProcessing:{...processing,values:{...processing.values,material:'임의 재질'}}},400);
  const saved=await save(labels,before,{changes:[],automaticProcessing:processing}),readback=await read(labels);
  h.load('app/product-label.ts').verifyProcessedProductLabelSave(before,saved,option,proposal.values);
  assert.equal(row(readback).values.material,'폴리에스테르');
  assert.equal(row(readback).sources.material,'label-suggestion');
  assert.equal(quoteMaterial(await read(quote)).value,'폴리에스테르');
  const blank=await save(labels,readback,{changes:[{optionId:option,fieldKey:'material',value:''}]});
  assert.equal(row(blank).values.material,'');
  assert.equal(row(blank).sources.material,'manual-option');
  assert.equal(Object.hasOwn((await generate(blank)).values,'material'),false);
  assert.deepEqual(h.network,[]);
 }finally{f.close();}
});

test.after(()=>{assert.deepEqual(hashes(),frozenHashes,'tested sources stayed fixed');if(process.env.STEP704_API_PROOF_PATH)fs.writeFileSync(process.env.STEP704_API_PROOF_PATH,JSON.stringify({cases:proofs,sourceHashes:frozenHashes,allowedDatabaseMutation:'one existing quotation_ai_daily reservation per provider call',externalRequests:0,browserActions:0,supplierHubWrites:0,operatingProductWrites:0},null,2));});
