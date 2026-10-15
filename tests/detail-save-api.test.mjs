import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { companies, json } from './helpers/image-download-ui.mjs';
import { makeCompositeFixture, loadComposite } from './helpers/detail-image-composite.mjs';
import { hubSchemaSnapshot } from './helpers/hub-schema.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';
import { createHash } from 'node:crypto';

const plain = value => JSON.parse(JSON.stringify(value));
const signal = () => new AbortController().signal;
async function fixture(company, { wire = false, excluded = false } = {}) {
  const f = await makeCompositeFixture(company, { count: 4, manualHtml: '<p>옵션별 수동 HTML &amp; 백업</p>' });
  const original = f.request;
  f.request = async (url, init = {}) => {
    if (!url.includes('/detail-save')) return original(url, init);
    f.calls.push({ url, init });
    return f.api.load('app/api/products/[id]/detail-save/route.ts')[init.method ?? 'GET'](new Request('https://app.test' + url, init), { params: Promise.resolve({ id: f.product.id }) });
  };
  const profileId = f.view.categoryContext.profileId, qurl = f.base + '/quotation-fields?profileId=' + profileId;
  if (wire) {
    const profiles = f.api.load('db/category-profiles.ts'), profile = await profiles.getCategoryProfile('owner', profileId);
    const live = { ...hubSchemaSnapshot({ code: company.companyCode, name: company.companyName }, profile.categoryId), categoryPath: profile.categoryPath,
      inputBindings: 'couplus-paths-v1' };
    const raw = JSON.parse(live.schemaString);
    raw.properties.imagePage.properties.details = { type: 'object', properties: {
      detailedImage: { type: 'string', title: '상세 이미지' }, htmlProductDetailContent: { type: 'string', title: 'HTML 상세 내용' },
    } };
    live.schemaString = JSON.stringify(raw);
    const fields = f.api.load('app/quotation-schema.ts').getQuotationSchema(profile.categoryId, profile.categoryPath, live).fields.map(field => field.id);
    const workbook = quotationWorkbook(fields), sha256 = createHash('sha256').update(workbook).digest('hex'), storageKey = f.api.load('db/category-templates.ts').templateKey('owner', sha256, 'xlsx');
    f.api.objects.set(storageKey, new Uint8Array(workbook));
    const next = await profiles.updateCategoryProfile('owner', profileId, profile.revision, { ...profile, hubSchema: live,
      template: { ...profile.template, sha256, storageKey, headers: fields }, mappings: fields.map((field, column) => ({ field, column, required: false })) });
    const row = f.api.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get('job'), context = JSON.parse(row.payload);
    context.category = next; f.api.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(context), 'job');
  }
  if (excluded) {
    const saved = await json(await f.api.route(f.base + '/options'));
    const rows = f.api.load('app/product-options.ts').optionInputs(saved.options); rows[1].included = false;
    await json(await f.api.route(f.base + '/options', { method: 'PATCH', body: { expectedRevision: saved.options.revision, expectedProductVersion: saved.productVersion, rows } }));
  }
  f.view = await json(await f.api.route(qurl));
  const targets = f.api.load('app/quotation-image-targets.ts').optionImageTargets(f.view.resolved.schema.fields);
  f.view = await json(await f.api.route(qurl, { method: 'PUT', body: { expectedRevision: f.view.revision, expectedInputFingerprint: f.view.inputFingerprint, changes: [
    ...targets.detailImages.linked.map(fieldKey => ({ optionId: f.optionId, fieldKey, value: f.selectedKeys.join('\n') })),
    ...targets.detailHtml.linked.map(fieldKey => ({ optionId: null, fieldKey, value: '<article>공통 수동 HTML</article>' })),
    ...targets.detailHtml.linked.map(fieldKey => ({ optionId: f.optionId, fieldKey, value: '<p>옵션별 수동 HTML &amp; 백업</p>' })),
    ...(excluded ? targets.detailHtml.linked.map(fieldKey => ({ optionId: f.view.resolved.rows.filter(row => row.optionId)[1].optionId, fieldKey, value: '' })) : []),
  ] } }));
  const endpoint = f.base + '/detail-save?profileId=' + profileId;
  const runtime = loadComposite(f), source = () => ({ productId: f.product.id, optionId: f.optionId, profileId, view: f.view });
  const prepare = async () => runtime.helper.prepareDetailComposite(source(), signal(), f.request);
  const upload = async prepared => {
    const form = new FormData(); form.set('file', new File([prepared.output], 'sourceflow-quotation-label.png', { type: 'image/png' })); form.set('labelUploadId', prepared.uploadId);
    const response = await f.request('/api/files', { method: 'POST', body: form }); assert.equal(response.status, 201, await response.clone().text());
    return { expectedRevision: prepared.view.revision, expectedInputFingerprint: prepared.view.inputFingerprint, sourceOptionId: prepared.optionId,
      uploadId: prepared.uploadId, sha256: prepared.sha256, bytes: prepared.output.size };
  };
  const post = body => f.request(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const recover = uploadId => f.request(endpoint + '&uploadId=' + uploadId);
  const sourceRows = () => JSON.stringify(['product_content', 'product_options', 'product_price_policy', 'collection_context', 'category_profiles'].map(table => f.api.sqlite.prepare('SELECT * FROM ' + table).all()));
  const full = () => JSON.stringify([f.retained(), f.originals(), f.api.sqlite.prepare('SELECT * FROM members').all(), f.api.sqlite.prepare('SELECT * FROM workspace_settings').all()]);
  const statementSql = new WeakMap(), originalPrepare = f.api.db.prepare;
  f.api.db.prepare = sql => { const statement = originalPrepare(sql); statementSql.set(statement, sql); return statement; };
  const isDetailBatch = statements => statements.some(statement => statementSql.get(statement)?.startsWith('UPDATE product_quotation_fields SET revision=CASE WHEN EXISTS'));
  return { ...f, qurl, endpoint, runtime, targets, prepare, upload, post, recover, sourceRows, full, isDetailBatch };
}
const state = f => JSON.parse(f.api.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload);

for (const company of companies) test(`atomic detail save writes canonical and exact primary common/all-option fields including excluded options and preserves scoped backups (${company.companyCode})`, async () => {
  const f = await fixture(company, { wire: true, excluded: true });
  try {
    const plan = f.api.load('app/detail-save-plan.ts'), beforeView = plain(f.view), beforeSource = f.sourceRows();
    assert.deepEqual(plain(f.targets.detailImages.primaryField.hubWire.path), ['imagePage', 'details', 'detailedImage']);
    assert.deepEqual(plain(f.targets.detailHtml.primaryField.hubWire.path), ['imagePage', 'details', 'htmlProductDetailContent']);
    assert.ok(beforeView.resolved.rows.some(row => row.optionId && !row.included));
    const row = f.api.sqlite.prepare('SELECT payload FROM product_quotation_fields').get(), savedState = JSON.parse(row.payload);
    savedState.categoryOverrides['category:991234'] = { common: { detailHtml: '<p>다른 카테고리 원문</p>' }, options: {} };
    f.api.sqlite.prepare('UPDATE product_quotation_fields SET payload=?').run(JSON.stringify(savedState));
    const prepared = await f.prepare(), body = await f.upload(prepared), files = f.originals();
    const result = await json(await f.post(body)), key = result.receipt.key;
    assert.equal(result.quotation.revision, beforeView.revision + 1); assert.equal(result.receipt.beforeRevision, beforeView.revision);
    assert.deepEqual(result.receipt.optionIds, beforeView.resolved.rows.flatMap(row => row.optionId ? [row.optionId] : []));
    assert.equal(result.receipt.sourceOptionId, f.optionId); assert.equal(result.receipt.sha256, prepared.sha256);
    assert.deepEqual(result.quotation.imageKeys, [...beforeView.imageKeys, key]);
    assert.equal(result.quotation.contentRevision, beforeView.contentRevision); assert.equal(result.quotation.optionRevision, beforeView.optionRevision);
    const expectedChanges = plain(plan.detailSaveChanges(beforeView, key));
    for (const change of expectedChanges) {
      const layer = change.optionId === null ? result.quotation.overrides.common : result.quotation.overrides.options[change.optionId];
      assert.equal(layer[change.fieldKey], change.value);
      if (change.optionId) assert.equal(result.quotation.resolved.rows.find(row => row.optionId === change.optionId).fields[change.fieldKey].value, change.value);
    }
    const after = state(f), history = after.detailSaveBackups['category:80719'];
    assert.equal(history.length, 1); assert.deepEqual(history[0].receipt, result.receipt);
    assert.deepEqual(history[0].before, plain(plan.detailSaveManualBackup(beforeView, expectedChanges)));
    assert.deepEqual(history[0].sources, plain(prepared.sources));
    assert.equal(history[0].beforeInputFingerprint, beforeView.inputFingerprint); assert.equal(history[0].beforeProductVersion, beforeView.productVersion);
    assert.equal(history[0].updatedAt, result.quotation.productVersion); assert.equal(after.updatedAt, result.quotation.productVersion);
    assert.ok(history[0].before.some(change => change.value === null)); assert.ok(history[0].before.some(change => change.value === ''));
    assert.ok(history[0].before.some(change => change.value === '<p>옵션별 수동 HTML &amp; 백업</p>'));
    assert.deepEqual(after.categoryOverrides['category:991234'], savedState.categoryOverrides['category:991234']);
    const expected = plain(f.api.load('app/quotation-schema.ts').applyQuotationChanges(beforeView.overrides, expectedChanges));
    assert.deepEqual(result.quotation.overrides, expected); assert.equal(f.sourceRows(), beforeSource); assert.equal(f.originals(), files);
    assert.equal(f.calls.filter(call => call.url.endsWith('/attachments')).length, 0);
    assert.equal(f.product.supplier_hub_status, '미전송');
    const baseline = f.full(), recovered = await json(await f.recover(prepared.uploadId));
    assert.equal(recovered.applied, true); assert.deepEqual(recovered.receipt, result.receipt); assert.equal(f.full(), baseline);
    assert.ok(!Object.hasOwn(recovered.quotation, 'detailSaveBackups'), 'ordinary view never exposes backup histories');
    const exported = await f.exportQuote(), reader = f.api.load('app/xlsx-template.ts');
    const uploadPlan = JSON.parse(new TextDecoder().decode(exported.archive.get('supplier-hub-upload-plan.json')));
    const sheet = reader.inspectXlsxArchive(await reader.readXlsxArchive(exported.archive.get(uploadPlan.quotation.file.filename)));
    const headers = reader.xlsxHeaders(sheet, '견적서', 1), filename = exported.document.uploadFilenames[key];
    assert.equal(exported.document.rows.length, beforeView.resolved.rows.filter(row => row.included).length); assert.ok(exported.document.rows.length > 0);
    for (const [index, row] of exported.document.rows.entries()) if (row.included) {
      const cells = reader.xlsxHeaders(sheet, '견적서', index + 2);
      assert.equal(cells[headers.indexOf(f.targets.detailImages.primary)], filename);
      assert.equal(cells[headers.indexOf(f.targets.detailHtml.primary)], '');
    }
    assert.deepEqual(Buffer.from(exported.archive.get('assets/' + filename)), Buffer.from(await prepared.output.arrayBuffer()));
    const archived = JSON.parse(new TextDecoder().decode(exported.archive.get('quotation-saved-scopes.json')));
    assert.ok(JSON.stringify(archived).includes('옵션별 수동 HTML &amp; 백업'));
  } finally { f.api.close(); }
});

for (const company of companies) test(`an exact repeated POST is read-only while collisions and later manual edits conflict (${company.companyCode})`, async () => {
  const f = await fixture(company);
  try {
    const prepared = await f.prepare(), body = await f.upload(prepared), saved = await json(await f.post(body)), baseline = f.full();
    const batch = f.api.db.batch; let mutations = 0;
    f.api.db.batch = async statements => { if (f.isDetailBatch(statements)) mutations++; return batch(statements); };
    assert.deepEqual(await json(await f.post(body)), saved); assert.equal(mutations, 0); assert.equal(f.full(), baseline);
    for (const bad of [{ ...body, bytes: body.bytes + 1 }, { ...body, sha256: 'a'.repeat(64) }, { ...body, sourceOptionId: 'wrong-option' }, { ...body, expectedInputFingerprint: 'b'.repeat(64) }])
      assert.equal((await f.post(bad)).status, 409);
    assert.equal(f.full(), baseline); assert.equal(mutations, 0);
    const view = saved.quotation;
    await json(await f.api.route(f.qurl, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
      changes: [{ optionId: f.optionId, fieldKey: 'brand', value: '저장 후 직접 수정' }] } }));
    const changed = f.full(); assert.equal((await f.post(body)).status, 409); assert.equal((await f.recover(body.uploadId)).status, 409); assert.equal(f.full(), changed);
  } finally { f.api.close(); }
});

for (const company of companies) test(`source and exact old quotation payload races make the final detail batch a complete no-op (${company.companyCode})`, async () => {
  for (const race of ['quotation-payload', 'options', 'settings', 'member']) {
    const f = await fixture(company);
    try {
      if (race === 'member') {
        f.api.bindings.YOOFAM_AUTH_ENABLED = 'true'; const email = company.companyCode === 'A01526306' ? 'jwhj1116@kakao.com' : 'unari8484@gmail.com';
        const now = new Date().toISOString(); f.api.sqlite.prepare('INSERT INTO members VALUES(?,?,?,?,?,?,?,?,?,?)').run('owner', email, 'fixture', company.companyCode === 'A01526306' ? 'admin' : 'member', 'approved', company.companyCode, company.companyName, now, now, null);
      }
      const prepared = await f.prepare(), body = await f.upload(prepared), batch = f.api.db.batch; let raced = false, baseline;
      f.api.db.batch = async statements => {
        if (!raced && f.isDetailBatch(statements)) {
          raced = true;
          if (race === 'quotation-payload') { const next = state(f); next.categoryOverrides['category:80719'].common.brand = '동일 revision의 새 수정'; f.api.sqlite.prepare('UPDATE product_quotation_fields SET payload=?').run(JSON.stringify(next)); }
          if (race === 'options') { const row = f.api.sqlite.prepare('SELECT payload FROM product_options').get(), value = JSON.parse(row.payload); value.revision++; f.api.sqlite.prepare('UPDATE product_options SET revision=?,payload=?').run(value.revision, JSON.stringify(value)); }
          if (race === 'settings') f.api.sqlite.prepare('INSERT INTO workspace_settings(owner_id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at')
            .run('owner', JSON.stringify({ ...f.api.settings, brand: '새 공통 설정' }), new Date().toISOString());
          if (race === 'member') f.api.sqlite.prepare("UPDATE members SET status='suspended' WHERE id='owner'").run();
          baseline = f.full();
        }
        return batch(statements);
      };
      assert.equal((await f.post(body)).status, 409, race); assert.equal(raced, true); assert.equal(f.full(), baseline);
      assert.equal(state(f).detailSaveBackups, undefined);
    } finally { f.api.close(); }
  }
});

test('product companion aborts or ignored updates roll back the image, every quote edit and its backup together', async () => {
  for (const fault of ['ABORT', 'IGNORE']) {
    const f = await fixture(companies[0]);
    try {
      const prepared = await f.prepare(), body = await f.upload(prepared), baseline = f.full();
      f.api.sqlite.exec(`CREATE TRIGGER fail_detail_product BEFORE UPDATE ON products BEGIN SELECT RAISE(${fault}${fault === 'ABORT' ? ", 'fixture product companion'" : ''}); END`);
      assert.equal((await f.post(body)).status, 503); assert.equal(f.full(), baseline);
      assert.equal((await json(await f.recover(body.uploadId))).applied, false); assert.equal(f.full(), baseline);
      f.api.sqlite.exec('DROP TRIGGER fail_detail_product');
      const saved = await json(await f.post(body)); assert.equal(saved.quotation.revision, f.view.revision + 1); assert.equal(state(f).detailSaveBackups['category:80719'].length, 1);
    } finally { f.api.close(); }
  }
});

test('source bytes, source clock and uploaded PNG metadata cannot be substituted after preview', async () => {
  for (const changed of ['source-bytes', 'source-clock', 'png-metadata', 'png-bytes']) {
    const f = await fixture(companies[0]);
    try {
      const prepared = await f.prepare(), body = await f.upload(prepared), key = f.api.load('app/label-upload-key.ts').labelUploadKey('owner', body.uploadId);
      if (changed === 'source-bytes') await f.api.bindings.FILES.put(f.selectedKeys[0], await sharp({ create: { width: 800, height: 1, channels: 4, background: '#000000' } }).png().toBuffer(), { httpMetadata: { contentType: 'image/png' } });
      if (changed === 'source-clock') f.api.sqlite.prepare('UPDATE products SET updated_at=?').run(new Date(Date.parse(f.view.productVersion) + 1).toISOString());
      if (changed === 'png-metadata') await f.api.bindings.FILES.put(key, await prepared.output.arrayBuffer(), { httpMetadata: { contentType: 'image/png' }, customMetadata: { labelUploadId: body.uploadId, labelBlobSha256: 'f'.repeat(64) } });
      if (changed === 'png-bytes') f.api.objects.set(key, new Uint8Array(await sharp({ create: { width: 800, height: 4, channels: 4, background: '#abcdef' } }).png().toBuffer()));
      const before = f.full(); assert.equal((await f.post(body)).status, 409); assert.equal(f.full(), before); assert.equal(state(f).detailSaveBackups, undefined);
    } finally { f.api.close(); }
  }
});

test('strict body, origin, profile, owner and company failures never attach or edit a detached preview', async () => {
  const f = await fixture(companies[0]);
  try {
    const prepared = await f.prepare(), body = await f.upload(prepared), before = f.full();
    for (const bad of [{ ...body, arbitrary: true }, { ...body, bytes: 0 }, { ...body, uploadId: 'wrong' }, { ...body, reviewed: true }, { ...body, expectedRevision: -1 }]) assert.equal((await f.post(bad)).status, 400);
    const route = f.api.load('app/api/products/[id]/detail-save/route.ts'), context = { params: Promise.resolve({ id: f.product.id }) };
    assert.equal((await route.POST(new Request('https://app.test' + f.endpoint, { method: 'POST', headers: { origin: 'https://other.test' }, body: JSON.stringify(body) }), context)).status, 400);
    assert.equal((await f.request(f.endpoint + '&profileId=cat', { method: 'POST', body: JSON.stringify(body) })).status, 400);
    assert.equal((await route.POST(new Request('https://app.test' + f.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'not-owned-product' }) })).status, 404);
    f.api.setCompany({ code: companies[1].companyCode, name: companies[1].companyName }); assert.equal((await f.post(body)).status, 409);
    assert.equal(f.full(), before); assert.equal(state(f).detailSaveBackups, undefined);
  } finally { f.api.close(); }
});

test('backup-count and full-payload limits reject without pruning any retained backup or final field', async () => {
  for (const limit of ['count', 'bytes']) {
    const f = await fixture(companies[0]);
    try {
      const current = state(f), scope = 'category:80719';
      const backup = { receipt: { uploadId: 'a'.repeat(64), key: f.view.imageKeys[0], sha256: 'b'.repeat(64), bytes: 1, revision: 1, beforeRevision: 0,
        sourceOptionId: f.optionId, categoryId: '80719', optionIds: [f.optionId] }, before: [], sources: [], beforeProductVersion: f.view.productVersion, beforeInputFingerprint: f.view.inputFingerprint, updatedAt: f.view.productVersion };
      current.detailSaveBackups = { [scope]: limit === 'count' ? Array.from({ length: 5 }, (_, index) => ({ ...backup, receipt: { ...backup.receipt, uploadId: String(index + 1).repeat(64) } }))
        : [{ ...backup, before: [{ optionId: null, fieldKey: 'detailHtml', value: 'x'.repeat(512 * 1024) }] }] };
      f.api.sqlite.prepare('UPDATE product_quotation_fields SET payload=?').run(JSON.stringify(current));
      const prepared = await f.prepare(), body = await f.upload(prepared), before = f.full(), response = await f.post(body);
      assert.equal(response.status, 413, await response.clone().text()); assert.equal(f.full(), before); assert.deepEqual(state(f).detailSaveBackups, current.detailSaveBackups);
    } finally { f.api.close(); }
  }
});
