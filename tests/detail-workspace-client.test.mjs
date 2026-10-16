import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, runtime, plain } from './helpers/detail-workspace.mjs';
import { detailWorkspaceFixture } from './helpers/detail-workspace-api.mjs';
const signal = () => new AbortController().signal;

test('explicit read returns absent workspace without inventing data or writes and binds the exact view', async () => {
  const f = await fixture(), client = runtime(f.request).client, before = JSON.stringify(f.view);
  const read = await client.readDetailWorkspace(f.selection(), signal()); assert.equal(read.workspace, null);
  assert.deepEqual(plain(read.roles), { top: [f.keys[0]], bottom: [f.keys[3]] }); assert.equal(JSON.stringify(f.view), before);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'GET'); assert.equal(f.calls[0].init.cache, 'no-store');
  for (const kind of ['view', 'option', 'profile', 'roles', 'foreign', 'extra']) {
    const reply = f.reply(), input = f.selection();
    if (kind === 'view') reply.view.contentRevision++;
    if (kind === 'option') input.optionId = 'blue';
    if (kind === 'profile') input.profileId = 'another';
    if (kind === 'roles') reply.roles.bottom = reply.roles.top;
    if (kind === 'foreign') reply.roles.top = ['other/top.png'];
    if (kind === 'extra') reply.unexpected = true;
    await assert.rejects(client.validateDetailWorkspaceReply(input, reply), undefined, kind);
  }
});

for (const company of [{ code: 'A01464742', name: '와이홉' }, { code: 'A01526306', name: '유앤채' }]) {
  test(`save binds canonical request, exact clocks, company, file proofs and all other quote data stays unchanged (${company.code})`, async () => {
    const f = await fixture(company), { client } = runtime(f.request), before = JSON.stringify(f.view), selection = f.selection();
    const reply = await client.readDetailWorkspace(selection, signal()), input = await client.createDetailWorkspaceSave(selection, reply, f.document()), attempt = {};
    const result = await client.saveDetailWorkspace(input, attempt, signal());
    assert.equal(attempt.pending, false); assert.equal(result.workspace.revision, 1); assert.equal(result.workspace.requestId, input.requestId);
    assert.deepEqual(plain(result.workspace.company), company); assert.equal(JSON.stringify(f.view), before);
    const writes = f.calls.filter(call => call.method !== 'GET'); assert.equal(writes.length, 1); assert.equal(writes[0].method, 'PUT');
    const body = JSON.parse(writes[0].init.body); assert.deepEqual(Object.keys(body).sort(), ['document', 'expectedRevision', 'expectedView', 'optionId', 'requestId'].sort());
    assert.equal(body.expectedView.inputFingerprint, f.view.inputFingerprint); assert.equal(body.document.generatedHtml, f.document().generatedHtml);
    await assert.rejects(client.saveDetailWorkspace(input, attempt, signal())); assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1);
  });
}

test('document origin, role, owned pool, generated HTML and unique stable IDs are validated before dispatch', async () => {
  const f = await fixture(), { client } = runtime(f.request), before = f.reply();
  for (const kind of ['origin', 'role', 'foreign', 'html', 'duplicate', 'count']) {
    const document = f.document();
    if (kind === 'origin') document.photos[1].originKey = f.keys[4];
    if (kind === 'role') document.photos[1].role = 'top';
    if (kind === 'foreign') document.photos[1].key = 'other/source.png';
    if (kind === 'html') document.generatedHtml = '<script>not-generated</script>';
    if (kind === 'duplicate') document.photos[1].id = document.photos[0].id;
    if (kind === 'count') document.photos = Array.from({ length: 151 }, (_, index) => ({ ...document.photos[1], id: 'p-' + index }));
    await assert.rejects(client.createDetailWorkspaceSave(f.selection(), before, document), undefined, kind);
  }
  assert.equal(f.calls.length, 0);
});

test('later replacement preserves fixed origin and role, repeated keys remain separate ordered positions', async () => {
  const f = await fixture(), { client, model } = runtime(f.request), first = await client.createDetailWorkspaceSave(f.selection(), f.reply(), f.document());
  const saved = await client.saveDetailWorkspace(first, {}, signal()), document = plain(saved.workspace.document);
  document.photos[1].key = f.keys[4]; document.photos.splice(2, 0, { id: 'repeat', originKey: f.keys[4], key: f.keys[4], role: 'body' });
  document.generatedHtml = model.generateDetailWorkspaceHtml(document.photos, 0);
  const next = await client.createDetailWorkspaceSave(f.selection(), saved, document), result = await client.saveDetailWorkspace(next, {}, signal());
  assert.equal(result.workspace.document.photos[1].originKey, f.keys[1]); assert.equal(result.workspace.document.photos[1].key, f.keys[4]);
  assert.deepEqual(plain(result.workspace.document.photos.slice(1, 3).map(photo => photo.key)), [f.keys[4], f.keys[4]]);
  for (const kind of ['origin', 'role']) {
    const invalid = plain(document); invalid.photos[1][kind === 'origin' ? 'originKey' : 'role'] = kind === 'origin' ? f.keys[4] : 'bottom';
    invalid.generatedHtml = model.generateDetailWorkspaceHtml(invalid.photos, 0);
    await assert.rejects(client.createDetailWorkspaceSave(f.selection(), saved, invalid));
  }
});

test('lost ACK remains locked and recovery plus session restoration are GET only', async () => {
  const f = await fixture(); let lost = true; const request = async (url, init = {}) => { const response = await f.request(url, init); if (init.method === 'PUT' && lost) { lost = false; return Response.json({ error: 'lost ACK' }, { status: 503 }); } return response; };
  const { client } = runtime(request), input = await client.createDetailWorkspaceSave(f.selection(), f.reply(), f.document()), attempt = {};
  await assert.rejects(client.saveDetailWorkspace(input, attempt, signal()), /lost ACK/); assert.equal(attempt.pending, true);
  await assert.rejects(client.saveDetailWorkspace(input, attempt, signal()));
  const restored = await client.restoredDetailWorkspaceAttempt(plain(input)); assert.equal(restored.pending, true);
  const result = await client.recoverDetailWorkspace(plain(input), restored, signal()); assert.equal(result.workspace.requestId, input.requestId); assert.equal(restored.pending, false);
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1); assert.equal(f.calls.at(-1).method, 'GET');
  const changed = plain(input); changed.document.imageMargin = 2;
  await assert.rejects(client.restoredDetailWorkspaceAttempt(changed));
});

test('missing, another request, changed company, revision, digest and document never clear an unknown write', async () => {
  for (const kind of ['request', 'company', 'revision', 'digest', 'document', 'generic404']) {
    const f = await fixture(), { client, model } = runtime(f.request); let input = await client.createDetailWorkspaceSave(f.selection(), f.reply(), f.document());
    const saved = await client.saveDetailWorkspace(input, {}, signal());
    if (kind === 'company') { input = await client.createDetailWorkspaceSave(f.selection(), saved, f.document()); await client.saveDetailWorkspace(input, {}, signal()); }
    const attempt = await client.restoredDetailWorkspaceAttempt(input);
    if (kind === 'request') f.workspace.requestId = 'b'.repeat(64);
    if (kind === 'company') f.workspace.company = { code: 'A01526306', name: '유앤채' };
    if (kind === 'revision') f.workspace.revision++;
    if (kind === 'digest') f.workspace.digest = 'f'.repeat(64);
    if (kind === 'document') { [f.workspace.document.photos[1], f.workspace.document.photos[2]] = [f.workspace.document.photos[2], f.workspace.document.photos[1]]; f.workspace.document.generatedHtml = model.generateDetailWorkspaceHtml(f.workspace.document.photos, 0); const files = new Map(f.workspace.files.map(file => [file.key, file])); f.workspace.files = model.detailWorkspaceFileKeys(f.workspace.document).map(key => files.get(key)); }
    if (f.workspace && !['digest'].includes(kind)) { const body = { ...f.workspace }; delete body.digest; f.workspace.digest = await model.detailWorkspaceDigest(body); }
    const transport = kind === 'generic404' ? async () => Response.json({ error: 'missing' }, { status: 404 }) : f.request;
    await assert.rejects(client.recoverDetailWorkspace(input, attempt, signal(), transport), undefined, kind); assert.equal(attempt.pending, true, kind);
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, kind === 'company' ? 2 : 1);
  }
});

test('an exact unchanged-before GET authorizes only an explicit same-input retry, including a late idempotent first write', async () => {
  for (const late of [false, true]) {
    const f = await fixture(), { client } = runtime(f.request), input = await client.createDetailWorkspaceSave(f.selection(), f.reply(), f.document());
    let first = true; const request = async (url, init = {}) => { if (init.method === 'PUT' && first) { first = false; f.calls.push({ url, init, method: 'PUT' }); throw Error('not dispatched'); } return f.request(url, init); };
    const attempt = {}; await assert.rejects(client.saveDetailWorkspace(input, attempt, signal(), request));
    const result = await client.recoverDetailWorkspace(input, attempt, signal(), request); assert.equal(result.workspace, null); assert.equal(attempt.pending, false); assert.equal(attempt.retryReady, true);
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1);
    if (late) await f.request(f.calls[0].url, f.calls[0].init);
    await client.saveDetailWorkspace(input, attempt, signal(), request); assert.equal(attempt.pending, false); assert.equal(attempt.retryReady, false);
    const bodies = f.calls.filter(call => call.method === 'PUT').map(call => call.init.body); assert.ok(bodies.every(body => body === bodies[0])); assert.equal(f.workspace.revision, 1);
  }
});

test('read-only recovery can use a fresh unrelated quote clock but cannot change product, option, profile or category', async () => {
  const f = await fixture(), { client } = runtime(f.request), input = await client.createDetailWorkspaceSave(f.selection(), f.reply(), f.document()); await client.saveDetailWorkspace(input, {}, signal());
  f.view.revision++; f.view.productVersion = '2026-10-16T00:00:02.000Z'; f.view.overrides.options.red.detailHtml = '별도 최신 수동 HTML';
  const attempt = await client.restoredDetailWorkspaceAttempt(input), count = f.calls.length;
  const reply = await client.recoverDetailWorkspace(input, attempt, signal(), f.request, f.selection()); assert.equal(reply.view.revision, f.view.revision); assert.equal(attempt.pending, false);
  assert.equal(f.calls.length, count + 1); assert.equal(f.calls.at(-1).method, 'GET');
  for (const kind of ['productId', 'optionId', 'profileId', 'category']) { const current = f.selection(); if (kind === 'category') current.view.categoryContext.categoryId = 'different'; else current[kind] = 'different'; const restored = await client.restoredDetailWorkspaceAttempt(input); await assert.rejects(client.recoverDetailWorkspace(input, restored, signal(), f.request, current)); assert.equal(restored.pending, true); }
});

test('an uncommitted request with a changed quote requires an explicit read-only rebase before a new request can be created', async () => {
  const f = await fixture(), { client } = runtime(f.request), input = await client.createDetailWorkspaceSave(f.selection(), f.reply(), f.document()), attempt = await client.restoredDetailWorkspaceAttempt(input);
  f.view.revision++; f.view.productVersion = '2026-10-16T00:00:04.000Z';
  await client.recoverDetailWorkspace(input, attempt, signal(), f.request, f.selection()); assert.equal(attempt.retryReady, false); assert.equal(attempt.notApplied, true);
  await assert.rejects(client.saveDetailWorkspace(input, attempt, signal())); assert.equal(f.calls.filter(call => call.method === 'PUT').length, 0);
  const fresh = await client.prepareDetailWorkspaceRebase(input, attempt, f.selection(), signal()); assert.notEqual(fresh.requestId, input.requestId);
  assert.deepEqual(plain(fresh.document), plain(input.document)); assert.equal(fresh.expectedRevision, input.expectedRevision); assert.ok(f.calls.every(call => call.method === 'GET'));
  await client.saveDetailWorkspace(fresh, {}, signal()); assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1);
});

for (const company of [{ companyCode: 'A01464742', companyName: '와이홉' }, { companyCode: 'A01526306', companyName: '유앤채' }]) {
  test(`actual client GET/PUT URLs execute actual authenticated routes and leave every nonworkspace table and file unchanged (${company.companyCode})`, async () => {
    const f = await detailWorkspaceFixture(company), calls = []; let lose = company.companyCode === 'A01526306';
    const transport = async (url, init = {}) => { calls.push({ url, init }); if (!url.includes('/detail-workspace')) return f.request(url, init);
      const method = init.method ?? 'GET', response = await f.route[method](new Request('https://app.test' + url, init), f.context);
      if (lose && method === 'PUT' && response.status === 200) { lose = false; return Response.json({ error: 'actual persisted ACK lost' }, { status: 503 }); } return response;
    };
    try {
      const { client } = runtime(transport), selection = { productId: f.product.id, optionId: f.optionId, profileId: f.initialView.categoryContext.profileId, view: await f.view() };
      const before = await client.readDetailWorkspace(selection, signal()), tables = f.tables(), objects = [...f.api.objects].map(([key, bytes]) => [key, Buffer.from(bytes).toString('hex')]);
      const input = await client.createDetailWorkspaceSave(selection, before, f.document()), attempt = {};
      if (lose) { await assert.rejects(client.saveDetailWorkspace(input, attempt, signal()), /ACK lost/); await client.recoverDetailWorkspace(input, attempt, signal()); }
      else await client.saveDetailWorkspace(input, attempt, signal());
      const result = await client.readDetailWorkspace(selection, signal()); assert.equal(result.workspace.revision, 1); assert.equal(result.workspace.requestId, input.requestId);
      assert.deepEqual(plain(await client.prepareDetailWorkspaceAdoption(selection, result, signal())), f.selectedKeys);
      for (const [table, rows] of Object.entries(tables)) if (table !== 'product_detail_workspaces') assert.deepEqual(f.tables()[table], rows, table);
      assert.deepEqual([...f.api.objects].map(([key, bytes]) => [key, Buffer.from(bytes).toString('hex')]), objects);
      const puts = calls.filter(call => call.init.method === 'PUT'); assert.equal(puts.length, 1); assert.equal(new URL(puts[0].url, 'https://app.test').searchParams.has('optionId'), false);
    } finally { f.api.close(); }
  });
}

test('adoption reads exact actual bytes and stable view before returning ordered keys with no quote write', async () => {
  const f = await fixture(), { client } = runtime(f.request), input = await client.createDetailWorkspaceSave(f.selection(), f.reply(), f.document()), saved = await client.saveDetailWorkspace(input, {}, signal());
  const before = JSON.stringify(f.view), keys = await client.prepareDetailWorkspaceAdoption(f.selection(), saved, signal());
  assert.deepEqual(plain(keys), f.keys.slice(0, 4)); assert.equal(JSON.stringify(f.view), before);
  assert.equal(f.calls.filter(call => call.url.includes('/api/files/')).length, 4); assert.equal(f.calls.filter(call => call.method !== 'GET').length, 1);
  f.objects.set(f.keys[1], f.objects.get(f.keys[2])); await assert.rejects(client.prepareDetailWorkspaceAdoption(f.selection(), saved, signal()));
});

test('abort before dispatch and while verifying files never adopts or writes again', async () => {
  const f = await fixture(), { client } = runtime(f.request), input = await client.createDetailWorkspaceSave(f.selection(), f.reply(), f.document()), aborted = new AbortController(); aborted.abort();
  await assert.rejects(client.saveDetailWorkspace(input, {}, aborted.signal)); assert.equal(f.calls.length, 0);
  const saved = await client.saveDetailWorkspace(input, {}, signal()), controller = new AbortController();
  const request = async (url, init) => { const response = await f.request(url, init); if (url.includes('/api/files/')) controller.abort(); return response; };
  await assert.rejects(client.prepareDetailWorkspaceAdoption(f.selection(), saved, controller.signal, request)); assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1);
});
