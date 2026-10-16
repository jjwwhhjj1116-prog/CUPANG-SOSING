import test from 'node:test';
import assert from 'node:assert/strict';
import { companies } from './helpers/image-download-ui.mjs';
import { detailEditorCompositionFixture, compositionRouteWithIdentity, json } from './helpers/detail-editor-composition-api.mjs';
import { createHash } from 'node:crypto';

const plain = value => JSON.parse(JSON.stringify(value));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const scope = f => 'category:' + f.initialView.categoryContext.categoryId;
const backup = f => f.state().detailSaveBackups[scope(f)].at(-1);
const all = f => JSON.stringify(f.api.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, f.api.sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
const files = f => [...f.api.objects].map(([key, bytes]) => [key, sha(bytes)]);

for (const company of companies) test(`ordered photos and literal effective/raw HTML survive atomic flatten, reload and read-only restore (${company.companyCode})`, async () => {
  const f = await detailEditorCompositionFixture(company, { wire: true, excluded: true });
  try {
    const replacement = 'owner/composition-replacement.png';
    await f.api.bindings.FILES.put(replacement, f.api.objects.get(f.selectedKeys[1]).slice(), { httpMetadata: { contentType: 'image/png' } });
    const product = f.api.sqlite.prepare('SELECT image_keys FROM products WHERE id=?').get(f.product.id);
    f.api.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([...JSON.parse(product.image_keys), replacement]), f.product.id);
    const html = '<section data-manual="&quot;">직접 HTML &amp; 공백\n<img src="https://external.invalid/image.png"></section>', keys = [f.selectedKeys[2], replacement, f.selectedKeys[0]];
    await f.set([...f.targets.detailImages.linked.map(fieldKey => ({ optionId: f.optionId, fieldKey, value: keys.join('\n') })),
      ...f.targets.detailHtml.linked.map(fieldKey => ({ optionId: f.optionId, fieldKey, value: html }))]);
    const before = await f.view(), sourceTables = f.sourceRows(), result = await f.save(), saved = await json(result.response), model = f.api.load('app/detail-editor-composition.ts');
    assert.equal(saved.receipt.editorPolicy, 'ordered-inputs-html-v1'); assert.equal(saved.receipt.editorSha256, await model.detailSaveEditorSha256(saved.editor));
    assert.equal(saved.editor.html.fieldKey, f.targets.detailHtml.primary); assert.equal(saved.editor.html.effective, html);
    assert.deepEqual(saved.editor.company, { code: company.companyCode, name: company.companyName }); assert.deepEqual(saved.editor.context, before.categoryContext);
    assert.equal(f.sourceRows(), sourceTables);
    const stored = backup(f); assert.deepEqual(stored.editor, saved.editor); assert.deepEqual(stored.sources.map(image => image.key), keys);
    for (const row of saved.quotation.resolved.rows) {
      for (const field of f.targets.detailImages.linked) assert.equal(row.fields[field].value, saved.receipt.key);
      for (const field of f.targets.detailHtml.linked) assert.equal(row.fields[field].value, '');
    }
    const retained = all(f), retainedFiles = files(f), restored = await json(await f.restore());
    assert.equal(all(f), retained); assert.deepEqual(files(f), retainedFiles);
    assert.deepEqual(restored.composition.inputs.images, stored.sources); assert.deepEqual(restored.composition.inputs.images.map(image => image.key), keys);
    assert.equal(restored.composition.inputs.origin.productId, f.product.id); assert.equal(restored.composition.inputs.origin.sourceOptionId, f.optionId);
    assert.equal(restored.composition.html.effective, html); assert.equal(restored.composition.html.fieldKey, f.targets.detailHtml.primary);
    for (const field of f.targets.detailHtml.linked) {
      assert.equal(restored.composition.html.rawOption[field], html); assert.equal(restored.composition.html.rawCommon[field], '<article>공통 수동 HTML</article>');
    }
    assert.equal(restored.source.productId, f.product.id); assert.equal(restored.source.optionId, f.optionId); assert.equal(restored.source.profileId, before.categoryContext.profileId);
    assert.equal(restored.source.revision, saved.quotation.revision); assert.equal(restored.source.inputFingerprint, saved.quotation.inputFingerprint);
    assert.equal(Object.hasOwn(restored.source, 'quotationTarget'), false);
    const unchanged = plain(restored.composition); const validated = model.validateDetailEditorComposition(restored.composition, 'owner', before.categoryContext.categoryId);
    validated.inputs.images.reverse(); validated.html.rawCommon[f.targets.detailHtml.primary] = 'local'; assert.deepEqual(restored.composition, unchanged);
    const other = saved.quotation.resolved.rows.find(row => row.optionId && row.optionId !== f.optionId).optionId;
    await f.set([{ optionId: other, fieldKey: 'brand', value: '상세 저장 후 별도 수정' }]);
    const late = await json(await f.restore(other)); assert.deepEqual(late.composition, restored.composition); assert.ok(late.source.revision > restored.source.revision);
    const exported = await f.exportQuote(), archive = JSON.parse(new TextDecoder().decode(exported.archive.get('quotation-saved-scopes.json')));
    assert.deepEqual(archive.saved.detailSaveBackups[scope(f)].at(-1).editor, saved.editor);
  } finally { f.api.close(); }
});

test('absent own HTML, inherited common, intentional blank, whitespace and generated HTML remain distinct', async () => {
  for (const mode of ['inherited', 'blank', 'whitespace', 'generated']) {
    const f = await detailEditorCompositionFixture(companies[0], { wire: true });
    try {
      const common = mode === 'generated' ? null : '<p>상속한 공통 HTML</p>', own = mode === 'blank' ? '' : mode === 'whitespace' ? ' \n ' : null;
      await f.set(f.targets.detailHtml.linked.flatMap(fieldKey => [{ optionId: null, fieldKey, value: common }, { optionId: f.optionId, fieldKey, value: own }]));
      const before = await f.view(), effective = before.resolved.rows.find(row => row.optionId === f.optionId).fields[f.targets.detailHtml.primary].value;
      const saved = await json((await f.save()).response), restored = await json(await f.restore());
      assert.equal(saved.editor.html.effective, effective, mode); assert.equal(restored.composition.html.effective, effective, mode);
      for (const key of f.targets.detailHtml.linked) { assert.equal(restored.composition.html.rawCommon[key], common, mode); assert.equal(restored.composition.html.rawOption[key], own, mode); }
      if (mode === 'blank') assert.equal(effective, '');
      if (mode === 'whitespace') assert.equal(effective, own);
      if (mode === 'generated') assert.notEqual(effective, '');
    } finally { f.api.close(); }
  }
});

for (const company of companies) test(`new snapshot receipts are idempotent and recover a lost ACK without extra writes (${company.companyCode})`, async () => {
  const f = await detailEditorCompositionFixture(company);
  try {
    const result = await f.save(), saved = await json(result.response), retained = all(f), savedFiles = files(f);
    assert.deepEqual(await json(await f.post(result.body)), saved);
    const recovered = await json(await f.recover(result.body.uploadId)); assert.equal(recovered.applied, true); assert.deepEqual(recovered.editor, saved.editor); assert.deepEqual(recovered.receipt, saved.receipt);
    assert.equal(all(f), retained); assert.deepEqual(files(f), savedFiles);
    const { editorPolicy: ignored, ...legacy } = result.body; assert.ok(ignored);
    assert.equal((await f.post(legacy)).status, 409); assert.equal((await f.post({ ...result.body, editorPolicy: 'forged' })).status, 400);
    assert.equal(all(f), retained);
  } finally { f.api.close(); }
});

test('old six/seven-field saves remain unchanged and cannot fabricate missing or copied family HTML snapshots', async () => {
  for (const textPolicy of [undefined, 'couplus-detail-alt-v1']) {
    const f = await detailEditorCompositionFixture(companies[0]);
    try {
      const prepared = await f.prepare(), body = { ...await f.upload(prepared), ...(textPolicy ? { textPolicy } : {}) }, saved = await json(await f.post(body)), retained = all(f);
      assert.equal(saved.editor, undefined); assert.equal(saved.receipt.editorPolicy, undefined); assert.equal(backup(f).editor, undefined);
      const response = await f.restore(); assert.equal(response.status, 404); assert.equal((await response.json()).code, 'DETAIL_COMPOSITION_MISSING'); assert.equal(all(f), retained);
      const own = f.state(), inputs = saved.quotation.detailEditorInputs, foreign = plain(inputs); foreign.origin.productId = 'family-source-product';
      own.detailEditorInputs = { [scope(f)]: foreign }; delete own.detailSaveBackups;
      f.writeState(own); const family = all(f), missing = await f.restore(); assert.equal(missing.status, 404); assert.equal((await missing.json()).code, 'DETAIL_COMPOSITION_MISSING'); assert.equal(all(f), family);
    } finally { f.api.close(); }
  }
});

test('present snapshot, digest, raw alias set and current context corruption fail closed on restore and recovery', async () => {
  const f = await detailEditorCompositionFixture(companies[0], { wire: true });
  try {
    const result = await f.save(), saved = await json(result.response), original = f.state();
    for (const change of ['snapshot', 'sha', 'snapshot-missing', 'policy-missing', 'receipt-key', 'raw-missing', 'raw-duplicate', 'company', 'context']) {
      const value = plain(original), item = value.detailSaveBackups[scope(f)].at(-1);
      if (change === 'snapshot') item.editor.html.effective += '변조';
      if (change === 'sha') item.receipt.editorSha256 = '0'.repeat(64);
      if (change === 'snapshot-missing') delete item.editor;
      if (change === 'policy-missing') delete item.receipt.editorPolicy;
      if (change === 'receipt-key') item.receipt.key = f.selectedKeys[0];
      if (change === 'raw-missing') item.before = item.before.filter(cell => cell.optionId !== f.optionId || cell.fieldKey !== f.targets.detailHtml.primary);
      if (change === 'raw-duplicate') item.before.push(item.before.find(cell => cell.optionId === f.optionId && cell.fieldKey === f.targets.detailHtml.primary));
      if (change === 'company') item.editor.company = { code: companies[1].companyCode, name: companies[1].companyName };
      if (change === 'context') item.editor.context.profileId = 'another-profile';
      f.writeState(value); const retained = all(f);
      for (const response of [await f.restore(), await f.recover(saved.receipt.uploadId), await f.post(result.body)]) assert.equal(response.status, 409, change + ': ' + await response.clone().text());
      assert.equal(all(f), retained, change);
    }
  } finally { f.api.close(); }
});

test('readonly restore verifies actual PNG and ordered source bytes and rejects a mid-read state change', async () => {
  const f = await detailEditorCompositionFixture(companies[0]);
  try {
    const saved = await json((await f.save()).response), original = f.state();
    for (const key of [saved.receipt.key, backup(f).sources[0].key]) {
      const bytes = f.api.objects.get(key).slice(), changed = bytes.slice(); changed[changed.length - 1] ^= 1; f.api.objects.set(key, changed);
      const retained = all(f); assert.equal((await f.restore()).status, 409); assert.equal(all(f), retained); f.api.objects.set(key, bytes);
      f.api.objects.delete(key); assert.equal((await f.restore()).status, 409); f.api.objects.set(key, bytes);
    }
    const get = f.api.bindings.FILES.get; let changed = false, retained;
    f.api.bindings.FILES.get = async (...args) => {
      const result = await get(...args);
      if (!changed && args[0] === backup(f).sources[0].key) { changed = true; const value = plain(original); value.categoryOverrides[scope(f)].common.brand = '동일 revision 경쟁 변경'; f.writeState(value); retained = all(f); }
      return result;
    };
    assert.equal((await f.restore()).status, 409); assert.ok(changed); assert.equal(all(f), retained);
  } finally { f.api.close(); }
});

test('new-policy recovery and repeated POST pin raw snapshot and approved identity across awaited PNG reads', async () => {
  for (const action of ['recovery', 'replay']) for (const mode of ['snapshot', 'member']) {
    const company = companies[0], f = await detailEditorCompositionFixture(company);
    try {
      const result = await f.save(), saved = await json(result.response), user = { current: { verifiedAccess: true, userId: 'owner', membership: {
        id: 'owner', email: 'unari8484@gmail.com', role: 'member', status: 'approved', companyCode: company.companyCode, companyName: company.companyName } } },
        route = compositionRouteWithIdentity(f, user), context = { params: Promise.resolve({ id: f.product.id }) }, get = f.api.bindings.FILES.get;
      let changed = false, retained;
      f.api.bindings.FILES.get = async (...args) => {
        const object = await get(...args);
        if (!changed && args[0] === saved.receipt.key) {
          changed = true;
          if (mode === 'snapshot') { const value = f.state(); value.detailSaveBackups[scope(f)].at(-1).editor.html.effective += '같은 리비전 변조'; f.writeState(value); }
          else user.current = { ...user.current, membership: { ...user.current.membership, role: 'admin' } };
          retained = all(f);
        }
        return object;
      };
      const response = action === 'recovery'
        ? await route.GET(new Request('https://app.test' + f.endpoint + '&uploadId=' + result.body.uploadId), context)
        : await route.POST(new Request('https://app.test' + f.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(result.body) }), context);
      assert.equal(response.status, 409, action + ':' + mode + ': ' + await response.clone().text()); assert.ok(changed); assert.equal(all(f), retained);
    } finally { f.api.close(); }
  }
});

test('new policy uses the existing atomic CAS/rollback and bounded backup transaction', async () => {
  for (const mode of ['same-revision', 'ignored-product', 'count', 'payload']) {
    const f = await detailEditorCompositionFixture(companies[0]);
    try {
      if (mode === 'count' || mode === 'payload') {
        const value = f.state(), historical = { receipt: { uploadId: 'a'.repeat(64), key: f.initialView.imageKeys[0], sha256: 'b'.repeat(64), bytes: 1, revision: 1, beforeRevision: 0, sourceOptionId: f.optionId, categoryId: f.initialView.categoryContext.categoryId, optionIds: [f.optionId] }, before: [], sources: [], beforeProductVersion: f.initialView.productVersion, beforeInputFingerprint: f.initialView.inputFingerprint, updatedAt: f.initialView.productVersion };
        value.detailSaveBackups = { [scope(f)]: mode === 'count' ? Array.from({ length: 5 }, (_, index) => ({ ...historical, receipt: { ...historical.receipt, uploadId: String(index + 1).repeat(64) } })) : [{ ...historical, padding: 'x'.repeat(512 * 1024) }] };
        f.writeState(value);
      }
      const prepared = await f.prepare(), body = { ...await f.upload(prepared), editorPolicy: 'ordered-inputs-html-v1' }, batch = f.api.db.batch; let retained = all(f), raced = false;
      if (mode === 'ignored-product') f.api.sqlite.exec('CREATE TRIGGER ignore_composition_product BEFORE UPDATE ON products BEGIN SELECT RAISE(IGNORE); END');
      f.api.db.batch = async statements => {
        if (mode === 'same-revision' && !raced && f.isDetailBatch(statements)) { raced = true; const value = f.state(); value.categoryOverrides[scope(f)].common.brand = '경쟁 저장'; f.writeState(value); retained = all(f); }
        return batch(statements);
      };
      const response = await f.post(body); assert.equal(response.status, mode === 'same-revision' ? 409 : mode === 'ignored-product' ? 503 : 413, mode + ': ' + await response.clone().text()); assert.equal(all(f), retained, mode);
      if (mode === 'same-revision') assert.ok(raced);
    } finally { f.api.close(); }
  }
});

test('closed queries, wrong company/option and edited current final fields cannot restore a historical document', async () => {
  const f = await detailEditorCompositionFixture(companies[0]);
  try {
    await json((await f.save()).response); const retained = all(f);
    for (const suffix of ['&uploadId=' + 'a'.repeat(64), '&editor=saved-composition-v1', '&optionId=duplicate', '&extra=true']) assert.equal((await f.restore(f.optionId, suffix)).status, 400);
    assert.equal((await f.restore('unknown-option')).status, 409); assert.equal(all(f), retained);
    f.api.setCompany({ code: companies[1].companyCode, name: companies[1].companyName }); assert.equal((await f.restore()).status, 409); assert.equal(all(f), retained);
    f.api.setCompany({ code: companies[0].companyCode, name: companies[0].companyName });
    await f.set([{ optionId: f.optionId, fieldKey: 'detailHtml', value: '<p>새 HTML</p>' }]); const after = all(f); assert.equal((await f.restore()).status, 409); assert.equal(all(f), after);
  } finally { f.api.close(); }
});
