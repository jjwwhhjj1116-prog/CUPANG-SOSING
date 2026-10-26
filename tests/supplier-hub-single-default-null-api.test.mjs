import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { apiFixture } from './helpers/supplier-hub-single-projection.mjs';
import { sizeChartApiFixture, sizeKeys, companies, module, plain, json, publicKeys, allTables } from './helpers/supplier-hub-single-size-chart.mjs';
import { SINGLE_DOCUMENT_LIVE_VERIFIED } from '../extensions/supplier-hub/single-dispatch.mjs';

const names = ['Global Trade Item Number', 'Parent Manufacturer Part Number', 'Manufacturer Part Number'];
const hiddenPath = ['productPage', 'unexposedAttributes'];
const recordedFile = new URL('../outputs/step650-official-81452-profile-after.json', import.meta.url);
const recorded = fs.existsSync(recordedFile) ? JSON.parse(fs.readFileSync(recordedFile, 'utf8')) : null;
const sourceFiles = ['app/supplier-hub-single-projection.ts', 'app/supplier-hub-schema.ts', 'app/quotation-schema.ts', 'app/initial-legal-notices.ts',
  'app/exports/single-package.ts', 'app/supplier-hub-single-assets.ts', 'app/supplier-hub-single-client.ts', 'tests/supplier-hub-single-default-null-api.test.mjs'];
const sha = value => createHash('sha256').update(value).digest('hex');
const hashes = () => Object.fromEntries(sourceFiles.map(file => [file, sha(fs.readFileSync(new URL('../' + file, import.meta.url)))]));
const frozen = hashes(), proof = [];
const hiddenValues = document => names.map(name => document.productPage.unexposedAttributes.find(item => item.attributeName === name)?.attributeValue);
const withoutTargetAttributes = payload => {
  const copy = plain(payload);
  for (const document of copy.jsonDocument) document.productPage.unexposedAttributes = document.productPage.unexposedAttributes.filter(item => !names.includes(item.attributeName));
  return copy;
};
const exactNodes = () => recorded ? JSON.parse(recorded.hubSchema.schemaString).properties.productPage.properties.unexposedAttributes.allOf
  .filter(item => names.includes(item.contains.properties.attributeName.enum[0])) : names.map(name => ({ contains: { type: 'object', required: ['attributeName', 'attributeValue'], properties: {
    attributeName: { type: 'string', enum: [name], exposed: false, requirement: '선택' }, attributeValue: { type: ['string', 'null'] },
  } } }));

after(() => {
  assert.deepEqual(hashes(), frozen, 'source changed during the focused integration run');
  if (proof.length) fs.writeFileSync(new URL('../outputs/step701-null-api-proof.json', import.meta.url), JSON.stringify({ format: 'single-default-null-api-proof-v1', sourceHashes: frozen,
    recordedSchemaAvailable: Boolean(recorded), cases: proof, boundary: 'Actual local API/SQLite/R2 and client packet serialization. Synthetic source facts, PNGs and accounts. Recorded 81452 wire nodes, when available, are reused for both isolated companies; this does not prove either live company schema or a Hub submission.',
    externalRequests: 0, browserActions: 0, productionWrites: 0, supplierHubWrites: 0, approveRequests: 0, executeRequests: 0, applyRequests: 0, liveGate: SINGLE_DOCUMENT_LIVE_VERIFIED }, null, 2) + '\n');
});

async function preparedFixture(company) {
  const f = await sizeChartApiFixture(company), { h } = f;
  try {
    // Expand the existing synthetic fixture with the three exact recorded wire
    // nodes. No private profile file, supplier fact or real account is imported.
    const snapshot = plain(f.snapshot), raw = JSON.parse(snapshot.schemaString);
    raw.properties.productPage.properties.unexposedAttributes.allOf.push(...exactNodes());
    raw.properties.productPage.properties.commonAttributes.properties.optionalNumber = { type: ['number', 'null'], title: '합성 선택 숫자' };
    snapshot.schemaString = JSON.stringify(raw);
    const profile = await h.load('db/category-profiles.ts').updateCategoryProfile('owner', f.profile.id, f.profile.revision, { ...f.profile, hubSchema: snapshot });
    assert.ok(profile); f.profile = profile;
    const at = new Date().toISOString(), offerId = '701000000701';
    const receipt = { schemaVersion: 1, offerId, sourceUrl: `https://detail.1688.com/offer/${offerId}.html`, provider: 'synthetic-step701', collectedAt: at,
      title: '合成原文', description: '合成说明', attributes: [{ name: '材质', value: '合成材料' }], options: [{ sku: 'SYNTHETIC-701', name: '合成选项', unitPriceCny: 7.1, minimumOrder: 1, stock: 20 }], images: [] };
    const prepared = h.load('app/collection-product.ts').prepareCollectionProduct('owner', { id: '00000000-0000-4000-8000-000000000701', offer_id: offerId, goal: 'work',
      context: { ...h.context, company, category: profile, keywords: '', capturedAt: at } }, receipt, f.id, at);
    const db = h.load('db/product-content.ts'), before = await db.readProductContent('owner', f.id);
    // Seed the production-generated initial snapshot into this existing synthetic
    // image fixture; the API edits below must retain it, including Stage 6 blanks.
    assert.ok(prepared.content.initialLegalNotices);
    assert.ok(await db.saveProductContent('owner', { ...before, revision: before.revision + 1, updatedAt: at, initialLegalNotices: prepared.content.initialLegalNotices }, before.revision));
    const content = (await json(await f.route(f.base + '/content'))).content;
    await json(await f.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision,
      patch: { seo: { title: '합성 수동 검토 상품' }, label: { productName: '', material: '합성 표시사항 재질' } } } }));
    const product = h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.id);
    h.sqlite.prepare('INSERT INTO products(id,owner_id,source_url,title,source_price_cny,exchange_rate,supply_margin,coupang_margin,supply_price,sale_price,msrp,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('synthetic-other-owner-701', 'other-owner', 'synthetic://other-owner-701', '다른 회사 합성 상품', 3, 350, 50, 40, 2100, 3500, 4550, at, at);
    await h.load('db/queries.ts').saveSettings('other-owner', JSON.stringify({ ...h.settings, brand: '다른 회사 보존값' }));
    const view = await json(await f.route(f.base + '/quotation-fields' + f.query));
    const fieldIds = names.map(name => view.resolved.schema.fields.find(field => field.hubWire?.path.join('.') === hiddenPath.join('.') && field.hubWire.name === name)?.id);
    assert.ok(fieldIds.every(Boolean));
    return { ...f, fieldIds, marker: plain(prepared.content.initialLegalNotices), productFacts: JSON.stringify(product), snapshot };
  } catch (error) { f.close(); throw error; }
}

for (const company of companies) test(`${company.code}: automatic hidden nulls survive preparation while manual blanks and typed final values stay independent`, async () => {
  let recordedRead = null;
  if (recorded) {
    // Only the recorded schema's original company was observed. The other
    // company is a local isolation fixture, never a new live schema claim.
    const r = await apiFixture(company, { ...plain(recorded.hubSchema), company: plain(company) });
    try {
      const before = allTables(r), objects = JSON.stringify([...r.h.objects]);
      const view = await json(await r.h.route(r.base + '/quotation-fields' + r.query));
      const out = await json(await r.h.route(r.base + '/supplier-hub-document' + r.query));
      assert.deepEqual(hiddenValues(out.payload.jsonDocument[0]), [null, null, null]);
      for (const name of names) {
        const field = view.resolved.schema.fields.find(field => field.hubWire?.path.join('.') === hiddenPath.join('.') && field.hubWire.name === name);
        assert.equal(view.resolved.rows.find(row => row.optionId === 'synthetic-one').fields[field.id].source, 'couplus-default');
        assert.equal(view.resolved.rows.find(row => row.optionId === 'synthetic-one').fields[field.id].value, '');
      }
      assert.equal(allTables(r), before); assert.equal(JSON.stringify([...r.h.objects]), objects); assert.deepEqual(r.h.network, []);
      recordedRead = { schemaSha256: sha(recorded.hubSchema.schemaString), typedValues: hiddenValues(out.payload.jsonDocument[0]), databaseUnchanged: true, storageUnchanged: true };
    } finally { r.close(); }
  }
  const f = await preparedFixture(company), { h } = f;
  try {
    const state = allTables(f), privateFiles = f.objectState();
    const view = await json(await f.route(f.base + '/quotation-fields' + f.query));
    const candidate = await json(await f.route(f.endpoint));
    assert.equal(candidate.review.canPrepare, true, JSON.stringify(candidate.review.issues.filter(issue => issue.level === 'error')));
    assert.deepEqual(candidate.payload.jsonDocument.map(hiddenValues), [[null, null, null], [null, null, null]]);
    const first = await json(await f.prepare(candidate.fingerprint)); assert.equal(first.prepared, true);
    const originalPayload = plain(first.payload), firstPublicPuts = f.storage.publicPutAttempts;
    assert.equal(publicKeys(f).length, 9); assert.equal(firstPublicPuts, 9);
    for (const [index, optionId] of ['synthetic-one', 'synthetic-two'].entries()) {
      const packet = await module('app/supplier-hub-single-client.ts').singlePackagePacket(first, 'owner', optionId);
      assert.deepEqual(plain(hiddenValues(packet.body.jsonDocument[0])), [null, null, null]);
      assert.deepEqual(plain(packet.body.jsonDocument[0]), first.payload.jsonDocument[index]); assert.equal(packet.company.code, company.code);
      assert.ok(Object.isFrozen(packet) && Object.isFrozen(packet.body.jsonDocument[0]));
      assert.equal(first.payload.jsonDocument[index].productPage.modelNumber, '');
      // Unlike the named hidden defaults above, this optional object property
      // has no saved value or schema default. The native initializer omits it.
      assert.equal(Object.hasOwn(first.payload.jsonDocument[index].productPage.commonAttributes, 'optionalNumber'), false);
      assert.equal(first.payload.jsonDocument[index].productPage.commonAttributes.count, 0);
      assert.equal(first.payload.jsonDocument[index].productPage.commonAttributes.booleanValue, false);
      assert.equal(first.payload.jsonDocument[index].productPage.commonAttributes.purchasePrice, '11960');
      assert.equal(first.payload.jsonDocument[index].productPage.commonAttributes.coupangSalePrice, '19930');
      assert.equal(first.payload.jsonDocument[index].productPage.commonAttributes.msrp, '25910');
      assert.ok(first.payload.jsonDocument[index].startPage.productName.startsWith('합성 수동 검토 상품'));
      assert.deepEqual(first.payload.jsonDocument[index].legalPage.notices.map(row => row.noticeItemValue), ['해당사항없음', '해당사항없음']);
      assert.equal(first.payload.jsonDocument[index].imagePage.images.sizeChartImage, first.manifest.find(slot => slot.optionId === optionId && slot.role === 'size').files[0].url);
    }
    assert.equal(allTables(f), state); assert.equal(f.objectState(), privateFiles);
    const publicBefore = JSON.stringify([...h.objects].map(([key, bytes]) => [key, sha(bytes)]));
    const readAgain = await json(await f.route(f.endpoint)); assert.equal(f.storage.publicPutAttempts, firstPublicPuts, 'read-only recovery does not publish');
    const preparedAgain = await json(await f.prepare(candidate.fingerprint));
    assert.deepEqual(readAgain.payload, originalPayload); assert.deepEqual(preparedAgain.payload, originalPayload);
    assert.equal(JSON.stringify([...h.objects].map(([key, bytes]) => [key, sha(bytes)])), publicBefore, 'explicit re-prepare retains the same objects and bytes');
    assert.equal(allTables(f), state); assert.equal(f.objectState(), privateFiles);
    await f.edit([{ fieldKey: f.fieldIds[0], optionId: null, value: '' }, { fieldKey: f.fieldIds[1], optionId: 'synthetic-two', value: '' },
      { fieldKey: f.fieldIds[2], optionId: 'synthetic-one', value: 'SYNTHETIC-PART-701' }, { fieldKey: f.fieldIds[2], optionId: 'synthetic-excluded', value: 'EXCLUDED-PART-701' }]);
    const edited = await json(await f.route(f.base + '/quotation-fields' + f.query));
    assert.equal(edited.resolved.rows.find(row => row.optionId === 'synthetic-one').fields[f.fieldIds[0]].source, 'manual-common');
    assert.equal(edited.resolved.rows.find(row => row.optionId === 'synthetic-two').fields[f.fieldIds[1]].source, 'manual-option');
    const afterManual = allTables(f), next = await json(await f.route(f.endpoint)), output = await json(await f.prepare(next.fingerprint));
    assert.deepEqual(output.payload.jsonDocument.map(hiddenValues), [['', null, 'SYNTHETIC-PART-701'], ['', '', null]]);
    assert.notEqual(output.fingerprint, first.fingerprint); assert.deepEqual(withoutTargetAttributes(output.payload), withoutTargetAttributes(originalPayload));
    for (const [index, optionId] of ['synthetic-one', 'synthetic-two'].entries()) {
      const packet = await module('app/supplier-hub-single-client.ts').singlePackagePacket(output, 'owner', optionId);
      assert.deepEqual(plain(hiddenValues(packet.body.jsonDocument[0])), hiddenValues(output.payload.jsonDocument[index]));
      assert.equal(packet.body.jsonDocument.length, 1); assert.equal(packet.body.docId, null);
    }
    assert.deepEqual(output.options.map(row => row.optionId), ['synthetic-one', 'synthetic-two']);
    assert.deepEqual(output.excludedOptions.map(row => row.optionId), ['synthetic-excluded']);
    assert.ok(!JSON.stringify(output.payload).includes('EXCLUDED-PART-701'));
    assert.ok(!output.manifest.some(slot => slot.optionId === 'synthetic-excluded' || slot.keys.includes(sizeKeys[2])));
    const content = (await json(await f.route(f.base + '/content'))).content;
    assert.deepEqual(content.initialLegalNotices, f.marker); assert.equal(content.label.productName.value, ''); assert.equal(content.label.material.value, '합성 표시사항 재질');
    assert.equal(allTables(f), afterManual); assert.equal(f.objectState(), privateFiles); assert.equal(f.storage.privatePutAttempts, 0);
    assert.equal(JSON.stringify([...h.objects].map(([key, bytes]) => [key, sha(bytes)])), publicBefore);
    for (const value of [first, output]) { assert.equal(value.registered, false); assert.equal(value.remoteWrites, false); assert.equal(value.submissionReady, false); assert.equal(value.humanAgreementsConfirmed, false); }
    assert.equal(SINGLE_DOCUMENT_LIVE_VERIFIED, false); assert.deepEqual(h.network, []); assert.equal(h.aiSources.length, 0);
    assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n, 0); assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_single_receipts').get().n, 0);
    // Ordinary saves do not change original option inclusion, source pricing or
    // the settings/other-owner rows contained in this exact preserved snapshot.
    const after = new Map(JSON.parse(afterManual)), before = new Map(JSON.parse(state));
    for (const table of ['products', 'product_options', 'product_price_policy', 'product_content', 'workspace_settings', 'category_profiles', 'collection_context', 'collection_results'])
      if (table !== 'products') assert.deepEqual(after.get(table), before.get(table), table);
    const sourceProduct = h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.id);
    const { updated_at: ignoredBefore, quote_status: ignoredStatusBefore, ...beforeProduct } = JSON.parse(f.productFacts);
    const { updated_at: ignoredAfter, quote_status: ignoredStatusAfter, ...afterProduct } = sourceProduct;
    void ignoredBefore; void ignoredAfter; void ignoredStatusBefore; void ignoredStatusAfter; assert.deepEqual(afterProduct, beforeProduct);
    assert.deepEqual(after.get('products').find(row => row.owner_id === 'other-owner'), before.get('products').find(row => row.owner_id === 'other-owner'));
    proof.push({ company, recordedRead, requests: f.requests, requestCount: f.requests.length, preparedOptions: 2, excludedOptions: 1,
      initialTypedValues: first.payload.jsonDocument.map(hiddenValues), manualTypedValues: output.payload.jsonDocument.map(hiddenValues),
      initialLegalNoticesPreserved: true, finalTitlePriceImagesSizePreserved: true, originalFactsSettingsAndOtherOwnerPreserved: true,
      privateR2Unchanged: true, publicFiles: publicKeys(f).length, publicPutAttempts: f.storage.publicPutAttempts, repeatedPrepareObjectsAndBytesUnchanged: true, getRecoveryPublicPuts: 0,
      initialFingerprint: first.fingerprint, manualFingerprint: output.fingerprint, clientPacketsVerified: 4, registered: false });
    assert.equal(view.resolved.rows.filter(row => row.included).length, 2);
  } finally { f.close(); }
});
