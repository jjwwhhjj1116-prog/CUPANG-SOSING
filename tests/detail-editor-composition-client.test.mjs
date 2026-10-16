import test from 'node:test';
import assert from 'node:assert/strict';
import { compositionFixture, loadClient, plain, selection } from './helpers/detail-editor-composition-fixture.mjs';

const signal = () => new AbortController().signal;
const prepare = (f, request = f.request, selected = selection(f), abort = signal()) => loadClient(request).helper.prepareSavedDetailComposition(selected, abort, request);

test('composition preparation preserves literal HTML, blank/whitespace and raw nulls, reads all proofs, and never writes', async () => {
  for (const html of ['', ' \t\r\n ', '<script>window.noExecution=1</script>\r\n<p> &amp; 한국어 </p>']) {
    const f = await compositionFixture({ html, duplicate: true }), before = JSON.stringify(f.view), expected = plain(f.composition);
    const result = await prepare(f);
    assert.equal(result.composition.html.effective, html); assert.deepEqual(plain(result.composition), expected);
    assert.equal(result.composition.html.rawCommon.detailHtml, null); assert.equal(result.composition.html.rawCommon['wire-detail-html'], '');
    assert.deepEqual(plain(result.keys), ['owner/one.png', 'owner/two.png', 'owner/one.png']);
    assert.equal(result.inputs.origin.productId, 'product'); assert.equal(result.inputs.origin.sourceOptionId, 'red');
    assert.equal(JSON.stringify(f.view), before); assert.equal(f.compositionReads, 2);
    assert.equal(f.calls.filter(call => call.url.startsWith('/api/files/owner/one.png')).length, 1);
    const query = new URL(f.calls[0].url, 'https://app.test');
    assert.equal(query.searchParams.get('editor'), 'saved-composition-v1'); assert.equal(query.searchParams.get('optionId'), 'red'); assert.equal(query.searchParams.get('profileId'), 'profile');
    assert.ok(f.calls.every(call => call.method === 'GET' && call.cache === 'no-store' && call.signal instanceof AbortSignal));
  }
});

test('missing or corrupt composition fails without falling back to images-only or generating HTML', async () => {
  for (const kind of ['missing', 'null', 'format', 'extra-policy', 'source-extra-company', 'input-origin', 'raw-null-map', 'raw-alias', 'effective-null']) {
    const f = await compositionFixture(), request = async (url, init) => {
      const response = await f.request(url, init); if (!url.includes('/detail-save?')) return response;
      const reply = f.reply();
      if (kind === 'missing') return Response.json({ error: '구성이 없습니다.', code: 'DETAIL_COMPOSITION_MISSING' }, { status: 404 });
      if (kind === 'null') reply.composition = null;
      if (kind === 'format') reply.composition.format = 'saved-detail-inputs-v1';
      if (kind === 'extra-policy') reply.composition.editorPolicy = 'legacy';
      if (kind === 'source-extra-company') reply.source.company = { code: 'A01464742', name: '와이홉' };
      if (kind === 'input-origin') reply.composition.inputs.origin.productId = 'foreign-product';
      if (kind === 'raw-null-map') reply.composition.html.rawOption = null;
      if (kind === 'raw-alias') delete reply.composition.html.rawCommon.detailHtml;
      if (kind === 'effective-null') reply.composition.html.effective = null;
      return Response.json(reply);
    };
    const before = JSON.stringify(f.view); await assert.rejects(prepare(f, request), undefined, kind);
    assert.equal(f.calls.length, 1, kind); assert.equal(JSON.stringify(f.view), before); assert.ok(f.calls.every(call => call.method === 'GET'));
  }
});

test('every fresh source identity is bound to the current product, option, profile and complete current context', async () => {
  const changes = { productId: 'other-product', optionId: 'blue', profileId: 'other-profile', productVersion: '2026-10-16T00:00:00.000Z',
    contentRevision: 9, optionRevision: 9, revision: 9, inputFingerprint: 'c'.repeat(64), categoryContext: { categoryId: '81221', categoryPath: ['다름'], profileId: 'profile', source: 'profile' } };
  for (const [field, value] of Object.entries(changes)) {
    const f = await compositionFixture(), request = async (url, init) => {
      const response = await f.request(url, init); if (!url.includes('/detail-save?')) return response;
      const reply = f.reply(); reply.source[field] = value; return Response.json(reply);
    };
    await assert.rejects(prepare(f, request), undefined, field); assert.equal(f.calls.length, 1, field);
  }
});

test('HTML must have the exact current primary binding, complete raw aliases and valid field constraints', async () => {
  for (const kind of ['primary', 'alias-order', 'alias-extra', 'alias-missing', 'oversized', 'wire-maxlength']) {
    const f = await compositionFixture();
    if (kind === 'primary') f.composition.html.fieldKey = 'detailHtml';
    if (kind === 'alias-order') {
      f.composition.html.rawCommon = { 'wire-detail-html': '', detailHtml: null };
      f.composition.html.rawOption = { 'wire-detail-html': '', detailHtml: null };
    }
    if (kind === 'alias-extra') f.composition.html.rawOption.unrelated = '';
    if (kind === 'alias-missing') delete f.composition.html.rawOption.detailHtml;
    if (kind === 'oversized') f.composition.html.effective = 'x'.repeat(150001);
    if (kind === 'wire-maxlength') { f.view.resolved.schema.fields.find(field => field.id === 'wire-detail-html').maxLength = 3; f.composition.html.effective = '1234'; }
    await assert.rejects(prepare(f), undefined, kind); assert.equal(f.calls.length, 1, kind);
  }
});

test('nonblank current HTML, readonly fields, image conflicts and invalid selection fail before a composition fetch', async () => {
  for (const kind of ['html-canonical', 'html-wire', 'readonly', 'image-alias', 'profile', 'option', 'missing-inputs']) {
    const f = await compositionFixture(); let selected = selection(f);
    const row = f.view.resolved.rows.find(row => row.optionId === 'red');
    if (kind === 'html-canonical') row.fields.detailHtml.value = ' ';
    if (kind === 'html-wire') row.fields['wire-detail-html'].value = '<p>변경</p>';
    if (kind === 'readonly') f.view.resolved.schema.fields.find(field => field.id === 'wire-detail-html').readOnly = true;
    if (kind === 'image-alias') row.fields['wire-detail-images'].value = 'owner/one.png';
    if (kind === 'profile') selected = { ...selected, profileId: 'other' };
    if (kind === 'option') selected = { ...selected, optionId: 'absent' };
    if (kind === 'missing-inputs') delete f.view.detailEditorInputs;
    await assert.rejects(prepare(f, f.request, selected), undefined, kind); assert.equal(f.calls.length, 0, kind);
  }
});

test('changed second composition response or before/after quotation read cannot stage stale HTML with newer images', async () => {
  for (const kind of ['second-html', 'second-raw', 'second-source', 'view-before', 'view-after']) {
    const f = await compositionFixture(); let views = 0;
    const request = async (url, init) => {
      const response = await f.request(url, init);
      if (url.includes('/detail-save?') && f.compositionReads === 2) {
        const reply = f.reply();
        if (kind === 'second-html') reply.composition.html.effective += 'changed';
        if (kind === 'second-raw') reply.composition.html.rawCommon.detailHtml = '';
        if (kind === 'second-source') reply.source.revision++;
        return Response.json(reply);
      }
      if (url.includes('/quotation-fields') && ++views === (kind === 'view-before' ? 1 : kind === 'view-after' ? 2 : -1)) return Response.json({ ...f.view, revision: f.view.revision + 1 });
      return response;
    };
    const before = JSON.stringify(f.view); await assert.rejects(prepare(f, request), undefined, kind);
    assert.equal(JSON.stringify(f.view), before); assert.ok(f.calls.every(call => call.method === 'GET'));
  }
});

test('actual input or final PNG damage aborts the HTML composition and never performs the second composition read', async () => {
  for (const key of ['owner/one.png', 'final']) {
    const f = await compositionFixture(), selected = key === 'final' ? f.key : key;
    f.objects.set(selected, Buffer.from('not a PNG'));
    await assert.rejects(prepare(f)); assert.equal(f.compositionReads, 1); assert.ok(f.calls.every(call => call.method === 'GET'));
  }
});

test('abort before the first request or after either composition response cannot continue or write', async () => {
  for (const at of [0, 1, 2]) {
    const f = await compositionFixture(), controller = new AbortController(); if (!at) controller.abort();
    const request = async (url, init) => { const response = await f.request(url, init); if (url.includes('/detail-save?') && f.compositionReads === at) controller.abort(); return response; };
    await assert.rejects(prepare(f, request, selection(f), controller.signal));
    assert.equal(f.compositionReads, at); assert.ok(f.calls.every(call => call.method === 'GET'));
    if (at <= 1) assert.equal(f.calls.filter(call => call.url.includes('/api/files/')).length, 0);
  }
});
