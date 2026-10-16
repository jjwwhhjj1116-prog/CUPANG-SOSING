import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cropClientFixture, plain } from './helpers/free-image-crop.mjs';

const sha = value => createHash('sha256').update(typeof value === 'string' ? value : Buffer.from(value)).digest('hex');
const signal = () => new AbortController().signal;
const target = value => ({ kind: 'quotation', profileId: null, optionId: 'sku-a', input: 'detailImages', fieldKey: 'wire-detail', slotIndex: 1,
  revision: 7, inputFingerprint: 'c'.repeat(64), optionRevision: 3, value: 'owner/first.png\n' + value });
function reviewed(h) {
  const image = h.image();
  image.source = { ...image.source, quotationTarget: { ...target(image.source.sourceKey), bindingSha256: 'b'.repeat(64) } };
  const brush = h.brush.createFreeImageBrush(2, [{ x: 4, y: 7 }, { x: 8, y: 8 }], 20, 12);
  const regions = [
    { ...h.region('manual-7', { x: 2, y: 1, width: 8, height: 5 }, '검토'), translationProvenance: 'manual', fontFamily: 'serif', bold: true, italic: true, textAlign: 'center', lineHeight: 1.7 },
    { ...h.region('brush-8', brush.box, ''), text: '', erase: true, brush: brush.brush, translationProvenance: 'manual', background: '#00ff00' },
    { ...h.region('manual-9', { x: 1, y: 1, width: 3, height: 4 }, ''), text: '', selected: false, translationProvenance: 'manual' },
  ];
  return { image, regions, rect: { x: 1, y: 1, width: 10, height: 9 } };
}
test('reviewed quote preview retains ordered selected and unselected text/style/brush/crop with an independent immutable document', async () => {
  const h = cropClientFixture(), { image, regions, rect } = reviewed(h);
  const result = await h.client.renderFreeImageTranslation(image, regions, signal(), [], rect, 'en');
  assert.deepEqual(plain(result.editDocument), { format: 'free-image-edit-v1', width: 20, height: 12, sourceLanguage: 'en', regions: plain(regions),
    crop: { ...rect, sourceWidth: 20, sourceHeight: 12 } });
  const before = JSON.stringify(result.editDocument);
  regions[0].translated = 'later typing'; regions[1].brush.points[0].x = 2; regions.reverse();
  assert.equal(JSON.stringify(result.editDocument), before); assert.deepEqual([result.width, result.height], [10, 9]);
  const key = await h.client.expectedFreeImageOutputKey(result);
  const changed = { ...result, editDocument: plain(result.editDocument) }; changed.editDocument.regions[2].translated = 'unchecked note';
  assert.notEqual(await h.client.expectedFreeImageOutputKey(changed), key, 'same PNG bytes with different saved editing intent must not share an identity');
  assert.equal(await h.client.expectedFreeImageOutputKey(result), key);
});

test('apply and unknown-outcome recovery bind the document digest and same PNG without replaying a write', async () => {
  const h = cropClientFixture(), { image, regions, rect } = reviewed(h);
  const rendered = await h.client.renderFreeImageTranslation(image, regions, signal(), [], rect, 'zh');
  const editDocument = plain(rendered.editDocument), hash = sha(JSON.stringify(editDocument)), key = await h.client.expectedFreeImageOutputKey(rendered), calls = [];
  const receipt = { source: rendered.source, key, applied: true, productVersion: '2026-10-06T00:00:01Z', contentRevision: 2, optionRevision: 3,
    quotationRevision: 8, quotationInputFingerprint: 'd'.repeat(64), crop: plain(rendered.crop), editDocumentSha256: hash };
  const reply = await h.client.applyFreeImageTranslation(rendered, signal(), async (_url, init) => {
    calls.push('apply'); assert.deepEqual(JSON.parse(init.body.get('editDocument')), editDocument);
    assert.equal(sha(await init.body.get('file').arrayBuffer()), sha(await rendered.output.arrayBuffer())); return Response.json(receipt);
  });
  assert.equal(reply.editDocumentSha256, hash);
  for (const applied of [true, false]) {
    const recovered = await h.client.recoverFreeImageTranslation(rendered, signal(), async (_url, init) => {
      calls.push('recover'); const body = JSON.parse(init.body); assert.deepEqual(body.editDocument, editDocument); assert.equal(body.outputSha256, sha(await rendered.output.arrayBuffer()));
      return Response.json(applied ? { ...receipt, replayed: true } : { source: rendered.source, key, applied: false, crop: plain(rendered.crop), editDocumentSha256: hash });
    }); assert.equal(recovered.applied, applied);
  }
  for (const wrong of [undefined, 'e'.repeat(64)]) {
    await assert.rejects(h.client.applyFreeImageTranslation(rendered, signal(), async () => Response.json({ ...receipt, editDocumentSha256: wrong })), error => error.uncertain === true);
    await assert.rejects(h.client.recoverFreeImageTranslation(rendered, signal(), async () => Response.json({ source: rendered.source, key, crop: rendered.crop, applied: false, editDocumentSha256: wrong })), error => error.uncertain === true);
  }
  assert.deepEqual(calls, ['apply', 'recover', 'recover']);
});

test('reopen reads authenticated original pixels, restores raw canvas dimensions, and keeps the current result as the replacement anchor', async () => {
  const h = cropClientFixture(), { image, regions, rect } = reviewed(h), original = new TextEncoder().encode('actual authenticated source');
  const doc = plain((await h.client.renderFreeImageTranslation(image, regions, signal(), [], rect, 'en')).editDocument);
  const resultKey = 'owner/free-image-product-reviewed-result.png', requested = target(resultKey), source = { ...image.source, sourceSha256: sha(original),
    quotationTarget: { ...requested, bindingSha256: 'f'.repeat(64) }, editorSource: { resultKey, resultSha256: 'd'.repeat(64), documentSha256: sha(JSON.stringify(doc)) } };
  const calls = [], loaded = await h.client.readFreeImageSource('product', source.productVersion, resultKey, 'detail', signal(), async url => {
    calls.push(url); return calls.length === 1 ? Response.json({ source, editDocument: doc }) : new Response(original);
  }, requested, { restoreEditor: true });
  assert.equal(new URL(calls[0], 'https://fixture.test').searchParams.get('editor'), 'saved');
  assert.equal(calls[1], '/api/files/owner/original.png'); assert.equal(calls.length, 2, 'never read the flattened result as the render base');
  assert.deepEqual(plain(loaded.editDocument), doc); assert.deepEqual([loaded.width, loaded.height], [20, 12]);
  const rerendered = await h.client.renderFreeImageTranslation(loaded, loaded.editDocument.regions, signal(), [], rect, loaded.editDocument.sourceLanguage);
  assert.deepEqual([rerendered.width, rerendered.height], [10, 9]); assert.equal(rerendered.source.editorSource.resultKey, resultKey);
  const initial = await h.client.renderFreeImageTranslation(image, regions, signal(), [], rect, 'en');
  assert.deepEqual(await rerendered.output.arrayBuffer(), await initial.output.arrayBuffer(), 'restored edits are rendered once from the original canvas');
});

test('invalid restored bindings, document SHA, direction or original bytes do not silently open a flattened picture', async () => {
  for (const mode of ['product', 'version', 'anchor', 'target', 'document', 'orientation', 'bytes']) {
    const h = cropClientFixture(), { image, regions } = reviewed(h), original = new TextEncoder().encode('original');
    const doc = plain((await h.client.renderFreeImageTranslation(image, regions, signal())).editDocument);
    const resultKey = 'owner/free-image-product-output.png', requested = target(resultKey), source = { ...image.source, sourceSha256: sha(original), quotationTarget: { ...requested, bindingSha256: 'b'.repeat(64) },
      editorSource: { resultKey, resultSha256: 'd'.repeat(64), documentSha256: sha(JSON.stringify(doc)) } };
    if (mode === 'product') source.productId = 'other'; if (mode === 'version') source.productVersion = '2026-10-06T00:00:01Z';
    if (mode === 'anchor') source.editorSource.resultKey = 'owner/other.png'; if (mode === 'target') source.quotationTarget.optionId = 'other';
    if (mode === 'document') doc.regions[0].translated = 'tampered';
    if (mode === 'orientation') { doc.width = 12; doc.height = 20; source.editorSource.documentSha256 = sha(JSON.stringify(doc)); }
    const calls = [];
    await assert.rejects(h.client.readFreeImageSource('product', image.source.productVersion, resultKey, 'detail', signal(), async url => {
      calls.push(url); return calls.length === 1 ? Response.json({ source, editDocument: doc }) : new Response(mode === 'bytes' ? 'tampered original' : original);
    }, requested, { restoreEditor: true }));
    assert.ok(calls.length <= 2); assert.ok(calls.every(url => !url.endsWith('/' + resultKey)));
  }
});

test('only explicit missing-document responses permit legacy result fallback; rejected and interrupted reads never downgrade', async () => {
  const key = 'owner/free-image-product-legacy.png';
  for (const code of [undefined, 'wrong-code', 'image-edit-document-missing']) {
    for (const status of [403, 404, 409, 503]) {
      const h = cropClientFixture(), requested = target(key), bytes = new TextEncoder().encode('legacy flattened original'), calls = [];
      const proof = { ...h.source, sourceKey: key, sourceSha256: sha(bytes), quotationTarget: { ...requested, bindingSha256: 'b'.repeat(64) } };
      const run = h.client.readFreeImageSource('product', h.source.productVersion, key, 'detail', signal(), async url => {
        calls.push(url); return calls.length === 1 ? Response.json({ error: 'rejected', ...(code ? { code } : {}) }, { status }) : calls.length === 2 ? Response.json({ source: proof }) : new Response(bytes);
      }, requested, { restoreEditor: true });
      if (status === 404 && code === 'image-edit-document-missing') { const loaded = await run; assert.equal(loaded.editDocument, undefined); assert.equal(calls.length, 3); }
      else { await assert.rejects(run); assert.equal(calls.length, 1); }
    }
  }
  const h = cropClientFixture(), requested = target(key), proof = { ...h.source, sourceKey: key, quotationTarget: { ...requested, bindingSha256: 'b'.repeat(64) } }, calls = [];
  await assert.rejects(h.client.readFreeImageSource('product', h.source.productVersion, key, 'detail', signal(), async url => { calls.push(url); return Response.json({ source: proof }); }, requested, { restoreEditor: true }));
  assert.equal(calls.length, 1, 'a success response without saved document proof cannot silently downgrade');
});
