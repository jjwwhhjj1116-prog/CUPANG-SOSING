import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { companies } from './helpers/image-download-ui.mjs';
import { workspaceDetailSaveFixture, json, sha } from './helpers/workspace-detail-save-api.mjs';
import { currentDetailPublicationFixture } from './helpers/current-detail-publication.mjs';

async function multipart(f, publication = false, compressionLevel = 6) {
  const original = await f.prepareWorkspace(), helper = f.api.load('app/detail-composite-parts.ts'), parts = [];
  for (const [start, end] of [[0, 2], [2, original.sources.length]]) {
    const sources = original.sources.slice(start, end), layers = []; let height = 0;
    for (const source of sources) {
      const scaled = Math.max(1, Math.round(source.height * 800 / source.width));
      layers.push({ input: await sharp(f.api.objects.get(source.key)).resize(800, scaled).png().toBuffer(), left: 0, top: height }); height += scaled;
    }
    const bytes = new Uint8Array(await sharp({ create: { width: 800, height, channels: 4, background: '#fff' } }).composite(layers).png({ compressionLevel }).toBuffer());
    parts.push({ start, end, width: 800, height, sha256: sha(bytes), bytes: bytes.length, output: new Blob([bytes], { type: 'image/png' }) });
  }
  const identity = { productId: f.product.id, optionId: f.optionId, category: original.view.categoryContext, fingerprint: original.view.inputFingerprint,
    sources: original.sources, workspace: { revision: original.workspace.revision, digest: original.workspace.digest } };
  if (publication) {
    const plan = f.api.load('app/detail-save-plan.ts'), peers = plan.detailSaveOptionIds(original.view).map(optionId => {
      const row = f.row(optionId), workspace = row ? JSON.parse(row.payload) : null;
      return { optionId, workspace: workspace ? { revision: workspace.revision, digest: workspace.digest } : null };
    });
    identity.peerDigest = sha(JSON.stringify(peers)); identity.publicationPolicy = 'shared-body-pixels-v1';
    identity.publishedBodyImages = plan.detailSavePublishedBodyImages(original.workspace, 'owner');
  }
  const uploadId = await helper.detailCompositePartsUploadId(identity, parts), descriptors = [];
  for (const [index, part] of parts.entries()) {
    const id = await helper.detailCompositePartUploadId(uploadId, index, part);
    await f.upload({ ...original, ...part, uploadId: id });
    descriptors.push({ ...helper.detailCompositePartMetadata(part), uploadId: id });
  }
  return { original, body: { expectedRevision: original.view.revision, expectedInputFingerprint: original.view.inputFingerprint,
    sourceOptionId: f.optionId, uploadId, sha256: parts[0].sha256, bytes: parts[0].bytes,
    textPolicy: 'couplus-detail-alt-v1', editorPolicy: 'ordered-inputs-html-v1', workspace: identity.workspace,
    ...(publication ? { peerDigest: identity.peerDigest, publicationPolicy: identity.publicationPolicy } : {}),
    partsPolicy: helper.DETAIL_COMPOSITE_PARTS_POLICY, parts: descriptors } };
}
const retained = f => JSON.stringify(f.tables());

test('multipart detail save commits both ordered outputs once and recovers the same complete receipt', async () => {
  const f = await workspaceDetailSaveFixture(companies[0], { edited: false, blankQuote: true });
  try {
    const { original, body } = await multipart(f), saved = await json(await f.post(body)), keys = saved.receipt.parts.map(part => part.key);
    assert.equal(keys.length, 2); assert.equal(saved.receipt.key, keys[0]);
    assert.equal(JSON.stringify(f.api.load('app/detail-composite-parts.ts').validateDetailCompositeParts(saved.receipt.parts, original.sources.length, true)), JSON.stringify(body.parts));
    assert.deepEqual(saved.quotation.imageKeys, [...original.view.imageKeys, ...keys]);
    assert.equal(saved.quotation.revision, original.view.revision + 1);
    for (const row of saved.quotation.resolved.rows) {
      for (const field of f.targets.detailImages.linked) assert.equal(row.fields[field].value, keys.join('\n'));
      for (const field of f.targets.detailHtml.linked) assert.equal(row.fields[field].value, '');
    }
    const baseline = retained(f), again = await json(await f.post(body)), recovered = await json(await f.recover(body.uploadId));
    assert.deepEqual(again, saved); assert.equal(recovered.applied, true); assert.deepEqual(recovered.receipt, saved.receipt); assert.equal(retained(f), baseline);
    const restored = await json(await f.restore()); assert.deepEqual(restored.composition.inputs.images, original.sources);
    const history = f.state().detailSaveBackups['category:' + original.view.categoryContext.categoryId];
    assert.equal(history.length, 1); assert.deepEqual(history[0].sources, original.sources);
  } finally { f.api.close(); }
});

test('multipart rejects missing or tampered second output and malformed ranges before a quotation mutation', async () => {
  for (const mode of ['missing', 'tampered', 'range', 'height', 'part-id', 'alias']) {
    const f = await workspaceDetailSaveFixture(companies[0], { edited: false });
    try {
      const { body } = await multipart(f), key = f.api.load('app/label-upload-key.ts').labelUploadKey('owner', body.parts[1].uploadId);
      if (mode === 'missing') f.api.objects.delete(key);
      if (mode === 'tampered') { const bytes = f.api.objects.get(key).slice(); bytes[bytes.length - 1] ^= 1; f.api.objects.set(key, bytes); }
      if (mode === 'range') body.parts[1].start--;
      if (mode === 'height') body.parts[1].height++;
      if (mode === 'part-id') body.parts[1].uploadId = 'f'.repeat(64);
      if (mode === 'alias') body.sha256 = 'e'.repeat(64);
      const baseline = retained(f), response = await f.post(body);
      assert.ok([400, 409].includes(response.status), mode + ': ' + await response.clone().text()); assert.equal(retained(f), baseline, mode);
    } finally { f.api.close(); }
  }
});

test('multipart recovery verifies the second file instead of accepting the first part alone', async () => {
  const f = await workspaceDetailSaveFixture(companies[0], { edited: false });
  try {
    const { body } = await multipart(f), saved = await json(await f.post(body)), baseline = retained(f);
    f.api.objects.delete(saved.receipt.parts[1].key);
    assert.equal((await f.recover(body.uploadId)).status, 409); assert.equal((await f.post(body)).status, 409); assert.equal(retained(f), baseline);
  } finally { f.api.close(); }
});

test('full-detail height above 16000 is retained as photo-boundary parts, not rejected or reduced', async () => {
  const f = await workspaceDetailSaveFixture(companies[0], { edited: false });
  try {
    f.api.sqlite.prepare('DELETE FROM product_detail_workspaces').run();
    for (const [index, key] of f.selectedKeys.entries()) f.api.objects.set(key, await f.png(index % 2 ? '#116644' : '#661144', 800, 6000));
    await json(await f.put(await f.body()));
    const { original, body } = await multipart(f), saved = await json(await f.post(body));
    assert.equal(original.height, 24000); assert.deepEqual(body.parts.map(part => part.height), [12000, 12000]);
    assert.equal(saved.receipt.parts.reduce((sum, part) => sum + part.height, 0), original.height);
    assert.equal((await json(await f.recover(body.uploadId))).applied, true);
  } finally { f.api.close(); }
});

test('multipart companion-write failure rolls back both final links and the receipt as one unit', async () => {
  const f = await workspaceDetailSaveFixture(companies[0], { edited: false });
  try {
    const { body } = await multipart(f);
    f.api.sqlite.exec('CREATE TRIGGER multipart_ignore_product BEFORE UPDATE ON products BEGIN SELECT RAISE(IGNORE); END');
    const baseline = retained(f), objects = [...f.api.objects].map(([key, bytes]) => [key, sha(bytes)]), response = await f.post(body);
    assert.ok([409, 503].includes(response.status)); assert.equal(retained(f), baseline);
    assert.deepEqual([...f.api.objects].map(([key, bytes]) => [key, sha(bytes)]), objects);
    assert.equal((await json(await f.recover(body.uploadId))).applied, false);
  } finally { f.api.close(); }
});

test('current Stage5 proof checks the complete ordered multipart publication without writes', async () => {
  const f = await currentDetailPublicationFixture();
  try {
    const { body } = await multipart(f, true), saved = await json(await f.post(body)), baseline = retained(f);
    assert.equal((await json(await f.current())).status, 'current'); assert.equal(retained(f), baseline);
    f.api.objects.delete(saved.receipt.parts[1].key);
    const result = await json(await f.current()); assert.equal(result.status, 'review-required'); assert.deepEqual(result.execution, { requests: 0, writes: 0 }); assert.equal(retained(f), baseline);
  } finally { f.api.close(); }
});

test('multipart output manifests above 30MiB are rejected before any quotation mutation', async () => {
  const f = await workspaceDetailSaveFixture(companies[0], { edited: false });
  try {
    const { body } = await multipart(f), bytes = 8 * 1024 * 1024, source = body.parts[0];
    body.bytes = bytes; body.parts = Array.from({ length: 4 }, (_, index) => ({ ...source, start: index, end: index + 1, height: 1, bytes,
      uploadId: index === 0 ? body.uploadId : String(index).repeat(64) }));
    const baseline = retained(f), response = await f.post(body);
    assert.equal(response.status, 400); assert.match((await response.json()).error, /분할 이미지/); assert.equal(retained(f), baseline);
  } finally { f.api.close(); }
});

test('multipart keeps per-file 10MiB while accepting a verified combined output above the legacy 10MiB total', async () => {
  const f = await workspaceDetailSaveFixture(companies[0], { edited: false });
  try {
    f.api.sqlite.prepare('DELETE FROM product_detail_workspaces').run();
    for (const [index, key] of f.selectedKeys.entries()) f.api.objects.set(key, await f.png(index % 2 ? '#116644' : '#661144', 800, 1600));
    await json(await f.put(await f.body()));
    const { body } = await multipart(f, false, 0), total = body.parts.reduce((sum, part) => sum + part.bytes, 0);
    assert.ok(total > 10 * 1024 * 1024 && total < 30 * 1024 * 1024); assert.ok(body.parts.every(part => part.bytes < 10 * 1024 * 1024));
    const saved = await json(await f.post(body)); assert.equal(saved.receipt.parts.reduce((sum, part) => sum + part.bytes, 0), total);
    assert.equal((await json(await f.recover(body.uploadId))).applied, true);
  } finally { f.api.close(); }
});
