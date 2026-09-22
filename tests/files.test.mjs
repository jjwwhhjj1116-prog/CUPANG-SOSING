import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';

function load(file, overrides = {}) {
  const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, Request, Response, File, FormData, ReadableStream, TextEncoder, TextDecoder, Uint8Array, DataView, crypto: webcrypto, process: { env: { NODE_ENV: 'development' } }, require(name) {
    if (name in overrides) return overrides[name];
    if (name === 'next/server') return { NextResponse: Response };
    if (name === '@/app/chatgpt-auth') return { getChatGPTUser: async () => ({ userId: 'owner' }), getWorkspaceOwnerId: async () => 'owner' };
    if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`, overrides);
    throw Error(name);
  } });
  return exports;
}
const helpers = load('app/request-body.ts');
const fileHelpers = load('app/image-files.ts');
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=', 'base64'));
function stream(bytes) { return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }); }
function multipart(bytes = png, name = 'picture.png', type = 'image/png') {
  const form = new FormData(); form.set('file', new File([bytes], name, { type }));
  return new Request('http://localhost/api/files', { method: 'POST', body: form });
}
function bucket() {
  const saved = new Map();
  return { saved,
    async put(key, bytes, options) { saved.set(key, { bytes: new Uint8Array(bytes), ...options }); return { key, size: bytes.byteLength }; },
    async get(key, options) {
      const value = saved.get(key); if (!value) return null;
      const bytes = options?.range ? value.bytes.slice(options.range.offset, options.range.offset + options.range.length) : value.bytes;
      return { size: value.bytes.byteLength, httpMetadata: value.httpMetadata, customMetadata: value.customMetadata, body: stream(bytes) };
    },
  };
}
const routes = storage => {
  const overrides = { 'cloudflare:workers': { env: storage ? { FILES: storage } : {} } };
  return { upload: load('app/api/files/route.ts', overrides), download: load('app/api/files/[...key]/route.ts', overrides) };
};
const context = key => ({ params: Promise.resolve({ key: key.split('/') }) });

test('bounded readers enforce streamed bytes despite false Content-Length, cancel excess and reject invalid UTF-8', async () => {
  let cancelled = false;
  const request = new Request('http://localhost', { method: 'POST', headers: { 'content-length': '1' }, duplex: 'half', body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); }, cancel() { cancelled = true; } }) });
  await assert.rejects(helpers.readBoundedBytes(request, 4), error => error.status === 413); assert.equal(cancelled, true);
  await assert.rejects(helpers.readBoundedText(new Request('http://localhost', { method: 'POST', body: '한글' }), 5), error => error.status === 413);
  await assert.rejects(helpers.readBoundedText(new Request('http://localhost', { method: 'POST', body: new Uint8Array([0xff]) }), 10), error => error.status === 400);
  assert.equal(await helpers.readBoundedText(new Request('http://localhost', { method: 'POST', body: '한글' }), 6), '한글');
  await assert.rejects(helpers.readBoundedJson(new Request('http://localhost', { method: 'POST', body: '{}' }), 100), error => error.status === 400);
  assert.equal((await helpers.readBoundedJson(new Request('http://localhost', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: '{"ok":true}' }), 100)).ok, true);
});

test('image keys reject traversal, nested template objects and adjacent owner prefixes', () => {
  assert.equal(fileHelpers.isOwnedImageKey('owner', 'owner/uuid-old.filename.png'), true);
  for (const key of ['owner/../file.png', 'owner/.', 'owner/..', 'owner/nested/file.png', 'owner/%2e%2e%2fprivate', 'owner/file\\image.png', 'owner2/file.png', 'other/file.png', 'owner/file\n.png']) assert.equal(fileHelpers.isOwnedImageKey('owner', key), false);
  assert.equal(fileHelpers.isOwnedImageKey('owner/other', 'owner/other/file.png'), false);
});

test('upload/read round trip preserves bytes and derives MIME/extension from actual content', async () => {
  const storage = bucket(); const { upload, download } = routes(storage);
  const response = await upload.POST(multipart(png, '../../pretend.html', 'text/html'));
  assert.equal(response.status, 201); const result = await response.json();
  assert.equal(result.contentType, 'image/png'); assert.ok(result.key.startsWith('owner/')); assert.ok(result.key.endsWith('.png')); assert.ok(!result.key.includes('..'));
  assert.equal(storage.saved.get(result.key).httpMetadata.contentType, 'image/png'); assert.equal(storage.saved.get(result.key).customMetadata.imageValidation, 'header-v1');
  const read = await download.GET(new Request('http://localhost'), context(result.key));
  assert.equal(read.status, 200); assert.equal(read.headers.get('content-type'), 'image/png'); assert.equal(read.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(read.headers.get('cache-control'), 'private, no-store'); assert.ok(read.headers.get('content-disposition').startsWith('inline;')); assert.ok(read.headers.get('content-security-policy').includes('sandbox'));
  assert.deepEqual(new Uint8Array(await read.arrayBuffer()), png);
});

test('disguised SVG/HTML, empty files, duplicate multipart fields and oversized uploads never reach R2', async () => {
  let writes = 0; const { upload } = routes({ put: async () => { writes++; return {}; } });
  for (const active of ['<svg onload="alert(1)"></svg>', '<html><script>bad</script></html>']) assert.equal((await upload.POST(multipart(new TextEncoder().encode(active), 'fake.png', 'image/png'))).status, 415);
  assert.equal((await upload.POST(multipart(new Uint8Array(0)))).status, 400);
  const duplicate = new FormData(); duplicate.append('file', new File([png], 'one.png')); duplicate.append('file', new File([png], 'two.png'));
  assert.equal((await upload.POST(new Request('http://localhost', { method: 'POST', body: duplicate }))).status, 400);
  assert.equal((await upload.POST(multipart(new Uint8Array(fileHelpers.MAX_IMAGE_BYTES + 1)))).status, 413);
  assert.equal((await upload.POST(new Request('http://localhost', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=test', 'content-length': String(fileHelpers.MAX_IMAGE_MULTIPART_BYTES + 1) }, body: 'x' }))).status, 413);
  assert.equal(writes, 0);
});

test('legacy active-format originals remain stored and are only served as non-sniffable attachments', async () => {
  const storage = bucket(); const original = new TextEncoder().encode('<svg onload="bad"></svg>');
  storage.saved.set('owner/old.svg', { bytes: original, httpMetadata: { contentType: 'image/svg+xml' } });
  const response = await routes(storage).download.GET(new Request('http://localhost'), context('owner/old.svg'));
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.ok(response.headers.get('content-disposition').startsWith('attachment;')); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), original); assert.equal(storage.saved.size, 1);
});

test('file routes distinguish forbidden/missing/oversized/unavailable storage and phantom upload failures', async () => {
  let reads = 0; const storage = { get: async () => { reads++; return null; } };
  assert.equal((await routes(storage).download.GET(new Request('http://localhost'), context('other/image.png'))).status, 403); assert.equal(reads, 0);
  assert.equal((await routes(storage).download.GET(new Request('http://localhost'), context('owner/missing.png'))).status, 404);
  assert.equal((await routes({ get: async () => ({ size: fileHelpers.MAX_IMAGE_BYTES + 1 }) }).download.GET(new Request('http://localhost'), context('owner/huge.png'))).status, 413);
  assert.equal((await routes(null).upload.POST(multipart())).status, 503);
  assert.equal((await routes({ put: async () => null }).upload.POST(multipart())).status, 503);
  const failure = await routes({ put: async () => { throw Error('private R2 credentials'); } }).upload.POST(multipart());
  assert.equal(failure.status, 503); assert.ok(!(await failure.text()).includes('private R2'));
});

test('generic product PATCH verifies new R2 image links and preserves legacy references already on that product', async () => {
  const storage = bucket(); storage.saved.set('owner/image.png', { bytes: png }); storage.saved.set('owner/unsafe.svg', { bytes: new TextEncoder().encode('<svg></svg>') });
  let writes = 0;
  const overrides = { 'cloudflare:workers': { env: { FILES: storage } }, '@/db/queries': {
    findProduct: async () => ({ id: 'test', image_keys: '["owner/legacy.svg"]', updated_at: '2026-09-22T00:00:00.000Z' }),
    updateProduct: async (_owner, _id, updates) => { writes++; return { id: 'test', ...updates }; },
  } };
  const route = load('app/api/products/[id]/route.ts', overrides);
  const patch = keys => new Request('http://localhost', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image_keys: JSON.stringify(keys), expectedVersion: '2026-09-22T00:00:00.000Z' }) });
  const ctx = { params: Promise.resolve({ id: 'test' }) };
  for (const keys of [['owner/missing.png'], ['owner/unsafe.svg'], ['owner/category-templates/x.xlsx'], ['other/image.png'], ['owner/image.png', 'owner/image.png']]) assert.equal((await route.PATCH(patch(keys), ctx)).status, 400);
  assert.equal(writes, 0);
  assert.equal((await route.PATCH(patch(['owner/legacy.svg', 'owner/image.png']), ctx)).status, 200); assert.equal(writes, 1);
  const missing = load('app/api/products/[id]/route.ts', { ...overrides, '@/db/queries': { findProduct: async () => null } });
  assert.equal((await missing.PATCH(patch(['owner/image.png']), ctx)).status, 404);
});
