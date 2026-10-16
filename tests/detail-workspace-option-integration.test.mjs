import test from 'node:test';
import assert from 'node:assert/strict';
import { compositionFixture, panel, nodes, plain } from './helpers/detail-editor-composition-fixture.mjs';

const child = h => nodes(h.render()).find(node => typeof node.type === 'function' && node.type.name === 'DetailWorkspacePanel');

test('independent detail workspace opens no request automatically and stages only ordered photos before explicit quotation save', async () => {
  const f = await compositionFixture(), before = plain(f.view), h = panel(f);
  try {
    await h.settle(); const workspace = child(h); assert.ok(workspace); assert.equal(workspace.props.disabled, false); assert.equal(workspace.props.beforeAdopt(), true);
    assert.ok(h.calls.every(call => !call.url.includes('/detail-workspace') && call.method === 'GET'));
    workspace.props.onAdopt(['owner/two.png', 'owner/one.png']); await h.settle();
    assert.deepEqual(plain(h.ordered()), ['owner/two.png', 'owner/one.png']); assert.deepEqual(plain(f.view), before);
    assert.equal(h.control('선택 옵션 상세 HTML').props.value, before.resolved.rows.find(row => row.optionId === 'red').fields['wire-detail-html'].value);
    assert.ok(h.calls.every(call => call.method === 'GET')); assert.equal(child(h).props.disabled, true);
    await h.click('선택 옵션 이미지 저장'); const writes = h.calls.filter(call => call.method !== 'GET'); assert.equal(writes.length, 1);
    const changes = JSON.parse(writes[0].init.body).changes;
    assert.deepEqual(plain(changes), ['detailImages', 'wire-detail-images'].map(fieldKey => ({ optionId: 'red', fieldKey, value: 'owner/two.png\nowner/one.png' })));
    for (const id of ['detailHtml', 'wire-detail-html', 'altText']) assert.equal(f.view.overrides.options.red[id], before.overrides.options.red[id]);
    assert.deepEqual(plain(f.view.overrides.common), before.overrides.common); assert.deepEqual(plain(f.view.overrides.options.blue), before.overrides.options.blue);
  } finally { h.close(); }
});

test('workspace I/O synchronously locks peer photo/HTML/composite actions without blocking its own final adoption', async () => {
  const f = await compositionFixture(), h = panel(f);
  try {
    await h.settle(); const workspace = child(h), remove = h.button('상세 이미지 1 선택 제거').props.onClick, html = h.control('선택 옵션 상세 HTML').props.onChange;
    workspace.props.onBusyChange(true); remove(); html({ target: { value: 'late peer edit' } }); const tree = h.render();
    assert.equal(tree.props['data-workspace-saving'], true); assert.equal(h.control('선택 옵션 상세 HTML').props.disabled, true);
    assert.deepEqual(plain(h.ordered()), [f.key]); assert.equal(workspace.props.beforeAdopt(), true);
    const composite = nodes(tree).find(node => typeof node.type === 'function' && node.type.name === 'DetailImageCompositePanel'); assert.equal(composite.props.disabled, true);
    workspace.props.onAdopt(['owner/one.png']); workspace.props.onBusyChange(false); await h.settle();
    assert.deepEqual(plain(h.ordered()), ['owner/one.png']); assert.ok(h.calls.every(call => call.method === 'GET'));
  } finally { h.close(); }
});

test('an old workspace callback never overwrites a parent HTML draft or survives hidden-stage ABA and disable', async () => {
  for (const mode of ['draft', 'stage-aba', 'disabled']) {
    const f = await compositionFixture(), h = panel(f);
    try {
      await h.settle(); const workspace = child(h);
      if (mode === 'draft') h.html('<p>parent unsaved HTML</p>');
      else if (mode === 'stage-aba') { h.set({ stage: 'additional' }); await h.flush(); h.set({ stage: 'detail' }); await h.flush(); }
      else h.set({ disabled: true });
      assert.equal(workspace.props.beforeAdopt(), false); workspace.props.onAdopt(['owner/one.png']); await h.flush();
      assert.deepEqual(plain(h.ordered()), [f.key]); assert.equal(h.control('선택 옵션 상세 HTML').props.value, mode === 'draft' ? '<p>parent unsaved HTML</p>' : '');
      assert.ok(h.calls.every(call => call.method === 'GET'));
    } finally { h.close(); }
  }
});

test('workspace adoption preserves protected banner positions and rejects foreign or unproven source keys', async () => {
  const f = await compositionFixture(); f.view.protectedDetailImageKeys = [f.key]; const h = panel(f);
  try {
    await h.settle(); const workspace = child(h);
    for (const keys of [[], ['owner/one.png'], [f.key, 'other/foreign.png'], [f.key, 'owner/missing.png'], [f.key, f.key]]) {
      workspace.props.onAdopt(keys); await h.settle(); assert.deepEqual(plain(h.ordered()), [f.key]); assert.equal(h.render().props['data-workspace-dirty'], false);
    }
    workspace.props.onAdopt([f.key, 'owner/one.png']); await h.settle(); assert.deepEqual(plain(h.ordered()), [f.key, 'owner/one.png']);
    assert.ok(h.calls.every(call => call.method === 'GET'));
  } finally { h.close(); }
});

test('a legacy view without banner role evidence and unmounted workspace callbacks cannot adopt or mutate state', async () => {
  const f = await compositionFixture(); delete f.view.protectedDetailImageKeys; const h = panel(f);
  await h.settle(); const workspace = child(h); assert.equal(workspace.props.beforeAdopt(), false);
  workspace.props.onAdopt(['owner/one.png']); await h.settle(); assert.deepEqual(plain(h.ordered()), [f.key]);
  h.close(); workspace.props.onBusyChange(true); workspace.props.onAdopt(['owner/one.png']); workspace.props.onBusyChange(false); assert.equal(h.lateWrites, 0);
});
