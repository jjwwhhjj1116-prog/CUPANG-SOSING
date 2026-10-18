import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';

const companies = [{ code: 'A01464742', name: '와이홉' }, { code: 'A01526306', name: '유앤채' }];
const names = ['품명 및 모델명', '재질', '크기, 중량', '제조자(수입자)', '제조국'];
const exceptionNames = ['출시년월', 'A/S 책임자와 전화번호', '품질보증기준'];
const categoryPath = ['스포츠/레져', '헬스/요가', '헬스기구/용품', '헬스보호대'];
const profileFile = new URL('../outputs/step650-official-81452-profile-after.json', import.meta.url), workbookFile = new URL('../outputs/step650-official-81452-original.xlsx', import.meta.url);
const recordedAvailable = fs.existsSync(profileFile) && fs.existsSync(workbookFile), proof = [];
const sha = value => createHash('sha256').update(value).digest('hex'), plain = value => JSON.parse(JSON.stringify(value));
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const productFacts = product => JSON.stringify(Object.fromEntries(['id', 'owner_id', 'source_url', 'title', 'source_price_cny', 'exchange_rate', 'supply_margin', 'coupang_margin', 'supply_price', 'sale_price', 'msrp', 'options_count', 'supplier_hub_status'].map(key => [key, product[key]])));
const sourceFiles = ['app/initial-legal-notices.ts', 'app/collection-product.ts', 'app/product-content.ts', 'app/quotation-schema.ts', 'app/couplus-quotation-defaults.ts', 'tests/intake-initial-legal-notices.test.mjs'];
const hashes = () => Object.fromEntries(sourceFiles.map(file => [file, fs.existsSync(new URL('../' + file, import.meta.url)) ? sha(fs.readFileSync(new URL('../' + file, import.meta.url))) : 'not-yet-created'])), frozen = hashes();
after(() => {
  assert.deepEqual(hashes(), frozen, 'source changed during this focused run');
  if (proof.length) fs.writeFileSync(new URL('../outputs/step700-notice-api-proof.json', import.meta.url), JSON.stringify({ format: 'initial-legal-notices-api-proof-v1', sourceHashes: frozen,
    recordedWorkbookAvailable: recordedAvailable, ...(recordedAvailable ? { recordedWorkbookSha256: sha(fs.readFileSync(workbookFile)), recordedProfileSha256: sha(fs.readFileSync(profileFile)) } : {}), cases: proof,
    boundary: 'Actual local category/intake/content/options/quotation handlers and SQLite with synthetic two-SKU source facts. Recorded 81452 Single schema/workbook, when present, is reused locally for both fixture companies; otherwise synthetic exact-wire OOXML is used. No real product, account, provider or Hub request.',
    externalRequests: 0, browserActions: 0, productionWrites: 0, supplierHubWrites: 0, approveRequests: 0, executeRequests: 0, applyRequests: 0 }, null, 2) + '\n');
});

function syntheticSchema(company) {
  const named = name => ({ contains: { type: 'object', properties: { noticeItemName: { type: 'string', enum: [name] }, noticeItemValue: { type: 'string' } } } });
  return { format: 'supplier-hub-schema-v1', categoryId: '81452', categoryPath, company, observedAt: Date.now(), inputBindings: 'couplus-paths-v1', settingsInitialization: 'couplus-options-v1', draftInitialization: 'couplus-required-v1',
    metadata: { kanCategoryId: 5562, noticeNumber: 25, scopeType: 'Retail_Categorized_Single', version: 188 }, schemaString: JSON.stringify({ type: 'object', required: ['startPage', 'productPage', 'legalPage'], properties: {
      startPage: { type: 'object', required: ['productName'], properties: { productName: { type: 'string', title: '상품명' } } },
      productPage: { type: 'object', required: ['manufacturer'], properties: { manufacturer: { type: 'string', title: '제조사' } } },
      legalPage: { type: 'object', required: ['notices'], properties: { notices: { type: 'array', allOf: [...names, ...exceptionNames, '세탁방법 및 취급시 주의사항'].map(named) } } },
    } }) };
}

async function fixture(company, { synthetic = false } = {}) {
  const offer = '700000000700', sourceUrl = 'https://detail.1688.com/offer/' + offer + '.html';
  const attrs = [{ name: '材质', value: '尼龙' }, { name: '型号', value: 'TEST-700' }, { name: '产品尺寸', value: '31 × 19 × 7 cm' }, { name: '原产国', value: '韩国' }];
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name, sourceFetcher: async target => {
    assert.equal(String(target), sourceUrl); return new Response('<script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', url: sourceUrl,
      name: '合成测试护具', description: '合成记录说明', additionalProperty: attrs.map(pair => ({ '@type': 'PropertyValue', ...pair })),
      hasVariant: ['黑色', '灰色'].map((name, index) => ({ '@type': 'Product', sku: offer + '-' + index, name, offers: { '@type': 'Offer', price: String(index + 5), priceCurrency: 'CNY',
        eligibleQuantity: { '@type': 'QuantitativeValue', minValue: 1 }, inventoryLevel: { '@type': 'QuantitativeValue', value: 20 + index } } })) }) + '</script>', { headers: { 'content-type': 'text/html;charset=utf-8' } });
  } });
  try {
    const settings = { ...h.settings, brand: company.name, manufacturer: '캡처 제조사', importer: company.name, serviceContact: '캡처 A/S 02-1234-5678', washingMethod: '손세탁', handlingPrecautions: '화기 주의', manufactureDatePreviousMonth: true };
    await json(await h.load('app/api/settings/route.ts').PUT(new Request('https://app.test/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...settings, expectedOwnerId: 'owner' }) })));
    await h.load('db/queries.ts').saveSettings('other-owner', JSON.stringify({ ...settings, brand: '다른 회사 보존값' }));
    const now = new Date().toISOString(); h.sqlite.prepare('INSERT INTO products(id,owner_id,source_url,title,source_price_cny,exchange_rate,supply_margin,coupang_margin,supply_price,sale_price,msrp,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('other-company-product', 'other-owner', 'https://detail.1688.com/offer/700000000701.html', '다른 회사 상품', 3, 350, 50, 40, 2100, 3500, 4550, now, now);
    let hubSchema = syntheticSchema(company), template = null, mappings = [], original = null;
    if (recordedAvailable && !synthetic) {
      hubSchema = plain(JSON.parse(fs.readFileSync(profileFile, 'utf8')).hubSchema); hubSchema.company = plain(company);
      original = new Uint8Array(fs.readFileSync(workbookFile)); const form = new FormData(); form.set('file', new File([original], 'recorded-81452.xlsx')); form.set('schema', JSON.stringify(hubSchema)); form.set('action', 'workbook');
      const linked = await json(await h.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test/api/category-profiles/official-template', { method: 'POST', body: form })), 201);
      template = linked.template; mappings = linked.mappings;
    }
    const profile = (await json(await h.load('app/api/category-profiles/route.ts').POST(new Request('https://app.test/api/category-profiles', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '초기 고시 격리 시험', categoryId: '81452', categoryPath, hubSchema, template, mappings }) })), 201)).profile;
    h.sqlite.prepare("DELETE FROM collection_context WHERE job_id='job'").run(); h.sqlite.prepare("DELETE FROM collection_jobs WHERE id='job'").run();
    const created = await json(await h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ urls: [sourceUrl], goal: 'collect', profileId: profile.id, expectedProfileRevision: profile.revision, expectedSettings: settings, features: '', keywords: '' }) })));
    const job = created.jobs[0], context = plain(job.context); context.capturedAt = '2024-03-31T14:59:59Z';
    h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(context), job.id);
    const calls = [], fetcher = (path, init = {}) => { calls.push({ path, action: typeof init.body === 'string' ? JSON.parse(init.body).action : null }); return h.route(path, { method: init.method ?? 'GET', body: init.body }); };
    const currentJob = () => h.load('db/collection-jobs.ts').findCollectionJob('owner', job.id);
    const intake = async () => h.load('app/intake-collection.ts').collectIntakeProduct(await currentJob(), { signal: new AbortController().signal, fetcher, onJob() {}, onProgress() {} });
    assert.match(await intake(), /상품 추가 완료/);
    const product = () => h.sqlite.prepare("SELECT * FROM products WHERE owner_id='owner'").get(), base = '/api/products/' + product().id;
    const content = () => h.route(base + '/content').then(response => json(response)).then(body => body.content), view = () => h.route(base + '/quotation-fields').then(response => json(response));
    const immutable = () => JSON.stringify(['collection_results', 'collection_context', 'category_profiles'].map(table => h.sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()));
    const other = () => JSON.stringify([h.sqlite.prepare("SELECT * FROM products WHERE owner_id='other-owner'").all(), h.sqlite.prepare("SELECT * FROM workspace_settings WHERE owner_id='other-owner'").all()]);
    const files = () => JSON.stringify([...h.objects].map(([key, bytes]) => [key, sha(bytes)]));
    return { h, company, settings, profile, hubSchema, original, attrs, product, base, content, view, calls, intake, immutable, other, files,
      async patch(patch) { const current = await content(); return json(await h.route(base + '/content', { method: 'PATCH', body: { expectedRevision: current.revision, patch } })); },
      async save(changes) { const current = await view(); return json(await h.route(base + '/quotation-fields', { method: 'PUT', body: { expectedRevision: current.revision, expectedInputFingerprint: current.inputFingerprint, changes } })); } };
  } catch (error) { h.close(); throw error; }
}

function fields(view) { return Object.fromEntries(view.resolved.schema.fields.filter(field => field.section === 'legal' && field.hubWire?.path.join('.') === 'legalPage.notices' && field.hubWire.name === field.label).map(field => [field.label, field])); }
function values(view, namesToRead = names) { const map = fields(view); return view.resolved.rows.filter(row => row.optionId).map(row => namesToRead.map(name => row.fields[map[name].id].value)); }
async function exportRows(f, labels = names) {
  const { h } = f, reader = h.load('app/xlsx-template.ts'); let bytes, rows, columns, sheet, start;
  if (f.original) {
    const preview = await json(await h.route(f.base + '/quotation', { method: 'POST', body: { action: 'preview', profileId: f.profile.id } }));
    const response = await h.route(f.base + '/quotation', { method: 'POST', body: { action: 'download', profileId: f.profile.id, fingerprint: preview.fingerprint } }); assert.equal(response.status, 200, await response.clone().text());
    bytes = await response.arrayBuffer(); const map = fields(await f.view()); columns = labels.map(name => { const column = f.profile.mappings.find(mapping => mapping.field === map[name].id)?.column; assert.ok(Number.isInteger(column), name); return column; });
    rows = preview.rows.map(row => columns.map(column => row[column])); sheet = f.profile.template.sheetName; start = preview.report.dataStartRow;
  } else {
    const sourceModel = h.load('app/exports/quotation-source.ts'), source = await sourceModel.readQuotationExportSource('owner', f.product().id, f.profile.id), resolved = sourceModel.resolveQuotationExport(source);
    const documentRows = h.load('app/exports/quotation-fields.ts').resolvedQuotationRows(source, resolved, []), map = fields({ resolved }), original = quotationWorkbook(labels);
    const output = await h.load('app/exports/mapped-quotation.ts').createMappedQuotation({ originalBytes: original.buffer, profile: { ...f.profile,
      template: { name: 'synthetic-notices.xlsx', format: 'xlsx', sheetName: '견적서', headerRow: 1, headers: labels, sha256: sha(original) }, mappings: labels.map((name, column) => ({ field: map[name].id, column, required: false })) }, rows: documentRows, dataStartRow: 2 });
    bytes = output.bytes.buffer; rows = plain(output.values); columns = labels.map((_, i) => i); sheet = '견적서'; start = 2;
  }
  const book = reader.inspectXlsxArchive(await reader.readXlsxArchive(bytes)); const cells = rows.map((_, index) => columns.map(column => reader.xlsxHeaders(book, sheet, start + index)[column] ?? ''));
  assert.deepEqual(cells, rows, 'actual serialized XLSX cells must equal API/export rows'); return { rows, cells, dataStartRow: start, bytesSha256: sha(new Uint8Array(bytes)) };
}

for (const company of companies) test(`new intake freezes only initial legal notices and stage-seven edits reach exact XLSX cells (${company.code})`, async () => {
  const f = await fixture(company), { h } = f;
  try {
    let content = await f.content(), view = await f.view(); const map = fields(view), initial = Array(5).fill('해당사항없음');
    assert.deepEqual(values(view), [initial, initial]); assert.equal(content.initialLegalNotices.format, 'couplus-initial-legal-notices-v1'); assert.equal(content.initialLegalNotices.categoryId, '81452');
    assert.deepEqual(content.initialLegalNotices.categoryPath, categoryPath); const snapshot = plain(content.initialLegalNotices);
    assert.equal(content.label.material.value, '尼龙'); assert.equal(content.label.dimensions.value, '31 × 19 × 7 cm'); assert.equal(content.label.countryOfOrigin.value, '韩国');
    assert.equal(content.label.model.value, 'TEST-700'); assert.equal(content.label.manufacturer.value, '캡처 제조사'); assert.equal(content.label.importer.value, company.name);
    assert.equal(content.label.productName.value, '合成测试护具'); assert.equal(content.label.productName.provenance, 'generated');
    assert.equal(content.label.releaseDate.value, '2024.02', 'the earlier stage-six captured-time contract is retained');
    const prior = new Date(Date.parse(f.product().created_at) + 9 * 60 * 60 * 1000); prior.setUTCDate(1); prior.setUTCMonth(prior.getUTCMonth() - 1);
    const initialMonth = prior.toISOString().slice(0, 7).replace('-', '.');
    const receipt = JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload); assert.deepEqual(receipt.attributes, f.attrs);
    assert.deepEqual(values(view, exceptionNames), Array.from({ length: 2 }, () => [initialMonth, f.settings.serviceContact, '해당사항없음']));
    const manufacturer = view.resolved.schema.fields.find(field => field.hubWire?.path.join('.') === 'productPage.manufacturer'); assert.ok(manufacturer);
    assert.ok(view.resolved.rows.every(row => row.fields[manufacturer.id].value === '캡처 제조사'), 'product manufacturer keeps its normal captured setting');
    const immutable = f.immutable(), other = f.other(), files = f.files(), facts = productFacts(f.product()), optionBefore = h.sqlite.prepare('SELECT payload FROM product_options').get().payload;
    const initialOutput = await exportRows(f); assert.deepEqual(initialOutput.cells, [initial, initial]);
    await h.load('db/queries.ts').saveSettings('owner', JSON.stringify({ ...f.settings, manufacturer: '이후 설정 제조사', importer: '이후 설정 수입자', serviceContact: '이후 연락처', manufactureDatePreviousMonth: false }));
    await f.patch({ seo: { title: '직접 저장한 SEO 이름', description: '직접 저장한 한국어 설명' }, detail: { description: '독립 상세 본문' } });
    assert.deepEqual(values(await f.view()), [initial, initial]); assert.deepEqual((await f.content()).initialLegalNotices, snapshot);
    content = await f.content(); await f.patch({ label: { productName: content.label.productName.value, material: content.label.material.value, dimensions: content.label.dimensions.value } });
    assert.deepEqual(values(await f.view()), [initial, initial], 'same-value stage-six save does not rewrite the initial legal document');
    await f.patch({ label: { productName: '', material: '', dimensions: '', manufacturer: '', importer: '', countryOfOrigin: '', contact: '' },
      labelClears: ['productName', 'material', 'dimensions', 'manufacturer', 'importer', 'countryOfOrigin', 'contact'] });
    content = await f.content(); assert.equal(content.label.material.value, ''); assert.equal(content.label.material.provenance, 'manual'); assert.deepEqual(content.initialLegalNotices, snapshot);
    view = await f.view(); assert.deepEqual(values(view), [initial, initial]); assert.deepEqual(values(view, exceptionNames), Array.from({ length: 2 }, () => [initialMonth, f.settings.serviceContact, '해당사항없음']));
    const ids = view.resolved.rows.filter(row => row.optionId).map(row => row.optionId), change = (name, value, optionId = null) => ({ fieldKey: map[name].id, value, optionId });
    await f.save([change(names[0], '견적 전용 품명'), change(names[1], ''), change(names[1], '직접 검토 재질', ids[0]), change(names[2], '', ids[1]), change(names[3], '직접 고시 제조자'), change(names[4], '', ids[0])]);
    const expected = [['견적 전용 품명', '직접 검토 재질', '해당사항없음', '직접 고시 제조자', ''], ['견적 전용 품명', '', '', '직접 고시 제조자', '해당사항없음']];
    assert.deepEqual(values(await f.view()), expected); const finalOutput = await exportRows(f); assert.deepEqual(finalOutput.cells, expected);
    await f.save([change(names[1], null, ids[0])]); assert.deepEqual(values(await f.view()).map(row => row[1]), ['', ''], 'removing only the option override exposes the common explicit blank');
    await f.save([change(names[1], null)]); assert.deepEqual(values(await f.view()).map(row => row[1]), ['해당사항없음', '해당사항없음'], 'removing the common override restores the frozen initial document, not stage-six blank');
    assert.equal(h.sqlite.prepare('SELECT payload FROM product_options').get().payload, optionBefore); assert.equal(f.immutable(), immutable); assert.equal(f.other(), other); assert.equal(f.files(), files); assert.equal(productFacts(f.product()), facts);
    assert.equal(f.product().supplier_hub_status, '미전송'); assert.equal(h.sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n, 0); assert.equal(h.aiSources.length, 0);
    assert.equal(f.calls.filter(call => ['approve', 'execute', 'apply'].includes(call.action)).length, 0);
    proof.push({ company, categoryId: '81452', sourceKind: 'synthetic two-SKU supplier receipt', officialWorkbookUsed: !!f.original, firstNoticeRows: initialOutput.cells,
      capturedSettingNoticeRows: values(view, exceptionNames), stageSixSameAndBlankLeaveInitialNotices: true, finalNoticeRows: finalOutput.cells, finalXlsxSha256: finalOutput.bytesSha256,
      immutableBeforeSha256: sha(immutable), immutableAfterSha256: sha(f.immutable()), otherOwnerBeforeSha256: sha(other), otherOwnerAfterSha256: sha(f.other()),
      originalFilesBeforeSha256: sha(files), originalFilesAfterSha256: sha(f.files()), sourceOptionsBeforeSha256: sha(optionBefore), sourceOptionsAfterSha256: sha(h.sqlite.prepare('SELECT payload FROM product_options').get().payload),
      productFactsBeforeSha256: sha(facts), productFactsAfterSha256: sha(productFacts(f.product())) });
  } finally { h.close(); }
});

test('initial policy remains exact to its category and wire, cannot be patched by clients, and absent legacy metadata is never backfilled', async () => {
  const f = await fixture(companies[0], { synthetic: true }), { h } = f;
  try {
    const content = await f.content(), current = await f.view(), snapshot = plain(content.initialLegalNotices), immutable = f.immutable();
    assert.ok(snapshot); assert.deepEqual(values(current), [Array(5).fill('해당사항없음'), Array(5).fill('해당사항없음')]);
    assert.deepEqual(values(current, ['세탁방법 및 취급시 주의사항']), [['세탁방법: 손세탁, 취급시 주의사항: 화기 주의'], ['세탁방법: 손세탁, 취급시 주의사항: 화기 주의']]);
    const before = h.sqlite.prepare('SELECT payload FROM product_content').get().payload;
    await json(await h.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision, patch: { initialLegalNotices: { ...snapshot, fields: [] } } } }), 400);
    assert.equal(h.sqlite.prepare('SELECT payload FROM product_content').get().payload, before);
    const source = h.load('app/exports/quotation-source.ts'), saved = await source.readQuotationExportSource('owner', f.product().id, f.profile.id);
    const altered = plain(saved.hubSchema), raw = JSON.parse(altered.schemaString); raw.properties.legalPage.properties.certificates = raw.properties.legalPage.properties.notices; delete raw.properties.legalPage.properties.notices;
    raw.properties.legalPage.required = ['certificates']; altered.schemaString = JSON.stringify(raw);
    const model = h.load('app/quotation-schema.ts'), resolved = model.resolveQuotationFields({ ...saved, categoryId: '81452', categoryPath, hubSchema: altered });
    for (const field of resolved.schema.fields.filter(field => field.hubWire?.path.join('.') === 'legalPage.certificates')) assert.ok(!snapshot.fields.some(entry => entry.fieldId === field.id && entry.signature === JSON.stringify(field)), 'similar labels in another array cannot inherit initial notice identity');
    assert.equal(h.load('app/initial-legal-notices.ts').readInitialLegalNotices(snapshot, resolved.schema).size, 0);
    const changed = plain(saved.hubSchema), changedRaw = JSON.parse(changed.schemaString);
    changedRaw.properties.legalPage.properties.notices.allOf.find(item => item.contains.properties.noticeItemName.enum[0] === '재질').contains.properties.noticeItemValue.maxLength = 100;
    changed.schemaString = JSON.stringify(changedRaw);
    const changedView = { resolved: model.resolveQuotationFields({ ...saved, categoryId: '81452', categoryPath, hubSchema: changed }) };
    assert.deepEqual(plain(values(changedView).map(row => row[1])), ['尼龙', '尼龙'], 'a new exact field signature must use its current source resolver, not the old initial snapshot');
    const moved = plain(saved.hubSchema); moved.categoryPath = ['다른 경로', '동일 표시명'];
    const movedView = { resolved: model.resolveQuotationFields({ ...saved, categoryId: '81452', categoryPath: moved.categoryPath, hubSchema: moved }) };
    assert.deepEqual(plain(values(movedView).map(row => row[1])), ['尼龙', '尼龙'], 'the same category ID with another complete path cannot use the frozen policy');
    const legacy = plain(content); delete legacy.initialLegalNotices; h.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(legacy), f.product().id);
    const legacyBefore = h.sqlite.prepare('SELECT * FROM product_content').get(), view = await f.view();
    assert.deepEqual(values(view), Array.from({ length: 2 }, () => ['合成测试护具 / TEST-700', '尼龙', '31 × 19 × 7 cm', '제조자: 캡처 제조사 / 수입자: 와이홉', '韩国']));
    await f.content(); await f.view(); assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_content').get(), legacyBefore, 'GET cannot migrate an existing document');
    assert.equal(f.immutable(), immutable); assert.equal(h.sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n, 0);
    proof.push({ name: 'exact-wire and legacy boundaries', company: companies[0], clientMetadataInjectionRejected: true, similarArrayCannotMatchFrozenFieldSignature: true,
      legacyMetadataAbsent: true, legacyNoticeRows: values(view), legacyGetWrites: 0 });
  } finally { h.close(); }
});
