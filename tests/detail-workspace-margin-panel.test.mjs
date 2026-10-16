import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, panel, runtime, nodes, text, plain, deferred } from './helpers/detail-workspace.mjs';

const label = '편집 HTML 사진 간격 (px)', composite = h => nodes(h.render()).find(node => node.type?.name === 'DetailWorkspaceCompositePanel');
async function stored(f, h) { await h.idle(); await h.click('상세 편집 구성 열기'); await h.click('편집 구성 보관'); }
function margin(h, value) { const input = h.control(label); assert.ok(input && !input.props.disabled); input.props.onChange({ target: { value } }); h.render(); }

test('photo spacing changes only the local generated HTML until explicit workspace storage, then reopens its exact saved value', async () => {
  const f = await fixture(), h = panel(f), before = JSON.stringify(f.view);
  try {
    await stored(f, h); assert.equal(h.control(label).props.value, '0'); assert.equal(h.control(label).props.min, 0); assert.equal(h.control(label).props.max, 200);
    const photos = plain(f.workspace.document.photos), writes = f.calls.filter(call => call.method === 'PUT').length;
    margin(h, '24'); assert.match(h.control('편집용 생성 HTML').props.value, /margin:0 0 24px 0/); assert.equal(f.workspace.document.imageMargin, 0);
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, writes); assert.equal(h.render().props['data-workspace-dirty'], true);
    assert.equal(composite(h).props.sourceCurrent, false); assert.equal(h.button('작업 사진을 선택 옵션 초안으로').props.disabled, true);
    await h.click('편집 구성 보관'); assert.equal(f.workspace.document.imageMargin, 24); assert.deepEqual(f.workspace.document.photos, photos); assert.equal(JSON.stringify(f.view), before);
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, writes + 1); assert.equal(h.adopted.length, 0); assert.equal(h.render().props['data-workspace-dirty'], false);
    await h.click('현재 구성 닫기'); await h.click('상세 편집 구성 열기'); assert.equal(h.control(label).props.value, '24');
    margin(h, '200'); await h.click('편집 구성 보관'); assert.equal(f.workspace.document.imageMargin, 200);
    margin(h, '0'); await h.click('편집 구성 보관'); assert.equal(f.workspace.document.imageMargin, 0);
    assert.match(text(h.render()), /최종 합친 이미지는 간격 없이 저장/); assert.equal(JSON.stringify(f.view), before);
  } finally { h.close(); }
});

test('empty, fractional, signed, exponential and out-of-range spacing stays visible and blocks save/adopt/editor/composite without silently clamping', async () => {
  for (const value of ['', '1.5', '-1', '201', '1e2', 'NaN', ' 8']) {
    const f = await fixture(), h = panel(f);
    try {
      await stored(f, h); const writes = f.calls.filter(call => call.method === 'PUT').length;
      const save = h.button('편집 구성 보관').props.onClick, adopt = h.button('작업 사진을 선택 옵션 초안으로').props.onClick, edit = h.button('작업 사진 2 편집').props.onClick;
      const previous = h.control('편집용 생성 HTML').props.value; margin(h, value);
      assert.equal(h.control(label).props.value, value); assert.equal(h.control(label).props['aria-invalid'], true); assert.equal(h.control('편집용 생성 HTML').props.value, previous);
      assert.equal(h.button('편집 구성 보관').props.disabled, true); assert.equal(h.button('작업 사진을 선택 옵션 초안으로').props.disabled, true); assert.equal(composite(h).props.beforeApply(), false);
      save(); adopt(); edit(); await h.idle(); assert.equal(f.calls.filter(call => call.method === 'PUT').length, writes); assert.equal(h.adopted.length, 0);
      assert.ok(!nodes(h.render()).some(node => node.type?.name === 'FreeImageTranslationPanel')); assert.match(text(h.render()), /0~200 사이의 정수/);
      margin(h, '16'); assert.equal(h.control(label).props['aria-invalid'], false); await h.click('편집 구성 보관'); assert.equal(f.workspace.document.imageMargin, 16);
    } finally { h.close(); }
  }
});

test('retained spacing callbacks reject a later workspace edit, disabled/stage ABA and changed source views', async () => {
  for (const mode of ['later-draft', 'disabled-aba', 'stage-aba', 'stale']) {
    const f = await fixture(), h = panel(f);
    try {
      await stored(f, h); const callback = h.control(label).props.onChange;
      if (mode === 'later-draft') margin(h, '10');
      if (mode === 'disabled-aba') { h.set({ disabled: true }); await h.tick(); h.set({ disabled: false }); await h.tick(); }
      if (mode === 'stage-aba') { h.set({ stageActive: false }); await h.tick(); h.set({ stageActive: true }); await h.tick(); }
      if (mode === 'stale') { const view = plain(f.view); view.revision++; h.set({ view }); await h.tick(); }
      const current = h.control(label).props.value; callback({ target: { value: '99' } }); await h.idle(); assert.equal(h.control(label).props.value, current, mode);
      assert.equal(f.workspace.document.imageMargin, 0); assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1);
    } finally { h.close(); }
  }
});

test('workspace I/O, photo editing and composing synchronously lock old spacing handlers without blocking their own completion', async () => {
  for (const mode of ['editor', 'composite', 'store']) {
    const f = await fixture(), hold = deferred(), entered = deferred(); let paused = false;
    const transport = async (url, init = {}) => { if (paused && init.method === 'PUT') { entered.resolve(); await hold.promise; } return f.request(url, init); };
    const h = panel(f, transport);
    try {
      await stored(f, h); const callback = h.control(label).props.onChange;
      if (mode === 'editor') h.button('작업 사진 2 편집').props.onClick();
      if (mode === 'composite') composite(h).props.onBusyChange(true);
      if (mode === 'store') { margin(h, '12'); paused = true; h.button('편집 구성 보관').props.onClick(); await entered.promise; }
      callback({ target: { value: '80' } }); await h.tick(); assert.equal(h.control(label).props.disabled, true); assert.equal(h.control(label).props.value, mode === 'store' ? '12' : '0');
      if (mode === 'composite') composite(h).props.onBusyChange(false);
      if (mode === 'store') { hold.resolve(); await h.idle(); assert.equal(f.workspace.document.imageMargin, 12); }
      assert.equal(h.adopted.length, 0);
    } finally { hold.resolve(); h.close(); }
  }
});

test('unknown storage ACK retains the exact reviewed spacing across reload and GET-only recovery without another PUT', async () => {
  const f = await fixture(); let lose = false;
  const transport = async (url, init = {}) => { const reply = await f.request(url, init); if (lose && init.method === 'PUT') { lose = false; return Response.json({ error: 'lost ACK' }, { status: 503 }); } return reply; };
  let h = panel(f, transport);
  try {
    await stored(f, h); margin(h, '31'); lose = true; await h.click('편집 구성 보관'); assert.equal(h.control(label).props.disabled, true); assert.equal(f.workspace.document.imageMargin, 31);
    h.close(); h = panel(f, transport); await h.idle(); assert.equal(h.control(label).props.value, '31'); assert.equal(h.control(label).props.disabled, true);
    const writes = f.calls.filter(call => call.method === 'PUT').length, before = f.calls.length; await h.click('보관 결과 확인');
    assert.equal(f.calls.length, before + 1); assert.equal(f.calls.at(-1).method, 'GET'); assert.equal(f.calls.filter(call => call.method === 'PUT').length, writes);
    assert.equal(h.control(label).props.value, '31'); assert.equal(h.control(label).props.disabled, false); assert.equal(h.adopted.length, 0);
    const r = runtime(f.request); assert.equal(f.workspace.document.generatedHtml, r.model.generateDetailWorkspaceHtml(f.workspace.document.photos, 31));
  } finally { h.close(); }
});
