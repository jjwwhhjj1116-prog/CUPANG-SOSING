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
  vm.runInNewContext(compiled, { exports, structuredClone, TextEncoder, require(name) {
    if (name === 'parse5') return parse5;
    if (name.startsWith('./')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
    if (!name.startsWith('@/app/')) throw Error(name);
    return load(name.slice(2) + '.ts');
  } });
  cache.set(file, exports); return exports;
}
const model = load('app/quotation-schema.ts');

const profiles=load('app/category-profiles.ts');
const hubs=load('app/hub-product-schemas.ts').hubProductSchemas;
const ids=[...new Set([...Object.keys(hubs),'80719','81452','64497','103495','77442','81221'])];
test('all known category quotation fields can be mapped into final exports',()=>{
  const missing=[];
  for(const id of ids) for(const field of model.getQuotationSchema(id).fields){
    if(!Object.hasOwn(profiles.categoryFields,field.id))missing.push(`${id}: ${field.id} (${field.label})`);
  }
  assert.deepEqual(missing,[]);
});

test('category-specific fields cannot be connected to another Supplier Hub category',()=>{
 for(const id of ids){
  const schema=model.getQuotationSchema(id);
  for(const field of schema.fields.filter(f=>/^(glove_|brace_|board_|tooth_|marathon_|hub_)/.test(f.id))){
   assert.equal(profiles.categoryFieldScope(field.id),id,field.id);
   const profile={name:'개발 검증',categoryId:'999999',categoryPath:['다른 카테고리'],template:{name:'test.csv',format:'csv',sha256:'a'.repeat(64),sheetName:'',headerRow:1,headers:[field.label]},mappings:[{column:0,field:field.id,required:false}]};
   assert.throws(()=>profiles.validateCategoryProfile(profile),/다른 카테고리/);
  }
 }
});
test('export fails explicitly instead of silently discarding an unmapped schema field',()=>{
 const exporter=load('app/exports/quotation-fields.ts');
 assert.throws(()=>exporter.resolvedQuotationRows({}, {schema:{fields:[{id:'future_field',label:'신규 항목'}]},rows:[]},[]),/내보내기 연결이 없는 항목.*신규 항목/);
});
