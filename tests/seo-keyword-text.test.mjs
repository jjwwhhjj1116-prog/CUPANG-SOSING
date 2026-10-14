import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/seo-keyword-text.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const prepare = raw => JSON.parse(JSON.stringify(exports.prepareSeoKeywordText(raw)));

const cases = [
  ['blank is an explicit empty tag list', '', '', [], false, 0],
  ['duplicates keep their original order', ' a, b, a ', ' a, b, a ', ['a', 'b', 'a'], false, 0],
  ['commas alone separate tags; internal newlines are retained', 'a\nb, c', 'a\nb, c', ['a\nb', 'c'], false, 0],
  ['empty comma entries are filtered only after preparation', ', a, ,b,, ', ', a, ,b,, ', ['a', 'b'], false, 0],
  ['exactly 150 raw UTF-16 units stay intact', 'a'.repeat(150), 'a'.repeat(150), ['a'.repeat(150)], false, 0],
  ['raw150 is not shortened when comma-space display becomes151', 'a'.repeat(148) + ',b', 'a'.repeat(148) + ',b', ['a'.repeat(148), 'b'], false, 0],
  ['compact75 tags stay intact even when display reaches223', Array(75).fill('a').join(','), Array(75).fill('a').join(','), Array(75).fill('a'), false, 0],
  ['151 excludes complete trailing tag and keeps150 prefix', 'a'.repeat(147) + ',b,c', 'a'.repeat(147) + ', b', ['a'.repeat(147), 'b'], true, 1],
  ['oversized first tag clears the complete tag rather than slicing it', 'a'.repeat(151), '', [], true, 1],
  ['oversized first tag cannot be replaced with a later short tag', 'a'.repeat(151) + ',b', '', [], true, 2],
  ['empty entries contribute comma-space length before final filtering', 'a'.repeat(147) + ',, b', 'a'.repeat(147) + ', ', ['a'.repeat(147)], true, 1],
  ['whitespace alone over150 trims to an empty explicit list', ' '.repeat(151), '', [], true, 0],
  ['emoji length uses UTF-16 units at150', '😀'.repeat(75), '😀'.repeat(75), ['😀'.repeat(75)], false, 0],
  ['emoji and one extra unit remove the whole tag at151', '😀'.repeat(75) + 'a', '', [], true, 1],
];
for (const [name, raw, text, keywords, shortened, removedTags] of cases) test(name, () => {
  assert.deepEqual(prepare(raw), { text, keywords, shortened, originalLength: raw.length, removedTags });
});
test('input bounds and forbidden controls are enforced before preparation', () => {
  assert.equal(prepare(' '.repeat(5050)).text, '');
  for (const value of [' '.repeat(5051), '\u0000', '\u000b', 1, null, ['a']]) assert.throws(() => prepare(value), /5050자/);
});

test('service cleaning preserves case and priority while deduplicating after character normalization', () => {
  const raw = ['키-워드', '키_워드', '키 워드', 'Key', 'key', 'Key', 'A  B', 'A\nB', '상품123'];
  assert.deepEqual(JSON.parse(JSON.stringify(exports.cleanSeoKeywordCandidates(raw))), ['키 워드', 'Key', 'key', 'A B', '상품123']);
});
test('compatibility Jamo rejects the whole tag; other unsupported characters become spaces', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(exports.cleanSeoKeywordCandidates(['정상ㄱ제품', 'ㅏgood', '中国产品', 'café', '마우스😀패드', 'ok가']))), ['caf', '마우스 패드', 'ok']);
});
test('service excludes empty or normalized over20 tags without shortening a word', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(exports.cleanSeoKeywordCandidates([null, undefined, '', '  ', '@@@', 'a'.repeat(20), 'a'.repeat(21), 123]))), ['a'.repeat(20), '123']);
});
test('document150 keeps a prefix instead of packing a later short tag into the gap', () => {
  const values = Array.from({ length: 7 }, (_, index) => String(index) + 'a'.repeat(19)).concat('last');
  assert.equal(exports.seoKeywordDocumentText(values), values.slice(0, 6).join(', '));
  const compact = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'];
  assert.equal(compact.join(',').length, 123); assert.equal(compact.join(', ').length, 184);
  assert.equal(exports.seoKeywordDocumentText(compact), compact.slice(0, 50).join(', '));
});
test('document basis is clock and exact-list bound; legacy or a later changed field stays unchanged', () => {
  const keywords = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'];
  const field = { value: keywords, updatedAt: '2026-10-14T01:00:00.000Z', provenance: 'manual' };
  const content = { seo: { keywords: field } };
  assert.equal(exports.quotationSeoKeywordText(content), keywords.join(', '));
  const basis = { policy: 'couplus-service-v1', sourceUpdatedAt: field.updatedAt, sourceKeywords: [...keywords], value: keywords.slice(0, 50).join(', ') };
  content.seoKeywordDocument = basis; assert.equal(exports.quotationSeoKeywordText(content), basis.value);
  for (const modified of [{ ...basis, sourceUpdatedAt: '2026-10-14T01:00:01.000Z' }, { ...basis, sourceKeywords: ['other'] }, { ...basis, value: 'forged' }, { ...basis, policy: 'other' }])
    assert.equal(exports.quotationSeoKeywordText({ seo: content.seo, seoKeywordDocument: modified }), keywords.join(', '));
  content.seo.keywords = { ...field, value: [], updatedAt: '2026-10-14T01:00:01.000Z' };
  content.seoKeywordDocument = { ...basis, sourceUpdatedAt: content.seo.keywords.updatedAt, sourceKeywords: [], value: '기존 문서 태그' };
  assert.equal(exports.quotationSeoKeywordText(content), '기존 문서 태그');
});
