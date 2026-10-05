import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const content = h => JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
const product = h => h.sqlite.prepare('SELECT * FROM products').get();
const json = async response => { assert.equal(response.ok, true, await response.clone().text()); return response.json(); };
const companies = [{ companyCode: 'A01464742', companyName: '와이홉' }, { companyCode: 'A01526306', companyName: '유앤채' }];
const componentHeadings = ['镜片材质', '镜框材质', '镜架材质'];

function abbreviateHeadings(h, component) {
  const run = h.bindings.AI.run;
  h.bindings.AI.run = async (...args) => {
    const output = await run(...args);
    // Valid structured AI output can shorten a heading. The immutable original
    // still says lens/frame material or supplier item number, not a whole-product fact.
    for (const [source, translated] of [[component, '재질'], ['货号', '모델명']]) {
      const item = output.response.attributes.find(attribute => attribute.name === '상품속성: ' + source);
      assert.ok(item); item.name = translated;
    }
    return output;
  };
}

for (const company of companies) test(`intake retains component and supplier-number scope through stage-seven quotation (${company.companyCode})`, async () => {
  for (const heading of componentHeadings) {
    const h = mobileIntakeHarness(company);
    try {
      abbreviateHeadings(h, heading);
      await h.intake();
      const saved = content(h), receipt = JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload);
      assert.equal(saved.label.material.value, '', heading + ' is not whole-product material');
      assert.equal(saved.label.model.value, '', 'supplier item number is not a model declaration');
      assert.equal(saved.label.material.provenance, 'unverified');
      assert.equal(saved.label.model.provenance, 'unverified');
      const quote = await json(await h.route(`/api/products/${product(h).id}/quotation-fields`));
      for (const row of quote.resolved.rows) {
        assert.equal(row.fields.model.value, '');
        assert.equal(row.fields.noticeMaterial.value, '해당사항없음');
        assert.equal(row.fields.noticeMaterial.source, 'couplus-default', 'retain the observed form default as an unverified default');
        assert.equal(row.fields.packagedWeightG.value, '');
        assert.equal(row.fields.packagedDimensionsMm.value, '');
      }
      const jobs = await json(await h.route(`/api/products/${product(h).id}/translation`)), job = jobs.jobs[0];
      for (const sourceName of [heading, '货号']) {
        const original = receipt.attributes.find(item => item.name === sourceName), index = job.review.source.attributes.findIndex(item => item.name === '상품속성: ' + sourceName);
        assert.equal(job.review.source.attributes[index].value, original.value);
        assert.equal(job.result.draft.attributes.find(item => item.sourceIndex === index).value, original.value);
        assert.equal(saved.categoryAttributes.values.find(item => item.sourceName === '상품속성: ' + sourceName).value, original.value);
      }
      assert.equal(saved.categoryAttributes.values.length, receipt.attributes.length);
      const options = JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);
      assert.equal(options.rows.length, 6);
      for (const row of quote.resolved.rows.filter(item => item.optionId)) {
        const option = options.rows.find(item => item.id === row.optionId);
        assert.equal(row.fields.color.value, option.color); assert.equal(row.fields.size.value, option.size);
        assert.ok(option.translatedName); assert.equal(option.unitCostCny, receipt.options.find(item => item.sku === option.supplierSku).unitPriceCny);
      }
      assert.equal(h.aiSources.length, 1);
      const before = JSON.stringify({ product: product(h), saved, options, receipt });
      await h.intake();
      assert.equal(JSON.stringify({ product: product(h), saved: content(h), options: JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload), receipt: JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload) }), before);
      assert.equal(h.aiSources.length, 1);
    } finally { h.close(); }
  }
});

test('source scope only removes automatic suggestions; explicitly reviewed mappings and manual blanks keep their existing contract', async () => {
  const h = mobileIntakeHarness();
  try {
    h.sqlite.prepare("UPDATE collection_jobs SET goal='collect'").run(); await h.intake();
    abbreviateHeadings(h, componentHeadings[0]);
    const base = `/api/products/${product(h).id}`, call = body => h.route(base + '/translation', { method: 'POST', body });
    let { job } = await json(await call({ action: 'prepare-collected', intake: true }));
    ({ job } = await json(await call({ action: 'approve', jobId: job.id, reviewFingerprint: job.review.fingerprint, confirmPaid: true })));
    ({ job } = await json(await call({ action: 'execute', jobId: job.id })));
    const adoption = h.load('app/translation-label-adoption.ts'), saved = content(h);
    const suggestions = adoption.suggestTranslationLabels(saved, job, product(h).updated_at);
    assert.equal(suggestions.mappings.some(item => ['material', 'model'].includes(item.field)), false);
    assert.ok(suggestions.skipped.some(message => message.includes('镜片材质')));
    assert.ok(suggestions.skipped.some(message => message.includes('货号')));
    const mappings = [['镜片材质', 'material'], ['货号', 'model']].map(([name, field]) => ({ field, sourceIndex: job.review.source.attributes.findIndex(item => item.name === '상품속성: ' + name) }));
    const selected = adoption.translationLabelAdoption(saved, job, product(h).updated_at, mappings);
    await json(await h.route(base + '/content', { method: 'PATCH', body: selected.input }));
    const quote = await json(await h.route(base + '/quotation-fields'));
    assert.equal(quote.resolved.rows[1].fields.noticeMaterial.value, 'PC');
    assert.equal(quote.resolved.rows[1].fields.model.value, '15995');
    await json(await h.route(base + '/content', { method: 'PATCH', body: { expectedRevision: content(h).revision, patch: { label: { material: '', model: '' }, labelClears: ['material', 'model'] } } }));
    const cleared = await json(await h.route(base + '/quotation-fields'));
    assert.equal(cleared.resolved.rows[1].fields.noticeMaterial.value, '');
    assert.equal(cleared.resolved.rows[1].fields.model.value, '');
  } finally { h.close(); }
});
