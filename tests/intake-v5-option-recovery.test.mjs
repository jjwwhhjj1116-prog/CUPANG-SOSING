import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const companies = [{companyCode: 'A01464742', companyName: '와이홉'}, {companyCode: 'A01526306', companyName: '유앤채'}];
const colors = new Map([['亮黑', '유광 검정'], ['砂黑', '무광 검정'], ['砂灰', '무광 회색']]);
const sizes = new Map([['太阳镜', '선글라스'], ['太阳镜 加005 盒子', '선글라스 + 005 케이스']]);
const json = async (response, status = 200) => {assert.equal(response.status, status, await response.clone().text()); return response.json();};
const payload = (h, table) => JSON.parse(h.sqlite.prepare('SELECT payload FROM ' + table).get().payload);

/** Recorded public supplier source, actual preparation/Google/adoption routes
 * and SQLite. The free endpoint response is a fixture; no external call occurs. */
async function fixture(company = companies[0]) {
  const queries = [], translations = new Map();
  const h = mobileIntakeHarness({...company, translationFetcher: async (target, init) => {
    const url = new URL(target), query = url.searchParams.get('q'); queries.push(query);
    assert.equal(url.origin, 'https://translate.googleapis.com'); assert.equal(url.pathname, '/translate_a/single');
    assert.equal(url.searchParams.get('client'), 'gtx'); assert.equal(url.searchParams.get('sl'), 'auto'); assert.equal(url.searchParams.get('tl'), 'ko');
    assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit'); assert.equal(init.body, undefined);
    const translate = source => {assert.ok(translations.has(source), 'only the exact selected source may reach Google'); return translations.get(source);};
    const translated = query.startsWith('[[YFTR') ? query.split('\n').map(line => {
      const match = /^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line); assert.ok(match);
      return `${match[1]} ${translate(match[2])}`;
    }).reverse().join('\n') : translate(query);
    return Response.json([[[translated, query, null, null]], null, 'zh-CN']);
  }});
  try {
    const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', {name: '기록 원문 복구 검증', categoryId: '69900',
      categoryPath: ['패션의류잡화', '유니섹스/남녀공용 패션', '공용 잡화', '선글라스', '남녀공용패션선글라스'], template: null, mappings: []}, 'cat');
    h.context.category = profile;
    h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context), 'job');
    await json(await h.route('/api/collection-jobs/job/collect', {method: 'POST'}));
    const saved = await json(await h.route('/api/collection-jobs/job/product', {method: 'POST'})), productId = saved.productId;
    let product = h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(productId), content = payload(h, 'product_content');
    const options = payload(h, 'product_options'), path = '/api/products/' + productId;
    const receipt = payload(h, 'collection_results'); assert.equal(options.rows.length, 6);
    const sourceAttributes = options.rows.slice(0, 5).flatMap(row => [{name: `option:${row.id}`, value: row.originalName},
      {name: `option-color:${row.id}`, value: row.color}, {name: `option-size:${row.id}`, value: row.size}]);
    for (const row of options.rows) {
      row.translatedName = row.originalName;
      for (const field of ['translatedName', 'color', 'size']) row.provenance[field] = 'translated';
    }
    for (const field of ['translatedName', 'color', 'size']) {options.rows[1][field] = ''; options.rows[1].provenance[field] = 'manual';}
    options.rows[2].translatedName = '직접 검토한 이름'; options.rows[2].color = '직접 검토한 색'; options.rows[2].size = '';
    for (const field of ['translatedName', 'color', 'size']) options.rows[2].provenance[field] = 'manual';
    options.rows[3].included = false;
    options.rows[4].originalName = '이후 직접 바꾼 원문'; options.rows[4].provenance.originalName = 'manual';
    // The sixth Chinese copy has no matching old job proof and is not silently
    // treated as an automatic correction just because it contains Han text.
    h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(options), productId);
    // Seed the manual SEO review through its actual API, including the existing
    // productName/title link and clock. A raw SQL title edit alone would leave
    // an impossible stale linked label that any later content save repairs.
    await json(await h.route(path + '/content', {method: 'PATCH', body: {expectedRevision: content.revision,
      patch: {seo: {title: '직접 검토한 기존 SEO', description: '', keywords: []}, label: {manufacturer: ''}}}}));
    product = h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(productId); content = payload(h, 'product_content');
    assert.equal(content.labelProductNameLinked, true); assert.equal(content.label.productName.value, content.seo.title.value);
    h.bindings.SOURCEFLOW_TEXT_PROVIDER = 'google-free'; delete h.bindings.AI;
    const source = h.load('app/automation/translation.ts').validateTranslationSource({title: receipt.title, description: receipt.description,
      attributes: sourceAttributes, provenance: 'manual', reference: h.load('app/sourcing.ts').collectionSourceReference('job', receipt.sourceUrl),
      category: {id: profile.categoryId, path: profile.categoryPath}, guidance: {features: h.context.features, keywords: h.context.keywords}});
    const config = h.load('app/automation/translation.ts').requireTranslationConfig(h.bindings);
    const review = {...await h.load('app/automation/translation.ts').prepareTranslationReview(source, config), instructionsVersion: 'sourceflow-translation-v5'};
    const stamp = new Date().toISOString(), old = {id: crypto.randomUUID(), productId, productVersion: product.updated_at, contentRevision: content.revision,
      status: 'prepared', review, result: null, error: null, createdAt: stamp, approvedAt: null, startedAt: null, finishedAt: null};
    const seeded = await h.load('db/translation-jobs.ts').createTranslationJob('owner', old, 'intake-auto-v1', 'a'.repeat(64)); assert.ok(seeded && !seeded.conflict);
    const oldResult = {draft: {title: '이전 번역 이름', description: '', keywords: [], attributes: sourceAttributes.map((pair, sourceIndex) => ({sourceIndex, name: pair.name, value: pair.value})), warnings: []},
      responseId: 'fixture-old-v5-copy', model: review.model, usage: null, generatedAt: stamp, provenance: 'generated', appliedToContent: false};
    h.sqlite.prepare("UPDATE translation_jobs SET status='completed',result=?,approved_at=?,started_at=?,finished_at=? WHERE id=?")
      .run(JSON.stringify(oldResult), stamp, stamp, stamp, old.id);
    const oldJob = await h.load('db/translation-jobs.ts').getTranslationJob('owner', productId, old.id);
    translations.set(receipt.title, '원문 기준 선글라스'); if (receipt.description) translations.set(receipt.description, '원문 기준 설명');
    for (const [text, translated] of [...colors, ...sizes]) translations.set(text, translated);
    for (const [color, translatedColor] of colors) for (const [size, translatedSize] of sizes) translations.set(`${color} / ${size}`, `${translatedColor} / ${translatedSize}`);
    const currentProduct = () => h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(productId);
    const prepare = expectedVersion => h.route(path + '/translation', {method: 'POST', body: {action: 'prepare-intake-options', expectedVersion: expectedVersion ?? currentProduct().updated_at}});
    const immutable = () => JSON.stringify({source: payload(h, 'collection_results'), context: payload(h, 'collection_context'), links: h.sqlite.prepare('SELECT * FROM collection_products').all(),
      old: h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(old.id)});
    return {h, productId, product, options, content, receipt, oldJob, queries, translations, path, prepare, currentProduct, immutable};
  } catch (error) {h.close(); throw error;}
}

for (const company of companies) test(`automatic intake requeues only a proved untouched v5 copy and persists Korean options via the free endpoint (${company.companyCode})`, async () => {
  const f = await fixture(company), {h} = f;
  try {
    const preserved = f.immutable(), beforeOptions = payload(h, 'product_options'), beforeContent = payload(h, 'product_content');
    const prepared = await json(await f.prepare(), 201); assert.equal(prepared.done, undefined); assert.equal(prepared.optionsOnly, true); assert.equal(prepared.autoDraft, true);
    assert.equal(prepared.job.review.instructionsVersion, 'sourceflow-translation-v6');
    assert.deepEqual(prepared.job.review.source.attributes, [
      {name: `option:${beforeOptions.rows[0].id}`, value: beforeOptions.rows[0].originalName},
      {name: `option-color:${beforeOptions.rows[0].id}`, value: beforeOptions.rows[0].color},
      {name: `option-size:${beforeOptions.rows[0].id}`, value: beforeOptions.rows[0].size},
    ]);
    assert.equal(prepared.remainingOptions, 0); assert.equal(f.queries.length, 0);
    await json(await h.route(f.path + '/translation', {method: 'POST', body: {action: 'approve', jobId: prepared.job.id, reviewFingerprint: prepared.job.review.fingerprint, confirmPaid: true}}));
    const executed = await json(await h.route(f.path + '/translation', {method: 'POST', body: {action: 'execute', jobId: prepared.job.id}}));
    assert.equal(executed.job.status, 'completed'); assert.equal(executed.job.result.model, 'google-translate-gtx');
    assert.equal(executed.job.result.draft.attributes.length, 3); assert.equal(h.aiSources.length, 0);
    const body = {scope: 'options', jobId: prepared.job.id, expectedVersion: f.product.updated_at};
    const preview = await json(await h.route(f.path + '/translation-apply', {method: 'POST', body: {...body, action: 'preview'}}));
    assert.equal(preview.preview.length, 3); assert.deepEqual(payload(h, 'product_options'), beforeOptions);
    const applied = await json(await h.route(f.path + '/translation-apply', {method: 'POST', body: {...body, action: 'apply', fingerprint: preview.fingerprint}}));
    const current = payload(h, 'product_options'), afterContent = payload(h, 'product_content'), first = current.rows[0];
    assert.ok(applied.productVersion > f.product.updated_at); assert.equal(current.revision, beforeOptions.revision + 1);
    for (const [field, value] of [['translatedName', f.translations.get(first.originalName)], ['color', colors.get(beforeOptions.rows[0].color)], ['size', sizes.get(beforeOptions.rows[0].size)]]) {
      assert.equal(first[field], value); assert.equal(first.provenance[field], 'translated');
    }
    assert.deepEqual(current.rows.slice(1), beforeOptions.rows.slice(1));
    for (const field of Object.keys(beforeOptions.rows[0]).filter(key => !['translatedName', 'color', 'size', 'provenance', 'updatedAt'].includes(key))) assert.deepEqual(first[field], beforeOptions.rows[0][field]);
    assert.deepEqual(afterContent.seo, beforeContent.seo); assert.deepEqual(afterContent.label, beforeContent.label); assert.deepEqual(afterContent.assets, beforeContent.assets);
    assert.equal(f.immutable(), preserved); assert.equal(f.currentProduct().supplier_hub_status, '미전송');
    const requests = f.queries.length, completed = await json(await f.prepare());
    assert.equal(completed.done, true); assert.equal(completed.productVersion, applied.productVersion); assert.equal(f.queries.length, requests);
    assert.ok(!h.network.includes('supplier.coupang.com'));
  } finally {h.close();}
});

test('copied Chinese text requires its exact completed job/product/original/provenance proof and never changes manual or excluded rows', async () => {
  const f = await fixture(), {h} = f;
  try {
    const collection = await h.load('db/collection-jobs.ts').findCollectionJob('owner', 'job');
    const builder = h.load('app/collected-seo-source.ts').collectedSeoSource, before = JSON.stringify(f.options);
    assert.equal(builder(f.receipt, collection, f.options, true).source.attributes.length, 0);
    for (const change of [job => ({...job, productId: 'foreign'}), job => ({...job, status: 'failed'}), job => ({...job, review: {...job.review, instructionsVersion: 'sourceflow-translation-v6'}})]) {
      assert.equal(builder(f.receipt, collection, f.options, true, [change(f.oldJob)]).source.attributes.length, 0);
    }
    const proved = builder(f.receipt, collection, f.options, true, [f.oldJob]); assert.equal(proved.source.attributes.length, 3);
    assert.ok(proved.source.attributes.every(pair => pair.name.endsWith(':' + f.options.rows[0].id)));
    assert.equal(JSON.stringify(f.options), before); assert.equal(f.queries.length, 0);
  } finally {h.close();}
});

test('a canonical v5 proof older than the latest twenty jobs is included in both automatic preparation and safe Korean adoption', async () => {
  const f = await fixture(), {h} = f;
  try {
    const oldRow = h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(f.oldJob.id), newerReview = {...f.oldJob.review, instructionsVersion: 'sourceflow-translation-v6'};
    for (let index = 0; index < 25; index++) {
      const created = new Date(Date.parse(oldRow.created_at) + 60000 + index).toISOString();
      h.sqlite.prepare(`INSERT INTO translation_jobs SELECT ?,owner_id,product_id,?,request_fingerprint,product_version,content_revision,status,
        review_fingerprint,?,expires_at,result,error,claim_token,?,approved_at,started_at,finished_at FROM translation_jobs WHERE id=?`)
        .run(crypto.randomUUID(), 'other-completed-' + index, JSON.stringify(newerReview), created, f.oldJob.id);
    }
    const history = await h.load('db/translation-jobs.ts').listTranslationJobs('owner', f.productId);
    assert.equal(history.length, 20); assert.ok(!history.some(job => job.id === f.oldJob.id));
    const preserved = f.immutable(), before = payload(h, 'product_options'), prepared = await json(await f.prepare(), 201);
    assert.equal(prepared.job.review.instructionsVersion, 'sourceflow-translation-v6'); assert.equal(prepared.job.review.source.attributes.length, 3);
    await json(await h.route(f.path + '/translation', {method: 'POST', body: {action: 'approve', jobId: prepared.job.id, reviewFingerprint: prepared.job.review.fingerprint, confirmPaid: true}}));
    const executed = await json(await h.route(f.path + '/translation', {method: 'POST', body: {action: 'execute', jobId: prepared.job.id}})); assert.equal(executed.job.status, 'completed');
    const body = {scope: 'options', jobId: prepared.job.id, expectedVersion: f.product.updated_at};
    const preview = await json(await h.route(f.path + '/translation-apply', {method: 'POST', body: {...body, action: 'preview'}})); assert.equal(preview.preview.length, 3);
    await json(await h.route(f.path + '/translation-apply', {method: 'POST', body: {...body, action: 'apply', fingerprint: preview.fingerprint}}));
    const after = payload(h, 'product_options'); assert.equal(after.rows[0].translatedName, f.translations.get(before.rows[0].originalName));
    assert.equal(after.rows[0].provenance.translatedName, 'translated'); assert.deepEqual(after.rows.slice(1), before.rows.slice(1));
    assert.equal(f.immutable(), preserved); assert.equal(h.aiSources.length, 0); assert.ok(!h.network.includes('supplier.coupang.com'));
  } finally {h.close();}
});

test('a saved option edit after recovery preparation invalidates the old source clock before Google approval or execution', async () => {
  const f = await fixture(), {h} = f;
  try {
    await json(await f.prepare('2020-01-01T00:00:00.000Z'), 409); assert.equal(f.queries.length, 0);
    const prepared = await json(await f.prepare(), 201), options = payload(h, 'product_options'), inputs = h.load('app/product-options.ts').optionInputs(options);
    inputs[0].translatedName = ''; inputs[0].color = ''; inputs[0].size = '';
    await json(await h.route(f.path + '/options', {method: 'PATCH', body: {expectedRevision: options.revision, expectedProductVersion: f.currentProduct().updated_at, rows: inputs}}));
    const edited = h.sqlite.prepare('SELECT payload FROM product_options').get().payload, clock = f.currentProduct().updated_at;
    await json(await h.route(f.path + '/translation', {method: 'POST', body: {action: 'approve', jobId: prepared.job.id, reviewFingerprint: prepared.job.review.fingerprint, confirmPaid: true}}), 409);
    assert.equal(f.queries.length, 0); assert.equal(h.sqlite.prepare('SELECT payload FROM product_options').get().payload, edited); assert.equal(f.currentProduct().updated_at, clock);
    const done = await json(await f.prepare()); assert.equal(done.done, true); assert.equal(payload(h, 'product_options').rows[0].translatedName, '');
  } finally {h.close();}
});
