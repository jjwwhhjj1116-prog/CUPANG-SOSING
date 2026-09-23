import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const requireNative = createRequire(import.meta.url);
const cache = new Map();
function load(file, overrides = {}) {
  if (!Object.keys(overrides).length && cache.has(file)) return cache.get(file);
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(compiled, { exports, Error, structuredClone, require(name) {
    if (name in overrides) return overrides[name];
    if (name.endsWith('.css')) return {};
    if (name.startsWith('@/app/')) return load(`${name.slice(2)}.ts`);
    if (name === 'react' || name === 'react/jsx-runtime') return requireNative(name);
    throw Error(`Unexpected dependency ${name}`);
  } });
  if (!Object.keys(overrides).length) cache.set(file, exports);
  return exports;
}
const editor = load('app/components/quotation-fields-editor.tsx');
const model = load('app/quotation-schema.ts');
const contentModel = load('app/product-content.ts');
const optionsModel = load('app/product-options.ts');
const settingsModel = load('app/workspace-settings.ts');
const clone = value => JSON.parse(JSON.stringify(value));
const change = (fieldKey, value, optionId = null) => ({ fieldKey, value, optionId });

function fixture(overrides = model.emptyQuotationOverrides(), brand = '기본 브랜드') {
  const content = contentModel.emptyProductContent('p1');
  content.seo.title.value = '상품 제목'; content.seo.keywords.value = ['확인한 태그'];
  content.assets.main.value = ['owner/main.png'];
  const rows = ['red', 'blue', 'excluded'].map((id, index) => ({ ...optionsModel.emptyOptionInput(id), originalName: id, unitCostCny: 4.5, included: index < 2 }));
  const source = { categoryId: '80719', product: { id: 'p1', title: '원문 제목', supply_price: 2000, sale_price: 3000, msrp: 4000, exchange_rate: 200, supply_margin: 0, coupang_margin: 0, image_keys: JSON.stringify(['owner/main.png', 'owner/second.png']) },
    content, settings: { ...settingsModel.defaultSettings, brand }, options: optionsModel.applyOptionRows(optionsModel.emptyProductOptions('p1'), rows, '2026-09-24T00:00:00.000Z') };
  return { revision: 1, inputFingerprint: 'fingerprint-1', overrides, resolved: model.resolveQuotationFields({ ...source, overrides }), automatic: model.resolveQuotationFields(source), imageKeys: JSON.parse(source.product.image_keys), submissionReady: false,
    categoryContext: { source: 'collection', profileId: null, categoryId: '80719', categoryPath: [] }, productVersion: '2026-09-24T00:00:00.000Z', contentRevision: 0, optionRevision: 1, updatedAt: null };
}

test('price relationship responds to both unsaved price cells, option inheritance and resets', () => {
  const view = fixture({common: {supplyPrice: '4000', salePrice: '3000'}, options: {}});
  const issue = cell => cell.issues.some(text => text.includes('공급가보다'));
  assert.equal(issue(editor.resolveQuotationEditorCell(view, [], 'red', 'salePrice')), true);
  assert.equal(issue(editor.resolveQuotationEditorCell(view, [change('supplyPrice', '2000')], 'red', 'salePrice')), false);
  assert.equal(issue(editor.resolveQuotationEditorCell(view, [change('salePrice', '5000', 'red')], 'red', 'salePrice')), false);
  assert.equal(issue(editor.resolveQuotationEditorCell(view, [change('salePrice', '5000', 'red')], 'blue', 'salePrice')), true);
});

test('editor keeps explicit empty manual values distinct from resetting to common or automatic values', () => {
  const view = fixture({ common: { brand: '공통 수정' }, options: { red: { brand: '빨강 전용' } } });
  let draft = editor.updateQuotationEditorDraft(view.overrides, [], change('brand', '', 'red'));
  assert.equal(editor.resolveQuotationEditorCell(view, draft, 'red', 'brand').value, '');
  assert.equal(editor.resolveQuotationEditorCell(view, draft, 'red', 'brand').source, 'manual-option');
  draft = editor.updateQuotationEditorDraft(view.overrides, draft, change('brand', null, 'red'));
  assert.equal(editor.resolveQuotationEditorCell(view, draft, 'red', 'brand').value, '공통 수정');
  draft = editor.updateQuotationEditorDraft(view.overrides, draft, change('brand', null));
  assert.equal(editor.resolveQuotationEditorCell(view, draft, 'red', 'brand').value, '기본 브랜드');
  const refreshed = fixture(view.overrides, '새 기본 브랜드');
  assert.equal(editor.resolveQuotationEditorCell(refreshed, draft, 'red', 'brand').value, '새 기본 브랜드');
  assert.equal(editor.resolveQuotationEditorCell(refreshed, [], 'red', 'brand').value, '빨강 전용');
  assert.equal(view.overrides.common.brand, '공통 수정');
});

test('staging replaces only the same option and field, removes no-op edits, and does not override readonly category data', () => {
  const view = fixture();
  const draft = editor.updateQuotationEditorDraft(view.overrides, [change('brand', 'A', 'red'), change('brand', 'B', 'blue'), change('model', 'M')], change('brand', 'C', 'red'));
  assert.equal(draft.length, 3); assert.equal(draft.find(item => item.optionId === 'blue').value, 'B');
  assert.equal(editor.updateQuotationEditorDraft(view.overrides, draft, change('brand', null, 'red')).length, 2);
  const category = editor.resolveQuotationEditorCell(view, [change('category', 'forged')], null, 'category');
  assert.match(category.value, /80719/); assert.equal(category.source, 'schema');
});

test('bulk preview is non-mutating, names existing manual overwrites, and copies only selected fields to requested option scope', () => {
  const view = fixture({ common: {}, options: { blue: { brand: '유지할 기존값', model: '기존 모델' } } });
  const draft = [change('brand', '', 'red')];
  const before = JSON.stringify({ view, draft });
  const preview = editor.previewQuotationEditorBulk(view, draft, 'red', ['brand'], true);
  assert.equal(preview.rows.length, 1); assert.equal(preview.rows[0].optionId, 'blue');
  assert.equal(preview.rows[0].manualBefore, true); assert.equal(preview.rows[0].before, '유지할 기존값'); assert.equal(preview.rows[0].after, '');
  assert.equal(JSON.stringify({ view, draft }), before);
  const applied = editor.applyQuotationEditorBulk(view, draft, preview);
  assert.equal(editor.resolveQuotationEditorCell(view, applied, 'blue', 'brand').value, '');
  assert.equal(editor.resolveQuotationEditorCell(view, applied, 'blue', 'model').value, '기존 모델');
  assert.equal(editor.resolveQuotationEditorCell(view, applied, 'excluded', 'brand').value, '기본 브랜드');
  assert.equal(editor.previewQuotationEditorBulk(view, draft, 'red', ['brand'], false).rows.length, 2);
  assert.throws(() => editor.previewQuotationEditorBulk(view, draft, 'red', ['category'], true), /수정 가능/);
});

test('bulk application rejects stale inputs or saved revisions and bounds oversized operations', () => {
  const view = fixture(); const draft = [change('brand', '수정', 'red')];
  const preview = editor.previewQuotationEditorBulk(view, draft, 'red', ['brand'], true);
  for (const next of [{ ...view, revision: 2 }, { ...view, inputFingerprint: 'changed' }]) assert.throws(() => editor.applyQuotationEditorBulk(next, draft, preview), /미리보기 이후/);
  assert.throws(() => editor.applyQuotationEditorBulk(view, [...draft, change('model', 'M')], preview), /미리보기 이후/);
  const large = clone(view);
  const source = large.resolved.rows[1]; const automatic = large.automatic.rows[1];
  for (let index = 0; index < 30; index++) { large.resolved.rows.push({ ...source, optionId: `more-${index}` }); large.automatic.rows.push({ ...automatic, optionId: `more-${index}` }); }
  const fields = large.resolved.schema.fields.filter(field => !field.readOnly).map(field => field.id);
  assert.throws(() => editor.previewQuotationEditorBulk(large, [], null, fields, true), /1,000/);
});

test('refresh preserves local drafts, detects concurrent same-cell edits, retains unresolved conflicts and removes edits already saved', () => {
  const previous = fixture({ common: { brand: '저장 A' }, options: {} });
  const next = fixture({ common: { brand: '다른 작업 B' }, options: {} }, '바뀐 기본값'); next.revision = 2;
  const changes = [change('brand', '내 입력 C'), change('model', '입력 모델', 'red')];
  const result = editor.reconcileQuotationEditorDraft(previous, next, changes);
  assert.equal(result.changes.length, 2); assert.equal(result.conflicts.length, 1); assert.equal(result.conflicts[0].saved, '다른 작업 B');
  const repeat = editor.reconcileQuotationEditorDraft(next, next, result.changes, result.conflicts);
  assert.equal(repeat.conflicts.length, 1, 'A second automatic refresh must not silently resolve the conflict');
  const matched = fixture({ common: { brand: '내 입력 C' }, options: {} });
  const acknowledged = editor.reconcileQuotationEditorDraft(next, matched, result.changes, result.conflicts);
  assert.equal(acknowledged.changes.length, 1); assert.equal(acknowledged.conflicts.length, 0);
  const removed = clone(next); removed.resolved.rows = removed.resolved.rows.filter(row => row.optionId !== 'red');
  assert.equal(editor.reconcileQuotationEditorDraft(previous, removed, changes).conflicts.find(item => item.change.optionId === 'red').unavailable, true);
});

test('editor shares schema validation for packaging, integer quantities, search tags and owned image count', () => {
  const view = fixture();
  const issues = (id, value) => editor.quotationEditorIssues(view.resolved.schema.fields.find(field => field.id === id), { value, source: 'manual-common', issues: [], needsReview: false }, view.imageKeys);
  for (const [id, value] of [['boxSkuQuantity', '1.5'], ['boxSkuQuantity', '0'], ['packagedWeightG', '1e3'], ['packagedDimensionsMm', '20 cm'], ['searchTags', '긴'.repeat(21)], ['mainImage', 'owner/main.png\nowner/second.png'], ['labelImages', 'other/foreign.png']]) assert.ok(issues(id, value).length, `${id}: ${value}`);
  assert.equal(issues('packagedDimensionsMm', '200*300*400').length, 0);
  assert.equal(issues('shelfLifeDays', '0').length, 0);
  assert.ok(issues('packagedWeightG', '').length);
  assert.doesNotThrow(() => model.validateQuotationChanges([change('packagedWeightG', '')], { schema: view.resolved.schema, optionIds: ['red', 'blue', 'excluded'], ownedImageKeys: view.imageKeys }));
});

function renderEditor(view, section = 'start', changes = []) {
  let slot = 0;
  const states = [view, changes, [], false, false, '', '', section, null, [], true, null];
  const hooks = { useState: initial => [slot < states.length ? states[slot++] : (typeof initial === 'function' ? initial() : initial), () => {}], useEffect() {}, useCallback: callback => callback, useRef: value => ({ current: value }), useId: () => 'editor-test' };
  const { QuotationFieldsEditor } = load('app/components/quotation-fields-editor.tsx', { react: hooks });
  return renderToStaticMarkup(React.createElement(QuotationFieldsEditor, { productId: 'p1' }));
}
test('rendered editor has five groups, marks schema uncertainty, marks observed defaults as reviewable and escapes manual HTML', () => {
  const view = fixture();
  const start = renderEditor(view);
  for (const section of ['시작 정보', '상품 정보', '이미지', '법적 정보', '물류 정보']) assert.ok(start.includes(section));
  assert.ok(start.includes('Supplier Hub 공식 화면')); assert.ok(start.includes('최종 접수는 추가 검증'));
  const legal = renderEditor(view, 'legal');
  assert.ok(legal.includes('인증')); assert.ok(legal.includes('value="해당사항없음" selected'));
  assert.ok(legal.includes('쿠플러스 양식 기본값')); assert.ok(legal.includes('검토 필요'));
  const malicious = '<script>alert("x")</script><img src="https://external.invalid/secret">';
  const image = renderEditor(view, 'image', [change('detailHtml', malicious)]);
  assert.ok(!image.includes('<script>alert')); assert.ok(!image.includes('<img src="https://external.invalid'));
  assert.ok(image.includes('&lt;script&gt;')); assert.ok(image.includes('/api/files/owner/main.png'));
  const unknown = clone(view); unknown.resolved.schema.status = 'unconfirmed'; unknown.resolved.schema.categoryId = 'other';
  assert.ok(renderEditor(unknown).includes('이 카테고리의 세부 규격은 미확인'));
});

test('rendered official dropdowns have a single blank choice and preserve an out-of-list saved value for correction',()=>{
  const view=fixture();
  for(const set of [view.resolved,view.automatic]){const material=set.rows.find(row=>row.optionId===null).fields.storageMaterial;material.value='면';material.source='content';material.issues=['지원하는 선택값을 확인해주세요.'];material.needsReview=true;}
  const html=renderEditor(view,'product');
  const select=id=>{const match=html.match(new RegExp(`<select[^>]*id="editor-test-${id}"[^>]*>([\\s\\S]*?)</select>`));assert.ok(match,id);return match[1];};
  for(const id of ['lidIncluded','storageMaterial','transparent']){const body=select(id);assert.equal((body.match(/<option value=""/g)||[]).length,1);assert.ok(body.includes('해당사항없음</option>'));}
  const material=select('storageMaterial');assert.ok(material.includes('면 · 목록 외 저장값'));assert.ok(material.includes('value="면" selected'));assert.ok(html.includes('지원하는 선택값을 확인해주세요.'));
  assert.ok(select('transparent').includes('value="해당없음"'));assert.ok(select('tradeType').includes('선택하지 않음'));
  for(const label of ['색상','수량','사이즈'])assert.ok(html.includes(`${label}<b>*</b>`));
  assert.ok(html.includes('Supplier Hub 공식 화면'));assert.ok(html.includes('이미지·인증·물류'));assert.ok(!html.includes('value="해당사항없음" selected'));
});

test('blank optional drafts do not receive a review badge while required blanks, invalid values and evidence review remain', () => {
  const view = fixture();
  assert.equal(editor.resolveQuotationEditorCell(view, [change('searchTags', '')], null, 'searchTags').needsReview, false);
  assert.equal(editor.resolveQuotationEditorCell(view, [change('msrp', '')], null, 'msrp').needsReview, false);
  assert.equal(editor.resolveQuotationEditorCell(view, [change('supplyPrice', '')], null, 'supplyPrice').needsReview, true);
  assert.equal(editor.resolveQuotationEditorCell(view, [change('msrp', 'wrong')], null, 'msrp').needsReview, true);
  assert.equal(editor.resolveQuotationEditorCell(view, [change('kcCertificationNumber', '')], null, 'kcCertificationNumber').needsReview, true);
});

test('80719 option limit appears above the option editor and leaves all options selectable', () => {
  const view = fixture(); const source = view.resolved.rows[1]; const automatic = view.automatic.rows[1];
  view.resolved.rows = [view.resolved.rows[0], ...Array.from({ length: 200 }, (_, index) => ({ ...source, optionId: `item-${index}`, included: index < 101 }))];
  view.automatic.rows = [view.automatic.rows[0], ...Array.from({ length: 200 }, (_, index) => ({ ...automatic, optionId: `item-${index}`, included: index < 101 }))];
  const html = renderEditor(view);
  assert.ok(html.includes('현재 견적 포함 옵션 101개')); assert.ok(html.includes('로컬 옵션은 모두 보존됩니다.'));
  assert.ok(html.indexOf('현재 견적 포함 옵션 101개') < html.indexOf('편집할 옵션'));
  assert.ok(html.includes('value="item-199"'));
  const invalidBarcode = renderEditor(fixture({ common: { barcodeMode: 'existing' }, options: {} }), 'product', [change('barcode', 'abc123')]);
  assert.ok(invalidBarcode.includes('실제 바코드는 6~14자'));
});

test('category changes retain unsaved values and require explicit review even when saved text matches',()=>{
 const previous=fixture();const next=fixture({common:{brand:'내 브랜드'},options:{}});
 next.resolved.schema.categoryId='77442';
 const draft=[change('brand','내 브랜드')];const original=JSON.stringify({previous,next,draft});
 const result=editor.reconcileQuotationEditorDraft(previous,next,draft);
 assert.equal(result.changes.length,1);assert.equal(result.conflicts[0].schemaChanged,true);
 const repeated=editor.reconcileQuotationEditorDraft(next,next,result.changes,result.conflicts);
 assert.equal(repeated.conflicts.length,1);
 assert.equal(editor.reconcileQuotationEditorDraft(next,next,repeated.changes,[]).changes.length,0);
 assert.equal(JSON.stringify({previous,next,draft}),original);
});
test('changed field rules trigger review only for affected drafts and removed fields stay unavailable',()=>{
 const previous=fixture();const next=clone(previous);
 next.resolved.schema.fields.find(field=>field.id==='brand').maxLength=5;
 const result=editor.reconcileQuotationEditorDraft(previous,next,[change('brand','브랜드'),change('model','모델')]);
 assert.equal(result.changes.length,2);assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].change.fieldKey,'brand');
 next.resolved.schema.fields=next.resolved.schema.fields.filter(field=>field.id!=='brand');
 assert.equal(editor.reconcileQuotationEditorDraft(previous,next,result.changes).conflicts[0].unavailable,true);
});
