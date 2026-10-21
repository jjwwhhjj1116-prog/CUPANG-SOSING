import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const cache=new Map();
function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,TextEncoder,Date,Set,Map,Error,require:name=>{assert(name.startsWith('@/'));return load(name.slice(2)+'.ts');}});return exports;}
const model=load('app/product-label.ts'),plain=value=>JSON.parse(JSON.stringify(value));
test('new Couplus structure freezes importer before manufacturer with unchanged semantic keys',()=>{
 const structure=plain(model.couplusProductLabelStructure());
 assert.deepEqual(structure.map(field=>field.id),['productName','importer','manufacturer','countryOfOrigin','netContents','material','productType','precautions','usageStandard']);
 assert.deepEqual(structure.slice(0,4).map(field=>field.label),['제품명','수입 및 판매원','제조원','제조국']);
 assert.deepEqual(structure.filter(field=>field.required).map(field=>field.id),['productName']);
 assert.deepEqual(plain(model.validateProductLabelStructure(structure)),structure);
});
test('absent legacy structure and saved custom order remain unchanged and independent from the new factory',()=>{
 const legacy=plain(model.productLabelStructure());assert.deepEqual(legacy.slice(0,3).map(field=>field.id),['productName','manufacturer','importer']);
 const saved=[{id:'custom_saved',label:'보관한 항목',required:false},legacy[0],legacy[2]],before=JSON.stringify(saved),copy=model.productLabelStructure({structure:saved});
 const fresh=model.couplusProductLabelStructure();fresh.reverse();fresh[0].label='변경한 임시 사본';copy[0].label='별도 임시 사본';
 assert.equal(JSON.stringify(saved),before);assert.deepEqual(plain(model.productLabelStructure()),legacy);
 assert.equal(model.couplusProductLabelStructure()[0].id,'productName');assert.equal(model.couplusProductLabelStructure()[8].label,'사용 기준');
});
