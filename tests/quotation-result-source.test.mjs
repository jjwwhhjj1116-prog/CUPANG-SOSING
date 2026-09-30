import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync(new URL('../app/quotation-result-source.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const prepared={productId:'p',profileId:'profile-1',categoryId:'80719',fingerprint:'a'.repeat(64),filename:'YOOFAM-'+ 'a'.repeat(64)+'.xlsx'};
const body=()=>({fingerprint:prepared.fingerprint,filename:prepared.filename,report:{productId:'p',profileId:'profile-1',categoryId:'80719',submissionReady:false}});
function setup(reply){const exports={},calls=[];vm.runInNewContext(code,{exports,Error,fetch:async(url,init)=>{calls.push({url,init});return reply();}});return {api:exports,calls};}
test('checks saved quotation identity through the lightweight read-only source action before result lookup',async()=>{
 const h=setup(()=>Response.json(body())),controller=new AbortController();
 await h.api.verifyQuotationResultSource(prepared,controller.signal);
 assert.equal(h.calls[0].url,'/api/products/p/quotation');
 assert.deepEqual(JSON.parse(h.calls[0].init.body),{action:'source',profileId:'profile-1'});
 assert.equal(h.calls[0].init.signal,controller.signal);
});
test('changed fingerprint, filename, product, category or profile invalidates prepared result source',async()=>{
 for(const mutate of [v=>v.fingerprint='b'.repeat(64),v=>v.filename='old.xlsx',v=>v.report.productId='other',v=>v.report.categoryId='999',v=>v.report.profileId='other',v=>v.report.submissionReady=true]){
  const value=body();mutate(value);const h=setup(()=>Response.json(value));
  await assert.rejects(h.api.verifyQuotationResultSource(prepared,new AbortController().signal),h.api.QuotationResultSourceChanged);
 }
 for(const value of [null,{},[]]){const h=setup(()=>Response.json(value));await assert.rejects(h.api.verifyQuotationResultSource(prepared,new AbortController().signal),h.api.QuotationResultSourceChanged);}
});
test('conflict invalidates preview but temporary failures do not claim source changed',async()=>{
 for(const status of [409,503,401]){
  const h=setup(()=>Response.json({error:'source unavailable'},{status}));
  await assert.rejects(h.api.verifyQuotationResultSource(prepared,new AbortController().signal),error=>error.message==='source unavailable'&&(error instanceof h.api.QuotationResultSourceChanged)===(status===409));
 }
});
test('cancellation during response reading stops the result lookup path',async()=>{
 const controller=new AbortController();const h=setup(()=>({ok:true,json:async()=>{controller.abort();return body();}}));
 await assert.rejects(h.api.verifyQuotationResultSource(prepared,controller.signal),/취소/);
});
