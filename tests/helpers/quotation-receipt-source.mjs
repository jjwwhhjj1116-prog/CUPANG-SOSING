import assert from 'node:assert/strict';
import fs from 'node:fs';
import { quotationAiApiFixture } from './quotation-ai-api.mjs';
import { mockProvider } from './quotation-ai.mjs';
const attributes = JSON.parse(fs.readFileSync(new URL('../fixtures/quotation-receipt-material-attributes.json', import.meta.url), 'utf8'));
async function fixture(pairs = attributes) {
  const f = await quotationAiApiFixture(), { h } = f;
  h.context.category = { ...f.profile }; h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context), 'job');
  h.sqlite.prepare('UPDATE products SET source_url=? WHERE id=?').run(h.sourceUrl, f.id);
  h.sqlite.exec(h.load('db/collection-jobs.ts').collectionProductSchema);
  h.sqlite.prepare('INSERT INTO collection_products(job_id,owner_id,product_id,created_at) VALUES(?,?,?,?)').run('job', 'owner', f.id, new Date().toISOString());
  const receipt = h.load('app/collection-result.ts').validateCollectionResult({ schemaVersion: 1, sourceUrl: h.sourceUrl, provider: 'chrome-public-mobile-v1', collectedAt: new Date().toISOString(),
    title: '商品原文', description: '', options: [{ sku: 'raw-one', name: '黑色', unitPriceCny: 7.1, minimumOrder: 1, stock: null }], images: [{ url: 'https://cbu01.alicdn.com/synthetic-material.png', role: 'main' }], attributes: pairs }, '813724060928');
  assert.equal((await h.load('db/collection-results.ts').storeCollectionResult('owner', 'job', receipt)).status, 'stored');
  const reader = h.load('app/exports/quotation-source.ts'), model = h.load('app/quotation-ai.ts');
  return { f, h, reader, model, receipt, read: () => reader.readMappedQuotationSource('owner', f.id, f.profile.id) };
}
const materialProvider = value => mockProvider({ mutate(result, request) { if (request.task !== 'ANALYZE_SCHEMA_ATTRIBUTES') {
  const change = result.changes?.find(change => request.fields.find(field => field.id === change.fieldKey)?.label === '소재'); if (change) change.value = value;
} return { response: JSON.stringify(result) }; } });

export { fixture, materialProvider, attributes };
