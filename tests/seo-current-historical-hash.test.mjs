import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash,webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const before='.superpowers/sdd/2026-11-06-ten-category-couplus-rules/task-2b-before/';
test('pre-task historical request bytes and digest are unchanged, with and without approved keyword-only policy',()=>{
 const h=mobileIntakeHarness();try{const baseline={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(before+'app/automation/translation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:baseline,Error,URL,TextEncoder,TextDecoder,Date,crypto:webcrypto,require:name=>h.load(name.slice(2)+'.ts')});
 const now=h.load('app/automation/translation.ts'),digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 for(const keywordPolicy of [undefined,'couplus-generated-v1']){
  const review={model:now.WORKERS_QWEN_MODEL,maxOutputTokens:4096,instructionsVersion:'sourceflow-translation-v6',destination:'Cloudflare Workers AI',qwenTranslationPolicy:'commerce-exact-option-colors-v6',...(keywordPolicy?{seoKeywordPolicy:keywordPolicy}:{}),source:{title:'袜子',description:'棉',attributes:[{name:'option:one',value:'白色'}],provenance:'manual',reference:'inert',category:{id:'1',path:['양말']},guidance:{features:'특징',keywords:'양말'}}};
  const previous=baseline.buildTranslationRequest(review),current=now.buildTranslationRequest(review);assert.equal(JSON.stringify(current),JSON.stringify(previous));assert.equal(digest(current),digest(previous));
 }
 }finally{h.close();}
});
