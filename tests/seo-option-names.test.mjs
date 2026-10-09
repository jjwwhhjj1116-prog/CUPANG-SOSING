import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const plain=value=>JSON.parse(JSON.stringify(value));
function load(file,overrides={},mode='development'){
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,Response,TextDecoder,Uint8Array,process:{env:{NODE_ENV:mode}},require(name){if(name in overrides)return overrides[name];if(name==='next/server')return{NextResponse:Response};if(name.startsWith('@/'))return load(name.slice(2)+'.ts',overrides,mode);throw Error(name);}});return exports;
}
const version='2026-10-10T00:00:00.000Z',next='2026-10-10T00:00:00.001Z';
const options=load('app/product-options.ts'),names=load('app/option-seo-names.ts');
function stored(){return{schemaVersion:1,productId:'p',revision:3,updatedAt:version,rows:['a','b'].map(id=>({...options.emptyOptionInput(id),originalName:'黑色',translatedName:id==='b'?'직접 입력':'',unitCostCny:null,
 included:true,imageKey:'owner/missing.png',packagedWidthMm:100,packagedLengthMm:200,packagedHeightMm:50,packagedWeightG:333,packagingUnitsPerPack:2,
 provenance:Object.fromEntries(Object.keys(options.optionFieldNames).map(key=>[key,key==='translatedName'&&id==='b'?'manual':'collected'])),updatedAt:version}))};}
const body=changes=>({expectedRevision:3,expectedProductVersion:version,changes});
const request=value=>new Request('http://localhost/api/products/p/option-names',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
const context={params:Promise.resolve({id:'p'})};

test('explicit same blank name becomes manual while all other fields, provenance and row order remain exact',()=>{
 const current=stored(),before=plain(current),input=names.validateOptionNamesInput(body([{optionId:'a',value:''}])),changed=names.applyOptionNameChanges(current,input.changes,next);
 assert.deepEqual(plain(current),before);assert.equal(changed.revision,4);assert.equal(changed.rows[0].provenance.translatedName,'manual');assert.equal(changed.rows[0].translatedName,'');
 assert.deepEqual(plain(changed.rows[1]),before.rows[1]);
 const normalized=plain(changed.rows[0]);normalized.updatedAt=version;normalized.provenance.translatedName='collected';assert.deepEqual(normalized,before.rows[0]);
 assert.throws(()=>names.applyOptionNameChanges(current,[{optionId:'unknown',value:'다른 상품'}],next),/옵션/);
 assert.throws(()=>names.applyOptionNameChanges({...current,rows:[current.rows[0],current.rows[0]]},[{optionId:'a',value:'모호한 옵션'}],next),/모호/);
});

test('name-only input rejects price/image/company injection, duplicate IDs, oversized names and malformed revisions',()=>{
 const valid=body([{optionId:'a',value:'검정색'}]);assert.deepEqual(plain(names.validateOptionNamesInput(valid)),valid);
 for(const bad of [{...valid,rows:[]},{...valid,company:'A01464742'},{...valid,expectedRevision:-1},{...valid,expectedProductVersion:'bad'},
  {...valid,changes:[]},{...valid,changes:[valid.changes[0],valid.changes[0]]},{...valid,changes:[{optionId:'a',value:'x',imageKey:'evil'}]},
  {...valid,changes:[{optionId:'a',value:'x'.repeat(501)}]},{...valid,changes:[{optionId:'a',value:'bad\u0000'}]}])assert.throws(()=>names.validateOptionNamesInput(bad));
});

test('actual names API saves without replacing unconfirmed cost or reopening unrelated image files',async()=>{
 const current=stored(),before=plain(current),product={id:'p',owner_id:'owner',updated_at:version,exchange_rate:350,supply_margin:50,coupang_margin:40,pricing_policy:null};let saved,calls=0;
 const route=load('app/api/products/[id]/option-names/route.ts',{'@/app/chatgpt-auth':{getChatGPTUser:async()=>null,getWorkspaceOwnerId:async()=> 'owner'},
  '@/db/queries':{findProduct:async(owner,id)=>owner==='owner'&&id==='p'?product:null,getSettings:async()=>null},
  '@/db/product-options':{readProductOptions:async()=>current,saveProductOptions:async(owner,value,revision,expected)=>{assert.equal(owner,'owner');assert.equal(revision,3);assert.equal(expected,version);calls++;saved=value;return value;}}});
 const response=await route.PATCH(request(body([{optionId:'a',value:'한국어 옵션명'}])),context),value=await response.json();
 assert.equal(response.status,200);assert.equal(calls,1);assert.equal(value.options.rows[0].translatedName,'한국어 옵션명');assert.equal(value.options.rows[0].unitCostCny,null);assert.equal(value.pricing.rows[0].error!==null,true);
 assert.deepEqual(plain(current),before);const row=plain(saved.rows[0]);row.translatedName='';row.updatedAt=version;row.provenance.translatedName='collected';assert.deepEqual(row,before.rows[0]);assert.deepEqual(plain(saved.rows[1]),before.rows[1]);
});

test('actual names API fails closed on other owner, stale revision, unknown option, unauthenticated production and write race',async()=>{
 const current=stored();let writes=0;
 const overrides={'@/app/chatgpt-auth':{getChatGPTUser:async()=>null,getWorkspaceOwnerId:async()=> 'owner'},'@/db/queries':{findProduct:async()=>({id:'p',updated_at:version,exchange_rate:350,supply_margin:50,coupang_margin:40}),getSettings:async()=>null},
  '@/db/product-options':{readProductOptions:async()=>current,saveProductOptions:async()=>{writes++;return null;}}};
 let route=load('app/api/products/[id]/option-names/route.ts',overrides);
 assert.equal((await route.PATCH(request({...body([{optionId:'a',value:'수정'}]),expectedRevision:2}),context)).status,409);assert.equal(writes,0);
 assert.equal((await route.PATCH(request(body([{optionId:'foreign',value:'수정'}])),context)).status,400);assert.equal(writes,0);
 assert.equal((await route.PATCH(request(body([{optionId:'a',value:'수정'}])),context)).status,409);assert.equal(writes,1);
 route=load('app/api/products/[id]/option-names/route.ts',{...overrides,'@/db/queries':{...overrides['@/db/queries'],findProduct:async()=>null}});
 assert.equal((await route.PATCH(request(body([{optionId:'a',value:'수정'}])),context)).status,404);assert.equal(writes,1);
 route=load('app/api/products/[id]/option-names/route.ts',overrides,'production');assert.equal((await route.PATCH(request(body([{optionId:'a',value:'수정'}])),context)).status,503);assert.equal(writes,1);
});
