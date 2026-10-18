import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const companies = [{ companyCode: 'A01464742', companyName: '와이홉' }, { companyCode: 'A01526306', companyName: '유앤채' }];
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const product = h => h.sqlite.prepare('SELECT * FROM products').get();
const payload = (h, table) => JSON.parse(h.sqlite.prepare('SELECT payload FROM ' + table).get().payload);
const frozen = h => JSON.stringify({ context: h.sqlite.prepare('SELECT * FROM collection_context').all(), receipt: h.sqlite.prepare('SELECT * FROM collection_results').all(),
  jobs: h.sqlite.prepare('SELECT * FROM translation_jobs ORDER BY id').all(), policy: h.sqlite.prepare('SELECT * FROM product_price_policy').all() });

async function fixture(company) {
  const h = mobileIntakeHarness(company);
  try {
    const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', { name: '옵션 원문 수동 정정 재개', categoryId: '80719',
      categoryPath: h.context.category.categoryPath, template: null, mappings: [] }, '00000000-0000-4000-8000-000000000615');
    h.context.category = profile;
    h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context), 'job');
    await h.load('db/queries.ts').saveSettings('owner', JSON.stringify(h.settings));
    let rows = [{ ...h.load('app/intake-queue.ts').intakeRow(profile, 'row'), url: h.sourceUrl, keywords: h.context.keywords }];
    const fetcher = (path, init) => path === '/api/collection-jobs'
      ? h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test' + path, init))
      : h.route(path, { method: init?.method ?? 'GET', body: init?.body });
    const run = () => h.load('app/intake-queue.ts').submitIntakeQueue(rows, 'price', { signal: new AbortController().signal, fetcher, expectedSettings: h.settings,
      onJobs() {}, onRow(id, patch) { rows = rows.map(row => row.id === id ? { ...row, ...patch } : row); },
      collect: (job, progress, linked) => h.load('app/intake-collection.ts').collectIntakeProduct(job, { signal: new AbortController().signal, fetcher,
        onProgress: progress, onJob(updated) { if (updated.product_id) linked(updated.product_id); } }) });
    return { h, profile, run, get rows() { return rows; } };
  } catch (error) { h.close(); throw error; }
}

for (const company of companies) test(`a partial intake queue resumes after manual source-name edits without touching reviewed fields (${company.companyCode})`, async () => {
  const f = await fixture(company), { h } = f;
  try {
    h.stats.failImageIndex = 4;
    await f.run();
    assert.equal(f.rows[0].status, 'error'); assert.ok(f.rows[0].productId); assert.match(f.rows[0].message, /원본 5번/);
    assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_images').get().n, 18);
    const id = product(h).id, path = '/api/products/' + id;
    const view = await json(await h.route(path + '/options'));
    const rows = h.load('app/product-options.ts').optionInputs(view.options);
    rows[0].originalName = '직접 정정한 공급자 옵션명'; rows[0].unitCostCny = 15.1; rows[0].unitsPerPack = 3;
    rows[0].color = ''; rows[0].size = '직접 확인한 사이즈';
    rows[1].originalName = '직접 정정한 두 번째 원문'; rows[1].translatedName = '';
    rows[2].originalName = '제외한 옵션의 정정 원문'; rows[2].included = false;
    rows.splice(3, 1);
    await json(await h.route(path + '/options', { method: 'PATCH', body: { expectedRevision: view.options.revision, expectedProductVersion: view.productVersion, rows } }));
    const key = JSON.parse(product(h).image_keys)[0], png = [...h.objects.get(key)];
    await json(await h.route(path + '/content', { method: 'PATCH', body: { expectedRevision: payload(h, 'product_content').revision,
      patch: { label: { material: '직접 검토한 재질' }, assets: { label: [key] } } } }));
    const quote = await json(await h.route(path + '/quotation-fields'));
    await json(await h.route(path + '/quotation-fields', { method: 'PUT', body: { expectedRevision: quote.revision, expectedInputFingerprint: quote.inputFingerprint,
      changes: [{ fieldKey: 'salePrice', optionId: rows[0].id, value: '45000' }] } }));
    const before = { content: payload(h, 'product_content'), options: payload(h, 'product_options'), overrides: h.sqlite.prepare('SELECT * FROM product_quotation_fields').all() };
    const source = frozen(h), requests = h.aiSources.length, downloads = h.stats.downloads;
    h.stats.failImageIndex = null;
    await f.run();
    assert.equal(f.rows[0].status, 'saved', f.rows[0].message); assert.equal(f.rows[0].productId, id);
    assert.match(f.rows[0].message, /상품 초안 저장됨/); assert.equal(h.aiSources.length, requests);
    assert.equal(h.stats.downloads, downloads + 1); assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_images').get().n, 19);
    const afterContent = payload(h, 'product_content');
    assert.equal(afterContent.revision, before.content.revision + 1, 'only the missing image import advances the content clock');
    assert.deepEqual({ ...afterContent, revision: before.content.revision, updatedAt: before.content.updatedAt }, before.content);
    assert.deepEqual(payload(h, 'product_options'), before.options);
    assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_quotation_fields').all(), before.overrides);
    assert.equal(frozen(h), source); assert.deepEqual([...h.objects.get(key)], png);
    const after = await json(await h.route(path + '/quotation-fields'));
    const first = after.resolved.rows.find(row => row.optionId === rows[0].id);
    assert.equal(first.fields.salePrice.value, '45000'); assert.equal(first.fields.salePrice.source, 'manual-option');
    assert.equal(first.fields.labelImages.value, key); assert.equal(first.fields.noticeMaterial.value, '해당사항없음');
    assert.equal(afterContent.label.material.value, '직접 검토한 재질', 'source label edits survive independently of the fresh legal notice');
    const second = payload(h, 'product_options').rows.find(row => row.id === rows[1].id);
    assert.equal(second.translatedName, ''); assert.equal(second.provenance.translatedName, 'manual');
    assert.equal(product(h).supplier_hub_status, '미전송'); assert.ok(!h.network.includes('supplier.coupang.com'));
  } finally { h.close(); }
});

test('canonical replay skips only a manually changed source-name result that is no longer a translation target', async () => {
  const h = mobileIntakeHarness();
  try {
    await h.intake();
    const options = payload(h, 'product_options'), saved = h.sqlite.prepare("SELECT id FROM translation_jobs WHERE idempotency_key='intake-auto-v1'").get();
    const job = await h.load('db/translation-jobs.ts').getTranslationJob('owner', options.productId, saved.id);
    const replay = h.load('app/intake-translation-replay.ts').intakeTranslationReplayJob;
    assert.equal(replay(job, options), job, 'unchanged originals preserve the saved planning identity');
    const changed = structuredClone(options), row = changed.rows[0]; row.originalName = '직접 정정'; row.provenance.originalName = 'manual';
    const before = JSON.stringify({ job, changed });
    const next = replay(job, changed), binding = `option:${row.id}`;
    assert.equal(next.result.draft.attributes.length, job.result.draft.attributes.length - 1);
    assert.ok(!next.result.draft.attributes.some(attribute => job.review.source.attributes[attribute.sourceIndex].name === binding));
    for (const name of [`option-color:${row.id}`, `option-size:${row.id}`]) assert.ok(next.result.draft.attributes.some(attribute => job.review.source.attributes[attribute.sourceIndex].name === name));
    assert.equal(JSON.stringify({ job, changed }), before, 'neither saved job nor options are rewritten');
    row.translatedName = ''; row.provenance.translatedName = 'manual';
    assert.equal(replay(job, changed).result.draft.attributes.length, next.result.draft.attributes.length, 'explicit manual blank is complete local input');
    row.provenance.translatedName = 'unverified';
    assert.equal(replay(job, changed), job, 'a changed original still awaiting translation cannot reuse the old result');
    row.translatedName = '기존 한국어'; row.provenance.originalName = 'collected';
    assert.equal(replay(job, changed), job, 'unproved source changes stay strict');
  } finally { h.close(); }
});

test('ordinary adoption remains strict for changed originals and replay keeps color/size source guards', async () => {
  const h = mobileIntakeHarness();
  try {
    await h.intake();
    const options = payload(h, 'product_options'), saved = h.sqlite.prepare("SELECT id FROM translation_jobs WHERE idempotency_key='intake-auto-v1'").get();
    const original = await h.load('db/translation-jobs.ts').getTranslationJob('owner', options.productId, saved.id);
    const job = { ...original, productVersion: product(h).updated_at }, adoption = h.load('app/option-translation.ts').adoptOptionTranslations;
    const changed = structuredClone(options), row = changed.rows[0]; row.originalName = '직접 정정'; row.provenance.originalName = 'manual';
    assert.throws(() => adoption(changed, job, job.productVersion, true), /원문이나 연결이 변경/);
    const replay = h.load('app/intake-translation-replay.ts').intakeTranslationReplayJob(job, changed);
    for (const field of ['color', 'size']) {
      const stale = structuredClone(changed); stale.rows[0][field] = '다른 수집 원문'; stale.rows[0].provenance[field] = 'collected';
      assert.throws(() => adoption(stale, replay, replay.productVersion, true), /원문이나 연결이 변경/, field);
      stale.rows[0].provenance[field] = 'manual';
      assert.equal(adoption(stale, replay, replay.productVersion, true).rows[0][field], '다른 수집 원문', field + ' manual value is protected');
    }
  } finally { h.close(); }
});
