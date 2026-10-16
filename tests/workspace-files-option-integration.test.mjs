import test from 'node:test';
import assert from 'node:assert/strict';
import { compositionFixture, panel as optionDetailPanel, plain, nodes } from './helpers/detail-editor-composition-fixture.mjs';

const child = h => nodes(h.render()).find(node => node.type?.name === 'DetailWorkspacePanel');
function attached(view) {
  return { ...plain(view), productVersion: new Date(Date.parse(view.productVersion) + 1000).toISOString(), inputFingerprint: '9'.repeat(64), imageKeys: [...view.imageKeys, 'owner/new-workspace-result.png'] };
}
test('a verified workspace pool attachment refreshes the parent without saving or changing option HTML/images', async () => {
  const f = await compositionFixture(), h = optionDetailPanel(f);
  try {
    await h.settle(); const workspace = child(h), before = plain(workspace.props.view), next = attached(before), html = h.control('선택 옵션 상세 HTML').props.value;
    workspace.props.onBusyChange(true); await h.flush();
    workspace.props.onFilesAttached(next); await h.flush();
    assert.deepEqual(plain(child(h).props.view), next); assert.deepEqual(plain(h.ordered()), [f.key]);
    assert.equal(h.control('선택 옵션 상세 HTML').props.value, html); assert.equal(h.render().props['data-workspace-dirty'], false);
    assert.ok(h.calls.every(call => call.method === 'GET')); workspace.props.onBusyChange(false); await h.flush();
  } finally { h.close(); }
});
test('a pool-attachment callback rejects quotation edits, missing/reordered/foreign keys and unchanged clocks', async () => {
  for (const mode of ['quote', 'removed', 'reordered', 'foreign', 'clock', 'context']) {
    const f = await compositionFixture(), h = optionDetailPanel(f);
    try {
      await h.settle(); const workspace = child(h), before = plain(workspace.props.view), next = attached(before);
      if (mode === 'quote') next.overrides.common.brand = 'changed';
      if (mode === 'removed') next.imageKeys.shift();
      if (mode === 'reordered') next.imageKeys.reverse();
      if (mode === 'foreign') next.imageKeys.push('other/result.png');
      if (mode === 'clock') next.productVersion = before.productVersion;
      if (mode === 'context') next.categoryContext.categoryPath = ['different'];
      workspace.props.onFilesAttached(next); await h.flush(); assert.deepEqual(plain(child(h).props.view), before, mode);
      assert.ok(h.calls.every(call => call.method === 'GET')); assert.equal(h.render().props['data-workspace-dirty'], false);
    } finally { h.close(); }
  }
});
test('old attachment callbacks cannot overwrite a dirty draft or survive stage/disabled/unmount transitions', async () => {
  for (const mode of ['dirty', 'stage', 'disabled', 'closed']) {
    const f = await compositionFixture(), h = optionDetailPanel(f);
    await h.settle(); const workspace = child(h), before = plain(workspace.props.view), next = attached(before);
    if (mode === 'dirty') h.html('<p>unsaved HTML</p>');
    if (mode === 'stage') { h.set({ stage: 'additional' }); await h.flush(); h.set({ stage: 'detail' }); await h.flush(); }
    if (mode === 'disabled') h.set({ disabled: true });
    if (mode === 'closed') h.close();
    workspace.props.onFilesAttached(next);
    if (mode !== 'closed') { await h.flush(); assert.deepEqual(plain(child(h).props.view), before); if (mode === 'dirty') assert.equal(h.control('선택 옵션 상세 HTML').props.value, '<p>unsaved HTML</p>'); h.close(); }
    else assert.equal(h.lateWrites, 0);
  }
});
