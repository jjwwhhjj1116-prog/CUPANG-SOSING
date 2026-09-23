import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file) { const exports={}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,structuredClone,Error,require:name=>load(name.slice(2)+'.ts')}); return exports; }
const {translationAdoptionInput}=load('app/translation-adoption.ts');
const {emptyProductContent,applyContentPatch}=load('app/product-content.ts');
function fixture(){
 const content=applyContentPatch(emptyProductContent('p'),{seo:{title:'수동 제목',keywords:['유지'],description:'수동 설명'},label:{material:'면'}},'before');
 const job={productId:'p',productVersion:'v',status:'completed',result:{draft:{title:'번역 제목',keywords:['번역 검색어'],description:'번역 설명'}}};
 return {content,job};
}
test('selected translation fields form one revision-bound save and preserve unselected content',()=>{
 const {content,job}=fixture();const original=JSON.stringify({content,job});
 const input=translationAdoptionInput(content,job,'v',['description','title']);
 assert.equal(input.expectedRevision,content.revision);
 const next=applyContentPatch(content,input.patch,'after');
 assert.equal(next.revision,content.revision+1);assert.equal(next.seo.title.value,'번역 제목');assert.equal(next.seo.description.value,'번역 설명');
 assert.equal(JSON.stringify(next.seo.keywords),JSON.stringify(content.seo.keywords));assert.equal(JSON.stringify(next.label),JSON.stringify(content.label));assert.equal(JSON.stringify(next.assets),JSON.stringify(content.assets));
 assert.equal(JSON.stringify({content,job}),original);
});
test('wrong product/version, incomplete result and invalid selection cannot produce a save',()=>{
 const {content,job}=fixture();
 for(const change of [{productId:'other'},{productVersion:'old'},{status:'running'},{result:null}])assert.throws(()=>translationAdoptionInput(content,{...job,...change},'v',['title']));
 for(const fields of [[],['title','title'],['material']])assert.throws(()=>translationAdoptionInput(content,job,'v',fields));
});
test('all fields and single fields use the same content validation; invalid output prevents partial save',()=>{
 const {content,job}=fixture();
 const input=translationAdoptionInput(content,job,'v',['title','keywords','description']);
 assert.equal(Object.keys(input.patch.seo).length,3);
 assert.equal(Object.keys(translationAdoptionInput(content,job,'v',['title']).patch.seo).length,1);
 job.result.draft.description='x'.repeat(20001);
 assert.throws(()=>translationAdoptionInput(content,job,'v',['title','description']));
 assert.equal(content.seo.title.value,'수동 제목');
});
