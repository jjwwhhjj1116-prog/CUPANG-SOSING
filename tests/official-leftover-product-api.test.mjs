import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { schemaCompanies, schemaPath, hubSchemaSnapshot } from './helpers/hub-schema.mjs';
import { workbookArchive } from './helpers/quotation-workbook.mjs';
import { submissionPackageUI } from './helpers/submission-package-ui.mjs';

const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const product = h => h.sqlite.prepare('SELECT * FROM products').get();
const retained = h => JSON.stringify(['products', 'product_content', 'product_options', 'product_quotation_fields', 'product_price_policy', 'category_profiles',
  'collection_context', 'collection_results', 'collection_products', 'collection_images'].map(table => [table, h.sqlite.prepare('SELECT * FROM ' + table).all()]));

// Synthetic official-layout bytes and recorded intake facts, with actual API
// handlers, SQLite and an in-memory R2. No seller file or Hub request is used.
async function fixture(company, leftover) {
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name });
  try {
    const snapshot = { ...hubSchemaSnapshot(company), metadata: { displayCategoryCode: '991234', kanCategoryId: 3000,
      scopeType: 'Retail_Categorized_Single', noticeNumber: 17, version: 189 } };
    const headers = ['상품명', '카테고리', '공급가', ...Array.from({ length: 17 }, (_, index) => '선택 시험 ' + index)];
    const category = schemaPath.join('>') + ' (991234)', sheetName = 'QF_3000_시험';
    const row = (number, values) => `<row r="${number}">${values.map((value, index) => `<c r="${String.fromCharCode(65 + index)}${number}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`;
    const bytes = workbookArchive([
      ['[Content_Types].xml', '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
      ['_rels/.rels', '<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', `<workbook xmlns:r="relationship"><sheets><sheet name="${sheetName}" r:id="one"/></sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="shared" Type="x/sharedStrings" Target="sharedStrings.xml"/></Relationships>'],
      ['xl/sharedStrings.xml', '<sst><si><r><t>원본 이전</t></r><r><t> 상품명</t></r></si></sst>'],
      ['xl/worksheets/sheet1.xml', `<worksheet><sheetData>${row(1, ['', 'Retail_Categorized_Excel:Kan:3000:Notice17:Version190'])}${row(5, headers)}${row(6, headers.map((_, index) => index < 3 ? '필수' : '선택'))}${row(7, headers.map(() => '작성 안내'))}${row(8, headers.map((_, index) => index === 1 ? category : '예시'))}${row(9, headers.map(() => ''))}${leftover.xml}</sheetData><dataValidations><dataValidation type="list" sqref="B9:B1008"><formula1>"${category}"</formula1></dataValidation></dataValidations></worksheet>`],
    ]);
    const form = new FormData(); form.set('file', new File([bytes], 'synthetic-official.xlsx')); form.set('schema', JSON.stringify(snapshot)); form.set('action', 'workbook');
    const connected = await json(await h.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test/api/category-profiles/official-template', { method: 'POST', body: form })), 201);
    assert.deepEqual([...h.objects.get(connected.template.storageKey)], [...new Uint8Array(bytes)]);
    const saved = await json(await h.load('app/api/category-profiles/route.ts').POST(new Request('https://app.test/api/category-profiles', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '격리 잔여상품행 API 회귀', categoryId: snapshot.categoryId,
        categoryPath: snapshot.categoryPath, hubSchema: snapshot, template: connected.template, mappings: connected.mappings }) })), 201);
    h.context.category = saved.profile;
    h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context), 'job');
    h.sqlite.prepare("UPDATE collection_jobs SET goal='collect' WHERE id='job'").run();
    await h.intake();
    const base = '/api/products/' + product(h).id, options = await json(await h.route(base + '/options'));
    const rows = h.load('app/product-options.ts').optionInputs(options.options); rows.forEach((row, index) => { row.included = index === 0; });
    await json(await h.route(base + '/options', { method: 'PATCH', body: { expectedRevision: options.options.revision, expectedProductVersion: options.productVersion, rows } }));
    await json(await h.route(base + '/quotation-fields'));
    return { h, base, profile: saved.profile, bytes };
  } catch (error) { h.close(); throw error; }
}

for (const company of schemaCompanies) for (const leftover of [
  { name: 'shared-string previous product', row: 20, xml: '<row r="20"><c r="A20" t="s"><v>0</v></c></row>' },
  { name: 'uncached title formula beyond the preview range', row: 1008, xml: '<row r="1008"><c r="A1008" t="str"><f>"원본 이전 상품명"</f></c></row>' },
]) test(`quotation API rejects ${leftover.name} before package or Hub handoff (${company.code})`, async () => {
  const f = await fixture(company, leftover), { h } = f;
  try {
    const before = retained(h), files = new Map([...h.objects].map(([key, bytes]) => [key, [...bytes]]));
    const identity = await json(await h.route(f.base + '/quotation', { method: 'POST', body: { action: 'source', profileId: f.profile.id } }));
    assert.equal(identity.report.rowCount, 1); assert.equal(identity.report.submissionReady, false); assert.deepEqual(identity.report.company, company);
    for (const action of ['preview', 'export', 'download']) {
      const response = await h.route(f.base + '/quotation', { method: 'POST', body: { action, profileId: f.profile.id,
        ...(action === 'preview' ? {} : { fingerprint: identity.fingerprint }) } });
      assert.equal(response.status, 400, await response.clone().text());
      assert.match(response.headers.get('content-type'), /application\/json/);
      assert.equal(response.headers.get('content-disposition'), null);
      const body = await response.json(); assert.deepEqual(Object.keys(body), ['error']);
      assert.match(body.error, new RegExp(`A${leftover.row}.*출력 범위 밖.*상품`));
    }
    const ui = submissionPackageUI({ route: h.route, productId: product(h).id, profileId: f.profile.id, categoryId: f.profile.categoryId, requestTimeoutMs: 30000 });
    await ui.click('견적서 + 첨부 파일 준비');
    assert.match(ui.alerts().join(' '), new RegExp(`A${leftover.row}.*출력 범위 밖.*상품`));
    assert.equal(ui.button('등록 전송'), undefined); assert.equal(ui.button('확장에 첨부 파일 준비'), undefined);
    assert.deepEqual(ui.calls.map(call => call.action), ['preview'], 'no ZIP retrieval or extension transport can begin after rejection');
    assert.equal(retained(h), before); assert.deepEqual(new Map([...h.objects].map(([key, bytes]) => [key, [...bytes]])), files);
    assert.deepEqual([...h.objects.get(f.profile.template.storageKey)], [...new Uint8Array(f.bytes)]);
    assert.equal(h.aiSources.length, 0); assert.ok(!h.network.includes('supplier.coupang.com'));
    assert.equal(product(h).supplier_hub_status, '미전송');
  } finally { h.close(); }
});
