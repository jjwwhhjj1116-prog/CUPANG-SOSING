import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assetApiFixture, companies, keys, imageBytes, sha, labelName, plain } from './helpers/supplier-hub-single-assets.mjs';
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const publicKeys = f => [...f.h.objects.keys()].filter(key => key.startsWith('quotation-public-detail/'));
const preserve = (f, state, objects) => { assert.equal(f.state(), state); assert.equal(f.objectState(), objects); assert.deepEqual(f.h.network, []); assert.equal(f.h.aiSources.length, 0); };
async function edit(f, changes) {
  const view = await json(await f.h.route(f.base + '/quotation-fields' + f.query));
  return json(await f.h.route(f.base + '/quotation-fields' + f.query, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes } }));
}
for (const company of companies) test(`GET candidates then explicit POST produce immutable exact Single assets (${company.code})`, async () => {
  const f = await assetApiFixture(company); try {
    const state = f.state(), objects = f.objectState(), preview = await json(await f.h.route(f.endpoint));
    assert.equal(preview.prepared, false); assert.equal(preview.review.canPrepare, true, JSON.stringify(preview.review.issues.filter(issue => issue.level === 'error'))); assert.equal(publicKeys(f).length, 0);
    assert.equal(preview.payload.jsonDocument.length, 2); assert.equal(preview.payload.jsonDocument[0].imagePage.images.mainImage, undefined);
    assert.equal(preview.source.profileId, f.profile.id); assert.deepEqual(plain(preview.company), company); preserve(f, state, objects);
    const response = await f.prepare(preview.fingerprint), out = await json(response); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(out.prepared, true); assert.equal(out.registered, false); assert.equal(out.remoteWrites, false); assert.equal(out.submissionReady, false); assert.equal(out.humanAgreementsConfirmed, false);
    assert.equal(out.fingerprint, preview.fingerprint); assert.equal(out.payload.docId, null); assert.equal(out.payload.categoryId, 765432); assert.equal(out.payload.displayCategoryCode, '81452');
    assert.deepEqual(plain(out.excludedOptions.map(row => row.optionId)), ['synthetic-excluded']); assert.equal(publicKeys(f).length, 7);
    const url = key => out.manifest.flatMap(slot => slot.files).find(file => file.key === key).url;
    for (const document of out.payload.jsonDocument) {
      assert.equal(document.imagePage.images.mainImage, url(keys[0])); assert.equal(document.imagePage.images.additionalImage, keys.slice(1, 3).map(url).join(','));
      assert.equal(document.imagePage.details.detailedImage, keys.slice(3, 6).map(url).join(',')); assert.equal(document.imagePage.details.htmlProductDetailContent, '');
      assert.deepEqual(plain(document.imagePage.images.labelImages), [{ labelImageType: labelName, labelImageFiles: url(keys[6]) }]);
      assert.equal(document.productPage.modelNumber, ''); assert.equal(document.productPage.commonAttributes.purchasePrice, '11960');
      assert.equal(document.productPage.commonAttributes.coupangSalePrice, '19930'); assert.equal(document.productPage.commonAttributes.msrp, '25910');
      assert.equal(document.productPage.commonAttributes.count, 0); assert.equal(document.productPage.commonAttributes.booleanValue, false);
      assert.equal(document.imagePage.msrpAgree, false); assert.equal(document.imagePage.labelContactAgreed, false);
    }
    assert.ok(!JSON.stringify(out.payload).includes('owner/')); assert.ok(!out.manifest.some(slot => slot.optionId === 'synthetic-excluded'));
    for (const file of out.manifest.flatMap(slot => slot.files)) {
      const storedKey = 'quotation-public-detail/' + new URL(file.url).pathname.split('/').at(-1), object = await f.h.bindings.FILES.get(storedKey);
      assert.equal(sha(new Uint8Array(await object.arrayBuffer())), file.sha256); assert.equal(object.httpMetadata.contentType, file.contentType);
      assert.equal(file.published, true); assert.equal(file.verification, 'stored-body-sha256');
    }
    const repeat = await json(await f.prepare(preview.fingerprint)); assert.equal(repeat.fingerprint, out.fingerprint); assert.deepEqual(plain(repeat.payload), plain(out.payload));
    const fresh = await json(await f.h.route(f.endpoint)); assert.equal(fresh.prepared, true); assert.equal(fresh.fingerprint, out.fingerprint);
    assert.deepEqual(plain(fresh.payload), plain(out.payload));
    assert.equal(publicKeys(f).length, 7); preserve(f, state, objects);
    assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) AS total FROM supplier_hub_receipts').get().total, 0);
  } finally { f.close(); }
});
test('manual option image blank and edited option main remain final, without publishing excluded or removed sources', async () => {
  const f = await assetApiFixture(); try {
    await edit(f, [{ fieldKey: f.byWire(['imagePage', 'images', 'mainImage']), optionId: 'synthetic-two', value: '' },
      { fieldKey: f.byWire(['imagePage', 'images', 'additionalImage']), optionId: 'synthetic-two', value: '' }]);
    const state = f.state(), objects = f.objectState(), view = await json(await f.h.route(f.endpoint)), out = await json(await f.prepare(view.fingerprint));
    assert.equal(out.prepared, true); assert.equal(out.payload.jsonDocument[1].imagePage.images.mainImage, ''); assert.equal(out.payload.jsonDocument[1].imagePage.images.additionalImage, '');
    assert.equal(out.payload.jsonDocument[0].imagePage.images.mainImage, out.manifest.find(slot => slot.role === 'main').files[0].url);
    assert.ok(!out.manifest.some(slot => slot.role === 'main' && slot.optionId === 'synthetic-two')); assert.ok(!out.manifest.some(slot => slot.keys.includes(keys[7]))); preserve(f, state, objects);
  } finally { f.close(); }
});
test('old quotation/profile/product/settings fingerprint prevents any publication', async () => {
  for (const kind of ['quotation', 'profile', 'product', 'settings']) {
    const f = await assetApiFixture(); try {
      const view = await json(await f.h.route(f.endpoint));
      if (kind === 'quotation') await edit(f, [{ fieldKey: 'model', optionId: 'synthetic-one', value: 'REVIEWED-MODEL-653' }]);
      if (kind === 'profile') f.h.sqlite.prepare('UPDATE category_profiles SET revision=revision+1 WHERE id=?').run(f.profile.id);
      if (kind === 'product') f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2099-01-01T00:00:00.000Z', f.id);
      if (kind === 'settings') await f.h.load('db/queries.ts').saveSettings('owner', JSON.stringify({ ...f.h.settings, brand: '새로 검토한 브랜드' }));
      const state = f.state(), objects = f.objectState(), out = await json(await f.prepare(view.fingerprint), 409);
      assert.equal(out.code, 'SINGLE_SOURCE_CHANGED'); assert.equal(publicKeys(f).length, 0); preserve(f, state, objects);
    } finally { f.close(); }
  }
});
test('same-key image bytes, source metadata or public config change invalidates old prepare', async () => {
  for (const kind of ['bytes', 'metadata', 'config']) {
    const f = await assetApiFixture(); try {
      const view = await json(await f.h.route(f.endpoint));
      if (kind === 'bytes') await f.h.bindings.FILES.put(keys[0], imageBytes(132), { httpMetadata: { contentType: 'image/png' }, customMetadata: { sha256: sha(imageBytes(132)) } });
      if (kind === 'metadata') await f.h.bindings.FILES.put(keys[0], imageBytes(0), { httpMetadata: { contentType: 'image/png' }, customMetadata: { sha256: sha(imageBytes(0)), reviewed: 'different-source' } });
      if (kind === 'config') f.h.bindings.YOOFAM_DETAIL_IMAGE_SECRET = 'b'.repeat(64);
      const state = f.state(), objects = f.objectState(); await json(await f.prepare(view.fingerprint), 409); assert.equal(publicKeys(f).length, 0); preserve(f, state, objects);
    } finally { f.close(); }
  }
});
test('current owner/company and strict query/body/origin prevent preparing a foreign scope', async () => {
  const f = await assetApiFixture(); try {
    const view = await json(await f.h.route(f.endpoint)), state = f.state(), objects = f.objectState();
    const route = f.h.load('app/api/products/[id]/supplier-hub-single-package/route.ts'), context = { params: Promise.resolve({ id: f.id }) };
    assert.deepEqual(Object.keys(route).sort(), ['GET', 'POST']);
    assert.equal((await route.GET(new Request('https://app.test' + f.endpoint, { method: 'POST' }), context)).status, 405);
    for (const query of ['?profileId=', '?profileId=x&profileId=y', '?remoteWrite=true', '?expectedFingerprint=' + view.fingerprint])
      await json(await f.h.route(f.base + '/supplier-hub-single-package' + query), 400);
    for (const body of [{ action: 'prepare' }, { action: 'submit', expectedFingerprint: view.fingerprint }, { action: 'prepare', expectedFingerprint: view.fingerprint, agree: true }, { action: 'prepare', expectedFingerprint: 'bad' }])
      await json(await f.h.route(f.endpoint, { method: 'POST', body }), 400);
    const cross = new Request('https://app.test' + f.endpoint, { method: 'POST', headers: { origin: 'https://foreign.example.test', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'prepare', expectedFingerprint: view.fingerprint }) });
    await json(await route.POST(cross, context), 403); preserve(f, state, objects); assert.equal(publicKeys(f).length, 0);
    f.h.setCompany(companies[1]); await json(await f.prepare(view.fingerprint), 409); assert.equal(publicKeys(f).length, 0);
    f.h.setCompany(companies[0]); f.h.sqlite.prepare('UPDATE products SET owner_id=? WHERE id=?').run('different-owner', f.id);
    await json(await f.prepare(view.fingerprint), 404); assert.equal(publicKeys(f).length, 0);
  } finally { f.close(); }
});
test('required legal files and scalar constraints remain precise blockers without publication', async () => {
  for (const kind of ['legal', 'scalar', 'config']) {
    const f = await assetApiFixture(); try {
      if (kind === 'legal') {
        const db = f.h.load('db/product-content.ts'), content = await db.readProductContent('owner', f.id);
        await db.saveProductContent('owner', { ...content, legalDocuments: { applicability: 'required', files: [] }, revision: content.revision + 1 }, content.revision);
      }
      if (kind === 'scalar') await edit(f, [{ fieldKey: f.byWire(['startPage', 'productName']), optionId: 'synthetic-one', value: '' }]);
      if (kind === 'config') { delete f.h.bindings.YOOFAM_DETAIL_IMAGE_ORIGIN; delete f.h.bindings.YOOFAM_DETAIL_IMAGE_SECRET; }
      const state = f.state(), objects = f.objectState(), view = await json(await f.h.route(f.endpoint)), out = await json(await f.prepare(view.fingerprint));
      assert.equal(out.prepared, false); assert.equal(out.review.canPrepare, false); assert.ok(out.review.issues.some(issue => issue.level === 'error'));
      if (kind === 'legal') assert.ok(out.review.issues.some(issue => issue.code === 'LEGAL_DOCUMENT_MISSING'));
      assert.equal(publicKeys(f).length, 0); preserve(f, state, objects);
    } finally { f.close(); }
  }
});
test('immutable capability collision cannot replace prior public bytes', async () => {
  const f = await assetApiFixture(); try {
    const view = await json(await f.h.route(f.endpoint)), candidate = view.manifest[0].files[0], token = new URL(candidate.url).pathname.split('/').at(-1), key = 'quotation-public-detail/' + token;
    await f.h.bindings.FILES.put(key, imageBytes(213), { httpMetadata: { contentType: 'image/png' }, customMetadata: { publication: 'yoofam-public-detail-v1', sha256: sha(imageBytes(213)) } });
    const state = f.state(), objects = f.objectState(); await json(await f.prepare(view.fingerprint), 409); assert.equal(sha(f.h.objects.get(key)), sha(imageBytes(213)));
    assert.equal(publicKeys(f).length, 1); preserve(f, state, objects);
  } finally { f.close(); }
});
test('forged public metadata with different actual body is detected after immutable put', async () => {
  const f = await assetApiFixture(); try {
    const view = await json(await f.h.route(f.endpoint)), file = view.manifest[0].files[0], key = 'quotation-public-detail/' + new URL(file.url).pathname.split('/').at(-1);
    await f.h.bindings.FILES.put(key, imageBytes(213), { httpMetadata: { contentType: 'image/png' }, customMetadata: { publication: 'yoofam-public-detail-v1', sha256: file.sha256 } });
    const state = f.state(), objects = f.objectState(), out = await json(await f.prepare(view.fingerprint), 409); assert.equal(out.code, 'SINGLE_PUBLIC_IMAGE_CONFLICT');
    assert.equal(sha(f.h.objects.get(key)), sha(imageBytes(213))); assert.equal(publicKeys(f).length, 1); preserve(f, state, objects);
  } finally { f.close(); }
});
test('a mid-publication company switch stops all following copies, leaving original rows untouched', async () => {
  const f = await assetApiFixture(); try {
    const view = await json(await f.h.route(f.endpoint)), state = f.state(), objects = f.objectState(), put = f.h.bindings.FILES.put; let once = false;
    f.h.bindings.FILES.put = async (...args) => { const result = await put(...args); if (args[0].startsWith('quotation-public-detail/') && !once) { once = true; f.h.setCompany(companies[1]); } return result; };
    const out = await json(await f.prepare(view.fingerprint), 409); assert.equal(out.code, 'SINGLE_SOURCE_CHANGED'); assert.equal(publicKeys(f).length, 1); preserve(f, state, objects);
  } finally { f.close(); }
});
test('request abort prevents public puts; private lookup does not reset a draft', async () => {
  const f = await assetApiFixture(); try {
    const view = await json(await f.h.route(f.endpoint)), state = f.state(), objects = f.objectState(), controller = new AbortController(); controller.abort();
    const request = new Request('https://app.test' + f.endpoint, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'prepare', expectedFingerprint: view.fingerprint }) });
    await json(await f.h.load('app/api/products/[id]/supplier-hub-single-package/route.ts').POST(request, { params: Promise.resolve({ id: f.id }) }), 409);
    assert.equal(publicKeys(f).length, 0); preserve(f, state, objects);
  } finally { f.close(); }
});
test('a server-marked generated label without current source proof blocks publication', async () => {
  for (const recipe of ['quotation', 'product']) {
    const f = await assetApiFixture(); try {
      const marked = recipe === 'quotation' ? { quotationLabelRecipe: f.h.load('app/quotation-label-upload.ts').QUOTATION_LABEL_PNG_RECIPE } : { productLabelRecipe: 'product-label-png-v1' };
      await f.h.bindings.FILES.put(keys[6], imageBytes(6), { httpMetadata: { contentType: 'image/png' }, customMetadata: { ...marked, sha256: sha(imageBytes(6)) } });
      const state = f.state(), objects = f.objectState(), view = await json(await f.h.route(f.endpoint)), out = await json(await f.prepare(view.fingerprint));
      assert.equal(out.prepared, false); assert.ok(out.review.issues.some(issue => issue.code === (recipe === 'quotation' ? 'GENERATED_QUOTATION_LABEL_UNCONFIRMED' : 'GENERATED_PRODUCT_LABEL_UNCONFIRMED')));
      assert.equal(publicKeys(f).length, 0); preserve(f, state, objects);
    } finally { f.close(); }
  }
});
test('independent canonical price edits or manual blanks never silently rewrite the final Single wire', async () => {
  for (const value of ['25911', '']) {
    const f = await assetApiFixture(); try {
      await edit(f, [{ fieldKey: 'msrp', optionId: 'synthetic-one', value }]);
      const state = f.state(), objects = f.objectState(), view = await json(await f.h.route(f.endpoint)), out = await json(await f.prepare(view.fingerprint));
      assert.equal(out.prepared, false); assert.ok(out.review.issues.some(issue => issue.code === 'SINGLE_PRICE_SUMMARY_CONFLICT' && issue.optionId === 'synthetic-one'));
      assert.equal(out.payload.jsonDocument[0].productPage.commonAttributes.msrp, '25910');
      assert.ok(out.review.fields.some(field => field.optionId === 'synthetic-one' && field.fieldId === 'msrp' && field.path.length === 0 && field.savedValue === value));
      assert.equal(publicKeys(f).length, 0); preserve(f, state, objects);
    } finally { f.close(); }
  }
});
const recorded = new URL('../outputs/step650-official-81452-profile-after.json', import.meta.url);
for (const company of companies) test(`recorded Single 81452 68 wires expose exact blockers without inventing defaults (${company.code})`, { skip: !fs.existsSync(recorded) }, async () => {
  // Only Unand's schema was recorded; Waihop here is an isolated wire-contract
  // reuse, not an observation of Waihop's live supplier form.
  const saved = JSON.parse(fs.readFileSync(recorded, 'utf8')), snapshot = { ...saved.hubSchema, company: { ...company } }, f = await assetApiFixture(company, snapshot, { twoOptions: false });
  try {
    const state = f.state(), objects = f.objectState(), view = await json(await f.h.route(f.endpoint)), out = await json(await f.prepare(view.fingerprint));
    assert.equal(out.payload.categoryId, 5562); assert.equal(out.payload.productNoticeNumber, 25); assert.equal(out.payload.version, 188);
    assert.equal(out.review.fields.filter(field => field.path.length).length, 68); assert.equal(out.prepared, false); assert.ok(out.review.issues.some(issue => issue.level === 'error'));
    assert.ok(out.manifest.some(slot => slot.role === 'label' && slot.wire.name === labelName)); assert.equal(publicKeys(f).length, 0); preserve(f, state, objects);
  } finally { f.close(); }
});
