import test from 'node:test';
import assert from 'node:assert/strict';
import { seoWorkspaceHarness } from './helpers/seo-workspace.mjs';
import { seoWorkspaceEditor, plain, responseJson } from './helpers/seo-workspace-editor.mjs';

// Retained current main SHA36a8e3252cba8096da3e9b06eaf3c338699dce35280a0080484a5c7181d20fb7:
// SEO writer [185110,187401); applyBundleSuffixToSeoOptions [187402,188322)
// SHA91d37d01e580d45c2ba8813e980550e2039af0060cb2ab1d572d5c9e1257d463.
// Parent requested name wins over a same-request child name/blank. Current
// quantity is used; the requested parent map is not recursively rewritten.
function bundled(api) {
  const options = structuredClone(api.options), parent = options.rows[0];
  parent.translatedName = '검정';
  const child = { ...structuredClone(parent), id: 'child', translatedName: '과거 직접 번들명', unitsPerPack: 5, included: true },
    excluded = { ...structuredClone(parent), id: 'excluded-child', translatedName: '검정 (4개묶음)', unitsPerPack: 4, included: false },
    released = { ...structuredClone(parent), id: 'released-child', translatedName: '해제한 이름 유지', unitsPerPack: 1, included: true };
  for (const row of [parent, child, excluded, released]) row.provenance.translatedName = 'manual';
  options.rows.push(child, excluded, released);
  options.bundleSources = { child: { sourceOptionId: parent.id, quantity: 2 }, 'excluded-child': { sourceOptionId: parent.id, quantity: 4 },
    'released-child': { sourceOptionId: parent.id, quantity: 3 } };
  api.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(options), api.id);
  return { options, parent, child, excluded, released };
}
function withoutNameEdit(row) {
  const value = structuredClone(row); delete value.translatedName; delete value.updatedAt; delete value.provenance.translatedName; return value;
}

for (const companyCode of ['A01464742', 'A01526306']) test(`explicit SEO parent save reaches direct bundle names, reopened UI and quotation labels (${companyCode})`, async () => {
  const api = seoWorkspaceHarness({ companyCode }), seed = bundled(api), before = api.stored();
  let lost = companyCode === 'A01526306', ui;
  try {
    ui = seoWorkspaceEditor(api, { fetcher: async (url, init, route) => {
      const response = await route(url, init);
      if (init?.method === 'PATCH' && lost) { lost = false; throw Error('synthetic committed SEO ACK lost'); }
      return response;
    } });
    await ui.idle(); ui.edit('1번째 한국어 옵션명', '남색');
    assert.equal(api.stored().options.payload, before.options.payload, 'local name edit does not write');
    await ui.click('SEO 설정 저장');
    if (companyCode === 'A01526306') {
      assert.equal(ui.saved, 0); const offset = ui.calls.length;
      await ui.click('SEO 저장 결과 확인');
      assert.ok(ui.calls.slice(offset).every(call => call.method === 'GET'), 'lost ACK recovery is read only');
    }
    assert.equal(ui.saved, 1); assert.equal(ui.calls.filter(call => call.method === 'PATCH').length, 1);
    const saved = await responseJson(await api.request()), byId = new Map(saved.options.rows.map(row => [row.id, row]));
    assert.equal(byId.get(seed.parent.id).translatedName, '남색'); assert.equal(byId.get('child').translatedName, '남색 (5개묶음)');
    assert.equal(byId.get('excluded-child').translatedName, '남색 (4개묶음)');
    assert.deepEqual(byId.get('released-child'), seed.released); assert.deepEqual(byId.get('second'), seed.options.rows[1]);
    assert.equal(saved.options.revision, seed.options.revision + 1); assert.equal(saved.options.updatedAt, saved.productVersion);
    assert.deepEqual(saved.options.bundleSources, seed.options.bundleSources);
    for (const row of seed.options.rows) {
      const next = byId.get(row.id); assert.deepEqual(withoutNameEdit(next), withoutNameEdit(row), 'name edits retain every price/image/packaging/inclusion fact');
      if ([seed.parent.id, 'child', 'excluded-child'].includes(row.id)) {
        assert.equal(next.provenance.translatedName, 'manual'); assert.equal(next.updatedAt, saved.productVersion);
      }
    }
    assert.deepEqual(api.stored().quotation, before.quotation); assert.deepEqual(api.stored().content, before.content);
    const quoteRoute = api.load('app/api/products/[id]/quotation-fields/route.ts'), q = await responseJson(await quoteRoute.GET(
      new Request('https://app.test/api/products/' + api.id + '/quotation-fields'), { params: Promise.resolve({ id: api.id }) }));
    assert.equal(q.resolved.rows.find(row => row.optionId === 'child').optionLabel, '남색 (5개묶음)');
    assert.equal(q.resolved.rows.find(row => row.optionId === 'excluded-child').optionLabel, '남색 (4개묶음)');
    assert.equal(q.resolved.rows.find(row => row.optionId === 'excluded-child').included, false);
    assert.equal(q.resolved.rows.find(row => row.optionId === seed.parent.id).fields.title.value, '직접 견적 이름', 'manual quotation title remains independent');
    ui.close(); ui = seoWorkspaceEditor(api, { props: { version: saved.productVersion } }); await ui.idle();
    assert.equal(ui.input('3번째 한국어 옵션명').props.value, '남색 (5개묶음)'); assert.equal(ui.input('4번째 한국어 옵션명').props.value, '남색 (4개묶음)');
    assert.ok(ui.calls.every(call => call.method === 'GET')); assert.equal(ui.render().props['data-workspace-dirty'], false);
  } finally { ui?.close(); api.close(); }
});

test('changed truthy parent wins over same-request child edits and blank, while child-only and empty-parent edits remain exact', () => {
  const api = seoWorkspaceHarness(); try {
    const { options, parent } = bundled(api), apply = api.load('app/option-seo-names.ts').applyOptionNameChanges, before = JSON.stringify(options), now = '2026-10-19T01:00:00.000Z';
    for (const value of ['직접 자식 입력', '']) {
      const saved = apply(options, [{ optionId: parent.id, value: '남색' }, { optionId: 'child', value }], now);
      assert.equal(saved.rows.find(row => row.id === 'child').translatedName, '남색 (5개묶음)');
      assert.equal(apply(options, [{ optionId: 'child', value }], now).rows.find(row => row.id === 'child').translatedName, value);
      const cleared = apply(options, [{ optionId: parent.id, value: '' }, { optionId: 'child', value }], now);
      assert.equal(cleared.rows[0].translatedName, ''); assert.equal(cleared.rows.find(row => row.id === 'child').translatedName, value);
    }
    assert.equal(apply(options, [{ optionId: parent.id, value: '  ' }], now).rows.find(row => row.id === 'child').translatedName, '   (5개묶음)', 'source truthy whitespace and suffix stripping do not trim');
    assert.equal(apply(options, [{ optionId: parent.id, value: '검정' }], now).rows.find(row => row.id === 'child').translatedName, '과거 직접 번들명', 'retyping unchanged parent does not migrate existing child names');
    assert.equal(JSON.stringify(options), before);
  } finally { api.close(); }
});

test('nested bundles use only explicit direct parent names, current quantities and one trailing suffix', () => {
  const api = seoWorkspaceHarness(); try {
    const { options, parent } = bundled(api), child = options.rows.find(row => row.id === 'child');
    options.rows.push({ ...structuredClone(child), id: 'grandchild', translatedName: '기존 손자 (2개묶음)', unitsPerPack: 2 });
    options.bundleSources.grandchild = { sourceOptionId: 'child', quantity: 2 };
    const apply = api.load('app/option-seo-names.ts').applyOptionNameChanges, now = '2026-10-19T01:00:00.000Z';
    const direct = apply(options, [{ optionId: parent.id, value: '남색 (8개묶음)  ' }], now);
    assert.equal(direct.rows.find(row => row.id === 'child').translatedName, '남색 (5개묶음)');
    assert.equal(direct.rows.find(row => row.id === 'grandchild').translatedName, '기존 손자 (2개묶음)', 'derived child is not a transitive request');
    const both = apply(options, [{ optionId: parent.id, value: '남색' }, { optionId: 'child', value: '직접 중간' }], now);
    assert.equal(both.rows.find(row => row.id === 'child').translatedName, '남색 (5개묶음)');
    assert.equal(both.rows.find(row => row.id === 'grandchild').translatedName, '직접 중간 (2개묶음)', 'grandchild uses original explicit child input, as recorded source does');
  } finally { api.close(); }
});

test('missing historical rows and source-less selling packs are not inferred or restored by an unrelated name save', () => {
  const api = seoWorkspaceHarness(); try {
    const { options, parent } = bundled(api), apply = api.load('app/option-seo-names.ts').applyOptionNameChanges, now = '2026-10-19T01:00:00.000Z';
    options.bundleSources.removed = { sourceOptionId: parent.id, quantity: 7 };
    options.bundleSources.child = { sourceOptionId: 'removed-source', quantity: 2 };
    const before = plain(options), saved = apply(options, [{ optionId: parent.id, value: '남색' }], now);
    assert.deepEqual(saved.rows.find(row => row.id === 'child'), before.rows.find(row => row.id === 'child'));
    assert.equal(saved.rows.some(row => row.id === 'removed'), false);
    const noLineage = { ...options, bundleSources: undefined };
    assert.deepEqual(apply(noLineage, [{ optionId: parent.id, value: '남색' }], now).rows.find(row => row.id === 'child'), before.rows.find(row => row.id === 'child'));
  } finally { api.close(); }
});

test('a valid 500-character parent whose derived bundle name exceeds 500 rejects the actual whole SEO transaction', async () => {
  const api = seoWorkspaceHarness(); try {
    const seed = bundled(api), before = api.stored(), mutations = api.mutations.length;
    const response = await api.request('PATCH', { expectedProductVersion: api.version, expectedContentRevision: api.content.revision,
      expectedOptionRevision: seed.options.revision, seo: { title: '같이 저장하면 안 됨' }, optionNames: [{ optionId: seed.parent.id, value: '가'.repeat(500) }] });
    assert.equal(response.status, 400); assert.match((await response.json()).error, /500자/);
    assert.deepEqual(api.stored(), before); assert.equal(api.mutations.length, mutations, 'no product/content/option partial save');
  } finally { api.close(); }
});
