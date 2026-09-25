import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file) { const exports={}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,structuredClone,Error,require:name=>load(name.slice(2)+'.ts')}); return exports; }
const {translationAdoptionInput}=load('app/translation-adoption.ts');
const {emptyProductContent,applyContentPatch}=load('app/product-content.ts');
const {translationBatchAdoption}=load('app/translation-batch-adoption.ts');

test('batch adoption saves SEO and exact label matches once while protecting manual blanks and unrelated assets',()=>{
 const content=emptyProductContent('p');
 content.seo.title={value:'原文',provenance:'collected',updatedAt:'before'};
 content.seo.description={value:'',provenance:'manual',updatedAt:'before'};
 content.label.countryOfOrigin={value:'',provenance:'manual',updatedAt:'before'};
 const job={productId:'p',productVersion:'v',status:'completed',review:{source:{attributes:[{name:'상품속성: 材质'},{name:'상품속성: 国'}]}},result:{draft:{title:'번역 제목',keywords:['검색어'],description:'자동 설명',attributes:[{sourceIndex:0,name:'재질',value:'면'},{sourceIndex:1,name:'제조국',value:'중국'}]}}};
 const before=JSON.stringify({content,job});const plan=translationBatchAdoption(content,job,'v');
 assert.equal(plan.preview.length,4);assert.equal(plan.input.expectedRevision,0);
 const next=applyContentPatch(content,plan.input.patch,'now');
 assert.equal(next.revision,1);assert.equal(next.seo.title.value,'번역 제목');assert.equal(next.label.material.value,'면');
 assert.equal(next.seo.description.value,'');assert.equal(next.label.countryOfOrigin.value,'');assert.equal(JSON.stringify(next.assets),JSON.stringify(content.assets));
 assert.equal(JSON.stringify({content,job}),before);assert.equal(translationBatchAdoption(next,job,'v').input,null);
 assert.equal(translationBatchAdoption(next,job,'v').preview.length,0);
 for(const change of [{productId:'other'},{productVersion:'old'},{status:'running'},{result:null}])assert.throws(()=>translationBatchAdoption(content,{...job,...change},'v'));
 job.result.draft.title='x'.repeat(501);assert.throws(()=>translationBatchAdoption(content,job,'v'));assert.equal(content.revision,0);
});
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

test('explicit equivalent label headings are adopted but conflicting aliases and component materials are not',()=>{
 const pairs=[['제품명','productName'],['상품명','productName'],['소재','material'],['구성품','components'],['크기 및 중량','dimensions'],['취급 및 사용 주의사항','precautions']];
 for(const [name,field] of pairs){
  const {content,job}=labelFixture();job.result.draft.attributes=[{sourceIndex:0,name,value:'확인한 상품값'}];
  const before=JSON.stringify({content,job});let result=suggestTranslationLabels(content,job,'v');assert.equal(result.mappings[0].field,field);
  assert.equal(translationLabelAdoption(content,job,'v',result.mappings).input.patch.label[field],'확인한 상품값');assert.equal(JSON.stringify({content,job}),before);
  content.label[field]={value:'',provenance:'manual',updatedAt:'now'};result=suggestTranslationLabels(content,job,'v');assert.equal(result.mappings.length,0);
 }
 const {content,job}=labelFixture();job.result.draft.attributes=[{sourceIndex:0,name:'재질',value:'면'},{sourceIndex:1,name:'소재',value:'나일론'}];
 assert.equal(suggestTranslationLabels(content,job,'v').mappings.length,0);
 for(const name of ['겉감 소재','안감 소재','포장 크기','크기','중량','대략 소재']){job.result.draft.attributes=[{sourceIndex:0,name,value:'추정 금지'}];assert.equal(suggestTranslationLabels(content,job,'v').mappings.length,0);}
});

test('batch adoption fills an untouched label name with the effective SEO title in the same revision',()=>{
 const content=emptyProductContent('p');const job={productId:'p',productVersion:'v',status:'completed',review:{source:{attributes:[]}},result:{draft:{title:'번역 상품명',keywords:[],description:'',attributes:[]}}};
 let plan=translationBatchAdoption(content,job,'v');assert.equal(plan.input.patch.label.productName,'번역 상품명');assert.equal(plan.input.expectedRevision,0);
 const saved=applyContentPatch(content,plan.input.patch,'now');assert.equal(saved.revision,1);assert.equal(saved.label.productName.value,saved.seo.title.value);
 assert.equal(translationBatchAdoption(saved,job,'v').input,null);
 content.seo.title={value:'직접 SEO 제목',provenance:'manual',updatedAt:'before'};
 plan=translationBatchAdoption(content,job,'v');assert.equal(plan.input.patch.label.productName,'직접 SEO 제목');assert.equal(plan.input.patch.seo,undefined);
 for(const field of [{value:'',provenance:'manual'},{value:'별도 라벨명',provenance:'collected'}]){content.label.productName={...field,updatedAt:'before'};plan=translationBatchAdoption(content,job,'v');assert.equal(plan.input,null);}
 content.label.productName={value:'',provenance:'unverified',updatedAt:null};
 job.review.source.attributes=[{name:'상품속성: 名称'},{name:'상품속성: 产品名'}];job.result.draft.attributes=[{sourceIndex:0,name:'품명',value:'다른 품명'},{sourceIndex:1,name:'제품명',value:'충돌 품명'}];
 assert.equal(translationBatchAdoption(content,job,'v').input,null);
 job.result.draft.attributes.pop();plan=translationBatchAdoption(content,job,'v');assert.equal(plan.input.patch.label.productName,'다른 품명');
});
