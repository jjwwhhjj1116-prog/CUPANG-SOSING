import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';
import { webcrypto } from 'node:crypto';

const content = h => JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
const options = h => JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);
const product = h => h.sqlite.prepare('SELECT * FROM products').get();
const receipt = h => JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload);
const originals = h => new Map(h.sqlite.prepare('SELECT image_index,object_key FROM collection_images ORDER BY image_index').all().map(row => [row.image_index, row.object_key]));
const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
const imageDraft = h => h.route('/api/collection-jobs/job/image-draft', { method: 'POST', body: { productId: product(h).id } });
const patchContent = (h, patch) => h.route('/api/products/' + product(h).id + '/content', { method: 'PATCH', body: { expectedRevision: content(h).revision, patch } });
const patchOptions = (h, edit) => {
  const saved = options(h), rows = h.load('app/product-options.ts').optionInputs(saved); edit(rows);
  return h.route('/api/products/' + product(h).id + '/options', { method: 'PATCH', body: { expectedRevision: saved.revision, expectedProductVersion: product(h).updated_at, rows } });
};
async function library(h) {
  h.sqlite.prepare("UPDATE collection_jobs SET goal='collect'").run();
  await h.intake();
  h.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run();
}

for (const company of [{ companyCode: 'A01464742', companyName: '와이홉' }, { companyCode: 'A01526306', companyName: '유앤채' }]) {
  test(`URL intake links recorded originals to editable image and SKU drafts (${company.companyCode})`, async () => {
    const h = mobileIntakeHarness(company);
    try {
      h.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run();
      await h.intake();
      const source = receipt(h), keys = originals(h), saved = content(h), rows = options(h).rows;
      for (const role of ['main', 'additional', 'detail']) {
        const expected = source.images.flatMap((image, index) => image.role === role ? [keys.get(index)] : []);
        assert.ok(expected.length, role + ' has recorded supplier images');
        assert.deepEqual(saved.assets[role].value, expected, role + ' uses exact receipt order');
        assert.equal(saved.assets[role].provenance, 'collected');
      }
      for (const row of rows) {
        const original = source.options.find(value => value.sku === row.supplierSku);
        assert.equal(row.imageKey, keys.get(original.imageIndex));
        assert.equal(row.provenance.imageKey, 'collected');
      }
      const quote = await json(await h.route('/api/products/' + product(h).id + '/quotation-fields'));
      for (const row of quote.resolved.rows) {
        assert.equal(row.fields.mainImage.value, row.optionId ? rows.find(option => option.id === row.optionId).imageKey : saved.assets.main.value[0]);
        assert.equal(row.fields.additionalImages.value, saved.assets.additional.value.join('\n'));
        assert.equal(row.fields.detailImages.value, saved.assets.detail.value.join('\n'));
      }
      const fields = ['skuId', 'mainImage', 'additionalImages', 'detailImages'];
      const workbook = quotationWorkbook(fields), sha256 = Buffer.from(await webcrypto.subtle.digest('SHA-256', workbook)).toString('hex');
      const storageKey = h.load('db/category-templates.ts').templateKey('owner', sha256, 'xlsx'); h.objects.set(storageKey, workbook);
      await h.load('db/category-profiles.ts').createCategoryProfile('owner', { name: '합성 이미지 연결 시험', categoryId: '80719', categoryPath: h.context.category.categoryPath,
        template: { name: 'image-links.xlsx', format: 'xlsx', sha256, storageKey, sheetName: '견적서', headerRow: 1, headers: fields },
        mappings: fields.map((field, column) => ({ field, column, required: false })) }, 'cat');
      const exportSource = h.load('app/exports/quotation-source.ts'), exported = await exportSource.readQuotationExportSource('owner', product(h).id, 'cat');
      const resolved = exportSource.resolveQuotationExport(exported), exportFields = h.load('app/exports/quotation-fields.ts');
      const attachments = exportFields.quotationAttachmentKeys(exported, resolved, 'quotation').map((key, index) => ({ key, name: `assets/source-${index}.png`, bytes: h.objects.get(key) }));
      const exportedRows = exportFields.resolvedQuotationRows(exported, resolved, attachments);
      const xlsx = await h.load('app/exports/mapped-quotation.ts').createMappedQuotation({ originalBytes: workbook, profile: exported.profile, rows: exportedRows, dataStartRow: 2 });
      const reader = h.load('app/xlsx-template.ts'), sheets = reader.inspectXlsxArchive(await reader.readXlsxArchive(xlsx.bytes));
      for (let index = 0; index < rows.length; index++) {
        const cells = reader.xlsxHeaders(sheets, '견적서', index + 2), asset = attachments.find(item => item.key === rows[index].imageKey);
        assert.equal(cells[0], rows[index].supplierSku); assert.equal(cells[1], asset.name.split('/').at(-1));
        assert.equal(cells[2], exportedRows[index].additionalImages); assert.equal(cells[3], exportedRows[index].detailImages);
      }
      assert.equal(h.stats.downloads, 19);
      assert.equal(h.stats.maxDownloads, 3, 'keep the existing three-download batches');
      assert.equal(h.aiSources.length, 1);
      assert.equal(product(h).image_status, '대기');
      assert.equal(product(h).supplier_hub_status, '미전송');
      const before = JSON.stringify({ product: product(h), content: saved, options: options(h) });
      await h.intake();
      assert.equal(JSON.stringify({ product: product(h), content: content(h), options: options(h) }), before);
      assert.equal(h.stats.downloads, 19);
      assert.equal(h.aiSources.length, 1);
    } finally { h.close(); }
  });
}

test('collect and SEO-price preserve the observed empty image stages and cannot call work-only image assignment', async () => {
  for (const goal of ['collect', 'price', 'transmit']) {
    const h = mobileIntakeHarness();
    try {
      h.sqlite.prepare('UPDATE collection_jobs SET goal=?').run(goal);
      await h.intake();
      for (const role of ['main', 'additional', 'detail']) assert.deepEqual(content(h).assets[role].value, []);
      assert.ok(options(h).rows.every(row => row.imageKey === null));
      assert.ok(!h.calls.some(path => path.endsWith('/image-draft')));
      const before = JSON.stringify({ product: product(h), content: content(h), options: options(h) });
      assert.equal((await imageDraft(h)).status, 409);
      assert.equal(JSON.stringify({ product: product(h), content: content(h), options: options(h) }), before);
    } finally { h.close(); }
  }
});

test('work image drafts preserve explicit same-empty roles, selected order, banners, cleared option images and excluded rows', async () => {
  const h = mobileIntakeHarness();
  try {
    await library(h);
    const keys = [...originals(h).values()];
    await json(await patchContent(h, { assets: { main: [], additional: [keys[2], keys[1]], detailTop: [keys[0]] }, seo: { description: '', keywords: [] }, label: { material: '직접 확인한 재질' } }));
    assert.equal(content(h).assets.main.provenance, 'manual', 'explicit unchanged empty role is a manual choice');
    await json(await patchOptions(h, rows => { rows[0].imageKey = keys[1]; rows[1].imageKey = keys[2]; rows[2].included = false; rows[3].translatedName = '직접 수정 옵션'; }));
    await json(await patchOptions(h, rows => { rows[1].imageKey = null; }));
    const before = { content: content(h), options: options(h), policy: h.sqlite.prepare('SELECT payload FROM product_price_policy').get().payload };
    const result = await json(await imageDraft(h));
    assert.equal(result.changedRoles, 1);
    assert.equal(result.changedOptions, 3);
    const saved = content(h), rows = options(h).rows;
    for (const role of ['main', 'additional', 'detailTop']) assert.deepEqual(saved.assets[role], before.content.assets[role]);
    assert.deepEqual(saved.seo, before.content.seo); assert.deepEqual(saved.label, before.content.label);
    assert.ok(saved.assets.detail.value.length > 0); assert.equal(saved.assets.detail.provenance, 'collected');
    for (let index = 0; index < 3; index++) assert.deepEqual(rows[index], before.options.rows[index]);
    assert.equal(rows[3].translatedName, '직접 수정 옵션');
    assert.equal(h.sqlite.prepare('SELECT payload FROM product_price_policy').get().payload, before.policy);
    const settled = JSON.stringify({ product: product(h), content: saved, options: options(h) });
    assert.deepEqual(await json(await imageDraft(h)), { productId: product(h).id, changedRoles: 0, changedOptions: 0, prepared: true, message: '원본 이미지 초안을 연결했습니다. 번역·가공·검토 완료 여부는 각 단계에서 확인해주세요.' });
    assert.equal(JSON.stringify({ product: product(h), content: content(h), options: options(h) }), settled);
  } finally { h.close(); }
});

test('partial work image import and lost draft acknowledgement resume in receipt order without refetch or restoring manual blanks', async () => {
  const h = mobileIntakeHarness();
  try {
    h.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run(); h.stats.failImageIndex = 4;
    await assert.rejects(h.intake(), /원본 5번/);
    assert.ok(content(h).assets.main.value.length);
    await json(await patchContent(h, { assets: { main: [] } }));
    const downloads = h.stats.downloads; h.stats.failImageIndex = null;
    const fetcher = async (path, init) => {
      const response = await h.route(path, { method: init?.method ?? 'GET', body: init?.body });
      if (path.endsWith('/image-draft')) throw Error('fixture saved acknowledgement lost');
      return response;
    };
    await assert.rejects(h.load('app/intake-collection.ts').collectIntakeProduct(await h.load('db/collection-jobs.ts').findCollectionJob('owner', 'job'), { signal: new AbortController().signal, fetcher, onJob() {}, onProgress() {} }), /acknowledgement lost/);
    assert.equal(h.stats.downloads - downloads, 1);
    assert.deepEqual(content(h).assets.main.value, []);
    const source = receipt(h), keys = originals(h);
    for (const role of ['additional', 'detail']) assert.deepEqual(content(h).assets[role].value, source.images.flatMap((image, index) => image.role === role ? [keys.get(index)] : []));
    const before = JSON.stringify({ product: product(h), content: content(h), options: options(h) });
    await h.intake();
    assert.equal(JSON.stringify({ product: product(h), content: content(h), options: options(h) }), before);
    assert.equal(h.aiSources.length, 1); assert.equal(h.stats.downloads - downloads, 1);
  } finally { h.close(); }
});

test('image draft atomic guard rejects independent content/options revisions, changed receipt/context/link and concurrent goal change', async () => {
  for (const change of ['content', 'options', 'receipt', 'context', 'link', 'goal', 'image']) {
    const h = mobileIntakeHarness();
    try {
      await library(h);
      const originalBatch = h.db.batch; let raced = false, expected;
      h.db.batch = async statements => {
        // The image-draft store's only three-statement transaction follows its
        // reads. Mutations use the same product clock to test independent CAS.
        if (!raced && statements.length === 3) {
          raced = true;
          if (change === 'content' || change === 'options') {
            const value = change === 'content' ? content(h) : options(h); value.revision++;
            if (change === 'content') value.label.material = { value: '동시 수정 재질', provenance: 'manual', updatedAt: product(h).updated_at };
            else value.rows[0].included = false;
            h.sqlite.prepare(`UPDATE product_${change} SET revision=?,payload=?`).run(value.revision, JSON.stringify(value));
          } else if (change === 'receipt') { const value = receipt(h); value.images.reverse(); h.sqlite.prepare('UPDATE collection_results SET payload=?').run(JSON.stringify(value)); }
          else if (change === 'context') { const value = JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_context').get().payload); value.category.categoryPath = ['동시 수정 분류']; h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(value)); }
          else if (change === 'link') h.sqlite.prepare("DELETE FROM collection_products WHERE job_id='job'").run();
          else if (change === 'goal') h.sqlite.prepare("UPDATE collection_jobs SET goal='price'").run();
          else h.sqlite.prepare('DELETE FROM collection_images WHERE image_index=4').run();
          expected = JSON.stringify({ product: product(h), content: content(h), options: options(h) });
        }
        return originalBatch(statements);
      };
      assert.equal((await imageDraft(h)).status, 409, change);
      assert.equal(raced, true);
      assert.equal(JSON.stringify({ product: product(h), content: content(h), options: options(h) }), expected, change + ' stays untouched after race');
    } finally { h.close(); }
  }
});

test('image draft rejects foreign links and changed product source while detached originals stay excluded', async () => {
  const h = mobileIntakeHarness();
  try {
    await library(h);
    const before = JSON.stringify({ content: content(h), options: options(h) });
    assert.equal((await h.route('/api/collection-jobs/job/image-draft', { method: 'POST', body: { productId: 'other-product' } })).status, 409);
    h.sqlite.prepare("UPDATE collection_jobs SET owner_id='another-owner'").run();
    assert.equal((await imageDraft(h)).status, 409);
    h.sqlite.prepare("UPDATE collection_jobs SET owner_id='owner'").run();
    h.sqlite.prepare("UPDATE products SET source_url='https://detail.1688.com/offer/813724060929.html'").run();
    assert.equal((await imageDraft(h)).status, 409);
    h.sqlite.prepare('UPDATE products SET source_url=?').run(h.sourceUrl);
    assert.equal(JSON.stringify({ content: content(h), options: options(h) }), before);
    const keys = originals(h), source = receipt(h), detached = keys.get(source.options[0].imageIndex);
    h.sqlite.prepare('UPDATE products SET image_keys=?').run(JSON.stringify(JSON.parse(product(h).image_keys).filter(key => key !== detached)));
    await json(await imageDraft(h));
    assert.ok(!Object.values(content(h).assets).some(field => field.value.includes(detached)));
    assert.ok(options(h).rows.filter(row => source.options.find(item => item.sku === row.supplierSku).imageIndex === source.options[0].imageIndex).every(row => row.imageKey === null));
    assert.ok(!JSON.parse(product(h).image_keys).includes(detached));
  } finally { h.close(); }
});

test('larger source image drafts keep one representative and the first thirty additional originals without losing the library', async () => {
  const h = mobileIntakeHarness();
  try {
    await library(h);
    const source = receipt(h), existing = originals(h), imageKeys = JSON.parse(product(h).image_keys);
    // Synthetic extra source entries test the editor's per-role limit. The
    // recorded supplier receipt itself has only nineteen images.
    const needed = 31 - source.images.filter(image => image.role === 'additional').length;
    for (let index = 0; index < needed; index++) {
      const imageIndex = source.images.length, key = `owner/extra-${index}.png`;
      source.images.push({ role: 'additional', url: `https://cbu01.alicdn.com/fixture-${index}.png` }); imageKeys.push(key); existing.set(imageIndex, key);
      h.sqlite.prepare('INSERT INTO collection_images VALUES(?,?,?,?,?,?,?)').run('job', imageIndex, 'owner', product(h).id, key, 'fixture-' + index, product(h).updated_at);
    }
    assert.ok(imageKeys.length <= 50);
    h.sqlite.prepare('UPDATE collection_results SET payload=?').run(JSON.stringify(source));
    h.sqlite.prepare('UPDATE products SET image_keys=?').run(JSON.stringify(imageKeys));
    await json(await imageDraft(h));
    assert.equal(content(h).assets.main.value.length, 1);
    const expected = source.images.flatMap((image, index) => image.role === 'additional' ? [existing.get(index)] : []).slice(0, 30);
    assert.deepEqual(content(h).assets.additional.value, expected);
    assert.deepEqual(JSON.parse(product(h).image_keys), imageKeys);
  } finally { h.close(); }
});

test('failed companion image-draft write rolls back every change and exact retry succeeds', async () => {
  const h = mobileIntakeHarness();
  try {
    await library(h);
    const before = JSON.stringify({ product: product(h), content: content(h), options: options(h) });
    h.sqlite.exec("CREATE TRIGGER fail_image_draft BEFORE UPDATE ON product_options BEGIN SELECT RAISE(ABORT,'fixture options storage failure'); END");
    assert.equal((await imageDraft(h)).status, 503);
    assert.equal(JSON.stringify({ product: product(h), content: content(h), options: options(h) }), before);
    h.sqlite.exec('DROP TRIGGER fail_image_draft');
    const result = await json(await imageDraft(h));
    assert.equal(result.changedRoles, 3); assert.equal(result.changedOptions, 6);
    assert.equal(h.stats.downloads, 19);
  } finally { h.close(); }
});
