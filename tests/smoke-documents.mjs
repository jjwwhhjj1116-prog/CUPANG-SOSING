// Read only verification of a browser-generated document attached to a LOCAL TEST
// product. It exports local files but neither edits records nor visits 1688.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

const base = 'http://localhost:3000';
async function json(path, body) {
  const response = await fetch(base + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
}
const product = (await json('/api/products')).products.find(item => item.title === '[LOCAL TEST] XLSX·옵션·첨부 통합 검증 — 실상품 아님');
assert.ok(product, 'Run the local fixture setup first.');
const content = (await json(`/api/products/${product.id}/content`)).content;
const key = content.assets.size.value.at(-1);
assert.ok(key, 'Generate and attach a size PNG in the local browser first.');
assert.ok(JSON.parse(product.image_keys).includes(key));
const response = await fetch(`${base}/api/files/${encodeURIComponent(key)}`);
assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png');
const png = new Uint8Array(await response.arrayBuffer());
assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
const dimensions = new DataView(png.buffer, png.byteOffset, png.byteLength);
assert.equal(dimensions.getUint32(16), 1440); assert.ok(dimensions.getUint32(20) >= 300);
const profile = (await json('/api/category-profiles')).profiles.find(item => item.name === '[LOCAL TEST] XLSX 견적서 통합 검증');
assert.ok(profile);
const preview = await json(`/api/products/${product.id}/quotation`, { action: 'preview', profileId: profile.id, dataStartRow: 2 });
const exported = await fetch(`${base}/api/products/${product.id}/quotation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'export', profileId: profile.id, dataStartRow: 2, fingerprint: preview.fingerprint }) });
assert.equal(exported.status, 200);
const zip = new Uint8Array(await exported.arrayBuffer()); const files = unzipSync(zip);
const manifest = JSON.parse(strFromU8(files['manifest.json']));
const filename = manifest.assets.size.at(-1);
assert.deepEqual(files[filename], png);
assert.equal(manifest.submissionReady, false);
assert.ok(files['quotation-filled.xlsx']);
const report = { checkedAt: new Date().toISOString(), synthetic: true, actualProductCollected: false, paidCalls: 0, supplierSubmissions: 0, productId: product.id, contentRevision: content.revision, imageKey: key, width: dimensions.getUint32(16), height: dimensions.getUint32(20), bytes: png.length, exportedFilename: filename, checks: ['Browser-generated PNG persisted in R2', 'Product and size role link persisted', 'Quotation ZIP contains byte-identical generated document', 'Submission readiness remains false'] };
const labelKey = content.assets.label.value.at(-1);
if (labelKey) {
  const labelResponse = await fetch(`${base}/api/files/${encodeURIComponent(labelKey)}`);
  assert.equal(labelResponse.status, 200); assert.equal(labelResponse.headers.get('content-type'), 'image/png');
  const label = new Uint8Array(await labelResponse.arrayBuffer());
  const labelView = new DataView(label.buffer, label.byteOffset, label.byteLength);
  assert.equal(labelView.getUint32(16), 1200);
  assert.deepEqual(files[manifest.assets.label.at(-1)], label);
  report.label = { key: labelKey, width: labelView.getUint32(16), height: labelView.getUint32(20), bytes: label.length };
  report.checks.push('Browser-generated label PNG included byte-identically');
}
await fs.mkdir('outputs', { recursive: true });
await fs.writeFile('outputs/local-document-result.json', JSON.stringify(report, null, 2));
await fs.writeFile('outputs/local-document-quotation.zip', zip);
console.log(JSON.stringify(report, null, 2));
