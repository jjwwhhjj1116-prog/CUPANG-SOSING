import test from 'node:test';
import assert from 'node:assert/strict';
import { freeImageReanchorFixture } from './helpers/free-image-reanchor-api.mjs';
import { sha } from './helpers/free-image-edit-api.mjs';
import { schemaCompanies } from './helpers/hub-schema.mjs';
import { providedOptionModule } from './helpers/provided-option-quotation.mjs';
import sharp from 'sharp';

const plain = value => JSON.parse(JSON.stringify(value));
const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
const files = f => [...f.h.objects].map(([key, bytes]) => [key, sha(bytes)]);
async function fixture() {
  const f = await freeImageReanchorFixture(schemaCompanies[0]);
  const content = await f.h.load('db/product-content.ts').readProductContent('owner', f.id);
  await f.h.load('db/product-content.ts').saveProductContent('owner', f.h.load('app/product-content.ts').applyContentPatch(content,
    { assets: { additional: [f.keys[2]], detail: [f.keys[8]], detailTop: [f.keys[3]], detailBottom: [f.keys[4]] } }, new Date().toISOString()), content.revision);
  const route = f.h.load('app/api/products/[id]/image-text/route.ts');
  const source = (role, key = role === 'main' ? f.keys[1] : role === 'additional' ? f.keys[2] : f.keys[8], editor) => route.GET(new Request('https://app.test' + f.base + '/image-text?' + new URLSearchParams({
    role, sourceKey: key, ...(editor ? { editor } : {}),
  })), { params: Promise.resolve({ id: f.id }) });
  return { ...f, roleSource: role => source(role).then(json), openRole: (role, key) => source(role, key, 'saved-current-role-v1'), rawRoleSource: source };
}

for (const role of ['main', 'additional', 'detail']) test(`fresh ${role} role edit seals its document and selected options, clears native review and reopens the original at an exact current quote slot`, async () => {
  const f = await fixture(); try {
    const { source } = await f.roleSource(role), document = f.doc(), before = await f.read(), originalFiles = files(f),
      optionsBefore = plain(await f.h.load('db/product-options.ts').readProductOptions('owner', f.id)),
      contentBefore = plain(await f.h.load('db/product-content.ts').readProductContent('owner', f.id)), ids = role === 'main' ? [f.selected] : [];
    const saved = await json(await f.applyEdit(source, document, f.png(90), { optionImageIds: JSON.stringify(ids) }));
    assert.match(saved.editDocumentSha256, /^[a-f0-9]{64}$/u);
    const side = JSON.parse(new TextDecoder().decode(f.h.objects.get(saved.key + '.edit.json'))), metadata = await f.h.bindings.FILES.head(saved.key);
    assert.equal(side.format, 'free-image-role-edit-record-v1'); assert.deepEqual(side.source, source); assert.deepEqual(side.optionImageIds, ids);
    assert.deepEqual(side.document, document); assert.deepEqual(side.company, schemaCompanies[0]); assert.equal(side.context.source, 'collection');
    assert.equal(side.context.profileId, f.profile.id); assert.equal(side.context.categoryId, f.profile.categoryId);
    assert.equal(metadata.customMetadata.freeImageEditDocumentSha256, saved.editDocumentSha256);
    assert.equal(metadata.customMetadata.freeImageEditRecordSha256, sha(f.h.objects.get(saved.key + '.edit.json')));
    assert.equal(metadata.customMetadata.freeImageOptionIdsSha256, sha(JSON.stringify(ids)));
    assert.deepEqual(plain(await f.h.load('app/free-image-edit-review.ts').readFreeImageEditReviews(f.h.bindings.FILES, 'owner', f.id, [saved.key])).map(item => item.status), ['clear']);
    const after = await f.read(); assert.deepEqual(after.overrides, before.overrides);
    const contentAfter = plain(await f.h.load('db/product-content.ts').readProductContent('owner', f.id));
    for (const name of Object.keys(contentBefore.assets)) if (name !== role) assert.deepEqual(contentAfter.assets[name], contentBefore.assets[name]);
    assert.deepEqual(contentAfter.seo, contentBefore.seo); assert.deepEqual(contentAfter.label, contentBefore.label);
    const optionsAfter = plain(await f.h.load('db/product-options.ts').readProductOptions('owner', f.id));
    for (const row of optionsAfter.rows) {
      const old = optionsBefore.rows.find(item => item.id === row.id);
      assert.deepEqual(row, ids.includes(row.id) ? { ...old, imageKey: saved.key, provenance: { ...old.provenance, imageKey: 'manual' }, updatedAt: saved.productVersion } : old);
    }
    for (const [key, digest] of originalFiles) assert.equal(sha(f.h.objects.get(key)), digest, key);
    const input = role === 'main' ? 'mainImage' : role === 'additional' ? 'additionalImages' : 'detailImages';
    await f.saveImages([{ input, value: role === 'main' ? saved.key : [f.keys[0], saved.key].join('\n') }]);
    const snapshot = f.snapshot(), storedFiles = files(f);
    assert.equal((await f.open(saved.key, { input, policy: 'saved' })).status, 409);
    const opened = await json(await f.open(saved.key, { input }));
    assert.equal(opened.source.sourceKey, source.sourceKey); assert.equal(opened.source.sourceSha256, source.sourceSha256);
    assert.equal(opened.source.editorSource.resultKey, saved.key); assert.equal(opened.source.editorSource.anchorPolicy, 'current-target-v1');
    assert.deepEqual(opened.editDocument, document); assert.equal(f.snapshot(), snapshot); assert.deepEqual(files(f), storedFiles);
    const edit = plain(opened.editDocument); edit.regions[0].translated = '원본을 다시 편집한 문구';
    const second = await json(await f.applyEdit(opened.source, edit, f.png(91)));
    assert.equal((await json(await f.open(second.key, { input }))).editDocument.regions[0].translated, edit.regions[0].translated);
    assert.equal(JSON.parse(new TextDecoder().decode(f.h.objects.get(second.key + '.edit.json'))).format, 'free-image-edit-record-v1');
  } finally { f.close(); }
});

for (const role of ['main', 'additional', 'detail']) test(`same-stage ${role} reopen keeps original layers and replaces only the current output and currently connected selected options`, async () => {
  const f = await fixture(); try {
    if (role === 'main') {
      const before = await json(await f.h.route(f.base + '/options')), rows = f.h.load('app/product-options.ts').optionInputs(before.options);
      rows.find(row => row.id === f.other).imageKey = f.keys[1];
      await json(await f.h.route(f.base + '/options', { method: 'PATCH', body: { expectedRevision: before.options.revision, expectedProductVersion: before.productVersion, rows } }));
    }
    const { source } = await f.roleSource(role), ids = role === 'main' ? [f.selected] : [], doc = f.doc(),
      first = await json(await f.applyEdit(source, doc, f.png(90), { optionImageIds: JSON.stringify(ids) })), snapshot = f.snapshot(), storedFiles = files(f);
    const client = f.h.load('app/free-image-translation-client.ts'), route = f.h.load('app/api/products/[id]/image-text/route.ts'), calls = [];
    const opened = plain(await client.readFreeImageSourceProof(f.id, f.product().updated_at, first.key, role, new AbortController().signal, async path => {
      calls.push(path); return route.GET(new Request('https://app.test' + path), { params: Promise.resolve({ id: f.id }) });
    }, undefined, { restoreEditor: true }));
    assert.equal(new URL(calls[0], 'https://app.test').searchParams.get('editor'), 'saved-current-role-v1');
    assert.equal(opened.source.sourceKey, source.sourceKey); assert.equal(opened.source.sourceSha256, source.sourceSha256);
    assert.deepEqual([opened.source.width, opened.source.height], [3, 2]); assert.deepEqual(opened.editDocument, doc);
    assert.equal(opened.source.editorSource.anchorPolicy, 'current-role-v1'); assert.equal(opened.source.editorSource.resultKey, first.key);
    if (role === 'main') assert.deepEqual(opened.source.optionImages.optionIds, [f.selected]);
    assert.equal(f.snapshot(), snapshot); assert.deepEqual(files(f), storedFiles);
    const edited = plain(opened.editDocument); edited.regions[0].translated = '두 번째 단계 편집';
    const second = await json(await f.applyEdit(opened.source, edited, f.png(92), { optionImageIds: JSON.stringify(ids) }));
    const current = await f.h.load('db/product-content.ts').readProductContent('owner', f.id);
    assert.deepEqual(plain(current.assets[role].value), [second.key]);
    const again = await json(await f.openRole(role, second.key)); assert.equal(again.source.sourceKey, source.sourceKey); assert.deepEqual(again.editDocument, edited);
    if (role === 'main') {
      const options = await f.h.load('db/product-options.ts').readProductOptions('owner', f.id);
      assert.equal(options.rows.find(row => row.id === f.selected).imageKey, second.key);
      assert.equal(options.rows.find(row => row.id === f.other).imageKey, source.sourceKey);
      assert.equal((await f.applyEdit(again.source, edited, f.png(93), { optionImageIds: JSON.stringify([f.other]) })).status, 400);
    }
    const beforeReplay = f.snapshot(), filesBeforeReplay = files(f);
    const replay = await json(await f.applyEdit(opened.source, edited, f.png(92), { optionImageIds: JSON.stringify(ids) }));
    assert.equal(replay.key, second.key); assert.equal(replay.replayed, true); assert.equal(replay.editDocumentSha256, second.editDocumentSha256);
    assert.equal(f.snapshot(), beforeReplay); assert.deepEqual(files(f), filesBeforeReplay);
  } finally { f.close(); }
});

test('generic main sidecar, PNG and attachment ACK loss recover the exact document/selected-option outcome through reads without duplicate files', async () => {
  const f = await fixture(); try {
    const { source } = await f.roleSource('main'), document = f.doc(), client = f.h.load('app/free-image-translation-client.ts'),
      image = { source, width: 3, height: 2, output: new Blob([f.png(90)], { type: 'image/png' }), optionImageIds: [f.selected], editDocument: document },
      route = f.h.load('app/api/products/[id]/image-text/route.ts'), fetcher = (path, init) => route.POST(new Request('https://app.test' + path, init), { params: Promise.resolve({ id: f.id }) }),
      put = f.h.bindings.FILES.put, batch = f.h.db.batch, prepare = f.h.db.prepare, sql = new WeakMap(), lost = new Set();
    f.h.bindings.FILES.put = async (key, bytes, options) => {
      const value = await put(key, bytes, options), kind = key.endsWith('.edit.json') ? 'sidecar' : key.includes('/free-image-') ? 'png' : null;
      if (kind && !lost.has(kind)) { lost.add(kind); throw Error(kind + ' ACK lost'); } return value;
    };
    f.h.db.prepare = text => { const statement = prepare(text); sql.set(statement, text); return statement; };
    f.h.db.batch = async statements => { const result = await batch(statements);
      if (!lost.has('attachment') && statements.some(statement => sql.get(statement)?.includes('INSERT INTO product_content(product_id,owner_id,revision,payload,updated_at)'))) { lost.add('attachment'); throw Error('attachment ACK lost'); }
      return result;
    };
    const count = f.h.objects.size, saved = await client.applyFreeImageTranslation(image, new AbortController().signal, fetcher);
    assert.deepEqual([...lost].sort(), ['attachment', 'png', 'sidecar']); assert.equal(f.h.objects.size, count + 2);
    const before = f.snapshot(), beforeFiles = files(f), recovered = await client.recoverFreeImageTranslation(image, new AbortController().signal, fetcher);
    assert.equal(recovered.applied, true); assert.equal(recovered.replayed, true); assert.equal(recovered.key, saved.key); assert.equal(recovered.editDocumentSha256, saved.editDocumentSha256);
    assert.equal(f.snapshot(), before); assert.deepEqual(files(f), beforeFiles);
    const changed = plain(document); changed.regions[0].translated = '다른 문서';
    assert.equal((await f.post({ action: 'recover', source, optionImageIds: [f.selected], editDocument: changed, outputSha256: sha(f.png(90)), outputBytes: f.png(90).length })).status, 409);
    assert.equal(f.snapshot(), before); assert.deepEqual(files(f), beforeFiles);
  } finally { f.close(); }
});

test('an unattached generic output is never reported as adopted; fresh read-only recovery and explicit retry preserve the same immutable files', async () => {
  const f = await fixture(); try {
    const { source } = await f.roleSource('detail'), document = f.doc(), before = f.snapshot(), attach = f.h.load('db/product-attachments.ts'), original = attach.attachProductDocument;
    attach.attachProductDocument = async () => { throw Error('uncommitted fixture attachment'); };
    assert.equal((await f.applyEdit(source, document)).status, 503); assert.equal(f.snapshot(), before);
    const stored = files(f), count = f.h.objects.size, recovered = await json(await f.recoverEdit(source, document));
    assert.equal(recovered.applied, false); assert.equal(f.snapshot(), before); assert.deepEqual(files(f), stored);
    attach.attachProductDocument = original; const saved = await json(await f.applyEdit(source, document));
    assert.equal(saved.key, recovered.key); assert.equal(f.h.objects.size, count); assert.deepEqual(files(f), stored);
  } finally { f.close(); }
});

test('generic source, selected-option, stale-version and caller-supplied context forgery are refused before writing proof files', async () => {
  const f = await fixture(); try {
    const { source } = await f.roleSource('main'), document = f.doc(), before = f.snapshot(), stored = files(f);
    for (const changes of [{ productId: 'another-product' }, { sourceKey: 'someone/foreign.png' }, { sourceSha256: '0'.repeat(64) }, { width: 2 },
      { contentRevision: source.contentRevision - 1 }, { productVersion: '2020-01-01T00:00:00.000Z' }, { optionImages: { ...source.optionImages, revision: source.optionImages.revision - 1 } }]) {
      const response = await f.applyEdit({ ...source, ...changes }, document); assert.ok([400, 409].includes(response.status), await response.clone().text());
    }
    assert.equal((await f.applyEdit(source, document, f.png(90), { optionImageIds: JSON.stringify([f.other]) })).status, 400);
    for (const name of ['context', 'company']) assert.equal((await f.applyEdit(source, document, f.png(90), { [name]: JSON.stringify({ forged: true }) })).status, 400);
    f.h.setCompany(schemaCompanies[1]); assert.equal((await f.applyEdit(source, document)).status, 409); f.h.setCompany(schemaCompanies[0]);
    f.h.setMembershipStatus('suspended'); assert.equal((await f.applyEdit(source, document)).status, 409); f.h.setMembershipStatus('approved');
    assert.equal(f.snapshot(), before); assert.deepEqual(files(f), stored);
  } finally { f.close(); }
});

test('a flat generic PNG cannot acquire proof from an empty or entirely unselected no-op document', async () => {
  const f = await fixture(); try {
    const { source } = await f.roleSource('detail'), before = f.snapshot(), stored = files(f);
    for (const regions of [[], f.doc().regions.map(region => ({ ...region, selected: false })), [{ ...f.doc().regions[0], translated: ' ' }]]) {
      const response = await f.applyEdit(source, { ...f.doc(), regions });
      assert.equal(response.status, 409); assert.equal(f.snapshot(), before); assert.deepEqual(files(f), stored);
    }
  } finally { f.close(); }
});

test('generic role proof tampering, role/context/company drift and missing legacy documents cannot reopen or become confirmed', async () => {
  const f = await fixture(); try {
    const { source } = await f.roleSource('detail'), saved = await json(await f.applyEdit(source, f.doc())), sideKey = saved.key + '.edit.json',
      side = f.h.objects.get(sideKey).slice(), png = f.h.objects.get(saved.key).slice(), metadata = await f.h.bindings.FILES.head(saved.key), before = f.snapshot();
    const review = async () => (await f.h.load('app/free-image-edit-review.ts').readFreeImageEditReviews(f.h.bindings.FILES, 'owner', f.id, [saved.key]))[0].status;
    for (const mode of ['missing-sidecar', 'document', 'shape', 'format', 'context', 'selected', 'record-hash', 'source-hash', 'options-hash', 'output-hash', 'dimensions', 'output-bytes']) {
      f.h.objects.set(sideKey, side.slice()); const custom = { ...metadata.customMetadata }; let bytes = png.slice();
      if (mode === 'missing-sidecar') f.h.objects.delete(sideKey);
      if (['document', 'shape', 'format', 'context', 'selected'].includes(mode)) {
        const value = JSON.parse(new TextDecoder().decode(side));
        if (mode === 'document') value.document.regions[0].translated = '변조';
        if (mode === 'shape') value.extra = true;
        if (mode === 'format') value.format = 'unknown-role-record';
        if (mode === 'context') value.context.categoryId = '991235';
        if (mode === 'selected') value.optionImageIds = ['unrelated'];
        const changed = new TextEncoder().encode(JSON.stringify(value)); f.h.objects.set(sideKey, changed); custom.freeImageEditRecordSha256 = sha(changed);
      }
      if (mode === 'record-hash') custom.freeImageEditRecordSha256 = '0'.repeat(64);
      if (mode === 'source-hash') custom.freeImageSourceSha256 = '0'.repeat(64);
      if (mode === 'options-hash') custom.freeImageOptionIdsSha256 = sha('["unrelated"]');
      if (mode === 'output-hash') custom.freeImageOutputSha256 = '0'.repeat(64);
      if (mode === 'dimensions') custom.imageWidth = '999';
      if (mode === 'output-bytes') bytes[bytes.length - 1] ^= 1;
      await f.h.bindings.FILES.put(saved.key, bytes, { httpMetadata: metadata.httpMetadata, customMetadata: custom });
      assert.equal((await f.openRole('detail', saved.key)).status, 409, mode); assert.equal(f.snapshot(), before, mode);
      if (!['context', 'output-bytes'].includes(mode)) assert.equal(await review(), 'unconfirmed', mode);
    }
    f.h.objects.set(sideKey, side); await f.h.bindings.FILES.put(saved.key, png, { httpMetadata: metadata.httpMetadata, customMetadata: metadata.customMetadata });
    f.h.setCompany(schemaCompanies[1]); assert.equal((await f.openRole('detail', saved.key)).status, 409); f.h.setCompany(schemaCompanies[0]);
    assert.equal((await f.openRole('additional', saved.key)).status, 409); assert.equal(f.snapshot(), before);
    const legacy = await f.roleSource('additional'), old = await json(await f.applyEdit(legacy.source, undefined)), snapshot = f.snapshot();
    const absent = await f.openRole('additional', old.key); assert.equal(absent.status, 404); assert.equal((await absent.json()).code, 'image-edit-document-missing');
    const client = f.h.load('app/free-image-translation-client.ts'), route = f.h.load('app/api/products/[id]/image-text/route.ts'), calls = [];
    const fallback = await client.readFreeImageSourceProof(f.id, f.product().updated_at, old.key, 'additional', new AbortController().signal, async path => {
      calls.push(path); return route.GET(new Request('https://app.test' + path), { params: Promise.resolve({ id: f.id }) });
    }, undefined, { restoreEditor: true });
    assert.equal(fallback.editDocument, undefined); assert.equal(fallback.source.editorSource, undefined); assert.equal(fallback.source.sourceKey, old.key); assert.equal(calls.length, 2);
    assert.equal((await f.post({ action: 'recover', source: legacy.source, outputSha256: sha(f.png(90)), outputBytes: f.png(90).length })).status, 400);
    assert.equal(f.snapshot(), snapshot);
  } finally { f.close(); }
});

test('generic crop-only editing retains the full original canvas and exact crop while the selected output uses cropped dimensions', async () => {
  const f = await fixture(); try {
    const { source } = await f.roleSource('detail'), crop = { x: 1, y: 1, width: 2, height: 1, sourceWidth: 3, sourceHeight: 2 },
      document = { ...f.doc(), regions: [], crop }, png = await sharp({ create: { width: 2, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer();
    const saved = await json(await f.applyEdit(source, document, png)), opened = await json(await f.openRole('detail', saved.key));
    assert.deepEqual(opened.editDocument, document); assert.deepEqual([opened.source.width, opened.source.height], [3, 2]); assert.equal(opened.source.sourceKey, source.sourceKey);
    const metadata = await f.h.bindings.FILES.head(saved.key); assert.equal(metadata.customMetadata.imageWidth, '2'); assert.equal(metadata.customMetadata.imageHeight, '1');
    assert.equal((await json(await f.recoverEdit(source, document, png))).applied, true);
  } finally { f.close(); }
});

test('an option-only main edit and same-stage reedit preserve the exact common document and unselected option image', async () => {
  const f = await fixture(); try {
    const db = f.h.load('db/product-content.ts'), content = await db.readProductContent('owner', f.id);
    await db.saveProductContent('owner', f.h.load('app/product-content.ts').applyContentPatch(content, { assets: { main: [f.keys[0]] } }, new Date().toISOString()), content.revision);
    const originalContent = JSON.stringify(await db.readProductContent('owner', f.id)), { source } = await f.roleSource('main');
    assert.equal(source.optionImages.commonAssigned, false);
    const first = await json(await f.applyEdit(source, f.doc(), f.png(90), { optionImageIds: JSON.stringify([f.selected]) }));
    assert.equal(JSON.stringify(await db.readProductContent('owner', f.id)), originalContent);
    const opened = await json(await f.openRole('main', first.key)); assert.equal(opened.source.optionImages.commonAssigned, false);
    const second = await json(await f.applyEdit(opened.source, f.doc(), f.png(91), { optionImageIds: JSON.stringify([f.selected]) }));
    assert.equal(JSON.stringify(await db.readProductContent('owner', f.id)), originalContent);
    const options = await f.h.load('db/product-options.ts').readProductOptions('owner', f.id);
    assert.equal(options.rows.find(row => row.id === f.selected).imageKey, second.key); assert.equal(options.rows.find(row => row.id === f.other).imageKey, null);
  } finally { f.close(); }
});

test('source, option, category and company changes during immutable PNG storage refuse generic adoption and retain competing state', async () => {
  for (const mode of ['source', 'options', 'category', 'company']) {
    const f = await fixture(); try {
      const { source } = await f.roleSource('main'), put = f.h.bindings.FILES.put; let changed = false, competing;
      f.h.bindings.FILES.put = async (key, bytes, options) => {
        const result = await put(key, bytes, options);
        if (!changed && key.includes('/free-image-') && key.endsWith('.png')) {
          changed = true;
          if (mode === 'source') f.h.objects.set(source.sourceKey, new Uint8Array(f.png(31)));
          if (mode === 'options') { const row = f.h.sqlite.prepare('SELECT * FROM product_options WHERE product_id=?').get(f.id), value = JSON.parse(row.payload); value.revision++;
            f.h.sqlite.prepare('UPDATE product_options SET revision=?,payload=? WHERE product_id=?').run(value.revision, JSON.stringify(value), f.id); }
          if (mode === 'category') { const row = f.h.sqlite.prepare('SELECT * FROM collection_context WHERE job_id=?').get('job'), value = JSON.parse(row.payload); value.category.id = 'other-profile';
            f.h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(value), 'job'); }
          if (mode === 'company') f.h.setCompany(schemaCompanies[1]);
          competing = f.snapshot();
        }
        return result;
      };
      const response = await f.applyEdit(source, f.doc(), f.png(90), { optionImageIds: JSON.stringify([f.selected]) });
      assert.ok([409, 503].includes(response.status), mode + ': ' + await response.clone().text()); assert.equal(changed, true); assert.equal(f.snapshot(), competing, mode);
    } finally { f.close(); }
  }
});

test('historical v1 quotation key and canonical document/record hashes retain the exact captured 03104a92 identity', async () => {
  const records = providedOptionModule('app/free-image-edit-record.ts'), source = { productId: 'legacy-product', productVersion: '2026-10-31T00:00:00.000Z', contentRevision: 2,
    sourceKey: 'owner/original.png', sourceSha256: 'a'.repeat(64), role: 'detail', width: 3, height: 2,
    quotationTarget: { kind: 'quotation', profileId: 'cat', optionId: 'one', input: 'detailImages', fieldKey: 'detailImages', slotIndex: 0, revision: 3,
      inputFingerprint: 'b'.repeat(64), optionRevision: 1, bindingSha256: 'c'.repeat(64), value: 'owner/original.png' } },
    document = { format: 'free-image-edit-v1', width: 3, height: 2, sourceLanguage: 'zh', regions: [{ id: 'manual', text: '中', translated: '한',
      box: { x: 0, y: 0, width: 3, height: 2 }, confidence: 80, selected: true, issue: null, translationProvenance: 'manual', background: '#ffffff', foreground: '#000000', fontSize: 1 }] };
  const expectedKey = 'owner/free-image-legacy-product-873ecb8af24e9206b55d3aa82cfc3db3f2c8d63d081e9e65e3bcbf343b3dfd18-' + 'd'.repeat(64) + '.png';
  assert.equal((await records.freeImageEditOutputKey(source, document, 'd'.repeat(64))).key, expectedKey);
  const prepared = await records.prepareFreeImageEditRecord(source, document, { source: 'collection', profileId: 'cat', categoryId: '991234', categoryPath: ['시험 대분류', '시험 최종분류'] },
    schemaCompanies[0], { key: expectedKey, sha256: 'd'.repeat(64), bytes: 123, width: 3, height: 2 });
  assert.equal(prepared.documentSha256, '95fde95dba49863677554e920bb510861fccce4d3d73553dfeb8773d3471e0d4');
  assert.equal(prepared.recordSha256, 'c503e505a3629eddc1054f5e7c96a26bf0105eebc3d772b8f79ea7ab25d5a19f');
  assert.deepEqual(Object.keys(prepared.record), ['format', 'source', 'document', 'context', 'company', 'result']);
});
