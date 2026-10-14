import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createHash, webcrypto } from 'node:crypto';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const native = createRequire(import.meta.url);
const plain = value => JSON.parse(JSON.stringify(value));
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const exposedGroup = '노출 속성';
const legalGroup = '상품 법적 정보 : 고객이 상품 이해에 필요한 법적 고시 정보입니다.';
const companies = [{ code: 'A01526306', name: '유앤채' }, { code: 'A01464742', name: '와이홉' }];
const colorFields = () => [
  { id: 'color', label: '색상', section: 'product', visibility: 'exposed', type: 'text', required: true,
    hubWire: { path: ['productPage', 'commonAttributes', 'exposedAttributes'], nameKey: 'attributeName', valueKey: 'attributeValue', name: '색상' } },
  { id: 'brace_noticeColor', label: '색상', section: 'legal', visibility: 'common', type: 'text', required: true,
    hubWire: { path: ['legalPage', 'notices'], nameKey: 'noticeItemName', valueKey: 'noticeItemValue', name: '색상' } },
];
// Only the mapping module is isolated here, so contradictory wires can be
// tested without a schema compiler quietly discarding the invalid candidate.
function mapper(fields) {
  const exports = {}, output = ts.transpileModule(fs.readFileSync(new URL('../app/quotation-mapping.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, { exports, require(name) {
    if (name === './quotation-schema') return { getQuotationSchema: () => ({ fields }) };
    if (name === './category-profiles') return { categoryFields: Object.fromEntries(fields.map(field => [field.id, field.label])) };
    throw Error(name);
  } });
  return exports.suggestQuotationMappings;
}

test('duplicate colors use exact original sections and captured named wires, irrespective of column order', () => {
  const fields = colorFields(), before = JSON.stringify(fields), suggest = mapper(fields);
  for (const groups of [[exposedGroup, legalGroup], [legalGroup, exposedGroup]]) {
    const result = suggest(['색상', '색상'], '81452', ['필수', '필수'], undefined, groups);
    assert.deepEqual(plain(result.mappings), groups.map((group, column) => ({ column, field: group === exposedGroup ? 'color' : 'brace_noticeColor', required: true })));
    assert.deepEqual(plain(result.ambiguousColumns), []);
  }
  assert.equal(JSON.stringify(fields), before);
});

test('missing or similar section titles and duplicate columns inside one section remain ambiguous', () => {
  const suggest = mapper(colorFields());
  for (const groups of [undefined, [null, null], ['노출속성', '상품 법적 정보'], ['노출 속성 ', legalGroup + ' '], [exposedGroup, exposedGroup], [legalGroup, legalGroup]]) {
    const result = suggest(['색상', '색상'], '81452', null, undefined, groups);
    assert.deepEqual(plain(result.mappings), []); assert.deepEqual(plain(result.ambiguousColumns), [0, 1]);
  }
});

test('a matching section never assigns a static, contradictory, unnamed or near-matching wire', () => {
  const cases = [
    field => { delete field.hubWire; }, field => { field.hubWire.name = '색상 구분'; },
    field => { field.hubWire.nameKey = 'name'; }, field => { field.hubWire.valueKey = 'value'; },
    field => { field.hubWire.path.push('value'); }, field => { field.hubWire.path[0] = 'otherPage'; },
    field => { field.visibility = 'hidden'; }, field => { field.section = 'logistics'; },
  ];
  for (const index of [0, 1]) for (const amend of cases) {
    const fields = colorFields(); amend(fields[index]); const before = JSON.stringify(fields);
    const result = mapper(fields)(['색상', '색상'], '81452', null, undefined, [exposedGroup, legalGroup]);
    assert.equal(result.mappings.some(mapping => mapping.column === index), false);
    assert.ok(result.ambiguousColumns.includes(index)); assert.equal(JSON.stringify(fields), before);
  }
  const fields = colorFields(); fields.push({ ...structuredClone(fields[0]), id: 'live_81452_duplicate' });
  assert.equal(mapper(fields)(['색상', '색상'], '81452', null, undefined, [exposedGroup, legalGroup]).mappings.some(mapping => mapping.column === 0), false);
});

// Captured private schemas and the original workbook stay in ignored outputs.
// The Waihop cases reuse Unand's exact recorded contract in an isolated account;
// neither the supplier fixture product nor these tests is a commercial proposal.
const profileFile = new URL('../outputs/step650-official-81452-profile.json', import.meta.url);
const originalFile = new URL('../outputs/step650-official-81452-original.xlsx', import.meta.url);
const available = fs.existsSync(profileFile) && fs.existsSync(originalFile);
const originalSha = '9c4be4963b13a3af085e5814d76d0cb5bb6c8e9815ebe8c2ad4e4309d72e4782';
const recorded = () => JSON.parse(fs.readFileSync(profileFile, 'utf8'));
async function connect(h, snapshot, bytes) {
  const form = new FormData(); form.set('file', new File([bytes], 'local-original-5562.xlsx'));
  form.set('schema', JSON.stringify(snapshot)); form.set('action', 'workbook');
  return json(await h.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test/api/category-profiles/official-template', { method: 'POST', body: form })), 201);
}
async function fixture(company, { intake = true, mappings } = {}) {
  const saved = recorded(), snapshot = structuredClone(saved.hubSchema), bytes = new Uint8Array(fs.readFileSync(originalFile));
  assert.deepEqual(snapshot.company, companies[0]); assert.equal(saved.categoryId, '81452');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), originalSha); assert.equal(saved.template.sha256, originalSha);
  snapshot.company = { ...company };
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name });
  try {
    const linked = await connect(h, snapshot, bytes), input = { name: 'LOCAL 81452 COLOR CONTRACT', categoryId: saved.categoryId,
      categoryPath: saved.categoryPath, hubSchema: snapshot, template: linked.template, mappings: mappings ?? linked.mappings };
    const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', input, 'color-contract');
    h.context.category = profile; h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));
    if (intake) { h.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run(); await h.intake(); }
    const product = () => h.sqlite.prepare('SELECT * FROM products').get(), base = intake ? '/api/products/' + product().id : null;
    const view = () => h.route(base + '/quotation-fields').then(json);
    const save = async changes => { const previous = await view(); return json(await h.route(base + '/quotation-fields', { method: 'PUT', body: {
      expectedRevision: previous.revision, expectedInputFingerprint: previous.inputFingerprint, changes,
    } })); };
    const stable = () => JSON.stringify({ raw: h.sqlite.prepare('SELECT * FROM collection_results').all(), context: h.sqlite.prepare('SELECT * FROM collection_context').all(),
      profiles: h.sqlite.prepare('SELECT * FROM category_profiles').all(), options: h.sqlite.prepare('SELECT * FROM product_options').all(),
      policy: product()?.pricing_policy, prices: product() ? [product().supply_price, product().sale_price, product().msrp] : [], imageKeys: product()?.image_keys,
      objects: [...h.objects].map(([key, value]) => [key, Buffer.from(value).toString('base64')]) });
    return { h, linked, saved, snapshot, bytes, profile, product, base, view, save, stable, close: () => h.close() };
  } catch (error) { h.close(); throw error; }
}
async function output(f) {
  const fields = await f.view(), preview = await json(await f.h.route(f.base + '/quotation', { method: 'POST', body: { action: 'preview' } }));
  const response = await f.h.route(f.base + '/quotation', { method: 'POST', body: { action: 'download', fingerprint: preview.fingerprint } });
  assert.equal(response.status, 200, await response.clone().text());
  const reader = f.h.load('app/xlsx-template.ts'), book = reader.inspectXlsxArchive(await reader.readXlsxArchive(await response.arrayBuffer()));
  const rows = fields.resolved.rows.filter(row => row.included), cells = rows.map((_, i) => reader.xlsxHeaders(book, f.profile.template.sheetName, 9 + i));
  return { fields, preview, rows, exposed: cells.map(row => row[7]), legal: cells.map(row => row[47]) };
}
function unchanged(f, before, network) {
  assert.equal(f.stable(), before); assert.equal(f.h.network.length, network);
  assert.deepEqual(f.h.objects.get(f.profile.template.storageKey), f.bytes);
  assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n, 0);
  assert.equal(f.product().supplier_hub_status, '미전송');
}

for (const company of companies) test(`original Kan5562 duplicate color cells map to distinct fields through actual API and six-row XLSX (${company.code})`, { skip: !available }, async () => {
  const f = await fixture(company);
  try {
    assert.equal(f.linked.report.matchedColumns, 57); assert.equal(f.linked.template.headers.length, 58);
    assert.deepEqual(plain(f.linked.report.unmatchedColumns), [0]); assert.deepEqual(plain(f.linked.report.ambiguousColumns), []);
    assert.equal(f.profile.mappings.find(mapping => mapping.column === 7).field, 'color');
    assert.equal(f.profile.mappings.find(mapping => mapping.column === 47).field, 'brace_noticeColor');
    assert.equal(f.profile.template.workbookEvidence.excelSchemaVerified, false, 'original-file mapping does not fabricate a separate Excel schema verification');
    const view = await f.view(), options = view.resolved.rows.filter(row => row.included).map(row => row.optionId); assert.equal(options.length, 6);
    await f.save([{ fieldKey: 'color', optionId: null, value: '블랙(색상)' }, { fieldKey: 'brace_noticeColor', optionId: null, value: '검정색' },
      { fieldKey: 'color', optionId: options[1], value: '화이트(색상)' }, { fieldKey: 'brace_noticeColor', optionId: options[1], value: '흰색' },
      { fieldKey: 'color', optionId: options[2], value: '' }, { fieldKey: 'brace_noticeColor', optionId: options[2], value: '' }]);
    const before = f.stable(), network = f.h.network.length, result = await output(f);
    assert.deepEqual(result.exposed, ['블랙(색상)', '화이트(색상)', '', ...Array(3).fill('블랙(색상)')]);
    assert.deepEqual(result.legal, ['검정색', '흰색', '', ...Array(3).fill('검정색')]);
    for (let i = 0; i < 6; i++) { assert.equal(result.rows[i].fields.color.value, result.exposed[i]); assert.equal(result.rows[i].fields.brace_noticeColor.value, result.legal[i]); }
    assert.equal(result.rows[2].fields.color.source, 'manual-option'); assert.equal(result.rows[2].fields.brace_noticeColor.source, 'manual-option');
    assert.equal(result.preview.submissionReview.issues.some(issue => issue.code === 'EXCEL_FIELD_UNMAPPED' && ['color', 'brace_noticeColor'].includes(issue.fieldId)), false);
    assert.deepEqual(result.preview.report.company, company); unchanged(f, before, network);
  } finally { f.close(); }
});

test('recorded ambiguous mappings are not automatically migrated and a later stage-six edit preserves both manual color scopes', { skip: !available }, async () => {
  const f = await fixture(companies[0]);
  try {
    assert.equal(f.saved.mappings.length, 55); assert.equal(f.saved.mappings.some(mapping => [7, 47].includes(mapping.column)), false);
    const initial = await f.view(), options = initial.resolved.rows.filter(row => row.included).map(row => row.optionId);
    await f.save([{ fieldKey: 'color', optionId: null, value: '검정(직접 속성)' }, { fieldKey: 'brace_noticeColor', optionId: null, value: '검정(직접 고시)' },
      { fieldKey: 'color', optionId: options[0], value: '' }, { fieldKey: 'brace_noticeColor', optionId: options[1], value: '' }]);
    const before = f.stable(), network = f.h.network.length, content = (await json(await f.h.route(f.base + '/content'))).content;
    await json(await f.h.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision, patch: { label: { material: '단계6 직접 소재' } } } }));
    const result = await output(f);
    assert.deepEqual(result.exposed, ['', ...Array(5).fill('검정(직접 속성)')]);
    assert.deepEqual(result.legal, ['검정(직접 고시)', '', ...Array(4).fill('검정(직접 고시)')]); unchanged(f, before, network);
    assert.equal(JSON.stringify(recorded()), JSON.stringify(f.saved)); assert.equal(createHash('sha256').update(fs.readFileSync(originalFile)).digest('hex'), originalSha);
  } finally { f.close(); }
});

const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
function editor(f, value) {
  const state = [], refs = [], effects = [], writes = [], saved = []; let index = 0, refIndex = 0, first = true;
  const hooks = { useState(initial) { const i = index++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
    return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
  useRef(initial) { const i = refIndex++; return refs[i] ?? (refs[i] = { current: initial }); }, useEffect(effect) { if (first) effects.push(effect); } };
  const exports = {}, compiled = ts.transpileModule(fs.readFileSync(new URL('../app/components/category-profile-editor.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compiled, { exports, Error, AbortController, structuredClone, TextEncoder, TextDecoder, FormData, crypto: webcrypto,
    fetch: async (url, init) => {
      if (url.startsWith('/api/category-profiles/template?')) return new Response(f.bytes);
      assert.equal(url, '/api/category-profiles'); assert.equal(init.method, 'PUT'); writes.push(JSON.parse(init.body));
      return f.h.load('app/api/category-profiles/route.ts').PUT(new Request('https://app.test' + url, init));
    }, require(name) {
      if (name === 'react') return hooks; if (name === 'react/jsx-runtime') return native(name);
      if (name.startsWith('@/')) return f.h.load(name.slice(2) + '.ts'); throw Error(name);
    } });
  const render = () => { index = 0; refIndex = 0; const tree = exports.CategoryProfileEditor({ value, onSave: profile => saved.push(profile), onClose() {} }); first = false; return tree; };
  render(); effects.splice(0).forEach(effect => effect());
  const find = predicate => { const found = nodes(render()).find(predicate); assert.ok(found, 'expected real profile editor control'); return found; };
  return { render, find, writes, saved, idle: async () => { for (let i = 0; i < 80; i++) await new Promise(resolve => setTimeout(resolve, 1)); } };
}

for (const company of companies) test(`explicit missing-column connection adds only two colors while saved choices and a manual blank constant survive (${company.code})`, { skip: !available }, async () => {
  const original = recorded(), mappings = structuredClone(original.mappings);
  const manualColumn = mappings.find(mapping => mapping.field === 'noticeServiceContact').column;
  Object.assign(mappings.find(mapping => mapping.column === manualColumn), { field: 'constant', constant: '', required: false });
  const f = await fixture(company, { intake: false, mappings });
  try {
    const profileBefore = JSON.stringify(f.profile), dbBefore = JSON.stringify(f.h.sqlite.prepare('SELECT * FROM category_profiles').all()), ui = editor(f, f.profile);
    await ui.idle(); assert.equal(ui.find(node => node.props?.['aria-label'] === '8열 연결').props.value, '');
    assert.equal(ui.find(node => node.props?.['aria-label'] === '48열 연결').props.value, '');
    ui.find(node => node.type === 'button' && node.props.children === '미연결 열 자동 연결').props.onClick();
    assert.equal(ui.find(node => node.props?.['aria-label'] === '8열 연결').props.value, 'color');
    assert.equal(ui.find(node => node.props?.['aria-label'] === '48열 연결').props.value, 'brace_noticeColor');
    assert.equal(ui.writes.length, 0); assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM category_profiles').all()), dbBefore);
    await ui.render().props.onSubmit({ preventDefault() {} }); assert.equal(ui.writes.length, 1); assert.equal(ui.saved.length, 1);
    assert.equal(ui.writes[0].expectedRevision, 1); assert.equal(ui.saved[0].revision, 2); assert.equal(ui.saved[0].mappings.length, 57);
    for (const mapping of mappings) assert.deepEqual(ui.saved[0].mappings.find(candidate => candidate.column === mapping.column), mapping);
    assert.deepEqual(ui.saved[0].template, plain(f.profile.template)); assert.equal(JSON.stringify(f.profile), profileBefore);
    assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM products').get().n, 0); assert.equal(f.h.network.length, 0);
    assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n, 0);
  } finally { f.close(); }
});
