import test from 'node:test';
import assert from 'node:assert/strict';
import { seoWorkspaceHarness } from './helpers/seo-workspace.mjs';
const plain = value => JSON.parse(JSON.stringify(value));
const body = (h, seo) => ({ expectedProductVersion: h.version, expectedContentRevision: h.content.revision, expectedOptionRevision: h.options.revision, seo });
async function fields(h) {
  const response = await h.load('app/api/products/[id]/quotation-fields/route.ts').GET(new Request('https://app.test/api/products/' + h.id + '/quotation-fields'), { params: Promise.resolve({ id: h.id }) });
  assert.equal(response.status, 200, await response.clone().text()); return response.json();
}
function privateBlank(h) {
  const q = JSON.parse(h.stored().quotation.payload); q.overrides.options.second.title = '';
  h.sqlite.prepare('UPDATE product_quotation_fields SET payload=? WHERE product_id=?').run(JSON.stringify(q), h.id);
}
for (const companyCode of ['A01464742', 'A01526306']) {
  for (const seo of [{ title: '직접 저장한 공통 SEO 상품명' }, { keywordText: '새 태그' }, { title: '', keywordText: '공란 제목 검토' }])
    test(`${companyCode}: manual SEO save reads base document title while preserving option and manual quotation values ${JSON.stringify(seo)}`, async () => {
      const h = seoWorkspaceHarness({ companyCode });
      try {
        privateBlank(h); const before = h.stored(), request = { ...body(h, seo), optionNames: [{ optionId: h.options.rows[0].id, value: '수정 한글 옵션' }] };
        const response = await h.request('PATCH', request); assert.equal(response.status, 200, await response.clone().text());
        const saved = await response.json(), reread = await (await h.request()).json(); assert.deepEqual(reread, saved);
        const marker = saved.content.seoTitleDocument; assert.equal(marker.policy, 'couplus-seo-save-v1');
        assert.equal(marker.value, saved.content.seo.title.value); assert.equal(marker.sourceUpdatedAt, saved.content.seo.title.updatedAt);
        const q = await fields(h); for (const row of q.automatic.rows) assert.equal(row.fields.title.value, marker.value);
        assert.equal(q.resolved.rows.find(row => row.optionId === h.options.rows[0].id).fields.title.value, '직접 견적 이름');
        assert.equal(q.resolved.rows.find(row => row.optionId === 'second').fields.title.value, '');
        assert.equal(saved.options.rows[0].translatedName, '수정 한글 옵션'); assert.deepEqual(h.stored().quotation, before.quotation);
        assert.deepEqual(saved.content.assets, h.content.assets); assert.deepEqual(saved.content.label, h.content.label);
        assert.deepEqual(saved.content.seo.description, h.content.seo.description); assert.deepEqual(saved.content.detail, h.content.detail);
        for (const key of Object.keys(before.product).filter(key => !['updated_at', 'quote_status'].includes(key))) assert.deepEqual(h.stored().product[key], before.product[key], key);
      } finally { h.close(); }
    });
  test(`${companyCode}: body-description and option-only saves do not claim the manual SEO document policy`, async () => {
    for (const patch of [{ seo: { description: '직접 상세 본문' } }, { optionNames: [{ optionId: 'opt1', value: '이름만 변경' }] }]) {
      const h = seoWorkspaceHarness({ companyCode });
      try {
        if (patch.optionNames) patch.optionNames[0].optionId = h.options.rows[0].id;
        const response = await h.request('PATCH', { ...body(h, undefined), ...patch }); assert.equal(response.status, 200, await response.clone().text());
        const saved = await response.json(); assert.equal(saved.content.seoTitleDocument, undefined);
        const q = await fields(h), row = q.automatic.rows.find(value => value.optionId === h.options.rows[0].id);
        assert.equal(row.fields.title.value, saved.content.seo.title.value + ', ' + saved.options.rows[0].translatedName);
      } finally { h.close(); }
    }
  });
  test(`${companyCode}: later independent title value or clock invalidates the saved document basis`, async () => {
    const h = seoWorkspaceHarness({ companyCode });
    try {
      const response = await h.request('PATCH', body(h, { title: '저장 SEO 이름' })); assert.equal(response.status, 200);
      const saved = await response.json(), title = h.load('app/seo-title-document.ts').quotationSeoDocumentTitle;
      assert.equal(title(saved.content, '저장 SEO 이름', { translatedName: '옵션명' }), '저장 SEO 이름');
      for (const field of [{ ...saved.content.seo.title, value: '다른 writer 이름' }, { ...saved.content.seo.title, updatedAt: '2030-01-01T00:00:00.000Z' }]) {
        const content = plain(saved.content); content.seo.title = field;
        assert.equal(title(content, field.value, { translatedName: '옵션명' }), field.value + ', 옵션명');
      }
      for (const marker of [{ ...saved.content.seoTitleDocument, value: '다른 문서 이름' }, { ...saved.content.seoTitleDocument, policy: 'unknown' }, { ...saved.content.seoTitleDocument, injected: true }, null]) {
        const content = plain(saved.content); content.seoTitleDocument = marker;
        assert.equal(title(content, '저장 SEO 이름', { translatedName: '옵션명' }), '저장 SEO 이름, 옵션명');
      }
    } finally { h.close(); }
  });
  test(`${companyCode}: absent legacy title keeps its known product fallback, and clients cannot inject document proof`, async () => {
    const h = seoWorkspaceHarness({ companyCode });
    try {
      const legacy = plain(h.content); legacy.seo.title = { value: '', provenance: 'unverified', updatedAt: null };
      h.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(legacy), h.id);
      const response = await h.request('PATCH', body(h, { keywordText: '새 태그' })); assert.equal(response.status, 200);
      const saved = await response.json(); assert.equal(saved.content.seoTitleDocument, undefined);
      const title = h.load('app/seo-title-document.ts').quotationSeoDocumentTitle;
      assert.equal(title(saved.content, '보존된 원문 제목', { translatedName: '저장 옵션' }), '보존된 원문 제목, 저장 옵션');
      const malformed = plain(saved.content); malformed.seoTitleDocument = { policy: 'couplus-seo-save-v1', sourceTitle: '', sourceUpdatedAt: null, value: '' };
      assert.equal(title(malformed, '보존된 원문 제목', { translatedName: '저장 옵션' }), '보존된 원문 제목, 저장 옵션', 'an absent legacy title cannot assert an empty document policy');
      const before = h.stored(); const forged = await h.request('PATCH', { ...body(h, { title: '제목' }), seoTitleDocument: { value: '조작' } });
      assert.equal(forged.status, 400); assert.deepEqual(h.stored(), before);
    } finally { h.close(); }
  });
}
