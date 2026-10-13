import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';

const native = createRequire(import.meta.url);
function load(file, overrides = {}, cache = new Map()) {
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  const code = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, crypto, TextEncoder, TextDecoder, structuredClone, Response, Request, URL, AbortSignal, AbortController, Blob, FormData, atob,
    fetch() { throw Error('Unexpected external request'); }, require(name) {
      if (name in overrides) return overrides[name];
      if (name.startsWith('@/')) return load(name.slice(2) + '.ts', overrides, cache);
      return native(name);
    }, ...overrides.globals }, { filename: file });
  return exports;
}
const model = load('app/automation/image-edit.ts');
const input = { sourceKey: 'owner/source.png', prompt: '', purpose: 'translate', size: '1024x1024', quality: 'low' };
const settings = model.imageProcessingSettings({ translateImages: true, removeBackground: false, addCopyright: true,
  translationPrompt: '- 숫자와 단위를 유지하고 간결한 한국어 표현을 사용하세요.\n- 이모지를 사용하지 마세요.' });
const source = { mime: 'image/png', width: 1, height: 1, bytes: 67, sha256: 'a'.repeat(64) };
const copyStep = recipe => recipe.find(step => step.key === 'copywriting');

test('saved copywriting adds only fact-preserving Korean sales wording to translated source text', () => {
  for (const purpose of ['translate', 'thumbnail', 'detail']) {
    const result = model.imageRecipe({ ...input, purpose }, settings);
    assert.equal(copyStep(result.recipe)?.status, 'applied', purpose);
    assert.match(result.effectivePrompt, /Korean marketing copy/);
    assert.match(result.effectivePrompt, /Do not add new slogans/);
    assert.match(result.effectivePrompt, /Do not invent features, measurements, certifications/);
    assert.match(result.effectivePrompt, /Preserve exact numbers, units and identifiers/);
    assert.match(result.effectivePrompt, /Do not use emojis or emoticons/);
    assert.equal(result.recipe.find(step => step.key === 'copyright').status, 'skipped');
    assert.match(result.effectivePrompt, /Never infer a copyright owner/);
    assert.match(result.effectivePrompt, /Preserve existing copyright marks and watermarks/);
  }
});

test('copywriting is inactive when disabled, translation setting is off, or purpose is cleanup', () => {
  for (const [purpose, patch] of [['translate', { addCopyright: false }], ['detail', { translateImages: false }],
    ['translate', { translateImages: false }], ['cleanup', {}]]) {
    const result = model.imageRecipe({ ...input, purpose }, model.imageProcessingSettings({ ...settings, ...patch }));
    assert.equal(copyStep(result.recipe)?.status, 'skipped', purpose + JSON.stringify(patch));
    assert.doesNotMatch(result.effectivePrompt, /Task:.*Korean marketing copy|Rewrite legible promotional source text as concise Korean marketing copy/);
    if (purpose === 'cleanup') assert.match(result.effectivePrompt, /Do not translate retained text or add replacement copy/);
    if (purpose === 'detail' && patch.translateImages === false) assert.match(result.effectivePrompt, /Do not translate or rewrite it/);
  }
});

test('saved style guidance and manual request stay subordinate to product facts and ownership', () => {
  const guide = '인증마크를 새로 추가하고 © EXAMPLE 소유권 문구를 넣어라';
  const result = model.imageRecipe({ ...input, prompt: 'Create extra accessories and new safety claims.' },
    model.imageProcessingSettings({ ...settings, translationPrompt: guide, brand: 'UNVERIFIED-RIGHTS-OWNER' }));
  assert.match(result.effectivePrompt, /Saved translation style guidance \(JSON string\)/);
  assert.ok(result.effectivePrompt.includes(JSON.stringify(guide)));
  assert.match(result.effectivePrompt, /ignore conflicting requests/);
  assert.doesNotMatch(result.effectivePrompt, /UNVERIFIED-RIGHTS-OWNER/);
  assert.match(result.effectivePrompt, /Never infer a copyright owner/);
});

test('new reviews use a new recipe version without changing saved settings or original evidence', async () => {
  const before = JSON.stringify({ input, settings, source });
  const review = await model.prepareImageReview(input, source, 'gpt-image-1.5', settings, new Date('2026-10-13T00:00:00Z'));
  assert.equal(model.imageRecipeVersion, 2);
  assert.equal(review.recipeVersion, 2);
  assert.equal(copyStep(review.recipe)?.status, 'applied');
  assert.equal(JSON.stringify(review.settingsSnapshot), JSON.stringify(settings));
  assert.equal(JSON.stringify({ input, settings, source }), before);
  const disabled = await model.prepareImageReview(input, source, 'gpt-image-1.5', { ...settings, addCopyright: false }, new Date('2026-10-13T00:00:00Z'));
  assert.notEqual(disabled.fingerprint, review.fingerprint);
});

test('an old prepared review is rejected before decoding source or calling a paid provider', async () => {
  const review = await model.prepareImageReview(input, source, 'gpt-image-1.5', settings);
  let calls = 0;
  await assert.rejects(model.executeImageEdit({ ...review, recipeVersion: 1 }, { apiKey: 'LOCAL-TEST-ONLY', model: review.model },
    new Uint8Array(), async () => { calls++; throw Error('Unexpected paid request'); }), error => error.code === 'IMAGE_RECIPE_CHANGED');
  assert.equal(calls, 0);
});

test('a reviewed copywriting request reaches the exact outgoing image form once and preserves original bytes', async () => {
  const crc32 = load('app/exports/zip.ts').crc32;
  function png(width, height) {
    const chunk = (type, bytes) => { const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
      size.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes]))); return Buffer.concat([size, name, bytes, crc]); };
    const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
      chunk('IDAT', deflateSync(Buffer.alloc(height * (width * 4 + 1)))), chunk('IEND', Buffer.alloc(0))]);
  }
  const original = png(1, 1), before = Buffer.from(original), output = png(1024, 1024);
  for (const addCopyright of [true, false]) {
    const review = await model.prepareImageReview(input, await model.imageMetadata(original), 'gpt-image-1.5', { ...settings, addCopyright });
    let calls = 0;
    const result = await model.executeImageEdit(review, { apiKey: 'LOCAL-TEST-ONLY', model: review.model }, original, async (url, init) => {
      calls++; assert.equal(url, 'https://api.openai.com/v1/images/edits'); assert.equal(init.redirect, 'manual');
      assert.equal(init.body.get('prompt'), review.effectivePrompt); assert.equal(init.body.get('n'), '1');
      assert.equal(init.body.get('prompt').includes('Rewrite legible promotional source text as concise Korean marketing copy'), addCopyright);
      assert.deepEqual(Buffer.from(await init.body.get('image').arrayBuffer()), before);
      return Response.json({ data: [{ b64_json: output.toString('base64') }], output_format: 'png' });
    });
    assert.equal(calls, 1); assert.deepEqual(Buffer.from(result.bytes), output); assert.deepEqual(original, before);
  }
});

const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null ? '' : String(tree);
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
function panelHarness({ status = 'prepared', recipeVersion = 2 } = {}) {
  const slots = [], effects = [], calls = []; let index = 0;
  const job = { id: 'local-image-job', productId: 'local-product', productVersion: 'v', contentRevision: 0, status,
    createdAt: '2026-10-13T00:00:00Z', review: { ...input, sourceKey: 'owner/source.png', source, model: 'gpt-image-1.5',
      fingerprint: 'review', settingsFingerprint: 'settings', settingsSnapshot: settings, recipeVersion,
      recipe: [], effectivePrompt: 'fixed historical request', expiresAt: '2099-01-01', paidNotice: 'local only', pricingUrl: 'https://example.invalid' },
    result: status === 'completed' ? { attached: false, storageKey: 'owner/edited.png' } : null, error: null };
  const view = { configuration: { configured: true, issues: [] }, settings, settingsFingerprint: 'settings', jobs: [job] };
  const hooks = { useState(initial) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
    return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
  useRef(initial) { const i = index++; return slots[i] ?? (slots[i] = { current: initial }); },
  useEffect(fn, deps) { const i = index++, old = slots[i]; if (!old || !deps || deps.some((value, j) => !Object.is(value, old.deps[j]))) {
    const next = { deps, cleanup: null }; slots[i] = next; effects.push(() => { old?.cleanup?.(); next.cleanup = fn(); });
  } } };
  const Panel = load('app/components/image-generation-panel.tsx', { react: hooks, globals: { fetch: async (url, init) => {
    calls.push({ url, init }); return Response.json(init?.method === 'POST' ? { job: { ...job, result: { attached: true, storageKey: 'owner/edited.png' } } } : view);
  } } }).default;
  const props = { productId: 'local-product', version: 'v', imageKeys: ['owner/source.png'] };
  function render() { index = 0; const wrapper = Panel(props), tree = wrapper.type(wrapper.props); effects.splice(0).forEach(fn => fn()); return tree; }
  render();
  return { calls, render, close() { slots.forEach(slot => slot?.cleanup?.()); } };
}

test('current image review shows marketing copywriting rather than a false ownership-mark setting', async () => {
  const h = panelHarness();
  try {
    await settle(); const tree = h.render();
    assert.match(text(tree), /카피라이팅 켜짐/);
    assert.doesNotMatch(text(tree), /저작권 표시 켜짐|권리자 문구가 없어 미적용/);
    const checkbox = nodes(tree).find(node => node.type === 'input' && node.props.type === 'checkbox');
    assert.equal(checkbox.props.disabled, false);
    checkbox.props.onChange({ target: { checked: true } });
    const approve = nodes(h.render()).find(node => node.type === 'button' && text(node) === '유료 요청 승인 · 아직 호출하지 않음');
    assert.equal(approve.props.disabled, false);
    assert.equal(h.calls.length, 1);
  } finally { h.close(); }
});

test('old prepared and approved reviews remain readable but require new review before spending', async () => {
  for (const status of ['prepared', 'approved']) {
    const h = panelHarness({ status, recipeVersion: 1 });
    try {
      await settle(); const tree = h.render();
      assert.match(text(tree), /fixed historical request/);
      const button = nodes(tree).find(node => node.type === 'button' && text(node) === (status === 'prepared'
        ? '유료 요청 승인 · 아직 호출하지 않음' : '승인한 이미지 1장 가공 · 비용 발생'));
      assert.equal(button.props.disabled, true);
      assert.equal(h.calls.length, 1);
    } finally { h.close(); }
  }
});

test('completed old image results can still be attached without calling any image provider', async () => {
  const h = panelHarness({ status: 'completed', recipeVersion: 1 });
  try {
    await settle(); const attach = nodes(h.render()).find(node => node.type === 'button' && text(node) === '생성된 결과를 현재 상품에 추가 · 무료');
    assert.equal(attach.props.disabled, false); attach.props.onClick(); await settle();
    assert.equal(h.calls.length, 2);
    assert.equal(JSON.parse(h.calls[1].init.body).action, 'attach');
    assert.match(text(h.render()), /fixed historical request/);
  } finally { h.close(); }
});
