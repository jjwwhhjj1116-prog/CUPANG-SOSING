import test from 'node:test';
import assert from 'node:assert/strict';
import { companies, json, nodes, downloadUI } from './helpers/image-download-ui.mjs';
import { detailWorkspaceFixture } from './helpers/detail-workspace-api.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const signal = () => new AbortController().signal;
const writes = f => f.calls.filter(call => ['POST', 'PUT', 'PATCH'].includes(call.init.method));
const workspace = ui => nodes(ui.render()).find(node => node.type?.name === 'DetailWorkspacePanel');
const validation = f => f.api.load('app/quotation-save-validation.ts');

for (const company of companies) for (const lost of [false, true]) test(`a badge-bearing selected-option composite completes once after ${lost ? 'lost pool ACK and GET recovery' : 'confirmed pool append'} (${company.companyCode})`, async () => {
  const f = await detailWorkspaceFixture(company, { wire: true, excluded: true });
  try {
    const prepared = await f.prepare(), before = plain(prepared.view), sources = f.sourceRows(), objects = new Map(f.api.objects), start = f.calls.length, attempt = {};
    assert.ok(validation(f).currentSavedQuotationValidation(before, f.product.id));
    let dropped = false, attached;
    const request = async (url, init = {}) => {
      const response = await f.request(url, init);
      if (url.endsWith('/attachments') && init.method === 'POST') {
        assert.equal(response.status, 200); attached = await json(await f.api.route(f.qurl));
        assert.equal(attached.savedValidation, undefined, 'the actual committed pool invalidates derived input-check evidence');
        if (lost && !dropped) { dropped = true; throw Error('lost pool ACK'); }
      }
      return response;
    };
    if (lost) {
      await assert.rejects(f.runtime.helper.applyDetailComposite(prepared, attempt, signal(), request), /lost pool ACK/);
      assert.equal(attempt.pending, 'pool'); const count = writes(f).length, retained = f.retained();
      assert.equal(await f.runtime.helper.recoverDetailComposite(prepared, attempt, signal(), request), 'ready');
      assert.equal(writes(f).length, count); assert.equal(f.retained(), retained); assert.equal(attempt.completed, undefined);
    }
    const saved = await f.runtime.helper.applyDetailComposite(prepared, attempt, signal(), request);
    assert.deepEqual(plain(saved.imageKeys), [...before.imageKeys, attempt.key]);
    assert.equal(saved.revision, before.revision + 1); assert.deepEqual(plain(saved.overrides.common), before.overrides.common);
    for (const row of before.resolved.rows.filter(row => row.optionId && row.optionId !== f.optionId))
      assert.deepEqual(plain(saved.overrides.options[row.optionId]), before.overrides.options[row.optionId]);
    const oldRow = before.resolved.rows.find(row => row.optionId === f.optionId), newRow = saved.resolved.rows.find(row => row.optionId === f.optionId);
    for (const id of f.targets.detailImages.linked) assert.equal(newRow.fields[id].value, attempt.key);
    for (const id of f.targets.detailHtml.linked) assert.equal(newRow.fields[id].value, oldRow.fields[id].value);
    assert.equal(f.sourceRows(), sources); for (const [key, bytes] of objects) assert.deepEqual(f.api.objects.get(key), bytes);
    const calls = f.calls.slice(start);
    assert.equal(calls.filter(call => call.url === '/api/files' && call.init.method === 'POST').length, 1);
    assert.equal(calls.filter(call => call.url.endsWith('/attachments') && call.init.method === 'POST').length, 1);
    assert.equal(calls.filter(call => call.url.includes('/quotation-fields') && call.init.method === 'PUT').length, 1);
    const count = writes(f).length; assert.deepEqual(await f.runtime.helper.applyDetailComposite(prepared, attempt, signal(), request), saved);
    assert.equal(await f.runtime.helper.recoverDetailComposite(prepared, attempt, signal(), request), 'completed'); assert.equal(writes(f).length, count);
  } finally { f.api.close(); }
});

test('selected-option pool confirmation rejects retained, replacement and null badges before any quotation save', async () => {
  for (const mode of ['stale', 'replacement', 'null']) {
    const f = await detailWorkspaceFixture(companies[0], { wire: true, excluded: true });
    try {
      const prepared = await f.prepare(), attempt = {}, start = f.calls.length; let attached = false;
      const request = async (url, init = {}) => {
        const response = await f.request(url, init);
        if (url.endsWith('/attachments') && init.method === 'POST') attached = true;
        if (attached && url.includes('/quotation-fields') && !init.method) {
          const body = await response.json(); body.savedValidation = mode === 'null' ? null : plain(prepared.view.savedValidation);
          if (mode === 'replacement') {
            body.savedValidation.productVersion = body.productVersion; body.savedValidation.inputFingerprint = body.inputFingerprint;
            assert.ok(validation(f).currentSavedQuotationValidation(body, f.product.id), 'replacement looks current but is different evidence');
          }
          return Response.json(body);
        }
        return response;
      };
      await assert.rejects(f.runtime.helper.applyDetailComposite(prepared, attempt, signal(), request));
      assert.equal(attempt.pending, 'pool'); assert.equal(f.calls.slice(start).filter(call => call.init.method === 'PUT').length, 0);
      const count = writes(f).length; assert.equal(await f.runtime.helper.recoverDetailComposite(prepared, attempt, signal(), f.request), 'ready');
      assert.equal(writes(f).length, count);
    } finally { f.api.close(); }
  }
});

test('a real late quotation edit still blocks read recovery of a committed pool append', async () => {
  const f = await detailWorkspaceFixture(companies[1], { wire: true, excluded: true });
  try {
    const prepared = await f.prepare(), attempt = {};
    await assert.rejects(f.runtime.helper.applyDetailComposite(prepared, attempt, signal(), async (url, init = {}) => {
      const response = await f.request(url, init); if (url.endsWith('/attachments') && init.method === 'POST') throw Error('lost pool ACK'); return response;
    }), /lost pool ACK/);
    await f.set([{ optionId: f.optionId, fieldKey: f.targets.detailHtml.primary, value: '<p>다른 곳에서 수정한 HTML</p>' }]);
    const count = writes(f).length, retained = f.retained();
    await assert.rejects(f.runtime.helper.recoverDetailComposite(prepared, attempt, signal(), f.request));
    assert.equal(attempt.pending, 'pool'); assert.equal(writes(f).length, count); assert.equal(f.retained(), retained);
  } finally { f.api.close(); }
});

for (const company of companies) test(`actual option parent accepts badge invalidation after a pool-only append and keeps saved HTML/images (${company.companyCode})`, async () => {
  const f = await detailWorkspaceFixture(company, { wire: true, excluded: true }); let ui;
  try {
    const before = await f.view(); assert.ok(validation(f).currentSavedQuotationValidation(before, f.product.id));
    ui = downloadUI('app/components/option-image-editor.tsx', 'OptionImageEditor', { productId: f.product.id, optionId: f.optionId,
      profileId: before.categoryContext.profileId, version: before.productVersion, stage: 'detail' }, f.request);
    await ui.idle(); const child = workspace(ui), key = 'owner/confirmed-workspace-result.png';
    assert.deepEqual(plain(child.props.view), before);
    await f.api.bindings.FILES.put(key, f.api.objects.get(f.selectedKeys[0]), { httpMetadata: { contentType: 'image/png' } });
    await json(await f.request(f.base + '/attachments', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, role: null, expectedVersion: before.productVersion, expectedContentRevision: before.contentRevision }) }));
    const next = await f.view(), count = writes(f).length; assert.equal(next.savedValidation, undefined);
    child.props.onBusyChange(true); ui.render(); child.props.onFilesAttached(next); ui.render(); child.props.onBusyChange(false); await ui.idle();
    assert.deepEqual(plain(workspace(ui).props.view), next); assert.equal(ui.saved.length, 1); assert.equal(writes(f).length, count);
    assert.deepEqual(plain(next.overrides), before.overrides); assert.deepEqual(plain(next.resolved), before.resolved);
    assert.equal(nodes(ui.render()).find(node => node.props?.['aria-label'] === '선택 옵션 이미지 편집').props['data-workspace-dirty'], false);
  } finally { ui?.close(); f.api.close(); }
});

test('actual parent rejects stale, replacement and null validation on an otherwise exact committed append', async () => {
  const f = await detailWorkspaceFixture(companies[0], { wire: true, excluded: true }), parents = [];
  try {
    const before = await f.view(), key = 'owner/confirmed-workspace-result.png';
    for (const mode of ['stale', 'replacement', 'null']) {
      const ui = downloadUI('app/components/option-image-editor.tsx', 'OptionImageEditor', { productId: f.product.id, optionId: f.optionId,
        profileId: before.categoryContext.profileId, version: before.productVersion, stage: 'detail' }, f.request);
      parents.push({ mode, ui }); await ui.idle(); assert.deepEqual(plain(workspace(ui).props.view), before);
    }
    await f.api.bindings.FILES.put(key, f.api.objects.get(f.selectedKeys[0]), { httpMetadata: { contentType: 'image/png' } });
    await json(await f.request(f.base + '/attachments', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, role: null, expectedVersion: before.productVersion, expectedContentRevision: before.contentRevision }) }));
    const after = await f.view(), count = writes(f).length;
    for (const { mode, ui } of parents) {
      const next = plain(after); next.savedValidation = mode === 'null' ? null : plain(before.savedValidation);
      if (mode === 'replacement') {
        next.savedValidation.productVersion = next.productVersion; next.savedValidation.inputFingerprint = next.inputFingerprint;
        assert.ok(validation(f).currentSavedQuotationValidation(next, f.product.id));
      }
      workspace(ui).props.onFilesAttached(next); await ui.idle();
      assert.equal(ui.saved.length, 0, mode); assert.deepEqual(plain(workspace(ui).props.view), before, mode); assert.equal(writes(f).length, count);
    }
  } finally { parents.forEach(({ ui }) => ui.close()); f.api.close(); }
});
