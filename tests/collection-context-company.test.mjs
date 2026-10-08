import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';
import { hubSchemaSnapshot, schemaCompanies, schemaPath } from './helpers/hub-schema.mjs';

const json = async (response, status = 200) => {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
};
const stored = h => JSON.stringify(Object.fromEntries([
  'products', 'product_content', 'product_options', 'product_price_policy', 'product_quotation_fields',
  'category_profiles', 'collection_jobs', 'collection_context', 'collection_products', 'supplier_hub_receipts',
].map(table => [table, h.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])));

async function schemaLessDraft(company) {
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name });
  // Start through the real create route, rather than assigning identity to an
  // already captured fixture. Every database/object here belongs to this test.
  h.sqlite.prepare('DELETE FROM collection_context WHERE job_id=?').run('job');
  h.sqlite.prepare('DELETE FROM collection_jobs WHERE id=?').run('job');
  await h.load('db/queries.ts').saveSettings('owner', JSON.stringify(h.settings));
  const fields = ['skuId', 'categoryId', ...h.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field => field.id)];
  const bytes = quotationWorkbook(fields), sha256 = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const storageKey = h.load('db/category-templates.ts').templateKey('owner', sha256, 'xlsx');
  await h.bindings.FILES.put(storageKey, bytes, { customMetadata: { sha256, format: 'xlsx' } });
  const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', {
    name: '회사 별도 기록 수동 양식', categoryId: '80719', categoryPath: h.context.category.categoryPath,
    template: { name: 'synthetic.xlsx', format: 'xlsx', sha256, storageKey, sheetName: '견적서', headerRow: 1, headers: fields },
    mappings: fields.map((field, column) => ({ field, column, required: false })),
  });
  const queue = () => h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ urls: [h.sourceUrl], goal: 'price', profileId: profile.id, expectedProfileRevision: profile.revision }),
  }));
  const queued = await json(await queue()), job = queued.jobs[0];
  assert.deepEqual(job.context.company, company);
  assert.equal(job.context.category.hubSchema, undefined);
  await h.intake(job.id);
  const productId = h.sqlite.prepare('SELECT product_id FROM collection_products WHERE job_id=?').get(job.id).product_id;
  const base = '/api/products/' + productId;
  const content = (await json(await h.route(base + '/content'))).content;
  const images = h.sqlite.prepare('SELECT object_key FROM collection_images WHERE job_id=? ORDER BY image_index').all(job.id).map(row => row.object_key);
  await json(await h.route(base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision, patch: {
    label: { model: 'TEST-MODEL', material: '나일론' }, assets: { main: [images[0]], additional: [images[1]], detail: [images[2]], label: [images[3]] },
  } } }));
  const first = await json(await h.route(base + '/quotation-fields'));
  const saved = await json(await h.route(base + '/quotation-fields', { method: 'PUT', body: {
    expectedRevision: first.revision, expectedInputFingerprint: first.inputFingerprint, changes: [
      { optionId: null, fieldKey: 'title', value: '원래 회사에 저장한 견적 상품명' },
      { optionId: null, fieldKey: 'handlingReason', value: '해당사항없음' },
      { optionId: null, fieldKey: 'packagedWeightG', value: '420' },
      { optionId: null, fieldKey: 'packagedDimensionsMm', value: '100*200*300' },
      { optionId: null, fieldKey: 'storageMaterial', value: '' },
    ],
  } }));
  const preview = await json(await h.route(base + '/quotation', { method: 'POST', body: { action: 'preview' } }));
  assert.equal(preview.submissionReview.errorCount, 0);
  assert.deepEqual(preview.report.company, company);
  assert.equal(preview.report.rowCount, 6);
  return { h, profile, job, productId, base, saved, preview, queue };
}

for (const company of schemaCompanies) test(`schema-less API intake freezes approved company/defaults and rejects reassigned prepare/edit/receipt (${company.code})`, async () => {
  const f = await schemaLessDraft(company), { h, profile, job, productId, base, saved, preview } = f;
  try {
    const contextPayload = h.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get(job.id).payload;
    const original = stored(h), objects = [...h.objects].map(([key, bytes]) => [key, Buffer.from(bytes).toString('hex')]);
    const other = schemaCompanies.find(value => value.code !== company.code);
    h.setCompany(other);
    for (const suffix of ['', '?profileId=' + profile.id]) {
      const read = await json(await h.route(base + '/quotation-fields' + suffix), 409);
      assert.equal(read.code, 'QUOTATION_COMPANY_MISMATCH');
      const write = await json(await h.route(base + '/quotation-fields' + suffix, { method: 'PUT', body: {
        expectedRevision: saved.revision, expectedInputFingerprint: saved.inputFingerprint,
        changes: [{ optionId: null, fieldKey: 'title', value: '다른 회사가 덮어쓸 수 없는 이름' }],
      } }), 409);
      assert.equal(write.code, 'QUOTATION_COMPANY_MISMATCH');
    }
    assert.equal((await h.route(base + '/registration-settings')).status, 409);
    assert.equal((await h.route('/api/collection-jobs/' + job.id + '/product', { method: 'POST' })).status, 409);
    for (const action of ['source', 'preview', 'export', 'download']) {
      const rejected = await json(await h.route(base + '/quotation', { method: 'POST', body: {
        action, profileId: profile.id, ...(['export', 'download'].includes(action) ? { fingerprint: preview.fingerprint } : {}),
      } }), 409);
      assert.match(rejected.error, /현재 로그인 회사와 다릅니다/);
    }
    await json(await h.route(base + '/supplier-hub-receipt', { method: 'POST', body: {
      profileId: profile.id, categoryId: '80719', fingerprint: preview.fingerprint,
      result: { state: 'validation-complete', filename: preview.filename, company, includedOptions: 6,
        quotationId: 'synthetic-company-proof', observedAt: Date.now(), registered: false },
    } }), 409);
    assert.equal(stored(h), original, 'rejection changes no draft, source, company, default, asset or receipt');
    assert.deepEqual([...h.objects].map(([key, bytes]) => [key, Buffer.from(bytes).toString('hex')]), objects);

    h.setCompany(company);
    const resumed = await json(await h.route(base + '/quotation', { method: 'POST', body: { action: 'preview' } }));
    assert.equal(resumed.fingerprint, preview.fingerprint);
    assert.deepEqual(resumed.rows, preview.rows);
    assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get(job.id).payload, contextPayload);

    h.setCompany(other);
    await h.load('db/queries.ts').saveSettings('owner', JSON.stringify({ ...h.settings, importer: other.name }));
    const next = await json(await f.queue());
    assert.notEqual(next.jobs[0].id, job.id, 'known independent company can release only the disposable linked offer claim');
    assert.deepEqual(next.jobs[0].context.company, other);
    assert.equal(next.jobs[0].context.settings.importer, other.name);
    assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get(job.id).payload, contextPayload);
    assert.equal(h.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(productId).payload,
      JSON.parse(original).product_quotation_fields.find(row => row.product_id === productId).payload);
  } finally { h.close(); }
});

for (const company of schemaCompanies) test(`legacy schema company remains authoritative without backfilling its context (${company.code})`, async () => {
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name, capturedCompany: false });
  try {
    const schema = hubSchemaSnapshot(company), profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', {
      name: '기존 회사 기록 양식', categoryId: schema.categoryId, categoryPath: schemaPath, hubSchema: schema, template: null, mappings: [],
    });
    h.context.category = profile;
    h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context), 'job');
    await h.intake();
    const product = h.sqlite.prepare('SELECT * FROM products').get(), payload = h.sqlite.prepare('SELECT payload FROM collection_context').get().payload;
    const source = await h.load('app/exports/quotation-source.ts').readMappedQuotationSource('owner', product.id, null);
    assert.deepEqual(JSON.parse(JSON.stringify(source.company)), company);
    assert.equal(Object.hasOwn(JSON.parse(payload), 'company'), false);
    h.setCompany(schemaCompanies.find(value => value.code !== company.code));
    assert.equal((await h.route('/api/products/' + product.id + '/quotation-fields')).status, 409);
    await assert.rejects(() => h.load('app/exports/quotation-source.ts').readMappedQuotationSource('owner', product.id, null), /현재 로그인 회사와 다릅니다/);
    assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context').get().payload, payload);
  } finally { h.close(); }
});

test('truly unrecorded legacy company stays ambiguous and cannot become a transmittable quotation', async () => {
  const h = mobileIntakeHarness({ capturedCompany: false });
  try {
    await h.load('db/category-profiles.ts').createCategoryProfile('owner', h.context.category, 'cat');
    await h.intake();
    const product = h.sqlite.prepare('SELECT * FROM products').get(), base = '/api/products/' + product.id;
    const original = stored(h), source = await h.load('app/exports/quotation-source.ts').readQuotationExportSource('owner', product.id, null);
    assert.equal(source.company, null, 'today’s membership cannot establish a missing historical identity');
    const view = await json(await h.route(base + '/quotation-fields'));
    assert.equal(view.resolved.rows[0].fields.noticeManufacturerImporter.value.includes(h.context.settings.importer), true);
    await assert.rejects(() => h.load('app/exports/quotation-source.ts').readMappedQuotationSource('owner', product.id, null), /회사 코드·이름이 기록되지 않은 초안/);
    assert.equal((await h.route(base + '/quotation', { method: 'POST', body: { action: 'source' } })).status, 409);
    assert.equal(stored(h), original, 'ambiguous legacy records are neither inferred nor rewritten');
  } finally { h.close(); }
});

test('a pending company-less legacy URL stays preserved and explicitly reports the missing company capture', async () => {
  const h = mobileIntakeHarness({ capturedCompany: false });
  try {
    const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', h.context.category);
    h.context.category = profile;
    h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context), 'job');
    await h.load('db/queries.ts').saveSettings('owner', JSON.stringify(h.settings));
    const original = h.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get('job').payload;
    const result = await json(await h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        urls: [h.sourceUrl], goal: 'price', profileId: profile.id, expectedProfileRevision: profile.revision, keywords: h.context.keywords,
      }),
    })));
    assert.equal(result.jobs[0].id, 'job');
    assert.equal(Object.hasOwn(result.jobs[0].context, 'company'), false);
    assert.deepEqual(result.preservedRequests[0].differences, ['수집 당시 회사']);
    assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get('job').payload, original);
    assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM collection_jobs').get().n, 1);
  } finally { h.close(); }
});

test('a production schema-less intake with an invalid approved company pair stops before new capture', async () => {
  const company = schemaCompanies[0], other = schemaCompanies[1];
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: other.name });
  try {
    const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', h.context.category);
    const before = h.sqlite.prepare('SELECT * FROM collection_context').all();
    const rejected = await json(await h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        urls: [h.sourceUrl], profileId: profile.id, expectedProfileRevision: profile.revision,
      }),
    })), 409);
    assert.equal(rejected.code, 'COLLECTION_COMPANY_UNCONFIRMED');
    assert.deepEqual(h.sqlite.prepare('SELECT * FROM collection_context').all(), before);
    assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM collection_jobs').get().n, 1);
  } finally { h.close(); }
});

test('invalid or contradictory recorded company pairs are rejected before defaults are applied', () => {
  const h = mobileIntakeHarness();
  try {
    const reader = h.load('app/collection-company.ts').capturedCollectionCompany;
    for (const company of schemaCompanies) {
      const other = schemaCompanies.find(value => value.code !== company.code);
      assert.throws(() => reader({ company: { code: company.code, name: other.name } }), /회사 코드·이름/);
      assert.throws(() => reader({ company, category: { hubSchema: { company: other } } }), /회사 코드·이름/);
    }
  } finally { h.close(); }
});
