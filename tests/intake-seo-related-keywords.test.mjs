import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const json = async (response, status = 200) => {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
};
const offerId = '630800250001';
const sourceUrl = `https://detail.1688.com/offer/${offerId}.html`;
const memo = { brand: '검토 브랜드', features: '책상 정리', keywords: '펜홀더' };
const lookup = { action: 'prepare-collected', intake: true, lookupSeoKeywords: true };
const seoComposition = {
  version: 'couplus-current-composition-v2',
  memo,
  related: { source: 'consumer', query: memo.keywords, keywords: ['펜홀더', '펜꽂이', '연필꽂이', '책갈피', '펜클립'], warnings: [] },
};

async function fixture() {
  const h = mobileIntakeHarness();
  try {
    const translation = h.load('app/automation/translation.ts');
    h.bindings.SOURCEFLOW_TEXT_MODEL = translation.WORKERS_QWEN_MODEL;
    await h.load('db/queries.ts').saveSettings('owner', JSON.stringify({ ...h.settings, brand: memo.brand }));
    const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', {
      name: '펜홀더 합성 검수', categoryId: '80025', categoryPath: ['문구/오피스', '펜홀더/연필꽂이'], template: null, mappings: [],
    });
    const request = new Request('https://app.test/api/collection-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ urls: [sourceUrl], goal: 'price', profileId: profile.id, expectedProfileRevision: profile.revision, features: memo.features, keywords: memo.keywords }),
    });
    const { jobs: [queued] } = await json(await h.load('app/api/collection-jobs/route.ts').POST(request));
    await json(await h.route(`/api/collection-jobs/${queued.id}/result`, { method: 'POST', body: {
      schemaVersion: 1, sourceUrl, provider: 'synthetic-local-80025', collectedAt: new Date().toISOString(),
      title: '桌面收纳笔筒', description: '桌面收纳用', attributes: [], images: [],
      options: [{ sku: 'LOCAL-WHITE', name: '纯白笔筒', unitPriceCny: 4.5, minimumOrder: 1, stock: 50 }],
    } }));
    // A later workspace settings edit cannot change the frozen intake memo.
    await h.load('db/queries.ts').saveSettings('owner', JSON.stringify({ ...h.settings, brand: '다른 브랜드' }));
    const promote = () => h.route(`/api/collection-jobs/${queued.id}/product`, { method: 'POST' }).then(json);
    return { h, queued, promote };
  } catch (error) { h.close(); throw error; }
}

function browserIntake(h) {
  const messages = [], listeners = new Set(), cache = new Map();
  const window = {
    location: { origin: 'https://app.test' },
    addEventListener(_type, handler) { listeners.add(handler); },
    removeEventListener(_type, handler) { listeners.delete(handler); },
    postMessage(message, origin) {
      assert.equal(origin, window.location.origin);
      messages.push(message.type);
      const capability = 'couplus-consumer-keywords-v1';
      const result = message.type === 'PING' ? { ok: true, seoKeywords: capability }
        : { ok: true, capability, requestId: message.requestId, query: message.payload.query, keywords: seoComposition.related.keywords, warnings: [] };
      queueMicrotask(() => {
        for (const handler of listeners) handler({ source: window, origin, data: { channel: 'YOOFAM_HUB_HANDOFF_RESULT', requestId: message.requestId, result } });
      });
    },
  };
  const load = file => {
    if (!['app/intake-collection.ts','app/intake-seo.ts','app/seo-related-keywords-client.ts'].includes(file)) return h.load(file);
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    vm.runInNewContext(compiled.outputText, { exports, window, Error, AbortSignal, Headers, Response, Date, crypto, setTimeout, clearTimeout,
      require: name => load(name.slice(2) + '.ts'),
    });
    return exports;
  };
  return { messages, collect: load('app/intake-collection.ts').collectIntakeProduct };
}

test('fresh Qwen intake requests candidates against its captured memo and reuses the same approved job', async () => {
  const { h, promote } = await fixture();
  try {
    const { productId } = await promote();
    const post = body => h.route(`/api/products/${productId}/translation`, { method: 'POST', body });
    assert.deepEqual(await json(await post(lookup)), { productId, intakeSeoMemo: memo });
    assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM translation_jobs').get().n, 0);
    const prepare = { action: 'prepare-collected', intake: true, seoComposition };
    for (const field of ['brand', 'features', 'keywords']) {
      const changedMemo = { ...memo, [field]: '변경한 값' };
      const related = field === 'keywords' ? { ...seoComposition.related, query: changedMemo.keywords } : seoComposition.related;
      await json(await post({ ...prepare, seoComposition: { ...seoComposition, memo: changedMemo, related } }), 409);
    }
    const { job } = await json(await post(prepare), 201);
    assert.equal(job.status, 'prepared');
    assert.deepEqual(job.review.seoComposition, seoComposition);
    assert.equal(job.review.seoCompositionContext, undefined, 'initial intake keeps full translation scope');
    assert.deepEqual(job.review.source.guidance, { features: memo.features, keywords: memo.keywords });
    assert.ok(!job.review.source.attributes.some(row => row.value === '책갈피'));
    const request = h.load('app/automation/translation.ts').buildTranslationRequest(job.review);
    assert.deepEqual(JSON.parse(request.input[0].content[0].text).composition.related.keywords, seoComposition.related.keywords);
    const { job: replayed, replayed: reused } = await json(await post(lookup));
    assert.equal(reused, true);
    assert.deepEqual(replayed, job);
    const { job: raced } = await json(await post({ ...prepare, seoComposition: { ...seoComposition, related: { ...seoComposition.related, keywords: ['펜홀더'] } } }));
    assert.deepEqual(raced, job);
    assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM translation_jobs').get().n, 1);
    assert.equal(h.aiSources.length, 0);
  } finally { h.close(); }
});

test('Google intake skips consumer candidates and prepares its unchanged canonical translation', async () => {
  const { h, promote } = await fixture();
  try {
    h.bindings.SOURCEFLOW_TEXT_PROVIDER = 'google-free';
    const { productId } = await promote();
    const response = await h.route(`/api/products/${productId}/translation`, { method: 'POST', body: lookup });
    const { intakeSeoMemo, job } = await json(response, 201);
    assert.equal(intakeSeoMemo, undefined);
    assert.equal(job.review.destination, 'Google 번역');
    assert.equal(job.review.seoComposition, undefined);
  } finally { h.close(); }
});

test('fresh browser intake recommends and saves only same-product tags, with the full translation intact', async () => {
  const { h, queued } = await fixture();
  try {
    const browser = browserIntake(h), payloads = [];
    h.bindings.AI.run = async (_model, input) => {
      const source = JSON.parse(input.messages[1].content.split('\n\nPRODUCT_SOURCE_JSON:\n')[1].slice(0, -'\n/no_think'.length));
      h.aiSources.push(source);
      assert.ok(input.response_format.json_schema.required.includes('description'));
      assert.ok(input.response_format.json_schema.required.includes('attributes'));
      const draft = {
        title: '책상 정리 펜홀더', description: '책상 정리용',
        keywords: ['펜홀더', '펜꽂이', '연필꽂이', '책갈피', '펜클립'], warnings: [],
        attributes: source.attributes.map(attribute => ({ sourceIndex: attribute.sourceIndex, name: '옵션명', value: '순백색 펜통' })),
      };
      return { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(draft) } }] };
    };
    const collect = async () => browser.collect(await h.load('db/collection-jobs.ts').findCollectionJob('owner', queued.id), {
      signal: new AbortController().signal, onJob() {}, onProgress() {},
      fetcher: (path, init = {}) => {
        if (path.endsWith('/translation') && init.method === 'POST') payloads.push(JSON.parse(init.body));
        return h.route(path, { method: init.method ?? 'GET', body: init.body });
      },
    });
    assert.match(await collect(), /SEO·옵션 초안/);
    assert.deepEqual(browser.messages, ['PING', 'SEO_KEYWORDS']);
    assert.deepEqual(payloads[0], lookup);
    assert.deepEqual(payloads[1].seoComposition, seoComposition);
    assert.equal(h.aiSources.length, 1);
    assert.deepEqual(h.aiSources[0].composition.related.keywords, seoComposition.related.keywords);
    const product = h.sqlite.prepare('SELECT id, supplier_hub_status FROM products WHERE source_url = ?').get(sourceUrl);
    const base = `/api/products/${product.id}`;
    const { content } = await json(await h.route(base + '/content'));
    assert.equal(content.seo.description.value, '책상 정리용');
    assert.deepEqual(content.seo.keywords.value, ['펜홀더', '펜꽂이', '연필꽂이']);
    const { options } = await json(await h.route(base + '/options'));
    assert.equal(options.rows[0].translatedName, '순백색 펜통');
    const { resolved } = await json(await h.route(base + '/quotation-fields'));
    assert.equal(resolved.rows.find(row => row.optionId === 'collected-1').fields.searchTags.value, '펜홀더, 펜꽂이, 연필꽂이');
    await collect();
    assert.deepEqual(browser.messages, ['PING', 'SEO_KEYWORDS']);
    assert.equal(h.aiSources.length, 1);
    assert.equal(product.supplier_hub_status, '미전송');
    assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM supplier_hub_receipts').get().n, 0);
  } finally { h.close(); }
});
