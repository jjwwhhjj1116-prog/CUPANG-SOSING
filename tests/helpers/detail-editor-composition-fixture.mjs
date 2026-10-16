import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';
import { createRequire } from 'node:module';
import { createHash, webcrypto } from 'node:crypto';

const context = { assert, fs, path, vm, ts, sharp, createRequire, createHash, webcrypto, URL, URLSearchParams,
  Response, Headers, Blob, File, Buffer, AbortController, AbortSignal, DOMException, TextEncoder, TextDecoder, Uint8Array, DataView,
  structuredClone, setTimeout, clearTimeout, setImmediate };
function declarations(name, result, transform = value => value) {
  const url = new URL('../' + name, import.meta.url), source = fs.readFileSync(url, 'utf8');
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true), statements = [];
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement)) continue;
    if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(ast) === 'test') break;
    statements.push(statement.getText(ast));
  }
  // Reuse only pure fixture/hook declarations, never import registered suites.
  const code = transform(statements.join('\n')).replaceAll('import.meta.url', JSON.stringify(url.href));
  return vm.runInNewContext(code + '\n(' + result + ')', { ...context });
}
const base = declarations('detail-editor-inputs-client.test.mjs', '{fixture,loadClient}');
const ui = declarations('detail-editor-inputs-panel.test.mjs', '{panel,nodes,text,deferred}', source => {
  source = source.replace(/const fixtureUrl = [\s\S]+?(?=function panel\()/u, '');
  const marker = 'return Response.json(f.view);';
  assert.equal(source.split(marker).length, 2, 'one synthetic PUT response seam');
  return source.replace(marker, 'return f.afterPut ? f.afterPut(f.view) : Response.json(f.view);');
});
export const loadClient = base.loadClient, panel = ui.panel, nodes = ui.nodes, text = ui.text, deferred = ui.deferred;
export const plain = value => JSON.parse(JSON.stringify(value));
export const selection = f => ({ productId: 'product', optionId: 'red', profileId: 'profile', view: f.view });
export const reopenComposition = '저장 전 사진·HTML로 편집';
export async function compositionFixture({ html = '<p> 저장 전 원문\r\n&amp; </p>', duplicate = false } = {}) {
  const f = await base.fixture({ duplicate }), originalRequest = f.request;
  f.view.categoryContext.source = 'profile';
  f.view.detailEditorInputs.origin.productId = 'product';
  f.view.detailEditorInputs.origin.sourceOptionId = 'red';
  for (const id of ['detailHtml', 'wire-detail-html']) {
    f.view.overrides.options.red[id] = '';
    f.view.resolved.rows.find(row => row.optionId === 'red').fields[id].value = '';
    f.view.automatic.rows.find(row => row.optionId === 'red').fields[id].value = '';
  }
  f.composition = { format: 'saved-detail-composition-v1', inputs: plain(f.view.detailEditorInputs),
    html: { fieldKey: 'wire-detail-html', effective: html,
      rawCommon: { detailHtml: null, 'wire-detail-html': '' }, rawOption: { detailHtml: html, 'wire-detail-html': html } } };
  f.compositionReads = 0;
  f.reply = () => ({ source: { productId: 'product', profileId: 'profile', optionId: 'red', productVersion: f.view.productVersion,
    contentRevision: f.view.contentRevision, optionRevision: f.view.optionRevision, revision: f.view.revision,
    inputFingerprint: f.view.inputFingerprint, categoryContext: plain(f.view.categoryContext) }, composition: plain(f.composition) });
  f.request = async (url, init = {}) => {
    if (url.includes('/detail-save?')) {
      f.calls.push({ url, method: init.method ?? 'GET', signal: init.signal, cache: init.cache });
      assert.equal(init.method ?? 'GET', 'GET', 'composition read must not mutate'); f.compositionReads++;
      return Response.json(f.reply());
    }
    return originalRequest(url, init);
  };
  return f;
}
