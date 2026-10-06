import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
const status = async (response, expected) => assert.equal(response.status, expected, await response.clone().text());
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function png(color = 200) {
  const chunk = (name, data) => {
    const joined = Buffer.concat([Buffer.from(name), data]); let crc = 0xffffffff;
    for (const byte of joined) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const size = Buffer.alloc(4), check = Buffer.alloc(4); size.writeUInt32BE(data.length); check.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, joined, check]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(3, 0); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(2 * (3 * 4 + 1), color); rows[0] = 0; rows[13] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
async function fixture({ count = 6, withOptions = true } = {}) {
  const h = mobileIntakeHarness(); h.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run(); await h.intake();
  const product = () => h.sqlite.prepare('SELECT * FROM products').get(), id = product().id, base = '/api/products/' + id;
  // Valid synthetic PNG pixels replace only this in-memory fixture's media.
  // No seller/customer images, real DB or external transmission is changed.
  const keys = JSON.parse(product().image_keys);
  keys.forEach((key, index) => h.objects.set(key, new Uint8Array(png(index))));
  const originalGet = h.bindings.FILES.get;
  h.bindings.FILES.get = async (key, options) => {
    const object = await originalGet(key); if (!object) return null;
    // Buffer.slice().buffer exposes the pooled backing allocation rather than
    // the object's bytes. Copy the fixture's exact Uint8Array view and return
    // only its byteLength for both stream and ArrayBuffer reads.
    const bytes = new Uint8Array(h.objects.get(key));
    return { ...object, arrayBuffer: async () => bytes.slice().buffer,
      body: new Response(options?.range ? bytes.slice(options.range.offset ?? 0, (options.range.offset ?? 0) + options.range.length) : bytes).body };
  };
  const originalPut = h.bindings.FILES.put;
  h.bindings.FILES.put = async (key, bytes, options) => {
    if (options?.customMetadata) assert.ok(new TextEncoder().encode(JSON.stringify(options.customMetadata)).length <= 8192, 'R2 output metadata must fit the actual platform limit');
    return originalPut(key, bytes, options);
  };
  const content = () => h.load('db/product-content.ts').readProductContent('owner', id);
  const options = () => h.load('db/product-options.ts').readProductOptions('owner', id);
  const sourceKey = keys[0], otherKey = keys[1];
  const beforeContent = await content();
  await h.load('db/product-content.ts').saveProductContent('owner', h.load('app/product-content.ts').applyContentPatch(beforeContent,
    { assets: { main: [sourceKey], additional: [keys[2]], detailTop: [keys[3]], detail: [keys[4]], detailBottom: [keys[5]], label: [keys[6]] } }, new Date().toISOString()), beforeContent.revision);
  if (withOptions) {
    const previous = await options(), model = h.load('app/product-options.ts'), inputs = model.optionInputs(previous);
    const rows = Array.from({ length: count }, (_, index) => ({ ...inputs[index % inputs.length], id: 'option-' + String(index).padStart(3, '0') + (count === 200 ? '-' + 'x'.repeat(69) : ''), supplierSku: 'SKU-' + index,
      translatedName: index === 0 ? '' : '검토 옵션 ' + index, imageKey: index === 2 ? null : index === 3 ? otherKey : sourceKey, included: index !== 5,
      unitCostCny: index === 5 ? null : 1.2 + index, unitsPerPack: index === 1 ? 2 : 1, color: index === 1 ? '' : inputs[index % inputs.length].color }));
    await h.load('db/product-options.ts').saveProductOptions('owner', model.applyOptionRows(previous, rows, new Date().toISOString()), previous.revision, product().updated_at);
  } else h.sqlite.prepare('DELETE FROM product_options WHERE product_id=?').run(id);
  const route = h.load('app/api/products/[id]/image-text/route.ts'), context = { params: Promise.resolve({ id }) };
  const request = (method, body, role = 'main') => route[method](new Request('https://app.test' + base + '/image-text' + (method === 'GET' ? '?' + new URLSearchParams({ sourceKey, role }) : ''),
    { method, ...(body === undefined ? {} : { body, ...(body instanceof FormData ? {} : { headers: { 'content-type': 'application/json' } }) }) }), context);
  const source = async (role = 'main') => (await json(await request('GET', undefined, role))).source;
  const form = (source, selected) => { const value = new FormData(); value.set('action', 'apply'); value.set('source', JSON.stringify(source));
    value.set('file', new File([png(90)], 'translated.png', { type: 'image/png' })); if (selected !== undefined) value.set('optionImageIds', JSON.stringify(selected)); return value; };
  const snapshot = async () => JSON.stringify({ product: product(), content: await content(), options: await options() });
  return { h, id, base, keys, sourceKey, otherKey, product, content, options, source, form, request, snapshot, close() { h.close(); } };
}

test('main source proof lists exact matching option image IDs, and other roles retain their prior proof shape', async () => {
  const f = await fixture(); try {
    const source = await f.source(), options = await f.options();
    assert.deepEqual(plain(source.optionImages), plain({ revision: options.revision, optionIds: options.rows.filter(row => row.imageKey === f.sourceKey).map(row => row.id).sort() }));
    const get = f.h.load('app/api/products/[id]/image-text/route.ts').GET;
    const other = await json(await get(new Request('https://app.test' + f.base + '/image-text?' + new URLSearchParams({ sourceKey: f.keys[2], role: 'additional' })), { params: Promise.resolve({ id: f.id }) }));
    assert.equal(other.source.optionImages, undefined);
  } finally { f.close(); }
});
test('selected option images and common main apply atomically; fallback rows use the output while unselected and unrelated rows retain their pictures and other facts', async () => {
  const f = await fixture(); try {
    const source = await f.source(), before = plain(await f.options()), beforeContent = plain(await f.content());
    const selected = ['option-001', 'option-000'], res = await f.request('POST', f.form(source, selected)), saved = await json(res), after = plain(await f.options());
    assert.deepEqual(saved.optionImageIds, [...selected].sort()); assert.equal(saved.optionRevision, before.revision + 1);
    assert.equal(after.revision, before.revision + 1); assert.equal(after.updatedAt, saved.productVersion);
    for (const row of after.rows) {
      const previous = before.rows.find(old => old.id === row.id);
      const expected = selected.includes(row.id) ? { ...previous, imageKey: saved.key, provenance: { ...previous.provenance, imageKey: 'manual' }, updatedAt: saved.productVersion } : previous;
      assert.deepEqual(row, expected, row.id + ' preserves all non-image inputs and order');
    }
    const content = plain(await f.content()); assert.deepEqual(content.assets.main.value, [saved.key]);
    for (const role of ['additional', 'detailTop', 'detail', 'detailBottom', 'label', 'size']) assert.deepEqual(content.assets[role], beforeContent.assets[role]);
    assert.deepEqual(content.seo, beforeContent.seo); assert.deepEqual(content.label, beforeContent.label);
    const view = await json(await f.h.route(f.base + '/quotation-fields'));
    for (const row of view.resolved.rows) {
      if (row.optionId === null) { assert.equal(row.fields.mainImage.value, saved.key); assert.equal(row.included, false); continue; }
      const option = after.rows.find(option => option.id === row.optionId);
      assert.ok(option, 'each resolved SKU row has its original option');
      assert.equal(row.fields.mainImage.value, option.imageKey ?? saved.key);
    }
    const fallback = view.resolved.rows.find(row => row.optionId === 'option-002');
    assert.ok(fallback); assert.equal(fallback.included, true); assert.equal(after.rows.find(row => row.id === 'option-002').imageKey, null);
    assert.equal(fallback.fields.mainImage.value, saved.key, 'a real included SKU with no own image follows the changed common role');
    const metadata = await f.h.bindings.FILES.head(saved.key); assert.equal(metadata.customMetadata.dimensionValidation, 'header-v1');
    const checked = await f.h.load('app/quotation-image-review.ts').inspectQuotationImages(view.resolved, JSON.parse(f.product().image_keys), f.h.bindings.FILES.head);
    assert.match(checked.get(saved.key).message, /3×2px/); assert.doesNotMatch(checked.get(saved.key).message, /기록이 없습니다/);
    const repeated = await json(await f.request('POST', f.form(source, selected)));
    assert.equal(repeated.replayed, true); assert.equal(repeated.optionRevision, after.revision); assert.equal((await f.options()).revision, after.revision);
    assert.equal(f.product().supplier_hub_status, '미전송');
  } finally { f.close(); }
});
test('real handler adoption reaches final per-SKU XLSX cells and upload manifest with exact PNG bytes, while manual image/HTML overrides stay authoritative', async () => {
  const f = await fixture(); try {
    const beforeView = await json(await f.h.route(f.base + '/quotation-fields'));
    await json(await f.h.route(f.base + '/quotation-fields', { method: 'PUT', body: { expectedRevision: beforeView.revision, expectedInputFingerprint: beforeView.inputFingerprint, changes: [
      { fieldKey: 'mainImage', optionId: 'option-004', value: f.sourceKey }, { fieldKey: 'mainImage', optionId: 'option-005', value: '' },
      { fieldKey: 'additionalImages', optionId: 'option-001', value: f.otherKey }, { fieldKey: 'detailImages', optionId: 'option-001', value: f.keys[4] },
      { fieldKey: 'detailHtml', optionId: 'option-001', value: '<p>직접 작성한 상세 HTML</p>' },
    ] } }));
    const storedOverrides = f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(f.id).payload;
    const source = await f.source(), applied = await json(await f.request('POST', f.form(source, ['option-000', 'option-001', 'option-004', 'option-005'])));
    assert.equal(f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(f.id).payload, storedOverrides);
    const fields = ['skuId', 'categoryId', ...f.h.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field => field.id)];
    const workbook = quotationWorkbook(fields), sha256 = Buffer.from(await webcrypto.subtle.digest('SHA-256', workbook)).toString('hex');
    const storageKey = f.h.load('db/category-templates.ts').templateKey('owner', sha256, 'xlsx'); f.h.objects.set(storageKey, workbook);
    await f.h.load('db/category-profiles.ts').createCategoryProfile('owner', { name: '무료 이미지 옵션 전파 검증', categoryId: '80719', categoryPath: f.h.context.category.categoryPath,
      template: { name: 'image-option.xlsx', format: 'xlsx', sha256, storageKey, sheetName: '견적서', headerRow: 1, headers: fields },
      mappings: fields.map((field, column) => ({ field, column, required: false })) }, 'cat');
    const preview = await json(await f.h.route(f.base + '/quotation', { method: 'POST', body: { action: 'preview' } }));
    const exported = await f.h.route(f.base + '/quotation', { method: 'POST', body: { action: 'export', fingerprint: preview.fingerprint } }); await status(exported, 200);
    const reader = f.h.load('app/xlsx-template.ts'), files = await reader.readXlsxArchive(await exported.arrayBuffer());
    const plan = JSON.parse(new TextDecoder().decode(files.get('supplier-hub-upload-plan.json'))), document = JSON.parse(new TextDecoder().decode(files.get('quotation-fields.json')));
    const sheet = reader.inspectXlsxArchive(await reader.readXlsxArchive(files.get(plan.quotation.file.filename)));
    for (const [index, row] of document.rows.entries()) {
      const cells = reader.xlsxHeaders(sheet, '견적서', index + 2), key = row.optionId === 'option-004' ? f.sourceKey : row.optionId === 'option-003' ? f.otherKey : applied.key;
      assert.equal(row.fields.mainImage.value, key); assert.equal(cells[fields.indexOf('mainImage')], document.uploadFilenames[key]);
      if (row.optionId === 'option-001') { assert.equal(row.fields.additionalImages.source, 'manual-option'); assert.equal(row.fields.additionalImages.value, f.otherKey);
        assert.equal(cells[fields.indexOf('additionalImages')], document.uploadFilenames[f.otherKey]); assert.equal(cells[fields.indexOf('detailHtml')], '<p>직접 작성한 상세 HTML</p>'); }
    }
    const image = plan.productImages.find(image => image.key === applied.key); assert.ok(image); assert.equal(image.sha256, digest(png(90)));
    assert.deepEqual(Buffer.from(files.get(image.archivePath)), png(90)); assert.ok(image.references.some(ref => ref.optionId === 'option-000' && ref.fieldId === 'mainImage'));
    assert.ok(!image.references.some(ref => ref.optionId === 'option-004' && ref.fieldId === 'mainImage'));
    assert.equal(f.product().supplier_hub_status, '미전송');
  } finally { f.close(); }
});
test('common manual main and intentional option blank remain unchanged when selected matching option references are adopted', async () => {
  const f = await fixture(); try {
    const view = await json(await f.h.route(f.base + '/quotation-fields'));
    await json(await f.h.route(f.base + '/quotation-fields', { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
      changes: [{ fieldKey: 'mainImage', optionId: null, value: f.otherKey }, { fieldKey: 'mainImage', optionId: 'option-000', value: '' }] } }));
    const before = f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(f.id).payload;
    await json(await f.request('POST', f.form(await f.source(), ['option-000', 'option-001'])));
    const after = await json(await f.h.route(f.base + '/quotation-fields'));
    assert.equal(f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(f.id).payload, before);
    for (const row of after.resolved.rows) assert.equal(row.fields.mainImage.value, row.optionId === 'option-000' ? '' : f.otherKey);
  } finally { f.close(); }
});
test('empty selection and legacy proofs do not change options or create a missing option row', async () => {
  for (const mode of ['empty-selection', 'legacy', 'no-options']) {
    const f = await fixture({ withOptions: mode !== 'no-options' }); try {
      const source = await f.source(), before = plain(await f.options());
      if (mode === 'legacy') delete source.optionImages;
      const saved = await json(await f.request('POST', f.form(source, mode === 'legacy' ? undefined : [])));
      assert.equal(saved.optionImageIds, undefined); assert.equal(saved.optionRevision, undefined); assert.deepEqual(plain(await f.options()), before);
      if (mode === 'no-options') assert.equal(f.h.sqlite.prepare('SELECT count(*) AS n FROM product_options WHERE product_id=?').get(f.id).n, 0);
    } finally { f.close(); }
  }
});
test('invalid, duplicate, foreign, omitted-proof or non-main selected option IDs cannot store output', async () => {
  const f = await fixture(); try {
    const source = await f.source(), baseline = await f.snapshot(), writes = [], put = f.h.bindings.FILES.put;
    f.h.bindings.FILES.put = async (...args) => { writes.push(args[0]); return put(...args); };
    for (const ids of [['option-000', 'option-000'], ['option-003'], ['foreign'], [1], Array.from({ length: 201 }, (_, i) => 'o-' + i)]) await status(await f.request('POST', f.form(source, ids)), 400);
    const legacy = { ...source }; delete legacy.optionImages; await status(await f.request('POST', f.form(legacy, ['option-000'])), 400);
    const malformed = f.form(source, []); malformed.set('optionImageIds', '{'); await status(await f.request('POST', malformed), 400);
    const duplicate = f.form(source, []); duplicate.append('optionImageIds', '[]'); await status(await f.request('POST', duplicate), 400);
    assert.equal(writes.length, 0); assert.equal(await f.snapshot(), baseline);
  } finally { f.close(); }
});
test('200 matching option IDs fit the bounded source proof and preserve all rows on one explicit selected adoption', async () => {
  const f = await fixture({ count: 200 }); try {
    const source = await f.source(); assert.ok(source.optionImages.optionIds.length > 190); assert.ok(JSON.stringify(source).length > 4096);
    const ids = source.optionImages.optionIds.slice(); const saved = await json(await f.request('POST', f.form(source, ids)));
    assert.deepEqual(saved.optionImageIds, ids); assert.equal((await f.options()).rows.length, 200);
    const metadata = (await f.h.bindings.FILES.head(saved.key)).customMetadata;
    const model = f.h.load('app/free-image-translation.ts');
    assert.equal(metadata.freeImageSourceSha256, digest(new TextEncoder().encode(model.freeImageSourceIdentity(source))));
    assert.equal(metadata.freeImageOptionIdsSha256, digest(new TextEncoder().encode(JSON.stringify(ids))));
    assert.equal(metadata.freeImageSource, undefined); assert.equal(metadata.freeImageOptionIds, undefined);
    assert.ok(new TextEncoder().encode(JSON.stringify(metadata)).length < 1024);
  } finally { f.close(); }
});
for (const change of ['content', 'option', 'product', 'keys']) test(`atomic selected adoption rejects concurrent ${change} save without a partial content/options/product mutation`, async () => {
  const f = await fixture(); try {
    const source = await f.source(), batch = f.h.db.batch; let raced = false, expected;
    f.h.db.batch = async statements => {
      if (!raced && statements.length === 3) {
        raced = true;
        if (change === 'content' || change === 'option') {
          const value = plain(change === 'content' ? await f.content() : await f.options()); value.revision++;
          if (change === 'content') value.label.material.value = '동시 수정 재질'; else value.rows[0].translatedName = '동시 수정 옵션명';
          f.h.sqlite.prepare('UPDATE product_' + (change === 'content' ? 'content' : 'options') + ' SET revision=?,payload=? WHERE product_id=?').run(value.revision, JSON.stringify(value), f.id);
        } else if (change === 'product') f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2030-01-01T00:00:00.000Z', f.id);
        else f.h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([...f.keys, 'owner/concurrent.png']), f.id);
        expected = await f.snapshot();
      }
      return batch(statements);
    };
    await status(await f.request('POST', f.form(source, ['option-000', 'option-001'])), 409);
    assert.equal(raced, true); assert.equal(await f.snapshot(), expected);
  } finally { f.close(); }
});
test('option revision is also compared for common-only adoption and translate, including same product clock changes', async () => {
  const f = await fixture(); try {
    const source = await f.source(), options = plain(await f.options()); options.revision++;
    f.h.sqlite.prepare('UPDATE product_options SET revision=?,payload=? WHERE product_id=?').run(options.revision, JSON.stringify(options), f.id);
    const baseline = await f.snapshot(); await status(await f.request('POST', f.form(source, [])), 409);
    await status(await f.request('POST', JSON.stringify({ action: 'translate', source, sourceLanguage: 'zh', regions: [{ id: 'r1', text: '中文' }] })), 409);
    assert.equal(await f.snapshot(), baseline);
  } finally { f.close(); }
});
for (const target of ['product_options', 'products']) test(`a failing companion ${target} write rolls back both role and selected image references; retry reuses the output`, async () => {
  const f = await fixture(); try {
    const source = await f.source(), before = await f.snapshot();
    f.h.sqlite.exec(`CREATE TRIGGER reject_translation BEFORE UPDATE ON ${target} BEGIN SELECT RAISE(ABORT,'fixture companion write failed'); END`);
    await status(await f.request('POST', f.form(source, ['option-000'])), 503); assert.equal(await f.snapshot(), before);
    const afterFailure = f.h.objects.size; f.h.sqlite.exec('DROP TRIGGER reject_translation');
    const saved = await json(await f.request('POST', f.form(source, ['option-000']))); assert.equal(f.h.objects.size, afterFailure);
    assert.equal((await f.options()).rows[0].imageKey, saved.key); assert.equal((await f.content()).assets.main.value[0], saved.key);
  } finally { f.close(); }
});
test('committed three-way acknowledgement loss recovers only the stored scope and already attached selected rows', async () => {
  const f = await fixture(); try {
    const source = await f.source(), batch = f.h.db.batch; let lost = false;
    f.h.db.batch = async statements => { const result = await batch(statements); if (!lost && statements.length === 3) { lost = true; throw Error('fixture committed three-way reply lost'); } return result; };
    const saved = await json(await f.request('POST', f.form(source, ['option-000', 'option-001']))); assert.equal(saved.replayed, true);
    const before = await f.snapshot(), repeated = await json(await f.request('POST', f.form(source, ['option-001', 'option-000'])));
    assert.equal(repeated.replayed, true); assert.equal(repeated.key, saved.key); assert.equal(await f.snapshot(), before);
    for (const mode of ['changed-row', 'deleted-row']) {
      const options = plain(await f.options()); options.revision++;
      if (mode === 'changed-row') options.rows.find(row => row.id === 'option-000').imageKey = f.otherKey;
      else options.rows = options.rows.filter(row => row.id !== 'option-000');
      f.h.sqlite.prepare('UPDATE product_options SET revision=?,payload=? WHERE product_id=?').run(options.revision, JSON.stringify(options), f.id);
      const baseline = await f.snapshot(); await status(await f.request('POST', f.form(source, ['option-000', 'option-001'])), 409); assert.equal(await f.snapshot(), baseline);
    }
  } finally { f.close(); }
});
test('changed option-selection scope never adopts new rows after a common result was already attached', async () => {
  const f = await fixture(); try {
    const source = await f.source(); const saved = await json(await f.request('POST', f.form(source, []))), before = await f.snapshot();
    await status(await f.request('POST', f.form(source, ['option-000'])), 409); assert.equal(await f.snapshot(), before);
    assert.equal((await f.options()).rows[0].imageKey, f.sourceKey); assert.ok(saved.key !== f.sourceKey);
  } finally { f.close(); }
});
test('a committed R2 reply loss is byte-verified before selected option references are connected', async () => {
  const f = await fixture(); try {
    const source = await f.source(), put = f.h.bindings.FILES.put; let lost = false;
    f.h.bindings.FILES.put = async (...args) => { const saved = await put(...args); if (!lost && args[0].includes('/free-image-')) { lost = true; throw Error('fixture stored PNG acknowledgement lost'); } return saved; };
    const saved = await json(await f.request('POST', f.form(source, ['option-000']))); assert.equal(lost, true);
    assert.equal((await f.options()).rows[0].imageKey, saved.key); assert.deepEqual(Buffer.from(f.h.objects.get(saved.key)), png(90));
    const repeated = await json(await f.request('POST', f.form(source, ['option-000']))); assert.equal(repeated.replayed, true);
  } finally { f.close(); }
});
test('an unavailable readback leaves a committed option attachment intact and an explicit healthy retry confirms it without new writes', async () => {
  const f = await fixture(); try {
    const source = await f.source(), batch = f.h.db.batch, get = f.h.bindings.FILES.get; let unavailable = false, committed = false;
    f.h.bindings.FILES.get = async (key, options) => { if (unavailable && key.includes('/free-image-')) throw Error('fixture PNG readback unavailable'); return get(key, options); };
    f.h.db.batch = async statements => { const result = await batch(statements); if (!committed && statements.length === 3) { committed = true; unavailable = true; throw Error('fixture committed DB acknowledgement lost'); } return result; };
    await status(await f.request('POST', f.form(source, ['option-000'])), 503); assert.equal(committed, true);
    const before = await f.snapshot(), objectCount = f.h.objects.size; unavailable = false;
    const saved = await json(await f.request('POST', f.form(source, ['option-000']))); assert.equal(saved.replayed, true);
    assert.equal(await f.snapshot(), before); assert.equal(f.h.objects.size, objectCount);
  } finally { f.close(); }
});
test('short legacy common-only raw metadata remains recoverable, while selected scope cannot downgrade to raw or incomplete hashes', async () => {
  const f = await fixture(); try {
    const source = await f.source(); delete source.optionImages;
    const saved = await json(await f.request('POST', f.form(source, []))), head = await f.h.bindings.FILES.head(saved.key), model = f.h.load('app/free-image-translation.ts');
    const metadata = { ...head.customMetadata, freeImageSource: model.freeImageSourceIdentity(source) }; delete metadata.freeImageSourceSha256; delete metadata.freeImageOptionIdsSha256;
    // The test fixture mutates only its in-memory object metadata to represent
    // an existing step 584 common-only object; production writes remain conditional.
    const get = f.h.bindings.FILES.get; f.h.bindings.FILES.get = async (key, options) => { const object = await get(key, options); return object && key === saved.key ? { ...object, customMetadata: metadata } : object; };
    const replayed = await json(await f.request('POST', f.form(source, []))); assert.equal(replayed.replayed, true);
  } finally { f.close(); }
  for (const mode of ['raw', 'missing-option-hash', 'wrong-option-hash', 'wrong-source-hash']) {
    const f = await fixture(); try {
      const source = await f.source(), ids = ['option-000'], saved = await json(await f.request('POST', f.form(source, ids)));
      const head = await f.h.bindings.FILES.head(saved.key), metadata = { ...head.customMetadata };
      if (mode === 'raw') { metadata.freeImageSource = f.h.load('app/free-image-translation.ts').freeImageSourceIdentity(source); metadata.freeImageOptionIds = JSON.stringify(ids); delete metadata.freeImageSourceSha256; delete metadata.freeImageOptionIdsSha256; }
      if (mode === 'missing-option-hash') delete metadata.freeImageOptionIdsSha256;
      if (mode === 'wrong-option-hash') metadata.freeImageOptionIdsSha256 = '0'.repeat(64);
      if (mode === 'wrong-source-hash') metadata.freeImageSourceSha256 = '0'.repeat(64);
      const get = f.h.bindings.FILES.get; f.h.bindings.FILES.get = async (key, options) => { const object = await get(key, options); return object && key === saved.key ? { ...object, customMetadata: metadata } : object; };
      const before = await f.snapshot(); await status(await f.request('POST', f.form(source, ids)), 409); assert.equal(await f.snapshot(), before);
    } finally { f.close(); }
  }
});

async function individualSource(f) {
  return (await json(await f.h.load('app/api/products/[id]/image-text/route.ts').GET(new Request('https://app.test' + f.base + '/image-text?'
    + new URLSearchParams({ sourceKey: f.otherKey, role: 'main' })), { params: Promise.resolve({ id: f.id }) }))).source;
}
test('an individual option photo outside common main can be translated into its SKU XLSX and PNG manifest without changing common content or fallback rows', async () => {
  const f = await fixture(); try {
    const source = await individualSource(f), beforeContentRow = plain(f.h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(f.id));
    const beforeContent = plain(await f.content()), beforeOptions = plain(await f.options()), beforeProduct = plain(f.product());
    const beforePolicy = f.h.sqlite.prepare('SELECT payload FROM product_price_policy WHERE product_id=?').get(f.id).payload;
    assert.equal(source.sourceKey, f.otherKey); assert.equal(source.optionImages.commonAssigned, false);
    assert.deepEqual(source.optionImages.optionIds, ['option-003']);
    const saved = await json(await f.request('POST', f.form(source, ['option-003'])));
    assert.equal(saved.contentRevision, source.contentRevision); assert.equal(saved.optionRevision, source.optionImages.revision + 1);
    assert.deepEqual(plain(f.h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(f.id)), beforeContentRow, 'all content bytes, revision and timestamp remain untouched');
    assert.deepEqual(plain(await f.content()), beforeContent);
    const options = plain(await f.options());
    for (const row of options.rows) assert.deepEqual(row, row.id === 'option-003'
      ? { ...beforeOptions.rows.find(old => old.id === row.id), imageKey: saved.key, provenance: { ...beforeOptions.rows.find(old => old.id === row.id).provenance, imageKey: 'manual' }, updatedAt: saved.productVersion }
      : beforeOptions.rows.find(old => old.id === row.id));
    const product = plain(f.product());
    for (const field of Object.keys(beforeProduct).filter(field => !['image_keys', 'quote_status', 'updated_at'].includes(field))) assert.deepEqual(product[field], beforeProduct[field], field + ' remains untouched');
    assert.equal(f.h.sqlite.prepare('SELECT payload FROM product_price_policy WHERE product_id=?').get(f.id).payload, beforePolicy);
    const view = await json(await f.h.route(f.base + '/quotation-fields'));
    for (const row of view.resolved.rows) assert.equal(row.fields.mainImage.value, row.optionId === 'option-003' ? saved.key : f.sourceKey);
    const fields = ['skuId', 'categoryId', ...f.h.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field => field.id)];
    const workbook = quotationWorkbook(fields), sha256 = digest(workbook), storageKey = f.h.load('db/category-templates.ts').templateKey('owner', sha256, 'xlsx'); f.h.objects.set(storageKey, workbook);
    await f.h.load('db/category-profiles.ts').createCategoryProfile('owner', { name: '개별 옵션 이미지 전파 검증', categoryId: '80719', categoryPath: f.h.context.category.categoryPath,
      template: { name: 'individual-image.xlsx', format: 'xlsx', sha256, storageKey, sheetName: '견적서', headerRow: 1, headers: fields },
      mappings: fields.map((field, column) => ({ field, column, required: false })) }, 'cat');
    const preview = await json(await f.h.route(f.base + '/quotation', { method: 'POST', body: { action: 'preview' } }));
    const exported = await f.h.route(f.base + '/quotation', { method: 'POST', body: { action: 'export', fingerprint: preview.fingerprint } }); await status(exported, 200);
    const reader = f.h.load('app/xlsx-template.ts'), files = await reader.readXlsxArchive(await exported.arrayBuffer());
    const document = JSON.parse(new TextDecoder().decode(files.get('quotation-fields.json'))), plan = JSON.parse(new TextDecoder().decode(files.get('supplier-hub-upload-plan.json')));
    const sheet = reader.inspectXlsxArchive(await reader.readXlsxArchive(files.get(plan.quotation.file.filename)));
    for (const [index, row] of document.rows.entries()) {
      const key = row.optionId === 'option-003' ? saved.key : f.sourceKey;
      assert.equal(reader.xlsxHeaders(sheet, '견적서', index + 2)[fields.indexOf('mainImage')], document.uploadFilenames[key]);
    }
    const artifact = plan.productImages.find(image => image.key === saved.key); assert.ok(artifact);
    assert.deepEqual(Buffer.from(files.get(artifact.archivePath)), png(90)); assert.equal(artifact.sha256, digest(png(90)));
    assert.deepEqual(artifact.references.filter(ref => ref.fieldId === 'mainImage').map(ref => ref.optionId), ['option-003']);
    assert.equal(f.product().supplier_hub_status, '미전송');
  } finally { f.close(); }
});
test('an option-only proof requires an explicit selected SKU; legacy, forged-common, changed option links and unrelated library photos cannot adopt it', async () => {
  const f = await fixture(); try {
    const source = await individualSource(f), before = await f.snapshot(), writes = [], put = f.h.bindings.FILES.put;
    f.h.bindings.FILES.put = async (...args) => { writes.push(args[0]); return put(...args); };
    await status(await f.request('POST', f.form(source, [])), 400); await status(await f.request('POST', f.form(source)), 400);
    await status(await f.request('POST', f.form(source, ['option-000'])), 400);
    const forged = plain(source); delete forged.optionImages.commonAssigned;
    await status(await f.request('POST', f.form(forged, ['option-003'])), 409);
    const legacy = plain(source); delete legacy.optionImages;
    await status(await f.request('POST', f.form(legacy, [])), 409);
    const get = f.h.load('app/api/products/[id]/image-text/route.ts').GET;
    await status(await get(new Request('https://app.test' + f.base + '/image-text?' + new URLSearchParams({ sourceKey: f.keys[7], role: 'main' })), { params: Promise.resolve({ id: f.id }) }), 409);
    assert.equal(await f.snapshot(), before); assert.equal(writes.length, 0);
  } finally { f.close(); }
});
test('option-only image attachment guards unchanged content/options/product clocks and rolls back a failing companion product write', async () => {
  for (const mode of ['content', 'options', 'product', 'companion-failure']) {
    const f = await fixture(); try {
      const source = await individualSource(f), before = await f.snapshot(), batch = f.h.db.batch; let raced = false, expected = before;
      if (mode === 'companion-failure') f.h.sqlite.exec("CREATE TRIGGER fail_individual_photo BEFORE UPDATE ON products BEGIN SELECT RAISE(ABORT,'fixture individual photo product failure'); END");
      else f.h.db.batch = async statements => {
        // Only the two-stage option-only write has a first statement that
        // updates an existing product_options row rather than INSERTing it.
        if (!raced && statements.length === 2) {
          raced = true;
          if (mode === 'product') f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2030-01-01T00:00:00.000Z', f.id);
          else {
            const value = plain(mode === 'content' ? await f.content() : await f.options()); value.revision++;
            if (mode === 'content') value.label.material.value = '동시 수정한 재질'; else value.rows.find(row => row.id === 'option-003').imageKey = f.sourceKey;
            f.h.sqlite.prepare('UPDATE product_' + mode + ' SET revision=?,payload=? WHERE product_id=?').run(value.revision, JSON.stringify(value), f.id);
          }
          expected = await f.snapshot();
        }
        return batch(statements);
      };
      await status(await f.request('POST', f.form(source, ['option-003'])), mode === 'companion-failure' ? 503 : 409);
      assert.equal(await f.snapshot(), expected);
      if (mode === 'companion-failure') {
        const objectCount = f.h.objects.size; f.h.sqlite.exec('DROP TRIGGER fail_individual_photo');
        const saved = await json(await f.request('POST', f.form(source, ['option-003']))); assert.equal(f.h.objects.size, objectCount);
        assert.equal((await f.options()).rows.find(row => row.id === 'option-003').imageKey, saved.key);
        assert.equal(saved.contentRevision, source.contentRevision);
      } else assert.equal(raced, true);
    } finally { f.close(); }
  }
});
test('option-only acknowledgement loss replays the chosen stored image, but changed or deleted selected rows cannot be recovered or recreated', async () => {
  const f = await fixture(); try {
    const source = await individualSource(f), batch = f.h.db.batch, beforeContent = plain(await f.content()); let lost = false;
    f.h.db.batch = async statements => { const result = await batch(statements); if (!lost && statements.length === 2) { lost = true; throw Error('fixture option-only committed acknowledgement lost'); } return result; };
    const saved = await json(await f.request('POST', f.form(source, ['option-003']))); assert.equal(saved.replayed, true);
    assert.equal(saved.contentRevision, source.contentRevision); assert.deepEqual(plain(await f.content()), beforeContent);
    const baseline = await f.snapshot(); const repeated = await json(await f.request('POST', f.form(source, ['option-003']))); assert.equal(repeated.replayed, true); assert.equal(await f.snapshot(), baseline);
    for (const mode of ['changed', 'deleted']) {
      const value = plain(await f.options()); value.revision++;
      if (mode === 'changed') value.rows.find(row => row.id === 'option-003').imageKey = f.sourceKey;
      else value.rows = value.rows.filter(row => row.id !== 'option-003');
      f.h.sqlite.prepare('UPDATE product_options SET revision=?,payload=? WHERE product_id=?').run(value.revision, JSON.stringify(value), f.id);
      const before = await f.snapshot(); await status(await f.request('POST', f.form(source, ['option-003'])), 409); assert.equal(await f.snapshot(), before);
    }
  } finally { f.close(); }
});
