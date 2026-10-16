import test from 'node:test';
import assert from 'node:assert/strict';
import { companies } from './helpers/image-download-ui.mjs';
import { workspaceImageEditFixture, json, sha } from './helpers/workspace-image-edit-api.mjs';
const plain = value => JSON.parse(JSON.stringify(value));
const unchanged = f => { const { product_detail_workspaces: ignored, ...tables } = f.tables(); void ignored; return tables; };
for (const company of companies) test(`manual workspace image editing changes one saved body photo and restores real source/text/crop/brush (${company.companyCode})`, async () => {
  const f = await workspaceImageEditFixture(company);
  try {
    const tables = unchanged(f), oldObjects = new Map(f.api.objects), network = [...f.api.network], opened = await json(await f.openImage()), source = opened.source, doc = f.editDocument(), bytes = await f.png();
    assert.equal(source.quotationTarget, undefined); assert.equal(source.workspaceTarget.kind, 'detail-workspace'); assert.equal(source.sourceKey, f.selectedKeys[1]);
    assert.equal(opened.editDocument, undefined); assert.deepEqual(unchanged(f), tables);
    const saved = await json(await f.applyImage(source, doc, bytes)), current = await json(await f.read());
    assert.equal(saved.workspace.revision, 2); assert.deepEqual(saved.view, f.openedWorkspace.view); assert.deepEqual(saved.workspace, current.workspace);
    assert.equal(saved.key.startsWith('owner/free-image-workspace-' + f.product.id + '-'), true); assert.equal(saved.view.imageKeys.includes(saved.key), false);
    const expected = plain(f.openedWorkspace.workspace.document); expected.photos[1].key = saved.key; expected.generatedHtml = f.model.generateDetailWorkspaceHtml(expected.photos, expected.imageMargin);
    assert.deepEqual(saved.workspace.document, expected); assert.deepEqual(unchanged(f), tables);
    for (const [key, bytes] of oldObjects) assert.deepEqual(f.api.objects.get(key), bytes);
    const privateFile = key => f.api.load('app/api/files/[...key]/route.ts').GET(new Request('https://app.test/api/files/' + key), { params: Promise.resolve({ key: key.split('/') }) });
    assert.equal(f.api.objects.size, oldObjects.size + 2); assert.equal((await privateFile(saved.key)).status, 200);
    assert.equal((await privateFile(saved.key + '.edit.json')).status, 404);
    const reopen = await json(await f.openImage()); assert.deepEqual(reopen.editDocument, doc); assert.equal(reopen.source.sourceKey, source.sourceKey);
    assert.equal(reopen.source.editorSource.resultKey, saved.key); assert.equal(reopen.source.workspaceTarget.revision, 2);
    const secondDoc = plain(reopen.editDocument); secondDoc.regions[0].translated = ' 다시 직접 수정 '; const second = await json(await f.applyImage(reopen.source, secondDoc, await f.png('#123456')));
    assert.equal(second.workspace.revision, 3); assert.equal(second.workspace.document.photos[1].originKey, f.selectedKeys[1]);
    const again = await json(await f.openImage()); assert.equal(again.source.sourceKey, source.sourceKey); assert.deepEqual(again.editDocument, secondDoc); assert.deepEqual(unchanged(f), tables);
    assert.deepEqual(f.api.network, network);
  } finally { f.api.close(); }
});

test('replacement edits the current pixels while retaining a different immutable original reference', async () => {
  const f = await workspaceImageEditFixture(companies[0]);
  try {
    const before = await json(await f.read()), doc = f.document(before.workspace.document.photos.map(photo => photo.id === f.photoId ? { ...photo, key: f.selectedKeys[2] } : photo));
    await json(await f.put(await f.body(doc, before))); const source = (await json(await f.openImage())).source;
    assert.equal(source.sourceKey, f.selectedKeys[2]); const saved = await json(await f.applyImage(source));
    assert.equal(saved.workspace.document.photos[1].originKey, f.selectedKeys[1]); assert.equal(saved.workspace.document.photos[1].key, saved.key);
    const opened = await json(await f.openImage()); assert.equal(opened.source.sourceKey, f.selectedKeys[2]); assert.equal(opened.source.sourceSha256, source.sourceSha256);
  } finally { f.api.close(); }
});

test('crop preserves full base dimensions and text/brush document while the result has exactly cropped PNG dimensions', async () => {
  const f = await workspaceImageEditFixture(companies[0]);
  try {
    const source = (await json(await f.openImage())).source, doc = f.editDocument(); doc.crop = { sourceWidth: 800, sourceHeight: 1, x: 10, y: 0, width: 400, height: 1 };
    const bytes = await f.png('#112233', 400, 1), saved = await json(await f.applyImage(source, doc, bytes)), opened = await json(await f.openImage());
    assert.deepEqual(opened.editDocument, doc); assert.equal(opened.source.width, 800); assert.equal(opened.source.height, 1);
    const proof = saved.workspace.files.find(file => file.key === saved.key); assert.equal(proof.width, 400); assert.equal(proof.height, 1);
    assert.equal((await f.applyImage(opened.source, doc, await f.png('#112233', 399, 1))).status, 400);
  } finally { f.api.close(); }
});

for (const company of companies) test(`unknown ACK and exact repeated apply recover without another workspace or R2 write (${company.companyCode})`, async () => {
  const f = await workspaceImageEditFixture(company);
  try {
    const source = (await json(await f.openImage())).source, doc = f.editDocument(), bytes = await f.png(), saved = await json(await f.applyImage(source, doc, bytes)),
      before = f.tables(), objects = [...f.api.objects].map(([key, bytes]) => [key, sha(bytes)]);
    const recovered = await json(await f.recoverImage(source, doc, bytes)); assert.equal(recovered.applied, true); assert.equal(recovered.replayed, true); assert.deepEqual(recovered.workspace, saved.workspace);
    assert.equal((await json(await f.applyImage(source, doc, bytes))).replayed, true); assert.deepEqual(f.tables(), before); assert.deepEqual([...f.api.objects].map(([key, bytes]) => [key, sha(bytes)]), objects);
    await f.set([{ optionId: f.optionId, fieldKey: 'brand', value: '나중에 저장한 견적값' }]); const changed = f.tables();
    assert.equal((await f.recoverImage(source, doc, bytes)).status, 409); assert.deepEqual(f.tables(), changed);
  } finally { f.api.close(); }
});

test('generic workspace reorder retains a sealed result but arbitrary nonpool rows, changed IDs and replacements cannot borrow its authority', async () => {
  const f = await workspaceImageEditFixture(companies[0]);
  try {
    const source = (await json(await f.openImage())).source, saved = await json(await f.applyImage(source)), rows = saved.workspace.document.photos,
      moved = f.document([rows[0], rows[2], rows[1], rows[3]]), reordered = await json(await f.put(await f.body(moved, saved)));
    assert.equal(reordered.workspace.document.photos[2].key, saved.key); const before = f.tables();
    for (const photos of [[rows[0], { ...rows[1], id: 'different' }, rows[2], rows[3]], [rows[0], rows[1], { ...rows[2], key: saved.key }, rows[3]]]) {
      const response = await f.put(await f.body(f.document(photos), reordered)); assert.equal(response.status, 409); assert.deepEqual(f.tables(), before);
    }
    const badKey = 'owner/arbitrary-outside-pool.png'; await f.api.bindings.FILES.put(badKey, await f.png(), { httpMetadata: { contentType: 'image/png' } });
    assert.equal((await f.put(await f.body(f.document(rows.map(photo => photo.id === f.photoId ? { ...photo, key: badKey } : photo)), reordered))).status, 409); assert.deepEqual(f.tables(), before);
    const removed = await json(await f.put(await f.body(f.document([rows[0], rows[2], rows[3]]), reordered)));
    assert.equal(removed.workspace.document.photos.length, 3); assert.equal((await f.openImage()).status, 409);
  } finally { f.api.close(); }
});

test('raw quote/member/settings/workspace SQL races and ignored image updates preserve every competing table exactly', async () => {
  for (const mode of ['quote', 'member', 'settings', 'workspace', 'ignore']) {
    const f = await workspaceImageEditFixture(companies[0]);
    try {
      const source = (await json(await f.openImage())).source, prepare = f.api.db.prepare; let injected = false, competing;
      if (mode === 'ignore') { f.api.sqlite.exec('CREATE TRIGGER ignore_workspace_image BEFORE INSERT ON product_detail_workspaces BEGIN SELECT RAISE(IGNORE); END'); competing = f.tables(); }
      else f.api.db.prepare = sql => { const statement = prepare(sql); if (sql.startsWith('INSERT INTO product_detail_workspaces')) { const execute = statement.execute;
        statement.execute = () => { if (!injected) { injected = true;
          if (mode === 'quote') { const state = f.state(); state.categoryOverrides['category:' + f.initialView.categoryContext.categoryId].common.brand = '경쟁'; f.writeState(state); }
          if (mode === 'member') f.api.sqlite.prepare("UPDATE members SET role='admin'").run();
          if (mode === 'settings') f.api.sqlite.prepare('INSERT INTO workspace_settings(owner_id,payload,updated_at) VALUES(?,?,?)').run('owner', JSON.stringify({ ...f.api.settings, brand: '경쟁' }), new Date().toISOString());
          if (mode === 'workspace') f.api.sqlite.prepare("UPDATE product_detail_workspaces SET updated_at='2027-01-01T00:00:00.000Z'").run();
          competing = f.tables(); } return execute(); }; } return statement; };
      const response = await f.applyImage(source); assert.ok([403, 409].includes(response.status), mode + ': ' + await response.clone().text()); assert.ok(injected || mode === 'ignore');
      assert.deepEqual(f.tables(), competing); assert.equal([...f.api.objects.keys()].filter(key => key.includes('free-image-workspace-')).length, 2, 'unadopted immutable R2 objects are allowed');
    } finally { f.api.close(); }
  }
});

test('failed sidecar storage cannot adopt a PNG, and a lost committed DB ACK is verified rather than written twice', async () => {
  for (const mode of ['sidecar', 'database']) {
    const f = await workspaceImageEditFixture(companies[0]);
    try {
      const source = (await json(await f.openImage())).source, before = f.tables();
      if (mode === 'sidecar') { const put = f.api.bindings.FILES.put; f.api.bindings.FILES.put = async (...args) => { if (args[0].endsWith('.edit.json')) throw Error('fixture storage failure'); return put(...args); };
        assert.equal((await f.applyImage(source)).status, 503); assert.deepEqual(f.tables(), before); assert.equal(f.api.objects.has(source.sourceKey), true);
      } else {
        const prepare = f.api.db.prepare; let injected = false;
        f.api.db.prepare = sql => { const statement = prepare(sql); if (sql.startsWith('INSERT INTO product_detail_workspaces')) { const execute = statement.execute; statement.execute = () => { execute(); injected = true; throw Error('fixture lost database ACK'); }; } return statement; };
        const saved = await json(await f.applyImage(source)); assert.ok(injected); assert.equal(saved.workspace.revision, 2); assert.equal(saved.replayed, true);
        assert.deepEqual(unchanged(f), Object.fromEntries(Object.entries(before).filter(([key]) => key !== 'product_detail_workspaces')));
      }
    } finally { f.api.close(); }
  }
});

test('result/base/sidecar bytes and marker tampering fail closed without legacy fallback or table writes', async () => {
  const f = await workspaceImageEditFixture(companies[0]);
  try {
    const source = (await json(await f.openImage())).source, saved = await json(await f.applyImage(source)), before = f.tables();
    for (const key of [source.sourceKey, saved.key, saved.key + '.edit.json']) {
      const original = f.api.objects.get(key).slice(), changed = original.slice(); changed[changed.length - 1] ^= 1; f.api.objects.set(key, changed);
      assert.equal((await f.openImage()).status, 409, key); assert.equal((await f.read()).status, 409); assert.deepEqual(f.tables(), before); f.api.objects.set(key, original);
    }
    const get = f.api.bindings.FILES.get;
    for (const mode of ['docMarker', 'recordMarker', 'bothMarkers']) {
      f.api.bindings.FILES.get = async (...args) => { const object = await get(...args); if (args[0] !== saved.key) return object; const customMetadata = { ...object.customMetadata };
        if (mode !== 'recordMarker') delete customMetadata.freeImageEditDocumentSha256; if (mode !== 'docMarker') delete customMetadata.freeImageEditRecordSha256; return { ...object, customMetadata }; };
      assert.equal((await f.openImage()).status, 409, mode); assert.deepEqual(f.tables(), before);
    }
    f.api.bindings.FILES.get = get;
  } finally { f.api.close(); }
});

test('workspace sources never authorize legacy quotation/content writes, banners, forged targets or other company/product/option scopes', async () => {
  const f = await workspaceImageEditFixture(companies[0]);
  try {
    const source = (await json(await f.openImage())).source, before = f.tables(), bytes = await f.png(), doc = f.editDocument();
    for (const change of [{ workspaceTarget: { ...source.workspaceTarget, digest: '0'.repeat(64) } }, { workspaceTarget: { ...source.workspaceTarget, bindingSha256: '0'.repeat(64) } },
      { workspaceTarget: { ...source.workspaceTarget, optionId: 'other-option' } }, { productId: 'other-product' }]) {
      assert.ok([400, 409].includes((await f.applyImage({ ...source, ...change }, doc, bytes)).status)); assert.deepEqual(f.tables(), before);
    }
    assert.equal((await f.openImage(f.openedWorkspace.workspace.document.photos[0].id)).status, 409);
    const form = new FormData(); form.set('action', 'apply'); form.set('source', JSON.stringify(source)); form.set('editDocument', JSON.stringify(doc)); form.set('file', new File([bytes], 'edited.png', { type: 'image/png' }));
    const legacy = f.api.load('app/api/products/[id]/image-text/route.ts'); assert.equal((await legacy.POST(new Request('https://app.test' + f.base + '/image-text', { method: 'POST', body: form }), f.context)).status, 400);
    const plainForm = new FormData(); plainForm.set('action', 'apply'); plainForm.set('source', JSON.stringify(source)); plainForm.set('file', new File([bytes], 'edited.png', { type: 'image/png' }));
    assert.equal((await legacy.POST(new Request('https://app.test' + f.base + '/image-text', { method: 'POST', body: plainForm }), f.context)).status, 409); assert.deepEqual(f.tables(), before);
    f.api.setCompany({ code: companies[1].companyCode, name: companies[1].companyName }); assert.ok([403, 409].includes((await f.openImage()).status)); assert.deepEqual(f.tables(), before);
  } finally { f.api.close(); }
});

test('workspace-only image apply succeeds at a full 150-image product pool without changing it', async () => {
  const f = await workspaceImageEditFixture(companies[0]);
  try {
    const pool = [...f.initialView.imageKeys], bytes = await f.png();
    for (let i = pool.length; i < 150; i++) { const key = `owner/full-pool-${i}.png`; await f.api.bindings.FILES.put(key, bytes, { httpMetadata: { contentType: 'image/png' } }); pool.push(key); }
    f.api.sqlite.prepare('UPDATE products SET image_keys=?').run(JSON.stringify(pool));
    const source = (await json(await f.openImage())).source, before = unchanged(f), saved = await json(await f.applyImage(source));
    assert.equal(saved.view.imageKeys.length, 150); assert.equal(saved.view.imageKeys.includes(saved.key), false); assert.deepEqual(unchanged(f), before);
    assert.equal((await json(await f.read())).workspace.document.photos[1].key, saved.key);
  } finally { f.api.close(); }
});

test('actual base/member/raw-workspace changes during awaited file reads reject before any metadata adoption', async () => {
  for (const mode of ['base', 'member', 'workspace']) {
    const f = await workspaceImageEditFixture(companies[0]);
    try {
      const source = (await json(await f.openImage())).source, get = f.api.bindings.FILES.get; let fired = false, competing;
      f.api.bindings.FILES.get = async (...args) => { const object = await get(...args); if (!fired && args[0] === source.sourceKey) { fired = true;
        if (mode === 'base') { const bytes = f.api.objects.get(source.sourceKey).slice(); bytes[bytes.length - 1] ^= 1; f.api.objects.set(source.sourceKey, bytes); }
        if (mode === 'member') f.api.sqlite.prepare("UPDATE members SET company_code='A01526306',company_name='유앤채'").run();
        if (mode === 'workspace') f.api.sqlite.prepare("UPDATE product_detail_workspaces SET request_id=?").run('0'.repeat(64)); competing = f.tables();
      } return object; };
      const response = await f.applyImage(source); assert.ok([403, 409].includes(response.status), mode + ': ' + await response.clone().text()); assert.ok(fired); assert.deepEqual(f.tables(), competing);
    } finally { f.api.close(); }
  }
});

test('a parent or member change after successful SQL remains an uncertain 503 rather than a false definite rejection', async () => {
  for (const mode of ['parent', 'member']) {
    const f = await workspaceImageEditFixture(companies[0]);
    try {
      const source = (await json(await f.openImage())).source, prepare = f.api.db.prepare; let fired = false;
      f.api.db.prepare = sql => { const statement = prepare(sql); if (sql.startsWith('INSERT INTO product_detail_workspaces')) { const execute = statement.execute;
        statement.execute = () => { const result = execute(); if (!fired) { fired = true;
          if (mode === 'parent') f.api.sqlite.prepare("UPDATE products SET updated_at='2027-01-01T00:00:00.000Z'").run();
          else f.api.sqlite.prepare("UPDATE members SET role='admin'").run();
        } return result; }; } return statement; };
      const response = await f.applyImage(source); assert.equal(response.status, 503, mode + ': ' + await response.clone().text()); assert.ok(fired);
      assert.equal(f.api.sqlite.prepare('SELECT revision FROM product_detail_workspaces').get().revision, 2, 'write truly committed before the competing change');
    } finally { f.api.close(); }
  }
});
