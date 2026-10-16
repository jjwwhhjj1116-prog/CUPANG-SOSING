import test from 'node:test';
import assert from 'node:assert/strict';
import { companies } from './helpers/image-download-ui.mjs';
import { workspaceDetailSaveFixture, json, sha } from './helpers/workspace-detail-save-api.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const scope = f => 'category:' + f.initialView.categoryContext.categoryId;
const backup = f => f.state().detailSaveBackups[scope(f)].at(-1);
const hashes = f => [...f.api.objects].map(([key, bytes]) => [key, sha(bytes)]);

for (const company of companies) test(`direct reviewed workspace save atomically publishes current nonpool photos and preserves every source (${company.companyCode})`, async () => {
  const f = await workspaceDetailSaveFixture(company, { blankQuote: true });
  try {
    const before = await json(await f.read()), tables = f.tables(), network = [...f.api.network], objects = hashes(f), prepared = await f.prepareWorkspace(), body = await f.uploadWorkspace(prepared);
    assert.equal(before.view.imageKeys.includes(f.imageEdit.key), false); assert.equal(prepared.height, 5, '400px crop scales to two pixels at full-bleed 800px');
    const saved = await json(await f.post(body)), key = saved.receipt.key, after = f.tables();
    assert.deepEqual(saved.workspace, before.workspace); assert.deepEqual(saved.receipt.workspace, body.workspace);
    assert.deepEqual(saved.quotation.imageKeys, [...before.view.imageKeys, f.imageEdit.key, key]);
    assert.equal(saved.quotation.revision, before.view.revision + 1); assert.equal(saved.quotation.contentRevision, before.view.contentRevision); assert.equal(saved.quotation.optionRevision, before.view.optionRevision);
    assert.equal(saved.quotation.productVersion, saved.quotation.updatedAt); assert.equal(saved.quotation.resolved.rows.filter(row => row.optionId).length, 6);
    assert.ok(saved.quotation.resolved.rows.some(row => row.optionId && !row.included));
    for (const row of saved.quotation.resolved.rows) {
      for (const field of f.targets.detailImages.linked) assert.equal(row.fields[field].value, key);
      for (const field of f.targets.detailHtml.linked) assert.equal(row.fields[field].value, '');
    }
    const plan = f.api.load('app/detail-save-plan.ts'), changes = plan.detailSaveChanges(before.view, key, saved.receipt.textPolicy, saved.receipt.textCommonFilled), state = backup(f);
    assert.equal(plan.detailSaveReceiptMatches(saved.quotation, saved.receipt), true); assert.deepEqual(state.workspace, before.workspace); assert.deepEqual(state.sources, prepared.sources);
    assert.deepEqual(state.before, plain(plan.detailSaveManualBackup(before.view, changes))); assert.equal(state.editor.html.effective, '<p>옵션별 수동 HTML &amp; 백업</p>');
    for (const [table, rows] of Object.entries(tables)) if (!['products', 'product_quotation_fields'].includes(table)) assert.deepEqual(after[table], rows, table);
    const expected = plain(tables.products); expected[0].image_keys = JSON.stringify(saved.quotation.imageKeys); expected[0].updated_at = saved.quotation.productVersion; expected[0].quote_status = '대기'; assert.deepEqual(plain(after.products), expected);
    assert.deepEqual(hashes(f).slice(0, objects.length), objects); assert.equal(f.api.objects.size, objects.length + 1); assert.deepEqual(f.api.network, network);
    const retained = f.tables(), savedObjects = hashes(f), repeated = await json(await f.post(body)), recovered = await json(await f.recover(body.uploadId));
    assert.deepEqual(repeated, saved); assert.deepEqual(await json(await f.post({ ...body, workspace: { digest: body.workspace.digest, revision: body.workspace.revision } })), saved);
    assert.equal(recovered.applied, true); assert.deepEqual(recovered.workspace, before.workspace); assert.deepEqual(recovered.receipt, saved.receipt);
    assert.deepEqual(f.tables(), retained); assert.deepEqual(hashes(f), savedObjects);
    const restored = await json(await f.restore()); assert.deepEqual(restored.composition.inputs.images, prepared.sources); assert.equal(restored.composition.html.effective, state.editor.html.effective);
    const exported = await f.exportQuote(), archive = JSON.parse(new TextDecoder().decode(exported.archive.get('quotation-saved-scopes.json')));
    assert.deepEqual(archive.saved.detailSaveBackups[scope(f)].at(-1).workspace, before.workspace); assert.deepEqual(archive.saved.detailSaveBackups[scope(f)].at(-1).sources, prepared.sources);
  } finally { f.api.close(); }
});

test('workspace proof is explicit, closed, policy-bound and cannot be substituted into a legacy upload', async () => {
  const f = await workspaceDetailSaveFixture(companies[0]);
  try {
    const prepared = await f.prepareWorkspace(), body = await f.uploadWorkspace(prepared), tables = f.tables();
    const invalid = [
      { ...body, workspace: { ...body.workspace, extra: true } }, { ...body, workspace: { ...body.workspace, revision: 0 } },
      { ...body, textPolicy: undefined }, { ...body, editorPolicy: undefined }, { ...body, workspace: null }, { ...body, extra: true },
    ];
    for (const value of invalid) { assert.equal((await f.post(value)).status, 400); assert.deepEqual(f.tables(), tables); }
    for (const value of [{ ...body, workspace: { ...body.workspace, revision: body.workspace.revision + 1 } }, { ...body, workspace: { ...body.workspace, digest: '0'.repeat(64) } },
      { ...body, sourceOptionId: 'not-an-option' }]) { assert.equal((await f.post(value)).status, 409); assert.deepEqual(f.tables(), tables); }
    const { workspace, ...legacy } = body; assert.ok(workspace); assert.equal((await f.post(legacy)).status, 409); assert.deepEqual(f.tables(), tables);
    const saved = await json(await f.post(body)); assert.equal((await f.post(legacy)).status, 409); assert.equal((await json(await f.recover(body.uploadId))).receipt.uploadId, saved.receipt.uploadId);
  } finally { f.api.close(); }
});

test('changed workspace and tampered current/original/sidecar files reject without changing product or quotation', async () => {
  for (const mode of ['workspace', 'current', 'original', 'sidecar']) {
    const f = await workspaceDetailSaveFixture(companies[0]);
    try {
      const prepared = await f.prepareWorkspace(), body = await f.uploadWorkspace(prepared);
      if (mode === 'workspace') { const current = await json(await f.read()); await json(await f.put(await f.body(f.document(current.workspace.document.photos, 12), current))); }
      else { const key = mode === 'current' ? f.imageEdit.key : mode === 'original' ? f.selectedKeys[1] : f.imageEdit.key + '.edit.json', changed = f.api.objects.get(key).slice(); changed[changed.length - 1] ^= 1; f.api.objects.set(key, changed); }
      const tables = f.tables(); assert.equal((await f.post(body)).status, 409, mode); assert.deepEqual(f.tables(), tables);
    } finally { f.api.close(); }
  }
});

test('exact source/member/workspace SQL fences reject races and ignored companion writes roll back the whole transaction', async () => {
  for (const mode of ['quote', 'member', 'settings', 'workspace', 'workspace-payload', 'ignore-product', 'ignore-quote']) {
    const f = await workspaceDetailSaveFixture(companies[0]);
    try {
      const prepared = await f.prepareWorkspace(), body = await f.uploadWorkspace(prepared), prepare = f.api.db.prepare; let injected = false, competing;
      if (mode.startsWith('ignore-')) { f.api.sqlite.exec(`CREATE TRIGGER detail_ignore BEFORE ${mode === 'ignore-product' ? 'UPDATE ON products' : 'INSERT ON product_quotation_fields'} BEGIN SELECT RAISE(IGNORE); END`); competing = f.tables(); }
      else f.api.db.prepare = sql => { const statement = prepare(sql); if (sql.startsWith('INSERT INTO product_quotation_fields')) { const execute = statement.execute; statement.execute = () => {
        if (!injected) { injected = true;
          if (mode === 'quote') { const state = f.state(); state.categoryOverrides[scope(f)].common.brand = '경쟁'; f.writeState(state); }
          if (mode === 'member') f.api.sqlite.prepare("UPDATE members SET status='rejected'").run();
          if (mode === 'settings') f.api.sqlite.prepare('INSERT INTO workspace_settings(owner_id,payload,updated_at) VALUES(?,?,?)').run('owner', JSON.stringify({ ...f.api.settings, brand: '경쟁' }), new Date().toISOString());
          if (mode === 'workspace') f.api.sqlite.prepare("UPDATE product_detail_workspaces SET updated_at='2027-01-01T00:00:00.000Z'").run();
          if (mode === 'workspace-payload') { const row = f.api.sqlite.prepare('SELECT payload FROM product_detail_workspaces').get(), saved = JSON.parse(row.payload); saved.document.imageMargin = 100; f.api.sqlite.prepare('UPDATE product_detail_workspaces SET payload=?').run(JSON.stringify(saved)); }
          competing = f.tables();
        } return execute(); }; } return statement; };
      const response = await f.post(body); assert.ok([403, 409, 503].includes(response.status), mode + ': ' + await response.clone().text()); assert.ok(injected || mode.startsWith('ignore-')); assert.deepEqual(f.tables(), competing, mode);
    } finally { f.api.close(); }
  }
});

test('pool and durable archive capacity limits fail atomically without pruning sources or workspace history', async () => {
  for (const mode of ['pool', 'payload', 'history']) {
    const f = await workspaceDetailSaveFixture(companies[0]);
    try {
      if (mode === 'pool') {
        const before = await f.view(), keys = [...before.imageKeys]; while (keys.length < 149) keys.push('owner/unused-owned-' + keys.length + '.png');
        f.api.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify(keys), f.product.id);
      }
      if (mode === 'payload') { const state = f.state(); state.retainedManualArchive = 'x'.repeat(512 * 1024 - 4000); f.writeState(state); }
      if (mode === 'history') { await json((await f.saveWorkspace()).response); const state = f.state(), item = state.detailSaveBackups[scope(f)][0]; state.detailSaveBackups[scope(f)] = Array.from({ length: 5 }, () => plain(item)); f.writeState(state); }
      const prepared = await f.prepareWorkspace(), body = await f.uploadWorkspace(prepared), tables = f.tables(), response = await f.post(body);
      assert.equal(response.status, mode === 'pool' ? 409 : 413, mode + ': ' + await response.clone().text()); assert.deepEqual(f.tables(), tables);
    } finally { f.api.close(); }
  }
});

test('a real committed database ACK loss is read-only recoverable and post-commit context uncertainty stays 503', async () => {
  for (const mode of ['lost-ack', 'late-member']) {
    const f = await workspaceDetailSaveFixture(companies[0]);
    try {
      const prepared = await f.prepareWorkspace(), body = await f.uploadWorkspace(prepared), batch = f.api.db.batch; let committed = false;
      f.api.db.batch = async statements => {
        if (!f.isDetailBatch(statements)) return batch(statements);
        const result = await batch(statements); committed = true;
        if (mode === 'lost-ack') throw Error('fixture committed SQL reply lost');
        f.api.sqlite.prepare("UPDATE members SET status='pending'").run(); return result;
      };
      const response = await f.post(body); assert.equal(response.status, 503, await response.clone().text()); assert.ok(committed);
      const stored = backup(f); assert.equal(stored.receipt.uploadId, body.uploadId); assert.equal(f.api.sqlite.prepare('SELECT revision FROM product_detail_workspaces').get().revision, prepared.workspace.revision);
      f.api.db.batch = batch; if (mode === 'late-member') f.api.sqlite.prepare("UPDATE members SET status='approved'").run();
      const retained = f.tables(), files = hashes(f), recovered = await json(await f.recover(body.uploadId));
      assert.equal(recovered.applied, true); assert.deepEqual(recovered.workspace, prepared.workspace); assert.deepEqual(f.tables(), retained); assert.deepEqual(hashes(f), files);
    } finally { f.api.close(); }
  }
});

test('saved workspace backup corruption and late workspace edits cannot be adopted as a current receipt', async () => {
  const f = await workspaceDetailSaveFixture(companies[1]);
  try {
    const { body, prepared, response } = await f.saveWorkspace(), saved = await json(response), original = f.state();
    for (const mode of ['missing-workspace', 'missing-proof', 'digest', 'foreign-product', 'sources', 'policy']) {
      const state = plain(original), item = state.detailSaveBackups[scope(f)].at(-1);
      if (mode === 'missing-workspace') delete item.workspace;
      if (mode === 'missing-proof') delete item.receipt.workspace;
      if (mode === 'digest') item.workspace.digest = '0'.repeat(64);
      if (mode === 'foreign-product') item.workspace.productId = 'other-product';
      if (mode === 'sources') item.sources.reverse();
      if (mode === 'policy') { delete item.receipt.editorPolicy; delete item.receipt.editorSha256; delete item.editor; }
      f.writeState(state); const retained = f.tables();
      assert.equal((await f.recover(body.uploadId)).status, 409, mode); assert.equal((await f.restore()).status, 409, mode + ' composition'); assert.deepEqual(f.tables(), retained);
    }
    f.writeState(original); const before = await json(await f.read()), doc = f.document(before.workspace.document.photos, 15);
    const updated = await json(await f.put(await f.body(doc, before))); assert.equal(updated.workspace.revision, prepared.workspace.revision + 1);
    const retained = f.tables(); assert.equal((await f.recover(body.uploadId)).status, 409); assert.equal((await f.post(body)).status, 409); assert.deepEqual(f.tables(), retained);
    assert.deepEqual((await json(await f.restore())).composition.inputs.images, backup(f).sources, 'immutable ordinary composition can still restore its old review independently');
    assert.equal(saved.receipt.workspace.revision, prepared.workspace.revision);
  } finally { f.api.close(); }
});

test('recovery rechecks exact workspace state after awaited output object reads', async () => {
  const f = await workspaceDetailSaveFixture(companies[0]);
  try {
    const result = await f.saveWorkspace(), saved = await json(result.response), get = f.api.bindings.FILES.get; let changed = false, competing;
    f.api.bindings.FILES.get = async (...args) => {
      const object = await get(...args);
      if (args[0] === saved.receipt.key && !changed) { changed = true; f.api.sqlite.prepare("UPDATE product_detail_workspaces SET updated_at='2027-01-01T00:00:00.000Z'").run(); competing = f.tables(); }
      return object;
    };
    assert.equal((await f.recover(result.body.uploadId)).status, 409); assert.ok(changed); assert.deepEqual(f.tables(), competing);
  } finally { f.api.close(); }
});
