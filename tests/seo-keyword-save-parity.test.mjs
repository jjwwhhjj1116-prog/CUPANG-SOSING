import test from 'node:test';
import assert from 'node:assert/strict';
import { seoWorkspaceHarness } from './helpers/seo-workspace.mjs';

const input = (h, keywordText) => ({ expectedProductVersion: h.version, expectedContentRevision: h.content.revision, expectedOptionRevision: h.options.revision,
  seo: { keywordText }, optionNames: [{ optionId: h.options.rows[0].id, value: '수정 옵션' }] });
const plain = value => JSON.parse(JSON.stringify(value));

for (const companyCode of ['A01464742', 'A01526306']) {
  for (const [name, raw, expected] of [
    ['duplicate and newline tags', 'a\nb, c, a\nb', ['a b', 'c']],
    ['compact75 duplicate tags', Array(75).fill('a').join(','), ['a']],
    ['151 raw prefix removal followed by service20 exclusion', 'a'.repeat(147) + ',b,c', ['b']],
    ['first oversized tag becomes explicit manual blank', 'a'.repeat(151) + ', b', []],
  ]) test(`${companyCode}: actual atomic API preserves ${name} through readback and stage7`, async () => {
    const h = seoWorkspaceHarness({ companyCode });
    try {
      const before = h.stored(), body = input(h, raw), validated = h.load('app/seo-workspace.ts').validateSeoWorkspaceInput(body);
      assert.deepEqual(plain(validated.seo.keywords), expected); assert.equal(validated.seo.keywordText, raw);
      assert.deepEqual(plain(h.load('app/seo-workspace.ts').validateSeoWorkspaceInput(validated)), plain(validated));
      const response = await h.request('PATCH', validated); assert.equal(response.status, 200, await response.clone().text());
      const saved = await response.json(), reread = await (await h.request()).json();
      assert.deepEqual(saved.content.seo.keywords.value, expected); assert.equal(saved.content.seo.keywords.provenance, 'manual');
      assert.deepEqual(reread, saved); assert.equal(saved.content.intakeKeywordSeed, undefined);
      assert.equal(Object.hasOwn(saved.content.seo, 'keywordText'), false); assert.deepEqual(saved.content.assets, h.content.assets); assert.deepEqual(saved.content.label, h.content.label);
      assert.deepEqual(h.stored().quotation, before.quotation);
      for (const key of Object.keys(before.product).filter(key => !['updated_at', 'quote_status'].includes(key))) assert.deepEqual(h.stored().product[key], before.product[key], key);
      assert.equal(saved.options.rows[0].packagedWeightG, 350); assert.equal(saved.options.rows[0].unitCostCny, 2.99);
      const route = h.load('app/api/products/[id]/quotation-fields/route.ts');
      const quotation = await route.GET(new Request('https://app.test/api/products/' + h.id + '/quotation-fields'), { params: Promise.resolve({ id: h.id }) });
      assert.equal(quotation.status, 200); const fields = await quotation.json();
      assert.equal(fields.automatic.rows.find(row => row.optionId === h.options.rows[0].id).fields.searchTags.value, expected.join(', '));
      assert.equal(fields.resolved.rows.find(row => row.optionId === h.options.rows[0].id).fields.title.value, '직접 견적 이름');
      const second = fields.resolved.rows.find(row => row.optionId === 'second'); assert.equal(second.fields.labelImages.value, ''); assert.equal(second.fields.salePrice.value, '');
      assert.equal(h.mutations.filter(value => value.sql.startsWith('UPDATE products')).length, 1);
    } finally { h.close(); }
  });
  test(`${companyCode}: keyword proof mismatch or malformed input rejects all fields with no writes`, async () => {
    const h = seoWorkspaceHarness({ companyCode });
    try {
      const before = h.stored();
      for (const seo of [
        { keywordText: 'a,a', keywords: ['a', 'a'] }, { keywordText: 'a,b', keywords: ['b', 'a'] }, { keywordText: 'a', keywords: 'a' },
        { keywordText: 'a', keywords: [1] }, { keywordText: null }, { keywordText: '\u0000' }, { keywordText: 'a'.repeat(5051) },
        { keywordText: 'a', sourceKey: 'foreign' }, { keywords: ['a'.repeat(90), 'b'.repeat(90)] },
      ]) {
        const response = await h.request('PATCH', { ...input(h, ''), seo: { title: 'must not partially save', ...seo } });
        assert.equal(response.status, 400, await response.clone().text()); assert.deepEqual(h.stored(), before);
      }
      assert.equal(h.mutations.length, 0);
    } finally { h.close(); }
  });
  test(`${companyCode}: metadata keeps all cleaned tags while each document gets only its150 prefix`, async () => {
    const h = seoWorkspaceHarness({ companyCode });
    try {
      const keywords = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'];
      const response = await h.request('PATCH', input(h, keywords.join(','))); assert.equal(response.status, 200);
      const saved = await response.json(); assert.deepEqual(saved.content.seo.keywords.value, keywords);
      assert.equal(saved.content.seoKeywordDocument.value, keywords.slice(0, 50).join(', '));
      const route = h.load('app/api/products/[id]/quotation-fields/route.ts');
      const fields = await (await route.GET(new Request('https://app.test/api/products/' + h.id + '/quotation-fields'), { params: Promise.resolve({ id: h.id }) })).json();
      for (const row of fields.automatic.rows) assert.equal(row.fields.searchTags.value, keywords.slice(0, 50).join(', '));
      assert.equal(fields.resolved.rows[0].fields.title.value, '직접 견적 이름');
    } finally { h.close(); }
  });
  test(`${companyCode}: empty cleaned metadata preserves the previous document and manual keyword override`, async () => {
    const h = seoWorkspaceHarness({ companyCode });
    try {
      const previous = structuredClone(h.content); previous.seo.keywords.value = ['이전 문서 태그'];
      h.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(previous), h.id);
      const quotation = JSON.parse(h.stored().quotation.payload); quotation.overrides.options.second.searchTags = '';
      h.sqlite.prepare('UPDATE product_quotation_fields SET payload=? WHERE product_id=?').run(JSON.stringify(quotation), h.id);
      const response = await h.request('PATCH', input(h, 'ㄱ invalid, ' + 'a'.repeat(21))); assert.equal(response.status, 200);
      const saved = await response.json(); assert.deepEqual(saved.content.seo.keywords.value, []); assert.equal(saved.content.seoKeywordDocument.value, '이전 문서 태그');
      assert.equal(saved.content.intakeKeywordSeed, undefined);
      const route = h.load('app/api/products/[id]/quotation-fields/route.ts');
      const fields = await (await route.GET(new Request('https://app.test/api/products/' + h.id + '/quotation-fields'), { params: Promise.resolve({ id: h.id }) })).json();
      for (const row of fields.automatic.rows) assert.equal(row.fields.searchTags.value, '이전 문서 태그');
      assert.equal(fields.resolved.rows.find(row => row.optionId === 'second').fields.searchTags.value, '');
      assert.deepEqual(JSON.parse(h.stored().quotation.payload), quotation);
    } finally { h.close(); }
  });
}

test('legacy array-only clients retain their former normalized validation contract', () => {
  const h = seoWorkspaceHarness();
  try {
    const body = input(h, 'a,a'); body.seo = { keywords: ['a', 'a', ' b '] };
    assert.deepEqual(plain(h.load('app/seo-workspace.ts').validateSeoWorkspaceInput(body).seo), { keywords: ['a', 'b'] });
    for (const keywords of [Array(51).fill('a'), ['a'.repeat(101)], ['a'.repeat(90), 'b'.repeat(90)]])
      assert.throws(() => h.load('app/seo-workspace.ts').validateSeoWorkspaceInput({ ...body, seo: { keywords } }), /50개|100자|150자/);
  } finally { h.close(); }
});
