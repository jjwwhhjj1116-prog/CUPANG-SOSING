import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { schemaCompanies, hubSchemaSnapshot, schemaPath } from './helpers/hub-schema.mjs';

// Reuse the synthetic arbitrary URL/category fixture and real handlers/SQLite.
// Only declarations are loaded; the existing test module is not registered.
const url = new URL('./intake-seo-guidance.test.mjs', import.meta.url);
const source = fs.readFileSync(url, 'utf8');
const ast = ts.createSourceFile('intake-fixture.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), declarations = [];
for (const statement of ast.statements) {
  if (ts.isImportDeclaration(statement)) continue;
  if (!ts.isVariableStatement(statement) && !ts.isFunctionDeclaration(statement)) break;
  declarations.push(statement.getText(ast));
}
const { fixture } = vm.runInNewContext(declarations.join('\n') + '\n({fixture})',
  { assert, mobileIntakeHarness, schemaCompanies, hubSchemaSnapshot, schemaPath, URL, Request, Response });
const plain = value => JSON.parse(JSON.stringify(value));
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const table = (f, name) => plain(f.h.sqlite.prepare('SELECT * FROM ' + name).all());
function snapshot(f, { retained = false } = {}) {
  return JSON.stringify(f.h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .filter(({ name }) => !retained || !['products', 'product_content', 'product_options'].includes(name))
    .map(({ name }) => [name, table(f, name)]));
}
const applyUrl = f => f.base + '/translation-apply';
const body = f => ({ jobId: f.initial.id, expectedVersion: f.product().updated_at });
async function preview(f, request = body(f), status = 200) {
  return json(await f.h.route(applyUrl(f), { method: 'POST', body: { ...request, action: 'preview' } }), status);
}
async function apply(f, reviewed, request = body(f), status = 200) {
  return json(await f.h.route(applyUrl(f), { method: 'POST', body: { ...request, action: 'apply', fingerprint: reviewed.fingerprint } }), status);
}
async function quote(f) { return json(await f.h.route(f.base + '/quotation-fields')); }
function policy(content) {
  return { policy: 'couplus-seo-save-v1', sourceTitle: content.seo.title.value,
    sourceUpdatedAt: content.seo.title.updatedAt, value: content.seo.title.value };
}
function seedContent(f, update) {
  const content = JSON.parse(f.h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.product().id).payload);
  update(content);
  f.h.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content), f.product().id);
}
function seedQuotation(f, title) {
  const option = JSON.parse(f.h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.product().id).payload).rows[0];
  const category = f.h.load('app/quotation-scopes.ts').quotationScope(f.profile.categoryId);
  const value = { schemaVersion: 1, productId: f.product().id, revision: 1, updatedAt: f.product().updated_at,
    overrides: { common: {}, options: {} }, categoryOverrides: { [category]: {
      common: { title: '직접 확인한 공통 견적 이름', searchTags: '' }, options: { [option.id]: { title } },
    } } };
  f.h.sqlite.prepare('INSERT INTO product_quotation_fields(product_id,owner_id,revision,payload,updated_at) VALUES(?,?,?,?,?)')
    .run(f.product().id, 'owner', 1, JSON.stringify(value), f.product().updated_at);
  return option.id;
}
async function prepared(company, { seo = {}, protectDescription = true } = {}) {
  const f = await fixture(company, { goal: 'collect' });
  try {
    await f.intake(); f.base = '/api/products/' + f.product().id;
    assert.equal(table(f, 'translation_jobs').length, 0, 'collect-only has no initial generation');
    assert.equal((await f.content()).seoTitleDocument, undefined);
    const initialContent = await f.content(), labels = Object.fromEntries(Object.keys(initialContent.label)
      .map(key => [key, key === 'certification' || key === 'countryOfOrigin' ? '' : '직접 보호 ' + key]));
    await json(await f.h.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: initialContent.revision, patch: {
      seo: { ...(protectDescription ? { description: '직접 작성한 상세 설명' } : {}), ...seo },
      detail: { description: '<p>기존 직접 작성한 본문</p>', altText: '직접 대체 텍스트' },
      label: labels, labelProductNameLinked: false,
    } } }));
    let stopped = 0;
    const outcome = await f.h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(f.product().id, async (path, init = {}) => {
      if (path.endsWith('/translation-apply') && JSON.parse(init.body).action === 'apply') {
        stopped++; throw Error('synthetic fixture stopped before canonical apply');
      }
      return f.fetcher(path, init);
    }, new AbortController().signal);
    assert.equal(outcome.completed, false); assert.equal(stopped, 1);
    assert.match(outcome.message, /stopped before canonical apply/);
    f.initial = await f.h.load('db/translation-jobs.ts').getTranslationJob('owner', f.product().id, f.canonical().id);
    assert.equal(f.initial.status, 'completed');
    assert.equal(f.canonical().idempotency_key, 'intake-auto-v1');
    assert.equal(f.queries.length, 2); assert.equal((await f.content()).seoTitleDocument, undefined);
    return f;
  } catch (error) { f.close(); throw error; }
}
function freezeOtherCandidates(f) {
  const options = JSON.parse(f.h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.product().id).payload);
  for (const row of options.rows) for (const field of ['translatedName', 'color', 'size']) row.provenance[field] = 'manual';
  f.h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(options), f.product().id);
  seedContent(f, content => {
    const plan = f.h.load('app/translation-integrated-adoption.ts').integratedTranslationPlan(content, options, f.initial,
      f.product().updated_at, 'all', f.settings.hiddenAttributes, f.settings.brand);
    if (plan.categoryAttributes) content.categoryAttributes = plan.categoryAttributes;
  });
}
async function independentJob(f) {
  const endpoint = f.base + '/translation', post = request => f.h.route(endpoint, { method: 'POST', body: request });
  const current = await json(await post({ action: 'prepare', source: plain(f.initial.review.source),
    expectedVersion: f.product().updated_at, idempotencyKey: 'synthetic-independent-review-' + f.profile.hubSchema.company.code }), 201);
  await json(await post({ action: 'approve', jobId: current.job.id, reviewFingerprint: current.job.review.fingerprint, confirmPaid: true }));
  const executed = await json(await post({ action: 'execute', jobId: current.job.id }));
  assert.equal(executed.job.status, 'completed'); return executed.job;
}

for (const company of schemaCompanies) {
  test(`${company.code}: category and new URL automatically apply the canonical first SEO document's plain title`, async () => {
    const f = await fixture(company);
    try {
      const message = await f.intake(); f.base = '/api/products/' + f.product().id;
      const content = await f.content(), reopened = await f.content(), options = await f.options();
      assert.match(message, /SEO·옵션 초안/); assert.deepEqual(reopened, content);
      assert.deepEqual(content.seoTitleDocument, policy(content));
      const q = await quote(f);
      assert.equal(q.categoryContext.profileId, f.profile.id);
      assert.equal(q.categoryContext.categoryId, f.profile.categoryId);
      for (const row of q.automatic.rows) assert.equal(row.fields.title.value, content.seo.title.value);
      assert.equal(content.label.productName.value, content.seo.title.value, 'existing first label link remains unchanged');
      assert.equal(f.product().title, '抽屉收纳盒'); assert.equal(f.product().source_url, f.sourceUrl);
      assert.equal(f.product().exchange_rate, 350); assert.equal(options.rows[0].unitCostCny, 5.5);
      assert.deepEqual(table(f, 'collection_results').find(row => row.job_id === f.job.id), plain(f.original));
      assert.deepEqual(table(f, 'collection_context').find(row => row.job_id === f.job.id), plain(f.context));
      assert.equal(f.queries.length, 2); assert.equal(f.sourceRequests.length, 1); assert.equal(f.h.aiSources.length, 0);
      assert.equal(f.product().supplier_hub_status, '미전송');
    } finally { f.close(); }
  });

  for (const title of ['직접 확인한 옵션 견적 제목', '']) test(`${company.code}: canonical preview/apply/reopen preserves scoped common quotation overrides and ${title ? 'manual title' : 'manual blank'}`, async () => {
    const f = await prepared(company);
    try {
      const optionId = seedQuotation(f, title), beforeContent = await f.content(), beforeOptions = await f.options(), beforeProduct = plain(f.product());
      const allBefore = snapshot(f), retained = snapshot(f, { retained: true }), files = JSON.stringify([...f.h.objects]), calls = f.h.network.length;
      const reviewed = await preview(f);
      assert.equal(snapshot(f), allBefore, 'preview writes neither the first document proof nor any table');
      const ack = await apply(f, reviewed), saved = await f.content(), options = await f.options();
      assert.deepEqual(saved.seoTitleDocument, policy(saved)); assert.equal(saved.seo.title.updatedAt, ack.productVersion);
      assert.deepEqual(await f.content(), saved);
      assert.deepEqual(saved.label, beforeContent.label); assert.deepEqual(saved.detail, beforeContent.detail); assert.deepEqual(saved.assets, beforeContent.assets);
      assert.deepEqual(saved.seo.description, beforeContent.seo.description);
      assert.equal(saved.detailDescriptionLinked, false); assert.equal(saved.labelProductNameLinked, false);
      for (const row of options.rows) {
        const before = beforeOptions.rows.find(value => value.id === row.id);
        for (const key of Object.keys(before).filter(key => !['translatedName', 'color', 'size', 'provenance', 'updatedAt'].includes(key)))
          assert.deepEqual(row[key], before[key], 'saved price/packaging/source ' + key);
        for (const key of Object.keys(before.provenance).filter(key => !['translatedName', 'color', 'size'].includes(key)))
          assert.deepEqual(row.provenance[key], before.provenance[key]);
      }
      for (const key of Object.keys(beforeProduct).filter(key => !['updated_at', 'quote_status'].includes(key)))
        assert.deepEqual(f.product()[key], beforeProduct[key], 'product source/price ' + key);
      const q = await quote(f);
      for (const row of q.automatic.rows) assert.equal(row.fields.title.value, saved.seo.title.value);
      assert.equal(q.resolved.rows.find(row => row.optionId === optionId).fields.title.value, title);
      assert.equal(q.overrides.common.title, '직접 확인한 공통 견적 이름'); assert.equal(q.overrides.common.searchTags, '');
      assert.equal(snapshot(f, { retained: true }), retained, 'quotation/source/settings/receipt/provider history remain byte-identical');
      assert.equal(JSON.stringify([...f.h.objects]), files); assert.equal(f.h.network.length, calls);
    } finally { f.close(); }
  });

  for (const title of ['나중 직접 확인한 상품명', '']) test(`${company.code}: actual initial keywords use the protected ${title ? 'title' : 'manual blank'} and its existing clock`, async () => {
    const f = await prepared(company, { seo: { title } });
    try {
      const before = await f.content(), reviewed = await preview(f);
      assert.ok(!reviewed.preview.some(row => row.name.startsWith('상품명')));
      assert.ok(reviewed.preview.some(row => row.name.startsWith('검색어')));
      await apply(f, reviewed); const saved = await f.content();
      assert.deepEqual(saved.seo.title, before.seo.title); assert.deepEqual(saved.seoTitleDocument, policy(before));
      for (const row of (await quote(f)).automatic.rows) assert.equal(row.fields.title.value, title);
    } finally { f.close(); }
  });

  test(`${company.code}: later manual title/tags including blanks remain protected and create no new policy`, async () => {
    const f = await prepared(company);
    try {
      const content = await f.content();
      await json(await f.h.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision,
        patch: { seo: { title: '', keywords: [] } } } }));
      const before = await f.content(), reviewed = await preview(f);
      assert.ok(!reviewed.preview.some(row => row.name.startsWith('상품명') || row.name.startsWith('검색어')));
      assert.ok(reviewed.preview.length > 0); await apply(f, reviewed);
      const saved = await f.content(); assert.equal(saved.seoTitleDocument, undefined);
      assert.deepEqual(saved.seo, before.seo); assert.deepEqual(saved.detail, before.detail); assert.deepEqual(saved.label, before.label);
    } finally { f.close(); }
  });

  test(`${company.code}: same-value eligible initial SEO creates no policy when only other translation changes`, async () => {
    const f = await prepared(company);
    try {
      const api = f.h.load('app/seo-guidance-composition.ts'), memo = { brand: f.settings.brand, features: f.features, keywords: f.keywords, title: '' };
      seedContent(f, content => {
        content.seo.title.value = api.seoGuidanceTitle(f.initial.result.draft, memo); content.seo.title.provenance = 'unverified';
        content.seo.keywords.value = plain(api.seoGuidanceTags(f.initial.result.draft, memo).tags); content.seo.keywords.provenance = 'unverified';
        delete content.intakeKeywordSeed;
      });
      const before = await f.content(), reviewed = await preview(f);
      assert.ok(reviewed.preview.length > 0);
      assert.ok(!reviewed.preview.some(row => row.name.startsWith('상품명') || row.name.startsWith('검색어')));
      await apply(f, reviewed); const saved = await f.content(); assert.equal(saved.seoTitleDocument, undefined);
      assert.deepEqual(saved.seo.title, before.seo.title); assert.deepEqual(saved.seo.keywords, before.seo.keywords);
    } finally { f.close(); }
  });

  test(`${company.code}: no-change canonical preview and rejected apply leave the policy and all tables untouched`, async () => {
    const f = await prepared(company, { seo: { title: '직접 상품명', keywords: [] } });
    try {
      freezeOtherCandidates(f); const before = snapshot(f), reviewed = await preview(f);
      assert.deepEqual(reviewed.preview, []); assert.equal(snapshot(f), before);
      await apply(f, reviewed, body(f), 409); assert.equal(snapshot(f), before);
      assert.equal((await f.content()).seoTitleDocument, undefined);
    } finally { f.close(); }
  });

  test(`${company.code}: description-only first SEO cannot establish a title document policy`, async () => {
    const f = await prepared(company, { seo: { title: '보호된 제목', keywords: [] }, protectDescription: false });
    try {
      freezeOtherCandidates(f); const before = await f.content(), reviewed = await preview(f);
      assert.deepEqual(reviewed.preview.map(row => row.name), ['상품 설명']);
      await apply(f, reviewed); const saved = await f.content(); assert.equal(saved.seoTitleDocument, undefined);
      assert.deepEqual(saved.seo.title, before.seo.title); assert.deepEqual(saved.seo.keywords, before.seo.keywords);
      assert.notDeepEqual(saved.seo.description, before.seo.description); assert.deepEqual(saved.detail, before.detail);
    } finally { f.close(); }
  });

  test(`${company.code}: options-only initial result keeps SEO and legacy document conversion separate`, async () => {
    const f = await prepared(company);
    try {
      const before = await f.content(), request = { ...body(f), scope: 'options' }, reviewed = await preview(f, request);
      assert.ok(reviewed.preview.length > 0); await apply(f, reviewed, request);
      const saved = await f.content(), options = await f.options(); assert.deepEqual(saved.seo, before.seo); assert.equal(saved.seoTitleDocument, undefined);
      for (const row of (await quote(f)).automatic.rows) {
        const option = options.rows.find(option => option.id === row.optionId);
        assert.equal(row.fields.title.value, option?.translatedName ? saved.seo.title.value + ', ' + option.translatedName : saved.seo.title.value);
      }
    } finally { f.close(); }
  });

  test(`${company.code}: a noncanonical manual translation still uses the legacy title fallback`, async () => {
    const f = await prepared(company);
    try {
      const independent = await independentJob(f), request = { jobId: independent.id, expectedVersion: f.product().updated_at }, reviewed = await preview(f, request);
      assert.notEqual(independent.id, f.initial.id); await apply(f, reviewed, request);
      const saved = await f.content(), options = await f.options(); assert.equal(saved.seoTitleDocument, undefined);
      for (const row of (await quote(f)).automatic.rows) {
        const option = options.rows.find(option => option.id === row.optionId);
        assert.equal(row.fields.title.value, option?.translatedName ? saved.seo.title.value + ', ' + option.translatedName : saved.seo.title.value);
      }
    } finally { f.close(); }
  });

  test(`${company.code}: collect-only preserves the source draft without SEO generation, application or document policy`, async () => {
    const f = await fixture(company, { goal: 'collect' });
    try {
      await f.intake(); const saved = await f.content();
      assert.equal(saved.seoTitleDocument, undefined); assert.equal(saved.seo.title.provenance, 'collected');
      assert.equal(table(f, 'translation_jobs').length, 0); assert.equal(f.queries.length, 0);
      assert.ok(!f.h.calls.some(path => path.endsWith('/translation') || path.endsWith('/translation-apply')));
      assert.equal(f.product().supplier_hub_status, '미전송');
    } finally { f.close(); }
  });

  test(`${company.code}: changed effective source or approved company rejects canonical preview/apply without writes`, async () => {
    for (const boundary of ['source', 'company']) {
      const f = await prepared(company);
      try {
        const reviewed = await preview(f);
        if (boundary === 'source') {
          const receipt = JSON.parse(f.original.payload); receipt.title = '변경된 합성 원문';
          f.h.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(JSON.stringify(receipt), f.job.id);
        } else f.h.setCompany(schemaCompanies.find(value => value.code !== company.code));
        const before = snapshot(f); await preview(f, body(f), 409); await apply(f, reviewed, body(f), 409);
        assert.equal(snapshot(f), before); assert.equal((await f.content()).seoTitleDocument, undefined);
      } finally { f.close(); }
    }
  });

  for (const boundary of ['product', 'content', 'options']) test(`${company.code}: atomic ${boundary} race cannot save the first SEO fields or document policy`, async () => {
    const f = await prepared(company);
    try {
      seedQuotation(f, ''); const reviewed = await preview(f), request = body(f), db = f.h.bindings.DB, prepare = db.prepare, batch = db.batch;
      let raced, races = 0;
      db.prepare = sql => { const statement = prepare(sql); statement.fixtureSql = sql; return statement; };
      db.batch = async statements => {
        if (!statements[0].fixtureSql?.includes('UPDATE products SET updated_at=') || !statements[0].fixtureSql.includes('options_count=')) return batch(statements);
        races++;
        if (boundary === 'product') f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2030-01-01T00:00:00.000Z', f.product().id);
        else {
          const row = f.h.sqlite.prepare('SELECT payload FROM product_' + boundary + ' WHERE product_id=?').get(f.product().id), payload = JSON.parse(row.payload);
          payload.revision++;
          f.h.sqlite.prepare('UPDATE product_' + boundary + ' SET revision=revision+1,payload=? WHERE product_id=?').run(JSON.stringify(payload), f.product().id);
        }
        raced = snapshot(f); return batch(statements);
      };
      await apply(f, reviewed, request, 409); assert.equal(races, 1); assert.equal(snapshot(f), raced);
      assert.equal((await f.content()).seoTitleDocument, undefined);
    } finally { f.close(); }
  });

  test(`${company.code}: late source-bound first replay stamps only untouched SEO and preserves later manual content`, async () => {
    const f = await prepared(company);
    try {
      const content = await f.content();
      await json(await f.h.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision,
        patch: { label: { material: '처음 생성 뒤 직접 검토한 재질' } } } }));
      const before = await f.content(), initial = JSON.stringify(f.initial), requests = f.h.network.length, reviewed = await preview(f);
      assert.ok(reviewed.preview.some(row => row.name.startsWith('상품명'))); await apply(f, reviewed);
      const saved = await f.content(); assert.deepEqual(saved.seoTitleDocument, policy(saved));
      assert.deepEqual(saved.label, before.label); assert.deepEqual(saved.detail, before.detail); assert.deepEqual(saved.seo.description, before.seo.description);
      assert.equal(JSON.stringify(await f.h.load('db/translation-jobs.ts').getTranslationJob('owner', f.product().id, f.initial.id)), initial);
      assert.equal(f.h.network.length, requests);
      for (const row of (await quote(f)).automatic.rows) assert.equal(row.fields.title.value, saved.seo.title.value);
    } finally { f.close(); }
  });
}
