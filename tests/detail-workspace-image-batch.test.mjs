import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { detailWorkspaceFixture, json } from './helpers/detail-workspace-api.mjs';
import { cropClientFixture } from './helpers/free-image-crop.mjs';
import { runtime, plain } from './helpers/detail-workspace.mjs';
const signal = () => new AbortController().signal;
async function fixture({ bodyCount } = {}) {
  const f = await detailWorkspaceFixture({ companyCode: 'A01464742', companyName: '와이홉' });
  for (const key of f.selectedKeys) f.api.objects.set(key, await sharp({ create: { width: 320, height: 240, channels: 4, background: '#2468ac' } }).png().toBuffer());
  const photos = f.document().photos;
  const document = bodyCount ? f.document([photos[0], ...Array.from({ length: bodyCount }, (_, index) => ({ ...photos[1], id: 'body-' + index })), photos.at(-1)]) : f.document();
  const saved = await json(await f.put(await f.body(document))), selection = { productId: f.product.id, optionId: f.optionId, profileId: saved.view.categoryContext.profileId, view: saved.view };
  const route = f.api.load('app/api/products/[id]/workspace-image-text/route.ts'), calls = [], canvas = cropClientFixture({ imageWidth: 320, imageHeight: 240 });
  let intercept = null;
  const request = async (url, init = {}) => {
    calls.push({ url, init });
    if (intercept) { const value = await intercept(url, init); if (value !== undefined) return value; }
    if (url.includes('/workspace-image-text')) return route[init.method ?? 'GET'](new Request('https://app.test' + url, init), f.context);
    if (url.includes('/detail-workspace?')) return f.route[init.method ?? 'GET'](new Request('https://app.test' + url, init), f.context);
    return f.request(url, init);
  };
  const r = runtime(request, { '@/app/free-image-translation-client': canvas.client }), batch = r.load('app/detail-workspace-image-batch.ts');
  const deps = { fetcher: request, recognize: async (_image, language) => [canvas.region('line', { x: 2, y: 3, width: 100, height: 20 }, '', { text: language === 'zh' ? '中文' : 'English', selected: true })],
    translate: async (_source, _language, regions) => ({ regions: regions.map(region => ({ id: region.id, original: region.text, translated: '검토 문구', issue: null })), warnings: [] }) };
  return { ...f, saved, selection, batch, deps, canvas, calls, prepare: () => batch.prepareDetailWorkspaceImageBatch({ selection, saved, language: 'zh' }, signal(), () => {}, deps), intercept(fn) { intercept = fn; } };
}
 test('preparation reads only stored BODY photos without writing quotation or workspace', async () => {
  const f = await fixture(); try {
   const before = f.tables(), prepared = await f.prepare(), body = f.saved.workspace.document.photos.filter(photo => photo.role === 'body');
   assert.deepEqual(plain(prepared.items.map(item => item.photoId)), body.map(photo => photo.id));
   assert.ok(prepared.items.length >= 2); assert.ok(prepared.items.every(item => item.status === 'ready' && item.rendered.editDocument));
   assert.deepEqual(f.tables(), before); assert.ok(f.calls.every(call => (call.init.method ?? 'GET') === 'GET'));
   assert.ok(!f.calls.some(call => call.url.includes('/quotation-fields') || call.url.includes('/image-text?')));
  } finally { f.api.close(); }
 });
 test('two explicitly reviewed BODY saves use exact fresh revision while banners/order/manual quote stay exact', async () => {
  const f = await fixture(); try {
   const before = f.tables(), prepared = await f.prepare(), ids = prepared.items.map(item => item.photoId);
   let next = await f.batch.applyDetailWorkspaceBatchResult(prepared, ids[0], signal(), () => {}, f.deps);
   next = await f.batch.applyDetailWorkspaceBatchResult(next, ids[1], signal(), () => {}, f.deps);
   assert.equal(next.saved.workspace.revision, f.saved.workspace.revision + 2);
   assert.deepEqual(plain(next.saved.view), plain(f.saved.view));
   assert.deepEqual(next.saved.workspace.document.photos.map(photo => [photo.id, photo.originKey, photo.role]), f.saved.workspace.document.photos.map(photo => [photo.id, photo.originKey, photo.role]));
   for (const photo of f.saved.workspace.document.photos.filter(photo => photo.role !== 'body')) assert.deepEqual(plain(next.saved.workspace.document.photos.find(row => row.id === photo.id)), photo);
   const uploads = f.calls.filter(call => call.init.body instanceof FormData);
   assert.deepEqual(uploads.map(call => JSON.parse(call.init.body.get('source')).workspaceTarget.revision), [f.saved.workspace.revision, f.saved.workspace.revision + 1]);
   for (const [table, rows] of Object.entries(before)) if (table !== 'product_detail_workspaces') assert.deepEqual(f.tables()[table], rows, table);
  } finally { f.api.close(); }
 });
 for (const kind of ['order', 'origin', 'banner', 'manual', 'sha']) test(`external ${kind} change fences an old BODY preview before upload`, async () => {
  const f = await fixture(); try {
   const prepared = await f.prepare();
   if (kind === 'manual') await f.set(f.targets.detailHtml.linked.map(fieldKey => ({ optionId: f.optionId, fieldKey, value: '<p>new manual HTML</p>' })));
   else if (kind === 'sha') f.api.objects.set(prepared.items[0].sourceKey, await sharp({ create: { width: 320, height: 240, channels: 4, background: '#000000' } }).png().toBuffer());
   else { const document = plain(f.saved.workspace.document); if (kind === 'order') [document.photos[1], document.photos[2]] = [document.photos[2], document.photos[1]];
    if (kind === 'origin') document.photos[1] = { ...document.photos[2], id: 'replacement-photo' };
    if (kind === 'banner') document.imageMargin = 3;
    document.generatedHtml = f.model.generateDetailWorkspaceHtml(document.photos, document.imageMargin);
    const body = await f.body(document, f.saved); await json(await f.put(body));
   }
   await assert.rejects(f.batch.applyDetailWorkspaceBatchResult(prepared, prepared.items[0].photoId, signal(), () => {}, f.deps));
   assert.equal(f.calls.filter(call => call.init.body instanceof FormData).length, 0);
  } finally { f.api.close(); }
 });
 test('lost apply ACK retains exact attempt, fences later photos, and recovers without multipart replay', async () => {
  const f = await fixture(); try {
   const prepared = await f.prepare(); let latest = prepared;
   f.intercept(async (url, init) => { if (!(init.body instanceof FormData)) return; const route = f.api.load('app/api/products/[id]/workspace-image-text/route.ts'); const response = await route.POST(new Request('https://app.test' + url, init), f.context); assert.equal(response.status, 200); return Response.json({ error: 'ACK lost' }, { status: 503 }); });
   await assert.rejects(f.batch.applyDetailWorkspaceBatchResult(prepared, prepared.items[0].photoId, signal(), next => { latest = next; }, f.deps));
   assert.equal(latest.items[0].status, 'uncertain'); assert.ok(latest.items[0].attempt.image === latest.items[0].rendered || latest.items[0].attempt.image.output === latest.items[0].rendered.output);
   await assert.rejects(f.batch.applyDetailWorkspaceBatchResult(latest, prepared.items[1].photoId, signal(), () => {}, f.deps));
   const recovered = await f.batch.recoverDetailWorkspaceBatchResult(latest, signal(), () => {}, f.deps);
   assert.equal(recovered.items[0].status, 'applied'); assert.equal(recovered.items[1].status, 'ready');
   assert.equal(f.calls.filter(call => call.init.body instanceof FormData).length, 1);
   assert.equal(f.calls.filter(call => typeof call.init.body === 'string' && JSON.parse(call.init.body).action === 'recover').length, 1);
  } finally { f.api.close(); }
 });

test('preview retention stops at 30MB across many stored BODY rows without any write', async () => {
 const f = await fixture({ bodyCount: 4 }); try {
  const before = f.tables();
  const batch = await f.batch.prepareDetailWorkspaceImageBatch({ selection: f.selection, saved: f.saved, language: 'zh' }, signal(), () => {}, { ...f.deps,
   render: async (...args) => ({ ...await f.canvas.client.renderFreeImageTranslation(...args), output: new Blob([new Uint8Array(9 * 1024 * 1024)], { type: 'image/png' }) }) });
  assert.deepEqual(batch.items.map(item => item.status), ['ready', 'ready', 'ready', 'failed']);
  assert.equal(batch.items.reduce((bytes, item) => bytes + (item.rendered?.output.size ?? 0), 0), 27 * 1024 * 1024);
  assert.deepEqual(f.tables(), before); assert.equal(f.calls.filter(call => call.init.body instanceof FormData).length, 0);
 } finally { f.api.close(); }
});

for (const kind of ['manual', 'crop-manual-brush']) test(`an existing ${kind} BODY edit remains untouched and only unedited BODY photos enter batch OCR/render`, async () => {
 const f = await fixture(); try {
  const client = runtime(f.deps.fetcher, { '@/app/free-image-translation-client': f.canvas.client }).load('app/detail-workspace-image-client.ts');
  const body = f.saved.workspace.document.photos.filter(photo => photo.role === 'body'), editedId = body[0].id, untouchedIds = body.slice(1).map(photo => photo.id);
  const context = saved => ({ selection: f.selection, saved, target: { kind: 'detail-workspace', profileId: f.selection.profileId, optionId: f.selection.optionId,
    photoId: editedId, revision: saved.workspace.revision, digest: saved.workspace.digest } });
  const image = await client.readDetailWorkspaceImage(context(f.saved), signal());
  const regions = [{ ...f.canvas.region('saved-manual', { x: 20, y: 20, width: 140, height: 40 }, '수동 문구 유지'), text: '原文', translationProvenance: 'manual',
    fontFamily: 'serif', bold: true, italic: true, textAlign: 'right', lineHeight: 1.7 }];
  if (kind === 'crop-manual-brush') {
    const drawing = f.canvas.brush.createFreeImageBrush(4, [{ x: 40, y: 80 }, { x: 70, y: 90 }], 320, 240);
    regions.push({ ...f.canvas.region('saved-brush', drawing.box, ''), erase: true, brush: drawing.brush });
  }
  const crop = kind === 'crop-manual-brush' ? { x: 10, y: 12, width: 200, height: 150 } : undefined;
  const rendered = await f.canvas.client.renderFreeImageTranslation(image, regions, signal(), [], crop, 'zh');
  const stored = await client.applyDetailWorkspaceImage(rendered, context(f.saved), signal()), saved = { view: stored.view, workspace: stored.workspace, roles: stored.roles };
  const document = plain(rendered.editDocument), before = f.tables(), objects = new Map([...f.api.objects].map(([key, bytes]) => [key, Buffer.from(bytes)])), start = f.calls.length;
  const stages = [], deps = { ...f.deps,
    recognize: async (...args) => { stages.push(['ocr', args[0].source.workspaceTarget.photoId]); return f.deps.recognize(...args); },
    translate: async (...args) => { stages.push(['translate', args[0].workspaceTarget.photoId]); return f.deps.translate(...args); },
    render: async (...args) => { stages.push(['render', args[0].source.workspaceTarget.photoId]); return f.canvas.client.renderFreeImageTranslation(...args); } };
  let batch = await f.batch.prepareDetailWorkspaceImageBatch({ selection: f.selection, saved, language: 'zh' }, signal(), () => {}, deps);
  assert.deepEqual(stages.filter(([, id]) => id === editedId), [], 'an editable saved photo must never reach OCR, translation or rendering');
  for (const stage of ['ocr', 'translate', 'render']) assert.deepEqual(stages.filter(([name]) => name === stage).map(([, id]) => id), untouchedIds);
  const skipped = batch.items.find(item => item.photoId === editedId);
  assert.equal(skipped.status, 'failed'); assert.equal(skipped.rendered, undefined); assert.match(skipped.message, /개별.*편집/u);
  assert.ok(batch.items.filter(item => item.photoId !== editedId).every(item => item.status === 'ready'));
  assert.deepEqual(f.tables(), before); assert.ok(f.calls.slice(start).every(call => (call.init.method ?? 'GET') === 'GET'));
  for (const [key, bytes] of objects) assert.deepEqual(Buffer.from(f.api.objects.get(key)), bytes, key);
  await assert.rejects(f.batch.applyDetailWorkspaceBatchResult(batch, editedId, signal(), () => {}, f.deps));
  batch = await f.batch.applyDetailWorkspaceBatchResult(batch, untouchedIds[0], signal(), () => {}, f.deps);
  const reopened = await client.readDetailWorkspaceImage(context(batch.saved), signal());
  assert.deepEqual(plain(reopened.editDocument), document); assert.equal(reopened.source.editorSource.resultKey, stored.key);
  if (crop) { assert.deepEqual([rendered.width, rendered.height], [200, 150]); assert.deepEqual(plain(reopened.editDocument.crop), { ...crop, sourceWidth: 320, sourceHeight: 240 }); }
  assert.deepEqual(plain(batch.saved.workspace.document.photos.find(photo => photo.id === editedId)), plain(saved.workspace.document.photos.find(photo => photo.id === editedId)));
 } finally { f.api.close(); }
});
