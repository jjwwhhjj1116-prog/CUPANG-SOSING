import test from 'node:test';
import assert from 'node:assert/strict';
import { compositionFixture, panel, nodes, text, plain, deferred, reopenComposition } from './helpers/detail-editor-composition-fixture.mjs';

const imagesOnly = '저장 전 개별 사진으로 편집';

test('explicit photo/HTML reopening stages literal HTML atomically and only an explicit save PUTs both exact linked fields', async () => {
  for (const html of ['', ' \t\r\n ', '<script>window.mustNotRun=1</script>\r\n<p>원문 &amp; 공백 </p>']) {
    const f = await compositionFixture({ html }), before = plain(f.view);
    f.composition.html.rawOption = { detailHtml: null, 'wire-detail-html': null };
    const h = panel(f);
    try {
      await h.settle(); assert.deepEqual(plain(h.ordered()), [f.key]); await h.click(reopenComposition);
      assert.deepEqual(plain(h.ordered()), ['owner/one.png', 'owner/two.png']);
      assert.equal(h.control('선택 옵션 상세 HTML').props.value, html); assert.equal(h.render().props['data-workspace-dirty'], true);
      assert.equal(h.render().props['data-workspace-saving'], false); assert.deepEqual(plain(f.view), before);
      assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
      assert.ok(nodes(h.render()).every(node => node.type !== 'script' && !node.props?.dangerouslySetInnerHTML), 'HTML is only editable text');
      await h.click('선택 옵션 이미지 저장'); assert.equal(h.saved, 1);
      const writes = h.calls.filter(call => call.method === 'PUT'); assert.equal(writes.length, 1);
      const changes = JSON.parse(writes[0].init.body).changes;
      assert.equal(changes.length, 4); assert.ok(changes.every(change => change.optionId === 'red'));
      for (const field of ['detailHtml', 'wire-detail-html']) {
        assert.equal(changes.find(change => change.fieldKey === field)?.value, html);
        assert.equal(f.view.overrides.options.red[field], html, 'historical null is restored as a new literal manual draft');
      }
      for (const field of ['detailImages', 'wire-detail-images']) assert.equal(f.view.overrides.options.red[field], 'owner/one.png\nowner/two.png');
      assert.equal(f.view.overrides.options.red.altText, before.overrides.options.red.altText);
      assert.equal(f.view.overrides.options.red.additionalImages, before.overrides.options.red.additionalImages);
      assert.deepEqual(plain(f.view.overrides.common), before.overrides.common); assert.deepEqual(plain(f.view.overrides.options.blue), before.overrides.options.blue);
      assert.equal(h.render().props['data-workspace-dirty'], false);
    } finally { h.close(); }
  }
});

test('the legacy images-only action remains separate and does not import historical HTML', async () => {
  const f = await compositionFixture({ html: '<p>이 경로에서는 복원하지 않음</p>' }), h = panel(f);
  try {
    await h.settle(); await h.click(imagesOnly);
    assert.deepEqual(plain(h.ordered()), ['owner/one.png', 'owner/two.png']); assert.equal(h.control('선택 옵션 상세 HTML').props.value, '');
    assert.equal(f.compositionReads, 0); assert.ok(h.calls.every(call => call.method === 'GET'));
    await h.click('선택 옵션 이미지 저장');
    const changes = JSON.parse(h.calls.find(call => call.method === 'PUT').init.body).changes;
    assert.ok(changes.every(change => ['detailImages', 'wire-detail-images'].includes(change.fieldKey)));
  } finally { h.close(); }
});

test('missing snapshot, invalid aliases and damaged files leave both current image and HTML untouched with no fallback', async () => {
  for (const kind of ['missing', 'aliases', 'file', 'second-html']) {
    const f = await compositionFixture(), before = JSON.stringify(f.view);
    if (kind === 'file') f.objects.set('owner/two.png', Buffer.from('broken image'));
    const transport = async (url, init) => {
      const response = await f.request(url, init); if (!url.includes('/detail-save?')) return response;
      if (kind === 'missing') return Response.json({ error: '저장된 HTML이 없습니다.' }, { status: 404 });
      const reply = f.reply();
      if (kind === 'aliases') delete reply.composition.html.rawCommon.detailHtml;
      if (kind === 'second-html' && f.compositionReads === 2) reply.composition.html.effective += 'changed';
      return Response.json(reply);
    };
    const h = panel(f, transport);
    try {
      await h.settle(); await h.click(reopenComposition);
      assert.deepEqual(plain(h.ordered()), [f.key], kind); assert.equal(h.control('선택 옵션 상세 HTML').props.value, '', kind);
      assert.equal(h.render().props['data-workspace-dirty'], false, kind); assert.equal(JSON.stringify(f.view), before);
      assert.ok(nodes(h.render()).some(node => node.props?.role === 'alert'), kind); assert.ok(h.calls.every(call => call.method === 'GET'));
      if (kind === 'missing' || kind === 'aliases') assert.equal(h.calls.filter(call => call.url.includes('/api/files/')).length, 0, 'no images-only fallback');
    } finally { h.close(); }
  }
});

test('existing HTML or other-stage image drafts block the new action and stale captured clicks cannot overwrite them', async () => {
  const f = await compositionFixture(), h = panel(f);
  try {
    await h.settle(); const stale = h.button(reopenComposition).props.onClick;
    h.html('<p>아직 저장하지 않은 내용</p>'); assert.equal(h.button(reopenComposition).props.disabled, true);
    const count = h.calls.length; stale(); await h.settle(); assert.equal(h.calls.length, count);
    assert.equal(h.control('선택 옵션 상세 HTML').props.value, '<p>아직 저장하지 않은 내용</p>');
    h.set({ stage: 'additional' }); await h.flush(); await h.click('추가 이미지 선택 비우기');
    h.set({ stage: 'detail' }); await h.flush(); assert.equal(h.button(reopenComposition).props.disabled, true);
    stale(); await h.settle(); assert.equal(f.compositionReads, 0); assert.ok(h.calls.every(call => call.method === 'GET'));
    assert.equal(h.control('선택 옵션 상세 HTML').props.value, '<p>아직 저장하지 않은 내용</p>');
  } finally { h.close(); }
});

test('duplicate saved positions and literal HTML all stage, while explicit save waits for the user to remove the duplicate position', async () => {
  const f = await compositionFixture({ duplicate: true, html: ' \n exact ' });
  f.view.resolved.schema.fields.filter(field => field.type === 'images' && field.id !== 'additionalImages').forEach(field => { field.maxItems = 2; });
  const h = panel(f);
  try {
    await h.settle(); await h.click(reopenComposition);
    assert.deepEqual(plain(h.ordered()), ['owner/one.png', 'owner/two.png', 'owner/one.png']);
    assert.equal(h.control('선택 옵션 상세 HTML').props.value, ' \n exact '); assert.equal(h.button('선택 옵션 이미지 저장').props.disabled, true);
    assert.ok(h.calls.every(call => call.method === 'GET')); await h.click('상세 이미지 3 선택 제거'); await h.click('선택 옵션 이미지 저장');
    assert.equal(h.calls.filter(call => call.method === 'PUT').length, 1); assert.equal(f.view.overrides.options.red.detailHtml, ' \n exact ');
  } finally { h.close(); }
});

test('double clicks start one read operation and expose parent busy then dirty markers without a write', async () => {
  const f = await compositionFixture(), gate = deferred(), entered = deferred(); let held = false;
  const transport = async (url, init) => { const response = await f.request(url, init); if (!held && url.includes('/detail-save?')) { held = true; entered.resolve(); await gate.promise; } return response; };
  const h = panel(f, transport);
  try {
    await h.settle(); const click = h.button(reopenComposition).props.onClick; click(); click(); await entered.promise;
    assert.equal(h.render().props['data-workspace-saving'], true); assert.equal(h.render().props['data-workspace-dirty'], false);
    assert.equal(h.button(reopenComposition).props.disabled, true); assert.equal(f.compositionReads, 1);
    gate.resolve(); await h.settle(); assert.equal(f.compositionReads, 2);
    assert.equal(h.render().props['data-workspace-saving'], false); assert.equal(h.render().props['data-workspace-dirty'], true);
    assert.ok(h.calls.every(call => call.method === 'GET'));
  } finally { gate.resolve(); h.close(); }
});

test('active, disabled, version and refresh ABA transitions reject delayed composition and stale click closures', async () => {
  for (const kind of ['active', 'disabled', 'version', 'refreshToken']) {
    const f = await compositionFixture(), gate = deferred(), entered = deferred(); let held = false;
    const transport = async (url, init) => { const response = await f.request(url, init); if (!held && url.includes('/detail-save?') && f.compositionReads === 2) { held = true; entered.resolve(); await gate.promise; } return response; };
    const h = panel(f, transport);
    try {
      await h.settle(); const oldClick = h.button(reopenComposition).props.onClick; h.start(reopenComposition); await entered.promise;
      const original = h.props[kind], other = typeof original === 'boolean' ? !original : kind === 'version' ? '2026-10-16T00:00:00.000Z' : 'next';
      h.set({ [kind]: other }); await h.flush(); h.set({ [kind]: original }); await h.flush(); gate.resolve(); await h.settle();
      assert.equal(h.render().props['data-workspace-dirty'], false, kind); assert.deepEqual(plain(h.ordered()), [f.key], kind);
      assert.equal(h.control('선택 옵션 상세 HTML').props.value, '', kind);
      const count = h.calls.length; oldClick(); await h.settle(); assert.equal(h.calls.length, count, kind); assert.ok(h.calls.every(call => call.method === 'GET'));
    } finally { gate.resolve(); h.close(); }
  }
});

test('option/profile/product/stage changes and unmount cannot populate another editor from an in-flight composition', async () => {
  for (const kind of ['optionId', 'profileId', 'productId', 'stage', 'unmount']) {
    const f = await compositionFixture(), gate = deferred(), entered = deferred(); let held = false;
    const transport = async (url, init) => { const response = await f.request(url, init); if (!held && url.startsWith('/api/files/')) { held = true; entered.resolve(); await gate.promise; } return response; };
    const h = panel(f, transport);
    try {
      await h.settle(); h.start(reopenComposition); await entered.promise;
      if (kind === 'unmount') h.close();
      else { h.set({ [kind]: kind === 'optionId' ? 'blue' : kind === 'stage' ? 'additional' : 'different' }); await h.flush(); }
      gate.resolve(); await new Promise(resolve => setImmediate(resolve));
      if (kind !== 'unmount') { await h.settle(); assert.equal(h.render().props['data-workspace-dirty'], false, kind); }
      assert.equal(h.lateWrites, 0, kind); assert.ok(h.calls.every(call => call.method === 'GET'));
    } finally { gate.resolve(); if (kind !== 'unmount') h.close(); }
  }
});

test('an uncertain explicit save blocks reopening and reconciles by GET without another PUT or lost HTML', async () => {
  const f = await compositionFixture({ html: ' \r\n보관할 원문 ' }); let fault = true;
  f.afterPut = view => { if (fault) { fault = false; return Response.json({ error: '응답이 유실되었습니다.' }, { status: 503 }); } return Response.json(view); };
  const h = panel(f);
  try {
    await h.settle(); const oldReopen = h.button(reopenComposition).props.onClick; await h.click(reopenComposition); await h.click('선택 옵션 이미지 저장');
    assert.equal(h.calls.filter(call => call.method === 'PUT').length, 1); assert.equal(h.button(reopenComposition).props.disabled, true);
    assert.ok(text(h.render()).includes('이미지 저장 결과 확인')); const count = h.calls.length;
    oldReopen(); await h.settle(); assert.equal(h.calls.length, count, 'pending write cannot reopen or replace the draft');
    await h.click('이미지 저장 결과 확인'); assert.equal(h.calls.filter(call => call.method === 'PUT').length, 1);
    assert.equal(h.saved, 1); assert.equal(h.render().props['data-workspace-dirty'], false);
    assert.equal(f.view.overrides.options.red.detailHtml, ' \r\n보관할 원문 '); assert.equal(f.view.overrides.options.red['wire-detail-html'], ' \r\n보관할 원문 ');
  } finally { h.close(); }
});
