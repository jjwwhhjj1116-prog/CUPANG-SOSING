import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/quotation-option-title.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const title=exports.quotationOptionTitle;
test('the observed selected saved Korean name appends once to an unchanged saved base title',()=>{
 const option={translatedName:'유광 검정 / 선글라스 + 005 케이스',originalName:'原文',color:'다른 색상',supplierSku:'source-sku'},before=JSON.stringify(option);
 assert.equal(title('검토 브랜드 우드 패턴 다리 선글라스',option),'검토 브랜드 우드 패턴 다리 선글라스, 유광 검정 / 선글라스 + 005 케이스');assert.equal(JSON.stringify(option),before);
 assert.equal(title('저장한 제목',{translatedName:'저장한 제목'}),'저장한 제목, 저장한 제목','the observed method neither deduplicates nor rewrites seller text');
});
test('missing or deliberately empty names never use the source name, colour or SKU and a blank SEO base stays blank',()=>{
 for(const option of [null,undefined,{translatedName:'',originalName:'原文',color:'검정',supplierSku:'SKU'}])assert.equal(title('확인 제목',option),'확인 제목');
 assert.equal(title('',{translatedName:'한글 옵션'}),'');assert.equal(title('',null),'');
});
test('the two saved strings keep whitespace, punctuation, Unicode and full length for downstream constraint review',()=>{
 assert.equal(title('  확인 제목  ',{translatedName:' 옵션, A\n😀 '}),'  확인 제목  ,  옵션, A\n😀 ');
 const base='가'.repeat(500),name='😀'.repeat(250);assert.equal(title(base,{translatedName:name}),base+', '+name);assert.equal(title(base,{translatedName:name}).length,1002);
});
