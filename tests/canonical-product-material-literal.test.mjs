import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
const api=providedOptionModule('app/product-fact-priority.ts');

test('complete same-fiber aliases become their existing Korean name without an invented percentage',()=>{
 for(const [raw,want]of [['涤纶（聚酯纤维）','폴리에스테르'],['polyester / 涤纶','폴리에스테르'],['棉 / cotton / 코튼','면'],['氨纶（elastane）','스판덱스'],['锦纶 / nylon','나일론']])assert.equal(api.canonicalProductMaterialLiteral(raw),want,raw);
});
test('explicit compositions preserve ordered original numeric and percent tokens including partial composition',()=>{
 for(const [raw,want]of [['棉85.0%,氨纶10%,锦纶5%','면 85.0%, 스판덱스 10%, 나일론 5%'],['85% 棉，10% 氨纶，5% 锦纶','면 85%, 스판덱스 10%, 나일론 5%'],['80% polyester','폴리에스테르 80%'],['100% polyester','폴리에스테르 100%'],['85.0％cotton / nylon15％','면 85.0％, 나일론 15％']])assert.equal(api.canonicalProductMaterialLiteral(raw),want,raw);
});
test('unknown residue, denier numbers, unsupported fibers and ambiguous mixtures never become canonical material',()=>{
 for(const raw of ['', '涤纶100D','100D polyester','polyester 100','테리폼（폴리에스테르）','polyester nylon','85% cotton / nylon','cotton85%,unknown15%','cotton85%,nylon20%','cotton85%,cotton10%,nylon5%','纯棉','polyester waterproof','-85% cotton,15% nylon','.85% cotton,15% nylon','polyester（폴리에스터）'])assert.equal(api.canonicalProductMaterialLiteral(raw),null,raw);
});
test('existing main-material choices retain their old full-composition and exact-choice behavior',()=>{
 const choices=[{value:'COTTON',label:'면'},{value:'POLY',label:'폴리에스테르'}];
 assert.equal(api.productMaterialChoice('cotton85%,nylon15%',choices),'COTTON');
 assert.equal(api.productMaterialChoice('80% polyester',choices),null);
 assert.equal(api.productMaterialChoice('폴리에스테르',choices),'POLY');
});
