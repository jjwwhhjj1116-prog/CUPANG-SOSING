import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const exports = {}; modules.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, structuredClone, AbortController, DOMException, require(name) {
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    if (name.startsWith('./')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
    throw Error('Unexpected dependency: ' + name);
  } });
  return exports;
}
const client = load('app/product-option-split-client.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const uuid = value => `${value.toString(16).padStart(8, '0')}-1111-4111-8111-${value.toString(16).padStart(12, '0')}`;
const signal = () => new AbortController().signal;
const companies = [{ code: 'A01464742', name: '와이홉' }, { code: 'A01526306', name: '유앤채' }];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture(company = companies[0]) {
  const view = { productVersion: '2026-10-15T01:00:00.000Z', inputFingerprint: 'a'.repeat(64), contentRevision: 3, optionRevision: 4, revision: 5,
    resolved: { rows: [{ optionId: null, included: true }, ...['source-c', 'source-a', 'source-b', 'excluded-d'].map((optionId, index) => ({ optionId, included: index !== 3 }))] } };
  const drafts = [{ label: ' 원본 그룹 ', optionIds: ['source-a', 'source-c'] }, { label: '새 그룹', optionIds: ['excluded-d', 'source-b'] }];
  let allocated = 0;
  const input = plain(client.createProductOptionSplitInput('source-product', 'profile_A-1', view, drafts, () => uuid(++allocated)));
  const preview = { format: 'product-option-split-preview-v1', requestId: input.requestId, fingerprint: 'b'.repeat(64),
    sourceProductId: input.productId, sourceVersion: input.sourceVersion, company: { ...company }, warnings: ['기존 원본을 보존한 명시 분할'],
    groups: input.groups.map((group, index) => ({ productId: group.productId, label: group.label, title: `원본 제목, ${group.label}`, seoTitle: `검토한 SEO 제목, ${group.label}`,
      optionIds: group.optionIds.map(id => group.optionIdMap[id]), sourceOptionIds: [...group.optionIds], retainsSource: index === 0 })) };
  const receipt = { ...plain(preview), format: 'product-option-split-receipt-v1', familyId: uuid(500), committedAt: '2026-10-15T01:00:00.001Z',
    groups: preview.groups.map((group, index) => ({ ...plain(group), jobId: index === 0 ? 'original-collection-job' : uuid(600 + index),
      productVersion: '2026-10-15T01:00:00.001Z', contentRevision: index === 0 ? 4 : 1, optionsRevision: index === 0 ? 5 : 1,
      quotationRevision: index === 0 ? 6 : 1, labelsRevision: index === 0 ? 8 : 1, registrationNumber: `26101500${index + 1}001` })) };
  return { view, drafts, input, preview, receipt, allocated: () => allocated };
}

function transport(...steps) {
  const calls = [];
  const fetcher = async function (url, init = {}) {
    assert.equal(this, undefined, 'fetch must not receive a helper object as this');
    calls.push({ url, method: init.method ?? 'GET', init, body: init.body ? JSON.parse(init.body) : undefined });
    assert.ok(steps.length, 'no unplanned request or write');
    const step = steps.shift();
    return typeof step === 'function' ? step(url, init) : step;
  };
  return { fetcher, calls, remaining: () => steps.length };
}

test('input makes one complete partition including excluded rows, preserves row order and keeps original UUIDs only in group one', () => {
  const f = fixture(), before = JSON.stringify([f.view, f.drafts]);
  assert.deepEqual(f.input.groups.map(group => group.optionIds), [['source-c', 'source-a'], ['source-b', 'excluded-d']]);
  assert.equal(f.input.groups[0].productId, 'source-product');
  assert.deepEqual(f.input.groups[0].optionIdMap, { 'source-c': 'source-c', 'source-a': 'source-a' });
  assert.deepEqual(f.input.groups[1].optionIdMap, { 'source-b': uuid(2), 'excluded-d': uuid(3) });
  assert.equal(f.input.groups[1].productId, uuid(1)); assert.equal(f.input.requestId, uuid(4)); assert.equal(f.allocated(), 4);
  assert.equal(f.input.groups[0].label, ' 원본 그룹 ');
  assert.deepEqual(f.input.revisions, { content: 3, options: 4, quotation: 5 });
  assert.equal(JSON.stringify([f.view, f.drafts]), before);
});

test('input includes every option even when every real row is excluded from quotation', () => {
  const f = fixture(); f.view.resolved.rows.forEach(row => { row.included = false; }); let next = 100;
  const value = plain(client.createProductOptionSplitInput(f.input.productId, undefined, f.view, f.drafts, () => uuid(++next)));
  assert.equal(value.groups.flatMap(group => group.optionIds).length, 4);
  assert.ok(value.groups[1].optionIds.includes('excluded-d')); assert.equal(value.profileId, undefined);
});

test('incomplete, duplicated, unknown, empty and over-limit partitions cannot allocate a usable request', () => {
  const f = fixture();
  for (const drafts of [[f.drafts[0]], [...f.drafts, ...Array.from({ length: 19 }, () => f.drafts[0])],
    [{ ...f.drafts[0], label: '  ' }, f.drafts[1]], [{ ...f.drafts[0], label: 'x'.repeat(121) }, f.drafts[1]],
    [{ ...f.drafts[0], optionIds: [] }, f.drafts[1]], [{ ...f.drafts[0], optionIds: ['unknown'] }, f.drafts[1]],
    [f.drafts[0], { ...f.drafts[1], optionIds: ['source-b'] }], [f.drafts[0], { ...f.drafts[1], optionIds: ['source-a', 'source-b', 'excluded-d'] }],
    [{ ...f.drafts[0], optionIds: ['source-c', 'source-c', 'source-a'] }, f.drafts[1]]]) {
    let id = 0;
    assert.throws(() => client.createProductOptionSplitInput(f.input.productId, undefined, f.view, drafts, () => uuid(++id)));
  }
});

test('invalid source clocks, option identities and failed UUID allocation are rejected before preview', () => {
  const f = fixture();
  for (const mutate of [view => { view.inputFingerprint = 'bad'; }, view => { view.productVersion = 'bad'; },
    view => { view.resolved.rows = view.resolved.rows.slice(0, 2); }, view => { view.resolved.rows[2].optionId = 'source-c'; },
    view => { view.resolved.rows = Array.from({ length: 201 }, (_, i) => ({ optionId: `source-${i}` })); }]) {
    const view = plain(f.view); mutate(view); let id = 0;
    assert.throws(() => client.createProductOptionSplitInput(f.input.productId, undefined, view, f.drafts, () => uuid(++id)));
  }
  for (const allocate of [() => 'not-uuid', () => uuid(1)]) assert.throws(() => client.createProductOptionSplitInput(f.input.productId, undefined, f.view, f.drafts, allocate));
  assert.throws(() => client.createProductOptionSplitInput(uuid(1), undefined, f.view, f.drafts, () => uuid(1)));
});

for (const company of companies) test(`preview sends only the explicit partition and validates source/group/company fields (${company.code})`, async () => {
  const f = fixture(company), t = transport(Response.json(f.preview)), before = JSON.stringify(f.input);
  const result = await client.previewProductOptionSplit(f.input, signal(), t.fetcher);
  assert.deepEqual(plain(result), f.preview); assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].url, '/api/products/source-product/option-splits?profileId=profile_A-1');
  assert.equal(t.calls[0].method, 'POST'); assert.equal(t.calls[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(t.calls[0].body, { action: 'preview', requestId: f.input.requestId, expectedInputFingerprint: f.input.expectedInputFingerprint, groups: f.input.groups });
  assert.equal(JSON.stringify(f.input), before);
  for (const mutate of [value => { value.sourceProductId = 'other'; }, value => { value.requestId = uuid(700); },
    value => { value.sourceVersion = '2026-10-14T01:00:00.000Z'; }, value => { value.fingerprint = 'bad'; },
    value => { value.company = { code: 'UNKNOWN', name: '회사' }; }, value => { value.company.name = companies.find(other => other.code !== company.code).name; },
    value => { value.warnings.push(1); }, value => { value.groups.pop(); }, value => { value.groups.reverse(); },
    value => { value.groups[0].retainsSource = false; }, value => { value.groups[1].productId = 'other'; },
    value => { value.groups[1].label = '다른 그룹'; }, value => { value.groups[1].sourceOptionIds.reverse(); },
    value => { value.groups[1].optionIds.reverse(); }, value => { value.groups[1].title = ''; },
    value => { delete value.groups[1].seoTitle; }, value => { value.groups[1].seoTitle = 1; }, value => { value.groups[1].seoTitle = 'x'.repeat(501); }]) {
    const value = plain(f.preview); mutate(value); assert.throws(() => client.validateProductOptionSplitPreview(f.input, value));
  }
});

test('preview rejects HTTP failures and malformed envelopes without any automatic follow-up', async () => {
  const f = fixture();
  for (const response of [Response.json({ error: '원천이 변경됨' }, { status: 409 }), Response.json(null), Response.json([])]) {
    const t = transport(response); await assert.rejects(client.previewProductOptionSplit(f.input, signal(), t.fetcher)); assert.equal(t.calls.length, 1);
  }
});

test('receipt pins reviewed titles, company, warnings, all UUID scopes and every source/child revision', () => {
  const f = fixture(); assert.deepEqual(plain(client.validateProductOptionSplitReceipt(f.input, f.preview, f.receipt)), f.receipt);
  const legacy = plain(f.receipt); legacy.groups[0].registrationNumber = null;
  assert.equal(client.validateProductOptionSplitReceipt(f.input, f.preview, legacy).groups[0].registrationNumber, null);
  const blankPreview = plain(f.preview), blankReceipt = plain(f.receipt);
  blankPreview.groups[1].seoTitle = ''; blankReceipt.groups[1].seoTitle = '';
  assert.equal(client.validateProductOptionSplitReceipt(f.input, blankPreview, blankReceipt).groups[1].seoTitle, '', 'a reviewed manual SEO blank is preserved');
  for (const mutate of [value => { value.familyId = 'not-uuid'; }, value => { value.committedAt = 'bad'; },
    value => { value.fingerprint = 'f'.repeat(64); }, value => { value.company = companies[1]; }, value => { value.warnings = ['검토하지 않은 안내']; },
    value => { value.groups[1].jobId = value.groups[0].jobId; }, value => { value.groups[1].jobId = 'legacy-job'; },
    value => { value.groups[0].productVersion = f.input.sourceVersion; }, value => { value.groups[1].contentRevision = 2; },
    value => { value.groups[0].contentRevision--; }, value => { value.groups[0].optionsRevision--; }, value => { value.groups[0].quotationRevision--; },
    value => { value.groups[1].labelsRevision = 0; }, value => { value.groups[1].registrationNumber = null; },
    value => { value.groups[1].registrationNumber = value.groups[0].registrationNumber; }, value => { value.groups[1].registrationNumber = 'wrong'; },
    value => { value.groups[1].optionIds[0] = uuid(999); }]) {
    const value = plain(f.receipt); mutate(value); assert.throws(() => client.validateProductOptionSplitReceipt(f.input, f.preview, value));
  }
});

test('a receipt cannot replace either the product title or SEO title shown in the reviewed preview', () => {
  const f = fixture();
  for (const field of ['title', 'seoTitle']) {
    const value = plain(f.receipt); value.groups[1][field] = '검토하지 않은 다른 상품명';
    assert.throws(() => client.validateProductOptionSplitReceipt(f.input, f.preview, value));
  }
});

test('commit is synchronous single-flight and sends the reviewed fingerprint once', async () => {
  const f = fixture(), gate = deferred(), attempt = {}, t = transport(() => gate.promise);
  const first = client.commitProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher);
  assert.equal(attempt.pending, true);
  await assert.rejects(client.commitProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher)); assert.equal(t.calls.length, 1);
  assert.deepEqual(t.calls[0].body, { action: 'commit', requestId: f.input.requestId, expectedInputFingerprint: f.input.expectedInputFingerprint,
    groups: f.input.groups, previewFingerprint: f.preview.fingerprint });
  gate.resolve(Response.json({ receipt: f.receipt, current: true }));
  assert.deepEqual(plain(await first), { receipt: f.receipt, current: true }); assert.equal(attempt.pending, false);
  await assert.rejects(client.commitProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher)); assert.equal(t.calls.length, 1);
});

test('lost commit ACK remains pending and GET-only recovery proves the same durable receipt', async () => {
  const f = fixture(), attempt = {}, t = transport(() => { throw Error('lost ACK'); }, Response.json({ receipt: f.receipt, current: true }));
  await assert.rejects(client.commitProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher), /lost ACK/);
  assert.equal(attempt.pending, true); assert.equal(attempt.receipt, undefined);
  await assert.rejects(client.commitProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher)); assert.equal(t.calls.length, 1);
  assert.deepEqual(plain(await client.recoverProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher)), { receipt: f.receipt, current: true });
  assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET']); assert.equal(t.calls[1].init.cache, 'no-store');
  assert.equal(t.calls[1].url, `/api/products/source-product/option-splits?profileId=profile_A-1&requestId=${f.input.requestId}`);
  assert.equal(attempt.pending, false); assert.deepEqual(plain(attempt.receipt), f.receipt);
});

test('HTTP errors, malformed JSON and mismatched commit ACKs stay uncertain until a read proves the result', async () => {
  const f = fixture();
  for (const response of [Response.json({ error: '같은 결과 확인 필요' }, { status: 409 }), Response.json({ error: 'temporary' }, { status: 503 }),
    new Response('not json', { status: 200 }), Response.json({ receipt: f.receipt }), Response.json({ receipt: { ...f.receipt, fingerprint: 'f'.repeat(64) }, current: true })]) {
    const attempt = {}, t = transport(response, Response.json({ receipt: f.receipt, current: true }));
    await assert.rejects(client.commitProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher)); assert.equal(attempt.pending, true);
    assert.equal((await client.recoverProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher)).current, true);
    assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET']);
  }
});

test('only the explicit no-ledger 404 clears pending and recovery itself never retries a write', async () => {
  const f = fixture(), attempt = {}, t = transport(() => { throw Error('connection lost'); },
    Response.json({ code: 'OPTION_SPLIT_NOT_FOUND', receipt: null, current: false }, { status: 404 }), Response.json({ receipt: f.receipt, current: true }));
  await assert.rejects(client.commitProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher));
  assert.equal(await client.recoverProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher), null);
  assert.equal(attempt.pending, false); assert.equal(attempt.receipt, undefined); assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET']);
  await client.commitProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher);
  assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET', 'POST'], 'only a later explicit commit dispatches another write');
});

test('generic, malformed and successful-status missing-receipt responses never authorize replay', async () => {
  const f = fixture();
  for (const [status, body] of [[404, { error: '상품 없음' }], [404, { code: 'OPTION_SPLIT_NOT_FOUND', current: false }],
    [404, { code: 'OPTION_SPLIT_NOT_FOUND', receipt: null, current: 'false' }], [404, { code: 'OTHER_NOT_FOUND', receipt: null, current: false }],
    [200, { code: 'OPTION_SPLIT_NOT_FOUND', receipt: null, current: false }]]) {
    const attempt = {}, t = transport(() => { throw Error('unknown commit'); }, Response.json(body, { status }));
    await assert.rejects(client.commitProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher));
    await assert.rejects(client.recoverProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher));
    assert.equal(attempt.pending, true); await assert.rejects(client.commitProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher));
    assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET']);
  }
});

test('historical current:false receipts remain success history and never dispatch the original split again', async () => {
  const f = fixture(), attempt = {}, t = transport(Response.json({ receipt: f.receipt, current: false }), Response.json({ receipt: f.receipt, current: false }),
    Response.json({ code: 'OPTION_SPLIT_NOT_FOUND', receipt: null, current: false }, { status: 404 }));
  assert.equal((await client.commitProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher)).current, false);
  await assert.rejects(client.commitProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher));
  assert.equal((await client.recoverProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher)).current, false);
  await assert.rejects(client.recoverProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher));
  await assert.rejects(client.commitProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher));
  assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET', 'GET']); assert.deepEqual(plain(attempt.receipt), f.receipt);
});

test('known receipts cannot change during later read-only recovery', async () => {
  const f = fixture(), attempt = {}, changed = plain(f.receipt); changed.familyId = uuid(999);
  const t = transport(Response.json({ receipt: f.receipt, current: true }), Response.json({ receipt: changed, current: false }));
  await client.commitProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher);
  await assert.rejects(client.recoverProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher));
  assert.deepEqual(plain(attempt.receipt), f.receipt); assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET']);
});

test('bound attempts cannot cross product, profile, fingerprint, source clock, partition or preview scope', async () => {
  const f = fixture(), attempt = {}, t = transport(() => { throw Error('lost ACK'); });
  await assert.rejects(client.commitProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher));
  for (const mutate of [input => { input.productId = 'other'; }, input => { input.profileId = 'other'; }, input => { input.requestId = uuid(999); },
    input => { input.expectedInputFingerprint = 'f'.repeat(64); }, input => { input.sourceVersion = '2026-10-14T00:00:00.000Z'; },
    input => { input.revisions.options++; }, input => { input.groups[1].label = '다른 입력'; }]) {
    const input = plain(f.input); mutate(input);
    await assert.rejects(client.recoverProductOptionSplit(input, f.preview, attempt, signal(), t.fetcher));
  }
  const otherPreview = plain(f.preview); otherPreview.fingerprint = 'f'.repeat(64);
  await assert.rejects(client.recoverProductOptionSplit(f.input, otherPreview, attempt, signal(), t.fetcher));
  for (const orphan of [{ pending: true }, { receipt: f.receipt }]) await assert.rejects(client.recoverProductOptionSplit(f.input, f.preview, orphan, signal(), t.fetcher));
  assert.equal(t.calls.length, 1); assert.equal(attempt.pending, true);
});

test('already aborted preview, commit and recovery send no requests', async () => {
  const f = fixture(), controller = new AbortController(), t = transport(), attempt = {}; controller.abort();
  await assert.rejects(client.previewProductOptionSplit(f.input, controller.signal, t.fetcher));
  await assert.rejects(client.commitProductOptionSplit(f.input, f.preview, attempt, controller.signal, t.fetcher));
  await assert.rejects(client.recoverProductOptionSplit(f.input, f.preview, attempt, controller.signal, t.fetcher));
  assert.equal(t.calls.length, 0); assert.equal(attempt.pending, undefined); assert.equal(attempt.receipt, undefined);
});

test('aborting after commit dispatch preserves uncertainty and a later fresh signal recovers by GET only', async () => {
  const f = fixture(), attempt = {}, controller = new AbortController(), t = transport(() => { controller.abort(); return Response.json({ receipt: f.receipt, current: true }); },
    Response.json({ receipt: f.receipt, current: true }));
  await assert.rejects(client.commitProductOptionSplit(f.input, f.preview, attempt, controller.signal, t.fetcher));
  assert.equal(attempt.pending, true); assert.equal(attempt.receipt, undefined);
  assert.equal((await client.recoverProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher)).current, true);
  assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET']);
});

test('aborting after a recovery response cannot adopt its receipt or clear pending', async () => {
  const f = fixture(), attempt = {}, controller = new AbortController(), t = transport(() => { throw Error('unknown'); },
    () => { controller.abort(); return Response.json({ receipt: f.receipt, current: true }); });
  await assert.rejects(client.commitProductOptionSplit(f.input, f.preview, attempt, signal(), t.fetcher));
  await assert.rejects(client.recoverProductOptionSplit(f.input, f.preview, attempt, controller.signal, t.fetcher));
  assert.equal(attempt.pending, true); assert.equal(attempt.receipt, undefined); assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET']);
});

test('session reload reconstructs a bound unknown attempt and recovers current or historical success by GET only', async () => {
  for (const current of [true, false]) {
    const f = fixture(), originalAttempt = {}, t = transport(() => { throw Error('committed but ACK lost before reload'); }, Response.json({ receipt: f.receipt, current }));
    await assert.rejects(client.commitProductOptionSplit(f.input, f.preview, originalAttempt, signal(), t.fetcher));
    assert.equal(originalAttempt.pending, true);
    // The panel persists the reviewed input/preview, never a fabricated success
    // receipt. A new page must rebuild the binding before it can issue a lookup.
    const stored = plain({ input: f.input, preview: f.preview });
    const restored = client.restoredProductOptionSplitAttempt(stored.input, stored.preview);
    assert.equal(restored.pending, true); assert.equal(restored.receipt, undefined);
    await assert.rejects(client.commitProductOptionSplit(stored.input, stored.preview, restored, signal(), t.fetcher));
    assert.equal(t.calls.length, 1, 'restored uncertainty cannot dispatch the partition');
    const result = await client.recoverProductOptionSplit(stored.input, stored.preview, restored, signal(), t.fetcher);
    assert.deepEqual(plain(result), { receipt: f.receipt, current }); assert.equal(restored.pending, false);
    await assert.rejects(client.commitProductOptionSplit(stored.input, stored.preview, restored, signal(), t.fetcher));
    assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET']);
  }
});

test('restored uncertainty clears only for the explicit absent-ledger proof and retains its original scope binding', async () => {
  const f = fixture(), stored = plain({ input: f.input, preview: f.preview }), restored = client.restoredProductOptionSplitAttempt(stored.input, stored.preview);
  const t = transport(Response.json({ code: 'OPTION_SPLIT_NOT_FOUND', receipt: null, current: false }, { status: 404 }));
  assert.equal(await client.recoverProductOptionSplit(stored.input, stored.preview, restored, signal(), t.fetcher), null);
  assert.equal(restored.pending, false); assert.equal(restored.receipt, undefined);
  const other = { ...stored.input, profileId: 'different-profile' };
  await assert.rejects(client.commitProductOptionSplit(other, stored.preview, restored, signal(), t.fetcher));
  assert.deepEqual(t.calls.map(call => call.method), ['GET']);
});

test('restoring malformed or mismatched serialized previews fails before recovery can fetch', () => {
  const f = fixture();
  for (const mutate of [preview => { preview.sourceProductId = 'different-product'; }, preview => { preview.requestId = uuid(999); },
    preview => { preview.company = { code: companies[0].code, name: companies[1].name }; },
    preview => { preview.groups[1].optionIds = ['not-the-reviewed-UUID']; }]) {
    const preview = plain(f.preview); mutate(preview);
    assert.throws(() => client.restoredProductOptionSplitAttempt(f.input, preview));
  }
});
