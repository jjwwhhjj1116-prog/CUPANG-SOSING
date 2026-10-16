import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compositeFixture, rebasePanel, plain, nodes, text } from './helpers/workspace-composite-ui.mjs';
import { runtime, panel as workspacePanel, deferred } from './helpers/detail-workspace.mjs';

const prepare = '현재 배너로 변경 내용 확인', save = '현재 배너로 편집 구성 보관', recover = '배너 변경 보관 결과 확인';
const child = h => nodes(h.render()).find(node => node.type?.name === 'DetailWorkspaceRebasePanel');
async function fixture(noChange = false) {
  const f = await compositeFixture(), r = runtime(f.request), model = r.load('app/detail-workspace-banner-rebase.ts');
  const roles = noChange ? f.reply().roles : { top: [f.keys[4]], bottom: [] }, document = model.buildDetailWorkspaceBannerDocument(f.workspace, roles);
  const files = r.model.detailWorkspaceFileKeys(document).map(key => f.workspace.files.find(file => file.key === key) ?? { key, bytes: f.objects.get(key).length,
    sha256: createHash('sha256').update(f.objects.get(key)).digest('hex'), width: 24, height: 14 });
  f.bannerPreview = await model.createDetailWorkspaceBannerPreview(f.view, f.workspace, roles, files);
  f.rebasedReply = async preview => {
    const body = { ...plain(preview.workspace), document: plain(preview.document), files: plain(preview.files), revision: preview.workspace.revision + 1,
      updatedAt: '2026-10-16T00:00:04.000Z', requestId: preview.requestId }; delete body.digest;
    return { view: plain(preview.view), workspace: { ...body, digest: await r.model.detailWorkspaceDigest(body) }, roles: plain(preview.roles) };
  };
  return f;
}

test('banner review is explicit/read-only and shows old/new real keys, preserved body/origins/spacing before a single approved workspace-only save', async () => {
  const f = await fixture(), h = rebasePanel(f), before = JSON.stringify(f.view);
  try {
    await h.idle(); assert.equal(h.calls.length, 0); await h.click(prepare); assert.equal(h.saved.length, 0); assert.equal(h.button(save).props.disabled, true);
    const images = nodes(h.render()).filter(node => node.type === 'img'); assert.ok(images.some(node => node.props.src.includes('replacement.png'))); assert.ok(images.some(node => node.props.src.includes('top.png')));
    assert.match(text(h.render()), /본문 사진 2장과 사진 간격 0px/); assert.match(text(h.render()), /상품 이미지·견적서·최종 PNG는 바꾸지/);
    assert.ok(nodes(h.render()).every(node => !node.props?.dangerouslySetInnerHTML)); h.review(); const callback = h.button(save).props.onClick; callback(); callback(); await h.idle();
    assert.equal(h.calls.filter(call => call.action === 'apply').length, 1); assert.equal(h.saved.length, 1); const reply = h.saved[0];
    assert.deepEqual(reply.workspace.document.photos.filter(photo => photo.role === 'body'), plain(f.workspace.document.photos.filter(photo => photo.role === 'body')));
    assert.equal(reply.workspace.document.imageMargin, f.workspace.document.imageMargin); assert.equal(JSON.stringify(f.view), before); assert.deepEqual(reply.view, plain(f.view)); assert.equal(h.locks.at(-1), false);
  } finally { h.close(); }
});

test('unchanged protected banners cannot be approved or written', async () => {
  const f = await fixture(true), h = rebasePanel(f);
  try { await h.click(prepare); assert.equal(h.checkbox().props.disabled, true); assert.equal(h.button(save).props.disabled, true); h.button(save).props.onClick(); await h.idle();
    assert.match(text(h.render()), /변경할 배너가 없습니다/); assert.equal(h.calls.filter(call => call.action === 'apply').length, 0);
  } finally { h.close(); }
});

test('disabled/stage ABA or a changed source view invalidates a reviewed banner proposal; a held GET cannot publish stale review', async () => {
  for (const mode of ['disabled', 'stageActive', 'view', 'held']) {
    const f = await fixture(), held = deferred(); let first = true;
    const h = rebasePanel(f, mode === 'held' ? { prepare: async () => { if (first) { first = false; return held.promise; } return plain(f.bannerPreview); } } : {});
    try {
      if (mode === 'held') h.button(prepare).props.onClick(); else { await h.click(prepare); h.review(); }
      const callback = h.button(save)?.props.onClick;
      if (mode === 'view') { const selection = f.selection(); selection.view.revision++; h.set({ selection }); }
      else { const flag = mode === 'held' ? 'stageActive' : mode; h.set({ [flag]: flag === 'disabled' }); await h.tick(); h.set({ [flag]: flag !== 'disabled' }); await h.tick(); }
      if (mode === 'held') held.resolve(plain(f.bannerPreview)); callback?.(); await h.idle();
      assert.equal(h.calls.filter(call => call.action === 'apply').length, 0); assert.equal(h.saved.length, 0);
      if (mode === 'held') assert.equal(h.button(save), undefined); else assert.equal(h.checkbox().props.disabled, true);
    } finally { held.resolve(plain(f.bannerPreview)); h.close(); }
  }
});

test('lost banner ACK locks edits/close and resolves with GET-only confirmation, never another apply', async () => {
  const f = await fixture(), h = rebasePanel(f, { apply: async () => { throw Error('503 unknown'); } });
  try {
    await h.click(prepare); h.review(); await h.click(save); assert.equal(h.locks.at(-1), true); assert.equal(h.saved.length, 0);
    assert.equal(h.button('배너 변경 확인 닫기').props.disabled, true); assert.equal(h.button(prepare).props.disabled, true); await h.click(recover);
    assert.deepEqual(h.calls.map(call => call.action), ['prepare', 'apply', 'recover']); assert.equal(h.saved.length, 1); assert.equal(h.locks.at(-1), false);
  } finally { h.close(); }
});

test('unapplied confirmation requires a fresh checkbox before explicit retry; no recovery path writes automatically', async () => {
  const f = await fixture(); let first = true;
  const h = rebasePanel(f, { apply: async (preview, attempt) => { if (first) { first = false; throw Error('unknown'); } attempt.completed = await f.rebasedReply(preview); attempt.pending = false; return attempt.completed; },
    recover: async (preview, attempt) => { attempt.pending = false; attempt.retryReady = true; return 'ready'; } });
  try {
    await h.click(prepare); h.review(); await h.click(save); await h.click(recover); assert.equal(h.saved.length, 0); assert.equal(h.checkbox().props.checked, false); assert.equal(h.button(save).props.disabled, true);
    assert.equal(h.calls.filter(call => call.action === 'apply').length, 1); h.review(); await h.click(save); assert.equal(h.saved.length, 1); assert.equal(h.calls.filter(call => call.action === 'apply').length, 2);
  } finally { h.close(); }
});

test('a late successful save after source changes stays pending until explicit frozen-input recovery; explicit latest only returns a preview', async () => {
  const f = await fixture(), held = deferred(); let signal;
  const h = rebasePanel(f, { apply: async (preview, attempt, nextSignal) => { signal = nextSignal; const reply = await held.promise; attempt.completed = reply; attempt.pending = false; return reply; } });
  try {
    await h.click(prepare); h.review(); h.button(save).props.onClick(); await h.tick(); const selection = f.selection(); selection.view.revision++; h.set({ selection }); await h.tick(); assert.equal(signal.aborted, false);
    held.resolve(await f.rebasedReply(f.bannerPreview)); await h.idle(); assert.equal(h.saved.length, 0); await h.click(recover); assert.equal(h.saved.length, 1);
    assert.deepEqual(plain(h.calls.find(call => call.action === 'recover').selection.view), plain(f.bannerPreview.view)); assert.equal(h.calls.filter(call => call.action === 'apply').length, 1);
  } finally { h.close(); }
  const next = rebasePanel(f, { apply: async () => { throw Error('unknown'); } });
  try { await next.click(prepare); next.review(); await next.click(save); await next.click('최신 배너 기준 다시 조회'); assert.equal(next.saved.length, 0); assert.equal(next.latest.length, 1);
    assert.equal(next.latest[0].format, 'detail-workspace-banner-rebase-v1'); assert.equal(next.button(save), undefined); assert.equal(next.calls.filter(call => call.action === 'apply').length, 1);
    assert.match(text(next.render()), /성공 여부는 단정하지/);
  } finally { next.close(); }
});

test('banner panel remains reachable without an ordinary workspace view and parent peer locks do not disable its own request', async () => {
  const f = await fixture(), request = f.request; let refreshed = 0;
  const h = workspacePanel(f, async (url, init = {}) => { if (url.includes('/detail-workspace?') && (init.method ?? 'GET') === 'GET') return Response.json({ error: 'current banner mismatch' }, { status: 409 }); return request(url, init); });
  h.set({ onRefreshRequested: () => refreshed++ });
  try {
    await h.idle(); assert.ok(child(h)); assert.equal(child(h).props.disabled, false); await h.click('상세 편집 구성 열기'); assert.match(text(h.render()), /current banner mismatch/);
    assert.equal(child(h).props.disabled, false); child(h).props.onBusyChange(true); await h.tick(); assert.equal(child(h).props.disabled, false); assert.equal(child(h).props.beforeApply(), true); assert.equal(h.button('상세 편집 구성 열기').props.disabled, true);
    const reply = await f.rebasedReply(f.bannerPreview); child(h).props.onSaved(reply); child(h).props.onBusyChange(false); await h.idle(); assert.equal(refreshed, 1); assert.equal(h.adopted.length, 0);
    assert.equal(h.control('편집 HTML 사진 간격 (px)').props.value, '0'); assert.deepEqual(plain(nodes(h.render()).filter(node => node.type === 'figure').map(node => text(node)).length), reply.workspace.document.photos.length);
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1, 'only initial synthetic seed');
  } finally { h.close(); }
});

test('dirty margin/document blocks cached banner completion, while explicit latest clears old work without opening a mismatched historical record', async () => {
  const f = await fixture(), h = workspacePanel(f); let refreshed = 0; h.set({ onRefreshRequested: () => refreshed++ });
  try {
    await h.idle(); await h.click('상세 편집 구성 열기'); const old = child(h); h.control('편집 HTML 사진 간격 (px)').props.onChange({ target: { value: '' } }); h.render();
    assert.equal(child(h).props.disabled, true); assert.equal(old.props.beforeApply(), false); old.props.onSaved(await f.rebasedReply(f.bannerPreview)); await h.idle(); assert.equal(refreshed, 0); assert.equal(h.control('편집 HTML 사진 간격 (px)').props.value, '');
    h.control('편집 HTML 사진 간격 (px)').props.onChange({ target: { value: '0' } }); h.render(); child(h).props.onLatestRead(f.bannerPreview); await h.idle();
    assert.equal(refreshed, 1); assert.equal(h.control('편집 HTML 사진 간격 (px)'), undefined); assert.ok(child(h)); assert.equal(h.adopted.length, 0);
  } finally { h.close(); }
});

test('a server-stale preview or definite precommit rejection still exposes an explicit GET-only latest escape', async () => {
  for (const mode of ['prepare', 'apply']) {
    const f = await fixture(), h = rebasePanel(f, mode === 'prepare' ? { prepare: async () => { throw Error('changed saved view'); } }
      : { apply: async (preview, attempt) => { attempt.pending = false; throw Error('409 source changed before commit'); } });
    try {
      await h.click(prepare); if (mode === 'apply') { h.review(); await h.click(save); }
      assert.ok(h.button('최신 배너 기준 다시 조회')); await h.click('최신 배너 기준 다시 조회'); assert.equal(h.latest.length, 1); assert.equal(h.saved.length, 0);
      assert.equal(h.calls.filter(call => call.action === 'apply').length, mode === 'apply' ? 1 : 0); assert.equal(h.calls.at(-1).action, 'latest');
    } finally { h.close(); }
  }
});

test('retained parent completion/latest callbacks cannot replace an edited-then-restored local workspace', async () => {
  const f = await fixture(), h = workspacePanel(f); let refreshed = 0; h.set({ onRefreshRequested: () => refreshed++ });
  try {
    await h.idle(); await h.click('상세 편집 구성 열기'); const old = child(h), body = h.control('편집용 생성 HTML').props.value;
    h.control('편집 HTML 사진 간격 (px)').props.onChange({ target: { value: '30' } }); h.render();
    h.control('편집 HTML 사진 간격 (px)').props.onChange({ target: { value: '0' } }); h.render(); assert.equal(h.render().props['data-workspace-dirty'], false);
    old.props.onSaved(await f.rebasedReply(f.bannerPreview)); old.props.onLatestRead(f.bannerPreview); await h.idle();
    assert.equal(refreshed, 0); assert.equal(h.control('편집용 생성 HTML').props.value, body); assert.equal(h.adopted.length, 0);
  } finally { h.close(); }
});
