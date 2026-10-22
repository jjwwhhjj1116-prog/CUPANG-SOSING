import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/quotation-packaged-weight.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error});
const base={id:'packagedWeightG',type:'number',section:'logistics',visibility:'common',unit:'g',required:true};
const wire={id:'hub_weight',type:'text',numericText:true,hubInput:'packagedWeightG',hubWire:{path:['logisticsPage','skuUnitBoxWeight']},section:'logistics',visibility:'common',unit:'g',required:true};
const plain=value=>JSON.parse(JSON.stringify(value));
test('the native form displays a single weight input while retaining both exact stored IDs and save linkage',()=>{
 for(const value of ['', '10']){
  const fields=[base,wire,{id:'other',label:'한 개 단품 포장 무게',type:'text'}],before=JSON.stringify(fields);
  assert.deepEqual(plain(exports.quotationPackagedWeightVisibleFields(fields,()=>value)).map(x=>x.id),['hub_weight','other']);
  assert.equal(exports.quotationPackagedWeightDisplayField(fields,'packagedWeightG',()=>value),'hub_weight');
  assert.deepEqual(plain(exports.quotationPackagedWeightEditFields(fields,'hub_weight','10')),['hub_weight','packagedWeightG']);
  assert.equal(JSON.stringify(fields),before);
 }
});
test('conflicting manual weight values both remain visible and focus keeps the exact conflicting ID',()=>{
 const fields=[base,wire],read=id=>id==='packagedWeightG'?'10':'20';
 assert.deepEqual(plain(exports.quotationPackagedWeightVisibleFields(fields,read)).map(x=>x.id),['packagedWeightG','hub_weight']);
 assert.equal(exports.quotationPackagedWeightDisplayField(fields,'packagedWeightG',read),'packagedWeightG');
});
test('labels or unrelated units/wires never collapse distinct physical inputs',()=>{
 for(const patch of [{unit:'kg'},{numericText:false},{readOnly:true},{hubWire:{path:['productPage','weight']}},{hubWire:{path:['logisticsPage','skuUnitBoxWeight'],name:'unrelated'}}]){
  const fields=[base,{...wire,...patch}];assert.equal(exports.quotationPackagedWeightVisibleFields(fields,()=>'' ).length,2);
 }
 assert.equal(exports.quotationPackagedWeightVisibleFields([base,wire,{...wire,id:'ambiguous'}],()=>'' ).length,3);
});
