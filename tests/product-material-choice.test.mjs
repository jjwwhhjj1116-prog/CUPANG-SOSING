import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule as module} from './helpers/provided-option-quotation.mjs';
import {aiFixture} from './helpers/quotation-ai.mjs';

function fixture(material='면 85%, 스판덱스 10%, 나일론 5%'){
 const f=aiFixture(),values=['면','폴리에스테르','나일론'];
 f.raw.properties.productPage.properties.unexposedAttributes.allOf.push({contains:{type:'object',required:['attributeName','attributeValue'],properties:{
  attributeName:{type:'string',enum:['상품 재질']},attributeValue:{type:'string',enum:values},
 }}});f.syncSchema();
 f.content.label.material={value:material,provenance:'manual',updatedAt:f.product.updated_at};
 const input={...f.saved,categoryId:f.snapshot.categoryId,categoryPath:f.snapshot.categoryPath,overrides:{common:{},options:{}}};
 const model=module('app/quotation-schema.ts'),resolve=()=>model.resolveQuotationFields(input);
 const schema=resolve().schema,materialField=schema.fields.find(field=>field.label==='상품 재질'),notice=schema.fields.find(field=>field.label==='소재');
 return{...f,input,model,resolve,materialField,notice};
}

test('an explicit majority composition selects its official main material without changing the full composition notice',()=>{
 for(const material of ['면 85%, 스판덱스 10%, 나일론 5%','85% 棉，10% 氨纶，5% 锦纶','cotton85%,spandex10%,nylon5%']){
  const f=fixture(material),before=JSON.stringify(f.input),result=f.resolve();
  for(const row of result.rows){assert.equal(row.fields[f.materialField.id].value,'면');assert.deepEqual([...row.fields[f.materialField.id].validationIssues],[]);assert.equal(row.fields[f.notice.id].value,material);}
  assert.equal(JSON.stringify(f.input),before);
 }
});

test('detail-priority material projection uses the same bounded official-choice matching',()=>{
 const f=fixture('폴리에스테르 80%');f.content.label.material.provenance='collected';
 f.content.detail.description={value:'재질: 면 85%, 스판덱스 10%, 나일론 5%',provenance:'translated',updatedAt:f.product.updated_at};
 assert.equal(f.resolve().rows[1].fields[f.materialField.id].value,'면');
});

test('partial, tied, invalid, or unlisted compositions remain unresolved instead of guessing a material',()=>{
 for(const material of ['면 50%, 나일론 50%','면 40%, 나일론 35%, 폴리에스테르 25%','면 85%','면 85%, 나일론 20%','면 70%, 면 25%, 나일론 5%','스판덱스 85%, 나일론 15%','면 혼방']){
  const f=fixture(material),field=f.resolve().rows[1].fields[f.materialField.id];
  assert.equal(field.value,material);assert.match(field.validationIssues.join(' '),/단일 재질.*직접 선택/);
 }
});

test('material exact choices and manual quotation values or blanks always retain their existing behavior',()=>{
 const f=fixture('나일론');assert.equal(f.resolve().rows[1].fields[f.materialField.id].value,'나일론');
 f.content.label.material.value='면 85%, 스판덱스 10%, 나일론 5%';
 f.input.overrides={common:{[f.materialField.id]:'나일론'},options:{[f.options.rows[0].id]:{[f.materialField.id]:''}}};
 const result=f.resolve();assert.equal(result.rows[0].fields[f.materialField.id].value,'나일론');assert.equal(result.rows[1].fields[f.materialField.id].value,'');assert.equal(result.rows[1].fields[f.materialField.id].source,'manual-option');
 f.input.overrides={common:{},options:{}};f.content.label.material.value='';assert.equal(f.resolve().rows[1].fields[f.materialField.id].value,'');
});

test('material choices use exact official wire values and decline ambiguous aliases',()=>{
 const m=module('app/product-fact-priority.ts'),choices=[{value:'COTTON-WIRE',label:'면'},{value:'NYLON-WIRE',label:'나일론'}];
 assert.equal(m.productMaterialChoice('면',choices),'COTTON-WIRE');
 assert.equal(m.productMaterialChoice('棉85%，锦纶15%',choices),'COTTON-WIRE');
 assert.equal(m.productMaterialChoice('100% cotton',choices),'COTTON-WIRE');
 assert.equal(m.productMaterialChoice('면85%,나일론15%',[...choices,{value:'ANOTHER-COTTON',label:'cotton'}]),null);
 assert.equal(m.productMaterialChoice('cotton85%,nylon15%',[{value:'COTTON-MIXED',label:'면 혼방'}]),null);
});

test('signed or malformed percentage fragments cannot be discarded to establish a majority',()=>{
 const m=module('app/product-fact-priority.ts'),choices=[{value:'COTTON',label:'면'}];
 for(const value of ['-85% cotton,10% spandex,5% nylon','.85% cotton,10% spandex,5% nylon',
  '85% cotton,-10% spandex,5% nylon','85% cotton, - 10% spandex,5% nylon',
  '+85% cotton,10% spandex,5% nylon','85% cotton,.10% spandex,5% nylon',
  '100% cotton, .% nylon','100% cotton, -% nylon','100% cotton, 0.5 nylon']){
  assert.equal(m.productMaterialChoice(value,choices),null,value);
 }
 assert.equal(m.productMaterialChoice('85.5% cotton,9.5% spandex,5% nylon',choices),'COTTON');
 assert.equal(m.productMaterialChoice('85% cotton,10% spandex,5% nylon.',choices),'COTTON');
 assert.match(m.productFactPriorityIssue('순면','material','85% cotton,10% spandex,5% nylon.'),/성분 비율/);
});
