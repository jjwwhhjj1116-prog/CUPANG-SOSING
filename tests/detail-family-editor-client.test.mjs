import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Reuse the established TS VM/fake-fetch adapter without registering its tests.
const sourceUrl = new URL('./detail-family-client.test.mjs', import.meta.url), source = fs.readFileSync(sourceUrl, 'utf8');
const ast = ts.createSourceFile(sourceUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), parts = [];
for (const statement of ast.statements) {
  if (ts.isImportDeclaration(statement)) {
    const name = statement.moduleSpecifier.text, resolved = name.startsWith('.') ? new URL(name, sourceUrl).href : import.meta.resolve(name);
    parts.push(statement.getText(ast).replace(statement.moduleSpecifier.getText(ast), JSON.stringify(resolved)));
  } else if (ts.isVariableStatement(statement) || ts.isFunctionDeclaration(statement)) parts.push(statement.getText(ast).replaceAll('import.meta.url', JSON.stringify(sourceUrl.href)));
  else break;
}
const { client, fixture: baseFixture, plain, uuid, signal, transport, companies } = await import('data:text/javascript,'
  + encodeURIComponent(parts.join('\n') + '\nexport { client, fixture, plain, uuid, signal, transport, companies };'));
const policy = 'saved-inputs-v1';
function fixture(company = companies[0], expanded = true) {
  const f = baseFixture(company), uploadId = 'e'.repeat(64);
  f.catalog.image.key = `owner-1/quotation-label-${uploadId}.png`;
  if (expanded) f.catalog.editor = { policy, images: 2, categoryId: '81221' };
  const input = plain(client.createDetailFamilyInput(f.input.productId, f.input.profileId, f.catalog, f.input.targetIds, f.input.requestId, expanded ? policy : undefined));
  const inputs = { format: 'saved-detail-inputs-v1', categoryId: '81221', origin: { productId: 'earlier-family-source', sourceOptionId: 'historical-source-option', uploadId, revision: 17 },
    output: { key: f.catalog.image.key, sha256: f.catalog.image.sha256, bytes: f.catalog.image.bytes },
    images: [{ key: 'owner-1/first.png', sha256: 'f'.repeat(64), width: 400, height: 100 }, { key: 'owner-1/second.png', sha256: 'a'.repeat(64), width: 800, height: 200 }] };
  const preview = { ...f.preview, key: f.catalog.image.key, ...(expanded ? { editor: { policy, inputs } } : {}) };
  const receipt = { ...f.receipt, key: f.catalog.image.key, ...(expanded ? { editor: plain(preview.editor) } : {}) };
  return { ...f, input, inputs, preview, receipt };
}

for (const company of companies) test(`expanded catalog/policy emits the reviewed editor mode for preview and commit (${company.code})`, async () => {
  const f = fixture(company), t = transport(Response.json(f.preview), Response.json({ receipt: f.receipt, current: true })), attempt = {};
  assert.deepEqual(plain(client.validateDetailFamilyCatalog(f.input.productId, f.catalog)), f.catalog);
  assert.deepEqual(plain(await client.previewDetailFamily(f.input, signal(), t.fetcher)), f.preview);
  assert.deepEqual(plain(await client.commitDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher)), { receipt: f.receipt, current: true });
  assert.ok(t.calls.every(call => call.body.editorPolicy === policy));
  assert.deepEqual(t.calls[0].body, { action: 'preview', requestId: f.input.requestId, expectedInputFingerprint: f.catalog.inputFingerprint, targetIds: f.input.targetIds, editorPolicy: policy });
  assert.equal(t.calls[1].body.previewFingerprint, f.preview.fingerprint);
  assert.equal(attempt.receipt.editor.inputs.origin.productId, 'earlier-family-source', 'copied source provenance is retained');
});

test('catalog summary requires exactly known policy, bounded image count and valid saved category identity', () => {
  const f = fixture();
  for (const editor of [null, [], { ...f.catalog.editor, policy: 'unknown-policy' }, { ...f.catalog.editor, images: 0 },
    { ...f.catalog.editor, images: 151 }, { ...f.catalog.editor, images: 1.5 }, { policy, images: 2 },
    ...['', ' ', 'bad/category', 'x'.repeat(101)].map(categoryId => ({ ...f.catalog.editor, categoryId })),
    { ...f.catalog.editor, unexpected: true }]) {
    assert.throws(() => client.validateDetailFamilyCatalog(f.input.productId, { ...f.catalog, editor }), JSON.stringify(editor));
  }
});

test('new mode needs matching supported catalog summary while an explicit old mode stays unexpanded', () => {
  const f = fixture();
  assert.throws(() => client.createDetailFamilyInput(f.input.productId, f.input.profileId, f.catalog, f.input.targetIds, uuid(990), 'unknown-policy'));
  const oldCatalog = plain(f.catalog); delete oldCatalog.editor;
  assert.throws(() => client.createDetailFamilyInput(f.input.productId, f.input.profileId, oldCatalog, f.input.targetIds, uuid(990), policy));
  const legacy = client.createDetailFamilyInput(f.input.productId, f.input.profileId, f.catalog, f.input.targetIds, uuid(990));
  assert.equal(Object.hasOwn(legacy, 'editorPolicy'), false, 'catalog support alone cannot silently expand an old reviewed request');
});

test('preview editor document binds catalog category, owner, output digest/size and bounded pre-composite image metadata', () => {
  const f = fixture();
  for (const mutate of [value => { delete value.editor; }, value => { value.editor.policy = 'unknown-policy'; },
    value => { value.editor.inputs.categoryId = 'other-category'; }, value => { value.editor.inputs.origin.uploadId = 'a'.repeat(64); },
    value => { value.editor.inputs.output.key = 'owner-1/other.png'; }, value => { value.editor.inputs.output.sha256 = 'a'.repeat(64); },
    value => { value.editor.inputs.output.bytes++; }, value => { value.editor.inputs.images.pop(); },
    value => { value.editor.inputs.images[0].key = 'foreign/original.png'; }, value => { value.editor.inputs.images[0].key = 'owner-1/../image.png'; },
    value => { value.editor.inputs.images[0].sha256 = 'bad'; }, value => { value.editor.inputs.images[0].width = 0; },
    value => { value.editor.inputs.images[0].height = 16001; }, value => { value.editor.inputs.images[0].width = 1; value.editor.inputs.images[0].height = 21; },
    value => { value.editor.inputs.regions = []; }]) {
    const value = plain(f.preview); mutate(value); assert.throws(() => client.validateDetailFamilyPreview(f.input, value));
  }
});

test('a valid but different saved input order or origin cannot replace the exact reviewed receipt document', () => {
  const f = fixture(); assert.deepEqual(plain(client.validateDetailFamilyReceipt(f.input, f.preview, f.receipt)), f.receipt);
  for (const mutate of [value => { value.editor.inputs.images.reverse(); }, value => { value.editor.inputs.origin.productId = 'unreviewed-source'; },
    value => { value.editor.inputs.origin.revision++; }, value => { value.editor.inputs.images[0].sha256 = 'b'.repeat(64); },
    value => { delete value.editor; }, value => { value.editor.inputs.images[0].height = 0; }]) {
    const value = plain(f.receipt); mutate(value); assert.throws(() => client.validateDetailFamilyReceipt(f.input, f.preview, value));
  }
});

test('legacy unexpanded preview/receipt/session recovery remain valid without adding the new policy', async () => {
  const f = fixture(companies[0], false), stored = plain({ input: f.input, preview: f.preview });
  const attempt = client.restoredDetailFamilyAttempt(stored.input, stored.preview), t = transport(Response.json({ receipt: f.receipt, current: true }));
  assert.equal(Object.hasOwn(f.input, 'editorPolicy'), false); assert.equal(Object.hasOwn(f.preview, 'editor'), false);
  assert.equal((await client.recoverDetailFamily(stored.input, stored.preview, attempt, signal(), t.fetcher)).current, true);
  assert.deepEqual(t.calls.map(call => call.method), ['GET']); assert.equal(attempt.receipt.editor, undefined);
  assert.throws(() => client.validateDetailFamilyPreview(f.input, fixture().preview), 'an expanded response cannot upgrade an old request');
});

test('expanded lost ACK and reload recover the exact saved document through GET only', async () => {
  const f = fixture(companies[1]), attempt = {}, t = transport(() => { throw Error('lost expanded ACK'); }, Response.json({ receipt: f.receipt, current: true }));
  await assert.rejects(client.commitDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher)); assert.equal(attempt.pending, true);
  const stored = plain({ input: f.input, preview: f.preview }), restored = client.restoredDetailFamilyAttempt(stored.input, stored.preview);
  await assert.rejects(client.commitDetailFamily(stored.input, stored.preview, restored, signal(), t.fetcher));
  assert.deepEqual(plain(await client.recoverDetailFamily(stored.input, stored.preview, restored, signal(), t.fetcher)), { receipt: f.receipt, current: true });
  assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET']); assert.equal(restored.receipt.editor.inputs.images.length, 2);
});

test('bound mode, catalog category and saved input proof cannot change across a pending session', async () => {
  const f = fixture(), attempt = client.restoredDetailFamilyAttempt(f.input, f.preview), t = transport();
  for (const mutate of [input => { delete input.editorPolicy; }, input => { input.editorPolicy = 'unknown-policy'; },
    input => { input.catalog.editor.categoryId = 'other-category'; }, input => { input.catalog.editor.images++; },
    input => { input.catalog.company = companies[1]; }]) {
    const input = plain(f.input); mutate(input); await assert.rejects(client.recoverDetailFamily(input, f.preview, attempt, signal(), t.fetcher));
  }
  const changed = plain(f.preview); changed.editor.inputs.images.reverse();
  await assert.rejects(client.recoverDetailFamily(f.input, changed, attempt, signal(), t.fetcher)); assert.equal(t.calls.length, 0);
});

test('a corrupt expanded ACK stays unknown and only the original exact document can resolve it', async () => {
  const f = fixture(), wrong = plain(f.receipt); wrong.editor.inputs.images.reverse();
  const attempt = {}, t = transport(Response.json({ receipt: wrong, current: true }), Response.json({ receipt: f.receipt, current: false }));
  await assert.rejects(client.commitDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher)); assert.equal(attempt.pending, true);
  const recovered = await client.recoverDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher); assert.equal(recovered.current, false);
  await assert.rejects(client.commitDetailFamily(f.input, f.preview, attempt, signal(), t.fetcher));
  assert.deepEqual(t.calls.map(call => call.method), ['POST', 'GET']); assert.deepEqual(plain(recovered.receipt.editor), f.preview.editor);
});
