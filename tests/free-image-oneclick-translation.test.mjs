import test from 'node:test';
import assert from 'node:assert/strict';
import { manualPanelFixture as fixture, nodes, plain, text } from './helpers/option-detail-manual-edit.mjs';

const target = (sequence = 1, patch = {}) => ({ sourceKey: 'owner/original.png', sequence, role: 'detail', sourceLanguage: 'zh', ...patch });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const actions = h => plain(h.calls.map(call => call.action));
const translatedReply = (source, rows, patch = {}) => ({ source, regions: rows.map(row => ({ id: row.id, original: row.text, translated: '검토할 한국어 ' + row.id, issue: null })), warnings: [], ...patch });
const png = image => ({ source: image.source, output: new Blob(['synthetic generated PNG'], { type: 'image/png' }), width: image.width, height: image.height });
const quotation = { kind: 'quotation', profileId: 'profile', optionId: 'red', input: 'detailImages', fieldKey: 'detailImages', slotIndex: 1,
  revision: 2, inputFingerprint: 'c'.repeat(64), optionRevision: 3, value: 'owner/second.png\nowner/original.png' };
const context = { profileId: quotation.profileId, optionId: quotation.optionId, input: quotation.input };

test('a fresh Chinese or English card action reads owned source, recognizes, translates and prepares PNG while applying stays explicit', async () => {
  for (const language of ['zh', 'en']) {
    const h = fixture({ translationTarget: target(1, { sourceLanguage: language, quotationTarget: quotation }), quotationContext: context });
    try {
      await h.settle(); assert.deepEqual(actions(h), ['source', 'ocr', 'translate', 'preview']);
      assert.equal(h.calls[0].key, 'owner/original.png'); assert.deepEqual(plain(h.calls[0].quotationTarget), quotation);
      assert.equal(h.calls[1].language, language); assert.equal(h.calls[2].language, language); assert.equal(h.calls[3].sourceLanguage, language);
      assert.deepEqual(plain(h.calls[3].image.source.quotationTarget), { ...quotation, bindingSha256: 'b'.repeat(64) });
      assert.deepEqual(plain(h.calls[3].optionImageIds), []); assert.equal(h.calls[3].rows[0].translated, '한국어 r1');
      assert.ok(nodes(h.render()).some(node => node.type === 'img' && node.props.alt === '한국어 문구 적용 미리보기'));
      assert.equal(h.saved, 0); h.allowApply(false); await h.click('검토한 번역 이미지 적용'); assert.equal(h.saved, 0); assert.equal(h.calls.length, 4);
      h.allowApply(true); await h.change('문구 1 한국어', '직접 검토 후 수정'); assert.equal(h.button('검토한 번역 이미지 적용'), undefined);
      await h.click('번역 이미지 미리보기'); await h.click('검토한 번역 이미지 적용'); assert.equal(h.saved, 1);
      assert.equal(h.calls.filter(call => call.action === 'apply').length, 1); assert.equal(h.calls.at(-1).image.source.quotationTarget.slotIndex, 1);
      assert.equal(h.calls.at(-1).image.output.type, 'image/png');
    } finally { h.close(); }
  }
});

test('manual image-card editing restores owned bytes without OCR, translation, PNG generation or automatic write', async () => {
  const h = fixture({ translationTarget: target(1, { intent: 'manual' }) });
  try {
    await h.settle(); assert.deepEqual(actions(h), ['source']); assert.deepEqual(plain(h.calls[0].options), { restoreEditor: true });
    assert.equal(h.field('문구 1 원문'), undefined); assert.equal(h.button('검토한 번역 이미지 적용'), undefined);
    await h.click('문구 영역 직접 추가'); await h.change('문구 1 한국어', '수동 편집 문구');
    assert.equal(h.field('문구 1 한국어').props.value, '수동 편집 문구'); assert.deepEqual(actions(h), ['source']); assert.equal(h.saved, 0);
  } finally { h.close(); }
});

test('mount or ordinary selection does not translate and an already consumed sequence never reruns on render, reactivation or discard', async () => {
  const h = fixture();
  try {
    await h.settle(); assert.deepEqual(actions(h), []); await h.change('이미지 원문 언어', 'en'); assert.deepEqual(actions(h), []);
    h.setProps({ translationTarget: target(1, { sourceLanguage: 'en' }) }); await h.settle(); assert.equal(h.calls.length, 4);
    h.setProps({ translationTarget: target(1, { sourceLanguage: 'en' }) }); await h.settle();
    h.setProps({ active: false }); await h.settle(); h.setProps({ active: true }); await h.settle(); assert.equal(h.calls.length, 4);
    await h.click('이미지 번역 편집 초안 지우기'); await h.settle(); assert.equal(h.calls.length, 4); assert.equal(h.button('검토한 번역 이미지 적용'), undefined);
    h.setProps({ translationTarget: target(2, { sourceLanguage: 'en' }) }); await h.settle(); assert.equal(h.calls.length, 8); assert.equal(h.saved, 0);
  } finally { h.close(); }
});

test('missing or unselected OCR text never creates invented translations or a PNG preview', async () => {
  for (const mode of ['empty', 'unselected']) {
    const h = fixture(); h.setOcr(() => mode === 'empty' ? [] : [{ id: 'unselected', text: 'LOW CONFIDENCE', selected: false, confidence: 10,
      translated: '', translationProvenance: 'empty', issue: null, box: { x: 1, y: 1, width: 18, height: 8 }, background: '#ffffff', foreground: '#111111', fontSize: 4 }]);
    try {
      h.setProps({ translationTarget: target() }); await h.settle(); assert.deepEqual(actions(h), ['source', 'ocr']);
      assert.match(text(h.render()), /자동 번역할 문구를 찾지 못했습니다/); assert.equal(h.button('검토한 번역 이미지 적용'), undefined); assert.equal(h.saved, 0);
      h.setProps({ translationTarget: target() }); await h.settle(); assert.equal(h.calls.length, 2, 'no automatic retries');
    } finally { h.close(); }
  }
});

test('partial translation failure retains recognized text and successful Korean but withholds a misleading PNG', async () => {
  const h = fixture(); h.setTranslate((source, rows) => translatedReply(source, rows, { regions: rows.map((row, index) => ({ id: row.id, original: row.text,
    translated: index ? null : '성공한 한국어', issue: index ? 'synthetic translation failure' : null })), warnings: ['1개 번역 실패'] }));
  try {
    h.setProps({ translationTarget: target() }); await h.settle(); assert.deepEqual(actions(h), ['source', 'ocr', 'translate']);
    assert.equal(h.field('문구 1 한국어').props.value, '성공한 한국어'); assert.equal(h.field('문구 2 원문').props.value, '中文 r2');
    assert.equal(h.field('문구 2 한국어').props.value, ''); assert.match(text(h.render()), /일부 문구를 번역하지 못했습니다/);
    assert.equal(h.button('검토한 번역 이미지 적용'), undefined); assert.equal(h.saved, 0);
    await h.change('문구 2 한국어', '직접 수정한 한국어'); await h.click('번역 이미지 미리보기'); assert.ok(h.button('검토한 번역 이미지 적용')); assert.equal(h.saved, 0);
  } finally { h.close(); }
});

test('source, OCR, translation and render failures stop once, surface the error and never apply fabricated output', async () => {
  for (const stage of ['source', 'ocr', 'translate', 'preview']) {
    const h = fixture(); const fail = () => { throw Error('synthetic ' + stage + ' failure'); };
    ({ source: () => h.setSource(fail), ocr: () => h.setOcr(fail), translate: () => h.setTranslate(fail), preview: () => h.setRender(fail) })[stage]();
    try {
      h.setProps({ translationTarget: target() }); await h.settle(); const count = h.calls.length;
      assert.equal(actions(h).at(-1), stage); assert.ok(nodes(h.render()).some(node => node.props?.role === 'alert' && text(node).trim()), 'the stage failure is visible');
      assert.equal(h.button('검토한 번역 이미지 적용'), undefined); assert.equal(h.saved, 0);
      for (let i = 0; i < 3; i++) h.setProps({ translationTarget: target() }); await h.settle(); assert.equal(h.calls.length, count);
      if (stage === 'translate' || stage === 'preview') assert.equal(h.field('문구 1 원문').props.value, '中文 r1');
    } finally { h.close(); }
  }
});

test('cancelling each in-flight stage aborts its signal and ignores a late successful reply without advancing the chain', async () => {
  for (const stage of ['source', 'ocr', 'translate', 'preview']) {
    const h = fixture(), gate = deferred(); let reply;
    if (stage === 'source') h.setSource(image => { reply = image; return gate.promise; });
    if (stage === 'ocr') h.setOcr(() => { reply = []; return gate.promise; });
    if (stage === 'translate') h.setTranslate((source, rows) => { reply = translatedReply(source, rows); return gate.promise; });
    if (stage === 'preview') h.setRender(image => { reply = png(image); return gate.promise; });
    try {
      h.setProps({ translationTarget: target() }); await h.settle(); const pending = h.calls.at(-1); assert.equal(pending.action, stage);
      await h.click('이미지 작업 취소'); assert.equal(pending.signal.aborted, true); const count = h.calls.length;
      gate.resolve(reply); await h.settle(); assert.equal(h.calls.length, count); assert.equal(h.button('검토한 번역 이미지 적용'), undefined); assert.equal(h.saved, 0);
      if (stage === 'translate' || stage === 'preview') assert.equal(h.field('문구 1 원문').props.value, '中文 r1');
    } finally { gate.resolve(reply); h.close(); }
  }
});

test('changed product version, selected quotation scope, or unmount rejects late translation and keeps all writes blocked', async () => {
  for (const mode of ['version', 'profile', 'option', 'close']) {
    const h = fixture({ quotationContext: context }), gate = deferred(); let pending;
    h.setTranslate((source, rows, signal) => { pending = { source, rows, signal }; return gate.promise; });
    try {
      h.setProps({ translationTarget: target(1, { quotationTarget: quotation }) }); await h.settle(); assert.ok(pending);
      if (mode === 'version') h.setProps({ version: '2026-10-06T00:00:01.000Z' });
      if (mode === 'profile') h.setProps({ quotationContext: { ...context, profileId: 'other' } });
      if (mode === 'option') h.setProps({ quotationContext: { ...context, optionId: 'blue' } });
      if (mode === 'close') h.close();
      await h.settle(); gate.resolve(translatedReply(pending.source, pending.rows)); await h.settle();
      assert.equal(pending.signal.aborted, true); assert.equal(h.field('문구 1 한국어').props.value, ''); assert.equal(h.calls.filter(call => ['preview', 'apply'].includes(call.action)).length, 0);
      assert.equal(h.saved, 0); assert.equal(h.late, 0);
    } finally { gate.resolve(); h.close(); }
  }
});

test('a new explicit target cancels an unfinished clean request, while dirty manual text and reviewed PNG cannot be overwritten', async () => {
  const h = fixture(), gate = deferred(); let first;
  h.setSource((image, signal) => { if (!first) { first = { image, signal }; return gate.promise; } return image; });
  try {
    h.setProps({ translationTarget: target() }); await h.settle(); h.setProps({ translationTarget: target(2, { sourceKey: 'owner/second.png', sourceLanguage: 'en' }) }); await h.settle();
    assert.equal(first.signal.aborted, true); assert.equal(h.field('번역할 원본 이미지').props.value, 'owner/second.png');
    assert.equal(h.calls.filter(call => call.action === 'source').length, 2); assert.equal(h.calls.filter(call => call.action === 'preview').length, 1);
    gate.resolve(first.image); await h.settle(); await h.change('문구 1 한국어', '보존할 직접 수정 문구'); await h.click('번역 이미지 미리보기');
    const count = h.calls.length;
    h.setProps({ translationTarget: target(3, { sourceKey: 'owner/second.png', sourceLanguage: 'en' }) }); await h.settle();
    h.setProps({ translationTarget: target(4, { sourceKey: 'owner/original.png' }) }); await h.settle();
    assert.equal(h.calls.length, count); assert.equal(h.field('문구 1 한국어').props.value, '보존할 직접 수정 문구');
    assert.equal(h.field('번역할 원본 이미지').props.value, 'owner/second.png'); assert.equal(h.saved, 0);
  } finally { gate.resolve(); h.close(); }
});

test('an uncertain final-slot apply keeps its exact PNG for recovery despite a fresh translation target', async () => {
  class UnknownSave extends Error { constructor() { super('synthetic unknown ACK'); this.uncertain = true; } }
  const h = fixture({ quotationContext: context }, { FreeImageApplyError: UnknownSave }); h.setApply(() => { throw new UnknownSave(); });
  try {
    h.setProps({ translationTarget: target(1, { quotationTarget: quotation }) }); await h.settle(); await h.click('검토한 번역 이미지 적용');
    const sent = h.calls.find(call => call.action === 'apply').image, count = h.calls.length;
    h.setProps({ translationTarget: target(2, { quotationTarget: quotation }) }); await h.settle();
    assert.equal(h.calls.length, count); assert.equal(h.button('검토한 번역 이미지 적용'), undefined);
    h.setRecover(image => { assert.equal(image, sent); return { applied: true }; }); await h.click('같은 결과의 저장 상태 다시 확인');
    assert.equal(h.saved, 1); assert.equal(h.calls.filter(call => call.action === 'apply').length, 1); assert.equal(h.calls.filter(call => call.action === 'recover').length, 1);
  } finally { h.close(); }
});
