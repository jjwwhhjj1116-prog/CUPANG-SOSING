import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { optionPriceTableUI, priceTableCompanies, priceTableNodes as nodes, priceTableText as text } from './helpers/option-price-table-ui.mjs';

const plain = value => JSON.parse(JSON.stringify(value)), sha = value => createHash('sha256').update(value).digest('hex');
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const change = (h, label, value) => h.node(label).props.onChange({ target: { value, valueAsNumber: Number(value) } });
const form = h => nodes(h.render()).find(node => node.type === 'form' && node.props['data-quotation-source-step'] === '가격');
const policyField = (h, label) => nodes(form(h)).find(node => node.type === 'label' && nodes(node).some(child => child.type === 'span' && child.props.children === label)).props.children[1];
const policyChange = (h, label, value) => policyField(h, label).props.onChange({ target: { value } });
const policySave = async h => { await form(h).props.onSubmit({ preventDefault() {} }); await h.settle(); };
const database = h => JSON.stringify(h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, h.sqlite.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all()]));
const originalFile = new URL('../outputs/step603-official-unand-2624.xlsx', import.meta.url), profileFile = new URL('../outputs/step604-unand-profile-read.json', import.meta.url);
const officialAvailable = fs.existsSync(originalFile) && fs.existsSync(profileFile), proof = [];
const files = ['app/components/price-editor.tsx', 'app/components/dashboard-client.tsx', 'app/components/option-price-preview.tsx', 'app/api/products/[id]/pricing/route.ts',
  'app/stage-two-msrp.ts', 'app/policy-quotation-prices.ts', 'db/queries.ts', 'db/quotation-fields.ts', 'tests/helpers/option-price-table-ui.mjs'];
const hashes = () => Object.fromEntries(files.map(file => [file, sha(fs.readFileSync(new URL('../' + file, import.meta.url)))]));
const frozen = hashes();
after(() => {
  assert.deepEqual(hashes(), frozen);
  if (proof.length) fs.writeFileSync(new URL('../outputs/step739-policy-api-proof.json', import.meta.url), JSON.stringify({ format: 'local-policy-recalculation-api-proof-v1', sourceHashes: frozen,
    officialWorkbookAvailable: officialAvailable, cases: proof, externalRequests: 0, browserActions: 0, supplierHubWrites: 0,
    boundary: 'Actual DetailPanel/PriceEditor/ProductOptionsEditor callbacks and API handlers, fixture authentication, isolated SQLite and R2 map. The previously recorded Unand workbook is reused for Waihop locally. No newly obtained workbook or live Supplier Hub operation is claimed.' }, null, 2) + '\n');
});

async function fixture(company = priceTableCompanies[0], { official = false, count = 5 } = {}) {
  const objects = new Map(), metadata = new Map(), storage = {
    head: async key => objects.has(key) ? { size: objects.get(key).byteLength, ...metadata.get(key) } : null,
    put: async (key, bytes, options) => { objects.set(key, new Uint8Array(bytes)); metadata.set(key, options); return {}; },
    get: async key => { const bytes = objects.get(key); return bytes ? { size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer, ...metadata.get(key) } : null; },
  };
  const h = await optionPriceTableUI(company, { count, integrated: true, detail: true, fileStorage: storage }), base = '/api/products/' + h.product.id, owner = h.product.owner_id;
  try {
    let profile, original;
    if (official && officialAvailable) {
      const captured = JSON.parse(JSON.parse(fs.readFileSync(profileFile, 'utf8'))[0].results[0].payload), hubSchema = structuredClone(captured.hubSchema); hubSchema.company = plain(company);
      original = new Uint8Array(fs.readFileSync(originalFile)); const upload = new FormData(); upload.set('file', new File([original], 'original-2624.xlsx')); upload.set('schema', JSON.stringify(hubSchema)); upload.set('action', 'workbook');
      const linked = await json(await h.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test/api/category-profiles/official-template', { method: 'POST', body: upload })), 201);
      profile = await h.load('db/category-profiles.ts').createCategoryProfile(owner, { name: 'LOCAL POLICY 698', categoryId: captured.categoryId, categoryPath: captured.categoryPath, hubSchema, template: linked.template, mappings: linked.mappings }, 'local-698');
    }
    await h.load('db/queries.ts').saveSettings(owner, JSON.stringify({ ...h.load('app/workspace-settings.ts').defaultSettings, ...h.policy, brand: company.name }));
    const quoteUrl = base + '/quotation-fields' + (profile ? '?profileId=' + profile.id : ''), quote = () => h.request(quoteUrl).then(response => json(response));
    const options = () => h.request(base + '/options').then(response => json(response));
    const refresh = async () => { h.changeProductVersion(h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(h.product.id).updated_at); await h.settle(); h.button('저장 가격 다시 조회').props.onClick(); await h.settle(); };
    h.selectProfile(profile?.id); await refresh();
    const paired = (view, input, optionId, value) => h.load('app/quotation-price-targets.ts').quotationPriceTargets(view.resolved.schema.fields)[input].linked.map(fieldKey => ({ fieldKey, optionId, value }));
    const write = async changes => { const view = await quote(); const saved = await json(await h.request(quoteUrl, { method: 'PUT', body: JSON.stringify({ expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes }) })); await refresh(); return saved; };
    const saveGrid = async () => { h.button('옵션 저장·가격 계산').props.onClick(); await h.settle(); assert.equal(nodes(h.render()).filter(node => node.props?.role === 'alert').map(text).join(' '), ''); };
    const state = () => JSON.parse(h.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(h.product.id).payload);
    const writeState = value => h.sqlite.prepare('UPDATE product_quotation_fields SET payload=? WHERE product_id=?').run(JSON.stringify(value), h.product.id);
    const stable = () => JSON.stringify(['collection_jobs', 'collection_results', 'collection_context', 'category_profiles', 'workspace_settings', 'product_content', 'product_options', 'product_registration_numbers', 'product_registration_options']
      .map(table => [table, h.sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()]));
    const objectSnapshot = () => JSON.stringify([...objects].map(([key, bytes]) => [key, sha(bytes)]));
    const workbook = async () => {
      if (!profile) return null;
      const preview = await json(await h.request(base + '/quotation', { method: 'POST', body: JSON.stringify({ action: 'preview', profileId: profile.id }) }));
      const response = await h.request(base + '/quotation', { method: 'POST', body: JSON.stringify({ action: 'download', profileId: profile.id, fingerprint: preview.fingerprint }) });
      assert.equal(response.status, 200, await response.clone().text()); const reader = h.load('app/xlsx-template.ts'), book = reader.inspectXlsxArchive(await reader.readXlsxArchive(await response.arrayBuffer()));
      return { preview, cells: preview.rows.map((_, index) => reader.xlsxHeaders(book, profile.template.sheetName, profile.template.dataStartRow + index)) };
    };
    return { h, company, base, owner, profile, original, quote, options, refresh, paired, write, saveGrid, state, writeState, stable, objectSnapshot, workbook };
  } catch (error) { h.close(); throw error; }
}
const row = (view, id = 'price-001') => view.resolved.rows.find(value => value.optionId === id).fields;
const values = fields => ['supplyPrice', 'salePrice', 'msrp'].map(key => fields[key].value);
const currentScope = (state, categoryId) => categoryId ? state.categoryOverrides['category:' + categoryId] : state.overrides;
// Legacy callers may still save a policy without requesting price replacement.
// Actual Stage2 controls now explicitly request the Couplus recalculation.
async function legacyPolicySave(f,changes){
  const current=await f.options();
  await json(await f.h.request(f.base+'/pricing',{method:'POST',body:JSON.stringify({policy:{...current.pricing.policy,...changes},expectedVersion:current.productVersion,...(f.profile?{profileId:f.profile.id}:{})})}));
  await f.h.reloadProduct();
  await f.refresh();
}

for (const company of priceTableCompanies) test(`legacy API policy save updates derived MSRP; explicit UI recalculation replaces scoped prices through API/Excel (${company.code})`, async () => {
  const f = await fixture(company, { official: true }), { h } = f, other = await optionPriceTableUI(priceTableCompanies.find(value => value.code !== company.code), { count: 1, integrated: true });
  try {
    const source = await f.options(), options = h.load('app/product-options.ts').optionInputs(source.options); options[3].included = false;
    await json(await h.request(f.base + '/options', { method: 'PATCH', body: JSON.stringify({ expectedRevision: source.options.revision, expectedProductVersion: source.productVersion, rows: options }) }));
    let view = await f.quote(); const targets = h.load('app/quotation-price-targets.ts').quotationPriceTargets(view.resolved.schema.fields), osrp = view.resolved.schema.fields.find(field => field.hubWire?.path.join('.') === 'productPage.commonAttributes.osrp');
    await f.write([...f.paired(view, 'msrp', 'price-002', '25000'), ...f.paired(view, 'msrp', 'price-003', ''),
      { fieldKey: 'title', optionId: 'price-002', value: '직접 저장한 제목 보존' }, { fieldKey: 'kcCertificationNumber', optionId: null, value: '' },
      { fieldKey: 'packagedWeightG', optionId: 'price-001', value: '420' }, ...(osrp ? [{ fieldKey: osrp.id, optionId: 'price-001', value: '76500' }] : [])]);
    change(h, '가격 옵션 1 판매가', '9000'); await f.saveGrid(); view = await f.quote(); assert.equal(row(view).msrp.value, '11700');
    const sourceBefore = f.stable(), objectsBefore = f.objectSnapshot(), otherBefore = database(other), sourceOptions = plain((await f.options()).options), numbers = plain((await f.options()).optionRegistrationNumbers);
    await legacyPolicySave(f,{msrpMultiple:1.5}); view = await f.quote();
    assert.equal(row(view).salePrice.value, '9000'); assert.equal(row(view).msrp.value, '13500'); assert.equal(view.stageTwoMsrp['price-001'].value, '13500');
    assert.equal(row(view, 'price-002').msrp.value, '25000'); assert.equal(row(view, 'price-003').msrp.value, ''); assert.equal(h.writes.filter(write => write.kind === 'pricing').at(-1).recalculate, undefined);
    const ordinaryBook = await f.workbook(); if (ordinaryBook) { assert.deepEqual(plain(ordinaryBook.cells[0].slice(29, 32)), ['4050', '9000', '13500']); assert.equal(ordinaryBook.cells[1][31], '25000'); assert.equal(ordinaryBook.cells[2][31], ''); }
    await f.write([...f.paired(view, 'supplyPrice', null, '7000'), ...f.paired(view, 'salePrice', null, '12000'),
      ...f.paired(view, 'supplyPrice', 'price-003', '8000'), ...f.paired(view, 'salePrice', 'price-003', '14000'), ...f.paired(view, 'msrp', 'price-003', '18200'),
      ...f.paired(view, 'supplyPrice', 'price-004', '8100'), ...f.paired(view, 'salePrice', 'price-004', '14100'), ...f.paired(view, 'msrp', 'price-004', '18300')]);
    const retained = f.state(), scope = currentScope(retained, view.categoryContext.categoryId);
    scope.options['retired-option'] = { supplyPrice: '123', salePrice: '456', msrp: '789', title: '이전 옵션 보존' };
    retained.categoryOverrides ??= {}; retained.categoryOverrides['category:991234'] = { common: { supplyPrice: '321', title: '다른 분류 보존' }, options: { 'price-001': { msrp: '654' } } };
    retained.detailSaveBackups = { 'category:991234': [{ receipt: { uploadId: 'a'.repeat(64), key: f.owner + '/images/local-history.png', sha256: 'b'.repeat(64), bytes: 1, revision: 1, beforeRevision: 0, sourceOptionId: 'price-001', categoryId: '991234', optionIds: ['price-001'] }, before: [{ fieldKey: 'title', optionId: 'price-001', value: '이전 상세 제목' }], sources: [], beforeProductVersion: view.productVersion, beforeInputFingerprint: view.inputFingerprint, updatedAt: view.productVersion }] };
    f.writeState(retained); await f.refresh();
    await legacyPolicySave(f,{exchangeRate:400,minimumMargin:5000}); view = await f.quote();
    assert.deepEqual(values(row(view, 'price-003')), ['8000', '14000', '18200'], 'ordinary policy save never clears manual prices');
    assert.equal(row(view, 'price-002').msrp.value, '25000'); assert.equal(view.stageTwoMsrp['price-001'].value, '13500');
    const beforeClick = database(h), beforeWrites = h.writes.length; h.node('가격 옵션 1 선택').props.onChange({ target: { checked: true } }); h.button('일괄 재계산').props.onClick();
    assert.equal(database(h), beforeClick); assert.equal(h.writes.length, beforeWrites); assert.equal(form(h).props['data-workspace-dirty'], true);
    await policySave(h); view = await f.quote(); const after = f.state(), newScope = currentScope(after, view.categoryContext.categoryId), priceIds = new Set(Object.values(targets).flatMap(target => target.linked));
    for (const layer of [newScope.common, ...sourceOptions.rows.map(option => newScope.options[option.id] ?? {})]) for (const key of priceIds) assert.equal(Object.hasOwn(layer, key), false, 'current price override cleared: ' + key);
    assert.deepEqual(values(row(view)), ['6200', '10330', '15500']); assert.deepEqual(values(row(view, 'price-003')), ['6200', '10330', '15500']); assert.equal(view.stageTwoMsrp, undefined);
    assert.equal(h.node('가격 옵션 1 판매가').props.value, '10330'); assert.equal(h.node('가격 옵션 1 권장소비자가').props.value, '15500'); assert.equal(form(h).props['data-workspace-dirty'], false);
    const request = h.writes.filter(write => write.kind === 'pricing').at(-1); assert.equal(request.recalculate, true); assert.equal(request.profileId, f.profile?.id); assert.equal(request.policy.recalculate, undefined);
    assert.deepEqual(newScope.options['retired-option'], scope.options['retired-option']); assert.deepEqual(after.categoryOverrides['category:991234'], retained.categoryOverrides['category:991234']); assert.deepEqual(after.detailSaveBackups, retained.detailSaveBackups);
    assert.deepEqual(after.categoryPackagingBasis ?? after.packagingBasis, retained.categoryPackagingBasis ?? retained.packagingBasis); assert.equal(row(view, 'price-002').title.value, '직접 저장한 제목 보존'); assert.equal(row(view).packagedWeightG.value, '420'); assert.equal(view.overrides.common.kcCertificationNumber, ''); if (osrp) assert.equal(row(view)[osrp.id].value, '76500');
    const book = await f.workbook(); if (book) { assert.deepEqual(book.preview.report.company, company); assert.equal(book.cells.length, 4); assert.deepEqual(plain(book.cells[0].slice(29, 32)), ['6200', '10330', '15500']); assert.equal(book.cells[1][2], '직접 저장한 제목 보존'); }
    const finalOptions = await f.options(); assert.deepEqual(plain(finalOptions.options), sourceOptions); assert.deepEqual(plain(finalOptions.optionRegistrationNumbers), numbers); assert.equal(finalOptions.options.rows[3].included, false);
    assert.equal(f.stable(), sourceBefore); assert.equal(f.objectSnapshot(), objectsBefore); assert.equal(database(other), otherBefore); assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM supplier_hub_receipts').get().n, 0);
    proof.push({ company, ordinary: ['9000', '13500'], manualPreservedBeforeExplicit: ['8000', '14000', '18200'], recalculated: values(row(view)), officialCells: book ? plain(book.cells[0].slice(29, 32)) : null,
      originalWorkbookSha256: f.original ? sha(f.original) : null, excludedOptionUnchanged: true, sourceBeforeSha256: sha(sourceBefore), sourceAfterSha256: sha(f.stable()), r2BeforeSha256: sha(objectsBefore), r2AfterSha256: sha(f.objectSnapshot()), otherCompanyBeforeSha256: sha(otherBefore), otherCompanyAfterSha256: sha(database(other)),
      protectedQuotationBeforeSha256: sha(JSON.stringify([scope.options['retired-option'], retained.categoryOverrides['category:991234'], retained.detailSaveBackups, retained.categoryPackagingBasis ?? retained.packagingBasis])), protectedQuotationAfterSha256: sha(JSON.stringify([newScope.options['retired-option'], after.categoryOverrides['category:991234'], after.detailSaveBackups, after.categoryPackagingBasis ?? after.packagingBasis])), trace: h.apiCalls.map(call => ({ method: call.method, url: call.url })) });
  } finally { h.close(); other.close(); }
});

test('ordinary legacy policy save keeps common prices and MSRP blank byte-for-byte; explicit action alone clears them', async () => {
  const f = await fixture(priceTableCompanies[0], { count: 1 }), { h } = f;
  try {
    const view = await f.quote(); await f.write([...f.paired(view, 'supplyPrice', null, '8000'), ...f.paired(view, 'salePrice', null, '14000'), ...f.paired(view, 'msrp', null, '')]);
    const before = f.state(); await legacyPolicySave(f,{msrpMultiple:1.5});
    assert.deepEqual(f.state(), before); assert.deepEqual(values(row(await f.quote())), ['8000', '14000', '']);
    h.button('일괄 재계산').props.onClick(); await policySave(h); const saved = await f.quote();
    assert.deepEqual(saved.overrides.common, {}); assert.deepEqual(values(row(saved)), ['4050', '6750', '10130']); assert.equal(saved.stageTwoMsrp, undefined);
  } finally { h.close(); }
});

test('pricing CAS rejects same-clock source changes and real SQLite companion failures roll back every local write', async () => {
  const results = [];
  for (const scenario of ['options', 'settings', 'policy', 'raw-quotation', 'policy-insert-ignore', 'quote-insert-ignore', 'quote-update-ignore', 'quote-update-abort', 'invalid-calculation']) {
    const f = await fixture(priceTableCompanies[0], { count: 2 }), { h } = f;
    try {
      change(h, '가격 옵션 1 판매가', '9000'); await f.saveGrid(); const view = await f.quote();
      const policy = { ...(await f.options()).pricing.policy, msrpMultiple: 1.5, recalculationMode: 'couplus-stage-two-v1' };
      const queries = h.load('db/queries.ts'), original = queries.applyProductPrice;
      let competing, intercepted = false;
      if (['options', 'settings', 'policy', 'raw-quotation'].includes(scenario)) queries.applyProductPrice = async (...args) => {
        assert.ok(args[5]?.source, 'the actual route supplied its guarded source snapshot'); intercepted = true;
        if (scenario === 'options') {
          const record = h.sqlite.prepare('SELECT payload,revision FROM product_options WHERE product_id=?').get(h.product.id), next = JSON.parse(record.payload); next.revision++;
          h.sqlite.prepare('UPDATE product_options SET payload=?,revision=? WHERE product_id=?').run(JSON.stringify(next), record.revision + 1, h.product.id);
        } else if (scenario === 'settings') {
          const settings = JSON.parse(h.sqlite.prepare('SELECT payload FROM workspace_settings WHERE owner_id=?').get(f.owner).payload); settings.brand = '동시 저장 브랜드';
          h.sqlite.prepare('UPDATE workspace_settings SET payload=? WHERE owner_id=?').run(JSON.stringify(settings), f.owner);
        } else if (scenario === 'policy') {
          const prior = JSON.parse(h.sqlite.prepare('SELECT payload FROM product_price_policy WHERE product_id=?').get(h.product.id).payload); prior.minimumMargin = 7777;
          h.sqlite.prepare('UPDATE product_price_policy SET payload=? WHERE product_id=?').run(JSON.stringify(prior), h.product.id);
        } else { const state = f.state(); state.overrides.common.title = '동일 revision에서 저장한 다른 제목'; f.writeState(state); }
        assert.equal(h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(h.product.id).updated_at, view.productVersion);
        competing = database(h); return original(...args);
      };
      if (scenario.endsWith('ignore') || scenario.endsWith('abort')) {
        const table = scenario.startsWith('policy-') ? 'product_price_policy' : 'product_quotation_fields', action = scenario.includes('insert') ? 'INSERT' : 'UPDATE';
        h.sqlite.exec(`CREATE TRIGGER local_pricing_fault BEFORE ${action} ON ${table} BEGIN SELECT RAISE(${scenario.endsWith('abort') ? "ABORT, 'local pricing companion rejected'" : 'IGNORE'}); END`);
      }
      if (scenario === 'invalid-calculation') Object.assign(policy, { exchangeRate: 0.000001, minimumMargin: 0, supplyMargin: 0, coupangMargin: 0, roundingUnit: 1000 });
      const before = database(h), expectedStatus = ['options', 'settings', 'policy', 'raw-quotation'].includes(scenario) ? 409 : scenario === 'invalid-calculation' ? 400 : 503;
      const response = await h.request(f.base + '/pricing', { method: 'POST', body: JSON.stringify({ expectedVersion: view.productVersion, policy, recalculate: true }) });
      await json(response, expectedStatus); assert.equal(database(h), competing ?? before, scenario + ': product, policy and quote must not partially commit');
      if (competing) assert.equal(intercepted, true); results.push({ scenario, status: response.status, preserved: true });
      queries.applyProductPrice = original;
    } finally { h.close(); }
  }
  proof.push({ kind: 'atomic-boundaries', results });
});

test('unchanged price plans still guard sources without creating or advancing quotation rows', async () => {
  const results = [];
  for (const scenario of ['empty-success', 'marker-success', 'settings-race', 'profile-race', 'same-policy-ignore', 'same-clock-cas-zero']) {
    const f = await fixture(priceTableCompanies[0], { count: 1 }), { h } = f, originalNow = Date.now;
    try {
      let profile;
      if (scenario === 'profile-race') profile = await h.load('db/category-profiles.ts').createCategoryProfile(f.owner, {
        name: '현재 분류', categoryId: '80719', categoryPath: ['주방용품', '주방수납/정리', '주방수납바구니/바스켓'], template: null, mappings: [],
      }, 'local-no-change');
      if (scenario === 'marker-success') { change(h, '가격 옵션 1 판매가', '9000'); await f.saveGrid(); }
      const policy = (await f.options()).pricing.policy, version = h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(h.product.id).updated_at;
      const quoteBefore = plain(h.sqlite.prepare('SELECT * FROM product_quotation_fields').all()), queries = h.load('db/queries.ts'), original = queries.applyProductPrice;
      let competing, intercepted = false;
      if (scenario === 'same-clock-cas-zero') h.sqlite.exec("CREATE TABLE local_sentinel_audit(note TEXT NOT NULL); CREATE TRIGGER local_sentinel_title AFTER UPDATE OF title ON products BEGIN INSERT INTO local_sentinel_audit(note) VALUES('title sentinel was executed'); END");
      queries.applyProductPrice = async (...args) => {
        intercepted = true; assert.equal(args[5]?.writeQuote, false, 'no-change plans keep the full guarded commit');
        if (scenario === 'settings-race') {
          const saved = JSON.parse(h.sqlite.prepare('SELECT payload FROM workspace_settings WHERE owner_id=?').get(f.owner).payload); saved.brand = '동시 변경 설정';
          h.sqlite.prepare('UPDATE workspace_settings SET payload=? WHERE owner_id=?').run(JSON.stringify(saved), f.owner);
        } else if (scenario === 'profile-race') h.sqlite.prepare('UPDATE category_profiles SET revision=revision+1 WHERE id=?').run(profile.id);
        else if (scenario === 'same-clock-cas-zero') {
          const target = '2099-01-01T00:00:00.000Z'; h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run(target, h.product.id);
          Date.now = () => Date.parse(target); competing = database(h);
        }
        if (scenario.endsWith('race')) { assert.equal(h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(h.product.id).updated_at, version); competing = database(h); }
        return original(...args);
      };
      if (scenario === 'same-policy-ignore') h.sqlite.exec('CREATE TRIGGER local_no_change_fault BEFORE INSERT ON product_price_policy BEGIN SELECT RAISE(IGNORE); END');
      const before = database(h), status = scenario.endsWith('race') ? 409 : ['same-policy-ignore', 'same-clock-cas-zero'].includes(scenario) ? 503 : 200;
      await json(await h.request(f.base + '/pricing', { method: 'POST', body: JSON.stringify({ expectedVersion: version, policy,
        ...(profile ? { profileId: profile.id } : {}), ...(scenario === 'marker-success' ? {} : { recalculate: true }) }) }), status);
      assert.equal(intercepted, true); assert.deepEqual(plain(h.sqlite.prepare('SELECT * FROM product_quotation_fields').all()), quoteBefore, 'no quote insert/revision on no-change');
      if (status !== 200) assert.equal(database(h), competing ?? before, scenario + ': failed no-change save has zero own writes');
      if (scenario === 'same-clock-cas-zero') assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM local_sentinel_audit').get().n, 0);
      if (scenario === 'marker-success') assert.equal((await f.quote()).stageTwoMsrp['price-001'].value, '11700');
      results.push({ scenario, status, quotationUnchanged: true, ...(status !== 200 ? { ownWrites: 0 } : {}) }); queries.applyProductPrice = original;
    } finally { Date.now = originalNow; h.close(); }
  }
  proof.push({ kind: 'unchanged-guarded-plans', results });
});

test('explicit same-policy intent survives a failed save, clears on acknowledgement/scope change, and lost ACK never claims success', async () => {
  const f = await fixture(priceTableCompanies[1], { count: 1 }), { h } = f;
  try {
    change(h, '가격 옵션 1 공급가', '8000'); change(h, '가격 옵션 1 판매가', '14000'); change(h, '가격 옵션 1 권장소비자가', '18200'); await f.saveGrid();
    const before = database(h); let reject = true;
    h.controls.before = (url, init) => { if (reject && url.endsWith('/pricing') && init.method === 'POST') { reject = false; throw Error('local policy request rejected before mutation'); } };
    h.button('일괄 재계산').props.onClick(); assert.equal(form(h).props['data-workspace-dirty'], true); await policySave(h);
    assert.equal(database(h), before); assert.equal(form(h).props['data-workspace-dirty'], true); assert.match(text(form(h)), /local policy request rejected/);
    await policySave(h); assert.equal(form(h).props['data-workspace-dirty'], false); assert.equal(h.writes.filter(write => write.kind === 'pricing').at(-1).recalculate, true);
    assert.deepEqual(values(row(await f.quote())), ['4050', '6750', '8780']);
    const writes = h.writes.length; h.button('일괄 재계산').props.onClick(); assert.equal(form(h).props['data-workspace-dirty'], true, 'an unchanged saved policy still has explicit destructive intent');
    const oldSubmit = form(h).props.onSubmit; h.selectProfile('missing'); h.selectProfile(undefined); await oldSubmit({ preventDefault() {} }); await h.settle();
    assert.equal(h.writes.length, writes); assert.equal(form(h).props['data-workspace-dirty'], false, 'scope ABA cannot retain destructive intent');
    let lost = true; h.controls.response = (url, init, response) => { if (lost && url.endsWith('/pricing') && init.method === 'POST') { lost = false; return Response.json({ error: 'local committed policy ACK lost' }, { status: 503 }); } return response; };
    policyChange(h, '시장가격 배수', '1.5'); h.button('일괄 재계산').props.onClick(); await policySave(h);
    assert.equal(form(h).props['data-workspace-dirty'], true); assert.doesNotMatch(text(form(h)), /가격을 저장했습니다/);
    const observed = await f.options(), observedQuote = await f.quote(); assert.equal(observed.pricing.policy.msrpMultiple, 1.5); assert.deepEqual(values(row(observedQuote)), ['4050', '6750', '10130']);
    const committed = database(h); await policySave(h); assert.equal(database(h), committed, 'retry with the old product version cannot apply a second mutation'); assert.equal(form(h).props['data-workspace-dirty'], true);
    assert.doesNotMatch(text(form(h)), /가격을 저장했습니다/); assert.equal(h.writes.filter(write => write.kind === 'pricing').at(-1).recalculate, true);
  } finally { h.close(); }
});
