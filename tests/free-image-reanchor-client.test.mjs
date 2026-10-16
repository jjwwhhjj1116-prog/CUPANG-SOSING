import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cropClientFixture, plain } from './helpers/free-image-crop.mjs';

const sha = bytes => createHash('sha256').update(typeof bytes === 'string' ? bytes : Buffer.from(bytes)).digest('hex');
const signal = () => new AbortController().signal;
const policy = 'current-target-v1', options = { restoreEditor: true, anchorPolicy: policy };
const resultKey = 'owner/free-image-product-historical-result.png';
function fixture({ input = 'detailImages', slot = 2, profileId = 'current-profile', optionId = 'current-option' } = {}) {
  const h = cropClientFixture(), original = new TextEncoder().encode('verified immutable original bytes');
  const role = input === 'mainImage' ? 'main' : input === 'additionalImages' ? 'additional' : input === 'labelImages' ? 'label' : 'detail';
  if (input === 'mainImage') slot = 0;
  const keys = Array.from({ length: slot + 1 }, (_, index) => index === slot ? resultKey : `owner/current-${index}.png`);
  const target = { kind: 'quotation', profileId, optionId, input, fieldKey: 'exact-' + input, slotIndex: slot,
    revision: 11, inputFingerprint: 'c'.repeat(64), optionRevision: 4, value: keys.join('\n') };
  const drawing = h.brush.createFreeImageBrush(2, [{ x: 5, y: 7 }, { x: 8, y: 8 }], 20, 12);
  const document = plain({ format: 'free-image-edit-v1', width: 20, height: 12, sourceLanguage: 'en', regions: [
    { ...h.region('manual-7', { x: 2, y: 1, width: 10, height: 5 }, '현재 옵션에서 재편집'), translationProvenance: 'manual', fontFamily: 'mono', bold: true, textAlign: 'center', lineHeight: 1.5 },
    { ...h.region('brush-8', drawing.box, ''), text: '', translated: '', translationProvenance: 'manual', erase: true, brush: drawing.brush },
    { ...h.region('manual-9', { x: 1, y: 1, width: 2, height: 2 }, ''), text: '', translated: '', selected: false, translationProvenance: 'manual' },
  ], crop: { x: 1, y: 1, width: 12, height: 9, sourceWidth: 20, sourceHeight: 12 } });
  const proof = { ...h.source, role, sourceSha256: sha(original), quotationTarget: { ...target, bindingSha256: 'b'.repeat(64) },
    editorSource: { resultKey, resultSha256: 'd'.repeat(64), documentSha256: sha(JSON.stringify(document)), anchorPolicy: policy } };
  const calls = [];
  const read = (fetcher = async (url, init) => {
    calls.push({ url, init }); return calls.length === 1 ? Response.json({ source: proof, editDocument: document }) : new Response(original);
  }, selectedOptions = options, request = target, abortSignal = signal()) => h.client.readFreeImageSource('product', h.source.productVersion, resultKey, role, abortSignal, fetcher, request, selectedOptions);
  return { ...h, original, role, target, document, proof, calls, read };
}

for (const input of ['mainImage', 'additionalImages', 'detailImages', 'labelImages']) test(`explicit current-target read binds the exact present ${input} slot and restores original canvas parameters`, async () => {
  const f = fixture({ input }), before = JSON.stringify([f.proof, f.document]), loaded = await f.read();
  const query = new URL(f.calls[0].url, 'https://local.test').searchParams;
  assert.equal(query.get('editor'), 'saved-current-target-v1'); assert.equal(query.get('sourceKey'), resultKey);
  assert.equal(query.get('optionId'), f.target.optionId); assert.equal(query.get('fieldKey'), f.target.fieldKey);
  assert.equal(query.get('slotIndex'), String(f.target.slotIndex)); assert.equal(query.get('profileId'), f.target.profileId);
  assert.equal(query.has('historicalOptionId'), false); assert.equal(query.has('value'), false);
  assert.equal(f.calls[1].url, '/api/files/owner/original.png'); assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(call => call.init.method === undefined && call.init.cache === 'no-store'));
  assert.deepEqual(plain(loaded.source.quotationTarget), f.proof.quotationTarget);
  assert.equal(loaded.source.editorSource.anchorPolicy, policy); assert.deepEqual(plain(loaded.editDocument), f.document);
  assert.deepEqual([loaded.width, loaded.height], [20, 12]); assert.equal(JSON.stringify([f.proof, f.document]), before);
});

test('same-product reordered and reused results use current option, role, field, revision and slot independently for each new read', async () => {
  const one = fixture({ input: 'detailImages', slot: 0, optionId: 'reordered-original-option', profileId: 'same-saved-profile' }),
    two = fixture({ input: 'additionalImages', slot: 2, optionId: 'other-current-option', profileId: 'same-saved-profile' });
  const [left, right] = await Promise.all([one.read(), two.read()]);
  assert.equal(left.source.sourceKey, right.source.sourceKey); assert.equal(left.source.editorSource.resultKey, right.source.editorSource.resultKey);
  assert.equal(left.source.quotationTarget.slotIndex, 0); assert.equal(right.source.quotationTarget.slotIndex, 2);
  assert.equal(left.source.role, 'detail'); assert.equal(right.source.role, 'additional');
  assert.notEqual(left.source.quotationTarget.optionId, right.source.quotationTarget.optionId);
  assert.deepEqual(plain(left.editDocument), plain(right.editDocument));
  assert.deepEqual([...one.calls, ...two.calls].map(call => call.init.method).filter(Boolean), [], 'read and reuse never mutate a quotation');
});

test('new and legacy saved policies cannot accept each other or silently discard a missing/unknown returned policy', async () => {
  for (const requested of [options, { restoreEditor: true }]) for (const returned of [undefined, policy, 'unsupported-policy']) {
    const f = fixture(), source = plain(f.proof), calls = [];
    if (returned === undefined) delete source.editorSource.anchorPolicy; else source.editorSource.anchorPolicy = returned;
    const run = f.read(async (url, init) => { calls.push({ url, init }); return calls.length === 1 ? Response.json({ source, editDocument: f.document }) : new Response(f.original); }, requested);
    const expected = requested.anchorPolicy === returned;
    if (expected) await run; else await assert.rejects(run);
    assert.equal(new URL(calls[0].url, 'https://local.test').searchParams.get('editor'), requested.anchorPolicy ? 'saved-current-target-v1' : 'saved');
    assert.equal(calls.length, expected ? 2 : 1, 'policy mismatches fail before reading any original bytes');
  }
});

test('a different current target, result, source product/version or document hash fails before original bytes are read', async () => {
  for (const mode of ['product', 'version', 'result', 'option', 'slot', 'field', 'profile', 'revision', 'option-revision', 'fingerprint', 'value', 'document']) {
    const f = fixture(), source = plain(f.proof), doc = plain(f.document), calls = [];
    if (mode === 'product') source.productId = 'different-product';
    if (mode === 'version') source.productVersion = '2026-10-06T00:00:05.000Z';
    if (mode === 'result') source.editorSource.resultKey = 'owner/free-image-product-other.png';
    if (mode === 'option') source.quotationTarget.optionId = 'stale-option';
    if (mode === 'slot') source.quotationTarget.slotIndex = 0;
    if (mode === 'field') source.quotationTarget.fieldKey = 'detailImages';
    if (mode === 'profile') source.quotationTarget.profileId = 'different-profile';
    if (mode === 'revision') source.quotationTarget.revision--;
    if (mode === 'option-revision') source.quotationTarget.optionRevision--;
    if (mode === 'fingerprint') source.quotationTarget.inputFingerprint = 'e'.repeat(64);
    if (mode === 'value') source.quotationTarget.value = 'owner/removed.png\n' + source.quotationTarget.value;
    if (mode === 'document') doc.regions[2].translated = 'tampered unchecked text';
    await assert.rejects(f.read(async (url, init) => { calls.push({ url, init }); return Response.json({ source, editDocument: doc }); }));
    assert.equal(calls.length, 1, mode + ' must not read pixels or try a legacy fallback');
  }
});

test('only specific missing-document404 downgrades a new-policy request to a plain legacy result read', async () => {
  for (const [status, code] of [[404, 'image-edit-document-missing'], [404, undefined], [404, 'not-found'], [403, 'image-edit-document-missing'],
    [409, 'image-edit-document-missing'], [503, 'image-edit-document-missing']]) {
    const f = fixture(), calls = [], bytes = new TextEncoder().encode('legacy flattened result'),
      flattened = { ...f.proof, sourceKey: resultKey, sourceSha256: sha(bytes) }; delete flattened.editorSource;
    const run = f.read(async (url, init) => { calls.push({ url, init }); return calls.length === 1 ? Response.json({ error: 'no document', ...(code ? { code } : {}) }, { status })
      : calls.length === 2 ? Response.json({ source: flattened }) : new Response(bytes); });
    if (status === 404 && code === 'image-edit-document-missing') {
      const loaded = await run; assert.equal(loaded.editDocument, undefined); assert.equal(calls.length, 3);
      assert.equal(new URL(calls[1].url, 'https://local.test').searchParams.has('editor'), false);
      assert.equal(calls[2].url, '/api/files/' + resultKey);
    } else { await assert.rejects(run); assert.equal(calls.length, 1); }
  }
  for (const missing of ['document', 'editor-proof', 'both']) {
    const f = fixture(), source = plain(f.proof), calls = [];
    if (missing !== 'document') delete source.editorSource;
    await assert.rejects(f.read(async url => { calls.push(url); return Response.json({ source, ...(missing === 'editor-proof' ? { editDocument: f.document } : {}) }); }));
    assert.equal(calls.length, 1, 'a200 incomplete proof cannot silently downgrade');
  }
});

test('ordinary originals and explicit no-restore reads retain the original source contract without requesting a reanchor', async () => {
  for (const withTarget of [true, false]) {
    const h = cropClientFixture(), original = new TextEncoder().encode('ordinary source bytes'), calls = [],
      target = { ...fixture().target, slotIndex: 0, value: h.source.sourceKey },
      source = { ...h.source, sourceSha256: sha(original), ...(withTarget ? { quotationTarget: { ...target, bindingSha256: 'b'.repeat(64) } } : {}) };
    const loaded = await h.client.readFreeImageSource('product', h.source.productVersion, h.source.sourceKey, 'detail', signal(), async (url, init) => {
      calls.push({ url, init }); return calls.length === 1 ? Response.json({ source }) : new Response(original);
    }, withTarget ? target : undefined, withTarget ? options : { restoreEditor: true });
    assert.equal(loaded.editDocument, undefined); assert.equal(new URL(calls[0].url, 'https://local.test').searchParams.has('editor'), false);
    assert.equal(calls[1].url, '/api/files/owner/original.png');
  }
  const f = fixture(), source = { ...f.proof, sourceKey: resultKey, sourceSha256: sha(f.original) }; delete source.editorSource;
  const calls = [], loaded = await f.client.readFreeImageSource('product', f.source.productVersion, resultKey, f.role, signal(),
    async url => { calls.push(url); return calls.length === 1 ? Response.json({ source }) : new Response(f.original); }, f.target);
  assert.equal(loaded.editDocument, undefined); assert.equal(new URL(calls[0], 'https://local.test').searchParams.has('editor'), false);
});

test('unsupported current-target policies and a policy without an explicit quotation target fail before fetching', async () => {
  for (const [selectedOptions, withTarget] of [[{ restoreEditor: true, anchorPolicy: 'other-policy' }, true],
    [{ restoreEditor: false, anchorPolicy: policy }, true], [options, false]]) {
    const f = fixture(); let calls = 0;
    await assert.rejects(f.client.readFreeImageSource('product', f.source.productVersion, resultKey, f.role, signal(), async () => {
      calls++; throw Error('policy must be rejected before request');
    }, withTarget ? f.target : undefined, selectedOptions));
    assert.equal(calls, 0);
  }
});

test('new-policy rerender and apply/recovery preserve the current target policy and use no historical write authorization', async () => {
  const f = fixture({ input: 'additionalImages', optionId: 'new-current-option', slot: 0 }), loaded = await f.read(),
    { x, y, width, height } = loaded.editDocument.crop,
    rendered = await f.client.renderFreeImageTranslation(loaded, loaded.editDocument.regions, signal(), [], { x, y, width, height }, loaded.editDocument.sourceLanguage),
    key = await f.client.expectedFreeImageOutputKey(rendered), documentSha256 = sha(JSON.stringify(rendered.editDocument)), calls = [];
  const oldProof = { ...rendered, source: plain(rendered.source) }; delete oldProof.source.editorSource.anchorPolicy;
  assert.notEqual(await f.client.expectedFreeImageOutputKey(oldProof), key, 'policy participates in the immutable operation identity');
  const receipt = { source: rendered.source, key, applied: true, productVersion: '2026-10-06T00:00:03.000Z', contentRevision: rendered.source.contentRevision,
    optionRevision: f.target.optionRevision, quotationRevision: f.target.revision + 1, quotationInputFingerprint: 'e'.repeat(64), crop: plain(rendered.crop), editDocumentSha256: documentSha256 };
  await f.client.applyFreeImageTranslation(rendered, signal(), async (_url, init) => {
    calls.push('apply'); const source = JSON.parse(init.body.get('source'));
    assert.equal(source.editorSource.anchorPolicy, policy); assert.deepEqual(source.quotationTarget, f.proof.quotationTarget);
    assert.deepEqual(JSON.parse(init.body.get('editDocument')), plain(rendered.editDocument)); return Response.json(receipt);
  });
  const recovery = await f.client.recoverFreeImageTranslation(rendered, signal(), async (_url, init) => {
    calls.push('recover'); const body = JSON.parse(init.body); assert.equal(body.action, 'recover'); assert.equal(body.source.editorSource.anchorPolicy, policy);
    assert.deepEqual(body.source.quotationTarget, f.proof.quotationTarget); assert.equal(body.outputSha256, sha(await rendered.output.arrayBuffer()));
    return Response.json({ ...receipt, replayed: true });
  });
  assert.equal(recovery.applied, true); assert.deepEqual(calls, ['apply', 'recover']);
  const downgraded = plain(receipt); delete downgraded.source.editorSource.anchorPolicy;
  await assert.rejects(f.client.applyFreeImageTranslation(rendered, signal(), async () => Response.json(downgraded)), error => error.uncertain === true);
});

test('aborted current-target preparation cannot read pixels, decode a document or trigger a fallback', async () => {
  const f = fixture(), pre = new AbortController(); pre.abort(); let reads = 0;
  await assert.rejects(f.read(async () => { reads++; throw Error('must not fetch'); }, options, f.target, pre.signal)); assert.equal(reads, 0);
  const during = new AbortController();
  await assert.rejects(f.read(async () => { reads++; during.abort(); return Response.json({ source: f.proof, editDocument: f.document }); }, options, f.target, during.signal));
  assert.equal(reads, 1, 'abort after the target proof prevents original reads and all fallback requests');
});
