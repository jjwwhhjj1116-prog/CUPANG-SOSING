import test from 'node:test';
import assert from 'node:assert/strict';
import { schemaCompanies } from './helpers/hub-schema.mjs';
import { freeImageReanchorFixture } from './helpers/free-image-reanchor-api.mjs';
import { sha } from './helpers/free-image-edit-api.mjs';

const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
const plain = value => JSON.parse(JSON.stringify(value));
const objects = f => [...f.h.objects].map(([key, bytes]) => [key, sha(bytes)]);

for (const company of schemaCompanies) test(`an explicit current-target reopen moves a saved edited photo without changing original provenance (${company.code})`, async () => {
  const f = await freeImageReanchorFixture(company);
  try {
    const { source, saved } = await f.seed(), sideKey = saved.key + '.edit.json', sideBefore = f.h.objects.get(sideKey).slice();
    const beforeView = await f.saveImages([{ input: 'additionalImages', value: [saved.key, f.keys[2], f.keys[3]].join('\n') }]), before = f.snapshot(), oldObjects = objects(f);
    assert.equal((await f.open(saved.key, { slotIndex: 0, policy: 'saved' })).status, 409);
    const opened = await json(await f.open(saved.key, { slotIndex: 0 }));
    assert.equal(f.snapshot(), before); assert.deepEqual(objects(f), oldObjects);
    assert.equal(opened.source.sourceKey, source.sourceKey); assert.equal(opened.source.sourceSha256, source.sourceSha256);
    assert.equal(opened.source.editorSource.anchorPolicy, 'current-target-v1'); assert.equal(opened.source.editorSource.resultKey, saved.key);
    assert.equal(opened.source.quotationTarget.slotIndex, 0); assert.equal(opened.source.quotationTarget.revision, beforeView.revision);
    assert.equal(opened.source.productVersion, beforeView.productVersion);
    const sourceTables = f.sourceRows(), doc = opened.editDocument; doc.regions[0].translated = '이동한 사진의 새 문구';
    const result = await json(await f.applyEdit(opened.source, doc, f.png(92))), after = await f.read();
    for (const row of beforeView.resolved.rows) {
      const actual = after.resolved.rows.find(value => value.optionId === row.optionId), expected = plain(row);
      if (row.optionId === f.selected) for (const key of f.target('additionalImages').linked) expected.fields[key].value = [result.key, f.keys[2], f.keys[3]].join('\n');
      for (const [field, cell] of Object.entries(expected.fields)) assert.equal(actual.fields[field].value, cell.value, String(row.optionId) + ':' + field);
    }
    assert.equal(f.sourceRows(), sourceTables); assert.deepEqual(f.h.objects.get(sideKey), sideBefore);
    const record = JSON.parse(new TextDecoder().decode(f.h.objects.get(result.key + '.edit.json')));
    assert.equal(record.source.quotationTarget.slotIndex, 0); assert.equal(record.source.editorSource.anchorPolicy, 'current-target-v1');
    assert.equal(record.source.sourceKey, source.sourceKey); assert.equal(record.source.quotationTarget.optionId, f.selected);
    const reopened = await json(await f.open(result.key, { slotIndex: 0 })); assert.equal(reopened.editDocument.regions[0].translated, doc.regions[0].translated);
  } finally { f.close(); }
});

test('the same owned saved result can reanchor across all four current quotation roles and another real option only', async () => {
  const f = await freeImageReanchorFixture(schemaCompanies[0]);
  try {
    const { source, saved } = await f.seed(), edits = ['mainImage', 'additionalImages', 'detailImages', 'labelImages'].map(input => ({ input, optionId: f.other, value: input === 'mainImage' ? saved.key : [f.keys[3], saved.key].join('\n') }));
    await f.saveImages(edits);
    for (const input of edits.map(value => value.input)) {
      const selection = { input, optionId: f.other }, before = f.snapshot(), originalObjects = objects(f);
      assert.equal((await f.open(saved.key, { ...selection, policy: 'saved' })).status, 409);
      const opened = await json(await f.open(saved.key, selection));
      assert.equal(opened.source.sourceKey, source.sourceKey); assert.equal(opened.source.quotationTarget.input, input); assert.equal(opened.source.quotationTarget.optionId, f.other);
      assert.equal(opened.source.role, input === 'mainImage' ? 'main' : input === 'additionalImages' ? 'additional' : input === 'labelImages' ? 'label' : 'detail');
      assert.equal(f.snapshot(), before); assert.deepEqual(objects(f), originalObjects);
    }
    const ordinary = await json(await f.open(saved.key, { input: 'mainImage', optionId: f.other, policy: null }));
    assert.equal(ordinary.source.editorSource, undefined); assert.equal(ordinary.editDocument, undefined);
    const opened = await json(await f.open(saved.key, { input: 'detailImages', optionId: f.other })), before = await f.read();
    const result = await json(await f.applyEdit(opened.source, opened.editDocument, f.png(93))), after = await f.read();
    for (const row of before.resolved.rows) for (const [fieldKey, cell] of Object.entries(row.fields)) {
      const expected = row.optionId === f.other && f.target('detailImages').linked.includes(fieldKey) ? [f.keys[3], result.key].join('\n') : cell.value;
      assert.equal(after.resolved.rows.find(value => value.optionId === row.optionId).fields[fieldKey].value, expected);
    }
  } finally { f.close(); }
});

test('unknown policies, forged hashes, stale anchors and a late saved change fail without adopting any output', async () => {
  const f = await freeImageReanchorFixture(schemaCompanies[0]);
  try {
    const { saved } = await f.seed(); await f.saveImages([{ input: 'additionalImages', value: [saved.key, f.keys[2]].join('\n') }]);
    const opened = await json(await f.open(saved.key, { slotIndex: 0 })), before = f.snapshot();
    assert.equal((await f.open(saved.key, { slotIndex: 0, policy: 'current-target-v2' })).status, 400);
    assert.equal((await f.open(saved.key, { slotIndex: 1 })).status, 409);
    for (const [field, value] of [['anchorPolicy', 'forged'], ['resultSha256', '0'.repeat(64)], ['documentSha256', '0'.repeat(64)]]) {
      const forged = plain(opened.source); forged.editorSource[field] = value;
      assert.equal((await f.applyEdit(forged, opened.editDocument)).status, field === 'anchorPolicy' ? 400 : 409);
    }
    assert.equal(f.snapshot(), before);
    const view = await f.read(); await json(await f.h.route(f.qurl, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [{ optionId: f.other, fieldKey: 'brand', value: '늦게 저장한 내용' }] } }));
    const later = f.snapshot(); assert.equal((await f.applyEdit(opened.source, opened.editDocument)).status, 409); assert.equal(f.snapshot(), later);
    const fresh = await json(await f.open(saved.key, { slotIndex: 0 })); assert.notEqual(fresh.source.productVersion, opened.source.productVersion);
    assert.equal(fresh.source.quotationTarget.revision, view.revision + 1);
  } finally { f.close(); }
});

test('new target policy is part of deterministic identity, survives a lost save ACK and recovers using reads alone', async () => {
  const f = await freeImageReanchorFixture(schemaCompanies[1]);
  try {
    const { saved } = await f.seed(), strict = (await json(await f.open(saved.key, { policy: 'saved' }))).source,
      opened = await json(await f.open(saved.key)), model = f.h.load('app/free-image-translation.ts');
    assert.equal(Object.hasOwn(strict.editorSource, 'anchorPolicy'), false);
    assert.notEqual(model.freeImageSourceIdentity(strict), model.freeImageSourceIdentity(opened.source));
    const historicalIdentity = JSON.parse(model.freeImageSourceIdentity(opened.source)); delete historicalIdentity.editorSource.anchorPolicy;
    assert.equal(model.freeImageSourceIdentity(strict), JSON.stringify(historicalIdentity));
    // Deliberately discard the successful write response, as a caller losing its ACK would.
    const response = await f.applyEdit(opened.source, opened.editDocument, f.png(94)); assert.equal(response.status, 200);
    const after = f.snapshot(), files = objects(f), recovered = await json(await f.recoverEdit(opened.source, opened.editDocument, f.png(94)));
    assert.equal(recovered.applied, true); assert.equal(recovered.source.editorSource.anchorPolicy, 'current-target-v1');
    assert.equal(f.snapshot(), after); assert.deepEqual(objects(f), files);
    const replayed = await json(await f.applyEdit(opened.source, opened.editDocument, f.png(94))); assert.equal(replayed.replayed, true); assert.equal(f.snapshot(), after);
  } finally { f.close(); }
});

test('current-target mode verifies original, result and sidecar bytes even after the photo moves', async () => {
  const f = await freeImageReanchorFixture(schemaCompanies[0]);
  try {
    const { source, saved } = await f.seed(); await f.saveImages([{ input: 'additionalImages', value: [saved.key, f.keys[3]].join('\n') }]);
    for (const key of [source.sourceKey, saved.key, saved.key + '.edit.json']) {
      const original = f.h.objects.get(key).slice(), changed = original.slice(); changed[changed.length - 1] ^= 1; f.h.objects.set(key, changed);
      const before = f.snapshot(); assert.equal((await f.open(saved.key, { slotIndex: 0 })).status, 409); assert.equal(f.snapshot(), before); f.h.objects.set(key, original);
    }
    const before = f.snapshot(), originalPool = JSON.parse(f.product().image_keys);
    f.h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify(originalPool.filter(key => key !== source.sourceKey)), f.id);
    const missing = f.snapshot(); assert.equal((await f.open(saved.key, { slotIndex: 0 })).status, 404); assert.equal(f.snapshot(), missing);
    f.h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify(originalPool), f.id); assert.equal(f.snapshot(), before);
  } finally { f.close(); }
});

test('current-target reanchoring never imports another company, category, profile or same-URL family product', async () => {
  const f = await freeImageReanchorFixture(schemaCompanies[0]);
  try {
    const { saved } = await f.seed(); await f.saveImages([{ input: 'additionalImages', value: [saved.key, f.keys[2]].join('\n') }]);
    const before = f.snapshot(); f.h.setCompany(schemaCompanies[1]); assert.equal((await f.open(saved.key, { slotIndex: 0 })).status, 409); f.h.setCompany(schemaCompanies[0]); assert.equal(f.snapshot(), before);
    assert.equal((await f.open(saved.key, { slotIndex: 0, profileId: 'unknown-profile' })).status, 404);
    const sideKey = saved.key + '.edit.json', bytes = f.h.objects.get(sideKey).slice(), record = JSON.parse(new TextDecoder().decode(bytes)), object = await f.h.bindings.FILES.head(saved.key), resultBytes = f.h.objects.get(saved.key).slice();
    for (const value of [{ ...record.context, categoryId: '991235' }, { ...record.context, profileId: 'different-profile' }]) {
      const changed = new TextEncoder().encode(JSON.stringify({ ...record, context: value })); f.h.objects.set(sideKey, changed);
      await f.h.bindings.FILES.put(saved.key, resultBytes, { httpMetadata: object.httpMetadata, customMetadata: { ...object.customMetadata, freeImageEditRecordSha256: sha(changed) } });
      assert.equal((await f.open(saved.key, { slotIndex: 0 })).status, 409); assert.equal(f.snapshot(), before);
    }
    f.h.objects.set(sideKey, bytes); await f.h.bindings.FILES.put(saved.key, resultBytes, { httpMetadata: object.httpMetadata, customMetadata: object.customMetadata });
    const child = 'same-url-family-child', product = { ...f.product(), id: child }, columns = Object.keys(product);
    f.h.sqlite.prepare(`INSERT INTO products(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...Object.values(product));
    for (const table of ['product_content', 'product_options', 'product_quotation_fields']) {
      const row = { ...f.h.sqlite.prepare(`SELECT * FROM ${table} WHERE product_id=?`).get(f.id), product_id: child }, payload = JSON.parse(row.payload); payload.productId = child; row.payload = JSON.stringify(payload);
      const fields = Object.keys(row); f.h.sqlite.prepare(`INSERT INTO ${table}(${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')})`).run(...Object.values(row));
    }
    const now = new Date().toISOString();
    f.h.sqlite.prepare('INSERT INTO product_option_split_operations(owner_id,request_id,source_product_id,family_id,root_product_id,profile_id,attempt_id,request_payload,before_payload,after_payload,receipt_payload,committed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('owner', 'reanchor-family', f.id, 'family', f.id, f.profile.id, 'attempt', '{}', '{}', '{}', '{}', now);
    for (const id of [f.id, child]) f.h.sqlite.prepare('INSERT INTO product_option_split_members VALUES(?,?,?,?,?,?,?)').run('owner', id, 'family', f.id, id === child ? f.id : null, 'reanchor-family', now);
    const afterChild = f.snapshot(); assert.equal((await f.open(saved.key, { productId: child, slotIndex: 0 })).status, 409); assert.equal(f.snapshot(), afterChild);
  } finally { f.close(); }
});
