import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { companies, json } from './helpers/image-download-ui.mjs';
import { makeCompositeFixture, loadComposite } from './helpers/detail-image-composite.mjs';

const input = fixture => ({ productId: fixture.product.id, optionId: fixture.optionId,
  profileId: fixture.view.categoryContext.profileId, view: fixture.view });
const signal = () => new AbortController().signal;
const fileUrl = key => '/api/files/' + key.split('/').map(encodeURIComponent).join('/');
const plain = value => JSON.parse(JSON.stringify(value));
function unchanged(fixture, before) {
  assert.equal(fixture.retained(), before.database);
  assert.equal(fixture.originals(), before.files);
  assert.ok(fixture.calls.every(call => !call.init.method || call.init.method === 'GET'));
  assert.ok(fixture.calls.every(call => call.url.startsWith(fixture.base + '/quotation-fields') || call.url.startsWith('/api/files/')));
  assert.ok(fixture.calls.every(call => !call.url.includes('labelUploadId=')));
  assert.equal(fixture.api.network.length, before.network);
}
const snapshot = fixture => ({ database: fixture.retained(), files: fixture.originals(), network: fixture.api.network.length });

for (const company of companies) test(`saved detail order downloads as an 800px white JPEG at a full image pool without any writes (${company.companyCode})`, async () => {
  const f = await makeCompositeFixture(company, { count: 4, manualHtml: '<p>직접 편집한 HTML &amp; 원문 유지</p>' });
  try {
    const order = [f.selectedKeys[2], f.selectedKeys[0], f.selectedKeys[3], f.selectedKeys[1]];
    for (let index = 0; index < f.selectedKeys.length; index++) {
      const color = index === 0 ? { r: 10, g: 20, b: 30, alpha: 0 } : f.colors[index];
      const bytes = await sharp({ create: { width: 400, height: 24, channels: 4, background: color } }).png().toBuffer();
      await f.api.bindings.FILES.put(f.selectedKeys[index], bytes, { httpMetadata: { contentType: 'image/png' } });
    }
    f.view = await json(await f.api.route(f.base + '/quotation-fields?profileId=' + f.view.categoryContext.profileId));
    f.view = await json(await f.api.route(f.base + '/quotation-fields?profileId=' + f.view.categoryContext.profileId, { method: 'PUT', body: {
      expectedRevision: f.view.revision, expectedInputFingerprint: f.view.inputFingerprint,
      changes: [{ optionId: f.optionId, fieldKey: 'detailImages', value: order.join('\n') }],
    } }));
    const extra = Array.from({ length: 150 - f.view.imageKeys.length }, (_, index) => `owner/unused-full-pool-${index}.png`);
    f.api.sqlite.prepare('UPDATE products SET image_keys=?').run(JSON.stringify([...f.view.imageKeys, ...extra]));
    f.view = await json(await f.api.route(f.base + '/quotation-fields?profileId=' + f.view.categoryContext.profileId));
    assert.equal(f.view.imageKeys.length, 150);
    const originalView = plain(f.view), before = snapshot(f), runtime = loadComposite(f);
    const downloaded = await runtime.helper.prepareDetailImageDownload(input(f), signal(), f.request);
    assert.equal(downloaded.output.type, 'image/jpeg');
    assert.equal(downloaded.width, 800);
    assert.equal(downloaded.height, 192);
    assert.deepEqual(plain(downloaded.keys), order);
    assert.deepEqual(Object.keys(downloaded).sort(), ['height', 'keys', 'output', 'width']);
    assert.deepEqual(runtime.encodes, [{ type: 'image/jpeg', quality: 0.92, width: 800, height: 192 }]);
    assert.deepEqual(runtime.draws.map(draw => draw.y), [0, 48, 96, 144]);
    const bytes = Buffer.from(await downloaded.output.arrayBuffer()), metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, 'jpeg'); assert.equal(metadata.width, 800); assert.equal(metadata.height, 192);
    assert.equal(metadata.hasAlpha, false); assert.ok(bytes.length <= 10 * 1024 * 1024);
    const pixels = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    for (let index = 0; index < order.length; index++) {
      const sourceIndex = f.selectedKeys.indexOf(order[index]), color = sourceIndex === 0 ? { r: 255, g: 255, b: 255 } : f.colors[sourceIndex];
      const offset = ((index * 48 + 24) * 800 + 400) * pixels.info.channels;
      for (const [channel, expected] of [color.r, color.g, color.b].entries()) assert.ok(Math.abs(pixels.data[offset + channel] - expected) <= 3);
    }
    assert.deepEqual(plain(f.view), originalView, 'rendering never mutates the caller quotation');
    assert.equal(f.view.resolved.rows.find(row => row.optionId === f.optionId).fields.detailHtml.value, '<p>직접 편집한 HTML &amp; 원문 유지</p>');
    assert.equal(f.calls.filter(call => call.url.includes('/quotation-fields')).length, 2);
    for (const key of order) assert.equal(f.calls.filter(call => call.url === fileUrl(key)).length, 2);
    assert.equal(runtime.blobs.size, 0, 'every source object URL is released');
    unchanged(f, before);
    await assert.rejects(runtime.helper.prepareDetailComposite(input(f), signal(), f.request), /공간/);
    unchanged(f, before);
  } finally { f.api.close(); }
});

for (const company of companies) test(`a changed quotation before or after JPEG rendering rejects the download without writes (${company.companyCode})`, async () => {
  for (const phase of ['before', 'after']) {
    const f = await makeCompositeFixture(company, { count: 3 });
    try {
      const runtime = loadComposite(f), before = snapshot(f); let reads = 0;
      const request = async (url, init) => {
        const response = await f.request(url, init);
        if (url.includes('/quotation-fields') && ++reads === (phase === 'before' ? 1 : 2)) {
          const changed = await response.json(); changed.revision++; changed.resolved.rows.find(row => row.optionId === f.optionId).fields.detailHtml.value = '<p>서버에서 바뀐 자료</p>';
          return Response.json(changed);
        }
        return response;
      };
      await assert.rejects(runtime.helper.prepareDetailImageDownload(input(f), signal(), request), /변경/);
      assert.equal(runtime.encodes.length, phase === 'before' ? 0 : 1);
      unchanged(f, before);
    } finally { f.api.close(); }
  }
});

for (const company of companies) test(`changed source bytes between JPEG render passes cannot produce a stale download (${company.companyCode})`, async () => {
  const f = await makeCompositeFixture(company, { count: 3 });
  try {
    const runtime = loadComposite(f), before = snapshot(f), changed = await sharp({ create: { width: 800, height: 1, channels: 4, background: '#000000' } }).png().toBuffer();
    let reads = 0;
    const request = async (url, init) => {
      const response = await f.request(url, init);
      return url === fileUrl(f.selectedKeys[0]) && ++reads === 2 ? new Response(changed, { headers: { 'content-type': 'image/png' } }) : response;
    };
    await assert.rejects(runtime.helper.prepareDetailImageDownload(input(f), signal(), request), /변경/);
    assert.equal(runtime.draws.length, 0); assert.equal(runtime.encodes.length, 0);
    unchanged(f, before);
  } finally { f.api.close(); }
});

test('aborted detail downloads stop before private reads or before a rendered file can be returned', async () => {
  for (const phase of ['before', 'source', 'after-render']) {
    const f = await makeCompositeFixture(companies[0], { count: 3 });
    try {
      const runtime = loadComposite(f), before = snapshot(f), controller = new AbortController(); let quoteReads = 0;
      if (phase === 'before') controller.abort();
      const request = async (url, init) => {
        const response = await f.request(url, init);
        if (phase === 'source' && url.startsWith('/api/files/') || phase === 'after-render' && url.includes('/quotation-fields') && ++quoteReads === 2) controller.abort();
        return response;
      };
      await assert.rejects(runtime.helper.prepareDetailImageDownload(input(f), controller.signal, request));
      if (phase === 'before') assert.equal(f.calls.length, 0);
      assert.equal(runtime.blobs.size, 0); unchanged(f, before);
    } finally { f.api.close(); }
  }
});

test('invalid, oversized or incorrectly sized Canvas outputs are never returned as a detail JPEG', async () => {
  const wrongMime = new Blob([await sharp({ create: { width: 800, height: 3, channels: 4, background: '#ffffff' } }).png().toBuffer()], { type: 'image/jpeg' });
  const wrongSize = new Blob([await sharp({ create: { width: 799, height: 3, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()], { type: 'image/jpeg' });
  for (const output of [null, new Blob([]), new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/jpeg' }), new Blob(['bad jpeg'], { type: 'image/jpeg' }), wrongMime, wrongSize]) {
    const f = await makeCompositeFixture(companies[0], { count: 3 });
    try {
      const document = { createElement() { return { width: 0, height: 0, getContext() { return { fillStyle: '', fillRect() {}, drawImage() {} }; }, toBlob(callback) { callback(output); } }; } };
      const runtime = loadComposite(f, { document }), before = snapshot(f);
      await assert.rejects(runtime.helper.prepareDetailImageDownload(input(f), signal(), f.request));
      unchanged(f, before);
    } finally { f.api.close(); }
  }
});

test('private image errors, excessive source dimensions and a changed company block detail downloads without writes', async () => {
  for (const failure of ['private404', 'dimensions', 'company']) {
    const f = await makeCompositeFixture(companies[0], { count: 3 });
    try {
      if (failure === 'dimensions') {
        const bytes = f.api.objects.get(f.selectedKeys[0]).slice();
        new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(16, 20000);
        await f.api.bindings.FILES.put(f.selectedKeys[0], bytes, { httpMetadata: { contentType: 'image/png' } });
      }
      if (failure === 'company') f.api.setCompany({ code: companies[1].companyCode, name: companies[1].companyName });
      const runtime = loadComposite(f), before = snapshot(f);
      const request = async (url, init) => {
        const response = await f.request(url, init);
        return failure === 'private404' && url.startsWith('/api/files/') ? Response.json({ error: 'fixture missing private source' }, { status: 404 }) : response;
      };
      await assert.rejects(runtime.helper.prepareDetailImageDownload(input(f), signal(), request));
      assert.equal(runtime.decoded.length, 0); assert.equal(runtime.encodes.length, 0);
      unchanged(f, before);
    } finally { f.api.close(); }
  }
});
