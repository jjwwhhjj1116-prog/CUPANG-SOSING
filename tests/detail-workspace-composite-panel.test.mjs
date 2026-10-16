import test from 'node:test';
import assert from 'node:assert/strict';
import { compositeFixture, compositePanel, plain, nodes, text } from './helpers/workspace-composite-ui.mjs';
import { deferred, panel as workspacePanel } from './helpers/detail-workspace.mjs';

const prepare = '보관 구성 합치기', download = '보관 구성 PNG 다운로드', save = '보관 구성으로 상세 저장', recover = '보관 구성 상세 저장 결과 확인';
const child = h => nodes(h.render()).find(node => node.type?.name === 'DetailWorkspaceCompositePanel');

test('saved-workspace preview and PNG download only read; explicit review gates the one common/all-option save including excluded rows', async () => {
  const f = await compositeFixture(), h = compositePanel(f), before = JSON.stringify(f.view);
  try {
    await h.click(prepare); assert.equal(JSON.stringify(f.view), before); assert.equal(h.saved.length, 0); assert.equal(h.button(save).props.disabled, true);
    assert.match(text(h.render()), /800px/); assert.match(text(h.render()), /모든 옵션 2개/); assert.match(text(h.render()), /견적 제외 옵션도 포함/);
    assert.match(text(h.render()), /저장 전 HTML/); assert.match(text(h.render()), /견적서 HTML 입력은 비웁니다/);
    assert.ok(nodes(h.render()).every(node => !node.props?.dangerouslySetInnerHTML));
    await h.click(download); assert.equal(h.downloads.length, 1); assert.match(h.downloads[0].download, /workspace-detail\.png$/);
    assert.deepEqual(h.calls.map(call => call.action), ['prepare', 'prepare']); assert.equal(JSON.stringify(f.view), before);
    h.review(); const handler = h.button(save).props.onClick; handler(); handler(); await h.idle();
    assert.equal(h.calls.filter(call => call.action === 'apply').length, 1); assert.equal(h.saved.length, 1);
    assert.ok(h.saved[0].resolved.rows.every(row => row.fields.detailHtml.value === '' && row.fields.detailImages.value === 'owner/final-workspace-detail.png'));
    assert.equal(h.saved[0].resolved.rows.find(row => row.optionId === 'blue').included, false);
    assert.equal(h.saved[0].resolved.rows.find(row => row.optionId === 'blue').fields.altText.value, '상세 설명 - 파랑');
    assert.equal(h.saved[0].resolved.rows.find(row => row.optionId === null).fields.altText.value, '  ');
    assert.equal(h.button(save).props.disabled, true); assert.equal(h.locks.at(-1), false);
  } finally { h.close(); }
});

test('dirty, disabled and stage ABA each invalidate an already reviewed preview even when the input returns to the same value', async () => {
  for (const flag of ['sourceCurrent', 'disabled', 'stageActive']) {
    const f = await compositeFixture(), h = compositePanel(f);
    try {
      await h.click(prepare); h.review(); const stale = h.button(save).props.onClick;
      h.set({ [flag]: flag === 'disabled' }); await h.tick(); h.set({ [flag]: flag !== 'disabled' }); await h.tick(); stale(); await h.idle();
      assert.equal(h.calls.filter(call => call.action === 'apply').length, 0, flag); assert.equal(h.button(save).props.disabled, true, flag); assert.equal(h.checkbox().props.disabled, true);
      await h.click(prepare); h.review(); await h.click(save); assert.equal(h.saved.length, 1);
    } finally { h.close(); }
  }
});

test('held prepare/download cannot produce a usable preview or anchor after dirty or hidden ABA; a fresh action still works', async () => {
  for (const mode of ['prepare', 'download']) {
    const f = await compositeFixture(), held = deferred(); let first = true, input;
    const h = compositePanel(f, { prepare: async (selection, saved, signal) => { if (first) { first = false; input = { selection, saved, signal }; return held.promise; } return f.prepared(selection, saved); } });
    try {
      h.button(mode === 'prepare' ? prepare : download).props.onClick(); h.set({ stageActive: false }); await h.tick(); h.set({ stageActive: true }); await h.tick();
      assert.equal(input.signal.aborted, true); held.resolve(f.prepared(input.selection, input.saved)); await h.idle();
      assert.equal(h.downloads.length, 0); assert.equal(h.button(save), undefined); assert.equal(h.saved.length, 0);
      await h.click(mode === 'prepare' ? prepare : download); assert.equal(mode === 'prepare' ? !!h.button(save) : h.downloads.length, mode === 'prepare' ? true : 1);
    } finally { h.close(); }
  }
});

test('a lost save ACK locks preview/close and recovery only reads once without reapplying', async () => {
  const f = await compositeFixture(), h = compositePanel(f, { apply: async () => { throw Error('503 lost acknowledgement'); } });
  try {
    await h.click(prepare); h.review(); await h.click(save); assert.equal(h.saved.length, 0); assert.equal(h.locks.at(-1), true);
    assert.equal(h.button(prepare).props.disabled, true); assert.equal(h.button(download).props.disabled, true); assert.equal(h.button('보관 구성 미리보기 닫기').props.disabled, true);
    const handler = h.button(recover).props.onClick; handler(); handler(); await h.idle();
    assert.deepEqual(h.calls.map(call => call.action), ['prepare', 'apply', 'recover']); assert.equal(h.saved.length, 1); assert.equal(h.locks.at(-1), false);
    assert.match(text(h.render()), /조회로 확인/);
  } finally { h.close(); }
});

test('unapplied recovery clears review and requires a new explicit confirmation before a repeated save', async () => {
  const f = await compositeFixture(); let first = true;
  const h = compositePanel(f, { apply: async (prepared, attempt) => { if (first) { first = false; throw Error('unknown'); } attempt.completed = f.savedView(); delete attempt.pending; return attempt.completed; },
    recover: async (prepared, attempt) => { delete attempt.pending; return 'ready'; } });
  try {
    await h.click(prepare); h.review(); await h.click(save); await h.click(recover); assert.equal(h.saved.length, 0); assert.equal(h.checkbox().props.checked, false); assert.equal(h.button(save).props.disabled, true);
    assert.equal(h.calls.filter(call => call.action === 'apply').length, 1); h.review(); await h.click(save); assert.equal(h.saved.length, 1); assert.equal(h.calls.filter(call => call.action === 'apply').length, 2);
  } finally { h.close(); }
});

test('a save dispatched before a source-clock change stays un-aborted and cannot deliver late success until explicit current GET recovery', async () => {
  const f = await compositeFixture(), held = deferred(); let signal;
  const h = compositePanel(f, { apply: async (prepared, attempt, nextSignal) => { signal = nextSignal; const next = await held.promise; attempt.completed = next; delete attempt.pending; return next; } });
  try {
    await h.click(prepare); h.review(); h.button(save).props.onClick(); await h.tick();
    const changed = f.selection(); changed.view.productVersion = '2026-10-16T00:00:04.000Z'; changed.view.revision++;
    h.set({ selection: changed, sourceCurrent: false }); await h.tick(); assert.equal(signal.aborted, false);
    held.resolve(f.savedView()); await h.idle(); assert.equal(h.saved.length, 0); assert.equal(h.button(recover).props.disabled, false); assert.equal(h.locks.at(-1), true);
    await h.click(recover); assert.equal(h.saved.length, 1); assert.equal(h.calls.filter(call => call.action === 'apply').length, 1);
  } finally { h.close(); }
});

test('explicit latest GET can leave a superseded pending save without claiming its outcome or replaying the save', async () => {
  const f = await compositeFixture(), h = compositePanel(f, { apply: async () => { throw Error('unknown save'); } });
  try {
    await h.click(prepare); h.review(); await h.click(save); const next = f.selection(); next.view.revision++;
    h.set({ selection: next, sourceCurrent: false }); await h.tick(); await h.click('최신 상세 구성으로 다시 열기');
    assert.equal(h.latest.length, 1); assert.equal(h.saved.length, 0); assert.equal(h.calls.filter(call => call.action === 'apply').length, 1);
    assert.deepEqual(h.calls.map(call => call.action), ['prepare', 'apply', 'latest']); assert.match(text(h.render()), /성공 여부를 단정하거나 저장 요청을 반복하지/);
    assert.equal(h.button(save), undefined); assert.equal(h.locks.at(-1), false);
  } finally { h.close(); }
});

test('unmounted late save and held download do not write local state, deliver callbacks, or click an anchor', async () => {
  for (const action of ['save', 'download']) {
    const f = await compositeFixture(), held = deferred(); let prepared, attempt;
    const h = compositePanel(f, action === 'save' ? { apply: async (input, state) => { prepared = input; attempt = state; return held.promise; } }
      : { prepare: async (selection, saved) => { prepared = f.prepared(selection, saved); return held.promise; } });
    if (action === 'save') { await h.click(prepare); h.review(); h.button(save).props.onClick(); } else h.button(download).props.onClick();
    await h.tick(); h.close(); if (attempt) { attempt.completed = f.savedView(); delete attempt.pending; } held.resolve(action === 'save' ? f.savedView() : prepared);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(h.saved.length, 0); assert.equal(h.downloads.length, 0); assert.equal(h.lateWrites, 0);
  }
});

test('workspace parent preserves clean saved authority, locks editing synchronously, and never disables the composing child with its own busy state', async () => {
  const f = await compositeFixture(), h = workspacePanel(f); let completed = 0, refresh = 0; h.set({ onCompositeSaved: () => completed++, onRefreshRequested: () => refresh++ });
  try {
    await h.idle(); await h.click('상세 편집 구성 열기'); const opened = child(h); assert.ok(opened); assert.equal(opened.props.sourceCurrent, true);
    const remove = h.button('작업 사진 2 제거').props.onClick, before = plain(f.workspace.document);
    opened.props.onBusyChange(true); remove(); await h.tick(); assert.equal(h.button('작업 사진 2 제거').props.disabled, true); assert.equal(child(h).props.disabled, false); assert.equal(child(h).props.beforeApply(), true);
    assert.deepEqual(plain(child(h).props.saved.workspace.document), before); opened.props.onBusyChange(false); await h.idle();
    const next = f.savedView(); child(h).props.onSaved(next); await h.idle(); assert.equal(completed, 1); assert.equal(h.adopted.length, 0); assert.equal(refresh, 0);
    assert.ok(f.calls.every(call => call.method === 'GET' || call.method === 'PUT')); assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1, 'only fixture initial workspace store');
  } finally { h.close(); }
});

test('workspace local dirty changes invalidate composite source without discarding its saved proof or silently adopting photos', async () => {
  const f = await compositeFixture(), h = workspacePanel(f);
  try {
    await h.idle(); await h.click('상세 편집 구성 열기'); const saved = plain(child(h).props.saved.workspace); await h.click('작업 사진 2 제거');
    assert.equal(child(h).props.sourceCurrent, false); assert.equal(child(h).props.disabled, false); assert.deepEqual(plain(child(h).props.saved.workspace), saved);
    assert.equal(child(h).props.beforeApply(), false); assert.equal(h.adopted.length, 0);
  } finally { h.close(); }
});
