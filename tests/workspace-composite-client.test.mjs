import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { workspaceImageEditFixture, json, sha } from './helpers/workspace-image-edit-api.mjs';
import { loadComposite } from './helpers/detail-image-composite.mjs';
const companies = [{ companyCode: 'A01464742', companyName: '와이홉' }, { companyCode: 'A01526306', companyName: '유앤채' }];
const signal = () => new AbortController().signal;
const plain = value => JSON.parse(JSON.stringify(value));
async function fixture(company = companies[0], { blank = false, margin = 0 } = {}) {
  const f = await workspaceImageEditFixture(company);
  const source = (await json(await f.openImage())).source;
  const edit = await json(await f.applyImage(source));
  const savedBefore = await json(await f.read());
  const doc = f.document(savedBefore.workspace.document.photos.filter((_, index) => index !== 2), margin);
  let saved = await json(await f.put(await f.body(doc, savedBefore)));
  if (blank) {
    await f.set(f.targets.detailImages.linked.map(fieldKey => ({ optionId: f.optionId, fieldKey, value: '' })));
    saved = await json(await f.read());
  }
  const calls = [], previous = f.request;
  const request = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('/detail-workspace?')) return f.route[init.method ?? 'GET'](new Request('https://app.test' + url, init), f.context);
    return previous(url, init);
  };
  const runtime = loadComposite({ request }), client = runtime.load('app/detail-workspace-composite-client.ts');
  const selection = { productId: f.product.id, optionId: f.optionId, profileId: saved.view.categoryContext.profileId, view: saved.view };
  return { ...f, edit, saved, selection, calls, request, runtime, client };
}
for (const company of companies) test(`saved workspace renders current private pixels and commits all rows without intermediate quote writes (${company.companyCode})`, async () => {
  const f = await fixture(company, { margin: 25 });
  try {
    const before = f.tables(), files = new Map([...f.api.objects].map(([key, bytes]) => [key, sha(bytes)]));
    assert.ok(!f.saved.view.imageKeys.includes(f.edit.key));
    const prepared = await f.client.prepareDetailWorkspaceComposite(f.selection, f.saved, signal(), f.request);
    assert.deepEqual(f.tables(), before, 'preview reads only');
    assert.deepEqual(plain(prepared.keys), f.saved.workspace.document.photos.map(photo => photo.key));
    assert.equal(prepared.height, 3, '800px full bleed excludes editor padding and margin');
    assert.deepEqual(f.runtime.draws.map(row => row.x), [0, 0, 0]);
    assert.deepEqual(f.runtime.draws.map(row => row.width), [800, 800, 800]);
    const pixels = await sharp(Buffer.from(await prepared.output.arrayBuffer())).metadata(); assert.equal(pixels.width, 800); assert.equal(pixels.height, 3);
    assert.ok(f.calls.every(call => (call.init.method ?? 'GET') === 'GET'));
    const attempt = {}, saved = await f.client.applyDetailWorkspaceComposite(prepared, attempt, signal(), f.request);
    assert.equal(saved.revision, f.saved.view.revision + 1);
    assert.deepEqual(plain(saved.imageKeys), [...f.saved.view.imageKeys, f.edit.key, attempt.key]);
    assert.ok(saved.resolved.rows.some(row => row.included === false));
    for (const row of saved.resolved.rows) { assert.equal(row.fields[f.targets.detailImages.primary].value, attempt.key); assert.equal(row.fields[f.targets.detailHtml.primary].value, ''); }
    const after = f.tables();
    for (const [table, rows] of Object.entries(before)) if (!['products', 'product_quotation_fields'].includes(table)) assert.deepEqual(after[table], rows, table);
    for (const [key, hash] of files) assert.equal(sha(f.api.objects.get(key)), hash, key);
    const state = f.state(), backup = Object.values(state.detailSaveBackups).flat().at(-1);
    assert.deepEqual(backup.workspace, f.saved.workspace); assert.ok(JSON.stringify(backup.editor).includes('옵션별 수동 HTML'));
    assert.equal(f.calls.filter(call => call.url.includes('/detail-save') && call.init.method === 'POST').length, 1);
    assert.equal(f.calls.filter(call => call.init.method === 'PUT' || call.url.endsWith('/attachments') || call.url.includes('/detail-workspace/attach')).length, 0);
  } finally { f.api.close(); }
});
test('workspace rendering and atomic save work when the old selected quotation image is explicitly blank', async () => {
  const f = await fixture(companies[0], { blank: true });
  try {
    const prepared = await f.client.prepareDetailWorkspaceComposite(f.selection, f.saved, signal(), f.request), attempt = {};
    const saved = await f.client.applyDetailWorkspaceComposite(prepared, attempt, signal(), f.request);
    assert.equal(saved.overrides.options[f.optionId][f.targets.detailImages.primary], attempt.key);
  } finally { f.api.close(); }
});
for (const stage of ['upload', 'save']) test(`lost workspace ${stage} ACK recovers by reads and never duplicates a file or backup`, async () => {
  const f = await fixture(companies[1]);
  try {
    const prepared = await f.client.prepareDetailWorkspaceComposite(f.selection, f.saved, signal(), f.request), attempt = {}; let lost = true;
    const request = async (url, init = {}) => { const reply = await f.request(url, init); if (lost && init.method === 'POST' && (stage === 'upload' ? url === '/api/files' : url.includes('/detail-save'))) { lost = false; assert.equal(reply.status, stage === 'upload' ? 201 : 200); throw Error('lost workspace ACK'); } return reply; };
    await assert.rejects(f.client.applyDetailWorkspaceComposite(prepared, attempt, signal(), request), /lost workspace ACK/);
    const count = f.calls.length, recovered = await f.client.recoverDetailWorkspaceComposite(prepared, attempt, signal(), request);
    assert.ok(f.calls.slice(count).every(call => (call.init.method ?? 'GET') === 'GET'));
    assert.equal(recovered, stage === 'upload' ? 'ready' : 'completed');
    if (recovered === 'ready') await f.client.applyDetailWorkspaceComposite(prepared, attempt, signal(), request);
    assert.equal(f.calls.filter(call => call.url === '/api/files' && call.init.method === 'POST').length, 1);
    assert.equal(f.calls.filter(call => call.url.includes('/detail-save') && call.init.method === 'POST').length, 1);
  } finally { f.api.close(); }
});
test('a wrong workspace acknowledgement stays uncertain until the exact archived document is recovered', async () => {
  const f = await fixture();
  try {
    const prepared = await f.client.prepareDetailWorkspaceComposite(f.selection, f.saved, signal(), f.request), attempt = {};
    const request = async (url, init = {}) => { const reply = await f.request(url, init); if (url.includes('/detail-save') && init.method === 'POST' && reply.ok) { const body = await reply.json(); body.workspace.document.photos[1].originKey = body.workspace.document.photos[1].key; return Response.json(body); } return reply; };
    await assert.rejects(f.client.applyDetailWorkspaceComposite(prepared, attempt, signal(), request)); assert.equal(attempt.pending, 'save');
    assert.equal(await f.client.recoverDetailWorkspaceComposite(prepared, attempt, signal(), f.request), 'completed');
  } finally { f.api.close(); }
});
test('stale or altered saved workspace cannot allocate a composite file', async () => {
  const f = await fixture();
  try {
    const changed = structuredClone(f.saved); changed.workspace.digest = 'f'.repeat(64);
    await assert.rejects(f.client.prepareDetailWorkspaceComposite(f.selection, changed, signal(), f.request));
    const doc = f.document(f.saved.workspace.document.photos, 17); await json(await f.put(await f.body(doc, f.saved)));
    await assert.rejects(f.client.prepareDetailWorkspaceComposite(f.selection, f.saved, signal(), f.request));
    assert.ok(f.calls.every(call => (call.init.method ?? 'GET') === 'GET'));
  } finally { f.api.close(); }
});
test('latest-state escape reads the new parent and workspace without asserting an earlier save succeeded', async () => {
  const f = await fixture();
  try {
    await f.set([{ optionId: f.optionId, fieldKey: 'brand', value: '다른 검토자가 수정' }]);
    const before = f.tables(), latest = await f.client.readLatestDetailWorkspaceComposite(f.selection, signal(), f.request);
    assert.notEqual(latest.view.productVersion, f.selection.view.productVersion); assert.deepEqual(plain(latest.workspace), f.saved.workspace);
    assert.deepEqual(f.tables(), before); assert.ok(f.calls.every(call => (call.init.method ?? 'GET') === 'GET'));
  } finally { f.api.close(); }
});
