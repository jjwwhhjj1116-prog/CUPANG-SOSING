import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

const file = new URL('../detail-save-api.test.mjs', import.meta.url), source = fs.readFileSync(file, 'utf8'),
  ast = ts.createSourceFile('detail-save-api.test.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), declarations = [];
for (const statement of ast.statements) {
  if (ts.isImportDeclaration(statement)) {
    const name = statement.moduleSpecifier.text, resolved = name.startsWith('.') ? new URL(name, file).href : import.meta.resolve(name);
    declarations.push(statement.getText(ast).replace(statement.moduleSpecifier.getText(ast), JSON.stringify(resolved)));
  } else if (ts.isVariableStatement(statement) || ts.isFunctionDeclaration(statement)) declarations.push(statement.getText(ast));
  else break;
}
const { fixture } = await import('data:text/javascript,' + encodeURIComponent(declarations.join('\n') + '\nexport {fixture};'));
export const json = async response => {
  if (response.status !== 200) throw Error(`Fixture response ${response.status}: ${await response.text()}`);
  return response.json();
};
export async function detailEditorCompositionFixture(company, options = {}) {
  const f = await fixture(company, options);
  // Route calls use actual SQLite/R2-backed application handlers, not a second
  // copy of registered tests from the source fixture.
  const view = async () => json(await f.api.route(f.qurl));
  const prepare = async () => f.runtime.helper.prepareDetailComposite({ productId: f.product.id, optionId: f.optionId,
    profileId: f.view.categoryContext.profileId, view: await view() }, new AbortController().signal, f.request);
  const set = async changes => {
    const before = await view(); return json(await f.api.route(f.qurl, { method: 'PUT', body: { expectedRevision: before.revision, expectedInputFingerprint: before.inputFingerprint, changes } }));
  };
  const restore = (optionId = f.optionId, extras = '') => f.request(f.endpoint + '&editor=saved-composition-v1&optionId=' + encodeURIComponent(optionId) + extras);
  const state = () => JSON.parse(f.api.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(f.product.id).payload);
  const writeState = value => f.api.sqlite.prepare('UPDATE product_quotation_fields SET payload=? WHERE product_id=?').run(JSON.stringify(value), f.product.id);
  const save = async (overrides = {}) => {
    const prepared = await prepare(), body = { ...await f.upload(prepared), textPolicy: 'couplus-detail-alt-v1', editorPolicy: 'ordered-inputs-html-v1', ...overrides };
    return { prepared, body, response: await f.post(body) };
  };
  return { ...f, initialView: f.view, view, prepare, set, restore, state, writeState, save };
}

/** Isolated authentication facade for testing an identity change during an
 * awaited R2 read. All non-auth dependencies remain the actual API harness. */
export function compositionRouteWithIdentity(f, user) {
  const exports = {}, route = fs.readFileSync(new URL('../../app/api/products/[id]/detail-save/route.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(route, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Error, URL, Date, TextEncoder, TextDecoder, Uint8Array, Request, Response, Headers, structuredClone, crypto,
      require(name) {
        if (name === '@/app/chatgpt-auth') return { getChatGPTUser: async () => user.current, getWorkspaceOwnerId: async () => 'owner' };
        if (name === 'cloudflare:workers') return { env: f.api.bindings };
        if (name === 'next/server') return { NextResponse: Response };
        if (!name.startsWith('@/')) throw Error(name);
        return f.api.load(name.slice(2) + '.ts');
      } });
  return exports;
}
