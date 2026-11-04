import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, panel, nodes, text, plain, deferred } from './helpers/detail-workspace.mjs';

const entries = (value, ancestors = []) => Array.isArray(value) ? value.flatMap(child => entries(child, ancestors))
  : value && typeof value === 'object' ? [{ node: value, ancestors }, ...entries(value.props?.children, [...ancestors, value])] : [];
const visible = entry => !entry.ancestors.some(node => node.props?.hidden || node.type === 'details' && !node.props.open) && !entry.node.props?.hidden;
const entryFor = (h, label) => entries(h.render()).find(({ node }) => node.props?.['aria-label'] === label || node.type === 'button' && text(node) === label);
const editor = h => nodes(h.render()).find(node => node.type?.name === 'FreeImageTranslationPanel');

test('primary photos keep protected banners clean and body actions visible while secondary controls stay mounted inside disclosures', async () => {
  const f = await fixture(), before = JSON.stringify(f.view), h = panel(f); h.set({ primaryDetailTools: true });
  try {
    await h.idle(); const figures = nodes(h.render()).filter(node => node.type === 'figure'); assert.equal(figures.length, 4);
    assert.deepEqual(figures.map(photo=>photo.props['data-photo-role']),['top','body','body','bottom']);
    assert.deepEqual(figures.map(photo=>photo.props['data-photo-state']),['setting','original','original','setting']);
    assert.deepEqual(figures.map(photo=>text(nodes(photo).find(node=>node.props?.className==='option-detail-image-badge'))),['상단 이미지','원본 이미지','원본 이미지','하단 이미지']);
    for(const index of [1,2])assert.equal(nodes(figures[index]).filter(node=>node.props?.className==='detail-workspace-photo-overlay').length,1);
    for (const index of [0, 3]) assert.equal(nodes(figures[index]).some(node => ['button', 'select', 'input'].includes(node.type)), false, 'protected banners contain no disabled body controls');
    for (const index of [2, 3]) {
      for (const action of ['중국어를 한국어로 번역', '영어를 한국어로 번역', '위로', '아래로', '제거']) { const entry = entryFor(h, `작업 사진 ${index} ${action}`); assert.ok(entry, action); assert.equal(visible(entry), true); }
      assert.equal(visible(entryFor(h, `작업 사진 ${index} 편집`)), false, 'manual original editing remains inside replacement controls');
    }
    for (const label of ['작업 사진 2 교체', '작업 사진 추가 선택', '편집 HTML 사진 간격 (px)', '편집용 생성 HTML', '작업 사진을 선택 옵션 초안으로', '현재 구성 닫기']) {
      const entry = entryFor(h, label); assert.ok(entry, label); assert.equal(visible(entry), false, label);
    }
    const rebase = entries(h.render()).find(({ node }) => node.type?.name === 'DetailWorkspaceRebasePanel'); assert.ok(rebase); assert.equal(visible(rebase), false);
    assert.equal(visible(entryFor(h, '상세 구성 저장')), false,'independent composition storage stays named and accessible in advanced settings, separate from final toolbar Save'); assert.equal(h.button('상세 구성 저장').props.disabled, false);
    assert.equal(h.button('편집 구성 보관'), undefined); assert.equal(text(h.render()).includes('owner/'), false, 'raw storage keys are not option labels or captions');
    const add = h.control('작업 사진 추가 선택'), replace = h.control('작업 사진 2 교체');
    for (const control of [add, replace]) for (const option of nodes(control).filter(node => node.type === 'option' && node.props.value)) {
      assert.match(text(option), /^이미지 [1-9]\d*$/u); assert.ok(f.view.imageKeys.includes(option.props.value));
      assert.equal(text(option), `이미지 ${f.view.imageKeys.indexOf(option.props.value) + 1}`);
    }
    for (const disclosure of nodes(h.render()).filter(node => node.type === 'details')) assert.equal(disclosure.props.onToggle, undefined, 'native disclosure opening is presentation only');
    assert.equal(f.calls.length, 1); assert.ok(f.calls.every(call => call.method === 'GET')); assert.equal(f.workspace, null); assert.equal(f.storage.size, 0); assert.equal(JSON.stringify(f.view), before);
  } finally { h.close(); }
});

for (const [language, label] of [['zh', '중국어'], ['en', '영어']]) test(`primary original ${language} action prepares translation for its exact saved body source and locks peer actions immediately`, async () => {
  const f = await fixture(), h = panel(f); h.set({ primaryDetailTools: true });
  try {
    await h.idle(); await h.click('상세 구성 저장'); const before = JSON.stringify(f.view), action = h.button(`작업 사진 2 ${label}를 한국어로 번역`), peer = h.button('작업 사진 3 영어를 한국어로 번역');
    assert.ok(action); assert.ok(peer); action.props.onClick(); peer.props.onClick(); await h.idle(); const child = editor(h); assert.ok(child);
    assert.equal(child.props.translationTarget.sourceKey, f.keys[1]); assert.equal(child.props.translationTarget.sourceLanguage, language); assert.equal(child.props.translationTarget.intent, undefined);
    assert.equal(child.props.translationTarget.role, 'detail'); assert.equal(child.props.translationTarget.quotationTarget, undefined); assert.equal(child.props.translationTarget.workspaceTarget.photoId, f.workspace.document.photos[1].id);
    assert.equal(child.props.workspaceContext.saved.workspace.digest, f.workspace.digest); assert.equal(child.props.workspaceContext.target.revision, f.workspace.revision); assert.equal(child.props.workspaceContext.target.optionId, 'red');
    assert.equal(child.props.translationTarget.sequence, 1); assert.equal(h.button('작업 사진 2 제거').props.disabled, true); assert.equal(f.calls.length, 2); assert.equal(JSON.stringify(f.view), before); assert.equal(h.adopted.length, 0);
    child.props.onCloseGuard(() => false); h.button('작업 사진 편집 닫기').props.onClick(); await h.idle(); assert.equal(editor(h).props.translationTarget.sequence, child.props.translationTarget.sequence);
    child.props.onCloseGuard(() => true); await h.click('작업 사진 편집 닫기'); assert.equal(editor(h), undefined);
  } finally { h.close(); }
});

for (const guard of ['unsaved', 'dirty', 'inactive', 'disabled', 'stale', 'saving', 'closed', 'edited']) test(`primary direct translation rejects a retained click when the workspace is ${guard}`, async () => {
  const f = await fixture(), gate = deferred(); let hold = false;
  const h = panel(f, (url, init = {}) => hold && init.method === 'PUT' ? gate.promise.then(() => f.request(url, init)) : f.request(url, init)); h.set({ primaryDetailTools: true });
  try {
    await h.idle(); if (guard !== 'unsaved') await h.click('상세 구성 저장');
    const action = h.button('작업 사진 2 중국어를 한국어로 번역'); assert.ok(action); assert.equal(action.props.disabled, guard === 'unsaved');
    if (guard === 'dirty' || guard === 'saving') h.control('편집 HTML 사진 간격 (px)').props.onChange({ target: { value: '4' } });
    if (guard === 'saving') { hold = true; h.button('상세 구성 저장').props.onClick(); }
    if (guard === 'inactive') h.set({ stageActive: false });
    if (guard === 'disabled') h.set({ disabled: true });
    if (guard === 'stale') h.set({ view: { ...plain(f.view), revision: f.view.revision + 1 } });
    if (guard === 'closed') h.button('현재 구성 닫기').props.onClick();
    if (guard === 'edited') { h.control('작업 사진 2 교체').props.onChange({ target: { value: f.keys[4] } }); await h.click('상세 구성 저장'); }
    const count = f.calls.length; action.props.onClick(); h.render(); assert.equal(editor(h), undefined); assert.equal(f.calls.length, count); assert.equal(h.adopted.length, 0);
    if (guard === 'saving') { gate.resolve(); await h.idle(); }
  } finally { h.close(); }
});

test('primary edited photos and batch review keep manual intent while original translation controls remain source-only', async () => {
  const f = await fixture(), h = panel(f); h.set({ primaryDetailTools: true });
  try {
    await h.idle(); await h.click('상세 구성 저장'); h.control('작업 사진 2 교체').props.onChange({ target: { value: f.keys[4] } }); await h.click('상세 구성 저장');
    assert.equal(h.button('작업 사진 2 중국어를 한국어로 번역'), undefined); assert.equal(visible(entryFor(h, '작업 사진 2 편집')), true); await h.click('작업 사진 2 편집');
    let child = editor(h); assert.equal(child.props.translationTarget.sourceKey, f.keys[4]); assert.equal(child.props.translationTarget.intent, 'manual');
    child.props.onCloseGuard(() => true); await h.click('작업 사진 편집 닫기');
    const batch = nodes(h.render()).find(node => node.type?.name === 'DetailWorkspaceImageBatchPanel'); batch.props.onReviewPhoto(f.workspace.document.photos[2].id, 'en'); await h.idle();
    child = editor(h); assert.equal(child.props.translationTarget.sourceKey, f.keys[2]); assert.equal(child.props.translationTarget.sourceLanguage, 'en'); assert.equal(child.props.translationTarget.intent, 'manual');
  } finally { h.close(); }
});

test('friendly labels retain exact photo keys and all explicit save, replacement, reorder and deletion handlers', async () => {
  const f = await fixture(), before = JSON.stringify(f.view), h = panel(f); h.set({ primaryDetailTools: true });
  try {
    await h.idle(); await h.click('상세 구성 저장'); const original = plain(f.workspace.document.photos);
    const replacement = h.control('작업 사진 2 교체'); assert.equal(replacement.props.disabled, false);
    const chosen = nodes(replacement).find(node => node.type === 'option' && text(node) === '이미지 5'); assert.equal(chosen.props.value, f.keys[4]);
    replacement.props.onChange({ target: { value: chosen.props.value } }); h.render();
    const changed=nodes(h.render()).filter(node=>node.type==='figure')[1];assert.equal(changed.props['data-photo-state'],'edited');assert.equal(text(nodes(changed).find(node=>node.props?.className==='option-detail-image-badge')),'편집된 이미지');
    assert.equal(h.render().props['data-workspace-dirty'], true); assert.equal(h.button('상세 구성 저장').props.disabled, false);
    await h.click('작업 사진 2 아래로'); await h.click('작업 사진 2 제거'); await h.click('상세 구성 저장');
    assert.deepEqual(plain(f.workspace.document.photos.map(photo => photo.key)), [f.keys[0], f.keys[4], f.keys[3]]);
    assert.equal(f.workspace.document.photos[1].originKey, original[1].originKey); assert.equal(f.workspace.document.photos[1].id, original[1].id);
    assert.equal(h.button('작업 사진 2 편집').props.disabled, false); assert.equal(h.render().props['data-workspace-dirty'], false);
    assert.equal(JSON.stringify(f.view), before); assert.equal(h.adopted.length, 0); assert.equal(f.calls.filter(call => call.method === 'PUT').length, 2);
  } finally { h.close(); }
});

test('non-primary presentation retains raw-key labels, explicit opening and all existing disabled banner controls', async () => {
  const f = await fixture(), h = panel(f);
  try {
    await h.idle(); assert.equal(f.calls.length, 0); await h.click('상세 편집 구성 열기');
    assert.equal(h.button('상세 구성 저장'), undefined); assert.equal(visible(entryFor(h, '편집 구성 보관')), true);
    for (const index of [1, 4]) for (const action of ['편집', '위로', '아래로', '제거']) {
      const entry = entryFor(h, `작업 사진 ${index} ${action}`); assert.ok(entry); assert.equal(visible(entry), true); assert.equal(entry.node.props.disabled, true);
    }
    for (const label of ['작업 사진 2 교체', '작업 사진 추가 선택', '편집 HTML 사진 간격 (px)', '작업 사진을 선택 옵션 초안으로', '현재 구성 닫기']) assert.equal(visible(entryFor(h, label)), true);
    const rebase = entries(h.render()).find(({ node }) => node.type?.name === 'DetailWorkspaceRebasePanel'); assert.equal(visible(rebase), true);
    assert.ok(nodes(h.control('작업 사진 추가 선택')).some(node => node.type === 'option' && text(node) === f.keys[4])); assert.ok(text(h.render()).includes(f.keys[4]));
    assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0);
  } finally { h.close(); }
});
