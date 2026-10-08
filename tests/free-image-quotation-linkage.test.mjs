import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { hubSchemaSnapshot, schemaCompanies, schemaPath } from './helpers/hub-schema.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
const status = async (response, expected) => assert.equal(response.status, expected, await response.clone().text());
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function png(color = 200) {
  const chunk = (name, data) => {
    const joined = Buffer.concat([Buffer.from(name), data]); let crc = 0xffffffff;
    for (const byte of joined) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const size = Buffer.alloc(4), check = Buffer.alloc(4); size.writeUInt32BE(data.length); check.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, joined, check]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(3, 0); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(26, color); rows[0] = 0; rows[13] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
async function fixture({ linkedWire = false, withMain = false, company = schemaCompanies[0] } = {}) {
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name, translationFetcher: async () => Response.json([[['번역 문구', '中文']]]) });
  try {
    const live = { ...hubSchemaSnapshot(company), inputBindings: 'couplus-paths-v1' }, raw = JSON.parse(live.schemaString);
    raw.properties.imagePage.properties.images = { type: 'object', properties: { additionalImage: { type: 'string', title: '추가 이미지' } } };
    if (withMain) raw.properties.imagePage.properties.images.properties.mainImage = { type: 'string', title: '대표 이미지' };
    raw.properties.imagePage.properties.details = { type: 'object', properties: { detailedImage: { type: 'string', title: '상세 이미지' }, htmlProductDetailContent: { type: 'string', title: 'HTML 상세 내용' } } };
    live.schemaString = JSON.stringify(raw);
    const schema = h.load('app/quotation-schema.ts').getQuotationSchema(live.categoryId, schemaPath, live), fields = schema.fields.map(field => field.id), workbook = quotationWorkbook(fields), hash = sha(workbook);
    const storageKey = h.load('db/category-templates.ts').templateKey('owner', hash, 'xlsx'); h.objects.set(storageKey, workbook);
    const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', { name: '최종 이미지 번역 시험', categoryId: live.categoryId, categoryPath: schemaPath, hubSchema: live,
      template: { name: 'synthetic-final-images.xlsx', format: 'xlsx', sha256: hash, storageKey, sheetName: '견적서', headerRow: 1, headers: fields }, mappings: fields.map((field, column) => ({ field, column, required: false })) }, 'cat');
    h.context.category = profile; h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context), 'job'); await h.intake();
    const product = () => h.sqlite.prepare('SELECT * FROM products').get(), id = product().id, base = '/api/products/' + id, keys = JSON.parse(product().image_keys);
    keys.forEach((key, index) => h.objects.set(key, new Uint8Array(png(index))));
    const get = h.bindings.FILES.get; h.bindings.FILES.get = async (key, options) => {
      const object = await get(key, options); if (!object) return null;
      const bytes = new Uint8Array(h.objects.get(key)); return { ...object, body: new Response(bytes).body, arrayBuffer: async () => bytes.slice().buffer };
    };
    if (linkedWire) {
      // Simulate a persisted primary wire with a distinct identity, as older
      // schema snapshots can contain. All API reads use the same exact schema.
      const snapshotHelpers = h.load('app/quotation-fields-snapshot.ts'), stable = snapshotHelpers.stableQuotationFieldsView;
      snapshotHelpers.stableQuotationFieldsView = async (...args) => {
        const saved = await stable(...args), view = saved.view;
        for (const input of [...(withMain ? ['mainImage'] : []), 'additionalImages', 'detailImages']) {
          for (const resolved of [view.resolved, view.automatic]) {
            const canonical = resolved.schema.fields.find(field => field.id === input), wire = { ...canonical, id: 'exact-' + input };
            delete canonical.hubInput; delete canonical.hubWire; resolved.schema.fields.push(wire);
            for (const row of resolved.rows) row.fields[wire.id] = { ...row.fields[input], value: view.overrides.options[row.optionId]?.[wire.id] ?? view.overrides.common[wire.id] ?? row.fields[input].value };
          }
        }
        return saved;
      };
    }
    const qurl = base + '/quotation-fields?profileId=' + profile.id, read = () => h.route(qurl).then(json);
    let before = await read(); const selected = before.resolved.rows.find(row => row.optionId).optionId, other = before.resolved.rows.filter(row => row.optionId)[1].optionId;
    if (withMain) {
      const content = await h.load('db/product-content.ts').readProductContent('owner', id), model = h.load('app/product-content.ts');
      await h.load('db/product-content.ts').saveProductContent('owner', model.applyContentPatch(content, { assets: { main: [keys[1]] } }, new Date(Math.max(Date.now(), Date.parse(before.productVersion) + 1)).toISOString()), content.revision);
      const options = await json(await h.route(base + '/options')), rows = h.load('app/product-options.ts').optionInputs(options.options); rows.find(row => row.id === selected).imageKey = keys[1];
      await json(await h.route(base + '/options', { method: 'PATCH', body: { expectedRevision: options.options.revision, expectedProductVersion: options.productVersion, rows } })); before = await read();
    }
    const changes = [];
    if (withMain) {
      const target = h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(before.resolved.schema.fields, 'mainImage');
      for (const fieldKey of target.linked) changes.push({ optionId: null, fieldKey, value: keys[2] }, { optionId: selected, fieldKey, value: keys[0] });
    }
    for (const input of ['additionalImages', 'detailImages']) {
      const target = h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(before.resolved.schema.fields, input);
      for (const fieldKey of target.linked) changes.push({ optionId: selected, fieldKey, value: [keys[2], keys[0], keys[3]].join('\n') });
    }
    changes.push({ optionId: selected, fieldKey: 'detailHtml', value: '<p>보존할 직접 작성 HTML</p>' }, { optionId: other, fieldKey: 'additionalImages', value: '' });
    await json(await h.route(qurl, { method: 'PUT', body: { expectedRevision: before.revision, expectedInputFingerprint: before.inputFingerprint, changes } })); before = await read();
    const imageRoute = h.load('app/api/products/[id]/image-text/route.ts'), context = { params: Promise.resolve({ id }) };
    const source = async (input = 'additionalImages', changes = {}) => {
      const view = await read(), target = h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(view.resolved.schema.fields, input);
      const params = new URLSearchParams({ sourceKey: keys[0], role: input === 'mainImage' ? 'main' : input === 'additionalImages' ? 'additional' : 'detail', target: 'quotation', profileId: profile.id, optionId: selected, fieldKey: target.primary, slotIndex: input === 'mainImage' ? '0' : '1', ...changes });
      return imageRoute.GET(new Request('https://app.test' + base + '/image-text?' + params), context);
    };
    const apply = (proof, extras = {}) => {
      const form = new FormData(); form.set('action', 'apply'); form.set('source', JSON.stringify(proof)); form.set('file', new File([png(90)], 'final.png', { type: 'image/png' }));
      for (const [key, value] of Object.entries(extras)) form.set(key, value);
      return imageRoute.POST(new Request('https://app.test' + base + '/image-text', { method: 'POST', body: form }), context);
    };
    const post = body => imageRoute.POST(new Request('https://app.test' + base + '/image-text', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), context);
    const recover = proof => post({ action: 'recover', source: proof, outputSha256: sha(png(90)), outputBytes: png(90).length });
    const sourceRows = () => JSON.stringify(Object.fromEntries(['product_content', 'product_options', 'product_price_policy', 'collection_context', 'collection_products', 'collection_results'].map(table => [table, h.sqlite.prepare('SELECT * FROM ' + table).all()])));
    const snapshot = () => JSON.stringify({ product: product(), quote: h.sqlite.prepare('SELECT * FROM product_quotation_fields').all(), source: sourceRows() });
    return { h, id, base, qurl, keys, profile, selected, other, before, source, apply, post, recover, product, read, sourceRows, snapshot, close() { h.close(); } };
  } catch (error) { h.close(); throw error; }
}

for (const input of ['additionalImages', 'detailImages']) test('final ' + input + ' translation replaces only the saved selected slot and exact canonical/wire in one commit', async () => {
  const f = await fixture({ linkedWire: true }); try {
    const source = (await json(await f.source(input))).source, before = await f.read(), raw = f.sourceRows(), overrides = plain(before.overrides), objects = [...f.h.objects.keys()], writes = [], batch = f.h.db.batch;
    f.h.db.batch = async statements => { const result = await batch(statements); if (statements.length === 2) writes.push(statements); return result; };
    assert.equal(source.quotationTarget.fieldKey, 'exact-' + input); assert.equal(source.quotationTarget.slotIndex, 1); assert.equal(source.optionImages, undefined);
    const saved = await json(await f.apply(source)), latest = await f.read(), expected = [f.keys[2], saved.key, f.keys[3]].join('\n');
    assert.equal(writes.length, 1); assert.equal(latest.revision, before.revision + 1); assert.equal(saved.quotationRevision, latest.revision);
    assert.equal(latest.contentRevision, before.contentRevision); assert.equal(latest.optionRevision, before.optionRevision); assert.equal(f.sourceRows(), raw);
    for (const id of [input, 'exact-' + input]) { assert.equal(latest.overrides.options[f.selected][id], expected); assert.equal(latest.resolved.rows.find(row => row.optionId === f.selected).fields[id].value, expected); }
    for (const id of [input, 'exact-' + input]) delete overrides.options[f.selected][id]; const changed = plain(latest.overrides); for (const id of [input, 'exact-' + input]) delete changed.options[f.selected][id]; assert.deepEqual(changed, overrides);
    assert.deepEqual(latest.imageKeys, [...before.imageKeys, saved.key]); assert.deepEqual([...f.h.objects.keys()], [...objects, saved.key]); assert.equal(f.product().supplier_hub_status, '미전송');
    const metadata = await f.h.bindings.FILES.head(saved.key); assert.equal(metadata.customMetadata.freeImageQuotationOverridesSha256, sha(JSON.stringify(latest.overrides)));
    assert.deepEqual(Buffer.from(f.h.objects.get(saved.key)), png(90));
    const baseline = f.snapshot(), repeated = await json(await f.apply(source)); assert.equal(repeated.replayed, true); assert.equal(repeated.key, saved.key); assert.equal(f.snapshot(), baseline);
  } finally { f.close(); }
});

for (const company of schemaCompanies) test(`final main image translation preserves source/main facts, replaces selected canonical/wire and recovers the same PNG into workbook and Hub references (${company.code})`, async () => {
  const f = await fixture({ linkedWire: true, withMain: true, company }); try {
    const source = (await json(await f.source('mainImage'))).source, before = await f.read(), sourceRows = f.sourceRows(), oldProduct = plain(f.product()), oldOverrides = plain(before.overrides), objects = [...f.h.objects.keys()];
    assert.equal(source.role, 'main'); assert.equal(source.quotationTarget.input, 'mainImage'); assert.equal(source.quotationTarget.fieldKey, 'exact-mainImage'); assert.equal(source.quotationTarget.slotIndex, 0); assert.equal(source.optionImages, undefined);
    const rawOptions = JSON.parse(f.h.sqlite.prepare('SELECT payload FROM product_options').get().payload), rawContent = JSON.parse(f.h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
    assert.equal(rawOptions.rows.find(row => row.id === f.selected).imageKey, f.keys[1]); assert.deepEqual(rawContent.assets.main.value, [f.keys[1]]); assert.equal(source.sourceKey, f.keys[0]); assert.notEqual(source.sourceKey, f.keys[1]);
    const untouched = f.snapshot(); await status(await f.source('mainImage', { slotIndex: '1' }), 400); await status(await f.source('mainImage', { role: 'additional' }), 409);
    for (const patch of [{ role: 'additional' }, { quotationTarget: { ...source.quotationTarget, slotIndex: 1 } }, { optionImages: { revision: rawOptions.revision, optionIds: [f.selected] } }]) await status(await f.apply({ ...source, ...patch }), 400);
    await status(await f.apply(source, { optionImageIds: JSON.stringify([f.selected]) }), 400); assert.equal(f.snapshot(), untouched); assert.deepEqual([...f.h.objects.keys()], objects);
    const batch = f.h.db.batch; let lost = false, commits = 0;
    f.h.db.batch = async statements => { const result = await batch(statements); if (statements.length === 2) { commits++; if (!lost) { lost = true; throw Error('fixture main image committed ACK lost'); } } return result; };
    const saved = await json(await f.apply(source)), latest = await f.read(); assert.equal(saved.replayed, true); assert.equal(commits, 1);
    assert.equal(latest.revision, before.revision + 1); assert.equal(latest.contentRevision, before.contentRevision); assert.equal(latest.optionRevision, before.optionRevision); assert.equal(f.sourceRows(), sourceRows);
    for (const fieldKey of ['mainImage', 'exact-mainImage']) { assert.equal(latest.overrides.options[f.selected][fieldKey], saved.key); assert.equal(latest.resolved.rows.find(row => row.optionId === f.selected).fields[fieldKey].value, saved.key); delete oldOverrides.options[f.selected][fieldKey]; }
    const overrides = plain(latest.overrides); for (const fieldKey of ['mainImage', 'exact-mainImage']) delete overrides.options[f.selected][fieldKey]; assert.deepEqual(overrides, oldOverrides);
    assert.equal(latest.resolved.rows.find(row => row.optionId === f.other).fields.mainImage.value, f.keys[2]);
    for (const field of Object.keys(oldProduct).filter(field => !['image_keys', 'quote_status', 'updated_at'].includes(field))) assert.deepEqual(f.product()[field], oldProduct[field]);
    assert.deepEqual(latest.imageKeys, [...before.imageKeys, saved.key]); assert.deepEqual([...f.h.objects.keys()], [...objects, saved.key]); assert.deepEqual(Buffer.from(f.h.objects.get(f.keys[0])), png(0)); assert.deepEqual(Buffer.from(f.h.objects.get(f.keys[1])), png(1));
    const baseline = f.snapshot(), count = f.h.objects.size, reordered = Object.fromEntries(Object.entries(source).reverse()); reordered.quotationTarget = Object.fromEntries(Object.entries(source.quotationTarget).reverse());
    const recovered = await json(await f.recover(reordered)); assert.equal(recovered.replayed, true); assert.equal(recovered.key, saved.key); const repeated = await json(await f.apply(reordered)); assert.equal(repeated.key, saved.key); assert.equal(commits, 1); assert.equal(f.snapshot(), baseline); assert.equal(f.h.objects.size, count);
    const preview = await json(await f.h.route(f.base + '/quotation', { method: 'POST', body: { action: 'preview', profileId: f.profile.id } }));
    const response = await f.h.route(f.base + '/quotation', { method: 'POST', body: { action: 'export', profileId: f.profile.id, fingerprint: preview.fingerprint } }); await status(response, 200);
    const reader = f.h.load('app/xlsx-template.ts'), archive = await reader.readXlsxArchive(await response.arrayBuffer()), document = JSON.parse(new TextDecoder().decode(archive.get('quotation-fields.json'))), plan = JSON.parse(new TextDecoder().decode(archive.get('supplier-hub-upload-plan.json')));
    const rowIndex = document.rows.findIndex(row => row.optionId === f.selected), selected = document.rows[rowIndex], sheet = reader.inspectXlsxArchive(await reader.readXlsxArchive(archive.get(plan.quotation.file.filename)));
    assert.equal(selected.fields.mainImage.value, saved.key); assert.equal(reader.xlsxHeaders(sheet, '견적서', rowIndex + 2)[f.profile.template.headers.indexOf('mainImage')], document.uploadFilenames[saved.key]);
    const image = plan.productImages.find(image => image.key === saved.key); assert.ok(image); assert.equal(image.sha256, sha(png(90))); assert.deepEqual(Buffer.from(archive.get(image.archivePath)), png(90)); assert.deepEqual(image.references.filter(ref => ref.fieldId === 'mainImage').map(ref => ref.optionId), [f.selected]);
    assert.equal(f.sourceRows(), sourceRows); assert.equal(f.product().supplier_hub_status, '미전송'); assert.ok(!f.h.network.some(host => /supplier\.coupang|couplus/.test(host)));
  } finally { f.close(); }
});

test('final proof keeps requested default selection null while binding actual captured category and resolved primary path', async () => {
  const f = await fixture(); try {
    const response = await f.source('additionalImages', { profileId: '' }); await status(response, 400);
    const target = f.h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(f.before.resolved.schema.fields, 'additionalImages');
    const proof = await json(await f.h.load('app/api/products/[id]/image-text/route.ts').GET(new Request('https://app.test' + f.base + '/image-text?' + new URLSearchParams({ sourceKey: f.keys[0], role: 'additional', target: 'quotation', optionId: f.selected, fieldKey: target.primary, slotIndex: '1' })), { params: Promise.resolve({ id: f.id }) }));
    const defaultView = await json(await f.h.route(f.base + '/quotation-fields'));
    assert.equal(proof.source.quotationTarget.profileId, null); assert.equal(proof.source.quotationTarget.inputFingerprint, defaultView.inputFingerprint);
    const before = f.sourceRows(); await json(await f.apply(proof.source)); assert.equal(f.sourceRows(), before);
  } finally { f.close(); }
});

test('forged selection, slot, binding, quotation versions and source SKU adoption cannot write or retarget a final proof', async () => {
  const f = await fixture(); try {
    const source = (await json(await f.source())).source, baseline = f.snapshot(), put = f.h.bindings.FILES.put, writes = [];
    f.h.bindings.FILES.put = async (...args) => { writes.push(args[0]); return put(...args); };
    for (const patch of [{ optionId: f.other }, { fieldKey: 'detailImages' }, { slotIndex: 0 }, { bindingSha256: '0'.repeat(64) }, { revision: source.quotationTarget.revision + 1 }, { inputFingerprint: '0'.repeat(64) }, { optionRevision: source.quotationTarget.optionRevision + 1 }]) {
      const proof = plain(source); Object.assign(proof.quotationTarget, patch); const response = await f.apply(proof); assert.ok([400, 409].includes(response.status), await response.text()); assert.equal(f.snapshot(), baseline);
    }
    await status(await f.apply(source, { optionImageIds: JSON.stringify([f.selected]) }), 400); assert.equal(writes.length, 0);
    await status(await f.source('additionalImages', { fieldKey: 'detailImages' }), 409); await status(await f.source('additionalImages', { slotIndex: '01' }), 400); await status(await f.source('additionalImages', { sourceKey: f.keys[1] }), 409);
  } finally { f.close(); }
});

test('read-only recovery proves same PNG before any retransmission and never advances revisions or creates media', async () => {
  const f = await fixture(); try {
    const source = (await json(await f.source())).source, baseline = f.snapshot(), objects = [...f.h.objects.keys()];
    const notSaved = await json(await f.recover(source)); assert.equal(notSaved.applied, false); assert.equal(f.snapshot(), baseline); assert.deepEqual([...f.h.objects.keys()], objects);
    const saved = await json(await f.apply(source)), committed = f.snapshot(), recovered = await json(await f.recover(source)); assert.equal(recovered.applied, true); assert.equal(recovered.replayed, true); assert.equal(recovered.key, saved.key); assert.equal(f.snapshot(), committed);
    await status(await f.post({ action: 'recover', source, outputSha256: '0'.repeat(64), outputBytes: png(90).length }), 409); assert.equal(f.snapshot(), committed);
  } finally { f.close(); }
});

test('equivalent quotation proof property order keeps the output key and exact PNG recovery while extra or forged fields stay rejected', async () => {
  const f = await fixture({ linkedWire: true }); try {
    const source = (await json(await f.source())).source, model = f.h.load('app/free-image-translation.ts');
    const reordered = Object.fromEntries(Object.entries(source).reverse()); reordered.quotationTarget = Object.fromEntries(Object.entries(source.quotationTarget).reverse());
    assert.equal(model.freeImageSourceIdentity(model.validateFreeImageSource(reordered)), model.freeImageSourceIdentity(source));
    assert.equal(model.freeImageApplyIdentity(reordered), model.freeImageApplyIdentity(source));
    const before = f.snapshot(), objects = [...f.h.objects.keys()], firstProbe = await json(await f.recover(source)), secondProbe = await json(await f.recover(reordered));
    assert.equal(firstProbe.applied, false); assert.equal(secondProbe.applied, false); assert.equal(firstProbe.key, secondProbe.key); assert.equal(f.snapshot(), before); assert.deepEqual([...f.h.objects.keys()], objects);
    const saved = await json(await f.apply(reordered)); assert.equal(saved.key, firstProbe.key); assert.deepEqual(Buffer.from(f.h.objects.get(saved.key)), png(90));
    const baseline = f.snapshot(), count = f.h.objects.size, recovered = await json(await f.recover(source)); assert.equal(recovered.key, saved.key); assert.equal(recovered.replayed, true);
    const replayed = await json(await f.apply(source)); assert.equal(replayed.key, saved.key); assert.equal(replayed.replayed, true); assert.equal(f.snapshot(), baseline); assert.equal(f.h.objects.size, count);
    const extra = plain(reordered); extra.quotationTarget.destination = f.other; await status(await f.recover(extra), 400); await status(await f.apply(extra), 400);
    const forged = plain(reordered); forged.quotationTarget.optionId = f.other; await status(await f.recover(forged), 409); await status(await f.apply(forged), 409); assert.equal(f.snapshot(), baseline);
  } finally { f.close(); }
});

test('the translated final SKU slot reaches quotation workbook, JSON and Hub upload image references with the exact saved PNG', async () => {
  const f = await fixture(); try {
    const source = (await json(await f.source('detailImages'))).source, raw = f.sourceRows(), saved = await json(await f.apply(source));
    const preview = await json(await f.h.route(f.base + '/quotation', { method: 'POST', body: { action: 'preview', profileId: f.profile.id } }));
    const response = await f.h.route(f.base + '/quotation', { method: 'POST', body: { action: 'export', profileId: f.profile.id, fingerprint: preview.fingerprint } }); await status(response, 200);
    const reader = f.h.load('app/xlsx-template.ts'), archive = await reader.readXlsxArchive(await response.arrayBuffer());
    const document = JSON.parse(new TextDecoder().decode(archive.get('quotation-fields.json'))), plan = JSON.parse(new TextDecoder().decode(archive.get('supplier-hub-upload-plan.json')));
    const row = document.rows.find(row => row.optionId === f.selected), rowIndex = document.rows.findIndex(row => row.optionId === f.selected), ordered = [f.keys[2], saved.key, f.keys[3]];
    assert.equal(row.fields.detailImages.value, ordered.join('\n')); assert.equal(row.fields.detailHtml.value, '<p>보존할 직접 작성 HTML</p>');
    const sheet = reader.inspectXlsxArchive(await reader.readXlsxArchive(archive.get(plan.quotation.file.filename))), fields = f.profile.template.headers;
    assert.equal(reader.xlsxHeaders(sheet, '견적서', rowIndex + 2)[fields.indexOf('detailImages')], ordered.map(key => document.uploadFilenames[key]).join('\n'));
    const image = plan.productImages.find(image => image.key === saved.key); assert.ok(image); assert.equal(image.sha256, sha(png(90)));
    assert.deepEqual(Buffer.from(archive.get(image.archivePath)), png(90)); assert.deepEqual(image.references.filter(reference => reference.fieldId === 'detailImages').map(reference => reference.optionId), [f.selected]);
    assert.equal(f.sourceRows(), raw); assert.equal(f.product().supplier_hub_status, '미전송'); assert.ok(!f.h.network.some(host => /supplier\.coupang|couplus/.test(host)));
  } finally { f.close(); }
});

for (const mode of ['quotation', 'content', 'options', 'settings', 'profile']) test('stale ' + mode + ' changes reject selected final-image application before media writes', async () => {
  const f = await fixture(); try {
    const source = (await json(await f.source())).source;
    if (mode === 'quotation') { const view = await f.read(); await json(await f.h.route(f.qurl, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [{ optionId: f.other, fieldKey: 'searchTags', value: '동시 저장한 문구' }] } })); }
    else if (mode === 'content' || mode === 'options') { const table = 'product_' + mode, row = f.h.sqlite.prepare('SELECT payload FROM ' + table).get(), value = JSON.parse(row.payload); value.revision++; f.h.sqlite.prepare('UPDATE ' + table + ' SET revision=?,payload=?').run(value.revision, JSON.stringify(value)); }
    else if (mode === 'profile') f.h.sqlite.prepare('UPDATE category_profiles SET revision=revision+1').run();
    else await f.h.load('db/queries.ts').saveSettings('owner', JSON.stringify({ ...f.h.settings, brand: '동시 변경 브랜드' }));
    const baseline = f.snapshot(), objects = [...f.h.objects.keys()]; await status(await f.apply(source), 409); await status(await f.recover(source), 409); assert.equal(f.snapshot(), baseline); assert.deepEqual([...f.h.objects.keys()], objects);
  } finally { f.close(); }
});

test('final quotation CAS rechecks source and quote revisions inside the image/key batch', async () => {
  const f = await fixture(); try {
    const source = (await json(await f.source())).source, batch = f.h.db.batch; let raced = false, baseline;
    f.h.db.batch = async statements => {
      if (!raced && statements.length === 2) { raced = true; const value = JSON.parse(f.h.sqlite.prepare('SELECT payload FROM product_options').get().payload); value.revision++; f.h.sqlite.prepare('UPDATE product_options SET revision=?,payload=?').run(value.revision, JSON.stringify(value)); baseline = f.snapshot(); }
      return batch(statements);
    };
    await status(await f.apply(source), 409); assert.equal(raced, true); assert.equal(f.snapshot(), baseline);
  } finally { f.close(); }
});

test('a companion product failure rolls back quotation override and library attachment; healthy retry reuses detached PNG', async () => {
  const f = await fixture(); try {
    const source = (await json(await f.source())).source, baseline = f.snapshot(); f.h.sqlite.exec("CREATE TRIGGER fail_final_image BEFORE UPDATE ON products BEGIN SELECT RAISE(ABORT,'fixture final image failure'); END");
    await status(await f.apply(source), 503); assert.equal(f.snapshot(), baseline); const objectCount = f.h.objects.size;
    const notSaved = await json(await f.recover(source)); assert.equal(notSaved.applied, false); assert.equal(f.h.objects.size, objectCount);
    f.h.sqlite.exec('DROP TRIGGER fail_final_image'); await json(await f.apply(source)); assert.equal(f.h.objects.size, objectCount);
  } finally { f.close(); }
});

test('committed final quotation ACK loss recovers exact stored bytes and selection without another write; later changes cannot replay', async () => {
  const f = await fixture(); try {
    const source = (await json(await f.source())).source, batch = f.h.db.batch; let lost = false;
    f.h.db.batch = async statements => { const result = await batch(statements); if (!lost && statements.length === 2) { lost = true; throw Error('fixture committed final quote ACK lost'); } return result; };
    const saved = await json(await f.apply(source)); assert.equal(saved.replayed, true); const baseline = f.snapshot(), count = f.h.objects.size;
    const recovered = await json(await f.recover(source)); assert.equal(recovered.key, saved.key); assert.equal(f.snapshot(), baseline); assert.equal(f.h.objects.size, count);
    const view = await f.read(); await json(await f.h.route(f.qurl, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [{ optionId: f.other, fieldKey: 'searchTags', value: '나중 수정' }] } }));
    const later = f.snapshot(); await status(await f.recover(source), 409); await status(await f.apply(source), 409); assert.equal(f.snapshot(), later);
  } finally { f.close(); }
});

test('stored final quotation PNG proof cannot downgrade to legacy common metadata or hide a different final override', async () => {
  for (const mode of ['legacy', 'wrong-overrides', 'changed-bytes']) {
    const f = await fixture(); try {
      const source = (await json(await f.source())).source, saved = await json(await f.apply(source)), head = await f.h.bindings.FILES.head(saved.key), metadata = { ...head.customMetadata };
      if (mode === 'legacy') { metadata.freeImageSource = f.h.load('app/free-image-translation.ts').freeImageSourceIdentity(source); delete metadata.freeImageSourceSha256; delete metadata.freeImageOptionIdsSha256; delete metadata.freeImageQuotationOverridesSha256; }
      if (mode === 'wrong-overrides') metadata.freeImageQuotationOverridesSha256 = '0'.repeat(64);
      if (mode === 'changed-bytes') f.h.objects.set(saved.key, new Uint8Array(png(91)));
      const get = f.h.bindings.FILES.get; f.h.bindings.FILES.get = async (...args) => { const object = await get(...args); return object && args[0] === saved.key ? { ...object, customMetadata: metadata } : object; };
      const baseline = f.snapshot(); await status(await f.recover(source), 409); assert.equal(f.snapshot(), baseline);
    } finally { f.close(); }
  }
});
