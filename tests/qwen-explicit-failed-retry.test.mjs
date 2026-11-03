import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

// Reuse the existing real-handler fixture without registering its tests.
// Expose its local transport/configuration; no production behavior is replaced.
const fixtureUrl=new URL('./batch-selected-qwen-integration.test.mjs',import.meta.url),source=fs.readFileSync(fixtureUrl,'utf8'),ast=ts.createSourceFile(fixtureUrl.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declarations=ast.statements.filter(statement=>ts.isVariableStatement(statement)||ts.isFunctionDeclaration(statement)).map(statement=>statement.getText(ast)).join('\n');
assert.ok(declarations.includes('return{h,id,google,generated,requests,immutable,good,run};'));
const {fixture}=vm.runInNewContext(declarations.replace('return{h,id,google,generated,requests,immutable,good,run};','return{h,id,google,generated,requests,immutable,good,run,fetcher,configuration};')+'\n({fixture})',{assert,mobileIntakeHarness,Response,Request,URL,Buffer,crypto,AbortController,TextEncoder});

test('actual failed Qwen batch retries only after explicit same-ledger confirmation, preserving the original failed job and source',async()=>{
 const f=await fixture(),{h}=f;try{
  const keys=new Map(),api=h.load('app/batch-selected-work.ts'),validRun=h.bindings.AI.run,options={stages:['seo'],mode:'full',expectedOwnerId:'owner',signal:new AbortController().signal,fetcher:f.fetcher,keys,newKey:()=>crypto.randomUUID(),onStage:()=>{},seoGenerationConsent:f.configuration};
  let invalidCalls=0,reviewedInstructions,reviewedFormat;h.bindings.AI.run=async(_model,input)=>{invalidCalls++;reviewedInstructions=input.messages[0].content;reviewedFormat=input.response_format;return{choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({title:'한국어秘密',keywords:['선글라스'],description:'원문 상품 설명',attributes:[],warnings:[]})}}]};};
  const originalSource=h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,first=await api.runSelectedBatchProduct(f.id,options);assert.equal(first.stages[0].status,'blocked');assert.equal(invalidCalls,1);
  const failed=h.sqlite.prepare("SELECT * FROM translation_jobs WHERE status='failed' AND json_extract(review,'$.model')=?").get('@cf/qwen/qwen3-30b-a3b-fp8');assert.ok(failed);const retained=JSON.stringify(failed),before=f.requests.length;
  const readback=await(await f.fetcher('/api/products/'+f.id+'/translation',{cache:'no-store'})).json(),storedReview=JSON.parse(failed.review);
  assert.equal(readback.jobs.find(job=>job.id===failed.id).review.qwenTranslationPolicy,'commerce-exact-option-colors-v6');assert.equal(storedReview.qwenTranslationPolicy,'commerce-exact-option-colors-v6');assert.match(reviewedInstructions,/防滑=미끄럼 방지/u);assert.equal(reviewedFormat.type,'json_schema');assert.ok(reviewedFormat.json_schema.properties.title.pattern);
  h.bindings.AI.run=validRun;const result=await api.runSelectedBatchProduct(f.id,{...options,retryFailedQwen:true});assert.equal(result.stages[0].status,'draft',JSON.stringify(result));assert.equal(f.generated.length,1);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(failed.id)),retained);assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,originalSource);
  const later=f.requests.slice(before),prepared=later.filter(request=>request.body?.action==='prepare'),executed=later.filter(request=>request.body?.action==='execute');assert.equal(prepared.length,1);assert.equal(executed.length,1);const completed=h.sqlite.prepare("SELECT * FROM translation_jobs WHERE status='completed' AND json_extract(review,'$.model')=?").get('@cf/qwen/qwen3-30b-a3b-fp8');assert.ok(completed);assert.notEqual(completed.id,failed.id);assert.notEqual(completed.idempotency_key,failed.idempotency_key);assert.equal(prepared[0].body.idempotencyKey,completed.idempotency_key);assert.ok(later.findIndex(request=>request.path.endsWith('/translation')&&!request.body)<later.indexOf(prepared[0]),'the original failed job is read before a new prepare');assert.notEqual(executed[0].body.jobId,failed.id);
 }finally{h.close();}
});


test('source-free Korean waterproof claim fails after one Qwen call without applying or overwriting manual content/options',async()=>{
 const f=await fixture({manual:true}),{h}=f;
 try{
  const validRun=h.bindings.AI.run;let calls=0;
  h.bindings.AI.run=async(...args)=>{calls++;const output=await validRun(...args),draft=JSON.parse(output.choices[0].message.content);draft.title='방수 선글라스';draft.keywords=['방수 선글라스'];output.choices[0].message.content=JSON.stringify(draft);return output;};
  const rows=()=>JSON.stringify(['product_content','product_options','product_quotation_fields'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()]));
  const before=rows(),source=f.immutable(),result=await f.run();
  assert.equal(calls,1);assert.equal(result.stages[0].status,'blocked');assert.equal(rows(),before);assert.equal(f.immutable(),source);
  assert.equal(f.requests.filter(request=>request.path.endsWith('/translation')&&request.body?.action==='execute').length,1);
  assert.equal(f.requests.filter(request=>request.path.endsWith('/translation-apply')&&request.body?.action==='apply').length,0);
  const failed=h.sqlite.prepare("SELECT * FROM translation_jobs WHERE status='failed' AND json_extract(review,'$.model')=?").get('@cf/qwen/qwen3-30b-a3b-fp8');
  assert.equal(JSON.parse(failed.error).code,'QWEN_UNSUPPORTED_CLAIM');assert.equal(failed.result,null);
 }finally{h.close();}
});

test('actual new-policy batch applies clean SEO and required options while omitting an unsafe ordinary attribute and preserving its immutable source',async()=>{
 const f=await fixture(),{h}=f;
 try{
  const validRun=h.bindings.AI.run,sourceBefore=f.immutable();let calls=0,badIndex;
  h.bindings.AI.run=async(...args)=>{
   calls++;const response=await validRun(...args),sent=JSON.parse(args[1].messages[1].content.split('\n\nPRODUCT_SOURCE_JSON:\n')[1].slice(0,-'\n/no_think'.length)),draft=JSON.parse(response.choices[0].message.content);
   badIndex=sent.attributes.find(row=>row.name==='상품속성: 上市年份/季节').sourceIndex;draft.attributes.find(row=>row.sourceIndex===badIndex).value='2099년 여름';response.choices[0].message.content=JSON.stringify(draft);return response;
  };
  const result=await f.run();assert.equal(result.stages[0].status,'blocked',JSON.stringify(result));assert.match(result.stages[0].message,/항목의 저장을 확인/u);assert.match(result.stages[0].message,/일부 원문 번역/u);assert.equal(calls,1);assert.equal(f.immutable(),sourceBefore);
  const job=h.sqlite.prepare("SELECT * FROM translation_jobs WHERE status='completed' AND json_extract(review,'$.model')=?").get('@cf/qwen/qwen3-30b-a3b-fp8');assert.ok(job);
  const saved=JSON.parse(job.result).draft;assert.equal(JSON.parse(job.review).qwenTranslationPolicy,'commerce-exact-option-colors-v6');assert.equal(saved.attributes.some(row=>row.sourceIndex===badIndex),false);assert.ok(saved.warnings.some(value=>value.includes('sourceIndex '+badIndex)&&value.includes('일반 상품속성')));
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload),options=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);
  assert.equal(content.seo.title.value,h.settings.brand+' '+f.good.title);assert.ok(options.rows.every(row=>row.provenance.translatedName==='translated'));assert.ok(!JSON.stringify({content,options}).includes('2099년'));
  assert.equal(f.requests.filter(request=>request.path.endsWith('/translation-apply')&&request.body?.action==='apply').length,1);assert.ok(!h.network.includes('supplier.coupang.com'));
 }finally{h.close();}
});
