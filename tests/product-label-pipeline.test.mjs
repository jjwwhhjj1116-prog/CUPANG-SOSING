import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';
import { readPackageZip } from '../extensions/supplier-hub/package.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=', 'base64'));
const companies = [{ companyCode: 'A01464742', companyName: '와이홉' }, { companyCode: 'A01526306', companyName: '유앤채' }];
const captions = ['제품명', '제조원', '수입 및 판매원', '제조국', '내용량', '원료명 및 성분명(재질)', '상품 유형', '사용 시 주의사항', '사용 기준'];
const keys = ['productName', 'manufacturer', 'importer', 'countryOfOrigin', 'netContents', 'material', 'productType', 'precautions', 'usageStandard'];
async function json(response, statuses = [200]) { assert.ok(statuses.includes(response.status), response.status + ': ' + await response.clone().text()); return response.json(); }

/** Real API handlers, ephemeral SQLite and recorded public intake facts. R2 and
 * PNG bytes are local fixtures. Nothing submits or modifies an operating Hub
 * record, and the XLSX below is explicitly a synthetic form fixture. */
async function fixture(company = companies[0]) {
  const api = mobileIntakeHarness(company);
  try {
    const get = api.bindings.FILES.get;
    api.bindings.FILES.get = async (key, options) => {
      const object = await get(key), bytes = api.objects.get(key); if (!object || !bytes) return object;
      const offset = options?.range?.offset ?? 0, end = options?.range?.length === undefined ? bytes.byteLength : offset + options.range.length;
      return { ...object, body: new Response(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice(offset, end)).body };
    };
    const schema = api.load('app/quotation-schema.ts').getQuotationSchema('80719'), fields = schema.fields.map(field => field.id);
    const workbook = new Uint8Array(quotationWorkbook(fields)), sha256 = Buffer.from(await webcrypto.subtle.digest('SHA-256', workbook)).toString('hex');
    const storageKey = api.load('db/category-templates.ts').templateKey('owner', sha256, 'xlsx'); api.objects.set(storageKey, workbook);
    const profileInput = { name: '9행 제품 표시사항 시험', categoryId: '80719', categoryPath: schema.categoryPath,
      template: { name: 'synthetic-product-label.xlsx', format: 'xlsx', sha256, storageKey, sheetName: '견적서', headerRow: 1, headers: fields },
      mappings: fields.map((field, column) => ({ field, column, required: false })) };
    const profile = await api.load('db/category-profiles.ts').createCategoryProfile('owner', profileInput, 'cat');
    api.context.category = profile; api.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(api.context), 'job'); await api.intake();
    const product = api.sqlite.prepare('SELECT * FROM products').get(), base = '/api/products/' + product.id;
    const endpoint = base + '/product-labels?profileId=' + profile.id, quotationEndpoint = base + '/quotation-fields?profileId=' + profile.id;
    const quotation = await json(await api.route(quotationEndpoint)), selected = quotation.resolved.rows.find(row => row.optionId), other = quotation.resolved.rows.filter(row => row.optionId)[1];
    const requests = [];
    const request = async (url, init = {}) => {
      requests.push({ url, method: init.method ?? 'GET', init });
      if (url === '/api/files') return api.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files', { method: 'POST', body: init.body }));
      return api.route(url, { method: init.method ?? 'GET', ...(init.body !== undefined ? { body: JSON.parse(init.body) } : {}) });
    };
    const read = () => api.route(endpoint).then(json), readQuotation = () => api.route(quotationEndpoint).then(json);
    const save = (view, changes) => api.route(endpoint, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes } });
    const saveQuotation = (view, changes) => api.route(quotationEndpoint, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes } }).then(json);
    const snapshots = () => Object.fromEntries(['product_content', 'product_options', 'product_price_policy'].map(table => [table, api.sqlite.prepare('SELECT payload FROM ' + table + ' WHERE product_id=?').get(product.id).payload]));
    return { api, company, profile, profileInput, fields, product, base, endpoint, quotationEndpoint, selected, other, requests, request, read, readQuotation, save, saveQuotation, snapshots };
  } catch (error) { api.close(); throw error; }
}

for (const company of companies) test(`nine selected product-label values and PNG reach the correct SKU workbook/ZIP without changing legal notices (${company.companyCode})`, async () => {
  const f = await fixture(company); try {
    const model = f.api.load('app/product-label.ts'), upload = f.api.load('app/product-label-upload.ts'), attachment = f.api.load('app/product-label-attachment.ts');
    assert.deepEqual(plain(model.productLabelFields.map(field => field.key)), keys); assert.deepEqual(plain(model.productLabelFields.map(field => field.label)), captions);
    let quote = await f.readQuotation();
    quote = await f.saveQuotation(quote, [{ optionId: null, fieldKey: 'noticeMaterial', value: '견적서 법적 재질 공통값' },
      { optionId: f.selected.optionId, fieldKey: 'noticeCountryOfOrigin', value: '법적 제조국 직접 수정' },
      { optionId: f.other.optionId, fieldKey: 'noticeMaterial', value: '다른 SKU 법적 재질' }]);
    const originalQuote = plain(quote.overrides), source = f.snapshots(); let view = await f.read();
    assert.equal(view.productId, f.product.id); assert.equal(view.revision, 0); assert.equal(view.categoryContext.categoryId, '80719'); assert.equal(view.categoryContext.profileId, f.profile.id);
    assert.equal(view.rows.filter(row => row.optionId).length, 6); assert.equal(view.rows.find(row => row.optionId === f.selected.optionId).values.importer, company.companyName);
    view = await json(await f.save(view, [{ optionId: null, fieldKey: 'material', value: '제품 표시사항 공통 재질' },
      { optionId: f.other.optionId, fieldKey: 'productName', value: '다른 SKU 라벨 이름' }]));
    const common = plain(view.overrides.common), other = plain(view.overrides.options[f.other.optionId]), values = {
      productName: '선택 SKU 제품명', manufacturer: '제품 라벨 제조원', importer: company.companyName, countryOfOrigin: '한국',
      netContents: '', material: '', productType: '수동 확인 상품 유형', precautions: '제품 사용 전에 확인하세요.\n고온을 피하세요.', usageStandard: '성인용',
    };
    const before = plain(view); view = await json(await f.save(view, keys.map(fieldKey => ({ optionId: f.selected.optionId, fieldKey, value: values[fieldKey] }))));
    model.verifyProductLabelSave(before, view, f.selected.optionId, values);
    const selected = view.rows.find(row => row.optionId === f.selected.optionId);
    assert.deepEqual(plain(selected.values), values); assert.ok(keys.every(key => selected.sources[key] === 'manual-option'));
    assert.equal(selected.values.netContents, ''); assert.equal(selected.values.material, ''); assert.deepEqual(plain(view.overrides.common), common); assert.deepEqual(plain(view.overrides.options[f.other.optionId]), other);
    const savedLabels = plain(view), plan = model.productLabelPlan(view, f.selected.optionId);
    assert.equal(plan.format, 'product-label'); assert.deepEqual(plain(plan.rows), captions.map((caption, index) => [caption, values[keys[index]]]));
    assert.equal(plan.rows.length, 9); assert.ok(!plan.rows.some(([, value]) => value === '[공란]' || value === '해당사항없음')); assert.deepEqual(f.snapshots(), source);
    assert.deepEqual(plain((await f.readQuotation()).overrides), originalQuote);
    const context = { productId: f.product.id, endpoint: f.endpoint, view, optionId: f.selected.optionId }, uploadId = await upload.productLabelUploadId(context);
    let rememberedKey = null;
    const result = await attachment.attachProductLabel({ productId: f.product.id, endpoint: f.endpoint, quotationEndpoint: f.quotationEndpoint, renderedView: view,
      optionId: f.selected.optionId, blob: new Blob([png], { type: 'image/png' }), uploadedKey: null, onUploaded: key => rememberedKey = key }, f.request);
    assert.equal(result.key, rememberedKey); assert.ok(result.key.startsWith('owner/')); assert.deepEqual(f.api.objects.get(result.key), png);
    assert.equal(result.view.revision, savedLabels.revision); assert.deepEqual(plain(result.view.overrides), savedLabels.overrides); assert.deepEqual(plain(result.view.rows.map(row => row.values)), savedLabels.rows.map(row => row.values));
    quote = await f.readQuotation(); assert.deepEqual(plain(quote.overrides.common), originalQuote.common); assert.deepEqual(plain(quote.overrides.options[f.other.optionId]), originalQuote.options[f.other.optionId]);
    assert.equal(quote.overrides.options[f.selected.optionId].noticeCountryOfOrigin, '법적 제조국 직접 수정');
    const selectedQuote = quote.resolved.rows.find(row => row.optionId === f.selected.optionId), otherQuote = quote.resolved.rows.find(row => row.optionId === f.other.optionId);
    assert.ok(selectedQuote.fields.labelImages.value.split('\n').includes(result.key)); assert.ok(!otherQuote.fields.labelImages.value.split('\n').includes(result.key));
    assert.deepEqual(plain(await upload.findProductLabelUpload(context, f.request)), { uploadId, key: result.key });
    assert.equal(f.requests.filter(row => row.url === '/api/files' && row.method === 'POST').length, 1);
    assert.ok(f.requests.filter(row => row.url.endsWith('/attachments')).every(row => JSON.parse(row.init.body).role === null));
    const preview = await json(await f.api.route(f.base + '/quotation', { method: 'POST', body: { action: 'preview', profileId: f.profile.id } }));
    const download = await f.api.route(f.base + '/quotation', { method: 'POST', body: { action: 'download', profileId: f.profile.id, fingerprint: preview.fingerprint } });
    assert.equal(download.status, 200, await download.clone().text()); const reader = f.api.load('app/xlsx-template.ts');
    const sheet = reader.inspectXlsxArchive(await reader.readXlsxArchive(await download.arrayBuffer())), firstRow = reader.xlsxHeaders(sheet, '견적서', 2), secondRow = reader.xlsxHeaders(sheet, '견적서', 3);
    assert.equal(firstRow[f.fields.indexOf('noticeMaterial')], '견적서 법적 재질 공통값'); assert.equal(firstRow[f.fields.indexOf('noticeCountryOfOrigin')], '법적 제조국 직접 수정'); assert.equal(secondRow[f.fields.indexOf('noticeMaterial')], '다른 SKU 법적 재질');
    const filename = firstRow[f.fields.indexOf('labelImages')]; assert.match(filename, /\.png$/); assert.ok(!secondRow[f.fields.indexOf('labelImages')].includes(filename));
    const exported = await f.api.route(f.base + '/quotation', { method: 'POST', body: { action: 'export', profileId: f.profile.id, fingerprint: preview.fingerprint } }); assert.equal(exported.status, 200, await exported.clone().text());
    const zip = readPackageZip(new Uint8Array(await exported.arrayBuffer())), manifest = JSON.parse(new TextDecoder().decode(zip.get('supplier-hub-upload-plan.json')));
    const item = manifest.labelImages.find(entry => entry.filename === filename); assert.ok(item); assert.deepEqual(zip.get(item.archivePath), png); assert.equal(manifest.company.code, company.companyCode); assert.equal(manifest.categoryId, '80719');
    view = await f.read(); view = await json(await f.save(view, [{ optionId: f.selected.optionId, fieldKey: 'material', value: null }, { optionId: f.selected.optionId, fieldKey: 'netContents', value: null }]));
    const reset = view.rows.find(row => row.optionId === f.selected.optionId); assert.equal(reset.values.material, '제품 표시사항 공통 재질'); assert.equal(reset.sources.material, 'manual-common'); assert.equal(reset.values.netContents, reset.automatic.netContents);
    assert.equal(Object.hasOwn(view.overrides.options[f.selected.optionId], 'material'), false); assert.equal(Object.hasOwn(view.overrides.options[f.selected.optionId], 'netContents'), false);
    assert.deepEqual(plain(view.overrides.common), common); assert.deepEqual(plain(view.overrides.options[f.other.optionId]), other); assert.deepEqual(f.snapshots(), source);
    const fileCount = f.requests.length;
    await assert.rejects(attachment.attachProductLabel({ productId: f.product.id, endpoint: f.endpoint, quotationEndpoint: f.quotationEndpoint, renderedView: savedLabels,
      optionId: f.selected.optionId, blob: new Blob([png], { type: 'image/png' }), uploadedKey: result.key, onUploaded() {} }, f.request), /변경|다시|일치/);
    assert.ok(f.requests.slice(fileCount).every(row => row.method === 'GET')); assert.ok((await f.readQuotation()).resolved.rows.find(row => row.optionId === f.selected.optionId).fields.labelImages.value.includes(result.key));
    assert.equal(f.api.sqlite.prepare('SELECT supplier_hub_status FROM products WHERE id=?').get(f.product.id).supplier_hub_status, '미전송'); assert.ok(!f.api.network.includes('supplier.coupang.com'));
  } finally { f.api.close(); }
});

test('real product-label API rejects stale/category/owner inputs, unsupported field keys and absent SKUs while preserving legitimate own IDs', async () => {
  const f = await fixture(); try {
    const model = f.api.load('app/product-label.ts'); let view = await f.read(), quote = await f.readQuotation(); const source = f.snapshots(), original = plain(quote.overrides);
    for (const changes of [
      [{ optionId: f.selected.optionId, fieldKey: 'noticeMaterial', value: 'legal wire is separate' }],
      [{ optionId: f.selected.optionId, fieldKey: '__proto__', value: 'invalid' }], [{ optionId: 'constructor', fieldKey: 'material', value: 'invalid' }],
      [{ optionId: 'unknown-option', fieldKey: 'material', value: 'invalid' }], [{ optionId: f.selected.optionId, fieldKey: 'material', value: 'a\u0000b' }],
      [{ optionId: f.selected.optionId, fieldKey: 'material', value: '가'.repeat(2001) }],
      [{ optionId: f.selected.optionId, fieldKey: 'material', value: 'one' }, { optionId: f.selected.optionId, fieldKey: 'material', value: 'two' }],
    ]) { const response = await f.save(view, changes); assert.equal(response.status, 400, await response.clone().text()); assert.equal((await f.read()).revision, view.revision); }
    for (const raw of ['{"common":{"__proto__":"bad"},"options":{}}', '{"common":{},"options":{"constructor":{"unknown":"bad"}}}', '{"common":{"unknown":"bad"},"options":{}}']) assert.throws(() => model.validateProductLabelOverrides(JSON.parse(raw)), /항목|옵션/);
    const ownIds = ['constructor', 'toString', 'hasOwnProperty', '__proto__'], existing = { common: { productName: '보존할 공통 제품명' }, options: { red: { material: '보존할 개별 재질' } } };
    const accepted = model.validateProductLabelChanges(ownIds.map(optionId => ({ optionId, fieldKey: 'material', value: 'owned ' + optionId })), ownIds);
    const own = model.applyProductLabelChanges(existing, accepted), prototype = Object.getPrototypeOf(own.options);
    for (const id of ownIds) { assert.equal(Object.hasOwn(own.options, id), true); assert.equal(own.options[id].material, 'owned ' + id); }
    assert.deepEqual(plain(own.common), existing.common); assert.deepEqual(plain(own.options.red), existing.options.red); assert.equal(Object.hasOwn(prototype, 'material'), false); assert.equal(Object.prototype.material, undefined);
    const roundTrip = model.validateProductLabelOverrides(JSON.parse(JSON.stringify(own))); for (const id of ownIds) { assert.equal(Object.hasOwn(roundTrip.options, id), true); assert.equal(roundTrip.options[id].material, 'owned ' + id); }
    const resetOwn = model.applyProductLabelChanges(own, ownIds.map(optionId => ({ optionId, fieldKey: 'material', value: null })));
    for (const id of ownIds) assert.equal(Object.hasOwn(resetOwn.options, id), false); assert.deepEqual(plain(resetOwn.common), existing.common); assert.deepEqual(plain(resetOwn.options.red), existing.options.red); assert.equal(Object.getPrototypeOf(own.options), prototype); assert.equal(Object.prototype.material, undefined);
    const changes = [{ optionId: f.selected.optionId, fieldKey: 'material', value: 'saved label' }], outdated = plain(view); view = await json(await f.save(view, changes));
    assert.equal((await f.save(outdated, [{ ...changes[0], value: 'stale overwrite' }])).status, 409); assert.equal((await f.read()).rows.find(row => row.optionId === f.selected.optionId).values.material, 'saved label');
    const wrong = await f.api.load('db/category-profiles.ts').createCategoryProfile('owner', { ...f.profileInput, name: '다른 선택 프로필' }, 'wrong-profile');
    assert.equal((await f.api.route(f.base + '/product-labels?profileId=' + wrong.id)).status, 409);
    assert.equal((await f.api.route('/api/products/other-product/product-labels?profileId=' + f.profile.id)).status, 404);
    const ownerBefore = f.api.sqlite.prepare('SELECT owner_id FROM products WHERE id=?').get(f.product.id).owner_id;
    f.api.sqlite.prepare('UPDATE products SET owner_id=? WHERE id=?').run('foreign-owner', f.product.id);
    try { assert.equal((await f.api.route(f.endpoint)).status, 404); } finally { f.api.sqlite.prepare('UPDATE products SET owner_id=? WHERE id=?').run(ownerBefore, f.product.id); }
    const qRevision = (await f.readQuotation()).revision; quote = await f.saveQuotation(await f.readQuotation(), [{ optionId: f.selected.optionId, fieldKey: 'noticeMaterial', value: 'new legal material' }]);
    assert.equal(quote.revision, qRevision + 1); assert.equal((await f.save(view, [{ ...changes[0], value: 'old source overwrite' }])).status, 409); assert.equal((await f.read()).rows.find(row => row.optionId === f.selected.optionId).values.material, 'saved label');
    assert.deepEqual(f.snapshots(), source); assert.deepEqual(plain(quote.overrides.common), original.common); assert.equal(quote.overrides.options[f.selected.optionId].noticeMaterial, 'new legal material');
  } finally { f.api.close(); }
});

test('durable product PNG lookup and explicit retry recover lost upload, pool attachment and quote acknowledgements without duplicate files', async () => {
  for (const stage of ['upload', 'attachment', 'quotation']) {
    const f = await fixture(); try {
      const view = await f.read(), before = f.snapshots(), attachment = f.api.load('app/product-label-attachment.ts'), upload = f.api.load('app/product-label-upload.ts');
      let lost = true, recoveryReadUnavailable = false, rememberedKey = null;
      const request = async (url, init = {}) => {
        if (recoveryReadUnavailable && !init.method) return Response.json({ error: 'recovery read unavailable' }, { status: 503 });
        const response = await f.request(url, init);
        if (lost && response.ok && (stage === 'upload' ? url === '/api/files' && init.method === 'POST'
          : stage === 'attachment' ? url.endsWith('/attachments') && init.method === 'POST' : url === f.quotationEndpoint && init.method === 'PUT')) {
          lost = false; recoveryReadUnavailable = true; throw Error('committed ' + stage + ' acknowledgement lost');
        }
        return response;
      };
      const input = () => ({ productId: f.product.id, endpoint: f.endpoint, quotationEndpoint: f.quotationEndpoint, renderedView: view, optionId: f.selected.optionId,
        blob: rememberedKey ? null : new Blob([png], { type: 'image/png' }), uploadedKey: rememberedKey, onUploaded: key => rememberedKey = key });
      await assert.rejects(attachment.attachProductLabel(input(), request), /acknowledgement lost|recovery read unavailable/);
      recoveryReadUnavailable = false;
      const result = await attachment.attachProductLabel(input(), request); assert.ok(result.key); assert.equal(result.key, rememberedKey); assert.deepEqual(f.api.objects.get(result.key), png);
      assert.equal(f.requests.filter(row => row.url === '/api/files' && row.method === 'POST').length, 1, stage);
      assert.equal(f.requests.filter(row => row.url.endsWith('/attachments') && row.method === 'POST').length, 1, stage);
      assert.equal(f.requests.filter(row => row.url === f.quotationEndpoint && row.method === 'PUT').length, 1, stage);
      const quote = await f.readQuotation(); assert.equal(quote.resolved.rows.find(row => row.optionId === f.selected.optionId).fields.labelImages.value.split('\n').filter(key => key === result.key).length, 1);
      assert.ok(!quote.resolved.rows.find(row => row.optionId === f.other.optionId).fields.labelImages.value.includes(result.key)); assert.deepEqual(f.snapshots(), before);
      const reloaded = await f.read(), context = { productId: f.product.id, endpoint: f.endpoint, view: reloaded, optionId: f.selected.optionId };
      assert.equal((await upload.findProductLabelUpload(context, f.request)).key, result.key);
      const originalId = await upload.productLabelUploadId({ ...context, view }), otherEdited = plain(reloaded), otherRow = otherEdited.rows.find(row => row.optionId === f.other.optionId);
      otherEdited.overrides.options[f.other.optionId] = { material: 'unrelated SKU' }; otherRow.values.material = 'unrelated SKU'; otherRow.sources.material = 'manual-option';
      assert.equal(await upload.productLabelUploadId({ ...context, view: otherEdited }), originalId);
      const stale = plain(reloaded), changedRow = stale.rows.find(row => row.optionId === f.selected.optionId);
      stale.overrides.options[f.selected.optionId] = { material: 'changed visible label' }; changedRow.values.material = 'changed visible label'; changedRow.sources.material = 'manual-option';
      assert.notEqual(await upload.productLabelUploadId({ ...context, view: stale }), originalId);
      const count = f.requests.length;
      await assert.rejects(upload.findProductLabelUpload(context, async () => Response.json({ error: 'durable lookup unavailable' }, { status: 503 })), /durable lookup unavailable/);
      assert.equal(f.requests.length, count); assert.equal((await f.read()).revision, view.revision); assert.equal(f.api.sqlite.prepare('SELECT supplier_hub_status FROM products WHERE id=?').get(f.product.id).supplier_hub_status, '미전송');
    } finally { f.api.close(); }
  }
});

test('every returned label row and source must match exact stored overrides, including unrelated SKUs and all nine maps', async () => {
  const f = await fixture(); try {
    const view = await f.read(), model = f.api.load('app/product-label.ts');
    for (const [name, change] of [
      ['other values', body => body.rows.find(row => row.optionId === f.other.optionId).values.material = 'forged other SKU'],
      ['other source', body => body.rows.find(row => row.optionId === f.other.optionId).sources.material = 'manual-option'],
      ['duplicate option', body => body.rows.push(plain(body.rows.find(row => row.optionId === f.other.optionId)))],
      ['extra value', body => body.rows[0].values.unknown = 'unsupported'], ['extra automatic', body => body.rows[0].automatic.unknown = 'unsupported'],
      ['extra source', body => body.rows[0].sources.unknown = 'content'], ['missing field', body => delete body.rows[0].values.material],
      ['malformed category', body => body.categoryContext.categoryId = 'other-category'], ['empty path', body => body.categoryContext.categoryPath = []],
      ['duplicate image', body => body.imageKeys.push(body.imageKeys[0])], ['empty image', body => body.imageKeys.push('')],
    ]) { const invalid = plain(view); change(invalid); assert.throws(() => model.verifyProductLabelsView(invalid, f.selected.optionId, f.profile.id), /확인하지 못했습니다|확인/, name); }
    assert.equal(view.rows.find(row => row.optionId === f.selected.optionId).values.netContents, '');
    assert.equal(view.rows.find(row => row.optionId === f.selected.optionId).automatic.netContents, '');
    assert.equal((await f.read()).revision, 0);
  } finally { f.api.close(); }
});

test('selected final SEO and its manual blank supersede an old generated common product name without touching legacy content', async () => {
  const f = await fixture(); try {
    const contentRecord = f.api.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.product.id), content = JSON.parse(contentRecord.payload);
    content.labelProductNameLinked = false; content.label.productName = { ...content.label.productName, value: '이전 생성된 공통 제품명', provenance: 'generated' };
    f.api.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content), f.product.id);
    let quotation = await f.readQuotation(); quotation = await f.saveQuotation(quotation, [{ optionId: f.selected.optionId, fieldKey: 'title', value: '저장된 선택 옵션 SEO' }, { optionId: f.other.optionId, fieldKey: 'title', value: '' }]);
    const savedSource = f.snapshots(), view = await f.read(), selected = view.rows.find(row => row.optionId === f.selected.optionId), other = view.rows.find(row => row.optionId === f.other.optionId);
    assert.equal(selected.values.productName, '저장된 선택 옵션 SEO'); assert.equal(selected.sources.productName, 'quotation');
    assert.equal(other.values.productName, ''); assert.equal(other.sources.productName, 'empty'); assert.deepEqual(f.snapshots(), savedSource);
    content.label.productName = { ...content.label.productName, value: '', provenance: 'manual' };
    f.api.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content), f.product.id);
    const manuallyBlank = await f.read(); assert.equal(manuallyBlank.rows.find(row => row.optionId === f.selected.optionId).values.productName, ''); assert.equal(manuallyBlank.rows.find(row => row.optionId === f.selected.optionId).sources.productName, 'content');
    assert.equal((await f.readQuotation()).overrides.options[f.selected.optionId].title, '저장된 선택 옵션 SEO');
  } finally { f.api.close(); }
});

test('a product removed after the API snapshot cannot commit either first label storage or a new product clock', async () => {
  const f = await fixture(); try {
    const view = await f.read(), before = f.snapshots(), prepare = f.api.db.prepare.bind(f.api.db), batch = f.api.db.batch.bind(f.api.db); let raced = false;
    f.api.db.prepare = sql => { const statement = prepare(sql); statement.labelTestSql = sql; return statement; };
    f.api.db.batch = async statements => {
      if (!raced && statements.some(statement => /INSERT INTO product_labels\(/.test(statement.labelTestSql ?? ''))) {
        raced = true; f.api.sqlite.prepare('INSERT INTO product_removals(product_id,owner_id,removed_at,product_version) VALUES(?,?,?,?)').run(f.product.id, 'owner', new Date().toISOString(), view.productVersion);
      }
      return batch(statements);
    };
    const response = await f.save(view, [{ optionId: f.selected.optionId, fieldKey: 'material', value: 'must not commit' }]);
    assert.equal(response.status, 409, await response.clone().text()); assert.equal(raced, true);
    assert.equal(f.api.sqlite.prepare('SELECT COUNT(*) AS count FROM product_labels WHERE product_id=?').get(f.product.id).count, 0);
    assert.equal(f.api.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(f.product.id).updated_at, view.productVersion); assert.deepEqual(f.snapshots(), before);
  } finally { f.api.close(); }
});

test('a changed nine-row plan after PNG upload preserves its durable file and prevents the pool or quotation write', async () => {
  const f = await fixture(); try {
    const attachment = f.api.load('app/product-label-attachment.ts'), upload = f.api.load('app/product-label-upload.ts'), view = await f.read(), source = f.snapshots(); let changed = false, oldKey = null;
    const request = async (url, init = {}) => {
      const response = await f.request(url, init);
      if (!changed && url === '/api/files' && init.method === 'POST' && response.ok) {
        changed = true; await json(await f.save(await f.read(), [{ optionId: f.selected.optionId, fieldKey: 'material', value: '업로드 중 변경된 재질' }]));
      }
      return response;
    };
    const input = { productId: f.product.id, endpoint: f.endpoint, quotationEndpoint: f.quotationEndpoint, renderedView: view, optionId: f.selected.optionId, blob: new Blob([png], { type: 'image/png' }), uploadedKey: null, onUploaded: key => oldKey = key };
    await assert.rejects(attachment.attachProductLabel(input, request), /변경|다시/); assert.ok(oldKey); assert.deepEqual(f.api.objects.get(oldKey), png);
    assert.equal(f.requests.some(row => row.url.endsWith('/attachments') || row.url === f.quotationEndpoint && row.method === 'PUT'), false);
    assert.ok(!(await f.readQuotation()).imageKeys.includes(oldKey)); assert.equal((await upload.findProductLabelUpload({ productId: f.product.id, endpoint: f.endpoint, view, optionId: f.selected.optionId }, f.request)).key, oldKey);
    const latest = await f.read(), current = await attachment.attachProductLabel({ ...input, renderedView: latest, uploadedKey: null, onUploaded() {} }, f.request);
    assert.notEqual(current.key, oldKey); assert.deepEqual(f.api.objects.get(current.key), png); assert.ok(f.api.objects.has(oldKey));
    assert.equal(f.requests.filter(row => row.url === '/api/files' && row.method === 'POST').length, 2); assert.deepEqual(f.snapshots(), source);
  } finally { f.api.close(); }
});

test('common nine-row editing and an explicitly generated common PNG preserve selected labels and legacy common content', async () => {
  const f = await fixture(companies[1]); try {
    const source = f.snapshots(), attachment = f.api.load('app/product-label-attachment.ts'), model = f.api.load('app/product-label.ts'); let view = await f.read();
    view = await json(await f.save(view, [{ optionId: null, fieldKey: 'productName', value: '공통 제품 라벨' }, { optionId: null, fieldKey: 'netContents', value: '' },
      { optionId: f.selected.optionId, fieldKey: 'productName', value: '개별 제품 라벨' }]));
    const selected = plain(view.overrides.options[f.selected.optionId]), plan = model.productLabelPlan(view, null); assert.equal(plan.rows.length, 9); assert.equal(plan.rows[0][1], '공통 제품 라벨'); assert.equal(plan.rows[4][1], '');
    const result = await attachment.attachProductLabel({ productId: f.product.id, endpoint: f.endpoint, quotationEndpoint: f.quotationEndpoint, renderedView: view,
      optionId: null, blob: new Blob([png], { type: 'image/png' }), uploadedKey: null, onUploaded() {} }, f.request);
    const quote = await f.readQuotation(); assert.ok(quote.overrides.common.labelImages.split('\n').includes(result.key)); assert.equal(Object.hasOwn(quote.overrides.options, f.selected.optionId), false);
    assert.deepEqual(plain((await f.read()).overrides.options[f.selected.optionId]), selected); assert.deepEqual(f.snapshots(), source);
    const before = await f.read(), reset = await json(await f.save(before, [{ optionId: null, fieldKey: 'productName', value: null }]));
    assert.equal(reset.rows.find(row => row.optionId === null).values.productName, reset.rows.find(row => row.optionId === null).automatic.productName);
    assert.equal(reset.rows.find(row => row.optionId === f.selected.optionId).values.productName, '개별 제품 라벨'); assert.equal(Object.hasOwn(reset.overrides.common, 'productName'), false);
  } finally { f.api.close(); }
});
