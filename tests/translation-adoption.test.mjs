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

const {translationLabelAdoption}=load('app/translation-label-adoption.ts');
function labelFixture(){
 const content=emptyProductContent('p');
 content.label.material={value:'原料',provenance:'collected',updatedAt:'before'};
 const job={productId:'p',productVersion:'v',status:'completed',review:{source:{attributes:[{name:'상품속성: 材质',value:'棉'},{name:'상품속성: 内容',value:'2个'}]}},result:{draft:{attributes:[{sourceIndex:0,name:'재질',value:'면'},{sourceIndex:1,name:'구성',value:'2개'}]}}};
 return {content,job};
}
test('reviewed collected attributes save label fields together with current CAS and preserve unrelated content',()=>{
 const {content,job}=labelFixture();const before=JSON.stringify({content,job});
 const plan=translationLabelAdoption(content,job,'v',[{sourceIndex:0,field:'material'},{sourceIndex:1,field:'components'}]);
 assert.equal(plan.preview[0].before,'原料');assert.equal(plan.preview[0].after,'면');assert.equal(plan.input.expectedRevision,content.revision);
 const next=applyContentPatch(content,plan.input.patch,'after');assert.equal(next.label.material.value,'면');assert.equal(next.label.components.value,'2개');assert.equal(next.label.material.provenance,'manual');
 assert.equal(JSON.stringify(next.seo),JSON.stringify(content.seo));assert.equal(JSON.stringify(next.assets),JSON.stringify(content.assets));assert.equal(JSON.stringify({content,job}),before);
 content.revision=8;assert.equal(translationLabelAdoption(content,job,'v',[{sourceIndex:0,field:'material'}]).input.expectedRevision,8);
});
test('label mapping protects manually edited values and blanks and rejects stale products or ambiguous destinations',()=>{
 const {content,job}=labelFixture();const mapping=[{sourceIndex:0,field:'material'}];
 for(const value of ['직접 재질','']){content.label.material={value,provenance:'manual',updatedAt:'now'};assert.throws(()=>translationLabelAdoption(content,job,'v',mapping),/직접 수정/);}
 content.label.material.provenance='collected';
 for(const changes of [{productId:'other'},{productVersion:'old'},{status:'running'},{result:null}])assert.throws(()=>translationLabelAdoption(content,{...job,...changes},'v',mapping));
 for(const maps of [[],[...mapping,...mapping],[{sourceIndex:0,field:'material'},{sourceIndex:1,field:'material'}],[{sourceIndex:0,field:'material'},{sourceIndex:0,field:'components'}],[{sourceIndex:0,field:'__proto__'}],[{sourceIndex:-1,field:'material'}]])assert.throws(()=>translationLabelAdoption(content,job,'v',maps));
});
test('label mapping only accepts unique nonempty seller attribute translations and validates full patch atomically',()=>{
 const {content,job}=labelFixture();const mapping=[{sourceIndex:0,field:'material'}];
 job.review.source.attributes[0].name='옵션: option-name';assert.throws(()=>translationLabelAdoption(content,job,'v',mapping));job.review.source.attributes[0].name='상품속성: 材质';
 job.result.draft.attributes.push({...job.result.draft.attributes[0]});assert.throws(()=>translationLabelAdoption(content,job,'v',mapping));job.result.draft.attributes.pop();
 job.result.draft.attributes[0].value=' ';assert.throws(()=>translationLabelAdoption(content,job,'v',mapping));
 job.result.draft.attributes[0].value='x'.repeat(2001);assert.throws(()=>translationLabelAdoption(content,job,'v',mapping));assert.equal(content.label.material.value,'原料');
});

const {suggestTranslationLabels}=load('app/translation-label-adoption.ts');
test('label suggestions select exact translated field names only without writing or inferring synonyms',()=>{
 const {content,job}=labelFixture();const before=JSON.stringify({content,job});
 let result=suggestTranslationLabels(content,job,'v');assert.equal(result.mappings.length,1);assert.equal(result.mappings[0].field,'material');assert.equal(result.mappings[0].sourceIndex,0);
 assert.equal(JSON.stringify({content,job}),before);
 job.result.draft.attributes[1].name=' 제품 구성품 ';result=suggestTranslationLabels(content,job,'v');assert.equal(result.mappings.length,2);
 const input=translationLabelAdoption(content,job,'v',result.mappings).input;assert.equal(input.patch.label.components,'2개');
 job.result.draft.attributes[0].name='겉감 재질';result=suggestTranslationLabels(content,job,'v');assert.equal(result.mappings.length,1);assert.equal(result.mappings[0].field,'components');
});
test('label suggestions leave duplicate names and manual fields unselected and report why',()=>{
 const {content,job}=labelFixture();job.result.draft.attributes[1].name='재질';
 let result=suggestTranslationLabels(content,job,'v');assert.equal(result.mappings.length,0);assert.match(result.skipped[0],/여러 개/);
 job.result.draft.attributes[1].name='제품 구성품';content.label.material={value:'',provenance:'manual',updatedAt:'now'};
 result=suggestTranslationLabels(content,job,'v');assert.equal(result.mappings.length,1);assert.equal(result.mappings[0].field,'components');assert.match(result.skipped[0],/직접 수정/);
});
test('label suggestions reject stale, incomplete, option-bound or invalid results without selecting unsafe values',()=>{
 const {content,job}=labelFixture();
 for(const change of [{productVersion:'other'},{productId:'other'},{status:'running'},{result:null}])assert.equal(suggestTranslationLabels(content,{...job,...change},'v').mappings.length,0);
 job.review.source.attributes[0].name='option:size';assert.equal(suggestTranslationLabels(content,job,'v').mappings.length,0);
 job.review.source.attributes[0].name='상품속성: 材质';job.result.draft.attributes[0].value=' ';assert.equal(suggestTranslationLabels(content,job,'v').mappings.length,0);
});
