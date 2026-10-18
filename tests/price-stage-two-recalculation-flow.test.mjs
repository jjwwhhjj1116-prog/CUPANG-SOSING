import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const mode = 'couplus-stage-two-v1';
const observed = { exchangeRate: 350, supplyMargin: 50, coupangMargin: 40, minimumMargin: 3000, msrpMultiple: 1.3, roundingUnit: 10, roundingMode: 'nearest' };
const companies = [{ code: 'A01526306', name: '유앤채' }, { code: 'A01464742', name: '와이홉' }];
const profileFile = new URL('../outputs/step604-unand-profile-read.json', import.meta.url), originalFile = new URL('../outputs/step603-official-unand-2624.xlsx', import.meta.url);
const available = fs.existsSync(profileFile) && fs.existsSync(originalFile);
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const plain = value => JSON.parse(JSON.stringify(value));
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => JSON.stringify(tree);

/** Real PriceEditor callbacks and calculation, with deterministic hook slots.
 * Children stay opaque here; actual options/API/Excel are checked below. */
export function stageTwoPriceUI({ load, initial = observed, sourcePrice = 25.6, onSave = async () => {} }) {
  const slots = []; let cursor = 0, changed = false, writes = 0, layouts = [];
  const exports = {}, react = {
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; changed ||= !Object.is(next, slots[i]); slots[i] = next; }]; },
    useRef(value) { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }); },
    useMemo(factory, deps) { const i=cursor++,previous=slots[i];if(!previous||!deps||!previous.deps||deps.length!==previous.deps.length||deps.some((value,index)=>!Object.is(value,previous.deps[index])))slots[i]={deps:deps?.slice(),value:factory()};return slots[i].value; },
    useLayoutEffect(effect, deps) { const i=cursor++,previous=slots[i];if(!previous||!deps||deps.some((value,index)=>!Object.is(value,previous.deps?.[index])))layouts.push(()=>{previous?.cleanup?.();slots[i]={deps,cleanup:effect()};}); },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/price-editor.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, Error, require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === '@/app/pricing') return load('app/pricing.ts');
      if (name === '@/app/components/option-price-preview') return { OptionPricePreview: function OptionPricePreview() {} };
      if (name === '@/app/components/option-quotation-prices') return { OptionQuotationPrices: function OptionQuotationPrices() {} };
      throw Error(name);
    } });
  const render = () => { let tree; for (let i = 0; i < 12; i++) { cursor = 0; changed = false; layouts=[]; tree = exports.PriceEditor({ sourcePrice, initial, productId: 'local', version: '2026-10-13T00:00:00.000Z', onSave: async policy => { writes++; await onSave(policy); initial = policy; } }); if (!changed) {for(const commit of layouts)commit();if(!changed)return tree;} } throw Error('Price editor render loop'); };
  const button = label => nodes(render()).find(node => node.type === 'button' && node.props.children === label);
  const field = label => nodes(render()).find(node => node.type === 'label' && nodes(node.props.children).some(child => child.type === 'span' && child.props.children === label))?.props.children[1];
  const policy = () => nodes(render()).find(node => node.type?.name === 'OptionPricePreview').props.policy;
  const submit = () => render().props.onSubmit({ preventDefault() {} });
  return { render, button, field, policy, submit, update(value) { initial = value; }, get writes() { return writes; } };
}

test('recalculation only stages latest unsaved policy and nearest rounding, then one explicit save writes it', async () => {
  const h = mobileIntakeHarness(); const saved = [];
  try {
    const ui = stageTwoPriceUI({ load: h.load, initial: { ...observed, roundingMode: 'up' }, onSave: async policy => saved.push(plain(policy)) });
    const retained = ui.button('일괄 재계산');
    ui.field('최소 공급 마진 (원)').props.onChange({ target: { value: '4500' } });
    retained.props.onClick(); retained.props.onClick();
    assert.equal(ui.policy().minimumMargin, 4500, 'retained button reads the latest functional state');
    assert.equal(ui.policy().roundingMode, 'nearest'); assert.equal(ui.policy().recalculationMode, mode);
    assert.equal(ui.writes, 0); assert.equal(ui.render().props['data-workspace-dirty'], true); assert.match(text(ui.render()), /판매 묶음 원가에 최소 공급 마진액/);
    assert.equal(h.load('app/pricing.ts').calculatePrice(25.6, ui.policy()).supplyPrice, 13460);
    await ui.submit(); assert.equal(ui.writes, 1); assert.equal(saved[0].minimumMargin, 4500); assert.equal(saved[0].recalculationMode, mode); assert.equal(ui.render().props['data-workspace-dirty'], false);
    ui.field('가격 처리 방식').props.onChange({ target: { value: 'up' } }); await ui.submit();
    assert.equal(ui.writes, 2); assert.equal(saved[1].roundingMode, 'up'); assert.equal(saved[1].recalculationMode, mode, 'later manual up choice remains usable');
  } finally { h.close(); }
});

test('busy/ref blocks retained recalculation and duplicate saves, and failed saves retain the reviewed draft', async () => {
  const h = mobileIntakeHarness(); let finish;
  try {
    const pending = new Promise(resolve => { finish = resolve; }), ui = stageTwoPriceUI({ load: h.load, onSave: () => pending });
    const retained = ui.button('일괄 재계산'); retained.props.onClick(); const submit = ui.render().props.onSubmit;
    const saving = submit({ preventDefault() {} }); retained.props.onClick(); await submit({ preventDefault() {} }); await ui.submit();
    assert.equal(ui.writes, 1); assert.equal(ui.button('일괄 재계산').props.disabled, true); assert.equal(ui.render().props['data-workspace-saving'], true);
    finish(); await saving; assert.equal(ui.render().props['data-workspace-saving'], false); assert.equal(ui.render().props['data-workspace-dirty'], false);
    const failing = stageTwoPriceUI({ load: h.load, onSave: async () => { throw Error('fixture save conflict'); } }); failing.button('일괄 재계산').props.onClick(); await failing.submit();
    assert.equal(failing.policy().recalculationMode, mode); assert.equal(failing.render().props['data-workspace-dirty'], true); assert.match(text(failing.render()), /fixture save conflict/);
    assert.equal(h.network.length, 0);
  } finally { h.close(); }
});

test('invalid policy blocks recalculation/save and disabled minimum keeps ratio while the mode counts as a real external update', async () => {
  const h = mobileIntakeHarness();
  try {
    const ui = stageTwoPriceUI({ load: h.load }); ui.field('환율 (원/CNY)').props.onChange({ target: { value: '' } });
    assert.equal(ui.button('일괄 재계산').props.disabled, true); ui.button('일괄 재계산').props.onClick(); await ui.submit(); assert.equal(ui.writes, 0); assert.equal(ui.policy().recalculationMode, undefined);
    ui.field('환율 (원/CNY)').props.onChange({ target: { value: '350' } }); ui.field('최소 공급 마진 보장').props.onChange({ target: { checked: false } }); ui.button('일괄 재계산').props.onClick();
    assert.equal(ui.policy().minimumMargin, 0); assert.equal(h.load('app/pricing.ts').calculatePrice(25.6, ui.policy()).supplyPrice, 17920);
    const clean = stageTwoPriceUI({ load: h.load }); clean.update({ ...observed, recalculationMode: mode }); assert.equal(clean.policy().recalculationMode, mode); assert.equal(clean.render().props['data-workspace-dirty'], false);
    clean.field('최소 공급 마진 (원)').props.onChange({ target: { value: '5500' } }); clean.update({ ...observed });
    assert.equal(clean.policy().minimumMargin, 5500); assert.match(text(clean.render()), /수정 중인 입력/); clean.button('수정 취소·최신 가격 정책 불러오기').props.onClick();
    assert.equal(clean.policy().minimumMargin, 3000); assert.equal(clean.policy().recalculationMode, undefined);
  } finally { h.close(); }
});

/** Fresh synthetic supplier receipt, actual handlers/SQLite and the previously
 * recorded original Unand workbook. Waihop reuses that contract in isolation;
 * this is not a newly obtained Waihop template or real Supplier Hub submission. */
export async function stageTwoPricingFixture(company = companies[0], { integrated = false, pack = 1 } = {}) {
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name });
  try {
    Object.assign(h.settings, { bundleEnabled: false, ...(integrated ? { useIntegratedRate: true, integratedRate: 300 } : {}) });
    h.context.settings = plain(h.settings); await h.load('db/queries.ts').saveSettings('owner', JSON.stringify(h.settings));
    const saved = JSON.parse(JSON.parse(fs.readFileSync(profileFile, 'utf8'))[0].results[0].payload), hubSchema = structuredClone(saved.hubSchema);
    assert.deepEqual(hubSchema.company, companies[0]); hubSchema.company = plain(company);
    const bytes = new Uint8Array(fs.readFileSync(originalFile)), form = new FormData(); form.set('file', new File([bytes], 'recorded-original.xlsx')); form.set('schema', JSON.stringify(hubSchema)); form.set('action', 'workbook');
    const linked = await json(await h.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test/api/category-profiles/official-template', { method: 'POST', body: form })), 201);
    const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', { name: 'LOCAL STAGE TWO PRICE REVIEW', categoryId: saved.categoryId, categoryPath: saved.categoryPath, hubSchema, template: linked.template, mappings: linked.mappings }, 'cat');
    h.context.category = profile; const sourceUrl = 'https://detail.1688.com/offer/640000000011.html';
    h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=?').run('640000000011', sourceUrl); h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));
    await json(await h.route('/api/collection-jobs/job/result', { method: 'POST', body: { schemaVersion: 1, sourceUrl, provider: 'synthetic-local-640', collectedAt: new Date().toISOString(), title: '本地商品', description: '本地商品说明', attributes: [], options: [
      { sku: 'LOCAL640-HIGH', name: '高价', unitPriceCny: 25.6, minimumOrder: 2, stock: 7 }, { sku: 'LOCAL640-LOW', name: '低价', unitPriceCny: 5.23, minimumOrder: 1, stock: 8 },
    ], images: [] } }));
    const promoted = await json(await h.route('/api/collection-jobs/job/product', { method: 'POST' })), productId = promoted.productId, base = '/api/products/' + productId;
    const product = () => h.load('db/queries.ts').findProduct('owner', productId), read = () => h.route(base + '/quotation-fields').then(response => json(response));
    if (pack !== 1) { const view = await json(await h.route(base + '/options')), rows = h.load('app/product-options.ts').optionInputs(view.options); rows[0].unitsPerPack = pack;
      await json(await h.route(base + '/options', { method: 'PATCH', body: { expectedRevision: view.options.revision, expectedProductVersion: view.productVersion, rows } })); }
    const immutable = () => JSON.stringify(Object.fromEntries(['collection_results', 'collection_context', 'category_profiles', 'workspace_settings', 'product_options', 'product_content'].map(table => [table, h.sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()])));
    const workbook = async () => {
      const preview = await json(await h.route(base + '/quotation', { method: 'POST', body: { action: 'preview' } })), response = await h.route(base + '/quotation', { method: 'POST', body: { action: 'download', fingerprint: preview.fingerprint } });
      assert.equal(response.status, 200, await response.clone().text()); const reader = h.load('app/xlsx-template.ts'), book = reader.inspectXlsxArchive(await reader.readXlsxArchive(await response.arrayBuffer()));
      return { preview, cells: preview.rows.map((_, index) => reader.xlsxHeaders(book, profile.template.sheetName, profile.template.dataStartRow + index)) };
    };
    return { h, company, base, profile, bytes, product, read, workbook, immutable };
  } catch (error) { h.close(); throw error; }
}

for (const company of companies) for (const integrated of [false, true]) test(`explicit stage-two save reaches options, stage seven and original 29/30/31 price columns (${company.code}, ${integrated ? 'integrated' : 'normal'})`, { skip: !available }, async () => {
  const f = await stageTwoPricingFixture(company, { integrated }), { h } = f;
  try {
    const product = await f.product(), policy = JSON.parse(product.pricing_policy), before = f.immutable(), objects = new Map([...h.objects].map(([key, value]) => [key, Buffer.from(value)]));
    assert.equal(policy.recalculationMode, undefined); const initial = await f.read(), initialHigh = initial.resolved.rows.find(row => row.optionId === 'collected-1');
    const ordinary = h.load('app/pricing.ts').calculatePrice(25.6, policy); assert.equal(initialHigh.fields.supplyPrice.value, String(ordinary.supplyPrice)); if (!integrated) assert.equal(ordinary.supplyPrice, 17920);
    let writes = 0; const ui = stageTwoPriceUI({ load: h.load, sourcePrice: product.source_price_cny, initial: policy, onSave: async value => {
      writes++; const current = await f.product(); await json(await h.route(f.base + '/pricing', { method: 'POST', body: { policy: value, expectedVersion: current.updated_at } }));
    } });
    ui.button('일괄 재계산').props.onClick(); assert.equal(writes, 0); assert.equal(f.immutable(), before); assert.equal((await f.product()).pricing_policy, product.pricing_policy);
    await ui.submit(); assert.equal(writes, 1); const saved = await f.product(), savedPolicy = JSON.parse(saved.pricing_policy); assert.equal(savedPolicy.recalculationMode, mode); assert.equal(savedPolicy.roundingMode, 'nearest');
    const fields = await f.read(), options = await json(await h.route(f.base + '/options')), exported = await f.workbook();
    const targets = h.load('app/quotation-price-targets.ts').quotationPriceTargets(fields.resolved.schema.fields), columns = ['supplyPrice', 'salePrice', 'msrp'].map(key => f.profile.mappings.find(mapping => mapping.field === targets[key].primary).column);
    assert.deepEqual(columns, [29, 30, 31]); assert.deepEqual(exported.preview.report.company, company);
    for (const [index, row] of options.options.rows.entries()) {
      const calculated = h.load('app/pricing.ts').calculatePrice(row.unitCostCny, savedPolicy, row.unitsPerPack), values = fields.resolved.rows.find(value => value.optionId === row.id).fields;
      assert.deepEqual(plain(options.pricing.rows[index].calculation), plain(calculated));
      for (const [j, key] of ['supplyPrice', 'salePrice', 'msrp'].entries()) { assert.equal(values[key].value, String(calculated[key])); assert.equal(values[targets[key].primary].value, String(calculated[key])); assert.equal(exported.cells[index][columns[j]], String(calculated[key])); }
    }
    if (!integrated) assert.deepEqual(plain(exported.cells[0].slice(29, 32)), ['11960', '19930', '25910']);
    assert.equal(f.immutable(), before); for (const [key, value] of objects) assert.deepEqual(Buffer.from(h.objects.get(key)), value);
    assert.equal(h.network.length, 0); assert.equal(h.aiSources.length, 0); assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM supplier_hub_receipts').get().n, 0); assert.equal(saved.supplier_hub_status, '미전송');
    assert.equal(createHash('sha256').update(f.bytes).digest('hex'), '58335f443503cc386521b6d2a78fa46c63b0735e68ec21cf7c9a156c0aa9bee6');
  } finally { h.close(); }
});

for (const company of companies) test(`reviewed pack, paired manual prices and blanks survive recalculation and original output (${company.code})`, { skip: !available }, async () => {
  const f = await stageTwoPricingFixture(company, { pack: 3 }), { h } = f;
  try {
    let view = await f.read(); const targets = h.load('app/quotation-price-targets.ts').quotationPriceTargets(view.resolved.schema.fields), changes = [
      ...targets.salePrice.linked.map(fieldKey => ({ fieldKey, optionId: 'collected-1', value: '98765' })),
      ...targets.supplyPrice.linked.map(fieldKey => ({ fieldKey, optionId: 'collected-2', value: '' })),
      ...targets.msrp.linked.map(fieldKey => ({ fieldKey, optionId: null, value: '' })),
    ];
    await json(await h.route(f.base + '/quotation-fields', { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes } }));
    const before = f.immutable(), overrides = h.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload, product = await f.product();
    const ui = stageTwoPriceUI({ load: h.load, sourcePrice: product.source_price_cny, initial: JSON.parse(product.pricing_policy), onSave: async policy => {
      await json(await h.route(f.base + '/pricing', { method: 'POST', body: { policy, expectedVersion: (await f.product()).updated_at } }));
    } });
    ui.button('일괄 재계산').props.onClick(); await ui.submit(); view = await f.read(); const exported = await f.workbook(), first = view.resolved.rows.find(row => row.optionId === 'collected-1').fields, second = view.resolved.rows.find(row => row.optionId === 'collected-2').fields;
    assert.equal(first.supplyPrice.value, '29880'); assert.equal(first.salePrice.value, '98765'); assert.equal(first.salePrice.source, 'manual-option'); assert.equal(first.msrp.value, ''); assert.equal(first.msrp.source, 'manual-common');
    assert.equal(second.supplyPrice.value, ''); assert.equal(second.supplyPrice.source, 'manual-option'); assert.equal(second.salePrice.value, '8050');
    assert.deepEqual(plain(exported.cells[0].slice(29, 32)), ['29880', '98765', '']); assert.deepEqual(plain(exported.cells[1].slice(29, 32)), ['', '8050', '']);
    assert.equal(h.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload, overrides); assert.equal(f.immutable(), before);
    assert.equal(h.network.length, 0); assert.equal(h.aiSources.length, 0); assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM supplier_hub_receipts').get().n, 0);
  } finally { h.close(); }
});

test('invalid mode and stale saves cannot overwrite a stored explicit policy or any original inputs', { skip: !available }, async () => {
  const f = await stageTwoPricingFixture(), { h } = f;
  try {
    const product = await f.product(), initial = JSON.parse(product.pricing_policy), immutable = f.immutable(), snapshot = () => JSON.stringify(Object.fromEntries(['products', 'product_price_policy', 'product_options', 'product_content', 'product_quotation_fields', 'workspace_settings', 'collection_results'].map(table => [table, h.sqlite.prepare('SELECT * FROM ' + table).all()]))), before = snapshot();
    for (const value of [null, false, '', 'unknown']) await json(await h.route(f.base + '/pricing', { method: 'POST', body: { policy: { ...initial, recalculationMode: value }, expectedVersion: product.updated_at } }), 400);
    assert.equal(snapshot(), before); await json(await h.route(f.base + '/pricing', { method: 'POST', body: { policy: { ...initial, recalculationMode: mode }, expectedVersion: product.updated_at } }));
    const saved = snapshot(); await json(await h.route(f.base + '/pricing', { method: 'POST', body: { policy: initial, expectedVersion: product.updated_at } }), 409); assert.equal(snapshot(), saved); assert.equal(f.immutable(), immutable);
    assert.equal(h.network.length, 0); assert.equal(h.aiSources.length, 0);
  } finally { h.close(); }
});
