import test from 'node:test';
import assert from 'node:assert/strict';
import { seoWorkspaceHarness } from './helpers/seo-workspace.mjs';
import { plain, nextVersion, responseJson } from './helpers/seo-workspace-editor.mjs';

const client = h => h.load('app/seo-workspace-client.ts');
const transport = h => (url, init) => {
  assert.equal(url, `/api/products/${encodeURIComponent(h.id)}/seo-workspace`);
  return h.request(init?.method ?? 'GET', init?.body ? JSON.parse(init.body) : undefined, init?.headers);
};
const draft = (h, seo = { title: '수정 상품명', keywords: '태그 하나, 태그 둘\n태그 하나' }) => ({ seo, optionNames: { [h.options.rows[0].id]: '수정 옵션명' } });

test('the client reads the real handler without writes and submits only explicit SEO/name deltas once', async () => {
  const h = seoWorkspaceHarness();
  try {
    const c = client(h), calls = [], beforeStorage = h.stored();
    const request = (url, init) => { calls.push({ url, init }); return transport(h)(url, init); };
    const before = await c.readSeoWorkspace(h.id, request);
    assert.equal(calls.length, 1); assert.equal(calls[0].init.cache, 'no-store'); assert.equal(calls[0].init.method, undefined);
    assert.deepEqual(h.stored(), beforeStorage); assert.equal(h.mutations.length, 0);
    const input = c.seoWorkspaceInput(before, draft(h)), saved = await c.saveSeoWorkspace(before, input, request);
    assert.deepEqual(plain(input), { expectedProductVersion: before.productVersion, expectedContentRevision: before.content.revision, expectedOptionRevision: before.options.revision,
      seo: { title: '수정 상품명', keywordText: '태그 하나, 태그 둘\n태그 하나', keywords: ['태그 하나', '태그 둘 태그 하나'] }, optionNames: [{ optionId: h.options.rows[0].id, value: '수정 옵션명' }] });
    assert.equal(calls.length, 2); assert.equal(calls[1].init.method, 'PATCH'); assert.equal(calls[1].init.headers['content-type'], 'application/json');
    c.verifySeoWorkspaceSave(before, input, saved);
    assert.deepEqual(saved, await responseJson(await h.request()));
    assert.deepEqual(h.stored().quotation, beforeStorage.quotation);
  } finally { h.close(); }
});

test('names-only deltas preserve untouched oversized legacy SEO byte for byte instead of validating or truncating it', async () => {
  const h = seoWorkspaceHarness();
  try {
    const legacy = structuredClone(h.content); legacy.seo.title.value = '옛'.repeat(130); legacy.seo.keywords.value = ['가'.repeat(90), '나'.repeat(90)];
    h.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(legacy), h.id);
    const c = client(h), before = await c.readSeoWorkspace(h.id, transport(h)), storage = h.stored();
    const input = c.seoWorkspaceInput(before, draft(h, {})); assert.equal(Object.hasOwn(input, 'seo'), false);
    const saved = await c.saveSeoWorkspace(before, input, transport(h));
    assert.deepEqual(saved.content, before.content); assert.deepEqual(h.stored().content, storage.content);
    assert.equal(saved.content.seo.title.value.length, 130); assert.equal(saved.content.seo.keywords.value.join(', ').length, 182);
    assert.equal(saved.options.rows[0].translatedName, '수정 옵션명');
  } finally { h.close(); }
});

test('explicit unchanged blanks remain deltas and become manual provenance without touching omitted fields', async () => {
  const h = seoWorkspaceHarness();
  try {
    const content = structuredClone(h.content), options = structuredClone(h.options);
    content.seo.title = { value: '', provenance: 'generated', updatedAt: h.version };
    content.seo.keywords = { value: [], provenance: 'generated', updatedAt: h.version };
    options.rows[0].translatedName = ''; options.rows[0].provenance.translatedName = 'translated';
    h.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content), h.id);
    h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(options), h.id);
    const c = client(h), before = await c.readSeoWorkspace(h.id, transport(h));
    const input = c.seoWorkspaceInput(before, { seo: { title: '', keywords: '' }, optionNames: { [options.rows[0].id]: '' } });
    assert.deepEqual(plain(input.seo), { title: '', keywordText: '', keywords: [] }); assert.equal(input.optionNames[0].value, '');
    const saved = await c.saveSeoWorkspace(before, input, transport(h));
    assert.equal(saved.content.seo.title.provenance, 'manual'); assert.equal(saved.content.seo.keywords.provenance, 'manual'); assert.equal(saved.options.rows[0].provenance.translatedName, 'manual');
    assert.deepEqual(saved.content.seo.description, before.content.seo.description); assert.deepEqual(saved.content.label, before.content.label);
    assert.equal(saved.content.intakeKeywordSeed, undefined);
  } finally { h.close(); }
});

test('unknown option bindings, oversized titles and invalid raw keyword text reject before the client sends any request', async () => {
  const h = seoWorkspaceHarness();
  try {
    const c = client(h), view = await responseJson(await h.request()); let requests = 0;
    for (const pending of [draft(h, { title: '가'.repeat(101) }), draft(h, { keywords: '가'.repeat(5051) }), draft(h, { keywords: '가\u0000나' }), { seo: {}, optionNames: { unknown: '이름' } }])
      assert.throws(() => c.seoWorkspaceInput(view, pending), /100자|5050|텍스트|검색|옵션/);
    await assert.rejects(c.saveSeoWorkspace(view, { expectedProductVersion: h.version, expectedContentRevision: h.content.revision, expectedOptionRevision: h.options.revision,
      seo: { title: '가'.repeat(101) } }, async () => { requests++; return Response.json(view); }), /100자/);
    assert.equal(requests, 0); assert.equal(h.mutations.length, 0);
  } finally { h.close(); }
});

const boundaryTags = Array.from({ length: 8 }, (_, index) => `Tag${index}` + 'a'.repeat(13));
const documentLongTags = Array.from({ length: 31 }, (_, index) => 'K' + String(index).padStart(2, '0'));
const keywordCases = [
  { name: '150 raw characters preserve all eight valid unique cleaned tags', raw: boundaryTags.join(', '), expected: boundaryTags },
  { name: '151 raw characters remove a whole valid last tag before cleaning', raw: boundaryTags.join(', ') + 'a', expected: boundaryTags.slice(0, -1) },
  { name: '150 raw characters keep complete candidates before the cleaner skips long tags', raw: '가'.repeat(70) + ', ' + '나'.repeat(78), expected: [] },
  { name: '151 raw characters remove the trailing tag before the cleaner skips the long prefix', raw: '가'.repeat(70) + ', ' + '나'.repeat(79), expected: [] },
  { name: 'duplicate comma-separated tags are normalized to their first occurrence', raw: '중복, 중복, 마지막', expected: ['중복', '마지막'] },
  { name: 'a newline is cleaned inside one tag rather than used as a separator', raw: '첫째\n둘째, 셋째', expected: ['첫째 둘째', '셋째'] },
  { name: 'comma-only blank tags save an explicit manual blank', raw: ' , , ', expected: [] },
  { name: 'compact 75-tag raw length 149 reaches cleaning and deduplicates to one tag', raw: Array(75).fill('가').join(','), expected: ['가'] },
  { name: 'all 31 unique cleaned tags remain top-level even when their canonical text exceeds 150', raw: documentLongTags.join(','), expected: documentLongTags },
  { name: 'the excluded valid trailing tag cannot be salvaged after the long prefix is cleaned out', raw: '가'.repeat(80) + ', ' + '나'.repeat(60) + ', ' + '다'.repeat(20), expected: [] },
  { name: 'an overlong first tag leaves a blank instead of salvaging a later tag', raw: '가'.repeat(151) + ', 끝', expected: [] },
  { name: 'the exact raw input cap 5050 remains valid and saves its blank prefix', raw: '가'.repeat(5050), expected: [] },
  { name: 'punctuation, jamo, long tags and normalized duplicates follow the case-sensitive service rules',
    raw: '한글-상품!,한글 상품,가ㄱ나,ㅏ,中文,123_456,BrandX,brandx,BrandX,A\nB,' + '가'.repeat(20) + ',' + '가'.repeat(21),
    expected: ['한글 상품', '123 456', 'BrandX', 'brandx', 'A B', '가'.repeat(20)] },
  { name: 'punctuation-only candidates produce an explicit empty cleaned list', raw: '!!!,___,中文,가ㄱ나', expected: [] },
  { name: 'cleaning applies the 20-character cap after replacement and trimming', raw: '가'.repeat(20) + '!,' + '나'.repeat(21), expected: ['가'.repeat(20)] },
];
for (const sample of keywordCases) test(`raw keyword client/API contract: ${sample.name}`, async () => {
  const h = seoWorkspaceHarness();
  try {
    const c = client(h), before = await c.readSeoWorkspace(h.id, transport(h)), storage = h.stored();
    const input = c.seoWorkspaceInput(before, { seo: { keywords: sample.raw }, optionNames: {} });
    assert.equal(input.seo.keywordText, sample.raw, 'the request proves the original typed text'); assert.deepEqual(plain(input.seo.keywords), sample.expected);
    assert.equal(Object.hasOwn(input.seo, 'title'), false); assert.equal(Object.hasOwn(input, 'optionNames'), false);
    const saved = await c.saveSeoWorkspace(before, input, transport(h));
    assert.deepEqual(saved.content.seo.keywords.value, sample.expected); assert.equal(saved.content.seo.keywords.provenance, 'manual');
    assert.equal(Object.hasOwn(saved.content.seo, 'keywordText'), false, 'raw request proof is not a stored SEO field');
    assert.deepEqual(saved.options, before.options); assert.deepEqual(h.stored().options, storage.options); assert.deepEqual(h.stored().quotation, storage.quotation);
    const readback = await c.readSeoWorkspace(h.id, transport(h)); assert.deepEqual(readback.content.seo.keywords.value, sample.expected);
    assert.equal(h.mutations.filter(item => item.sql.startsWith('UPDATE products')).length, 1);
  } finally { h.close(); }
});

test('keyword acknowledgement must match the exact cleaned prefix rather than original duplicates or removed tails', async () => {
  const h = seoWorkspaceHarness();
  try {
    const c = client(h), before = await responseJson(await h.request()), raw = '중복, 중복, ' + '긴'.repeat(151);
    const input = c.seoWorkspaceInput(before, { seo: { keywords: raw }, optionNames: {} });
    assert.deepEqual(plain(input.seo.keywords), ['중복']);
    const saved = await responseJson(await h.request('PATCH', input)); c.verifySeoWorkspaceSave(before, input, saved);
    for (const values of [['중복', '중복'], ['중복', '긴']]) {
      const wrong = structuredClone(saved); wrong.content.seo.keywords.value = values;
      assert.throws(() => c.verifySeoWorkspaceSave(before, input, wrong), /일치하지/);
    }
  } finally { h.close(); }
});

test('exact acknowledgement rejects foreign identity, changed unrelated cost, omitted manual blanks and skipped revisions', async () => {
  for (const [name, corrupt] of [
    ['foreign product', value => { value.productId = 'foreign'; }],
    ['unrelated cost', value => { value.options.rows[0].unitCostCny += 1; }],
    ['manual label blank', value => { value.content.label.material.value = '복원하면 안 됨'; }],
    ['image ownership set', value => { value.imageKeys.push('foreign/image.png'); }],
    ['skipped content revision', value => { value.content.revision++; }],
    ['foreign option name', value => { value.options.rows[1].translatedName = '다른 옵션 변경'; }],
  ]) {
    const h = seoWorkspaceHarness();
    try {
      const c = client(h), before = await responseJson(await h.request()), input = c.seoWorkspaceInput(before, draft(h));
      const saved = structuredClone(h.load('app/seo-workspace.ts').applySeoWorkspaceChanges(before, input, nextVersion(before.productVersion))); corrupt(saved);
      await assert.rejects(c.saveSeoWorkspace(before, input, async () => Response.json(saved)), error => error instanceof c.SeoWorkspaceSaveError && error.uncertain === true, name);
      assert.equal(h.mutations.length, 0, name);
    } finally { h.close(); }
  }
});

test('save error classification distinguishes a known conflict from an uncertain transport or server acknowledgement', async () => {
  const h = seoWorkspaceHarness();
  try {
    const c = client(h), before = await responseJson(await h.request()), input = c.seoWorkspaceInput(before, draft(h));
    for (const status of [400, 409, 503]) await assert.rejects(c.saveSeoWorkspace(before, input, async () => Response.json({ error: 'fixture failure' }, { status })),
      error => error instanceof c.SeoWorkspaceSaveError && error.status === status && error.uncertain === (status >= 500));
    await assert.rejects(c.saveSeoWorkspace(before, input, async () => { throw Error('connection lost'); }), error => error instanceof c.SeoWorkspaceSaveError && error.uncertain && error.status === undefined);
    assert.equal(h.mutations.length, 0);
  } finally { h.close(); }
});

test('lost acknowledgement confirmation accepts only the exact commit or the unchanged snapshot', async () => {
  const h = seoWorkspaceHarness();
  try {
    const c = client(h), before = await responseJson(await h.request()), input = c.seoWorkspaceInput(before, draft(h));
    assert.equal(c.seoWorkspaceSaveState(before, input, before), 'unchanged');
    const saved = await responseJson(await h.request('PATCH', input)); assert.equal(c.seoWorkspaceSaveState(before, input, saved), 'saved');
    const changed = structuredClone(saved); changed.options.rows[0].packagedWeightG++;
    assert.throws(() => c.seoWorkspaceSaveState(before, input, changed), /일치하지/);
  } finally { h.close(); }
});

test('safe refresh distinguishes unrelated changes, concurrent edited targets and changed source bindings', async () => {
  const h = seoWorkspaceHarness();
  try {
    const c = client(h), before = await responseJson(await h.request()), pending = draft(h), latest = structuredClone(before);
    latest.productVersion = nextVersion(before.productVersion); latest.options.revision++; latest.options.updatedAt = latest.productVersion;
    latest.options.rows[0].unitCostCny++; latest.options.rows[0].updatedAt = latest.productVersion; latest.content.label.material.value = '다른 저장 재질';
    assert.deepEqual(plain(c.seoWorkspaceRefreshConflicts(before, latest, pending)), []);
    latest.content.seo.title = { value: '다른 저장 상품명', provenance: 'manual', updatedAt: latest.productVersion };
    latest.options.rows[0].translatedName = '다른 저장 옵션명'; latest.options.rows[0].provenance.translatedName = 'manual';
    assert.deepEqual(plain(c.seoWorkspaceRefreshConflicts(before, latest, pending)), ['상품명', `옵션 ${latest.options.rows[0].originalName}`]);
    for (const change of [value => { value.options.rows = value.options.rows.slice(1); }, value => { value.options.rows[0].originalName = '변경 원문'; }, value => { value.options.rows[0].supplierSku = 'other-sku'; }]) {
      const moved = structuredClone(latest); change(moved); assert.throws(() => c.seoWorkspaceRefreshConflicts(before, moved, pending), /원문 연결/);
    }
    const stale = structuredClone(before); stale.productVersion = new Date(Date.parse(before.productVersion) - 1).toISOString();
    assert.throws(() => c.seoWorkspaceRefreshConflicts(before, stale, pending), /이전 버전/);
  } finally { h.close(); }
});
