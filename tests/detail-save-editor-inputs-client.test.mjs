import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { companies } from './helpers/image-download-ui.mjs';
import { loadComposite } from './helpers/detail-image-composite.mjs';

// Reuse only the existing complete API/SQLite fixture declarations. Importing
// its registered tests here would duplicate their execution and test counts.
const sourceUrl = new URL('./detail-save-client.test.mjs', import.meta.url), source = fs.readFileSync(sourceUrl, 'utf8');
const ast = ts.createSourceFile('detail-save-client.test.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), declarations = [];
for (const statement of ast.statements) {
  if (ts.isImportDeclaration(statement)) {
    const name = statement.moduleSpecifier.text, resolved = name.startsWith('.') ? new URL(name, sourceUrl).href : import.meta.resolve(name);
    declarations.push(statement.getText(ast).replace(statement.moduleSpecifier.getText(ast), JSON.stringify(resolved)));
  } else if (ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement)) declarations.push(statement.getText(ast));
  else break;
}
const { fixture } = await import('data:text/javascript,' + encodeURIComponent(declarations.join('\n') + '\nexport { fixture };'));
const signal = () => new AbortController().signal;
const plain = value => JSON.parse(JSON.stringify(value));
const prepare = (f, runtime) => runtime.helper.prepareDetailComposite({ productId: f.product.id, optionId: f.optionId, profileId: f.view.categoryContext.profileId, view: f.view }, signal(), f.request);
const mutations = f => f.calls.filter(call => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(call.init.method));

for (const company of companies) test(`actual detail-save client accepts only its exact owned sealed inputs and confirms current saved view (${company.companyCode})`, async () => {
  const f = await fixture(company);
  try {
    const runtime = loadComposite(f), client = runtime.load('app/detail-save-client.ts'), prepared = await prepare(f, runtime), attempt = {}, before = f.retained();
    assert.equal(f.retained(), before);
    const saved = await client.applyDetailSave(prepared, attempt, signal(), f.request), doc = saved.detailEditorInputs;
    assert.deepEqual(doc, { format: 'saved-detail-inputs-v1', categoryId: f.view.categoryContext.categoryId,
      origin: { productId: f.product.id, sourceOptionId: f.optionId, uploadId: prepared.uploadId, revision: saved.revision },
      output: { key: attempt.key, sha256: prepared.sha256, bytes: prepared.output.size }, images: plain(prepared.sources) });
    assert.ok(doc.images.every(image => image.key.startsWith('owner/'))); assert.equal(attempt.pending, undefined); assert.equal(attempt.completed, saved);
    const count = mutations(f).length; assert.equal(await client.recoverDetailSave(prepared, attempt, signal(), f.request), 'completed'); assert.equal(mutations(f).length, count);
    assert.equal(f.calls.filter(call => call.url.includes('/detail-save') && call.init.method === 'POST').length, 1);
  } finally { f.api.close(); }
});

const corruptions = {
  owner(doc) { doc.images[0].key = 'other-company/file.png'; },
  product(doc) { doc.origin.productId = 'another-valid-product'; },
  option(doc) { doc.origin.sourceOptionId = 'another-valid-option'; },
  category(doc) { doc.categoryId = '991234'; },
  revision(doc) { doc.origin.revision++; },
  order(doc) { doc.images.reverse(); },
  digest(doc) { doc.images[0].sha256 = 'a'.repeat(64); },
  dimensions(doc) { doc.images[0].width++; },
  output(doc) { doc.output.bytes++; },
  extra(doc) { doc.unprovedTranslation = true; },
};
for (const [name, corrupt] of Object.entries(corruptions)) test(`a ${name} saved-inputs ACK remains uncertain until GET proves the actual ordinary save`, async () => {
  const f = await fixture(companies[name.length % companies.length]);
  try {
    const runtime = loadComposite(f), client = runtime.load('app/detail-save-client.ts'), prepared = await prepare(f, runtime), attempt = {};
    const request = async (url, init = {}) => {
      const response = await f.request(url, init);
      if (url.includes('/detail-save') && init.method === 'POST' && response.ok) {
        const body = await response.json(); assert.ok(body.quotation.detailEditorInputs); corrupt(body.quotation.detailEditorInputs); return Response.json(body);
      }
      return response;
    };
    await assert.rejects(client.applyDetailSave(prepared, attempt, signal(), request)); assert.equal(attempt.pending, 'save'); assert.equal(attempt.completed, undefined);
    const after = f.retained(), count = mutations(f).length, readsStart = f.calls.length;
    assert.equal(await client.recoverDetailSave(prepared, attempt, signal(), f.request), 'completed'); assert.equal(f.retained(), after); assert.equal(mutations(f).length, count);
    assert.ok(f.calls.slice(readsStart).every(call => (call.init.method ?? 'GET') === 'GET'));
    assert.deepEqual(attempt.completed.detailEditorInputs.images, plain(prepared.sources));
    const stored = JSON.parse(f.api.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload);
    assert.equal(stored.detailSaveBackups['category:80719'].length, 1); assert.equal(f.calls.filter(call => call.url.includes('/detail-save') && call.init.method === 'POST').length, 1);
  } finally { f.api.close(); }
});

test('a compatible older server may omit optional saved-inputs metadata consistently without inventing a document', async () => {
  const f = await fixture(companies[0]);
  try {
    const request = async (url, init = {}) => {
      const response = await f.request(url, init);
      if (response.ok && (url.includes('/quotation-fields') || url.includes('/detail-save'))) {
        const body = await response.json(); if (body.quotation) delete body.quotation.detailEditorInputs; else delete body.detailEditorInputs; return Response.json(body);
      }
      return response;
    };
    const runtime = loadComposite(f), client = runtime.load('app/detail-save-client.ts'), prepared = await prepare(f, runtime), attempt = {};
    const saved = await client.applyDetailSave(prepared, attempt, signal(), request); assert.equal(saved.detailEditorInputs, undefined); assert.equal(attempt.completed, saved);
    const count = mutations(f).length; assert.equal(await client.recoverDetailSave(prepared, attempt, signal(), request), 'completed'); assert.equal(mutations(f).length, count);
  } finally { f.api.close(); }
});
