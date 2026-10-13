import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { schemaCompanies } from './helpers/hub-schema.mjs';

const profileFile = new URL('../outputs/step604-unand-profile-read.json', import.meta.url);
const originalFile = new URL('../outputs/step603-official-unand-2624.xlsx', import.meta.url);
const available = fs.existsSync(profileFile) && fs.existsSync(originalFile);
const hiddenId = 'live_69900_a749b246de44358c', noticeId = 'live_69900_76aeca064dcf50e4';
const plain = value => JSON.parse(JSON.stringify(value));
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
function recorded() { return JSON.parse(JSON.parse(fs.readFileSync(profileFile, 'utf8'))[0].results[0].payload); }

async function setup(company) {
  const saved = recorded(), hubSchema = structuredClone(saved.hubSchema);
  assert.equal(hubSchema.company.code, 'A01526306'); assert.equal(hubSchema.company.name, '유앤채');
  // Unand supplies the real recorded Single/original Excel pair. Waihop uses
  // that exact public contract in an isolated account fixture, not a new capture.
  hubSchema.company = { code: company.code, name: company.name };
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name });
  const bytes = new Uint8Array(fs.readFileSync(originalFile)), form = new FormData();
  form.set('file', new File([bytes], 'original-Unand.xlsx')); form.set('schema', JSON.stringify(hubSchema)); form.set('action', 'workbook');
  const linked = await json(await h.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test/api/category-profiles/official-template', { method: 'POST', body: form })), 201);
  const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', { name: 'LOCAL HIDDEN MATERIAL LINKAGE', categoryId: saved.categoryId,
    categoryPath: saved.categoryPath, hubSchema, template: linked.template, mappings: linked.mappings }, 'cat');
  h.context.category = profile; h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));
  h.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run(); await h.intake();
  const product = () => h.sqlite.prepare('SELECT * FROM products').get(), base = '/api/products/' + product().id, endpoint = base + '/quotation-fields';
  const view = await json(await h.route(endpoint)), hidden = view.resolved.schema.fields.find(field => field.id === hiddenId), notice = view.resolved.schema.fields.find(field => field.id === noticeId);
  assert.equal(hidden.contentField, 'material'); assert.equal(hidden.label, '상품 재질'); assert.equal(notice.label, '소재');
  assert.equal(profile.mappings.find(mapping => mapping.field === hiddenId).column, 18); assert.equal(profile.mappings.find(mapping => mapping.field === noticeId).column, 50);
  assert.equal(profile.template.dataStartRow, 9); assert.equal(view.resolved.rows.filter(row => row.included).length, 6);
  return { h, product, base, endpoint, profile, bytes, hidden, notice };
}

async function material(f, value) {
  const content = (await json(await f.h.route(f.base + '/content'))).content;
  return json(await f.h.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision,
    patch: { label: { material: value }, ...(value === '' ? { labelClears: ['material'] } : {}) } } }));
}
async function save(f, changes) {
  const view = await json(await f.h.route(f.endpoint));
  return json(await f.h.route(f.endpoint, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes } }));
}
async function output(f) {
  const view = await json(await f.h.route(f.endpoint)), preview = await json(await f.h.route(f.base + '/quotation', { method: 'POST', body: { action: 'preview' } }));
  const download = await f.h.route(f.base + '/quotation', { method: 'POST', body: { action: 'download', fingerprint: preview.fingerprint } });
  assert.equal(download.status, 200, await download.clone().text());
  const reader = f.h.load('app/xlsx-template.ts'), book = reader.inspectXlsxArchive(await reader.readXlsxArchive(await download.arrayBuffer()));
  const rows = view.resolved.rows.filter(row => row.included), cells = rows.map((_, index) => reader.xlsxHeaders(book, f.profile.template.sheetName, 9 + index));
  return { view, preview, rows, hiddenCells: cells.map(row => row[18]), noticeCells: cells.map(row => row[50]) };
}
function immutable(f) {
  return JSON.stringify({ raw: f.h.sqlite.prepare('SELECT * FROM collection_results').all(), context: f.h.sqlite.prepare('SELECT * FROM collection_context').all(),
    category: f.h.sqlite.prepare('SELECT * FROM category_profiles').all(), options: f.h.sqlite.prepare('SELECT * FROM product_options').all(),
    price: f.product().pricing_policy, prices: [f.product().supply_price, f.product().sale_price, f.product().msrp], imageKeys: f.product().image_keys });
}
const objectsOf = f => new Map([...f.h.objects].map(([key, bytes]) => [key, Buffer.from(bytes)]));
function unchanged(f, before, objects, networkBefore) {
  assert.equal(immutable(f), before); assert.equal(f.h.objects.size, objects.size);
  for (const [key, bytes] of objects) assert.deepEqual(Buffer.from(f.h.objects.get(key)), bytes);
  assert.deepEqual(Buffer.from(f.h.objects.get(f.profile.template.storageKey)), Buffer.from(f.bytes));
  assert.equal(f.h.network.length, networkBefore); assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) AS n FROM supplier_hub_receipts').get().n, 0); assert.equal(f.product().supplier_hub_status, '미전송');
}

test('the material source binds only the captured editable hidden string-enum wire, never a similar field', { skip: !available }, () => {
  const h = mobileIntakeHarness();
  try {
    const saved = recorded(), schema = h.load('app/quotation-schema.ts').getQuotationSchema(saved.categoryId, saved.categoryPath, saved.hubSchema);
    const field = plain(schema.fields.find(field => field.id === hiddenId)); delete field.contentField;
    // Execute the real private binding function, keeping the near-wire cases
    // separate from compiler validation that might discard an invalid snapshot.
    const source = fs.readFileSync(new URL('../app/quotation-schema.ts', import.meta.url), 'utf8'), ast = ts.createSourceFile('schema.ts', source, ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'productContentBinding'); assert.ok(declaration);
    const exports = {}; vm.runInNewContext(ts.transpileModule('export ' + declaration.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports });
    const bind = exports.productContentBinding, before = JSON.stringify(field); assert.equal(bind(field).contentField, 'material'); assert.equal(JSON.stringify(field), before);
    const mutations = [
      item => { item.section = 'legal'; }, item => { item.visibility = 'exposed'; }, item => { item.visibility = 'common'; },
      item => { item.type = 'text'; }, item => { item.type = 'number'; }, item => { item.readOnly = true; },
      item => { item.numericText = true; }, item => { item.numericValue = true; }, item => { delete item.choices; }, item => { item.choices = []; },
      item => { delete item.hubWire; }, item => { item.hubWire.path = ['productPage', 'exposedAttributes']; },
      item => { item.hubWire.path = ['productPage', 'unexposedAttributes', 'nested']; },
      item => { item.hubWire.nameKey = 'name'; }, item => { item.hubWire.valueKey = 'value'; },
      item => { item.hubWire.name = '프레임 재질'; }, item => { item.label = '상품 재질 설명'; },
      item => { item.label = '프레임 재질'; item.hubWire.name = '프레임 재질'; },
      item => { item.label = '렌즈 재질'; item.hubWire.name = '렌즈 재질'; },
    ];
    for (const mutate of mutations) { const input = structuredClone(field); mutate(input); const prior = JSON.stringify(input); assert.equal(bind(input).contentField, undefined); assert.equal(JSON.stringify(input), prior); }
  } finally { h.close(); }
});

for (const company of schemaCompanies) test(`stage-six material reaches both original columns in six rows without changing other facts (${company.code}; ${company.code === 'A01526306' ? 'recorded original' : 'reused contract'})`, { skip: !available }, async () => {
  const f = await setup(company);
  try {
    const initial = await json(await f.h.route(f.endpoint)), unrelated = initial.resolved.schema.fields.filter(field => field.visibility === 'exposed' || ['프레임 재질', '렌즈 재질', '렌즈 색상'].includes(field.label)).map(field => field.id);
    const initialCells = initial.resolved.rows.map(row => unrelated.map(id => plain(row.fields[id]))), before = immutable(f), objects = objectsOf(f), networkBefore = f.h.network.length;
    assert.ok(f.hidden.choices.some(choice => choice.value === '플라스틱'));
    await material(f, '플라스틱'); const result = await output(f);
    for (const row of result.rows) for (const id of [hiddenId, noticeId]) { assert.equal(row.fields[id].value, '플라스틱'); assert.equal(row.fields[id].source, 'content'); }
    assert.deepEqual(result.hiddenCells, Array(6).fill('플라스틱')); assert.deepEqual(result.noticeCells, Array(6).fill('플라스틱'));
    assert.equal(result.preview.submissionReview.issues.some(issue => issue.kind === 'error' && [hiddenId, noticeId].includes(issue.fieldId)), false);
    assert.deepEqual(result.view.resolved.rows.map(row => unrelated.map(id => plain(row.fields[id]))), initialCells);
    assert.deepEqual(result.preview.report.company, { code: company.code, name: company.name }); unchanged(f, before, objects, networkBefore);
  } finally { f.h.close(); }
});

for (const company of schemaCompanies) test(`saved common values, option blanks and exposed edits survive later material changes and clears (${company.code})`, { skip: !available }, async () => {
  const f = await setup(company);
  try {
    await material(f, '플라스틱'); const view = await json(await f.h.route(f.endpoint)), ids = view.resolved.rows.filter(row => row.included).map(row => row.optionId);
    const color = view.resolved.schema.fields.find(field => field.visibility === 'exposed' && field.label === '색상'); assert.ok(color);
    await save(f, [{ fieldKey: hiddenId, optionId: null, value: '유리' }, { fieldKey: hiddenId, optionId: ids[0], value: '' },
      { fieldKey: hiddenId, optionId: ids[1], value: '플라스틱' }, { fieldKey: noticeId, optionId: ids[2], value: '' }, { fieldKey: color.id, optionId: ids[3], value: '' }]);
    const before = immutable(f), objects = objectsOf(f), networkBefore = f.h.network.length;
    await material(f, '나일론'); let result = await output(f);
    assert.deepEqual(result.hiddenCells, ['', '플라스틱', ...Array(4).fill('유리')]); assert.deepEqual(result.noticeCells, ['나일론', '나일론', '', ...Array(3).fill('나일론')]);
    assert.equal(result.rows[0].fields[hiddenId].source, 'manual-option'); assert.equal(result.rows[1].fields[hiddenId].source, 'manual-option'); assert.equal(result.rows[2].fields[hiddenId].source, 'manual-common');
    assert.equal(result.rows[2].fields[noticeId].source, 'manual-option'); assert.equal(result.rows[3].fields[color.id].value, ''); assert.equal(result.rows[3].fields[color.id].source, 'manual-option');
    await material(f, ''); result = await output(f);
    assert.deepEqual(result.hiddenCells, ['', '플라스틱', ...Array(4).fill('유리')]); assert.deepEqual(result.noticeCells, Array(6).fill(''));
    const content = (await json(await f.h.route(f.base + '/content'))).content; assert.equal(content.label.material.value, ''); assert.equal(content.label.material.provenance, 'manual');
    await save(f, [{ fieldKey: hiddenId, optionId: null, value: null }]); result = await output(f);
    assert.deepEqual(result.hiddenCells, ['', '플라스틱', ...Array(4).fill('')]); assert.equal(result.rows[2].fields[hiddenId].source, 'content', 'a deliberate stage-six clear suppresses the automatic N/A fallback');
    await material(f, '플라스틱'); result = await output(f);
    assert.deepEqual(result.hiddenCells, ['', ...Array(5).fill('플라스틱')]); assert.deepEqual(result.noticeCells, ['플라스틱', '플라스틱', '', ...Array(3).fill('플라스틱')]);
    assert.equal(result.rows[0].fields[hiddenId].source, 'manual-option'); assert.equal(result.rows[1].fields[hiddenId].source, 'manual-option'); assert.equal(result.rows[3].fields[color.id].source, 'manual-option');
    unchanged(f, before, objects, networkBefore);
  } finally { f.h.close(); }
});

for (const company of schemaCompanies) test(`unmatched material enums stay intact and invalid while explicit blanks remain linked (${company.code})`, { skip: !available }, async () => {
  const f = await setup(company);
  try {
    const initial = await json(await f.h.route(f.endpoint)); assert.equal(initial.resolved.rows.find(row => row.included).fields[hiddenId].source, 'couplus-default');
    const before = immutable(f), objects = objectsOf(f), networkBefore = f.h.network.length, composite = '플라스틱 / 나일론';
    await material(f, composite); let result = await output(f);
    for (const row of result.rows) { assert.equal(row.fields[hiddenId].value, composite); assert.equal(row.fields[hiddenId].source, 'content'); assert.ok(row.fields[hiddenId].validationIssues.length > 0); assert.equal(row.fields[noticeId].value, composite); }
    assert.deepEqual(result.hiddenCells, Array(6).fill(composite)); assert.deepEqual(result.noticeCells, Array(6).fill(composite));
    assert.ok(result.preview.submissionReview.issues.some(issue => issue.kind === 'error' && issue.fieldId === hiddenId), 'the user must correct the exact choice before submission');
    await material(f, ''); result = await output(f);
    for (const row of result.rows) { assert.equal(row.fields[hiddenId].value, ''); assert.equal(row.fields[hiddenId].source, 'content'); assert.deepEqual(plain(row.fields[hiddenId].validationIssues), []); assert.equal(row.fields[noticeId].value, ''); }
    assert.deepEqual(result.hiddenCells, Array(6).fill('')); assert.deepEqual(result.noticeCells, Array(6).fill('')); unchanged(f, before, objects, networkBefore);
  } finally { f.h.close(); }
});
