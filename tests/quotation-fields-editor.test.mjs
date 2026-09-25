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
  vm.runInNewContext(compiled, { exports, Error, TextEncoder, structuredClone, AbortController, fetch: overrides.fetch ?? fetch, require(name) {
    if (name in overrides) return overrides[name];
    if (name.endsWith('.css')) return {};
    if (name.startsWith('@/app/')) {
      const modulePath = name.slice(2);
      return load(`${modulePath}.${fs.existsSync(new URL(`../${modulePath}.ts`, import.meta.url)) ? 'ts' : 'tsx'}`);
    }
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

test('category choices distinguish unfilled cells from explicit empty N/A and never save UI tokens',()=>{
 const {QuotationChoiceInput}=load('app/components/quotation-choice-input.tsx');
 const {quotationFieldDisplay}=load('app/quotation-field-display.ts');
 const ids=[...new Set([...Object.keys(load('app/hub-product-schemas.ts').hubProductSchemas),'80719','81452','64497','103495','77442'])];
 let covered=0;
 for(const id of ids){
  for(const field of model.getQuotationSchema(id).fields.filter(f=>f.choices?.some(c=>c.value===''))){
   covered++;const cell={value:'',source:'empty',needsReview:false,issues:[]};const written=[];
   const props={field,cell,id:'test',disabled:false,onChange:v=>written.push(v)};
   let element=QuotationChoiceInput(props);assert.equal(element.props.value,'unset');
   assert.equal(quotationFieldDisplay(field,cell),'[공란]');
   const index=field.choices.findIndex(c=>c.value==='');
   element.props.onChange({target:{value:`choice-${index}`}});assert.deepEqual(written,['']);
   for(const source of ['manual-option','manual-common','couplus-default','content']){
    const saved={...cell,source};element=QuotationChoiceInput({...props,cell:saved});
    assert.equal(element.props.value,`choice-${index}`);assert.equal(quotationFieldDisplay(field,saved),field.choices[index].label);
    const legalField={...field,section:'legal'};
    const plan=load('app/quotation-label-plan.ts').quotationLabelPlan({schema:{categoryId:id,categoryPath:[],fields:[legalField,{id:'title',label:'상품명',section:'start'}]},rows:[{optionId:null,optionLabel:'공통',included:true,fields:{[field.id]:saved,title:{value:'상품명',source:'content'}}}]},null);
    assert.equal(plan.rows[0][1],field.choices[index].label);
   }
   element.props.onChange({target:{value:'unset'}});element.props.onChange({target:{value:'choice-99999'}});assert.deepEqual(written,['']);
  }
 }
 assert.equal(ids.length,26);assert.ok(covered>100);
});

test('choice input keeps out-of-list saved values and ordinary clear choices intact',()=>{
 const {QuotationChoiceInput}=load('app/components/quotation-choice-input.tsx');const field={choices:[{value:'yes',label:'예'}]};const written=[];
 const element=QuotationChoiceInput({field,cell:{value:'old',source:'manual-option'},id:'test',disabled:false,onChange:v=>written.push(v)});
 assert.equal(element.props.value,'legacy');assert.match(renderToStaticMarkup(element),/old · 목록 외 저장값/);
 element.props.onChange({target:{value:'unset'}});assert.deepEqual(written,['']);
});

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

test('bulk skips missing source values without freezing automatic targets or clearing manual targets',()=>{
 const view=fixture({common:{},options:{blue:{model:'기존 모델',lidIncluded:'뚜껑포함'}}});
 for(const result of [view.automatic,view.resolved]){
  for(const id of ['model','lidIncluded'])result.rows.find(row=>row.optionId==='red').fields[id]={value:'',source:'empty',issues:[],validationIssues:[],needsReview:false};
 }
 const original=JSON.stringify(view);
 const plan=editor.previewQuotationEditorBulk(view,[],'red',['model','lidIncluded','brand'],false);
 assert.equal(plan.skipped.length,2);assert.ok(plan.rows.every(row=>row.fieldKey==='brand'));
 const changes=editor.applyQuotationEditorBulk(view,[],plan);
 assert.equal(editor.resolveQuotationEditorCell(view,changes,'blue','model').value,'기존 모델');
 assert.equal(editor.resolveQuotationEditorCell(view,changes,'blue','lidIncluded').value,'뚜껑포함');
 assert.ok(!changes.some(change=>change.fieldKey==='model'||change.fieldKey==='lidIncluded'));
 const refreshed=clone(view);refreshed.automatic.rows.find(row=>row.optionId==='excluded').fields.model={value:'다음 단계에서 저장한 모델',source:'content',issues:[],needsReview:false};
 assert.equal(editor.resolveQuotationEditorCell(refreshed,changes,'excluded','model').value,'다음 단계에서 저장한 모델');
 assert.equal(JSON.stringify(view),original);
});

test('bulk copies explicit empty choices and manual text clearing, then restores live automatic inheritance',()=>{
 const view=fixture();const draft=[change('lidIncluded','','red'),change('model','','red')];
 const plan=editor.previewQuotationEditorBulk(view,draft,'red',['lidIncluded','model'],true);
 assert.equal(plan.skipped.length,0);assert.equal(plan.rows.length,2);
 assert.equal(plan.rows.find(row=>row.fieldKey==='lidIncluded').afterDisplay,'해당사항없음');
 assert.equal(plan.rows.find(row=>row.fieldKey==='model').afterDisplay,'[공란]');
 const next=editor.applyQuotationEditorBulk(view,draft,plan);
 const cell=editor.resolveQuotationEditorCell(view,next,'blue','lidIncluded');assert.equal(cell.value,'');assert.equal(cell.source,'manual-option');
 const reset=editor.previewQuotationEditorRestore(view,next,['lidIncluded','model'],true);
 assert.equal(reset.rows.find(row=>row.fieldKey==='lidIncluded').afterDisplay,'해당사항없음');
 const restored=editor.applyQuotationEditorBulk(view,next,reset);
 assert.equal(editor.resolveQuotationEditorCell(view,restored,'blue','lidIncluded').source,'couplus-default');
 const refreshed=clone(view);refreshed.automatic.rows.find(row=>row.optionId==='blue').fields.lidIncluded={value:'뚜껑포함',source:'content',issues:[],needsReview:false};
 assert.equal(editor.resolveQuotationEditorCell(refreshed,restored,'blue','lidIncluded').value,'뚜껑포함');
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
  assert.ok(legal.includes('인증')); assert.ok(/selected=""[^>]*>해당사항없음<\/option>/.test(legal));
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
  for(const id of ['lidIncluded','storageMaterial','transparent']){const body=select(id);assert.equal((body.match(/>해당사항없음<\/option>/g)||[]).length,1);assert.ok(body.includes('해당사항없음</option>'));}
  const material=select('storageMaterial');assert.ok(material.includes('면 · 목록 외 저장값'));assert.ok(material.includes('value="legacy" selected'));assert.ok(html.includes('지원하는 선택값을 확인해주세요.'));
  assert.ok(select('transparent').includes('>해당없음</option>'));assert.ok(select('tradeType').includes('선택하지 않음'));
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

test('legacy import stages only reviewed values, preserves blank intent and unrelated drafts without changing originals',()=>{
 const view=fixture({common:{brand:'현재 브랜드'},options:{}});
 view.legacyOverrides={common:{brand:'이전 브랜드',model:''},options:{red:{title:'빨강 이전 제목'}}};
 const changes=[change('searchTags','유지할 태그')];const original=JSON.stringify({view,changes});
 const candidates=editor.legacyQuotationCandidates(view,changes);
 assert.equal(candidates.find(item=>item.change.fieldKey==='brand').before,'현재 브랜드');
 const keys=candidates.filter(item=>item.change.fieldKey!=='title').map(item=>item.key);
 const draft=editor.importLegacyQuotationDraft(view,changes,keys);
 assert.equal(editor.resolveQuotationEditorCell(view,draft,null,'brand').value,'이전 브랜드');
 assert.equal(editor.resolveQuotationEditorCell(view,draft,null,'model').value,'');
 assert.equal(editor.resolveQuotationEditorCell(view,draft,null,'searchTags').value,'유지할 태그');
 assert.equal(draft.some(item=>item.fieldKey==='title'),false);
 assert.equal(JSON.stringify({view,changes}),original);
});
test('legacy import blocks removed options, unsupported fields, readonly cells, invalid values and foreign images',()=>{
 const view=fixture();view.legacyOverrides={common:{category:'80719',retired:'x',mainImage:'other/foreign.png',packagedWeightG:'bad'},options:{deleted:{brand:'x'}}};
 const candidates=editor.legacyQuotationCandidates(view,[]);assert.equal(candidates.length,5);
 for(const item of candidates){assert.ok(item.issues.length);assert.throws(()=>editor.importLegacyQuotationDraft(view,[],[item.key]));}
 assert.throws(()=>editor.importLegacyQuotationDraft(view,[],['missing']));
 assert.throws(()=>editor.importLegacyQuotationDraft(view,[],[]));
 view.categoryContext.categoryId=null;assert.equal(editor.legacyQuotationCandidates(view,[]).length,0);
});

test('legacy comparison renders explicit selection and escapes previous HTML values',()=>{
 const view=fixture();view.legacyOverrides={common:{brand:'<script>legacy()</script>',retired:'이전 필드'},options:{}};
 const html=renderEditor(view);
 assert.ok(html.includes('분류 미지정 이전 입력 비교'));
 assert.ok(html.includes('&lt;script&gt;legacy()&lt;/script&gt;'));
 assert.ok(!html.includes('<script>legacy()'));
 assert.ok(html.includes('현재 양식에서 수정할 수 없는 항목'));
 assert.ok(html.includes('선택한 0개를 편집 초안에 적용'));
});

test('all-option overview reflects unsaved inherited values, resets, defaults and excluded rows without mutation',()=>{
 const view=fixture({common:{brand:'공통 브랜드'},options:{red:{brand:''}}});const before=JSON.stringify(view);
 const rows=editor.quotationOptionOverview(view,[]);
 assert.deepEqual(Array.from(rows,row=>row.optionId),['red','blue']);
 assert.equal(rows[0].missing,rows[1].missing+1);assert.ok(rows[0].defaults>0);assert.ok(rows[0].manual>0);assert.ok(rows[0].linked>0);
 const draft=[change('brand',null,'red'),change('brand','새 브랜드'),change('packagedWeightG','500'),change('packagedDimensionsMm','20*30*40')];
 const next=editor.quotationOptionOverview(view,draft);
 assert.equal(next[0].missing,next[1].missing);assert.equal(next[1].missing,rows[1].missing-2);
 assert.equal(next[0].problems.some(item=>item.fieldKey==='brand'),false);assert.equal(JSON.stringify(view),before);
 const empty=clone(view);empty.resolved.rows.forEach(row=>row.included=false);assert.equal(editor.quotationOptionOverview(empty,[]).length,0);
 const common=clone(empty);common.resolved.rows[0].included=true;assert.equal(editor.quotationOptionOverview(common,[])[0].optionId,null);
});

test('overview validates current draft prices and barcode mode together and renders per-option navigation',()=>{
 const view=fixture();view.resolved.schema.salePriceMustCoverSupply=true;
 const draft=[change('supplyPrice','5000'),change('salePrice','4000'),change('barcodeMode','existing'),change('barcode','bad','red')];
 const rows=editor.quotationOptionOverview(view,draft);
 assert.ok(rows[0].problems.some(item=>item.fieldKey==='salePrice'));assert.ok(rows[0].problems.some(item=>item.fieldKey==='barcode'));
 const fixed=[...draft,change('salePrice','6000','red'),change('barcode','ABC123','blue')];
 const next=editor.quotationOptionOverview(view,fixed);assert.equal(next[0].problems.some(item=>item.fieldKey==='salePrice'),false);assert.equal(next[1].problems.some(item=>item.fieldKey==='barcode'),false);
 const markup=renderToStaticMarkup(React.createElement(editor.QuotationOptionOverview,{view,changes:draft,disabled:true,onOpen(){}}));
 assert.match(markup,/전체 견적 작성 현황/);assert.match(markup,/바코드 구역 열기/);assert.match(markup,/disabled/);assert.doesNotMatch(markup,/>excluded</);
});

test('image role overlap warnings update when only the unsaved main image changes',()=>{
 const view=fixture({common:{detailImages:'owner/main.png'},options:{}});
 const has=changes=>editor.resolveQuotationEditorCell(view,changes,'red','detailImages').issues.includes(model.duplicateQuotationImageIssue);
 assert.equal(has([]),true);
 assert.equal(has([change('mainImage','owner/second.png','red')]),false);
 assert.equal(has([change('detailImages','','red')]),false);
 const overview=editor.quotationOptionOverview(view,[change('mainImage','owner/second.png','red')]);
 assert.equal(JSON.stringify(overview.find(row=>row.optionId==='red')).includes(model.duplicateQuotationImageIssue),false);
});

test('draft evidence metadata follows manual edits, blanks and resets instead of inheriting automatic default warnings',()=>{
 const view=fixture();const before=JSON.stringify(view);
 const auto=view.automatic.rows.find(r=>r.optionId==='red');
 const key=Object.keys(auto.fields).find(key=>auto.fields[key].source==='couplus-default'&&auto.fields[key].value.trim());
 assert.ok(key);
 const original=editor.resolveQuotationEditorCell(view,[],'red',key);
 assert.ok(original.reviewMessages.some(m=>m.includes('쿠플러스')));
 const manual=editor.resolveQuotationEditorCell(view,[change(key,original.value,'red')],'red',key);
 assert.equal(manual.source,'manual-option');assert.equal(manual.reviewMessages.some(m=>m.includes('쿠플러스')),false);
 const blank=editor.resolveQuotationEditorCell(view,[change(key,'','red')],'red',key);
 assert.equal(blank.reviewMessages.length,0);
 const reset=editor.resolveQuotationEditorCell(view,[change(key,null,'red')],'red',key);
 assert.deepEqual(clone(reset.reviewMessages),clone(original.reviewMessages));
 const image=editor.resolveQuotationEditorCell(view,[change('mainImage','owner/second.png','red')],'red','mainImage');
 assert.ok(image.validationIssues.some(m=>m.includes('공개 주소')));
 assert.equal(JSON.stringify(view),before);
});

test('overview preserves automatic validation failures, clears replaced values and restores errors on reset',()=>{
 const view=fixture();const issue='옵션 가격 계산을 확인해주세요.';
 for(const data of [view.automatic,view.resolved]){
  const cell=data.rows.find(row=>row.optionId==='red').fields.supplyPrice;
  cell.validationIssues=[issue];cell.issues=[issue];
 }
 const before=JSON.stringify(view);
 const problems=changes=>editor.quotationOptionOverview(view,changes).find(row=>row.optionId==='red').problems;
 assert.ok(problems([]).some(p=>p.fieldKey==='supplyPrice'&&p.issues.includes(issue)));
 assert.equal(problems([change('supplyPrice','3000','red')]).some(p=>p.fieldKey==='supplyPrice'),false);
 assert.ok(problems([change('supplyPrice',null,'red')]).some(p=>p.issues.includes(issue)));
 assert.ok(problems([]).some(p=>p.fieldKey==='mainImage'&&p.issues.some(text=>text.includes('공개 주소'))));
 assert.equal(problems([]).some(p=>p.issues.some(text=>text.includes('쿠플러스 참조 화면'))),false);
 assert.equal(JSON.stringify(view),before);
});

test('section progress uses current dependent price validation and distinguishes optional errors from required completion',()=>{
 const view=fixture();view.resolved.schema.salePriceMustCoverSupply=true;
 view.resolved.schema.fields=view.resolved.schema.fields.filter(f=>['supplyPrice','salePrice','brand','mainImage'].includes(f.id));
 view.resolved.schema.fields.find(f=>f.id==='salePrice').required=true;
 view.resolved.schema.fields.find(f=>f.id==='supplyPrice').required=false;
 const before=JSON.stringify(view);
 const draft=[change('supplyPrice','5000'),change('salePrice','4000')];
 const progress=changes=>editor.quotationSectionProgress(view,changes,'red');
 const bad=progress(draft).find(s=>s.id==='product');
 const good=progress([change('supplyPrice','3000'),change('salePrice','4000')]).find(s=>s.id==='product');
 assert.equal(good.complete,bad.complete+1);assert.equal(bad.invalid,good.invalid+1);
 assert.equal(bad.required,good.required);
 const image=progress(draft).find(s=>s.id==='image');
 assert.equal(image.required,0);assert.equal(image.complete,0);assert.equal(image.invalid,1);
 assert.equal(progress([...draft,change('mainImage','','red')]).find(s=>s.id==='image').invalid,0);
 const cell=editor.resolveQuotationEditorCell(view,draft,'red','salePrice');
 const field=view.resolved.schema.fields.find(f=>f.id==='salePrice');
 assert.ok(editor.quotationEditorValidation(field,cell,view.imageKeys).some(text=>text.includes('공급가보다')));
 assert.equal(JSON.stringify(view),before);
});

test('section progress does not treat review reminders as errors and preserves automatic failure on reset',()=>{
 const view=fixture();view.resolved.schema.fields=view.resolved.schema.fields.filter(f=>f.id==='brand');
 const field=view.resolved.schema.fields[0];const cell=editor.resolveQuotationEditorCell(view,[],'red','brand');
 assert.ok(cell.reviewMessages.length);assert.equal(editor.quotationEditorValidation(field,cell,view.imageKeys).length,0);
 const automatic=view.automatic.rows.find(row=>row.optionId==='red').fields.brand;
 automatic.validationIssues=['연결 자료 오류'];
 const progress=changes=>editor.quotationSectionProgress(view,changes,'red').find(s=>s.id==='product');
 assert.equal(progress([]).complete,0);assert.equal(progress([]).invalid,1);
 assert.equal(progress([change('brand','수정 브랜드','red')]).complete,1);
 assert.equal(progress([change('brand',null,'red')]).invalid,1);
 assert.equal(progress([change('brand','','red')]).complete,0);
});

test('changing barcode mode and supply price recomputes dependent draft validation metadata',()=>{
 const view=fixture({common:{barcodeMode:'existing',barcode:'',supplyPrice:'4000',salePrice:'3000'},options:{}});
 const barcode=changes=>editor.resolveQuotationEditorCell(view,changes,'red','barcode');
 assert.ok(barcode([]).validationIssues.some(m=>m.includes('실제 바코드')));
 assert.equal(barcode([change('barcodeMode','request-coupang')]).validationIssues.some(m=>m.includes('실제 바코드')),false);
 const price=editor.resolveQuotationEditorCell(view,[change('supplyPrice','2000')],'red','salePrice');
 assert.equal(price.validationIssues.some(m=>m.includes('공급가보다')),false);
 const manual=editor.resolveQuotationEditorCell(view,[change('brand','직접 브랜드','red')],'red','brand');
 assert.equal(manual.validationIssues.length,0);assert.ok(manual.reviewMessages.length);
});

const { quotationTranslationDraft } = load('app/quotation-translation-adoption.ts');
function attributeJob(view) { return { id:'job',productId:'p1',productVersion:view.productVersion,contentRevision:view.contentRevision,status:'completed',review:{source:{attributes:[{name:'상품속성: 材质',value:'尼龙'},{name:'상품속성: 尺寸',value:'38 cm'},{name:'option:red',value:'红色'}]}},result:{draft:{attributes:[{sourceIndex:0,name:'재질',value:'나일론'},{sourceIndex:1,name:'크기',value:'38 cm'},{sourceIndex:2,name:'색상',value:'빨강'}]}}}; }
test('reviewed translated attributes enter only selected option draft fields and preserve source state',()=>{
 const view=fixture();const job=attributeJob(view);const before=JSON.stringify({view,job});
 const changes=quotationTranslationDraft('p1',view,job,'red',[{sourceIndex:0,fieldId:'noticeMaterial'},{sourceIndex:1,fieldId:'noticeDimensions'}]);
 assert.equal(changes.length,2);assert.equal(changes[0].optionId,'red');
 assert.equal(editor.resolveQuotationEditorCell(view,changes,'red','noticeMaterial').value,'나일론');
 assert.equal(editor.resolveQuotationEditorCell(view,changes,'red','noticeDimensions').value,'38 cm');
 assert.notEqual(editor.resolveQuotationEditorCell(view,changes,'blue','noticeMaterial').value,'나일론');
 assert.equal(JSON.stringify({view,job}),before);
});
test('translation mapping preserves explicit manual blanks and inherited common overrides',()=>{
 for(const overrides of [{common:{noticeMaterial:''},options:{}},{common:{},options:{red:{noticeMaterial:'직접 재질'}}}]) {
  const view=fixture(overrides);assert.throws(()=>quotationTranslationDraft('p1',view,attributeJob(view),'red',[{sourceIndex:0,fieldId:'noticeMaterial'}]),/직접 수정값/);
 }
});
test('translation mapping rejects stale jobs, excluded options, non-product attributes and unsafe destinations',()=>{
 const view=fixture(),job=attributeJob(view),mapping=[{sourceIndex:0,fieldId:'noticeMaterial'}];
 for(const patch of [{productId:'other'},{productVersion:'old'},{contentRevision:99},{status:'running'},{result:null}])assert.throws(()=>quotationTranslationDraft('p1',view,{...job,...patch},'red',mapping));
 assert.throws(()=>quotationTranslationDraft('p1',view,job,'excluded',mapping));
 for(const fieldId of ['category','mainImage','supplyPrice','taxType','missing'])assert.throws(()=>quotationTranslationDraft('p1',view,job,'red',[{sourceIndex:0,fieldId}]));
 for(const sourceIndex of [2,-1,1.5,50])assert.throws(()=>quotationTranslationDraft('p1',view,job,'red',[{sourceIndex,fieldId:'noticeMaterial'}]));
 assert.throws(()=>quotationTranslationDraft('p1',view,job,'red',[...mapping,...mapping]));
 const long=clone(job);long.result.draft.attributes[0].value='x'.repeat(3000);assert.throws(()=>quotationTranslationDraft('p1',view,long,'red',mapping));
});
test('translated attribute panel labels the destination, respects disabled editing and performs no render-time requests',()=>{
 const {QuotationTranslatedAttributes}=load('app/components/quotation-translated-attributes.tsx');
 const html=renderToStaticMarkup(React.createElement(QuotationTranslatedAttributes,{productId:'p1',view:fixture(),optionId:'red',disabled:true,onApply(){throw Error('must not apply');}}));
 assert.match(html,/번역한 상품 속성을 견적 항목에 연결/);assert.match(html,/대상: red/);assert.match(html,/<fieldset disabled=""/);assert.match(html,/기존 직접 수정값은 보존/);
});

const {createAttributeRules,loadAttributeRules}=load('app/quotation-attribute-rules.ts');
test('category rule export contains names and destinations, not source values, and matches reordered attributes',()=>{
 const view=fixture(),job=attributeJob(view),before=JSON.stringify({view,job});
 const rules=createAttributeRules('p1',view,job,'red',[{sourceIndex:0,fieldId:'noticeMaterial'},{sourceIndex:1,fieldId:'noticeDimensions'}]);
 const json=JSON.stringify(rules);assert.ok(!json.includes('尼龙'));assert.ok(!json.includes('나일론'));assert.ok(!json.includes('38 cm'));
 const reordered=clone(job);reordered.review.source.attributes.reverse();reordered.result.draft.attributes.forEach(item=>item.sourceIndex=2-item.sourceIndex);
 const result=loadAttributeRules(json,'p1',view,reordered,'blue');
 assert.equal(result.mappings[0].sourceIndex,2);assert.equal(result.mappings[1].sourceIndex,1);assert.equal(result.skipped.length,0);
 const changes=quotationTranslationDraft('p1',view,reordered,'blue',result.mappings);assert.equal(changes[0].value,'나일론');
 assert.equal(JSON.stringify({view,job}),before);
});
test('rule reuse skips missing or ambiguous source names and preserves manual blanks',()=>{
 const view=fixture(),job=attributeJob(view);const json=JSON.stringify(createAttributeRules('p1',view,job,'red',[{sourceIndex:0,fieldId:'noticeMaterial'}]));
 const missing=clone(job);missing.review.source.attributes[0].name='상품속성: 다른이름';assert.equal(loadAttributeRules(json,'p1',view,missing,'red').mappings.length,0);
 const duplicate=clone(job);duplicate.review.source.attributes.push(duplicate.review.source.attributes[0]);assert.match(loadAttributeRules(json,'p1',view,duplicate,'red').skipped[0],/여러 개/);
 const manual=fixture({common:{noticeMaterial:''},options:{}});const preserved=loadAttributeRules(json,'p1',manual,attributeJob(manual),'red');assert.equal(preserved.mappings.length,0);assert.match(preserved.skipped[0],/직접 수정값/);
});
test('rule files reject different categories, schema drift, duplicates and excess size before applying',()=>{
 const view=fixture(),job=attributeJob(view);const rules=createAttributeRules('p1',view,job,'red',[{sourceIndex:0,fieldId:'noticeMaterial'}]);
 for(const invalid of [{...rules,categoryId:'other'},{...rules,format:'other'},{...rules,rules:[...rules.rules,...rules.rules]},{...rules,rules:[{...rules.rules[0],fieldSignature:'{}'}]}])assert.throws(()=>loadAttributeRules(JSON.stringify(invalid),'p1',view,job,'red'));
 assert.throws(()=>loadAttributeRules(' '.repeat(65537),'p1',view,job,'red'));
 const changed=clone(view);changed.resolved.schema.fields.find(item=>item.id==='noticeMaterial').maxLength=999;assert.throws(()=>loadAttributeRules(JSON.stringify(rules),'p1',changed,job,'red'),/양식이 변경/);
});
test('rule import cannot apply outdated translations and export rejects ambiguous names',()=>{
 const view=fixture(),job=attributeJob(view);const rules=createAttributeRules('p1',view,job,'red',[{sourceIndex:0,fieldId:'noticeMaterial'}]);
 const stale={...job,productVersion:'old'};const result=loadAttributeRules(JSON.stringify(rules),'p1',view,stale,'red');assert.equal(result.mappings.length,0);assert.match(result.skipped[0],/최신/);
 job.review.source.attributes[1].name=job.review.source.attributes[0].name;assert.throws(()=>createAttributeRules('p1',view,job,'red',[{sourceIndex:0,fieldId:'noticeMaterial'},{sourceIndex:1,fieldId:'noticeDimensions'}]),/동일한 원문/);
});

const { fetchAttributeSuggestions } = load('app/quotation-attribute-suggestions.ts');
test('saved category suggestions select by source name after reordering without changing quotation values', async()=>{
 const view=fixture(), job=attributeJob(view);const before=JSON.stringify(view);
 const rules=createAttributeRules('p1',view,job,'red',[{sourceIndex:0,fieldId:'noticeMaterial'}]);
 const reordered=clone(job);reordered.review.source.attributes.reverse();reordered.result.draft.attributes.forEach(item=>item.sourceIndex=2-item.sourceIndex);
 const calls=[];const request=async(url,options)=>{calls.push({url,options});return Response.json({rules,revision:4});};
 const result=await fetchAttributeSuggestions('p1',view,reordered,'red',request);
 assert.deepEqual(clone(result.mapping),{'2':'noticeMaterial'});assert.equal(result.revision,4);assert.equal(JSON.stringify(view),before);
 assert.equal(calls.length,1);assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.method,undefined);assert.match(calls[0].url,/categoryId=80719/);
});
test('automatic suggestions keep translations usable on server failures and reject incompatible stored rules',async()=>{
 const view=fixture(),job=attributeJob(view);
 const rules=createAttributeRules('p1',view,job,'red',[{sourceIndex:0,fieldId:'noticeMaterial'}]);
 for(const request of [async()=>{throw Error('offline');},async()=>Response.json({error:'unavailable'},{status:503}),async()=>Response.json({rules,revision:'4'}),async()=>Response.json({rules:{...rules,categoryId:'other'},revision:1}),async()=>Response.json({revision:1})]){
  const result=await fetchAttributeSuggestions('p1',view,job,'red',request);
  assert.deepEqual(clone(result.mapping),{});assert.equal(result.revision,null);assert.match(result.message,/적용하지 못했습니다/);
 }
 const absent=await fetchAttributeSuggestions('p1',view,job,'red',async()=>Response.json({rules:null,revision:0}));assert.equal(absent.revision,0);assert.deepEqual(clone(absent.mapping),{});
});
test('automatic rule reuse preserves manual blanks and omits attributes absent from the next translation',async()=>{
 const base=fixture(),job=attributeJob(base);const rules=createAttributeRules('p1',base,job,'red',[{sourceIndex:0,fieldId:'noticeMaterial'},{sourceIndex:1,fieldId:'noticeDimensions'}]);
 const view=fixture({common:{noticeMaterial:''},options:{}});const next=attributeJob(view);next.review.source.attributes[1].name='상품속성: other';
 const result=await fetchAttributeSuggestions('p1',view,next,'red',async()=>Response.json({rules,revision:2}));
 assert.deepEqual(clone(result.mapping),{});assert.equal(result.skipped.length,2);assert.equal(result.revision,2);
 let calls=0;next.result.draft.attributes=[];await fetchAttributeSuggestions('p1',view,next,'red',async()=>{calls++;throw Error('not expected');});assert.equal(calls,0);
});

const { quotationTranslationBatch } = load('app/quotation-translation-adoption.ts');
test('batch translated attributes target included option IDs only and preserve per-option manual blanks',()=>{
 const view=fixture({common:{},options:{blue:{noticeMaterial:''}}}),job=attributeJob(view);const before=JSON.stringify(view);
 const plan=quotationTranslationBatch('p1',view,job,[{sourceIndex:0,fieldId:'noticeMaterial'},{sourceIndex:1,fieldId:'noticeDimensions'}]);
 assert.equal(plan.changes.length,3);assert.equal(plan.preview.length,3);assert.equal(plan.skipped.length,1);
 assert.ok(plan.changes.every(change=>change.optionId==='red'||change.optionId==='blue'));
 assert.equal(plan.changes.some(change=>change.optionId==='blue'&&change.fieldKey==='noticeMaterial'),false);
 let draft=[];for(const item of plan.changes)draft=editor.updateQuotationEditorDraft(view.overrides,draft,item);
 assert.equal(editor.resolveQuotationEditorCell(view,draft,'red','noticeMaterial').value,'나일론');
 assert.equal(editor.resolveQuotationEditorCell(view,draft,'blue','noticeMaterial').value,'');
 assert.equal(editor.resolveQuotationEditorCell(view,draft,'blue','noticeDimensions').value,'38 cm');
 assert.equal(JSON.stringify(view),before);
});
test('batch translation preserves common overrides and rejects stale results, duplicate mappings and oversized batches',()=>{
 const view=fixture({common:{noticeMaterial:''},options:{}}),job=attributeJob(view),mapping=[{sourceIndex:0,fieldId:'noticeMaterial'}];
 const plan=quotationTranslationBatch('p1',view,job,mapping);assert.equal(plan.changes.length,0);assert.equal(plan.skipped.length,2);
 assert.throws(()=>quotationTranslationBatch('p1',view,{...job,productVersion:'old'},mapping));
 assert.throws(()=>quotationTranslationBatch('p1',view,job,[...mapping,...mapping]));
 const large=fixture();const row=large.resolved.rows.find(row=>row.optionId==='red');large.resolved.rows=Array.from({length:1001},(_,i)=>({...row,optionId:`option-${i}`}));
 assert.throws(()=>quotationTranslationBatch('p1',large,attributeJob(large),mapping),/1,000/);
});
test('batch validation is atomic and never returns partial changes for an invalid attribute',()=>{
 const view=fixture(),job=attributeJob(view),before=JSON.stringify(view);
 assert.throws(()=>quotationTranslationBatch('p1',view,job,[{sourceIndex:0,fieldId:'noticeMaterial'},{sourceIndex:2,fieldId:'noticeDimensions'}]));
 assert.equal(JSON.stringify(view),before);
 const none=clone(view);none.resolved.rows.forEach(row=>row.included=false);
 assert.throws(()=>quotationTranslationBatch('p1',none,job,[{sourceIndex:0,fieldId:'noticeMaterial'}]),/포함된 옵션/);
});

test('batch target selection rejects foreign, excluded, duplicate and empty option lists',()=>{
 const view=fixture(),job=attributeJob(view),mapping=[{sourceIndex:0,fieldId:'noticeMaterial'}];
 const plan=quotationTranslationBatch('p1',view,job,mapping,['blue']);assert.equal(plan.changes.length,1);assert.equal(plan.changes[0].optionId,'blue');
 for(const ids of [[],['missing'],['excluded'],['blue','blue'],[null]])assert.throws(()=>quotationTranslationBatch('p1',view,job,mapping,ids),/적용 옵션/);
});

test('bulk restore previews inherited and automatic values including equal and empty overrides without changing unrelated edits',()=>{
 const view=fixture({common:{brand:'공통 브랜드'},options:{red:{brand:'직접 브랜드',model:'',title:'상품 제목'},blue:{brand:'공통 브랜드'},excluded:{brand:'제외 유지'}}});
 const before=JSON.stringify(view);const pending=[change('model','미선택 보존','blue')];
 const preview=editor.previewQuotationEditorRestore(view,pending,['brand','title'],true);
 assert.equal(preview.mode,'restore');assert.equal(preview.rows.length,3);
 assert.equal(preview.rows.find(r=>r.optionId==='red'&&r.fieldKey==='brand').after,'공통 브랜드');
 const next=editor.applyQuotationEditorBulk(view,pending,preview);
 assert.equal(editor.resolveQuotationEditorCell(view,next,'red','brand').source,'manual-common');
 assert.equal(editor.resolveQuotationEditorCell(view,next,'red','title').source,'content');
 assert.equal(editor.resolveQuotationEditorCell(view,next,'red','model').value,'');
 assert.equal(editor.resolveQuotationEditorCell(view,next,'blue','model').value,'미선택 보존');
 assert.equal(editor.resolveQuotationEditorCell(view,next,'excluded','brand').value,'제외 유지');
 assert.equal(JSON.stringify(view),before);
 const restored=model.applyQuotationChanges(view.overrides,next);
 assert.equal(restored.common.brand,'공통 브랜드');assert.equal(Object.hasOwn(restored.options.red,'title'),false);
 assert.equal(restored.options.red.model,'');
});

test('bulk restore handles staged values and blanks, stale previews, excluded options and invalid fields',()=>{
 const view=fixture();const draft=[change('brand','','red')];
 const preview=editor.previewQuotationEditorRestore(view,draft,['brand'],true);
 assert.equal(preview.rows[0].before,'');assert.equal(preview.rows[0].after,'기본 브랜드');
 assert.equal(editor.applyQuotationEditorBulk(view,draft,preview).length,0);
 assert.throws(()=>editor.applyQuotationEditorBulk({...view,inputFingerprint:'new'},draft,preview),/미리보기 이후/);
 assert.throws(()=>editor.applyQuotationEditorBulk(view,[],preview),/미리보기 이후/);
 for(const fields of [[],['missing'],['category']])assert.throws(()=>editor.previewQuotationEditorRestore(view,[],fields,true),/수정 가능/);
 const other=fixture({common:{},options:{excluded:{brand:'제외'}}});
 assert.equal(editor.previewQuotationEditorRestore(other,[],['brand'],true).rows.length,0);
 assert.equal(editor.previewQuotationEditorRestore(other,[],['brand'],false).rows.length,1);
});

test('restoring an option override resumes later source updates while common and unselected values stay fixed',()=>{
 const view=fixture({common:{model:'고정 공통'},options:{red:{brand:'고정 브랜드',model:'고정 옵션'},blue:{brand:'다른 옵션'}}});
 const preview=editor.previewQuotationEditorRestore(view,[],['brand'],true);
 const saved=model.applyQuotationChanges(view.overrides,editor.applyQuotationEditorBulk(view,[],preview));
 const updated=fixture(saved,'변경한 기본 브랜드');
 assert.equal(updated.resolved.rows.find(r=>r.optionId==='red').fields.brand.value,'변경한 기본 브랜드');
 assert.equal(updated.resolved.rows.find(r=>r.optionId==='red').fields.model.value,'고정 옵션');
 assert.equal(updated.resolved.rows.find(r=>r.optionId==='blue').fields.model.value,'고정 공통');
});

test('translated category choices match observed labels and values, including explicit empty choice, without guesses',()=>{
 const view=fixture(),job=attributeJob(view),map=[{sourceIndex:0,fieldId:'basketShape'}];
 const before=JSON.stringify(view);
 job.result.draft.attributes[0].value='사각형';
 let changes=quotationTranslationDraft('p1',view,job,'red',map);
 assert.equal(changes[0].value,'사각형');assert.equal(editor.resolveQuotationEditorCell(view,changes,'red','basketShape').value,'사각형');
 job.result.draft.attributes[0].value='해당사항없음';changes=quotationTranslationDraft('p1',view,job,'red',map);
 assert.equal(changes[0].value,'');assert.equal(editor.resolveQuotationEditorCell(view,changes,'red','basketShape').source,'manual-option');
 for(const value of ['사각','모름','','원형 또는 사각형']){job.result.draft.attributes[0].value=value;assert.throws(()=>quotationTranslationDraft('p1',view,job,'red',map));}
 job.result.draft.attributes[0].value='사각형';
 const field=view.resolved.schema.fields.find(f=>f.id==='basketShape');field.choices.push({value:'other',label:'사각형'});
 assert.throws(()=>quotationTranslationDraft('p1',view,job,'red',map),/하나여야/);field.choices.pop();
 for(const fieldId of ['taxType','tradeType','kcMarkType','handlingReason','barcodeMode'])assert.throws(()=>quotationTranslationDraft('p1',view,job,'red',[{sourceIndex:0,fieldId}]));
 assert.equal(JSON.stringify(view),before);
});

test('category choice rules reuse only compatible values and schema and preserve manual option edits in batches',()=>{
 const view=fixture({common:{},options:{blue:{basketShape:''}}}),job=attributeJob(view),mapping=[{sourceIndex:0,fieldId:'basketShape'}];
 job.result.draft.attributes[0].value='사각형';
 const json=JSON.stringify(createAttributeRules('p1',view,job,'red',mapping));
 assert.equal(loadAttributeRules(json,'p1',view,job,'red').mappings.length,1);
 const batch=load('app/quotation-translation-adoption.ts').quotationTranslationBatch('p1',view,job,mapping);
 assert.equal(batch.changes.length,1);assert.equal(batch.changes[0].optionId,'red');assert.equal(batch.skipped.length,1);
 job.result.draft.attributes[0].value='알 수 없음';const missing=loadAttributeRules(json,'p1',view,job,'red');assert.equal(missing.mappings.length,0);assert.equal(missing.skipped.length,1);
 view.resolved.schema.fields.find(f=>f.id==='basketShape').choices.push({value:'new',label:'추가'});
 assert.throws(()=>loadAttributeRules(json,'p1',view,job,'red'),/양식이 변경/);
});

test('batch keeps explicit empty choice over empty automatic value and previews the actual choice storage',()=>{
 const view=fixture(),job=attributeJob(view),adoption=load('app/quotation-translation-adoption.ts');
 job.result.draft.attributes[0].value='해당사항없음';
 for(const row of view.resolved.rows)row.fields.basketShape.value='';
 const before=JSON.stringify(view);
 const plan=adoption.quotationTranslationBatch('p1',view,job,[{sourceIndex:0,fieldId:'basketShape'}]);
 assert.equal(plan.changes.length,2);
 assert.ok(plan.changes.every(change=>change.value===''));
 assert.ok(plan.preview.every(item=>item.afterDisplay==='해당사항없음 (저장값: 공란)'));
 for(const id of ['red','blue'])assert.equal(editor.resolveQuotationEditorCell(view,plan.changes,id,'basketShape').source,'manual-option');
 assert.equal(JSON.stringify(view),before);
 const field={...view.resolved.schema.fields.find(f=>f.id==='basketShape'),choices:[{value:'SQUARE',label:'사각형'}]};
 assert.equal(adoption.quotationAttributeDisplay(field,adoption.translatedAttributeValue(field,'사각형')),'사각형 (저장값: SQUARE)');
 assert.equal(adoption.quotationAttributeDisplay(field,'unknown'),'unknown');
});

test('attribute mapping UI previews resolved storage values and exposes invalid selections before apply',()=>{
 const view=fixture(),job=attributeJob(view);job.result.draft.attributes[0].value='해당사항없음';
 function render(){let index=0;const states=[[job],'job',{0:'basketShape'}];const {QuotationTranslatedAttributes}=load('app/components/quotation-translated-attributes.tsx',{react:{...React,useState(initial){const slot=index++;return [slot<states.length?states[slot]:initial,()=>{}];}}});return renderToStaticMarkup(React.createElement(QuotationTranslatedAttributes,{productId:'p1',view,optionId:'red',disabled:false,onApply(){throw Error('render must not write');}}));}
 assert.match(render(),/해당사항없음 \(저장값: 공란\)/);
 job.result.draft.attributes[0].value='알 수 없는 형태';const html=render();assert.match(html,/role="alert"/);assert.match(html,/정확히 일치하는 선택지가 하나/);
 assert.doesNotMatch(html,/→ 알 수 없는 형태/);
});

test('explicit server-rule reload replaces old mappings on empty, failed, or incompatible responses',async()=>{
 for(const response of [{rules:null,revision:0},{error:'조회 실패',status:500},{rules:{format:'bad'},revision:4}]){
  const view=fixture(),job=attributeJob(view);let index=0,calls=0,applied=0;
  const slots=[[job],'job',{0:'noticeMaterial'},false,'',['이전 보고'],3,null,[]];
  const hooks={...React,useRef(initial){const i=index++;return slots[i]??(slots[i]={current:initial});},useEffect(){},useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];}};
  const suggestions={fetchAttributeSuggestions:(...args)=>fetchAttributeSuggestions(...args.slice(0,4),async()=>{calls++;return Response.json(response,{status:response.status??200});})};
  const {QuotationTranslatedAttributes}=load('app/components/quotation-translated-attributes.tsx',{react:hooks,'@/app/quotation-attribute-suggestions':suggestions});
  const render=()=>{index=0;return QuotationTranslatedAttributes({productId:'p1',view,optionId:'red',disabled:false,onApply(){applied++;}});};
  const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
  const button=nodes(render()).find(n=>n.type==='button'&&n.props.children==='이 카테고리 서버 규칙 불러오기 · 현재 선택 교체');
  button.props.onClick();for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);assert.deepEqual(clone(slots[2]),{});assert.deepEqual(clone(slots[5]),[]);
  assert.equal(slots[6],response.rules===null?0:null);assert.equal(slots[3],false);assert.equal(applied,0);
  assert.ok(nodes(render()).find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children[0]==='선택한 연결로 서버 규칙 저장').props.disabled);
 }
});

function attributeRequestHarness(request){
 const view=fixture(),job=attributeJob(view),slots=[[job],'job',{0:'noticeMaterial'},false,'',[],3,null,[]];
 let index=0,first=true,unmounted=false,lateUpdates=0;const cleanups=[],calls=[];
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{if(unmounted)lateUpdates++;slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=index++;return slots[i]??(slots[i]={current:initial});},useEffect(fn){if(first)cleanups.push(fn());}};
 const {QuotationTranslatedAttributes}=load('app/components/quotation-translated-attributes.tsx',{react:hooks,fetch:(url,init)=>{calls.push({url,init});return request(url,init);}});
 const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
 const label=value=>Array.isArray(value)?value.map(label).join(''):typeof value==='string'||typeof value==='number'?String(value):'';
 const render=()=>{index=0;const tree=QuotationTranslatedAttributes({productId:'p1',view,optionId:'red',disabled:false,onApply(){throw Error('must not apply');}});first=false;return nodes(tree);};
 return{slots,calls,view,job,render,button(prefix){return render().find(n=>n.type==='button'&&label(n.props.children).startsWith(prefix)).props.onClick;},unmount(){unmounted=true;cleanups.forEach(fn=>fn?.());},get lateUpdates(){return lateUpdates;}};
}
const settleAttributes=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
function pendingAttribute(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}

test('attribute rule operations share an immediate lock and release it after failure for retry',async()=>{
 const pending=pendingAttribute();let attempt=0;const h=attributeRequestHarness(async()=>++attempt===1?pending.promise:Response.json({revision:4}));
 const save=h.button('선택한 연결로 서버 규칙 저장'),reload=h.button('이 카테고리 서버 규칙'),loadJobs=h.button('완료된 속성 번역');
 save();save();reload();loadJobs();assert.equal(h.calls.length,1);assert.equal(h.calls[0].init.method,'PUT');
 pending.resolve(Response.json({error:'실패'},{status:500}));await settleAttributes();assert.equal(h.slots[3],false);assert.match(h.slots[4],/실패/);
 h.button('선택한 연결로 서버 규칙 저장')();await settleAttributes();assert.equal(h.calls.length,2);assert.equal(h.slots[6],4);assert.match(h.slots[4],/저장했습니다/);
});

test('closed attribute panels abort network requests and ignore late translation, suggestion, and save responses',async()=>{
 for(const operation of ['완료된 속성 번역','이 카테고리 서버 규칙','선택한 연결로 서버 규칙 저장']){
  const pending=pendingAttribute(),h=attributeRequestHarness(()=>pending.promise);h.button(operation)();assert.equal(h.calls.length,1);
  h.unmount();assert.equal(h.calls[0].init.signal.aborted,true);
  pending.resolve(Response.json(operation.startsWith('완료')?{jobs:[h.job]}:operation.startsWith('이 카테고리')?{rules:null,revision:0}:{revision:4}));
  await settleAttributes();assert.equal(h.lateUpdates,0);assert.equal(h.calls.length,1);assert.equal(h.slots[6],3);
 }
});

test('closed attribute panels ignore late local rule files and file reads block concurrent server saves',async()=>{
 const pending=pendingAttribute(),h=attributeRequestHarness(()=>{throw Error('no network expected');});let reads=0;
 const file={size:10,text(){reads++;return pending.promise;}};
 const input=h.render().find(n=>n.type==='input'&&n.props.type==='file');const save=h.button('선택한 연결로 서버 규칙 저장');
 input.props.onChange({target:{files:[file],value:'file'}});input.props.onChange({target:{files:[file],value:'file'}});save();assert.equal(reads,1);assert.equal(h.calls.length,0);
 h.unmount();pending.resolve('{}');await settleAttributes();assert.equal(h.lateUpdates,0);
});

test('category selection preview uses actual quotation schema and defaults without leaking defaults between categories',()=>{
 const {CategoryQuotationPreview}=load('app/components/category-quotation-preview.tsx');
 const {couplusQuotationDefault}=load('app/couplus-quotation-defaults.ts');
 const render=schema=>renderToStaticMarkup(React.createElement(CategoryQuotationPreview,{schema}));
 const encode=value=>renderToStaticMarkup(React.createElement('span',null,value)).replace(/^<span>|<\/span>$/g,'');
 for(const category of ['80719','81452','103495','unknown']){
  const schema=model.getQuotationSchema(category),before=JSON.stringify(schema),html=render(schema);
  for(const field of schema.fields)assert.ok(html.includes(encode(field.label+(field.required?' *':''))),field.id);
  const count=schema.fields.filter(field=>couplusQuotationDefault(category,field)!==undefined).length;
  assert.ok(html.includes(`쿠플러스 기본값 확인 ${count}개`));
  assert.equal(JSON.stringify(schema),before);
  if(category==='80719'){assert.match(html,/쿠플러스 화면 관찰값/);assert.match(html,/해당사항없음.*저장값: 공란/);assert.match(html,/허용 선택지/);}
  else{assert.doesNotMatch(html,/쿠플러스 화면 관찰값/);assert.match(html,/미확인 · 임의 기본값 없음/);}
 }
});

const {suggestCategoryAttributes}=load('app/quotation-attribute-suggestions.ts');
test('first-use category suggestions match exact product attributes and observed select values without saving',async()=>{
 const view=fixture(),job=attributeJob(view);job.result.draft.attributes[0]={sourceIndex:0,name:'뚜껑 포함여부',value:'해당사항없음'};
 const before=JSON.stringify({view,job});const calls=[];
 const result=await fetchAttributeSuggestions('p1',view,job,'red',async(url,init)=>{calls.push({url,init});return Response.json({rules:null,revision:0});});
 assert.deepEqual(clone(result.mapping),{'0':'lidIncluded'});assert.equal(result.revision,0);assert.equal(calls.length,1);assert.equal(calls[0].init.method,undefined);assert.equal(JSON.stringify({view,job}),before);
 const changes=quotationTranslationDraft('p1',view,job,'red',[{sourceIndex:0,fieldId:result.mapping[0]}]);assert.equal(changes[0].value,'');
 job.result.draft.attributes[0].value='알수없는선택';const invalid=suggestCategoryAttributes('p1',view,job,'red');assert.equal(invalid.mappings.length,0);assert.ok(invalid.skipped.length);
});
test('first-use category suggestions preserve manual blanks and skip duplicates, legal and near-match names',()=>{
 const view=fixture({common:{color:''},options:{}}),job=attributeJob(view);job.result.draft.attributes[0].name='색상';job.result.draft.attributes[0].value='검정';
 let result=suggestCategoryAttributes('p1',view,job,'red');assert.equal(result.mappings.length,0);assert.ok(result.skipped.length);
 const clean=fixture();job.result.draft.attributes[0].name='사이즈';job.result.draft.attributes[1].name='사이즈';result=suggestCategoryAttributes('p1',clean,job,'red');assert.equal(result.mappings.length,0);
 job.result.draft.attributes[0].name='재질';job.result.draft.attributes[1].name='대략 사이즈';assert.equal(suggestCategoryAttributes('p1',clean,job,'red').mappings.length,0);
 job.result.draft.attributes[0].name='사이즈';clean.resolved.schema.fields.push({...clean.resolved.schema.fields.find(f=>f.id==='size'),id:'duplicateSize'});assert.equal(suggestCategoryAttributes('p1',clean,job,'red').mappings.length,0);
});
test('saved rules take precedence and failures never fall back to inferred category connections',async()=>{
 const view=fixture(),job=attributeJob(view);job.result.draft.attributes[0].name='사이즈';
 const rules=createAttributeRules('p1',view,job,'red',[{sourceIndex:0,fieldId:'noticeMaterial'}]);
 const saved=await fetchAttributeSuggestions('p1',view,job,'red',async()=>Response.json({rules,revision:2}));assert.deepEqual(clone(saved.mapping),{'0':'noticeMaterial'});
 for(const request of [async()=>Response.json({error:'fail'},{status:503}),async()=>Response.json({rules:null,revision:2})]){const result=await fetchAttributeSuggestions('p1',view,job,'red',request);assert.deepEqual(clone(result.mapping),{});assert.equal(result.revision,null);}
 assert.equal(suggestCategoryAttributes('p1',view,{...job,contentRevision:99},'red').mappings.length,0);assert.equal(suggestCategoryAttributes('p1',view,job,'excluded').mappings.length,0);
});
