import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
const sha = text => createHash('sha256').update(text).digest('hex'), plain = value => JSON.parse(JSON.stringify(value));
async function fixture(run) {
  const h = mobileIntakeHarness();
  try {
    const m = h.load('app/detail-workspace.ts'), b = h.load('app/detail-workspace-banner-rebase.ts'), context = { source: 'profile', profileId: 'cat', categoryId: '80719', categoryPath: ['시험', '분류'] },
      photo = (id, key, role = 'body', originKey = key) => ({ id, originKey, key, role }), photos = [photo('old-top', 'owner/old-top.png', 'top'),
        photo('body', 'owner/current.png', 'body', 'owner/original.png'), photo('old-bottom', 'owner/old-bottom.png', 'bottom')],
      document = { format: 'detail-workspace-v1', photos, imageMargin: 17, generatedHtml: m.generateDetailWorkspaceHtml(photos, 17) },
      file = key => ({ key, sha256: sha(key), bytes: 100, width: 800, height: 1 }),
      value = { format: 'detail-workspace-record-v1', productId: 'product', optionId: 'option', context, company: { code: 'A01464742', name: '와이홉' },
        revision: 2, updatedAt: '2026-10-16T00:00:00.000Z', requestId: 'b'.repeat(64), document, files: m.detailWorkspaceFileKeys(document).map(file) },
      workspace = { ...value, digest: await m.detailWorkspaceDigest(value) }, roles = { top: ['owner/new-top.png'], bottom: ['owner/new-bottom.png'] },
      view = { productVersion: '2026-10-16T00:00:00.000Z', revision: 2, contentRevision: 1, optionRevision: 1, inputFingerprint: 'a'.repeat(64), categoryContext: context,
        imageKeys: ['owner/original.png', ...roles.top, ...roles.bottom], resolved: { rows: [{ optionId: 'option' }] } },
      proofs = doc => m.detailWorkspaceFileKeys(doc).map(file);
    await run({ m, b, view, workspace, roles, proofs });
  } finally { h.close(); }
}
test('rebase preserves exact body lineage/current result, margin and body order while replacing only protected rows', () => fixture(async ({ b, view, workspace, roles, proofs }) => {
  const before = plain(workspace), document = b.buildDetailWorkspaceBannerDocument(workspace, roles), preview = await b.createDetailWorkspaceBannerPreview(view, workspace, roles, proofs(document));
  assert.deepEqual(plain(document.photos.filter(photo => photo.role === 'body')), workspace.document.photos.filter(photo => photo.role === 'body'));
  assert.deepEqual(plain(document.photos.map(photo => photo.key)), [roles.top[0], 'owner/current.png', roles.bottom[0]]); assert.equal(document.imageMargin, 17);
  assert.match(document.generatedHtml, /width:760px/); assert.match(document.generatedHtml, /17px/); assert.deepEqual(plain(workspace), before);
  const again = await b.createDetailWorkspaceBannerPreview(view, workspace, roles, proofs(document)); assert.deepEqual(preview, again);
  preview.document.photos[1].key = 'local'; assert.deepEqual(plain(workspace), before);
}));
test('unchanged same-role banners keep stable IDs and generated IDs cannot collide with saved body IDs', () => fixture(async ({ b, m, view, workspace, proofs }) => {
  const sameRoles = { top: ['owner/old-top.png'], bottom: ['owner/old-bottom.png'] }, same = b.buildDetailWorkspaceBannerDocument(workspace, sameRoles);
  assert.deepEqual(plain(same), workspace.document);
  const record = plain(workspace); record.document.photos[1].id = 'banner-rebase-3-top-0'; record.document.generatedHtml = m.generateDetailWorkspaceHtml(record.document.photos, record.document.imageMargin);
  const { digest: ignored, ...value } = record; void ignored; record.digest = await m.detailWorkspaceDigest(value);
  const roles = { top: ['owner/new-top.png'], bottom: [] }, document = b.buildDetailWorkspaceBannerDocument(record, roles);
  assert.equal(document.photos[0].id, 'banner-rebase-3-top-0-1'); assert.equal(document.photos[1].id, 'banner-rebase-3-top-0');
  assert.equal((await b.createDetailWorkspaceBannerPreview(view, record, roles, proofs(document))).document.photos[1].originKey, 'owner/original.png');
}));
test('candidate hash binds exact actual file bytes metadata, source clocks, role order and old workspace digest', () => fixture(async ({ b, view, workspace, roles, proofs }) => {
  const document = b.buildDetailWorkspaceBannerDocument(workspace, roles), files = proofs(document), before = await b.createDetailWorkspaceBannerPreview(view, workspace, roles, files);
  for (const field of ['sha256', 'bytes', 'width', 'height']) {
    const changed = plain(files); changed[0][field] = field === 'sha256' ? '0'.repeat(64) : changed[0][field] + 1;
    assert.notEqual((await b.createDetailWorkspaceBannerPreview(view, workspace, roles, changed)).requestId, before.requestId, field);
  }
  assert.notEqual((await b.createDetailWorkspaceBannerPreview({ ...view, revision: 3 }, workspace, roles, files)).requestId, before.requestId);
  await assert.rejects(b.createDetailWorkspaceBannerPreview(view, workspace, roles, files.slice(1)));
  await assert.rejects(b.createDetailWorkspaceBannerPreview(view, workspace, roles, [...files].reverse()));
  await assert.rejects(b.createDetailWorkspaceBannerPreview(view, { ...workspace, digest: '0'.repeat(64) }, roles, files));
}));
test('body/banner collision, ambiguous or unowned roles and more than150 candidate positions are rejected', () => fixture(async ({ b, m, view, workspace, roles, proofs }) => {
  assert.throws(() => b.buildDetailWorkspaceBannerDocument(workspace, { top: ['owner/current.png'], bottom: [] }), /본문/);
  for (const changed of [{ top: roles.top, bottom: roles.top }, { top: ['other/banner.png'], bottom: [] }, { top: ['owner/unpooled.png'], bottom: [] }]) {
    await assert.rejects(b.createDetailWorkspaceBannerPreview(view, workspace, changed, []));
  }
  const record = plain(workspace); record.document.photos = Array.from({ length: 150 }, (_, index) => ({ id: 'body-' + index, originKey: 'owner/original.png', key: 'owner/current.png', role: 'body' }));
  record.document.generatedHtml = m.generateDetailWorkspaceHtml(record.document.photos, record.document.imageMargin); record.files = proofs(record.document);
  const { digest: ignored, ...value } = record; void ignored; record.digest = await m.detailWorkspaceDigest(value);
  assert.throws(() => b.buildDetailWorkspaceBannerDocument(record, roles));
}));
test('empty current banners remove only old protected rows and malformed file totals fail the bounded model', () => fixture(async ({ b, view, workspace, proofs }) => {
  const roles = { top: [], bottom: [] }, doc = b.buildDetailWorkspaceBannerDocument(workspace, roles), preview = await b.createDetailWorkspaceBannerPreview(view, workspace, roles, proofs(doc));
  assert.equal(preview.document.photos.length, 1); assert.deepEqual(plain(preview.document.photos[0]), workspace.document.photos[1]);
  const bad = proofs(doc); bad[0].bytes = 11 * 1024 * 1024; await assert.rejects(b.createDetailWorkspaceBannerPreview(view, workspace, roles, bad));
}));
