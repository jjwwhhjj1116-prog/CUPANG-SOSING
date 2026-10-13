import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { quotationLabelFormUI } from './helpers/quotation-label-form-ui.mjs';
import { schemaCompanies } from './helpers/hub-schema.mjs';

const profileFile = new URL('../outputs/step604-unand-profile-read.json', import.meta.url);
const originalFile = new URL('../outputs/step603-official-unand-2624.xlsx', import.meta.url);
const available = fs.existsSync(profileFile) && fs.existsSync(originalFile);
const plain = value => JSON.parse(JSON.stringify(value));
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const buttonLabel = '입력한 모델명을 공식 모델명/품번에 적용';
const modelValue = 'REVIEWED-REAL-MODEL-' + '가'.repeat(37); // 57 units: a real model must not use the title's 50-unit suggestion rule.
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];

function recorded() { return JSON.parse(JSON.parse(fs.readFileSync(profileFile, 'utf8'))[0].results[0].payload); }

async function setup(company) {
  const saved = recorded(), hubSchema = structuredClone(saved.hubSchema);
  assert.deepEqual(hubSchema.company, { code: 'A01526306', name: '유앤채' });
  // Unand is the actual recorded original contract. Waihop reuses that public
  // contract in isolation to exercise account boundaries, not a new Hub capture.
  if (company) hubSchema.company = { code: company.code, name: company.name };
  const h = mobileIntakeHarness({ companyCode: hubSchema.company.code, companyName: hubSchema.company.name });
  const bytes = new Uint8Array(fs.readFileSync(originalFile)), form = new FormData();
  form.set('file', new File([bytes], 'original-Unand.xlsx')); form.set('schema', JSON.stringify(hubSchema)); form.set('action', 'workbook');
  const linked = await json(await h.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test/api/category-profiles/official-template', { method: 'POST', body: form })), 201);
  const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', { name: 'MEMORY ONLY REVIEWED MODEL', categoryId: saved.categoryId,
    categoryPath: saved.categoryPath, hubSchema, template: linked.template, mappings: linked.mappings }, 'cat');
  h.context.category = profile; h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));
  h.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run(); await h.intake();
  const product = () => h.sqlite.prepare('SELECT * FROM products').get(), base = '/api/products/' + product().id, endpoint = base + '/quotation-fields';
  const view = await json(await h.route(endpoint)), peers = view.resolved.schema.fields.filter(field => field.contentField === 'model');
  assert.equal(peers.length, 1); const peer = peers[0], mappings = profile.mappings.filter(mapping => mapping.field === peer.id);
  assert.equal(peer.id, 'live_69900_ec970ce9ec540353'); assert.equal(mappings.length, 1); assert.equal(mappings[0].column, 11);
  assert.equal(profile.template.dataStartRow, 9);
  return { h, product, base, endpoint, profile, peer, bytes, modelColumn: mappings[0].column };
}

const preserve = f => {
  const product = { ...f.product() }; delete product.updated_at;
  return JSON.stringify({ product, raw: f.h.sqlite.prepare('SELECT * FROM collection_results').all(), context: f.h.sqlite.prepare('SELECT * FROM collection_context').all(),
    content: f.h.sqlite.prepare('SELECT * FROM product_content').all(), options: f.h.sqlite.prepare('SELECT * FROM product_options').all() });
};
function form(f, calls = [], amend) {
  const request = async (url, init) => {
    const call = { method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null }; calls.push(call);
    const replacement = await amend?.(call); if (replacement) return replacement;
    return f.h.route(url, { method: call.method, ...(call.body ? { body: call.body } : {}) });
  };
  return quotationLabelFormUI({ productId: f.product().id, load: f.h.load, request, renderDocument() { throw Error('Model editing cannot generate images.'); } });
}
async function change(f, changes) {
  const view = await json(await f.h.route(f.endpoint));
  return json(await f.h.route(f.endpoint, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes } }));
}
async function output(f) {
  const view = await json(await f.h.route(f.endpoint)), preview = await json(await f.h.route(f.base + '/quotation', { method: 'POST', body: { action: 'preview' } }));
  const response = await f.h.route(f.base + '/quotation', { method: 'POST', body: { action: 'download', fingerprint: preview.fingerprint } });
  assert.equal(response.status, 200, await response.clone().text());
  const reader = f.h.load('app/xlsx-template.ts'), book = reader.inspectXlsxArchive(await reader.readXlsxArchive(await response.arrayBuffer()));
  return { view, preview, cells: view.resolved.rows.filter(row => row.included).map((_, index) => reader.xlsxHeaders(book, f.profile.template.sheetName, 9 + index)[f.modelColumn]) };
}
const modelError = preview => preview.submissionReview.issues.some(issue => issue.code === 'EXCEL_FIELD_UNMAPPED' && issue.fieldId === 'model');

test('direct typing and saving preserve independent cells until an explicit link fixes the original six model cells', { skip: !available }, async () => {
  const f = await setup(), calls = []; let ui;
  try {
    const before = preserve(f), objects = new Map([...f.h.objects].map(([key, bytes]) => [key, Buffer.from(bytes)])), networkBefore = f.h.network.length;
    ui = form(f, calls); await ui.idle(); ui.selectOption('');
    const stored = f.h.sqlite.prepare('SELECT * FROM product_quotation_fields').get();
    ui.field('model').props.onChange({ target: { value: modelValue } }); ui.render();
    assert.equal(ui.field(f.peer.id).props.value, ''); assert.ok(ui.button(buttonLabel));
    assert.deepEqual(f.h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(), stored, 'typing changes no stored field');
    await ui.click('견적 입력 저장');
    assert.deepEqual(plain(calls.find(call => call.method === 'PUT').body.changes), [{ fieldKey: 'model', optionId: null, value: modelValue }]);
    let result = await output(f); assert.ok(modelError(result.preview));
    assert.deepEqual(result.cells, Array(6).fill('')); assert.ok(result.view.resolved.rows.filter(row => row.included).every(row => row.fields.model.value === modelValue && row.fields[f.peer.id].value === ''));
    const beforeClick = f.h.sqlite.prepare('SELECT * FROM product_quotation_fields').get();
    await ui.click(buttonLabel); assert.equal(ui.field(f.peer.id).props.value, modelValue);
    assert.equal(calls.filter(call => call.method === 'PUT').length, 1); assert.deepEqual(f.h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(), beforeClick);
    await ui.click('견적 입력 저장');
    assert.deepEqual(plain(calls.filter(call => call.method === 'PUT')[1].body.changes), [{ fieldKey: f.peer.id, optionId: null, value: modelValue }]);
    result = await output(f); assert.equal(modelError(result.preview), false); assert.deepEqual(result.cells, Array(6).fill(modelValue));
    assert.ok(result.view.resolved.rows.filter(row => row.included).every(row => row.fields.model.value === modelValue && row.fields[f.peer.id].value === modelValue));
    assert.equal(preserve(f), before); assert.equal(f.h.objects.size, objects.size); for (const [key, bytes] of objects) assert.deepEqual(Buffer.from(f.h.objects.get(key)), bytes);
    assert.deepEqual(Buffer.from(f.h.objects.get(f.profile.template.storageKey)), Buffer.from(f.bytes));
    assert.equal(f.h.network.length, networkBefore); assert.equal(f.product().supplier_hub_status, '미전송');
  } finally { ui?.close(); f.h.close(); }
});

for (const company of schemaCompanies) for (const scope of ['common', 'option']) test(`one explicit ${scope} link and save keeps other reviewed models and original Excel output (${company.code}; ${company.code === 'A01526306' ? 'recorded original' : 'reused contract'})`, { skip: !available }, async () => {
  const f = await setup(company), calls = []; let ui;
  try {
    const initial = await json(await f.h.route(f.endpoint)), rows = initial.resolved.rows.filter(row => row.optionId), target = rows[0].optionId, retained = rows[1].optionId;
    await change(f, [{ fieldKey: 'model', optionId: retained, value: 'RETAINED-REAL-MODEL' }, { fieldKey: f.peer.id, optionId: retained, value: 'RETAINED-REAL-MODEL' }]);
    const before = preserve(f), quoteBefore = f.h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(), objects = new Map([...f.h.objects].map(([key, bytes]) => [key, Buffer.from(bytes)])), networkBefore = f.h.network.length;
    ui = form(f, calls); await ui.idle(); ui.selectOption(scope === 'common' ? '' : target);
    const optionId = scope === 'common' ? null : target;
    ui.field('model').props.onChange({ target: { value: modelValue } }); ui.render();
    if (scope === 'option') {
      const copy = nodes(ui.render().tree).find(node => node.type === 'input' && node.props.role === 'switch');
      copy.props.onChange({ target: { checked: true } }); ui.render(); assert.equal(nodes(ui.render().tree).find(node => node.props.role === 'switch').props.checked, true);
    }
    await ui.click(buttonLabel); assert.equal(ui.field('model').props.value, modelValue); assert.equal(ui.field(f.peer.id).props.value, modelValue);
    if (scope === 'option') assert.equal(nodes(ui.render().tree).find(node => node.props.role === 'switch').props.checked, false, 'explicit linking clears all-option copy');
    assert.equal(calls.filter(call => call.method === 'PUT').length, 0); assert.deepEqual(f.h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(), quoteBefore);
    await ui.click('견적 입력 저장'); const puts = calls.filter(call => call.method === 'PUT'); assert.equal(puts.length, 1);
    assert.deepEqual(plain(puts[0].body.changes), [{ fieldKey: 'model', optionId, value: modelValue }, { fieldKey: f.peer.id, optionId, value: modelValue }]);
    const result = await output(f), expected = scope === 'common' ? [modelValue, 'RETAINED-REAL-MODEL', ...Array(4).fill(modelValue)] : [modelValue, 'RETAINED-REAL-MODEL', ...Array(4).fill('')];
    assert.deepEqual(result.cells, expected); assert.equal(modelError(result.preview), false);
    for (const fieldKey of ['model', f.peer.id]) assert.deepEqual(result.view.resolved.rows.filter(row => row.included).map(row => row.fields[fieldKey].value), expected);
    assert.equal(result.view.overrides.options[retained].model, 'RETAINED-REAL-MODEL'); assert.equal(result.view.overrides.options[retained][f.peer.id], 'RETAINED-REAL-MODEL');
    assert.equal(preserve(f), before); for (const [key, bytes] of objects) assert.deepEqual(Buffer.from(f.h.objects.get(key)), bytes);
    assert.equal(f.h.network.length, networkBefore); assert.equal(f.product().supplier_hub_status, '미전송');
  } finally { ui?.close(); f.h.close(); }
});

test('the link recomputes latest same-tick input, keeps later manual peer blanks, and rejects old-scope handlers', { skip: !available }, async () => {
  const f = await setup(), calls = []; let ui;
  try {
    ui = form(f, calls); await ui.idle(); ui.selectOption('');
    ui.field('model').props.onChange({ target: { value: 'EARLIER-MODEL' } }); ui.render(); const captured = ui.button(buttonLabel); assert.ok(captured);
    ui.selectOption('collected-1'); captured.props.onClick(); assert.equal(ui.field(f.peer.id).props.value, '');
    ui.selectOption(''); assert.equal(ui.field(f.peer.id).props.value, '', 'an old common-scope handler cannot link after changing the selected option');
    ui.field('model').props.onChange({ target: { value: 'LATEST-MODEL' } }); captured.props.onClick();
    assert.equal(ui.field(f.peer.id).props.value, 'LATEST-MODEL'); assert.equal(ui.field('model').props.value, 'LATEST-MODEL');
    ui.field('model').props.onChange({ target: { value: 'DIFFERENT-LATEST' } }); ui.field(f.peer.id).props.onChange({ target: { value: '' } }); captured.props.onClick();
    assert.equal(ui.field(f.peer.id).props.value, ''); assert.equal(ui.button(buttonLabel), undefined);
    ui.field(f.peer.id).props.onChange({ target: { value: 'INDEPENDENT-PEER' } }); captured.props.onClick(); assert.equal(ui.field(f.peer.id).props.value, 'INDEPENDENT-PEER');
    ui.selectOption('collected-1'); captured.props.onClick(); assert.equal(ui.field(f.peer.id).props.value, 'INDEPENDENT-PEER');
    assert.equal(calls.filter(call => call.method === 'PUT').length, 0);
    ui.selectOption(''); ui.field('model').props.onChange({ target: { value: '' } }); captured.props.onClick(); assert.equal(ui.field('model').props.value, '');
    await ui.click('견적 입력 저장'); const view = await json(await f.h.route(f.endpoint));
    assert.equal(view.overrides.common.model, ''); assert.equal(view.overrides.common[f.peer.id], 'INDEPENDENT-PEER');
  } finally { ui?.close(); f.h.close(); }
});

test('manual peer common/option values and deliberate blanks stay independent and blocking', { skip: !available }, async () => {
  const f = await setup(); let ui;
  try {
    const inspect = f.h.load('app/quotation-model-suggestion.ts').quotationManualModelLinkState;
    const initial = await json(await f.h.route(f.endpoint)), optionId = initial.resolved.rows.find(row => row.optionId).optionId;
    const reset = () => change(f, [null, optionId].flatMap(id => ['model', f.peer.id].map(fieldKey => ({ fieldKey, optionId: id, value: null }))));
    const state = (view, scope) => inspect(view.resolved.schema, 'model', (id, layer = scope) => view.resolved.rows.find(row => row.optionId === layer)?.fields[id],
      { optionId: scope, optionIds: view.resolved.rows.filter(row => row.included).map(row => row.optionId) });
    for (const layer of [null, optionId]) for (const value of ['', 'INDEPENDENT-PEER']) {
      await reset(); const view = await change(f, [{ fieldKey: 'model', optionId: layer, value: modelValue }, { fieldKey: f.peer.id, optionId: layer, value }]);
      const before = f.h.sqlite.prepare('SELECT * FROM product_quotation_fields').get();
      assert.equal(state(view, layer).link, null); assert.match(state(view, layer).reason, /별도 직접 입력값|직접 비운/);
      ui = form(f); await ui.idle(); ui.selectOption(layer ?? ''); assert.equal(ui.button(buttonLabel), undefined);
      ui.field('model').props.onChange({ target: { value: 'ANOTHER-REVIEWED-MODEL' } }); await ui.click('견적 입력 저장');
      const after = await json(await f.h.route(f.endpoint));
      assert.equal(after.resolved.rows.find(row => row.optionId === layer).fields[f.peer.id].value, value);
      assert.ok(modelError((await output(f)).preview), 'independent manual values remain a genuine output mismatch');
      assert.notDeepEqual(f.h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(), before);
      ui.close(); ui = null;
    }
    for (const fieldKey of ['model', f.peer.id]) for (const value of ['', 'OPTION-INDEPENDENT']) {
      await reset(); const view = await change(f, [{ fieldKey: 'model', optionId: null, value: modelValue }, { fieldKey, optionId, value }]);
      const before = f.h.sqlite.prepare('SELECT * FROM product_quotation_fields').get();
      assert.equal(state(view, null).link, null); assert.match(state(view, null).reason, /옵션별/);
      assert.deepEqual(f.h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(), before);
    }
    for (const value of ['', 'INHERITED-PEER']) {
      await reset(); const view = await change(f, [{ fieldKey: f.peer.id, optionId: null, value }, { fieldKey: 'model', optionId, value: modelValue }]);
      assert.equal(state(view, optionId).link, null, 'an inherited manual peer blank/value remains protected');
    }
    await reset(); const samePair = await change(f, [{ fieldKey: 'model', optionId: null, value: modelValue },
      { fieldKey: 'model', optionId, value: 'RETAINED-PAIR' }, { fieldKey: f.peer.id, optionId, value: 'RETAINED-PAIR' }]);
    assert.ok(state(samePair, null).link, 'a matching independent option pair may remain while only the common peer is linked');
  } finally { ui?.close(); f.h.close(); }
});

test('manual linking requires exact model/official peer identity and preserves the full validated input', { skip: !available }, async () => {
  const f = await setup();
  try {
    const inspect = f.h.load('app/quotation-model-suggestion.ts').quotationManualModelLinkState;
    const initial = await json(await f.h.route(f.endpoint)), schema = initial.resolved.schema;
    const cells = { model: { value: modelValue, source: 'manual-common' }, [f.peer.id]: { value: '', source: 'couplus-default' } };
    const state = (current = schema, source = cells) => inspect(current, 'model', id => source[id], { optionId: 'selected', optionIds: ['selected'] });
    assert.equal(state().link.value, modelValue); assert.equal(state().link.value.length, 57);
    const withoutTitle = structuredClone(schema); withoutTitle.fields = withoutTitle.fields.filter(field => field.id !== 'title');
    assert.equal(state(withoutTitle).link.value, modelValue, 'a real model has no product-name dependency');
    for (const value of ['', '   ', 'x\ud800', 'x\udc00', 'x\u0001', 'x'.repeat(61)]) assert.equal(state(schema, { ...cells, model: { value, source: 'manual-common' } }).link, null);
    assert.equal(state(schema, { ...cells, model: { value: modelValue, source: 'content' } }).link, null, 'no passive automatic synchronization');
    assert.equal(state(schema, { ...cells, [f.peer.id]: { value: modelValue, source: 'manual-common' } }).link, null, 'already equal independent cells need no write');
    const mutations = [
      current => { current.status = 'unconfirmed'; }, current => { current.unsupportedFields = ['unknown']; },
      current => { current.fields.push(structuredClone(current.fields.find(field => field.id === 'model'))); },
      current => { current.fields.find(field => field.id === 'model').hubWire.name = ''; },
      current => { current.fields.find(field => field.id === 'model').readOnly = true; },
      current => { current.fields.find(field => field.id === 'model').maxLength = 10; },
      current => { current.fields.find(field => field.id === f.peer.id).maxLength = 10; },
      current => { current.fields.find(field => field.id === f.peer.id).minLength = 70; },
      current => { current.fields.find(field => field.id === f.peer.id).readOnly = true; },
      current => { current.fields.find(field => field.id === f.peer.id).contentField = 'material'; },
      current => { current.fields.find(field => field.id === f.peer.id).hubInput = 'brand'; },
      current => { current.fields.find(field => field.id === f.peer.id).optionDimension = 'color'; },
      current => { current.fields.find(field => field.id === f.peer.id).hubWire.name = 'OTHER'; },
      current => { current.fields.find(field => field.id === f.peer.id).hubWire.nameKey = 'name'; },
      current => { current.fields.find(field => field.id === f.peer.id).hubWire.valueKey = 'value'; },
      current => { current.fields.find(field => field.id === f.peer.id).choices = [{ value: 'FIXED', label: 'FIXED' }]; },
      current => { current.fields.push({ ...structuredClone(current.fields.find(field => field.id === f.peer.id)), id: 'ambiguous' }); },
    ];
    for (const mutate of mutations) { const current = structuredClone(schema); mutate(current); const before = JSON.stringify(current); assert.equal(state(current).link, null); assert.equal(JSON.stringify(current), before); }
    assert.equal(inspect(schema, 'model', id => cells[id]).link, null, 'no guessed option scope');
    assert.equal(inspect(schema, 'model', id => cells[id], { optionId: null, optionIds: ['same', 'same'] }).link, null);
    assert.equal(state(schema, { ...cells, [f.peer.id]: { value: 'OLD-AUTOMATIC-MODEL', source: 'content' } }).link.peer.before, 'OLD-AUTOMATIC-MODEL', 'the explicit preview may replace a previous automatic value');
  } finally { f.h.close(); }
});

test('failed saves retain the paired manual draft and the next save writes the exact pair once', { skip: !available }, async () => {
  const f = await setup(schemaCompanies[1]), calls = []; let ui, fail = true;
  try {
    ui = form(f, calls, call => call.method === 'PUT' && fail ? (fail = false, Response.json({ error: 'offline save failure' }, { status: 500 })) : null);
    await ui.idle(); ui.selectOption(''); ui.field('model').props.onChange({ target: { value: modelValue } }); ui.render(); await ui.click(buttonLabel);
    const before = f.h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(); await ui.click('견적 입력 저장');
    assert.ok(ui.alerts().includes('offline save failure')); assert.equal(ui.savedNotifications, 0);
    assert.equal(ui.field('model').props.value, modelValue); assert.equal(ui.field(f.peer.id).props.value, modelValue); assert.deepEqual(f.h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(), before);
    await ui.click('견적 입력 저장'); assert.equal(ui.savedNotifications, 1); assert.equal(calls.filter(call => call.method === 'PUT').length, 2);
    const result = await output(f); assert.equal(modelError(result.preview), false); assert.deepEqual(result.cells, Array(6).fill(modelValue));
  } finally { ui?.close(); f.h.close(); }
});

test('refresh immediately locks captured model links, then preserves drafts through success, failure and closing', { skip: !available }, async () => {
  for (const scope of ['common', 'option', 'closing']) {
    const f = await setup(), calls = []; let ui, hold = false, release;
    try {
      ui = form(f, calls, call => hold && call.method === 'GET' ? (hold = false, new Promise(resolve => { release = resolve; })) : null);
      await ui.idle(); ui.selectOption(scope === 'option' ? 'collected-1' : '');
      ui.field('model').props.onChange({ target: { value: modelValue } }); ui.render();
      const stored = f.h.sqlite.prepare('SELECT * FROM product_quotation_fields').get();
      for (const outcome of scope === 'closing' ? ['closing'] : ['success', 'failure']) {
        const captured = ui.button(buttonLabel), refresh = ui.button('기본값 다시 반영'); assert.ok(captured); assert.ok(refresh);
        hold = true; refresh.props.onClick(); assert.equal(typeof release, 'function');
        captured.props.onClick();
        assert.equal(ui.field(f.peer.id).props.value, '', 'a captured callback cannot create a draft which the pending GET would silently discard');
        assert.equal(ui.field('model').props.value, modelValue); assert.deepEqual(f.h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(), stored);
        if (outcome === 'closing') {
          const response = await f.h.route(f.endpoint); ui.close(); captured.props.onClick(); release(response);
          await new Promise(resolve => setImmediate(resolve));
          assert.deepEqual(f.h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(), stored); assert.equal(calls.filter(call => call.method === 'PUT').length, 0);
          break;
        }
        release(outcome === 'success' ? await f.h.route(f.endpoint) : Response.json({ error: 'offline refresh failure' }, { status: 500 }));
        await ui.idle(); assert.equal(ui.field('model').props.value, modelValue); assert.equal(ui.field(f.peer.id).props.value, '');
        assert.equal(calls.filter(call => call.method === 'PUT').length, 0); assert.deepEqual(f.h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(), stored);
        if (outcome === 'failure') assert.ok(ui.alerts().includes('offline refresh failure'));
      }
      if (scope === 'closing') continue;
      await ui.click(buttonLabel); assert.equal(ui.field(f.peer.id).props.value, modelValue);
      await ui.click('견적 입력 저장'); const writes = calls.filter(call => call.method === 'PUT'); assert.equal(writes.length, 1);
      const optionId = scope === 'common' ? null : 'collected-1';
      assert.deepEqual(plain(writes[0].body.changes), [{ fieldKey: 'model', optionId, value: modelValue }, { fieldKey: f.peer.id, optionId, value: modelValue }]);
      const result = await output(f); assert.equal(modelError(result.preview), false);
      assert.deepEqual(result.cells, scope === 'common' ? Array(6).fill(modelValue) : [modelValue, ...Array(5).fill('')]);
      assert.equal(f.product().supplier_hub_status, '미전송');
    } finally { ui?.close(); f.h.close(); }
  }
});
