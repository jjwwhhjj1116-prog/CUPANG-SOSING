import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { companies } from './helpers/image-download-ui.mjs';
import { detailWorkspaceFixture, json } from './helpers/detail-workspace-api.mjs';

const plain = value => JSON.parse(JSON.stringify(value)), sha = value => createHash('sha256').update(value).digest('hex');
const withoutWorkspace = f => { const { product_detail_workspaces: omitted, ...tables } = f.tables(); assert.ok(omitted); return tables; };
const objects = f => [...f.api.objects].map(([key, bytes]) => [key, sha(bytes)]);

for (const company of companies) test(`editor-only save/reload/replacement/reorder/deletion retains final product and quotation byte-for-byte (${company.companyCode})`, async () => {
  const f = await detailWorkspaceFixture(company, { wire: true, excluded: true });
  try {
    const before = await json(await f.read()), tables = withoutWorkspace(f), oldObjects = objects(f), requests = [...f.api.network];
    assert.equal(before.workspace, null); assert.deepEqual(before.roles, { top: [f.selectedKeys[0]], bottom: [f.selectedKeys[3]] });
    const firstBody = await f.body(), first = await json(await f.put(firstBody));
    assert.equal(first.workspace.revision, 1); assert.equal(first.workspace.requestId, firstBody.requestId); assert.deepEqual(first.view, before.view);
    assert.deepEqual(withoutWorkspace(f), tables); assert.deepEqual(objects(f), oldObjects); assert.deepEqual(f.api.network, requests);
    const { digest, ...record } = first.workspace; assert.equal(digest, await f.model.detailWorkspaceDigest(record));
    assert.deepEqual(await json(await f.read()), first);
    const doc = f.document([first.workspace.document.photos[0], { ...first.workspace.document.photos[1], key: f.selectedKeys[2] }, first.workspace.document.photos[3]], 12), secondBody = await f.body(doc, first), second = await json(await f.put(secondBody));
    assert.equal(second.workspace.revision, 2); assert.deepEqual(second.workspace.document, doc);
    assert.equal(second.workspace.document.photos[1].originKey, f.selectedKeys[1]); assert.equal(second.workspace.document.photos[1].key, f.selectedKeys[2]);
    assert.deepEqual(second.workspace.files.map(file => file.key), [f.selectedKeys[0], f.selectedKeys[1], f.selectedKeys[2], f.selectedKeys[3]]);
    assert.deepEqual(withoutWorkspace(f), tables); assert.deepEqual(objects(f), oldObjects); assert.deepEqual(second.view, before.view);
    // Adoption is a separate, explicit existing quote PUT. The workspace itself
    // remains readable after that independent final-field edit.
    await f.set(f.targets.detailImages.linked.map(fieldKey => ({ optionId: f.optionId, fieldKey, value: doc.photos.map(photo => photo.key).join('\n') })));
    const afterAdopt = await json(await f.read()); assert.deepEqual(afterAdopt.workspace, second.workspace); assert.ok(afterAdopt.view.revision > second.view.revision);
    const other = afterAdopt.view.resolved.rows.find(row => row.optionId && row.optionId !== f.optionId).optionId;
    assert.equal((await json(await f.read(other))).workspace, null);
  } finally { f.api.close(); }
});

for (const company of companies) test(`exact retry/recovery is read-only and a changed same request or stale version cannot overwrite it (${company.companyCode})`, async () => {
  const f = await detailWorkspaceFixture(company);
  try {
    const body = await f.body(), response = await f.put(body); assert.equal(response.status, 200); // successful response deliberately discarded
    const after = f.tables(), recovered = await json(await f.read()); assert.equal(recovered.workspace.requestId, body.requestId); assert.equal(recovered.workspace.revision, 1);
    assert.deepEqual(await json(await f.put(body)), recovered); assert.deepEqual(f.tables(), after);
    const changed = f.document(body.document.photos, 10); assert.equal((await f.put({ ...body, document: changed })).status, 400);
    const stale = { ...body, document: changed, requestId: await f.model.detailWorkspaceRequestId(f.product.id, f.optionId, body.expectedRevision, body.expectedView, changed) };
    assert.equal((await f.put(stale)).status, 409); assert.deepEqual(f.tables(), after);
    const current = await json(await f.read()), fresh = await f.body(changed, current); await f.set([{ optionId: f.optionId, fieldKey: 'brand', value: '동시에 저장한 견적서' }]);
    const competing = f.tables(); assert.equal((await f.put(fresh)).status, 409); assert.deepEqual(f.tables(), competing);
    const recoveredLater = await json(await f.read()); assert.deepEqual(recoveredLater.workspace, recovered.workspace);
  } finally { f.api.close(); }
});

test('new stable IDs require current own origin and roles while replacement cannot rewrite original lineage', async () => {
  const f = await detailWorkspaceFixture(companies[0]);
  try {
    const initial = await json(await f.read()), fakeOrigin = f.document([{ id: 'fake', originKey: f.selectedKeys[1], key: f.selectedKeys[2], role: 'body' }]);
    assert.equal((await f.put(await f.body(fakeOrigin, initial))).status, 409);
    const fakeRole = f.document([{ id: 'fake', originKey: f.selectedKeys[1], key: f.selectedKeys[1], role: 'top' }]); assert.equal((await f.put(await f.body(fakeRole, initial))).status, 409);
    const saved = await json(await f.put(await f.body())), bad = f.document(saved.workspace.document.photos.map((photo, index) => index === 1 ? { ...photo, originKey: f.selectedKeys[2] } : photo));
    const retained = f.tables(); assert.equal((await f.put(await f.body(bad, saved))).status, 409); assert.deepEqual(f.tables(), retained);
    const rows = saved.workspace.document.photos, reviewed = await f.body(saved.workspace.document, saved);
    for (const invalid of [rows.slice(1), [...rows.slice(0, 3)], [rows[1], rows[0], ...rows.slice(2)],
      [{ ...rows[0], key: f.selectedKeys[2] }, ...rows.slice(1)], [{ ...rows[0], id: 'different-banner-id' }, ...rows.slice(1)],
      [rows[0], { ...rows[0], id: 'duplicate-banner' }, ...rows.slice(1)]]) {
      const document = f.document(invalid), requestId = sha(JSON.stringify({ format: 'detail-workspace-save-v1', productId: f.product.id, optionId: f.optionId,
        expectedRevision: reviewed.expectedRevision, expectedView: reviewed.expectedView, document }));
      assert.equal((await f.put({ ...reviewed, document, requestId })).status, 409); assert.deepEqual(f.tables(), retained);
    }
    const oldContent = (await json(await f.api.route(f.base + '/content'))).content;
    await json(await f.api.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: oldContent.revision, patch: { assets: { detailTop: [], detailBottom: [] } } } }));
    const retainedAfterSettings = f.tables(); assert.equal((await f.read()).status, 409);
    assert.equal((await f.put(await f.body(f.document(saved.workspace.document.photos, 1), saved))).status, 409); assert.deepEqual(f.tables(), retainedAfterSettings);
  } finally { f.api.close(); }
});

test('same-revision raw quote, current membership, options/settings/profile and workspace row races make metadata INSERT/UPDATE a no-op', async () => {
  for (const mode of ['quote', 'member', 'options', 'settings', 'profile', 'workspace']) {
    const f = await detailWorkspaceFixture(companies[0]);
    try {
      if (mode === 'workspace') await json(await f.put(await f.body()));
      const current = await json(await f.read()), body = await f.body(f.document(current.workspace?.document.photos, 4), current), prepare = f.api.db.prepare; let injected = false, competing;
      f.api.db.prepare = sql => {
        const statement = prepare(sql);
        if (sql.startsWith('INSERT INTO product_detail_workspaces')) {
          const execute = statement.execute;
          statement.execute = () => {
            if (!injected) {
              injected = true;
              if (mode === 'quote') { const state = f.state(); state.categoryOverrides['category:' + current.view.categoryContext.categoryId].common.brand = '동일 revision 변경'; f.writeState(state); }
              if (mode === 'member') f.api.sqlite.prepare("UPDATE members SET role='admin'").run();
              if (mode === 'options') { const row = f.api.sqlite.prepare('SELECT payload FROM product_options').get(), value = JSON.parse(row.payload); value.rows[0].translatedName += '경쟁'; f.api.sqlite.prepare('UPDATE product_options SET payload=?').run(JSON.stringify(value)); }
              if (mode === 'settings') f.api.sqlite.prepare('INSERT INTO workspace_settings(owner_id,payload,updated_at) VALUES(?,?,?)').run('owner', JSON.stringify({ ...f.api.settings, brand: '경쟁 설정' }), new Date().toISOString());
              if (mode === 'profile') { const row = f.api.sqlite.prepare('SELECT payload FROM category_profiles').get(), value = JSON.parse(row.payload); value.name += '경쟁'; f.api.sqlite.prepare('UPDATE category_profiles SET payload=?').run(JSON.stringify(value)); }
              if (mode === 'workspace') f.api.sqlite.prepare("UPDATE product_detail_workspaces SET updated_at='2026-10-17T00:00:00.000Z'").run();
              competing = f.tables();
            }
            return execute();
          };
        }
        return statement;
      };
      const response = await f.put(body); assert.equal(response.status, 409, mode + ': ' + await response.clone().text()); assert.ok(injected); assert.deepEqual(f.tables(), competing);
    } finally { f.api.close(); }
  }
});

test('a lost metadata write ACK is recovered with GET and a suppressed INSERT leaves every table unchanged', async () => {
  for (const mode of ['lost', 'ignore']) {
    const f = await detailWorkspaceFixture(companies[0]);
    try {
      const body = await f.body(), before = f.tables(), prepare = f.api.db.prepare; let injected = false;
      if (mode === 'ignore') f.api.sqlite.exec('CREATE TRIGGER ignore_detail_workspace BEFORE INSERT ON product_detail_workspaces BEGIN SELECT RAISE(IGNORE); END');
      else f.api.db.prepare = sql => { const statement = prepare(sql); if (sql.startsWith('INSERT INTO product_detail_workspaces')) { const execute = statement.execute; statement.execute = () => { execute(); injected = true; throw Error('fixture lost database ACK'); }; } return statement; };
      const response = await f.put(body); assert.equal(response.status, mode === 'lost' ? 503 : 409);
      const recovered = await json(await f.read());
      if (mode === 'ignore') { assert.equal(recovered.workspace, null); assert.deepEqual(f.tables(), before); }
      else { assert.ok(injected); assert.equal(recovered.workspace.requestId, body.requestId); assert.equal(recovered.workspace.revision, 1); const after = f.tables(); assert.deepEqual((await json(await f.put(body))).workspace, recovered.workspace); assert.deepEqual(f.tables(), after); }
    } finally { f.api.close(); }
  }
});

test('stored document/proof/key/context corruption and changed actual original/current bytes cannot become a missing workspace', async () => {
  const f = await detailWorkspaceFixture(companies[0]);
  try {
    const first = await json(await f.put(await f.body())), doc = f.document(first.workspace.document.photos.map((photo, index) => index === 1 ? { ...photo, key: f.selectedKeys[2] } : photo)), saved = await json(await f.put(await f.body(doc, first))),
      original = f.api.sqlite.prepare('SELECT * FROM product_detail_workspaces').get();
    for (const mode of ['digest', 'context', 'key', 'html', 'column']) {
      const value = plain(saved.workspace); if (mode === 'digest') value.digest = '0'.repeat(64); if (mode === 'context') value.context.profileId = 'other';
      if (mode === 'key') value.document.photos[0].key = 'other/foreign.png'; if (mode === 'html') value.document.generatedHtml = '<script>bad</script>';
      f.api.sqlite.prepare('UPDATE product_detail_workspaces SET payload=?,revision=?').run(JSON.stringify(value), mode === 'column' ? 7 : original.revision);
      const retained = f.tables(); assert.equal((await f.read()).status, 409, mode); assert.deepEqual(f.tables(), retained);
    }
    f.api.sqlite.prepare('UPDATE product_detail_workspaces SET payload=?,revision=?').run(original.payload, original.revision);
    for (const key of [f.selectedKeys[1], f.selectedKeys[2]]) { const bytes = f.api.objects.get(key).slice(), changed = bytes.slice(); changed[changed.length - 1] ^= 1; f.api.objects.set(key, changed); const retained = f.tables(); assert.equal((await f.read()).status, 409); assert.deepEqual(f.tables(), retained); f.api.objects.set(key, bytes); }
  } finally { f.api.close(); }
});

test('source/workspace mutation during R2 reads rejects GET and current company or option never borrows another scope', async () => {
  const f = await detailWorkspaceFixture(companies[0]);
  try {
    await json(await f.put(await f.body())); const get = f.api.bindings.FILES.get; let changed = false, retained;
    f.api.bindings.FILES.get = async (...args) => { const object = await get(...args); if (!changed) { changed = true; f.api.sqlite.prepare("UPDATE product_detail_workspaces SET request_id=?").run('0'.repeat(64)); retained = f.tables(); } return object; };
    assert.equal((await f.read()).status, 409); assert.ok(changed); assert.deepEqual(f.tables(), retained); f.api.bindings.FILES.get = get;
    f.api.setCompany({ code: companies[1].companyCode, name: companies[1].companyName }); assert.ok([403, 409].includes((await f.read()).status));
    f.api.setCompany({ code: companies[0].companyCode, name: companies[0].companyName }); assert.equal((await f.read('unknown-option')).status, 409);
    for (const suffix of ['&extra=true', '&optionId=duplicate', '&profileId=duplicate', '&requestId=' + 'a'.repeat(64)]) assert.equal((await f.read(f.optionId, suffix)).status, 400);
  } finally { f.api.close(); }
});

test('closed body and origin/size guards reject without saving generated or executable input', async () => {
  const f = await detailWorkspaceFixture(companies[0]);
  try {
    const body = await f.body(), before = f.tables();
    for (const bad of [{ ...body, extra: true }, { ...body, optionId: '' }, { ...body, requestId: 'bad' }, { ...body, expectedRevision: -1 }]) assert.equal((await f.put(bad)).status, 400);
    assert.equal((await f.put({ ...body, document: { ...body.document, generatedHtml: '<iframe src="https://external.invalid"></iframe>' } })).status, 409);
    const request = (value, headers = {}) => new Request('https://app.test' + f.endpoint, { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: value });
    assert.equal((await f.route.PUT(request(JSON.stringify(body), { origin: 'https://other.test' }), f.context)).status, 400);
    assert.equal((await f.route.PUT(request(' '.repeat(512 * 1024 + 1)), f.context)).status, 413); assert.deepEqual(f.tables(), before);
  } finally { f.api.close(); }
});

test('captured collection and explicit profile contexts sharing a category keep independent workspace rows', async () => {
  const f = await detailWorkspaceFixture(companies[0]);
  try {
    const profileSaved = await json(await f.put(await f.body())), endpoint = 'https://app.test' + f.base + '/detail-workspace',
      collectionGet = () => f.route.GET(new Request(endpoint + '?optionId=' + encodeURIComponent(f.optionId)), f.context), collection = await json(await collectionGet());
    assert.equal(collection.view.categoryContext.categoryId, profileSaved.view.categoryContext.categoryId);
    assert.equal(collection.view.categoryContext.source, 'collection'); assert.equal(profileSaved.view.categoryContext.source, 'profile'); assert.equal(collection.workspace, null);
    const before = withoutWorkspace(f), document = f.document(profileSaved.workspace.document.photos, 9), body = await f.body(document, collection),
      saved = await json(await f.route.PUT(new Request(endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), f.context));
    assert.equal(saved.workspace.revision, 1); assert.equal(saved.workspace.document.imageMargin, 9); assert.deepEqual(withoutWorkspace(f), before);
    assert.deepEqual((await json(await f.read())).workspace, profileSaved.workspace); assert.deepEqual((await json(await collectionGet())).workspace, saved.workspace);
    const rows = f.api.sqlite.prepare('SELECT * FROM product_detail_workspaces').all(); assert.equal(rows.length, 2); assert.notEqual(rows[0].category_scope, rows[1].category_scope);
    for (const row of rows) assert.equal(row.category_scope, await f.model.detailWorkspaceScope(JSON.parse(row.payload).context));
  } finally { f.api.close(); }
});
