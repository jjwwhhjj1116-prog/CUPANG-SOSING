import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';

// Recorded public source only. Google responses and image bytes are fixtures;
// this exercises the actual intake/translation/content/quotation handlers and
// SQLite without contacting Supplier Hub or any external translation service.
const recorded = JSON.parse(fs.readFileSync(new URL('./fixtures/1688-mobile-813724060928.json', import.meta.url), 'utf8'));
const attributes = recorded.data['590893002003'].data.propsList;
const names = [
  '편광 여부', 'UV 등급', '렌즈 재질', '브랜드', '안경 형태', '테 재질', '안경테 재질', '근시용 렌즈 지원 여부',
  '판매자 품번', '렌즈 색상', '테 색상', '투과율 분류', '안경 구조', '사용 상황', '출시 연도/계절', '수출 전용 상품 여부',
  '색상', '사이즈', '생산지', '스타일', '사용 성별', '스타일 분류', '주요 판매 지역', '유행 요소 분류',
];
const values = [
  '아니요', 'UV380', 'PC', '리샹', '원형 테', 'PC', 'PC', '근시용 렌즈 미지원', '15995', '검정', '검정',
  '2등급/선글라스', '풀 테', '차광,외출,자전거 타기,운전,파티 모임', '2024년 여름', '예',
  '유광 검정,무광 검정,무광 회색', '선글라스,선글라스 + 005 케이스', '타이저우',
  '귀여운 스타일,일본 한국 스타일,사랑스러운 스타일,산뜻한 스타일', '공용', '산뜻하고 사랑스러운 스타일',
  '아프리카,유럽,남미,동남아,북미,동북아,중동,기타', '생활용품',
];
assert.equal(attributes.length, names.length); assert.equal(attributes.length, values.length);
const title = recorded.globalData.tempModel.offerTitle;
const dictionary = new Map([[title, '우드 패턴 다리 남녀공용 선글라스']]);
attributes.forEach((pair, index) => { dictionary.set(pair.name, names[index]); dictionary.set(pair.value, values[index]); });
const colors = new Map([['亮黑', '유광 검정'], ['砂黑', '무광 검정'], ['砂灰', '무광 회색']]);
const sizes = new Map([['太阳镜', '선글라스'], ['太阳镜 加005 盒子', '선글라스 + 005 케이스']]);
for (const [source, value] of [...colors, ...sizes]) dictionary.set(source, value);
for (const [color, translatedColor] of colors) for (const [size, translatedSize] of sizes) {
  dictionary.set(`${color} / ${size}`, `${translatedColor} / ${translatedSize}`);
}
const categoryPath = ['패션의류잡화', '유니섹스/남녀공용 패션', '공용 잡화', '선글라스', '남녀공용패션선글라스'];
const companies = [{ companyCode: 'A01464742', companyName: '와이홉' }, { companyCode: 'A01526306', companyName: '유앤채' }];
const payload = (h, table) => JSON.parse(h.sqlite.prepare(`SELECT payload FROM ${table}`).get().payload);
const product = h => h.sqlite.prepare('SELECT * FROM products').get();
const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
function googleFixture(queries, malformed = false) {
  return async (target, init) => {
    const url = new URL(target), query = url.searchParams.get('q'); queries.push(query);
    assert.equal(url.origin, 'https://translate.googleapis.com'); assert.equal(url.pathname, '/translate_a/single');
    assert.deepEqual([...url.searchParams].map(([key]) => key), ['client', 'sl', 'tl', 'dt', 'q']);
    assert.equal(url.searchParams.get('client'), 'gtx'); assert.equal(url.searchParams.get('sl'), 'auto');
    assert.equal(url.searchParams.get('tl'), 'ko'); assert.equal(url.searchParams.get('dt'), 't');
    assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); assert.equal(init.credentials, 'omit');
    const translate = source => { assert.ok(dictionary.has(source), `Unexpected source text: ${source}`); return dictionary.get(source); };
    let translated;
    if (!query.startsWith('[[YFTR')) translated = translate(query);
    else {
      const lines = query.split('\n').map(line => {
        const match = /^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line); assert.ok(match);
        return `${match[1]} ${translate(match[2])}`;
      }).reverse(); // IDs must bind independently of response order.
      translated = malformed ? lines.map(line => line.replace(/^\[\[YFTR\d{6}\]\]/u, '[[YFTR999999]]')).join('\n') : lines.join('\n');
    }
    return Response.json([[[translated, query, null, null]], null, 'zh-CN']);
  };
}
async function capturedCategory(h, company) {
  const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', {
    name: '기록 원문 선글라스 연결 시험', categoryId: '69900', categoryPath, template: null, mappings: [],
  }, 'cat');
  h.context.category = profile; h.context.settings = { ...h.context.settings, brand: company.companyName };
  h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context), 'job');
  h.sqlite.prepare("UPDATE collection_jobs SET goal='work' WHERE id='job'").run();
  // A later account setting must not be substituted into this captured draft.
  await h.load('db/queries.ts').saveSettings('owner', JSON.stringify({ ...h.settings, brand: '나중 브랜드', importer: '다른 수입자', exchangeRate: 999 }));
  h.bindings.SOURCEFLOW_TEXT_PROVIDER = 'google-free'; delete h.bindings.AI;
  return profile;
}
function currentState(h) {
  return JSON.stringify({ product: product(h), content: payload(h, 'product_content'), options: payload(h, 'product_options'),
    quotation: h.sqlite.prepare('SELECT * FROM product_quotation_fields').all(), receipt: payload(h, 'collection_results'), context: payload(h, 'collection_context') });
}

for (const company of companies) test(`Google two-request intake persists exact category, company, options, images and reviewed quotation (${company.companyCode})`, async () => {
  const queries = [], h = mobileIntakeHarness({ ...company, translationFetcher: googleFixture(queries) });
  try {
    const profile = await capturedCategory(h, company), captured = JSON.stringify(h.context);
    assert.match(await h.intake(), /상품 초안 저장됨/);
    assert.equal(queries.length, 2); assert.equal(queries[0], title);
    assert.equal(h.aiSources.length, 0); assert.equal(h.stats.downloads, 19);
    const source = payload(h, 'collection_results'), content = payload(h, 'product_content'), options = payload(h, 'product_options');
    const job = h.sqlite.prepare('SELECT * FROM translation_jobs').get(), result = JSON.parse(job.result), review = JSON.parse(job.review);
    assert.equal(job.status, 'completed'); assert.equal(review.model, 'google-translate-gtx'); assert.equal(result.translationRequests, 2);
    assert.equal(review.source.category.id, '69900'); assert.deepEqual(review.source.category.path, categoryPath);
    assert.equal(review.source.attributes.length, 42); assert.equal(result.draft.attributes.length, 42);
    assert.equal(result.googleStoppedHttpStatus, undefined); assert.equal(result.usage, null);
    const generatedTitle = `${company.companyName} 우드 패턴 다리 남녀공용 선글라스`;
    assert.equal(product(h).title, source.title); assert.equal(content.seo.title.value, generatedTitle);
    assert.equal(content.label.productName.value, generatedTitle); assert.equal(content.labelProductNameLinked, true);
    assert.equal(content.categoryAttributes.categoryId, '69900'); assert.equal(content.categoryAttributes.values.length, 24);
    for (const row of options.rows) {
      const original = source.options.find(item => item.sku === row.supplierSku); assert.ok(original);
      assert.equal(row.originalName, original.name); assert.equal(row.translatedName, dictionary.get(original.name));
      assert.equal(row.color, colors.get(original.color)); assert.equal(row.size, sizes.get(original.size));
      assert.equal(row.provenance.translatedName, 'translated'); assert.equal(row.provenance.color, 'translated'); assert.equal(row.provenance.size, 'translated');
      assert.equal(row.unitCostCny, original.unitPriceCny); assert.ok(row.imageKey);
    }
    for (const role of ['main', 'additional', 'detail']) assert.ok(content.assets[role].value.length, role);
    const base = '/api/products/' + product(h).id;
    let view = await json(await h.route(base + '/quotation-fields'));
    assert.equal(view.categoryContext.profileId, profile.id); assert.equal(view.categoryContext.categoryId, '69900');
    assert.deepEqual(view.categoryContext.categoryPath, categoryPath);
    for (const row of view.resolved.rows.filter(row => row.optionId)) {
      const option = options.rows.find(option => option.id === row.optionId);
      const expected = option.unitCostCny === 3.6 ? ['4260', '7100', '9230'] : ['4930', '8220', '10690'];
      assert.equal(row.fields.title.value, generatedTitle); assert.equal(row.fields.brand.value, company.companyName);
      assert.equal(row.fields.brand.source, 'settings'); assert.equal(row.fields.mainImage.value, option.imageKey);
      assert.equal(row.fields.additionalImages.value, content.assets.additional.value.join('\n'));
      assert.equal(row.fields.detailImages.value, content.assets.detail.value.join('\n'));
      assert.deepEqual(['supplyPrice', 'salePrice', 'msrp'].map(field => row.fields[field].value), expected);
    }
    // Manual edits after generation, including explicit blanks, are authoritative.
    await json(await h.route(base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision, patch: {
      seo: { title: '직접 확인한 선글라스', description: '', keywords: [] }, assets: { detail: [] },
    } } }));
    const inputs = h.load('app/product-options.ts').optionInputs(options); inputs[0].translatedName = ''; inputs[0].color = ''; inputs.at(-1).included = false;
    const removed = inputs.splice(4, 1)[0]; // The old completed result still references this explicitly deleted option.
    await json(await h.route(base + '/options', { method: 'PATCH', body: { expectedRevision: options.revision, expectedProductVersion: product(h).updated_at, rows: inputs } }));
    view = await json(await h.route(base + '/quotation-fields'));
    await json(await h.route(base + '/quotation-fields', { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [
      { fieldKey: 'title', optionId: null, value: '견적 검토 상품명' }, { fieldKey: 'salePrice', optionId: inputs[0].id, value: '9990' },
      { fieldKey: 'mainImage', optionId: inputs[0].id, value: '' },
    ] } }));
    const before = currentState(h), network = h.network.length;
    await h.intake(); assert.equal(queries.length, 2); assert.equal(h.network.length, network); assert.equal(currentState(h), before);
    assert.ok(!payload(h, 'product_options').rows.some(row => row.id === removed.id));
    assert.deepEqual(h.sqlite.prepare('SELECT * FROM translation_jobs').get(), job, 'replay planning cannot edit the canonical result');
    assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context').get().payload, captured);
    const fields = ['skuId', 'categoryId', 'sourceUrl', 'title', 'brand', 'supplyPrice', 'salePrice', 'msrp', 'mainImage', 'detailImages'];
    const workbook = quotationWorkbook(fields), sha256 = Buffer.from(await webcrypto.subtle.digest('SHA-256', workbook)).toString('hex');
    const storageKey = h.load('db/category-templates.ts').templateKey('owner', sha256, 'xlsx'); h.objects.set(storageKey, workbook);
    const mappedProfile = await h.load('db/category-profiles.ts').updateCategoryProfile('owner', profile.id, profile.revision, { name: '합성 Google 견적 연결 시험', categoryId: '69900', categoryPath,
      template: { name: 'synthetic.xlsx', format: 'xlsx', sha256, storageKey, sheetName: '견적서', headerRow: 1, headers: fields },
      mappings: fields.map((field, column) => ({ field, column, required: false })),
    }); assert.ok(mappedProfile);
    const preview = await json(await h.route(base + '/quotation', { method: 'POST', body: { action: 'preview' } }));
    assert.equal(preview.rows.length, 4); assert.deepEqual(preview.report.company, { code: company.companyCode, name: company.companyName });
    const downloaded = await h.route(base + '/quotation', { method: 'POST', body: { action: 'download', fingerprint: preview.fingerprint } });
    assert.equal(downloaded.status, 200, await downloaded.clone().text());
    const reader = h.load('app/xlsx-template.ts'), sheets = reader.inspectXlsxArchive(await reader.readXlsxArchive(await downloaded.arrayBuffer()));
    for (let index = 0; index < 4; index++) {
      const row = Object.fromEntries(fields.map((field, column) => [field, reader.xlsxHeaders(sheets, '견적서', index + 2)[column]]));
      assert.equal(row.categoryId, '69900'); assert.equal(row.sourceUrl, h.sourceUrl); assert.equal(row.title, '견적 검토 상품명');
      assert.equal(row.brand, company.companyName); assert.equal(row.detailImages, '');
      if (!index) { assert.equal(row.salePrice, '9990'); assert.equal(row.mainImage, ''); }
    }
    assert.equal(product(h).supplier_hub_status, '미전송'); assert.ok(!h.network.includes('supplier.coupang.com'));
  } finally { h.close(); }
});

test('a damaged Google batch keeps editable title and recorded options without claiming completed option translation', async () => {
  const queries = [], h = mobileIntakeHarness({ ...companies[0], translationFetcher: googleFixture(queries, true) });
  try {
    await capturedCategory(h, companies[0]);
    const message = await h.intake(); assert.match(message, /검토 필요/); assert.equal(queries.length, 2);
    const options = payload(h, 'product_options'), content = payload(h, 'product_content');
    assert.equal(content.seo.title.value, '와이홉 우드 패턴 다리 남녀공용 선글라스');
    assert.equal(content.categoryAttributes, undefined);
    assert.ok(options.rows.every(row => row.translatedName === '' && row.provenance.translatedName !== 'translated'));
    assert.ok(options.rows.every(row => row.provenance.color === 'collected' && row.provenance.size === 'collected'));
    assert.ok(options.rows.every(row => row.imageKey)); assert.ok(content.assets.detail.value.length);
    const before = currentState(h); await h.intake(); assert.equal(queries.length, 2); assert.equal(currentState(h), before);
    const saved = h.sqlite.prepare('SELECT * FROM translation_jobs').get(); assert.equal(saved.status, 'completed');
    assert.match(JSON.parse(saved.result).draft.warnings.join(' '), /식별자.*묶음/);
    assert.equal(product(h).supplier_hub_status, '미전송'); assert.equal(h.aiSources.length, 0);
  } finally { h.close(); }
});
