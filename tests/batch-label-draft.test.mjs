import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { schemaCompanies } from './helpers/hub-schema.mjs';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

// Real label/settings validators with a deterministic transport. No model,
// provider, OCR, uploads or live product is reachable through this fixture.
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file); const exports = {}; cache.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Error, Date, URL, URLSearchParams, AbortController, AbortSignal, structuredClone,
    fetch() { throw Error('External network forbidden'); }, require(name) {
      if (name === '@/app/quotation-schema') return {};
      assert.ok(name.startsWith('@/'), name); return load(name.slice(2) + '.ts');
    } }); return exports;
}
const model = load('app/batch-label-draft.ts'), settingsModule = load('app/workspace-settings.ts');
const fields = load('app/product-label.ts').productLabelFields.map(field => field.key);
const plain = value => JSON.parse(JSON.stringify(value)), signal = () => new AbortController().signal;
const version = '2026-10-19T04:00:00.000Z';
function view({ source = 'collection', profileId = 'captured-cat', rows } = {}) {
  const values = Object.fromEntries(fields.map(key => [key, key === 'productName' ? '검토 상품' : '']));
  const makeRow = (optionId, included) => ({ optionId, optionLabel: optionId ?? '공통', included, values: { ...values }, automatic: { ...values },
    sources: Object.fromEntries(fields.map(key => [key, key === 'productName' ? 'quotation' : 'empty'])) });
  return { productId: 'one', revision: 0, inputFingerprint: 'a'.repeat(64), productVersion: version, contentRevision: 2, optionRevision: 3,
    quotationRevision: 0, quotationInputFingerprint: 'b'.repeat(64), categoryContext: { source, profileId, categoryId: '991234', categoryPath: ['시험', '최종분류'] },
    imageKeys: [], overrides: { common: {}, options: {} }, rows: rows ?? [makeRow(null, true), makeRow('second', true), makeRow('first', true), makeRow('excluded', false)], updatedAt: null };
}
function fixture(company, { translateImages = true, values = { one: view() }, settingsResponses } = {}) {
  const scope = { ownerId: company.code === 'A01526306' ? 'admin-fixture' : 'member-fixture', company: plain(company) };
  const settings = { ...settingsModule.newWorkspaceSettings, translateImages, brand: company.name }, initial = { scope, settings };
  const calls = []; let settingsReads = 0, intercept;
  const fetcher = async (url, init = {}) => {
    assert.equal(init.method, undefined); assert.equal(init.body, undefined); assert.equal(init.cache, 'no-store'); assert.ok(init.signal instanceof AbortSignal);
    calls.push(url); if (intercept) { const response = await intercept(url, init); if (response !== undefined) return response; }
    if (url === '/api/settings') return Response.json(settingsResponses?.[settingsReads++] ?? initial);
    const parsed = new URL(url, 'https://label-queue.test'); assert.match(parsed.pathname, /^\/api\/products\/[A-Za-z0-9_-]+\/product-labels$/);
    const value = values[parsed.pathname.split('/')[3]]; return value instanceof Response ? value : value ? Response.json(value) : Response.json({ error: '합성 표시사항 조회 실패' }, { status: 404 });
  };
  return { scope, settings, initial, values, calls, fetcher, intercept(fn) { intercept = fn; } };
}

for (const company of schemaCompanies) {
  test(`label review queue keeps stable included-option order, excludes common/disabled rows and never mutates (${company.code})`, async () => {
    const f = fixture(company), before = JSON.stringify(f.values);
    const plan = await model.planBatchLabelDraft([{ id: 'one', title: '등록 상품' }, { id: 'one', title: '등록 상품' }], signal(), f.fetcher);
    assert.deepEqual(plain(plan.scope), f.scope); assert.deepEqual(plain(plan.settings), f.settings);
    assert.deepEqual(plain(plan.tasks.map(task => [task.productId, task.productTitle, task.optionId, task.profileId])), [['one', '등록 상품', 'second', null], ['one', '등록 상품', 'first', null]]);
    assert.ok(plan.tasks.every(task => task.categoryContext.profileId === 'captured-cat')); assert.equal(plan.messages.length, 0);
    assert.equal(JSON.stringify(f.values), before); assert.deepEqual(f.calls, ['/api/settings', '/api/products/one/product-labels', '/api/settings']);
  });
  test(`stage-six queue remains enabled when image translation is disabled (${company.code})`, async () => {
    const f = fixture(company, { translateImages: false }), plan = await model.planBatchLabelDraft([{ id: 'one', title: '상품' }], signal(), f.fetcher);
    assert.equal(plan.tasks.length, 2); assert.equal(plan.settings.translateImages, false);
    const current = await model.refreshBatchLabelDraftTask(plan.tasks[0], plan, signal(), f.fetcher); assert.equal(current.productId, 'one');
    assert.ok(f.calls.every(url => !/product-label-draft|image-text|uploads|transmi/.test(url)));
  });
  test(`manual shared/option blanks and custom reordered structure survive planning and refresh (${company.code})`, async () => {
    const value = view(); value.structure = [{ id: 'productName', label: '제품명', required: true }, { id: 'custom_review', label: '검토 메모', required: false }, { id: 'material', label: '재질', required: false }];
    value.overrides = { common: { material: '' }, options: { second: { custom_review: '보존 메모' } } };
    for (const row of value.rows) {
      row.automatic = { productName: '검토 상품', custom_review: '', material: '원문 재질' };
      row.values = { productName: '검토 상품', custom_review: row.optionId === 'second' ? '보존 메모' : '', material: '' };
      row.sources = { productName: 'quotation', custom_review: row.optionId === 'second' ? 'manual-option' : 'empty', material: 'manual-common' };
    }
    const f = fixture(company, { values: { one: value } }), before = JSON.stringify(value), plan = await model.planBatchLabelDraft([{ id: 'one', title: '상품' }], signal(), f.fetcher);
    assert.equal(plan.tasks.length, 2); const refreshed = await model.refreshBatchLabelDraftTask(plan.tasks[0], plan, signal(), f.fetcher);
    assert.deepEqual(plain(refreshed), value); assert.equal(JSON.stringify(value), before);
  });
  test(`product failures and no included options stay visible while valid products remain queued (${company.code})`, async () => {
    const invalid = view(); invalid.inputFingerprint = 'wrong'; const none = view(); none.productId = 'none'; none.rows.forEach(row => { row.included = false; });
    const f = fixture(company, { values: { one: view(), invalid, none } }), plan = await model.planBatchLabelDraft([{ id: 'missing', title: '없음' }, { id: 'one', title: '정상' }, { id: 'invalid', title: '불일치' }, { id: 'none', title: '제외' }], signal(), f.fetcher);
    assert.equal(plan.tasks.length, 2); assert.ok(plan.tasks.every(task => task.productId === 'one'));
    assert.match(plan.messages.find(row => row.productId === 'missing').message, /조회 실패/); assert.match(plan.messages.find(row => row.productId === 'none').message, /포함된 옵션/);
    assert.ok(plan.messages.find(row => row.productId === 'invalid'));
  });
  test(`missing/invalid saved settings or owner scope stop before reading labels (${company.code})`, async () => {
    for (const reply of [{ settings: null }, { settings: {} }, { settings: { ...settingsModule.newWorkspaceSettings }, scope: null }, { settings: { ...settingsModule.newWorkspaceSettings, translateImages: 'no' }, scope: { ownerId: 'owner', company } }]) {
      const f = fixture(company, { settingsResponses: [reply] }); await assert.rejects(model.planBatchLabelDraft([{ id: 'one', title: '상품' }], signal(), f.fetcher)); assert.deepEqual(f.calls, ['/api/settings']);
    }
  });
  test(`owner/company and saved settings changes invalidate the whole planned queue (${company.code})`, async () => {
    for (const mode of ['owner', 'company', 'settings']) {
      const f = fixture(company), next = plain(f.initial); let reads = 0;
      if (mode === 'owner') next.scope.ownerId += '-changed'; else if (mode === 'company') next.scope.company = plain(schemaCompanies.find(value => value.code !== company.code)); else next.settings.manufacturer = '다른 저장값';
      f.intercept(url => url === '/api/settings' ? Response.json(reads++ ? next : f.initial) : undefined);
      await assert.rejects(model.planBatchLabelDraft([{ id: 'one', title: '상품' }], signal(), f.fetcher), /계정 또는 기본설정/);
    }
  });
  test(`refresh accepts current forward versions and original collection scope without selecting its profile (${company.code})`, async () => {
    const f = fixture(company), plan = await model.planBatchLabelDraft([{ id: 'one', title: '상품' }], signal(), f.fetcher), next = plain(f.values.one);
    next.productVersion = '2026-10-19T04:00:01.000Z'; next.updatedAt = version; next.revision = 1; next.inputFingerprint = 'c'.repeat(64); f.values.one = next;
    const start = f.calls.length, current = await model.refreshBatchLabelDraftTask(plan.tasks[0], plan, signal(), f.fetcher);
    assert.equal(current.productVersion, next.productVersion); assert.equal(current.updatedAt, version); assert.equal(plan.tasks[0].productVersion, version);
    assert.deepEqual(f.calls.slice(start), ['/api/settings', '/api/products/one/product-labels', '/api/settings']);
    const explicit = fixture(company, { values: { one: view({ source: 'profile', profileId: 'cat' }) } }), selected = await model.planBatchLabelDraft([{ id: 'one', title: '상품' }], signal(), explicit.fetcher);
    await model.refreshBatchLabelDraftTask(selected.tasks[0], selected, signal(), explicit.fetcher); assert.equal(explicit.calls.at(-2), '/api/products/one/product-labels?profileId=cat');
  });
  test(`changed product/category/option, backwards clocks and future label clocks block refresh (${company.code})`, async () => {
    for (const mode of ['product', 'category', 'excluded', 'clock', 'profile', 'duplicate', 'future', 'unknown']) {
      const f = fixture(company), plan = await model.planBatchLabelDraft([{ id: 'one', title: '상품' }], signal(), f.fetcher), next = plain(f.values.one);
      if (mode === 'product') next.productId = 'other'; else if (mode === 'category') next.categoryContext.categoryId = '881234';
      else if (mode === 'excluded') next.rows[1].included = false; else if (mode === 'clock') next.productVersion = '2026-10-19T03:59:59.000Z';
      else if (mode === 'profile') next.categoryContext.profileId = 'other'; else if (mode === 'duplicate') next.rows.push(plain(next.rows[1]));
      else if (mode === 'future') next.updatedAt = '2026-10-19T04:00:02.000Z'; else next.categoryContext.source = 'unknown';
      f.values.one = next; await assert.rejects(model.refreshBatchLabelDraftTask(plan.tasks[0], plan, signal(), f.fetcher)); assert.equal(f.calls.at(-1), '/api/settings');
    }
  });
  test(`settings/scope are rechecked before and after each label group read (${company.code})`, async () => {
    for (const after of [false, true]) {
      const f = fixture(company), plan = await model.planBatchLabelDraft([{ id: 'one', title: '상품' }], signal(), f.fetcher), next = plain(f.initial); next.scope.ownerId += '-changed'; let reads = 0;
      f.intercept(url => url === '/api/settings' ? Response.json(after && reads++ === 0 ? f.initial : next) : undefined);
      const start = f.calls.length; await assert.rejects(model.refreshBatchLabelDraftTask(plan.tasks[0], plan, signal(), f.fetcher), /계정 또는 기본설정/);
      assert.equal(f.calls.slice(start).filter(url => url.includes('/product-labels')).length, after ? 1 : 0);
    }
  });
  test(`cancellation and the 100 unique-product bound do not turn into completed review tasks (${company.code})`, async () => {
    const f = fixture(company), reason = Error('fixture stopped'), controller = new AbortController();
    f.intercept(url => { if (url.includes('/product-labels')) { controller.abort(reason); throw reason; } });
    await assert.rejects(model.planBatchLabelDraft([{ id: 'one', title: '상품' }, { id: 'later', title: '다음' }], controller.signal, f.fetcher), error => error === reason); assert.equal(f.calls.length, 2);
    const start = f.calls.length; await assert.rejects(model.planBatchLabelDraft(Array.from({ length: 101 }, (_, i) => ({ id: 'id' + i, title: '상품' })), signal(), f.fetcher), /100개/); assert.equal(f.calls.length, start);
    const aborted = new AbortController(); aborted.abort(reason); await assert.rejects(model.planBatchLabelDraft([], aborted.signal, f.fetcher), error => error === reason); assert.equal(f.calls.length, start);
  });
  test(`actual work intake and content-only API edits review untouched revision-zero label state (${company.code})`, async () => {
    const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name });
    const read = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
    try {
      await h.load('db/category-profiles.ts').createCategoryProfile('owner', h.context.category, 'cat');
      h.settings.translateImages = false; h.context.settings.translateImages = false;
      h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context), 'job');
      await h.load('db/queries.ts').saveSettings('owner', JSON.stringify(h.settings));
      h.sqlite.prepare("UPDATE collection_jobs SET goal='work' WHERE id='job'").run(); await h.intake();
      const product = h.sqlite.prepare('SELECT * FROM products').get(), base = '/api/products/' + product.id;
      const options = await read(await h.route(base + '/options')), rows = h.load('app/product-options.ts').optionInputs(options.options); rows.at(-1).included = false;
      await read(await h.route(base + '/options', { method: 'PATCH', body: { expectedRevision: options.options.revision, expectedProductVersion: options.productVersion, rows } }));
      const calls = [], settingsRoute = h.load('app/api/settings/route.ts'), fetcher = async (url, init = {}) => {
        assert.equal(init.method, undefined); assert.equal(init.body, undefined); init.signal.throwIfAborted(); calls.push(url); return url === '/api/settings' ? settingsRoute.GET() : h.route(url);
      };
      const snapshot = () => JSON.stringify({ product: h.sqlite.prepare('SELECT * FROM products').all(), content: h.sqlite.prepare('SELECT * FROM product_content').all(),
        options: h.sqlite.prepare('SELECT * FROM product_options').all(), labels: h.sqlite.prepare('SELECT * FROM product_labels').all(), quotation: h.sqlite.prepare('SELECT * FROM product_quotation_fields').all(),
        images: [...h.objects].map(([key, bytes]) => [key, Buffer.from(bytes).toString('hex')]) });
      const initial = await read(await h.route(base + '/product-labels')); assert.equal(initial.revision, 0); assert.equal(initial.updatedAt, null); assert.equal(initial.categoryContext.source, 'collection');
      const before = snapshot(), plan = await model.planBatchLabelDraft([{ id: product.id, title: product.title }], signal(), fetcher);
      assert.equal(plan.tasks.length, rows.length - 1, JSON.stringify(plan.messages)); assert.equal(plan.settings.translateImages, false);
      assert.ok(plan.tasks.every(task => task.profileId === null && task.categoryContext.profileId === 'cat' && task.optionId !== rows.at(-1).id));
      for (const task of plan.tasks) { const current = await model.refreshBatchLabelDraftTask(task, plan, signal(), fetcher); assert.equal(current.updatedAt, null); }
      assert.equal(snapshot(), before); assert.ok(calls.every(url => !url.includes('?profileId=')));
      const content = (await read(await h.route(base + '/content'))).content;
      await read(await h.route(base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision, patch: { detail: { description: '검토자가 작성한 원문 기반 설명' } } } }));
      const edited = await read(await h.route(base + '/product-labels')); assert.equal(edited.updatedAt, null); assert.equal(edited.revision, 0); assert.ok(Date.parse(edited.productVersion) > Date.parse(initial.productVersion));
      const editedBefore = snapshot(), nextPlan = await model.planBatchLabelDraft([{ id: product.id, title: product.title }], signal(), fetcher); assert.equal(nextPlan.tasks.length, plan.tasks.length);
      for (const task of nextPlan.tasks) { const current = await model.refreshBatchLabelDraftTask(task, nextPlan, signal(), fetcher); assert.equal(current.contentRevision, edited.contentRevision); }
      assert.equal((await model.refreshBatchLabelDraftTask(plan.tasks[0], plan, signal(), fetcher)).productVersion, edited.productVersion);
      assert.equal(snapshot(), editedBefore); assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status, '미전송');
      assert.ok(!calls.some(url => /draft|image-text|upload|transmit/.test(url)), 'planner never calls AI or image processing');
    } finally { h.close(); }
  });
}
