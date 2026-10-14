import test from 'node:test';
import assert from 'node:assert/strict';
import { seoWorkspaceHarness } from './helpers/seo-workspace.mjs';

const input = h => ({ expectedProductVersion: h.version, expectedContentRevision: h.content.revision, expectedOptionRevision: h.options.revision,
  seo: { title: '수정한 상품명', keywords: ['수정 태그', '다른 태그'] }, optionNames: [{ optionId: h.options.rows[0].id, value: '수정한 옵션명' }] });
for (const companyCode of ['A01464742', 'A01526306']) {
  test(`one stage-one save atomically commits title/tags and names, preserving all unrelated data (${companyCode})`, async () => {
    const h = seoWorkspaceHarness({ companyCode });
    try {
      const before = h.stored(), response = await h.request('PATCH', input(h)), body = await response.json(), saved = h.stored();
      assert.equal(response.status, 200); assert.deepEqual(h.batches.at(-1), 3);
      assert.equal(body.content.revision, h.content.revision + 1); assert.equal(body.options.revision, h.options.revision + 1);
      assert.equal(body.content.updatedAt, body.productVersion); assert.equal(body.options.updatedAt, body.productVersion);
      assert.equal(body.content.seo.title.value, '수정한 상품명'); assert.equal(body.options.rows[0].translatedName, '수정한 옵션명');
      assert.equal(body.content.seo.title.provenance, 'manual'); assert.equal(body.options.rows[0].provenance.translatedName, 'manual');
      assert.deepEqual(body.content.assets, h.content.assets); assert.deepEqual(body.content.label, h.content.label); assert.deepEqual(body.content.detail, h.content.detail);
      assert.deepEqual(body.options.rows[1], h.options.rows[1]);
      const changed = body.options.rows[0], original = h.options.rows[0];
      for (const key of Object.keys(original).filter(key => !['translatedName', 'provenance', 'updatedAt'].includes(key))) assert.deepEqual(changed[key], original[key], key);
      assert.equal(changed.provenance.unitCostCny, original.provenance.unitCostCny); assert.equal(changed.packagedWeightG, 350);
      assert.deepEqual(saved.quotation, before.quotation);
      for (const key of Object.keys(before.product).filter(key => !['updated_at', 'quote_status'].includes(key))) assert.deepEqual(saved.product[key], before.product[key], key);
      assert.deepEqual((await (await h.request()).json()).content, body.content); assert.deepEqual((await (await h.request()).json()).options, body.options);
      assert.equal(h.mutations.filter(item => item.sql.startsWith('UPDATE products')).length, 1);
    } finally { h.close(); }
  });
  test(`section-only save keeps the absent table byte-identical and handles legacy oversized SEO (${companyCode})`, async () => {
    for (const section of ['seo', 'optionNames']) {
      const h = seoWorkspaceHarness({ companyCode });
      try {
        if (section === 'optionNames') { const legacy = structuredClone(h.content); legacy.seo.title.value = '옛'.repeat(120); h.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(legacy), h.id); }
        const before = h.stored(), patch = input(h); delete patch[section === 'seo' ? 'optionNames' : 'seo'];
        const response = await h.request('PATCH', patch), after = h.stored(); assert.equal(response.status, 200);
        assert.deepEqual(after[section === 'seo' ? 'options' : 'content'], before[section === 'seo' ? 'options' : 'content']);
        assert.equal(h.batches.at(-1), 2);
      } finally { h.close(); }
    }
  });
  test(`explicit same blanks are manual and cannot resurrect an option or keyword seed (${companyCode})`, async () => {
    const h = seoWorkspaceHarness({ companyCode });
    try {
      const value = input(h); value.seo = { title: '', keywords: [] }; value.optionNames[0].value = '';
      const response = await h.request('PATCH', value), body = await response.json(); assert.equal(response.status, 200);
      assert.equal(body.content.seo.title.value, ''); assert.deepEqual(body.content.seo.keywords.value, []); assert.equal(body.content.intakeKeywordSeed, undefined);
      assert.equal(body.options.rows[0].translatedName, ''); assert.equal(body.options.rows[0].provenance.translatedName, 'manual');
    } finally { h.close(); }
  });
  test(`saved stage-one title/tags/name feed stage seven while manual quotation overrides remain authoritative (${companyCode})`, async () => {
    const h = seoWorkspaceHarness({ companyCode });
    try {
      const response = await h.request('PATCH', input(h)); assert.equal(response.status, 200);
      const result = await h.load('app/api/products/[id]/quotation-fields/route.ts').GET(new Request('https://app.test/api/products/' + h.id + '/quotation-fields'), { params: Promise.resolve({ id: h.id }) });
      assert.equal(result.status, 200); const view = await result.json();
      const generated = view.automatic.rows.find(row => row.optionId === h.options.rows[0].id);
      assert.equal(generated.fields.title.value, '수정한 상품명, 수정한 옵션명'); assert.equal(generated.fields.searchTags.value, '수정 태그, 다른 태그');
      assert.equal(view.resolved.rows.find(row => row.optionId === h.options.rows[0].id).fields.title.value, '직접 견적 이름');
      const second = view.resolved.rows.find(row => row.optionId === 'second'); assert.equal(second.fields.salePrice.value, ''); assert.equal(second.fields.labelImages.value, '');
      assert.equal(generated.fields.packagedWeightG.value, '350');
    } finally { h.close(); }
  });
}

test('invalid names or malformed/oversized SEO reject the entire request without partial writes', async () => {
  const h = seoWorkspaceHarness();
  try {
    const valid = input(h), before = h.stored();
    const bad = [ { ...valid, company: 'other' }, { ...valid, seo: {} }, { ...valid, seo: { title: 'x'.repeat(101) } },
      { ...valid, seo: { keywords: ['x'.repeat(90), 'y'.repeat(90)] } }, { ...valid, seo: { assets: [] } }, { ...valid, optionNames: [] },
      { ...valid, optionNames: [valid.optionNames[0], valid.optionNames[0]] }, { ...valid, optionNames: [{ optionId: 'foreign', value: '잘못된 이름' }] },
      { ...valid, optionNames: [{ optionId: valid.optionNames[0].optionId, value: 'x'.repeat(501) }] }, { ...valid, expectedOptionRevision: -1 },
      { ...valid, seo: null }, { ...valid, expectedProductVersion: 'bad' } ];
    for (const value of bad) assert.equal((await h.request('PATCH', value)).status, 400);
    assert.deepEqual(h.stored(), before); assert.equal(h.mutations.length, 0);
    assert.equal((await h.request('PATCH', valid, { origin: 'https://evil.test' })).status, 400);
    assert.equal((await h.request('PATCH', valid, { 'content-type': 'text/plain' })).status, 400);
    assert.equal((await h.request('PATCH', '{bad')).status, 400);
    assert.equal((await h.request('PATCH', 'x'.repeat(512 * 1024 + 1))).status, 413);
  } finally { h.close(); }
});

test('authentication and foreign ownership reject both read and write', async () => {
  for (const settings of [{ authenticated: false }, { owner: 'another-owner' }]) {
    const h = seoWorkspaceHarness(settings);
    try { const before = h.stored(), status = settings.authenticated === false ? 503 : 404;
      assert.equal((await h.request()).status, status); assert.equal((await h.request('PATCH', input(h))).status, status);
      assert.deepEqual(h.stored(), before); assert.equal(h.mutations.length, 0);
    } finally { h.close(); }
  }
});

for (const stale of ['expectedProductVersion', 'expectedContentRevision', 'expectedOptionRevision']) test(`stale ${stale} cannot partially save either section`, async () => {
  const h = seoWorkspaceHarness();
  try { const before = h.stored(), patch = input(h); patch[stale] = stale.endsWith('Version') ? '2026-10-13T00:00:00.000Z' : patch[stale] + 1;
    assert.equal((await h.request('PATCH', patch)).status, 409); assert.deepEqual(h.stored(), before); assert.equal(h.mutations.length, 0);
  } finally { h.close(); }
});

for (const boundary of ['product', 'content', 'options', 'removed', 'foreign-content', 'foreign-options']) test(`atomic CAS rejects a ${boundary} writer race before either section commits`, async () => {
  const h = seoWorkspaceHarness();
  try {
    let raced;
    h.race(() => {
      if (boundary === 'product') h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2026-10-14T01:00:00.100Z', h.id);
      if (boundary === 'content' || boundary === 'options') h.sqlite.prepare(`UPDATE product_${boundary} SET revision=revision+1 WHERE product_id=?`).run(h.id);
      if (boundary === 'removed') h.sqlite.prepare('INSERT INTO product_removals VALUES(?,?,?,?)').run(h.id, 'owner', h.version, h.version);
      if (boundary.startsWith('foreign-')) h.sqlite.prepare(`UPDATE product_${boundary.slice(8)} SET owner_id='foreign' WHERE product_id=?`).run(h.id);
      raced = h.stored();
    });
    assert.equal((await h.request('PATCH', input(h))).status, 409); assert.deepEqual(h.stored(), raced);
  } finally { h.close(); }
});

test('a failure after the first SQL section rolls back product and content with no partial state', async () => {
  const h = seoWorkspaceHarness();
  try {
    h.sqlite.exec("CREATE TRIGGER fail_seo_names BEFORE UPDATE ON product_options BEGIN SELECT RAISE(ABORT, 'fixture atomic rollback'); END");
    const before = h.stored(); assert.equal((await h.request('PATCH', input(h))).status, 503); assert.deepEqual(h.stored(), before);
  } finally { h.close(); }
});

test('coherent GET refuses a product clock change between source reads', async () => {
  const h = seoWorkspaceHarness();
  try { h.findRace(count => { if (count === 2) h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2026-10-14T01:00:00.100Z', h.id); });
    assert.equal((await h.request()).status, 409); assert.equal(h.mutations.length, 0);
  } finally { h.close(); }
});

test('removed product cannot open or save SEO, including removal between snapshot reads', async () => {
  for (const boundary of ['before', 'between']) {
    const h = seoWorkspaceHarness();
    try {
      const remove = () => h.sqlite.prepare('INSERT INTO product_removals VALUES(?,?,?,?)').run(h.id, 'owner', h.version, h.version);
      if (boundary === 'before') remove(); else h.findRace(count => { if (count === 2) remove(); });
      const before = h.stored(); assert.equal((await h.request()).status, boundary === 'before' ? 404 : 409);
      assert.equal((await h.request('PATCH', input(h))).status, 404); assert.deepEqual(h.stored(), before); assert.equal(h.mutations.length, 0);
    } finally { h.close(); }
  }
});
