import test from 'node:test';
import assert from 'node:assert/strict';
import { providedOptionModule as load } from './helpers/provided-option-quotation.mjs';
import { freeImageEditFixture } from './helpers/free-image-edit-api.mjs';
import { schemaCompanies } from './helpers/hub-schema.mjs';

const helper = load('app/free-image-editor-target.ts'), signal = () => new AbortController().signal;
const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
const key = 'owner/free-image-product-synthetic-result.png', version = '2026-10-23T01:00:00.000Z';
const selection = { productId: 'product', productVersion: version, sourceKey: key, role: 'main', profileId: 'profile' };
function view() {
  const schema = load('app/quotation-schema.ts').getQuotationSchema('80719');
  return { productVersion: version, revision: 3, optionRevision: 2, inputFingerprint: 'a'.repeat(64), imageKeys: [key], protectedDetailImageKeys: [],
    categoryContext: { source: 'profile', profileId: 'profile', categoryId: '80719', categoryPath: [] },
    resolved: { schema, rows: [{ optionId: 'one', included: true, fields: { mainImage: { value: key } } }] } };
}

test('generated dropdown selection resolves only a unique included current role and exact profile/version', async () => {
  const current = view(), calls = [], target = await helper.readSavedFreeImageQuotationTarget(selection, signal(), async (url, init) => {
    calls.push({ url, init }); return Response.json(current);
  });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/products/product/quotation-fields?profileId=profile');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.deepEqual(JSON.parse(JSON.stringify(target)), { kind: 'quotation', profileId: 'profile', input: 'mainImage', fieldKey: 'mainImage',
    optionId: 'one', slotIndex: 0, value: key, revision: 3, optionRevision: 2, inputFingerprint: 'a'.repeat(64) });
  for (const mutate of [value => { value.productVersion = 'changed'; }, value => { value.categoryContext.profileId = 'other'; },
    value => { value.imageKeys = []; }, value => { value.resolved.rows[0].included = false; },
    value => { value.resolved.rows[0].fields.mainImage.value = ''; },
    value => { value.resolved.rows[0].fields.mainImage.value = key + '\n' + key; },
    value => { value.resolved.schema.fields.find(field => field.id === 'mainImage').readOnly = true; },
    value => { value.resolved.rows.push({ ...value.resolved.rows[0], optionId: 'two' }); },
  ]) {
    const changed = structuredClone(current); mutate(changed);
    await assert.rejects(helper.readSavedFreeImageQuotationTarget(selection, signal(), async () => Response.json(changed)));
  }
  await assert.rejects(helper.readSavedFreeImageQuotationTarget({ ...selection, context: { profileId: 'profile', optionId: 'other', input: 'mainImage' } }, signal(), async () => Response.json(current)));
  for (const wrong of [{ sourceKey: 'owner/original.png' }, { productId: 'another-product' }, { role: 'detailTop' }]) {
    await assert.rejects(helper.readSavedFreeImageQuotationTarget({ ...selection, ...wrong }, signal(), async () => assert.fail('invalid selection must not request source')));
  }
});

test('explicit focused option disambiguates shared current references; inconsistent exact wires never do', async () => {
  const current = view(); current.resolved.rows.push({ ...current.resolved.rows[0], optionId: 'two' });
  const context = { profileId: 'profile', optionId: 'two', input: 'mainImage' };
  assert.equal((await helper.readSavedFreeImageQuotationTarget({ ...selection, context }, signal(), async () => Response.json(current))).optionId, 'two');
  const base = current.resolved.schema.fields.find(field => field.id === 'mainImage');
  current.resolved.schema.fields.push({ ...base, id: 'exact-main', hubInput: 'mainImage', hubWire: { path: ['imagePage', 'images', 'mainImage'] } });
  current.resolved.rows.forEach(row => { row.fields['exact-main'] = { value: key }; row.fields.mainImage.value = ''; });
  await assert.rejects(helper.readSavedFreeImageQuotationTarget({ ...selection, context }, signal(), async () => Response.json(current)), /일치/);
});

test('target discovery exposes HTTP/format diagnostics without echoing private HTML or accepting a malformed response', async () => {
  for (const response of [new Response('<html>private platform error</html>', { status: 503, headers: { 'content-type': 'text/html' } }),
    new Response('{invalid private body', { headers: { 'content-type': 'application/json' } })]) {
    await assert.rejects(helper.readSavedFreeImageQuotationTarget(selection, signal(), async () => response), error => {
      assert.match(error.message, /견적 연결 조회.*GET \/api\/products\/:id\/quotation-fields/);
      assert.match(error.message, response.status === 503 ? /HTTP 503.*HTML 응답/ : /HTTP 200.*JSON 형식 오류/);
      assert.doesNotMatch(error.message, /private|Unexpected token/); return true;
    });
  }
});

for (const company of schemaCompanies) test(`three sequential main drafts reopen via current quotation scope after the generic route correctly rejects them (${company.code})`, async () => {
  const f = await freeImageEditFixture(company);
  try {
    const ids = (await f.read()).resolved.rows.filter(row => row.optionId !== null && row.included).slice(0, 3).map(row => row.optionId);
    assert.equal(ids.length, 3); const saved = [], originals = [], sourceRows = f.sourceRows();
    for (const [index, optionId] of ids.entries()) {
      const current = await f.read(), field = f.h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(current.resolved.schema.fields, 'mainImage').primary;
      const sourceKey = current.resolved.rows.find(row => row.optionId === optionId).fields[field].value;
      const source = (await json(await f.source('mainImage', { optionId, sourceKey, slotIndex: '0' }))).source, doc = f.doc();
      doc.regions[0].translated = '검증된 번역 ' + index;
      doc.regions.push({ ...doc.regions[0], id: 'unresolved', text: '未确认', translated: '', selected: false, translationProvenance: 'empty', issue: '자동 번역 미완료: 원문 확인 필요' });
      originals.push(source); saved.push(await json(await f.applyEdit(source, doc, f.png(90 + index))));
    }
    const current = await f.read(), route = f.h.load('app/api/products/[id]/image-text/route.ts'), before = f.snapshot();
    assert.notEqual(current.productVersion, originals[0].productVersion);
    for (const [index, item] of saved.entries()) {
      const common = new URLSearchParams({ sourceKey: item.key, role: 'main' });
      const denied = await route.GET(new Request('https://app.test' + f.base + '/image-text?' + common), { params: Promise.resolve({ id: f.id }) });
      assert.equal(denied.status, 409, 'quotation-only generated files must not gain common-role access');
      const requested = await helper.readSavedFreeImageQuotationTarget({ productId: f.id, productVersion: current.productVersion, sourceKey: item.key, role: 'main', profileId: f.profile.id }, signal(), url => f.h.route(url));
      assert.equal(requested.optionId, ids[index]); assert.equal(requested.revision, current.revision);
      const reopened = await json(await f.source('mainImage', { sourceKey: item.key, optionId: requested.optionId, fieldKey: requested.fieldKey, slotIndex: String(requested.slotIndex), editor: 'saved-current-target-v1' }));
      assert.equal(reopened.source.sourceKey, originals[index].sourceKey); assert.equal(reopened.source.sourceSha256, originals[index].sourceSha256);
      assert.equal(reopened.source.productVersion, current.productVersion); assert.equal(reopened.source.quotationTarget.revision, current.revision);
      assert.equal(reopened.source.editorSource.resultKey, item.key); assert.equal(reopened.editDocument.regions[0].translated, '검증된 번역 ' + index);
      assert.equal(reopened.editDocument.regions[2].selected, false); assert.match(reopened.editDocument.regions[2].issue, /미완료/);
    }
    assert.equal(f.snapshot(), before); assert.equal(f.sourceRows(), sourceRows);
    f.h.setCompany(schemaCompanies.find(value => value.code !== company.code));
    await assert.rejects(helper.readSavedFreeImageQuotationTarget({ productId: f.id, productVersion: current.productVersion, sourceKey: saved[0].key, role: 'main', profileId: f.profile.id }, signal(), url => f.h.route(url)));
    assert.equal(f.snapshot(), before);
  } finally { f.close(); }
});
