import test from 'node:test';
import assert from 'node:assert/strict';
import { compositionFixture, panel, nodes, plain } from './helpers/detail-editor-composition-fixture.mjs';

const child = h => nodes(h.render()).find(node => node.type?.name === 'DetailWorkspacePanel');
function committed(before) {
  const next = plain(before), key = 'owner/workspace-final.png'; next.revision++;
  next.productVersion = new Date(Date.parse(before.productVersion) + 1000).toISOString(); next.updatedAt = next.productVersion;
  next.inputFingerprint = 'd'.repeat(64); next.imageKeys.push(key);
  for (const row of next.resolved.rows) {
    const own = row.optionId === null ? next.overrides.common : next.overrides.options[row.optionId];
    for (const field of ['detailImages', 'wire-detail-images']) { own[field] = key; row.fields[field].value = key; }
    for (const field of ['detailHtml', 'wire-detail-html']) { own[field] = ''; row.fields[field].value = ''; }
  }
  return next;
}

test('explicit all-option composite completion refreshes selected final pixels and blank HTML without adoption, attachment, or another quotation write', async () => {
  const f = await compositionFixture(), manual = '<p>selected saved manual HTML &amp;</p>';
  for (const field of ['detailHtml', 'wire-detail-html']) {
    f.view.overrides.options.red[field] = manual;
    f.view.resolved.rows.find(row => row.optionId === 'red').fields[field].value = manual;
    f.view.automatic.rows.find(row => row.optionId === 'red').fields[field].value = manual;
  }
  const h = panel(f);
  try {
    await h.settle(); const workspace = child(h), before = plain(workspace.props.view), next = committed(before);
    assert.equal(h.control('선택 옵션 상세 HTML').props.value, manual);
    workspace.props.onBusyChange(true); await h.flush(); workspace.props.onCompositeSaved(next); await h.flush();
    assert.deepEqual(plain(child(h).props.view), next); assert.deepEqual(plain(h.ordered()), ['owner/workspace-final.png']);
    assert.equal(h.control('선택 옵션 상세 HTML').props.value, ''); assert.equal(h.render().props['data-workspace-dirty'], false);
    assert.equal(h.saved, 1); assert.ok(h.calls.every(call => call.method === 'GET')); assert.equal(next.resolved.rows.find(row => row.optionId === 'blue').included, false);
    assert.ok(next.resolved.rows.every(row => row.fields.detailHtml.value === '' && row.fields['wire-detail-html'].value === ''));
    workspace.props.onBusyChange(false); await h.flush();
  } finally { h.close(); }
});

test('composite callback rejects clocks/category/pool mismatches without treating an attachment-only response as a detail save', async () => {
  for (const mode of ['revision', 'content', 'options', 'context', 'unchanged-clock', 'reordered-pool', 'foreign-pool', 'attachment-only']) {
    const f = await compositionFixture(), h = panel(f);
    try {
      await h.settle(); const workspace = child(h), before = plain(workspace.props.view), next = committed(before);
      if (mode === 'revision' || mode === 'attachment-only') next.revision = before.revision;
      if (mode === 'content') next.contentRevision++;
      if (mode === 'options') next.optionRevision++;
      if (mode === 'context') next.categoryContext.categoryPath = ['different'];
      if (mode === 'unchanged-clock') next.updatedAt = next.productVersion = before.productVersion;
      if (mode === 'reordered-pool') next.imageKeys.reverse();
      if (mode === 'foreign-pool') next.imageKeys.push('foreign/result.png');
      workspace.props.onCompositeSaved(next); await h.flush(); assert.deepEqual(plain(child(h).props.view), before, mode); assert.equal(h.saved, 0);
      assert.ok(h.calls.every(call => call.method === 'GET')); assert.equal(h.render().props['data-workspace-dirty'], false);
    } finally { h.close(); }
  }
});

test('a stale all-option callback cannot overwrite a dirty parent or survive stage/disabled ABA, version changes or unmount', async () => {
  for (const mode of ['dirty', 'stage-aba', 'disabled-aba', 'version', 'unmount']) {
    const f = await compositionFixture(), h = panel(f); await h.settle(); const workspace = child(h), before = plain(workspace.props.view), next = committed(before);
    if (mode === 'dirty') h.html('<p>unsaved parent HTML</p>');
    if (mode === 'stage-aba') { h.set({ stage: 'additional' }); await h.flush(); h.set({ stage: 'detail' }); await h.flush(); }
    if (mode === 'disabled-aba') { h.set({ disabled: true }); await h.flush(); h.set({ disabled: false }); await h.flush(); }
    if (mode === 'version') { h.set({ version: '2026-10-16T23:00:00.000Z' }); await h.flush(); }
    if (mode === 'unmount') h.close();
    workspace.props.onCompositeSaved(next);
    if (mode === 'unmount') assert.equal(h.lateWrites, 0); else {
      await h.flush(); assert.deepEqual(plain(child(h).props.view), before, mode); assert.equal(h.saved, 0);
      if (mode === 'dirty') assert.equal(h.control('선택 옵션 상세 HTML').props.value, '<p>unsaved parent HTML</p>');
      h.close();
    }
  }
});
