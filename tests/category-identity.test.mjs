import * as parse5 from 'parse5';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';

const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { exports, structuredClone, TextEncoder, URL, require(name) {
    if (name === 'parse5') return parse5;
    if (name.startsWith('./')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
    if (!name.startsWith('@/app/')) throw Error(name);
    return load(name.slice(2) + '.ts');
  } });
  cache.set(file, exports); return exports;
}
const identity=load('app/category-identity.ts');
const schemas=load('app/quotation-schema.ts');
const hubs=load('app/hub-product-schemas.ts').hubProductSchemas;
const ids=[...new Set([...Object.keys(hubs),'80719','81452','64497','103495','77442','81221'])];
test('every known code accepts only its complete observed category path',()=>{
 for(const categoryId of ids){
  const categoryPath=Array.from(schemas.getQuotationSchema(categoryId).categoryPath);
  const input={categoryId,categoryPath};const before=JSON.stringify(input);
  assert.doesNotThrow(()=>identity.validateCategoryIdentity(input));
  assert.equal(JSON.stringify(input),before);
  assert.throws(()=>identity.validateCategoryIdentity({categoryId,categoryPath:['다른 분류',...categoryPath.slice(1)]}),/코드.*경로가 일치하지 않습니다/);
  assert.throws(()=>identity.validateCategoryIdentity({categoryId,categoryPath:[categoryPath.at(-1)]}),/경로가 일치하지 않습니다/);
 }
});
test('Couplus whitespace aliases match the same Hub code without rewriting saved input',()=>{
 const input={categoryId:'81221',categoryPath:['스포츠/레져','스포츠잡화','스포츠장갑']};
 assert.doesNotThrow(()=>identity.validateCategoryIdentity(input));
 assert.throws(()=>identity.validateCategoryIdentity({...input,categoryId:'81452'}),/경로가 일치하지 않습니다/);
});
test('unknown codes are not guessed from familiar category labels',()=>{
 const input={categoryId:'999999',categoryPath:['스포츠/레져','스포츠잡화','스포츠장갑']};
 identity.validateCategoryIdentity(input);
 assert.equal(schemas.getQuotationSchema(input.categoryId).status,'unconfirmed');
});

async function collectionCategoryResponse(user){
 const profileId='11111111-1111-4111-8111-111111111111';let queued=0,settingsRead=0;
 const deps={
  'next/server':{NextResponse:Response},
  '@/app/chatgpt-auth':{getChatGPTUser:async()=>user,getWorkspaceOwnerId:async()=>'test-owner'},
  '@/db/category-profiles':{getCategoryProfileSnapshot:async()=>{const category={id:profileId,revision:1,categoryId:'81472',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓']};return {category,payload:JSON.stringify(category)};}},
  '@/db/queries':{getSettings:async()=>{settingsRead++;return null;}},
  '@/db/collection-jobs':{enqueueCollection:async()=>{queued++;return[];},listCollectionJobs:async()=>[]},
 };
 const exports={};
 const code=ts.transpileModule(fs.readFileSync(new URL('../app/api/collection-jobs/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,Response,Request,URL,process:{env:{NODE_ENV:'production'}},require(name){return deps[name]??load(name.slice(2)+'.ts');}});
 const response=await exports.POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({urls:['https://detail.1688.com/offer/813724060928.html'],goal:'price',profileId,expectedProfileRevision:1})}));
 return {response,queued,settingsRead};
}

for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])test(`collection route rejects a mismatched saved category before enqueueing or reading settings (${company.code})`,async()=>{
 const {response,queued,settingsRead}=await collectionCategoryResponse({verifiedAccess:true,userId:'test-owner',
  membership:{id:'test-owner',status:'approved',companyCode:company.code,companyName:company.name}});
 assert.equal(response.status,400);
 const body=await response.json();assert.equal(body.code,'CATEGORY_IDENTITY_MISMATCH',JSON.stringify(body));
 assert.equal(queued,0);assert.equal(settingsRead,0);
});

test('collection route rejects unconfirmed or foreign-owner company authentication before category validation',async()=>{
 for(const user of [
  {verifiedAccess:true},
  {verifiedAccess:true,userId:'different-owner',membership:{status:'approved',companyCode:'A01464742',companyName:'와이홉'}},
  {verifiedAccess:true,userId:'test-owner',membership:{status:'pending',companyCode:'A01526306',companyName:'유앤채'}},
 ]){
  const {response,queued,settingsRead}=await collectionCategoryResponse(user);
  assert.equal(response.status,409);
  const body=await response.json();assert.equal(body.code,'COLLECTION_COMPANY_UNCONFIRMED',JSON.stringify(body));
  assert.equal(queued,0);assert.equal(settingsRead,0);
 }
});


test('all observed yoga codes validate full paths before their quotation forms are available',()=>{
 const records=JSON.parse(fs.readFileSync(new URL('../docs/yoga-category-comparison-2026-09-28.json',import.meta.url),'utf8')).categoryIds;
 for(const record of records){
  assert.doesNotThrow(()=>identity.validateCategoryIdentity({categoryId:record.categoryId,categoryPath:record.path}));
  const different=records.find(r=>r.categoryId!==record.categoryId);
  assert.throws(()=>identity.validateCategoryIdentity({categoryId:record.categoryId,categoryPath:different.path}),/경로가 일치하지 않습니다/);
  assert.throws(()=>identity.validateCategoryIdentity({categoryId:record.categoryId,categoryPath:[record.path.at(-1)]}),/경로가 일치하지 않습니다/);
  if(record.categoryId!=='81467')assert.equal(schemas.getQuotationSchema(record.categoryId).status,'unconfirmed');
 }
});
