import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const payload = (h, table) => JSON.parse(h.sqlite.prepare('SELECT payload FROM ' + table).get().payload);
const product = h => h.sqlite.prepare('SELECT * FROM products').get();

async function fixture({ failOptions = false } = {}) {
  const queries = [], translations = new Map();
  let originalTitle;
  const h = mobileIntakeHarness({ translationFetcher: async target => {
    const q = new URL(target).searchParams.get('q'); queries.push(q);
    // A duplicate essential-title request would consume quota before options.
    if (q === originalTitle && queries.filter(value => value === q).length > 1 || failOptions && q.startsWith('[[YFTR'))
      return new Response('local quota fixture', { status: 429 });
    const translate = value => { assert.ok(translations.has(value), value); return translations.get(value); };
    const result = q.startsWith('[[YFTR') ? q.split('\n').map(line => {
      const match = /^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line); assert.ok(match);
      return `${match[1]} ${translate(match[2])}`;
    }).join('\n') : translate(q);
    return Response.json([[[result, q]], null, 'zh-CN']);
  } });
  try {
    await json(await h.route('/api/collection-jobs/job/collect', { method: 'POST' }));
    const saved = await json(await h.route('/api/collection-jobs/job/product', { method: 'POST' }));
    const receipt = payload(h, 'collection_results'); originalTitle = receipt.title;
    receipt.description = '源文本说明';
    // Fill the initial attribute budget so every option needs a continuation.
    receipt.attributes = Array.from({ length: 50 }, (_, index) => ({ name: `검토 속성 ${index}`, value: '확인한 원문' }));
    h.sqlite.prepare('UPDATE collection_results SET payload=?').run(JSON.stringify(receipt));
    translations.set(originalTitle, '원문 기준 선글라스'); translations.set(receipt.description, '상품 설명');
    const colors = new Map([['亮黑', '유광 검정'], ['砂黑', '무광 검정'], ['砂灰', '무광 회색']]);
    const sizes = new Map([['太阳镜', '선글라스'], ['太阳镜 加005 盒子', '선글라스 + 005 케이스']]);
    for (const row of payload(h, 'product_options').rows) {
      translations.set(row.color, colors.get(row.color)); translations.set(row.size, sizes.get(row.size));
      translations.set(row.originalName, `${colors.get(row.color)} / ${sizes.get(row.size)}`);
    }
    h.bindings.SOURCEFLOW_TEXT_PROVIDER = 'google-free'; delete h.bindings.AI;
    const base = `/api/products/${saved.productId}`;
    const fetcher = (path, init) => h.route(path, { method: init?.method ?? 'GET', body: init?.body });
    return { h, queries, receipt, base, fetcher, productId: saved.productId };
  } catch (error) { h.close(); throw error; }
}

async function prepareContinuation(f, beforeContinuation = () => {}) {
  const initial = await json(await f.h.route(f.base + '/translation', { method: 'POST', body: { action: 'prepare-collected', intake: true } }), 201);
  const run = await f.h.load('app/reviewed-translation.ts').runReviewedTranslation(f.productId, initial.job, { fetcher: f.fetcher, signal: new AbortController().signal, onJob: () => {} });
  assert.equal(run.job.status, 'completed'); assert.ok(run.job.result.draft.title);
  const body = { jobId: run.job.id, expectedVersion: product(f.h).updated_at };
  const preview = await json(await f.h.route(f.base + '/translation-apply', { method: 'POST', body: { ...body, action: 'preview' } }));
  await json(await f.h.route(f.base + '/translation-apply', { method: 'POST', body: { ...body, action: 'apply', fingerprint: preview.fingerprint } }));
  beforeContinuation();
  return json(await f.h.route(f.base + '/translation', { method: 'POST', body: { action: 'prepare-intake-options', expectedVersion: product(f.h).updated_at } }), 201);
}

test('automatic Google options continuation never retranslates the initial title or description and saved replay sends no Google requests', async () => {
  const f = await fixture();
  try {
    const outcome = await f.h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(f.productId, f.fetcher, new AbortController().signal);
    assert.equal(f.queries.filter(q => q === f.receipt.title).length, 1, 'only the initial SEO job may translate the source title');
    assert.equal(f.queries.filter(q => q === f.receipt.description).length, 1);
    assert.equal(outcome.completed, true); assert.equal(outcome.manualReady, false); assert.equal(outcome.reviewRequired, false);
    assert.equal(f.queries.length, 3, 'title, description and one deduplicated options block');
    const jobs = f.h.sqlite.prepare('SELECT * FROM translation_jobs').all();
    const initial = jobs.find(job => job.idempotency_key === 'intake-auto-v1'), options = jobs.find(job => job.idempotency_key.startsWith('intake-options-'));
    assert.equal(initial.status, 'completed'); assert.equal(options.status, 'completed');
    const initialReview = JSON.parse(initial.review), optionReview = JSON.parse(options.review), optionResult = JSON.parse(options.result);
    assert.equal(Object.hasOwn(initialReview, 'intakeOptions'), false);
    assert.equal(JSON.parse(initial.result).draft.title, '원문 기준 선글라스');
    assert.deepEqual(optionReview.intakeOptions, { initialJobId: initial.id, optionRevision: payload(f.h, 'product_options').revision - 1, scope: 'options' });
    assert.equal(Object.hasOwn(optionReview, 'optionsRetry'), false);
    assert.equal(optionResult.draft.title, ''); assert.equal(optionResult.draft.description, ''); assert.deepEqual(optionResult.draft.keywords, []);
    assert.equal(optionResult.translationRequests, 1); assert.equal(optionResult.draft.attributes.length, 18);
    assert.ok(payload(f.h, 'product_options').rows.every(row => row.provenance.translatedName === 'translated'));
    const content = JSON.stringify(payload(f.h, 'product_content')), requests = f.queries.length;
    const replay = await f.h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(f.productId, f.fetcher, new AbortController().signal);
    assert.equal(replay.completed, true); assert.equal(f.queries.length, requests); assert.equal(JSON.stringify(payload(f.h, 'product_content')), content);
    assert.equal(product(f.h).supplier_hub_status, '미전송'); assert.equal(f.h.aiSources.length, 0);
  } finally { f.h.close(); }
});

test('a completed Workers AI SEO parent can continue pending options through Google without retranslating SEO or changing the saved parent', async () => {
  const f = await fixture();
  try {
    f.h.bindings.SOURCEFLOW_TEXT_PROVIDER = 'workers-ai'; let initialCalls = 0;
    f.h.bindings.AI = { run: async (model, input) => {
      assert.equal(model, f.h.bindings.SOURCEFLOW_TEXT_MODEL); initialCalls++;
      const source = JSON.parse(input.messages[1].content);
      return { response: { title: '원문 기준 선글라스', description: '상품 설명', keywords: ['선글라스'], warnings: [],
        attributes: source.attributes.map((pair, sourceIndex) => ({ sourceIndex, name: pair.name, value: pair.value })) } };
    } };
    const prepared = await prepareContinuation(f, () => { f.h.bindings.SOURCEFLOW_TEXT_PROVIDER = 'google-free'; delete f.h.bindings.AI; });
    const parentBefore = JSON.stringify(f.h.sqlite.prepare("SELECT * FROM translation_jobs WHERE idempotency_key='intake-auto-v1'").get());
    const seoBefore = JSON.stringify(payload(f.h, 'product_content').seo);
    assert.equal(initialCalls, 1); assert.equal(f.queries.length, 0); assert.equal(prepared.job.review.destination, 'Google 번역');
    const run = await f.h.load('app/reviewed-translation.ts').runReviewedTranslation(f.productId, prepared.job,
      { fetcher: f.fetcher, signal: new AbortController().signal, onJob: () => {} });
    assert.equal(run.job.status, 'completed'); assert.equal(run.job.result.translationRequests, 1);
    assert.equal(run.job.result.draft.title, ''); assert.equal(run.job.result.draft.description, '');
    assert.equal(run.job.result.draft.attributes.length, 18); assert.equal(f.queries.length, 1); assert.match(f.queries[0], /^\[\[YFTR/);
    const body = { jobId: run.job.id, expectedVersion: product(f.h).updated_at, scope: 'options' };
    const preview = await json(await f.h.route(f.base + '/translation-apply', { method: 'POST', body: { ...body, action: 'preview' } }));
    await json(await f.h.route(f.base + '/translation-apply', { method: 'POST', body: { ...body, action: 'apply', fingerprint: preview.fingerprint } }));
    assert.ok(payload(f.h, 'product_options').rows.every(row => row.provenance.translatedName === 'translated'));
    assert.equal(JSON.stringify(payload(f.h, 'product_content').seo), seoBefore);
    assert.equal(JSON.stringify(f.h.sqlite.prepare("SELECT * FROM translation_jobs WHERE idempotency_key='intake-auto-v1'").get()), parentBefore);
    const replay = await f.h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(f.productId, f.fetcher, new AbortController().signal);
    assert.equal(replay.completed, true); assert.equal(f.queries.length, 1); assert.equal(initialCalls, 1);
  } finally { f.h.close(); }
});

test('a Google options-only quota acknowledgement remains a reusable partial draft without discarding the saved initial SEO', async () => {
  const f = await fixture({ failOptions: true });
  try {
    const beforeOptions = payload(f.h, 'product_options');
    const outcome = await f.h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(f.productId, f.fetcher, new AbortController().signal);
    assert.equal(outcome.reviewRequired, true); assert.equal(outcome.manualReady, false); assert.match(outcome.message, /HTTP 429/);
    const options = f.h.sqlite.prepare("SELECT * FROM translation_jobs WHERE idempotency_key LIKE 'intake-options-%'").get();
    assert.equal(options.status, 'completed'); assert.equal(options.error, null);
    const result = JSON.parse(options.result); assert.equal(result.googleStoppedHttpStatus, 429); assert.equal(result.draft.attributes.length, 0);
    assert.equal(result.draft.title, ''); assert.equal(result.translationRequests, 1);
    const model = f.h.load('app/automation/model.ts'), currentProduct = product(f.h), currentContent = payload(f.h, 'product_content'), currentOptions = payload(f.h, 'product_options');
    const optionJob = await f.h.load('db/translation-jobs.ts').getTranslationJob('owner', f.productId, options.id), now = new Date().toISOString();
    const baseline = await model.planAutomation(currentProduct, f.h.settings, null, currentContent, null, now, currentOptions);
    const withOptions = await model.planAutomation(currentProduct, f.h.settings, null, currentContent, optionJob, now, currentOptions);
    assert.equal(withOptions.inputFingerprint, baseline.inputFingerprint);
    assert.deepEqual(withOptions.stages.find(stage => stage.id === 'seo'), baseline.stages.find(stage => stage.id === 'seo'));
    assert.deepEqual(payload(f.h, 'product_options').rows, beforeOptions.rows);
    const content = JSON.stringify(payload(f.h, 'product_content')), savedOptions = JSON.stringify(payload(f.h, 'product_options')), requests = f.queries.length;
    const replay = await f.h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(f.productId, f.fetcher, new AbortController().signal);
    assert.equal(replay.reviewRequired, true); assert.equal(f.queries.length, requests);
    assert.equal(JSON.stringify(payload(f.h, 'product_options')), savedOptions); assert.equal(JSON.stringify(payload(f.h, 'product_content')), content);
    assert.equal(f.queries.filter(q => q === f.receipt.title).length, 1);
  } finally { f.h.close(); }
});

test('automatic option proof rejects malformed scope, foreign provider, non-option source and coexistence with explicit retries', async () => {
  const f = await fixture();
  try {
    const prepared = await prepareContinuation(f), review = prepared.job.review;
    const validate = f.h.load('app/intake-options-translation.ts').intakeOptionsReviewProof;
    assert.deepEqual(validate(review), review.intakeOptions);
    const noProof = { ...review }; delete noProof.intakeOptions; assert.equal(validate(noProof), null);
    for (const changed of [
      { ...review, intakeOptions: undefined }, { ...review, intakeOptions: null },
      { ...review, intakeOptions: { ...review.intakeOptions, extra: true } },
      { ...review, intakeOptions: { ...review.intakeOptions, scope: 'all' } },
      { ...review, intakeOptions: { ...review.intakeOptions, initialJobId: 'foreign' } },
      { ...review, intakeOptions: { ...review.intakeOptions, optionRevision: -1 } },
      { ...review, destination: 'Cloudflare Workers AI' }, { ...review, maxOutputTokens: 1000 },
      { ...review, optionsRetry: { retryKey: crypto.randomUUID(), optionRevision: 0, scope: 'options' } },
      { ...review, seoRetry: {} }, { ...review, source: { ...review.source, attributes: [] } },
      { ...review, source: { ...review.source, attributes: [{ name: '상품속성: 색상', value: '黑色' }] } },
    ]) assert.throws(() => validate(changed), /자동 옵션 번역 작업/);
  } finally { f.h.close(); }
});

test('the full initial SEO review cannot accept a continuation proof from the client or skip its essential title', async () => {
  const f = await fixture();
  try {
    const initial = await json(await f.h.route(f.base + '/translation', { method: 'POST', body: { action: 'prepare-collected', intake: true } }), 201);
    assert.equal(Object.hasOwn(initial.job.review, 'intakeOptions'), false); assert.equal(f.queries.length, 0);
    const proof = { initialJobId: initial.job.id, optionRevision: payload(f.h, 'product_options').revision, scope: 'options' };
    await json(await f.h.route(f.base + '/translation', { method: 'POST', body: { action: 'prepare-collected', intake: true, intakeOptions: proof } }), 400);
    const review = { ...initial.job.review, intakeOptions: proof, source: { ...initial.job.review.source,
      attributes: [{ name: 'option:collected-1', value: payload(f.h, 'product_options').rows[0].originalName }] } };
    // Even a damaged persisted initial review cannot identify itself as a continuation.
    f.h.sqlite.prepare('UPDATE translation_jobs SET review=? WHERE id=?').run(JSON.stringify(review), initial.job.id);
    await json(await f.h.route(f.base + '/translation', { method: 'POST', body: { action: 'approve', jobId: initial.job.id, reviewFingerprint: initial.job.review.fingerprint, confirmPaid: true } }), 409);
    assert.equal(f.queries.length, 0); assert.equal(f.h.sqlite.prepare('SELECT status FROM translation_jobs').get().status, 'prepared');
  } finally { f.h.close(); }
});

for (const changed of ['options-clock', 'source-title', 'source-description', 'canonical-parent', 'canonical-config', 'canonical-empty-seo', 'canonical-scope'])
  test(`automatic option approval and execution reject a changed ${changed} before any Google request`, async () => {
    const f = await fixture();
    try {
      const prepared = await prepareContinuation(f), job = prepared.job;
      const approve = () => f.h.route(f.base + '/translation', { method: 'POST', body: { action: 'approve', jobId: job.id, reviewFingerprint: job.review.fingerprint, confirmPaid: true } });
      const execute = () => f.h.route(f.base + '/translation', { method: 'POST', body: { action: 'execute', jobId: job.id } });
      await json(await approve()); const requests = f.queries.length;
      if (changed === 'options-clock') {
        const options = payload(f.h, 'product_options'); options.revision++;
        f.h.sqlite.prepare('UPDATE product_options SET revision=?,payload=?').run(options.revision, JSON.stringify(options));
      } else if (changed.startsWith('source-')) {
        const receipt = payload(f.h, 'collection_results'); receipt[changed.slice(7)] += ' 修改';
        f.h.sqlite.prepare('UPDATE collection_results SET payload=?').run(JSON.stringify(receipt));
      } else if (changed === 'canonical-parent') {
        const review = { ...job.review, intakeOptions: { ...job.review.intakeOptions, initialJobId: crypto.randomUUID() } };
        f.h.sqlite.prepare('UPDATE translation_jobs SET review=? WHERE id=?').run(JSON.stringify(review), job.id);
      } else if (changed === 'canonical-empty-seo') {
        const canonical = f.h.sqlite.prepare("SELECT * FROM translation_jobs WHERE idempotency_key='intake-auto-v1'").get();
        const result = JSON.parse(canonical.result); result.draft.title = ''; result.draft.description = '';
        f.h.sqlite.prepare('UPDATE translation_jobs SET result=? WHERE id=?').run(JSON.stringify(result), canonical.id);
      } else {
        const canonical = f.h.sqlite.prepare("SELECT * FROM translation_jobs WHERE idempotency_key='intake-auto-v1'").get();
        const review = changed === 'canonical-scope' ? { ...JSON.parse(canonical.review), optionsRetry: {} }
          : { ...JSON.parse(canonical.review), model: 'foreign-model' };
        f.h.sqlite.prepare('UPDATE translation_jobs SET review=? WHERE id=?').run(JSON.stringify(review), canonical.id);
      }
      await json(await approve(), 409); await json(await execute(), 409);
      assert.equal(f.queries.length, requests); assert.equal(f.h.sqlite.prepare('SELECT status FROM translation_jobs WHERE id=?').get(job.id).status, 'approved');
    } finally { f.h.close(); }
  });

for (const action of ['approve', 'execute']) test(`the atomic automatic option ${action} refuses an option revision changed after its source read`, async () => {
  const f = await fixture();
  try {
    const prepared = await prepareContinuation(f), job = prepared.job;
    const approve = { action: 'approve', jobId: job.id, reviewFingerprint: job.review.fingerprint, confirmPaid: true };
    if (action === 'execute') await json(await f.h.route(f.base + '/translation', { method: 'POST', body: approve }));
    const before = JSON.stringify(f.h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(job.id)), requests = f.queries.length;
    const originalPrepare = f.h.db.prepare; let injected = false;
    f.h.db.prepare = function(sql) {
      const query = originalPrepare(sql);
      if (sql.startsWith('UPDATE translation_jobs') && sql.includes(action === 'approve' ? "SET status='approved'" : "SET status='running'")) {
        const execute = query.execute;
        query.execute = function() {
          if (!injected) { injected = true; f.h.sqlite.prepare('UPDATE product_options SET revision=revision+1 WHERE product_id=?').run(f.productId); }
          return execute();
        };
      }
      return query;
    };
    await json(await f.h.route(f.base + '/translation', { method: 'POST', body: action === 'approve' ? approve : { action, jobId: job.id } }), 409);
    assert.equal(injected, true); assert.equal(f.queries.length, requests);
    assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(job.id)), before);
  } finally { f.h.close(); }
});

test('an automatic options result can only preview or apply the reviewed options scope', async () => {
  const f = await fixture();
  try {
    const prepared = await prepareContinuation(f), seo = JSON.stringify(payload(f.h, 'product_content').seo);
    const run = await f.h.load('app/reviewed-translation.ts').runReviewedTranslation(f.productId, prepared.job, { fetcher: f.fetcher, signal: new AbortController().signal, onJob: () => {} });
    assert.equal(run.job.status, 'completed');
    const content = payload(f.h, 'product_content'), version = product(f.h).updated_at;
    assert.throws(() => f.h.load('app/translation-adoption.ts').translationAdoptionInput(content, run.job, version, ['title']), /옵션 전용 번역/);
    assert.throws(() => f.h.load('app/translation-batch-adoption.ts').translationBatchAdoption(content, run.job, version), /옵션 전용 번역/);
    assert.throws(() => f.h.load('app/translation-label-adoption.ts').translationLabelAdoption(content, run.job, version, [{ sourceIndex: 0, field: 'material' }]), /옵션 전용 번역/);
    const body = { action: 'preview', jobId: run.job.id, expectedVersion: product(f.h).updated_at };
    await json(await f.h.route(f.base + '/translation-apply', { method: 'POST', body }), 409);
    const preview = await json(await f.h.route(f.base + '/translation-apply', { method: 'POST', body: { ...body, scope: 'options' } }));
    assert.equal(preview.preview.length, 18); assert.equal(JSON.stringify(payload(f.h, 'product_content').seo), seo);
    await json(await f.h.route(f.base + '/translation-apply', { method: 'POST', body: { ...body, action: 'apply', scope: 'options', fingerprint: preview.fingerprint } }));
    assert.equal(JSON.stringify(payload(f.h, 'product_content').seo), seo);
  } finally { f.h.close(); }
});
