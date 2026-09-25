import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file, deps={}) {const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>deps[name]??load(name.slice(2)+'.ts',deps)});return exports;}
const {quotationKeywordPlan}=load('app/quotation-keywords.ts');
test('keyword proposal respects exact 150-character separator budget and never splits an overlong keyword',()=>{
 const input=[...Array.from({length:6},(_,i)=>String(i)+'가'.repeat(19)),'나'.repeat(18)];
 const exact=quotationKeywordPlan(input.join('\n'));
 assert.equal(exact.resultLength,150);assert.equal(exact.omitted.length,0);
 const extra=quotationKeywordPlan([...input,'추가','다'.repeat(21)].join(','));
 assert.equal(extra.resultLength,150);assert.equal(extra.omitted.length,2);assert.equal(extra.kept.length,7);
 assert.equal(extra.omitted[1].value,'다'.repeat(21));
});
test('empty input, duplicates, whitespace and later fitting terms retain original order',()=>{
 assert.equal(quotationKeywordPlan(' , \n ').kept.length,0);
 const plan=quotationKeywordPlan('  가방,가방\n'+'나'.repeat(21)+',끈');
 assert.equal(plan.kept.join(','),'가방,끈');assert.equal(plan.omitted.length,2);
 assert.equal(plan.original.length,4);
});
test('review only changes input after the user applies the visible proposal, and refuses an empty result',()=>{
 const jsx=(type,props)=>({type,props});const {QuotationKeywordReview}=load('app/components/quotation-keyword-review.tsx',{'react/jsx-runtime':{jsx,jsxs:jsx}});
 const walk=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(walk):[n,...walk(n.props?.children)];
 let applied=null;
 const nodes=walk(QuotationKeywordReview({value:'가방,가방,끈',onApply:value=>applied=value}));
 assert.equal(applied,null);const button=nodes.find(n=>n.type==='button');assert.equal(button.props.disabled,false);button.props.onClick();assert.equal(applied,'가방\n끈');
 const empty=walk(QuotationKeywordReview({value:'가'.repeat(21),onApply:()=>{throw Error('must not apply');}}));assert.equal(empty.find(n=>n.type==='button').props.disabled,true);
});
