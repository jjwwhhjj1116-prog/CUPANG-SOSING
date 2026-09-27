import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,TextEncoder,require:name=>load(name.slice(2)+'.ts')});return exports;}
const {collectedSeoSource}=load('app/collected-seo-source.ts');
const receipt={offerId:'123',sourceUrl:'https://detail.1688.com/offer/123.html',title:'원문 상품',description:'원문 설명',attributes:[{name:'option:other',value:'seller value'}]};
const job={id:'j',offer_id:'123',context:{category:{categoryId:'80719',categoryPath:['주방용품','바스켓']},features:'기능',keywords:'검색어'}};
const row=i=>({id:`o${i}`,included:true,originalName:'黑色',translatedName:'',color:'黑色',size:'',provenance:{translatedName:'unverified',color:'collected'}});
test('saved source retains category and guidance and namespaces seller keys away from option bindings',()=>{
 const result=collectedSeoSource(receipt,job,{rows:[row(1),{...row(2),included:false},{...row(3),translatedName:'수정 옵션',color:'수동 색상',provenance:{translatedName:'manual',color:'manual'}}]});
 assert.equal(result.source.category.id,'80719');assert.equal(result.source.guidance.keywords,'검색어');
 assert.deepEqual(JSON.parse(JSON.stringify(result.source.attributes)),[{name:'상품속성: option:other',value:'seller value'},{name:'option:o1',value:'黑色'},{name:'option-color:o1',value:'黑色'}]);assert.equal(result.remainingOptions,0);
 assert.throws(()=>collectedSeoSource(receipt,{...job,offer_id:'999'},{rows:[]}));
});
test('large option sets retain the unselected original entries and report remaining work',()=>{
 const options={rows:Array.from({length:40},(_,i)=>row(i))};const before=JSON.stringify(options);
 const result=collectedSeoSource(receipt,job,options);assert.equal(result.source.attributes.length,50);assert.equal(result.remainingOptions,31);assert.equal(JSON.stringify(options),before);
});
