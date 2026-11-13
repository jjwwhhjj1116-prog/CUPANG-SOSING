import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {assetApiFixture,companies,plain} from './helpers/supplier-hub-single-assets.mjs';

const tables=f=>JSON.stringify(f.h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,f.h.sqlite.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));
for(const company of companies)test(company.code+': product-label GET reuses the authenticated stable view without the internal quotation HTTP JSON roundtrip or any writes',async()=>{
 const f=await assetApiFixture(company,undefined,{populate:false});try{
  const {h}=f;
  const source=h.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get('job');
  const captured={...JSON.parse(source.payload),company,category:f.profile};
  h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(captured),'job');
  h.sqlite.prepare('UPDATE products SET source_url=? WHERE id=?').run(h.sourceUrl,f.id);
  h.sqlite.prepare('INSERT INTO collection_products VALUES(?,?,?,?)').run('job','owner',f.id,new Date().toISOString());
  const raw=f.h.load('app/quotation-fields-read.ts'),fields=f.h.load('app/api/products/[id]/quotation-fields/route.ts'),label=f.base+'/product-labels'+f.query;
  const before=tables(f),objects=f.objectState(),context={params:Promise.resolve({id:f.id})},quoteRequest=new Request('https://app.test'+f.base+'/quotation-fields'+f.query);
  const direct=await raw.readQuotationFieldsForRequest(quoteRequest,context),publicReply=await fields.GET(quoteRequest,context);
  assert.equal(direct instanceof Response,false);assert.equal(publicReply.status,200);assert.deepEqual(await publicReply.json(),plain(direct));
  const reads={};
  for(const [file,names] of Object.entries({'db/queries.ts':['findProduct','getSettings'],'db/product-content.ts':['readProductContent'],'db/product-options.ts':['readProductOptions'],'db/product-labels.ts':['readProductLabels','productLabelsSourcesCurrent'],'db/category-profiles.ts':['getCategoryProfile'],'db/quotation-fields.ts':['readQuotationCollectionSource','quotationSourcesCurrent']})){
   const db=f.h.load(file);for(const name of names){const read=db[name];reads[name]=0;db[name]=(...args)=>{reads[name]++;return read(...args);};}
  }
  fields.GET=()=>assert.fail('An internal label read must not build and parse the whole quotation HTTP response');
  const response=await f.h.route(label),view=await response.json();assert.equal(response.status,200);assert.equal(view.rows.filter(row=>row.optionId).length,3);
  for(const [name,count] of Object.entries(reads))assert.equal(count,1,`${name} reads each label source or verifies its own fence once`);
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
  const missing=await f.h.route(f.base+'/product-labels?profileId=missing-profile');assert.equal(missing.status,404);assert.match((await missing.json()).error,/카테고리/);
  const missingProduct=await f.h.route('/api/products/missing/product-labels?profileId=missing-profile');assert.equal(missingProduct.status,404);assert.match((await missingProduct.json()).error,/상품을 찾을 수 없습니다/);
  assert.equal(tables(f),before);assert.equal(f.h.network.length,0);
 }finally{f.close();}
});

test('label GET rejects unverified access before reading and scopes verified access to its owner',async()=>{
 const f=await assetApiFixture(undefined,undefined,{populate:false});try{
  const {h}=f,endpoint=f.base+'/product-labels'+f.query,db=h.load('db/queries.ts'),find=db.findProduct;
  const owners=[];
  db.findProduct=(owner,...args)=>{owners.push(owner);return find(owner,...args);};
  h.auth.getChatGPTUser=async()=>({verifiedAccess:false,userId:'owner'});
  const denied=await h.route(endpoint);assert.equal(denied.status,503);assert.equal((await denied.json()).code,'AUTH_REQUIRED');assert.deepEqual(owners,[]);
  h.auth.getChatGPTUser=async()=>({verifiedAccess:true,userId:'another-owner'});
  const foreign=await h.route(endpoint);assert.equal(foreign.status,404);assert.deepEqual(owners,['another-owner']);
 }finally{f.close();}
});

test('label GET does not return its reused quotation sources when the label revision changes before its own final proof',async()=>{
 const f=await assetApiFixture(undefined,undefined,{populate:false});try{
  const h=f.h,db=h.load('db/product-labels.ts'),read=db.productLabelsSourcesCurrent;
  const saved=await db.readProductLabels('owner',f.id);
  let verified=false;
  db.productLabelsSourcesCurrent=async(owner,id,source,revision)=>{
   assert.equal(id,f.id);assert.equal(revision,saved.revision);verified=true;
   const at=new Date().toISOString();
   const changed={...saved,revision:revision+1,overrides:{common:{...saved.overrides.common,material:'동시 수정 재질'},options:saved.overrides.options},updatedAt:at};
   h.sqlite.prepare('UPDATE product_labels SET revision=?,payload=?,updated_at=? WHERE product_id=? AND owner_id=?').run(changed.revision,JSON.stringify(changed),at,id,owner);
   return read(owner,id,source,revision);
  };
  const response=await f.h.route(f.base+'/product-labels'+f.query),body=await response.json();
  assert.equal(verified,true);assert.equal(response.status,409);assert.equal(body.code,'PRODUCT_LABELS_CONFLICT');
  assert.equal(Object.hasOwn(body,'rows'),false);assert.equal(h.network.length,0);
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
