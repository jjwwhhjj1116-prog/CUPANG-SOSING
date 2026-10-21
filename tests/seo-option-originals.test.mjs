import test from 'node:test';
import assert from 'node:assert/strict';
import { seoWorkspaceHarness } from './helpers/seo-workspace.mjs';
import { seoWorkspaceEditor, visibleText, plain } from './helpers/seo-workspace-editor.mjs';
import { seedSeoOptionOriginals } from './helpers/seo-option-originals.mjs';

const body = async h => { const response = await h.request(); assert.equal(response.status, 200); return response.json(); };
for (const companyCode of ['A01464742', 'A01526306']) {
  test(`exact stored axis references show separately from final name, including excluded rows (${companyCode})`, async () => {
    const api = seoWorkspaceHarness({ companyCode }); const source = seedSeoOptionOriginals(api), before = api.stored(), h = seoWorkspaceEditor(api);
    try {
      await h.idle(); assert.match(visibleText(h.render()), /원본: 黑色 \(검정\) \/ 均码 \(프리\)/);
      const view = await body(api); assert.equal(Object.keys(view.optionOriginalReferences).length, 2);
      assert.equal(view.options.rows[1].included, false); assert.deepEqual(api.stored(), before); assert.equal(api.mutations.length, 0);
      assert.equal(h.calls.length, 1); assert.equal(h.calls[0].method, 'GET');
      h.edit('1번째 한국어 옵션명', '검정 프리사이즈 1개'); await h.click('SEO 설정 저장');
      const patches = h.calls.filter(call => call.method === 'PATCH'); assert.equal(patches.length, 1);
      assert.deepEqual(patches[0].body.optionNames, [{ optionId: source.options.rows[0].id, value: '검정 프리사이즈 1개' }]);
      assert.equal(Object.hasOwn(patches[0].body, 'optionOriginalReferences'), false); assert.equal(h.saved, 1);
      const after = await body(api); assert.equal(after.options.rows[0].translatedName, '검정 프리사이즈 1개');
      assert.equal(after.options.rows[0].provenance.translatedName, 'manual'); assert.equal(after.optionOriginalReferences[source.options.rows[0].id].axes[0].translated, '검정');
      assert.deepEqual(after.content, JSON.parse(before.content.payload)); assert.deepEqual(api.stored().quotation, before.quotation);
      const expected = plain(source.options.rows[0]), changed = plain(after.options.rows[0]);
      for (const key of Object.keys(expected).filter(key => !['translatedName', 'provenance', 'updatedAt'].includes(key))) assert.deepEqual(changed[key], expected[key], key);
    } finally { h.close(); api.close(); }
  });
}

const fallbacks = {
  'manual axis': (h, f) => { f.options.rows[0].provenance.color = 'manual'; f.setOptions(f.options); },
  'manual blank axis': (h, f) => { f.options.rows[0].color = ''; f.options.rows[0].provenance.color = 'manual'; f.setOptions(f.options); },
  'current translated value changed': (h, f) => { f.options.rows[0].color = '다른색'; f.setOptions(f.options); },
  'legacy copied Chinese translation': (h, f) => { f.options.rows[0].color = '黑色'; f.setOptions(f.options); f.review.instructionsVersion = 'sourceflow-translation-v5'; f.setReview(f.review);
    f.result.draft.attributes[1].value = '黑色'; f.setResult(f.result); },
  'translation introduces an unsupported number': (h, f) => { f.options.rows[0].color = '검정 2개'; f.setOptions(f.options); f.result.draft.attributes[1].value = '검정 2개'; f.setResult(f.result); },
  'original option changed': (h, f) => { f.options.rows[0].originalName = '다른 원문'; f.setOptions(f.options); },
  'review original changed': (h, f) => { f.review.source.attributes[0].value = '다른 원문'; f.setReview(f.review); },
  'duplicate original binding': (h, f) => { f.review.source.attributes.push(f.review.source.attributes[0]); f.setReview(f.review); },
  'duplicate axis binding': (h, f) => { f.review.source.attributes.push(f.review.source.attributes[1]); f.setReview(f.review); },
  'duplicate result index': (h, f) => { f.result.draft.attributes.push(f.result.draft.attributes[1]); f.setResult(f.result); },
  'axis index points at another original': (h, f) => { [f.result.draft.attributes[1].sourceIndex, f.result.draft.attributes[2].sourceIndex] = [2, 1]; f.setResult(f.result); },
  'axis binding belongs to another option': (h, f) => { f.review.source.attributes[1].name = 'option-color:foreign'; f.setReview(f.review); },
  'foreign source reference': (h, f) => { f.review.source.reference = f.review.source.reference.replace(f.jobId, 'foreign-source'); f.setReview(f.review); },
  'foreign collection owner': (h, f) => { h.sqlite.prepare('UPDATE collection_jobs SET owner_id=? WHERE id=?').run('foreign', f.jobId); },
  'foreign translation owner': (h, f) => { h.sqlite.prepare('UPDATE translation_jobs SET owner_id=? WHERE id=?').run('foreign', f.translationId); },
  'foreign translation product': (h, f) => { const product = h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(h.id), keys = Object.keys(product); product.id += '-foreign';
    h.sqlite.prepare(`INSERT INTO products(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map(key => product[key]));
    h.sqlite.prepare('UPDATE translation_jobs SET product_id=? WHERE id=?').run(product.id, f.translationId); },
  'product source replaced': h => { h.sqlite.prepare('UPDATE products SET source_url=? WHERE id=?').run('https://detail.1688.com/offer/778.html', h.id); },
  'collection source replaced': (h, f) => { h.sqlite.prepare('UPDATE collection_jobs SET source_url=? WHERE id=?').run('https://detail.1688.com/offer/778.html', f.jobId); },
  'collection cancelled': (h, f) => { h.sqlite.prepare("UPDATE collection_jobs SET status='cancelled' WHERE id=?").run(f.jobId); },
  'translation newer than current row': (h, f) => { h.sqlite.prepare('UPDATE translation_jobs SET finished_at=? WHERE id=?').run(new Date(Date.parse(h.version) + 1).toISOString(), f.translationId); },
  'translation incomplete': (h, f) => { h.sqlite.prepare("UPDATE translation_jobs SET status='running' WHERE id=?").run(f.translationId); },
  'damaged result': (h, f) => { h.sqlite.prepare('UPDATE translation_jobs SET result=? WHERE id=?').run('{', f.translationId); },
  'missing history': h => { h.sqlite.prepare('DELETE FROM translation_jobs').run(); },
  'missing legacy history table': h => { h.sqlite.exec('DROP TABLE translation_jobs'); },
  'full history window cannot establish uniqueness': (h, f) => { const old = h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(f.translationId), keys = Object.keys(old);
    for (let i = 0; i < 19; i++) { const copy = { ...old, id: old.id + '-' + i, idempotency_key: old.idempotency_key + '-' + i, status: 'failed' };
      h.sqlite.prepare(`INSERT INTO translation_jobs(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map(key => copy[key])); } },
  'ambiguous matching history': (h, f) => { const old = h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(f.translationId), keys = Object.keys(old);
    old.id += '-duplicate'; old.idempotency_key += '-duplicate'; h.sqlite.prepare(`INSERT INTO translation_jobs(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map(key => old[key])); },
};
for (const [name, change] of Object.entries(fallbacks)) test(`${name} leaves authoritative original plain and SEO entry available`, async () => {
  const h = seoWorkspaceHarness();
  try {
    const f = seedSeoOptionOriginals(h); change(h, f); const before = h.stored(), view = await body(h);
    assert.equal(view.optionOriginalReferences?.[f.options.rows[0].id], undefined);
    assert.deepEqual(h.stored(), before); assert.equal(h.mutations.length, 0);
  } finally { h.close(); }
});

test('stable option IDs survive row order changes and final manual blanks without rewriting either source or final name', async () => {
  const api = seoWorkspaceHarness(), f = seedSeoOptionOriginals(api);
  f.options.rows.reverse(); f.options.rows[0].translatedName = ''; f.options.rows[0].provenance.translatedName = 'manual'; f.setOptions(f.options);
  const before = api.stored(), h = seoWorkspaceEditor(api);
  try {
    await h.idle(); assert.equal(h.input('1번째 한국어 옵션명').props.value, '');
    assert.match(visibleText(h.render()), /원본: 黑色 \(검정\) \/ 均码 \(프리\)/);
    const view = await body(api); assert.equal(Object.keys(view.optionOriginalReferences).length, 2);
    assert.deepEqual(api.stored(), before); assert.equal(api.mutations.length, 0);
  } finally { h.close(); api.close(); }
});

test('GET-only references reject mutation input and cannot weaken existing strict save acknowledgements', async () => {
  const h = seoWorkspaceHarness();
  try {
    seedSeoOptionOriginals(h); const c = h.load('app/seo-workspace-client.ts'), before = await body(h);
    c.verifySeoWorkspaceView(before, h.id);
    const input = c.seoWorkspaceInput(before, { seo: {}, optionNames: { [before.options.rows[0].id]: '수동 완성명' } });
    const response = await h.request('PATCH', { ...input, optionOriginalReferences: before.optionOriginalReferences }); assert.equal(response.status, 400); assert.equal(h.mutations.length, 0);
    const saved = await (await h.request('PATCH', input)).json(); assert.equal(saved.optionOriginalReferences, undefined);
    c.verifySeoWorkspaceSave(before, input, saved);
    const later = await body(h); c.verifySeoWorkspaceSave(before, input, later);
    const plainBefore = structuredClone(before); delete plainBefore.optionOriginalReferences;
    assert.equal(c.seoWorkspaceSaveState(before, input, plainBefore), 'unchanged');
    const wrong = structuredClone(saved); wrong.content.seo.title.value = '무관한 값 변경';
    assert.throws(() => c.verifySeoWorkspaceSave(before, input, wrong), /수정한 항목과 일치하지/);
    const corrupt = structuredClone(later); corrupt.optionOriginalReferences[before.options.rows[0].id].axes[0].translated = '다른 색상';
    assert.throws(() => c.verifySeoWorkspaceSave(before, input, corrupt), /번역 참고자료가 일치하지/);
    const foreign = structuredClone(before); foreign.optionOriginalReferences.foreign = foreign.optionOriginalReferences[before.options.rows[0].id];
    assert.throws(() => c.verifySeoWorkspaceView(foreign, h.id), /참고자료의 연결/);
    const duplicate = structuredClone(before); duplicate.optionOriginalReferences[before.options.rows[0].id].axes[1] = duplicate.optionOriginalReferences[before.options.rows[0].id].axes[0];
    assert.throws(() => c.verifySeoWorkspaceView(duplicate, h.id), /번역 참고자료가 일치하지/);
  } finally { h.close(); }
});

test('the reference helper performs only three bounded SELECTs and suppresses a collection-link race', async () => {
  const h = seoWorkspaceHarness();
  try {
    const f = seedSeoOptionOriginals(h), helper = h.load('db/seo-option-originals.ts'), sql = [], prepare = h.db.prepare;
    let links = 0;
    h.db.prepare = value => { sql.push(value); if (value.startsWith('SELECT j.id') && ++links === 2)
      h.sqlite.prepare('UPDATE collection_jobs SET updated_at=? WHERE id=?').run(new Date(Date.parse(h.version) + 1).toISOString(), f.jobId);
      return prepare(value); };
    const before = h.stored(), result = await helper.readSeoOptionOriginalReferences(f.owner, h.product, f.options);
    assert.deepEqual(plain(result), {}); assert.equal(sql.length, 3); assert.ok(sql.every(value => value.trim().startsWith('SELECT')));
    assert.match(sql[1], /LIMIT 20/); assert.match(sql[0], /LIMIT 2/); assert.deepEqual(h.stored(), before); assert.equal(h.mutations.length, 0);
  } finally { h.close(); }
});

for (const id of ['__proto__', 'toString']) test(`an exact option ID ${id} cannot turn inherited object values into a caption`, async () => {
  const api = seoWorkspaceHarness();
  const options = JSON.parse(api.stored().options.payload); options.rows[0].id = id;
  api.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(options), api.id);
  const f = seedSeoOptionOriginals(api);
  if (id === 'toString') { f.options.rows[0].provenance.color = 'manual'; f.setOptions(f.options); }
  const h = seoWorkspaceEditor(api);
  try {
    await h.idle(); const view = await body(api); api.load('app/seo-workspace-client.ts').verifySeoWorkspaceView(view, api.id);
    assert.equal(Object.hasOwn(view.optionOriginalReferences, id), id === '__proto__');
    const firstCaption = visibleText(h.render()).split('원본: ')[1]; assert.ok(firstCaption);
    assert.equal(firstCaption.startsWith('黑色 (검정) / 均码 (프리)'), id === '__proto__'); assert.equal(api.mutations.length, 0);
  } finally { h.close(); api.close(); }
});
