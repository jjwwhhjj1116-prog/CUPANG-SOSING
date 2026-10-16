import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { detailWorkspaceFixture, json } from './helpers/detail-workspace-api.mjs';
import { cropClientFixture } from './helpers/free-image-crop.mjs';
import { runtime, plain } from './helpers/detail-workspace.mjs';
const companies = [{ companyCode: 'A01464742', companyName: '와이홉' }, { companyCode: 'A01526306', companyName: '유앤채' }];
const signal = () => new AbortController().signal;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(company = companies[0]) {
  const f = await detailWorkspaceFixture(company), context = f.context, route = f.api.load('app/api/products/[id]/workspace-image-text/route.ts'), calls = [];
  f.api.objects.set(f.selectedKeys[1], await sharp({ create: { width: 320, height: 240, channels: 4, background: '#2468ac' } }).png().toBuffer());
  const saved = await json(await f.put(await f.body())), photo = saved.workspace.document.photos[1];
  const selection = { productId: f.product.id, optionId: f.optionId, profileId: saved.view.categoryContext.profileId, view: saved.view };
  const target = { kind: 'detail-workspace', profileId: selection.profileId ?? null, optionId: selection.optionId, photoId: photo.id, revision: saved.workspace.revision, digest: saved.workspace.digest };
  const editor = { selection, saved, target }, proof = saved.workspace.files.find(file => file.key === photo.key), canvas = cropClientFixture({ imageWidth: proof.width, imageHeight: proof.height });
  const request = async (url, init = {}) => { calls.push({ url, init }); if (url.includes('/workspace-image-text')) return route[init.method ?? 'GET'](new Request('https://app.test' + url, init), context); return f.request(url, init); };
  const r = runtime(request, { '@/app/free-image-translation-client': canvas.client }), client = r.load('app/detail-workspace-image-client.ts');
  return { ...f, saved, photo, editor, canvas, client, request, calls, r };
}
function rendered(f, image) { return f.canvas.client.renderFreeImageTranslation(image, [f.canvas.region('manual-1', { x: 2, y: 3, width: 15, height: 8 }, '직접 검토한 작업 사진')], signal(), [], { x: 1, y: 2, width: 20, height: 12 }, 'en'); }

for (const company of companies) test(`real workspace transport opens current pixels, stores editable PNG outside the product pool, and reopens sealed original/document (${company.companyCode})`, async () => {
  const f = await fixture(company);
  try {
    const before = f.tables(), originalFiles = new Map([...f.api.objects].map(([key, bytes]) => [key, digest(bytes)]));
    const image = await f.client.readDetailWorkspaceImage(f.editor, signal()); assert.equal(image.source.sourceKey, f.photo.key); assert.equal(image.source.quotationTarget, undefined);
    const output = await rendered(f, image), result = await f.client.applyDetailWorkspaceImage(output, f.editor, signal());
    assert.equal(result.applied, true); assert.ok(result.key.startsWith(`owner/free-image-workspace-${f.product.id}-`)); assert.equal(result.workspace.revision, f.saved.workspace.revision + 1);
    assert.equal(result.workspace.document.photos[1].originKey, f.photo.originKey); assert.equal(result.workspace.document.photos[1].key, result.key); assert.deepEqual(plain(result.view), plain(f.saved.view));
    for (const [table, rows] of Object.entries(before)) if (table !== 'product_detail_workspaces') assert.deepEqual(f.tables()[table], rows, table);
    for (const [key, sha] of originalFiles) assert.equal(digest(f.api.objects.get(key)), sha, key);
    assert.equal(f.api.objects.size, originalFiles.size + 2); assert.ok(!result.view.imageKeys.includes(result.key));
    const current = { selection: f.editor.selection, saved: { view: result.view, workspace: result.workspace, roles: result.roles }, target: { ...f.editor.target, revision: result.workspace.revision, digest: result.workspace.digest } };
    const reopened = await f.client.readDetailWorkspaceImage(current, signal()); assert.equal(reopened.source.sourceKey, f.photo.key); assert.equal(reopened.source.editorSource.resultKey, result.key);
    assert.equal(reopened.editDocument.sourceLanguage, 'en'); assert.equal(reopened.editDocument.regions[0].translated, '직접 검토한 작업 사진'); assert.deepEqual(plain(reopened.editDocument.crop), plain(output.crop));
    assert.equal(reopened.width, image.width); assert.equal(reopened.height, image.height); assert.equal(result.workspace.files.find(file => file.key === result.key).width, 20);
    assert.equal(f.calls.filter(call => call.init.method === 'POST' && call.init.body instanceof FormData).length, 1); assert.ok(f.calls.every(call => !call.url.includes('/image-text?') && !call.url.includes('/quotation-fields')));
  } finally { f.api.close(); }
});

test('stale target revisions, digests, profiles and a wrong stable photo never read source pixels or write', async () => {
  const f = await fixture();
  try {
    for (const patch of [{ revision: 4 }, { digest: 'f'.repeat(64) }, { profileId: 'another' }, { photoId: 'another' }]) {
      const changed = { ...f.editor, target: { ...f.editor.target, ...patch } }, count = f.calls.length; await assert.rejects(f.client.readDetailWorkspaceImage(changed, signal())); assert.equal(f.calls.length, count);
    }
    const calls = [], request = async (url, init) => { calls.push(url); const response = await f.request(url, init); if (url.includes('/workspace-image-text?')) { const body = await response.json(); body.source.workspaceTarget.revision++; return Response.json(body); } return response; };
    await assert.rejects(f.client.readDetailWorkspaceImage(f.editor, signal(), request)); assert.equal(calls.length, 1);
  } finally { f.api.close(); }
});

test('workspace storage ACK loss uses JSON recovery, never a second multipart apply, and legacy apply refuses the target', async () => {
  const f = await fixture(companies[1]); let lost = true;
  try {
    const image = await f.client.readDetailWorkspaceImage(f.editor, signal()), output = await rendered(f, image);
    const request = async (url, init) => { const response = await f.request(url, init); if (init.method === 'POST' && init.body instanceof FormData && lost) { lost = false; assert.equal(response.status, 200); return Response.json({ error: 'workspace ACK lost' }, { status: 503 }); } return response; };
    await assert.rejects(f.client.applyDetailWorkspaceImage(output, f.editor, signal(), request), error => error.uncertain === true);
    const reply = await f.client.recoverDetailWorkspaceImage(output, f.editor, signal(), request); assert.equal(reply.applied, true);
    assert.equal(f.calls.filter(call => call.init.body instanceof FormData).length, 1); assert.equal(f.calls.filter(call => typeof call.init.body === 'string' && JSON.parse(call.init.body).action === 'recover').length, 1);
    const count = f.calls.length; await assert.rejects(f.canvas.client.applyFreeImageTranslation(output, signal(), request), /작업 사진/); assert.equal(f.calls.length, count);
  } finally { f.api.close(); }
});

test('unapplied recovery authorizes no write and malformed documents or reply metadata cannot be accepted', async () => {
  const f = await fixture();
  try {
    const image = await f.client.readDetailWorkspaceImage(f.editor, signal()), output = await rendered(f, image), before = f.tables();
    const missing = await f.client.recoverDetailWorkspaceImage(output, f.editor, signal()); assert.equal(missing.applied, false); assert.deepEqual(f.tables(), before);
    for (const kind of ['crop', 'document', 'dimensions']) {
      const broken = { ...output, editDocument: plain(output.editDocument) }; if (kind === 'crop') broken.editDocument.crop.x++; if (kind === 'document') broken.editDocument.regions[0].unexpected = true; if (kind === 'dimensions') broken.width++;
      const count = f.calls.length; await assert.rejects(f.client.applyDetailWorkspaceImage(broken, f.editor, signal())); assert.equal(f.calls.length, count, kind);
    }
    const request = async (url, init) => { const response = await f.request(url, init); const body = await response.json(); if (body.applied === true) body.editDocumentSha256 = '0'.repeat(64); return Response.json(body, { status: response.status }); };
    await assert.rejects(f.client.applyDetailWorkspaceImage(output, f.editor, signal(), request), error => error.uncertain === true);
  } finally { f.api.close(); }
});

test('workspace-only file authority supports local order edits but never arbitrary new rows, origin changes or read-only adoption before attachment', async () => {
  const f = await fixture();
  try {
    const image = await f.client.readDetailWorkspaceImage(f.editor, signal()), output = await rendered(f, image), reply = await f.client.applyDetailWorkspaceImage(output, f.editor, signal()), saved = { view: reply.view, workspace: reply.workspace, roles: reply.roles };
    const client = f.r.client, document = plain(reply.workspace.document); [document.photos[1], document.photos[2]] = [document.photos[2], document.photos[1]]; document.generatedHtml = f.model.generateDetailWorkspaceHtml(document.photos, 0);
    const input = await client.createDetailWorkspaceSave(f.editor.selection, saved, document); assert.equal(input.document.photos[2].key, reply.key);
    const forged = plain(document); forged.photos[2].id = 'new-row'; forged.generatedHtml = f.model.generateDetailWorkspaceHtml(forged.photos, 0); await assert.rejects(client.createDetailWorkspaceSave(f.editor.selection, saved, forged));
    const before = f.calls.length; await assert.rejects(client.prepareDetailWorkspaceAdoption(f.editor.selection, saved, signal()), /상품 이미지/); assert.equal(f.calls.length, before);
  } finally { f.api.close(); }
});

test('abort before apply dispatch and aborted pixel reads never write workspace or product data', async () => {
  const f = await fixture();
  try {
    const controller = new AbortController(); controller.abort(); const count = f.calls.length;
    await assert.rejects(f.client.readDetailWorkspaceImage(f.editor, controller.signal)); assert.equal(f.calls.length, count);
    const image = await f.client.readDetailWorkspaceImage(f.editor, signal()), output = await rendered(f, image), before = f.tables(); await assert.rejects(f.client.applyDetailWorkspaceImage(output, f.editor, controller.signal)); assert.deepEqual(f.tables(), before);
  } finally { f.api.close(); }
});

test('after an old image command loses its binding, explicit latest-editor GET preserves current manual HTML without classifying or repeating that command', async () => {
  const f = await fixture();
  try {
    const image = await f.client.readDetailWorkspaceImage(f.editor, signal()), output = await rendered(f, image), stored = await f.client.applyDetailWorkspaceImage(output, f.editor, signal());
    await f.set(f.targets.detailHtml.linked.map(fieldKey => ({ optionId: f.optionId, fieldKey, value: ' \r\n외부에서 저장한 수동 HTML ' })));
    await assert.rejects(f.client.recoverDetailWorkspaceImage(output, f.editor, signal()));
    const before = f.tables(), count = f.calls.length, latest = await f.client.readLatestDetailWorkspaceForEditor(f.editor, signal());
    assert.equal(f.calls.length, count + 1); assert.equal(f.calls.at(-1).init.method ?? 'GET', 'GET'); assert.deepEqual(f.tables(), before);
    assert.equal(latest.workspace.document.photos[1].key, stored.key); assert.ok(latest.view.revision > f.editor.selection.view.revision);
    for (const field of f.targets.detailHtml.linked) assert.equal(latest.view.overrides.options[f.optionId][field], ' \r\n외부에서 저장한 수동 HTML ');
    assert.equal(f.calls.filter(call => call.init.body instanceof FormData).length, 1);
  } finally { f.api.close(); }
});
