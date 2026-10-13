import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { deflateSync } from 'node:zlib';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';
import { readPackageZip } from '../extensions/supplier-hub/package.mjs';

function syntheticPng(h, width, height) {
  const crc32 = h.load('app/exports/zip.ts').crc32;
  const chunk = (name, data) => {
    const type = Buffer.from(name), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([length, type, data, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(height * (width * 4 + 1)))), chunk('IEND', Buffer.alloc(0))]);
}
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
function strictImageAdapter(h) {
  const exports = {}, file = 'app/automation/image-edit.ts';
  const code = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  // The intake harness models server pages and lacks the browser-compatible
  // base64 primitive. The strict adapter receives it without relaxing checks.
  vm.runInNewContext(code, { exports, crypto, TextEncoder, TextDecoder, structuredClone, URL, Response, AbortSignal, Blob, FormData, atob,
    require: name => h.load(name.slice(2) + '.ts'), fetch: () => { throw Error('Unexpected real image request'); } });
  return exports.executeImageEdit;
}

for (const company of [{ companyCode: 'A01526306', companyName: '유앤채' }, { companyCode: 'A01464742', companyName: '와이홉' }]) {
  test(`reviewed generated PNG retains format/dimension proof through real role adoption and XLSX (${company.companyCode})`, async () => {
    const h = mobileIntakeHarness(company);
    try {
      const readObject = h.bindings.FILES.get;
      h.bindings.FILES.get = async key => { const object = await readObject(key); return object ? { ...object, body: new Response(await object.arrayBuffer()).body } : null; };
      const fields = ['categoryId', 'mainImage', 'additionalImages', 'detailImages'], workbook = quotationWorkbook(fields);
      const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', workbook)).toString('hex');
      const storageKey = h.load('db/category-templates.ts').templateKey('owner', sha256, 'xlsx'); h.objects.set(storageKey, workbook);
      const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', {
        name: 'SYNTHETIC generated-image metadata test', categoryId: '80719', categoryPath: h.context.category.categoryPath,
        template: { name: 'synthetic-generated-image.xlsx', format: 'xlsx', sha256, storageKey, sheetName: '견적서', headerRow: 1, headers: fields },
        mappings: fields.map((field, column) => ({ field, column, required: false })),
      }, 'cat');
      h.context.category = profile;
      h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context), 'job');
      h.sqlite.prepare("UPDATE collection_jobs SET goal='work' WHERE id='job'").run(); await h.intake();
      const product = () => h.sqlite.prepare('SELECT * FROM products').get(), base = '/api/products/' + product().id;
      let content = (await json(await h.route(base + '/content'))).content;
      const optionsBefore = (await json(await h.route(base + '/options'))).options;
      const sourceKey = optionsBefore.rows.find(row => row.imageKey).imageKey;
      const original = syntheticPng(h, 2, 2), output = syntheticPng(h, 1024, 1024);
      // Only blank local pixels replace this synthetic fixture source, never seller media.
      await h.bindings.FILES.put(sourceKey, original, { httpMetadata: { contentType: 'image/png' }, customMetadata: { imageValidation: 'header-v1', dimensionValidation: 'header-v1', imageWidth: '2', imageHeight: '2' } });
      const fixtureAssets = Object.fromEntries(Object.entries(content.assets).map(([role, field]) => [role, role === 'main' ? [sourceKey] : field.value.filter(key => key !== sourceKey)]));
      content = (await json(await h.route(base + '/content', {
        method: 'PATCH', body: { expectedRevision: content.revision, patch: { assets: fixtureAssets } },
      }))).content;
      const assetsBefore = structuredClone(content.assets), immutableBefore = { raw: h.sqlite.prepare('SELECT payload FROM collection_results').get().payload, settings: h.sqlite.prepare('SELECT payload FROM collection_context').get().payload };
      Object.assign(h.bindings, { OPENAI_API_KEY: 'TEST-ONLY-NOT-A-REAL-KEY', SOURCEFLOW_IMAGE_MODEL: 'gpt-image-1.5' });
      const model = h.load('app/automation/image-edit.ts'), actualExecute = strictImageAdapter(h);
      let providerCalls = 0;
      model.executeImageEdit = (review, config, bytes) => actualExecute(review, config, bytes, async (url, request) => {
        providerCalls++; assert.equal(url, 'https://api.openai.com/v1/images/edits'); assert.equal(request.redirect, 'manual');
        assert.equal(request.body.get('n'), '1'); assert.equal(request.body.get('image').type, 'image/png');
        assert.deepEqual(Buffer.from(await request.body.get('image').arrayBuffer()), original);
        return Response.json({ data: [{ b64_json: output.toString('base64') }], output_format: 'png', size: '1024x1024', quality: 'low' });
      });
      const prepared = await json(await h.route(base + '/image-generation', { method: 'POST', body: { action: 'prepare', expectedVersion: product().updated_at,
        sourceKey, prompt: 'SYNTHETIC blank image only', purpose: 'thumbnail', size: '1024x1024', quality: 'low', idempotencyKey: 'metadata-' + company.companyCode } }), 201);
      assert.equal(providerCalls, 0);
      const approved = await json(await h.route(base + '/image-generation', { method: 'POST', body: { action: 'approve', jobId: prepared.job.id, reviewFingerprint: prepared.job.review.fingerprint, confirmPaid: true } }));
      assert.equal(approved.job.status, 'approved'); assert.equal(providerCalls, 0);
      const executed = await json(await h.route(base + '/image-generation', { method: 'POST', body: { action: 'execute', jobId: prepared.job.id } }));
      const job = executed.job;
      assert.equal(job.status, 'completed', JSON.stringify(job.error));
      const outputKey = job.result.storageKey;
      assert.equal(job.result.attached, true); assert.equal(providerCalls, 1);
      assert.equal(job.result.width, 1024); assert.equal(job.result.height, 1024);
      const head = await h.bindings.FILES.head(outputKey);
      assert.equal(head.customMetadata.imageValidation, 'header-v1');
      assert.equal(head.customMetadata.dimensionValidation, 'header-v1');
      assert.equal(head.customMetadata.imageWidth, '1024'); assert.equal(head.customMetadata.imageHeight, '1024');
      assert.equal(head.customMetadata.sha256, job.result.sha256); assert.equal(head.customMetadata.imageJobId, job.id);
      assert.equal(head.customMetadata.provenance, 'generated'); assert.equal(head.httpMetadata.contentType, 'image/png');
      assert.deepEqual(Buffer.from(h.objects.get(sourceKey)), original); assert.deepEqual(Buffer.from(h.objects.get(outputKey)), output);
      assert.deepEqual((await json(await h.route(base + '/content'))).content.assets, assetsBefore, 'execution appends a result without changing roles');
      const keys = JSON.parse(product().image_keys), patch = h.load('app/image-role-adoption.ts').generatedImagesRolePatch(content, [job], keys);
      content = (await json(await h.route(base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision, patch, reviewedImageJobIds: [job.id] } }))).content;
      await h.load('app/option-image-adoption.ts').adoptGeneratedOptionImage(product().id, job, keys, (url, init) => h.route(url, { method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(init.body) } : {}) }));
      assert.deepEqual(content.assets.main.value, [outputKey]);
      for (const role of ['additional', 'detailTop', 'detail', 'detailBottom', 'label', 'size']) assert.deepEqual(content.assets[role], assetsBefore[role]);
      const optionAfter = (await json(await h.route(base + '/options'))).options;
      const facts = rows => rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !['imageKey', 'provenance', 'updatedAt'].includes(key))));
      assert.deepEqual(facts(optionAfter.rows), facts(optionsBefore.rows), 'reviewed image adoption preserves option facts and prices');
      const quote = await json(await h.route(base + '/quotation-fields'));
      const checks = await h.load('app/quotation-image-review.ts').inspectQuotationImages(quote.resolved, JSON.parse(product().image_keys), key => h.bindings.FILES.head(key));
      assert.equal(checks.has(outputKey), false, 'strictly checked 1024px representative image needs no missing-proof or pixel warning');
      const detailSelection = { schema: { fields: [{ id: 'detailImages', type: 'images' }] }, rows: [{ included: true, fields: { detailImages: { value: outputKey } } }] };
      const detailChecks = await h.load('app/quotation-image-review.ts').inspectQuotationImages(detailSelection, [outputKey], key => h.bindings.FILES.head(key));
      assert.equal(detailChecks.get(outputKey).kind, 'review');
      assert.match(detailChecks.get(outputKey).message, /1024×1024px.*가로 780px/u, 'real dimension advice remains visible for a detail role');
      const legacyChecks = await h.load('app/quotation-image-review.ts').inspectQuotationImages(detailSelection, [outputKey], async () => ({ ...head, customMetadata: { provenance: 'generated' } }));
      assert.match(legacyChecks.get(outputKey).message, /형식검사 기록/u, 'old records are not silently reclassified as validated');
      const review = h.load('app/submission-review.ts').inspectSubmission(quote.resolved, JSON.parse(product().image_keys), checks);
      assert.equal(review.issues.some(issue => issue.code === 'IMAGE_VERIFICATION' && issue.fieldId === 'mainImage' && issue.message.includes('형식검사 기록')), false);
      const preview = await json(await h.route(base + '/quotation', { method: 'POST', body: { action: 'preview' } }));
      const exported = await h.route(base + '/quotation', { method: 'POST', body: { action: 'export', fingerprint: preview.fingerprint } });
      assert.equal(exported.status, 200, await exported.clone().text());
      const archive = readPackageZip(new Uint8Array(await exported.arrayBuffer())), exportedFields = JSON.parse(new TextDecoder().decode(archive.get('quotation-fields.json')));
      const packagedOutput = exportedFields.assets[outputKey]; assert.ok(packagedOutput);
      assert.deepEqual(Buffer.from(archive.get(packagedOutput)), output);
      const reader = h.load('app/xlsx-template.ts'), sheet = reader.inspectXlsxArchive(await reader.readXlsxArchive(archive.get(preview.filename)));
      for (let index = 0; index < optionAfter.rows.length; index++) {
        const row = optionAfter.rows[index], values = reader.xlsxHeaders(sheet, '견적서', index + 2);
        assert.equal(values[1], exportedFields.uploadFilenames[row.imageKey]);
        if (optionsBefore.rows[index].imageKey === sourceKey) assert.equal(row.imageKey, outputKey);
      }
      assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload, immutableBefore.raw);
      assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context').get().payload, immutableBefore.settings);
      assert.equal(product().supplier_hub_status, '미전송'); assert.equal(h.network.includes('api.openai.com'), false); assert.equal(h.network.includes('supplier.coupang.com'), false);
      fs.writeFileSync(new URL('../outputs/step636-generated-image-validation-' + company.companyCode + '.json', import.meta.url), JSON.stringify({ company: company.companyCode,
        strictValidatedDimensions: { width: job.result.width, height: job.result.height }, storedMetadata: head.customMetadata,
        formatProofRetained: true, dimensionsProofRetained: true, falseMissingProofReview: false, originalBytesPreserved: true, otherRolesPreserved: true,
        mockedProviderCalls: providerCalls, externalProviderCalls: 0, hubSubmission: false, optionRowsExported: optionAfter.rows.length, exactGeneratedBytesExported: true }, null, 2));
    } finally { h.close(); }
  });
}
