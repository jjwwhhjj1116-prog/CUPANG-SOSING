import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { companies, json } from './helpers/image-download-ui.mjs';
import { loadComposite } from './helpers/detail-image-composite.mjs';

// Reuse actual image upload/detail-save routes and SQLite, without registering
// the older suite again or replacing its legacy-default assertions.
const url = new URL('./detail-save-client.test.mjs', import.meta.url), source = fs.readFileSync(url, 'utf8'),
  ast = ts.createSourceFile('detail-save-client.test.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), declarations = [];
for (const statement of ast.statements) {
  if (ts.isImportDeclaration(statement)) {
    const name = statement.moduleSpecifier.text, resolved = name.startsWith('.') ? new URL(name, url).href : import.meta.resolve(name);
    declarations.push(statement.getText(ast).replace(statement.moduleSpecifier.getText(ast), JSON.stringify(resolved)));
  } else if (ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement)) declarations.push(statement.getText(ast));
  else break;
}
const { fixture } = await import('data:text/javascript,' + encodeURIComponent(declarations.join('\n') + '\nexport { fixture };'));
const options = { editorPolicy: 'ordered-inputs-html-v1' }, signal = () => new AbortController().signal;
const mutations = f => f.calls.filter(call => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(call.init.method));
const plain = value => JSON.parse(JSON.stringify(value));
async function prepare(f) {
  const runtime = loadComposite(f), client = runtime.load('app/detail-save-client.ts'), model = runtime.load('app/detail-editor-composition.ts');
  const prepared = await runtime.helper.prepareDetailComposite({ productId: f.product.id, optionId: f.optionId,
    profileId: f.view.categoryContext.profileId, view: f.view }, signal(), f.request);
  return { client, model, prepared };
}
async function html(f, value) {
  const target = f.api.load('app/quotation-image-targets.ts').optionImageTargets(f.view.resolved.schema.fields).detailHtml;
  f.view = await json(await f.api.route(f.base + '/quotation-fields?profileId=' + f.view.categoryContext.profileId, { method: 'PUT', body: {
    expectedRevision: f.view.revision, expectedInputFingerprint: f.view.inputFingerprint,
    changes: target.linked.map(fieldKey => ({ fieldKey, optionId: f.optionId, value })),
  } }));
}

for (const company of companies) test(`explicit editor policy stores exact source HTML and ordered inputs with a verified response digest (${company.companyCode})`, async () => {
  const f = await fixture(company);
  try {
    const { client, model, prepared } = await prepare(f), attempt = {}, expectedHtml = model.detailSaveEditorHtml(f.view, f.optionId);
    const saved = await client.applyDetailSave(prepared, attempt, signal(), f.request, options);
    const post = mutations(f).filter(call => call.url.includes('/detail-save'));
    assert.equal(post.length, 1); assert.equal(JSON.parse(post[0].init.body).editorPolicy, options.editorPolicy);
    assert.deepEqual(Object.keys(JSON.parse(post[0].init.body)).sort(), ['bytes', 'editorPolicy', 'expectedInputFingerprint', 'expectedRevision', 'sha256', 'sourceOptionId', 'textPolicy', 'uploadId'].sort());
    const state = JSON.parse(f.api.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload), backup = Object.values(state.detailSaveBackups).flat()[0];
    assert.equal(backup.receipt.editorPolicy, options.editorPolicy); assert.equal(backup.receipt.editorSha256, await model.detailSaveEditorSha256(backup.editor));
    assert.deepEqual(backup.editor.html, plain(expectedHtml)); assert.deepEqual(backup.editor.context, plain(f.view.categoryContext));
    assert.deepEqual(backup.editor.company, { code: company.companyCode, name: company.companyName });
    assert.deepEqual(backup.sources, plain(prepared.sources)); assert.equal(saved.overrides.options[f.optionId].detailHtml, '');
    assert.equal(attempt.completed, saved); const count = mutations(f).length;
    assert.equal(await client.recoverDetailSave(prepared, attempt, signal(), f.request, options), 'completed');
    assert.equal(mutations(f).length, count); assert.equal(Object.values(state.detailSaveBackups).flat().length, 1);
  } finally { f.api.close(); }
});

for (const value of ['', '  \n\t ', null]) test(`editor snapshot preserves literal ${value === null ? 'inherited' : JSON.stringify(value)} HTML without confusing absence and blank`, async () => {
  const f = await fixture(companies[0]);
  try {
    await html(f, value); const { client, model, prepared } = await prepare(f), expected = model.detailSaveEditorHtml(f.view, f.optionId), attempt = {};
    await client.applyDetailSave(prepared, attempt, signal(), f.request, options);
    const state = JSON.parse(f.api.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload), backup = Object.values(state.detailSaveBackups).flat()[0];
    assert.equal(backup.editor.html.effective, expected.effective); if (value !== null) assert.equal(expected.effective, value);
    assert.equal(backup.before.find(change => change.optionId === f.optionId && change.fieldKey === expected.fieldKey).value, value);
    assert.equal(backup.receipt.editorSha256, await model.detailSaveEditorSha256(backup.editor));
  } finally { f.api.close(); }
});

const corruptions = {
  missingPolicy(body) { delete body.receipt.editorPolicy; }, wrongPolicy(body) { body.receipt.editorPolicy = 'other-policy'; },
  missingHash(body) { delete body.receipt.editorSha256; }, wrongHash(body) { body.receipt.editorSha256 = 'a'.repeat(64); },
  missingEditor(body) { delete body.editor; }, html(body) { body.editor.html.effective = '다른 HTML'; },
  field(body) { body.editor.html.fieldKey = 'unrelated-field'; }, context(body) { body.editor.context.profileId = 'different-profile'; },
  company(body) { body.editor.company.code = 'unrecognized-company'; }, extra(body) { body.editor.unreviewed = true; },
};
for (const [name, corrupt] of Object.entries(corruptions)) test(`a ${name} editor ACK remains uncertain and only exact read-only recovery completes it`, async () => {
  const f = await fixture(companies[1]);
  try {
    const { client, model, prepared } = await prepare(f), attempt = {};
    const request = async (path, init = {}) => {
      const response = await f.request(path, init);
      if (path.includes('/detail-save') && init.method === 'POST' && response.ok) {
        const body = await response.json(); assert.ok(body.editor && body.receipt.editorPolicy); corrupt(body);
        // A self-consistent digest still cannot authorize another source HTML,
        // field or category/profile. Those must match the reviewed view too.
        if (['html', 'field', 'context'].includes(name)) body.receipt.editorSha256 = await model.detailSaveEditorSha256(body.editor);
        return Response.json(body);
      }
      return response;
    };
    await assert.rejects(client.applyDetailSave(prepared, attempt, signal(), request, options));
    assert.equal(attempt.pending, 'save'); assert.equal(attempt.completed, undefined);
    const retained = f.retained(), count = mutations(f).length, start = f.calls.length;
    assert.equal(await client.recoverDetailSave(prepared, attempt, signal(), f.request, options), 'completed');
    assert.equal(f.retained(), retained); assert.equal(mutations(f).length, count);
    assert.ok(f.calls.slice(start).every(call => (call.init.method ?? 'GET') === 'GET'));
    assert.equal(mutations(f).filter(call => call.url.includes('/detail-save')).length, 1);
  } finally { f.api.close(); }
});

test('canonical editor hashing accepts response property order changes without changing the captured literal values', async () => {
  const f = await fixture(companies[0]);
  try {
    const { client, prepared } = await prepare(f), attempt = {};
    await client.applyDetailSave(prepared, attempt, signal(), async (path, init = {}) => {
      const response = await f.request(path, init);
      if (path.includes('/detail-save') && init.method === 'POST' && response.ok) {
        const body = await response.json(), editor = body.editor;
        body.editor = { html: { effective: editor.html.effective, fieldKey: editor.html.fieldKey }, company: { name: editor.company.name, code: editor.company.code },
          context: { categoryPath: editor.context.categoryPath, categoryId: editor.context.categoryId, profileId: editor.context.profileId, source: editor.context.source }, format: editor.format };
        return Response.json(body);
      }
      return response;
    }, options);
    assert.ok(attempt.completed); assert.equal(attempt.pending, undefined);
  } finally { f.api.close(); }
});

test('editor policy and saved HTML are bound before uploads; old pending attempts cannot be upgraded or downgraded', async () => {
  const f = await fixture(companies[0]);
  try {
    const { client, prepared } = await prepare(f);
    for (const mode of ['missing', 'read-only', 'too-long', 'category']) {
      const input = { ...prepared, view: plain(prepared.view) }, target = f.api.load('app/quotation-image-targets.ts').optionImageTargets(input.view.resolved.schema.fields).detailHtml;
      if (mode === 'missing') delete input.view.resolved.rows.find(row => row.optionId === f.optionId).fields[target.primary];
      if (mode === 'read-only') input.view.resolved.schema.fields.find(field => field.id === target.primary).readOnly = true;
      if (mode === 'too-long') input.view.resolved.rows.find(row => row.optionId === f.optionId).fields[target.primary].value = 'x'.repeat(150001);
      if (mode === 'category') input.view.categoryContext.categoryId = null;
      let calls = 0; await assert.rejects(client.applyDetailSave(input, {}, signal(), async () => { calls++; throw Error('must reject before fetching'); }, options)); assert.equal(calls, 0);
    }
    for (const selected of [{}, { editorPolicy: 'unsupported' }, { editorPolicy: options.editorPolicy, extra: true }, null]) {
      let calls = 0; await assert.rejects(client.applyDetailSave(prepared, {}, signal(), async () => { calls++; throw Error('unsupported policy must not fetch'); }, selected)); assert.equal(calls, 0);
    }
    for (const originalPolicy of [undefined, options]) {
      const attempt = {}; let calls = 0;
      await assert.rejects(client.applyDetailSave(prepared, attempt, signal(), async () => { calls++; throw Error('stop after binding'); }, originalPolicy));
      attempt.pending = 'save';
      const count = calls;
      await assert.rejects(client.recoverDetailSave(prepared, attempt, signal(), async () => { calls++; throw Error('identity changed'); }, originalPolicy ? undefined : options));
      assert.equal(calls, count); assert.equal(attempt.pending, 'save'); assert.equal(attempt.completed, undefined);
    }
  } finally { f.api.close(); }
});

test('legacy default bodies and receipts remain legacy even if an ACK attempts to add an unreviewed editor policy', async () => {
  const f = await fixture(companies[0]);
  try {
    const { client, model, prepared } = await prepare(f), attempt = {};
    await assert.rejects(client.applyDetailSave(prepared, attempt, signal(), async (path, init = {}) => {
      const response = await f.request(path, init);
      if (path.includes('/detail-save') && init.method === 'POST' && response.ok) {
        assert.equal(Object.hasOwn(JSON.parse(init.body), 'editorPolicy'), false);
        const body = await response.json(); assert.equal(body.receipt.editorPolicy, undefined); assert.equal(body.editor, undefined);
        body.editor = model.createDetailSaveEditorSnapshot(f.view, f.optionId, { code: companies[0].companyCode, name: companies[0].companyName });
        body.receipt.editorPolicy = options.editorPolicy; body.receipt.editorSha256 = await model.detailSaveEditorSha256(body.editor);
        return Response.json(body);
      }
      return response;
    }));
    assert.equal(attempt.pending, 'save'); const count = mutations(f).length, start = f.calls.length;
    assert.equal(await client.recoverDetailSave(prepared, attempt, signal(), f.request), 'completed');
    assert.equal(mutations(f).length, count); assert.ok(f.calls.slice(start).every(call => (call.init.method ?? 'GET') === 'GET'));
    const state = JSON.parse(f.api.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload), backup = Object.values(state.detailSaveBackups).flat()[0];
    assert.equal(backup.receipt.editorPolicy, undefined); assert.equal(backup.editor, undefined);
  } finally { f.api.close(); }
});

test('abort before work allocates nothing; abort after a committed save retains uncertainty until GET-only recovery', async () => {
  const f = await fixture(companies[1]);
  try {
    const { client, prepared } = await prepare(f), before = new AbortController(); before.abort(); let calls = 0;
    await assert.rejects(client.applyDetailSave(prepared, {}, before.signal, async () => { calls++; }, options)); assert.equal(calls, 0);
    const after = new AbortController(), attempt = {};
    await assert.rejects(client.applyDetailSave(prepared, attempt, after.signal, async (path, init = {}) => {
      const response = await f.request(path, init); if (path.includes('/detail-save') && init.method === 'POST') { assert.equal(response.status, 200); after.abort(); } return response;
    }, options));
    assert.equal(attempt.pending, 'save'); assert.equal(attempt.completed, undefined);
    const count = mutations(f).length, start = f.calls.length;
    assert.equal(await client.recoverDetailSave(prepared, attempt, signal(), f.request, options), 'completed');
    assert.equal(mutations(f).length, count); assert.ok(f.calls.slice(start).every(call => (call.init.method ?? 'GET') === 'GET'));
  } finally { f.api.close(); }
});
