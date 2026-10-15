import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const companies = [{ code: 'A01526306', name: '유앤채' }, { code: 'A01464742', name: '와이홉' }];
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=', 'base64'));
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };

/** Actual private SQLite/API and in-memory object-store fixture. Synthetic
 * product/template only; no source, translation or Supplier Hub is contacted. */
export async function manualDetailExportFixture(company = companies[0]) {
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name,
    sourceFetcher: async () => { throw Error('No external source requests in manual HTML tests.'); } });
  const owner = 'owner', id = 'manual-detail-' + company.code, at = '2026-10-15T02:00:00.000Z';
  const keys = ['owner/manual-detail-top-' + company.code + '.png', 'owner/manual-detail-body-' + company.code + '.png'];
  keys.forEach((key, index) => h.objects.set(key, new Uint8Array([...png, index])));
  h.bindings.YOOFAM_DETAIL_IMAGE_SECRET = 'a1'.repeat(32); h.bindings.YOOFAM_DETAIL_IMAGE_ORIGIN = 'https://detail.example.test';
  const product = { id, owner_id: owner, source_url: 'synthetic://manual-detail/' + company.code, title: 'LOCAL manual detail',
    source_price_cny: 2.99, exchange_rate: 350, supply_margin: 50, coupang_margin: 40, supply_price: 4050, sale_price: 6750, msrp: 8780,
    options_count: 2, seo_status: '대기', image_status: '대기', quote_status: '대기', registration_status: '미전송', supplier_hub_status: '미전송',
    image_keys: JSON.stringify(keys), goal_stage: 'collect', created_at: at, updated_at: at };
  await h.load('db/queries.ts').insertProduct(product, { exchangeRate: 350, supplyMargin: 50, coupangMargin: 40,
    minimumMargin: 3000, msrpMultiple: 1.3, roundingUnit: 10, roundingMode: 'nearest' });
  const model = h.load('app/product-options.ts'), rows = ['one', 'two'].map(optionId => ({ ...model.emptyOptionInput(optionId),
    originalName: optionId, translatedName: '합성 옵션 ' + optionId, unitCostCny: 2.99, included: true }));
  await h.load('db/product-options.ts').saveProductOptions(owner, model.applyOptionRows(model.emptyProductOptions(id), rows, at), 0, at);
  const contentModel = h.load('app/product-content.ts'), content = contentModel.applyContentPatch(contentModel.emptyProductContent(id),
    { detail: { description: '저장한 상세 설명', altText: '저장한 대체 문구' }, assets: { detailTop: [keys[0]], detail: [keys[1]] } }, at);
  await h.load('db/product-content.ts').saveProductContent(owner, content, 0, product.image_keys);
  const bytes = new TextEncoder().encode('HTML 상품 상세 컨텐츠,상세이미지 파일명\r\n'), sha256 = createHash('sha256').update(bytes).digest('hex');
  const templateKey = `${owner}/category-templates/${sha256}.csv`; h.objects.set(templateKey, bytes);
  const profile = await h.load('db/category-profiles.ts').createCategoryProfile(owner, { name: 'LOCAL manual HTML CSV', categoryId: '80719',
    categoryPath: [...h.load('app/quotation-schema.ts').getQuotationSchema('80719').categoryPath],
    template: { name: 'local-manual-html.csv', format: 'csv', sha256, sheetName: '', headerRow: 1,
      headers: ['HTML 상품 상세 컨텐츠', '상세이미지 파일명'], storageKey: templateKey },
    mappings: [{ column: 0, field: 'detailHtml', required: false }, { column: 1, field: 'detailImages', required: false }] });
  const publications = [], files = h.bindings.FILES, get = files.get, put = files.put;
  files.get = async key => { const object = await get(key); return object ? { ...object, body: new Response(await object.arrayBuffer()).body } : null; };
  files.put = async (key, data, settings) => { const result = await put(key, data, settings); if (key.startsWith('quotation-public-detail/')) publications.push(key);
    return result === null ? null : files.head(key); };
  const context = { params: Promise.resolve({ id }) }, fieldsUrl = `https://app.test/api/products/${id}/quotation-fields?profileId=${profile.id}`;
  const getView = () => h.load('app/api/products/[id]/quotation-fields/route.ts').GET(new Request(fieldsUrl), context);
  const saveHtml = async (html, view) => {
    const current = view ?? await json(await getView());
    return h.load('app/api/products/[id]/quotation-fields/route.ts').PUT(new Request(fieldsUrl, { method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'https://app.test' }, body: JSON.stringify({ expectedRevision: current.revision,
        expectedInputFingerprint: current.inputFingerprint, changes: [{ optionId: null, fieldKey: 'detailHtml', value: html }] }) }), context);
  };
  const quotation = input => h.load('app/api/products/[id]/quotation/route.ts').POST(new Request(`https://app.test/api/products/${id}/quotation`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profileId: profile.id, ...input }) }), context);
  const media = (url, token = new URL(url).pathname.split('/').at(-1)) => h.load('app/media/quotation/[token]/route.ts').GET(new Request(url), { params: Promise.resolve({ token }) });
  const snapshot = () => JSON.stringify(['products', 'product_options', 'product_content', 'product_quotation_fields', 'category_profiles'].map(table =>
    [table, h.sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()]));
  return { ...h, company, product, profile, keys, publications, getView, saveHtml, quotation, media, snapshot };
}

for (const company of companies) {
  test(`saved edited preview HTML reaches actual CSV and published image responses without rewriting manual content (${company.code})`, async () => {
    const h = await manualDetailExportFixture(company); try {
      const view = await json(await h.getView()), generated = view.resolved.rows.find(row => row.optionId === 'one').fields.detailHtml.value;
      const urls = [...generated.matchAll(/src="(https:\/\/detail\.example\.test\/media\/quotation\/[a-f0-9]{64})"/g)].map(match => match[1]);
      assert.equal(urls.length, 2); assert.equal(h.publications.length, 0);
      for (const url of urls) assert.equal((await h.media(url)).status, 404);
      const html = generated.replace('margin:0', 'margin:9px') + '<p data-reviewed="yes">수동 수정 &amp; 原文 보존</p>';
      const saved = await json(await h.saveHtml(html, view));
      assert.ok(saved.resolved.rows.every(row => row.fields.detailHtml.value === html)); assert.equal(h.publications.length, 0);
      const reviewed = await json(await h.quotation({ action: 'preview' }));
      assert.deepEqual(reviewed.report.company, company); assert.equal(reviewed.report.publicDetailImages.count, 2);
      assert.equal(reviewed.report.publicDetailImages.publishedByThisRequest, false); assert.ok(reviewed.rows.every(row => row[0] === html));
      const before = h.snapshot(), response = await h.quotation({ action: 'export', fingerprint: reviewed.fingerprint });
      assert.equal(response.status, 200, await response.clone().text()); const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
      const plan = JSON.parse(new TextDecoder().decode(archive['supplier-hub-upload-plan.json'])); assert.deepEqual(plan.company, company);
      const csv = new TextDecoder().decode(archive[plan.quotation.file.filename]);
      assert.ok(csv.includes('"' + html.replaceAll('"', '""') + '"'), 'CSV contains the exact escaped manual HTML cell');
      assert.ok(csv.includes('margin:9px')); assert.ok(csv.includes('수동 수정 &amp; 原文 보존')); assert.ok(urls.every(url => csv.includes(url)));
      const fields = JSON.parse(new TextDecoder().decode(archive['quotation-fields.json']));
      assert.ok(fields.rows.every(row => row.fields.detailHtml.value === html)); assert.equal(h.publications.length, 2);
      assert.equal(h.snapshot(), before, 'export/publication never rewrites saved source rows or manual quotation text');
      for (const url of urls) { const media = await h.media(url); assert.equal(media.status, 200); assert.equal(media.headers.get('content-type'), 'image/png'); }
      const downloaded = await h.quotation({ action: 'download', fingerprint: reviewed.fingerprint }); assert.equal(downloaded.status, 200);
      assert.equal(new TextDecoder().decode(await downloaded.arrayBuffer()), csv); assert.equal(h.snapshot(), before);
      assert.deepEqual(h.network, []);
    } finally { h.close(); }
  });
}
