import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { detailFamilyFixture } from './helpers/detail-family-apply-api.mjs';
import { companies, json } from './helpers/image-download-ui.mjs';

const product = (f, id) => ({ ...f.api.sqlite.prepare('SELECT * FROM products WHERE id=?').get(id) });
const state = (f, table, id) => JSON.parse(f.api.sqlite.prepare(`SELECT payload FROM ${table} WHERE product_id=?`).get(id).payload);
const patchPayload = (f, table, id, mutate) => { const value = state(f, table, id); mutate(value); f.api.sqlite.prepare(`UPDATE ${table} SET payload=? WHERE product_id=?`).run(JSON.stringify(value), id); };
const snapshot = (f, id) => f.api.load('db/product-option-splits.ts').readOwnedSplitSnapshot('owner', id, f.view.categoryContext.profileId);
const qurl = (f, id) => '/api/products/' + id + '/quotation-fields?profileId=' + f.view.categoryContext.profileId;

for (const company of companies) test(`saved integrated PNG applies only selected family quotations, every real option and exact primary XLSX (${company.companyCode})`, async () => {
  const f = await detailFamilyFixture(company, { groups: 4 });
  try {
    const two = f.targetIds[1], optionBody = await json(await f.api.route('/api/products/' + two + '/options'));
    const optionRows = f.api.load('app/product-options.ts').optionInputs(optionBody.options); optionRows[1].included = false;
    await json(await f.api.route('/api/products/' + two + '/options', { method: 'PATCH', body: { expectedRevision: optionBody.options.revision,
      expectedProductVersion: optionBody.productVersion, rows: optionRows } }));
    const targetView = await json(await f.api.route(qurl(f, two)));
    await json(await f.api.route(qurl(f, two), { method: 'PUT', body: { expectedRevision: targetView.revision, expectedInputFingerprint: targetView.inputFingerprint,
      changes: [{ optionId: null, fieldKey: 'altText', value: '대상의 직접 공통 ALT' }, ...targetView.resolved.rows.filter(row => row.optionId).map((row, i) => ({ optionId: row.optionId, fieldKey: 'altText', value: '대상 옵션 ALT ' + i })),
        { optionId: null, fieldKey: 'supplyPrice', value: '12345' }, { optionId: null, fieldKey: 'salePrice', value: '23456' }, { optionId: null, fieldKey: 'msrp', value: '45678' }] } }));
    const selected = [two, f.targetIds[0]], original = new Map();
    for (const id of selected) original.set(id, { product: product(f, id), quotation: state(f, 'product_quotation_fields', id),
      content: state(f, 'product_content', id), options: state(f, 'product_options', id), labels: state(f, 'product_labels', id), view: await json(await f.api.route(qurl(f, id))) });
    const source = (await snapshot(f, f.sourceId)).payload, untouched = (await snapshot(f, f.targetIds[2])).payload, files = f.originals(), network = f.api.network.length, providers = f.api.aiSources.length;
    const beforeCatalog = f.all(), catalog = await json(await f.catalog()); assert.equal(f.all(), beforeCatalog); assert.equal(catalog.sourceReady, true);
    assert.equal(catalog.targets.find(target => target.productId === two).optionCount, 2);
    const input = f.makeFamilyInput(selected), preview = await f.previewFamily(input); assert.equal(f.all(), beforeCatalog); assert.deepEqual(preview.targets.map(target => target.productId), selected);
    const saved = await json(await f.commitFamily(input, preview)); assert.equal(saved.current, true); assert.equal(saved.receipt.key, f.sourceImage.key);
    assert.equal((await snapshot(f, f.sourceId)).payload, source); assert.equal((await snapshot(f, f.targetIds[2])).payload, untouched); assert.equal(f.originals(), files);
    for (const [index, id] of selected.entries()) {
      const before = original.get(id), after = state(f, 'product_quotation_fields', id), current = product(f, id), view = await json(await f.api.route(qurl(f, id)));
      assert.equal(after.revision, before.quotation.revision + 1); assert.equal(after.updatedAt, saved.receipt.committedAt);
      assert.deepEqual(current, { ...before.product, image_keys: JSON.stringify([...JSON.parse(before.product.image_keys), f.sourceImage.key]), quote_status: '대기', updated_at: saved.receipt.committedAt });
      for (const [table, key] of [['product_content', 'content'], ['product_options', 'options'], ['product_labels', 'labels']]) assert.deepEqual(state(f, table, id), before[key]);
      assert.deepEqual(after.categoryOverrides['category:991234'], before.quotation.categoryOverrides['category:991234']);
      assert.deepEqual(after.overrides, before.quotation.overrides); assert.deepEqual(after.detailSaveBackups, before.quotation.detailSaveBackups);
      const targets = f.api.load('app/quotation-image-targets.ts').optionImageTargets(view.resolved.schema.fields);
      assert.deepEqual(JSON.parse(JSON.stringify(targets.detailImages.primaryField.hubWire.path)), ['imagePage', 'details', 'detailedImage']);
      for (const row of view.resolved.rows) {
        for (const fieldId of targets.detailImages.linked) assert.equal(row.fields[fieldId].value, f.sourceImage.key);
        for (const fieldId of targets.detailHtml.linked) assert.equal(row.fields[fieldId].value, '');
        for (const [fieldId, cell] of Object.entries(before.view.resolved.rows.find(old => old.optionId === row.optionId).fields))
          if (![...targets.detailImages.linked, ...targets.detailHtml.linked].includes(fieldId)) assert.deepEqual(row.fields[fieldId], cell, fieldId);
      }
      assert.equal(saved.receipt.targets[index].savedRevision, before.quotation.revision + 1); assert.equal(saved.receipt.targets[index].savedVersion, saved.receipt.committedAt);
      const exportPreview = await json(await f.api.route('/api/products/' + id + '/quotation', { method: 'POST', body: { action: 'preview', profileId: f.view.categoryContext.profileId } }));
      const response = await f.api.route('/api/products/' + id + '/quotation', { method: 'POST', body: { action: 'export', profileId: f.view.categoryContext.profileId, fingerprint: exportPreview.fingerprint } });
      assert.equal(response.status, 200, await response.clone().text());
      const reader = f.api.load('app/xlsx-template.ts'), archive = await reader.readXlsxArchive(await response.arrayBuffer()), document = JSON.parse(new TextDecoder().decode(archive.get('quotation-fields.json'))), plan = JSON.parse(new TextDecoder().decode(archive.get('supplier-hub-upload-plan.json')));
      const sheet = reader.inspectXlsxArchive(await reader.readXlsxArchive(archive.get(plan.quotation.file.filename))), headers = reader.xlsxHeaders(sheet, '견적서', 1), filename = document.uploadFilenames[f.sourceImage.key];
      for (const [rowIndex] of document.rows.entries()) {
        const cells = reader.xlsxHeaders(sheet, '견적서', rowIndex + 2); assert.equal(cells[headers.indexOf(targets.detailImages.primary)], filename); assert.equal(cells[headers.indexOf(targets.detailHtml.primary)], '');
      }
      assert.deepEqual(Buffer.from(archive.get('assets/' + filename)), Buffer.from(await f.prepared.output.arrayBuffer()));
    }
    const ledger = f.api.sqlite.prepare('SELECT * FROM detail_family_apply_operations').get(); assert.ok(JSON.stringify(JSON.parse(ledger.before_payload)).includes('그룹2 다른 양식 HTML'));
    assert.equal(f.api.network.length, network); assert.equal(f.api.aiSources.length, providers);
  } finally { f.api.close(); }
});

for (const company of companies) test(`exact apply/recovery is read-only and later edits yield historical currentfalse (${company.companyCode})`, async () => {
  const f = await detailFamilyFixture(company);
  try {
    const input = f.makeFamilyInput(), preview = await f.previewFamily(input), saved = await json(await f.commitFamily(input, preview)), before = f.all(), batch = f.api.db.batch; let writes = 0;
    f.api.db.batch = statements => { if (f.isFamilyBatch(statements)) writes++; return batch(statements); };
    assert.deepEqual(await json(await f.recoverFamily(input.requestId)), saved); assert.deepEqual(await json(await f.commitFamily(input, preview)), saved); assert.equal(writes, 0); assert.equal(f.all(), before);
    patchPayload(f, 'product_quotation_fields', f.targetIds[0], value => value.categoryOverrides['category:80719'].common.altText = '그 뒤 직접 수정한 ALT');
    const changed = f.all(), history = await json(await f.recoverFamily(input.requestId)); assert.equal(history.current, false); assert.deepEqual(history.receipt, saved.receipt);
    assert.deepEqual(await json(await f.commitFamily(input, preview)), history); assert.equal(f.all(), changed); assert.equal(writes, 0);
    const reordered = { ...input, targetIds: [...input.targetIds].reverse() }; assert.equal((await f.commitFamily(reordered, preview)).status, 409); assert.equal(f.all(), changed);
  } finally { f.api.close(); }
});

for (const company of companies) test(`source and target whole-payload races abort all selected writes (${company.companyCode})`, async () => {
  const cases = company.companyCode === 'A01464742' ? ['source', 'quotation', 'content', 'options', 'labels', 'family', 'member', 'settings', 'profile', 'context', 'result', 'images', 'busy', 'hub'] : ['source', 'quotation', 'member', 'family'];
  for (const race of cases) {
    const f = await detailFamilyFixture(company);
    try {
      const input = f.makeFamilyInput(), preview = await f.previewFamily(input), batch = f.api.db.batch, target = f.targetIds[1]; let raced = false, competing;
      f.api.db.batch = async statements => {
        if (!raced && f.isFamilyBatch(statements)) {
          raced = true;
          if (race === 'source') patchPayload(f, 'product_quotation_fields', f.sourceId, value => value.categoryOverrides['category:80719'].common.brand = '원본 동일 revision 수정');
          if (race === 'quotation') patchPayload(f, 'product_quotation_fields', target, value => value.categoryOverrides['category:80719'].common.altText = '대상 동일 revision ALT');
          if (race === 'content') patchPayload(f, 'product_content', target, value => value.seo.description.value = '대상 원문 수정');
          if (race === 'options') patchPayload(f, 'product_options', target, value => value.rows[0].stock = 12345678);
          if (race === 'labels') patchPayload(f, 'product_labels', target, value => value.overrides.common.material = '대상 표시사항 수정');
          if (race === 'family') f.api.sqlite.prepare('UPDATE product_option_split_members SET parent_product_id=NULL WHERE product_id=?').run(target);
          if (race === 'member') f.api.sqlite.prepare("UPDATE members SET status='suspended'").run();
          if (race === 'settings') f.api.sqlite.prepare('INSERT INTO workspace_settings VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET payload=excluded.payload').run('owner', JSON.stringify({ ...f.api.settings, brand: '새 설정' }), new Date().toISOString());
          if (race === 'profile') { const p = JSON.parse(f.api.sqlite.prepare('SELECT payload FROM category_profiles').get().payload); p.name = '다른 프로필명'; f.api.sqlite.prepare('UPDATE category_profiles SET payload=?').run(JSON.stringify(p)); }
          const jobId = f.api.sqlite.prepare('SELECT job_id FROM collection_products WHERE product_id=?').get(target).job_id;
          if (race === 'context') { const value = JSON.parse(f.api.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get(jobId).payload); value.features = '다른 가이드'; f.api.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(value), jobId); }
          if (race === 'result') { const value = JSON.parse(f.api.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get(jobId).payload); value.description += '다른 원문'; f.api.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(JSON.stringify(value), jobId); }
          if (race === 'images') f.api.sqlite.prepare("UPDATE collection_images SET operation_id='경쟁 원본 이미지' WHERE product_id=?").run(target);
          if (race === 'busy') f.api.sqlite.prepare('INSERT INTO quotation_ai_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), 'owner', target, randomUUID(), 'a'.repeat(64), '{}', 'running', null, null, null, new Date().toISOString(), null, null);
          if (race === 'hub') f.api.sqlite.prepare('INSERT INTO supplier_hub_receipts VALUES(?,?,?,?,?,?)').run('owner', target, 'a'.repeat(64), 1, 1, '{}');
          competing = f.all();
        }
        return batch(statements);
      };
      const response = await f.commitFamily(input, preview); assert.equal(response.status, 409, race + ': ' + await response.clone().text()); assert.equal(raced, true); assert.equal(f.all(), competing, race);
      assert.equal(f.api.sqlite.prepare('SELECT COUNT(*) AS n FROM detail_family_apply_operations').get().n, 0);
    } finally { f.api.close(); }
  }
});

test('ignored target companions/post-image capture roll back every selected quote and clock; unknown committed transport recovers by reads', async () => {
  for (const [table, action] of [['products', 'UPDATE'], ['product_quotation_fields', 'INSERT'], ['detail_family_apply_operations', 'UPDATE']]) {
    const f = await detailFamilyFixture();
    try {
      const input = f.makeFamilyInput(), preview = await f.previewFamily(input); f.api.sqlite.exec(`CREATE TRIGGER ignore_family BEFORE ${action} ON ${table} BEGIN SELECT RAISE(IGNORE); END`);
      const before = f.all(), response = await f.commitFamily(input, preview); assert.equal(response.status, 409, await response.clone().text()); assert.equal(f.all(), before);
    } finally { f.api.close(); }
  }
  const f = await detailFamilyFixture();
  try {
    const input = f.makeFamilyInput(), preview = await f.previewFamily(input), batch = f.api.db.batch; let lost = false;
    f.api.db.batch = async statements => { const result = await batch(statements); if (!lost && f.isFamilyBatch(statements)) { lost = true; throw Error('transport lost after actual commit'); } return result; };
    const response = await f.commitFamily(input, preview); assert.equal(response.status, 503); assert.equal((await response.json()).code, 'DETAIL_FAMILY_UNCERTAIN');
    const before = f.all(), recovered = await json(await f.recoverFamily(input.requestId)); assert.equal(recovered.current, true); assert.equal(f.all(), before);
  } finally { f.api.close(); }
});

test('ordinary receipt remains usable after unrelated saved source edits and copied keys never duplicate target pools', async () => {
  const f = await detailFamilyFixture();
  try {
    let view = await json(await f.api.route(f.qurl));
    view = await json(await f.api.route(f.qurl, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
      changes: [{ fieldKey: 'brand', optionId: null, value: '상세 저장 후 다른 항목 수정' }] } }));
    assert.ok(view.revision > f.sourceDetailReceipt.revision);
    const input = { ...f.makeFamilyInput(), expectedInputFingerprint: view.inputFingerprint }, preview = await f.previewFamily(input);
    assert.equal((await json(await f.commitFamily(input, preview))).current, true);
    const pools = f.targetIds.map(id => product(f, id).image_keys), second = { ...input, requestId: randomUUID() };
    assert.equal((await json(await f.commitFamily(second, await f.previewFamily(second)))).current, true);
    assert.deepEqual(f.targetIds.map(id => product(f, id).image_keys), pools);
  } finally { f.api.close(); }
});

test('source receipt/image tampering, unrelated URL drafts, transmitted targets and closed invalid requests cannot apply', async () => {
  const f = await detailFamilyFixture();
  try {
    const input = f.makeFamilyInput(), before = f.all();
    for (const body of [{ action: 'preview', ...input, targetIds: [] }, { action: 'preview', ...input, targetIds: [input.targetIds[0], input.targetIds[0]] },
      { action: 'preview', ...input, targetIds: [f.sourceId] }, { action: 'preview', ...input, extra: true }, { action: 'commit', ...input }])
      assert.ok([400, 409].includes((await f.postFamily(body)).status));
    assert.equal(f.all(), before); const missing = await f.recoverFamily(randomUUID()); assert.equal(missing.status, 404); assert.equal((await missing.json()).code, 'DETAIL_FAMILY_NOT_FOUND');
    const unrelated = product(f, f.sourceId); unrelated.id = randomUUID(); const columns = Object.keys(unrelated);
    f.api.sqlite.prepare('INSERT INTO products(' + columns.join(',') + ') VALUES(' + columns.map(() => '?').join(',') + ')').run(...Object.values(unrelated));
    const afterUnrelated = f.all(); assert.notEqual((await f.postFamily({ action: 'preview', ...input, targetIds: [unrelated.id] })).status, 200); assert.equal(f.all(), afterUnrelated);
    f.api.sqlite.prepare("UPDATE products SET supplier_hub_status='전송완료' WHERE id=?").run(f.targetIds[0]);
    const catalog = await json(await f.catalog()); assert.equal(catalog.targets.find(row => row.productId === f.targetIds[0]).eligible, false);
    const modified = f.all(); assert.equal((await f.postFamily({ action: 'preview', ...input })).status, 409); assert.equal(f.all(), modified);
    f.api.objects.set(f.sourceImage.key, new Uint8Array([1, 2, 3]));
    const invalid = await json(await f.catalog()); assert.equal(invalid.sourceReady, false); assert.equal(invalid.image, null);
    assert.equal((await f.postFamily({ action: 'preview', ...input })).status, 409); assert.equal(f.all(), modified);
  } finally { f.api.close(); }
});

test('19targets commit within actual D1 statement/binding/SQL-byte caps and retain exact source proof', async () => {
  const f = await detailFamilyFixture(companies[0], { groups: 20, leanCapture: true });
  try {
    const input = f.makeFamilyInput(), preview = await f.previewFamily(input), source = (await snapshot(f, f.sourceId)).payload, batch = f.api.db.batch; let measured, databaseFailure;
    f.api.db.batch = async statements => { if (f.isFamilyBatch(statements)) measured = f.statementMetrics(statements); try { return await batch(statements); } catch (error) { databaseFailure = error.message; throw error; } };
    const response = await f.commitFamily(input, preview); assert.equal(response.status, 200, databaseFailure ?? await response.clone().text());
    const result = await response.json(); assert.equal(result.current, true); assert.equal(result.receipt.targets.length, 19);
    assert.ok(measured.length <= 100, String(measured.length)); assert.ok(Math.max(...measured.map(row => row.bindings)) <= 100);
    assert.ok(Math.max(...measured.map(row => row.sqlBytes)) < 100000); assert.equal((await snapshot(f, f.sourceId)).payload, source);
    console.log('D1 family maximum metrics', JSON.stringify({ statements: measured.length, maxBindings: Math.max(...measured.map(row => row.bindings)), maxSqlBytes: Math.max(...measured.map(row => row.sqlBytes)) }));
  } finally { f.api.close(); }
});

test('a heavy19-target archive is rejected by the2MiB preflight bound without a provisional receipt or product writes', async () => {
  const f = await detailFamilyFixture(companies[0], { groups: 20 });
  try {
    const input = f.makeFamilyInput(), before = f.all(), response = await f.postFamily({ action: 'preview', ...input });
    assert.equal(response.status, 413, await response.clone().text()); assert.equal(f.all(), before);
    assert.equal(f.api.sqlite.prepare('SELECT COUNT(*) AS n FROM detail_family_apply_operations').get().n, 0);
  } finally { f.api.close(); }
});

test('a same-revision source or target payload edit between stable view and raw snapshot cannot bind an old view to new bytes', async () => {
  for (const location of ['source', 'target']) {
    const f = await detailFamilyFixture();
    try {
      const input = f.makeFamilyInput(), targetId = location === 'source' ? f.sourceId : f.targetIds[0], prepare = f.api.db.prepare;
      let seen = 0, changed = false;
      f.api.db.prepare = sql => {
        const statement = prepare(sql), bind = statement.bind, first = statement.first; let args = [];
        statement.bind = (...values) => { args = values; return bind(...values); };
        if (sql.startsWith('WITH a(owner,id,profile)')) statement.first = async (...values) => {
          if (args[1] === targetId && ++seen === (location === 'source' ? 2 : 1)) {
            changed = true; patchPayload(f, 'product_content', targetId, content => content.seo.description.value = '뷰를 읽은 직후 동일 revision에서 변경');
          }
          return first(...values);
        };
        return statement;
      };
      const response = await f.postFamily({ action: 'preview', ...input }); assert.equal(response.status, 409, location + ': ' + await response.clone().text());
      assert.equal(changed, true); assert.equal(f.api.sqlite.prepare('SELECT COUNT(*) AS n FROM detail_family_apply_operations').get().n, 0);
    } finally { f.api.close(); }
  }
});

test('recovery and exact replay retain the historical receipt but cannot adopt a missing or changed PNG as current', async () => {
  const f = await detailFamilyFixture();
  try {
    const input = f.makeFamilyInput(), preview = await f.previewFamily(input), saved = await json(await f.commitFamily(input, preview));
    const originalBytes = f.api.objects.get(f.sourceImage.key).slice(), before = f.all(), batch = f.api.db.batch; let mutations = 0;
    f.api.db.batch = statements => { if (f.isFamilyBatch(statements)) mutations++; return batch(statements); };
    for (const missing of [true, false]) {
      if (missing) f.api.objects.delete(f.sourceImage.key);
      else { const changed = originalBytes.slice(); changed[changed.length - 1] ^= 1; f.api.objects.set(f.sourceImage.key, changed); }
      const historical = await json(await f.recoverFamily(input.requestId)); assert.equal(historical.current, false); assert.deepEqual(historical.receipt, saved.receipt);
      assert.deepEqual(await json(await f.commitFamily(input, preview)), historical); assert.equal(f.all(), before); assert.equal(mutations, 0);
    }
    f.api.objects.set(f.sourceImage.key, originalBytes);
    assert.deepEqual(await json(await f.recoverFamily(input.requestId)), saved); assert.equal(f.all(), before); assert.equal(mutations, 0);
  } finally { f.api.close(); }
});
