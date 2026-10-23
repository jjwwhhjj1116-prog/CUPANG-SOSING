import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {assetApiFixture,companies,plain} from './helpers/supplier-hub-single-assets.mjs';

const tables=f=>JSON.stringify(f.h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,f.h.sqlite.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));
for(const company of companies)test(company.code+': product-label GET reuses the authenticated stable view without the internal quotation HTTP JSON roundtrip or any writes',async()=>{
 const f=await assetApiFixture(company,undefined,{populate:false});try{
  const raw=f.h.load('app/quotation-fields-read.ts'),fields=f.h.load('app/api/products/[id]/quotation-fields/route.ts'),label=f.base+'/product-labels'+f.query;
  const before=tables(f),objects=f.objectState(),context={params:Promise.resolve({id:f.id})},quoteRequest=new Request('https://app.test'+f.base+'/quotation-fields'+f.query);
  const direct=await raw.readQuotationFieldsForRequest(quoteRequest,context),publicReply=await fields.GET(quoteRequest,context);
  assert.equal(direct instanceof Response,false);assert.equal(publicReply.status,200);assert.deepEqual(await publicReply.json(),plain(direct));
  let calls=0;const original=raw.readQuotationFieldsForRequest;raw.readQuotationFieldsForRequest=async(...args)=>{calls++;return original(...args);};
  fields.GET=()=>assert.fail('An internal label read must not build and parse the whole quotation HTTP response');
  const response=await f.h.route(label),view=await response.json();assert.equal(response.status,200);assert.equal(calls,1);assert.equal(view.rows.filter(row=>row.optionId).length,3);
  assert.equal(view.quotationInputFingerprint,direct.inputFingerprint);assert.equal(view.quotationRevision,direct.revision);assert.equal(view.productVersion,direct.productVersion);assert.deepEqual(view.categoryContext,plain(direct.categoryContext));
  assert.equal(tables(f),before);assert.equal(f.objectState(),objects);assert.equal(f.h.network.length,0);
 }finally{f.close();}
});

test('the direct read retains quotation final-source fencing and the same category/company/error contract for label GET',async()=>{
 const f=await assetApiFixture(undefined,undefined,{populate:false});try{
  const endpoint=f.base+'/product-labels'+f.query,db=f.h.load('db/quotation-fields.ts'),check=db.quotationSourcesCurrent,before=tables(f);let checks=0;
  db.quotationSourcesCurrent=async()=>{checks++;return false;};
  const conflict=await f.h.route(endpoint),body=await conflict.json();assert.equal(conflict.status,409);assert.equal(body.code,'QUOTATION_FIELDS_CONFLICT');assert.equal(checks,1);assert.equal(tables(f),before);
  db.quotationSourcesCurrent=check;f.h.setCompany(companies[1]);
  const company=await f.h.route(endpoint);assert.equal(company.status,409);assert.equal((await company.json()).code,'QUOTATION_COMPANY_MISMATCH');assert.equal(tables(f),before);
  f.h.setCompany(companies[0]);const invalid=await f.h.route(f.base+'/product-labels?profileId=invalid!');assert.equal(invalid.status,400);assert.equal(tables(f),before);
  const missing=await f.h.route(f.base+'/product-labels?profileId=missing-profile');assert.equal(missing.status,404);assert.equal(tables(f),before);assert.equal(f.h.network.length,0);
 }finally{f.close();}
});

test('saving and then rereading one label keeps its explicit blank, other options and final clocks while the HTTP adapter stays unused',async()=>{
 const f=await assetApiFixture(undefined,undefined,{populate:false});try{
  const endpoint=f.base+'/product-labels'+f.query,fields=f.h.load('app/api/products/[id]/quotation-fields/route.ts');
  fields.GET=()=>assert.fail('A label save/read uses only the shared stable read');
  const first=await(await f.h.route(endpoint)).json(),selected=first.rows.find(row=>row.optionId),others=first.rows.filter(row=>row.optionId!==selected.optionId),objects=f.objectState();
  const protectedTables=()=>JSON.stringify(['product_content','product_options','product_quotation_fields'].map(name=>[name,f.h.sqlite.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));
  const before=protectedTables();
  const response=await f.h.route(endpoint,{method:'PUT',body:{expectedRevision:first.revision,expectedInputFingerprint:first.inputFingerprint,changes:[{optionId:selected.optionId,fieldKey:'material',value:''}]}});
  assert.equal(response.status,200,await response.clone().text());const saved=await response.json(),again=await(await f.h.route(endpoint)).json();
  assert.deepEqual(again,saved);assert.equal(saved.revision,first.revision+1);assert.equal(saved.rows.find(row=>row.optionId===selected.optionId).values.material,'');assert.equal(saved.rows.find(row=>row.optionId===selected.optionId).sources.material,'manual-option');
  assert.deepEqual(saved.rows.filter(row=>row.optionId!==selected.optionId),others);assert.equal(protectedTables(),before);assert.equal(f.objectState(),objects);assert.equal(f.h.network.length,0);
 }finally{f.close();}
});

test('the shared internal read rejects production authentication before owner, profile or stable-source access',async()=>{
 let owners=0,reads=0;const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/quotation-fields-read.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,URL,Error,process:{env:{NODE_ENV:'production'}},require(name){
   if(name==='@/app/chatgpt-auth')return{getChatGPTUser:async()=>({verifiedAccess:false}),getWorkspaceOwnerId:async()=>{owners++;return'owner';}};
   assert.equal(name,'@/app/quotation-fields-snapshot');return{stableQuotationFieldsView:async()=>{reads++;throw Error('must not read');},QuotationFieldsSnapshotError:class extends Error{constructor(message,status){super(message);this.status=status;}}};
  }});
 await assert.rejects(exports.readQuotationFieldsForRequest(new Request('https://app.test/api/products/p/quotation-fields'),{params:Promise.resolve({id:'p'})}),error=>error.status===503);
 assert.equal(owners,0);assert.equal(reads,0);
});
