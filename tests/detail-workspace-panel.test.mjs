import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, panel, runtime, nodes, text, deferred, plain } from './helpers/detail-workspace.mjs';

test('opening is explicit and previews actual ordered roles without writes, role or spacing controls, or executable HTML', async () => {
  const f = await fixture(), h = panel(f);
  try {
    await h.idle(); assert.equal(f.calls.length, 0); await h.click('상세 편집 구성 열기');
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'GET');
    assert.equal(h.control('작업 사진 1 교체').props.disabled, true); assert.equal(h.control('작업 사진 2 교체').props.disabled, true, 'new originals must first be sealed');
    assert.equal(h.button('작업 사진 1 제거').props.disabled, true); assert.equal(h.button('작업 사진 4 제거').props.disabled, true);
    assert.equal(h.button('작업 사진 2 위로').props.disabled, true); assert.equal(h.button('작업 사진 3 아래로').props.disabled, true);
    assert.ok(nodes(h.render()).every(node => !node.props?.dangerouslySetInnerHTML && node.type !== 'iframe' && node.type !== 'script'));
    assert.equal(h.control('편집용 생성 HTML').props.readOnly, true); assert.match(h.control('편집용 생성 HTML').props.value, /width:760px/);
    assert.equal(nodes(h.render()).filter(node => node.type === 'select').length, 5); assert.equal(h.adopted.length, 0);
  } finally { h.close(); }
});

test('explicit save, body reorder/replacement/delete and exact adoption keep stable origins, banners and literal quote HTML', async () => {
  const f = await fixture(), h = panel(f), before = JSON.stringify(f.view);
  try {
    await h.idle(); await h.click('상세 편집 구성 열기'); await h.click('편집 구성 보관'); assert.equal(f.workspace.revision, 1);
    const original = plain(f.workspace.document.photos), oldRemove = h.button('작업 사진 2 제거').props.onClick;
    await h.click('작업 사진 3 위로'); assert.equal(h.button('작업 사진을 선택 옵션 초안으로').props.disabled, true);
    oldRemove(); await h.idle(); assert.equal(nodes(h.render()).filter(node => node.type === 'figure').length, 4, 'stale mutation closure cannot change a later draft');
    h.control('작업 사진 2 교체').props.onChange({ target: { value: f.keys[4] } }); h.render();
    await h.click('작업 사진 3 제거'); await h.click('편집 구성 보관'); assert.equal(f.workspace.revision, 2);
    assert.deepEqual(f.workspace.document.photos.map(photo => photo.key), [f.keys[0], f.keys[4], f.keys[3]]);
    assert.equal(f.workspace.document.photos[1].originKey, original[2].originKey); assert.equal(f.workspace.document.photos[1].id, original[2].id);
    await h.click('작업 사진을 선택 옵션 초안으로'); assert.deepEqual(h.adopted, [[f.keys[0], f.keys[4], f.keys[3]]]);
    assert.equal(JSON.stringify(f.view), before); assert.equal(f.calls.filter(call => call.method === 'PUT').length, 2);
    assert.ok(f.calls.every(call => call.url.includes('/detail-workspace?') || call.url.startsWith('/api/files/')));
  } finally { h.close(); }
});

test('new repeated positions retain separate IDs and cannot replace their original before the first save', async () => {
  const f = await fixture(), h = panel(f);
  try {
    await h.idle(); await h.click('상세 편집 구성 열기'); await h.click('편집 구성 보관');
    h.control('작업 사진 추가 선택').props.onChange({ target: { value: f.keys[1] } }); h.render(); const add = h.button('작업 사진 추가').props.onClick;
    add(); add(); await h.idle(); assert.equal(nodes(h.render()).filter(node => node.type === 'figure').length, 5, 'same tick double click adds one position');
    assert.equal(h.control('작업 사진 4 교체').props.disabled, true); await h.click('편집 구성 보관');
    const photos = f.workspace.document.photos; assert.equal(photos[3].originKey, f.keys[1]); assert.notEqual(photos[3].id, photos[1].id);
    assert.equal(photos[4].role, 'bottom'); assert.equal(h.control('작업 사진 4 교체').props.disabled, false);
  } finally { h.close(); }
});

test('lost ACK locks all mutations and adoption, survives reload and resolves by one GET without another PUT', async () => {
  const f = await fixture(); let lost = true; const transport = async (url, init = {}) => { const response = await f.request(url, init); if (init.method === 'PUT' && lost) { lost = false; return Response.json({ error: '응답 유실' }, { status: 503 }); } return response; };
  let h = panel(f, transport);
  try {
    await h.idle(); await h.click('상세 편집 구성 열기'); const save = h.button('편집 구성 보관').props.onClick; save(); save(); await h.idle();
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1); assert.equal(f.storage.size, 1);
    assert.equal(h.button('편집 구성 보관').props.disabled, true); assert.equal(h.button('작업 사진을 선택 옵션 초안으로').props.disabled, true);
    h.close(); h = panel(f, transport); await h.idle(); assert.match(text(h.render()), /이전 편집 구성/);
    const before = f.calls.length; await h.click('보관 결과 확인'); assert.equal(f.calls.length, before + 1); assert.equal(f.calls.at(-1).method, 'GET'); assert.equal(f.storage.size, 0);
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1); assert.equal(h.button('작업 사진을 선택 옵션 초안으로').props.disabled, false);
  } finally { h.close(); }
});

test('source changes preserve the local draft and disable old callbacks until explicit close and reopen', async () => {
  const f = await fixture(), h = panel(f);
  try {
    await h.idle(); await h.click('상세 편집 구성 열기'); await h.click('편집 구성 보관');
    const remove = h.button('작업 사진 2 제거').props.onClick; const before = f.calls.length;
    const updated = plain(f.view); updated.revision++; h.set({ view: updated }); await h.idle(); remove(); await h.idle();
    assert.equal(f.calls.length, before); assert.equal(nodes(h.render()).filter(node => node.type === 'figure').length, 4); assert.equal(h.button('편집 구성 보관').props.disabled, true);
    assert.match(text(h.render()), /현재 구성은 유지/); await h.click('현재 구성 닫기'); assert.equal(nodes(h.render()).filter(node => node.type === 'figure').length, 0);
    f.view = updated; await h.click('상세 편집 구성 열기'); assert.equal(nodes(h.render()).filter(node => node.type === 'figure').length, 4);
  } finally { h.close(); }
});

test('delayed read and adopt cannot update after active or disabled ABA, or invoke a changed dirty guard', async () => {
  for (const kind of ['stageActive', 'disabled', 'guard']) {
    const f = await fixture(), api = runtime(f.request), input = await api.client.createDetailWorkspaceSave(f.selection(), f.reply(), f.document()); await api.client.saveDetailWorkspace(input, {}, new AbortController().signal);
    const gate = deferred(), entered = deferred(); let hold = false, allowed = true;
    const transport = async (url, init) => { const response = await f.request(url, init); if (hold && url.startsWith('/api/files/')) { hold = false; entered.resolve(); await gate.promise; } return response; };
    const h = panel(f, transport);
    try {
      h.set({ beforeAdopt: () => allowed }); await h.idle(); await h.click('상세 편집 구성 열기'); hold = true;
      h.button('작업 사진을 선택 옵션 초안으로').props.onClick(); await entered.promise;
      if (kind === 'guard') allowed = false;
      else { const original = kind === 'stageActive'; h.set({ [kind]: !original }); await h.tick(); h.set({ [kind]: original }); await h.tick(); }
      gate.resolve(); await h.idle(); assert.equal(h.adopted.length, 0, kind); assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1);
    } finally { gate.resolve(); h.close(); }
  }
});

test('same-tick save lock and unmount during an actual write preserve recovery without late callbacks', async () => {
  const f = await fixture(), gate = deferred(), entered = deferred(); let signal;
  const transport = async (url, init) => { const response = await f.request(url, init); if (init?.method === 'PUT') { signal = init.signal; entered.resolve(); await gate.promise; } return response; };
  const h = panel(f, transport);
  await h.idle(); await h.click('상세 편집 구성 열기'); const save = h.button('편집 구성 보관').props.onClick; save(); save(); await entered.promise;
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1); assert.equal(h.control('작업 사진 2 교체').props.disabled, true); h.close(); assert.equal(signal.aborted, false);
  gate.resolve(); await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(f.storage.size, 1); assert.equal(h.adopted.length, 0);
});

test('mismatched stored request and damaged files cannot adopt or silently replace an unknown record', async () => {
  const f = await fixture(), h = panel(f);
  try {
    await h.idle(); await h.click('상세 편집 구성 열기'); await h.click('편집 구성 보관');
    f.objects.set(f.keys[1], f.objects.get(f.keys[2])); await h.click('작업 사진을 선택 옵션 초안으로'); assert.equal(h.adopted.length, 0);
    assert.ok(nodes(h.render()).some(node => node.props?.role === 'alert')); assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1);
  } finally { h.close(); }
});

test('an uncommitted request stays locked after GET until an explicit identical retry', async () => {
  const f = await fixture(); let first = true;
  const transport = async (url, init = {}) => { if (init.method === 'PUT' && first) { first = false; f.calls.push({ url, init, method: 'PUT' }); throw Error('not dispatched'); } return f.request(url, init); };
  const h = panel(f, transport);
  try {
    await h.idle(); await h.click('상세 편집 구성 열기'); await h.click('편집 구성 보관'); assert.equal(f.workspace, null);
    await h.click('보관 결과 확인'); assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1); assert.equal(h.button('작업 사진 2 제거').props.disabled, true);
    await h.click('같은 구성 다시 보관'); const writes = f.calls.filter(call => call.method === 'PUT'); assert.equal(writes.length, 2); assert.equal(writes[0].init.body, writes[1].init.body);
    assert.equal(f.workspace.revision, 1); assert.equal(f.storage.size, 0); assert.equal(h.button('작업 사진을 선택 옵션 초안으로').props.disabled, false);
  } finally { h.close(); }
});

test('corrupt local confirmation requires an explicit authenticated GET-only repair before editing can resume', async () => {
  const f = await fixture(); f.storage.set('yoofam-detail-workspace-v1:product:red:profile', '{broken JSON'); const h = panel(f);
  try {
    await h.idle(); assert.equal(f.calls.length, 0); assert.equal(h.button('상세 편집 구성 열기').props.disabled, true);
    await h.click('최신 보관 구성으로 복구'); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'GET'); assert.equal(f.storage.size, 0);
    assert.equal(h.button('편집 구성 보관').props.disabled, false); assert.equal(h.adopted.length, 0); assert.match(text(h.render()), /저장 요청은 보내지 않았습니다/);
  } finally { h.close(); }
});

test('unknown ACK recovers against a fresh same-category quote without overwriting unrelated HTML or issuing a second PUT', async () => {
  const f = await fixture(); let lost = true; const transport = async (url, init = {}) => { const response = await f.request(url, init); if (init.method === 'PUT' && lost) { lost = false; return Response.json({ error: 'lost ACK' }, { status: 503 }); } return response; };
  const h = panel(f, transport);
  try {
    await h.idle(); await h.click('상세 편집 구성 열기'); await h.click('편집 구성 보관');
    f.view.revision++; f.view.productVersion = '2026-10-16T00:00:05.000Z'; f.view.overrides.options.red.detailHtml = '<p>별도 최신 수동 HTML</p>'; h.set({ view: plain(f.view) }); await h.idle();
    await h.click('보관 결과 확인'); assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1); assert.equal(f.storage.size, 0);
    assert.equal(h.button('작업 사진을 선택 옵션 초안으로').props.disabled, false); assert.equal(f.view.overrides.options.red.detailHtml, '<p>별도 최신 수동 HTML</p>'); assert.equal(h.adopted.length, 0);
  } finally { h.close(); }
});

test('captured adoption cannot discard a later workspace edit and changing inline busy callbacks causes no request loop', async () => {
  const f = await fixture(), h = panel(f);
  try {
    await h.idle(); await h.click('상세 편집 구성 열기'); await h.click('편집 구성 보관'); const stale = h.button('작업 사진을 선택 옵션 초안으로').props.onClick;
    await h.click('작업 사진 2 아래로'); const count = f.calls.length; stale(); await h.idle(); assert.equal(f.calls.length, count); assert.equal(h.adopted.length, 0);
    for (let index = 0; index < 15; index++) { h.set({ beforeAdopt: () => true }); await h.idle(); }
    assert.equal(f.calls.length, count); assert.equal(h.render().props['data-workspace-dirty'], true);
  } finally { h.close(); }
});

test('a changed quote and uncommitted request rebase only on an explicit GET click, retaining the document until another explicit save', async () => {
  const f = await fixture(); let first = true; const transport = async (url, init = {}) => { if (init.method === 'PUT' && first) { first = false; f.calls.push({ url, init, method: 'PUT' }); throw Error('not dispatched'); } return f.request(url, init); };
  const h = panel(f, transport);
  try {
    await h.idle(); await h.click('상세 편집 구성 열기'); await h.click('작업 사진 3 위로'); await h.click('편집 구성 보관');
    const firstBody = f.calls.find(call => call.method === 'PUT').init.body; f.view.revision++; f.view.productVersion = '2026-10-16T00:00:06.000Z'; h.set({ view: plain(f.view) }); await h.idle();
    await h.click('보관 결과 확인'); assert.equal(h.button('같은 구성 다시 보관'), undefined); const count = f.calls.length;
    await h.click('최신 기준으로 보관 준비'); assert.equal(f.calls.length, count + 1); assert.equal(f.calls.at(-1).method, 'GET'); assert.equal(f.storage.size, 0);
    assert.equal(h.button('편집 구성 보관').props.disabled, false); await h.click('편집 구성 보관');
    const bodies = f.calls.filter(call => call.method === 'PUT').map(call => JSON.parse(call.init.body)); assert.equal(bodies.length, 2); assert.notEqual(bodies[0].requestId, bodies[1].requestId);
    assert.deepEqual(bodies[1].document, JSON.parse(firstBody).document); assert.equal(f.workspace.revision, 1);
  } finally { h.close(); }
});

test('a successful ACK completed during a hidden-stage ABA retains its receipt until explicit current verification', async () => {
  const f = await fixture(), gate = deferred(), entered = deferred(); const transport = async (url, init = {}) => { const response = await f.request(url, init); if (init.method === 'PUT') { entered.resolve(); await gate.promise; } return response; };
  const h = panel(f, transport);
  try {
    await h.idle(); await h.click('상세 편집 구성 열기'); h.button('편집 구성 보관').props.onClick(); await entered.promise;
    h.set({ stageActive: false }); await h.tick(); h.set({ stageActive: true }); await h.tick(); gate.resolve(); await h.idle();
    assert.equal(f.storage.size, 1); assert.equal(h.button('작업 사진을 선택 옵션 초안으로').props.disabled, true);
    await h.click('보관 결과 확인'); assert.equal(f.storage.size, 0); assert.equal(h.button('작업 사진을 선택 옵션 초안으로').props.disabled, false); assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1);
  } finally { gate.resolve(); h.close(); }
});
