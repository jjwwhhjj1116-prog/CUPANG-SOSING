import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const companies = [
  { companyCode: 'A01464742', companyName: '와이홉' },
  { companyCode: 'A01526306', companyName: '유앤채' },
];
const scenarios = [
  // The single-line blocks on either side of the multiline SKU are separate:
  // essential title + preceding description + multiline name + valid fields.
  { name: 'multiline option name', originalName: '白色\n大号', translatedName: '흰색\n대형', requests: 4, badField: 'translatedName' },
  { name: 'expanded option name', originalName: '白色' + '产品'.repeat(120), translatedName: '제품'.repeat(251), requests: 2, badField: 'translatedName' },
  { name: 'expanded color', originalName: '白色', translatedName: '흰색', originalColor: '浅'.repeat(100), translatedColor: '밝'.repeat(201), requests: 2, badField: 'color' },
];
const json = async (response, status = 200) => {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
};
const product = h => h.sqlite.prepare('SELECT * FROM products').get();
const payload = (h, table) => JSON.parse(h.sqlite.prepare(`SELECT payload FROM ${table}`).get().payload);
const translationRow = h => h.sqlite.prepare("SELECT * FROM translation_jobs WHERE idempotency_key='intake-auto-v1'").get();

function preservedFacts(h) {
  const { updated_at: clock, ...record } = product(h);
  assert.ok(Number.isFinite(Date.parse(clock)));
  return JSON.stringify({
    record,
    context: h.sqlite.prepare('SELECT * FROM collection_context ORDER BY job_id').all(),
    source: h.sqlite.prepare('SELECT * FROM collection_results ORDER BY job_id').all(),
    category: h.sqlite.prepare('SELECT * FROM category_profiles ORDER BY id').all(),
    policy: h.sqlite.prepare('SELECT * FROM product_price_policy ORDER BY product_id').all(),
    receipts: h.sqlite.prepare('SELECT * FROM supplier_hub_receipts ORDER BY fingerprint').all(),
    optionPrices: payload(h, 'product_options').rows.map(row => ({
      id: row.id, originalName: row.originalName, supplierSku: row.supplierSku,
      unitCostCny: row.unitCostCny, unitsPerPack: row.unitsPerPack,
      minimumOrderQuantity: row.minimumOrderQuantity, included: row.included,
    })),
    objectBytes: [...h.objects].map(([key, bytes]) => [key, [...bytes]]),
  });
}

function savedDraft(h) {
  return JSON.stringify({
    product: product(h),
    content: h.sqlite.prepare('SELECT * FROM product_content').all(),
    options: h.sqlite.prepare('SELECT * FROM product_options').all(),
    jobs: h.sqlite.prepare('SELECT * FROM translation_jobs ORDER BY id').all(),
  });
}

async function fixture(company, scenario) {
  // This new synthetic offer is the only source URL the transport may read.
  // The helper's recorded default offer is never collected by these tests.
  const offerId = '632010000011', url = `https://detail.1688.com/offer/${offerId}.html`;
  const queries = [];
  const dictionary = new Map([
    ['合成收纳箱', '합성 수납함'], ['塑料收纳', '플라스틱 수납'],
    ['材质', '재질'], ['塑料', '플라스틱'],
    [scenario.originalName, scenario.translatedName],
    ['红色 小号', '빨강 소형'], ['红色', '빨강'], ['小号', '소형'],
    ...(scenario.originalColor ? [[scenario.originalColor, scenario.translatedColor]] : []),
  ]);
  const source = {
    '@context': 'https://schema.org', '@type': 'Product', url,
    name: '合成收纳箱', description: '塑料收纳',
    additionalProperty: [{ '@type': 'PropertyValue', name: '材质', value: '塑料' }],
    hasVariant: [
      { '@type': 'Product', sku: offerId + '01', name: scenario.originalName,
        ...(scenario.originalColor ? { color: scenario.originalColor } : {}),
        offers: { '@type': 'Offer', price: '5.5', priceCurrency: 'CNY',
          eligibleQuantity: { '@type': 'QuantitativeValue', minValue: 2 } } },
      { '@type': 'Product', sku: offerId + '02', name: '红色 小号', color: '红色', size: '小号',
        offers: { '@type': 'Offer', price: '7.25', priceCurrency: 'CNY',
          eligibleQuantity: { '@type': 'QuantitativeValue', minValue: 3 } } },
    ],
  };
  const h = mobileIntakeHarness({ ...company,
    sourceFetcher: async target => {
      assert.equal(String(target), url, 'no other supplier offer may be accessed');
      return new Response('<script type="application/ld+json">' + JSON.stringify(source) + '</script>',
        { headers: { 'content-type': 'text/html' } });
    },
    translationFetcher: async target => {
      const q = new URL(target).searchParams.get('q'); queries.push(q);
      const translate = value => {
        assert.ok(dictionary.has(value), 'unexpected supplier text: ' + value);
        return dictionary.get(value);
      };
      const translated = q.startsWith('[[YFTR') ? q.split('\n').map(line => {
        const match = /^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line); assert.ok(match);
        return match[1] + ' ' + translate(match[2]);
      }).join('\n') : translate(q);
      return Response.json([[[translated, q]], null, 'zh-CN']);
    },
  });
  try {
    h.bindings.SOURCEFLOW_TEXT_PROVIDER = 'google-free'; delete h.bindings.AI;
    await h.load('db/queries.ts').saveSettings('owner', JSON.stringify({ ...h.settings, brand: company.companyName }));
    const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', {
      name: '옵션 출력 경계 합성', categoryId: '80719', categoryPath: h.context.category.categoryPath,
      template: null, mappings: [],
    });
    const queued = await json(await h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ urls: [url], goal: 'price', profileId: profile.id, expectedProfileRevision: profile.revision }),
    })));
    const message = await h.intake(queued.jobs[0].id);
    const base = '/api/products/' + product(h).id;
    const fetcher = (path, init) => h.route(path, { method: init?.method ?? 'GET', body: init?.body });
    return { h, queries, profile, message, base, fetcher, source, url };
  } catch (error) { h.close(); throw error; }
}

function assertPartial(outcome) {
  assert.equal(outcome.completed, false);
  assert.equal(outcome.manualReady, false);
  assert.equal(outcome.reviewRequired, true, outcome.message);
  assert.match(outcome.message, /검토 필요.*누락/u);
}

for (const company of companies) for (const scenario of scenarios) {
  test(`intake preserves one invalid ${scenario.name} and adopts the valid draft, legacy replay and manual edits (${company.companyCode})`, async () => {
    const f = await fixture(company, scenario), { h } = f;
    try {
      const currentProduct = product(h), content = payload(h, 'product_content'), options = payload(h, 'product_options');
      const row = translationRow(h), review = JSON.parse(row.review), result = JSON.parse(row.result);
      const first = options.rows[0], second = options.rows[1];
      assert.equal(row.status, 'completed'); assert.equal(review.instructionsVersion, 'sourceflow-translation-v6');
      assert.equal(result.model, 'google-translate-gtx'); assert.equal(result.translationRequests, scenario.requests);
      assert.equal(f.queries.length, scenario.requests); assert.equal(h.aiSources.length, 0);
      assert.equal(result.draft.title, '합성 수납함'); assert.equal(result.draft.description, '플라스틱 수납');
      assert.equal(content.seo.title.value, company.companyName + ' 합성 수납함');
      assert.equal(content.seo.description.value, '플라스틱 수납');
      assert.equal(content.label.material.value, '플라스틱');
      assert.equal(content.categoryAttributes.categoryId, f.profile.categoryId);
      assert.deepEqual(content.categoryAttributes.values.map(({ name, value }) => [name, value]), [['재질', '플라스틱']]);
      assert.equal(first.originalName, scenario.originalName);
      if (scenario.badField === 'translatedName') {
        assert.equal(first.translatedName, ''); assert.notEqual(first.provenance.translatedName, 'translated');
      } else {
        assert.equal(first.translatedName, scenario.translatedName); assert.equal(first.provenance.translatedName, 'translated');
        assert.equal(first.color, scenario.originalColor); assert.equal(first.provenance.color, 'collected');
      }
      assert.equal(second.originalName, '红色 小号'); assert.equal(second.translatedName, '빨강 소형');
      assert.equal(second.color, '빨강'); assert.equal(second.size, '소형');
      for (const field of ['translatedName', 'color', 'size']) assert.equal(second.provenance[field], 'translated');
      assert.deepEqual(options.rows.map(item => [item.unitCostCny, item.minimumOrderQuantity]), [[5.5, 2], [7.25, 3]]);
      assert.equal(currentProduct.source_url, f.url); assert.equal(currentProduct.source_price_cny, 5.5);
      assert.equal(currentProduct.supplier_hub_status, '미전송');
      assert.match(f.message, /상품 초안 저장됨.*검토 필요/u);

      const badBinding = (scenario.badField === 'color' ? 'option-color:' : 'option:') + first.id;
      const badIndex = review.source.attributes.findIndex(pair => pair.name === badBinding);
      assert.ok(badIndex >= 0); assert.equal(review.source.attributes[badIndex].value, scenario.badField === 'color' ? scenario.originalColor : scenario.originalName);
      assert.ok(!result.draft.attributes.some(attribute => attribute.sourceIndex === badIndex));
      const coverage = h.load('app/automation/translation.ts').translationAttributeCoverage;
      assert.deepEqual([...coverage(review.source, result.draft).missingSourceIndexes], [badIndex]);
      assert.ok(result.draft.warnings.some(value => /입력 규격/u.test(value)));
      const facts = preservedFacts(h), beforeReplay = savedDraft(h);
      const requests = f.queries.length;
      assertPartial(await h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(currentProduct.id, f.fetcher, new AbortController().signal));
      assert.equal(f.queries.length, requests, 'partial saved result must not automatically retry Google');
      assert.equal(savedDraft(h), beforeReplay); assert.equal(preservedFacts(h), facts);

      // Model an earlier completed v6 row containing the unusable bound result.
      // Reopening/previewing it must filter the planning view, not rewrite history.
      const legacyResult = structuredClone(result);
      legacyResult.draft.attributes.push({ sourceIndex: badIndex, name: badBinding,
        value: scenario.badField === 'color' ? scenario.translatedColor : scenario.translatedName });
      legacyResult.draft.attributes.sort((a, b) => a.sourceIndex - b.sourceIndex);
      const legacyRaw = JSON.stringify(legacyResult);
      h.sqlite.prepare('UPDATE translation_jobs SET result=? WHERE id=?').run(legacyRaw, row.id);
      const legacyBefore = savedDraft(h);
      const jobView = await json(await h.route(f.base + '/translation'));
      const legacyJob = jobView.jobs.find(job => job.id === row.id);
      assert.ok(legacyJob.result.draft.attributes.some(attribute => attribute.sourceIndex === badIndex));
      assert.deepEqual([...coverage(legacyJob.review.source, legacyJob.result.draft).missingSourceIndexes], [badIndex]);
      const preview = await json(await h.route(f.base + '/translation-apply', { method: 'POST', body: {
        action: 'preview', jobId: row.id, expectedVersion: product(h).updated_at,
      } }));
      assert.equal(preview.preview.length, 0, 'valid values already applied must not be rewritten during legacy preview');
      assert.ok(preview.skipped.some(value => /입력 규격/u.test(value)));
      assertPartial(await h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(currentProduct.id, f.fetcher, new AbortController().signal));
      assert.equal(translationRow(h).result, legacyRaw); assert.equal(savedDraft(h), legacyBefore);
      assert.equal(f.queries.length, requests); assert.equal(preservedFacts(h), facts);

      // Real editor writes preserve both an explicit blank and a manually
      // reviewed value when that old completed result is opened again.
      const contentView = await json(await h.route(f.base + '/content'));
      await json(await h.route(f.base + '/content', { method: 'PATCH', body: {
        expectedRevision: contentView.content.revision,
        patch: { seo: { title: '직접 검토한 제목', description: '' }, label: { material: '직접 검토한 재질' } },
      } }));
      const optionView = await json(await h.route(f.base + '/options'));
      const manualRows = h.load('app/product-options.ts').optionInputs(optionView.options);
      manualRows[1].translatedName = ''; manualRows[1].color = '직접 검토한 색상';
      await json(await h.route(f.base + '/options', { method: 'PATCH', body: {
        expectedRevision: optionView.options.revision, expectedProductVersion: optionView.productVersion, rows: manualRows,
      } }));
      const manualBefore = savedDraft(h);
      assertPartial(await h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(currentProduct.id, f.fetcher, new AbortController().signal));
      assert.equal(savedDraft(h), manualBefore, 'replay is read-only after explicit editor saves');
      const savedContent = payload(h, 'product_content'), savedSecond = payload(h, 'product_options').rows[1];
      assert.equal(savedContent.seo.title.value, '직접 검토한 제목'); assert.equal(savedContent.seo.title.provenance, 'manual');
      assert.equal(savedContent.seo.description.value, ''); assert.equal(savedContent.seo.description.provenance, 'manual');
      assert.equal(savedContent.label.material.value, '직접 검토한 재질'); assert.equal(savedContent.label.material.provenance, 'manual');
      assert.equal(savedSecond.translatedName, ''); assert.equal(savedSecond.provenance.translatedName, 'manual');
      assert.equal(savedSecond.color, '직접 검토한 색상'); assert.equal(savedSecond.provenance.color, 'manual');
      assert.equal(f.queries.length, requests); assert.equal(translationRow(h).result, legacyRaw);
      assert.equal(preservedFacts(h), facts, 'source receipt, category/company, pricing/MOQ and original bytes are unchanged');
      assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM translation_jobs').get().n, 1);
      assert.equal(h.stats.downloads, 0); assert.equal(h.objects.size, 0);
      assert.ok(!h.network.includes('supplier.coupang.com'));
    } finally { h.close(); }
  });
}
