import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { assetApiFixture, companies, module, plain } from './helpers/supplier-hub-single-assets.mjs';
import { SINGLE_DOCUMENT_LIVE_VERIFIED, dispatchSingleDocument } from '../extensions/supplier-hub/single-dispatch.mjs';
import { SINGLE_SENDER } from './helpers/supplier-hub-single-document.mjs';
import { createProductDocumentPacket, validateProductDocumentPacket, productDocumentPacketBinding, PRODUCT_DOCUMENT_REQUEST_TTL } from '../extensions/supplier-hub/product-document.mjs';

const compiler = module('app/supplier-hub-product-document.ts'), now = 1792368000000, requestId = 'f0abeef0-0728-4abe-8eee-000000000728';
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const digest = value => sha(canonical(value)), cases = [];
const owned = ['extensions/supplier-hub/product-document.mjs', 'extensions/supplier-hub/product-document.d.mts', 'tests/supplier-hub-product-transport.test.mjs'];
const sourceHashes = Object.fromEntries(owned.map(file => [file, sha(fs.readFileSync(new URL('../' + file, import.meta.url)))]));
after(() => fs.writeFileSync(new URL('../outputs/step728-product-transport-proof.json', import.meta.url), JSON.stringify({ sourceHashes, cases,
  boundary: 'Pure full-group packet validation over actual isolated local prepared package/compiler fixtures. No dispatch, source collection, Hub access, business writes or actual receipt.',
  productionGate: SINGLE_DOCUMENT_LIVE_VERIFIED, realProductWrites: 0, hubWrites: 0, externalRequests: 0 }, null, 2) + '\n'));
async function json(response) { assert.equal(response.status, 200, await response.clone().text()); return response.json(); }
function seal(review) {
  const value = plain(review), deferred = plain(value.body);
  for (const document of deferred.jsonDocument) for (const key of ['msrpAgree', 'labelContactAgreed']) if (document.imagePage && Object.hasOwn(document.imagePage, key)) document.imagePage[key] = false;
  value.originalBodySha256 = digest(value.body); value.preparedBodySha256 = digest(deferred);
  value.reviewDigest = digest({ format: value.format, type: value.type, identity: value.identity, members: value.members, originalBodySha256: value.originalBodySha256, preparedBodySha256: value.preparedBodySha256 });
  return value;
}
const packet = review => ({ type: 'YOOFAM_PRODUCT_DOCUMENT_REQUEST', version: 1, requestId, createdAt: now, review: plain(review) });
const options = { now, requestId, createdAt: now };
const samples = new Map();
async function sample(company = companies[0]) {
  if (samples.has(company.code)) return plain(samples.get(company.code));
  const f = await assetApiFixture(company);
  try {
    let view = await json(await f.h.route(f.base + '/quotation-fields' + f.query));
    view = await json(await f.h.route(f.base + '/quotation-fields' + f.query, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [
      { fieldKey: f.byWire(['startPage', 'productName']), optionId: 'synthetic-one', value: '전체 상품 첫 옵션' },
      { fieldKey: f.byWire(['startPage', 'productName']), optionId: 'synthetic-two', value: '전체 상품 두 옵션 <수정>' },
      { fieldKey: f.byWire(['productPage', 'modelNumber']), optionId: 'synthetic-two', value: 'MODEL-728-TWO' },
      ...[['supplyPrice', '3333', ['productPage', 'commonAttributes', 'purchasePrice']], ['salePrice', '4444', ['productPage', 'commonAttributes', 'coupangSalePrice']], ['msrp', '5555', ['productPage', 'commonAttributes', 'msrp']]]
        .flatMap(([key, value, path]) => [...new Set([key, f.byWire(path)])].map(fieldKey => ({ fieldKey, optionId: 'synthetic-two', value }))),
    ] } }));
    const unprepared = await json(await f.h.route(f.endpoint)); assert.equal(unprepared.review.canPrepare, true, JSON.stringify(unprepared.review));
    const prepared = await json(await f.prepare(unprepared.fingerprint)), before = f.state(), objects = f.objectState();
    const review = await compiler.compileSupplierHubProductDocument({ packageView: prepared, quotationView: view, ownerId: 'owner' });
    assert.equal(f.state(), before); assert.equal(f.objectState(), objects); assert.equal(f.h.network.length, 0);
    samples.set(company.code, plain(review)); return plain(review);
  } finally { f.close(); }
}

for (const company of companies) test(`actual compiled full group remains one immutable request (${company.code})`, async () => {
  const review = await sample(company), before = canonical(review), value = await createProductDocumentPacket(review, options);
  const result = await validateProductDocumentPacket(value, { now, ownerId: 'owner', company });
  assert.equal(value.type, 'YOOFAM_PRODUCT_DOCUMENT_REQUEST'); assert.equal(value.version, 1); assert.equal(value.requestId, requestId); assert.equal(value.createdAt, now);
  assert.deepEqual(result.packet.review.body, review.body); assert.equal(result.packet.review.body.jsonDocument.length, 2);
  assert.deepEqual(result.binding.members.map(member => member.optionId), ['synthetic-one', 'synthetic-two']);
  assert.deepEqual(result.binding.members.map(member => member.documentIndex), [0, 1]); assert.equal(JSON.stringify(result).includes('synthetic-excluded'), false);
  assert.deepEqual(result.packet.review.body.jsonDocument.map(document => document.productPage.modelNumber), ['', 'MODEL-728-TWO']);
  assert.deepEqual(result.packet.review.body.jsonDocument.map(document => document.productPage.commonAttributes.coupangSalePrice), ['19930', '4444']);
  assert.equal(result.packet.review.body.productName, result.packet.review.body.jsonDocument[0].startPage.productName);
  assert.equal(result.binding.originalBodySha256, digest(review.body)); assert.deepEqual(result.binding, await productDocumentPacketBinding(value, { now }));
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.packet.review.body.jsonDocument[1]) && Object.isFrozen(result.binding.members[1]));
  assert.throws(() => { result.binding.members[0].optionId = 'changed'; }, TypeError); assert.equal(canonical(review), before);
  for (const state of [result, result.binding, result.packet.review]) { assert.equal(state.remoteWrites, false); assert.equal(state.registered, false); assert.equal(state.submissionReady, false); }
  await assert.rejects(dispatchSingleDocument({ action: 'preview', packet: value }, SINGLE_SENDER)); assert.equal(SINGLE_DOCUMENT_LIVE_VERIFIED, false);
  cases.push({ name: 'actual compiler ' + company.code, included: 2, excluded: 1, wholeBody: true, scalarFallback: false });
});

test('all-row agreement deferral keeps original flags, blanks and unknown saved values exact', async () => {
  const review = await sample(); review.body.jsonDocument[0].imagePage.msrpAgree = true; review.body.jsonDocument[1].imagePage.labelContactAgreed = true;
  review.body.jsonDocument[1].productPage.msrpAgree = true;
  review.body.jsonDocument[1].productPage.futureSavedForm = { blank: '', nullable: null, zero: 0, flag: false, rows: ['원문', { nested: '그대로' }] };
  const sealed = seal(review), before = canonical(sealed), result = await validateProductDocumentPacket(packet(sealed), { now });
  assert.equal(result.packet.review.body.jsonDocument[0].imagePage.msrpAgree, true); assert.equal(result.packet.review.body.jsonDocument[1].imagePage.labelContactAgreed, true);
  for (const document of result.preparedBody.jsonDocument) for (const key of ['msrpAgree', 'labelContactAgreed']) if (Object.hasOwn(document.imagePage, key)) assert.equal(document.imagePage[key], false);
  assert.equal(result.preparedBody.jsonDocument[1].productPage.msrpAgree, true); assert.deepEqual(result.preparedBody.jsonDocument[1].productPage.futureSavedForm, review.body.jsonDocument[1].productPage.futureSavedForm);
  assert.equal(result.binding.preparedBodySha256, digest(result.preparedBody)); assert.notEqual(result.binding.originalBodySha256, result.binding.preparedBodySha256); assert.equal(canonical(sealed), before);
  cases.push({ name: 'all row defer', documents: 2, unrelatedFlagsPreserved: true, manualBlankPreserved: true });
});

test('complete member ordering, every document and saved account bind the logical digest', async () => {
  const review = await sample(), initial = await productDocumentPacketBinding(packet(review), { now });
  const mutations = [v => { v.members.reverse(); v.members.forEach((member, index) => member.documentIndex = index); v.body.jsonDocument.reverse(); v.body.productName = v.body.jsonDocument[0].startPage.productName; },
    v => { v.body.jsonDocument[1].productPage.modelNumber = ''; }, v => { v.body.jsonDocument[1].productPage.commonAttributes.coupangSalePrice = '0'; },
    v => { v.members[1].optionLabel = '옵션 이름 변경'; }, v => { v.identity.source.optionRevision++; }, v => { v.identity.ownerId = 'other-owner'; }];
  for (const mutate of mutations) { const changed = plain(review); mutate(changed); const result = await productDocumentPacketBinding(packet(seal(changed)), { now }); assert.notEqual(result.packetDigest, initial.packetDigest); }
  const duplicateRequest = { ...packet(review), requestId: 'f0abeef0-0728-4abe-8eee-000000000729', createdAt: now + 1 };
  assert.equal((await productDocumentPacketBinding(duplicateRequest, { now: now + 1 })).packetDigest, initial.packetDigest);
  cases.push({ name: 'group digest', orderedMembersBound: true, secondBodyBound: true, companyOwnerSourceBound: true, requestNonceNotLogicalIdentity: true });
});

test('nullable captured profile is supported without selecting a live profile', async () => {
  const review = await sample(); review.identity.profileId = null; review.identity.requestedProfileId = null; review.identity.source.profileId = null; review.identity.source.profileRevision = null;
  const result = await validateProductDocumentPacket(packet(seal(review)), { now }); assert.equal(result.binding.identity.profileId, null); assert.equal(result.binding.identity.requestedProfileId, null);
  const captured = await sample(); captured.identity.requestedProfileId = null; assert.equal((await validateProductDocumentPacket(packet(seal(captured)), { now })).binding.identity.requestedProfileId, null);
  cases.push({ name: 'nullable capture', noImplicitProfileSelection: true });
});

test('malformed member sets, non-new documents, unknown pages and category/title mismatches reject even rehashed', async () => {
  const review = await sample(), mutations = [v => { v.members = []; v.body.jsonDocument = []; }, v => { v.members[1].optionId = null; }, v => { v.members[1].optionId = v.members[0].optionId; },
    v => { v.members[1].documentIndex = 0; }, v => { v.members[1].optionId = 'bad option id'; }, v => { v.members[1].extra = 'unknown'; }, v => { v.body.jsonDocument.pop(); },
    v => { v.body.docId = 728; }, v => { v.body.scope = 'Retail_Categorized_Bulk'; }, v => { v.body.jsonDocument[1].unknownPage = {}; }, v => { v.body.jsonDocument[1].productPage = 'not page'; },
    v => { v.body.jsonDocument[1].startPage.categoryPath = '다른 카테고리'; }, v => { v.body.jsonDocument[1].startPage.productName = ''; }, v => { v.body.productName = '다른 제목'; },
    v => { v.body.categoryPath = '정확한 코드 없는 경로'; v.body.jsonDocument.forEach(document => document.startPage.categoryPath = v.body.categoryPath); },
    v => { v.body.jsonDocument[1].imagePage.msrpAgree = 'false'; }, v => { v.identity.company.name = '다른 회사'; }, v => { v.identity.source.profileId = 'different'; },
    v => { v.identity.requestedProfileId = 'different'; }, v => { v.identity.source.quotationRevision = -1; }, v => { v.remoteWrites = true; }, v => { v.registered = true; }, v => { v.submissionReady = true; }];
  for (const mutate of mutations) { const changed = plain(review); mutate(changed); await assert.rejects(validateProductDocumentPacket(packet(seal(changed)), { now })); }
  const many = plain(review); many.members = Array.from({ length: 201 }, (_, index) => ({ optionId: 'option-' + index, optionLabel: '', documentIndex: index })); many.body.jsonDocument = many.members.map(() => plain(review.body.jsonDocument[0]));
  await assert.rejects(validateProductDocumentPacket(packet(seal(many)), { now }));
  cases.push({ name: 'rehashed malformed contracts', rejected: mutations.length + 1, maxMembers: 200 });
});

test('body, prepared body and review digests are independently checked', async () => {
  const review = await sample();
  for (const hash of ['originalBodySha256', 'preparedBodySha256', 'reviewDigest']) { const value = packet(review); value.review[hash] = 'f'.repeat(64); await assert.rejects(validateProductDocumentPacket(value, { now }), { code: 'HASH' }); }
  const changed = packet(review); changed.review.body.jsonDocument[1].productPage.modelNumber = 'unsaved'; await assert.rejects(validateProductDocumentPacket(changed, { now }), { code: 'HASH' });
  cases.push({ name: 'all three hashes', independentHashFailures: 4 });
});

test('strict request envelope, UUID, TTL and future bounds never infer transmission', async () => {
  const review = await sample();
  const mutations = [v => { v.type = 'YOOFAM_SINGLE_DOCUMENT_TRANSPORT'; }, v => { v.version = 2; }, v => { v.requestId = 'not-uuid'; }, v => { v.requestId = 'f0abeef0-0728-1abe-8eee-000000000728'; },
    v => { v.optionId = 'synthetic-one'; }, v => { v.createdAt = now - PRODUCT_DOCUMENT_REQUEST_TTL; }, v => { v.createdAt = now + 5001; }, v => { v.createdAt = 0; }, v => { v.createdAt = now + 0.5; }];
  for (const mutate of mutations) { const value = packet(review); mutate(value); await assert.rejects(validateProductDocumentPacket(value, { now })); }
  await validateProductDocumentPacket({ ...packet(review), createdAt: now - PRODUCT_DOCUMENT_REQUEST_TTL + 1 }, { now });
  await validateProductDocumentPacket({ ...packet(review), createdAt: now + 5000 }, { now });
  await assert.rejects(validateProductDocumentPacket(packet(review), { now: NaN })); await assert.rejects(validateProductDocumentPacket(packet(review), { now, ownerId: 'other-owner' }), { code: 'ACCOUNT' });
  await assert.rejects(validateProductDocumentPacket(packet(review), { now, company: companies[1] }), { code: 'ACCOUNT' });
  cases.push({ name: 'request envelope', mutations: mutations.length, ttl: PRODUCT_DOCUMENT_REQUEST_TTL, futureTolerance: 5000, noRemoteAction: true });
});

test('unsafe descriptors, prototypes, secrets and sparse arrays reject without invoking getters or toJSON', async () => {
  const review = await sample(); let getters = 0, toJSON = 0;
  const makers = [() => { const value = {}; Object.defineProperty(value, 'value', { enumerable: true, get() { getters++; return 'secret'; } }); return value; },
    () => ({ toJSON() { toJSON++; return {}; } }), () => new Date(), () => new Map(), () => Object.create({ inherited: true }), () => JSON.parse('{"__proto__":{"polluted":true}}'),
    () => ({ Authorization: 'secret' }), () => ({ access_token: 'secret' }), () => ({ 'api-key': 'secret' }), () => ({ cookie: 'secret' }), () => [, 'sparse'],
    () => { const array = ['x']; Object.defineProperty(array, '0', { enumerable: true, get() { getters++; return 'bad'; } }); return array; },
    () => { const array = ['x']; array.extra = 1; return array; }, () => { const array = ['x']; Object.setPrototypeOf(array, {}); return array; },
    () => { const value = {}; Object.defineProperty(value, 'hidden', { value: 'bad' }); return value; }, () => ({ value: Symbol('bad') }), () => ({ value: undefined }), () => ({ value: NaN }),
    () => { const value = {}; value.self = value; return value; }];
  for (const make of makers) { const value = packet(review); value.review.body.jsonDocument[1].productPage.future = make(); await assert.rejects(validateProductDocumentPacket(value, { now })); }
  const top = {}; Object.defineProperty(top, 'review', { enumerable: true, get() { getters++; return review; } }); await assert.rejects(validateProductDocumentPacket(top, { now }));
  assert.equal(getters, 0); assert.equal(toJSON, 0); assert.equal({}.polluted, undefined);
  cases.push({ name: 'inert safe JSON', unsafeCases: makers.length + 1, getterCalls: getters, toJSONCalls: toJSON });
});

test('cross-realm plain JSON remains valid but excessive depth, nodes and UTF8 bytes do not', async () => {
  const review = await sample(), crossRealm = vm.runInNewContext('JSON.parse(' + JSON.stringify(JSON.stringify(packet(review))) + ')');
  assert.equal((await validateProductDocumentPacket(crossRealm, { now })).packet.review.body.jsonDocument.length, 2);
  const deep = packet(review); let value = { blank: '' }; for (let index = 0; index < 31; index++) value = { value }; deep.review.body.jsonDocument[1].productPage.future = value;
  await assert.rejects(validateProductDocumentPacket(deep, { now }), { code: 'JSON_LIMIT' });
  const nodes = packet(review); nodes.review.body.jsonDocument[1].productPage.future = Array.from({ length: 100001 }, () => 0); await assert.rejects(validateProductDocumentPacket(nodes, { now }), { code: 'JSON_LIMIT' });
  const bytes = packet(review); bytes.review.body.jsonDocument[1].productPage.future = '가'.repeat(3 * 1024 * 1024); await assert.rejects(validateProductDocumentPacket(bytes, { now }), { code: 'JSON_LIMIT' });
  cases.push({ name: 'bounded cross realm JSON', depth: 30, nodes: 100000, bytes: 6 * 1024 * 1024 });
});
