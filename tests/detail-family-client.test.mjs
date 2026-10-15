import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const exports = {}; modules.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, structuredClone, AbortController, DOMException, TextEncoder, TextDecoder, crypto: webcrypto, require(name) {
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    if (name.startsWith('./')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
    throw Error('Unexpected dependency: ' + name);
  } });
  return exports;
}
const client = load('app/detail-family-client.ts');
const { MAX_IMAGE_BYTES } = load('app/image-files.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const uuid = value => `${value.toString(16).padStart(8, '0')}-1111-4111-8111-${value.toString(16).padStart(12, '0')}`;
const signal = () => new AbortController().signal;
const companies = [{ code: 'A01464742', name: '와이홉' }, { code: 'A01526306', name: '유앤채' }];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture(company = companies[0]) {
  const catalog = { format: 'detail-family-catalog-v1', sourceProductId: 'saved-source', sourceVersion: '2026-10-15T01:00:00.000Z',
    inputFingerprint: 'a'.repeat(64), company: { ...company }, familyId: uuid(500), sourceReady: true, reason: null,
    image: { key: 'owner-1/reviewed-detail.png', sha256: 'b'.repeat(64), bytes: 2048, width: 800, height: 400 },
    targets: [{ productId: 'child-b', title: ' 분할 상품 B ', registrationNumber: '261015002001', optionCount: 2, eligible: true, reason: null },
      { productId: 'child-a', title: '분할 상품 A', registrationNumber: null, optionCount: 1, eligible: true, reason: null },
      { productId: 'blocked-child', title: '다른 범위', registrationNumber: '261015003001', optionCount: 3, eligible: false, reason: '다른 카테고리' }] };
  const input = plain(client.createDetailFamilyInput('saved-source', 'profile_A-1', catalog, ['child-a', 'child-b'], uuid(600)));
  const preview = { format: 'detail-family-preview-v1', requestId: input.requestId, fingerprint: 'c'.repeat(64),
    sourceProductId: input.productId, sourceVersion: catalog.sourceVersion, company: { ...company }, familyId: catalog.familyId,
    key: catalog.image.key, sha256: catalog.image.sha256, bytes: catalog.image.bytes,
    targets: input.targetIds.map((productId, index) => {
      const listed = catalog.targets.find(target => target.productId === productId);
      return { productId, title: listed.title, registrationNumber: listed.registrationNumber,
        beforeVersion: `2026-10-15T00:00:0${index}.000Z`, revision: index + 2,
        optionIds: Array.from({ length: listed.optionCount }, (_, option) => `${productId}-option-${option}`) };
    }) };
  const receipt = { ...plain(preview), format: 'detail-family-receipt-v1', committedAt: '2026-10-15T01:00:00.001Z',
    targets: preview.targets.map(target => ({ ...plain(target), savedRevision: target.revision + 1, savedVersion: '2026-10-15T01:00:00.001Z' })) };
  return { catalog, input, preview, receipt };
}

function transport(...steps) {
  const calls = [];
  const fetcher = async function (url, init = {}) {
    assert.equal(this, undefined);
    calls.push({ url, method: init.method ?? 'GET', init, body: init.body ? JSON.parse(init.body) : undefined });
    assert.ok(steps.length, 'no unplanned request or write');
    const step = steps.shift();
    return typeof step === 'function' ? step(url, init) : step;
  };
  return { calls, fetcher };
}

for (const company of companies) test(`catalog read validates ordinary saved source and exact company (${company.code})`, async () => {
  const f = fixture(company), t = transport(Response.json(f.catalog));
  assert.deepEqual(plain(await client.readDetailFamilyCatalog(f.input.productId, f.input.profileId, signal(), t.fetcher)), f.catalog);
  assert.equal(t.calls[0].url, '/api/products/saved-source/detail-family?profileId=profile_A-1');
  assert.equal(t.calls[0].method, 'GET'); assert.equal(t.calls[0].init.cache, 'no-store');
  assert.equal(t.calls[0].body, undefined);
  for (const mutate of [value => { value.sourceProductId = 'other'; }, value => { value.sourceVersion = 'bad'; },
    value => { value.inputFingerprint = 'bad'; }, value => { value.company = { code: 'OTHER', name: '회사' }; },
    value => { value.company.name = companies.find(other => other.code !== company.code).name; },
    value => { value.familyId = 'bad'; }, value => { value.sourceReady = 'true'; }, value => { value.reason = 1; },
    value => { value.image = null; }, value => { value.targets.push(plain(value.targets[0])); },
    value => { value.targets[0].productId = value.sourceProductId; }, value => { value.targets[0].registrationNumber = 'bad'; },
    value => { value.targets[0].optionCount = 201; }, value => { value.targets[0].title = 'x'.repeat(501); },
    value => { value.targets = Array.from({ length: 201 }, (_, index) => ({ ...value.targets[0], productId: `child-${index}` })); }]) {
    const value = plain(f.catalog); mutate(value); assert.throws(() => client.validateDetailFamilyCatalog(f.input.productId, value));
  }
});

test('source image catalog rejects malformed keys, hashes, byte counts and dimensions', () => {
  const f = fixture();
  for (const key of ['', '/media/quotation/token', 'https://other.test/image.png', 'data:image/png;base64,x',
    'owner-1/../detail.png', 'owner-1/detail\n.png', 'owner-1/detail\\name.png', 'owner-1/detail%2Fname.png', 'owner-1/detail.png?other=1']) {
    const value = plain(f.catalog); value.image.key = key;
    assert.throws(() => client.validateDetailFamilyCatalog(f.input.productId, value), `invalid key: ${JSON.stringify(key)}`);
  }
  for (const patch of [{ sha256: 'bad' }, { bytes: 0 }, { bytes: MAX_IMAGE_BYTES + 1 }, { bytes: 1.5 },
    { width: 799 }, { height: 0 }, { height: 16001 }, { height: 1.5 }]) {
    const value = plain(f.catalog); Object.assign(value.image, patch);
    assert.throws(() => client.validateDetailFamilyCatalog(f.input.productId, value));
  }
});

test('catalog can explain absent saved source but input cannot apply it', () => {
  const f = fixture(), unavailable = { ...f.catalog, familyId: null, sourceReady: false, image: null, reason: '공통·전체 옵션 상세 저장이 필요합니다.' };
  assert.deepEqual(plain(client.validateDetailFamilyCatalog(f.input.productId, unavailable)), unavailable);
  assert.throws(() => client.createDetailFamilyInput(f.input.productId, undefined, unavailable, ['child-a'], uuid(601)), /공통·전체 옵션/);
});

test('input preserves reviewed target order and rejects empty, duplicate, unknown, ineligible or over-limit selections', () => {
  const f = fixture(), before = JSON.stringify(f.catalog), selection = ['child-a', 'child-b'];
  const input = client.createDetailFamilyInput(f.input.productId, undefined, f.catalog, selection, uuid(602));
  selection.reverse(); assert.deepEqual(plain(input.targetIds), ['child-a', 'child-b']); assert.equal(input.profileId, undefined);
  assert.equal(JSON.stringify(f.catalog), before);
  for (const ids of [[], ['child-a', 'child-a'], ['unknown'], ['saved-source'], ['blocked-child'], Array.from({ length: 20 }, (_, i) => `child-${i}`)])
    assert.throws(() => client.createDetailFamilyInput(f.input.productId, f.input.profileId, f.catalog, ids, uuid(603)));
  assert.throws(() => client.createDetailFamilyInput(f.input.productId, undefined, f.catalog, ['child-a'], 'not-uuid'));
});

for (const company of companies) test(`preview sends only selected family targets and source fingerprint (${company.code})`, async () => {
  const f = fixture(company), t = transport(Response.json(f.preview)), before = JSON.stringify(f.input);
  assert.deepEqual(plain(await client.previewDetailFamily(f.input, signal(), t.fetcher)), f.preview);
  assert.equal(t.calls[0].method, 'POST'); assert.equal(t.calls[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(t.calls[0].body, { action: 'preview', requestId: f.input.requestId, expectedInputFingerprint: f.catalog.inputFingerprint, targetIds: f.input.targetIds });
  assert.equal(JSON.stringify(f.input), before);
  for (const mutate of [value => { value.sourceProductId = 'other'; }, value => { value.sourceVersion = '2026-10-14T01:00:00.000Z'; },
    value => { value.requestId = uuid(999); }, value => { value.fingerprint = 'bad'; }, value => { value.familyId = uuid(999); },
    value => { value.company = companies.find(other => other.code !== company.code); }, value => { value.key = 'owner-1/unreviewed.png'; },
    value => { value.sha256 = 'f'.repeat(64); }, value => { value.bytes++; }, value => { value.targets.reverse(); },
    value => { value.targets.pop(); }, value => { value.targets[0].productId = 'blocked-child'; }, value => { value.targets[0].title = '다른 이름'; },
    value => { value.targets[0].registrationNumber = '261015999999'; }, value => { value.targets[0].beforeVersion = 'bad'; },
    value => { value.targets[0].revision = -1; }, value => { value.targets[0].optionIds = []; },
    value => { value.targets[1].optionIds[1] = value.targets[1].optionIds[0]; }, value => { value.targets[0].optionIds[0] = '__proto__'; }]) {
    const value = plain(f.preview); mutate(value); assert.throws(() => client.validateDetailFamilyPreview(f.input, value));
  }
});

test('receipt pins reviewed names, exact option order, company, image proof, revisions and shared commit version', () => {
  const f = fixture(); assert.deepEqual(plain(client.validateDetailFamilyReceipt(f.input, f.preview, f.receipt)), f.receipt);
  for (const mutate of [value => { value.format = 'detail-family-preview-v1'; }, value => { value.fingerprint = 'f'.repeat(64); },
    value => { value.company = companies[1]; }, value => { value.sourceVersion = '2026-10-16T01:00:00.000Z'; },
    value => { value.familyId = uuid(999); }, value => { value.key = 'owner-1/other.png'; }, value => { value.sha256 = 'f'.repeat(64); },
    value => { value.bytes++; }, value => { value.targets[1].title = value.targets[1].title.trim(); },
    value => { value.targets[0].beforeVersion = '2026-10-14T00:00:00.000Z'; }, value => { value.targets[0].revision++; },
    value => { value.targets[1].optionIds.reverse(); }, value => { value.targets[0].savedRevision++; },
    value => { value.targets[0].savedVersion = value.targets[0].beforeVersion; }, value => { value.targets[0].savedVersion = 'bad'; },
    value => { value.targets[0].savedVersion = '2026-10-15T01:00:00.002Z'; }, value => { value.committedAt = 'bad'; }]) {
    const value = plain(f.receipt); mutate(value); assert.throws(() => client.validateDetailFamilyReceipt(f.input, f.preview, value));
  }
});

test('read and preflight HTTP codes or malformed envelopes never issue a follow-up mutation', async () => {
  const f = fixture();
  for (const [status, value] of [[403, { error: '회사 승인 필요', code: 'FORBIDDEN' }],
    [409, { error: '원본 상세 저장 필요', code: 'DETAIL_FAMILY_SOURCE_NOT_READY' }],
    [409, { error: '자료 변경', code: 'DETAIL_FAMILY_CONFLICT' }], [200, null], [200, []]]) {
    for (const operation of ['read', 'preview']) {
      const t = transport(Response.json(value, { status }));
      await assert.rejects(operation === 'read' ? client.readDetailFamilyCatalog(f.input.productId, f.input.profileId, signal(), t.fetcher)
        : client.previewDetailFamily(f.input, signal(), t.fetcher)); assert.equal(t.calls.length, 1);
    }
  }
});

test('commit synchronously locks duplicate clicks and emits one reviewed write', async () => {
  const f = fixture(), attempt = {}, gate = deferred(), t = transport(() => gate.promise);
  const first = client.commitDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher);
  assert.equal(attempt.pending, true);
  await assert.rejects(client.commitDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher)); assert.equal(t.calls.length, 1);
  assert.deepEqual(t.calls[0].body, { action: 'commit', requestId: f.input.requestId, expectedInputFingerprint: f.catalog.inputFingerprint,
    targetIds: f.input.targetIds, previewFingerprint: f.preview.fingerprint });
  gate.resolve(Response.json({ receipt: f.receipt, current: true }));
  assert.deepEqual(plain(await first), { receipt: f.receipt, current: true }); assert.equal(attempt.pending, false);
  await assert.rejects(client.commitDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher)); assert.equal(t.calls.length, 1);
});

test('lost ACK preserves pending and only GET recovery can prove the same saved operation', async () => {
  const f = fixture(), attempt = {}, t = transport(() => { throw Error('lost ACK'); }, Response.json({ receipt: f.receipt, current: true }));
  await assert.rejects(client.commitDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher), /lost ACK/);
  assert.equal(attempt.pending, true); assert.equal(attempt.receipt, undefined);
  await assert.rejects(client.commitDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher)); assert.equal(t.calls.length, 1);
  assert.deepEqual(plain(await client.recoverDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher)), { receipt: f.receipt, current: true });
  assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET']); assert.equal(t.calls[1].init.cache, 'no-store');
  assert.equal(t.calls[1].url, `/api/products/saved-source/detail-family?profileId=profile_A-1&requestId=${f.input.requestId}`);
});

test('non-OK, bad JSON and malformed commit acknowledgements remain uncertain until a read succeeds', async () => {
  const f = fixture();
  for (const response of [Response.json({ error: '경합', code: 'DETAIL_FAMILY_CONFLICT' }, { status: 409 }),
    Response.json({ error: '접속 오류' }, { status: 503 }), new Response('not JSON'),
    Response.json({ receipt: f.receipt }), Response.json({ receipt: f.receipt, current: 'true' }),
    Response.json({ receipt: { ...f.receipt, company: companies[1] }, current: true })]) {
    const attempt = {}, t = transport(response, Response.json({ receipt: f.receipt, current: true }));
    await assert.rejects(client.commitDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher)); assert.equal(attempt.pending, true);
    assert.equal((await client.recoverDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher)).current, true);
    assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET']);
  }
});

test('only explicit DETAIL_FAMILY_NOT_FOUND 404 clears unknown state without automatically replaying a write', async () => {
  const f = fixture(), attempt = {}, t = transport(() => { throw Error('unknown'); },
    Response.json({ code: 'DETAIL_FAMILY_NOT_FOUND', receipt: null, current: false }, { status: 404 }), Response.json({ receipt: f.receipt, current: true }));
  await assert.rejects(client.commitDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher));
  assert.equal(await client.recoverDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher), null); assert.equal(attempt.pending, false);
  assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET']);
  await client.commitDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher);
  assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET', 'POST'], 'a second write needs a later explicit call');
});

test('generic 404, other feature codes and malformed absence claims never authorize a repeated write', async () => {
  const f = fixture();
  for (const [status, value] of [[404, { error: '상품 없음' }], [404, { code: 'OPTION_SPLIT_NOT_FOUND', receipt: null, current: false }],
    [404, { code: 'DETAIL_FAMILY_NOT_FOUND', current: false }], [404, { code: 'DETAIL_FAMILY_NOT_FOUND', receipt: null, current: 'false' }],
    [200, { code: 'DETAIL_FAMILY_NOT_FOUND', receipt: null, current: false }]]) {
    const attempt = {}, t = transport(() => { throw Error('unknown'); }, Response.json(value, { status }));
    await assert.rejects(client.commitDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher));
    await assert.rejects(client.recoverDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher));
    assert.equal(attempt.pending, true);
    await assert.rejects(client.commitDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher));
    assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET']);
  }
});

test('historical current:false receipts are retained and can never repeat the original mutation', async () => {
  const f = fixture(), attempt = {}, t = transport(Response.json({ receipt: f.receipt, current: false }),
    Response.json({ receipt: f.receipt, current: false }), Response.json({ code: 'DETAIL_FAMILY_NOT_FOUND', receipt: null, current: false }, { status: 404 }));
  assert.equal((await client.commitDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher)).current, false);
  await assert.rejects(client.commitDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher));
  assert.equal((await client.recoverDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher)).current, false);
  await assert.rejects(client.recoverDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher));
  await assert.rejects(client.commitDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher));
  assert.deepEqual(plain(attempt.receipt), f.receipt); assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET', 'GET']);
});

test('known receipt is immutable across recovery even when a different receipt remains structurally valid', async () => {
  const f = fixture(), attempt = {}, different = plain(f.receipt); different.committedAt = '2026-10-15T01:00:00.002Z';
  different.targets.forEach(target => { target.savedVersion = different.committedAt; });
  const t = transport(Response.json({ receipt: f.receipt, current: true }), Response.json({ receipt: different, current: false }));
  await client.commitDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher);
  await assert.rejects(client.recoverDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher));
  assert.deepEqual(plain(attempt.receipt), f.receipt); assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET']);
});

test('a bound attempt cannot change product, profile, target order, source clock, image, request or approved company', async () => {
  const f = fixture(), attempt = {}, t = transport(() => { throw Error('unknown'); });
  await assert.rejects(client.commitDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher));
  for (const mutate of [input => { input.productId = 'other'; }, input => { input.profileId = 'other-profile'; }, input => { input.requestId = uuid(999); },
    input => { input.targetIds.reverse(); }, input => { input.catalog.inputFingerprint = 'f'.repeat(64); },
    input => { input.catalog.sourceVersion = '2026-10-14T00:00:00.000Z'; }, input => { input.catalog.image.key = 'owner-1/other.png'; },
    input => { input.catalog.company = companies[1]; }]) {
    const input = plain(f.input); mutate(input);
    await assert.rejects(client.recoverDetailFamily(input, f.preview, attempt, signal(), t.fetcher));
  }
  const otherCompany = fixture(companies[1]);
  await assert.rejects(client.recoverDetailFamily(otherCompany.input, otherCompany.preview, attempt, signal(), t.fetcher));
  for (const orphan of [{ pending: true }, { receipt: f.receipt }])
    await assert.rejects(client.recoverDetailFamily(f.input, f.preview, orphan, signal(), t.fetcher));
  assert.equal(t.calls.length, 1); assert.equal(attempt.pending, true);
});

test('session reload restores an unknown binding and recovers current or historical success by GET only', async () => {
  for (const current of [true, false]) {
    const f = fixture(), oldAttempt = {}, t = transport(() => { throw Error('saved but page lost ACK'); }, Response.json({ receipt: f.receipt, current }));
    await assert.rejects(client.commitDetailFamily(f.input, f.preview, oldAttempt, signal(), t.fetcher));
    const stored = plain({ input: f.input, preview: f.preview }), restored = client.restoredDetailFamilyAttempt(stored.input, stored.preview);
    assert.equal(restored.pending, true); assert.equal(restored.receipt, undefined);
    await assert.rejects(client.commitDetailFamily(stored.input, stored.preview, restored, signal(), t.fetcher));
    assert.deepEqual(plain(await client.recoverDetailFamily(stored.input, stored.preview, restored, signal(), t.fetcher)), { receipt: f.receipt, current });
    await assert.rejects(client.commitDetailFamily(stored.input, stored.preview, restored, signal(), t.fetcher));
    assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET']);
  }
});

test('reload keeps unknown state for generic 404 and clears only explicit absent ledger without unbinding scope', async () => {
  const f = fixture(), restored = client.restoredDetailFamilyAttempt(f.input, f.preview);
  const t = transport(Response.json({ error: 'not found' }, { status: 404 }),
    Response.json({ code: 'DETAIL_FAMILY_NOT_FOUND', receipt: null, current: false }, { status: 404 }));
  await assert.rejects(client.recoverDetailFamily(f.input, f.preview, restored, signal(), t.fetcher)); assert.equal(restored.pending, true);
  assert.equal(await client.recoverDetailFamily(f.input, f.preview, restored, signal(), t.fetcher), null);
  assert.equal(restored.pending, false);
  await assert.rejects(client.commitDetailFamily({ ...f.input, profileId: 'changed' }, f.preview, restored, signal(), t.fetcher));
  assert.deepEqual(t.calls.map(call => call.method), ['GET', 'GET']);
});

test('malformed serialized preview or changed company cannot be restored for a lookup', () => {
  const f = fixture();
  for (const mutate of [value => { value.requestId = uuid(999); }, value => { value.sourceProductId = 'other'; },
    value => { value.company = companies[1]; }, value => { value.targets[0].title = '검토하지 않은 이름'; },
    value => { value.targets.reverse(); }, value => { value.key = 'owner-1/other.png'; }]) {
    const preview = plain(f.preview); mutate(preview);
    assert.throws(() => client.restoredDetailFamilyAttempt(f.input, preview));
  }
});

test('already aborted catalog, preview, commit and recovery perform no request or pending write transition', async () => {
  const f = fixture(), controller = new AbortController(), attempt = {}, t = transport(); controller.abort();
  await assert.rejects(client.readDetailFamilyCatalog(f.input.productId, f.input.profileId, controller.signal, t.fetcher));
  await assert.rejects(client.previewDetailFamily(f.input, controller.signal, t.fetcher));
  await assert.rejects(client.commitDetailFamily(f.input, f.preview, attempt, controller.signal, t.fetcher));
  await assert.rejects(client.recoverDetailFamily(f.input, f.preview, attempt, controller.signal, t.fetcher));
  assert.equal(t.calls.length, 0); assert.equal(attempt.pending, undefined); assert.equal(attempt.receipt, undefined);
});

test('abort after dispatch keeps the commit unknown and fresh-signal recovery uses one GET', async () => {
  const f = fixture(), controller = new AbortController(), attempt = {}, t = transport(() => {
    controller.abort(); return Response.json({ receipt: f.receipt, current: true });
  }, Response.json({ receipt: f.receipt, current: true }));
  await assert.rejects(client.commitDetailFamily(f.input, f.preview, attempt, controller.signal, t.fetcher));
  assert.equal(attempt.pending, true); assert.equal(attempt.receipt, undefined);
  await client.recoverDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher);
  assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET']);
});

test('abort after read/preflight/recovery response does not adopt its result or clear an uncertain operation', async () => {
  const f = fixture();
  for (const operation of ['read', 'preview', 'recover']) {
    const controller = new AbortController(), attempt = client.restoredDetailFamilyAttempt(f.input, f.preview);
    const t = transport(() => { controller.abort(); return Response.json(operation === 'read' ? f.catalog : operation === 'preview' ? f.preview : { receipt: f.receipt, current: true }); });
    await assert.rejects(operation === 'read' ? client.readDetailFamilyCatalog(f.input.productId, f.input.profileId, controller.signal, t.fetcher)
      : operation === 'preview' ? client.previewDetailFamily(f.input, controller.signal, t.fetcher)
        : client.recoverDetailFamily(f.input, f.preview, attempt, controller.signal, t.fetcher));
    assert.equal(t.calls.length, 1); assert.equal(attempt.pending, true); assert.equal(attempt.receipt, undefined);
  }
});
