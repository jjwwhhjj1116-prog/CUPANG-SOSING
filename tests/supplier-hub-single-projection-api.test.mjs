import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
import { apiFixture, companies, syntheticSnapshot, plain, module } from './helpers/supplier-hub-single-projection.mjs';
const endpoint = 'app/api/products/[id]/supplier-hub-document/route.ts';
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
function scopeRoute(fixture, user, owner = 'owner') {
  const exports = {}, source = ts.transpileModule(fs.readFileSync(new URL('../' + endpoint, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, Response, Request, URL, Error, Headers, crypto: webcrypto, process: { env: { NODE_ENV: 'production' } },
    require(name) {
      if (name === 'next/server') return { NextResponse: Response };
      if (name === '@/app/chatgpt-auth') return { getChatGPTUser: user, getWorkspaceOwnerId: async () => owner };
      if (name === '@/app/exports/quotation-source') return fixture.h.load('app/exports/quotation-source.ts');
      if (name === '@/db/quotation-fields') return fixture.h.load('db/quotation-fields.ts');
      if (name.startsWith('@/app/')) return module(name.slice(2) + '.ts');
      throw Error('Forbidden test dependency ' + name);
    } }, { filename: endpoint });
  return exports;
}
const approved = (company = companies[0]) => ({ userId: 'owner', verifiedAccess: true, membership: { id: 'owner', email: 'synthetic-single@example.test', role: 'member', status: 'approved', companyCode: company.code, companyName: company.name } });
for (const company of companies) test(`actual GET/API/SQLite preserves explicit final values and untouched source/history (${company.code})`, async () => {
  const f = await apiFixture(company); try {
    const view = await json(await f.h.route(f.base + '/quotation-fields' + f.query));
    const byPath = wire => view.resolved.schema.fields.find(field => JSON.stringify(field.hubWire?.path) === JSON.stringify(wire) && field.hubWire?.name === undefined).id;
    const changes = [
      { fieldKey: byPath(['startPage', 'productName']), optionId: 'synthetic-one', value: '명시 저장 상품명' },
      { fieldKey: byPath(['productPage', 'modelNumber']), optionId: 'synthetic-one', value: '' },
      { fieldKey: byPath(['productPage', 'commonAttributes', 'purchasePrice']), optionId: 'synthetic-one', value: '11960' },
      { fieldKey: byPath(['productPage', 'commonAttributes', 'coupangSalePrice']), optionId: 'synthetic-one', value: '19930' },
      { fieldKey: byPath(['productPage', 'commonAttributes', 'msrp']), optionId: 'synthetic-one', value: '25910' },
    ];
    await json(await f.h.route(f.base + '/quotation-fields' + f.query, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes } }));
    const before = f.state(), beforeObjects = JSON.stringify([...f.h.objects]), beforeModels = f.h.aiSources.length;
    let puts = 0; const originalPut = f.h.bindings.FILES.put; f.h.bindings.FILES.put = async (...args) => { puts++; return originalPut(...args); };
    const response = await f.h.route(f.base + '/supplier-hub-document' + f.query), out = await json(response), document = out.payload.jsonDocument[0];
    assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(out.requestedProfileId, f.profile.id); assert.equal(out.productId, f.id);
    assert.equal(out.payload.productName, '명시 저장 상품명'); assert.equal(document.startPage.productName, '명시 저장 상품명'); assert.equal(document.productPage.modelNumber, '');
    assert.equal(document.productPage.commonAttributes.purchasePrice, '11960'); assert.equal(document.productPage.commonAttributes.coupangSalePrice, '19930'); assert.equal(document.productPage.commonAttributes.msrp, '25910');
    assert.deepEqual(plain(out.company), company); assert.equal(out.payload.categoryId, 765432); assert.equal(out.payload.displayCategoryCode, '81452');
    assert.equal(out.payload.docId, null); assert.equal(out.registered, false); assert.equal(out.remoteWrites, false); assert.equal(out.submissionReady, false); assert.equal(out.humanAgreementsConfirmed, false);
    assert.ok(out.review.unresolvedImages.length >= 2); assert.ok(!JSON.stringify(out.payload).includes('owner/main.png'));
    assert.ok(out.review.fields.some(field => field.source === 'manual-option' && field.savedValue === ''));
    const repeat = await json(await f.h.route(f.base + '/supplier-hub-document' + f.query + '&expectedFingerprint=' + out.fingerprint));
    assert.equal(repeat.fingerprint, out.fingerprint); assert.equal(f.state(), before); assert.equal(JSON.stringify([...f.h.objects]), beforeObjects);
    assert.equal(puts, 0); assert.equal(f.h.aiSources.length, beforeModels); assert.deepEqual(f.h.network, []);
    assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) AS total FROM supplier_hub_receipts').get().total, 0);
  } finally { f.close(); }
});
test('GET rejects a foreign owner and a changed company; no seller or existing row changes', async () => {
  const f = await apiFixture(); try {
    f.h.sqlite.prepare('UPDATE products SET owner_id=? WHERE id=?').run('foreign-owner', f.id); const before = f.state();
    await json(await f.h.route(f.base + '/supplier-hub-document' + f.query), 404); assert.equal(f.state(), before);
    f.h.sqlite.prepare('UPDATE products SET owner_id=? WHERE id=?').run('owner', f.id); f.h.setCompany(companies[1]); const switched = f.state();
    await json(await f.h.route(f.base + '/supplier-hub-document' + f.query), 409); assert.equal(f.state(), switched); assert.deepEqual(f.h.network, []);
  } finally { f.close(); }
});
test('GET only: POST has no exported handler; malformed/duplicate/unknown query never reads a product', async () => {
  const f = await apiFixture(); try {
    const route = f.h.load(endpoint); assert.deepEqual(Object.keys(route), ['GET']);
    const response = await route.GET(new Request('https://app.test' + f.base + '/supplier-hub-document', { method: 'POST' }), { params: Promise.resolve({ id: f.id }) });
    assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET');
    for (const query of ['?profileId=', '?profileId=x&profileId=y', '?expectedFingerprint=bad', '?remoteWrite=true', '?expectedFingerprint=' + 'a'.repeat(64) + '&expectedFingerprint=' + 'a'.repeat(64)])
      await json(await f.h.route(f.base + '/supplier-hub-document' + query), 400);
  } finally { f.close(); }
});
test('wrong expected fingerprint, Excel-only profile and malformed original Single identity fail closed', async () => {
  const f = await apiFixture(); try {
    const before = f.state(); await json(await f.h.route(f.base + '/supplier-hub-document' + f.query + '&expectedFingerprint=' + 'a'.repeat(64)), 409); assert.equal(f.state(), before);
  } finally { f.close(); }
  const excel = syntheticSnapshot(); excel.metadata.scopeType = 'Retail_Categorized_Excel'; const raw = JSON.parse(excel.schemaString); raw.metadata = raw.metadata.replace('Retail_Categorized_Single', 'Retail_Categorized_Excel'); excel.schemaString = JSON.stringify(raw);
  const g = await apiFixture(companies[0], excel); try { const before = g.state(); const out = await json(await g.h.route(g.base + '/supplier-hub-document' + g.query), 409); assert.equal(out.code, 'SINGLE_IDENTITY'); assert.equal(g.state(), before); } finally { g.close(); }
});
test('source clocks, quote revisions and profile changes during preview invalidate returned data', async () => {
  for (const kind of ['product', 'quotation', 'profile']) {
    const f = await apiFixture(); try {
      const source = f.h.load('app/exports/quotation-source.ts'), read = source.readQuotationExportSource; let calls = 0, afterActor;
      source.readQuotationExportSource = async (...args) => {
        if (++calls === 2) {
          if (kind === 'product') f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2099-01-01T00:00:00.000Z', f.id);
          if (kind === 'quotation') {
            const current = f.h.sqlite.prepare('SELECT * FROM product_quotation_fields WHERE product_id=?').get(f.id);
            if (current) f.h.sqlite.prepare('UPDATE product_quotation_fields SET revision=revision+1 WHERE product_id=?').run(f.id);
            else {
              const view = await f.h.load('app/api/products/[id]/quotation-fields/route.ts').GET(new Request('https://app.test' + f.base + '/quotation-fields' + f.query), { params: Promise.resolve({ id: f.id }) });
              const data = await view.json(); assert.equal(view.status, 200);
              await json(await f.h.route(f.base + '/quotation-fields' + f.query, { method: 'PUT', body: { expectedRevision: data.revision, expectedInputFingerprint: data.inputFingerprint, changes: [{ fieldKey: 'model', optionId: 'synthetic-one', value: '' }] } }));
            }
          }
          if (kind === 'profile') f.h.sqlite.prepare('UPDATE category_profiles SET revision=revision+1 WHERE id=?').run(f.profile.id);
          afterActor = f.state();
        }
        return read(...args);
      };
      const out = await json(await f.h.route(f.base + '/supplier-hub-document' + f.query), 409); assert.equal(out.code, 'SINGLE_SOURCE_CHANGED'); assert.equal(f.state(), afterActor); assert.deepEqual(f.h.network, []);
    } finally { f.close(); }
  }
});
test('authentication/owner/approval and post-read membership changes cannot return another scope', async () => {
  const f = await apiFixture(); try {
    const context = { params: Promise.resolve({ id: f.id }) }, request = () => new Request('https://app.test' + f.base + '/supplier-hub-document' + f.query), before = f.state();
    await json(await scopeRoute(f, async () => null).GET(request(), context), 503);
    await json(await scopeRoute(f, async () => ({ ...approved(), userId: 'other-owner' })).GET(request(), context), 409);
    await json(await scopeRoute(f, async () => ({ ...approved(), membership: { ...approved().membership, id: 'same-company-other-owner' } })).GET(request(), context), 409);
    await json(await scopeRoute(f, async () => ({ ...approved(), membership: { ...approved().membership, status: 'pending' } })).GET(request(), context), 409);
    let calls = 0; const route = scopeRoute(f, async () => ++calls === 1 ? approved() : { ...approved(), membership: { ...approved().membership, role: 'admin' } });
    const out = await json(await route.GET(request(), context), 409); assert.equal(out.code, 'SINGLE_SOURCE_CHANGED'); assert.equal(f.state(), before);
  } finally { f.close(); }
});
test('same object auth scope mutation during read cannot alter the captured member identity', async () => {
  const f = await apiFixture(); try {
    const user = approved(), before = f.state(); let calls = 0;
    const route = scopeRoute(f, async () => { if (++calls === 2) user.membership.role = 'admin'; return user; });
    const out = await json(await route.GET(new Request('https://app.test' + f.base + '/supplier-hub-document' + f.query), { params: Promise.resolve({ id: f.id }) }), 409);
    assert.equal(out.code, 'SINGLE_SOURCE_CHANGED'); assert.equal(f.state(), before); assert.deepEqual(f.h.network, []);
  } finally { f.close(); }
});
const recorded = new URL('../outputs/step650-official-81452-profile-after.json', import.meta.url);
for (const company of companies) test(`actual read-only route with recorded 81452 Single wire contract and isolated synthetic company (${company.code})`, { skip: !fs.existsSync(recorded) }, async () => {
  // Only Unand is recorded. Waihop reuses that wire contract inside this isolated
  // synthetic fixture; this is not evidence of Waihop's live supplier schema.
  const saved = JSON.parse(fs.readFileSync(recorded, 'utf8')), snapshot = { ...saved.hubSchema, company: { ...company } }, f = await apiFixture(company, snapshot);
  try {
    const before = f.state(), out = await json(await f.h.route(f.base + '/supplier-hub-document' + f.query));
    assert.equal(out.payload.categoryId, 5562); assert.equal(out.payload.displayCategoryCode, '81452'); assert.equal(out.payload.version, 188); assert.equal(out.payload.productNoticeNumber, 25);
    assert.equal(out.review.fields.filter(field => field.path.length).length, 68); assert.equal(out.payload.jsonDocument.length, 1);
    assert.equal(out.payload.jsonDocument[0].legalPage.notices.length, 12); assert.equal(out.payload.jsonDocument[0].productPage.unexposedAttributes.length, 10);
    assert.ok(out.review.issues.some(issue => issue.level === 'error')); assert.equal(out.submissionReady, false); assert.equal(f.state(), before);
    assert.deepEqual(f.h.network, []); assert.equal(f.h.aiSources.length, 0); assert.equal(f.h.objects.size, 0);
  } finally { f.close(); }
});
