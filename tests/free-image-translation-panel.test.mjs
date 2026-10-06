import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';

const native = createRequire(import.meta.url), version = '2026-10-06T00:00:00.000Z';
const plain = value => JSON.parse(JSON.stringify(value));
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const region = (id, translated = '') => ({ id, text: '中文 ' + id, box: { x: 1, y: 1, width: 18, height: 8 }, confidence: 90,
  selected: true, translated, issue: null, translationProvenance: translated ? 'generated' : 'empty', background: '#ffffff', foreground: '#111111', fontSize: 4 });
class ApplyError extends Error { constructor(message, uncertain) { super(message); this.uncertain = uncertain; } }

function fixture() {
  const calls = [], busy = [], states = [], effects = [], urls = [], revoked = []; let cursor = 0, closed = false, late = 0, saved = 0, allowApply = true;
  let props = { productId: 'product', version, imageKeys: ['owner/original.png', 'owner/second.png'],
    translationTarget: { sourceKey: 'owner/original.png', sequence: 1, sourceLanguage: 'zh', role: 'detail' },
    onProductChanged: () => saved++, onBusyChange: value => busy.push(value), beforeApply: () => allowApply };
  let sourceIntercept = null, ocrIntercept = null, translateIntercept = null, renderIntercept = null, applyIntercept = null;
  class ObjectURL extends URL { static createObjectURL(blob) { const url = 'blob:fixture-' + urls.length; urls.push({ url, blob }); return url; } static revokeObjectURL(url) { revoked.push(url); } }
  const hooks = {
    useState(initial) { const id = cursor++; if (!(id in states)) states[id] = typeof initial === 'function' ? initial() : initial;
      return [states[id], value => { if (closed) late++; states[id] = typeof value === 'function' ? value(states[id]) : value; }]; },
    useRef(initial) { const id = cursor++; return states[id] ?? (states[id] = { current: initial }); },
    useEffect(fn, deps) { const id = cursor++, old = states[id]; if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) {
      const next = { deps }; states[id] = next; effects.push(() => { old?.cleanup?.(); next.cleanup = fn(); });
    } },
  };
  const sourceFor = (id, productVersion, sourceKey, role) => ({ productId: id, productVersion, contentRevision: 2, sourceKey, sourceSha256: 'a'.repeat(64), role, width: 20, height: 12 });
  const client = {
    FreeImageApplyError: ApplyError,
    async readFreeImageSource(id, productVersion, key, role, signal) { calls.push({ action: 'source', id, productVersion, key, role, signal });
      const image = { source: sourceFor(id, productVersion, key, role), width: 20, height: 12, blob: new Blob(['original']), canvas: {} }; return sourceIntercept ? sourceIntercept(image, signal) : image; },
    async recognizeFreeImage(image, language, signal, progress) { calls.push({ action: 'ocr', image, language, signal }); progress('인식 중'); return ocrIntercept ? ocrIntercept(image, signal) : [region('r1'), region('r2')]; },
    async translateFreeImageRegions(source, language, rows, signal) { calls.push({ action: 'translate', source, language, rows, signal });
      return translateIntercept ? translateIntercept(source, rows, signal) : { source, regions: rows.map(row => ({ id: row.id, original: row.text, translated: '한국어 ' + row.id, issue: null })), requests: 1, stoppedHttpStatus: null, warnings: [] }; },
    async renderFreeImageTranslation(image, rows, signal, optionImageIds = []) {
      const selection = Array.from(optionImageIds).sort(); calls.push({ action: 'preview', image, rows, signal, optionImageIds: selection });
      if (selection.some(id => image.source.role !== 'main' || !image.source.optionImages?.optionIds.includes(id)) || new Set(selection).size !== selection.length
        || image.source.optionImages?.commonAssigned === false && !selection.length) throw Error('이 원본을 대표 이미지로 사용하는 옵션만 선택해주세요.');
      return renderIntercept ? renderIntercept(image, rows, signal, selection) : { source: image.source, output: new Blob(['rendered PNG'], { type: 'image/png' }), width: 20, height: 12,
        ...(selection.length ? { optionImageIds: [...selection] } : {}) }; },
    async applyFreeImageTranslation(image, signal) { calls.push({ action: 'apply', image, signal });
      return applyIntercept ? applyIntercept(image, signal) : { source: image.source, key: 'owner/generated.png', applied: true, productVersion: '2026-10-06T00:00:01Z', contentRevision: 3 }; },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/free-image-translation-panel.tsx', import.meta.url), 'utf8'),
    { fileName: 'panel.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, Error, Date, URL: ObjectURL, Blob, AbortController, console, require(name) {
      if (name === 'react') return hooks; if (name === 'react/jsx-runtime') return native(name);
      if (name === '@/app/free-image-translation') return { FREE_IMAGE_ROLES: ['main', 'additional', 'detailTop', 'detail', 'detailBottom'], MAX_OCR_REGIONS: 100 };
      assert.equal(name, '@/app/free-image-translation-client'); return client;
    } });
  const render = () => { cursor = 0; const outer = exports.default(props), tree = outer.type(outer.props); effects.splice(0).forEach(fn => fn()); return tree; };
  const settle = async () => { for (let index = 0; index < 6; index++) { render(); await new Promise(resolve => setImmediate(resolve)); } };
  const button = label => nodes(render()).find(node => node.type === 'button' && text(node) === label);
  const field = label => nodes(render()).find(node => node.props['aria-label'] === label);
  render(); render();
  return { render, settle, calls, busy, urls, revoked, button, field, get saved() { return saved; }, get late() { return late; },
    setSource(fn) { sourceIntercept = fn; }, setOcr(fn) { ocrIntercept = fn; }, setTranslate(fn) { translateIntercept = fn; }, setRender(fn) { renderIntercept = fn; }, setApply(fn) { applyIntercept = fn; },
    setProps(update) { props = { ...props, ...update }; render(); render(); }, allowApply(value) { allowApply = value; },
    async click(label) { await settle(); const control = button(label); assert.ok(control && !control.props.disabled, 'available control: ' + label); control.props.onClick(); await settle(); },
    async change(label, value, checked) { const control = field(label); assert.ok(control, label); control.props.onChange({ target: { value, checked } }); await settle(); },
    close() { if (closed) return; states.forEach(state => state?.cleanup?.()); closed = true; } };
}
async function translated(h) { await h.click('원본 문구 읽기'); await h.click('선택 문구 한국어 번역'); }

test('toolbar source/language/role selection does not automatically run OCR, Google or save and marks only its own source stage', async () => {
  const h = fixture(); try {
    await h.settle();
    assert.equal(h.calls.length, 0); assert.equal(h.field('번역할 원본 이미지').props.value, 'owner/original.png');
    assert.equal(h.render().props['data-quotation-source-step'], '상세 이미지'); assert.equal(h.render().props['data-workspace-dirty'], undefined);
    h.setProps({ translationTarget: { sourceKey: 'owner/second.png', sequence: 2, role: 'main', sourceLanguage: 'en' } }); await h.settle();
    assert.equal(h.calls.length, 0); assert.equal(h.field('이미지 원문 언어').props.value, 'en'); assert.equal(h.field('번역할 이미지 역할').props.value, 'main');
    assert.equal(h.render().props['data-quotation-source-step'], '대표 이미지');
    await h.change('번역할 이미지 역할', 'additional'); assert.equal(h.calls.length, 0); assert.equal(h.render().props['data-quotation-source-step'], '추가 이미지');
  } finally { h.close(); }
});

test('explicit OCR and selected translation retain manual Korean/blanks and invalidate previews on further edits', async () => {
  const h = fixture(); try {
    await h.click('원본 문구 읽기'); assert.deepEqual(h.calls.map(call => call.action), ['source', 'ocr']);
    assert.equal(h.render().props['data-workspace-dirty'], 'true');
    assert.equal(nodes(h.render()).filter(node => node.props['data-workspace-dirty']).length, 1, 'only panel root is ignored by its own apply guard');
    await h.change('문구 1 한국어', '직접 검토한 한국어'); await h.click('선택 문구 한국어 번역');
    assert.deepEqual(plain(h.calls.find(call => call.action === 'translate').rows), [{ id: 'r2', text: '中文 r2' }]);
    assert.equal(h.field('문구 1 한국어').props.value, '직접 검토한 한국어'); assert.equal(h.field('문구 2 한국어').props.value, '한국어 r2');
    await h.click('번역 이미지 미리보기'); assert.ok(h.button('검토한 번역 이미지 적용')); assert.equal(h.calls.filter(call => call.action === 'apply').length, 0);
    await h.change('문구 1 한국어', ''); assert.equal(h.button('검토한 번역 이미지 적용'), undefined);
    await h.change('문구 2 원문', '수정한 원문'); await h.click('선택 문구 한국어 번역');
    const last = h.calls.filter(call => call.action === 'translate').at(-1); assert.deepEqual(plain(last.rows), [{ id: 'r2', text: '수정한 원문' }]);
    assert.equal(h.field('문구 1 한국어').props.value, '', 'explicit manual blank is not refilled');
    await h.click('문구 2 영역 삭제'); assert.equal(h.field('문구 2 원문'), undefined);
    await h.click('문구 영역 직접 추가'); assert.ok(h.field('문구 2 원문')); assert.equal(h.calls.filter(call => call.action === 'apply').length, 0);
  } finally { h.close(); }
});

test('apply requires reviewed preview and the parent guard, prevents double action, then notifies a single saved change', async () => {
  const h = fixture(); try {
    await translated(h); await h.click('번역 이미지 미리보기'); h.allowApply(false);
    await h.click('검토한 번역 이미지 적용'); assert.equal(h.calls.filter(call => call.action === 'apply').length, 0); assert.equal(h.saved, 0);
    h.allowApply(true); const pending = deferred(); h.setApply(() => pending.promise);
    const first = h.button('검토한 번역 이미지 적용'); first.props.onClick(); first.props.onClick(); await h.settle();
    assert.equal(h.calls.filter(call => call.action === 'apply').length, 1); assert.equal(h.busy.at(-1), true);
    pending.resolve({ applied: true }); await h.settle();
    assert.equal(h.saved, 1); assert.equal(h.busy.at(-1), false); assert.equal(h.render().props['data-workspace-dirty'], undefined);
    assert.equal(h.button('검토한 번역 이미지 적용'), undefined);
  } finally { h.close(); }
});

test('unknown save response retains the exact output/proof for explicit retry even after a newer product version', async () => {
  const h = fixture(); try {
    await translated(h); await h.click('번역 이미지 미리보기'); let attempts = 0;
    h.setApply(async () => { if (!attempts++) throw new ApplyError('응답 유실', true); return { applied: true, replayed: true }; });
    await h.click('검토한 번역 이미지 적용'); assert.equal(h.saved, 0); assert.equal(h.calls.filter(call => call.action === 'apply').length, 1);
    assert.ok(h.button('같은 결과의 저장 상태 다시 확인')); assert.equal(h.field('번역할 원본 이미지').props.disabled, true);
    h.setProps({ version: '2026-10-06T00:00:03.000Z' }); await h.settle(); assert.ok(h.button('같은 결과의 저장 상태 다시 확인'));
    await h.click('같은 결과의 저장 상태 다시 확인');
    const saves = h.calls.filter(call => call.action === 'apply'); assert.equal(saves.length, 2); assert.equal(saves[0].image, saves[1].image);
    assert.equal(saves[1].image.source.productVersion, version); assert.equal(h.saved, 1); assert.equal(h.render().props['data-workspace-dirty'], undefined);
  } finally { h.close(); }
});

test('another saved stage preserves manual OCR text and blanks until an explicit same-original refresh; changed bytes never rebind the draft', async () => {
  const h = fixture(); try {
    await translated(h); await h.change('문구 1 원문', '직접 고친 원문'); await h.change('문구 1 한국어', '직접 확인한 번역'); await h.change('문구 2 한국어', '');
    await h.change('문구 2 선택', '', false);
    await h.click('번역 이미지 미리보기'); const count = h.calls.length;
    h.setProps({ version: '2026-10-06T00:00:02.000Z' }); await h.settle();
    assert.equal(h.calls.length, count, 'a new version does not implicitly read or translate');
    assert.equal(h.field('문구 1 한국어').props.value, '직접 확인한 번역'); assert.equal(h.field('문구 2 한국어').props.value, '');
    assert.equal(h.field('문구 1 원문').props.value, '직접 고친 원문');
    assert.equal(h.render().props['data-workspace-dirty'], 'true'); assert.equal(h.button('검토한 번역 이미지 적용'), undefined);
    assert.equal(h.button('번역 이미지 미리보기').props.disabled, true);
    await h.click('원본 저장 상태 다시 확인');
    assert.equal(h.field('문구 1 한국어').props.value, '직접 확인한 번역'); assert.equal(h.field('문구 2 한국어').props.value, '');
    assert.equal(h.field('문구 1 원문').props.value, '직접 고친 원문');
    assert.equal(h.calls.filter(call => call.action === 'ocr').length, 1); assert.equal(h.calls.filter(call => call.action === 'translate').length, 1);
    assert.equal(h.button('번역 이미지 미리보기').props.disabled, false); assert.equal(h.button('검토한 번역 이미지 적용'), undefined);
    const checkedCount = h.calls.length; h.setProps({ version: '2026-10-06T00:00:03.000Z' }); await h.settle(); assert.equal(h.calls.length, checkedCount);
    const reading = deferred(); let fresh;
    h.setSource(image => { fresh = image; return reading.promise; }); h.button('원본 저장 상태 다시 확인').props.onClick(); await h.settle();
    assert.equal(h.render().props['data-workspace-saving'], 'true'); assert.equal(h.render().props['data-workspace-busy'], undefined);
    reading.resolve({ ...fresh, source: { ...fresh.source, sourceSha256: 'b'.repeat(64) } }); await h.settle();
    assert.equal(h.render().props['data-workspace-saving'], undefined);
    assert.equal(h.field('문구 1 한국어').props.value, '직접 확인한 번역'); assert.equal(h.field('문구 2 한국어').props.value, '');
    assert.equal(h.field('문구 1 원문').props.value, '직접 고친 원문');
    assert.equal(h.button('번역 이미지 미리보기').props.disabled, true); assert.equal(h.button('검토한 번역 이미지 적용'), undefined);
    assert.match(nodes(h.render()).filter(node => node.props.role === 'alert').map(text).join(' '), /원본.*변경.*유지/);
    assert.equal(h.saved, 0); assert.equal(h.calls.filter(call => call.action === 'apply').length, 0);
  } finally { h.close(); }
});

test('cancel, new target and unmount abort active work and ignore late OCR/translation/apply outcomes', async () => {
  const h = fixture(); try {
    await h.settle();
    const pending = deferred(); h.setOcr(() => pending.promise); const click = h.button('원본 문구 읽기'); click.props.onClick(); await h.settle();
    assert.equal(h.busy.at(-1), true); const cancel = h.button('이미지 작업 취소'); cancel.props.onClick();
    assert.equal(h.busy.at(-1), false, 'busy cancellation is synchronous'); assert.equal(h.calls.find(call => call.action === 'ocr').signal.aborted, true);
    pending.resolve([region('late')]); await h.settle(); assert.equal(h.field('문구 1 원문'), undefined);
    h.setOcr(null); await h.click('원본 문구 읽기');
    const translating = deferred(); h.setTranslate(() => translating.promise); h.button('선택 문구 한국어 번역').props.onClick(); await h.settle();
    h.setProps({ translationTarget: { sourceKey: 'owner/second.png', sequence: 2, role: 'detail', sourceLanguage: 'en' } }); await h.settle();
    assert.equal(h.calls.find(call => call.action === 'translate').signal.aborted, true); assert.equal(h.field('문구 1 원문').props.value, '中文 r1');
    assert.equal(h.field('번역할 원본 이미지').props.value, 'owner/original.png'); assert.equal(h.calls.filter(call => call.action === 'ocr').length, 2, 'new target does not run another OCR');
    translating.resolve({ regions: [{ id: 'r1', original: '中文 r1', translated: 'late', issue: null }], warnings: [] }); await h.settle(); assert.equal(h.field('문구 1 한국어').props.value, '');
    await h.click('이미지 번역 편집 초안 지우기');
    h.setProps({ translationTarget: { sourceKey: 'owner/second.png', sequence: 3, role: 'detail', sourceLanguage: 'en' } }); await h.settle();
    assert.equal(h.field('번역할 원본 이미지').props.value, 'owner/second.png'); assert.equal(h.field('문구 1 원문'), undefined);
    h.setTranslate(null); await translated(h); await h.click('번역 이미지 미리보기');
    const saving = deferred(); h.setApply(() => saving.promise); h.button('검토한 번역 이미지 적용').props.onClick(); await h.settle();
    h.close(); assert.equal(h.busy.at(-1), false); assert.equal(h.calls.filter(call => call.action === 'apply').at(-1).signal.aborted, true);
    saving.resolve({ applied: true }); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.saved, 0); assert.equal(h.late, 0);
    assert.ok(h.revoked.length > 0);
  } finally { h.close(); }
});

test('repeated same-image targets retain manual drafts; different image/role and OCR reset require explicit draft clearing', async () => {
  const h = fixture(); try {
    await translated(h); await h.change('문구 1 한국어', '직접 검토한 번역'); await h.change('문구 2 한국어', '');
    const originalUrl = nodes(h.render()).find(node => node.type === 'img' && node.props.alt === '문구 번역 원본').props.src;
    const count = h.calls.length;
    h.setProps({ translationTarget: { sourceKey: 'owner/original.png', sequence: 2, role: 'detail', sourceLanguage: 'en' } }); await h.settle();
    assert.equal(h.field('문구 1 한국어').props.value, '직접 검토한 번역'); assert.equal(h.field('문구 2 한국어').props.value, '');
    assert.equal(h.field('이미지 원문 언어').props.value, 'en'); assert.equal(h.calls.length, count);
    assert.equal(nodes(h.render()).find(node => node.type === 'img' && node.props.alt === '문구 번역 원본').props.src, originalUrl);
    assert.equal(h.button('원본 문구 읽기').props.disabled, true);
    h.button('원본 문구 읽기').props.onClick(); await h.settle(); assert.equal(h.calls.length, count, 'even an old handler cannot reset an edited OCR draft');
    h.setProps({ translationTarget: { sourceKey: 'owner/second.png', sequence: 3, role: 'main', sourceLanguage: 'zh' } }); await h.settle();
    assert.equal(h.field('번역할 원본 이미지').props.value, 'owner/original.png'); assert.equal(h.field('번역할 이미지 역할').props.value, 'detail');
    assert.equal(h.field('문구 1 한국어').props.value, '직접 검토한 번역'); assert.equal(h.field('문구 2 한국어').props.value, ''); assert.equal(h.calls.length, count);
    await h.change('번역할 이미지 역할', 'additional'); assert.equal(h.field('번역할 이미지 역할').props.value, 'detail');
    await h.click('이미지 번역 편집 초안 지우기'); assert.equal(h.field('문구 1 원문'), undefined);
    assert.equal(nodes(h.render()).some(node => node.type === 'img'), false, 'no URL for the discarded blob remains visible'); assert.ok(h.revoked.includes(originalUrl));
    h.setProps({ translationTarget: { sourceKey: 'owner/second.png', sequence: 4, role: 'main', sourceLanguage: 'en' } }); await h.settle();
    assert.equal(h.field('번역할 원본 이미지').props.value, 'owner/second.png'); assert.equal(h.field('번역할 이미지 역할').props.value, 'main'); assert.equal(h.calls.length, count);
    assert.equal(h.button('원본 문구 읽기').props.disabled, false); assert.equal(h.calls.filter(call => call.action === 'apply').length, 0);
  } finally { h.close(); }
});

function mainImageOptions(h, focusedOptionId, ids = ['sku-a', 'sku-b'], optionOnly = false) {
  h.setProps({ focusedOptionId, translationTarget: { sourceKey: 'owner/original.png', sequence: 2, role: 'main', sourceLanguage: 'zh' } });
  h.setSource(image => ({ ...image, source: { ...image.source, optionImages: { revision: 7, optionIds: [...ids], ...(optionOnly ? { commonAssigned: false } : {}) } } }));
}
const optionLabel = id => `옵션 ${id} 번역 대표 이미지 적용`;

test('focused option scope and full manual controls reach only the explicitly reviewed main-image preview/apply', async () => {
  const h = fixture(); try {
    mainImageOptions(h, 'sku-b'); await h.settle(); assert.equal(h.calls.length, 0);
    await h.click('원본 문구 읽기');
    assert.equal(h.field(optionLabel('sku-a')).props.checked, false); assert.equal(h.field(optionLabel('sku-b')).props.checked, true);
    await h.change('문구 1 원문', '검토한 원문'); await h.change('문구 1 한국어', '직접 확인한 한국어');
    await h.change('문구 2 한국어', ''); await h.change('문구 2 선택', '', false);
    for (const [field, value] of [['x', 2], ['y', 2], ['width', 12], ['height', 8]]) await h.change('문구 1 ' + field, String(value));
    await h.change('문구 1 배경색', '#ddeeff'); await h.change('문구 1 글자색', '#223344'); await h.change('문구 1 글자 크기', '6');
    await h.click('번역 이미지 미리보기');
    let previews = h.calls.filter(call => call.action === 'preview'); assert.deepEqual(previews[0].optionImageIds, ['sku-b']);
    assert.equal(h.calls.filter(call => call.action === 'apply').length, 0);
    const previousApply = h.button('검토한 번역 이미지 적용').props.onClick;
    const count = h.calls.length;
    await h.change(optionLabel('sku-a'), '', true);
    previousApply(); await h.settle();
    assert.equal(h.calls.filter(call => call.action === 'apply').length, 0, 'an old apply callback cannot save a preview whose scope was changed');
    assert.equal(h.calls.length, count, 'checkbox changes do not start OCR, Google, preview or save');
    assert.equal(h.button('검토한 번역 이미지 적용'), undefined, 'scope changes require a newly reviewed preview');
    assert.equal(h.field('문구 1 한국어').props.value, '직접 확인한 한국어'); assert.equal(h.field('문구 2 한국어').props.value, '');
    await h.click('번역 이미지 미리보기'); previews = h.calls.filter(call => call.action === 'preview');
    const last = previews.at(-1), row = last.rows[0];
    assert.deepEqual(last.optionImageIds, ['sku-a', 'sku-b']);
    assert.deepEqual(plain({ text: row.text, translated: row.translated, box: row.box, background: row.background, foreground: row.foreground, fontSize: row.fontSize }),
      { text: '검토한 원문', translated: '직접 확인한 한국어', box: { x: 2, y: 2, width: 12, height: 8 }, background: '#ddeeff', foreground: '#223344', fontSize: 6 });
    assert.equal(last.rows[1].translated, ''); assert.equal(last.rows[1].selected, false);
    assert.match(text(h.render()), /선택 옵션 2개 개별 대표 이미지/);
    assert.match(text(h.render()), /공통 대표 이미지 사용 옵션 포함/);
    await h.click('검토한 번역 이미지 적용');
    const applied = h.calls.filter(call => call.action === 'apply'); assert.equal(applied.length, 1);
    assert.deepEqual(applied[0].image.optionImageIds, ['sku-a', 'sku-b']);
    assert.deepEqual(plain(applied[0].image.source.optionImages), { revision: 7, optionIds: ['sku-a', 'sku-b'] });
    assert.equal(h.saved, 1); assert.equal(h.calls.filter(call => call.action === 'translate').length, 0);
  } finally { h.close(); }
});

test('main-image options default to no selection without a matching focused row; selection alone protects a failed OCR draft', async () => {
  for (const focused of [undefined, 'foreign-option']) {
    const h = fixture(); try {
      mainImageOptions(h, focused); await h.click('원본 문구 읽기');
      for (const id of ['sku-a', 'sku-b']) assert.equal(h.field(optionLabel(id)).props.checked, false);
      assert.equal(h.calls.filter(call => call.action === 'apply' || call.action === 'translate').length, 0);
    } finally { h.close(); }
  }
  const h = fixture(); try {
    mainImageOptions(h, 'sku-b'); h.setOcr(async () => { throw Error('읽을 문구 없음'); }); await h.click('원본 문구 읽기');
    assert.equal(h.field('문구 1 원문'), undefined); assert.equal(h.field(optionLabel('sku-b')).props.checked, true);
    const count = h.calls.length;
    h.setProps({ translationTarget: { sourceKey: 'owner/second.png', sequence: 3, role: 'main' } }); await h.settle();
    assert.equal(h.field('번역할 원본 이미지').props.value, 'owner/original.png'); assert.equal(h.field(optionLabel('sku-b')).props.checked, true);
    assert.equal(h.calls.length, count); assert.equal(h.render().props['data-workspace-dirty'], 'true');
    await h.click('이미지 번역 편집 초안 지우기');
    h.setProps({ translationTarget: { sourceKey: 'owner/second.png', sequence: 4, role: 'main' } }); await h.settle();
    assert.equal(h.field('번역할 원본 이미지').props.value, 'owner/second.png'); assert.equal(h.calls.length, count);
    assert.equal(h.field(optionLabel('sku-b')), undefined);
  } finally { h.close(); }
});

test('manual option scope after failed OCR blocks rereading even through a previously enabled callback until explicit discard', async () => {
  const h = fixture(); try {
    mainImageOptions(h, undefined); h.setOcr(async () => { throw Error('fixture OCR cannot read this image'); });
    await h.click('원본 문구 읽기');
    assert.equal(h.field('문구 1 원문'), undefined);
    assert.equal(h.field(optionLabel('sku-a')).props.checked, false); assert.equal(h.field(optionLabel('sku-b')).props.checked, false);
    const retainedRead = h.button('원본 문구 읽기'); assert.equal(retainedRead.props.disabled, false);
    await h.change(optionLabel('sku-a'), '', true);
    assert.equal(h.button('원본 문구 읽기').props.disabled, true);
    assert.equal(h.render().props['data-workspace-dirty'], 'true');
    const reads = h.calls.filter(call => call.action === 'source').length, recognitions = h.calls.filter(call => call.action === 'ocr').length;
    retainedRead.props.onClick(); await h.settle();
    assert.equal(h.calls.filter(call => call.action === 'source').length, reads, 'an earlier enabled callback cannot reread after a manual scope choice');
    assert.equal(h.calls.filter(call => call.action === 'ocr').length, recognitions, 'manual scope survives without another OCR request');
    assert.equal(h.field(optionLabel('sku-a')).props.checked, true); assert.equal(h.field(optionLabel('sku-b')).props.checked, false);
    assert.equal(h.render().props['data-workspace-dirty'], 'true'); assert.equal(h.saved, 0);
    assert.equal(h.calls.filter(call => call.action === 'translate' || call.action === 'preview' || call.action === 'apply').length, 0);
    await h.click('이미지 번역 편집 초안 지우기');
    assert.equal(h.field(optionLabel('sku-a')), undefined); assert.equal(h.render().props['data-workspace-dirty'], undefined);
    assert.equal(h.button('원본 문구 읽기').props.disabled, false);
    h.setOcr(null); await h.click('원본 문구 읽기');
    assert.equal(h.calls.filter(call => call.action === 'source').length, reads + 1); assert.equal(h.calls.filter(call => call.action === 'ocr').length, recognitions + 1);
    assert.ok(h.field('문구 1 원문')); assert.equal(h.field(optionLabel('sku-a')).props.checked, false, 'only an explicit discard permits resetting the old scope');
    assert.equal(h.saved, 0);
  } finally { h.close(); }
});

test('unknown scoped apply retains the identical PNG and chosen IDs through version/target changes and explicit retry', async () => {
  const h = fixture(); try {
    mainImageOptions(h, 'sku-b'); await translated(h); await h.change(optionLabel('sku-a'), '', true); await h.click('번역 이미지 미리보기');
    let attempts = 0; h.setApply(async () => { if (!attempts++) throw new ApplyError('저장 응답 유실', true); return { applied: true, replayed: true }; });
    await h.click('검토한 번역 이미지 적용'); const count = h.calls.length;
    h.setProps({ version: '2026-10-06T00:00:03.000Z', translationTarget: { sourceKey: 'owner/second.png', sequence: 3, role: 'main' } }); await h.settle();
    await h.change(optionLabel('sku-a'), '', false);
    assert.equal(h.calls.length, count, 'new product/toolbar state and locked checkbox do not resend or broaden the unknown apply');
    assert.equal(h.field('번역할 원본 이미지').props.value, 'owner/original.png');
    const controls = nodes(h.render()).find(node => node.type === 'fieldset' && node.props['aria-label'] === '번역 대표 이미지의 옵션 적용 범위');
    assert.equal(controls.props.disabled, true); assert.equal(h.field(optionLabel('sku-a')).props.checked, true);
    await h.click('같은 결과의 저장 상태 다시 확인');
    const applies = h.calls.filter(call => call.action === 'apply'); assert.equal(applies.length, 2);
    assert.equal(applies[0].image, applies[1].image); assert.equal(applies[0].image.output, applies[1].image.output);
    assert.equal(applies[1].image.source.productVersion, version);
    assert.deepEqual(applies[1].image.optionImageIds, ['sku-a', 'sku-b']);
    assert.deepEqual(plain(applies[1].image.source.optionImages), { revision: 7, optionIds: ['sku-a', 'sku-b'] });
    assert.equal(h.saved, 1); assert.equal(h.render().props['data-workspace-dirty'], undefined);
  } finally { h.close(); }
});

test('explicit source refresh preserves selected IDs/manual blanks and requires deselecting stale option connections', async () => {
  const h = fixture(); try {
    mainImageOptions(h, 'sku-b'); await translated(h); await h.change('문구 1 한국어', '유지할 한국어'); await h.change('문구 2 한국어', '');
    await h.change('문구 2 선택', '', false); await h.click('번역 이미지 미리보기'); const count = h.calls.length;
    h.setProps({ version: '2026-10-06T00:00:04.000Z' }); await h.settle();
    assert.equal(h.calls.length, count); assert.equal(h.button('검토한 번역 이미지 적용'), undefined);
    assert.equal(h.field(optionLabel('sku-b')).props.checked, true);
    h.setSource(image => ({ ...image, source: { ...image.source, optionImages: { revision: 8, optionIds: ['sku-a'] } } }));
    await h.click('원본 저장 상태 다시 확인');
    assert.equal(h.field('문구 1 한국어').props.value, '유지할 한국어'); assert.equal(h.field('문구 2 한국어').props.value, '');
    assert.equal(h.field(optionLabel('sku-b')).props.checked, true); assert.equal(h.field(optionLabel('sku-b')).props.disabled, false, 'stale selected IDs can be explicitly removed');
    assert.match(text(h.render()), /현재 같은 원본 연결에 없음, 선택 해제 필요/);
    await h.click('번역 이미지 미리보기'); assert.equal(h.button('검토한 번역 이미지 적용'), undefined);
    assert.match(nodes(h.render()).filter(node => node.props.role === 'alert').map(text).join(' '), /옵션/);
    await h.change(optionLabel('sku-b'), '', false); assert.equal(h.field(optionLabel('sku-b')), undefined);
    await h.click('번역 이미지 미리보기');
    const preview = h.calls.filter(call => call.action === 'preview').at(-1);
    assert.deepEqual(preview.optionImageIds, []); assert.equal(preview.image.source.optionImages.revision, 8);
    assert.ok(h.button('검토한 번역 이미지 적용')); assert.equal(h.calls.filter(call => call.action === 'apply').length, 0);
    assert.equal(h.calls.filter(call => call.action === 'ocr').length, 1); assert.equal(h.calls.filter(call => call.action === 'translate').length, 1);
  } finally { h.close(); }
});

test('individual-only source keeps common/fallback images outside its reviewed scope and requires an explicit matching option', async () => {
  for (const focusedOptionId of [undefined, 'foreign-option', 'sku-b']) {
    const h = fixture(); try {
      mainImageOptions(h, focusedOptionId, ['sku-a', 'sku-b'], true);
      h.setProps({ translationTarget: { sourceKey: 'owner/second.png', sequence: 3, role: 'main', sourceLanguage: 'zh' } });
      await h.settle(); assert.equal(h.calls.length, 0); await h.click('원본 문구 읽기');
      assert.equal(h.field('번역할 원본 이미지').props.value, 'owner/second.png');
      assert.equal(h.field(optionLabel('sku-a')).props.checked, false);
      assert.equal(h.field(optionLabel('sku-b')).props.checked, focusedOptionId === 'sku-b');
      await h.change('문구 1 원문', '확인한 개별 이미지 원문'); await h.change('문구 1 한국어', '확인한 개별 이미지 번역');
      await h.change('문구 2 한국어', ''); await h.change('문구 2 선택', '', false);
      if (focusedOptionId !== 'sku-b') {
        assert.equal(h.button('번역 이미지 미리보기').props.disabled, true, 'unmatched focus does not silently apply to common main');
        assert.equal(h.button('검토한 번역 이미지 적용'), undefined);
        const count = h.calls.length; await h.change(optionLabel('sku-b'), '', true); assert.equal(h.calls.length, count);
      }
      await h.click('번역 이미지 미리보기');
      const scope = nodes(h.render()).filter(node => node.type === 'p' && text(node).startsWith('적용 범위:')).map(text).join(' ');
      assert.match(scope, /선택 옵션 1개/); assert.doesNotMatch(scope, /공통 대표 이미지 사용 옵션 포함/);
      assert.equal(h.field('문구 1 한국어').props.value, '확인한 개별 이미지 번역'); assert.equal(h.field('문구 2 한국어').props.value, '');
      assert.equal(h.calls.filter(call => call.action === 'translate' || call.action === 'apply').length, 0);
      const calls = h.calls.length; await h.change(optionLabel('sku-b'), '', false); assert.equal(h.calls.length, calls);
      assert.equal(h.button('검토한 번역 이미지 적용'), undefined); assert.equal(h.button('번역 이미지 미리보기').props.disabled, true);
      assert.equal(h.field('문구 1 원문').props.value, '확인한 개별 이미지 원문'); assert.equal(h.field('문구 1 한국어').props.value, '확인한 개별 이미지 번역');
      await h.change(optionLabel('sku-a'), '', true); await h.click('번역 이미지 미리보기');
      h.setApply(async image => {
        assert.equal(image.source.sourceKey, 'owner/second.png'); assert.equal(image.source.optionImages.commonAssigned, false);
        assert.deepEqual(image.optionImageIds, ['sku-a']);
        return { source: image.source, applied: true, contentRevision: image.source.contentRevision, optionRevision: 8 };
      });
      await h.click('검토한 번역 이미지 적용'); assert.equal(h.saved, 1);
      assert.equal(h.calls.filter(call => call.action === 'source').length, 1); assert.equal(h.calls.filter(call => call.action === 'ocr').length, 1);
      assert.equal(h.calls.filter(call => call.action === 'apply').length, 1); assert.equal(h.calls.filter(call => call.action === 'translate').length, 0);
    } finally { h.close(); }
  }
});
