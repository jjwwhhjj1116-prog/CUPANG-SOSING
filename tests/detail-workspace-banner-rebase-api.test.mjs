import test from 'node:test';
import assert from 'node:assert/strict';
import { companies } from './helpers/image-download-ui.mjs';
import { detailWorkspaceBannerRebaseFixture, json } from './helpers/detail-workspace-banner-rebase-api.mjs';
import { sha } from './helpers/workspace-image-edit-api.mjs';
const otherTables = f => Object.fromEntries(Object.entries(f.tables()).filter(([table]) => table !== 'product_detail_workspaces'));
const objects = f => [...f.api.objects].map(([key, bytes]) => [key, sha(bytes)]);

for (const company of companies) test(`explicit reviewed banner rebase keeps sealed body lineage and all non-workspace state (${company.companyCode})`, async () => {
  const f = await detailWorkspaceBannerRebaseFixture(company);
  try {
    const tables = f.tables(), files = objects(f), network = [...f.api.network]; assert.equal((await f.read()).status, 409);
    const preview = await json(await f.preview()); assert.deepEqual(f.tables(), tables); assert.deepEqual(objects(f), files);
    assert.deepEqual(preview.workspace, f.oldWorkspace); assert.deepEqual(preview.roles, { top: [f.newTop], bottom: [f.newBottom] });
    assert.deepEqual(preview.document.photos.filter(photo => photo.role === 'body'), f.oldWorkspace.document.photos.filter(photo => photo.role === 'body'));
    assert.equal(preview.document.photos[1].key, f.imageEdit.key); assert.equal(preview.view.imageKeys.includes(f.imageEdit.key), false);
    const body = f.rebaseBody(preview), saved = await json(await f.rebasePut(body)); assert.equal(saved.workspace.revision, preview.workspace.revision + 1); assert.equal(saved.workspace.requestId, preview.requestId);
    assert.deepEqual(saved.workspace.document, preview.document); assert.deepEqual(saved.workspace.files, preview.files); assert.deepEqual(saved.view, preview.view);
    assert.deepEqual(otherTables(f), Object.fromEntries(Object.entries(tables).filter(([table]) => table !== 'product_detail_workspaces'))); assert.deepEqual(objects(f), files); assert.deepEqual(f.api.network, network);
    const { digest, ...record } = saved.workspace; assert.equal(digest, await f.model.detailWorkspaceDigest(record));
    assert.deepEqual(await json(await f.read()), saved); const retained = f.tables(); assert.deepEqual(await json(await f.rebasePut(body)), saved); assert.deepEqual(f.tables(), retained);
    assert.equal((await f.rebasePut({ ...body, expectedDigest: '0'.repeat(64) })).status, 409); assert.deepEqual(f.tables(), retained);
    const reopened = await json(await f.openImage()); assert.equal(reopened.source.editorSource.resultKey, f.imageEdit.key); assert.deepEqual(reopened.editDocument, f.editDocument());
  } finally { f.api.close(); }
});

test('historical banner inspection tolerates only old banner removal from current pool and still verifies its actual bytes', async () => {
  const f = await detailWorkspaceBannerRebaseFixture(companies[0]);
  try {
    const before = await f.view(), oldKeys = [f.selectedKeys[0], f.selectedKeys[3]];
    f.api.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify(before.imageKeys.filter(key => !oldKeys.includes(key))), f.product.id);
    const tables = otherTables(f), preview = await json(await f.preview()); assert.equal((await f.read()).status, 409);
    const saved = await json(await f.rebasePut(f.rebaseBody(preview))); assert.deepEqual(otherTables(f), tables); assert.deepEqual(saved.workspace.document.photos.filter(photo => photo.role === 'body'), f.oldWorkspace.document.photos.filter(photo => photo.role === 'body'));
    const retained = f.tables(); assert.deepEqual(await json(await f.read()), saved); assert.deepEqual(f.tables(), retained);
  } finally { f.api.close(); }
  const missing = await detailWorkspaceBannerRebaseFixture(companies[0]);
  try { missing.api.objects.delete(missing.selectedKeys[0]); const tables = missing.tables(); assert.equal((await missing.preview()).status, 409); assert.deepEqual(missing.tables(), tables); } finally { missing.api.close(); }
});

test('historical multiple current banners preserve same-role IDs and disabling all banners keeps every body', async () => {
  const f = await detailWorkspaceBannerRebaseFixture(companies[0]);
  try {
    // Current content PATCH intentionally permits one banner. A supported
    // historical array is seeded without weakening that public writer.
    const row = f.api.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.product.id), content = JSON.parse(row.payload);
    content.assets.detailTop.value = [f.selectedKeys[0], f.newTop]; content.assets.detailBottom.value = [f.newBottom, f.selectedKeys[3]];
    f.api.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content), f.product.id);
    const preview = await json(await f.preview()); assert.equal(preview.document.photos[0].id, f.oldWorkspace.document.photos[0].id); assert.equal(preview.document.photos.at(-1).id, f.oldWorkspace.document.photos.at(-1).id);
    assert.deepEqual(preview.document.photos.filter(photo => photo.role === 'top').map(photo => photo.key), [f.selectedKeys[0], f.newTop]); await json(await f.rebasePut(f.rebaseBody(preview)));
    await f.setRoles([], []); const empty = await json(await f.preview()), before = otherTables(f), saved = await json(await f.rebasePut(f.rebaseBody(empty)));
    assert.deepEqual(saved.workspace.document.photos, f.oldWorkspace.document.photos.filter(photo => photo.role === 'body')); assert.deepEqual(otherTables(f), before);
  } finally { f.api.close(); }
});

test('no-op reset and body/banner overlap never write or silently remove a body', async () => {
  const f = await detailWorkspaceBannerRebaseFixture(companies[0]);
  try {
    await f.setRoles([f.selectedKeys[0]], [f.selectedKeys[3]]); const preview = await json(await f.preview()), unchanged = f.tables();
    assert.deepEqual(preview.document, preview.workspace.document); assert.equal((await f.rebasePut(f.rebaseBody(preview))).status, 409); assert.deepEqual(f.tables(), unchanged);
    const content = (await json(await f.api.route(f.base + '/content'))).content;
    await json(await f.api.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision,
      patch: { assets: { detailTop: [f.selectedKeys[2]], detail: content.assets.detail.value.filter(key => key !== f.selectedKeys[2]), detailBottom: [f.newBottom] } } } }));
    const retained = f.tables(), response = await f.preview(); assert.equal(response.status, 409); assert.match((await response.json()).error, /본문/); assert.deepEqual(f.tables(), retained);
  } finally { f.api.close(); }
});

test('preview request hashes bind new banner bytes and old/current body files or sidecar corruption cannot be bypassed', async () => {
  for (const mode of ['new-banner', 'old-banner', 'body-result', 'body-origin', 'sidecar']) {
    const f = await detailWorkspaceBannerRebaseFixture(companies[0]);
    try {
      const preview = await json(await f.preview()), body = f.rebaseBody(preview);
      if (mode === 'new-banner') f.api.objects.set(f.newTop, await f.png('#abcdef'));
      else { const key = mode === 'old-banner' ? f.selectedKeys[0] : mode === 'body-result' ? f.imageEdit.key : mode === 'body-origin' ? f.selectedKeys[1] : f.imageEdit.key + '.edit.json'; const changed = f.api.objects.get(key).slice(); changed[changed.length - 1] ^= 1; f.api.objects.set(key, changed); }
      const retained = f.tables(); assert.equal((await f.rebasePut(body)).status, 409, mode); assert.deepEqual(f.tables(), retained);
      if (mode === 'new-banner') assert.notEqual((await json(await f.preview())).requestId, preview.requestId); else assert.equal((await f.preview()).status, 409);
    } finally { f.api.close(); }
  }
});

test('raw source/member/context/workspace races make the sole workspace UPSERT a no-op', async () => {
  for (const mode of ['quote', 'member', 'content', 'settings', 'profile', 'workspace', 'ignore']) {
    const f = await detailWorkspaceBannerRebaseFixture(companies[0]);
    try {
      const preview = await json(await f.preview()), body = f.rebaseBody(preview), prepare = f.api.db.prepare; let injected = false, competing;
      if (mode === 'ignore') { f.api.sqlite.exec('CREATE TRIGGER ignore_rebase BEFORE INSERT ON product_detail_workspaces BEGIN SELECT RAISE(IGNORE); END'); competing = f.tables(); }
      else f.api.db.prepare = sql => { const statement = prepare(sql); if (sql.startsWith('INSERT INTO product_detail_workspaces')) { const execute = statement.execute; statement.execute = () => {
        if (!injected) { injected = true;
          if (mode === 'quote') { const value = f.state(); value.categoryOverrides['category:' + preview.view.categoryContext.categoryId].common.brand = '경쟁'; f.writeState(value); }
          if (mode === 'member') f.api.sqlite.prepare("UPDATE members SET status='pending'").run();
          if (mode === 'content') { const row = f.api.sqlite.prepare('SELECT payload FROM product_content').get(), value = JSON.parse(row.payload); value.detail.description.value += '경쟁'; f.api.sqlite.prepare('UPDATE product_content SET payload=?').run(JSON.stringify(value)); }
          if (mode === 'settings') f.api.sqlite.prepare('INSERT INTO workspace_settings(owner_id,payload,updated_at) VALUES(?,?,?)').run('owner', JSON.stringify({ ...f.api.settings, brand: '경쟁' }), new Date().toISOString());
          if (mode === 'profile') { const row = f.api.sqlite.prepare('SELECT payload FROM category_profiles').get(), value = JSON.parse(row.payload); value.name += '경쟁'; f.api.sqlite.prepare('UPDATE category_profiles SET payload=?').run(JSON.stringify(value)); }
          if (mode === 'workspace') f.api.sqlite.prepare("UPDATE product_detail_workspaces SET updated_at='2027-01-01T00:00:00.000Z'").run();
          competing = f.tables();
        } return execute(); }; } return statement; };
      const response = await f.rebasePut(body); assert.equal(response.status, 409, mode + ': ' + await response.clone().text()); assert.ok(injected || mode === 'ignore'); assert.deepEqual(f.tables(), competing);
    } finally { f.api.close(); }
  }
});

test('lost committed ACK is recovered by normal GET only and post-commit membership uncertainty remains503', async () => {
  for (const mode of ['lost', 'late-member']) {
    const f = await detailWorkspaceBannerRebaseFixture(companies[1]);
    try {
      const preview = await json(await f.preview()), body = f.rebaseBody(preview), prepare = f.api.db.prepare; let injected = false;
      f.api.db.prepare = sql => { const statement = prepare(sql); if (sql.startsWith('INSERT INTO product_detail_workspaces')) { const execute = statement.execute; statement.execute = () => {
        const result = execute(); injected = true; if (mode === 'lost') throw Error('fixture committed ACK lost'); f.api.sqlite.prepare("UPDATE members SET status='pending'").run(); return result;
      }; } return statement; };
      assert.equal((await f.rebasePut(body)).status, 503); assert.ok(injected); f.api.db.prepare = prepare; if (mode === 'late-member') f.api.sqlite.prepare("UPDATE members SET status='approved'").run();
      const before = f.tables(), recovered = await json(await f.read()); assert.equal(recovered.workspace.requestId, preview.requestId); assert.equal(recovered.workspace.revision, preview.workspace.revision + 1); assert.deepEqual(f.tables(), before);
    } finally { f.api.close(); }
  }
});

test('closed body/query/origin scope and changed source snapshot cannot change another option or company', async () => {
  const f = await detailWorkspaceBannerRebaseFixture(companies[0]);
  try {
    const preview = await json(await f.preview()), body = f.rebaseBody(preview), before = f.tables();
    for (const value of [{ ...body, document: preview.document }, { ...body, extra: true }, { ...body, expectedRevision: 0 }, { ...body, expectedDigest: 'bad' }]) assert.equal((await f.rebasePut(value)).status, 400);
    for (const value of [{ ...body, requestId: '0'.repeat(64) }, { ...body, optionId: 'not-an-option' }, { ...body, expectedView: { ...body.expectedView, revision: body.expectedView.revision + 1 } }]) assert.equal((await f.rebasePut(value)).status, 409);
    const req = (url, init) => f.rebaseRoute[init?.method ?? 'GET'](new Request('https://app.test' + url, init), f.context);
    assert.equal((await req(f.rebaseEndpoint + '&optionId=' + f.optionId + '&extra=true')).status, 400);
    assert.equal((await req(f.rebaseEndpoint, { method: 'PUT', headers: { 'content-type': 'application/json', origin: 'https://foreign.test' }, body: JSON.stringify(body) })).status, 400);
    assert.deepEqual(f.tables(), before); f.api.setCompany({ code: companies[1].companyCode, name: companies[1].companyName }); assert.ok([403, 409].includes((await f.preview()).status)); assert.deepEqual(f.tables(), before);
  } finally { f.api.close(); }
});

test('awaited file reads recheck source and workspace raw snapshots before returning a preview', async () => {
  const f = await detailWorkspaceBannerRebaseFixture(companies[0]);
  try {
    const get = f.api.bindings.FILES.get; let injected = false, competing;
    f.api.bindings.FILES.get = async (...args) => { const object = await get(...args); if (args[0] === f.newTop && !injected) { injected = true; f.api.sqlite.prepare("UPDATE product_detail_workspaces SET updated_at='2027-01-01T00:00:00.000Z'").run(); competing = f.tables(); } return object; };
    assert.equal((await f.preview()).status, 409); assert.ok(injected); assert.deepEqual(f.tables(), competing);
  } finally { f.api.close(); }
});
