import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const native = createRequire(import.meta.url), companies = [{ code: 'A01464742', name: '와이홉' }, { code: 'A01526306', name: '유앤채' }];
const sha = value => createHash('sha256').update(value).digest('hex');
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null ? '' : String(tree);
const payload = (h, table) => JSON.parse(h.sqlite.prepare('SELECT payload FROM ' + table).get().payload);
const state = h => JSON.stringify(['products', 'product_content', 'product_options', 'product_price_policy', 'product_quotation_fields'].map(table => h.sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()));
const sourceState = h => JSON.stringify(['collection_results', 'collection_context', 'workspace_settings', 'category_profiles'].map(table => h.sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()));
const objectState = h => JSON.stringify([...h.objects].map(([key, bytes]) => [key, sha(bytes)]));
const proof = [], sourceFiles = ['app/intake-seo.ts', 'app/intake-collection.ts', 'app/intake-queue.ts', 'app/components/intake-queue-panel.tsx', 'app/components/translation-panel.tsx', 'tests/helpers/mobile-intake.mjs', 'tests/intake-approval-draft-flow.test.mjs'];
const hashes = () => Object.fromEntries(sourceFiles.map(file => [file, sha(fs.readFileSync(new URL('../' + file, import.meta.url)))])), frozen = hashes();
after(() => {
  assert.deepEqual(hashes(), frozen, 'source changed during this focused run');
  if (proof.length) fs.writeFileSync(new URL('../outputs/step700-approval-api-proof.json', import.meta.url), JSON.stringify({ format: 'intake-approval-draft-proof-v1', sourceHashes: frozen, cases: proof,
    boundary: 'Actual IntakeQueuePanel and TranslationPanel callbacks, actual category/intake/product/content/options/translation/quotation handlers, in-memory SQLite and fixture R2 bytes. Supplier/auth/React hooks are isolated. No paid request executes.',
    externalRequests: 0, browserActions: 0, productionWrites: 0, supplierHubWrites: 0 }, null, 2) + '\n');
});

function component(h, file, props, fetcher, exportName) {
  const slots = [], effects = [], layouts = [], storage = new Map(); let cursor = 0, mounted = true;
  const effect = (queue, fn, deps) => { const index = cursor++, old = slots[index]; if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps?.[i]))) {
    slots[index] = { deps, cleanup: old?.cleanup }; queue.push(() => { old?.cleanup?.(); slots[index].cleanup = fn(); }); } };
  const hooks = { useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], value => { if (mounted) slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
  useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
  useEffect(fn, deps) { effect(effects, fn, deps); }, useLayoutEffect(fn, deps) { effect(layouts, fn, deps); },
  useCallback(fn, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) slots[index] = { deps, fn }; return slots[index].fn; } };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { exports, Error, AbortController, crypto, fetch: fetcher, sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    require(name) { if (name === 'react') return hooks; if (name.startsWith('@/app/components/')) return new Proxy({}, { get: () => () => null }); return name.startsWith('@/') ? h.load(name.slice(2) + '.ts') : native(name); } });
  function render() { cursor = 0; let tree = exports[exportName ?? 'default'](props()); if (typeof tree.type === 'function') tree = tree.type(tree.props);
    layouts.splice(0).forEach(fn => fn()); effects.splice(0).forEach(fn => fn()); return tree; }
  async function idle() { for (let i = 0; i < 16; i++) { render(); await new Promise(done => setImmediate(done)); } render(); }
  return { render, idle, button(label) { const button = nodes(render()).find(node => node.type === 'button' && text(node).includes(label)); assert.ok(button, label); return button; },
    async click(label) { const button = this.button(label); assert.equal(button.props.disabled, false, label); button.props.onClick(); await idle(); },
    close() { mounted = false; slots.forEach(slot => slot?.cleanup?.()); } };
}

async function fixture(company, goal) {
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name }); let ui;
  try {
    h.bindings.SOURCEFLOW_TEXT_PROVIDER = 'openai'; h.bindings.SOURCEFLOW_TEXT_MODEL = 'gpt-4.1-mini'; h.bindings.OPENAI_API_KEY = 'local-fixture-not-sent';
    const categoryPath = ['패션의류잡화', '유니섹스/남녀공용 패션', '공용 잡화', '선글라스', '남녀공용패션선글라스'];
    const hubSchema = { format: 'supplier-hub-schema-v1', categoryId: '69900', categoryPath, company, observedAt: Date.now(), inputBindings: 'couplus-paths-v1', settingsInitialization: 'couplus-options-v1',
      draftInitialization: 'couplus-required-v1', metadata: { displayCategoryCode: '69900', kanCategoryId: 2624, scopeType: 'Retail_Categorized_Single', noticeNumber: 4, version: 188 },
      schemaString: JSON.stringify({ type: 'object', properties: { startPage: { type: 'object', properties: { productName: { type: 'string', title: '상품명' } } }, productPage: { type: 'object', properties: { brand: { type: 'string', title: '브랜드' } } }, legalPage: { type: 'object', properties: {} } } }) };
    const profile = (await json(await h.load('app/api/category-profiles/route.ts').POST(new Request('https://app.test/api/category-profiles', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '선글라스 승인 대기 시험', categoryId: '69900', categoryPath, hubSchema, template: null, mappings: [] }) })), 201)).profile;
    // Let the actual queue endpoint create the normal UUID request and frozen
    // category/settings context; the helper's unstarted seed has id='job'.
    h.sqlite.prepare("DELETE FROM collection_context WHERE job_id='job'").run(); h.sqlite.prepare("DELETE FROM collection_jobs WHERE id='job'").run();
    await h.load('db/queries.ts').saveSettings('owner', JSON.stringify(h.settings));
    // A separate owner's retained product/settings are never part of this intake.
    const date = new Date().toISOString(); h.sqlite.prepare('INSERT INTO products(id,owner_id,source_url,title,source_price_cny,exchange_rate,supply_margin,coupang_margin,supply_price,sale_price,msrp,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('other-company-product', 'other-owner', 'https://detail.1688.com/offer/700000000001.html', '다른 회사 저장 상품', 7, 350, 50, 40, 4900, 8170, 10620, date, date);
    await h.load('db/queries.ts').saveSettings('other-owner', JSON.stringify({ ...h.settings, brand: '다른 회사 고유 설정' }));
    const product = () => h.sqlite.prepare("SELECT * FROM products WHERE owner_id='owner'").get();
    const calls = [], opened = [], busy = []; let rows = [{ ...h.load('app/intake-queue.ts').intakeRow(profile, 'row'), url: h.sourceUrl, keywords: h.context.keywords }], jobs = [], intercept = null;
    const direct = (path, init = {}) => path === '/api/collection-jobs' ? h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test' + path, init)) : h.route(path, { method: init.method ?? 'GET', body: init.body });
    const fetcher = async (path, init = {}) => { calls.push({ path, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : null });
      if (intercept) { const response = await intercept(path, init); if (response) return response; } return direct(path, init); };
    ui = component(h, 'app/components/intake-queue-panel.tsx', () => ({ rows, jobs, settings: h.settings, profiles: [profile], workspaceOwnerId: 'owner', goal, onGoal() {}, onSettingsReloaded() {},
      onRows: update => rows = update(rows), onProfile() {}, onAdvanced() {}, onJobs: values => jobs = values, onBusy: value => busy.push(value), onOpenProduct: async (id, signal) => {
        assert.equal(signal.aborted, false); const current = await json(await h.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test/api/products/' + id), { params: Promise.resolve({ id }) }));
        const content = await json(await h.route('/api/products/' + id + '/content')), options = await json(await h.route('/api/products/' + id + '/options')), quotation = await json(await h.route('/api/products/' + id + '/quotation-fields'));
        opened.push({ product: current.product, content: content.content, options: options.options, quotation }); } }), fetcher, 'IntakeQueuePanel');
    async function start() { const button = ui.button('시작 ('); assert.equal(button.props.disabled, false); button.props.onClick(); const deadline = Date.now() + 20000;
      while (busy.at(-1) !== false) { ui.render(); assert.ok(Date.now() < deadline, 'intake did not settle'); await new Promise(done => setTimeout(done, 1)); } await ui.idle(); }
    return { h, ui, product, calls, opened, direct, fetcher, start, profile, get rows() { return rows; }, set intercept(value) { intercept = value; },
      retry() { rows = rows.map(row => ({ ...row, status: 'draft', message: '', productId: undefined })); }, close() { ui.close(); h.close(); } };
  } catch (error) { ui?.close(); h.close(); throw error; }
}

for (const [index, company] of companies.entries()) test(`prepared OpenAI intake opens an editable approval-waiting draft without executing, and preserves edits on replay (${company.code})`, async () => {
  const goal = index ? 'work' : 'price', f = await fixture(company, goal), { h } = f; let review;
  try {
    await f.start(); assert.equal(f.rows[0].status, 'saved'); assert.match(f.rows[0].message, /승인/); assert.doesNotMatch(f.rows[0].message, /생성해 반영|번역 완료|전송 완료/);
    assert.equal(f.opened.length, 1); assert.equal(f.opened[0].product.id, f.product().id); assert.equal(f.opened[0].options.rows.length, 6); assert.equal(h.objects.size, 19);
    assert.equal(f.opened[0].quotation.resolved.schema.categoryId, '69900'); assert.equal(f.opened[0].quotation.categoryContext.profileId, f.profile.id);
    assert.equal(f.product().supplier_hub_status, '미전송'); assert.equal(payload(h, 'product_content').assets.main.value.length, goal === 'work' ? 1 : 0);
    const base = '/api/products/' + f.product().id, initial = (await json(await h.route(base + '/translation'))).jobs[0];
    assert.equal(initial.status, 'prepared'); assert.equal(initial.startedAt, null); assert.equal(initial.result, null); assert.equal(initial.error, null);
    assert.notEqual(initial.productVersion, f.product().updated_at, 'image saving advances the product version after preparing the request');
    const immutable = sourceState(h), immutableSha = sha(immutable), original = h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(initial.id), before = state(h), files = objectState(h);
    // Actual reopened history must refresh/re-prepare and still require explicit approval.
    review = component(h, 'app/components/translation-panel.tsx', () => ({ productId: f.product().id, version: f.product().updated_at, title: f.product().title }), f.fetcher);
    await review.idle(); assert.match(text(review.render()), /새 실행에는 새 검토 요청이 필요/); assert.equal(review.button('SEO 초안 작성').props.disabled, true);
    await review.click('작업 상태 다시 조회'); assert.equal(review.button('SEO 초안 작성').props.disabled, true);
    await review.click('현재 상품 원문으로 SEO 요청 다시 준비');
    const refreshed = (await json(await h.route(base + '/translation'))).jobs[0]; assert.notEqual(refreshed.id, initial.id); assert.equal(refreshed.status, 'prepared'); assert.equal(refreshed.productVersion, f.product().updated_at);
    assert.doesNotMatch(text(review.render()), /새 실행에는 새 검토 요청이 필요/); assert.equal(review.button('SEO 초안 작성').props.disabled, true, 'current source still requires a fresh explicit approval');
    const approval = nodes(review.render()).find(node => node.type === 'label' && /검토하고 승인/.test(text(node))); assert.ok(approval);
    const check = nodes(approval).find(node => node.type === 'input'); assert.equal(check.props.checked, false); assert.equal(check.props.disabled, false);
    assert.equal(state(h), before); assert.equal(objectState(h), files); assert.deepEqual(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(initial.id), original); review.close(); review = null;
    // Re-queue the same saved source after genuine user edits, including blanks.
    const content = payload(h, 'product_content'), options = payload(h, 'product_options');
    await json(await h.route(base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision, patch: { seo: { title: '', description: '직접 검토한 설명', keywords: [] }, label: { material: '' }, labelClears: ['material'], assets: { main: [], additional: [], detail: [] } } } }));
    const input = h.load('app/product-options.ts').optionInputs(options); input[0].included = false; input[1].translatedName = '직접 입력한 옵션'; input[1].color = ''; input[1].imageKey = null;
    await json(await h.route(base + '/options', { method: 'PATCH', body: { expectedRevision: options.revision, expectedProductVersion: f.product().updated_at, rows: input } }));
    const manual = state(h), downloads = h.stats.downloads; f.retry(); await f.start();
    assert.equal(f.rows[0].status, 'saved'); assert.equal(f.opened.length, 2); assert.equal(state(h), manual); assert.equal(sourceState(h), immutable); assert.equal(objectState(h), files); assert.equal(h.stats.downloads, downloads);
    assert.equal(f.opened[1].content.seo.title.value, ''); assert.equal(f.opened[1].content.seo.title.provenance, 'manual'); assert.deepEqual(f.opened[1].content.seo.keywords.value, []);
    assert.equal(f.opened[1].options.rows[0].included, false); assert.equal(f.opened[1].options.rows[1].imageKey, null); assert.deepEqual(f.opened[1].content.assets.main.value, []);
    const jobsBefore = h.sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n; f.retry(); await f.start();
    assert.equal(f.rows[0].status, 'saved'); assert.equal(f.opened.length, 3); assert.equal(h.sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n, jobsBefore, 'unchanged preparation is reused');
    assert.equal(state(h), manual); assert.equal(sourceState(h), immutable); assert.equal(objectState(h), files);
    assert.equal(f.calls.filter(call => ['execute', 'approve'].includes(call.body?.action)).length, 0); assert.equal(f.calls.filter(call => call.path.endsWith('/translation-apply')).length, 0); assert.equal(h.aiSources.length, 0);
    assert.equal(h.sqlite.prepare("SELECT count(*) n FROM products WHERE owner_id='owner'").get().n, 1); assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_jobs').get().n, 1);
    proof.push({ company, goal, queueStatus: f.rows[0].status, initialJobStatus: initial.status, sourceOptions: 6, savedImages: h.objects.size, autoOpens: f.opened.length,
      oldVersionCannotExecute: true, explicitCurrentReviewRequired: true, originalJobPreserved: true, unchangedReplayPreparedJobs: jobsBefore, manualStateBeforeSha256: sha(manual), manualStateAfterSha256: sha(state(h)),
      sourceBeforeSha256: immutableSha, sourceAfterSha256: sha(sourceState(h)), imagesBeforeSha256: sha(files), imagesAfterSha256: sha(objectState(h)), executeRequests: 0, applyRequests: 0 });
  } finally { review?.close(); f.close(); }
});

test('malformed, mismatched and unacknowledged preparation never becomes a saved queue result or executes a request', async () => {
  const f = await fixture(companies[0], 'price'), { h } = f;
  try {
    await f.start(); assert.equal(f.rows[0].status, 'saved'); const saved = state(h), immutable = sourceState(h), files = objectState(h), modes = ['foreign-product', 'running', 'malformed-review', 'http-failure', 'lost-ack'];
    for (const mode of modes) {
      f.intercept = async (path, init) => { if (!path.endsWith('/translation') || init.method !== 'POST') return null;
        const response = await f.direct(path, init), body = await response.json();
        if (mode === 'lost-ack') throw Error('fixture preparation acknowledgement lost');
        if (mode === 'http-failure') return Response.json({ error: 'fixture preparation acknowledgement failed' }, { status: 503 });
        if (mode === 'foreign-product') body.job.productId = 'other-company-product';
        if (mode === 'running') body.job.status = 'running';
        if (mode === 'malformed-review') body.job.review.fingerprint = 'not-a-fingerprint';
        return Response.json(body, { status: response.status }); };
      f.retry(); await f.start(); assert.equal(f.rows[0].status, 'error', mode); assert.equal(f.opened.length, 1, mode); assert.equal(f.ui.button('1~7단계 확인·수정').props.disabled, false, mode);
      assert.equal(state(h), saved, mode); assert.equal(sourceState(h), immutable, mode); assert.equal(objectState(h), files, mode);
    }
    f.intercept = null; f.retry(); await f.start(); assert.equal(f.rows[0].status, 'saved'); assert.equal(f.opened.length, 2); assert.equal(state(h), saved);
    assert.equal(f.calls.filter(call => ['execute', 'approve', 'apply'].includes(call.body?.action)).length, 0);
    proof.push({ name: 'preparation acknowledgement guards', modes, rejectedQueueOutcomes: modes.length, recoveredAutoOpens: 1, productStateBeforeSha256: sha(saved), productStateAfterSha256: sha(state(h)), executeRequests: 0, applyRequests: 0 });
  } finally { f.close(); }
});

test('real image import failure retains its product and recovery action before approval-waiting intake may auto-open', async () => {
  const f = await fixture(companies[1], 'work'), { h } = f;
  try {
    h.stats.failImageIndex = 4; await f.start(); assert.equal(f.rows[0].status, 'error'); assert.equal(f.opened.length, 0); assert.ok(f.product()); assert.equal(h.objects.size, 18);
    assert.equal(h.sqlite.prepare('SELECT status FROM translation_jobs').get().status, 'prepared'); const id = f.product().id, immutable = sourceState(h);
    assert.equal(f.ui.button('1~7단계 확인·수정').props.disabled, false); await f.ui.click('1~7단계 확인·수정'); assert.equal(f.opened.length, 1); assert.equal(f.opened[0].product.id, id);
    h.stats.failImageIndex = null; f.retry(); await f.start(); assert.equal(f.rows[0].status, 'saved'); assert.equal(f.opened.length, 2); assert.equal(f.product().id, id); assert.equal(h.objects.size, 19);
    assert.equal(payload(h, 'product_content').assets.main.value.length, 1); assert.equal(sourceState(h), immutable); assert.equal(f.product().supplier_hub_status, '미전송');
    const before = state(h), files = objectState(h), downloads = h.stats.downloads; f.retry(); await f.start(); assert.equal(f.rows[0].status, 'saved'); assert.equal(state(h), before); assert.equal(objectState(h), files); assert.equal(h.stats.downloads, downloads);
    assert.equal(f.calls.filter(call => ['execute', 'approve', 'apply'].includes(call.body?.action)).length, 0);
    proof.push({ name: 'real image failure and recovery', company: companies[1], firstQueueStatus: 'error', savedImagesBeforeRecovery: 18, savedImagesAfterRecovery: 19, sameProduct: true,
      explicitRecoveryOpened: true, recoveredQueueStatus: 'saved', sourceBeforeSha256: sha(immutable), sourceAfterSha256: sha(sourceState(h)), executeRequests: 0, applyRequests: 0 });
  } finally { f.close(); }
});
