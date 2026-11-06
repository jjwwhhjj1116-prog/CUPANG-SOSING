import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';

const api=providedOptionModule('app/automation/translation.ts'),plain=value=>JSON.parse(JSON.stringify(value));
const revision='couplus-typed-seo-v4',topKeys=['keywords','seoOptions','title'];
const source={title:'旧标题 手腕垫',description:'보존할 판매자 원문 설명',attributes:[{name:'상품속성: 材质',value:'棉'},{name:'상품속성: 用途',value:'사무용'}],provenance:'manual',reference:'inert SEO-only scope',category:{id:'synthetic-pad',path:['손목 패드']}};
const composition={version:'couplus-current-composition-v1',memo:{brand:'',features:'손목 패드 10cm',keywords:'손목패드'},related:{source:'provided',query:'손목패드',keywords:['손목 패드','사무용 패드'],warnings:[]}};
const context=count=>({optionRevision:2,bundleQuantity:null,selectedOptions:Array.from({length:count},(_,index)=>({id:'owned-'+index,name:'黑色 / 10cm',nameTrans:'',color:'黑色',size:'10cm',bundleQuantity:1,manualName:false,manualColor:false,manualSize:false}))});
const noNetwork=()=>assert.fail('No network or live model call');
const bridge=()=>({title:'손목 패드',keywords:['손목 패드'],description:'',attributes:[],warnings:[]});
async function fixture({count=2,extra=false,validationExtra=false,truncated=false}={}){
 const calls=[],config={provider:'workers-ai',model:api.WORKERS_QWEN_MODEL,maxOutputTokens:4096,ai:{run:async(model,input)=>{
  assert.equal(model,api.WORKERS_QWEN_MODEL);calls.push(plain(input));
  if(truncated)return {choices:[{finish_reason:'length',message:{role:'assistant',content:'{"title":"손목 패드","keywords":['}}]};
  const data=JSON.parse(input.messages[1].content.split('\n\nPRODUCT_SOURCE_JSON:\n')[1].slice(0,-'\n/no_think'.length));
  const result=data.validationDraft??{title:Object.hasOwn(data,'optionExamples')?'':'손목 패드',keywords:Object.hasOwn(data,'optionExamples')?[]:['손목 패드','사무용 패드'],seoOptions:data.seoOptionTargets.map(row=>({optionId:row.id,name:'검정 10cm',color:'검정',size:'10cm'}))};
  return {choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({...result,...(extra||validationExtra&&data.validationDraft?{description:'',attributes:[],warnings:[],...(validationExtra?{title:'수용하면 안 되는 검증 제목'}:{})}:{})})}}]};
 }}};
 const review=await api.prepareTranslationReview(plain(source),config,new Date('2026-11-06T00:00:00.000Z'),plain(composition),context(count));
 return{calls,config,review,run:()=>api.executeTranslation(review,config,noNetwork)};
}

test('new typed SEO requests exactly title, keywords and existing seoOptions while keeping current reference facts',async()=>{
 const f=await fixture(),request=api.buildTranslationRequest(f.review),schema=request.text.format.schema;
 assert.deepEqual(Array.from(schema.required).sort(),topKeys);assert.deepEqual(Object.keys(schema.properties).sort(),topKeys);
 assert.equal(f.review.typedSeoPromptRevision,revision);assert.equal(request.max_output_tokens,4096);
 assert.doesNotMatch(request.instructions,/description은|attributes.*번역|warnings.*반환|여섯 키|다섯 키/u);
 const input=JSON.parse(request.input[0].content[0].text);assert.deepEqual(plain(input.materialAndShapeFacts),[source.attributes[0]]);assert.equal(input.effectiveTargetKeyword,'손목패드');assert.equal(input.sourceTitleAuthority,'reference');
 assert.deepEqual(plain(schema.properties.seoOptions.items.properties.optionId.enum),['owned-0','owned-1']);
 assert.deepEqual(Object.keys(schema.properties.seoOptions.items.properties).sort(),['color','name','optionId','size']);
});

test('generation, bounded validation and twenty-option continuation all use TOP3 and local empty non-SEO bridge',async()=>{
 const f=await fixture({count:21}),before=JSON.stringify(f.review),result=await f.run();
 assert.equal(f.calls.length,3);assert.equal(result.draft.description,'');assert.deepEqual(plain(result.draft.attributes),[]);assert.equal(result.seoOptions.length,21);assert.equal(JSON.stringify(f.review),before);
 for(const call of f.calls){assert.deepEqual(Object.keys(call.response_format.json_schema.properties).sort(),topKeys);assert.deepEqual(Array.from(call.response_format.json_schema.required).sort(),topKeys);assert.doesNotMatch(call.messages[0].content,/description은|attributes.*번역|여섯 키|다섯 키/u);}
 const payloads=f.calls.map(call=>JSON.parse(call.messages[1].content.split('\n\nPRODUCT_SOURCE_JSON:\n')[1].slice(0,-'\n/no_think'.length)));
 assert.equal(payloads[0].seoOptionTargets.length,20);assert.deepEqual(payloads[1].seoOptionTargets.map(row=>row.id),['owned-20']);assert.ok(payloads[1].optionExamples.length);
 assert.deepEqual(Object.keys(payloads[2].validationDraft).sort(),topKeys);assert.equal(payloads[2].validationDraft.seoOptions.length,21);
 assert.equal(f.calls[1].response_format.json_schema.properties.title.maxLength,0);assert.equal(f.calls[1].response_format.json_schema.properties.keywords.maxItems,0);
});

test('v4 refuses extra legacy model output fields and never retries a truncated generation',async()=>{
 const extra=await fixture({extra:true});await assert.rejects(extra.run(),error=>error.code==='INVALID_MODEL_OUTPUT');assert.equal(extra.calls.length,1);
 const truncated=await fixture({truncated:true});await assert.rejects(truncated.run(),error=>error.code==='INVALID_MODEL_OUTPUT_QWEN_OUTPUT_TRUNCATED'&&error.mayHaveBeenCharged);assert.equal(truncated.calls.length,1);
});

test('six-key validation output is rejected while the known TOP3 result and local warning remain, without a retry',async()=>{
 const f=await fixture({validationExtra:true}),result=await f.run();assert.equal(f.calls.length,2);assert.equal(result.draft.title,'손목 패드');assert.equal(result.draft.description,'');assert.deepEqual(plain(result.draft.attributes),[]);assert.match(result.draft.warnings.join(' '),/한자 검증 응답을 확인하지 못해/u);
});

test('v4 stored drafts reject non-SEO fields before adoption instead of normalizing or removing them',()=>{
 const validate=draft=>api.validateQwenTranslationDraft(draft,source,'commerce-exact-option-colors-v6','couplus-generated-v1',composition,context(2),'all',revision);
 assert.doesNotThrow(()=>validate(bridge()));
 for(const mutate of [draft=>{draft.description='모델이 추가한 설명';},draft=>{draft.attributes=[{sourceIndex:0,name:'재질',value:'테리폼'}];},draft=>{draft.attributes=[{sourceIndex:99,name:'재질',value:'변조'}];}]){const draft=bridge();mutate(draft);const before=JSON.stringify(draft);assert.throws(()=>validate(draft),error=>error.code==='INVALID_MODEL_OUTPUT');assert.equal(JSON.stringify(draft),before);}
});

test('historical v3/v2/v1/absent full requests, transport, results and fingerprints retain captured bytes',async()=>{
 let code=fs.readFileSync('tests/typed-seo-prompt-revision.test.mjs','utf8');code=code.slice(0,code.indexOf('\ntest(')).replace("'./helpers/provided-option-quotation.mjs'",JSON.stringify(pathToFileURL(process.cwd()+'/tests/helpers/provided-option-quotation.mjs').href));code+='\nexport {api,model,fixture,historicalReview,digest};';
 const h=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const expected={absent:['1c64c61bbc8708de4b2504eebdbb7315b7a6bed824ca41002f08a9c79d13be1f','e9276642b226b815c7374fc14deaa3628d3fe60b580ec2d370e8c64bcc0d6042','155bd3db409292935db50e51a6aae6b52a9f266530b7d60d6d6bb4b60b86c7b7','cd95fc00bb2a5584f92b2d3a9f0bc4737f5e07e65817359cdd260f36081954dd'],'couplus-typed-seo-v1':['cf09f027bb269b885cedcd259f6ad1c05f4ee9fa7a324e53cb9edc956199fc42','af0f94261dfcd0908af9f6ac08988fc885bbdf38b129806c1fae8e659537c053','0cfd5f5b67e4f6fcd2596f7cfc756cc504a0ee1de625d1b70b8db67b92bdb4fb','3b43e6dbc138e87330df047dd135f354c47a49d74c956c8f7de17f55b4fe4a20'],'couplus-typed-seo-v2':['23f3d01c42e2104f6a3b8d99274d60ab740fe7c670db3e7ea6eaae70183619a8','3b0ba3f4f9006c06cc25b8775588234640f673cb875f1d3b861ad614a4d6966f','2b07121da13b93a7b55c2a2fff2d0cf046f1b333808343835c7a7718daf99d42','690270f67cde94c05d3691e1214cf26babb94fc3563e0abd95cfe14a24805204'],'couplus-typed-seo-v3':['23f3d01c42e2104f6a3b8d99274d60ab740fe7c670db3e7ea6eaae70183619a8','3b0ba3f4f9006c06cc25b8775588234640f673cb875f1d3b861ad614a4d6966f','2b07121da13b93a7b55c2a2fff2d0cf046f1b333808343835c7a7718daf99d42','bce22e865bde313a961e67c5665f9b75e434573726024d8d23efc96884fc873d']};
 for(const[key,hashes]of Object.entries(expected)){const f=h.fixture(),review={...h.historicalReview(),...(key==='absent'?{}:{typedSeoPromptRevision:key})},{fingerprint,...signed}=review;void fingerprint;const before=JSON.stringify(review),result=await h.api.executeTranslation(review,f.config,noNetwork);assert.deepEqual([h.digest(h.api.buildTranslationRequest(review)),h.digest(f.calls[0]),h.digest(f.calls),await h.model.fingerprint(signed)],hashes);assert.equal(h.digest({draft:result.draft,seoOptions:result.seoOptions}),'360f99fdb34d2c602c5bf24ea38011c8fb8a155d9da0bfcf4c35f813472554c5');assert.equal(JSON.stringify(review),before);}
});

test('v4 integrated adoption preserves descriptions, category bindings, independent labels and flags while an enabled name link follows title',async()=>{
 const f=await fixture(),result=await f.run(),contentApi=providedOptionModule('app/product-content.ts'),optionApi=providedOptionModule('app/product-options.ts'),integrated=providedOptionModule('app/translation-integrated-adoption.ts'),manual=providedOptionModule('app/translation-adoption.ts');
 for(const linked of [false,true]){
  const content=contentApi.applyContentPatch(contentApi.emptyProductContent('p'),{seo:{description:'기존 수동 설명'},label:{material:'',manufacturer:'독립 제조사'},labelClears:['material']},'2026-11-06T00:00:00.000Z');content.seo.title={value:'이전 상품명',provenance:'collected',updatedAt:null};content.labelProductNameLinked=linked;if(linked)content.label.productName={value:'이전 상품명',provenance:'generated',updatedAt:null};
  content.categoryAttributes={categoryId:source.category.id,jobId:'older-source',values:[{name:'재질',value:'이전 번역 면',sourceName:'상품속성: 材质'}],bindings:[{fieldId:'old-field',fieldSignature:'a'.repeat(64),value:'이전 연결'}],reservedFields:['old-field']};
  const options=optionApi.applyOptionRows(optionApi.emptyProductOptions('p'),context(2).selectedOptions.map(target=>({...optionApi.emptyOptionInput(target.id),originalName:target.name,color:target.color,size:target.size,included:true})),'2026-11-06T00:00:00.000Z');for(const row of options.rows)row.provenance={...row.provenance,translatedName:'unverified',color:'collected',size:'collected'};
  const job={id:'00000000-0000-4000-8000-000000000001',productId:'p',productVersion:'v',contentRevision:content.revision,status:'completed',review:{...f.review,seoCompositionContext:{...f.review.seoCompositionContext,optionRevision:options.revision}},result};
  const before=JSON.stringify({content,options,job}),plan=integrated.integratedTranslationPlan(content,options,job,'v'),saved=contentApi.applyContentPatch(content,plan.patch??{},'next');
  assert.equal(plan.patch?.seo?.description,undefined);assert.equal(plan.patch?.label,undefined);assert.equal(plan.patch?.labelProductNameLinked,undefined);assert.equal(plan.categoryAttributes,undefined);assert.doesNotMatch(plan.skipped.join(' '),/일부 상품 속성 번역이 누락/u);
  assert.deepEqual(plain(saved.seo.description),plain(content.seo.description));assert.deepEqual(plain(saved.categoryAttributes),plain(content.categoryAttributes));assert.deepEqual(plain(saved.label.material),plain(content.label.material));assert.deepEqual(plain(saved.label.manufacturer),plain(content.label.manufacturer));assert.equal(saved.labelProductNameLinked,linked);assert.equal(saved.label.productName.value,linked?result.draft.title:content.label.productName.value);if(linked)assert.ok(plan.preview.some(row=>row.name.includes('SEO 상품명 연동')));
  assert.equal(JSON.stringify({content,options,job}),before);
  assert.throws(()=>manual.translationAdoptionInput(content,job,'v',['description']));
  for(const scope of ['all','options'])for(const mutate of [bad=>{bad.result.draft.description='부당한 설명';},bad=>{bad.result.draft.attributes=[{sourceIndex:99,name:'재질',value:'잘못된 값'}];}]){const bad=plain(job);mutate(bad);assert.throws(()=>integrated.integratedTranslationPlan(content,options,bad,'v',scope));assert.throws(()=>manual.translationAdoptionInput(content,bad,'v',['title']));}
 }
});

test('actual v4 API refuses forged non-SEO fields, preserves old data and completes batch SEO with source description present',async()=>{
 let code=fs.readFileSync('tests/batch-selected-qwen-integration.test.mjs','utf8');code=code.slice(0,code.indexOf('\nfor(const manual')).replace("'./helpers/mobile-intake.mjs'",JSON.stringify(new URL('./helpers/mobile-intake.mjs',import.meta.url).href));code+='\nexport {fixture,translated};';const {fixture:create,translated}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64')),f=await create(),{h}=f;
 const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
 const base='/api/products/'+f.id,payload=table=>JSON.parse(h.sqlite.prepare('SELECT payload FROM '+table+' WHERE product_id=?').get(f.id).payload),version=()=>h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(f.id).updated_at;
 try{
  let current=payload('product_content');await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:current.revision,patch:{seo:{description:'기존 수동 설명을 유지'},label:{material:'',manufacturer:'독립 수동 제조사'},labelClears:['material']}}}));
  current=payload('product_content');current.categoryAttributes={categoryId:'69900',jobId:'old-translation',values:[{name:'재질',value:'기존 번역 재질',sourceName:'상품속성: 材质'}],bindings:[{fieldId:'old-field',fieldSignature:'b'.repeat(64),value:'기존 연결'}]};h.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(current),f.id);
  const rows=payload('product_options');for(const key of ['translatedName','color','size']){rows.rows[0][key]='';rows.rows[0].provenance[key]='manual';}h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(rows),f.id);
  let calls=0;h.bindings.AI={run:async(_model,input)=>{calls++;const data=JSON.parse(input.messages[1].content.split('\n\nPRODUCT_SOURCE_JSON:\n')[1].slice(0,-'\n/no_think'.length));const value=data.validationDraft??{title:f.good.title,keywords:f.good.keywords,seoOptions:data.seoOptionTargets.map(row=>({optionId:row.id,name:row.manualName?row.nameTrans:translated(row.name),color:row.manualColor?row.color:translated(row.color),size:row.manualSize?row.size:translated(row.size)}))};return{choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}]};}};
  const fetcher=(target,init={})=>target==='/api/supplier-hub/catalog-context'?h.load('app/api/supplier-hub/catalog-context/route.ts').GET():h.route(target,{method:init.method??'GET',body:init.body}),inventory=h.load('app/batch-seo-work.ts'),signal=new AbortController().signal,plan=await inventory.planBatchSeoWork([{id:f.id,title:'계약 시험 상품'}],signal,fetcher),task=plan.tasks[0];assert.ok(task);
  await assert.rejects(inventory.refreshBatchSeoWorkTask(task,plan,signal,async(target,init)=>{const response=await fetcher(target,init);if(!target.endsWith('/translation'))return response;const body=await response.json();body.configuration={configured:true,model:'google-translate-gtx',maxOutputTokens:0,issues:[]};return Response.json(body);}));
  const route=h.route;h.route=async(target,options={})=>{const body=typeof options.body==='string'?JSON.parse(options.body):options.body;return target.endsWith('/translation-apply')&&body?.action==='apply'?Response.json({error:'test retains completed job before manual apply'},{status:409}):route(target,options);};await f.run();h.route=route;
  const stored=h.sqlite.prepare("SELECT * FROM translation_jobs WHERE status='completed' ORDER BY created_at DESC").all().find(row=>JSON.parse(row.review).typedSeoPromptRevision===revision);assert.ok(stored,JSON.stringify(h.sqlite.prepare('SELECT status,error FROM translation_jobs').all()));const result=JSON.parse(stored.result),review=JSON.parse(stored.review),snapshot=payload('product_content');
  const state={schemaVersion:1,productId:f.id,productVersion:stored.product_version,contentRevision:stored.content_revision,source:review.source,memo:review.seoComposition.memo,seoComposition:review.seoComposition,optionRevision:review.seoCompositionContext.optionRevision,sourceFingerprint:review.seoCompositionContext.sourceFingerprint,configuration:{configured:true,model:review.model,maxOutputTokens:review.maxOutputTokens},idempotencyKey:crypto.randomUUID(),jobId:stored.id,reviewFingerprint:review.fingerprint,prepareSubmitted:true,approvalSubmitted:true,executeSubmitted:true};
  const outcome=await h.load('app/seo-workspace-draft.ts').refreshSeoWorkspaceDraft(state,{signal,fetcher,onState:()=>{}});assert.equal(outcome.partial,false,'reference-only source description and attributes are not missing translations');assert.equal(outcome.job.id,stored.id);
  const generated=h.load('app/seo-generated-draft.ts'),job={...stored,productId:f.id,productVersion:stored.product_version,contentRevision:stored.content_revision,review,result,error:null},seed=generated.createSeoGeneratedDraft({ownerId:'owner',productVersion:stored.product_version,content:snapshot,options:payload('product_options'),job,brand:'',replaceSaved:true});assert.equal(seed.values.seo.description,undefined);const merged=generated.mergeSeoGeneratedDraft(seed,{productId:f.id,productVersion:stored.product_version,content:snapshot,options:payload('product_options')},'owner',{seo:{description:''},optionNames:{}});assert.equal(merged.seo.description,'');assert.deepEqual(payload('product_content'),snapshot);
  for(const mutate of [bad=>{bad.draft.description='변조 설명';},bad=>{bad.draft.attributes=[{sourceIndex:99,name:'재질',value:'변조 값'}];}]){const bad=plain(result);mutate(bad);h.sqlite.prepare('UPDATE translation_jobs SET result=? WHERE id=?').run(JSON.stringify(bad),stored.id);for(const action of ['preview','apply']){await json(await h.route(base+'/translation-apply',{method:'POST',body:{action,jobId:stored.id,expectedVersion:version(),scope:'all',...(action==='apply'?{fingerprint:'a'.repeat(64)}:{})}}),409);assert.deepEqual(payload('product_content'),snapshot);}}
  h.sqlite.prepare('UPDATE translation_jobs SET result=? WHERE id=?').run(stored.result,stored.id);const preview=await json(await h.route(base+'/translation-apply',{method:'POST',body:{action:'preview',jobId:stored.id,expectedVersion:version(),scope:'all'}}));await json(await h.route(base+'/translation-apply',{method:'POST',body:{action:'apply',jobId:stored.id,expectedVersion:version(),scope:'all',fingerprint:preview.fingerprint}}));
  const saved=payload('product_content');assert.deepEqual(saved.seo.description,snapshot.seo.description);assert.deepEqual(saved.categoryAttributes,snapshot.categoryAttributes);for(const key of ['material','manufacturer'])assert.deepEqual(saved.label[key],snapshot.label[key]);assert.equal(saved.labelProductNameLinked,snapshot.labelProductNameLinked);assert.deepEqual(payload('product_options').rows[0],rows.rows[0]);assert.equal(calls,2);
  const progress=await inventory.refreshBatchSeoWorkProgress(task,plan,signal,fetcher,true);assert.equal(progress.task,null);assert.equal(saved.seo.description.value,'기존 수동 설명을 유지');
  saved.seo.description.provenance='collected';h.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(saved),f.id);const complete=await inventory.planBatchSeoWork([{id:f.id,title:'계약 시험 상품'}],signal,fetcher);assert.equal(complete.tasks.length,0,'a collected description is reference data, not an unfinished Qwen SEO target');
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:saved.revision,patch:{seo:{description:'정상 직접 설명 수정'}}}}));assert.equal(payload('product_content').seo.description.value,'정상 직접 설명 수정');assert.equal(calls,2);assert.equal(h.sqlite.prepare('SELECT result FROM translation_jobs WHERE id=?').get(stored.id).result,stored.result);
 }finally{h.close();}
});
