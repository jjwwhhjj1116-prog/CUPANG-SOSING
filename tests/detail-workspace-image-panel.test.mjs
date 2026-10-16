import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixture, panel, runtime, nodes, text, plain } from './helpers/detail-workspace.mjs';
const editor = h => nodes(h.render()).find(node => typeof node.type === 'function' && node.type.name === 'FreeImageTranslationPanel');
async function openEditor(f, h) { await h.idle(); await h.click('상세 편집 구성 열기'); await h.click('편집 구성 보관'); await h.click('작업 사진 2 편집'); return editor(h); }
async function sealedReply(f) {
  const { model } = runtime(f.request), before = f.workspace, bytes = f.objects.get(f.keys[4]), sha256 = createHash('sha256').update(bytes).digest('hex');
  const key = `owner/free-image-workspace-product-${'e'.repeat(64)}-${sha256}.png`; f.objects.set(key, bytes);
  const photos = plain(before.document.photos); photos[1].key = key;
  const document = { ...plain(before.document), photos, generatedHtml: model.generateDetailWorkspaceHtml(photos, before.document.imageMargin) }, files = new Map(before.files.map(file => [file.key, file]));
  files.set(key, { key, sha256, bytes: bytes.length, width: 24, height: 14 });
  const body = { format: before.format, productId: before.productId, optionId: before.optionId, context: before.context, company: before.company, revision: before.revision + 1,
    updatedAt: new Date(Date.parse(before.updatedAt) + 1).toISOString(), requestId: await model.detailWorkspaceRequestId('product', 'red', before.revision, model.detailWorkspaceExpectedView(f.view), document),
    document, files: model.detailWorkspaceFileKeys(document).map(key => files.get(key)) };
  f.workspace = { ...body, digest: await model.detailWorkspaceDigest(body) }; return f.reply();
}

test('only a clean stored body photo opens its exact current key and stable ID; peers and same-tick closing are guarded', async () => {
  const f = await fixture(), h = panel(f);
  try {
    await h.idle(); await h.click('상세 편집 구성 열기'); assert.equal(h.button('작업 사진 2 편집').props.disabled, true); await h.click('편집 구성 보관');
    h.control('작업 사진 2 교체').props.onChange({ target: { value: f.keys[4] } }); h.render(); assert.equal(h.button('작업 사진 2 편집').props.disabled, true); await h.click('편집 구성 보관');
    await h.click('작업 사진 2 편집'); const child = editor(h); assert.ok(child); assert.equal(child.props.translationTarget.sourceKey, f.keys[4]);
    assert.equal(child.props.workspaceContext.saved.workspace.document.photos[1].originKey, f.keys[1]); assert.equal(child.props.translationTarget.workspaceTarget.photoId, f.workspace.document.photos[1].id);
    assert.equal(child.props.translationTarget.workspaceTarget.revision, 2); assert.equal(child.props.translationTarget.quotationTarget, undefined);
    assert.equal(h.button('작업 사진 2 제거').props.disabled, true); assert.equal(h.button('작업 사진을 선택 옵션 초안으로').props.disabled, true); assert.equal(h.locks.at(-1), true);
    child.props.onCloseGuard(() => false); h.button('작업 사진 편집 닫기').props.onClick(); await h.idle(); assert.ok(editor(h));
    child.props.onCloseGuard(() => true); await h.click('작업 사진 편집 닫기'); assert.equal(editor(h), undefined); assert.equal(h.adopted.length, 0);
  } finally { h.close(); }
});

test('verified photo completion updates only the independent composition and disables adoption until explicit pool attachment', async () => {
  const f = await fixture(), h = panel(f), before = JSON.stringify(f.view);
  try {
    const child = await openEditor(f, h), source = plain(f.workspace.document.photos), reply = await sealedReply(f); child.props.onWorkspaceSaved(reply); await h.idle();
    assert.equal(editor(h), undefined); assert.equal(h.adopted.length, 0); assert.equal(JSON.stringify(f.view), before);
    assert.equal(h.button('작업 사진을 선택 옵션 초안으로').props.disabled, true); assert.equal(h.button('편집 결과를 상품 이미지에 추가').props.disabled, false);
    assert.equal(f.workspace.document.photos[1].id, source[1].id); assert.equal(f.workspace.document.photos[1].originKey, source[1].originKey);
    assert.deepEqual(f.workspace.document.photos.filter((_, index) => index !== 1), source.filter((_, index) => index !== 1));
    const count = f.calls.length; child.props.onWorkspaceSaved(reply); await h.idle(); assert.equal(f.calls.length, count); assert.equal(h.adopted.length, 0);
    assert.ok(nodes(h.render()).every(node => !node.props?.dangerouslySetInnerHTML));
  } finally { h.close(); }
});

for (const lost of [false, true]) test(`pool attachment is a separate explicit action, preserves HTML, and missing ACK recovers without repeating POST (lost=${lost})`, async () => {
  const f = await fixture(), request = f.request; let lose = lost, attached = 0, h;
  const transport = async (url, init = {}) => {
    if (url.includes('/detail-workspace/attach')) {
      f.calls.push({ url, init, method: init.method }); assert.equal(init.method, 'POST');
      const input = JSON.parse(init.body); assert.equal(input.revision, f.workspace.revision); assert.equal(input.digest, f.workspace.digest);
      f.view = { ...plain(f.view), imageKeys: [...f.view.imageKeys, ...f.workspace.document.photos.map(photo => photo.key).filter(key => !f.view.imageKeys.includes(key))], productVersion: '2026-10-16T00:00:04.000Z', inputFingerprint: 'b'.repeat(64) };
      if (lose) { lose = false; return Response.json({ error: 'attachment ACK lost' }, { status: 503 }); } return Response.json(f.reply());
    }
    return request(url, init);
  };
  h = panel(f, transport); h.set({ onFilesAttached: view => { attached++; h.set({ view }); } });
  try {
    const child = await openEditor(f, h), html = f.view.overrides.options.red.detailHtml, reply = await sealedReply(f); child.props.onWorkspaceSaved(reply); await h.idle();
    await h.click('편집 결과를 상품 이미지에 추가'); if (lost) { assert.equal(h.button('작업 사진을 선택 옵션 초안으로').props.disabled, true); assert.equal(attached, 0); await h.click('상품 이미지 추가 결과 확인'); }
    assert.equal(attached, 1); assert.equal(f.calls.filter(call => call.method === 'POST').length, 1); assert.equal(f.view.overrides.options.red.detailHtml, html);
    assert.equal(h.button('작업 사진을 선택 옵션 초안으로').props.disabled, false); assert.equal(h.adopted.length, 0); await h.click('작업 사진을 선택 옵션 초안으로'); assert.equal(h.adopted.length, 1);
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  } finally { h.close(); }
});

test('late editor completion after an active ABA cannot overwrite local state or call quotation adoption', async () => {
  const f = await fixture(), h = panel(f);
  try {
    const child = await openEditor(f, h), reply = await sealedReply(f); h.set({ stageActive: false }); await h.tick(); h.set({ stageActive: true }); await h.tick();
    child.props.onWorkspaceSaved(reply); await h.idle(); assert.ok(editor(h)); assert.equal(h.button('편집 결과를 상품 이미지에 추가'), undefined); assert.equal(h.adopted.length, 0);
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1);
  } finally { h.close(); }
});

test('explicit latest-editor GET replaces a blocked local editor without replaying a write or claiming the old outcome', async () => {
  const f = await fixture(), h = panel(f); let refreshed = 0; h.set({ onRefreshRequested: () => { refreshed++; h.set({ view: plain(f.view) }); } });
  try {
    const child = await openEditor(f, h); child.props.onEditingChange(true); h.render(); assert.equal(h.button('작업 사진 편집 닫기').props.disabled, true);
    f.view.revision++; f.view.productVersion = '2026-10-16T00:00:05.000Z'; const count = f.calls.length;
    await h.click('최신 구성으로 다시 열기'); assert.equal(f.calls.length, count + 1); assert.equal(f.calls.at(-1).method, 'GET'); assert.equal(editor(h), undefined); assert.equal(refreshed, 1);
    assert.equal(h.adopted.length, 0); assert.match(text(h.render()), /성공 여부를 단정하거나 저장 요청을 반복하지/);
  } finally { h.close(); }
});

test('explicit latest-attachment GET exits a changed-parent conflict while preserving its latest manual fields', async () => {
  const f = await fixture(), request = f.request; let h, refreshed = 0, strictAttached = 0;
  const transport = async (url, init = {}) => { if (url.includes('/attach')) { f.calls.push({ url, init, method: 'POST' }); return Response.json({ error: 'unknown attachment ACK' }, { status: 503 }); } return request(url, init); };
  h = panel(f, transport); h.set({ onFilesAttached: () => strictAttached++, onRefreshRequested: () => { refreshed++; h.set({ view: plain(f.view) }); } });
  try {
    const child = await openEditor(f, h), reply = await sealedReply(f); child.props.onWorkspaceSaved(reply); await h.idle(); await h.click('편집 결과를 상품 이미지에 추가');
    f.view.revision++; f.view.overrides.options.red.detailHtml = '외부에서 명시적으로 저장한 공란 아님'; f.view.productVersion = '2026-10-16T00:00:08.000Z';
    const count = f.calls.length; await h.click('최신 상태로 다시 열기'); assert.equal(f.calls.length, count + 1); assert.equal(f.calls.at(-1).method, 'GET'); assert.equal(refreshed, 1); assert.equal(strictAttached, 0);
    assert.equal(h.adopted.length, 0); assert.equal(f.view.overrides.options.red.detailHtml, '외부에서 명시적으로 저장한 공란 아님'); assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  } finally { h.close(); }
});
