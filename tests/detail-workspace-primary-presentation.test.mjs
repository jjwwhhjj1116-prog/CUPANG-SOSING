import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, panel, nodes, text, plain } from './helpers/detail-workspace.mjs';

const entries = (value, ancestors = []) => Array.isArray(value) ? value.flatMap(child => entries(child, ancestors))
  : value && typeof value === 'object' ? [{ node: value, ancestors }, ...entries(value.props?.children, [...ancestors, value])] : [];
const visible = entry => !entry.ancestors.some(node => node.props?.hidden || node.type === 'details' && !node.props.open) && !entry.node.props?.hidden;
const entryFor = (h, label) => entries(h.render()).find(({ node }) => node.props?.['aria-label'] === label || node.type === 'button' && text(node) === label);

test('primary photos keep protected banners clean and body actions visible while secondary controls stay mounted inside disclosures', async () => {
  const f = await fixture(), before = JSON.stringify(f.view), h = panel(f); h.set({ primaryDetailTools: true });
  try {
    await h.idle(); const figures = nodes(h.render()).filter(node => node.type === 'figure'); assert.equal(figures.length, 4);
    for (const index of [0, 3]) assert.equal(nodes(figures[index]).some(node => ['button', 'select', 'input'].includes(node.type)), false, 'protected banners contain no disabled body controls');
    for (const index of [2, 3]) for (const action of ['편집', '위로', '아래로', '제거']) assert.equal(visible(entryFor(h, `작업 사진 ${index} ${action}`)), true);
    for (const label of ['작업 사진 2 교체', '작업 사진 추가 선택', '편집 HTML 사진 간격 (px)', '편집용 생성 HTML', '작업 사진을 선택 옵션 초안으로', '현재 구성 닫기']) {
      const entry = entryFor(h, label); assert.ok(entry, label); assert.equal(visible(entry), false, label);
    }
    const rebase = entries(h.render()).find(({ node }) => node.type?.name === 'DetailWorkspaceRebasePanel'); assert.ok(rebase); assert.equal(visible(rebase), false);
    assert.equal(visible(entryFor(h, '상세 구성 저장')), true); assert.equal(h.button('상세 구성 저장').props.disabled, false);
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

test('friendly labels retain exact photo keys and all explicit save, replacement, reorder and deletion handlers', async () => {
  const f = await fixture(), before = JSON.stringify(f.view), h = panel(f); h.set({ primaryDetailTools: true });
  try {
    await h.idle(); await h.click('상세 구성 저장'); const original = plain(f.workspace.document.photos);
    const replacement = h.control('작업 사진 2 교체'); assert.equal(replacement.props.disabled, false);
    const chosen = nodes(replacement).find(node => node.type === 'option' && text(node) === '이미지 5'); assert.equal(chosen.props.value, f.keys[4]);
    replacement.props.onChange({ target: { value: chosen.props.value } }); h.render();
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
