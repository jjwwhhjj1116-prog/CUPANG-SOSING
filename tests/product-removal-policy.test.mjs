import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const version = '2026-10-01T00:00:00.000Z';
const companies = [{ companyCode: 'A01464742', companyName: '와이홉' }, { companyCode: 'A01526306', companyName: '유앤채' }];
const json = async (response, status) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
async function seed(h) {
  h.objects.set('owner/main.png', new Uint8Array([1, 2, 3]));
  await h.load('db/queries.ts').insertProduct({
    id: 'product', owner_id: 'owner', source_url: h.sourceUrl, title: '검토중인 원본 상품', source_price_cny: 1,
    exchange_rate: 350, supply_margin: 50, coupang_margin: 40, supply_price: 3000, sale_price: 5000, msrp: 6500,
    options_count: 2, seo_status: '대기', image_status: '대기', quote_status: '대기', registration_status: '검토 중',
    supplier_hub_status: '미전송', image_keys: '["owner/main.png"]', goal_stage: 'price', created_at: version, updated_at: version,
  });
}
function receipt(h, company, state = 'validation-rejected', fingerprint = 'a'.repeat(64), observedAt = 1) {
  const result = { state, filename: `YOOFAM-${fingerprint}.xlsx`, company: { code: company.companyCode, name: company.companyName },
    includedOptions: 2, observedAt, registered: false, ...(state === 'validation-complete' ? { quotationId: 'accepted-original-company' } : {}) };
  const value = { schemaVersion: 1, evidence: 'chrome-observation', profileId: 'category', categoryId: '80719', fingerprint,
    productVersion: version, recordedAt: version, result };
  const model = h.load('app/supplier-hub-receipt.ts');
  model.parseStoredSupplierHubReceipt(JSON.stringify(value));
  return { fingerprint, payload: JSON.stringify(value), observed_at: model.supplierHubReceiptObservationTime(result), evidence_order: model.supplierHubReceiptOrder(result) };
}
function insert(h, row) {
  h.sqlite.prepare('INSERT INTO supplier_hub_receipts(owner_id,product_id,fingerprint,observed_at,evidence_order,payload) VALUES(?,?,?,?,?,?)')
    .run('owner', 'product', row.fingerprint, row.observed_at, row.evidence_order, row.payload);
}
function remove(h, body = { expectedVersion: version }) {
  return h.load('app/api/products/[id]/route.ts').DELETE(new Request('https://app.test/api/products/product', {
    method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: 'product' }) });
}
function snapshot(h) {
  return JSON.stringify(Object.fromEntries(h.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'product_removals' ORDER BY name")
    .all().map(({ name }) => [name, h.sqlite.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()])));
}
function beforeInsert(h, callback) {
  const original = h.db.prepare;
  h.db.prepare = sql => {
    const query = original(sql), first = query.first;
    if (/^INSERT INTO product_removals/iu.test(sql.trim())) query.first = async () => { h.db.prepare = original; callback(); return first.call(query); };
    return query;
  };
}

for (const state of ['validation-pending', 'validation-complete', 'malformed']) test(`atomic removal refuses ${state} receipt arriving after a verified empty history`, async () => {
  for (const company of companies) {
    const h = mobileIntakeHarness(company);
    try {
      await seed(h);
      const model = h.load('db/product-removals.ts');
      assert.equal((await model.readProductRemovalPolicies('owner', [{ id: 'product' }])).product.blocked, false);
      let afterEvidence;
      beforeInsert(h, () => {
        const row = state === 'malformed'
          ? { fingerprint: 'a'.repeat(64), payload: '{"result":{"state":"validation-rejected"}}', observed_at: 1, evidence_order: 1000 }
          : receipt(h, company, state);
        insert(h, row); afterEvidence = snapshot(h);
      });
      const response = await json(await remove(h), 409);
      assert.equal(response.code, state === 'malformed' ? 'PRODUCT_HUB_EVIDENCE_UNCONFIRMED' : 'PRODUCT_HUB_TRANSMITTED');
      assert.equal(response.removal_policy.blocked, true);
      assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM product_removals').get().count, 0);
      assert.equal(snapshot(h), afterEvidence, 'rejecting removal changes no draft, receipt, source, or clock');
      assert.deepEqual([...h.objects.get('owner/main.png')], [1, 2, 3]);
    } finally { h.close(); }
  }
});

test('exact rejected receipt tuple cannot authorize deletion after that same fingerprint becomes pending', async () => {
  const h = mobileIntakeHarness();
  try {
    await seed(h); insert(h, receipt(h, companies[0]));
    assert.equal((await h.load('db/product-removals.ts').readProductRemovalPolicies('owner', [{ id: 'product' }])).product.blocked, false);
    let afterEvidence;
    beforeInsert(h, () => {
      const row = receipt(h, companies[0], 'validation-pending', 'a'.repeat(64), 2);
      h.sqlite.prepare('UPDATE supplier_hub_receipts SET payload=?,observed_at=?,evidence_order=? WHERE owner_id=? AND product_id=? AND fingerprint=?')
        .run(row.payload, row.observed_at, row.evidence_order, 'owner', 'product', row.fingerprint);
      afterEvidence = snapshot(h);
    });
    const rejected = await json(await remove(h), 409);
    assert.equal(rejected.code, 'PRODUCT_HUB_TRANSMITTED');
    assert.equal(rejected.hub_receipt.label, '파일 검증 중');
    assert.equal(snapshot(h), afterEvidence);
    assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM product_removals').get().count, 0);
  } finally { h.close(); }
});

test('legacy archived submitted evidence can be restored without changing receipt bytes or product clock', async () => {
  const h = mobileIntakeHarness();
  try {
    await seed(h); insert(h, receipt(h, companies[0], 'validation-complete'));
    h.sqlite.prepare('INSERT INTO product_removals VALUES(?,?,?,?)').run('product', 'owner', version, version);
    const before = snapshot(h);
    const restored = await json(await remove(h, { action: 'restore', expectedVersion: version, expectedRemovedAt: version }), 200);
    assert.deepEqual(restored, { productId: 'product', restored: true });
    assert.equal(snapshot(h), before);
    assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM product_removals').get().count, 0);
    const rejected = await json(await remove(h), 409);
    assert.equal(rejected.code, 'PRODUCT_HUB_TRANSMITTED');
    assert.equal(snapshot(h), before);
  } finally { h.close(); }
});

test('policy proof rejects mismatched receipt clocks/order and missing or contradictory client decisions', async () => {
  const h = mobileIntakeHarness();
  try {
    const model = h.load('app/product-removal-policy.ts'), row = receipt(h, companies[0]);
    for (const changed of [{ ...row, observed_at: 2 }, { ...row, evidence_order: 0 }, { ...row, fingerprint: 'b'.repeat(64) }]) {
      const decision = model.productRemovalDecisionFromReceipts([changed]);
      assert.equal(decision.blocked, true); assert.equal(decision.code, 'PRODUCT_HUB_EVIDENCE_UNCONFIRMED');
    }
    const empty = model.productRemovalDecisionFromReceipts([]), complete = model.productRemovalDecisionFromReceipts([receipt(h, companies[0], 'validation-complete')]);
    assert.equal(model.productRemovalDecision({ removal_policy: empty }).blocked, false);
    assert.equal(model.productRemovalDecision({}).blocked, true);
    assert.equal(model.productRemovalDecision({ removal_policy: { blocked: false } }).blocked, true);
    assert.equal(model.productRemovalDecision({ removal_policy: empty, hub_receipt: complete.receipt }).code, 'PRODUCT_HUB_TRANSMITTED');
    assert.equal(model.productRemovalDecision({ hub_receipt: model.productRemovalDecisionFromReceipts([row]).receipt }).code, 'PRODUCT_HUB_EVIDENCE_UNCONFIRMED', 'a latest-only rejection cannot certify the absence of older transmissions');
  } finally { h.close(); }
});

test('large fully validated rejection histories fail closed before constructing an oversized SQL snapshot', () => {
  const h = mobileIntakeHarness();
  try {
    const model = h.load('app/product-removal-policy.ts');
    const rows = Array.from({ length: 30 }, (_, index) => {
      const row = receipt(h, companies[0], 'validation-rejected', (index + 1).toString(16).padStart(64, '0'));
      const stored = JSON.parse(row.payload); stored.result.detail = 'r'.repeat(20000); row.payload = JSON.stringify(stored);
      h.load('app/supplier-hub-receipt.ts').parseStoredSupplierHubReceipt(row.payload);
      return row;
    });
    assert.ok(new TextEncoder().encode(JSON.stringify(rows)).length > model.PRODUCT_REMOVAL_RECEIPT_SNAPSHOT_LIMIT);
    const decision = model.productRemovalDecisionFromReceipts(rows);
    assert.equal(decision.blocked, true); assert.equal(decision.code, 'PRODUCT_HUB_EVIDENCE_UNCONFIRMED');
  } finally { h.close(); }
});
