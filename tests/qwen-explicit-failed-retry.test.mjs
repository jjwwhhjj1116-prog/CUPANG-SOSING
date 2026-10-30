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
  let invalidCalls=0;h.bindings.AI.run=async()=>{invalidCalls++;return{choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({title:'한국어秘密',keywords:['선글라스'],description:'원문 상품 설명',attributes:[],warnings:[]})}}]};};
  const originalSource=h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,first=await api.runSelectedBatchProduct(f.id,options);assert.equal(first.stages[0].status,'blocked');assert.equal(invalidCalls,1);
  const failed=h.sqlite.prepare("SELECT * FROM translation_jobs WHERE status='failed' AND json_extract(review,'$.model')=?").get('@cf/qwen/qwen3-30b-a3b-fp8');assert.ok(failed);const retained=JSON.stringify(failed),before=f.requests.length;
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
