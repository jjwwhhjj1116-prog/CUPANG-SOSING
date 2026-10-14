import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryPickerUI } from './helpers/category-picker.mjs';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { hubSchemaSnapshot, schemaCompanies, schemaPath } from './helpers/hub-schema.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const json = async (response, status = 200) => {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
};
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const waitFor = async predicate => {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error('Single category fixture timed out');
    await new Promise(resolve => setTimeout(resolve, 1));
  }
};

/** Actual CategoryPicker, settings/profile/collection/content/quotation APIs and
 * SQLite. All categories, seller facts, source receipts and translation results
 * are isolated fixtures; no browser, real supplier, image provider or Hub call. */
function setup(company) {
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name });
  const snapshot = { ...hubSchemaSnapshot(company), draftInitialization: 'couplus-required-v1', inputBindings: 'couplus-paths-v1', settingsInitialization: 'couplus-options-v1',
    metadata: { displayCategoryCode: '991234', kanCategoryId: 3000, scopeType: 'Retail_Categorized_Single', noticeNumber: 17, version: 190 } };
  const raw = JSON.parse(snapshot.schemaString);
  raw.metadata = 'scope:Retail_Categorized_Single;categoryId:3000;productNoticeCategoryId:17;version:190';
  snapshot.schemaString = JSON.stringify(raw);
  const choice = { key: 'single-' + company.code, categoryId: '991234', path: [...schemaPath], isLeaf: true,
    supplierHub: { trail: [], ownerId: 'owner', company: { ...company } } };
  const profiles = h.load('app/api/category-profiles/route.ts'), settings = h.load('app/api/settings/route.ts');
  let schemaReads = 0, excelReads = 0, ack;
  const request = async (path, init) => {
    if (path === '/api/settings') return settings.GET();
    assert.equal(path.split('?')[0], '/api/category-profiles');
    const response = await profiles[init?.method ?? 'GET'](new Request('https://app.test' + path, init));
    if (ack && init?.method === 'POST' && response.ok) {
      const body = await response.json(); ack(body.profile); return Response.json(body, { status: response.status });
    }
    return response;
  };
  const picker = categoryPickerUI(request, { workspaceOwnerId: 'owner', catalog: {
    loadLiveHubCategorySchema: async () => { schemaReads++; return snapshot; },
    loadLiveHubCategoryTemplate: async () => { excelReads++; throw Error('Optional Excel unavailable in this fixture'); },
  } });
  const retained = () => JSON.stringify(Object.fromEntries(['products', 'product_options', 'product_content', 'product_quotation_fields', 'collection_context', 'collection_results', 'workspace_settings']
    .map(table => [table, h.sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()])));
  return { h, snapshot, choice, picker, request, retained, get schemaReads() { return schemaReads; }, get excelReads() { return excelReads; },
    setAck(fn) { ack = fn; }, close() { picker.close(); h.close(); } };
}

for (const company of schemaCompanies) test(`Single-only category opens URL intake and saved stage-seven form without Excel (${company.code})`, async () => {
  const f = setup(company);
  try {
    // Existing work and a separately saved member setting must survive the new
    // category choice. New source data uses only the captured member setting.
    await f.h.intake();
    const oldProduct = f.h.sqlite.prepare('SELECT * FROM products').get();
    const oldWork = () => JSON.stringify({ product: f.h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(oldProduct.id),
      content: f.h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(oldProduct.id),
      options: f.h.sqlite.prepare('SELECT * FROM product_options WHERE product_id=?').get(oldProduct.id) });
    const retainedWork = oldWork();
    const memberSettings = { ...f.h.settings, brand: company.name, manufacturer: company.name + ' 합성 제조사' };
    await f.h.load('db/queries.ts').saveSettings('owner', JSON.stringify(memberSettings));
    const before = f.retained(), retainedObjects = JSON.stringify([...f.h.objects]), retainedNetwork = [...f.h.network];
    await f.picker.chooseLive(f.choice);
    assert.equal(f.picker.selected.length, 1, JSON.stringify(f.picker.alerts()));
    const selected = f.picker.selected[0];
    assert.equal(selected.template, null); assert.deepEqual(selected.mappings, []);
    assert.deepEqual(selected.hubSchema.company, company); assert.equal(selected.hubSchema.schemaString, f.snapshot.schemaString);
    assert.equal(f.excelReads, 0); assert.equal(f.schemaReads, 1);
    assert.equal(f.retained(), before, 'selection must not rewrite products, settings or captured source');
    assert.equal(JSON.stringify([...f.h.objects]), retainedObjects, 'Single selection must not upload a workbook or alter the existing images');
    f.h.bindings.AI.run = async (model, input) => {
      assert.equal(model, f.h.bindings.SOURCEFLOW_TEXT_MODEL);
      const source = JSON.parse(input.messages[1].content); f.h.aiSources.push(source);
      return { response: { title: '합성 수납함', description: '합성 상품 설명', keywords: ['수납함'], warnings: [],
        attributes: source.attributes.map((pair, sourceIndex) => ({ sourceIndex, name: pair.name, value: pair.value === '黑色' ? '검정' : pair.value })) } };
    };
    const url = 'https://detail.1688.com/offer/654000000001.html';
    const queue = await json(await f.h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ urls: [url], goal: 'price', profileId: selected.id,
        expectedProfileRevision: selected.revision, expectedSettings: memberSettings, features: '합성 특징', keywords: '합성 태그' }) })), 200);
    const job = queue.jobs[0];
    assert.deepEqual(job.context.company, company); assert.deepEqual(job.context.settings, memberSettings);
    assert.equal(job.context.category.template, null); assert.equal(job.context.category.hubSchema.schemaString, f.snapshot.schemaString);
    await json(await f.h.route(`/api/collection-jobs/${job.id}/result`, { method: 'POST', body: { schemaVersion: 1, sourceUrl: url,
      provider: 'synthetic-single-category-654', collectedAt: new Date().toISOString(), title: '合成收纳盒', description: '合成商品说明',
      options: [{ sku: '654001', name: '黑色', color: '검정', unitPriceCny: 2.99, minimumOrder: 1, stock: 10 }], images: [], attributes: [] } }));
    const created = await json(await f.h.route(`/api/collection-jobs/${job.id}/product`, { method: 'POST' }));
    const seo = await f.h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(created.productId,
      (path, init) => f.h.route(path, { method: init?.method ?? 'GET', body: init?.body }), new AbortController().signal);
    assert.equal(seo.completed, true, seo.message);
    const base = '/api/products/' + created.productId;
    const view = await json(await f.h.route(base + '/quotation-fields'));
    assert.equal(view.categoryContext.profileId, selected.id); assert.equal(view.resolved.schema.categoryId, selected.categoryId);
    assert.equal(view.resolved.schema.status, 'observed'); assert.equal(view.resolved.rows.filter(row => row.included).length, 1);
    const saved = await f.h.load('app/exports/quotation-source.ts').readQuotationExportSource('owner', created.productId, null);
    assert.equal(Object.hasOwn(saved, 'template'), false); assert.deepEqual(plain(saved.company), company); assert.equal(saved.hubSchema.schemaString, f.snapshot.schemaString);
    const projection = await f.h.load('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument({ snapshot: saved.hubSchema,
      company, categoryId: selected.categoryId, categoryPath: selected.categoryPath, resolved: f.h.load('app/exports/quotation-source.ts').resolveQuotationExport(saved) });
    assert.equal(projection.payload.scope, 'Retail_Categorized_Single'); assert.equal(projection.payload.displayCategoryCode, '991234');
    assert.equal(projection.payload.categoryId, 3000); assert.equal(projection.payload.jsonDocument.length, 1);
    assert.equal(projection.registered, false); assert.equal(projection.remoteWrites, false); assert.equal(projection.submissionReady, false);
    assert.equal(oldWork(), retainedWork); assert.equal(f.excelReads, 0); assert.deepEqual(f.h.network, retainedNetwork);
    assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM supplier_hub_receipts').get().n, 0);
  } finally { f.close(); }
});

for (const company of schemaCompanies) test(`reselecting a verified Single-only profile reuses its exact definition (${company.code})`, async () => {
  const f = setup(company);
  try {
    await f.picker.chooseLive(f.choice); const selected = f.picker.selected[0]; assert.ok(selected, JSON.stringify(f.picker.alerts()));
    const before = JSON.stringify(f.h.sqlite.prepare('SELECT * FROM category_profiles').all());
    f.picker.reopen(); await f.picker.chooseLive(f.choice);
    assert.equal(f.picker.selected.length, 2); assert.equal(f.picker.selected[1].id, selected.id);
    assert.equal(f.picker.selected[1].revision, selected.revision); assert.equal(f.excelReads, 0);
    assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM category_profiles').all()), before);
    assert.equal(f.picker.calls.filter(call => call.method === 'POST').length, 1);
  } finally { f.close(); }
});

test('requesting Excel is explicit and its failure preserves the Single leaf for a normal retry', async () => {
  const f = setup(schemaCompanies[0]);
  try {
    f.picker.chooseConnection(true); const before = f.retained(); await f.picker.chooseLive(f.choice);
    assert.equal(f.picker.selected.length, 0); assert.equal(f.excelReads, 1); assert.equal(f.retained(), before);
    assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM category_profiles').get().n, 0);
    assert.match(f.picker.alerts().join(' '), /Optional Excel unavailable/);
    f.picker.chooseConnection(false); await f.picker.confirm();
    assert.equal(f.picker.selected.length, 1, JSON.stringify(f.picker.alerts())); assert.equal(f.picker.selected[0].template, null);
    assert.equal(f.excelReads, 1, 'returning to normal intake must not retry the failed workbook');
  } finally { f.close(); }
});

test('wrong company, code, path or missing Single schema never becomes a code-only profile', async () => {
  for (const corrupt of [snapshot => { snapshot.company = schemaCompanies[1]; }, snapshot => { snapshot.categoryId = '991235'; },
    snapshot => { snapshot.categoryPath = ['다른 분류']; }, snapshot => { snapshot.schemaString = '{}'; }]) {
    const f = setup(schemaCompanies[0]);
    try {
      corrupt(f.snapshot); const before = f.retained(); await f.picker.chooseLive(f.choice);
      assert.equal(f.picker.selected.length, 0); assert.ok(f.picker.alerts().length); assert.equal(f.retained(), before);
      assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM category_profiles').get().n, 0); assert.equal(f.excelReads, 0);
    } finally { f.close(); }
  }
});

for (const scope of ['Retail_Categorized_Excel', null]) test(`normal live intake rejects ${scope ?? 'missing'} form scope before saving a profile`, async () => {
  const f = setup(schemaCompanies[0]);
  try {
    const raw = JSON.parse(f.snapshot.schemaString);
    if (scope === null) { delete f.snapshot.metadata.scopeType; delete raw.metadata; }
    else { f.snapshot.metadata.scopeType = scope; raw.metadata = raw.metadata.replace('Retail_Categorized_Single', scope); }
    f.snapshot.schemaString = JSON.stringify(raw);
    const before = f.retained(); await f.picker.chooseLive(f.choice);
    assert.equal(f.picker.selected.length, 0); assert.match(f.picker.alerts().join(' '), /Single scope/);
    assert.equal(f.picker.calls.some(call => call.method !== 'GET'), false);
    assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM category_profiles').get().n, 0);
    assert.equal(f.retained(), before); assert.equal(f.excelReads, 0);
  } finally { f.close(); }
});

test('a successful create ACK must preserve exactly the requested Single form and absence of a workbook', async () => {
  for (const corrupt of [profile => { delete profile.hubSchema; }, profile => { profile.hubSchema.metadata.version++; },
    profile => { profile.template = { name: 'unrequested.xlsx' }; }, profile => { profile.mappings = [{ column: 0, field: 'constant', constant: 'wrong' }]; }]) {
    const f = setup(schemaCompanies[0]);
    try {
      f.setAck(corrupt); await f.picker.chooseLive(f.choice);
      assert.equal(f.picker.selected.length, 0); assert.ok(f.picker.alerts().length); assert.equal(f.excelReads, 0);
      assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM products').get().n, 0);
    } finally { f.close(); }
  }
});

test('a committed Single profile reply arriving after picker close never opens URL intake', async () => {
  const f = setup(schemaCompanies[0]);
  try {
    let release, signal;
    const ui = categoryPickerUI(async (path, init) => { const response = await f.request(path, init);
      if (init?.method === 'POST' && response.ok) { signal = init.signal; await new Promise(resolve => { release = resolve; }); } return response;
    }, { workspaceOwnerId: 'owner', catalog: { loadLiveHubCategorySchema: async () => f.snapshot,
      loadLiveHubCategoryTemplate: async () => assert.fail('late Single creation must never request Excel') } });
    nodes(ui.render()).find(node => node.type?.name === 'SupplierHubCategoryBrowser').props.onChoice(f.choice);
    await waitFor(() => Boolean(release)); ui.close(); assert.equal(signal.aborted, true); release();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(ui.selected.length, 0); assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM category_profiles').get().n, 1);
    assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM products').get().n, 0);
    assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM collection_jobs').get().n, 1, 'only the original inert fixture job exists');
  } finally { f.close(); }
});
