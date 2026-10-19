import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { schemaCompanies } from './helpers/hub-schema.mjs';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

// The queue uses real settings, primary-wire and batch-slot validators. Only
// transport is synthetic; no source service, OCR, provider or upload is called.
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const exports = {}; modules.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Error, Date, URL, URLSearchParams, AbortController, AbortSignal, structuredClone,
    fetch() { throw Error('External fetch is forbidden in this fixture'); },
    require(name) {
      if (['@/app/quotation-schema', '@/app/free-image-translation-client'].includes(name)) return {};
      assert.ok(name.startsWith('@/'), name); return load(name.slice(2) + '.ts');
    } });
  return exports;
}
const model = load('app/batch-image-work.ts'), settingsModule = load('app/workspace-settings.ts');
const plain = value => JSON.parse(JSON.stringify(value)), signal = () => new AbortController().signal;
const version = '2026-10-19T02:00:00.000Z';
const cell = (value, source = 'manual-option') => ({ value, source, needsReview: false, issues: [] });
const ids = ['mainImage', 'additionalImages', 'detailImages', 'detailHtml'];
function view({ profileId = 'cat', rows } = {}) {
  const fields = ids.map(id => ({ id, section: 'image', label: id, type: id === 'detailHtml' ? 'textarea' : 'images', required: false, visibility: 'common', maxItems: id === 'mainImage' ? 1 : 30 }));
  fields.push({ id: 'wireMain', section: 'image', label: '현재 대표', type: 'images', required: false, visibility: 'common', maxItems: 1,
    hubInput: 'mainImage', hubWire: { path: ['imagePage', 'images', 'mainImage'] } });
  const included = rows ?? [
    { optionId: 'second', optionLabel: '두 번째 옵션', included: true, fields: { mainImage: cell('owner/main.png'), wireMain: cell('owner/main.png'), additionalImages: cell('owner/add.png'), detailImages: cell('owner/top.png\nowner/detail.png\nowner/bottom.png'), detailHtml: cell('<p>수동 HTML 유지</p>') } },
    { optionId: 'first', optionLabel: '첫 번째 옵션', included: true, fields: { mainImage: cell(''), wireMain: cell(''), additionalImages: cell(''), detailImages: cell('owner/top.png\nowner/bottom.png'), detailHtml: cell('') } },
    { optionId: 'excluded', optionLabel: '제외 옵션', included: false, fields: {} },
  ];
  const resolved = { schema: { version: 1, categoryId: '991234', categoryPath: ['시험', '최종분류'], status: 'observed', evidence: 'synthetic queue test', fields, submissionReady: false }, rows: included, issues: [] };
  return { revision: 2, inputFingerprint: 'a'.repeat(64), overrides: { common: {}, options: {} }, resolved, automatic: plain(resolved),
    categoryContext: { source: profileId ? 'profile' : 'collection', profileId, categoryId: '991234', categoryPath: ['시험', '최종분류'] },
    productVersion: version, contentRevision: 3, optionRevision: 4, updatedAt: version,
    imageKeys: ['owner/main.png', 'owner/add.png', 'owner/top.png', 'owner/detail.png', 'owner/bottom.png'],
    protectedDetailImageKeys: ['owner/top.png', 'owner/bottom.png'], submissionReady: false };
}
function fixture(company, { enabled = true, values = { one: view() }, settingsResponses } = {}) {
  const scope = { ownerId: company.code === 'A01526306' ? 'admin-fixture' : 'member-fixture', company: plain(company) };
  const settings = { ...settingsModule.newWorkspaceSettings, translateImages: enabled, brand: company.name };
  const initial = { settings, scope }, calls = []; let settingsReads = 0, intercept;
  const fetcher = async (url, init = {}) => {
    assert.equal(init.method, undefined, 'queue has no mutation requests'); assert.equal(init.body, undefined);
    assert.equal(init.cache, 'no-store'); assert.ok(init.signal instanceof AbortSignal); calls.push(url);
    if (intercept) { const result = await intercept(url, init); if (result !== undefined) return result; }
    if (url === '/api/settings') { const reply = settingsResponses?.[settingsReads++] ?? initial; return Response.json(reply); }
    const parsed = new URL(url, 'https://queue.test'); assert.match(parsed.pathname, /^\/api\/products\/[A-Za-z0-9_-]+\/quotation-fields$/);
    const key = parsed.pathname.split('/')[3], value = values[key];
    if (value instanceof Response) return value;
    if (!value) return Response.json({ error: '합성 상품 조회 실패' }, { status: 404 });
    return Response.json(value);
  };
  return { scope, settings, initial, calls, fetcher, values, intercept(fn) { intercept = fn; } };
}

for (const company of schemaCompanies) {
  test(`image work queue keeps stable included option/stage order, manual blanks, banners and originals (${company.code})`, async () => {
    const f = fixture(company), before = JSON.stringify(f.values);
    const plan = await model.planBatchImageWork([{ id: 'one', title: '작업 상품' }, { id: 'one', title: '작업 상품' }], signal(), f.fetcher);
    assert.equal(plan.enabled, true); assert.deepEqual(plain(plan.scope), f.scope); assert.deepEqual(plain(plan.settings), f.settings);
    assert.deepEqual(plain(plan.tasks.map(task => [task.optionId, task.stage, task.imageCount])), [['second', 'main', 1], ['second', 'additional', 1], ['second', 'detail', 1]]);
    assert.ok(plan.tasks.every(task => task.productId === 'one' && task.productTitle === '작업 상품' && task.profileId === 'cat' && task.productVersion === version));
    assert.equal(plan.messages.length, 3); assert.match(plan.messages[0].message, /빈 값/); assert.match(plan.messages[2].message, /설정 이미지만/);
    assert.equal(f.calls.filter(url => url.includes('/quotation-fields')).length, 1); assert.equal(f.calls.filter(url => url === '/api/settings').length, 2);
    assert.equal(JSON.stringify(f.values), before); assert.ok(f.calls.every(url => !/image-text|upload|transmi|automation/.test(url)));
  });
  test(`disabled saved translation does not read any quotation or start image processing (${company.code})`, async () => {
    const f = fixture(company, { enabled: false }); const plan = await model.planBatchImageWork([{ id: 'one', title: '상품' }], signal(), f.fetcher);
    assert.equal(plan.enabled, false); assert.equal(plan.tasks.length, 0); assert.deepEqual(f.calls, ['/api/settings', '/api/settings']);
    await assert.rejects(model.refreshBatchImageTask({}, plan, signal(), f.fetcher)); assert.equal(f.calls.length, 2);
  });
  test(`per-product failures remain visible while healthy rows stay queued without any writes (${company.code})`, async () => {
    const invalid = view(); invalid.inputFingerprint = 'not-proof'; const f = fixture(company, { values: { one: view(), broken: invalid, none: view({ rows: [] }) } });
    const plan = await model.planBatchImageWork([{ id: 'missing', title: '없음' }, { id: 'one', title: '정상' }, { id: 'broken', title: '잘못된 시계' }, { id: 'none', title: '제외' }], signal(), f.fetcher);
    assert.equal(plan.tasks.length, 3); assert.ok(plan.tasks.every(task => task.productId === 'one'));
    assert.match(plan.messages.find(row => row.productId === 'missing').message, /조회 실패/);
    assert.match(plan.messages.find(row => row.productId === 'broken').message, /변경|확인/);
    assert.match(plan.messages.find(row => row.productId === 'none').message, /포함된 옵션/);
  });
  test(`planning rejects missing saved settings or account identity before reading products (${company.code})`, async () => {
    for (const reply of [{ settings: null }, { settings: {} }, { settings: { ...settingsModule.newWorkspaceSettings }, scope: null }, { settings: { ...settingsModule.newWorkspaceSettings, translateImages: 'yes' }, scope: { ownerId: 'owner', company } }]) {
      const f = fixture(company, { settingsResponses: [reply] }); await assert.rejects(model.planBatchImageWork([{ id: 'one', title: '상품' }], signal(), f.fetcher));
      assert.deepEqual(f.calls, ['/api/settings']);
    }
  });
  test(`owner/company and saved setting changes during planning discard the entire queue (${company.code})`, async () => {
    for (const change of ['owner', 'company', 'settings']) {
      const f = fixture(company); const next = plain(f.initial);
      if (change === 'owner') next.scope.ownerId += '-new';
      else if (change === 'company') next.scope.company = plain(schemaCompanies.find(value => value.code !== company.code));
      else next.settings.translationPrompt = '저장한 번역 지침 변경';
      let reads = 0; f.intercept(url => url === '/api/settings' ? Response.json(reads++ ? next : f.initial) : undefined);
      await assert.rejects(model.planBatchImageWork([{ id: 'one', title: '상품' }], signal(), f.fetcher), /계정 또는 기본설정/);
    }
  });
  test(`each group refresh rechecks current scope/settings and permits acknowledged forward clocks (${company.code})`, async () => {
    const f = fixture(company), plan = await model.planBatchImageWork([{ id: 'one', title: '상품' }], signal(), f.fetcher), task = plan.tasks[2];
    const next = plain(f.values.one); next.productVersion = next.updatedAt = '2026-10-19T02:00:01.000Z'; next.revision++; next.inputFingerprint = 'b'.repeat(64); f.values.one = next;
    const start = f.calls.length, current = await model.refreshBatchImageTask(task, plan, signal(), f.fetcher);
    assert.equal(current.productVersion, next.productVersion); assert.equal(current.revision, 3);
    assert.deepEqual(f.calls.slice(start), ['/api/settings', '/api/products/one/quotation-fields?profileId=cat', '/api/settings']);
    assert.equal(plan.tasks[2].productVersion, version, 'queue evidence is not silently advanced');
  });
  test(`refresh rejects category, exclusion, image-count and backwards-clock changes (${company.code})`, async () => {
    for (const mode of ['category', 'excluded', 'imageCount', 'clock', 'profile', 'wire']) {
      const f = fixture(company), plan = await model.planBatchImageWork([{ id: 'one', title: '상품' }], signal(), f.fetcher), task = plan.tasks[0], next = plain(f.values.one);
      if (mode === 'category') { next.categoryContext.categoryId = next.resolved.schema.categoryId = '881234'; }
      else if (mode === 'excluded') next.resolved.rows[0].included = false;
      else if (mode === 'imageCount') next.resolved.rows[0].fields.mainImage.value = next.resolved.rows[0].fields.wireMain.value = '';
      else if (mode === 'clock') next.productVersion = next.updatedAt = '2026-10-19T01:59:59.000Z';
      else if (mode === 'profile') next.categoryContext.profileId = 'other';
      else next.resolved.rows[0].fields.wireMain.value = 'owner/add.png';
      f.values.one = next; await assert.rejects(model.refreshBatchImageTask(task, plan, signal(), f.fetcher));
      assert.equal(f.calls.at(-1), '/api/settings', 'scope is checked after the group read even when its document is invalid');
    }
  });
  test(`scope/settings mutation before or during refresh blocks review of another account (${company.code})`, async () => {
    for (const during of [false, true]) {
      const f = fixture(company), plan = await model.planBatchImageWork([{ id: 'one', title: '상품' }], signal(), f.fetcher), next = plain(f.initial);
      next.settings.translateImages = false; let reads = 0;
      f.intercept(url => url === '/api/settings' ? Response.json(during && reads++ === 0 ? f.initial : next) : undefined);
      const start = f.calls.length; await assert.rejects(model.refreshBatchImageTask(plan.tasks[0], plan, signal(), f.fetcher), /계정 또는 기본설정/);
      assert.equal(f.calls.slice(start).filter(url => url.includes('/quotation-fields')).length, during ? 1 : 0);
    }
  });
  test(`abort is propagated rather than converted to a per-product success or failure (${company.code})`, async () => {
    const f = fixture(company), controller = new AbortController(), reason = Error('fixture stop');
    f.intercept(url => { if (url.includes('/quotation-fields')) { controller.abort(reason); throw reason; } });
    await assert.rejects(model.planBatchImageWork([{ id: 'one', title: '상품' }, { id: 'later', title: '다음' }], controller.signal, f.fetcher), error => error === reason);
    assert.equal(f.calls.length, 2); assert.ok(!f.calls.some(url => url.includes('/later/')));
    const aborted = new AbortController(); aborted.abort(reason); const start = f.calls.length;
    await assert.rejects(model.planBatchImageWork([], aborted.signal, f.fetcher), error => error === reason); assert.equal(f.calls.length, start);
  });
  test(`queue caps unique products before reads and retains collection profile-null context (${company.code})`, async () => {
    const f = fixture(company, { values: { one: view({ profileId: null }) } });
    await assert.rejects(model.planBatchImageWork(Array.from({ length: 101 }, (_, index) => ({ id: `id${index}`, title: '상품' })), signal(), f.fetcher), /100개/); assert.equal(f.calls.length, 0);
    const plan = await model.planBatchImageWork([{ id: 'one', title: '상품' }], signal(), f.fetcher); assert.ok(plan.tasks.every(task => task.profileId === null));
    await model.refreshBatchImageTask(plan.tasks[0], plan, signal(), f.fetcher); assert.equal(f.calls.at(-2), '/api/products/one/quotation-fields');
  });
  test(`fresh and older quotation override clocks remain valid after unrelated product preparation (${company.code})`, async () => {
    for (const updatedAt of [null, '2026-10-18T02:00:00.000Z']) {
      const value = view(); value.updatedAt = updatedAt; const f = fixture(company, { values: { one: value } });
      const plan = await model.planBatchImageWork([{ id: 'one', title: '새 초안' }], signal(), f.fetcher);
      assert.equal(plan.tasks.length, 3); const current = await model.refreshBatchImageTask(plan.tasks[0], plan, signal(), f.fetcher);
      assert.equal(current.updatedAt, updatedAt); assert.equal(current.productVersion, version);
    }
  });
  test(`actual intake and content-only API edits prepare/refresh untouched quotation overrides (${company.code})`, async () => {
    const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name });
    const read = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
    try {
      const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', h.context.category, 'cat');
      assert.equal(profile.id, 'cat');
      await h.load('db/queries.ts').saveSettings('owner', JSON.stringify(h.settings));
      h.sqlite.prepare("UPDATE collection_jobs SET goal='work' WHERE id='job'").run();
      await h.intake();
      const product = h.sqlite.prepare('SELECT * FROM products').get(), base = '/api/products/' + product.id;
      const calls = [], settingsRoute = h.load('app/api/settings/route.ts');
      const fetcher = async (url, init = {}) => {
        assert.equal(init.method, undefined); assert.equal(init.body, undefined); init.signal.throwIfAborted(); calls.push(url);
        return url === '/api/settings' ? settingsRoute.GET() : h.route(url);
      };
      const snapshot = () => JSON.stringify({ product: h.sqlite.prepare('SELECT * FROM products').all(),
        content: h.sqlite.prepare('SELECT * FROM product_content').all(), options: h.sqlite.prepare('SELECT * FROM product_options').all(),
        quotation: h.sqlite.prepare('SELECT * FROM product_quotation_fields').all(), images: [...h.objects].map(([key, bytes]) => [key, Buffer.from(bytes).toString('hex')]) });
      const first = await read(await h.route(base + '/quotation-fields'));
      assert.equal(first.revision, 0); assert.equal(first.updatedAt, null); assert.equal(first.categoryContext.source, 'collection'); assert.equal(first.categoryContext.profileId, 'cat');
      const before = snapshot(), plan = await model.planBatchImageWork([{ id: product.id, title: product.title }], signal(), fetcher);
      assert.ok(plan.tasks.length > 0, JSON.stringify(plan.messages)); assert.ok(plan.tasks.every(task => task.profileId === null && task.categoryContext.profileId === 'cat'));
      for (const task of plan.tasks) { const current = await model.refreshBatchImageTask(task, plan, signal(), fetcher); assert.equal(current.updatedAt, null); }
      assert.equal(snapshot(), before, 'actual plan+refresh performs no data writes'); assert.ok(calls.every(url => !url.includes('?profileId=')), 'captured category is not silently switched to the current profile');
      const content = (await read(await h.route(base + '/content'))).content;
      await read(await h.route(base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision, patch: { detail: { description: '검토자가 작성한 설명은 유지합니다.' } } } }));
      const edited = await read(await h.route(base + '/quotation-fields')); assert.equal(edited.revision, 0); assert.equal(edited.updatedAt, null); assert.ok(Date.parse(edited.productVersion) > Date.parse(first.productVersion));
      const editedBefore = snapshot(), editedPlan = await model.planBatchImageWork([{ id: product.id, title: product.title }], signal(), fetcher);
      assert.equal(editedPlan.tasks.length, plan.tasks.length); for (const task of editedPlan.tasks) {
        const current = await model.refreshBatchImageTask(task, editedPlan, signal(), fetcher); assert.equal(current.productVersion, edited.productVersion); assert.equal(current.contentRevision, edited.contentRevision);
      }
      const advanced = await model.refreshBatchImageTask(plan.tasks[0], plan, signal(), fetcher); assert.equal(advanced.productVersion, edited.productVersion, 'new group reads the current document');
      assert.equal(snapshot(), editedBefore); assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status, '미전송');
    } finally { h.close(); }
  });
}
