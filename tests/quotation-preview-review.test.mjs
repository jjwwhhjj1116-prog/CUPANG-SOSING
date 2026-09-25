import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const exports = {};
const source = fs.readFileSync(new URL('../app/components/quotation-preview-review.tsx', import.meta.url), 'utf8');
const native=createRequire(import.meta.url),shared={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/quotation-review-issues.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:shared,require:native});
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require:name=>name==='@/app/components/quotation-review-issues'?shared:native(name) });
const { QuotationPreviewReview: Panel } = exports;
const review = { errorCount: 1, reviewCount: 1, omittedIssueCount: 2, limits: ['파일 헤더 검사'], issues: [
  { kind: 'error', fieldId: 'labelImages', optionId: 'red', optionLabel: '<script>빨강</script>', message: '라벨 첨부 필요' },
  { kind: 'review', fieldId: null, optionId: null, optionLabel: '공통', message: '별도 확인' },
] };
test('preview findings escape option text, show omitted totals and disable navigation while editing', () => {
  const html = renderToStaticMarkup(createElement(Panel, { review, disabled: true, onInspect() {} }));
  assert.match(html, /수정 필요 1개/); assert.match(html, /확인 필요 1개/);
  assert.match(html, /추가 2개/); assert.match(html, /파일 헤더 검사/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /disabled=""/);
});
test('issue navigation retains the exact option and field instead of display labels', () => {
  let target;
  const tree = Panel({ review, disabled: false, onInspect: value => { target = value; } });
  const buttons = [];
  function visit(node) {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    if (node.type === shared.QuotationReviewIssues) buttons.push(node);
    visit(node.props?.children);
  }
  visit(tree); assert.equal(buttons.length, 1);
  buttons[0].props.onInspect({optionId:'red',fieldId:'labelImages'});
  assert.equal(target.optionId, 'red'); assert.equal(target.fieldId, 'labelImages');
  const html = renderToStaticMarkup(createElement(Panel, { review: { ...review, errorCount: 0, reviewCount: 0, omittedIssueCount: 0, issues: [] }, disabled: false, onInspect() {} }));
  assert.match(html, /실제 접수 검증은 별도/);
});
