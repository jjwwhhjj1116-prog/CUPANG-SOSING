import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { workspaceDetailSaveFixture, json } from './helpers/workspace-detail-save-api.mjs';
import { companies } from './helpers/image-download-ui.mjs';

const plain = value => JSON.parse(JSON.stringify(value));

async function fixture(company, { unsaved = false } = {}) {
  const f = await workspaceDetailSaveFixture(company, { edited: false });
  try {
    if (unsaved) f.api.sqlite.prepare('DELETE FROM product_detail_workspaces').run();
    // The source fixture manually assigns photos. Model the same collected
    // role/automatic quotation that the selected-work runner actually accepts.
    const row = f.api.sqlite.prepare('SELECT payload FROM product_content').get(), content = JSON.parse(row.payload);
    content.assets.detail.provenance = 'collected';
    f.api.sqlite.prepare('UPDATE product_content SET payload=?').run(JSON.stringify(content));
    await f.set(f.targets.detailImages.linked.map(fieldKey => ({ optionId: f.optionId, fieldKey, value: null })));
    const initial = await f.view(), profileId = initial.categoryContext.profileId, route = f.api.load('app/api/products/[id]/image-text/route.ts'), calls = [];
    let intercept;
    const fetcher = async (url, init = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body });
      if (intercept) { const result = await intercept(url, init); if (result !== undefined) return result; }
      if (url.includes('/image-text')) return route[init.method ?? 'GET'](new Request('https://app.test' + url, init), f.context);
      if (url.includes('/detail-workspace')) return f.route[init.method ?? 'GET'](new Request('https://app.test' + url, init), f.context);
      return f.request(url, init);
    };
    const model = f.api.load('app/batch-selected-image-work.ts'), state = model.createSelectedImageStageState('owner', f.product.id, 'detail');
    let inference = 0;
    const deps = {
      plan: async () => ({ enabled: true, scope: { ownerId: 'owner', company: { code: company.companyCode, name: company.companyName } }, settings: { translateImages: true },
        tasks: [{ productId: f.product.id, productTitle: '합성 상품', optionId: f.optionId, optionLabel: '합성 옵션', stage: 'detail', profileId,
          categoryContext: initial.categoryContext, productVersion: initial.productVersion, imageCount: 2 }], messages: [] }),
      refresh: () => f.view(),
      readSource: async (_productId, _version, key, role, signal, _fetcher, target) => {
        signal.throwIfAborted();
        const query = new URLSearchParams({ sourceKey: key, role, target: 'quotation', profileId, optionId: f.optionId, fieldKey: target.fieldKey, slotIndex: String(target.slotIndex) });
        const { source } = await json(await fetcher(f.base + '/image-text?' + query));
        return { source, blob: new Blob([f.api.objects.get(key)], { type: 'image/png' }), canvas: { width: 800, height: 1 }, width: source.width, height: source.height };
      },
      recognize: async image => {
        inference++;
        image.visionResult = { notice: '검증된 합성 Qwen 응답', blocks: [] };
        return [{ id: 'line', text: '原文', translated: '한국어', translationProvenance: 'generated', confidence: 100, selected: true,
          box: { x: 0, y: 0, width: 20, height: 1 }, issue: null, background: '#ffffff', foreground: '#000000', fontSize: 1 }];
      },
      translate: async () => assert.fail('A verified Vision result must never fall back to Google/local translation'),
      render: async (image, regions) => ({ source: image.source, width: image.width, height: image.height,
        output: new Blob([await f.png('#ff0000')], { type: 'image/png' }),
        editDocument: f.api.load('app/free-image-edit-document.ts').validateFreeImageEditDocument({ format: 'free-image-edit-v1', width: image.width, height: image.height, sourceLanguage: 'zh', regions }, image.source) }),
    };
    return { ...f, state, calls, deps, get inference() { return inference; }, intercept(fn) { intercept = fn; },
      run: () => model.processSelectedImageStage(f.product.id, 'detail', { ownerId: 'owner', signal: new AbortController().signal, fetcher, state }, deps) };
  } catch (error) { f.api.close(); throw error; }
}

for (const company of companies) for (const unsaved of [false, true]) test(`${company.companyCode}: automatic detail translation survives ${unsaved ? 'first workspace creation' : 'saved workspace'} and actual final composite, with editable original regions`, async () => {
  const f = await fixture(company, { unsaved });
  try {
    const before = await json(await f.read()), originalPhotos = before.workspace?.document.photos;
    const result = await f.run(); assert.equal(result.status, 'completed', result.messages.join(' ')); assert.equal(result.applied, 2); assert.equal(f.inference, 2);
    const saved = await json(await f.read()), photos = saved.workspace.document.photos;
    assert.deepEqual(photos.map(photo => photo.originKey), f.selectedKeys);
    assert.deepEqual(photos.filter(photo => photo.role !== 'body').map(photo => photo.key), [f.selectedKeys[0], f.selectedKeys[3]]);
    if (originalPhotos) assert.deepEqual(photos.map(photo => photo.id), originalPhotos.map(photo => photo.id));
    const outputs = photos.filter(photo => photo.role === 'body').map(photo => photo.key);
    assert.ok(outputs.every(key => key.startsWith('owner/free-image-') && !key.startsWith('owner/free-image-workspace-')));
    const opened = await json(await f.openImage(photos[1].id));
    assert.equal(opened.source.sourceKey, f.selectedKeys[1]); assert.equal(opened.source.editorSource.resultKey, outputs[0]);
    assert.equal(opened.editDocument.regions[0].text, '原文'); assert.equal(opened.editDocument.regions[0].translated, '한국어');
    const final = await f.saveWorkspace(), response = await json(final.response);
    assert.deepEqual(final.prepared.sources.map(source => source.key), photos.map(photo => photo.key));
    const pixels = await sharp(Buffer.from(await final.prepared.output.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
    for (const y of [1, 2]) assert.deepEqual(Array.from(pixels.data.slice(y * 800 * pixels.info.channels, y * 800 * pixels.info.channels + 3)), [255, 0, 0]);
    assert.ok(response.quotation.resolved.rows.every(row => row.fields.detailImages.value === response.receipt.key));
    assert.equal(f.inference, 2, 'reconcile/reopen/final save must not repeat provider inference');
  } finally { f.api.close(); }
});

test('saved workspace ordering, deleted body photos, replacements and banner IDs survive automatic quotation translations', async () => {
  const f = await fixture(companies[0]);
  try {
    const before = await json(await f.read()), photos = plain(before.workspace.document.photos);
    photos.splice(1, 1); photos[1].key = f.keys[5];
    const document = { ...before.workspace.document, photos, generatedHtml: f.model.generateDetailWorkspaceHtml(photos, before.workspace.document.imageMargin) };
    await json(await f.put(await f.body(document, before)));
    const result = await f.run(); assert.equal(result.status, 'completed', result.messages.join(' '));
    assert.deepEqual((await json(await f.read())).workspace.document.photos, photos);
    assert.equal(f.calls.filter(call => call.url.includes('/detail-workspace') && call.method === 'PUT').length, 0, 'removed/replaced photos must never be restored or overwritten');
  } finally { f.api.close(); }
});

test('automatic reconciliation follows source identities after the user reverses saved body order', async () => {
  const f = await fixture(companies[0]);
  try {
    const before = await json(await f.read()), photos = plain(before.workspace.document.photos);
    [photos[1], photos[2]] = [photos[2], photos[1]];
    const document = { ...before.workspace.document, photos, generatedHtml: f.model.generateDetailWorkspaceHtml(photos, before.workspace.document.imageMargin) };
    await json(await f.put(await f.body(document, before)));
    const result = await f.run(); assert.equal(result.status, 'completed', result.messages.join(' '));
    const actual = (await json(await f.read())).workspace.document.photos, batch = f.state.batches[f.optionId];
    assert.deepEqual(actual.map(photo => photo.id), photos.map(photo => photo.id));
    assert.deepEqual(actual.map(photo => photo.originKey), photos.map(photo => photo.originKey));
    assert.equal(actual[1].key, batch.items[2].appliedKey); assert.equal(actual[2].key, batch.items[1].appliedKey);
  } finally { f.api.close(); }
});

for (const unsaved of [false, true]) for (const committed of [false, true]) test(`lost ${unsaved ? 'seed' : 'translation'} workspace ACK (${committed ? 'committed' : 'uncommitted'}) retains the exact CAS request and recovers by reads`, async () => {
  const f = await fixture(companies[0], { unsaved });
  try {
    let once = true;
    f.intercept(async (url, init) => {
      if (once && url.includes('/detail-workspace') && init.method === 'PUT') {
        once = false; if (committed) await json(await f.route.PUT(new Request('https://app.test' + url, init), f.context)); throw Error('fixture lost workspace ACK');
      }
    });
    const first = await f.run(); assert.equal(first.status, 'uncertain'); assert.equal(f.inference, 1); assert.ok(f.state.detailWorkspacePending.save.attempt.pending);
    const writes = f.calls.filter(call => call.method !== 'GET').length;
    const recovered = await f.run(); assert.equal(recovered.recovered, true); assert.equal(recovered.status, 'partial'); assert.equal(f.inference, 1);
    assert.equal(f.calls.filter(call => call.method !== 'GET').length, writes, 'recovery must not repeat quote/upload/workspace writes');
    let completed = recovered;
    for (let resumes = 0; resumes < 4 && completed.status !== 'completed'; resumes++) completed = await f.run();
    assert.equal(completed.status, 'completed', completed.messages.join(' ')); assert.equal(f.inference, 2); assert.equal(f.state.detailWorkspacePending, undefined);
  } finally { f.api.close(); }
});

test('lost quotation ACK recovery queues workspace adoption without dispatching a new workspace write or inference', async () => {
  const f = await fixture(companies[0]);
  try {
    let once = true;
    f.intercept(async (url, init) => {
      if (once && url.endsWith('/image-text') && init.body instanceof FormData) {
        once = false; await json(await f.api.load('app/api/products/[id]/image-text/route.ts').POST(new Request('https://app.test' + url, init), f.context));
        throw Error('fixture lost quotation ACK');
      }
    });
    assert.equal((await f.run()).status, 'uncertain'); assert.equal(f.inference, 1);
    const writes = f.calls.filter(call => call.method !== 'GET').length;
    const recovered = await f.run(); assert.equal(recovered.recovered, true); assert.equal(recovered.status, 'partial');
    assert.equal(f.calls.filter(call => call.method === 'PUT' && call.url.includes('/detail-workspace')).length, 0);
    assert.equal(f.calls.filter(call => call.body instanceof FormData).length, 1);
    // The recovery POST reads the immutable quotation receipt; it never sends
    // a PNG or a workspace save. Other reconciliation is a separate action.
    assert.equal(f.calls.filter(call => call.method !== 'GET').length, writes + 1); assert.equal(f.inference, 1);
    assert.ok(f.state.detailWorkspacePending);
    const adopted = await f.run(); assert.equal(adopted.recovered, true); assert.equal(f.inference, 1);
    assert.equal((await f.run()).status, 'completed'); assert.equal(f.inference, 2);
  } finally { f.api.close(); }
});

test('tampered generated edit metadata never enters a workspace or causes another inference', async () => {
  const f = await fixture(companies[0]);
  try {
    f.intercept(async (url, init) => {
      if (url.includes('/image-text?') && new URL(url, 'https://app.test').searchParams.get('editor') === 'saved') {
        const response = await f.api.load('app/api/products/[id]/image-text/route.ts').GET(new Request('https://app.test' + url, init), f.context), body = await json(response);
        body.editDocument.regions[0].translated = '변조한 문구'; return Response.json(body);
      }
    });
    const result = await f.run(); assert.equal(result.status, 'partial'); assert.equal(f.inference, 1); assert.ok(f.state.detailWorkspacePending);
    assert.equal(f.calls.filter(call => call.method === 'PUT' && call.url.includes('/detail-workspace')).length, 0);
    assert.deepEqual((await json(await f.read())).workspace.document.photos.map(photo => photo.key), f.selectedKeys);
  } finally { f.api.close(); }
});

for (const damage of ['missing', 'foreign']) test(`${damage} generated edit sidecar fails before adopting a flattened result`, async () => {
  const f = await fixture(companies[0]);
  try {
    f.intercept(async url => {
      const query = new URL(url, 'https://app.test').searchParams;
      if (url.includes('/image-text?') && query.get('editor') === 'saved') {
        const key = query.get('sourceKey') + '.edit.json';
        if (damage === 'missing') f.api.objects.delete(key);
        else f.api.objects.set(key, new TextEncoder().encode('{"format":"foreign-record"}'));
      }
    });
    const result = await f.run(); assert.equal(result.status, 'partial'); assert.equal(f.inference, 1); assert.ok(f.state.detailWorkspacePending);
    assert.equal(f.calls.filter(call => call.method === 'PUT' && call.url.includes('/detail-workspace')).length, 0);
    assert.deepEqual((await json(await f.read())).workspace.document.photos.map(photo => photo.key), f.selectedKeys);
  } finally { f.api.close(); }
});
