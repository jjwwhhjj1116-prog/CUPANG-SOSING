import test from 'node:test';
import assert from 'node:assert/strict';
import { companies, json } from './helpers/image-download-ui.mjs';
import { detailSaveFixture, detailSaveState } from './helpers/detail-save-fixture.mjs';

const policy = 'couplus-detail-alt-v1';
const plain = value => JSON.parse(JSON.stringify(value));
const realIds = view => view.resolved.rows.flatMap(row => row.optionId === null ? [] : [row.optionId]);
const layer = (view, id) => id === null ? view.overrides.common : view.overrides.options[id];
const altTargets = view => {
  const fields = view.resolved.schema.fields;
  const exact = fields.filter(field => !field.hubWire?.name && JSON.stringify(field.hubWire?.path) === JSON.stringify(['imagePage', 'details', 'altText']));
  assert.equal(exact.length, 1, 'the real category has one exact primary ALT path');
  assert.equal(exact[0].hubInput, 'altText');
  return { primary: exact[0].id, linked: [...new Set(['altText', exact[0].id])] };
};
const expectedAlt = (base, rawName) => rawName ? `${base} - ${rawName}` : base;

async function configure(f, { common = '', description = 'SEO에서 저장한 상세 설명', productName = ' 原始中文商品名 ', seoTitle = '최종 저장한 한국어 SEO 제목', commonAbsent = false } = {}) {
  const current = await json(await f.api.route(f.base + '/content'));
  await json(await f.api.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: current.content.revision,
    patch: { seo: { title: seoTitle || '임시 제목', description: description || '임시 설명' } } } }));
  // Simulate supported saved/legacy raw data. Public option/content editors trim
  // text; the vendor's detail action must still use stored truthiness verbatim.
  const contentRow = f.api.sqlite.prepare('SELECT payload FROM product_content').get(), content = JSON.parse(contentRow.payload);
  content.seo.description.value = description;
  content.seo.title.value = seoTitle;
  f.api.sqlite.prepare('UPDATE product_content SET payload=?').run(JSON.stringify(content));
  f.api.sqlite.prepare('UPDATE products SET title=?').run(productName);
  const saved = JSON.parse(f.api.sqlite.prepare('SELECT payload FROM product_options').get().payload);
  const names = ['한글 옵션', '', '  여백 있는 옵션  ', '   ', '🧺', '0'];
  saved.rows.forEach((row, index) => { row.translatedName = names[index]; row.originalName = `원문 대체 금지 ${index}`; row.supplierSku = `SKU-FALLBACK-${index}`; });
  f.api.sqlite.prepare('UPDATE product_options SET payload=?').run(JSON.stringify(saved));
  await f.refresh();
  const targets = altTargets(f.view), ids = realIds(f.view);
  const changes = [
    ...(!commonAbsent ? targets.linked.map(fieldKey => ({ optionId: null, fieldKey, value: common })) : []),
    ...targets.linked.map(fieldKey => ({ optionId: ids[0], fieldKey, value: '' })),
    ...targets.linked.map(fieldKey => ({ optionId: ids[2], fieldKey, value: '옵션이 직접 작성한 이전 ALT' })),
    { optionId: null, fieldKey: 'title', value: '공통 견적서 제목도 ALT의 상품명이 아님' },
    { optionId: ids[0], fieldKey: 'title', value: '옵션별 견적서 제목도 ALT의 상품명이 아님' },
  ];
  f.view = await json(await f.api.route(f.qurl, { method: 'PUT', body: { expectedRevision: f.view.revision,
    expectedInputFingerprint: f.view.inputFingerprint, changes } }));
  const expectedNames = Object.fromEntries(saved.rows.map((row, index) => [row.id, names[index]]));
  const finalProductName = seoTitle || productName;
  assert.deepEqual(f.view.detailSaveTextBasis, { policy, productName: finalProductName, metaDescription: description, optionNames: expectedNames });
  return { targets, ids, names: expectedNames, base: description || `${finalProductName} 상세 설명`, common };
}

async function save(f, textPolicy = policy) {
  const prepared = await f.prepare(), body = await f.upload(prepared);
  if (textPolicy !== undefined) body.textPolicy = textPolicy;
  const response = await f.post(body);
  assert.equal(response.status, 200, await response.clone().text());
  return { prepared, body, result: await response.json() };
}

for (const company of companies) test(`detail save applies literal raw ALT naming to all options, exact primary XLSX and retained backup (${company.companyCode})`, async () => {
  const f = await detailSaveFixture(company);
  try {
    const expected = await configure(f), before = plain(f.view), sources = f.sourceRows();
    const { prepared, body, result } = await save(f), after = result.quotation;
    assert.equal(result.receipt.textPolicy, policy); assert.equal(result.receipt.textCommonFilled, true);
    assert.equal(after.revision, before.revision + 1); assert.equal(f.sourceRows(), sources, 'SEO, options, source HTML/images and category proof remain unchanged');
    assert.equal(after.resolved.rows.find(row => row.optionId === expected.ids[1]).included, false);
    for (const id of [null, ...expected.ids]) for (const field of expected.targets.linked) {
      const value = id === null ? expected.base : expectedAlt(expected.base, expected.names[id]);
      assert.equal(layer(after, id)[field], value);
      assert.equal(after.resolved.rows.find(row => row.optionId === id).fields[field].value, value);
    }
    assert.equal(layer(after, expected.ids[1])[expected.targets.primary], expected.base, 'empty translated name never falls back to source name or SKU');
    const history = detailSaveState(f).detailSaveBackups['category:80719'];
    assert.equal(history.length, 1); const backup = history[0].before;
    assert.equal(backup.find(row => row.optionId === expected.ids[0] && row.fieldKey === 'altText').value, '');
    assert.equal(backup.find(row => row.optionId === expected.ids[1] && row.fieldKey === 'altText').value, null);
    assert.equal(backup.find(row => row.optionId === expected.ids[2] && row.fieldKey === 'altText').value, '옵션이 직접 작성한 이전 ALT');
    assert.equal(backup.find(row => row.optionId === null && row.fieldKey === 'altText').value, '');
    assert.ok(backup.some(row => row.value === '<p>옵션별 수동 HTML &amp; 백업</p>'));
    const snapshot = f.full(), batches = f.api.db.batch; let writes = 0;
    f.api.db.batch = async statements => { if (f.isDetailBatch(statements)) writes++; return batches(statements); };
    assert.deepEqual(await json(await f.post(body)), result); assert.equal(writes, 0); assert.equal(f.full(), snapshot);
    assert.deepEqual((await json(await f.recover(body.uploadId))).receipt, result.receipt); assert.equal(f.full(), snapshot);
    assert.equal((await f.post(Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'textPolicy')))).status, 409, 'a new-policy receipt cannot acknowledge a legacy command');
    assert.equal(f.full(), snapshot);
    const exported = await f.exportQuote(), reader = f.api.load('app/xlsx-template.ts');
    const uploadPlan = JSON.parse(new TextDecoder().decode(exported.archive.get('supplier-hub-upload-plan.json')));
    const sheet = reader.inspectXlsxArchive(await reader.readXlsxArchive(exported.archive.get(uploadPlan.quotation.file.filename)));
    const headers = reader.xlsxHeaders(sheet, '견적서', 1);
    assert.equal(exported.document.rows.length, expected.ids.length - 1);
    for (const [index, row] of exported.document.rows.entries()) {
      const cells = reader.xlsxHeaders(sheet, '견적서', index + 2), value = expectedAlt(expected.base, expected.names[row.optionId]);
      assert.equal(row.fields[expected.targets.primary].value, value);
      assert.equal(cells[headers.indexOf(expected.targets.primary)], value);
      assert.equal(cells[headers.indexOf(f.targets.detailHtml.primary)], '');
      assert.equal(cells[headers.indexOf(f.targets.detailImages.primary)], exported.document.uploadFilenames[result.receipt.key]);
    }
    const filename = exported.document.uploadFilenames[result.receipt.key];
    assert.deepEqual(Buffer.from(exported.archive.get('assets/' + filename)), Buffer.from(await prepared.output.arrayBuffer()));
    const archived = JSON.parse(new TextDecoder().decode(exported.archive.get('quotation-saved-scopes.json')));
    assert.deepEqual(archived.saved.detailSaveBackups['category:80719'][0], history[0]);
  } finally { f.api.close(); }
});

for (const company of companies) test(`truthy common ALT including whitespace is preserved while options use SEO description (${company.companyCode})`, async () => {
  for (const common of ['직접 작성한 공통 ALT', '   ']) {
    const f = await detailSaveFixture(company);
    try {
      const expected = await configure(f, { common }), before = plain(f.view.overrides.common);
      const { result } = await save(f);
      assert.equal(result.receipt.textCommonFilled, false);
      for (const field of expected.targets.linked) assert.equal(result.quotation.overrides.common[field], before[field]);
      for (const id of expected.ids) assert.equal(layer(result.quotation, id)[expected.targets.primary], expectedAlt(expected.base, expected.names[id]));
      assert.ok(!detailSaveState(f).detailSaveBackups['category:80719'][0].before.some(row => row.optionId === null && expected.targets.linked.includes(row.fieldKey)));
      assert.equal((await json(await f.recover(result.receipt.uploadId))).applied, true);
    } finally { f.api.close(); }
  }
});

for (const company of companies) test(`empty description uses saved final SEO title, source title only without SEO, and keeps common manual ALT (${company.companyCode})`, async () => {
  for (const description of ['', '   ']) for (const seoTitle of ['최종 저장한 한국어 SEO 제목', '']) {
    const f = await detailSaveFixture(company);
    try {
      const expected = await configure(f, { description, seoTitle, productName: '  原始中文商品名  ', common: '직접 작성한 공통 한국어 ALT' });
      const { result } = await save(f);
      assert.equal(result.quotation.overrides.common[expected.targets.primary], '직접 작성한 공통 한국어 ALT');
      for (const id of expected.ids) assert.equal(layer(result.quotation, id)[expected.targets.primary], expectedAlt(expected.base, expected.names[id]));
      if (!description) assert.equal(expected.base, `${seoTitle || '  原始中文商品名  '} 상세 설명`);
      if (!description && seoTitle) assert.ok(!expected.base.includes('原始中文'));
      assert.ok(!expected.base.includes('견적서 제목'));
    } finally { f.api.close(); }
  }
});

for (const company of companies) test(`legacy six-field detail save leaves every ALT layer unchanged and cannot masquerade as the new policy (${company.companyCode})`, async () => {
  const f = await detailSaveFixture(company);
  try {
    const expected = await configure(f), before = plain(f.view), prepared = await f.prepare(), body = await f.upload(prepared);
    assert.equal(Object.keys(body).length, 6);
    const result = await json(await f.post(body));
    assert.equal(Object.hasOwn(result.receipt, 'textPolicy'), false); assert.equal(Object.hasOwn(result.receipt, 'textCommonFilled'), false);
    for (const id of [null, ...expected.ids]) for (const field of expected.targets.linked) {
      assert.equal(layer(result.quotation, id)?.[field], layer(before, id)?.[field]);
      assert.equal(result.quotation.resolved.rows.find(row => row.optionId === id).fields[field].value, before.resolved.rows.find(row => row.optionId === id).fields[field].value);
    }
    assert.ok(!detailSaveState(f).detailSaveBackups['category:80719'][0].before.some(row => expected.targets.linked.includes(row.fieldKey)));
    const state = f.full(); assert.equal((await f.post({ ...body, textPolicy: policy })).status, 409); assert.equal(f.full(), state);
    assert.deepEqual(await json(await f.post(body)), result);
  } finally { f.api.close(); }
});

test('absent manual common ALT uses resolved automatic truthiness and records null only when it is filled', async () => {
  for (const automatic of ['이미 저장한 자동 공통 ALT', '']) {
    const f = await detailSaveFixture(companies[0]);
    try {
      const expected = await configure(f, { commonAbsent: true });
      const content = JSON.parse(f.api.sqlite.prepare('SELECT payload FROM product_content').get().payload);
      content.detail.altText.value = automatic;
      f.api.sqlite.prepare('UPDATE product_content SET payload=?').run(JSON.stringify(content));
      await f.refresh();
      assert.equal(Object.hasOwn(f.view.overrides.common, expected.targets.primary), false);
      assert.equal(f.view.resolved.rows.find(row => row.optionId === null).fields[expected.targets.primary].value, automatic);
      const { result } = await save(f), backup = detailSaveState(f).detailSaveBackups['category:80719'][0].before;
      assert.equal(result.receipt.textCommonFilled, !automatic);
      if (automatic) {
        for (const field of expected.targets.linked) assert.equal(Object.hasOwn(result.quotation.overrides.common, field), false);
        assert.ok(!backup.some(row => row.optionId === null && expected.targets.linked.includes(row.fieldKey)));
      } else {
        for (const field of expected.targets.linked) {
          assert.equal(result.quotation.overrides.common[field], expected.base);
          assert.equal(backup.find(row => row.optionId === null && row.fieldKey === field).value, null);
        }
      }
    } finally { f.api.close(); }
  }
});

for (const company of companies) test(`saved SEO, raw option-name and same-revision manual ALT races reject the entire new-policy transaction (${company.companyCode})`, async () => {
  for (const race of ['content', 'options', 'quote']) {
    const f = await detailSaveFixture(company);
    try {
      await configure(f); const prepared = await f.prepare(), body = { ...await f.upload(prepared), textPolicy: policy };
      const batch = f.api.db.batch; let raced = false, competing;
      f.api.db.batch = async statements => {
        if (!raced && f.isDetailBatch(statements)) {
          raced = true;
          if (race === 'quote') {
            const value = detailSaveState(f); value.categoryOverrides['category:80719'].common.altText = '동일 revision에서 경쟁 저장한 ALT';
            f.api.sqlite.prepare('UPDATE product_quotation_fields SET payload=?').run(JSON.stringify(value));
          } else {
            const table = race === 'content' ? 'product_content' : 'product_options';
            const value = JSON.parse(f.api.sqlite.prepare('SELECT payload FROM ' + table).get().payload);
            if (race === 'content') value.seo.description.value = '경쟁 SEO 설명'; else value.rows[0].translatedName = '경쟁 옵션 원문';
            value.revision++; f.api.sqlite.prepare('UPDATE ' + table + ' SET revision=?,payload=?').run(value.revision, JSON.stringify(value));
          }
          competing = f.full();
        }
        return batch(statements);
      };
      assert.equal((await f.post(body)).status, 409, race); assert.equal(raced, true); assert.equal(f.full(), competing);
      assert.equal(detailSaveState(f).detailSaveBackups, undefined);
    } finally { f.api.close(); }
  }
});

test('200-option internal detail+HTML+ALT plan covers 1206 exact cells without relaxing the external 1000-cell guard', async () => {
  const f = await detailSaveFixture(companies[0]);
  try {
    await configure(f); const view = plain(f.view), ids = Array.from({ length: 200 }, (_, i) => `boundary-${i}`);
    const template = view.resolved.rows.find(row => row.optionId !== null), common = view.resolved.rows.find(row => row.optionId === null);
    view.resolved.rows = [common, ...ids.map((optionId, i) => ({ ...plain(template), optionId, included: i !== 199 }))];
    view.overrides = { common: { altText: '' }, options: {} };
    view.detailSaveTextBasis.optionNames = Object.fromEntries(ids.map((id, i) => [id, i === 199 ? '  마지막 원문  ' : '']));
    const paths = { detailImages: ['imagePage', 'details', 'detailedImage'], detailHtml: ['imagePage', 'details', 'htmlProductDetailContent'], altText: ['imagePage', 'details', 'altText'] };
    for (const [id, path] of Object.entries(paths)) {
      const canonical = view.resolved.schema.fields.find(field => field.id === id);
      const wire = { ...plain(canonical), id: 'wire_' + id, hubWire: { path }, hubInput: id };
      delete canonical.hubWire; delete canonical.hubInput;
      view.resolved.schema.fields.push(wire);
      for (const row of view.resolved.rows) row.fields[wire.id] = plain(row.fields[id]);
    }
    const snapshot = JSON.stringify(view), key = f.keys[0], plan = f.api.load('app/detail-save-plan.ts').detailSaveChanges(view, key, policy);
    assert.equal(plan.length, 1206); assert.equal(new Set(plan.map(row => JSON.stringify([row.optionId, row.fieldKey]))).size, 1206);
    assert.equal(plan.find(row => row.optionId === ids[199] && row.fieldKey === 'wire_altText').value, `${view.detailSaveTextBasis.metaDescription} -   마지막 원문  `);
    assert.equal(plan.filter(row => row.optionId === null).length, 6); assert.equal(JSON.stringify(view), snapshot);
    assert.throws(() => f.api.load('app/quotation-schema.ts').validateQuotationChanges(plan, { schema: view.resolved.schema, optionIds: ids, ownedImageKeys: view.imageKeys, overrides: view.overrides }), /1,000/);
    // Truthiness belongs to the exact primary path even when a distinct
    // canonical alias disagrees; preserving common means preserving both.
    common.fields.altText.value = '';
    common.fields.wire_altText.value = '주 입력 경로의 기존 ALT';
    view.overrides.common = { altText: '', wire_altText: '주 입력 경로의 기존 ALT' };
    const keepCommon = f.api.load('app/detail-save-plan.ts').detailSaveChanges(view, key, policy);
    assert.equal(keepCommon.length, 1204);
    assert.ok(!keepCommon.some(change => change.optionId === null && ['altText', 'wire_altText'].includes(change.fieldKey)));
    common.fields.altText.value = '별도 canonical ALT'; common.fields.wire_altText.value = '';
    view.overrides.common = { altText: '별도 canonical ALT', wire_altText: '' };
    const fillCommon = f.api.load('app/detail-save-plan.ts').detailSaveChanges(view, key, policy);
    assert.equal(fillCommon.length, 1206);
    assert.deepEqual(plain(fillCommon.filter(change => change.optionId === null && ['altText', 'wire_altText'].includes(change.fieldKey)).map(change => change.value)),
      [view.detailSaveTextBasis.metaDescription, view.detailSaveTextBasis.metaDescription]);
  } finally { f.api.close(); }
});
