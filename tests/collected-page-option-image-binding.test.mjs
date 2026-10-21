import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { companies, syntheticSnapshot, plain } from './helpers/supplier-hub-single-projection.mjs';

// Reuse the inert two-axis DOM fixture, not the test bodies or any live page.
const fixtureURL = new URL('./page-dom-source-intake-flow.test.mjs', import.meta.url);
const fixtureText = fs.readFileSync(fixtureURL, 'utf8');
const ast = ts.createSourceFile(fixtureURL.href, fixtureText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = ast.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node)
  || ts.isFunctionDeclaration(node) && ['documentFromHtml', 'capturedPage', 'retainedProduct'].includes(node.name?.text));
const fixtureCode = declarations.map(node => {
  let value = node.getFullText(ast);
  if (ts.isImportDeclaration(node)) {
    const name = node.moduleSpecifier.text;
    if (!name.startsWith('node:')) value = value.replace("'" + name + "'", JSON.stringify(name.startsWith('.') ? new URL(name, fixtureURL).href : import.meta.resolve(name)));
  }
  return value;
}).join('\n').replaceAll('import.meta.url', JSON.stringify(fixtureURL.href)) + '\nexport {capturedPage,retainedProduct,images,sourceUrl,offerId};';
const { capturedPage, retainedProduct, images, sourceUrl, offerId } = await import('data:text/javascript,' + encodeURIComponent(fixtureCode));
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const now = '2026-10-21T00:00:00.000Z';
const files = h => JSON.stringify([...h.objects].map(([key, bytes]) => [key, Buffer.from(bytes).toString('hex')]));

function pureSource(h) {
  return { format: 'yoofam-page-source-v1', sourceUrl: h.sourceUrl, offerId: '813724060928', collectedAt: now,
    title: '합성 옵션 이미지', description: '합성 원문', attributes: [],
    images: [0, 1, 2].map(index => ({ url: `https://cbu01.alicdn.com/synthetic-binding-773-${index}.png`, role: index === 0 ? 'main' : 'additional' })),
    options: [null, null, 'known-supplier-773'].map((supplierSku, index) => ({ key: `explicit-row:${index + 1}`, name: ['黑色', '灰色', '蓝色'][index],
      supplierSku, unitPriceCny: [5.3, 6.1, 7.2][index], currency: 'CNY', minimumOrder: null, stock: null,
      imageUrl: `https://cbu01.alicdn.com/synthetic-binding-773-${index}.png` })) };
}
async function pureState(h) {
  const result = h.load('app/source-inbox.ts').pageSourceCollectionResult(pureSource(h));
  const job = { ...await h.load('db/collection-jobs.ts').findCollectionJob('owner', 'job'), owner_id: 'owner' };
  const prepared = h.load('app/collection-product.ts').prepareCollectionProduct('owner', job, result, 'synthetic-product-773', now);
  const model = h.load('app/collected-page-option-binding.ts');
  await model.issueCollectedPageOptionBindings('owner', job, result, prepared.options);
  return { result, job, prepared, model, options: prepared.options, rows: h.load('app/product-options.ts') };
}

test('only first canonical import issues exact source-row bindings; anonymous images require the verified map while known SKU matching stays intact', async () => {
  const h = mobileIntakeHarness();
  try {
    const { result, job, prepared, model, options, rows } = await pureState(h);
    assert.deepEqual(plain(options.collectedPageOptionBindings.rows), [
      { optionId: 'collected-1', sourceIndex: 0, sourceKey: 'explicit-row:1' },
      { optionId: 'collected-2', sourceIndex: 1, sourceKey: 'explicit-row:2' },
    ]);
    assert.deepEqual(options.rows.map(row => row.supplierSku), ['', '', 'known-supplier-773']);
    const map = await model.collectedPageOptionImageIndices('owner', job, result, options);
    assert.deepEqual(plain([...map]), [['collected-1', 0], ['collected-2', 1]]);
    const keys = [0, 1, 2].map(index => `owner/synthetic-option-binding-${index}.png`), links = keys.map((key, imageIndex) => ({ key, imageIndex }));
    const draft = h.load('app/collection-image-draft.ts').collectedImageDraft;
    assert.deepEqual(plain(draft('owner', result, links, keys, prepared.content, options, now).options.rows).map(row => row.imageKey), [null, null, keys[2]], 'legacy sync callers cannot reconstruct anonymous identities');
    assert.deepEqual(plain(draft('owner', result, links, keys, prepared.content, options, now, map).options.rows).map(row => row.imageKey), keys);
    const edited = rows.optionInputs(options).reverse(); edited[1].unitCostCny = 8.9; edited[1].translatedName = '직접 회색';
    const reordered = rows.applyOptionRows(options, edited, now);
    assert.deepEqual(plain([...await model.collectedPageOptionImageIndices('owner', job, result, reordered)]), plain([...map]), 'binding follows canonical ID, never the current row position or price');
    assert.equal(reordered.rows[1].provenance.unitCostCny, 'manual');
    assert.deepEqual(plain(reordered.collectedPageOptionBindings), plain(options.collectedPageOptionBindings));
    const explicit = rows.optionInputs(options); explicit[0].imageKey = keys[1];
    let manual = rows.applyOptionRows(options, explicit, now);
    const blank = rows.optionInputs(manual); blank[0].imageKey = null; blank[1].included = false;
    manual = rows.applyOptionRows(manual, blank, now);
    const protectedDraft = draft('owner', result, links, keys, prepared.content, manual, now, map);
    assert.equal(protectedDraft.options.rows[0].imageKey, null); assert.equal(protectedDraft.options.rows[0].provenance.imageKey, 'manual');
    assert.equal(protectedDraft.options.rows[1].imageKey, null); assert.equal(protectedDraft.options.rows[1].included, false);
    assert.equal(protectedDraft.options.rows[2].imageKey, keys[2]);
    const fresh = () => h.load('app/collection-product.ts').prepareCollectionProduct('owner', job, result, 'synthetic-new-773', now).options;
    for (const mutate of [value => { value.revision = 2; }, value => { value.rows[0].id = 'rewritten'; }, value => { value.rows[0].originalName = '다른 원문'; },
      value => { value.rows[0].unitCostCny = 500; }, value => { value.rows[0].supplierSku = 'invented'; }, value => { value.rows[0].imageKey = keys[0]; }]) {
      const invalid = fresh(); mutate(invalid);
      await assert.rejects(model.issueCollectedPageOptionBindings('owner', job, result, invalid));
      assert.equal(invalid.collectedPageOptionBindings, undefined);
    }
    await assert.rejects(model.issueCollectedPageOptionBindings('other', job, result, fresh()));
    await assert.rejects(model.issueCollectedPageOptionBindings('owner', { ...job, owner_id: 'other' }, result, fresh()));
    await assert.rejects(model.issueCollectedPageOptionBindings('owner', job, result, options), /최초/);
    const accessOptions = fresh(), accessOwner = 'cf:synthetic-owner-773', accessJob = { ...job, owner_id: accessOwner };
    await model.issueCollectedPageOptionBindings(accessOwner, accessJob, result, accessOptions);
    assert.deepEqual(plain([...await model.collectedPageOptionImageIndices(accessOwner, accessJob, result, accessOptions)]), [['collected-1', 0], ['collected-2', 1]], 'the supported Cloudflare owner namespace stays compatible');
    assert.equal((await model.collectedPageOptionImageIndices('cf:other-owner', accessJob, result, accessOptions)).size, 0);
    assert.deepEqual(h.network, []);
  } finally { h.close(); }
});

test('source rewrite, foreign receipt, clone, duplicate identities, and removed/recreated rows cannot recover anonymous images', async () => {
  const h = mobileIntakeHarness();
  try {
    const { result, job, model, options, rows } = await pureState(h), before = JSON.stringify({ result, options });
    const resolve = (value = options, source = result, owner = 'owner', selected = job) => model.collectedPageOptionImageIndices(owner, selected, source, value);
    assert.equal((await resolve(options, result, 'other')).size, 0);
    assert.equal((await resolve(options, result, 'owner', { ...job, owner_id: 'other' })).size, 0);
    assert.equal((await resolve(options, result, 'owner', { ...job, id: 'foreign-job' })).size, 0);
    assert.equal((await resolve({ ...options, productId: 'cloned-product' })).size, 0);
    const legacy = structuredClone(options); delete legacy.collectedPageOptionBindings; assert.equal((await resolve(legacy)).size, 0);
    for (const mutate of [value => { value.title += ' 수정'; }, value => { value.options[0].name = '수정된 원문'; }, value => { value.options[0].imageIndex = 1; },
      value => { value.options[0].unitPriceCny += 1; }, value => { value.pageOptionIdentity.sourceKeys.reverse(); },
      value => { value.images[0].url = 'https://cbu01.alicdn.com/synthetic-rewritten-773.png'; }, value => { value.offerId = '000000000773'; }]) {
      const source = structuredClone(result); mutate(source); assert.equal((await resolve(options, source)).size, 0);
    }
    for (const mutate of [value => { value.collectedPageOptionBindings.jobId = 'foreign-job'; }, value => { value.collectedPageOptionBindings.ownerId = 'other'; },
      value => { value.collectedPageOptionBindings.rows[0].sourceKey = 'unrelated-key'; }, value => { value.collectedPageOptionBindings.rows[1].sourceIndex = 0; },
      value => { value.collectedPageOptionBindings.rows[0].extra = 'untrusted'; }]) {
      const value = structuredClone(options); mutate(value); assert.equal((await resolve(value)).size, 0);
    }
    const duplicate = structuredClone(options); duplicate.rows.push(structuredClone(duplicate.rows[0]));
    assert.deepEqual(plain([...await resolve(duplicate)]), [['collected-2', 1]], 'ambiguous current ID is not assigned, unrelated identity survives');
    const kept = rows.applyOptionRows(options, rows.optionInputs(options).slice(1), now);
    const recreated = rows.applyOptionRows(kept, [rows.optionInputs(options)[0], ...rows.optionInputs(kept)], now);
    assert.deepEqual(plain(recreated.collectedPageOptionBindings.rows).map(row => row.optionId), ['collected-2']);
    assert.deepEqual(plain([...await resolve(recreated)]), [['collected-2', 1]], 'reusing an old option ID does not restore its creation binding');
    const renamedInputs = rows.optionInputs(options); renamedInputs[0].originalName = '직접 원문 변경';
    const renamed = rows.applyOptionRows(options, renamedInputs, now), restoredInputs = rows.optionInputs(renamed); restoredInputs[0].originalName = options.rows[0].originalName;
    const restored = rows.applyOptionRows(renamed, restoredInputs, now);
    assert.deepEqual(plain([...await resolve(restored)]), [['collected-2', 1]], 'rewriting the original name back never revives a pruned identity');
    const newInputs = rows.optionInputs(options); newInputs.push({ ...newInputs[0], id: 'bundle-child' });
    const bundled = rows.applyOptionRows(options, newInputs, now);
    assert.equal((await resolve(bundled)).has('bundle-child'), false);
    assert.equal(JSON.stringify({ result, options }), before); assert.deepEqual(h.network, []);
  } finally { h.close(); }
});

async function importedFlow(company) {
  let sourceRequests = 0, aiCalls = 0;
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name, fixtureImageUrls: images,
    sourceFetcher: () => { sourceRequests++; assert.fail('No actual supplier request'); } });
  const translations = new Map([['黑色 / 均码', '검정 / 프리'], ['灰色 / 均码', '회색 / 프리'], ['黑色', '검정'], ['灰色', '회색'], ['均码', '프리']]);
  h.bindings.AI.run = async (_model, input) => {
    aiCalls++; const source = JSON.parse(input.messages[1].content);
    return { response: { title: '합성 옵션 이미지 검수', description: '합성 검수 설명', keywords: ['합성 검수'], warnings: [],
      attributes: source.attributes.map((pair, sourceIndex) => ({ sourceIndex, name: pair.name, value: translations.get(pair.value) ?? pair.value })) } };
  };
  const settings = { ...h.settings, brand: company.name }; await h.load('db/queries.ts').saveSettings('owner', JSON.stringify(settings));
  const oldId = 'synthetic-protected-image-773', oldKey = 'owner/synthetic-protected-image-773.png', birth = new Date().toISOString(), policy = h.load('app/pricing.ts').pricePolicy(settings);
  h.objects.set(oldKey, Uint8Array.of(7, 7, 3));
  await h.load('db/queries.ts').insertProduct({ id: oldId, owner_id: 'owner', source_url: 'synthetic://protected-work-773', title: '기존 합성 작업 유지', source_price_cny: 8,
    exchange_rate: policy.exchangeRate, supply_margin: policy.supplyMargin, coupang_margin: policy.coupangMargin, supply_price: 5600, sale_price: 9340, msrp: 12150, options_count: 1,
    seo_status: '완료', image_status: '완료', quote_status: '대기', registration_status: '대기', supplier_hub_status: '미전송', image_keys: JSON.stringify([oldKey]), goal_stage: 'work', created_at: birth, updated_at: birth }, policy);
  const oldBefore = retainedProduct(h, oldId), oldBytes = Buffer.from(h.objects.get(oldKey)).toString('hex');
  const priorJob = JSON.stringify(h.sqlite.prepare("SELECT * FROM collection_jobs WHERE id='job'").get());
  const form = syntheticSnapshot(company), profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', {
    name: 'SYNTHETIC-IMAGE-BINDING-773', categoryId: form.categoryId, categoryPath: form.categoryPath, template: null, mappings: [], hubSchema: form });
  const source = capturedPage(), fingerprint = await h.load('app/source-inbox.ts').pageSourceFingerprint(source);
  const captureId = '00000000-0000-4000-8000-000000000773', api = h.load('app/api/source-inbox/route.ts');
  const sourcePost = expectedOwnerId => api.POST(new Request('https://app.test/api/source-inbox', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedOwnerId, expectedCompany: company, id: captureId, fingerprint, snapshot: source }) }));
  await json(await sourcePost('other'), 409); await json(await sourcePost('owner'));
  const selection = (await json(await h.load('app/api/source-inbox/ready/route.ts').GET(new Request('https://app.test/api/source-inbox/ready?' + new URLSearchParams({ sourceUrl, captureId, fingerprint, revision: '1' }))))).capture;
  const sourceBefore = JSON.stringify(h.sqlite.prepare('SELECT * FROM source_inbox WHERE id=?').get(captureId)), jobsApi = h.load('app/api/collection-jobs/route.ts');
  const newJob = revision => jobsApi.POST(new Request('https://app.test/api/collection-jobs', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ urls: [sourceUrl], goal: 'work', profileId: profile.id, expectedProfileRevision: revision, expectedSettings: settings, features: '', keywords: '' }) }));
  const count = h.sqlite.prepare('SELECT count(*) n FROM collection_jobs').get().n;
  await json(await newJob(profile.revision + 1), 409); assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_jobs').get().n, count);
  const queued = await json(await newJob(profile.revision)); assert.equal(queued.jobs.length, 1); const jobId = queued.jobs[0].id;
  const run = async () => h.load('app/intake-collection.ts').collectIntakeProduct(await h.load('db/collection-jobs.ts').findCollectionJob('owner', jobId), {
    selectedCapture: selection, signal: new AbortController().signal, fetcher: (path, init) => h.route(path, { method: init?.method ?? 'GET', body: init?.body }),
    onJob() {}, onProgress() {}, captureFromBrowser: () => assert.fail('No browser source'), probeExistingFromBrowser: () => assert.fail('No source probe') });
  assert.match(await run(), /상품 초안 저장됨/);
  const job = await h.load('db/collection-jobs.ts').findCollectionJob('owner', jobId), productId = job.product_id, base = '/api/products/' + productId;
  return { h, run, newJob, job, jobId, productId, base, profile, form, source, sourceBefore, captureId, oldId, oldKey, oldBefore, oldBytes, priorJob,
    sourceRequests: () => sourceRequests, aiCalls: () => aiCalls };
}

for (const company of companies) test(`${company.code}: saved DOM capture -> chosen category -> actual intake -> SEO thumbnails and each quotation main image, preserving old work and later edits`, async () => {
  const f = await importedFlow(company), { h, job, jobId, productId, base } = f;
  try {
    const source = (await h.load('db/collection-results.ts').readCollectionResult('owner', jobId)).result;
    const receiptBefore = JSON.stringify(h.sqlite.prepare('SELECT * FROM collection_results WHERE job_id=?').get(jobId));
    const seo = await json(await h.route(base + '/seo-workspace')), quote = await json(await h.route(base + '/quotation-fields'));
    assert.equal(job.context.category.id, f.profile.id); assert.equal(job.context.company.code, company.code); assert.equal(source.offerId, offerId);
    const keys = new Map(h.sqlite.prepare('SELECT image_index,object_key FROM collection_images WHERE job_id=?').all(jobId).map(row => [row.image_index, row.object_key]));
    const optionKeys = [keys.get(2), keys.get(3)]; assert.ok(optionKeys.every(key => key && h.objects.has(key))); assert.notEqual(...optionKeys);
    assert.deepEqual(seo.options.rows.map(row => [row.id, row.originalName, row.translatedName, row.unitCostCny, row.supplierSku]), [
      ['collected-1', '黑色 / 均码', '검정 / 프리', 5.3, ''], ['collected-2', '灰色 / 均码', '회색 / 프리', 6.1, ''],
    ]);
    assert.deepEqual(seo.options.rows.map(row => row.imageKey), optionKeys);
    assert.ok(seo.options.rows.every(row => row.provenance.imageKey === 'collected' && row.provenance.supplierSku === 'unverified'));
    assert.deepEqual(seo.sourceImageKeys, { 'collected-1': optionKeys[0], 'collected-2': optionKeys[1] });
    assert.deepEqual(quote.resolved.rows.filter(row => row.optionId).map(row => [row.optionId, row.fields.mainImage.value]), [['collected-1', optionKeys[0]], ['collected-2', optionKeys[1]]]);
    assert.equal(quote.categoryContext.profileId, f.profile.id); assert.equal(quote.resolved.schema.categoryId, f.form.categoryId);
    const binding = seo.options.collectedPageOptionBindings;
    assert.equal(binding.ownerId, 'owner'); assert.equal(binding.jobId, jobId); assert.equal(binding.productId, productId);
    assert.deepEqual(binding.rows.map(row => [row.optionId, row.sourceKey]), [['collected-1', 'dom-row:1'], ['collected-2', 'dom-row:2']]);
    const edited = await json(await h.route(base + '/seo-workspace', { method: 'PATCH', body: {
      expectedProductVersion: seo.productVersion, expectedContentRevision: seo.content.revision, expectedOptionRevision: seo.options.revision,
      seo: { title: '직접 검토한 합성 상품' }, optionNames: [{ optionId: 'collected-2', value: '직접 회색 / 프리' }] } }));
    assert.deepEqual(edited.options.collectedPageOptionBindings, binding);
    assert.deepEqual((await json(await h.route(base + '/seo-workspace'))).sourceImageKeys, seo.sourceImageKeys);
    const rows = h.load('app/product-options.ts').optionInputs(edited.options).reverse(); rows[0].unitCostCny = 8.4; rows[1].imageKey = optionKeys[1];
    let state = await json(await h.route(base + '/options', { method: 'PATCH', body: { expectedRevision: edited.options.revision, expectedProductVersion: edited.productVersion, rows } }));
    const blank = h.load('app/product-options.ts').optionInputs(state.options); blank[1].imageKey = null;
    state = await json(await h.route(base + '/options', { method: 'PATCH', body: { expectedRevision: state.options.revision, expectedProductVersion: state.productVersion, rows: blank } }));
    const editBefore = retainedProduct(h, productId), fileBefore = files(h), aiBefore = f.aiCalls();
    const again = await json(await h.route('/api/collection-jobs/' + jobId + '/image-draft', { method: 'POST', body: { productId } }));
    assert.equal(again.changedOptions, 0); assert.equal(again.changedRoles, 0);
    assert.equal(retainedProduct(h, productId), editBefore); assert.equal(files(h), fileBefore);
    const current = await json(await h.route(base + '/seo-workspace'));
    assert.deepEqual(current.options.rows.map(row => [row.id, row.imageKey, row.unitCostCny]), [['collected-2', optionKeys[1], 8.4], ['collected-1', null, 5.3]]);
    assert.equal(current.options.rows[1].provenance.imageKey, 'manual'); assert.deepEqual(current.sourceImageKeys, seo.sourceImageKeys);
    assert.deepEqual(current.options.collectedPageOptionBindings, binding);
    await json(await f.newJob(f.profile.revision)); assert.match(await f.run(), /기존 상품 열기/);
    assert.equal(retainedProduct(h, productId), editBefore); assert.equal(files(h), fileBefore); assert.equal(f.aiCalls(), aiBefore);
    assert.equal(retainedProduct(h, f.oldId), f.oldBefore); assert.equal(Buffer.from(h.objects.get(f.oldKey)).toString('hex'), f.oldBytes);
    assert.equal(JSON.stringify(h.sqlite.prepare("SELECT * FROM collection_jobs WHERE id='job'").get()), f.priorJob);
    assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM source_inbox WHERE id=?').get(f.captureId)), f.sourceBefore);
    assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM collection_results WHERE job_id=?').get(jobId)), receiptBefore);
    assert.equal(f.sourceRequests(), 0); assert.ok(h.network.every(host => host === 'cbu01.alicdn.com'));
    assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n, 0);
  } finally { h.close(); }
});

test('actual thumbnail reads are owner/product/job/source-bound; API deletion and raw rewrite permanently prune bindings without touching source files', async () => {
  const f = await importedFlow(companies[1]), { h, base, productId, jobId } = f;
  try {
    const queries = h.load('db/queries.ts'), db = h.load('db/collection-images.ts'), model = h.load('app/product-options.ts');
    const product = await queries.findProduct('owner', productId), original = await h.load('db/product-options.ts').readProductOptions('owner', productId), fileBefore = files(h);
    const initial = await db.readOptionSourceImages('owner', product, original); assert.equal(Object.keys(initial).length, 2);
    assert.deepEqual(plain(await db.readOptionSourceImages('other', product, original)), {});
    assert.deepEqual(plain(await db.readOptionSourceImages('owner', { ...product, id: f.oldId }, original)), {});
    assert.deepEqual(plain(await db.readOptionSourceImages('owner', product, { ...original, collectedPageOptionBindings: undefined })), {});
    const foreign = structuredClone(original); foreign.collectedPageOptionBindings.jobId = 'job';
    assert.deepEqual(plain(await db.readOptionSourceImages('owner', product, foreign)), {});
    const savedReceipt = h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get(jobId).payload;
    assert.equal(h.load('app/collection-source-supplement.ts').canSupplementCollection(JSON.parse(savedReceipt)), false);
    await json(await h.route('/api/collection-jobs/' + jobId + '/source-supplement', { method: 'POST', body: {} }), 409);
    assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get(jobId).payload, savedReceipt, 'anonymous page identity cannot enter the separate mobile-supplement contract');
    const changed = JSON.parse(savedReceipt); changed.options[0].imageIndex = 3;
    h.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(JSON.stringify(changed), jobId);
    assert.deepEqual(plain(await db.readOptionSourceImages('owner', product, original)), {}, 'changed saved receipt cannot redirect thumbnails');
    h.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(savedReceipt, jobId);
    assert.deepEqual(plain(await db.readOptionSourceImages('owner', product, original)), plain(initial));
    const save = async (state, rows) => json(await h.route(base + '/options', { method: 'PATCH', body: { expectedRevision: state.options.revision, expectedProductVersion: state.productVersion, rows } }));
    const start = await json(await h.route(base + '/options'));
    await json(await h.route(base + '/options', { method: 'PATCH', body: { expectedRevision: start.options.revision, expectedProductVersion: start.productVersion,
      rows: model.optionInputs(start.options), collectedPageOptionBindings: original.collectedPageOptionBindings } }), 400);
    let state = await save(start, model.optionInputs(start.options).slice(1));
    state = await save(state, [model.optionInputs(original)[0], ...model.optionInputs(state.options)]);
    assert.deepEqual(state.options.collectedPageOptionBindings.rows.map(row => row.optionId), ['collected-2']);
    assert.deepEqual((await json(await h.route(base + '/options'))).sourceImageKeys, { 'collected-2': initial['collected-2'] });
    let rows = model.optionInputs(state.options); rows[1].originalName = '수동으로 다른 원문'; state = await save(state, rows);
    rows = model.optionInputs(state.options); rows[1].originalName = original.rows[1].originalName; state = await save(state, rows);
    assert.equal(state.options.collectedPageOptionBindings, undefined); assert.deepEqual((await json(await h.route(base + '/options'))).sourceImageKeys, {});
    assert.equal(state.options.rows[1].provenance.originalName, 'manual');
    assert.equal(files(h), fileBefore); assert.equal(retainedProduct(h, f.oldId), f.oldBefore);
    assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get(jobId).payload, savedReceipt);
    assert.equal(f.sourceRequests(), 0); assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n, 0);
  } finally { h.close(); }
});
