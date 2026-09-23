import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,require:name=>load(name.slice(2)+'.ts')});return exports;}
const model=load('app/option-translation.ts');const optionsModel=load('app/product-options.ts');
function fixture(){
 const options=optionsModel.applyOptionRows(optionsModel.emptyProductOptions('p'),[{...optionsModel.emptyOptionInput('a'),originalName:'白色',supplierSku:'sku-a',unitCostCny:4,unitsPerPack:2,included:true},{...optionsModel.emptyOptionInput('b'),originalName:'黑色',translatedName:'직접 수정 검정',unitCostCny:5,included:true}],'v');
 const job={productId:'p',productVersion:'v',status:'completed',review:{source:{attributes:[{name:'option:a',value:'白色'},{name:'option:b',value:'黑色'}]}},result:{draft:{attributes:[{sourceIndex:1,name:'검정',value:'블랙'},{sourceIndex:0,name:'흰색',value:'화이트'}]}}};return {options,job};
}
test('prepare includes only blank translated option names, with stable IDs',()=>{const {options}=fixture();assert.deepEqual(JSON.parse(JSON.stringify(model.optionTranslationAttributes(options))),[{name:'option:a',value:'白色'}]);options.rows[0].translatedName='입력';assert.throws(()=>model.optionTranslationAttributes(options),/없습니다/);});
test('adoption maps output indexes instead of order and preserves existing names and all other values',()=>{
 const {options,job}=fixture();const before=JSON.stringify(options);const result=model.adoptOptionTranslations(options,job,'v');
 assert.equal(result.changed,1);assert.equal(result.rows[0].translatedName,'화이트');assert.equal(result.rows[1].translatedName,'직접 수정 검정');
 assert.equal(result.rows[0].unitCostCny,4);assert.equal(result.rows[0].unitsPerPack,2);assert.equal(result.rows[0].supplierSku,'sku-a');assert.equal(JSON.stringify(options),before);
});
test('stale product, altered original, missing option and duplicate result bindings are rejected',()=>{
 for(const alter of [({job})=>{job.productVersion='old';},({job})=>{job.productId='other';},({options})=>{options.rows[0].originalName='새 원문';},({options})=>{options.rows.shift();},({job})=>{job.result.draft.attributes.push(job.result.draft.attributes[1]);}]){const data=fixture();alter(data);assert.throws(()=>model.adoptOptionTranslations(data.options,data.job,'v'));}
});
test('no partial application on invalid translated text and manual attributes never target options',()=>{
 for(const value of ['', 'x'.repeat(501),'a\nb']){const {options,job}=fixture();job.result.draft.attributes[1].value=value;assert.throws(()=>model.adoptOptionTranslations(options,job,'v'));assert.equal(options.rows[0].translatedName,'');}
 const {options,job}=fixture();job.review.source.attributes.forEach(a=>a.name='색상');assert.throws(()=>model.adoptOptionTranslations(options,job,'v'),/없습니다/);
});

test('collected color and size translate by exact field binding and preserve manual attributes',()=>{
 const {options,job}=fixture();
 options.rows[0].color='白色';options.rows[0].size='小号';options.rows[0].provenance.color='collected';options.rows[0].provenance.size='collected';
 options.rows[1].color='직접 입력';options.rows[1].provenance.color='manual';
 const source=model.optionTranslationAttributes(options);
 assert.deepEqual(JSON.parse(JSON.stringify(source)),[{name:'option:a',value:'白色'},{name:'option-color:a',value:'白色'},{name:'option-size:a',value:'小号'}]);
 job.review.source.attributes=source;
 job.result.draft.attributes=[{sourceIndex:2,name:'ignored',value:'소형'},{sourceIndex:1,name:'ignored',value:'흰색'},{sourceIndex:0,name:'ignored',value:'화이트 옵션'}];
 const before=JSON.stringify(options);const result=model.adoptOptionTranslations(options,job,'v');
 assert.equal(result.changed,3);assert.equal(result.rows[0].color,'흰색');assert.equal(result.rows[0].size,'소형');assert.equal(result.rows[0].translatedName,'화이트 옵션');
 assert.equal(result.rows[1].color,'직접 입력');assert.equal(JSON.stringify(options),before);
 const saved=optionsModel.applyOptionRows(options,result.rows,'saved');
 assert.equal(saved.rows[0].provenance.color,'manual');assert.equal(saved.rows[0].provenance.size,'manual');
 assert.throws(()=>model.optionTranslationAttributes(saved),/없습니다/);
});

test('attribute adoption preserves manual clear, rejects changed collected source and never partially writes',()=>{
 for(const mutation of ['manual','changed','long','duplicate']){
  const {options,job}=fixture();options.rows[0].color='白';options.rows[0].provenance.color='collected';
  job.review.source.attributes=[{name:'option:a',value:'白色'},{name:'option-color:a',value:'白'}];
  job.result.draft.attributes=[{sourceIndex:0,value:'화이트'},{sourceIndex:1,value:'흰색'}];
  if(mutation==='manual'){options.rows[0].color='';options.rows[0].provenance.color='manual';}
  if(mutation==='changed')options.rows[0].color='黑';
  if(mutation==='long')job.result.draft.attributes[1].value='x'.repeat(201);
  if(mutation==='duplicate')job.result.draft.attributes.push(job.result.draft.attributes[1]);
  const before=JSON.stringify(options);
  if(mutation==='manual'){const result=model.adoptOptionTranslations(options,job,'v');assert.equal(result.changed,1);assert.equal(result.rows[0].color,'');}
  else assert.throws(()=>model.adoptOptionTranslations(options,job,'v'));
  assert.equal(JSON.stringify(options),before);
 }
});

test('translation limit counts attributes rather than just option rows',()=>{
 const {options}=fixture();options.rows=[];
 for(let i=0;i<17;i++)options.rows.push({...optionsModel.emptyOptionInput(`a${i}`),originalName:'原文',color:'白',size:'小',provenance:{color:'collected',size:'collected'}});
 assert.throws(()=>model.optionTranslationAttributes(options),/50/);
 options.rows[16].size='';assert.equal(model.optionTranslationAttributes(options).length,50);
});
