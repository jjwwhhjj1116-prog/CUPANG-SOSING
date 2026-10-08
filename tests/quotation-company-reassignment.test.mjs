import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { hubSchemaSnapshot, schemaCompanies, schemaPath } from './helpers/hub-schema.mjs';

const json = async (response, status = 200) => {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
};

// Keep the real SQLite handlers and source guards; only this test's current
// approved membership can change. No shared harness or operating data changes.
function companyRoutes(h, initialCompany) {
  let company = initialCompany;
  const auth = {
    getChatGPTUser: async () => ({ verifiedAccess: true, userId: 'owner', membership: {
      id: 'owner', email: 'synthetic-company-test@example.test', role: 'member', status: 'approved',
      companyCode: company.code, companyName: company.name,
    } }),
    getWorkspaceOwnerId: async () => 'owner',
  };
  function load(file) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, Error, URL, TextEncoder, Uint8Array, Response, process: { env: { NODE_ENV: 'production' } },
      require(name) {
        if (name === '@/app/chatgpt-auth') return auth;
        if (name === 'cloudflare:workers') return { env: h.bindings };
        if (name === 'next/server') return { NextResponse: Response };
        if (name === '@/app/quotation-fields-snapshot') return load('app/quotation-fields-snapshot.ts');
        assert.ok(name.startsWith('@/'), name);
        return h.load(name.slice(2) + '.ts');
      },
    });
    return exports;
  }
  const fields = load('app/api/products/[id]/quotation-fields/route.ts');
  const exporter = load('app/exports/quotation-source.ts');
  return {
    setCompany(value) { company = value; h.setCompany(value); },
    exporter,
    request(productId, profileId, method = 'GET', body) {
      const url = `https://app.test/api/products/${productId}/quotation-fields${profileId ? '?profileId=' + profileId : ''}`;
      return fields[method](new Request(url, { method, headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }), { params: Promise.resolve({ id: productId }) });
    },
  };
}

const stored = h => JSON.stringify(Object.fromEntries([
  'products', 'product_content', 'product_options', 'product_price_policy', 'product_quotation_fields',
  'category_profiles', 'collection_jobs', 'collection_context', 'collection_products',
].map(table => [table, h.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])));

async function capturedProduct(h, company) {
  const hubSchema = { ...hubSchemaSnapshot(company), draftInitialization: 'couplus-required-v1', inputBindings: 'couplus-paths-v1', settingsInitialization: 'couplus-options-v1' };
  const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', {
    name: '합성 회사별 카테고리', categoryId: hubSchema.categoryId, categoryPath: schemaPath, hubSchema, template: null, mappings: [],
  });
  h.context.category = profile;
  h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context), 'job');
  await h.intake();
  const product = h.sqlite.prepare('SELECT * FROM products').get();
  assert.ok(product, 'recorded-source intake created its own test product');
  return { product, profile };
}

for (const company of schemaCompanies) test(`category quotation GET/PUT retain original records after approved-company reassignment (${company.code})`, async () => {
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name });
  try {
    const { product, profile } = await capturedProduct(h, company), api = companyRoutes(h, company);
    const before = await json(await api.request(product.id));
    const saved = await json(await api.request(product.id, undefined, 'PUT', {
      expectedRevision: before.revision, expectedInputFingerprint: before.inputFingerprint,
      changes: [{ optionId: null, fieldKey: 'title', value: '원래 회사의 검토 상품명' }],
    }));
    assert.equal(saved.overrides.common.title, '원래 회사의 검토 상품명');
    const original = stored(h), objectKeys = [...h.objects.keys()];
    api.setCompany(schemaCompanies.find(value => value.code !== company.code));
    for (const selected of [undefined, profile.id]) {
      const rejected = await json(await api.request(product.id, selected), 409);
      assert.equal(rejected.code, 'QUOTATION_COMPANY_MISMATCH');
      assert.match(rejected.error, /현재 로그인 회사와 다릅니다/);
      const write = await json(await api.request(product.id, selected, 'PUT', {
        expectedRevision: saved.revision, expectedInputFingerprint: saved.inputFingerprint,
        changes: [{ optionId: null, fieldKey: 'title', value: '새 회사로 바꾸면 안 되는 상품명' }],
      }), 409);
      assert.equal(write.code, 'QUOTATION_COMPANY_MISMATCH');
      await assert.rejects(() => api.exporter.readQuotationExportSource('owner', product.id, selected ?? null), /현재 로그인 회사와 다릅니다/);
      assert.equal(stored(h), original, 'company rejection changes no source, manual override, or product clock');
      assert.deepEqual([...h.objects.keys()], objectKeys);
    }
    api.setCompany(company);
    const resumed = await json(await api.request(product.id, profile.id));
    assert.equal(resumed.overrides.common.title, '원래 회사의 검토 상품명');
    assert.equal(resumed.revision, saved.revision);
    assert.equal(resumed.productVersion, saved.productVersion);
  } finally { h.close(); }
});

test('explicit quotation profile checks its current company as well as the frozen collection company', async () => {
  const company = schemaCompanies[0], h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name });
  try {
    const { product, profile } = await capturedProduct(h, company), api = companyRoutes(h, company);
    const current = await json(await api.request(product.id, profile.id));
    const other = schemaCompanies[1], payload = JSON.parse(h.sqlite.prepare('SELECT payload FROM category_profiles WHERE id=?').get(profile.id).payload);
    payload.hubSchema.company = other;
    h.sqlite.prepare('UPDATE category_profiles SET payload=?,revision=revision+1 WHERE id=?').run(JSON.stringify(payload), profile.id);
    const original = stored(h);
    assert.equal((await api.request(product.id)).status, 200, 'the original frozen schema remains valid for its approved company');
    const read = await json(await api.request(product.id, profile.id), 409);
    assert.equal(read.code, 'QUOTATION_COMPANY_MISMATCH');
    const write = await json(await api.request(product.id, profile.id, 'PUT', {
      expectedRevision: current.revision, expectedInputFingerprint: current.inputFingerprint,
      changes: [{ optionId: null, fieldKey: 'title', value: '현재 다른 회사 양식으로 저장 금지' }],
    }), 409);
    assert.equal(write.code, 'QUOTATION_COMPANY_MISMATCH');
    assert.equal(stored(h), original);
  } finally { h.close(); }
});
