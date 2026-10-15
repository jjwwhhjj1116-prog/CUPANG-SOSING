import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { detailFamilyFixture } from './helpers/detail-family-apply-api.mjs';
import { companies, json } from './helpers/image-download-ui.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const state = (f, table, id) => JSON.parse(f.api.sqlite.prepare(`SELECT payload FROM ${table} WHERE product_id=?`).get(id).payload);
const patch = (f, table, id, amend) => { const value = state(f, table, id); amend(value); f.api.sqlite.prepare(`UPDATE ${table} SET payload=? WHERE product_id=?`).run(JSON.stringify(value), id); };
const product = (f, id) => ({ ...f.api.sqlite.prepare('SELECT * FROM products WHERE id=?').get(id) });
const qurl = (f, id) => '/api/products/' + id + '/quotation-fields?profileId=' + f.view.categoryContext.profileId;
const snapshot = (f, id) => f.api.load('db/product-option-splits.ts').readOwnedSplitSnapshot('owner', id, f.view.categoryContext.profileId);
const inputs = async (f, ids = f.targetIds) => ({ ...f.makeFamilyInput(ids), expectedInputFingerprint: (await json(await f.api.route(f.qurl))).inputFingerprint, editorPolicy: 'saved-inputs-v1' });

for (const company of companies) test(`scoped saved inputs retain sealed sequence after global content diverges, without overwriting any other stage (${company.companyCode})`, async () => {
  const f = await detailFamilyFixture(company, { groups: 4 });
  try {
    const sealed = plain(f.view.detailEditorInputs); assert.ok(sealed); assert.deepEqual(sealed.images, plain(f.prepared.sources));
    const current = (await json(await f.api.route(f.base + '/content'))).content;
    await json(await f.api.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: current.revision,
      patch: { assets: { detail: [] }, detail: { description: '통합 저장 뒤 바뀐 전역 편집 설명' } } } }));
    const selected = [f.targetIds[1], f.targetIds[0]], missingKey = sealed.images[1].key;
    const p = product(f, selected[0]); f.api.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify(JSON.parse(p.image_keys).filter(key => key !== missingKey)), selected[0]);
    for (const id of selected) patch(f, 'product_quotation_fields', id, value => { value.detailEditorInputs = { 'category:991234': { ...sealed, categoryId: '991234' } }; });
    const beforeSource = (await snapshot(f, f.sourceId)).payload, untouched = (await snapshot(f, f.targetIds[2])).payload;
    const originals = new Map(selected.map(id => [id, { product: product(f, id), content: state(f, 'product_content', id), options: state(f, 'product_options', id),
      labels: state(f, 'product_labels', id), quotation: state(f, 'product_quotation_fields', id) }]));
    const beforeCatalog = f.all(), network = f.api.network.length, providers = f.api.aiSources.length;
    const catalog = await json(await f.catalog()); assert.equal(f.all(), beforeCatalog);
    assert.deepEqual(catalog.editor, { policy: 'saved-inputs-v1', categoryId: '80719', images: sealed.images.length });
    const input = await inputs(f, selected), preview = await f.previewFamily(input); assert.equal(f.all(), beforeCatalog);
    assert.deepEqual(preview.editor, { policy: 'saved-inputs-v1', inputs: sealed }); assert.deepEqual(preview.targets.map(row => row.productId), selected);
    const saved = await json(await f.commitFamily(input, preview)); assert.equal(saved.current, true); assert.deepEqual(saved.receipt.editor, preview.editor);
    assert.equal((await snapshot(f, f.sourceId)).payload, beforeSource); assert.equal((await snapshot(f, f.targetIds[2])).payload, untouched);
    for (const id of selected) {
      const before = originals.get(id), after = state(f, 'product_quotation_fields', id), view = await json(await f.api.route(qurl(f, id)));
      const pool = [...new Set([...JSON.parse(before.product.image_keys), sealed.output.key, ...sealed.images.map(image => image.key)])];
      assert.deepEqual(product(f, id), { ...before.product, image_keys: JSON.stringify(pool), quote_status: '대기', updated_at: saved.receipt.committedAt });
      for (const [table, name] of [['product_content', 'content'], ['product_options', 'options'], ['product_labels', 'labels']]) assert.deepEqual(state(f, table, id), before[name]);
      assert.deepEqual(after.detailEditorInputs, { ...before.quotation.detailEditorInputs, 'category:80719': sealed });
      assert.deepEqual(view.detailEditorInputs, sealed); assert.equal(view.detailEditorInputs.origin.productId, f.sourceId);
      assert.deepEqual(after.categoryOverrides['category:991234'], before.quotation.categoryOverrides['category:991234']);
      assert.deepEqual(after.detailSaveBackups, before.quotation.detailSaveBackups);
      const targets = f.api.load('app/quotation-image-targets.ts').optionImageTargets(view.resolved.schema.fields);
      for (const row of view.resolved.rows) {
        for (const key of targets.detailImages.linked) assert.equal(row.fields[key].value, sealed.output.key);
        for (const key of targets.detailHtml.linked) assert.equal(row.fields[key].value, '');
      }
      assert.deepEqual(view.automatic.detailEditorInputs, undefined);
    }
    const beforeReads = f.all(); assert.deepEqual(await json(await f.recoverFamily(input.requestId)), saved); assert.equal(f.all(), beforeReads);
    assert.equal(f.api.network.length, network); assert.equal(f.api.aiSources.length, providers);
  } finally { f.api.close(); }
});

test('new editor policy is an exact reviewed side effect; old reviews and immutable old receipts never acquire it', async () => {
  const f = await detailFamilyFixture();
  try {
    const legacy = f.makeFamilyInput(), modern = { ...legacy, editorPolicy: 'saved-inputs-v1' };
    const oldPreview = await f.previewFamily(legacy), newPreview = await f.previewFamily(modern), before = f.all();
    assert.notEqual(oldPreview.fingerprint, newPreview.fingerprint); assert.equal(oldPreview.editor, undefined); assert.ok(newPreview.editor);
    assert.equal((await f.commitFamily(modern, oldPreview)).status, 409); assert.equal((await f.commitFamily(legacy, newPreview)).status, 409); assert.equal(f.all(), before);
    for (const editorPolicy of [null, false, 'unknown', {}]) assert.equal((await f.postFamily({ action: 'preview', ...legacy, editorPolicy })).status, 400);
    const saved = await json(await f.commitFamily(legacy, oldPreview)); assert.equal(saved.receipt.editor, undefined);
    for (const id of f.targetIds) assert.equal(state(f, 'product_quotation_fields', id).detailEditorInputs, undefined);
    const after = f.all(); assert.deepEqual(await json(await f.commitFamily(legacy, oldPreview)), saved); assert.equal(f.all(), after);
    assert.equal((await f.commitFamily(modern, oldPreview)).status, 409); assert.equal(f.all(), after);
  } finally { f.api.close(); }
});

test('missing or changed sealed input bytes block new preview and commit while final PNG and legacy mode remain valid', async () => {
  const f = await detailFamilyFixture();
  try {
    const input = await inputs(f), preview = await f.previewFamily(input), key = preview.editor.inputs.images[0].key, bytes = f.api.objects.get(key).slice(), before = f.all();
    f.api.objects.delete(key); assert.ok((await json(await f.catalog())).editor);
    assert.equal((await f.postFamily({ action: 'preview', ...input })).status, 409); assert.equal((await f.commitFamily(input, preview)).status, 409); assert.equal(f.all(), before);
    const changed = bytes.slice(); changed[changed.length - 1] ^= 1; f.api.objects.set(key, changed);
    assert.equal((await f.commitFamily(input, preview)).status, 409); assert.equal(f.all(), before);
    const legacy = { ...input }; delete legacy.editorPolicy;
    const saved = await json(await f.commitFamily(legacy, await f.previewFamily(legacy))); assert.equal(saved.current, true); assert.equal(saved.receipt.editor, undefined);
    f.api.objects.set(key, bytes);
  } finally { f.api.close(); }
});

test('new scoped inputs capacity accounts for missing originals without replacing full target pools', async () => {
  const f = await detailFamilyFixture();
  try {
    const target = f.targetIds[0], doc = f.view.detailEditorInputs, missing = doc.images[0].key;
    const pool = [...JSON.parse(product(f, target).image_keys).filter(key => key !== missing), doc.output.key];
    for (let index = 0; pool.length < 150; index++) pool.push('owner/family-capacity-' + index + '.png');
    f.api.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify(pool), target);
    const input = await inputs(f, [target]), before = f.all();
    const response = await f.postFamily({ action: 'preview', ...input }); assert.equal(response.status, 409); assert.match((await response.json()).error, /공간/u); assert.equal(f.all(), before);
    const legacy = { ...input }; delete legacy.editorPolicy;
    assert.equal((await f.postFamily({ action: 'preview', ...legacy })).status, 200); assert.equal(f.all(), before);
  } finally { f.api.close(); }
});

test('scoped source and target metadata CAS races and ignored companions retain original pools and all metadata', async () => {
  for (const mutation of ['source-backup', 'target-metadata', 'ignore-product']) {
    const f = await detailFamilyFixture();
    try {
      const input = await inputs(f), preview = await f.previewFamily(input), batch = f.api.db.batch; let competing, injected = false;
      if (mutation === 'ignore-product') f.api.sqlite.exec('CREATE TRIGGER ignore_editor_family BEFORE UPDATE ON products BEGIN SELECT RAISE(IGNORE); END');
      f.api.db.batch = async statements => {
        if (!injected && f.isFamilyBatch(statements)) {
          injected = true;
          if (mutation === 'source-backup') patch(f, 'product_quotation_fields', f.sourceId, value => value.detailSaveBackups['category:80719'][0].sources.reverse());
          if (mutation === 'target-metadata') patch(f, 'product_quotation_fields', f.targetIds[1], value => { value.detailEditorInputs = { 'category:80719': preview.editor.inputs }; });
          competing = f.all();
        }
        return batch(statements);
      };
      const response = await f.commitFamily(input, preview); assert.equal(response.status, 409, mutation + ': ' + await response.clone().text()); assert.ok(injected); assert.equal(f.all(), competing);
      assert.equal(f.api.sqlite.prepare('SELECT COUNT(*) AS n FROM detail_family_apply_operations').get().n, 0);
    } finally { f.api.close(); }
  }
});

test('new editor lost ACK recovers sealed metadata by reads and changed input bytes make the receipt historical', async () => {
  const f = await detailFamilyFixture();
  try {
    const input = await inputs(f), preview = await f.previewFamily(input), batch = f.api.db.batch; let lost = false, mutations = 0;
    f.api.db.batch = async statements => { const result = await batch(statements); if (f.isFamilyBatch(statements)) { mutations++; if (!lost) { lost = true; throw Error('lost ACK after exact metadata commit'); } } return result; };
    const response = await f.commitFamily(input, preview); assert.equal(response.status, 503); assert.equal((await response.json()).code, 'DETAIL_FAMILY_UNCERTAIN');
    const before = f.all(), saved = await json(await f.recoverFamily(input.requestId)); assert.equal(saved.current, true); assert.deepEqual(saved.receipt.editor, preview.editor); assert.equal(mutations, 1);
    const key = preview.editor.inputs.images[1].key, bytes = f.api.objects.get(key).slice(); f.api.objects.delete(key);
    const historical = await json(await f.recoverFamily(input.requestId)); assert.equal(historical.current, false); assert.deepEqual(historical.receipt, saved.receipt);
    assert.deepEqual(await json(await f.commitFamily(input, preview)), historical); assert.equal(f.all(), before); assert.equal(mutations, 1);
    f.api.objects.set(key, bytes); assert.deepEqual(await json(await f.recoverFamily(input.requestId)), saved); assert.equal(f.all(), before);
  } finally { f.api.close(); }
});

test('sealed bytes are read again immediately before commit, so a later file change cannot create metadata or a receipt', async () => {
  const f = await detailFamilyFixture();
  try {
    const input = await inputs(f), preview = await f.previewFamily(input), key = preview.editor.inputs.images[0].key;
    const original = f.api.objects.get(key).slice(), get = f.api.bindings.FILES.get, before = f.all(); let reads = 0;
    f.api.bindings.FILES.get = async (requested, ...args) => {
      if (requested === key && ++reads === 2) { const changed = original.slice(); changed[changed.length - 1] ^= 1; f.api.objects.set(key, changed); }
      return get(requested, ...args);
    };
    const response = await f.commitFamily(input, preview); assert.equal(response.status, 409); assert.equal(reads, 2); assert.equal(f.all(), before);
    assert.equal(f.api.sqlite.prepare('SELECT COUNT(*) AS n FROM detail_family_apply_operations').get().n, 0);
    f.api.objects.set(key, original);
  } finally { f.api.close(); }
});

test('an ordinary target save retires only its copied category metadata and exposes its own new sealed receipt', async () => {
  const f = await detailFamilyFixture();
  try {
    const target = f.targetIds[0], input = await inputs(f, [target]), saved = await json(await f.commitFamily(input, await f.previewFamily(input)));
    patch(f, 'product_quotation_fields', target, value => { value.detailEditorInputs['category:991234'] = { ...saved.receipt.editor.inputs, categoryId: '991234' }; });
    const before = state(f, 'product_quotation_fields', target), view = await json(await f.api.route(qurl(f, target))), optionId = view.resolved.rows.find(row => row.optionId).optionId;
    const prepared = await f.runtime.helper.prepareDetailComposite({ productId: target, optionId, profileId: view.categoryContext.profileId, view }, new AbortController().signal, f.request);
    const body = await f.upload(prepared), response = await json(await f.api.route('/api/products/' + target + '/detail-save?profileId=' + view.categoryContext.profileId, { method: 'POST', body }));
    const after = state(f, 'product_quotation_fields', target);
    assert.deepEqual(after.detailEditorInputs, { 'category:991234': before.detailEditorInputs['category:991234'] });
    assert.equal(response.quotation.detailEditorInputs.origin.productId, target); assert.equal(response.quotation.detailEditorInputs.origin.uploadId, response.receipt.uploadId);
    assert.deepEqual(response.quotation.detailEditorInputs.images, plain(prepared.sources)); assert.notEqual(response.receipt.key, saved.receipt.key);
  } finally { f.api.close(); }
});

test('a fresh nineteen-target scoped copy still fits the exact atomic D1 batch and bounded archive', async () => {
  const f = await detailFamilyFixture(companies[0], { groups: 20, leanCapture: true });
  try {
    const input = await inputs(f), preview = await f.previewFamily(input), batch = f.api.db.batch; let metrics;
    f.api.db.batch = statements => { if (f.isFamilyBatch(statements)) metrics = { statements: statements.length, maxBindings: Math.max(...f.statementMetrics(statements).map(row => row.bindings)), maxSqlBytes: Math.max(...f.statementMetrics(statements).map(row => row.sqlBytes)) }; return batch(statements); };
    const saved = await json(await f.commitFamily(input, preview)); assert.equal(saved.current, true); assert.equal(saved.receipt.targets.length, 19);
    assert.equal(metrics.statements, 97); assert.ok(metrics.maxBindings <= 100); assert.ok(metrics.maxSqlBytes < 100000);
    const archive = f.api.sqlite.prepare('SELECT before_payload,after_payload,request_payload,receipt_payload FROM detail_family_apply_operations').get();
    assert.ok(Object.values(archive).reduce((sum, value) => sum + Buffer.byteLength(value), 0) <= 2 * 1024 * 1024);
    for (const id of f.targetIds) assert.deepEqual(state(f, 'product_quotation_fields', id).detailEditorInputs['category:80719'], preview.editor.inputs);
    assert.equal(createHash('sha256').update(f.api.objects.get(preview.key)).digest('hex'), preview.sha256);
    console.log('D1 saved-inputs maximum metrics', JSON.stringify(metrics));
  } finally { f.api.close(); }
});
