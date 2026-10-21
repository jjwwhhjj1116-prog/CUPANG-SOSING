import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { optionPriceTableUI, priceTableCompanies, priceTableNodes as nodes, priceTableText as text } from './helpers/option-price-table-ui.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const change = (h, label, value) => h.node(label).props.onChange({ target: { value, valueAsNumber: Number(value) } });
const alerts = h => nodes(h.render()).filter(node => node.props?.role === 'alert').map(text).join(' ');
const database = h => JSON.stringify(h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, h.sqlite.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all()]));
const originalFile = new URL('../outputs/step603-official-unand-2624.xlsx', import.meta.url);
const profileFile = new URL('../outputs/step604-unand-profile-read.json', import.meta.url);
const officialAvailable = fs.existsSync(originalFile) && fs.existsSync(profileFile);
const sourceFiles = ['app/stage-two-msrp.ts', 'app/pricing.ts', 'app/components/product-options-editor.tsx', 'app/components/option-quotation-prices.tsx', 'app/components/option-price-table.tsx',
  'app/api/products/[id]/quotation-fields/route.ts', 'app/api/products/[id]/stage-two-pricing/route.ts', 'app/stage-two-pricing.ts', 'db/stage-two-pricing.ts',
  'app/quotation-fields-snapshot.ts', 'app/quotation-schema.ts', 'db/quotation-fields.ts'];
const sourceHashes = () => Object.fromEntries(sourceFiles.filter(file => fs.existsSync(new URL('../' + file, import.meta.url)))
  .map(file => [file, sha(fs.readFileSync(new URL('../' + file, import.meta.url)))]));
const frozen = sourceHashes(), proof = [];
after(() => {
  assert.deepEqual(sourceHashes(), frozen);
  if (proof.length) fs.writeFileSync(new URL('../outputs/step761-msrp-api-proof.json', import.meta.url), JSON.stringify({
    format: 'local-stage-two-msrp-api-proof-v1', sourceHashes: frozen, officialWorkbookAvailable: officialAvailable, cases: proof,
    externalNetworkRequests: 0, browserActions: 0, supplierHubWrites: 0,
    boundaries: 'Actual ProductOptionsEditor callbacks for the official flows; actual DetailPanel for the common-price and ACK-loss flows. Authenticated API handlers use fixture identities, isolated SQLite and local R2. The previously recorded original Unand workbook is reused for Waihop locally; no new live template, scraping, Chrome action, or Supplier Hub submission is claimed.',
  }, null, 2) + '\n');
});

async function fixture(company, { official = false, count = 6 } = {}) {
  const objects = new Map(), metadata = new Map(), fileStorage = {
    head: async key => objects.has(key) ? { size: objects.get(key).byteLength, ...metadata.get(key) } : null,
    put: async (key, bytes, options) => { objects.set(key, new Uint8Array(bytes)); metadata.set(key, options); return {}; },
    get: async key => { const bytes = objects.get(key); return bytes ? { size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer, ...metadata.get(key) } : null; },
  };
  const h = await optionPriceTableUI(company, { count, integrated: true, detail: !official, fileStorage });
  const base = '/api/products/' + h.product.id, owner = h.product.owner_id;
  try {
    let profile, original;
    if (official && officialAvailable) {
      const captured = JSON.parse(JSON.parse(fs.readFileSync(profileFile, 'utf8'))[0].results[0].payload), hubSchema = structuredClone(captured.hubSchema);
      assert.equal(hubSchema.company.code, 'A01526306'); hubSchema.company = plain(company);
      original = new Uint8Array(fs.readFileSync(originalFile));
      const form = new FormData(); form.set('file', new File([original], 'original-2624.xlsx')); form.set('schema', JSON.stringify(hubSchema)); form.set('action', 'workbook');
      const linked = await json(await h.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test/api/category-profiles/official-template', { method: 'POST', body: form })), 201);
      profile = await h.load('db/category-profiles.ts').createCategoryProfile(owner, { name: 'LOCAL MSRP 697', categoryId: captured.categoryId, categoryPath: captured.categoryPath,
        hubSchema, template: linked.template, mappings: linked.mappings }, 'local-697');
    }
    // A later workspace default must not replace this product's saved 1.3/10 policy.
    await h.load('db/queries.ts').saveSettings(owner, JSON.stringify({ ...h.load('app/workspace-settings.ts').defaultSettings, ...h.policy, msrpMultiple: 2.7, roundingUnit: 1000, brand: company.name }));
    const url = base + '/quotation-fields' + (profile ? '?profileId=' + profile.id : '');
    const read = () => h.request(url).then(response => json(response));
    const options = () => h.request(base + '/options').then(response => json(response));
    const refresh = async () => { h.changeProductVersion(h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(h.product.id).updated_at); await h.settle(); };
    h.selectProfile(profile?.id); await refresh(); h.button('저장 가격 다시 조회').props.onClick(); await h.settle();
    const write = async (changes, extra = {}, status = 200, from) => {
      const view = from ?? await read();
      return json(await h.request(url, { method: 'PUT', body: JSON.stringify({ expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes, ...extra }) }), status);
    };
    const paired = (view, input, optionId, value) => h.load('app/quotation-price-targets.ts').quotationPriceTargets(view.resolved.schema.fields)[input].linked.map(fieldKey => ({ fieldKey, optionId, value }));
    const save = async () => { h.node('옵션 가격 저장하기').props.onClick(); await h.settle(); assert.equal(alerts(h), ''); };
    const stable = () => JSON.stringify(['collection_jobs', 'collection_results', 'collection_context', 'category_profiles', 'workspace_settings', 'product_content',
      'product_registration_numbers', 'product_registration_options'].map(table => [table, h.sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()]));
    const objectSnapshot = () => JSON.stringify([...objects].map(([key, bytes]) => [key, sha(bytes)]));
    const workbook = async () => {
      if (!profile) return null;
      const preview = await json(await h.request(base + '/quotation', { method: 'POST', body: JSON.stringify({ action: 'preview', profileId: profile.id }) }));
      const response = await h.request(base + '/quotation', { method: 'POST', body: JSON.stringify({ action: 'download', profileId: profile.id, fingerprint: preview.fingerprint }) });
      assert.equal(response.status, 200, await response.clone().text());
      const reader = h.load('app/xlsx-template.ts'), book = reader.inspectXlsxArchive(await reader.readXlsxArchive(await response.arrayBuffer()));
      return { preview, cells: preview.rows.map((_, index) => reader.xlsxHeaders(book, profile.template.sheetName, profile.template.dataStartRow + index)) };
    };
    return { h, company, base, url, profile, original, read, options, refresh, write, paired, save, stable, objectSnapshot, workbook };
  } catch (error) { h.close(); throw error; }
}

for (const company of priceTableCompanies) test(`Stage2 sale saves automatic MSRP through reread, Stage7 and original workbook without changing manual prices (${company.code})`, async () => {
  const f = await fixture(company, { official: true }), { h } = f;
  const other = await optionPriceTableUI(priceTableCompanies.find(value => value.code !== company.code), { count: 1, integrated: true });
  try {
    let optionView = await f.options(); const rows = h.load('app/product-options.ts').optionInputs(optionView.options); rows[5].included = false;
    await json(await h.request(f.base + '/options', { method: 'PATCH', body: JSON.stringify({ expectedRevision: optionView.options.revision, expectedProductVersion: optionView.productVersion, rows }) }));
    const content = await json(await h.request(f.base + '/content'));
    await json(await h.request(f.base + '/content', { method: 'PATCH', body: JSON.stringify({ expectedRevision: content.content.revision, patch: { seo: { title: '로컬 MSRP 검토 상품' } } }) }));
    let view = await f.read(); const independent = view.resolved.schema.fields.find(field => field.hubWire?.path.join('.') === 'productPage.commonAttributes.osrp');
    const seed = [...f.paired(view, 'msrp', 'price-002', '27000'), ...f.paired(view, 'msrp', 'price-003', ''), ...f.paired(view, 'msrp', 'price-005', '30000'),
      { fieldKey: 'title', optionId: 'price-002', value: '직접 보존할 옵션 제목' }, ...(independent ? [{ fieldKey: independent.id, optionId: 'price-001', value: '76500' }] : [])];
    await f.write(seed); await f.refresh();
    const stable = f.stable(), objects = f.objectSnapshot(), otherBefore = database(other), sourceRows = plain((await f.options()).options.rows), policyBefore=plain((await f.options()).pricing.policy), writesBefore = h.writes.length;
    assert.equal(h.node('가격 옵션 1 판매가').props.value, '6750'); assert.equal(h.node('가격 옵션 1 권장소비자가').props.value, '8780');
    change(h, '가격 옵션 1 판매가', '9000'); change(h, '가격 옵션 2 판매가', '15000'); change(h, '가격 옵션 3 판매가', '15000');
    change(h, '가격 옵션 4 판매가', '9000'); change(h, '가격 옵션 4 권장소비자가', '17000'); change(h, '가격 옵션 5 판매가', '9000');
    h.node('가격 옵션 5 권장소비자가 복원').props.onClick();
    assert.equal(h.writes.length, writesBefore, 'editing changes no saved row');
    await f.save(); view = await f.read();
    const values = id => view.resolved.rows.find(row => row.optionId === id).fields;
    assert.equal(values('price-001').msrp.value, '11700', JSON.stringify({ writes: h.writes.slice(writesBefore), status: nodes(h.render()).filter(node => node.props?.role === 'status').map(text) }));
    assert.equal(values('price-002').msrp.value, '27000'); assert.equal(values('price-003').msrp.value, ''); assert.equal(values('price-004').msrp.value, '17000'); assert.equal(values('price-005').msrp.value, '8780');
    assert.deepEqual(Object.keys(view.stageTwoMsrp ?? {}), ['price-001']);
    assert.deepEqual(h.writes.slice(writesBefore).map(write => [write.method,write.kind]), [['POST','stage-two-pricing']]);
    assert.equal(Object.hasOwn(h.writes.at(-1),'stageTwoMsrp'),false,'MSRP authority is derived on the server, never supplied by the pricing form');
    const firstBook = await f.workbook();
    if (firstBook) { assert.deepEqual(firstBook.preview.report.company, company); assert.equal(firstBook.cells.length, 5); assert.deepEqual(plain(firstBook.cells[0].slice(29, 32)), ['4050', '9000', '11700']); assert.equal(firstBook.cells[1][2], '직접 보존할 옵션 제목'); assert.equal(firstBook.cells[2][31], ''); }
    h.button('저장 가격 다시 조회').props.onClick(); await h.settle(); assert.equal(h.node('가격 옵션 1 권장소비자가').props.value, '11700');
    change(h, '가격 옵션 1 판매가', '15000'); await f.save(); view = await f.read(); assert.equal(values('price-001').msrp.value, '19500');
    const secondBook = await f.workbook(); if (secondBook) assert.deepEqual(plain(secondBook.cells[0].slice(29, 32)), ['4050', '15000', '19500']);
    // The ordinary Stage7 API explicitly confirms the SAME value, changing its ownership.
    await f.write(f.paired(view, 'msrp', 'price-001', '19500')); await f.refresh(); view = await f.read(); assert.equal(view.stageTwoMsrp?.['price-001'], undefined);
    change(h, '가격 옵션 1 판매가', '18000'); await f.save(); view = await f.read(); assert.equal(values('price-001').msrp.value, '19500');
    const beforeExcluded = database(h);
    await f.write([...f.paired(view, 'salePrice', 'price-006', '9000'), ...f.paired(view, 'msrp', 'price-006', '11700')], { stageTwoMsrp: ['price-006'] }, 400, view);
    assert.equal(database(h), beforeExcluded, 'an excluded row cannot acquire automatic MSRP authority');
    assert.equal(values('price-002').title.value, '직접 보존할 옵션 제목'); if (independent) assert.equal(values('price-001')[independent.id].value, '76500');
    assert.deepEqual(plain((await f.options()).options.rows), sourceRows);assert.deepEqual(plain((await f.options()).pricing.policy),policyBefore); assert.equal(f.stable(), stable); assert.equal(f.objectSnapshot(), objects); assert.equal(database(other), otherBefore);
    assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM supplier_hub_receipts').get().n, 0); assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products WHERE id=?').get(h.product.id).supplier_hub_status, '미전송');
    proof.push({ company, result: 'passed', policy: plain((await f.options()).pricing.policy), saleMsrp: [[6750, 8780], [9000, 11700], [15000, 19500], [18000, 19500]],
      manualAmount: 27000, manualBlank: '', pendingAmount: 17000, pendingRestore: 8780, excludedOption: 'price-006', independentOsrp: independent ? '76500' : null,
      officialCells: secondBook ? plain(secondBook.cells[0].slice(29, 32)) : null, originalWorkbookSha256: f.original ? sha(f.original) : null,
      protectedBeforeSha256: sha(stable), protectedAfterSha256: sha(f.stable()), r2BeforeSha256: sha(objects), r2AfterSha256: sha(f.objectSnapshot()), otherCompanyBeforeSha256: sha(otherBefore), otherCompanyAfterSha256: sha(database(other)),
      trace: h.apiCalls.map(call => ({ method: call.method, url: call.url })) });
  } finally { h.close(); other.close(); }
});

test('common manual MSRP amount/blank and explicit pending blank stay independent; forged or stale Stage2 intent never writes', async () => {
  const f = await fixture(priceTableCompanies[0], { count: 3 }), { h } = f;
  try {
    for (const index of [1, 2, 3]) change(h, `가격 옵션 ${index} 개당 원가`, '5.23');
    const row = nodes(h.render()).find(node => node.props?.['data-price-option-id'] === 'price-001');
    assert.match(text(nodes(row).find(node => node.props?.['data-price-column'] === 'supplyMargin')), /2,999\.5원/);
    assert.match(text(h.node('전체 옵션 가격 요약')), /평균 공급 마진: 3,000원/);
    await f.save();
    let view = await f.read();const costDerivedMsrp=view.resolved.rows.find(row=>row.optionId==='price-001').fields.msrp.value;assert.equal(view.stageTwoMsrp['price-001'].value,costDerivedMsrp,'cost change now performs the original per-row price/MSRP recalculation');
    await f.write(f.paired(view, 'msrp', null, '27000'));await f.refresh();view=await f.read();assert.equal(view.resolved.rows.find(row=>row.optionId==='price-001').fields.msrp.value,costDerivedMsrp,'a common edit retires automatic authority but never silently removes its saved per-row override');assert.equal(view.stageTwoMsrp?.['price-001'],undefined);
    await f.write(f.paired(view,'msrp','price-001',null));await f.refresh();change(h, '가격 옵션 1 판매가', '9000'); await f.save();
    view = await f.read(); assert.equal(view.resolved.rows.find(row => row.optionId === 'price-001').fields.msrp.value, '27000'); assert.equal(view.stageTwoMsrp?.['price-001'], undefined);
    await f.write(f.paired(view, 'msrp', null, '')); await f.refresh(); change(h, '가격 옵션 1 판매가', '15000'); await f.save(); view = await f.read(); assert.equal(view.resolved.rows.find(row => row.optionId === 'price-001').fields.msrp.value, '');
    await f.write(f.paired(view, 'msrp', null, null)); await f.refresh(); change(h, '가격 옵션 2 판매가', '15000'); change(h, '가격 옵션 2 권장소비자가', ''); await f.save();
    view = await f.read(); assert.equal(view.resolved.rows.find(row => row.optionId === 'price-002').fields.msrp.value, ''); assert.equal(view.stageTwoMsrp?.['price-002'], undefined);
    assert.equal(view.resolved.rows.find(row=>row.optionId==='price-003').fields.msrp.value,costDerivedMsrp,'the other cost-derived row also keeps its exact saved value after common authority is retired');await f.write(f.paired(view,'msrp','price-003',null));await f.refresh();view=await f.read();
    const attempt = [...f.paired(view, 'salePrice', 'price-003', '9000'), ...f.paired(view, 'msrp', 'price-003', '11700')], before = database(h);
    for (const stageTwoMsrp of [true, 'price-003', ['missing'], ['price-003', 'price-003']]) await f.write(attempt, { stageTwoMsrp }, 400, view);
    await f.write([...f.paired(view, 'salePrice', 'price-003', '9000'), ...f.paired(view, 'msrp', 'price-003', '99999')], { stageTwoMsrp: ['price-003'] }, 400, view);
    await f.write(f.paired(view, 'msrp', 'price-003', '11700'), { stageTwoMsrp: ['price-003'] }, 400, view); assert.equal(database(h), before);
    const policy = { ...(await f.options()).pricing.policy, msrpMultiple: 1.7 };
    await json(await h.request(f.base + '/pricing', { method: 'POST', body: JSON.stringify({ policy, expectedVersion: view.productVersion }) })); const afterPolicy = database(h);
    await f.write(attempt, { stageTwoMsrp: ['price-003'] }, 409, view); assert.equal(database(h), afterPolicy);
    const current = await f.read(); await f.write(attempt, { stageTwoMsrp: ['price-003'] }, 400, current); assert.equal(database(h), afterPolicy, 'fresh CAS does not authorize an amount derived from the old policy');
    await f.write([...f.paired(current, 'salePrice', 'price-003', '9e3'), ...f.paired(current, 'msrp', 'price-003', '15300')], { stageTwoMsrp: ['price-003'] }, 400, current);
    assert.equal(database(h), afterPolicy, 'existing canonical integer grammar remains enforced');
    const accepted = await f.write([...f.paired(current, 'salePrice', 'price-003', '9000'), ...f.paired(current, 'msrp', 'price-003', '15300')], { stageTwoMsrp: ['price-003'] }, 200, current);
    assert.equal(accepted.stageTwoMsrp['price-003'].value, '15300'); assert.equal(accepted.resolved.rows.find(row => row.optionId === 'price-003').fields.salePrice.value, '9000');
  } finally { h.close(); }
});

test('committed derived MSRP ACK loss recovers by read without a duplicate atomic POST and continues automatic edits', async () => {
  const f = await fixture(priceTableCompanies[1], { count: 2 }), { h } = f;
  try {
    const source = f.stable(); let lost = true;
    h.controls.response = (url, init, response) => { if (lost && init.method === 'POST' && url.includes('/stage-two-pricing')) { lost = false; return Response.json({ error: 'local committed ACK lost' }, { status: 503 }); } return response; };
    change(h, '가격 옵션 1 판매가', '9000'); const save = h.node('옵션 가격 저장하기').props.onClick; save(); await h.settle(); save(); await h.settle();
    assert.equal(h.writes.filter(write => write.kind === 'stage-two-pricing').length, 1); assert.equal(h.saved, 0); assert.equal(h.node('가격 옵션 1 판매가').props.value, '9000'); assert.equal(h.node('가격 옵션 1 판매가').props.disabled, true);
    const committed = await f.read(); assert.equal(committed.resolved.rows.find(row => row.optionId === 'price-001').fields.msrp.value, '11700');
    h.button('입력 유지 · 저장 결과 확인').props.onClick(); await h.settle(); assert.equal(h.saved, 1); assert.equal(h.writes.filter(write => write.kind === 'stage-two-pricing').length, 1); assert.equal(h.node('가격 옵션 1 권장소비자가').props.value, '11700');
    change(h, '가격 옵션 1 판매가', '15000'); await f.save(); const next = await f.read(); assert.equal(next.resolved.rows.find(row => row.optionId === 'price-001').fields.msrp.value, '19500');
    assert.equal(h.writes.filter(write => write.kind === 'stage-two-pricing').length, 2); assert.equal(f.stable(), source);
  } finally { h.close(); }
});
