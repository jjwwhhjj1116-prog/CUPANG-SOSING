import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
const hash = 'a'.repeat(64), source = { productId: 'product', productVersion: '2026-10-16T00:00:00.000Z', contentRevision: 1,
  sourceKey: 'owner/base.png', sourceSha256: hash, role: 'detail', width: 3, height: 2,
  workspaceTarget: { kind: 'detail-workspace', profileId: 'cat', optionId: 'one', photoId: 'photo', revision: 1, digest: hash, bindingSha256: hash } },
  doc = { format: 'free-image-edit-v1', width: 3, height: 2, sourceLanguage: 'zh', regions: [] };
const fixture = async run => { const f = mobileIntakeHarness(); try { await run(f); } finally { f.close(); } };
test('workspace image sources have a genuine exclusive identity and independent deterministic immutable output namespace', () => fixture(async f => {
  const model = f.load('app/free-image-translation.ts'), record = f.load('app/free-image-edit-record.ts');
  assert.equal(model.validateFreeImageSource(source), source); assert.match(model.freeImageSourceIdentity(source), /"workspaceTarget":\{"kind":"detail-workspace"/u);
  const result = await record.freeImageEditOutputKey(source, doc, hash); assert.match(result.key, /^owner\/free-image-workspace-product-[a-f0-9]{64}-[a-f0-9]{64}\.png$/u);
  assert.notEqual(result.key, (await record.freeImageEditOutputKey({ ...source, workspaceTarget: { ...source.workspaceTarget, photoId: 'another' } }, doc, hash)).key);
  const { workspaceTarget: omitted, ...legacy } = source; void omitted;
  const legacyIdentity = model.freeImageSourceIdentity(legacy); assert.equal(legacyIdentity.includes('workspaceTarget'), false); assert.equal(model.freeImageApplyIdentity(legacy), legacyIdentity);
  assert.match((await record.freeImageEditOutputKey({ ...legacy, quotationTarget: { kind: 'quotation', profileId: 'cat', optionId: 'one', input: 'detailImages', fieldKey: 'detailImages', slotIndex: 0,
    revision: 1, inputFingerprint: hash, optionRevision: 1, bindingSha256: hash, value: legacy.sourceKey } }, doc, hash)).key, /^owner\/free-image-product-/u);
}));
test('forged or mixed workspace/quotation/option discriminants and unsupported restoration policies fail closed', () => fixture(f => {
  const m = f.load('app/free-image-translation.ts');
  for (const value of [{ ...source, role: 'main' }, { ...source, optionImages: { revision: 1, optionIds: [] } }, { ...source, quotationTarget: {} },
    { ...source, workspaceTarget: { ...source.workspaceTarget, extra: true } }, { ...source, workspaceTarget: { ...source.workspaceTarget, revision: 0 } },
    { ...source, workspaceTarget: { ...source.workspaceTarget, photoId: '__proto__' } }, { ...source, workspaceTarget: { ...source.workspaceTarget, digest: 'bad' } },
    { ...source, editorSource: { resultKey: 'owner/result.png', resultSha256: hash, documentSha256: hash, anchorPolicy: 'current-target-v1' } }]) assert.throws(() => m.validateFreeImageSource(value));
  assert.throws(() => m.validateFreeImageOptionIds(source, ['one']));
  const restored = { ...source, editorSource: { resultKey: 'owner/result.png', resultSha256: hash, documentSha256: hash } };
  assert.equal(m.validateFreeImageSource(restored), restored); assert.throws(() => m.freeImageApplyIdentity(restored));
  assert.match(m.freeImageApplyIdentity(restored, [], undefined, hash), /editDocumentSha256/u);
}));
test('full pool keeps its 150 limit while only the exact authorized saved photo may retain one nonpool current result', () => fixture(f => {
  const m = f.load('app/detail-workspace.ts'), pool = Array.from({ length: 150 }, (_, i) => `owner/p-${i}.png`), result = 'owner/free-image-workspace-product-' + hash + '-' + hash + '.png',
    photo = { id: 'one', originKey: pool[0], key: result, role: 'body' }, document = { format: 'detail-workspace-v1', photos: [photo], imageMargin: 0, generatedHtml: m.generateDetailWorkspaceHtml([photo], 0) };
  assert.equal(m.validateDetailWorkspaceDocument(document, 'owner', pool, undefined, { top: [], bottom: [] }, [photo]).photos[0].key, result);
  for (const authority of [[], [{ id: 'other', key: result }], [{ id: 'one', key: 'owner/unrelated.png' }]]) assert.throws(() => m.validateDetailWorkspaceDocument(document, 'owner', pool, undefined, undefined, authority));
  assert.throws(() => m.validateDetailWorkspaceDocument({ ...document, photos: [{ ...photo, originKey: result }] }, 'owner', pool, undefined, undefined, [photo]));
}));
