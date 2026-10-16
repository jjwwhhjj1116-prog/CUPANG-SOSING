import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { freeImageEditFixture, sha } from './helpers/free-image-edit-api.mjs';
import { schemaCompanies } from './helpers/hub-schema.mjs';
const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
const plain = value => JSON.parse(JSON.stringify(value));

for (const company of schemaCompanies) test(`explicit quote apply seals editable text/style/brush inputs and reopens original pixels read-only (${company.code})`, async () => {
  const f = await freeImageEditFixture(company);
  try {
    const source = (await json(await f.source())).source, doc = f.doc(), before = f.sourceRows(), saved = await json(await f.applyEdit(source, doc));
    assert.match(saved.editDocumentSha256, /^[a-f0-9]{64}$/u); assert.equal(saved.applied, true); assert.equal(f.sourceRows(), before);
    const normalized = f.h.load('app/free-image-edit-document.ts').validateFreeImageEditDocument(doc, source), sideKey = saved.key + '.edit.json', side = JSON.parse(new TextDecoder().decode(f.h.objects.get(sideKey)));
    assert.deepEqual(side.document, plain(normalized)); assert.deepEqual(side.company, company); assert.equal(side.source.productId, f.id);
    assert.equal(side.source.quotationTarget.optionId, f.selected); assert.equal(side.result.key, saved.key); assert.equal(side.result.sha256, sha(f.png(90)));
    const object = await f.h.bindings.FILES.head(saved.key); assert.equal(object.customMetadata.freeImageEditDocumentSha256, saved.editDocumentSha256);
    assert.equal(object.customMetadata.freeImageEditRecordSha256, sha(f.h.objects.get(sideKey)));
    const after = f.snapshot(), files = [...f.h.objects].map(([key, bytes]) => [key, sha(bytes)]), opened = await json(await f.reopen(saved.key));
    assert.equal(f.snapshot(), after); assert.deepEqual([...f.h.objects].map(([key, bytes]) => [key, sha(bytes)]), files);
    assert.deepEqual(opened.editDocument, plain(normalized)); assert.equal(opened.source.sourceKey, source.sourceKey); assert.equal(opened.source.sourceSha256, source.sourceSha256);
    assert.equal(opened.source.editorSource.resultKey, saved.key); assert.equal(opened.source.editorSource.resultSha256, side.result.sha256); assert.equal(opened.source.editorSource.documentSha256, saved.editDocumentSha256);
    assert.equal(opened.source.quotationTarget.value.split('\n')[1], saved.key); assert.ok(opened.source.quotationTarget.revision > source.quotationTarget.revision);
    const hidden = await f.h.load('app/api/files/[...key]/route.ts').GET(new Request('https://app.test/api/files/' + sideKey), { params: Promise.resolve({ key: sideKey.split('/') }) }); assert.equal(hidden.status, 404);
    assert.equal(f.snapshot(), after);
  } finally { f.close(); }
});

test('reopened edit rebases onto current quote after unrelated edits and a second result still renders from the first original', async () => {
  const f = await freeImageEditFixture(schemaCompanies[0]);
  try {
    const source = (await json(await f.source())).source, saved = await json(await f.applyEdit(source, f.doc()));
    let view = await f.read(); await json(await f.h.route(f.qurl, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
      changes: [{ optionId: f.other, fieldKey: 'brand', value: '다른 옵션의 별도 변경' }] } }));
    const opened = await json(await f.reopen(saved.key)), doc = opened.editDocument; doc.regions[0].translated = '두 번째 수동 문구';
    const newer = await json(await f.applyEdit(opened.source, doc, f.png(91))); assert.notEqual(newer.key, saved.key);
    const reopened = await json(await f.reopen(newer.key)); assert.equal(reopened.source.sourceKey, source.sourceKey); assert.equal(reopened.source.sourceSha256, source.sourceSha256);
    assert.equal(reopened.source.editorSource.resultKey, newer.key); assert.equal(reopened.editDocument.regions[0].translated, '두 번째 수동 문구');
    assert.equal((await f.read()).resolved.rows.find(row => row.optionId === f.other).fields.brand.value, '다른 옵션의 별도 변경');
    assert.equal((await f.applyEdit(reopened.source, undefined)).status, 400);
  } finally { f.close(); }
});

test('crop recipe keeps original coordinates and can reopen a cropped output without using flattened pixels as the canvas', async () => {
  const f = await freeImageEditFixture(schemaCompanies[1]);
  try {
    const source = (await json(await f.source())).source, doc = f.doc(); doc.crop = { x: 1, y: 1, width: 2, height: 1, sourceWidth: 3, sourceHeight: 2 };
    const png = await sharp({ create: { width: 2, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer();
    const saved = await json(await f.applyEdit(source, doc, png)), opened = await json(await f.reopen(saved.key));
    assert.equal(opened.source.width, 3); assert.equal(opened.source.height, 2); assert.deepEqual(opened.editDocument.crop, doc.crop); assert.deepEqual(opened.editDocument.regions[0].box, doc.regions[0].box);
    assert.equal((await f.applyEdit(source, doc, png, { crop: JSON.stringify({ ...doc.crop, x: 0 }) })).status, 400);
    assert.equal((await json(await f.recoverEdit(source, doc, png))).applied, true);
  } finally { f.close(); }
});

test('wrong option/slot, stale anchor and imported family context do not expose an editable document or write anything', async () => {
  const f = await freeImageEditFixture(schemaCompanies[0]);
  try {
    const source = (await json(await f.source())).source, saved = await json(await f.applyEdit(source, f.doc())), before = f.snapshot();
    for (const changes of [{ optionId: f.other }, { slotIndex: '0' }, { sourceKey: source.sourceKey }]) assert.equal((await f.reopen(saved.key, changes)).status, 409);
    assert.equal(f.snapshot(), before);
    const view = await f.read(), target = f.h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(view.resolved.schema.fields, 'additionalImages');
    await json(await f.h.route(f.qurl, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
      changes: target.linked.map(fieldKey => ({ optionId: f.selected, fieldKey, value: [f.keys[2], source.sourceKey, f.keys[3]].join('\n') })) } }));
    const after = f.snapshot(); assert.equal((await f.reopen(saved.key)).status, 409); assert.equal(f.snapshot(), after);
  } finally { f.close(); }
});

test('sidecar tampering is not a legacy404 fallback and deterministic result identity changes when only the recipe changes', async () => {
  const f = await freeImageEditFixture(schemaCompanies[0]);
  try {
    const source = (await json(await f.source())).source, doc = f.doc(), saved = await json(await f.applyEdit(source, doc)), key = saved.key + '.edit.json';
    const bytes = f.h.objects.get(key).slice(), body = JSON.parse(new TextDecoder().decode(bytes)); body.document.regions[0].translated = '변조'; f.h.objects.set(key, new TextEncoder().encode(JSON.stringify(body)));
    const before = f.snapshot(); assert.equal((await f.reopen(saved.key)).status, 409); assert.equal((await f.recoverEdit(source, doc)).status, 409); assert.equal(f.snapshot(), before);
    f.h.objects.set(key, bytes);
    const other = f.doc(); other.regions[0].translated = '같은 PNG지만 다른 편집값';
    const identity = f.h.load('app/free-image-edit-record.ts'), a = await identity.freeImageEditOutputKey(source, doc, sha(f.png(90))), b = await identity.freeImageEditOutputKey(source, other, sha(f.png(90)));
    assert.notEqual(a.key, b.key); assert.equal(a.key, saved.key);
    const legacy = await json(await f.source('detailImages')), legacySaved = await json(await f.apply(legacy.source));
    const absent = await f.source('detailImages', { sourceKey: legacySaved.key, editor: 'saved' }); assert.equal(absent.status, 404); assert.equal((await absent.json()).code, 'image-edit-document-missing');
  } finally { f.close(); }
});

test('lost sidecar and PNG upload ACKs are proved before the one quote commit and recovery stays read-only', async () => {
  const f = await freeImageEditFixture(schemaCompanies[1]);
  try {
    const source = (await json(await f.source())).source, doc = f.doc(), put = f.h.bindings.FILES.put; let sideLost = false, pngLost = false;
    f.h.bindings.FILES.put = async (key, bytes, options) => { const result = await put(key, bytes, options); if (key.endsWith('.edit.json') && !sideLost) { sideLost = true; throw Error('sidecarACKlost'); } if (key.endsWith('.png') && key.includes('/free-image-') && !pngLost) { pngLost = true; throw Error('PNGACKlost'); } return result; };
    const saved = await json(await f.applyEdit(source, doc)); assert.ok(sideLost && pngLost);
    const before = f.snapshot(), count = f.h.objects.size; assert.equal((await json(await f.recoverEdit(source, doc))).key, saved.key); assert.equal(f.snapshot(), before); assert.equal(f.h.objects.size, count);
    assert.equal((await json(await f.applyEdit(source, doc))).replayed, true); assert.equal(f.snapshot(), before);
  } finally { f.close(); }
});

test('partly stripped edit markers or a missing sidecar fail closed rather than downgrading to flattened legacy editing', async () => {
  const f = await freeImageEditFixture(schemaCompanies[0]);
  try {
    const source = (await json(await f.source())).source, saved = await json(await f.applyEdit(source, f.doc())), bytes = f.h.objects.get(saved.key).slice(),
      sideKey = saved.key + '.edit.json', sideBytes = f.h.objects.get(sideKey).slice(), metadata = await f.h.bindings.FILES.head(saved.key), before = f.snapshot();
    for (const mode of ['doc-marker', 'record-marker', 'both-markers', 'sidecar']) {
      const custom = { ...metadata.customMetadata };
      if (mode === 'doc-marker' || mode === 'both-markers') delete custom.freeImageEditDocumentSha256;
      if (mode === 'record-marker' || mode === 'both-markers') delete custom.freeImageEditRecordSha256;
      if (mode === 'sidecar') f.h.objects.delete(sideKey); else f.h.objects.set(sideKey, sideBytes);
      await f.h.bindings.FILES.put(saved.key, bytes, { httpMetadata: metadata.httpMetadata, customMetadata: custom });
      const response = await f.reopen(saved.key); assert.equal(response.status, 409, mode); assert.notEqual((await response.json()).code, 'image-edit-document-missing'); assert.equal(f.snapshot(), before);
    }
  } finally { f.close(); }
});

test('actual original/output corruption, company changes and a same-URL family copy cannot rebind the document', async () => {
  const f = await freeImageEditFixture(schemaCompanies[0]);
  try {
    const source = (await json(await f.source())).source, saved = await json(await f.applyEdit(source, f.doc()));
    for (const key of [source.sourceKey, saved.key]) {
      const original = f.h.objects.get(key).slice(), changed = original.slice(); changed[changed.length - 1] ^= 1; f.h.objects.set(key, changed);
      const before = f.snapshot(); assert.equal((await f.reopen(saved.key)).status, 409); assert.equal(f.snapshot(), before); f.h.objects.set(key, original);
    }
    f.h.setCompany(schemaCompanies[1]); const beforeCompany = f.snapshot(); assert.equal((await f.reopen(saved.key)).status, 409); assert.equal(f.snapshot(), beforeCompany); f.h.setCompany(schemaCompanies[0]);
    const child = 'different-family-product', original = { ...f.product(), id: child }, columns = Object.keys(original);
    f.h.sqlite.prepare(`INSERT INTO products(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...Object.values(original));
    for (const table of ['product_content', 'product_options', 'product_quotation_fields']) {
      const row = { ...f.h.sqlite.prepare(`SELECT * FROM ${table} WHERE product_id=?`).get(f.id), product_id: child }, payload = JSON.parse(row.payload); payload.productId = child; row.payload = JSON.stringify(payload);
      const fields = Object.keys(row); f.h.sqlite.prepare(`INSERT INTO ${table}(${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')})`).run(...Object.values(row));
    }
    const now = new Date().toISOString();
    f.h.sqlite.prepare(`INSERT INTO product_option_split_operations(owner_id,request_id,source_product_id,family_id,root_product_id,profile_id,attempt_id,request_payload,before_payload,after_payload,receipt_payload,committed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run('owner', 'fixture-family', f.id, 'same-family', f.id, f.profile.id, 'fixture-attempt', '{}', '{}', '{}', '{}', now);
    f.h.sqlite.prepare('INSERT INTO product_option_split_members VALUES(?,?,?,?,?,?,?)').run('owner', f.id, 'same-family', f.id, null, 'fixture-family', now);
    f.h.sqlite.prepare('INSERT INTO product_option_split_members VALUES(?,?,?,?,?,?,?)').run('owner', child, 'same-family', f.id, f.id, 'fixture-family', now);
    const view = await f.read(), target = f.h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(view.resolved.schema.fields, 'additionalImages');
    const query = new URLSearchParams({ sourceKey: saved.key, role: 'additional', target: 'quotation', profileId: f.profile.id, optionId: f.selected, fieldKey: target.primary, slotIndex: '1', editor: 'saved' });
    const beforeChild = f.snapshot(), response = await f.h.load('app/api/products/[id]/image-text/route.ts').GET(new Request('https://app.test/api/products/' + child + '/image-text?' + query), { params: Promise.resolve({ id: child }) });
    assert.equal(response.status, 409); assert.equal(f.snapshot(), beforeChild);
  } finally { f.close(); }
});

test('new document adoption rolls back ignored companions and guards exact quotation payload and approved membership inside SQLite', async () => {
  for (const mode of ['ignore-quote', 'ignore-product', 'member', 'company', 'quotation']) {
    const f = await freeImageEditFixture(schemaCompanies[0]);
    try {
      const source = (await json(await f.source())).source, doc = f.doc(), sql = new WeakMap(), prepare = f.h.db.prepare, batch = f.h.db.batch; let competing, injected = false;
      const all = () => JSON.stringify(f.h.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => [name, f.h.sqlite.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all()]));
      if (mode === 'ignore-quote') f.h.sqlite.exec('CREATE TRIGGER ignore_edit_quote BEFORE INSERT ON product_quotation_fields BEGIN SELECT RAISE(IGNORE); END');
      if (mode === 'ignore-product') f.h.sqlite.exec('CREATE TRIGGER ignore_edit_product BEFORE UPDATE ON products BEGIN SELECT RAISE(IGNORE); END');
      f.h.db.prepare = text => { const statement = prepare(text); sql.set(statement, text); return statement; };
      f.h.db.batch = async statements => {
        if (!injected && statements.some(statement => sql.get(statement)?.startsWith('UPDATE product_quotation_fields SET revision=CASE'))) {
          injected = true;
          if (mode === 'member') f.h.sqlite.prepare("UPDATE members SET status='suspended'").run();
          if (mode === 'company') f.h.sqlite.prepare("UPDATE members SET company_code='A01526306',company_name='유앤채'").run();
          if (mode === 'quotation') { const row = f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(f.id), value = JSON.parse(row.payload); value.categoryOverrides['category:' + f.profile.categoryId].common.brand = '경쟁하는 동일 리비전 변경'; f.h.sqlite.prepare('UPDATE product_quotation_fields SET payload=? WHERE product_id=?').run(JSON.stringify(value), f.id); }
          competing = all();
        }
        return batch(statements);
      };
      const response = await f.applyEdit(source, doc); assert.ok([409, 503].includes(response.status), mode + ': ' + await response.clone().text()); assert.equal(injected, true); assert.equal(all(), competing, mode);
      assert.ok([...f.h.objects.keys()].some(key => key.endsWith('.edit.json')), 'only unreferenced immutable files may remain');
    } finally { f.close(); }
  }
});

test('sidecar or PNG storage failure cannot adopt a quote; healthy retry verifies and reuses any detached immutable file', async () => {
  for (const phase of ['sidecar', 'png']) {
    const f = await freeImageEditFixture(schemaCompanies[1]);
    try {
      const source = (await json(await f.source())).source, before = f.snapshot(), put = f.h.bindings.FILES.put; let failed = false;
      f.h.bindings.FILES.put = async (key, bytes, options) => {
        if (phase === 'sidecar' && key.endsWith('.edit.json') || phase === 'png' && key.includes('/free-image-') && key.endsWith('.png')) { failed = true; throw Error('uncommitted fixture storage failure'); }
        return put(key, bytes, options);
      };
      const response = await f.applyEdit(source, f.doc()); assert.equal(response.status, 503); assert.ok(failed); assert.equal(f.snapshot(), before);
      assert.equal([...f.h.objects.keys()].filter(key => key.endsWith('.edit.json')).length, phase === 'png' ? 1 : 0);
      f.h.bindings.FILES.put = put; assert.equal((await json(await f.applyEdit(source, f.doc()))).applied, true);
    } finally { f.close(); }
  }
});

test('legacy JSON remains bounded to 96 KiB while an explicitly sealed document can recover its larger complete payload', async () => {
  const f = await freeImageEditFixture(schemaCompanies[0]);
  try {
    const source = (await json(await f.source())).source, before = f.snapshot();
    const legacyTranslate = { action: 'translate', source, sourceLanguage: 'zh', regions: [{ id: 'oversized', text: ' '.repeat(96 * 1024) }] };
    assert.equal((await f.post(legacyTranslate)).status, 413);
    assert.equal((await f.post({ action: 'recover', source, outputSha256: sha(f.png(90)), outputBytes: f.png(90).length, padding: ' '.repeat(96 * 1024) })).status, 413);
    assert.equal(f.snapshot(), before);
    const document = f.doc(), region = document.regions[0];
    document.regions = Array.from({ length: 4 }, (_, index) => ({ ...region, id: 'large-' + index, text: '原'.repeat(5000), translated: '번'.repeat(5000) }));
    assert.ok(Buffer.byteLength(JSON.stringify(document)) > 96 * 1024);
    const saved = await json(await f.applyEdit(source, document)), after = f.snapshot(), recovered = await json(await f.recoverEdit(source, document));
    assert.equal(recovered.applied, true); assert.equal(recovered.key, saved.key); assert.equal(recovered.editDocumentSha256, saved.editDocumentSha256); assert.equal(f.snapshot(), after);
  } finally { f.close(); }
});
