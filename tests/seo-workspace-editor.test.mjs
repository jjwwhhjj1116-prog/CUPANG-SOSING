import test from 'node:test';
import assert from 'node:assert/strict';
import { seoWorkspaceHarness } from './helpers/seo-workspace.mjs';
import { seoWorkspaceEditor, nodes, visibleText, deferred, nextVersion, responseJson } from './helpers/seo-workspace-editor.mjs';

const patches = h => h.calls.filter(call => call.method === 'PATCH');
const nameLabel = '1번째 한국어 옵션명';

test('option-name guidance follows the edited value before the single explicit SEO save',async()=>{
 const api=seoWorkspaceHarness(),h=seoWorkspaceEditor(api);try{
  await h.idle();const before=api.stored(),option=()=>nodes(h.render()).find(node=>node.type==='article'&&nodes(node).some(child=>child.props?.['aria-label']===nameLabel));
  assert.doesNotMatch(visibleText(option()),/한국어 옵션명을 입력해주세요/);
  h.edit(nameLabel,'');assert.match(visibleText(option()),/한국어 옵션명을 입력해주세요/);
  h.edit(nameLabel,'검토한 한국어 옵션');assert.doesNotMatch(visibleText(option()),/한국어 옵션명을 입력해주세요/);assert.equal(h.input(nameLabel).props.value,'검토한 한국어 옵션');
  assert.equal(patches(h).length,0);assert.deepEqual(api.stored(),before);await h.click('SEO 설정 저장');assert.equal(patches(h).length,1);assert.equal(h.input(nameLabel).props.value,'검토한 한국어 옵션');
 }finally{h.close();api.close();}
});

test('ordinary tag edits keep technical save previews collapsed while shortening and validation remain visible',async()=>{
 const api=seoWorkspaceHarness(),h=seoWorkspaceEditor(api);try{
  await h.idle();const details=()=>nodes(h.render()).find(node=>node.type==='details'&&node.props.className==='seo-keyword-review');
  h.edit('SEO 검색태그','검토한 태그');assert.equal(details().props.open,undefined);assert.ok(nodes(details()).some(node=>node.props?.['aria-label']==='검색태그 최종 저장안'));assert.equal(patches(h).length,0);
  h.edit('SEO 검색태그','정상, '+'가'.repeat(147));assert.equal(details().props.open,true,'a shortened save plan is exposed before saving');assert.ok(nodes(details()).some(node=>node.props?.['aria-label']==='검색태그 저장안'));
  h.edit('SEO 상품명','가'.repeat(101));const alerts=nodes(h.render()).filter(node=>node.props.role==='alert');assert.ok(alerts.length);assert.ok(alerts.every(alert=>!nodes(details()).includes(alert)),'actual validation errors remain outside the collapsed technical details');assert.equal(h.button('SEO 설정 저장').props.disabled,true);assert.equal(patches(h).length,0);
 }finally{h.close();api.close();}
});
async function concurrent(api, change, { content = false, options = false } = {}) {
  const latest = await responseJson(await api.request()); latest.productVersion = nextVersion(latest.productVersion); change(latest);
  if (content) { latest.content.revision++; latest.content.updatedAt = latest.productVersion; }
  if (options) { latest.options.revision++; latest.options.updatedAt = latest.productVersion; }
  api.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run(latest.productVersion, api.id);
  api.sqlite.prepare('UPDATE product_content SET revision=?,payload=?,updated_at=? WHERE product_id=?').run(latest.content.revision, JSON.stringify(latest.content), latest.content.updatedAt, api.id);
  api.sqlite.prepare('UPDATE product_options SET revision=?,payload=?,updated_at=? WHERE product_id=?').run(latest.options.revision, JSON.stringify(latest.options), latest.options.updatedAt, api.id);
  return latest;
}

for (const companyCode of ['A01464742', 'A01526306']) test(`entry and draft edits are GET-only; one explicit save commits title/tags/name while retaining quotation and unrelated data (${companyCode})`, async () => {
  const api = seoWorkspaceHarness({ companyCode }), h = seoWorkspaceEditor(api);
  try {
    const before = api.stored(); await h.idle();
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0].method, 'GET'); assert.equal(h.calls[0].init.cache, 'no-store');
    assert.deepEqual(api.stored(), before); assert.equal(api.mutations.length, 0);
    assert.equal(h.input('SEO 상품명').props.placeholder, '검색 최적화된 상품명을 입력하세요');
    assert.equal(h.input('SEO 검색태그').props.placeholder, '키워드1, 키워드2, 키워드3 형태로 입력하세요');
    assert.equal(h.input('SEO 검색태그').props.rows, 3);
    assert.equal(h.input(nameLabel).props.placeholder, '한글 옵션명 입력');
    h.edit('SEO 상품명', '검토한 상품명'); h.edit('SEO 검색태그', '검색 하나, 검색 둘\n검색 하나'); h.edit(nameLabel, '검토한 옵션명');
    assert.equal(patches(h).length, 0); assert.equal(h.render().props['data-workspace-dirty'], true);
    await h.click('SEO 설정 저장');
    assert.equal(patches(h).length, 1); assert.equal(h.saved, 1); assert.equal(h.render().props['data-workspace-dirty'], false);
    assert.deepEqual(patches(h)[0].body, { expectedProductVersion: api.version, expectedContentRevision: api.content.revision, expectedOptionRevision: api.options.revision,
      seo: { title: '검토한 상품명', keywordText: '검색 하나, 검색 둘\n검색 하나', keywords: ['검색 하나', '검색 둘 검색 하나'] }, optionNames: [{ optionId: api.options.rows[0].id, value: '검토한 옵션명' }] });
    const saved = await responseJson(await api.request()), storage = api.stored();
    assert.equal(saved.content.seo.title.value, '검토한 상품명'); assert.equal(saved.options.rows[0].translatedName, '검토한 옵션명');
    assert.deepEqual(saved.content.assets, api.content.assets); assert.deepEqual(saved.content.label, api.content.label); assert.deepEqual(saved.content.detail, api.content.detail);
    for (const key of Object.keys(api.options.rows[0]).filter(key => !['translatedName', 'provenance', 'updatedAt'].includes(key))) assert.deepEqual(saved.options.rows[0][key], api.options.rows[0][key], key);
    assert.deepEqual(saved.options.rows[1], api.options.rows[1]); assert.deepEqual(storage.quotation, before.quotation);
    for (const key of Object.keys(before.product).filter(key => !['updated_at', 'quote_status'].includes(key))) assert.deepEqual(storage.product[key], before.product[key], key);
    assert.ok(h.calls.every(call => call.method === 'GET' || call.method === 'PATCH'));
  } finally { h.close(); api.close(); }
});

test('keyword length guidance changes at the observed 120/140 boundaries without trimming or saving the draft', async () => {
  const api = seoWorkspaceHarness(), h = seoWorkspaceEditor(api);
  try {
    await h.idle(); const before = api.stored();
    for (const [length, expected] of [[120, 'normal'], [121, 'warning'], [140, 'warning'], [141, 'danger'], [150, 'danger'], [151, 'danger']]) {
      const raw = '정상, ' + '긴'.repeat(length - 4); h.edit('SEO 검색태그', raw);
      const counter = nodes(h.render()).find(node => node.props['data-seo-keyword-length']);
      assert.equal(counter.props['data-seo-keyword-length'], expected);
      assert.equal(counter.props.children.filter(value => typeof value !== 'boolean').map(visibleText).join(''), `${length}/150자`);
      assert.equal(h.input('SEO 검색태그').props.value, raw, 'length cues must not replace the exact reviewed input');
      assert.equal(patches(h).length, 0); assert.equal(api.mutations.length, 0); assert.deepEqual(api.stored(), before);
      assert.equal(h.button('SEO 설정 저장').props.disabled, false, 'an early warning is guidance, not a new save prohibition');
    }
    assert.ok(nodes(h.render()).some(node => node.props['aria-label'] === '검색태그 저장안'), 'over-limit draft retains its explicit whole-tag review');
    await h.click('SEO 설정 저장');
    assert.equal(patches(h).length, 1); assert.deepEqual(patches(h)[0].body.seo, { keywordText: '정상, ' + '긴'.repeat(147), keywords: ['정상'] });
    assert.equal(h.input('SEO 검색태그').props.value, '정상');
    assert.equal(nodes(h.render()).find(node => node.props['data-seo-keyword-length']).props['data-seo-keyword-length'], 'normal');
    assert.deepEqual(api.stored().options, before.options); assert.deepEqual(api.stored().quotation, before.quotation);
    const saved = await responseJson(await api.request()); assert.deepEqual(saved.content.label, api.content.label); assert.deepEqual(saved.content.assets, api.content.assets);
  } finally { h.close(); api.close(); }
});

test('names-only saving does not submit or truncate untouched legacy title/tags beyond current caps', async () => {
  const api = seoWorkspaceHarness(), legacy = structuredClone(api.content);
  legacy.seo.title.value = '기'.repeat(130); legacy.seo.keywords.value = ['가'.repeat(90), '나'.repeat(90)];
  api.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(legacy), api.id);
  const before = api.stored(), h = seoWorkspaceEditor(api);
  try {
    await h.idle(); assert.equal(h.input('SEO 상품명').props.value.length, 130); assert.equal(h.input('SEO 검색태그').props.value.length, 182);
    assert.match(visibleText(h.render()), /130\/100자.*기존 저장값은 유지/s); assert.match(visibleText(h.render()), /182\/150자.*기존 저장값은 유지/s);
    h.edit(nameLabel, '옵션 이름만 변경'); await h.click('SEO 설정 저장');
    assert.equal(patches(h).length, 1); assert.equal(Object.hasOwn(patches(h)[0].body, 'seo'), false);
    assert.deepEqual(api.stored().content, before.content); assert.equal(h.input('SEO 상품명').props.value, legacy.seo.title.value); assert.equal(h.saved, 1);
  } finally { h.close(); api.close(); }
});

test('explicit unchanged blanks and description are saved as manual fields, with untouched manual blanks preserved', async () => {
  const api = seoWorkspaceHarness(), content = structuredClone(api.content), options = structuredClone(api.options);
  content.seo.title = { value: '', provenance: 'generated', updatedAt: api.version }; content.seo.keywords = { value: [], provenance: 'generated', updatedAt: api.version };
  content.label.material = { value: '', provenance: 'manual', updatedAt: api.version }; options.rows[0].translatedName = ''; options.rows[0].provenance.translatedName = 'translated';
  api.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content), api.id);
  api.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(options), api.id);
  const h = seoWorkspaceEditor(api);
  try {
    await h.idle(); h.edit('SEO 상품명', ''); h.edit('SEO 검색태그', ''); h.edit('SEO 상품 설명', '직접 검토 설명'); h.edit(nameLabel, ''); await h.click('SEO 설정 저장');
    const saved = await responseJson(await api.request()); assert.deepEqual(patches(h)[0].body.seo, { title: '', keywordText: '', keywords: [], description: '직접 검토 설명' });
    assert.equal(saved.content.seo.title.value, ''); assert.equal(saved.content.seo.title.provenance, 'manual'); assert.equal(saved.content.seo.keywords.provenance, 'manual');
    assert.equal(saved.options.rows[0].translatedName, ''); assert.equal(saved.options.rows[0].provenance.translatedName, 'manual'); assert.deepEqual(saved.content.label.material, content.label.material);
    assert.equal(saved.content.intakeKeywordSeed, undefined);
  } finally { h.close(); api.close(); }
});

test('over-limit titles and invalid keyword text remain intact and captured save callbacks cannot bypass validation', async () => {
  const api = seoWorkspaceHarness(), h = seoWorkspaceEditor(api);
  try {
    await h.idle(); h.edit('SEO 상품명', '검토 전'); const retained = h.button('SEO 설정 저장').props.onClick;
    h.edit('SEO 상품명', '가'.repeat(101)); assert.equal(h.button('SEO 설정 저장').props.disabled, true); retained(); await h.idle();
    assert.equal(h.input('SEO 상품명').props.value.length, 101); assert.equal(patches(h).length, 0);
    h.edit('SEO 상품명', '검토 후');
    for (const raw of ['가'.repeat(5051), '가\u0000나']) {
      h.edit('SEO 검색태그', raw); retained(); await h.idle();
      assert.equal(h.input('SEO 검색태그').props.value, raw); assert.equal(h.button('SEO 설정 저장').props.disabled, true); assert.equal(patches(h).length, 0); assert.equal(api.mutations.length, 0);
    }
  } finally { h.close(); api.close(); }
});

const boundaryTags = Array.from({ length: 8 }, (_, index) => `Tag${index}` + 'a'.repeat(13));
const documentLongTags = Array.from({ length: 31 }, (_, index) => 'K' + String(index).padStart(2, '0'));
const rawKeywordCases = [
  { name: '150 raw characters preserve all eight valid unique cleaned tags', raw: boundaryTags.join(', '), expected: boundaryTags, shortened: false },
  { name: '151 raw characters remove a whole valid last tag before cleaning', raw: boundaryTags.join(', ') + 'a', expected: boundaryTags.slice(0, -1), prefix: boundaryTags.slice(0, -1), shortened: true },
  { name: '150 raw characters are cleaned without prefix removal', raw: '가'.repeat(70) + ', ' + '나'.repeat(78), expected: [], shortened: false },
  { name: '151 raw characters remove a complete tail before cleaning', raw: '가'.repeat(70) + ', ' + '나'.repeat(79), expected: [], prefix: ['가'.repeat(70)], shortened: true },
  { name: 'duplicate tags normalize to their first occurrence', raw: '중복, 중복, 마지막', expected: ['중복', '마지막'], shortened: false },
  { name: 'comma-only blanks', raw: ' , , ', expected: [], shortened: false },
  { name: 'newline becomes a space inside one comma-delimited tag', raw: '첫째\n둘째, 셋째', expected: ['첫째 둘째', '셋째'], shortened: false },
  { name: 'compact 75 tags with raw149 and canonical223 deduplicate after preparation', raw: Array(75).fill('가').join(','), expected: ['가'], shortened: false },
  { name: 'raw123 keeps all31 unique cleaned tags despite canonical153', raw: documentLongTags.join(','), expected: documentLongTags, shortened: false },
  { name: 'valid whole trailing tag remains removed even if the retained prefix is cleaned empty', raw: '가'.repeat(80) + ', ' + '나'.repeat(60) + ', ' + '다'.repeat(20), expected: [], prefix: ['가'.repeat(80), '나'.repeat(60)], shortened: true },
  { name: 'overlong first tag saves an empty array', raw: '가'.repeat(151) + ', 끝', expected: [], prefix: [], shortened: true },
  { name: 'exact raw cap5050 saves its blank prefix', raw: '가'.repeat(5050), expected: [], prefix: [], shortened: true },
  { name: 'punctuation, jamo, long tags and normalized duplicates keep case-sensitive differences',
    raw: '한글-상품!,한글 상품,가ㄱ나,ㅏ,中文,123_456,BrandX,brandx,BrandX,A\nB,' + '가'.repeat(20) + ',' + '가'.repeat(21),
    expected: ['한글 상품', '123 456', 'BrandX', 'brandx', 'A B', '가'.repeat(20)], shortened: false },
  { name: 'all punctuation or jamo candidates clean to a manual blank', raw: '!!!,___,中文,가ㄱ나', expected: [], shortened: false },
  { name: '20-character cap is applied after punctuation replacement and trimming', raw: '가'.repeat(20) + '!,' + '나'.repeat(21), expected: ['가'.repeat(20)], shortened: false },
];
for (const sample of rawKeywordCases) test(`keyword editor actual API save/readback: ${sample.name}`, async () => {
  const api = seoWorkspaceHarness(), h = seoWorkspaceEditor(api);
  try {
    await h.idle(); const storage = api.stored(); h.edit('SEO 검색태그', sample.raw);
    assert.equal(h.input('SEO 검색태그').props.value, sample.raw, 'typing and preview do not replace the raw draft');
    assert.match(visibleText(h.render()), new RegExp(`${sample.raw.length}/150자`), 'the counter measures raw characters');
    assert.equal(h.button('SEO 설정 저장').props.disabled, false); assert.equal(patches(h).length, 0);
    const preview = nodes(h.render()).find(node => node.props['aria-label'] === '검색태그 저장안');
    if (sample.shortened) {
      assert.ok(preview, 'over-limit raw input has an accessible save preview');
      assert.ok(visibleText(preview).includes(`길이 조정 후 검색태그: ${sample.prefix.join(', ') || '(공란)'}`), 'raw prefix preview remains distinct from the cleaned saved list');
      const removed = sample.raw.split(',').map(value => value.trim()).filter(Boolean).length - sample.prefix.length;
      assert.ok(visibleText(preview).includes(`뒤 태그 ${removed}개를 제외`));
    } else assert.equal(preview, undefined, 'raw length at most 150 never announces shortening');
    const finalPreview = nodes(h.render()).find(node => node.props['aria-label'] === '검색태그 최종 저장안');
    assert.ok(finalPreview, 'an edited valid raw draft has a final cleaned save preview');
    assert.ok(visibleText(finalPreview).includes(`최종 저장 검색태그: ${sample.expected.join(', ') || '(공란)'}`), 'final preview shows the exact cleaned list or explicit blank');
    await h.click('SEO 설정 저장');
    assert.equal(patches(h).length, 1); assert.deepEqual(patches(h)[0].body.seo, { keywordText: sample.raw, keywords: sample.expected });
    assert.equal(h.input('SEO 검색태그').props.value, sample.expected.join(', '), 'only a verified successful readback replaces raw input'); assert.equal(h.saved, 1);
    assert.equal(h.render().props['data-workspace-dirty'], false); assert.equal(nodes(h.render()).some(node => ['검색태그 저장안', '검색태그 최종 저장안'].includes(node.props['aria-label'])), false);
    const value = await responseJson(await api.request());
    assert.deepEqual(value.content.seo.keywords.value, sample.expected); assert.equal(value.content.seo.keywords.provenance, 'manual');
    assert.deepEqual(api.stored().options, storage.options); assert.deepEqual(api.stored().quotation, storage.quotation);
    await h.click('SEO 저장본 다시 조회'); assert.equal(h.input('SEO 검색태그').props.value, sample.expected.join(', ')); assert.equal(patches(h).length, 1);
  } finally { h.close(); api.close(); }
});

test('a failed shortened-keyword acknowledgement retains raw draft and verifies its saved prefix with one GET', async () => {
  const api = seoWorkspaceHarness(), raw = '중복, 중복, ' + '긴'.repeat(151), expected = ['중복'];
  const h = seoWorkspaceEditor(api, { fetcher: async (url, init, route) => {
    const response = await route(url, init); if (init?.method !== 'PATCH') return response;
    const wrong = await response.json(); wrong.content.seo.keywords.value = ['중복', '중복']; return Response.json(wrong);
  } });
  try {
    await h.idle(); h.edit('SEO 검색태그', raw); await h.click('SEO 설정 저장');
    assert.deepEqual(patches(h)[0].body.seo, { keywordText: raw, keywords: expected }); assert.equal(patches(h).length, 1);
    assert.equal(h.input('SEO 검색태그').props.value, raw); assert.equal(h.render().props['data-workspace-dirty'], true); assert.equal(h.saved, 0);
    assert.match(visibleText(h.render()), /저장 결과를 아직 확인하지 못했습니다/);
    const before = api.stored(), count = h.calls.length; await h.click('SEO 저장 결과 확인');
    assert.equal(h.calls.length, count + 1); assert.equal(h.calls.at(-1).method, 'GET'); assert.equal(patches(h).length, 1); assert.deepEqual(api.stored(), before);
    assert.equal(h.input('SEO 검색태그').props.value, expected.join(', ')); assert.equal(h.saved, 1); assert.equal(h.render().props['data-workspace-dirty'], false);
  } finally { h.close(); api.close(); }
});

test('progress distinguishes initial GET, active PATCH and confirmation GET; uncertainty appears only after a retained attempt fails', async () => {
  const api = seoWorkspaceHarness(); let holdMethod = 'GET', waiting = deferred(), held;
  const h = seoWorkspaceEditor(api, { fetcher: (url, init, route) => {
    if ((init?.method ?? 'GET') === holdMethod) { held = { url, init, route }; return waiting.promise; }
    return route(url, init);
  } });
  try {
    await new Promise(resolve => setImmediate(resolve)); let text = visibleText(h.render());
    assert.match(text, /SEO·옵션 저장본을 확인하고 있습니다…/); assert.doesNotMatch(text, /저장 결과를 아직 확인하지 못했습니다|저장.*실패/);
    assert.equal(patches(h).length, 0); waiting.resolve(await held.route(held.url, held.init)); await h.idle();
    holdMethod = 'PATCH'; waiting = deferred(); h.edit('SEO 검색태그', '중복, 중복'); h.button('SEO 설정 저장').props.onClick();
    text = visibleText(h.render()); assert.match(text, /SEO 설정을 저장하고 있습니다…/); assert.doesNotMatch(text, /SEO·옵션 저장본을 확인하고 있습니다…|저장 결과를 아직 확인하지 못했습니다/);
    assert.equal(h.input('SEO 검색태그').props.value, '중복, 중복'); waiting.reject(Error('fixture uncommitted ACK lost')); await h.idle();
    text = visibleText(h.render()); assert.match(text, /저장 결과를 아직 확인하지 못했습니다/); assert.doesNotMatch(text, /저장하고 있습니다…|저장본을 확인하고 있습니다…/);
    holdMethod = 'GET'; waiting = deferred(); h.button('SEO 저장 결과 확인').props.onClick();
    text = visibleText(h.render()); assert.match(text, /SEO·옵션 저장본을 확인하고 있습니다…/); assert.doesNotMatch(text, /SEO 설정을 저장하고 있습니다…|저장 결과를 아직 확인하지 못했습니다/);
    assert.equal(patches(h).length, 1); waiting.resolve(await held.route(held.url, held.init)); await h.idle();
    assert.equal(h.input('SEO 검색태그').props.value, '중복, 중복'); assert.equal(h.render().props['data-workspace-dirty'], true); assert.equal(h.saved, 0);
    assert.doesNotMatch(visibleText(h.render()), /저장 결과를 아직 확인하지 못했습니다/); assert.equal(patches(h).length, 1);
  } finally { waiting.resolve(Response.json({ error: 'fixture finished' }, { status: 503 })); h.close(); api.close(); }
});

for (const corruption of ['foreign product', 'unrelated cost']) test(`wrong ACK (${corruption}) retains all drafts and requires a read instead of a second PATCH`, async () => {
  const api = seoWorkspaceHarness(), h = seoWorkspaceEditor(api, { fetcher: async (url, init, route) => {
    const response = await route(url, init); if (init?.method !== 'PATCH') return response;
    const saved = await response.json(); if (corruption === 'foreign product') saved.productId = 'foreign'; else saved.options.rows[0].unitCostCny++;
    return Response.json(saved);
  } });
  try {
    await h.idle(); h.edit('SEO 상품명', '확인 전 상품명'); h.edit('SEO 검색태그', ''); h.edit(nameLabel, '확인 전 옵션명'); await h.click('SEO 설정 저장');
    assert.equal(h.saved, 0); assert.equal(h.render().props['data-workspace-dirty'], true); assert.equal(h.input('SEO 상품명').props.value, '확인 전 상품명');
    assert.equal(h.input('SEO 검색태그').props.value, ''); assert.equal(h.input(nameLabel).props.value, '확인 전 옵션명'); assert.ok(h.button('SEO 저장 결과 확인')); assert.equal(patches(h).length, 1);
    const stored = api.stored(); await h.click('SEO 저장 결과 확인');
    assert.equal(patches(h).length, 1); assert.equal(h.saved, 1); assert.deepEqual(api.stored(), stored); assert.equal(h.render().props['data-workspace-dirty'], false);
  } finally { h.close(); api.close(); }
});

test('a committed lost ACK freezes its exact draft and explicit confirmation performs GET only', async () => {
  const api = seoWorkspaceHarness(); let lose = true;
  const h = seoWorkspaceEditor(api, { fetcher: async (url, init, route) => { const response = await route(url, init); if (init?.method === 'PATCH' && lose) { lose = false; throw Error('committed ACK lost'); } return response; } });
  try {
    await h.idle(); const retainedEdit = h.input('SEO 검색태그').props.onChange; h.edit('SEO 상품명', '확인할 상품명'); h.edit('SEO 검색태그', ''); h.edit(nameLabel, '확인할 옵션명');
    await h.click('SEO 설정 저장'); assert.equal(h.saved, 0); assert.equal(patches(h).length, 1); assert.equal(h.input(nameLabel).props.disabled, true);
    retainedEdit({ target: { value: '불확실 저장 중 변경' } }); assert.equal(h.input('SEO 검색태그').props.value, '');
    const stored = api.stored(), count = h.calls.length; await h.click('SEO 저장 결과 확인');
    assert.equal(h.calls.length, count + 1); assert.equal(h.calls.at(-1).method, 'GET'); assert.equal(patches(h).length, 1); assert.equal(h.saved, 1);
    assert.equal(h.render().props['data-workspace-dirty'], false); assert.deepEqual(api.stored(), stored);
    await h.click('SEO 저장본 다시 조회'); assert.equal(patches(h).length, 1); assert.equal(h.saved, 1);
  } finally { h.close(); api.close(); }
});

test('an uncommitted lost ACK keeps the draft after GET and requires another explicit save', async () => {
  const api = seoWorkspaceHarness(); let lose = true;
  const h = seoWorkspaceEditor(api, { fetcher: async (url, init, route) => { if (init?.method === 'PATCH' && lose) { lose = false; throw Error('request never committed'); } return route(url, init); } });
  try {
    await h.idle(); const before = api.stored(); h.edit('SEO 상품명', '보존할 상품명'); h.edit(nameLabel, '보존할 옵션명'); await h.click('SEO 설정 저장');
    assert.deepEqual(api.stored(), before); await h.click('SEO 저장 결과 확인');
    assert.equal(patches(h).length, 1); assert.equal(h.saved, 0); assert.equal(h.render().props['data-workspace-dirty'], true); assert.equal(h.input('SEO 상품명').props.value, '보존할 상품명');
    assert.equal(h.input(nameLabel).props.disabled, false); assert.match(visibleText(h.render()), /아직 저장되지 않은 입력/);
    await h.click('SEO 설정 저장'); assert.equal(patches(h).length, 2); assert.equal(h.saved, 1);
  } finally { h.close(); api.close(); }
});

test('lost ACK followed by an unrelated commit is not falsely confirmed and never auto-replays the save', async () => {
  const api = seoWorkspaceHarness(), h = seoWorkspaceEditor(api, { fetcher: async (url, init, route) => { const response = await route(url, init); if (init?.method === 'PATCH') throw Error('ACK lost'); return response; } });
  try {
    await h.idle(); h.edit('SEO 상품명', '내 상품명'); await h.click('SEO 설정 저장');
    await concurrent(api, value => { value.options.rows[0].packagedWeightG++; }, { options: true });
    const before = api.stored(); await h.click('SEO 저장 결과 확인');
    assert.equal(h.saved, 0); assert.equal(h.render().props['data-workspace-dirty'], true); assert.equal(h.input('SEO 상품명').props.value, '내 상품명');
    assert.equal(patches(h).length, 1); assert.deepEqual(api.stored(), before); assert.ok(h.button('SEO 저장 결과 확인'));
  } finally { h.close(); api.close(); }
});

test('a disjoint latest refresh keeps drafts, takes current clocks and preserves the concurrent cost', async () => {
  const api = seoWorkspaceHarness(), h = seoWorkspaceEditor(api);
  try {
    await h.idle(); h.edit('SEO 상품명', '내 상품명'); h.edit(nameLabel, '내 옵션명');
    const latest = await concurrent(api, value => { value.options.rows[0].unitCostCny = 8.25; value.options.rows[0].updatedAt = value.productVersion; value.content.label.material.value = '동시 수정 재질'; }, { options: true, content: true });
    h.patch({ version: latest.productVersion }); await h.idle(); assert.equal(h.input('SEO 상품명').props.value, '내 상품명'); assert.equal(patches(h).length, 0);
    await h.click('입력 유지·최신 SEO 조회'); assert.equal(patches(h).length, 0); assert.equal(h.input(nameLabel).props.value, '내 옵션명');
    await h.click('SEO 설정 저장'); assert.equal(patches(h).length, 1); assert.equal(patches(h)[0].body.expectedProductVersion, latest.productVersion);
    assert.equal(patches(h)[0].body.expectedContentRevision, latest.content.revision); assert.equal(patches(h)[0].body.expectedOptionRevision, latest.options.revision);
    const saved = await responseJson(await api.request()); assert.equal(saved.options.rows[0].unitCostCny, 8.25); assert.equal(saved.content.label.material.value, '동시 수정 재질'); assert.equal(h.saved, 1);
  } finally { h.close(); api.close(); }
});

test('a concurrent target edit requires comparison and explicit rebase before one explicit save', async () => {
  const api = seoWorkspaceHarness(), h = seoWorkspaceEditor(api);
  try {
    await h.idle(); h.edit('SEO 상품명', '내 상품명'); h.edit(nameLabel, '내 옵션명');
    const latest = await concurrent(api, value => { value.content.seo.title = { value: '다른 상품명', provenance: 'manual', updatedAt: value.productVersion }; value.options.rows[0].translatedName = '다른 옵션명'; value.options.rows[0].provenance.translatedName = 'manual'; value.options.rows[0].updatedAt = value.productVersion; }, { content: true, options: true });
    const before = api.stored(); await h.click('입력 유지·최신 SEO 조회');
    assert.equal(h.button('SEO 설정 저장').props.disabled, true); assert.ok(nodes(h.render()).some(node => node.props['aria-label'] === '다른 SEO 저장값 비교'));
    assert.match(visibleText(h.render()), /다른 상품명/); assert.match(visibleText(h.render()), /다른 옵션명/); assert.equal(h.input('SEO 상품명').props.value, '내 상품명');
    assert.equal(patches(h).length, 0); assert.deepEqual(api.stored(), before);
    await h.click('입력 유지·비교한 최신 기준 사용'); assert.equal(patches(h).length, 0); assert.equal(h.render().props['data-workspace-dirty'], true);
    await h.click('SEO 설정 저장'); assert.equal(patches(h).length, 1); assert.equal(patches(h)[0].body.expectedProductVersion, latest.productVersion); assert.equal(h.saved, 1);
  } finally { h.close(); api.close(); }
});

for (const boundary of ['removed', 'originalName', 'supplierSku']) test(`an edited option with changed ${boundary} binding blocks refresh and rebase`, async () => {
  const api = seoWorkspaceHarness(), h = seoWorkspaceEditor(api);
  try {
    await h.idle(); h.edit(nameLabel, '입력 유지 옵션명'); await concurrent(api, value => {
      if (boundary === 'removed') value.options.rows = value.options.rows.slice(1); else value.options.rows[0][boundary] = '다른 원문 연결';
    }, { options: true });
    await h.click('입력 유지·최신 SEO 조회'); assert.match(visibleText(h.render()), /원문 연결/); assert.equal(h.input(nameLabel).props.value, '입력 유지 옵션명');
    assert.equal(h.button('입력 유지·비교한 최신 기준 사용'), undefined); assert.equal(patches(h).length, 0); assert.equal(h.saved, 0);
  } finally { h.close(); api.close(); }
});

for (const change of ['version', 'scope', 'inactive']) test(`${change} layout changes reject captured callbacks and late PATCH before passive cleanup`, async () => {
  const api = seoWorkspaceHarness(), waiting = deferred(); let held;
  const h = seoWorkspaceEditor(api, { fetcher: (url, init, route) => { if (init?.method === 'PATCH') { held = { url, init, route }; return waiting.promise; } return route(url, init); } });
  try {
    await h.idle(); h.edit('SEO 상품명', '원래 범위 초안'); const oldEdit = h.input('SEO 상품명').props.onChange, oldSave = h.button('SEO 설정 저장').props.onClick;
    const oldRead = h.button('입력 유지·최신 SEO 조회').props.onClick; oldSave(); assert.equal(patches(h).length, 1);
    const changes = change === 'version' ? { version: nextVersion(api.version) } : change === 'scope' ? { productId: 'other-product' } : { active: false };
    h.patch(changes, false); assert.equal(held.init.signal.aborted, true);
    const calls = h.calls.length; oldEdit({ target: { value: '낡은 콜백 값' } }); oldSave(); oldRead(); assert.equal(h.calls.length, calls);
    waiting.resolve(await held.route(held.url, held.init)); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.saved, 0);
    const tree = h.render(false); assert.equal(patches(h).length, 1);
    if (change !== 'scope') assert.equal(h.input('SEO 상품명', tree).props.value, '원래 범위 초안'); else assert.equal(h.input('SEO 상품명', tree), undefined);
    h.render();
    if (change === 'inactive') { await new Promise(resolve => setImmediate(resolve)); h.patch({ active: true }); }
    if (change !== 'scope') await h.idle(); assert.equal(h.saved, 0);
  } finally { waiting.resolve(Response.json({ error: 'fixture finished' }, { status: 503 })); h.close(); api.close(); }
});

for (const change of ['version', 'scope', 'inactive']) test(`${change} layout changes reject a late GET before passive cleanup without clearing drafts`, async () => {
  const api = seoWorkspaceHarness(), waiting = deferred(); let hold = false, held;
  const h = seoWorkspaceEditor(api, { fetcher: async (url, init, route) => {
    const response = await route(url, init);
    if (hold && !init?.method) { hold = false; held = { init, response }; return waiting.promise; }
    return response;
  } });
  try {
    await h.idle(); h.edit('SEO 상품명', '조회 중 유지 초안'); const retainedRead = h.button('입력 유지·최신 SEO 조회').props.onClick;
    hold = true; retainedRead(); await new Promise(resolve => setImmediate(resolve)); assert.ok(held);
    h.patch(change === 'version' ? { version: nextVersion(api.version) } : change === 'scope' ? { productId: 'other-product' } : { active: false }, false);
    assert.equal(held.init.signal.aborted, true); const calls = h.calls.length; retainedRead(); assert.equal(h.calls.length, calls);
    waiting.resolve(held.response); await new Promise(resolve => setImmediate(resolve)); const tree = h.render(false);
    if (change === 'scope') assert.equal(h.input('SEO 상품명', tree), undefined); else assert.equal(h.input('SEO 상품명', tree).props.value, '조회 중 유지 초안');
    assert.equal(h.saved, 0); assert.equal(patches(h).length, 0); assert.equal(api.mutations.length, 0);
  } finally { waiting.resolve(Response.json({ error: 'fixture finished' }, { status: 503 })); h.close(); api.close(); }
});

test('a captured comparison rebase is ignored synchronously after a parent clock change', async () => {
  const api = seoWorkspaceHarness(), h = seoWorkspaceEditor(api);
  try {
    await h.idle(); h.edit('SEO 상품명', '유지할 상품명');
    const latest = await concurrent(api, value => { value.content.seo.title = { value: '다른 상품명', provenance: 'manual', updatedAt: value.productVersion }; }, { content: true });
    await h.click('입력 유지·최신 SEO 조회'); const retained = h.button('입력 유지·비교한 최신 기준 사용').props.onClick;
    h.patch({ version: nextVersion(latest.productVersion) }, false); retained(); const tree = h.render(false);
    assert.equal(h.input('SEO 상품명', tree).props.value, '유지할 상품명'); assert.equal(h.button('SEO 설정 저장', tree).props.disabled, true);
    assert.equal(h.button('입력 유지·비교한 최신 기준 사용', tree), undefined); assert.equal(patches(h).length, 0);
  } finally { h.close(); api.close(); }
});

test('unmount aborts pending GET and PATCH, and retained callbacks perform no writes or late state changes', async () => {
  for (const method of ['GET', 'PATCH']) {
    const api = seoWorkspaceHarness(), waiting = deferred(); let held;
    const h = seoWorkspaceEditor(api, { fetcher: (url, init, route) => { if ((init?.method ?? 'GET') === method) { held = { url, init, route }; return waiting.promise; } return route(url, init); } });
    try {
      if (method === 'PATCH') { await h.idle(); h.edit('SEO 상품명', '닫기 전 초안'); h.button('SEO 설정 저장').props.onClick(); }
      else await new Promise(resolve => setImmediate(resolve));
      const tree = h.render(false), callbacks = nodes(tree).flatMap(node => [node.props.onChange, node.props.onClick].filter(Boolean)); h.close(); assert.equal(held.init.signal.aborted, true);
      const calls = h.calls.length; callbacks.forEach(callback => callback({ target: { value: '닫힌 입력' } }));
      waiting.resolve(await held.route(held.url, held.init)); await new Promise(resolve => setImmediate(resolve));
      assert.equal(h.calls.length, calls); assert.equal(h.lateWrites, 0); assert.equal(h.saved, 0);
    } finally { waiting.resolve(Response.json({ error: 'fixture finished' }, { status: 503 })); h.close(); api.close(); }
  }
});

test('focused option and exact owned thumbnails include source-owned fallback while foreign references stay hidden', async () => {
  const api = seoWorkspaceHarness(), h = seoWorkspaceEditor(api, { props: { focusedOptionId: 'second' }, fetcher: async (url, init, route) => {
    const value = await responseJson(await route(url, init)); value.imageKeys.push('owner/source image.png'); value.options.rows[1].imageKey = null;
    value.sourceImageKeys = { second: 'owner/source image.png' };
    value.options.rows.push({ ...structuredClone(value.options.rows[1]), id: 'foreign', imageKey: 'foreign/not-owned.png' });
    return Response.json(value);
  } });
  try {
    await h.idle(); const tree = h.render(), articles = nodes(tree).filter(node => node.type === 'article'), images = nodes(tree).filter(node => node.type === 'img');
    assert.deepEqual(articles.map(node => node.props['data-option-target']), [false, true, false]);
    assert.deepEqual(images.map(node => node.props.src), ['/api/files/owner/seed.png', '/api/files/owner/source%20image.png']);
    assert.ok(images.every(node => !node.props.src.includes('foreign'))); assert.equal(patches(h).length, 0); assert.equal(api.mutations.length, 0);
  } finally { h.close(); api.close(); }
});

for (const uncertain of [false, true]) test(`parent clock V2 rejects an older V1 read while preserving ${uncertain ? 'an uncertain attempted' : 'a dirty'} draft`, async () => {
  const api = seoWorkspaceHarness(); let reject = uncertain;
  const h = seoWorkspaceEditor(api, { fetcher: (url, init, route) => { if (init?.method === 'PATCH' && reject) { reject = false; throw Error('uncommitted ACK lost'); } return route(url, init); } });
  try {
    await h.idle(); h.edit('SEO 상품명', '부모 시계 변경 후 유지'); if (uncertain) await h.click('SEO 설정 저장');
    h.patch({ version: nextVersion(api.version) }); await h.idle();
    await h.click(uncertain ? 'SEO 저장 결과 확인' : '입력 유지·최신 SEO 조회');
    assert.equal(h.input('SEO 상품명').props.value, '부모 시계 변경 후 유지'); assert.equal(h.saved, 0);
    assert.match(visibleText(h.render()), /이전|최신.*확인|저장 상태가 변경/);
    assert.equal(h.button(uncertain ? 'SEO 저장 결과 확인' : 'SEO 설정 저장').props.disabled || h.button('SEO 저장 결과 확인') !== undefined, true,
      'an older GET cannot mark the parent V2 source as fresh or enable a new PATCH');
    const before = patches(h).length; h.button(uncertain ? 'SEO 저장 결과 확인' : 'SEO 설정 저장').props.onClick(); await h.idle();
    assert.equal(patches(h).length, before);
  } finally { h.close(); api.close(); }
});
