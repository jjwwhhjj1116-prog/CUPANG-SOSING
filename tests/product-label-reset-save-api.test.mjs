import test from 'node:test';
import assert from 'node:assert/strict';
import {quotationAiApiFixture, plain} from './helpers/quotation-ai-api.mjs';

const selected = 'synthetic-one', sibling = 'synthetic-two';
const row = (view, optionId) => view.rows.find(item => item.optionId === optionId);
const json = async response => {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
};

/** Actual public label handlers and ephemeral SQLite. Automatic processing is
 * local; no provider, network, original product or Supplier Hub is accessed. */
async function fixture() {
  const f = await quotationAiApiFixture();
  try {
    const {h} = f, optionsModel = h.load('app/product-options.ts'), optionsStore = h.load('db/product-options.ts');
    const options = await optionsStore.readProductOptions('owner', f.id), product = await h.load('db/queries.ts').findProduct('owner', f.id);
    const next = optionsModel.applyOptionRows(options, [...options.rows, {...optionsModel.emptyOptionInput(sibling), originalName: '白色', translatedName: '흰색', supplierSku: 'SYNTHETIC-RESET', unitCostCny: 7.1, unitsPerPack: 1, included: true, color: '흰색'}], new Date().toISOString());
    assert.ok(await optionsStore.saveProductOptions('owner', next, options.revision, product.updated_at));
    const endpoint = f.base + '/product-labels' + f.query, read = () => h.route(endpoint).then(json);
    const save = (view, changes, extra = {}) => h.route(endpoint, {method: 'PUT', body: {expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes, ...extra}}).then(json);
    let view = await read();
    view = await save(view, [
      {optionId: null, fieldKey: 'usageStandard', value: ''},
      {optionId: selected, fieldKey: 'countryOfOrigin', value: ''},
      {optionId: sibling, fieldKey: 'manufacturer', value: '다른 옵션 제조원'},
    ]);
    for (const optionId of [null, selected, sibling]) {
      view = await save(view, [], {automaticProcessing: {optionId, values: {netContents: '', material: '', productType: ''}}});
    }
    view = await read();
    for (const optionId of [null, selected, sibling]) {
      assert.equal(row(view, optionId).values.netContents, '1개');
      assert.equal(row(view, optionId).sources.netContents, 'label-default');
    }
    assert.equal(view.automaticSuggestions.entries.length, 9);
    return {...f, read, save, view, model: h.load('app/product-label.ts')};
  } catch (error) { f.close(); throw error; }
}

for (const {name, optionId, value, expected, source} of [
  {name: 'selected null reset', optionId: selected, value: null, expected: '', source: 'empty'},
  {name: 'selected manual value', optionId: selected, value: '직접 확인한 2개', expected: '직접 확인한 2개', source: 'manual-option'},
  {name: 'selected explicit manual blank', optionId: selected, value: '', expected: '', source: 'manual-option'},
  {name: 'common null reset', optionId: null, value: null, expected: '', source: 'empty'},
]) test(`normal public label ${name} confirms committed ACK and recovery GET`, async () => {
  const f = await fixture();
  try {
    const before = f.view, draft = {netContents: value};
    const ack = await f.save(before, [{optionId, fieldKey: 'netContents', value}]), recovered = await f.read();
    assert.deepEqual(recovered, ack);
    assert.equal(ack.revision, before.revision + 1);
    assert.equal(row(ack, optionId).values.netContents, expected);
    assert.equal(row(ack, optionId).automatic.netContents, '');
    assert.equal(row(ack, optionId).sources.netContents, source);
    const remaining = before.automaticSuggestions.entries.filter(entry => entry.fieldKey !== 'netContents' || optionId !== null && entry.optionId !== optionId);
    assert.deepEqual(ack.automaticSuggestions, {...before.automaticSuggestions, entries: remaining});
    assert.deepEqual(ack.overrides.common, before.overrides.common);
    assert.deepEqual(ack.overrides.options[sibling], before.overrides.options[sibling]);
    assert.equal(row(ack, selected).values.countryOfOrigin, '');
    assert.equal(row(ack, selected).sources.countryOfOrigin, 'manual-option');
    assert.equal(row(ack, selected).values.usageStandard, '');
    assert.equal(row(ack, selected).sources.usageStandard, 'manual-common');
    if (value === null) assert.equal(Object.hasOwn(ack.overrides.options[selected] ?? {}, 'netContents'), false);
    else assert.equal(ack.overrides.options[selected].netContents, value);
    if (optionId === selected) {
      assert.equal(row(ack, null).values.netContents, '1개');
      assert.equal(row(ack, sibling).values.netContents, '1개');
    } else for (const id of [selected, sibling]) {
      assert.equal(row(ack, id).values.netContents, '');
      assert.equal(row(ack, id).sources.netContents, 'empty');
    }
    assert.equal(f.provider.calls.length, 0);
    assert.deepEqual(f.h.network, []);
    for (const saved of [ack, recovered]) assert.doesNotThrow(() => f.model.verifyProductLabelSave(before, saved, optionId, draft));
  } finally { f.close(); }
});

test('normal common reset omits an exhausted suggestion layer without creating manual blanks', async () => {
  const f = await fixture();
  try {
    const before = f.view, draft = {netContents: null, material: null, productType: null};
    const changes = Object.keys(draft).map(fieldKey => ({optionId: null, fieldKey, value: null}));
    const ack = await f.save(before, changes), recovered = await f.read();
    assert.equal(Object.hasOwn(ack, 'automaticSuggestions'), false);
    assert.deepEqual(ack.overrides, before.overrides);
    for (const id of [null, selected, sibling]) for (const fieldKey of Object.keys(draft)) {
      assert.equal(row(ack, id).automatic[fieldKey], '');
      assert.equal(row(ack, id).values[fieldKey], '');
      assert.equal(row(ack, id).sources[fieldKey], 'empty');
    }
    for (const saved of [ack, recovered]) assert.doesNotThrow(() => f.model.verifyProductLabelSave(before, saved, null, draft));
  } finally { f.close(); }
});

test('normal structure save removes only suggestions for the deleted field', async () => {
  const f = await fixture();
  try {
    const before = f.view, structure = f.model.productLabelStructure(before).filter(field => field.id !== 'material');
    const ack = await f.save(before, [], {structure}), recovered = await f.read();
    assert.deepEqual(ack.automaticSuggestions, {...before.automaticSuggestions, entries: before.automaticSuggestions.entries.filter(entry => entry.fieldKey !== 'material')});
    assert.deepEqual(ack.overrides, before.overrides);
    for (const saved of [ack, recovered]) assert.doesNotThrow(() => f.model.verifyProductLabelSave(before, saved, selected, {}, structure));
  } finally { f.close(); }
});

test('inactive stored label suggestion cannot relax content equality during normal reset', async () => {
  const f = await fixture();
  try {
    assert.equal(row(f.view, selected).sources.material, 'label-default');
    const store = f.h.load('db/product-content.ts'), content = await store.readProductContent('owner', f.id), revision = content.revision;
    content.revision++;
    content.label.material = {value: '직접 확인한 면 소재', provenance: 'manual', updatedAt: new Date().toISOString()};
    assert.ok(await store.saveProductContent('owner', content, revision));
    const before = await f.read(), draft = {material: null};
    assert.ok(before.automaticSuggestions.entries.some(entry => entry.optionId === selected && entry.fieldKey === 'material' && entry.value === '상세정보참조'));
    assert.equal(row(before, selected).automatic.material, '직접 확인한 면 소재');
    assert.equal(row(before, selected).sources.material, 'content');
    const ack = await f.save(before, [{optionId: selected, fieldKey: 'material', value: null}]), recovered = await f.read();
    assert.equal(row(ack, selected).automatic.material, '직접 확인한 면 소재');
    assert.equal(row(ack, selected).values.material, '직접 확인한 면 소재');
    assert.equal(row(ack, selected).sources.material, 'content');
    assert.ok(!ack.automaticSuggestions.entries.some(entry => entry.optionId === selected && entry.fieldKey === 'material'));
    for (const saved of [ack, recovered]) assert.doesNotThrow(() => f.model.verifyProductLabelSave(before, saved, selected, draft));
    assert.equal(f.provider.calls.length, 0);
    assert.deepEqual(f.h.network, []);
    const forged = plain(ack);
    row(forged, selected).automatic.material = row(forged, selected).values.material = '위조한 폴리에스테르';
    assert.throws(() => f.model.verifyProductLabelSave(before, forged, selected, draft));
  } finally { f.close(); }
});

test('normal public reset still rejects unrelated automatic, suggestion, source and snapshot tampering', async () => {
  const f = await fixture();
  try {
    const before = f.view, draft = {netContents: null}, ack = await f.save(before, [{optionId: selected, fieldKey: 'netContents', value: null}]);
    const mutations = [
      ['unrelated automatic cell', view => { row(view, sibling).automatic.netContents = '99개'; row(view, sibling).values.netContents = '99개'; }],
      ['retained automatic source', view => { row(view, sibling).sources.netContents = 'label-suggestion'; }],
      ['removed cell source', view => { row(view, selected).sources.netContents = 'label-default'; }],
      ['unrequested suggestion removal', view => { view.automaticSuggestions.entries.splice(0, 1); }],
      ['restored removed suggestion', view => { view.automaticSuggestions.entries.push(before.automaticSuggestions.entries.find(entry => entry.optionId === selected && entry.fieldKey === 'netContents')); }],
      ['retained suggestion value', view => { view.automaticSuggestions.entries[0].value = '99개'; }],
      ['retained suggestion classification', view => { view.automaticSuggestions.entries[0].classification = 'suggestion'; }],
      ['suggestion basis', view => { view.automaticSuggestions.basis += ' changed'; }],
      ['suggestion policy', view => { view.automaticSuggestions.policy = 'forged-policy'; }],
      ['manual blank value', view => { row(view, selected).values.countryOfOrigin = '위조'; }],
      ['manual blank source', view => { row(view, selected).sources.countryOfOrigin = 'empty'; }],
      ['unrequested override', view => { view.overrides.options[sibling].manufacturer = '위조'; row(view, sibling).values.manufacturer = '위조'; }],
      ['category', view => { view.categoryContext.categoryId = '99999'; }],
      ['row identity', view => { row(view, sibling).optionLabel = '다른 옵션'; }],
      ['content clock', view => { view.contentRevision++; }],
      ['option clock', view => { view.optionRevision++; }],
      ['quotation clock', view => { view.quotationRevision++; }],
      ['label clock', view => { view.revision++; }],
      ['stale product clock', view => { view.productVersion = before.productVersion; view.updatedAt = before.productVersion; }],
      ['unmatched product clock', view => { view.updatedAt = before.productVersion; }],
      ['render epoch', view => { view.renderEpoch = (view.renderEpoch ?? 0) + 1; }],
      ['structure', view => { view.structure = f.model.productLabelStructure(view).reverse(); }],
      ['image keys', view => { view.imageKeys.push('owner/unrequested.png'); }],
    ];
    for (const [name, mutate] of mutations) {
      const altered = plain(ack); mutate(altered);
      assert.throws(() => f.model.verifyProductLabelSave(before, altered, selected, draft), undefined, name);
    }
  } finally { f.close(); }
});
