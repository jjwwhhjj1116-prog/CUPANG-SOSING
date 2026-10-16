import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { detailWorkspaceBannerRebaseFixture } from './helpers/detail-workspace-banner-rebase-api.mjs';
import { runtime, plain } from './helpers/detail-workspace.mjs';
const companies = [{ companyCode: 'A01464742', companyName: '와이홉' }, { companyCode: 'A01526306', companyName: '유앤채' }];
const signal = () => new AbortController().signal;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(company = companies[0]) {
  const f = await detailWorkspaceBannerRebaseFixture(company), calls = [];
  const request = async (url, init = {}) => { calls.push({ url, init }); return f.request(url, init); };
  const client = runtime(request).load('app/detail-workspace-banner-rebase-client.ts');
  return { ...f, calls, request, client };
}
for (const company of companies) test(`explicit banner preview preserves sealed body edits and updates only the workspace (${company.companyCode})`, async () => {
  const f = await fixture(company);
  try {
    assert.equal((await f.read()).status, 409);
    const before = f.tables(), files = new Map([...f.api.objects].map(([key, bytes]) => [key, sha(bytes)]));
    const preview = await f.client.readDetailWorkspaceBannerRebase(f.selection, signal(), f.request);
    assert.deepEqual(f.tables(), before); assert.ok(f.calls.every(call => (call.init.method ?? 'GET') === 'GET'));
    assert.deepEqual(plain(preview.document.photos.filter(photo => photo.role === 'body')), f.oldWorkspace.document.photos.filter(photo => photo.role === 'body'));
    const attempt = {}, saved = await f.client.applyDetailWorkspaceBannerRebase(f.selection, preview, attempt, signal(), f.request);
    assert.equal(saved.workspace.revision, f.oldWorkspace.revision + 1); assert.equal(saved.workspace.requestId, preview.requestId);
    assert.deepEqual(plain(saved.workspace.document), plain(preview.document)); assert.deepEqual(plain(saved.view), f.selection.view);
    const after = f.tables(); for (const [table, rows] of Object.entries(before)) if (table !== 'product_detail_workspaces') assert.deepEqual(after[table], rows, table);
    assert.equal(files.size, f.api.objects.size); for (const [key, hash] of files) assert.equal(sha(f.api.objects.get(key)), hash);
    assert.equal((await f.read()).status, 200);
    const count = f.calls.filter(call => call.init.method === 'PUT').length;
    assert.deepEqual(plain(await f.client.applyDetailWorkspaceBannerRebase(f.selection, preview, attempt, signal(), f.request)), plain(saved));
    assert.equal(f.calls.filter(call => call.init.method === 'PUT').length, count);
  } finally { f.api.close(); }
});
test('lost banner replacement ACK is recovered using the normal read without repeating PUT', async () => {
  const f = await fixture(companies[1]);
  try {
    const preview = await f.client.readDetailWorkspaceBannerRebase(f.selection, signal(), f.request), attempt = {}; let lost = true;
    const request = async (url, init = {}) => { const response = await f.request(url, init); if (lost && init.method === 'PUT') { lost = false; assert.equal(response.status, 200); throw Error('lost banner ACK'); } return response; };
    await assert.rejects(f.client.applyDetailWorkspaceBannerRebase(f.selection, preview, attempt, signal(), request), /lost banner ACK/); assert.equal(attempt.pending, true);
    const count = f.calls.length; assert.equal(await f.client.recoverDetailWorkspaceBannerRebase(f.selection, preview, attempt, signal(), request), 'completed');
    assert.ok(f.calls.slice(count).every(call => (call.init.method ?? 'GET') === 'GET')); assert.ok(attempt.completed);
    assert.equal(f.calls.filter(call => call.init.method === 'PUT').length, 1);
  } finally { f.api.close(); }
});
test('an uncommitted banner request checks normal 409 then the identical preview before explicit retry', async () => {
  const f = await fixture();
  try {
    const preview = await f.client.readDetailWorkspaceBannerRebase(f.selection, signal(), f.request), attempt = {}; let miss = true;
    const request = async (url, init = {}) => { if (miss && init.method === 'PUT') { miss = false; return Response.json({ error: 'no dispatch' }, { status: 503 }); } return f.request(url, init); };
    await assert.rejects(f.client.applyDetailWorkspaceBannerRebase(f.selection, preview, attempt, signal(), request), /no dispatch/);
    const count = f.calls.length; assert.equal(await f.client.recoverDetailWorkspaceBannerRebase(f.selection, preview, attempt, signal(), request), 'ready');
    assert.equal(attempt.retryReady, true); assert.ok(f.calls.slice(count).every(call => (call.init.method ?? 'GET') === 'GET'));
    const saved = await f.client.applyDetailWorkspaceBannerRebase(f.selection, preview, attempt, signal(), request); assert.equal(saved.workspace.revision, preview.workspace.revision + 1);
    assert.equal(f.calls.filter(call => call.init.method === 'PUT').length, 1);
  } finally { f.api.close(); }
});
test('a forged preview cannot allocate a write or change a preserved body identity', async () => {
  const f = await fixture();
  try {
    const preview = await f.client.readDetailWorkspaceBannerRebase(f.selection, signal(), f.request);
    for (const mutate of [p => p.document.photos.find(photo => photo.role === 'body').id = 'different', p => p.files[0].sha256 = 'f'.repeat(64), p => p.requestId = 'f'.repeat(64), p => p.roles.top.reverse().push(p.roles.bottom[0])]) {
      const changed = structuredClone(preview); mutate(changed); const count = f.calls.length;
      await assert.rejects(f.client.applyDetailWorkspaceBannerRebase(f.selection, changed, {}, signal(), f.request)); assert.equal(f.calls.length, count);
    }
  } finally { f.api.close(); }
});
test('a malformed successful ACK remains uncertain and exact read recovery verifies the committed record', async () => {
  const f = await fixture();
  try {
    const preview = await f.client.readDetailWorkspaceBannerRebase(f.selection, signal(), f.request), attempt = {};
    const request = async (url, init = {}) => { const response = await f.request(url, init); if (init.method === 'PUT' && response.ok) { const body = await response.json(); body.workspace.document.imageMargin++; return Response.json(body); } return response; };
    await assert.rejects(f.client.applyDetailWorkspaceBannerRebase(f.selection, preview, attempt, signal(), request)); assert.equal(attempt.pending, true);
    assert.equal(await f.client.recoverDetailWorkspaceBannerRebase(f.selection, preview, attempt, signal(), f.request), 'completed');
  } finally { f.api.close(); }
});
test('latest preview supersedes an old uncertain attempt through reads without claiming it committed', async () => {
  const f = await fixture();
  try {
    const preview = await f.client.readDetailWorkspaceBannerRebase(f.selection, signal(), f.request), attempt = {};
    const request = async (url, init = {}) => init.method === 'PUT' ? Response.json({ error: 'no dispatch' }, { status: 503 }) : f.request(url, init);
    await assert.rejects(f.client.applyDetailWorkspaceBannerRebase(f.selection, preview, attempt, signal(), request));
    await f.set([{ optionId: f.optionId, fieldKey: 'brand', value: '다른 검토자가 수정' }]);
    await assert.rejects(f.client.recoverDetailWorkspaceBannerRebase(f.selection, preview, attempt, signal(), f.request));
    const before = f.tables(), count = f.calls.length, latest = await f.client.readLatestDetailWorkspaceBannerRebase(f.selection, attempt, signal(), f.request);
    assert.equal(attempt.superseded, true); assert.equal(attempt.completed, undefined); assert.notEqual(latest.view.productVersion, f.selection.view.productVersion);
    assert.deepEqual(f.tables(), before); assert.ok(f.calls.slice(count).every(call => (call.init.method ?? 'GET') === 'GET'));
    await assert.rejects(f.client.applyDetailWorkspaceBannerRebase(f.selection, preview, attempt, signal(), f.request));
  } finally { f.api.close(); }
});
test('a cancelled operation sends no preview or mutation request', async () => {
  const f = await fixture();
  try { const controller = new AbortController(); controller.abort(); const count = f.calls.length; await assert.rejects(f.client.readDetailWorkspaceBannerRebase(f.selection, controller.signal, f.request)); assert.equal(f.calls.length, count); }
  finally { f.api.close(); }
});
