// Opt-in integration check. Only the local development server and synthetic
// fixture files/products are touched; this does not collect any source product.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
if (!process.argv.includes('--allow-test-records')) throw Error('Pass --allow-test-records to upload a local synthetic image.');
const base = 'http://localhost:3000';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=', 'base64');
const fetchLocal = (path, options = {}) => fetch(base + path, { ...options, signal: AbortSignal.timeout(20000) });
async function upload(bytes, name, type) {
  const form = new FormData(); form.set('file', new File([bytes], name, { type }));
  return fetchLocal('/api/files', { method: 'POST', body: form });
}
const response = await upload(png, 'LOCAL-TEST-guarded-image.html', 'text/html');
const uploaded = await response.json(); assert.equal(response.status, 201, JSON.stringify(uploaded));
assert.equal(uploaded.contentType, 'image/png'); assert.ok(uploaded.key.endsWith('.png'));
const read = await fetchLocal(uploaded.url); assert.equal(read.status, 200);
assert.equal(read.headers.get('content-type'), 'image/png'); assert.equal(read.headers.get('x-content-type-options'), 'nosniff');
assert.ok(read.headers.get('content-disposition').startsWith('inline;'));
const restored = Buffer.from(await read.arrayBuffer()); assert.deepEqual(restored, png);
const svg = await upload('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'LOCAL-TEST-denied.png', 'image/png'); assert.equal(svg.status, 415);
const denied = await fetchLocal('/api/files/foreign-owner/LOCAL-TEST-denied.png'); assert.equal(denied.status, 403);
const listing = await fetchLocal('/api/products'); assert.equal(listing.status, 200);
const { products } = await listing.json();
const fixture = products.find(product => product.title === '[LOCAL TEST] XLSX·옵션·첨부 통합 검증 — 실상품 아님');
let attachmentVerified = false;
if (fixture) {
  const keys = [...new Set([...JSON.parse(fixture.image_keys), uploaded.key])];
  const linked = await fetchLocal(`/api/products/${fixture.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image_keys: JSON.stringify(keys), expectedVersion: fixture.updated_at }) });
  const saved = await linked.json(); assert.equal(linked.status, 200, JSON.stringify(saved));
  assert.ok(JSON.parse(saved.product.image_keys).includes(uploaded.key)); attachmentVerified = true;
}
const result = { checkedAt: new Date().toISOString(), synthetic: true, actualProductCollected: false, paidCalls: 0, supplierSubmissions: 0,
  imageKey: uploaded.key, bytes: restored.length, sha256: createHash('sha256').update(restored).digest('hex'), attachmentVerified,
  checks: ['Local R2 write/read byte equality', 'Actual PNG overrides claimed HTML MIME/name', 'Inline image nosniff', 'Disguised SVG upload rejected', 'Foreign owner denied', ...(attachmentVerified ? ['Synthetic product new R2 image reference validated and saved'] : [])] };
await fs.mkdir('outputs', { recursive: true }); await fs.writeFile('outputs/local-files-smoke-result.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
