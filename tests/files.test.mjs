import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';

function load(file, overrides = {}, mode = 'development') {
  const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, URL, Headers, Request, Response, File, FormData, ReadableStream, TextEncoder, TextDecoder, Uint8Array, DataView, crypto: webcrypto, process: { env: { NODE_ENV: mode } }, require(name) {
    if (name in overrides) return overrides[name];
    if (name === 'next/server') return { NextResponse: Response };
    if (name === '@/app/chatgpt-auth') return { getChatGPTUser: async () => ({ userId: 'owner' }), getWorkspaceOwnerId: async () => 'owner' };
    if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`, overrides, mode);
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
    async head(key){const value=saved.get(key);return value?{size:value.bytes.byteLength,httpMetadata:value.httpMetadata,customMetadata:value.customMetadata}:null;},
    async put(key, bytes, options) { if(options?.onlyIf?.get('if-none-match')==='*'&&saved.has(key))return null;saved.set(key, { bytes: new Uint8Array(bytes), ...options }); return { key, size: bytes.byteLength }; },
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
  assert.equal(storage.saved.get(result.key).customMetadata.dimensionValidation, 'header-v1');
  assert.equal(storage.saved.get(result.key).customMetadata.imageWidth, '1');
  assert.equal(storage.saved.get(result.key).customMetadata.imageHeight, '1');
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

const labelId = 'a'.repeat(64);
const labelRequest = (id = labelId, bytes = png, modify = () => {}) => {
  const form = new FormData();
  form.set('file', new File([bytes], 'sourceflow-quotation-label.png', { type: 'image/png' }));
  form.set('labelUploadId', id); modify(form);
  return new Request('http://localhost/api/files', { method: 'POST', body: form });
};
const labelLookup = (query = `labelUploadId=${labelId}`) => new Request(`http://localhost/api/files?${query}`);

test('saved label lookup and repeated uploads reuse only identical PNG bytes', async () => {
  const storage = bucket(), { upload } = routes(storage);
  const missing = await upload.GET(labelLookup());
  assert.deepEqual(await missing.json(), { key: null });
  assert.equal(missing.headers.get('cache-control'), 'no-store');
  const first = await upload.POST(labelRequest()); assert.equal(first.status, 201);
  const created = await first.json(); assert.equal(created.key, `owner/quotation-label-${labelId}.png`);
  const reused = await upload.POST(labelRequest()); assert.equal(reused.status, 200);
  const again = await reused.json(); assert.equal(again.key, created.key); assert.equal(again.reused, true);
  const found = await upload.GET(labelLookup()); assert.equal(found.status, 200);
  assert.equal(found.headers.get('cache-control'), 'no-store');
  const saved = await found.json(); assert.equal(saved.key, created.key); assert.match(saved.sha256, /^[a-f0-9]{64}$/);
  const changed = await upload.POST(labelRequest(labelId, new Uint8Array([...png, 1])));
  assert.equal(changed.status, 409); assert.equal(changed.headers.get('cache-control'), 'no-store');
  assert.equal(storage.saved.size, 1); assert.deepEqual(storage.saved.get(created.key).bytes, png);
  assert.equal(storage.saved.get(created.key).customMetadata.labelBlobSha256, saved.sha256);
});

for (const different of [false, true]) test(`simultaneous label uploads ${different ? 'reject changed bytes' : 'reuse identical bytes'} without replacing the first file`, async () => {
  const storage = bucket(), normalHead = storage.head.bind(storage); let heads = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  storage.head = async key => {
    const original = await normalHead(key);
    if (++heads <= 2) { if (heads === 2) release(); await gate; }
    return original;
  };
  const { upload } = routes(storage);
  const results = await Promise.all([upload.POST(labelRequest()), upload.POST(labelRequest(labelId, different ? new Uint8Array([...png, 1]) : png))]);
  assert.deepEqual(results.map(response => response.status).sort(), different ? [201, 409] : [200, 201]);
  const created = await results.find(response => response.status === 201).json();
  assert.equal(storage.saved.size, 1);
  assert.equal(storage.saved.get(created.key).onlyIf.get('if-none-match'), '*');
  const winningBytes = results[0].status === 201 ? png : (different ? new Uint8Array([...png, 1]) : png);
  assert.deepEqual(storage.saved.get(created.key).bytes, winningBytes);
  if (!different) assert.equal((await results.find(response => response.status === 200).json()).reused, true);
});

test('an upload acknowledgement loss is recovered by owner lookup without another R2 write', async () => {
  const storage = bucket(), normalPut = storage.put.bind(storage); let writes = 0;
  storage.put = async (...args) => { writes++; await normalPut(...args); throw Error('private storage response lost'); };
  const { upload } = routes(storage);
  const lost = await upload.POST(labelRequest()); assert.equal(lost.status, 503);
  assert.ok(!(await lost.text()).includes('private storage'));
  const found = await upload.GET(labelLookup()); assert.equal(found.status, 200);
  const stored = await found.json(); assert.equal(stored.key, `owner/quotation-label-${labelId}.png`);
  const retry = await upload.POST(labelRequest()); assert.equal(retry.status, 200);
  assert.equal((await retry.json()).key, stored.key); assert.equal(writes, 1);
});

test('label upload identifiers, multipart fields and origin are checked before storage access', async () => {
  let accesses = 0;
  const { upload } = routes({ head: async () => { accesses++; return null; }, put: async () => { accesses++; return {}; } });
  for (const id of ['', 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), '../other/file', new File([png], 'id.png')]) {
    assert.equal((await upload.POST(labelRequest(id))).status, 400);
  }
  const invalid = [
    form => form.append('labelUploadId', labelId),
    form => form.set('ownerId', 'other'),
    form => form.set('file', new File([png], 'other.png', { type: 'image/png' })),
    form => form.set('file', new File([new Uint8Array(Buffer.from('GIF89a\x01\x00\x01\x00', 'binary'))], 'sourceflow-quotation-label.png', { type: 'image/gif' })),
  ];
  for (const change of invalid) assert.equal((await upload.POST(labelRequest(labelId, png, change))).status, 400);
  const crossOrigin = labelRequest(); crossOrigin.headers.set('origin', 'https://other.test');
  assert.equal((await upload.POST(crossOrigin)).status, 400);
  assert.equal(accesses, 0);
});

test('label lookup ignores no ownership override and production requires verified access', async () => {
  const storage = bucket(), { upload } = routes(storage);
  await upload.POST(labelRequest()); let reads = 0;
  const normalHead = storage.head.bind(storage);
  storage.head = async key => { reads++; return normalHead(key); };
  for (const query of ['', 'labelUploadId=', `labelUploadId=${labelId}&labelUploadId=${labelId}`, `labelUploadId=${labelId}&ownerId=owner`, `labelUploadId=${labelId}&key=owner/file.png`, `labelUploadId=${'A'.repeat(64)}`]) {
    const invalid = await upload.GET(labelLookup(query)); assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get('cache-control'), 'no-store');
  }
  assert.equal(reads, 0);
  const ownOnly = load('app/api/files/route.ts', { 'cloudflare:workers': { env: { FILES: storage } },
    '@/app/chatgpt-auth': { getChatGPTUser: async () => ({ verifiedAccess: true }), getWorkspaceOwnerId: async () => 'other' } }, 'production');
  assert.deepEqual(await (await ownOnly.GET(labelLookup())).json(), { key: null });
  assert.equal(storage.saved.size, 1); assert.equal(reads, 1);
  const denied = load('app/api/files/route.ts', { 'cloudflare:workers': { env: { FILES: storage } },
    '@/app/chatgpt-auth': { getChatGPTUser: async () => ({ verifiedAccess: false }), getWorkspaceOwnerId: async () => { throw Error('must not resolve owner'); } } }, 'production');
  for (const response of [await denied.GET(labelLookup()), await denied.POST(labelRequest())]) {
    assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(reads, 1);
});

test('saved label metadata or failed lookup cannot be replaced by a fresh upload', async () => {
  for (const change of [value => { value.customMetadata.labelUploadId = 'b'.repeat(64); }, value => { value.customMetadata.labelBlobSha256 = 'invalid'; }, value => { value.httpMetadata.contentType = 'image/jpeg'; }, value => { value.bytes = new Uint8Array(0); }]) {
    const storage = bucket(), { upload } = routes(storage); await upload.POST(labelRequest());
    const key = `owner/quotation-label-${labelId}.png`, value = storage.saved.get(key); change(value);
    let writes = 0; storage.put = async () => { writes++; return {}; };
    const unavailable = await upload.GET(labelLookup()); assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get('cache-control'), 'no-store');
    assert.ok(!(await unavailable.text()).includes('Invalid saved label'));
    assert.equal((await upload.POST(labelRequest())).status, 503); assert.equal(writes, 0);
  }
  const failure = await routes({ head: async () => { throw Error('private R2 connection'); } }).upload.GET(labelLookup());
  assert.equal(failure.status, 503); assert.ok(!(await failure.text()).includes('private R2'));
});
