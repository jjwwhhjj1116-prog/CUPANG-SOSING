import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const companies = [{ code: 'A01464742', name: '와이홉' }, { code: 'A01526306', name: '유앤채' }];
const plain = value => JSON.parse(JSON.stringify(value)), sha = value => createHash('sha256').update(value).digest('hex');
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
const categoryPath = ['패션의류잡화', '유니섹스/남녀공용 패션', '공용 잡화', '선글라스', '남녀공용패션선글라스'];
const originalFile = new URL('../outputs/step603-official-unand-2624.xlsx', import.meta.url), profileFile = new URL('../outputs/step604-unand-profile-read.json', import.meta.url);
const officialAvailable = fs.existsSync(originalFile) && fs.existsSync(profileFile), proof = [];
const sourceFiles = ['app/api/products/[id]/translation-apply/route.ts', 'app/translation-batch-adoption.ts', 'app/seo-guidance-composition.ts',
  'app/seo-guidance-session.ts', 'app/components/seo-workspace-generator.tsx', 'app/components/intake-queue-panel.tsx', 'tests/helpers/mobile-intake.mjs'];
const hashes = () => Object.fromEntries(sourceFiles.map(file => [file, sha(fs.readFileSync(new URL('../' + file, import.meta.url)))])), frozen = hashes();
after(() => {
  assert.deepEqual(hashes(), frozen);
  if (proof.length) fs.writeFileSync(new URL('../outputs/step699-brand-api-proof.json', import.meta.url), JSON.stringify({ format: 'first-captured-brand-api-proof-v1', sourceHashes: frozen,
    officialWorkbookAvailable: officialAvailable, cases: proof, externalRequests: 0, browserActions: 0, productionWrites: 0, supplierHubWrites: 0,
    boundary: 'Actual local settings/intake/content/translation/quotation handlers and SQLite; actual SEO component callbacks with fixture authentication/providers. Recorded Unand workbook is reused for Waihop locally, never a new Hub read.' }, null, 2) + '\n');
});

/** The component reads actual API results. Only React hooks, storage and the
 * child preview are isolated; generating still prepares the real reviewed job. */
function seoUi(f) {
  const slots = [], effects = [], layouts = [], storage = new Map(), creates = [], calls = []; let cursor = 0, mounted = true;
  const sameDeps = (left, right) => Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, i) => Object.is(value, right[i]));
  const effect = (queue, fn, deps) => { const i = cursor++, old = slots[i]; if (!old || !sameDeps(deps, old.deps)) {
    slots[i] = { deps, cleanup: old?.cleanup }; queue.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } };
  const hooks = { useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
    return [slots[i], value => { if (mounted) slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
    useMemo(fn, deps) { const i = cursor++, old = slots[i]; if (!old || !sameDeps(deps, old.deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) { effect(effects, fn, deps); }, useLayoutEffect(fn, deps) { effect(layouts, fn, deps); } };
  const helper = f.h.load('app/seo-workspace-draft.ts'), exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/seo-workspace-generator.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { exports, AbortController, structuredClone, sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    fetch: async (url, init = {}) => { calls.push({ url, method: init.method ?? 'GET' }); return f.fetcher(url, init); }, require(name) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
      if (name.endsWith('.css')) return {};
      if (name === '@/app/components/translation-integrated-preview') return { TranslationIntegratedPreview: () => null };
      if (name === '@/app/seo-workspace-draft') return { ...helper, createSeoWorkspaceDraftState(input) { creates.push(plain(input)); return helper.createSeoWorkspaceDraftState(input); } };
      assert.ok(name.startsWith('@/')); return f.h.load(name.slice(2) + '.ts');
    } });
  const render = () => { cursor = 0; const product = f.product(), outer = exports.SeoWorkspaceGenerator({ productId: product.id, workspaceOwnerId: 'owner', version: product.updated_at,
    brand: '현재 계정의 나중 설정', active: true, beforeGenerate: () => true, onSaved() { throw Error('Preview must not save product content'); } });
    const tree = outer.type(outer.props); layouts.splice(0).forEach(fn => fn()); effects.splice(0).forEach(fn => fn()); return tree; };
  const until = async predicate => { const deadline = Date.now() + 10000; while (!predicate()) { assert.ok(Date.now() < deadline, 'SEO component did not settle: ' + text(render())); render(); await new Promise(done => setImmediate(done)); } };
  render();
  return { render, calls, creates, storage, until, input: (label = 'SEO 브랜드') => nodes(render()).find(node => node.props?.['aria-label'] === label),
    button: () => nodes(render()).find(node => node.type === 'button' && ['AI로 자동 생성', '한국어 초안 자동 작성'].includes(text(node))),
    close() { mounted = false; slots.forEach(slot => slot?.cleanup?.()); } };
}

async function fixture(company, provider, { brand = '  ' + company.name + '  , ' + '보조브랜드 '.repeat(20), goal = 'price', official = false } = {}) {
  const offerId = '699000000001', url = 'https://detail.1688.com/offer/' + offerId + '.html', queries = [];
  const dictionary = new Map([['黑色太阳镜', '검정 선글라스'], ['黑色镜架', '검정 안경테'], ['黑色', '검정'], ['材质', '재질'], ['塑料', '플라스틱']]);
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name, ...(provider === 'google' ? {
    sourceFetcher: async target => { assert.equal(String(target), url); return new Response('<script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', url, name: '黑色太阳镜', description: '黑色镜架',
      additionalProperty: [{ '@type': 'PropertyValue', name: '材质', value: '塑料' }], hasVariant: [{ '@type': 'Product', sku: offerId + '01', name: '黑色', offers: { '@type': 'Offer', price: '5.5', priceCurrency: 'CNY', eligibleQuantity: { '@type': 'QuantitativeValue', minValue: 1 } } }] }) + '</script>', { headers: { 'content-type': 'text/html;charset=utf-8' } }); },
    translationFetcher: async target => { const q = new URL(target).searchParams.get('q'); queries.push(q); const translate = value => { assert.ok(dictionary.has(value), 'unexpected supplier input: ' + value); return dictionary.get(value); };
      const translated = q.startsWith('[[YFTR') ? q.split('\n').map(line => { const match = /^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line); assert.ok(match); return match[1] + ' ' + translate(match[2]); }).join('\n') : translate(q);
      return Response.json([[[translated, q]], null, 'zh-CN']); },
  } : {}) });
  try {
    if (provider === 'google') { h.bindings.SOURCEFLOW_TEXT_PROVIDER = 'google-free'; delete h.bindings.AI; }
    const settings = { ...h.settings, brand }, savedSettings = await json(await h.load('app/api/settings/route.ts').PUT(new Request('https://app.test/api/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...settings, expectedOwnerId: 'owner' }) })));
    assert.equal(savedSettings.settings.brand, brand);
    let schema = { format: 'supplier-hub-schema-v1', categoryId: '69900', categoryPath, company, observedAt: Date.now(), metadata: { kanCategoryId: 2624, noticeNumber: 4, scopeType: 'Retail_Categorized_Single', version: 188 },
      inputBindings: 'couplus-paths-v1', draftInitialization: 'couplus-required-v1', settingsInitialization: 'couplus-options-v1', schemaString: JSON.stringify({ type: 'object', properties: {
        startPage: { type: 'object', properties: { productName: { type: 'string', title: '상품명' }, categoryPath: { type: 'string', title: '카테고리' } } },
        productPage: { type: 'object', properties: { brand: { type: 'string', title: '브랜드' }, manufacturer: { type: 'string', title: '제조사' } } }, legalPage: { type: 'object', properties: {} } } }) };
    let template = null, mappings = [], original = null;
    if (official && officialAvailable) {
      const captured = JSON.parse(JSON.parse(fs.readFileSync(profileFile, 'utf8'))[0].results[0].payload); schema = structuredClone(captured.hubSchema); schema.company = plain(company);
      original = new Uint8Array(fs.readFileSync(originalFile)); const form = new FormData(); form.set('file', new File([original], 'original-2624.xlsx')); form.set('schema', JSON.stringify(schema)); form.set('action', 'workbook');
      const linked = await json(await h.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test/api/category-profiles/official-template', { method: 'POST', body: form })), 201); template = linked.template; mappings = linked.mappings;
    }
    const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', { name: '격리 첫 브랜드 검수', categoryId: '69900', categoryPath, hubSchema: schema, template, mappings });
    // Remove only the helper's unstarted synthetic seed, so the real queue API
    // captures this test's settings for the recorded offer from the start.
    if (provider === 'workers') { h.sqlite.prepare("DELETE FROM collection_context WHERE job_id='job'").run(); h.sqlite.prepare("DELETE FROM collection_jobs WHERE id='job'").run(); }
    const sourceUrl = provider === 'workers' ? h.sourceUrl : url, features = provider === 'google' ? '가벼운' : '', keywords = provider === 'google' ? '외출용' : '';
    const queued = await json(await h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ urls: [sourceUrl], goal, profileId: profile.id, expectedProfileRevision: profile.revision, expectedSettings: savedSettings.settings, features, keywords }) })));
    const job = queued.jobs[0]; assert.equal(job.context.settings.brand, brand);
    await json(await h.route('/api/collection-jobs/' + job.id + '/collect', { method: 'POST' }));
    await h.load('db/queries.ts').saveSettings('owner', JSON.stringify({ ...settings, brand: '나중 저장한 다른 브랜드' }));
    const immutable = () => JSON.stringify(['collection_context', 'collection_results', 'category_profiles', 'workspace_settings'].map(table => h.sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()));
    const before = immutable(), product = () => h.sqlite.prepare('SELECT * FROM products WHERE source_url=?').get(sourceUrl), fetcher = (path, init = {}) => h.route(path, { method: init.method ?? 'GET', body: init.body });
    const content = async () => (await json(await h.route('/api/products/' + product().id + '/content'))).content;
    const state = () => JSON.stringify(['products', 'product_content', 'product_options', 'product_quotation_fields', 'product_price_policy', 'product_registration_numbers', 'product_registration_options'].map(table => h.sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()));
    const objects = () => JSON.stringify([...h.objects].map(([key, value]) => [key, sha(value)]));
    return { h, provider, company, brand, profile, original, job, queries, features, keywords, product, fetcher, content, immutable, before, state, objects,
      intake: () => h.intake(job.id), quote: () => h.route('/api/products/' + product().id + '/quotation-fields').then(response => json(response)) };
  } catch (error) { h.close(); throw error; }
}

for (const company of companies) for (const provider of ['workers', 'google']) test(`captured first brand reaches initial SEO, label, reopened UI and quotation without rewriting the brand list (${company.code}/${provider})`, async () => {
  const f = await fixture(company, provider, { official: provider === 'workers' }), { h } = f; let ui;
  const other = mobileIntakeHarness({ companyCode: companies.find(item => item.code !== company.code).code, companyName: companies.find(item => item.code !== company.code).name });
  try {
    const otherBefore = JSON.stringify(other.sqlite.prepare('SELECT * FROM collection_context').all());
    const message = await f.intake(), product = f.product(), base = '/api/products/' + product.id, content = await f.content(), view = await f.quote();
    const expected = provider === 'workers' ? company.name + ' 우드 패턴 다리 선글라스' : company.name + ' 가벼운 검정 선글라스 외출용';
    assert.equal(content.seo.title.value, expected); assert.equal(content.label.productName.value, expected); assert.equal(content.labelProductNameLinked, true);
    assert.doesNotMatch(message, /브랜드의 길이|SEO 구성.*검토|미완료/); assert.equal(content.intakeSeoGuidancePending, undefined);
    assert.ok(f.brand.length > 100); assert.equal(f.immutable(), f.before); assert.equal(product.supplier_hub_status, '미전송');
    const original = JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get(f.job.id).payload); assert.equal(product.title, original.title);
    for (const row of view.resolved.rows) { assert.equal(row.fields.title.value, expected); assert.equal(row.fields.brand.value, company.name); }
    const jobs = h.sqlite.prepare('SELECT * FROM translation_jobs WHERE product_id=?').all(product.id), canonical = plain(jobs[0]); assert.equal(jobs.length, 1); assert.equal(canonical.status, 'completed');
    assert.ok(!JSON.parse(canonical.result).draft.title.includes('보조브랜드')); assert.ok(f.queries.every(q => !q.includes(company.name) && !q.includes('보조브랜드') && !q.includes(f.features)), 'owner input never becomes supplier/provider text');
    const beforeUi = f.state(), objects = f.objects(), target = provider === 'workers' ? '직접 입력한 타겟' : f.keywords;
    const enterRequiredTarget = async () => {
      await ui.until(() => ui.input()?.props.value === f.brand.split(',')[0] && !ui.input().props.disabled);
      assert.equal(ui.input('SEO 타겟 키워드').props.value, f.keywords);
      if (provider === 'workers') {
        assert.equal(ui.button().props.disabled, true, 'A blank required target cannot generate a new draft');
        ui.input('SEO 타겟 키워드').props.onChange({ target: { value: target } });
      }
    };
    ui = seoUi(f); await enterRequiredTarget(); await ui.until(() => ui.button() && !ui.button().props.disabled);
    assert.equal(ui.input().props.value, f.brand.split(',')[0]); assert.ok(ui.calls.every(call => call.method === 'GET')); assert.equal(f.state(), beforeUi);
    ui.close(); ui = seoUi(f); await enterRequiredTarget(); await ui.until(() => ui.button() && !ui.button().props.disabled); assert.equal(ui.input().props.value, f.brand.split(',')[0]);
    const explicitBrand = '직접 브랜드, 직접 보조'; ui.input().props.onChange({ target: { value: explicitBrand } });
    const beforeRerenderCalls = ui.calls.length; ui.render(); ui.render();
    assert.equal(ui.input().props.value, explicitBrand); assert.equal(ui.input('SEO 타겟 키워드').props.value, target);
    assert.equal(ui.input('SEO 상품 특징').props.value, f.features); assert.equal(ui.calls.length, beforeRerenderCalls);
    assert.equal(ui.creates.length, 0); assert.equal(f.state(), beforeUi); ui.button().props.onClick();
    await ui.until(() => ui.creates.length === 1 && [...ui.storage.values()].some(raw => JSON.parse(raw).jobId));
    assert.equal(ui.creates[0].memo.brand, explicitBrand); assert.equal(JSON.parse([...ui.storage.values()][0]).memo.brand, explicitBrand); assert.equal(f.state(), beforeUi);
    assert.deepEqual(ui.creates[0].memo, { brand: explicitBrand, features: f.features, keywords: target }); ui.close(); ui = null;
    let cells = null;
    if (f.profile.template) {
      const preview = await json(await h.route(base + '/quotation', { method: 'POST', body: { action: 'preview', profileId: f.profile.id } }));
      const response = await h.route(base + '/quotation', { method: 'POST', body: { action: 'download', profileId: f.profile.id, fingerprint: preview.fingerprint } }); assert.equal(response.status, 200, await response.clone().text());
      const reader = h.load('app/xlsx-template.ts'), book = reader.inspectXlsxArchive(await reader.readXlsxArchive(await response.arrayBuffer()));
      cells = preview.rows.map((_, i) => reader.xlsxHeaders(book, f.profile.template.sheetName, f.profile.template.dataStartRow + i)); assert.equal(cells.length, 6);
      for (const row of cells) { assert.equal(row[2], expected); assert.equal(row[5], company.name); }
    }
    const current = await f.content(); await json(await h.route(base + '/content', { method: 'PATCH', body: { expectedRevision: current.revision, patch: { seo: { title: '', keywords: [] }, label: { productName: '별도 수동 품명' }, labelProductNameLinked: false } } }));
    const manual = f.state(), requests = h.network.length; await f.intake(); assert.equal(f.state(), manual); assert.equal(h.network.length, requests); assert.equal((await f.content()).seo.title.value, ''); assert.equal((await f.content()).label.productName.value, '별도 수동 품명');
    assert.deepEqual(plain(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(canonical.id)), canonical); assert.equal(f.immutable(), f.before); assert.equal(f.objects(), objects); assert.equal(JSON.stringify(other.sqlite.prepare('SELECT * FROM collection_context').all()), otherBefore);
    proof.push({ company, provider, settingsBrandLength: f.brand.length, firstBrand: company.name, expectedTitle: expected, savedTitle: content.seo.title.value, labelName: content.label.productName.value,
      quotationTitles: view.resolved.rows.map(row => row.fields.title.value), quotationBrands: view.resolved.rows.map(row => row.fields.brand.value), originalWorkbookSha256: f.original ? sha(f.original) : null,
      workbookTitles: cells?.map(row => row[2]) ?? null, workbookBrands: cells?.map(row => row[5]) ?? null, immutableBeforeSha256: sha(f.before), immutableAfterSha256: sha(f.immutable()), sourceTitlePreserved: true, explicitMemoPreserved: true, manualBlankAndUnlinkedLabelPreserved: true,
      r2UnchangedAfterInitialDraft: f.objects() === objects, otherCompanyUnchanged: true, providerCalls: provider === 'workers' ? h.aiSources.length : f.queries.length });
  } finally { ui?.close(); h.close(); other.close(); }
});

test('a blank first captured segment does not fall through to the second brand; pre-generation manual title and unlinked label remain authoritative', async () => {
  const cases = [];
  for (const [index, brand] of [', 보조브랜드', '   , 보조브랜드', ''].entries()) {
    const f = await fixture(companies[index % 2], 'google', { brand, goal: 'collect' }), { h } = f;
    try {
      await f.intake(); const before = await f.content(), product = f.product(), base = '/api/products/' + product.id;
      if (index === 2) await json(await h.route(base + '/content', { method: 'PATCH', body: { expectedRevision: before.revision, patch: { seo: { title: '직접 확인한 제목', keywords: [] }, label: { productName: '연동 해제한 수동 품명' }, labelProductNameLinked: false } } }));
      const outcome = await h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(product.id, f.fetcher, new AbortController().signal), saved = await f.content();
      assert.equal(outcome.completed, true); assert.equal(outcome.reviewRequired, false);
      assert.equal(saved.seo.title.value, index === 2 ? '직접 확인한 제목' : '가벼운 검정 선글라스 외출용'); assert.ok(!saved.seo.title.value.includes('보조브랜드'));
      if (index === 2) { assert.equal(saved.label.productName.value, '연동 해제한 수동 품명'); assert.deepEqual(saved.seo.keywords.value, []); }
      assert.equal(f.immutable(), f.before); cases.push({ brand, title: saved.seo.title.value, completed: true, sourceAndSettingsPreserved: true });
    } finally { h.close(); }
  }
  proof.push({ kind: 'blank-first-and-manual-boundary', cases });
});
