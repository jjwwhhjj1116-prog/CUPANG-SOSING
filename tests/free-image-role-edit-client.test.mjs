import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cropClientFixture, plain } from './helpers/free-image-crop.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const signal = () => new AbortController().signal;
test('generic role rendering retains editable layers and binds selected main options in both save and read-only recovery', async () => {
  const h = cropClientFixture(), image = h.image();
  image.source = { ...image.source, role: 'main', optionImages: { revision: 4, optionIds: ['one', 'two'] } };
  const regions = [h.region('manual', { x: 1, y: 1, width: 12, height: 8 }, '가'), { ...h.region('unchecked', { x: 1, y: 1, width: 3, height: 3 }, ''), text: '', selected: false }];
  const rendered = await h.client.renderFreeImageTranslation(image, regions, signal(), ['two']);
  assert.ok(rendered.editDocument, 'generic edited pixels must retain their actual editable layers');
  assert.deepEqual(plain(rendered.editDocument), { format: 'free-image-edit-v1', width: 20, height: 12, sourceLanguage: 'zh', regions: plain(regions) });
  const key = await h.client.expectedFreeImageOutputKey(rendered);
  assert.notEqual(await h.client.expectedFreeImageOutputKey({ ...rendered, optionImageIds: ['one'] }), key);
  const changed = { ...rendered, editDocument: plain(rendered.editDocument) }; changed.editDocument.regions[1].translated = '보존할 미선택 레이어';
  assert.notEqual(await h.client.expectedFreeImageOutputKey(changed), key);
  const documentSha256 = sha(JSON.stringify(rendered.editDocument)), receipt = { source: rendered.source, key, applied: true,
    productVersion: '2026-10-06T00:00:01Z', contentRevision: 3, optionRevision: 5, optionImageIds: ['two'], editDocumentSha256: documentSha256 };
  const saved = await h.client.applyFreeImageTranslation(rendered, signal(), async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body.get('editDocument')), plain(rendered.editDocument)); assert.deepEqual(JSON.parse(init.body.get('optionImageIds')), ['two']);
    assert.equal(sha(new Uint8Array(await init.body.get('file').arrayBuffer())), sha(new Uint8Array(await rendered.output.arrayBuffer())));
    return Response.json(receipt);
  });
  assert.equal(saved.editDocumentSha256, documentSha256);
  const recovered = await h.client.recoverFreeImageTranslation(rendered, signal(), async (_url, init) => {
    const body = JSON.parse(init.body); assert.equal(body.action, 'recover'); assert.deepEqual(body.optionImageIds, ['two']);
    assert.deepEqual(body.editDocument, plain(rendered.editDocument)); assert.equal(body.outputSha256, sha(new Uint8Array(await rendered.output.arrayBuffer())));
    return Response.json({ ...receipt, replayed: true });
  });
  assert.equal(recovered.key, key); assert.equal(recovered.replayed, true);
});

test('successful generic main and additional erase clears only its handled style diagnostics in the retained document', async () => {
  const issue = 'VISION_BACKGROUND_COMPLEX: 주변 배경색이 일정하지 않아 단색 채움이 어울리지 않을 수 있습니다. 배경색과 영역을 직접 확인한 뒤 선택해주세요.';
  for (const role of ['main', 'additional', 'detail']) {
    const h = cropClientFixture(), image = h.image(); image.source = { ...image.source, role };
    const regions = [{ ...h.region('erase', { x: 1, y: 1, width: 10, height: 8 }, ''), erase: true, issue },
      { ...h.region('unselected', { x: 1, y: 1, width: 10, height: 8 }, ''), erase: true, selected: false, issue },
      { ...h.region('unknown', { x: 1, y: 1, width: 10, height: 8 }, ''), erase: true, issue: 'provider review required ' + issue }], before = plain(regions);
    const rendered = await h.client.renderFreeImageTranslation(image, regions, signal());
    assert.equal(rendered.editDocument.regions[0].issue, role === 'detail' ? issue : null, role);
    assert.equal(rendered.editDocument.regions[1].issue, issue); assert.equal(rendered.editDocument.regions[2].issue, regions[2].issue);
    assert.deepEqual(plain(regions), before);
  }
});
