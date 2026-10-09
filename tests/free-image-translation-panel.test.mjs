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
const styleFields = ['글꼴', '굵게', '기울임', '정렬', '행간'];
const manualStyle = { fontFamily: 'serif', bold: true, italic: true, textAlign: 'center', lineHeight: 1.7 };
const regionStyle = row => Object.fromEntries(Object.keys(manualStyle).map(key => [key, row[key]]));
const styleModule = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/free-image-text-style.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: styleModule });
const historyModule = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/free-image-edit-history.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: historyModule });
class ApplyError extends Error { constructor(message, uncertain) { super(message); this.uncertain = uncertain; } }

function fixture() {
  const calls = [], busy = [], states = [], effects = [], urls = [], revoked = []; let cursor = 0, closed = false, late = 0, saved = 0, allowApply = true;
  let props = { productId: 'product', version, imageKeys: ['owner/original.png', 'owner/second.png'],
    translationTarget: { sourceKey: 'owner/original.png', sequence: 1, sourceLanguage: 'zh', role: 'detail' },
    onProductChanged: () => saved++, onBusyChange: value => busy.push(value), beforeApply: () => allowApply };
  let sourceIntercept = null, ocrIntercept = null, translateIntercept = null, renderIntercept = null, applyIntercept = null, recoverIntercept = null;
  class ObjectURL extends URL { static createObjectURL(blob) { const url = 'blob:fixture-' + urls.length; urls.push({ url, blob }); return url; } static revokeObjectURL(url) { revoked.push(url); } }
  const hooks = {
    useState(initial) { const id = cursor++; if (!(id in states)) states[id] = typeof initial === 'function' ? initial() : initial;
      return [states[id], value => { if (closed) late++; states[id] = typeof value === 'function' ? value(states[id]) : value; }]; },
    useRef(initial) { const id = cursor++; return states[id] ?? (states[id] = { current: initial }); },
    useCallback(fn, deps) { const id = cursor++, old = states[id]; if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) states[id] = { value: fn, deps }; return states[id].value; },
    useEffect(fn, deps) { const id = cursor++, old = states[id]; if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) {
      const next = { deps }; states[id] = next; effects.push(() => { old?.cleanup?.(); next.cleanup = fn(); });
    } },
  };
  hooks.useLayoutEffect = hooks.useEffect;
  const sourceFor = (id, productVersion, sourceKey, role) => ({ productId: id, productVersion, contentRevision: 2, sourceKey, sourceSha256: 'a'.repeat(64), role, width: 20, height: 12 });
  const client = {
    FreeImageApplyError: ApplyError,
    sameFreeImageQuotationRequest(actual, expected) { const clean = target => target ? Object.fromEntries(Object.entries(target).filter(([key]) => key !== 'bindingSha256')) : null; return JSON.stringify(clean(actual)) === JSON.stringify(clean(expected)); },
    async readFreeImageSource(id, productVersion, key, role, signal, _fetcher, quotationTarget) { calls.push({ action: 'source', id, productVersion, key, role, signal, quotationTarget });
      const image = { source: { ...sourceFor(id, productVersion, key, role), ...(quotationTarget ? { quotationTarget: { ...quotationTarget, bindingSha256: 'b'.repeat(64) } } : {}) }, width: 20, height: 12, blob: new Blob(['original']), canvas: {} }; return sourceIntercept ? sourceIntercept(image, signal) : image; },
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
    async recoverFreeImageTranslation(image, signal) { calls.push({ action: 'recover', image, signal }); return recoverIntercept ? recoverIntercept(image, signal) : { source: image.source, key: 'owner/generated.png', applied: true, replayed: true }; },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/free-image-translation-panel.tsx', import.meta.url), 'utf8'),
    { fileName: 'panel.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, Error, Date, URL: ObjectURL, Blob, AbortController, console, require(name) {
      if (name === 'react') return hooks; if (name === 'react/jsx-runtime') return native(name);
      if (name === '@/app/free-image-translation') return { FREE_IMAGE_ROLES: ['main', 'additional', 'detailTop', 'detail', 'detailBottom'], MAX_OCR_REGIONS: 100 };
      if (name === '@/app/free-image-text-style') return styleModule;
      if (name === '@/app/free-image-edit-history') return historyModule;
      assert.equal(name, '@/app/free-image-translation-client'); return client;
    } });
  const render = () => { cursor = 0; const outer = exports.default(props), tree = outer.type(outer.props); effects.splice(0).forEach(fn => fn()); return tree; };
  const settle = async () => { for (let index = 0; index < 6; index++) { render(); await new Promise(resolve => setImmediate(resolve)); } };
  const button = label => nodes(render()).find(node => node.type === 'button' && text(node) === label);
  const field = label => nodes(render()).find(node => node.props['aria-label'] === label);
  render(); render();
  return { render, settle, calls, busy, urls, revoked, button, field, get saved() { return saved; }, get late() { return late; },
    setSource(fn) { sourceIntercept = fn; }, setOcr(fn) { ocrIntercept = fn; }, setTranslate(fn) { translateIntercept = fn; }, setRender(fn) { renderIntercept = fn; }, setApply(fn) { applyIntercept = fn; }, setRecover(fn) { recoverIntercept = fn; },
    setProps(update) { props = { ...props, ...update }; render(); render(); }, allowApply(value) { allowApply = value; },
    async click(label) { await settle(); const control = button(label); assert.ok(control && !control.props.disabled, 'available control: ' + label); control.props.onClick(); await settle(); },
    async clickField(label) { await settle(); const control = field(label); assert.ok(control && !control.props.disabled, 'available control: ' + label); control.props.onClick(); await settle(); },
    async change(label, value, checked) { const control = field(label); assert.ok(control, label); control.props.onChange({ target: { value, checked } }); await settle(); },
    close() { if (closed) return; states.forEach(state => state?.cleanup?.()); closed = true; } };
}
async function translated(h) { await h.click('원본 문구 읽기'); await h.click('선택 문구 한국어 번역'); }
async function styleRegion(h, index = 1, values = manualStyle) {
  await h.change(`문구 ${index} 글꼴`, values.fontFamily);
  await h.change(`문구 ${index} 굵게`, '', values.bold);
  await h.change(`문구 ${index} 기울임`, '', values.italic);
  await h.change(`문구 ${index} 정렬`, values.textAlign);
  await h.change(`문구 ${index} 행간`, String(values.lineHeight));
}
async function snapshotRegions(h) {
  await h.click('번역 이미지 미리보기');
  return plain(h.calls.filter(call => call.action === 'preview').at(-1).rows);
}

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

test('explicit region erase skips translation, preserves blank/manual text, invalidates preview and sends only reviewed output', async () => {
  const h = fixture(); try {
    await h.click('원본 문구 읽기');
    await h.change('문구 1 영역 지우기', '', true); await h.change('문구 1 배경색', '#234567');
    assert.equal(h.field('문구 1 한국어').props.value, ''); assert.equal(h.field('문구 1 한국어').props.disabled, true);
    assert.equal(h.field('문구 1 원문').props.disabled, true); assert.equal(h.field('문구 1 글자 크기').props.disabled, true);
    await h.click('선택 문구 한국어 번역');
    assert.deepEqual(plain(h.calls.find(call => call.action === 'translate').rows), [{ id: 'r2', text: '中文 r2' }]);
    assert.equal(h.field('문구 1 한국어').props.value, ''); assert.equal(h.field('문구 2 한국어').props.value, '한국어 r2');
    await h.click('번역 이미지 미리보기');
    const mixed = h.calls.filter(call => call.action === 'preview').at(-1);
    assert.equal(mixed.rows[0].erase, true); assert.equal(mixed.rows[0].background, '#234567');
    assert.equal(mixed.rows[0].translated, ''); assert.equal(mixed.rows[1].translated, '한국어 r2');
    await h.change('문구 1 영역 지우기', '', false); assert.equal(h.button('검토한 번역 이미지 적용'), undefined);
    assert.equal(h.field('문구 1 한국어').props.disabled, false); assert.equal(h.field('문구 1 원문').props.value, '中文 r1');
    await h.change('문구 1 한국어', '직접 보존한 문구'); await h.change('문구 1 영역 지우기', '', true);
    await h.change('문구 2 선택', '', false);
    assert.equal(h.button('선택 문구 한국어 번역').props.disabled, true);
    await h.click('번역 이미지 미리보기'); h.allowApply(false); await h.click('검토한 번역 이미지 적용');
    assert.equal(h.calls.filter(call => call.action === 'apply').length, 0);
    await h.change('문구 1 영역 지우기', '', false);
    assert.equal(h.field('문구 1 한국어').props.value, '직접 보존한 문구'); assert.equal(h.button('검토한 번역 이미지 적용'), undefined);
    await h.change('문구 1 영역 지우기', '', true); await h.click('번역 이미지 미리보기'); h.allowApply(true);
    const preview = h.calls.filter(call => call.action === 'preview').at(-1); await h.click('검토한 번역 이미지 적용');
    const applied = h.calls.find(call => call.action === 'apply');
    assert.equal(applied.image.source, preview.image.source); assert.equal(applied.image.output, h.urls.at(-1).blob);
    assert.equal(h.calls.filter(call => call.action === 'translate').length, 1); assert.equal(h.saved, 1);
  } finally { h.close(); }
});

test('a manually added erase rectangle needs no OCR wording and retains scope through cancel and lost apply acknowledgement', async () => {
  const h = fixture(); try {
    h.setOcr(async () => { throw Error('OCR found no words'); }); await h.click('원본 문구 읽기');
    await h.click('문구 영역 직접 추가'); await h.change('문구 1 영역 지우기', '', true);
    assert.equal(h.field('문구 1 원문').props.value, ''); assert.equal(h.field('문구 1 한국어').props.value, '');
    assert.equal(h.button('선택 문구 한국어 번역').props.disabled, true);
    const rendering = deferred(); h.setRender(() => rendering.promise);
    await h.click('번역 이미지 미리보기'); await h.click('이미지 작업 취소');
    const old = h.calls.filter(call => call.action === 'preview').at(-1);
    assert.equal(old.signal.aborted, true);
    rendering.resolve({ source: old.image.source, output: new Blob(['late PNG'], { type: 'image/png' }), width: 20, height: 12 }); await h.settle();
    assert.equal(h.button('검토한 번역 이미지 적용'), undefined); assert.equal(h.field('문구 1 영역 지우기').props.checked, true);
    h.setRender(null); await h.click('번역 이미지 미리보기');
    h.setApply(async () => { throw new ApplyError('save acknowledgement lost', true); }); await h.click('검토한 번역 이미지 적용');
    const first = h.calls.find(call => call.action === 'apply'); assert.equal(h.saved, 0);
    h.setProps({ version: '2026-10-06T00:00:02.000Z' }); await h.settle();
    h.setApply(async () => ({ applied: true, replayed: true })); await h.click('같은 결과의 저장 상태 다시 확인');
    const second = h.calls.filter(call => call.action === 'apply').at(-1);
    assert.equal(second.image, first.image); assert.equal(second.image.output, first.image.output);
    assert.equal(second.image.source.productVersion, version); assert.equal(h.saved, 1);
    assert.equal(h.calls.filter(call => call.action === 'translate').length, 0);
  } finally { h.close(); }
});

test('a failed partial retry retains earlier generated Korean, reports failure and keeps manual blanks', async () => {
  const h = fixture(); try {
    h.setOcr(async () => [region('r1'), region('r2'), region('r3')]);
    await h.click('원본 문구 읽기'); await h.change('문구 3 한국어', '');
    h.setTranslate(async (source, rows) => ({ source, regions: rows.map(row => ({ id: row.id, original: row.text,
      translated: row.id === 'r1' ? '먼저 성공한 한국어' : null, issue: row.id === 'r1' ? null : '미번역 영역' })),
      requests: 1, stoppedHttpStatus: null, warnings: [] }));
    await h.click('선택 문구 한국어 번역');
    assert.equal(h.field('문구 1 한국어').props.value, '먼저 성공한 한국어'); assert.equal(h.field('문구 2 한국어').props.value, '');
    const first = h.calls.filter(call => call.action === 'translate').at(-1);
    assert.deepEqual(plain(first.rows), [{ id: 'r1', text: '中文 r1' }, { id: 'r2', text: '中文 r2' }]);
    h.setTranslate(async (source, rows) => ({ source, regions: rows.map(row => ({ id: row.id, original: row.text,
      translated: null, issue: 'Google 번역 HTTP 429' })), requests: 1, stoppedHttpStatus: 429,
      warnings: ['Google HTTP 429 이후 요청을 중단했습니다. 자동 재시도하지 않습니다.'] }));
    await h.click('선택 문구 한국어 번역');
    assert.equal(h.field('문구 1 한국어').props.value, '먼저 성공한 한국어'); assert.equal(h.field('문구 2 한국어').props.value, '', 'the initially failed region remains untranslated');
    assert.equal(h.field('문구 3 한국어').props.value, '', 'the explicit manual blank is never translated');
    const status = nodes(h.render()).filter(node => node.props.role === 'status').map(text).join(' ');
    assert.match(status, /0개 번역/); assert.match(status, /429.*자동 재시도하지 않습니다/);
    assert.equal(nodes(h.render()).filter(node => node.type === 'p' && text(node) === 'Google 번역 HTTP 429').length, 2, 'failed returned regions still carry their failure issue');
    const retried = h.calls.filter(call => call.action === 'translate').at(-1);
    assert.deepEqual(plain(retried.source), plain(first.source)); assert.deepEqual(plain(retried.rows), plain(first.rows));
    assert.equal(h.calls.filter(call => call.action === 'translate').length, 2, 'the failure never starts an automatic retry');
    h.setTranslate(async (source, rows) => ({ source, regions: rows.map(row => ({ id: row.id, original: row.text,
      translated: '다시 성공한 한국어 ' + row.id, issue: null })), requests: 1, stoppedHttpStatus: null, warnings: [] }));
    await h.click('선택 문구 한국어 번역');
    assert.equal(h.field('문구 1 한국어').props.value, '다시 성공한 한국어 r1', 'retained generated text can still be explicitly retranslated');
    assert.equal(h.field('문구 2 한국어').props.value, '다시 성공한 한국어 r2'); assert.equal(h.field('문구 3 한국어').props.value, '');
    assert.deepEqual(plain(h.calls.filter(call => call.action === 'translate').at(-1).rows), plain(first.rows), 'preserving a generated result never converts it to a manual value');
    assert.equal(h.saved, 0); assert.equal(h.calls.filter(call => call.action === 'apply' || call.action === 'preview').length, 0);
  } finally { h.close(); }
});

test('a failed retry after original text changes cannot restore the previous generated Korean', async () => {
  const h = fixture(); try {
    await translated(h); assert.equal(h.field('문구 1 한국어').props.value, '한국어 r1');
    await h.change('문구 1 원문', '다른 원문'); assert.equal(h.field('문구 1 한국어').props.value, '');
    await h.change('문구 2 선택', '', false);
    h.setTranslate(async (source, rows) => ({ source, regions: rows.map(row => ({ id: row.id, original: row.text,
      translated: null, issue: 'Google 번역 HTTP 503' })), requests: 1, stoppedHttpStatus: 503, warnings: [] }));
    await h.click('선택 문구 한국어 번역');
    assert.equal(h.field('문구 1 원문').props.value, '다른 원문'); assert.equal(h.field('문구 1 한국어').props.value, '');
    assert.equal(h.field('문구 2 한국어').props.value, '한국어 r2', 'unselected translated regions stay unchanged');
    assert.deepEqual(plain(h.calls.filter(call => call.action === 'translate').at(-1).rows), [{ id: 'r1', text: '다른 원문' }]);
    assert.equal(h.saved, 0); assert.equal(h.calls.filter(call => call.action === 'apply' || call.action === 'preview').length, 0);
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
function finalImageSelection(h, input = 'detailImages', sourceLanguage = 'zh') {
  const quotationTarget = { kind: 'quotation', profileId: null, optionId: 'sku-a', input, fieldKey: 'wire-' + input, slotIndex: input === 'mainImage' ? 0 : 1,
    revision: 7, inputFingerprint: 'c'.repeat(64), optionRevision: 3, value: input === 'mainImage' ? 'owner/original.png' : 'owner/second.png\nowner/original.png' };
  const quotationContext = { profileId: null, optionId: 'sku-a', input };
  h.setProps({ focusedOptionId: 'sku-a', quotationContext, translationTarget: { sourceKey: 'owner/original.png', sequence: 2,
    sourceLanguage, role: input === 'mainImage' ? 'main' : input === 'additionalImages' ? 'additional' : 'detail', quotationTarget } });
  return { quotationTarget, quotationContext };
}

test('final quotation toolbar binds both languages to the saved slot and leaves all processing explicit', async () => {
  for (const [input, language] of [['mainImage', 'zh'], ['mainImage', 'en'], ['additionalImages', 'zh'], ['detailImages', 'en']]) {
    const h = fixture(); try {
      const { quotationTarget } = finalImageSelection(h, input, language); await h.settle();
      assert.equal(h.calls.length, 0); assert.equal(h.field('이미지 원문 언어').props.value, language);
      assert.equal(h.field('번역할 원본 이미지').props.disabled, true); assert.equal(h.field('번역할 이미지 역할').props.disabled, true);
      assert.equal(h.field('번역 대표 이미지의 옵션 적용 범위'), undefined, 'final main image never exposes common/source option scope');
      await translated(h); assert.deepEqual(plain(h.calls.find(call => call.action === 'source').quotationTarget), quotationTarget);
      assert.equal(h.calls.find(call => call.action === 'ocr').language, language);
      await h.change('문구 1 한국어', '직접 쓴 한국어'); await h.change('문구 2 한국어', ''); await h.change('문구 2 선택', '', false);
      await h.click('번역 이미지 미리보기'); const preview = h.calls.find(call => call.action === 'preview');
      assert.equal(preview.image.source.quotationTarget.slotIndex, input === 'mainImage' ? 0 : 1); assert.deepEqual(preview.optionImageIds, []);
      assert.equal(preview.rows[0].translated, '직접 쓴 한국어'); assert.equal(preview.rows[1].translated, '');
      await h.click('검토한 번역 이미지 적용'); const applied = h.calls.find(call => call.action === 'apply');
      assert.equal(applied.image.source.quotationTarget.fieldKey, 'wire-' + input); assert.equal(applied.image.optionImageIds, undefined);
      assert.equal(h.saved, 1); assert.equal(h.calls.filter(call => call.action === 'source' || call.action === 'ocr' || call.action === 'translate').length, 3);
    } finally { h.close(); }
  }
});

test('final quotation selection navigation blocks old handlers and late translation while retaining manual blanks', async () => {
  const h = fixture(); try {
    const { quotationContext } = finalImageSelection(h); await translated(h);
    await h.change('문구 1 한국어', '보관할 한국어'); await h.change('문구 2 한국어', ''); await h.change('문구 2 선택', '', false);
    await h.click('번역 이미지 미리보기'); const apply = h.button('검토한 번역 이미지 적용').props.onClick;
    const edit = h.field('문구 1 한국어').props.onChange, count = h.calls.length;
    h.setProps({ quotationContext: { ...quotationContext, optionId: 'sku-b' }, focusedOptionId: 'sku-b' }); await h.settle();
    apply(); edit({ target: { value: 'stale edit' } }); await h.settle();
    assert.equal(h.calls.length, count); assert.equal(h.field('문구 1 한국어').props.value, '보관할 한국어'); assert.equal(h.field('문구 2 한국어').props.value, '');
    assert.equal(h.button('번역 이미지 미리보기').props.disabled, true); assert.equal(h.button('검토한 번역 이미지 적용'), undefined);
    h.setProps({ quotationContext, focusedOptionId: 'sku-a' }); await h.settle(); await h.change('문구 1 원문', '새로 검토할 원문');
    // A manually authored Korean row is excluded; use the second nonmanual row.
    await h.change('문구 2 원문', 'late source'); await h.click('문구 영역 직접 추가'); await h.change('문구 3 원문', 'new source');
    const pending = deferred(); h.setTranslate(() => pending.promise); h.button('선택 문구 한국어 번역').props.onClick(); await h.settle();
    h.setProps({ quotationContext: undefined }); await h.settle();
    assert.equal(h.calls.filter(call => call.action === 'translate').at(-1).signal.aborted, true);
    pending.resolve({ regions: [{ id: 'manual-1', original: 'new source', translated: 'late Korean', issue: null }], warnings: [] }); await h.settle();
    assert.equal(h.field('문구 3 한국어').props.value, ''); assert.equal(h.field('문구 1 한국어').props.value, '보관할 한국어'); assert.equal(h.saved, 0);
  } finally { h.close(); }
});

test('a lost final-slot ACK recovers the same PNG before allowing a separate explicit retransmission', async () => {
  for (const [input, committed] of [['mainImage', true], ['mainImage', false], ['detailImages', true], ['detailImages', false]]) {
    const h = fixture(); try {
      const { quotationContext } = finalImageSelection(h, input); await translated(h); await h.click('번역 이미지 미리보기');
      let attempts = 0; h.setApply(async () => { if (!attempts++) throw new ApplyError('ACK lost', true); return { applied: true }; });
      h.setRecover(async image => ({ source: image.source, key: 'owner/generated.png', applied: committed, ...(committed ? { replayed: true } : {}) }));
      const originalApply = h.button('검토한 번역 이미지 적용').props.onClick;
      await h.click('검토한 번역 이미지 적용'); const original = h.calls.find(call => call.action === 'apply').image;
      originalApply(); await h.settle(); assert.equal(h.calls.filter(call => call.action === 'apply').length, 1, 'old apply handler cannot bypass recovery');
      const recovery = h.button('같은 결과의 저장 상태 다시 확인').props.onClick;
      h.setProps({ quotationContext: { ...quotationContext, optionId: 'sku-b' }, focusedOptionId: 'sku-b' }); await h.settle();
      recovery(); await h.settle(); assert.equal(h.calls.filter(call => call.action === 'recover').length, 0);
      h.setProps({ quotationContext, focusedOptionId: 'sku-a' }); await h.settle(); await h.click('같은 결과의 저장 상태 다시 확인');
      assert.equal(h.calls.find(call => call.action === 'recover').image, original); assert.equal(h.calls.filter(call => call.action === 'apply').length, 1);
      if (!committed) {
        assert.equal(h.saved, 0); assert.equal(h.field('문구 1 한국어').props.value, '한국어 r1');
        const oldRetry = h.button('같은 미리보기 다시 적용').props.onClick;
        h.setProps({ version: '2026-10-06T00:00:03.000Z' });
        const beforeDeferredReset = h.button('같은 미리보기 다시 적용');
        oldRetry(); beforeDeferredReset?.props.onClick(); await h.settle();
        assert.equal(h.calls.filter(call => call.action === 'apply').length, 1, 'a version change requires another read before any retry, including before deferred UI reset');
        await h.click('같은 결과의 저장 상태 다시 확인');
        await h.click('같은 미리보기 다시 적용'); const applies = h.calls.filter(call => call.action === 'apply');
        assert.equal(applies.length, 2); assert.equal(applies[1].image, original); assert.equal(applies[1].image.output, original.output);
      }
      assert.equal(h.saved, 1); assert.equal(h.calls.filter(call => call.action === 'source' || call.action === 'ocr' || call.action === 'translate' || call.action === 'preview').length, 4);
    } finally { h.close(); }
  }
});

test('focused option scope and full manual controls reach only the explicitly reviewed main-image preview/apply', async () => {
  const h = fixture(); try {
    mainImageOptions(h, 'sku-b'); await h.settle(); assert.equal(h.calls.length, 0);
    await h.click('원본 문구 읽기');
    assert.equal(h.field(optionLabel('sku-a')).props.checked, false); assert.equal(h.field(optionLabel('sku-b')).props.checked, true);
    await h.change('문구 1 원문', '검토한 원문'); await h.change('문구 1 한국어', '직접 확인한 한국어');
    await h.change('문구 2 한국어', ''); await h.change('문구 2 선택', '', false);
    for (const [field, value] of [['x', 2], ['y', 2], ['width', 12], ['height', 8]]) await h.change('문구 1 ' + field, String(value));
    await h.change('문구 1 배경색', '#ddeeff'); await h.change('문구 1 글자색', '#223344'); await h.change('문구 1 글자 크기', '6');
    await styleRegion(h);
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
    assert.deepEqual(plain(regionStyle(row)), manualStyle);
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

test('region text-style controls retain legacy defaults and independently pass reviewed styles without refilling manual blanks', async () => {
  const h = fixture(); try {
    await h.click('원본 문구 읽기');
    assert.equal(h.field('문구 1 글꼴').props.value, 'sans');
    assert.deepEqual(nodes(h.field('문구 1 글꼴')).filter(node => node.type === 'option').map(node => [node.props.value, text(node)]), [['sans', '고딕'], ['serif', '명조'], ['mono', '고정폭'], ['gmarket', 'Gmarket Sans Medium']]);
    assert.equal(h.field('문구 1 굵게').props.checked, false); assert.equal(h.field('문구 1 기울임').props.checked, false);
    assert.equal(h.field('문구 1 정렬').props.value, 'left'); assert.equal(h.field('문구 1 행간').props.value, 1.2);
    assert.deepEqual(['min', 'max', 'step'].map(key => h.field('문구 1 행간').props[key]), [0.8, 3, 0.1]);
    await h.change('문구 1 한국어', '직접 검토한 두 줄\n문구'); await h.change('문구 2 한국어', '');
    const count = h.calls.length; await styleRegion(h);
    assert.equal(h.calls.length, count, 'changing presentation never reads/translates/previews/saves automatically');
    assert.equal(h.render().props['data-workspace-dirty'], 'true');
    await h.click('번역 이미지 미리보기');
    const preview = h.calls.filter(call => call.action === 'preview').at(-1);
    assert.deepEqual(plain(regionStyle(preview.rows[0])), manualStyle);
    assert.equal(preview.rows[0].translated, '직접 검토한 두 줄\n문구'); assert.equal(preview.rows[1].translated, '');
    assert.ok(Object.keys(manualStyle).every(key => !Object.hasOwn(preview.rows[1], key)), 'the untouched region remains an older style-free draft');
    assert.equal(h.field('문구 2 글꼴').props.value, 'sans'); assert.equal(h.field('문구 2 행간').props.value, 1.2);
    assert.equal(h.calls.filter(call => call.action === 'translate' || call.action === 'apply').length, 0);
  } finally { h.close(); }
});

test('erase disables every text-style control while retaining styles, Korean text and stale-control protection', async () => {
  const h = fixture(); try {
    await translated(h); await styleRegion(h); await h.change('문구 1 한국어', '지우기 해제 후 유지할 문구');
    const priorFont = h.field('문구 1 글꼴').props.onChange, priorBold = h.field('문구 1 굵게').props.onChange;
    await h.change('문구 1 영역 지우기', '', true);
    for (const label of styleFields) assert.equal(h.field('문구 1 ' + label).props.disabled, true, label);
    priorFont({ target: { value: 'mono' } }); priorBold({ target: { checked: false } }); await h.settle();
    assert.equal(h.field('문구 1 글꼴').props.value, 'serif'); assert.equal(h.field('문구 1 굵게').props.checked, true);
    await h.click('번역 이미지 미리보기');
    const erased = h.calls.filter(call => call.action === 'preview').at(-1);
    assert.equal(erased.rows[0].erase, true); assert.deepEqual(plain(regionStyle(erased.rows[0])), manualStyle);
    assert.equal(erased.rows[0].translated, '지우기 해제 후 유지할 문구');
    await h.change('문구 1 영역 지우기', '', false);
    assert.equal(h.button('검토한 번역 이미지 적용'), undefined);
    for (const label of styleFields) assert.equal(h.field('문구 1 ' + label).props.disabled, false, label);
    assert.equal(h.field('문구 1 한국어').props.value, '지우기 해제 후 유지할 문구');
    await h.click('번역 이미지 미리보기'); assert.deepEqual(plain(regionStyle(h.calls.filter(call => call.action === 'preview').at(-1).rows[0])), manualStyle);
    assert.equal(h.saved, 0);
  } finally { h.close(); }
});

test('each style change invalidates the reviewed PNG and blocks an earlier apply callback until a new preview', async () => {
  const h = fixture(); try {
    await translated(h);
    for (const [label, value, checked] of [['글꼴', 'mono'], ['굵게', '', true], ['기울임', '', true], ['정렬', 'right'], ['행간', '2.2']]) {
      await h.click('번역 이미지 미리보기');
      const before = h.calls.filter(call => call.action === 'preview').at(-1), apply = h.button('검토한 번역 이미지 적용').props.onClick;
      const count = h.calls.length; await h.change('문구 1 ' + label, value, checked); apply(); await h.settle();
      assert.equal(h.button('검토한 번역 이미지 적용'), undefined, label);
      assert.equal(h.calls.length, count, 'stale apply performs no upload or mutation: ' + label);
      await h.click('번역 이미지 미리보기');
      const next = h.calls.filter(call => call.action === 'preview').at(-1);
      assert.notEqual(next, before); assert.deepEqual(plain(next.image.source), plain(before.image.source));
    }
    await h.click('검토한 번역 이미지 적용'); assert.equal(h.saved, 1);
    assert.equal(h.calls.filter(call => call.action === 'apply').length, 1);
  } finally { h.close(); }
});

test('failed saves retain styled drafts and an unknown save retries the exact PNG without accepting old style handlers', async () => {
  for (const uncertain of [false, true]) {
    const h = fixture(); try {
      await translated(h); await styleRegion(h); await h.change('문구 2 한국어', ''); await h.click('번역 이미지 미리보기');
      const fontChange = h.field('문구 1 글꼴').props.onChange;
      h.setApply(async () => { throw new ApplyError('격리 저장 실패', uncertain); });
      await h.click('검토한 번역 이미지 적용');
      const first = h.calls.filter(call => call.action === 'apply')[0].image;
      assert.equal(h.saved, 0); assert.equal(h.field('문구 1 글꼴').props.value, 'serif');
      assert.equal(h.field('문구 2 한국어').props.value, ''); assert.equal(h.render().props['data-workspace-dirty'], 'true');
      if (uncertain) {
        fontChange({ target: { value: 'mono' } }); await h.settle();
        assert.equal(h.field('문구 1 글꼴').props.value, 'serif', 'unconfirmed save retains its exact reviewed style');
      }
      h.setApply(async image => ({ source: image.source, applied: true, replayed: true }));
      await h.click(uncertain ? '같은 결과의 저장 상태 다시 확인' : '검토한 번역 이미지 적용');
      const attempts = h.calls.filter(call => call.action === 'apply');
      assert.equal(attempts.length, 2); assert.equal(attempts[1].image, first); assert.equal(attempts[1].image.output, first.output);
      assert.equal(h.saved, 1); assert.equal(h.calls.filter(call => call.action === 'preview').length, 1);
    } finally { h.close(); }
  }
});

test('styled final-slot drafts survive option navigation and late preview replies cannot enable the old quotation target', async () => {
  const h = fixture(); try {
    const { quotationTarget, quotationContext } = finalImageSelection(h, 'additionalImages'); await translated(h); await styleRegion(h);
    await h.change('문구 2 한국어', '');
    const pending = deferred(); let reviewedRows;
    h.setRender((image, rows, signal) => { assert.equal(signal.aborted, false); reviewedRows = plain(rows); return pending.promise; });
    const oldStyle = h.field('문구 1 정렬').props.onChange;
    h.button('번역 이미지 미리보기').props.onClick(); await h.settle();
    const request = h.calls.filter(call => call.action === 'preview').at(-1);
    h.setProps({ quotationContext: { ...quotationContext, optionId: 'sku-b' }, focusedOptionId: 'sku-b' }); await h.settle();
    oldStyle({ target: { value: 'right' } }); await h.settle();
    assert.equal(request.signal.aborted, true); assert.equal(h.field('문구 1 정렬').props.value, 'center');
    pending.resolve({ source: request.image.source, output: new Blob(['late styled PNG'], { type: 'image/png' }), width: 20, height: 12 }); await h.settle();
    assert.equal(h.button('검토한 번역 이미지 적용'), undefined); assert.equal(h.saved, 0);
    assert.deepEqual(regionStyle(reviewedRows[0]), manualStyle); assert.equal(reviewedRows[1].translated, '');
    h.setProps({ quotationContext, focusedOptionId: 'sku-a' }); await h.settle(); h.setRender(null);
    await h.click('번역 이미지 미리보기');
    const next = h.calls.filter(call => call.action === 'preview').at(-1);
    assert.deepEqual(plain(regionStyle(next.rows[0])), manualStyle); assert.deepEqual(plain(next.image.source.quotationTarget), { ...quotationTarget, bindingSha256: 'b'.repeat(64) });
    assert.deepEqual(next.optionImageIds, []);
    await h.click('검토한 번역 이미지 적용'); assert.equal(h.saved, 1);
  } finally { h.close(); }
});

test('closing a styled draft blocks previously captured controls without late state updates or processing', async () => {
  const h = fixture();
  await translated(h); await styleRegion(h);
  const fontChange = h.field('문구 1 글꼴').props.onChange, lineChange = h.field('문구 1 행간').props.onChange;
  const count = h.calls.length; h.close();
  fontChange({ target: { value: 'mono' } }); lineChange({ target: { value: '2' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.late, 0); assert.equal(h.calls.length, count); assert.equal(h.saved, 0);
});

test('Gmarket style selection changes only the reviewed text presentation and retains the exact final main-image slot', async () => {
  const h = fixture(); try {
    const { quotationTarget } = finalImageSelection(h, 'mainImage'); await translated(h);
    assert.ok(nodes(h.field('문구 1 글꼴')).some(node => node.type === 'option' && node.props.value === 'gmarket' && text(node) === 'Gmarket Sans Medium'));
    await h.change('문구 1 한국어', '직접 검토한 Gmarket 문구'); await h.change('문구 2 한국어', '');
    await h.click('번역 이미지 미리보기');
    const before = h.calls.filter(call => call.action === 'preview').at(-1), priorApply = h.button('검토한 번역 이미지 적용').props.onClick;
    const count = h.calls.length, style = { fontFamily: 'gmarket', bold: true, italic: true, textAlign: 'right', lineHeight: 1.8 };
    await styleRegion(h, 1, style); priorApply(); await h.settle();
    assert.equal(h.calls.length, count, 'font and style selection never reloads the source, translates, renders or saves implicitly');
    assert.equal(h.button('검토한 번역 이미지 적용'), undefined); assert.equal(h.field('번역할 원본 이미지').props.value, 'owner/original.png');
    assert.equal(h.field('번역할 이미지 역할').props.value, 'main'); assert.equal(h.field('문구 2 한국어').props.value, '');
    await h.click('번역 이미지 미리보기');
    const next = h.calls.filter(call => call.action === 'preview').at(-1);
    assert.deepEqual(plain(regionStyle(next.rows[0])), style); assert.equal(next.rows[0].translated, '직접 검토한 Gmarket 문구');
    assert.deepEqual(plain(next.image.source), plain(before.image.source));
    assert.deepEqual(plain(next.image.source.quotationTarget), { ...quotationTarget, bindingSha256: 'b'.repeat(64) });
    assert.deepEqual(next.optionImageIds, []); assert.ok(Object.keys(style).every(key => !Object.hasOwn(next.rows[1], key)));
    await h.click('검토한 번역 이미지 적용');
    const applied = h.calls.filter(call => call.action === 'apply'); assert.equal(applied.length, 1); assert.equal(applied[0].image.source, next.image.source);
    assert.equal(h.saved, 1); assert.equal(h.calls.filter(call => call.action === 'source').length, 1); assert.equal(h.calls.filter(call => call.action === 'translate').length, 1);
  } finally { h.close(); }
});

test('manual region edits, additions, deletions and layer order undo and redo exact arrays without changing source or option selection', async () => {
  const h = fixture(); try {
    mainImageOptions(h, 'sku-b'); await translated(h);
    const states = [await snapshotRegions(h)];
    const edits = [
      () => h.change('문구 1 원문', '검토한 새 원문'), () => h.change('문구 1 한국어', '직접 확인한 문구'),
      () => h.change('문구 2 한국어', ''), () => h.change('문구 1 x', '2'),
      () => h.change('문구 1 글꼴', 'gmarket'), () => h.change('문구 2 영역 지우기', '', true),
      () => h.change('문구 1 선택', '', false), () => h.click('문구 영역 직접 추가'),
      () => h.change('문구 3 한국어', '새 수동 영역'), () => h.clickField('문구 2 앞으로'),
      () => h.click('문구 1 영역 삭제'),
    ];
    for (const edit of edits) { await edit(); states.push(await snapshotRegions(h)); }
    assert.deepEqual(states.at(-2).map(row => row.id), ['r1', 'manual-1', 'r2']);
    assert.deepEqual(states.at(-1).map(row => row.id), ['manual-1', 'r2']);
    const source = plain(h.calls.find(call => call.action === 'source'));
    for (let index = states.length - 2; index >= 0; index--) {
      const count = h.calls.length; await h.click('되돌리기');
      assert.equal(h.button('검토한 번역 이미지 적용'), undefined); assert.equal(h.calls.length, count, 'undo performs no processing');
      assert.deepEqual(await snapshotRegions(h), states[index]); assert.equal(h.field(optionLabel('sku-b')).props.checked, true);
    }
    for (let index = 1; index < states.length; index++) {
      const count = h.calls.length; await h.click('다시 실행'); assert.equal(h.calls.length, count, 'redo performs no processing');
      assert.equal(h.button('검토한 번역 이미지 적용'), undefined); assert.deepEqual(await snapshotRegions(h), states[index]);
    }
    assert.equal(h.button('다시 실행').props.disabled, true);
    await h.click('되돌리기'); await h.change('문구 1 배경색', '#123456'); assert.equal(h.button('다시 실행').props.disabled, true, 'a new manual edit removes only the redo branch');
    assert.deepEqual(plain(h.calls.find(call => call.action === 'source')), source);
    assert.equal(h.calls.filter(call => call.action === 'source').length, 1); assert.equal(h.calls.filter(call => call.action === 'translate').length, 1); assert.equal(h.saved, 0);
  } finally { h.close(); }
});

test('textarea typing coalesces within one focus session and a new focus starts another reversible edit', async () => {
  const h = fixture(); try {
    await translated(h); const baseline = await snapshotRegions(h);
    h.field('문구 1 한국어').props.onFocus();
    for (const value of ['가', '가나', '가나다']) await h.change('문구 1 한국어', value);
    h.field('문구 1 한국어').props.onBlur(); await h.settle();
    const first = await snapshotRegions(h); await h.click('되돌리기'); assert.deepEqual(await snapshotRegions(h), baseline);
    await h.click('다시 실행'); assert.deepEqual(await snapshotRegions(h), first);
    h.field('문구 1 한국어').props.onFocus();
    for (const value of ['새', '새 문구']) await h.change('문구 1 한국어', value);
    h.field('문구 1 한국어').props.onBlur(); await h.settle();
    await h.click('되돌리기'); assert.deepEqual(await snapshotRegions(h), first, 'blur/focus ends the previous typing group');
    assert.equal(h.saved, 0); assert.equal(h.calls.filter(call => call.action === 'translate').length, 1);
  } finally { h.close(); }
});

test('layer bounds and erase layers follow the exact renderer order; deleting all layers remains undoable', async () => {
  const h = fixture(); try {
    await translated(h); await h.change('문구 1 영역 지우기', '', true);
    assert.equal(h.field('문구 1 뒤로').props.disabled, true); assert.equal(h.field('문구 2 앞으로').props.disabled, true);
    const before = await snapshotRegions(h), apply = h.button('검토한 번역 이미지 적용').props.onClick, count = h.calls.length;
    await h.clickField('문구 1 앞으로'); apply(); await h.settle();
    assert.equal(h.calls.length, count); assert.equal(h.button('검토한 번역 이미지 적용'), undefined);
    assert.deepEqual((await snapshotRegions(h)).map(row => row.id), ['r2', 'r1']);
    assert.equal(h.field('문구 2 앞으로').props.disabled, true); assert.match(text(h.render()), /나중.*위/);
    await h.click('되돌리기'); assert.deepEqual(await snapshotRegions(h), before);
    await h.click('문구 2 영역 삭제'); await h.click('문구 1 영역 삭제');
    assert.equal(h.field('문구 1 원문'), undefined); assert.equal(h.button('되돌리기').props.disabled, false);
    await h.click('되돌리기'); assert.equal(h.field('문구 1 원문').props.value, before[0].text);
    await h.click('되돌리기'); assert.deepEqual(await snapshotRegions(h), before);
    assert.equal(h.saved, 0);
  } finally { h.close(); }
});

test('same-byte refresh preserves edit history, while discard, new OCR and acknowledged save reset its baseline and reject old handlers', async () => {
  const h = fixture(); try {
    await translated(h); const before = await snapshotRegions(h);
    await h.change('문구 1 한국어', '새 버전에서도 보관');
    const edited = await snapshotRegions(h), regionFieldsets = () => nodes(h.render()).filter(node => node.type === 'fieldset' && node.props.className === 'translation-field');
    assert.ok(regionFieldsets().every(node => node.props.disabled === false));
    const oldUndo = h.button('되돌리기').props.onClick, oldText = h.field('문구 1 한국어').props.onChange;
    h.setProps({ version: '2026-10-06T00:00:03.000Z' }); await h.settle(); oldUndo(); await h.settle();
    assert.equal(h.field('문구 1 한국어').props.value, '새 버전에서도 보관');
    assert.ok(regionFieldsets().every(node => node.props.disabled === true), 'the retained old-version draft visibly locks until its source is checked');
    assert.equal(h.button('원본 저장 상태 다시 확인').props.disabled, false, 'source refresh remains usable');
    await h.click('원본 저장 상태 다시 확인');
    assert.ok(regionFieldsets().every(node => node.props.disabled === false));
    assert.deepEqual(await snapshotRegions(h), edited, 'same bytes preserve every draft field');
    await h.click('되돌리기'); assert.deepEqual(await snapshotRegions(h), before);
    await h.click('다시 실행'); assert.deepEqual(await snapshotRegions(h), edited, 'same-byte refresh preserves the exact undo and redo history');
    await h.click('이미지 번역 편집 초안 지우기'); await h.click('원본 문구 읽기');
    assert.equal(h.button('되돌리기').props.disabled, true); assert.equal(h.button('다시 실행').props.disabled, true);
    oldText({ target: { value: 'old draft cannot overwrite new OCR r1' } }); oldUndo(); await h.settle();
    assert.equal(h.field('문구 1 한국어').props.value, '');
    await h.change('문구 1 한국어', '새 OCR 기준 문구'); await h.click('번역 이미지 미리보기'); await h.click('검토한 번역 이미지 적용');
    assert.equal(h.saved, 1); assert.equal(h.field('문구 1 원문'), undefined);
    await h.click('원본 문구 읽기'); assert.equal(h.button('되돌리기').props.disabled, true); assert.equal(h.button('다시 실행').props.disabled, true);
  } finally { h.close(); }
});

test('busy, unknown save and ready-retry states block retained undo/reorder handlers and keep the exact reviewed PNG', async () => {
  const h = fixture(); try {
    const { quotationTarget } = finalImageSelection(h); await translated(h); await h.change('문구 1 한국어', '보관 문구');
    const undo = h.button('되돌리기').props.onClick, reorder = h.field('문구 1 앞으로').props.onClick;
    await h.click('번역 이미지 미리보기'); const pending = deferred(); h.setApply(() => pending.promise);
    h.button('검토한 번역 이미지 적용').props.onClick(); await h.settle();
    undo(); reorder(); await h.settle(); assert.equal(h.field('문구 1 한국어').props.value, '보관 문구');
    assert.equal(h.button('되돌리기').props.disabled, true); assert.equal(h.field('문구 1 앞으로').props.disabled, true);
    pending.reject(new ApplyError('응답 유실', true)); await h.settle(); undo(); reorder(); await h.settle();
    assert.equal(h.field('문구 1 한국어').props.value, '보관 문구'); assert.equal(h.button('되돌리기').props.disabled, true);
    const saved = h.calls.find(call => call.action === 'apply').image;
    h.setRecover(async image => ({ source: image.source, applied: false })); await h.click('같은 결과의 저장 상태 다시 확인');
    undo(); reorder(); await h.settle(); assert.equal(h.field('문구 1 한국어').props.value, '보관 문구');
    assert.equal(h.button('다시 실행').props.disabled, true); assert.equal(h.field('문구 1 앞으로').props.disabled, true);
    h.setApply(async image => ({ source: image.source, applied: true })); await h.click('같은 미리보기 다시 적용');
    assert.equal(h.calls.filter(call => call.action === 'apply').at(-1).image, saved);
    assert.deepEqual(plain(saved.source.quotationTarget), { ...quotationTarget, bindingSha256: 'b'.repeat(64) }); assert.equal(h.saved, 1);
  } finally { h.close(); }
});

test('accepted translation is one reversible edit and stale slot or closed callbacks cannot move its history', async () => {
  const h = fixture(); try {
    const { quotationContext } = finalImageSelection(h); await h.click('원본 문구 읽기');
    await h.change('문구 1 배경색', '#ddeeff'); const before = await snapshotRegions(h);
    await h.click('선택 문구 한국어 번역'); const after = await snapshotRegions(h);
    assert.notDeepEqual(after, before); await h.click('되돌리기'); assert.deepEqual(await snapshotRegions(h), before);
    await h.click('다시 실행'); assert.deepEqual(await snapshotRegions(h), after);
    const undo = h.button('되돌리기').props.onClick, reorder = h.field('문구 1 앞으로').props.onClick;
    const count = h.calls.length;
    h.setProps({ quotationContext: { ...quotationContext, optionId: 'sku-b' }, focusedOptionId: 'sku-b' }); await h.settle(); undo(); reorder(); await h.settle();
    assert.equal(h.field('문구 1 한국어').props.value, '한국어 r1'); assert.equal(h.calls.length, count);
    h.setProps({ quotationContext, focusedOptionId: 'sku-a' }); await h.settle(); await h.click('되돌리기'); assert.equal(h.field('문구 1 한국어').props.value, '');
    const currentUndo = h.button('되돌리기').props.onClick; h.close(); currentUndo(); reorder();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(h.late, 0); assert.equal(h.saved, 0);
  } finally { h.close(); }
});

test('undo supersedes captured translate, preview, reorder and delete callbacks without processing or changing restored arrays', async () => {
  const h = fixture(); try {
    await h.click('원본 문구 읽기'); await h.change('문구 1 선택', '', false);
    const restored = await snapshotRegions(h); await h.change('문구 1 선택', '', true);
    const translate = h.button('선택 문구 한국어 번역').props.onClick, preview = h.button('번역 이미지 미리보기').props.onClick;
    const reorder = h.field('문구 1 앞으로').props.onClick, remove = h.button('문구 1 영역 삭제').props.onClick;
    await h.click('되돌리기'); const count = h.calls.length;
    translate(); preview(); reorder(); remove(); await h.settle();
    assert.equal(h.calls.length, count, 'superseded draft callbacks cannot send Google, render or save requests');
    assert.equal(h.field('문구 1 선택').props.checked, false); assert.equal(h.field('문구 1 한국어').props.value, '');
    assert.deepEqual(await snapshotRegions(h), restored); assert.equal(h.saved, 0);
  } finally { h.close(); }
});

test('an earlier translate callback reads the latest selected originals after ordinary edits and cannot fill an unchecked region', async () => {
  const h = fixture(); try {
    await h.click('원본 문구 읽기'); const translate = h.button('선택 문구 한국어 번역').props.onClick;
    await h.change('문구 1 선택', '', false); await h.change('문구 2 원문', '현재 검토한 두 번째 원문');
    translate(); await h.settle();
    const request = h.calls.filter(call => call.action === 'translate').at(-1);
    assert.deepEqual(plain(request.rows), [{ id: 'r2', text: '현재 검토한 두 번째 원문' }]);
    assert.equal(h.field('문구 1 한국어').props.value, ''); assert.equal(h.field('문구 1 선택').props.checked, false);
    assert.equal(h.field('문구 2 한국어').props.value, '한국어 r2'); assert.equal(h.saved, 0);
    await h.change('문구 2 선택', '', false); const count = h.calls.length; translate(); await h.settle();
    assert.equal(h.calls.length, count, 'an earlier enabled control cannot translate a now empty selection');
  } finally { h.close(); }
});
