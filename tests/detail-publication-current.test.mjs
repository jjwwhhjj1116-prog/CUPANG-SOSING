import test from 'node:test';
import assert from 'node:assert/strict';
import { currentDetailPublicationFixture, policy } from './helpers/current-detail-publication.mjs';
import { json } from './helpers/workspace-detail-save-api.mjs';
const plain = value => JSON.parse(JSON.stringify(value));
async function freshJob(f) {
  const client = f.runtime.load('app/batch-selected-detail-work.ts'), operations = [];
  f.calls.length = 0;
  const result = await client.processSelectedDetailWork(f.product.id, { ownerId: 'owner', company: f.openedWorkspace.workspace.company,
    signal: new AbortController().signal, fetcher: f.request, state: client.createSelectedDetailWorkState('owner', f.product.id), assertCurrent: async () => {} },
  { readImage: async () => { operations.push('image-read'); throw Error('forbidden image read'); }, recognize: async () => { operations.push('provider'); throw Error('forbidden provider'); },
    prepareComposite: async () => { operations.push('render'); throw Error('forbidden render'); }, applyImage: async () => { operations.push('write'); throw Error('forbidden write'); } });
  assert.deepEqual(operations, []); assert.ok(f.calls.every(call => call.method === 'GET')); return result;
}

test('versioned current-publication GET proves source, every peer and actual output without writing or replaying a receipt', async () => {
  const f = await currentDetailPublicationFixture(); try {
    const { body } = await f.prepare(), saved = await json(await f.post(body)), before = f.tables(), response = await json(await f.current());
    assert.equal(response.policy, policy); assert.equal(response.readOnly, true); assert.equal(response.status, 'current');
    assert.equal(response.publication.uploadId, body.uploadId); assert.equal(response.publication.peerAfterDigest, saved.receipt.peerAfterDigest);
    assert.equal(response.publication.basisSha256, saved.receipt.currentStage5.basisSha256); assert.equal(response.publication.fieldsSha256, saved.receipt.currentStage5.fieldsSha256);
    assert.equal(response.source.inputFingerprint, saved.quotation.inputFingerprint); assert.deepEqual(response.execution, { requests: 0, writes: 0 });
    assert.equal(response.applied, undefined); assert.deepEqual(f.tables(), before);
  } finally { f.api.close(); }
});

test('unrelated label content and quotation fields can advance clocks while exact Stage5 publication remains current', async () => {
  const f = await currentDetailPublicationFixture(); try {
    const { body } = await f.prepare(); await json(await f.post(body));
    const content = (await json(await f.api.route(f.base + '/content'))).content;
    await json(await f.api.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision, patch: { label: { precautions: '합성 표시사항' } } } }));
    const view = await f.view(), field = view.resolved.schema.fields.find(field => field.id === 'model'); assert.ok(field);
    await f.set([{ optionId: null, fieldKey: field.id, value: '합성 모델' }]);
    assert.equal((await f.recover(body.uploadId)).status, 409, 'strict old-command replay remains unchanged');
    const before = f.tables(), result = await json(await f.current()); assert.equal(result.status, 'current');
    const reused = await freshJob(f); assert.equal(reused.status, 'completed'); assert.equal(reused.reused, true); assert.deepEqual(f.tables(), before);
  } finally { f.api.close(); }
});

for (const change of ['detail-field', 'html-blank', 'alt', 'seo', 'source-assets', 'options', 'settings', 'peer', 'output-bytes', 'alias-bytes', 'source-bytes', 'legacy'])
  test(`changed ${change} requires review and current-publication GET never mutates`, async () => {
    const f = await currentDetailPublicationFixture(); try {
      const { body } = await f.prepare(), saved = await json(await f.post(body));
      if (['detail-field', 'html-blank', 'alt'].includes(change)) {
        const key = change === 'detail-field' ? f.targets.detailImages.primary : change === 'html-blank' ? f.targets.detailHtml.primary : 'altText';
        await f.set([{ optionId: null, fieldKey: key, value: change === 'detail-field' ? f.selectedKeys[1] : change === 'html-blank' ? '<p>직접 내용</p>' : '직접 설명' }]);
      } else if (['seo', 'source-assets'].includes(change)) {
        const content = (await json(await f.api.route(f.base + '/content'))).content;
        await json(await f.api.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision, patch: change === 'seo' ? { seo: { title: '직접 수정한 SEO' } } : { assets: { detail: [...content.assets.detail.value].reverse() } } } }));
      } else if (change === 'options') {
        const current = await json(await f.api.route(f.base + '/options')), rows = f.api.load('app/product-options.ts').optionInputs(current.options); rows.at(-1).included = !rows.at(-1).included;
        await json(await f.api.route(f.base + '/options', { method: 'PATCH', body: { expectedRevision: current.options.revision, expectedProductVersion: current.productVersion, rows } }));
      } else if (change === 'settings') f.api.sqlite.prepare('UPDATE workspace_settings SET payload=? WHERE owner_id=?').run(JSON.stringify({ ...f.settings, translationPrompt: '새 요청' }), 'owner');
      else if (change === 'peer') {
        const peerId = saved.quotation.resolved.rows.find(row => row.optionId && row.optionId !== f.optionId && row.included).optionId, before = await json(await f.read(peerId)), document = plain(before.workspace.document); document.imageMargin = 9; document.generatedHtml = f.model.generateDetailWorkspaceHtml(document.photos, 9);
        await json(await f.put({ optionId: peerId, expectedRevision: before.workspace.revision, expectedView: f.model.detailWorkspaceExpectedView(before.view), requestId: await f.model.detailWorkspaceRequestId(f.product.id, peerId, before.workspace.revision, f.model.detailWorkspaceExpectedView(before.view), document), document }));
      } else if (change.endsWith('bytes')) {
        const key = change === 'output-bytes' ? saved.receipt.key : change === 'alias-bytes' ? saved.receipt.publishedBodyImages[0].key : saved.receipt.publishedBodyImages[0].sourceKey;
        f.api.objects.set(key, await f.png('#ff5500'));
      } else {
        const state = f.state(), backup = Object.values(state.detailSaveBackups).flat().find(entry => entry.receipt.uploadId === body.uploadId); delete backup.receipt.currentStage5; f.writeState(state);
      }
      const before = f.tables(), result = await json(await f.current()); assert.equal(result.status, 'review-required', change); assert.deepEqual(result.execution, { requests: 0, writes: 0 });
      const blocked = await freshJob(f); assert.equal(blocked.status, 'partial'); assert.equal(blocked.reused, undefined); assert.deepEqual(f.tables(), before);
    } finally { f.api.close(); }
  });

test('fresh coordinator reuses exact published Stage5 before image reads and preserves pending inference before any reuse read', async () => {
  const f = await currentDetailPublicationFixture(); try {
    const { body } = await f.prepare(); await json(await f.post(body));
    const client = f.runtime.load('app/batch-selected-detail-work.ts'), operations = [], state = client.createSelectedDetailWorkState('owner', f.product.id),
      options = { ownerId: 'owner', company: f.openedWorkspace.workspace.company, signal: new AbortController().signal, fetcher: f.request, state, assertCurrent: async () => {} },
      deps = { readImage: async () => { operations.push('readImage'); throw Error('no image read during reuse'); }, recognize: async () => { operations.push('recognize'); throw Error('no inference'); }, prepareComposite: async () => { operations.push('prepare'); throw Error('no render/upload'); } };
    const before = f.tables(), result = await client.processSelectedDetailWork(f.product.id, options, deps); assert.equal(result.status, 'completed'); assert.equal(result.reused, true);
    assert.deepEqual(operations, []); assert.ok(f.calls.every(call => call.method === 'GET')); assert.deepEqual(f.tables(), before);
    const current = await json(await f.read()), photo = current.workspace.document.photos.find(photo => photo.role === 'body'), source = (await json(await f.openImage(photo.id))).source,
      vision = f.api.load('app/image-text-vision.ts'), configuration = { provider: 'workers-ai-vision', model: vision.IMAGE_TEXT_VISION_MODEL, configured: true, paidAllowed: true, notice: vision.IMAGE_TEXT_VISION_NOTICE },
      pending = client.createSelectedDetailWorkState('owner', f.product.id), attempt = { requestId: '7f3511ce-7eae-40d4-8af4-51e901a61004', source, configuration };
    pending.inference = { photoId: photo.id, attempt }; f.calls.length = 0;
    const observed = await client.processSelectedDetailWork(f.product.id, { ...options, state: pending }, { ...deps, observe: async original => {
      assert.equal(original, attempt); operations.push('observe'); return { requestId: attempt.requestId, source, configuration, status: 'uncertain', readOnly: true, execution: { requests: 0 } };
    } });
    assert.equal(observed.status, 'partial'); assert.equal(observed.inferencePending, true); assert.equal(pending.inference.attempt, attempt);
    assert.deepEqual(operations, ['observe']); assert.ok(!f.calls.some(call => call.url.includes('current=automatic-stage5-v1'))); assert.deepEqual(f.tables(), before);
  } finally { f.api.close(); }
});

test('the read client rejects malformed, foreign, stale or mutation-shaped current-publication responses', async () => {
  const f = await currentDetailPublicationFixture(); try {
    const { body } = await f.prepare(); await json(await f.post(body));
    const observation = await json(await f.current()), view = await f.view(), client = f.runtime.load('app/detail-workspace-composite-client.ts'),
      selection = { productId: f.product.id, profileId: view.categoryContext.profileId, view };
    assert.equal((await client.readCurrentDetailPublication(selection, new AbortController().signal, async () => Response.json(observation))).status, 'current');
    const variants = [value => { value.readOnly = false; }, value => { value.execution.requests = 1; }, value => { value.execution.writes = 1; },
      value => { value.source.productId = 'foreign'; }, value => { value.source.inputFingerprint = '0'.repeat(64); }, value => { value.status = 'completed'; },
      value => { delete value.publication; }, value => { value.applied = true; }, value => { value.publication.sourceOptionId = 'foreign'; }, value => { value.publication.bodyPhotos = 0; }];
    for (const change of variants) { const value = plain(observation); change(value); await assert.rejects(() => client.readCurrentDetailPublication(selection, new AbortController().signal, async () => Response.json(value))); }
  } finally { f.api.close(); }
});

for (const asset of ['output', 'alias']) for (const change of ['peer', 'settings']) test(`current-publication GET rechecks ${change} after awaited final-${asset} reads`, async () => {
  const f = await currentDetailPublicationFixture(); try {
    const { body } = await f.prepare(), saved = await json(await f.post(body)), get = f.api.bindings.FILES.get; let injected = false, competing, aliasReads = 0;
    f.api.bindings.FILES.get = async (...args) => {
      const object = await get(...args);
      if (args[0] === saved.receipt.publishedBodyImages[0].key) aliasReads++;
      if (!injected && (asset === 'output' ? args[0] === saved.receipt.key : args[0] === saved.receipt.publishedBodyImages[0].key && aliasReads === 2)) {
        injected = true;
        if (change === 'peer') { const peerId = saved.quotation.resolved.rows.find(row => row.optionId && row.optionId !== f.optionId && row.included).optionId; f.api.sqlite.prepare('UPDATE product_detail_workspaces SET revision=revision+1 WHERE option_id=?').run(peerId); }
        else f.api.sqlite.prepare('UPDATE workspace_settings SET payload=? WHERE owner_id=?').run(JSON.stringify({ ...f.settings, translationPrompt: 'late source change' }), 'owner');
        competing = f.tables();
      }
      return object;
    };
    assert.equal((await json(await f.current())).status, 'review-required'); assert.equal(injected, true); assert.deepEqual(f.tables(), competing);
  } finally { f.api.close(); }
});

test('current-publication selection is closed and unpublished products remain a read-only non-completion', async () => {
  const f = await currentDetailPublicationFixture(); try {
    const before = f.tables(), result = await json(await f.current()); assert.equal(result.status, 'unpublished'); assert.equal(result.publication, undefined); assert.deepEqual(f.tables(), before);
    const base = f.base + '/detail-save?profileId=' + f.initialView.categoryContext.profileId;
    for (const suffix of ['&current=other', '&current=' + policy + '&current=' + policy, '&current=' + policy + '&uploadId=' + 'a'.repeat(64), '&current=' + policy + '&editor=saved-composition-v1']) assert.equal((await f.request(base + suffix)).status, 400);
  } finally { f.api.close(); }
});

test('an older no-publication-mode saved composition requires review before any fresh image work', async () => {
  const f = await currentDetailPublicationFixture(); try {
    const prepared = await f.prepareWorkspace(); await json(await f.post(await f.uploadWorkspace(prepared)));
    const before = f.tables(), observation = await json(await f.current()); assert.equal(observation.status, 'review-required');
    assert.equal((await freshJob(f)).status, 'partial'); assert.deepEqual(f.tables(), before);
  } finally { f.api.close(); }
});
