import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { companies } from './helpers/image-download-ui.mjs';
import { detailWorkspaceFixture, json } from './helpers/detail-workspace-api.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const signal = () => new AbortController().signal;
async function edited(company) {
  const f = await detailWorkspaceFixture(company, { wire: true, excluded: true });
  try {
    const stored = await json(await f.put(await f.body())), photo = stored.workspace.document.photos.find(photo => photo.role === 'body'),
      route = f.api.load('app/api/products/[id]/workspace-image-text/route.ts'),
      query = new URLSearchParams({ profileId: f.initialView.categoryContext.profileId, optionId: f.optionId, photoId: photo.id });
    const source = (await json(await route.GET(new Request('https://app.test' + f.base + '/workspace-image-text?' + query), f.context))).source;
    const editDocument = { format: 'free-image-edit-v1', width: source.width, height: source.height, sourceLanguage: 'zh', regions: [
      { id: 'manual-1', text: '原文', translated: '검토 문구', box: { x: 0, y: 0, width: Math.min(10, source.width), height: Math.min(10, source.height) },
        confidence: 0, selected: true, issue: null, translationProvenance: 'manual', background: '#ffffff', foreground: '#111111', fontSize: 1 },
    ] };
    const output = await sharp({ create: { width: source.width, height: source.height, channels: 4, background: '#13579b' } }).png().toBuffer();
    const form = new FormData(); form.set('action', 'apply'); form.set('source', JSON.stringify(source)); form.set('editDocument', JSON.stringify(editDocument));
    form.set('file', new File([output], 'reviewed-test-draft.png', { type: 'image/png' }));
    const applied = await json(await route.POST(new Request('https://app.test' + f.base + '/workspace-image-text', { method: 'POST', body: form }), f.context));
    const saved = { view: applied.view, workspace: applied.workspace, roles: applied.roles }, attachRoute = f.api.load('app/api/products/[id]/detail-workspace/attach/route.ts'),
      expectedView = f.model.detailWorkspaceExpectedView(saved.view), body = { optionId: f.optionId, expectedView, revision: saved.workspace.revision, digest: saved.workspace.digest },
      url = 'https://app.test' + f.base + '/detail-workspace/attach?profileId=' + f.initialView.categoryContext.profileId;
    const attach = (value = body, extras = {}) => attachRoute.POST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...extras }, body: JSON.stringify(value) }), f.context);
    return { ...f, saved, photo, applied, attach, attachBody: body, attachUrl: url };
  } catch (error) { f.api.close(); throw error; }
}
const exceptProducts = tables => { const { products: omitted, ...rest } = tables; assert.ok(omitted); return rest; };

for (const company of companies) test(`explicit result attachment appends only current workspace keys and changes no quotation/content/source rows (${company.companyCode})`, async () => {
  const f = await edited(company);
  try {
    const before = f.tables(), original = plain(f.saved), key = f.applied.key;
    assert.ok(!f.saved.view.imageKeys.includes(key));
    const after = await json(await f.attach());
    assert.deepEqual(after.workspace, original.workspace); assert.deepEqual(after.roles, original.roles);
    assert.deepEqual(after.view.imageKeys, [...original.view.imageKeys, key]);
    assert.ok(Date.parse(after.view.productVersion) > Date.parse(original.view.productVersion));
    assert.deepEqual(exceptProducts(f.tables()), exceptProducts(before));
    const oldProduct = before.products[0], newProduct = f.tables().products[0], normalize = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['image_keys', 'updated_at'].includes(key)));
    assert.deepEqual(normalize(newProduct), normalize(oldProduct));
    assert.deepEqual(JSON.parse(newProduct.image_keys), after.view.imageKeys);
    const snapshot = f.tables(); assert.deepEqual(await json(await f.attach()), after); assert.deepEqual(f.tables(), snapshot, 'exact repeated request performs no update');
    // The existing quote route remains the only explicit final-field write.
    await f.set(f.targets.detailImages.linked.map(fieldKey => ({ optionId: f.optionId, fieldKey, value: after.workspace.document.photos.map(photo => photo.key).join('\n') })));
    const final = await f.view(); assert.equal(final.revision, original.view.revision + 1);
    const selected = view => view.resolved.rows.find(row => row.optionId === f.optionId);
    for (const fieldKey of f.targets.detailHtml.linked) assert.equal(selected(final).fields[fieldKey].value, selected(original.view).fields[fieldKey].value);
    assert.deepEqual((await json(await f.read())).workspace, original.workspace);
  } finally { f.api.close(); }
});

test('attachment rejects extra keys, foreign origin, stale workspace, membership change and actual result byte changes without appending anything', async () => {
  const f = await edited(companies[0]);
  try {
    const before = f.tables();
    for (const body of [{ ...f.attachBody, keys: ['owner/injected.png'] }, { ...f.attachBody, revision: f.attachBody.revision - 1 }, { ...f.attachBody, digest: '0'.repeat(64) }, { ...f.attachBody, expectedView: { ...f.attachBody.expectedView, revision: f.attachBody.expectedView.revision + 1 } }])
      assert.ok([400, 409].includes((await f.attach(body)).status));
    assert.equal((await f.attach(f.attachBody, { origin: 'https://other.test' })).status, 400); assert.deepEqual(f.tables(), before);
    f.api.sqlite.prepare("UPDATE members SET status='pending' WHERE id='owner'").run(); const memberChanged = f.tables();
    assert.equal((await f.attach()).status, 403); assert.deepEqual(f.tables(), memberChanged);
    f.api.sqlite.prepare("UPDATE members SET status='approved' WHERE id='owner'").run();
    const bytes = f.api.objects.get(f.applied.key); f.api.objects.set(f.applied.key, new Uint8Array(bytes.map((value, index) => index === bytes.length - 1 ? value ^ 1 : value)));
    const tampered = f.tables(); assert.equal((await f.attach()).status, 409); assert.deepEqual(f.tables(), tampered);
  } finally { f.api.close(); }
});

test('a full product candidate pool blocks explicit attachment and retains workspace-only results', async () => {
  const f = await edited(companies[0]);
  try {
    const product = f.tables().products[0], keys = JSON.parse(product.image_keys);
    while (keys.length < 150) keys.push('owner/pool-limit-' + keys.length + '.png');
    f.api.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify(keys), f.product.id);
    const before = f.tables(), latest = await json(await f.read());
    const body = { ...f.attachBody, expectedView: f.model.detailWorkspaceExpectedView(latest.view) };
    const response = await f.attach(body); assert.ok([409, 413].includes(response.status)); assert.deepEqual(f.tables(), before);
  } finally { f.api.close(); }
});

test('unknown attachment acknowledgement is recovered only by GET; changed quotation replies cannot be accepted', async () => {
  const f = await edited(companies[1]);
  try {
    const calls = [], client = f.api.load('app/detail-workspace-attachment-client.ts'), selection = { productId: f.product.id, optionId: f.optionId, profileId: f.initialView.categoryContext.profileId, view: f.saved.view };
    const fetcher = async (url, init = {}) => {
      calls.push({ method: init.method ?? 'GET', url });
      if (init.method === 'POST') { const response = await f.attach(JSON.parse(init.body)); assert.equal(response.status, 200); return Response.json({ error: 'fixture lost ACK' }, { status: 503 }); }
      return f.read();
    };
    const attempt = {};
    await assert.rejects(client.attachDetailWorkspaceFiles(selection, f.saved, attempt, signal(), fetcher)); assert.equal(attempt.pending, true);
    const committed = f.tables(); await assert.rejects(client.attachDetailWorkspaceFiles(selection, f.saved, attempt, signal(), fetcher)); assert.equal(calls.length, 1);
    const recovered = await client.recoverDetailWorkspaceFiles(selection, f.saved, attempt, signal(), fetcher);
    assert.equal(recovered.attached, true); assert.equal(attempt.pending, false); assert.deepEqual(f.tables(), committed);
    assert.deepEqual(calls.map(call => call.method), ['POST', 'GET']);
    const bad = plain(recovered.reply); bad.view.overrides.common.brand = 'unexpected edit';
    const pending = { identity: attempt.identity, pending: true };
    await assert.rejects(client.recoverDetailWorkspaceFiles(selection, f.saved, pending, signal(), async () => Response.json(bad)));
    assert.equal(pending.pending, true); assert.deepEqual(f.tables(), committed);
    await f.set([{ optionId: f.optionId, fieldKey: 'brand', value: 'later manual edit' }]);
    const competing = f.tables(), old = { identity: attempt.identity, pending: true };
    await assert.rejects(client.recoverDetailWorkspaceFiles(selection, f.saved, old, signal(), fetcher));
    assert.equal(old.pending, true);
    const latest = await client.readLatestDetailWorkspaceAfterAttachment(selection, f.saved, old, signal(), fetcher);
    assert.equal(old.superseded, true); assert.equal(old.pending, false); assert.equal(old.completed, undefined);
    assert.equal(latest.view.resolved.rows.find(row => row.optionId === f.optionId).fields.brand.value, 'later manual edit');
    const count = calls.length; await assert.rejects(client.attachDetailWorkspaceFiles(selection, f.saved, old, signal(), fetcher));
    assert.equal(calls.length, count); assert.deepEqual(f.tables(), competing);
  } finally { f.api.close(); }
});

test('an exact uncommitted attachment can be prepared for an explicit retry but is never automatically sent again', async () => {
  const f = await edited(companies[0]);
  try {
    const calls = [], client = f.api.load('app/detail-workspace-attachment-client.ts'), selection = { productId: f.product.id, optionId: f.optionId, profileId: f.initialView.categoryContext.profileId, view: f.saved.view }, attempt = {};
    const fetcher = async (url, init = {}) => {
      calls.push(init.method ?? 'GET'); if (init.method === 'POST' && calls.filter(method => method === 'POST').length === 1) throw Error('fixture request not dispatched');
      return init.method === 'POST' ? f.attach(JSON.parse(init.body)) : f.read();
    };
    await assert.rejects(client.attachDetailWorkspaceFiles(selection, f.saved, attempt, signal(), fetcher));
    const untouched = f.tables(), result = await client.recoverDetailWorkspaceFiles(selection, f.saved, attempt, signal(), fetcher);
    assert.equal(result.attached, false); assert.equal(attempt.retryReady, true); assert.deepEqual(f.tables(), untouched); assert.deepEqual(calls, ['POST', 'GET']);
    await client.attachDetailWorkspaceFiles(selection, f.saved, attempt, signal(), fetcher); assert.deepEqual(calls, ['POST', 'GET', 'POST']);
    assert.ok((await f.view()).imageKeys.includes(f.applied.key));
  } finally { f.api.close(); }
});

test('raw quote/member/workspace races and ignored pool updates never append files to competing state', async () => {
  for (const mode of ['quote', 'member', 'workspace', 'ignore']) {
    const f = await edited(companies[0]);
    try {
      const prepare = f.api.db.prepare; let competing, injected = false;
      if (mode === 'ignore') {
        f.api.sqlite.exec('CREATE TRIGGER ignore_workspace_attachment BEFORE UPDATE ON products BEGIN SELECT RAISE(IGNORE); END'); competing = f.tables();
      } else f.api.db.prepare = sql => {
        const statement = prepare(sql);
        if (sql.startsWith('UPDATE products SET image_keys=?,updated_at=?')) {
          const execute = statement.execute; statement.execute = () => {
            if (!injected) {
              injected = true;
              if (mode === 'quote') { const value = f.state(); value.categoryOverrides['category:' + f.initialView.categoryContext.categoryId].common.brand = 'competing literal'; f.writeState(value); }
              if (mode === 'member') f.api.sqlite.prepare("UPDATE members SET status='pending' WHERE id='owner'").run();
              if (mode === 'workspace') f.api.sqlite.prepare('UPDATE product_detail_workspaces SET request_id=?').run('0'.repeat(64));
              competing = f.tables();
            }
            return execute();
          };
        }
        return statement;
      };
      const response = await f.attach(); assert.ok([403, 409].includes(response.status), mode + ': ' + await response.clone().text());
      assert.ok(injected || mode === 'ignore'); assert.deepEqual(f.tables(), competing);
    } finally { f.api.close(); }
  }
});

test('a committed pool update with a lost database acknowledgement is confirmed by a later read without a second update', async () => {
  const f = await edited(companies[1]);
  try {
    const prepare = f.api.db.prepare; let updates = 0;
    f.api.db.prepare = sql => {
      const statement = prepare(sql);
      if (sql.startsWith('UPDATE products SET image_keys=?,updated_at=?')) { const execute = statement.execute; statement.execute = () => { updates++; execute(); throw Error('fixture database ACK lost'); }; }
      return statement;
    };
    assert.equal((await f.attach()).status, 503); const committed = f.tables(), after = await json(await f.read());
    assert.ok(after.view.imageKeys.includes(f.applied.key)); assert.deepEqual(await json(await f.attach()), after);
    assert.equal(updates, 1); assert.deepEqual(f.tables(), committed);
  } finally { f.api.close(); }
});
