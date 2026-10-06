import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';

function load(file, cache = new Map()) {
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText, {exports, crypto, URL, URLSearchParams, Response, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout,
    fetch: () => {throw Error('Live HTTP forbidden');}, require(name) {
      if (name === 'parse5') return parse5;
      assert.ok(name.startsWith('@/app/'), name); return load(name.slice(2) + '.ts', cache);
    }});
  return exports;
}
const batch = load('app/automation/google-translation-batch.ts');
const drafts = load('app/automation/google-translation-draft.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const google = value => Response.json([[[value, 'fixture source']], null, 'zh-CN']);
const source = (attributes = [], extra = {}) => ({title: '太阳镜', description: '', attributes,
  provenance: 'manual', reference: 'Local fixture only', category: {id: '69900', path: ['패션', '선글라스']}, ...extra});
function rows(q) {
  return q.split('\n').map(line => {
    const match = /^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line);
    assert.ok(match, 'fixture expects exact framed text'); return {id: match[1], original: match[2]};
  });
}
function replyBlock(q, translate, reverse = false) {
  const entries = rows(q); if (reverse) entries.reverse();
  return google(entries.map(({id, original}) => `${id} ${translate(original)}`).join('\n'));
}

test('framing is bounded, deterministic and lossless while unsafe strings remain individual', () => {
  const input = ['棉', '黑色', '棉', '原文\n两行', '[[YFTR000001]] 原文', '中'.repeat(5000), '中'.repeat(5001), '白色', '蓝色'];
  const before = JSON.stringify(input), planned = batch.planGoogleTranslationRequests(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(plain(planned), plain(batch.planGoogleTranslationRequests(input)));
  const originals = planned.flatMap(request => request.kind === 'block' ? request.entries.map(entry => entry.original) : [request.text]);
  assert.deepEqual(plain(originals), [...new Set(input)]);
  for (const request of planned) if (request.kind === 'block') {
    assert.ok(request.text.length <= 5000); assert.ok(request.entries.length > 1);
  }
  assert.deepEqual(plain(planned.filter(request => request.kind === 'single').map(request => request.text)), input.slice(3, 7));
});

test('shuffled exact IDs bind independent values without positional swaps or marker numbers', () => {
  const [block] = batch.planGoogleTranslationRequests(['宽度 10 cm', '长度 20 cm']);
  const output = `${block.entries[1].id} 길이 20 cm\n${block.entries[0].id} 너비 10 cm`;
  const result = batch.parseGoogleTranslationBlock(output, block);
  assert.equal(result.get('宽度 10 cm'), '너비 10 cm');
  assert.equal(result.get('长度 20 cm'), '길이 20 cm');
  assert.ok([...result.values()].every(value => !value.includes('YFTR')));
});

test('unknown, duplicated, missing, corrupted and nested IDs reject the entire ambiguous block', () => {
  const [block] = batch.planGoogleTranslationRequests(['单价 12.50', '库存 8']);
  const [a, b] = block.entries;
  for (const output of [
    `${a.id} 가격 12.50\n${a.id} 재고 8`,
    `${a.id} 가격 12.50\n[[YFTR999999]] 재고 8`,
    `${a.id} 가격 12.50`,
    `${a.id.toLowerCase()} 가격 12.50\n${b.id} 재고 8`,
    `${a.id} 가격 12.50 ${b.id}\n${b.id} 재고 8`,
    `가격 12.50\n재고 8`,
    `${a.id} 가격 12.50\n\n${b.id} 재고 8`,
  ]) assert.equal(batch.parseGoogleTranslationBlock(output, block), null);
});

test('24 attributes and 6 options use one title plus one block through the exact keyless GET', async () => {
  const translations = new Map([['太阳镜', '선글라스'], ['商品说明', '상품 설명']]);
  const attributes = Array.from({length: 24}, (_, index) => {
    translations.set(`属性${index}`, `속성 ${index}`); translations.set(`棉${index}`, `면 ${index}`);
    return {name: `属性${index}`, value: `棉${index}`};
  });
  for (let index = 0; index < 6; index++) {
    translations.set(`黑色${index} / M`, `검정 ${index} / M`); translations.set(`黑色${index}`, `검정 ${index}`);
    attributes.push({name: `option:sku_${index}`, value: `黑色${index} / M`},
      {name: `option-color:sku_${index}`, value: `黑色${index}`}, {name: `option-size:sku_${index}`, value: 'M'});
  }
  const input = source(attributes, {description: '商品说明'}), before = JSON.stringify(input), queries = [];
  let active = 0, maxActive = 0;
  const result = await drafts.buildGoogleTranslationDraft(input, async (url, init) => {
    const address = new URL(url); assert.equal(address.origin, 'https://translate.googleapis.com');
    assert.equal(address.pathname, '/translate_a/single');
    assert.deepEqual([...address.searchParams].map(([name]) => name), ['client', 'sl', 'tl', 'dt', 'q']);
    for (const [name, value] of Object.entries({client: 'gtx', sl: 'auto', tl: 'ko', dt: 't'})) assert.equal(address.searchParams.get(name), value);
    assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'manual');
    const q = address.searchParams.get('q'); queries.push(q); assert.ok(q.length <= 5000);
    active++; maxActive = Math.max(maxActive, active); await new Promise(resolve => setTimeout(resolve, 1)); active--;
    const translate = original => {assert.ok(translations.has(original), original); return translations.get(original);};
    return q === input.title ? google(translate(q)) : replyBlock(q, translate, true);
  });
  assert.equal(result.requests, 2); assert.equal(queries.length, 2); assert.equal(maxActive, 1);
  assert.equal(queries[0], input.title); assert.equal(result.draft.title, '선글라스');
  assert.equal(result.draft.description, '상품 설명'); assert.equal(result.draft.attributes.length, 42);
  for (let index = 0; index < 6; index++) {
    assert.equal(result.draft.attributes[24 + index * 3].name, `option:sku_${index}`);
    assert.equal(result.draft.attributes[24 + index * 3].value, `검정 ${index} / M`);
  }
  const sent = rows(queries[1]).map(row => row.original);
  assert.equal(new Set(sent).size, sent.length); assert.equal(JSON.stringify(input), before);
});

test('shuffled IDs do not relax per-field money or measurement evidence checks', async () => {
  const input = source([{name: '商品属性: 单价', value: '12.50 元'}, {name: '商品属性: 宽度', value: '10 厘米'},
    {name: '商品属性: 材质', value: '棉'}], {title: '한국어 선글라스'});
  const values = new Map([['商品属性: 单价', '상품 속성: 단가'], ['12.50 元', '125.00 위안'],
    ['商品属性: 宽度', '상품 속성: 너비'], ['10 厘米', '20 센티미터'], ['商品属性: 材质', '상품 속성: 소재'], ['棉', '면']]);
  const result = await drafts.buildGoogleTranslationDraft(input, async url => replyBlock(new URL(url).searchParams.get('q'), original => values.get(original), true));
  assert.deepEqual(plain(result.draft.attributes.map(attribute => attribute.sourceIndex)), [2]);
  assert.equal(result.draft.attributes[0].value, '면');
  assert.match(result.draft.warnings.join(' '), /원문에 없는 숫자.*2개/);
});

test('a corrupted block preserves the successful title and never re-calls individual fields', async () => {
  const input = source([{name: '材质', value: '棉'}, {name: '价格', value: '12.50 元'}]); let calls = 0;
  const result = await drafts.buildGoogleTranslationDraft(input, async url => {
    calls++; const q = new URL(url).searchParams.get('q'); if (q === input.title) return google('선글라스');
    const entries = rows(q);
    return google(entries.map((entry, index) => `${index ? entries[0].id : entry.id} 가격 125.00`).join('\n'));
  });
  assert.equal(calls, 2); assert.equal(result.draft.title, '선글라스'); assert.equal(result.draft.attributes.length, 0);
  assert.match(result.draft.warnings.join(' '), /식별자.*적용하지/); assert.match(result.draft.warnings.join(' '), /개별 재요청하지/);
});

for (const status of [429, 500, 503]) test(`HTTP ${status} retains a successful block and stops every later block without fallback`, async () => {
  const input = source(Array.from({length: 20}, (_, index) => ({name: `option-color:sku_${index}`, value: `颜色${index} ${'文'.repeat(900)}`})));
  const queries = [];
  const result = await drafts.buildGoogleTranslationDraft(input, async url => {
    const q = new URL(url).searchParams.get('q'); queries.push(q);
    if (queries.length === 1) return google('선글라스');
    if (queries.length === 2) return replyBlock(q, original => `색상 ${original.match(/\d+/u)[0]}`, true);
    return new Response('fixture service failure', {status});
  });
  assert.equal(queries.length, 3); assert.equal(result.requests, 3); assert.equal(result.stoppedHttpStatus, status);
  assert.deepEqual(plain(result.draft.attributes.map(attribute => attribute.sourceIndex)), [0, 1, 2, 3, 4]);
  assert.equal(result.draft.title, '선글라스'); assert.match(result.draft.warnings.join(' '), new RegExp(`HTTP ${status}.*중단`));
});

test('a failed essential title produces only its original plain-text request', async () => {
  const input = source([{name: '材质', value: '棉'}]); const queries = [];
  const result = await drafts.buildGoogleTranslationDraft(input, async url => {
    queries.push(new URL(url).searchParams.get('q')); return new Response('fixture limit', {status: 429});
  });
  assert.deepEqual(queries, [input.title]); assert.equal(result.requests, 1); assert.equal(result.draft.title, '');
  assert.equal(result.draft.attributes.length, 0); assert.equal(result.failure.status, 429);
});

test('newline, marker-like and oversized source remains intact without ambiguous framing or truncation', async () => {
  const input = source([{name: 'option:sku_a', value: '红色\n10'}, {name: 'option:sku_b', value: '[[YFTR000001]] 黑色'},
    {name: 'option:sku_c', value: '中'.repeat(5001)}, {name: 'option:sku_d', value: '棉'}],
    {title: '한국어 선글라스', description: '中'.repeat(5001)}), before = JSON.stringify(input), queries = [];
  const result = await drafts.buildGoogleTranslationDraft(input, async url => {
    const q = new URL(url).searchParams.get('q'); queries.push(q);
    return google(new Map([['红色\n10', '빨강\n10'], ['[[YFTR000001]] 黑色', '검정'], ['棉', '면']]).get(q));
  });
  assert.deepEqual(queries, ['红色\n10', '[[YFTR000001]] 黑色', '棉']);
  assert.equal(result.requests, 3); assert.equal(result.draft.description, '');
  assert.deepEqual(plain(result.draft.attributes.map(attribute => attribute.sourceIndex)), [0, 1, 3]);
  assert.equal(JSON.stringify(input), before); assert.match(result.draft.warnings.join(' '), /설명 초안을 비워/);
});

test('individual unsafe text still obeys the total 49-request budget', async () => {
  const input = source(Array.from({length: 65}, (_, index) => ({name: `option-color:sku_${index}`, value: `颜色${index}\n样式`}))); let calls = 0;
  const result = await drafts.buildGoogleTranslationDraft(input, async url => {
    calls++; const q = new URL(url).searchParams.get('q'); return google(q === input.title ? '선글라스' : `색상 ${q.match(/\d+/u)[0]}`);
  });
  assert.equal(calls, 49); assert.equal(result.requests, 49); assert.equal(result.draft.attributes.length, 48);
  assert.match(result.draft.warnings.join(' '), /묶음 한도/);
});
