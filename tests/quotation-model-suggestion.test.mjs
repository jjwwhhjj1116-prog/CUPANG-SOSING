import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { schemaCompanies } from './helpers/hub-schema.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';
import { quotationLabelFormUI } from './helpers/quotation-label-form-ui.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
const hash = async bytes => Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
const moduleHarness = mobileIntakeHarness(), suggestion = moduleHarness.load('app/quotation-model-suggestion.ts').quotationModelSuggestion;
const suggestionState = moduleHarness.load('app/quotation-model-suggestion.ts').quotationModelSuggestionState;
const quotation = moduleHarness.load('app/quotation-schema.ts');
test.after(() => moduleHarness.close());
const schema = () => quotation.getQuotationSchema('80719');
const propose = (current = schema(), model = '', title = '검토한 최종 상품명', fieldId = 'model', source = 'content') =>
  suggestion(current, fieldId, id => id === 'model' ? { value: model, source: 'manual-common' } : id === 'title' ? { value: title, source } : undefined);

test('an explicit suggestion uses the final title and never changes model cells merely by reading them', () => {
  const current = schema(), before = JSON.stringify(current);
  const answer = propose(current, '', '  검토한 최종 상품명  ', 'model', 'manual-option');
  assert.deepEqual(plain(answer), { fieldId: 'model', titleFieldId: 'title', sourceTitle: '검토한 최종 상품명', source: 'manual-option', value: '검토한 최종 상품명', shortened: false, changes: [{ fieldKey: 'model', value: '검토한 최종 상품명' }] });
  assert.equal(JSON.stringify(current), before);
  assert.equal(propose(current, 'EXISTING-MODEL'), null); assert.equal(propose(current, '  EXISTING-MODEL  '), null);
  assert.ok(propose(current, '   '), 'a deliberately blank cell is only offered an explicit action');
  assert.equal(propose(current, '', ''), null); assert.equal(propose(current, '', '   '), null);
  assert.equal(propose(current, '', '상품명', 'noticeNameModel'), null);
});

test('the public fifty-unit model proposal keeps Unicode pairs intact and obeys captured length constraints', () => {
  assert.equal(propose(schema(), '', '가'.repeat(70)).value, '가'.repeat(50));
  assert.equal(propose(schema(), '', 'x'.repeat(49) + '😀').value, 'x'.repeat(49));
  assert.equal(propose(schema(), '', '😀'.repeat(25) + 'Z').value, '😀'.repeat(25));
  for (const title of ['x\ud800', 'x\udc00', 'x\u0001', 'x'.repeat(501)]) assert.equal(propose(schema(), '', title), null);
  const short = schema(); short.fields.find(field => field.id === 'model').maxLength = 5;
  assert.equal(propose(short, '', '123456'), null, 'do not silently invent another truncation rule');
  const minimum = schema(); minimum.fields.find(field => field.id === 'model').minLength = 8;
  assert.equal(propose(minimum, '', '1234567'), null);
});

test('model suggestions require exact unique editable model and title identities, never similar labels', () => {
  const mutations = [
    current => { current.status = 'unconfirmed'; },
    current => { current.unsupportedFields = ['productPage / modelNumber']; },
    current => { current.fields.push(structuredClone(current.fields.find(field => field.id === 'model'))); },
    current => { current.fields.push({ ...current.fields.find(field => field.id === 'model'), id: 'second-model', hubInput: 'model' }); },
    current => { current.fields.push(structuredClone(current.fields.find(field => field.id === 'title'))); },
    current => { current.fields.find(field => field.id === 'model').readOnly = true; },
    current => { current.fields.find(field => field.id === 'model').type = 'select'; },
    current => { current.fields.find(field => field.id === 'model').choices = [{ value: 'FIXED', label: 'FIXED' }]; },
    current => { current.fields.find(field => field.id === 'model').numericText = true; },
    current => { current.fields.find(field => field.id === 'model').contentField = 'material'; },
    current => { current.fields.find(field => field.id === 'model').visibility = 'hidden'; },
    current => { current.fields.find(field => field.id === 'model').section = 'legal'; },
    current => { current.fields.find(field => field.id === 'model').hubWire = { path: ['productPage', 'otherModel'] }; },
    current => { current.fields.find(field => field.id === 'title').hubWire = { path: ['productPage', 'productName'] }; },
    current => { current.fields.find(field => field.id === 'title').hubInput = 'searchTags'; },
    current => { current.fields.find(field => field.id === 'title').type = 'textarea'; },
    current => { current.fields.find(field => field.id === 'title').choices = [{ value: 'FIXED', label: 'FIXED' }]; },
  ];
  for (const mutate of mutations) { const current = schema(); mutate(current); assert.equal(propose(current), null); }
  const live = schema();
  Object.assign(live.fields.find(field => field.id === 'model'), { hubInput: 'model', hubWire: { path: ['productPage', 'modelNumber'] } });
  Object.assign(live.fields.find(field => field.id === 'title'), { hubInput: 'title', hubWire: { path: ['startPage', 'productName'] } });
  assert.ok(propose(live));
  for (const key of ['name', 'nameKey', 'valueKey']) { const other = structuredClone(live); other.fields.find(field => field.id === 'model').hubWire[key] = ''; assert.equal(propose(other), null); }
});

const categoryPath = ['패션의류잡화', '유니섹스/남녀공용 패션', '공용 잡화', '선글라스', '남녀공용패션선글라스'];
// Sanitized recorded Single69900 v188 model/name contract, inside a synthetic
// category fixture and XLSX. The two companies exercise app isolation; this is
// not a newly downloaded Waihop contract or a real Supplier Hub receipt.
function snapshot(company, amend) {
  const raw = { type: 'object', properties: {
    startPage: { type: 'object', properties: { productName: { type: 'string', title: '상품명', maxLength: 500 } } },
    productPage: { type: 'object', properties: { modelNumber: { type: 'string', title: '모델명', maxLength: 60 } } },
    legalPage: { type: 'object', properties: {} },
  } };
  amend?.(raw);
  return { format: 'supplier-hub-schema-v1', categoryId: '69900', categoryPath, company, observedAt: Date.now(),
    inputBindings: 'couplus-paths-v1', metadata: { kanCategoryId: 2624, noticeNumber: 4, scope: 'Retail_Categorized_Single', version: 188 }, schemaString: JSON.stringify(raw) };
}

test('captured enum, const, pattern, foreign wire and duplicate rules do not offer unverified model values', () => {
  for (const amend of [raw => { raw.properties.productPage.properties.modelNumber.enum = ['FIXED']; },
    raw => { raw.properties.productPage.properties.modelNumber.const = 'FIXED'; },
    raw => { raw.properties.productPage.properties.modelNumber.pattern = '^FIXED$'; },
    raw => { raw.properties.productPage.properties.modelNumber.type = 'integer'; },
    raw => { raw.properties.productPage.properties.modelNumber.format = 'email'; },
    raw => { const fields = raw.properties.productPage.properties; fields.otherModel = fields.modelNumber; delete fields.modelNumber; },
  ]) {
    const captured = snapshot(schemaCompanies[0], amend), before = JSON.stringify(captured);
    const current = quotation.getQuotationSchema(captured.categoryId, categoryPath, captured);
    assert.equal(propose(current), null); assert.equal(JSON.stringify(captured), before);
  }
});

async function setup(company) {
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name });
  const hubSchema = snapshot(company), current = h.load('app/quotation-schema.ts').getQuotationSchema('69900', categoryPath, hubSchema);
  const headers = ['skuId', ...current.fields.map(field => field.id)], bytes = quotationWorkbook(headers), sha256 = await hash(bytes);
  const storageKey = h.load('db/category-templates.ts').templateKey('owner', sha256, 'xlsx'); h.objects.set(storageKey, bytes);
  const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', { name: '모델명 명시 적용 시험', categoryId: '69900', categoryPath, hubSchema,
    template: { name: 'synthetic-model.xlsx', format: 'xlsx', sha256, storageKey, sheetName: '견적서', headerRow: 1, headers },
    mappings: headers.map((field, column) => ({ field, column, required: false })) }, 'cat');
  h.context.category = profile; h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));
  h.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run(); await h.intake();
  const product = () => h.sqlite.prepare('SELECT * FROM products').get(), base = '/api/products/' + product().id, endpoint = base + '/quotation-fields';
  return { h, product, base, endpoint, headers, profile, bytes, storageKey };
}

async function workbook(f) {
  const preview = await json(await f.h.route(f.base + '/quotation', { method: 'POST', body: { action: 'preview' } }));
  const response = await f.h.route(f.base + '/quotation', { method: 'POST', body: { action: 'download', fingerprint: preview.fingerprint } });
  assert.equal(response.status, 200, await response.clone().text());
  const reader = f.h.load('app/xlsx-template.ts'), sheet = reader.inspectXlsxArchive(await reader.readXlsxArchive(await response.arrayBuffer()));
  return preview.rows.map((_, index) => reader.xlsxHeaders(sheet, '견적서', index + 2));
}

for (const company of schemaCompanies) for (const scope of ['common', 'option']) test(`explicit model suggestion edits only reviewed ${scope} draft, then API and XLSX (${company.code})`, async () => {
  const f = await setup(company), { h, product, base, endpoint } = f; let ui;
  try {
    let content = (await json(await h.route(base + '/content'))).content;
    await json(await h.route(base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision, patch: { seo: { title: 'SEO에서 확인한 상품명' } } } }));
    let view = await json(await h.route(endpoint)); const options = view.resolved.rows.filter(row => row.optionId), target = options[0], retained = options[1];
    // Keep the compatible manual API as historical fixture data. QuotationEdit
    // now displays these saved names read-only; only the model is staged here.
    const reviewedName = (scope === 'common' ? '수동 공통 최종 상품명 ' : '수동 옵션 최종 상품명 ') + '검토한 내용 '.repeat(12);
    await json(await h.route(endpoint, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [
      { optionId: null, fieldKey: 'title', value: scope === 'common' ? reviewedName : '공통 견적에서 검토한 상품명' }, { optionId: null, fieldKey: 'model', value: '' },
      { optionId: target.optionId, fieldKey: 'title', value: scope === 'option' ? reviewedName : '선택 옵션 견적에서 검토한 상품명' }, { optionId: target.optionId, fieldKey: 'model', value: '' },
      { optionId: retained.optionId, fieldKey: 'model', value: 'RETAINED-OPTION-MODEL' },
    ] } }));
    const before = { raw: h.sqlite.prepare('SELECT payload FROM collection_results').get().payload, context: h.sqlite.prepare('SELECT payload FROM collection_context').get().payload,
      content: h.sqlite.prepare('SELECT payload FROM product_content').get().payload, options: h.sqlite.prepare('SELECT payload FROM product_options').get().payload,
      images: product().image_keys, pricing: product().pricing_policy, objects: new Map([...h.objects].map(([key, value]) => [key, Buffer.from(value)])) };
    const calls = [];
    const request = async (url, init) => { calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null }); return h.route(url, { method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(init.body) } : {}) }); };
    ui = quotationLabelFormUI({ productId: product().id, load: h.load, request, renderDocument() { throw Error('Image generation must not run for a model edit.'); } }); await ui.idle();
    ui.selectOption(scope === 'common' ? '' : target.optionId);
    assert.equal(ui.field('title').props.readOnly, true); assert.equal(ui.field('title').props.value, reviewedName);
    ui.field('title').props.onChange({ target: { value: '프로그램으로 시도한 상품명 수정' } }); ui.render();
    assert.equal(ui.field('title').props.value, reviewedName, 'a read-only title callback cannot stage a manual write');
    const savedBeforeClick = h.sqlite.prepare('SELECT * FROM product_quotation_fields').get();
    assert.equal(ui.field('model').props.value, ''); assert.ok(ui.button('상품명으로 모델명 입력'));
    ui.start('상품명으로 모델명 입력'); ui.render();
    const expected = reviewedName.trim().slice(0, 50);
    assert.equal(ui.field('model').props.value, expected); assert.equal(ui.button('상품명으로 모델명 입력'), undefined);
    assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(), savedBeforeClick, 'click changes only the local editor draft');
    assert.equal(calls.filter(call => call.method === 'PUT').length, 0);
    await ui.click('견적 입력 저장'); assert.equal(calls.filter(call => call.method === 'PUT').length, 1); assert.equal(ui.savedNotifications, 1);
    const written = calls.find(call => call.method === 'PUT').body;
    assert.deepEqual(plain(written.changes), [{ fieldKey: 'model', optionId: scope === 'common' ? null : target.optionId, value: expected }]);
    view = await json(await h.route(endpoint)); const rows = view.resolved.rows.filter(row => row.included), cells = await workbook(f);
    const expectedModels = scope === 'common' ? ['', 'RETAINED-OPTION-MODEL', ...Array(4).fill(expected)] : [expected, 'RETAINED-OPTION-MODEL', ...Array(4).fill('')];
    assert.deepEqual(rows.map(row => row.fields.model.value), expectedModels);
    assert.deepEqual(cells.map(row => row[f.headers.indexOf('model')]), expectedModels);
    assert.equal(view.overrides.common.model, scope === 'common' ? expected : ''); assert.equal(view.overrides.options[retained.optionId].model, 'RETAINED-OPTION-MODEL');
    assert.equal(scope === 'common' ? view.overrides.common.title : view.overrides.options[target.optionId].title, reviewedName, 'the full historical title is preserved while only the model is shortened');
    ui.selectOption(retained.optionId); assert.equal(ui.field('model').props.value, 'RETAINED-OPTION-MODEL'); assert.equal(ui.button('상품명으로 모델명 입력'), undefined);
    assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload, before.raw); assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context').get().payload, before.context);
    assert.equal(h.sqlite.prepare('SELECT payload FROM product_content').get().payload, before.content); assert.equal(h.sqlite.prepare('SELECT payload FROM product_options').get().payload, before.options);
    assert.equal(product().image_keys, before.images); assert.equal(product().pricing_policy, before.pricing); assert.equal(product().supplier_hub_status, '미전송');
    for (const [key, value] of before.objects) assert.deepEqual(Buffer.from(h.objects.get(key)), value);
    assert.deepEqual(Buffer.from(h.objects.get(f.storageKey)), Buffer.from(f.bytes)); assert.ok(!h.network.some(host => host.includes('coupang')));
  } finally { ui?.close(); h.close(); }
});

test('a captured model action recomputes a same-tick title reset and never overwrites a newly typed model', async () => {
  const f = await setup(schemaCompanies[0]), { h, product, base, endpoint } = f; let ui;
  try {
    let content = (await json(await h.route(base + '/content'))).content;
    await json(await h.route(base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision, patch: { seo: { title: 'SEO에서 확인한 최신 상품명' } } } }));
    let view = await json(await h.route(endpoint));
    await json(await h.route(endpoint, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [{ fieldKey: 'title', optionId: 'collected-1', value: '이전에 직접 저장한 상품명' }] } }));
    view = await json(await h.route(endpoint)); const latestTitle = view.automatic.rows.find(row => row.optionId === 'collected-1').fields.title.value.trim().slice(0, 50);
    const calls = [], request = async (url, init) => { calls.push(init?.method ?? 'GET'); return h.route(url, { method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(init.body) } : {}) }); };
    ui = quotationLabelFormUI({ productId: product().id, load: h.load, request, renderDocument() { throw Error('Unexpected image generation'); } }); await ui.idle();
    ui.selectOption('collected-1'); const captured = ui.button('상품명으로 모델명 입력'); assert.ok(captured);
    const before = h.sqlite.prepare('SELECT * FROM product_quotation_fields').get();
    assert.equal(ui.field('title').props.readOnly, true);
    ui.button('상품명 수정 해제 · SEO 자동값 사용').props.onClick();
    captured.props.onClick(); assert.equal(ui.field('model').props.value, latestTitle, 'the captured proposal reads the newly staged reset instead of its old historical title');
    ui.field('model').props.onChange({ target: { value: 'JUST-TYPED-MODEL' } });
    captured.props.onClick(); assert.equal(ui.field('model').props.value, 'JUST-TYPED-MODEL');
    assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(), before); assert.equal(calls.includes('PUT'), false);
    ui.close(); ui = null;
    // A deliberately cleared SEO source becomes blank only after explicitly
    // resetting the retained quotation override. A captured model action must
    // see that same-tick reset and cannot revive its former title proposal.
    content = (await json(await h.route(base + '/content'))).content;
    await json(await h.route(base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision, patch: { seo: { title: '' } } } }));
    ui = quotationLabelFormUI({ productId: product().id, load: h.load, request, renderDocument() { throw Error('Unexpected image generation'); } }); await ui.idle(); ui.selectOption('collected-1');
    const blankCaptured = ui.button('상품명으로 모델명 입력'); assert.ok(blankCaptured);
    ui.button('상품명 수정 해제 · SEO 자동값 사용').props.onClick(); blankCaptured.props.onClick();
    assert.equal(ui.field('title').props.value, ''); assert.equal(ui.field('model').props.value, '', 'a newly cleared source title cannot restore an earlier proposal');
    assert.equal(ui.button('상품명으로 모델명 입력'), undefined);
    assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(), before); assert.equal(calls.includes('PUT'), false);
    assert.equal((await json(await h.route(endpoint))).resolved.rows.find(row => row.optionId === 'collected-1').fields.model.value, '');
  } finally { ui?.close(); h.close(); }
});

test('a failed explicit save retains the model draft and one successful retry stores its exact value', async () => {
  const f = await setup(schemaCompanies[1]), { h, product } = f; let ui;
  try {
    let writes = 0;
    const request = async (url, init) => {
      if (init?.method === 'PUT' && ++writes === 1) return new Response(JSON.stringify({ error: 'fixture save failure' }), { status: 500 });
      return h.route(url, { method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(init.body) } : {}) });
    };
    ui = quotationLabelFormUI({ productId: product().id, load: h.load, request, renderDocument() { throw Error('Unexpected image generation'); } }); await ui.idle();
    ui.selectOption('collected-1'); const expected = ui.field('title').props.value.trim().slice(0, 50);
    const before = h.sqlite.prepare('SELECT * FROM product_quotation_fields').get();
    await ui.click('상품명으로 모델명 입력'); await ui.click('견적 입력 저장');
    assert.equal(ui.field('model').props.value, expected); assert.equal(ui.savedNotifications, 0); assert.ok(ui.alerts().includes('fixture save failure'));
    assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(), before);
    await ui.click('견적 입력 저장'); assert.equal(writes, 2); assert.equal(ui.savedNotifications, 1);
    assert.equal(ui.field('model').props.value, expected); assert.equal(product().supplier_hub_status, '미전송');
  } finally { ui?.close(); h.close(); }
});

function pairedSchema() {
  const current = schema();
  Object.assign(current.fields.find(field => field.id === 'model'), { hubInput: 'model', hubWire: { path: ['productPage', 'modelNumber'] } });
  Object.assign(current.fields.find(field => field.id === 'title'), { hubInput: 'title', hubWire: { path: ['startPage', 'productName'] } });
  current.fields.push({ id: 'official-model', section: 'product', visibility: 'hidden', type: 'text', required: false, label: '모델명/품번', contentField: 'model',
    hubWire: { path: ['productPage', 'unexposedAttributes'], name: '모델명/품번', nameKey: 'attributeName', valueKey: 'attributeValue' }, maxLength: 2000 });
  return current;
}
test('exact official peer proposals preserve independent common and option values, manual blanks and paired retained models', () => {
  const current = pairedSchema(), title = '검토한 최종 상품명', cell = (value, source) => ({ value, source });
  const automatic = { model: cell('', 'empty'), 'official-model': cell('', 'couplus-default'), title: cell(title, 'manual-common') };
  const inspect = (common = automatic, options = [automatic, automatic], optionId = null, schemaValue = current) => {
    const read = (id, scope = optionId) => scope === null ? common[id] : options[scope === 'first' ? 0 : 1][id];
    return suggestionState(schemaValue, 'model', read, { optionId, optionIds: ['first', 'second'] });
  };
  const answer = inspect(); assert.deepEqual(plain(answer.suggestion.changes), [{ fieldKey: 'model', value: title }, { fieldKey: 'official-model', value: title }]);
  for (const peer of [cell('', 'manual-common'), cell('INDEPENDENT', 'manual-common'), cell('EXISTING', 'content')]) {
    const common = { ...automatic, 'official-model': peer }, before = JSON.stringify(common);
    const blocked = inspect(common); assert.equal(blocked.suggestion, null); assert.match(blocked.reason, /별도 입력값|직접 비운/); assert.equal(JSON.stringify(common), before);
  }
  for (const key of ['model', 'official-model']) for (const value of ['', 'INDEPENDENT']) {
    const row = { ...automatic, [key]: cell(value, 'manual-option') }, before = JSON.stringify(row);
    const blocked = inspect(automatic, [row, automatic]); assert.equal(blocked.suggestion, null); assert.match(blocked.reason, /옵션별/); assert.equal(JSON.stringify(row), before);
  }
  const retained = { ...automatic, model: cell('RETAINED', 'manual-option'), 'official-model': cell('RETAINED', 'manual-option') };
  assert.ok(inspect(automatic, [retained, automatic]).suggestion, 'both independent model values remain untouched while a common pair is entered');
  const samePeer = { ...automatic, 'official-model': cell(title, 'manual-common') };
  assert.deepEqual(plain(inspect(samePeer, [samePeer, samePeer]).suggestion.changes), [{ fieldKey: 'model', value: title }]);
  for (const source of ['manual-common', 'manual-option']) {
    const row = { ...automatic, 'official-model': cell('', source) };
    assert.equal(inspect(automatic, [row, automatic], 'first').suggestion, null, 'option edits never overwrite an independent blank or inherited manual blank');
  }
  const optionSame = { ...automatic, 'official-model': cell(title, 'manual-option') };
  assert.deepEqual(plain(inspect(automatic, [optionSame, automatic], 'first').suggestion.changes), [{ fieldKey: 'model', value: title }]);
});

test('official model peers must be unique exact text wires with confirmed input constraints and reviewed option scope', () => {
  const mutations = [
    current => { current.fields.push(structuredClone(current.fields.at(-1))); },
    current => { current.fields.at(-1).hubWire.path = ['productPage', 'otherAttributes']; },
    current => { current.fields.at(-1).hubWire.nameKey = 'name'; },
    current => { current.fields.at(-1).hubWire.valueKey = 'value'; },
    current => { current.fields.at(-1).contentField = 'material'; },
    current => { current.fields.at(-1).readOnly = true; },
    current => { current.fields.at(-1).type = 'select'; },
    current => { current.fields.at(-1).choices = [{ value: 'FIXED', label: 'FIXED' }]; },
    current => { current.fields.at(-1).hubInput = 'brand'; },
    current => { current.fields.at(-1).maxLength = 2; },
  ];
  const cells = { model: { value: '', source: 'empty' }, title: { value: '검토한 최종 상품명', source: 'content' }, 'official-model': { value: '', source: 'couplus-default' } };
  for (const mutate of mutations) { const current = pairedSchema(); mutate(current); assert.equal(suggestionState(current, 'model', id => cells[id], { optionId: null, optionIds: ['first'] }).suggestion, null); }
  assert.equal(suggestion(pairedSchema(), 'model', id => cells[id]), null, 'a peer must not be filled without a verified option scope');
});

const originalProfileFile = new URL('../outputs/step604-unand-profile-read.json', import.meta.url);
const originalWorkbookFile = new URL('../outputs/step603-official-unand-2624.xlsx', import.meta.url);
const originalAvailable = fs.existsSync(originalProfileFile) && fs.existsSync(originalWorkbookFile);

async function setupOriginal() {
  const saved = JSON.parse(JSON.parse(fs.readFileSync(originalProfileFile, 'utf8'))[0].results[0].payload), hubSchema = saved.hubSchema;
  assert.equal(hubSchema.company.code, 'A01526306'); assert.equal(hubSchema.company.name, '유앤채');
  const h = mobileIntakeHarness({ companyCode: hubSchema.company.code, companyName: hubSchema.company.name });
  const bytes = new Uint8Array(fs.readFileSync(originalWorkbookFile)), form = new FormData();
  form.set('file', new File([bytes], 'original-Unand.xlsx')); form.set('schema', JSON.stringify(hubSchema)); form.set('action', 'workbook');
  const connected = await (async response => { assert.equal(response.status, 201, await response.clone().text()); return response.json(); })(
    await h.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test/api/category-profiles/official-template', { method: 'POST', body: form })));
  const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', { name: '공식 원본 모델 명시 적용 검수', categoryId: saved.categoryId, categoryPath: saved.categoryPath, hubSchema,
    template: connected.template, mappings: connected.mappings }, 'cat');
  h.context.category = profile; h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));
  h.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run(); await h.intake();
  const product = () => h.sqlite.prepare('SELECT * FROM products').get(), base = '/api/products/' + product().id, endpoint = base + '/quotation-fields';
  const view = await json(await h.route(endpoint)), peers = view.resolved.schema.fields.filter(field => field.contentField === 'model');
  assert.equal(peers.length, 1); const peer = peers[0], mapping = profile.mappings.find(item => item.field === peer.id); assert.equal(mapping.column, 11);
  assert.equal(profile.mappings.some(item => item.field === 'model'), false);
  return { h, product, base, endpoint, profile, peer, modelColumn: mapping.column, bytes, storageKey: profile.template.storageKey, headers: profile.template.headers };
}

test('actual original Unand XLSX receives the reviewed model in six official cells through one explicit two-field save', { skip: !originalAvailable }, async () => {
  const f = await setupOriginal(), { h, product, endpoint, peer } = f; let ui;
  try {
    const title = '사용자가 검토한 최종 상품명 · 별도 모델이 없는 상품임을 확인하고 공식 원본의 모델명 열에도 동일한 값을 명시 적용합니다.';
    let view = await json(await h.route(endpoint)); const retainedOption = view.resolved.rows.filter(row => row.optionId)[1].optionId;
    await json(await h.route(endpoint, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [
      { fieldKey: 'title', optionId: null, value: title }, { fieldKey: 'model', optionId: null, value: '' },
      { fieldKey: 'model', optionId: retainedOption, value: 'RETAINED-MODEL' }, { fieldKey: peer.id, optionId: retainedOption, value: 'RETAINED-MODEL' },
    ] } }));
    const immutable = () => JSON.stringify({ raw: h.sqlite.prepare('SELECT payload FROM collection_results').get().payload, context: h.sqlite.prepare('SELECT payload FROM collection_context').get().payload,
      content: h.sqlite.prepare('SELECT * FROM product_content').all(), options: h.sqlite.prepare('SELECT * FROM product_options').all(), imageKeys: product().image_keys, pricing: product().pricing_policy });
    const before = immutable(), originalObjects = new Map([...h.objects].map(([key, value]) => [key, Buffer.from(value)])), calls = [];
    const request = async (url, init) => { calls.push({ method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null }); return h.route(url, { method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(init.body) } : {}) }); };
    ui = quotationLabelFormUI({ productId: product().id, load: h.load, request, renderDocument() { throw Error('No image generation'); } }); await ui.idle(); ui.selectOption('');
    assert.equal(ui.field('model').props.value, ''); assert.equal(ui.field(peer.id).props.value, '');
    const beforeClick = h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(); await ui.click('상품명으로 모델명 입력');
    const expected = title.trim().slice(0, 50); assert.equal(ui.field('model').props.value, expected); assert.equal(ui.field(peer.id).props.value, expected);
    assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(), beforeClick); assert.equal(calls.filter(call => call.method === 'PUT').length, 0);
    await ui.click('견적 입력 저장'); const puts = calls.filter(call => call.method === 'PUT'); assert.equal(puts.length, 1);
    assert.deepEqual(plain(puts[0].body.changes), [{ fieldKey: 'model', value: expected, optionId: null }, { fieldKey: peer.id, value: expected, optionId: null }]);
    view = await json(await h.route(endpoint)); const included = view.resolved.rows.filter(row => row.included), expectedRows = [expected, 'RETAINED-MODEL', ...Array(4).fill(expected)];
    assert.deepEqual(included.map(row => row.fields.model.value), expectedRows); assert.deepEqual(included.map(row => row.fields[peer.id].value), expectedRows);
    const preview = await json(await h.route(f.base + '/quotation', { method: 'POST', body: { action: 'preview' } }));
    assert.equal(preview.submissionReview.issues.some(issue => issue.code === 'EXCEL_FIELD_UNMAPPED' && issue.fieldId === 'model'), false);
    const download = await h.route(f.base + '/quotation', { method: 'POST', body: { action: 'download', fingerprint: preview.fingerprint } }); assert.equal(download.status, 200, await download.clone().text());
    const reader = h.load('app/xlsx-template.ts'), book = reader.inspectXlsxArchive(await reader.readXlsxArchive(await download.arrayBuffer()));
    const start = f.profile.template.dataStartRow ?? f.profile.template.headerRow + 1; assert.equal(start, 9);
    assert.deepEqual(included.map((_, index) => reader.xlsxHeaders(book, f.profile.template.sheetName, start + index)[f.modelColumn]), expectedRows);
    assert.equal(immutable(), before); for (const [key, bytes] of originalObjects) assert.deepEqual(Buffer.from(h.objects.get(key)), bytes);
    assert.deepEqual(Buffer.from(h.objects.get(f.storageKey)), Buffer.from(f.bytes)); assert.equal(product().supplier_hub_status, '미전송'); assert.ok(!h.network.some(host => host.includes('coupang')));
  } finally { ui?.close(); h.close(); }
});

test('actual original peer manual blank staged in the same tick cancels a captured suggestion without hidden repairs', { skip: !originalAvailable }, async () => {
  const f = await setupOriginal(), { h, product, peer } = f; let ui;
  try {
    const calls = [], request = async (url, init) => { calls.push(init?.method ?? 'GET'); return h.route(url, { method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(init.body) } : {}) }); };
    ui = quotationLabelFormUI({ productId: product().id, load: h.load, request, renderDocument() { throw Error('No image generation'); } }); await ui.idle(); ui.selectOption('');
    const captured = ui.button('상품명으로 모델명 입력'); assert.ok(captured);
    const before = h.sqlite.prepare('SELECT * FROM product_quotation_fields').get();
    ui.field(peer.id).props.onChange({ target: { value: '' } }); captured.props.onClick();
    assert.equal(ui.field('model').props.value, ''); assert.equal(ui.field(peer.id).props.value, ''); assert.equal(ui.button('상품명으로 모델명 입력'), undefined);
    assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(), before); assert.equal(calls.includes('PUT'), false);
    await ui.click('견적 입력 저장');
    const view = await json(await h.route(f.endpoint)); assert.equal(view.overrides.common[peer.id], ''); assert.equal(view.overrides.common.model, undefined);
    assert.equal(product().supplier_hub_status, '미전송');
  } finally { ui?.close(); h.close(); }
});
