import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { schemaCompanies, hubSchemaSnapshot } from './helpers/hub-schema.mjs';

const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const product = h => h.sqlite.prepare('SELECT * FROM products').get();
const payload = (h, table) => JSON.parse(h.sqlite.prepare('SELECT payload FROM ' + table).get().payload);
const retained = h => JSON.stringify(['products', 'product_content', 'product_options', 'product_quotation_fields', 'product_price_policy', 'collection_context',
  'collection_results', 'translation_jobs'].map(table => h.sqlite.prepare('SELECT * FROM ' + table).all()));
const translatedOption = value => value.replaceAll('亮黑', '유광 검정').replaceAll('砂黑', '무광 검정').replaceAll('砂灰', '무광 회색')
  .replaceAll('太阳镜 加005 盒子', '선글라스 + 005 케이스').replaceAll('太阳镜', '선글라스');

// Actual intake/translation/content/quotation APIs and queue, with recorded SKU
// facts and isolated Google/R2 fixtures. No supplier or Google request is sent.
async function fixture(company, mode = '400') {
  const description = mode === 'chunk' ? '原'.repeat(5001) : '原文商品说明\n第二行原文说明', queries = [], calls = [], previews = [];
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name, translationFetcher: target => {
    const query = new URL(target).searchParams.get('q'); queries.push(query);
    if (query === description || mode === 'chunk' && /^原+$/u.test(query)) {
      if (mode === 'network') throw Error('synthetic description transport failure');
      if (mode === 'invalid') return Response.json({ unsupported: 'synthetic description response' });
      return new Response('synthetic description HTTP error', { status: 400 });
    }
    const translated = query.startsWith('[[YFTR') ? query.split('\n').map(line => {
      const match = /^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line); assert.ok(match);
      return match[1] + ' ' + translatedOption(match[2]);
    }).join('\n') : '원문 기준 선글라스';
    return Response.json([[[translated, query]], null, 'zh-CN']);
  } });
  try {
    const snapshot = hubSchemaSnapshot(company), profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', {
      name: '설명 번역 누락 검증', categoryId: snapshot.categoryId, categoryPath: snapshot.categoryPath, hubSchema: snapshot, template: null, mappings: [] });
    h.context.category = profile;
    h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));
    await h.load('db/queries.ts').saveSettings('owner', JSON.stringify(h.settings));
    await json(await h.route('/api/collection-jobs/job/collect', { method: 'POST' }));
    const receipt = payload(h, 'collection_results'); receipt.description = description; receipt.attributes = [{ name: '재질', value: 'PC' }];
    h.sqlite.prepare('UPDATE collection_results SET payload=?').run(JSON.stringify(receipt));
    h.bindings.SOURCEFLOW_TEXT_PROVIDER = 'google-free'; delete h.bindings.AI;
    let rows = [{ ...h.load('app/intake-queue.ts').intakeRow(profile, 'row'), url: h.sourceUrl, keywords: h.context.keywords }], intercept;
    const fetcher = async (path, init = {}) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined; calls.push({ path, body });
      const response = path === '/api/collection-jobs'
        ? await h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test' + path, init))
        : await h.route(path, { method: init.method ?? 'GET', body: init.body });
      if (path.endsWith('/translation-apply') && body.action === 'preview' && response.ok) previews.push(await response.clone().json());
      return intercept ? await intercept(path, init, response) : response;
    };
    const run = (signal = new AbortController().signal) => h.load('app/intake-queue.ts').submitIntakeQueue(rows, 'price', { signal, fetcher, expectedSettings: h.settings,
      onJobs() {}, onRow(id, patch) { rows = rows.map(row => row.id === id ? { ...row, ...patch } : row); },
      collect: (job, progress, linked) => h.load('app/intake-collection.ts').collectIntakeProduct(job, { signal, fetcher, onProgress: progress,
        onJob(updated) { if (updated.product_id) linked(updated.product_id); } }) });
    const prepare = (signal = new AbortController().signal) => h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(product(h).id, fetcher, signal);
    return { h, description, queries, calls, previews, run, prepare, get rows() { return rows; }, set intercept(value) { intercept = value; },
      restore() { rows = rows.map(row => ({ ...row, status: 'draft', message: '', productId: undefined })); } };
  } catch (error) { h.close(); throw error; }
}

for (const company of schemaCompanies) for (const mode of ['400', 'network', 'invalid', 'chunk']) test(`missing Google description remains review-required after successful title/options (${company.code}, ${mode})`, async () => {
  const f = await fixture(company, mode), { h } = f;
  try {
    await f.run();
    assert.equal(f.rows[0].status, 'saved', f.rows[0].message); assert.match(f.rows[0].message, /검토 필요.*상품 설명 번역/);
    assert.doesNotMatch(f.rows[0].message, /SEO·옵션 초안을 생성해 반영했습니다/);
    const content = payload(h, 'product_content'), options = payload(h, 'product_options'), current = product(h);
    assert.equal(content.seo.description.value, f.description); assert.equal(content.seo.description.provenance, 'collected');
    assert.ok(content.seo.title.value.includes('원문 기준 선글라스')); assert.equal(content.categoryAttributes.values[0].value, 'PC');
    assert.ok(options.rows.every(row => row.translatedName && row.provenance.translatedName === 'translated'));
    assert.equal(h.stats.downloads, 19); assert.equal(h.objects.size, 19); assert.equal(f.queries.length, 3);
    assert.equal(f.queries.filter(query => query === f.description).length, mode === 'chunk' ? 0 : 1);
    assert.equal(f.calls.filter(call => call.body?.action === 'prepare-intake-options').length, 0);
    assert.ok(f.previews.length); assert.equal(f.previews[0].intakeSeoCoverage.missingDescription, true);
    assert.equal(f.previews[0].intakeSeoCoverage.contentRevision, f.previews[0].contentRevision);
    const quote = await json(await h.route('/api/products/' + current.id + '/quotation-fields'));
    assert.ok(quote.resolved.rows[0].fields.detailHtml.value.includes('原')); assert.equal(Number(quote.resolved.rows[0].fields.supplyPrice.value), current.supply_price);
    const before = retained(h), objects = new Map([...h.objects].map(([key, bytes]) => [key, [...bytes]])), requests = f.queries.length;
    const retry = await f.prepare(); assert.equal(retry.completed, false); assert.equal(retry.reviewRequired, true); assert.equal(retry.manualReady, false);
    f.restore(); await f.run(); assert.equal(f.rows[0].status, 'saved'); assert.match(f.rows[0].message, /검토 필요.*상품 설명 번역/);
    assert.equal(retained(h), before); assert.deepEqual(new Map([...h.objects].map(([key, bytes]) => [key, [...bytes]])), objects);
    assert.equal(f.queries.length, requests); assert.equal(f.calls.filter(call => call.body?.action === 'execute').length, 1);
    assert.equal(product(h).supplier_hub_status, '미전송'); assert.ok(!h.network.includes('supplier.coupang.com'));
  } finally { h.close(); }
});

for (const company of schemaCompanies) test(`manual Korean descriptions and explicit blanks resolve only the missing-description review (${company.code})`, async () => {
  for (const description of ['직접 확인한 한국어 설명', '']) {
    const f = await fixture(company), { h } = f;
    try {
      await f.run();
      const path = '/api/products/' + product(h).id, content = payload(h, 'product_content'), key = JSON.parse(product(h).image_keys)[0];
      await json(await h.route(path + '/content', { method: 'PATCH', body: { expectedRevision: content.revision,
        patch: { seo: { description }, label: { material: '검토한 재질' }, assets: { label: [key] } } } }));
      const quote = await json(await h.route(path + '/quotation-fields'));
      await json(await h.route(path + '/quotation-fields', { method: 'PUT', body: { expectedRevision: quote.revision, expectedInputFingerprint: quote.inputFingerprint,
        changes: [{ fieldKey: 'salePrice', optionId: 'collected-1', value: '45000' }] } }));
      const before = retained(h), requests = f.queries.length, png = [...h.objects.get(key)];
      const retry = await f.prepare(); assert.equal(retry.completed, true); assert.equal(retry.reviewRequired, false);
      assert.equal(f.previews.at(-1).intakeSeoCoverage.missingDescription, false);
      f.restore(); await f.run(); assert.equal(f.rows[0].status, 'saved'); assert.doesNotMatch(f.rows[0].message, /검토 필요/);
      const current = payload(h, 'product_content'); assert.equal(current.seo.description.value, description); assert.equal(current.seo.description.provenance, 'manual');
      assert.equal(retained(h), before); assert.equal(f.queries.length, requests); assert.deepEqual([...h.objects.get(key)], png);
      const after = await json(await h.route(path + '/quotation-fields'));
      const first=after.resolved.rows.find(row=>row.optionId==='collected-1');
      assert.equal(first.fields.salePrice.value, '45000'); assert.equal(first.fields.salePrice.source, 'manual-option');
      assert.equal(first.fields.labelImages.value, key); assert.equal(current.label.material.value, '검토한 재질');assert.equal(current.label.material.provenance,'manual');
      assert.equal(first.fields.detailHtml.value, description ? '<p>직접 확인한 한국어 설명</p>' : '');
    } finally { h.close(); }
  }
});

test('missing-description coverage rejects a missing or foreign preview proof and suppresses cancelled acknowledgement', async () => {
  for (const mode of ['missing', 'foreign-job', 'foreign-revision', 'malformed', 'abort']) {
    const f = await fixture(schemaCompanies[0]), { h } = f;
    try {
      await f.run(); const before = retained(h), requests = f.queries.length, controller = new AbortController();
      f.intercept = async (path, init, response) => {
        if (!path.endsWith('/translation-apply') || JSON.parse(init.body).action !== 'preview') return response;
        const body = await response.json();
        if (mode === 'missing') delete body.intakeSeoCoverage;
        if (mode === 'foreign-job') body.intakeSeoCoverage.jobId = crypto.randomUUID();
        if (mode === 'foreign-revision') body.intakeSeoCoverage.contentRevision++;
        if (mode === 'malformed') body.intakeSeoCoverage.missingDescription = 'false';
        if (mode === 'abort') controller.abort();
        return Response.json(body);
      };
      const retry = await f.prepare(controller.signal);
      assert.equal(retry.completed, false); assert.equal(retry.reviewRequired, false);
      if (mode === 'abort') assert.equal(retry.message, ''); else assert.match(retry.message, /상품 설명과 번역 누락 상태/);
      assert.equal(retained(h), before); assert.equal(f.queries.length, requests);
    } finally { h.close(); }
  }
});

test('a manual description saved after the coverage preview invalidates apply and resumes without another Google request', async () => {
  const f=await fixture(schemaCompanies[0]),{h}=f;
  try{
    let edited=false;
    f.intercept=async(path,init,response)=>{
      if(!edited&&path.endsWith('/translation-apply')&&JSON.parse(init.body).action==='preview'&&response.ok){
        edited=true;
        await json(await h.route('/api/products/'+product(h).id+'/content',{method:'PATCH',body:{expectedRevision:payload(h,'product_content').revision,
          patch:{seo:{description:'미리보기 이후 직접 검토한 설명'}}}}));
      }
      return response;
    };
    await f.run();assert.equal(edited,true);assert.equal(f.rows[0].status,'error');assert.match(f.rows[0].message,/상품이 변경/);
    assert.equal(f.previews[0].intakeSeoCoverage.missingDescription,true);
    assert.equal(payload(h,'product_content').seo.title.provenance,'collected','stale coverage never acknowledges the pending title/options apply');
    assert.ok(payload(h,'product_options').rows.every(row=>row.translatedName===''));
    const requests=f.queries.length,job=h.sqlite.prepare('SELECT * FROM translation_jobs').get(),pngs=new Map([...h.objects].map(([key,bytes])=>[key,[...bytes]]));
    f.intercept=null;f.restore();await f.run();
    assert.equal(f.rows[0].status,'saved',f.rows[0].message);assert.doesNotMatch(f.rows[0].message,/검토 필요/);
    assert.equal(f.previews.at(-1).intakeSeoCoverage.missingDescription,false);
    assert.equal(payload(h,'product_content').seo.description.value,'미리보기 이후 직접 검토한 설명');
    assert.equal(payload(h,'product_content').seo.description.provenance,'manual');
    assert.ok(payload(h,'product_options').rows.every(row=>row.translatedName&&row.provenance.translatedName==='translated'));
    assert.equal(f.queries.length,requests);assert.deepEqual(h.sqlite.prepare('SELECT * FROM translation_jobs').get(),job);
    assert.deepEqual(new Map([...h.objects].map(([key,bytes])=>[key,[...bytes]])),pngs);
  }finally{h.close();}
});
