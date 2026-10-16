import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const company = { code: 'A01464742', name: '와이홉' }, context = { source: 'profile', profileId: 'cat', categoryId: '80719', categoryPath: ['시험', '분류'] },
  expected = { productVersion: '2026-10-16T00:00:00.000Z', revision: 0, contentRevision: 1, optionRevision: 1, inputFingerprint: 'a'.repeat(64), categoryContext: context },
  plain = value => JSON.parse(JSON.stringify(value));
async function fixture(run) { const h = mobileIntakeHarness(); try { await run(h.load('app/detail-workspace.ts')); } finally { h.close(); } }
const document = (m, photos, imageMargin = 0) => ({ format: 'detail-workspace-v1', photos, imageMargin, generatedHtml: m.generateDetailWorkspaceHtml(photos, imageMargin) });
const photo = (id, key, role = 'body', originKey = key) => ({ id, originKey, key, role });

test('workspace generator is deterministic, escapes private image paths and never accepts arbitrary HTML', () => fixture(m => {
  const rows = [photo('a', 'owner/a"<&.png'), photo('b', 'owner/a"<&.png')], doc = document(m, rows, 17), untouched = plain(doc);
  assert.match(doc.generatedHtml, /width:800px/u); assert.match(doc.generatedHtml, /padding:20px/u); assert.match(doc.generatedHtml, /width:760px/u); assert.match(doc.generatedHtml, /margin:0 0 17px 0/u);
  assert.match(doc.generatedHtml, /a%22%3C%26.png/u); assert.equal(doc.generatedHtml.includes('<script'), false);
  const owned = document(m, [photo('a', 'owner/a.png'), photo('b', 'owner/a.png')]), ownedUntouched = plain(owned);
  const valid = m.validateDetailWorkspaceDocument(owned, 'owner', ['owner/a.png'], null, { top: [], bottom: [] });
  valid.photos.reverse(); assert.deepEqual(owned, ownedUntouched); assert.deepEqual(doc, untouched);
  assert.throws(() => m.validateDetailWorkspaceDocument(doc, 'owner', [rows[0].key], null, { top: [], bottom: [] }));
  assert.throws(() => m.validateDetailWorkspaceDocument({ ...doc, generatedHtml: '<script>alert(1)</script>' }, 'owner', [rows[0].key]));
}));

test('stable IDs preserve original key while saved banners remain exact across body replacement and deletion', () => fixture(m => {
  const keys = ['owner/top.png', 'owner/one.png', 'owner/two.png'], roles = { top: [keys[0]], bottom: [] }, old = document(m, [photo('top', keys[0], 'top'), photo('body', keys[1])]);
  const next = document(m, [photo('top', keys[0], 'top'), photo('body', keys[2], 'body', keys[1])]);
  assert.deepEqual(plain(m.validateDetailWorkspaceDocument(next, 'owner', keys, old, roles)), next);
  assert.deepEqual(plain(m.validateDetailWorkspaceDocument(document(m, [next.photos[0]]), 'owner', keys, old, roles)).photos, [next.photos[0]]);
  for (const bad of [[next.photos[1], next.photos[0]], [next.photos[1]], [{ ...next.photos[0], id: 'recreated' }, next.photos[1]], [{ ...next.photos[0], key: keys[2] }, next.photos[1]]])
    assert.throws(() => m.validateDetailWorkspaceDocument(document(m, bad), 'owner', keys, old, roles));
  assert.throws(() => m.validateDetailWorkspaceDocument(document(m, [photo('body', keys[2])]), 'owner', keys, old, { top: [], bottom: [] }));
  assert.throws(() => m.validateDetailWorkspaceDocument(document(m, [photo('top', keys[0], 'body')]), 'owner', keys, old, { top: [], bottom: [] }));
  assert.throws(() => m.validateDetailWorkspaceDocument(document(m, [photo('new', keys[2], 'body', keys[1])]), 'owner', keys, old, { top: [], bottom: [] }));
}));

test('new photos take only actual disjoint top/bottom roles, never first/last heuristics', () => fixture(m => {
  const keys = ['owner/body.png', 'owner/bottom.png', 'owner/top.png'], roles = { top: [keys[2]], bottom: [keys[1]] }, rows = [photo('top', keys[2], 'top'), photo('middle', keys[0]), photo('bottom', keys[1], 'bottom')];
  assert.equal(m.validateDetailWorkspaceDocument(document(m, rows), 'owner', keys, null, roles).photos[1].role, 'body');
  assert.throws(() => m.validateDetailWorkspaceDocument(document(m, [rows[0], { ...rows[0], id: 'duplicate' }, ...rows.slice(1)]), 'owner', keys, null, roles));
  assert.throws(() => m.validateDetailWorkspaceDocument(document(m, [photo('fake', keys[0], 'top')]), 'owner', keys, null, roles));
  assert.throws(() => m.validateDetailWorkspaceRoles({ top: [keys[0]], bottom: [keys[0]] }, 'owner', keys));
}));

test('150 stable positions allow repeated owned keys while unknown fields, duplicate IDs and foreign/unpooled keys fail', () => fixture(m => {
  const keys = ['owner/photo.png'], rows = Array.from({ length: 150 }, (_, index) => photo('id-' + index, keys[0]));
  assert.equal(m.validateDetailWorkspaceDocument(document(m, rows), 'owner', keys, null, { top: [], bottom: [] }).photos.length, 150);
  assert.equal(m.validateDetailWorkspaceDocument(document(m, []), 'owner', keys, null, { top: [], bottom: [] }).photos.length, 0);
  for (const bad of [[rows[0], rows[0]], [...rows, photo('extra', keys[0])], [{ ...rows[0], extra: true }], [photo('foreign', 'other/a.png')], [photo('missing', 'owner/missing.png')]])
    assert.throws(() => m.validateDetailWorkspaceDocument({ format: 'detail-workspace-v1', photos: bad, imageMargin: 0, generatedHtml: '' }, 'owner', keys));
  for (const margin of [-1, 201, 0.5, '0']) assert.throws(() => m.generateDetailWorkspaceHtml(rows, margin));
}));

test('request identity normalizes key order but binds all clocks, exact context, option, revision and generated document', () => fixture(async m => {
  const doc = document(m, [photo('one', 'owner/a.png')]), first = await m.detailWorkspaceRequestId('product', 'option', 0, expected, doc);
  const reordered = { categoryContext: { categoryPath: context.categoryPath, categoryId: context.categoryId, profileId: context.profileId, source: context.source }, inputFingerprint: expected.inputFingerprint,
    optionRevision: 1, contentRevision: 1, revision: 0, productVersion: expected.productVersion };
  assert.equal(await m.detailWorkspaceRequestId('product', 'option', 0, reordered, { generatedHtml: doc.generatedHtml, imageMargin: 0, photos: doc.photos, format: doc.format }), first);
  for (const values of [['product', 'option', 1, expected, doc], ['product', 'other', 0, expected, doc], ['product', 'option', 0, { ...expected, revision: 1 }, doc], ['product', 'option', 0, expected, document(m, doc.photos, 1)]])
    assert.notEqual(await m.detailWorkspaceRequestId(...values), first);
  assert.throws(() => m.validateDetailWorkspaceExpectedView({ ...expected, extra: true }));
}));

test('record canonical digest binds exact identity, ordered origin/current file proofs and immutable metadata', () => fixture(async m => {
  const doc = document(m, [photo('one', 'owner/current.png', 'body', 'owner/origin.png')]), value = { format: 'detail-workspace-record-v1', productId: 'product', optionId: 'option', context, company,
    revision: 1, updatedAt: expected.productVersion, requestId: 'b'.repeat(64), document: doc,
    files: [{ key: 'owner/origin.png', sha256: 'c'.repeat(64), bytes: 100, width: 800, height: 100 }, { key: 'owner/current.png', sha256: 'd'.repeat(64), bytes: 101, width: 800, height: 90 }] };
  const digest = await m.detailWorkspaceDigest(value), record = { ...value, digest }, valid = m.validateDetailWorkspaceRecord(record, 'owner', 'product', 'option', context, company);
  assert.deepEqual(plain(valid), record); valid.document.photos[0].key = 'local'; assert.equal(record.document.photos[0].key, 'owner/current.png');
  for (const bad of [{ ...record, extra: true }, { ...record, files: [...record.files].reverse() }, { ...record, files: record.files.slice(0, 1) }, { ...record, files: [...record.files, record.files[0]] }])
    assert.throws(() => m.validateDetailWorkspaceRecord(bad, 'owner', 'product', 'option', context, company));
  assert.throws(() => m.validateDetailWorkspaceRecord(record, 'other', 'product', 'option', context, company));
  assert.throws(() => m.validateDetailWorkspaceRecord(record, 'owner', 'product', 'another', context, company));
  assert.notEqual(await m.detailWorkspaceDigest({ ...value, files: value.files.map((file, index) => index ? { ...file, bytes: 102 } : file) }), digest);
}));

test('workspace scope binds exact source, profile, category and path instead of category-code equivalence', () => fixture(async m => {
  const base = await m.detailWorkspaceScope(context);
  assert.equal(base, await m.detailWorkspaceScope({ categoryPath: [...context.categoryPath], categoryId: context.categoryId, profileId: context.profileId, source: context.source }));
  for (const changed of [{ ...context, source: 'collection' }, { ...context, profileId: 'other-profile' }, { ...context, categoryId: '80720' }, { ...context, categoryPath: ['다른', '분류'] }])
    assert.notEqual(await m.detailWorkspaceScope(changed), base);
}));
