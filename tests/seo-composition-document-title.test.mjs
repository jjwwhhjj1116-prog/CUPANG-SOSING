import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

// Reuse the recorded-source fixture and real handlers/temporary SQLite without
// importing its test registrations or replacing the adoption/persistence code.
const fixtureUrl = new URL('./seo-guidance-composition.test.mjs', import.meta.url);
const fixtureSource = fs.readFileSync(fixtureUrl, 'utf8');
const fixtureAst = ts.createSourceFile('composition-fixture.mjs', fixtureSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = [];
for (const statement of fixtureAst.statements) {
  if (ts.isImportDeclaration(statement)) continue;
  if (!ts.isVariableStatement(statement) && !ts.isFunctionDeclaration(statement)) break;
  declarations.push(statement.getText(fixtureAst));
}
const { fixture, companies, composition, json } = vm.runInNewContext(
  declarations.join('\n').replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href))
    + '\n({fixture,companies,composition,json})',
  { assert, fs, vm, mobileIntakeHarness, URL, Response, AbortController, TextEncoder },
);
const plain = value => JSON.parse(JSON.stringify(value));

const applyUrl = f => f.base + '/translation-apply';
async function requestPreview(f, body = f.body) {
  return json(await f.h.route(applyUrl(f), { method: 'POST', body: { ...body, action: 'preview' } }));
}
async function requestApply(f, reviewed, body = f.body, status = 200) {
  return json(await f.h.route(applyUrl(f), { method: 'POST', body: { ...body, action: 'apply', fingerprint: reviewed.fingerprint } }), status);
}
async function readContent(f) { return (await json(await f.h.route(f.base + '/content'))).content; }
async function readOptions(f) { return (await json(await f.h.route(f.base + '/options'))).options; }
async function readQuote(f) { return json(await f.h.route(f.base + '/quotation-fields')); }
function table(f, name) { return plain(f.h.sqlite.prepare('SELECT * FROM ' + name).all()); }
function stored(f) {
  return JSON.stringify(f.h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({ name }) => [name, table(f, name)]));
}
function retained(f) {
  return JSON.stringify(f.h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .filter(({ name }) => !['products', 'product_content', 'product_options'].includes(name)).map(({ name }) => [name, table(f, name)]));
}
function seedContent(f, update) {
  const content = JSON.parse(f.h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.job.productId).payload);
  update(content);
  f.h.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content), f.job.productId);
  return content;
}
function seedQuote(f) {
  const [first, second] = f.currentOptions.rows;
  const overrides = { common: {}, options: { [first.id]: { title: '직접 검토한 견적 제목' }, [second.id]: { title: '' } } };
  const scope = f.h.load('app/quotation-scopes.ts').quotationScope(f.h.context.category.categoryId);
  const payload = { schemaVersion: 1, productId: f.job.productId, revision: 1,
    overrides: { common: {}, options: {} }, categoryOverrides: { [scope]: overrides } };
  f.h.sqlite.prepare('INSERT OR REPLACE INTO product_quotation_fields(product_id,owner_id,revision,payload,updated_at) VALUES(?,?,?,?,?)')
    .run(f.job.productId, 'owner', 1, JSON.stringify(payload), f.body.expectedVersion);
}
function documentProof(content) {
  return { policy: 'couplus-seo-save-v1', sourceTitle: content.seo.title.value,
    sourceUpdatedAt: content.seo.title.updatedAt, value: content.seo.title.value };
}
function expectedTags(f) { return plain(f.h.load('app/seo-guidance-composition.ts').seoGuidanceTags(f.job.result.draft, composition).tags); }
function freezeOtherCandidates(f) {
  const options = plain(f.currentOptions);
  for (const row of options.rows) for (const field of ['translatedName', 'color', 'size']) row.provenance[field] = 'manual';
  f.h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(options), f.job.productId);
  seedContent(f, content => {
    const plan = f.h.load('app/translation-integrated-adoption.ts').integratedTranslationPlan(content, options, f.job,
      f.body.expectedVersion, 'all', f.h.context.settings.hiddenAttributes, f.h.context.settings.brand);
    if (plan.categoryAttributes) content.categoryAttributes = plan.categoryAttributes;
  });
}
async function prepareDescriptionReview(f) {
  const api = f.h.load('app/seo-workspace-draft.ts'), content = await readContent(f);
  // This synthetic manual source uses a short recorded phrase and the existing
  // local Google response fixture. Prepare/approve/execute remain real APIs.
  const source = { ...plain(f.job.review.source), description: '圆框', provenance: 'manual' };
  const state = api.createSeoWorkspaceDraftState({ productId: f.job.productId, productVersion: f.body.expectedVersion,
    contentRevision: content.revision, source, memo: { brand: composition.brand, features: composition.features, keywords: composition.keywords },
    configuration: f.h.load('app/automation/translation.ts').translationConfiguration(f.h.bindings) });
  const outcome = await api.runSeoWorkspaceDraft(state, { signal: new AbortController().signal,
    fetcher: (target, init = {}) => f.h.route(String(target), { method: init.method ?? 'GET', body: init.body }), onState: () => {} });
  assert.equal(outcome.job.status, 'completed');
  assert.equal(outcome.job.result.draft.description, '원형 테');
  f.job = outcome.job; f.body = { ...f.body, jobId: outcome.job.id };
}

for (const company of companies) {
  test(`${company.code}: preview is read-only; explicit composition apply/reopen uses the plain document title and retains manual quotation blanks`, async () => {
    const f = await fixture(company, { manualSeo: { description: '기존 직접 작성한 상세 본문' } });
    try {
      seedQuote(f);
      const contentBefore = await readContent(f), optionsBefore = await readOptions(f), productBefore = table(f, 'products'), allBefore = stored(f);
      const preserved = retained(f), objects = JSON.stringify([...f.h.objects]), network = f.h.network.length, aiCalls = f.h.aiSources.length;
      const reviewed = await requestPreview(f);
      assert.equal(stored(f), allBefore, 'preview changes no table or policy');
      assert.equal((await readContent(f)).seoTitleDocument, undefined);
      assert.ok(reviewed.preview.some(row => row.name === '상품명 · 사용자 구성안'));
      const ack = await requestApply(f, reviewed);
      const saved = await readContent(f), reopened = await readContent(f), options = await readOptions(f);
      assert.deepEqual(reopened, saved);
      assert.deepEqual(saved.seoTitleDocument, documentProof(saved));
      assert.equal(saved.seo.title.value, composition.title);
      assert.equal(saved.seo.title.updatedAt, ack.productVersion);
      assert.equal(saved.revision, contentBefore.revision + 1);
      assert.equal(options.revision, optionsBefore.revision + 1);
      for (const key of Object.keys(contentBefore).filter(key => !['seo', 'categoryAttributes', 'revision', 'updatedAt', 'seoTitleDocument', 'intakeKeywordSeed'].includes(key)))
        assert.deepEqual(saved[key], contentBefore[key], 'protected content ' + key);
      assert.equal(saved.intakeKeywordSeed, undefined, 'existing explicit keyword replacement retires the untouched intake keyword seed');
      assert.deepEqual(saved.seo.description, contentBefore.seo.description);
      for (const row of options.rows) {
        const before = optionsBefore.rows.find(item => item.id === row.id);
        for (const key of Object.keys(before).filter(key => !['translatedName', 'color', 'size', 'provenance', 'updatedAt'].includes(key)))
          assert.deepEqual(row[key], before[key], 'protected option ' + key);
        for (const key of Object.keys(before.provenance).filter(key => !['translatedName', 'color', 'size'].includes(key)))
          assert.deepEqual(row.provenance[key], before.provenance[key], 'protected option provenance ' + key);
      }
      const productAfter = table(f, 'products');
      for (const key of Object.keys(productBefore[0]).filter(key => !['updated_at', 'quote_status'].includes(key)))
        assert.deepEqual(productAfter[0][key], productBefore[0][key], 'captured product/price/source ' + key);
      const quotation = await readQuote(f);
      assert.ok(quotation.automatic.rows.length > 1);
      for (const row of quotation.automatic.rows) assert.equal(row.fields.title.value, composition.title);
      assert.equal(quotation.resolved.rows.find(row => row.optionId === options.rows[0].id).fields.title.value, '직접 검토한 견적 제목');
      assert.equal(quotation.resolved.rows.find(row => row.optionId === options.rows[1].id).fields.title.value, '');
      assert.equal(retained(f), preserved, 'quotation overrides, captured context/settings, source receipt and provider history remain identical');
      assert.equal(JSON.stringify([...f.h.objects]), objects, 'owned assets are not rewritten');
      assert.equal(f.h.network.length, network, 'preview/apply/GET issue no provider or supplier requests');
      assert.equal(f.h.aiSources.length, aiCalls);
    } finally { f.h.close(); }
  });

  for (const title of ['보호된 공통 상품명', '']) test(`${company.code}: applied keywords bind the protected ${title ? 'title' : 'manual blank'} to its existing clock`, async () => {
    const f = await fixture(company, { manualSeo: { title, description: '보호 본문' } });
    try {
      seedQuote(f);
      const before = await readContent(f), qBefore = table(f, 'product_quotation_fields'), reviewed = await requestPreview(f);
      assert.ok(!reviewed.preview.some(row => row.name === '상품명 · 사용자 구성안'));
      assert.ok(reviewed.preview.some(row => row.name === '검색어 · 사용자 구성안'));
      await requestApply(f, reviewed);
      const saved = await readContent(f);
      assert.deepEqual(saved.seo.title, before.seo.title);
      assert.deepEqual(saved.seoTitleDocument, documentProof(before));
      const q = await readQuote(f);
      for (const row of q.automatic.rows) assert.equal(row.fields.title.value, title);
      assert.equal(q.resolved.rows.find(row => row.optionId === f.currentOptions.rows[1].id).fields.title.value, '');
      assert.deepEqual(table(f, 'product_quotation_fields'), qBefore);
    } finally { f.h.close(); }
  });

  test(`${company.code}: a title-only composition keeps protected keywords and their provenance`, async () => {
    const f = await fixture(company, { manualSeo: { keywords: ['기존 직접 태그'], description: '보호 본문' } });
    try {
      const before = await readContent(f), reviewed = await requestPreview(f);
      assert.ok(reviewed.preview.some(row => row.name === '상품명 · 사용자 구성안'));
      assert.ok(!reviewed.preview.some(row => row.name === '검색어 · 사용자 구성안'));
      await requestApply(f, reviewed);
      const saved = await readContent(f);
      assert.deepEqual(saved.seo.keywords, before.seo.keywords);
      assert.deepEqual(saved.seoTitleDocument, documentProof(saved));
    } finally { f.h.close(); }
  });

  test(`${company.code}: description-only composition application creates no title policy`, async () => {
    const f = await fixture(company, { manualSeo: { title: '보호 제목', keywords: [] } });
    try {
      seedContent(f, content => { content.seo.description = { value: '', provenance: 'unverified', updatedAt: null }; });
      await prepareDescriptionReview(f);
      freezeOtherCandidates(f);
      const before = await readContent(f), quoteBefore = await readQuote(f), reviewed = await requestPreview(f);
      assert.deepEqual(plain(reviewed.preview.map(row => row.name)), ['상품 설명']);
      await requestApply(f, reviewed);
      const saved = await readContent(f);
      assert.equal(saved.seoTitleDocument, undefined);
      assert.deepEqual(saved.seo.title, before.seo.title);
      assert.deepEqual(saved.seo.keywords, before.seo.keywords);
      assert.notDeepEqual(saved.seo.description, before.seo.description);
      assert.deepEqual((await readQuote(f)).automatic.rows.map(row => row.fields.title), quoteBefore.automatic.rows.map(row => row.fields.title));
    } finally { f.h.close(); }
  });

  test(`${company.code}: protected/empty SEO with other applicable translation creates no title policy`, async () => {
    const f = await fixture(company, { manualSeo: { title: '', keywords: [], description: '보호 본문' } });
    try {
      const before = await readContent(f), reviewed = await requestPreview(f);
      assert.ok(reviewed.preview.length > 0);
      assert.ok(!reviewed.preview.some(row => ['상품명 · 사용자 구성안', '검색어 · 사용자 구성안', '상품 설명'].includes(row.name)));
      await requestApply(f, reviewed);
      const saved = await readContent(f);
      assert.equal(saved.seoTitleDocument, undefined);
      assert.deepEqual(saved.seo, before.seo);
    } finally { f.h.close(); }
  });

  test(`${company.code}: already equal eligible title/tags do not stamp a policy while other fields apply`, async () => {
    const f = await fixture(company);
    try {
      seedContent(f, content => {
        content.seo.title.value = composition.title;
        content.seo.title.provenance = 'unverified';
        content.seo.keywords.value = expectedTags(f);
        content.seo.keywords.provenance = 'unverified';
        delete content.intakeKeywordSeed;
      });
      const before = await readContent(f), reviewed = await requestPreview(f);
      assert.ok(reviewed.preview.length > 0);
      assert.ok(!reviewed.preview.some(row => row.name.startsWith('상품명') || row.name.startsWith('검색어')));
      await requestApply(f, reviewed);
      const saved = await readContent(f);
      assert.equal(saved.seoTitleDocument, undefined);
      assert.deepEqual(saved.seo.title, before.seo.title);
      assert.deepEqual(saved.seo.keywords, before.seo.keywords);
    } finally { f.h.close(); }
  });

  test(`${company.code}: no-change composition preview/apply leaves every table and policy unchanged`, async () => {
    const f = await fixture(company, { manualSeo: { title: composition.title, keywords: [], description: '보호 본문' } });
    try {
      freezeOtherCandidates(f);
      const before = stored(f), reviewed = await requestPreview(f);
      assert.deepEqual(plain(reviewed.preview), []);
      assert.equal(stored(f), before);
      await requestApply(f, reviewed, f.body, 409);
      assert.equal(stored(f), before);
      assert.equal((await readContent(f)).seoTitleDocument, undefined);
    } finally { f.h.close(); }
  });

  for (const scope of ['all', 'options']) test(`${company.code}: ${scope} translation without explicit composition keeps the legacy title fallback`, async () => {
    const f = await fixture(company);
    try {
      if (scope === 'options') seedContent(f, content => { content.seo.title = { value: '', provenance: 'unverified', updatedAt: null }; });
      const body = { jobId: f.job.id, expectedVersion: f.body.expectedVersion, scope }, before = await readContent(f);
      const reviewed = await requestPreview(f, body);
      assert.ok(reviewed.preview.length > 0);
      await requestApply(f, reviewed, body);
      const saved = await readContent(f), options = await readOptions(f), q = await readQuote(f);
      assert.equal(saved.seoTitleDocument, undefined);
      if (scope === 'options') assert.deepEqual(saved.seo, before.seo);
      const resolve = f.h.load('app/seo-title-document.ts').quotationSeoDocumentTitle;
      for (const row of q.automatic.rows) {
        const option = options.rows.find(option => option.id === row.optionId);
        assert.equal(row.fields.title.value, resolve(saved, saved.seo.title.value || table(f, 'products')[0].title, option));
        if (saved.seo.title.value && option?.translatedName) assert.equal(row.fields.title.value, saved.seo.title.value + ', ' + option.translatedName);
      }
    } finally { f.h.close(); }
  });

  test(`${company.code}: invalid scope, changed reviewed composition and client proof injection never write`, async () => {
    const f = await fixture(company);
    try {
      const reviewed = await requestPreview(f), before = stored(f);
      for (const bad of [{ ...f.body, scope: 'options' }, { ...f.body, seoTitleDocument: { value: '주입 제목' } },
        { ...f.body, seoComposition: { ...composition, seoTitleDocument: { value: '주입 제목' } } }]) {
        await json(await f.h.route(applyUrl(f), { method: 'POST', body: { ...bad, action: 'apply', fingerprint: reviewed.fingerprint } }), 400);
        assert.equal(stored(f), before);
      }
      await requestApply(f, reviewed, { ...f.body, seoComposition: { ...composition, title: '검토 후 바꾼 제목' } }, 409);
      assert.equal(stored(f), before);
      f.h.setCompany(companies.find(value => value.code !== company.code));
      await requestApply(f, reviewed, f.body, 409);
      assert.equal(stored(f), before);
    } finally { f.h.close(); }
  });

  for (const boundary of ['product', 'content', 'options']) test(`${company.code}: atomic ${boundary} CAS race prevents composition fields and title proof from committing`, async () => {
    const f = await fixture(company);
    try {
      seedQuote(f);
      const reviewed = await requestPreview(f), batch = f.h.bindings.DB.batch, prepare = f.h.bindings.DB.prepare;
      let raced, calls = 0;
      f.h.bindings.DB.prepare = sql => { const statement = prepare(sql); statement.fixtureSql = sql; return statement; };
      f.h.bindings.DB.batch = async statements => {
        if (!statements[0].fixtureSql?.includes('UPDATE products SET updated_at=') || !statements[0].fixtureSql.includes('options_count=')) return batch(statements);
        calls++;
        if (boundary === 'product') f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2030-01-01T00:00:00.000Z', f.job.productId);
        else {
          const row = f.h.sqlite.prepare('SELECT payload FROM product_' + boundary + ' WHERE product_id=?').get(f.job.productId), payload = JSON.parse(row.payload);
          payload.revision++;
          f.h.sqlite.prepare('UPDATE product_' + boundary + ' SET revision=revision+1,payload=? WHERE product_id=?').run(JSON.stringify(payload), f.job.productId);
        }
        raced = stored(f);
        return batch(statements);
      };
      await requestApply(f, reviewed, f.body, 409);
      assert.equal(calls, 1, 'race occurs immediately before the real atomic SQLite batch');
      assert.equal(stored(f), raced, 'none of the reviewed content/options/proof commits after the race');
      assert.equal((await readContent(f)).seoTitleDocument, undefined);
    } finally { f.h.close(); }
  });
}

test('the shared writer only accepts actual SEO fields and never stamps an unknown empty legacy title', async () => {
  const f = await fixture(companies[0]);
  try {
    const apply = f.h.load('app/seo-title-document.ts').applySeoDocumentTitlePolicy, baseline = await readContent(f);
    for (const patch of [undefined, {}, { description: '본문만' }]) {
      const content = plain(baseline); apply(content, patch); assert.deepEqual(content, baseline);
    }
    const legacy = plain(baseline); legacy.seo.title = { value: '', provenance: 'unverified', updatedAt: null };
    const before = plain(legacy); apply(legacy, { keywords: ['새 검색어'] }); assert.deepEqual(legacy, before);
    const blank = plain(legacy); blank.seo.title.provenance = 'manual'; apply(blank, { keywords: [] });
    assert.deepEqual(plain(blank.seoTitleDocument), documentProof(blank));
  } finally { f.h.close(); }
});
