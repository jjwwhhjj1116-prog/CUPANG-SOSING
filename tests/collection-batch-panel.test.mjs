import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const steps = ['SEO', '가격', '대표 이미지', '추가 이미지', '상세 이미지', '표시사항', '견적서'];
function nodes(tree) { if (Array.isArray(tree)) return tree.flatMap(nodes); return tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : []; }
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
function harness(onOpenProduct, outcome = { status: 'completed', productId: 'saved-product', completedImages: 1 }) {
  const states = [], refs = [], cleanups = []; let index = 0, ri = 0, first = true, imports = 0;
  const hooks = { useState(initial) { const n = index++; if (n >= states.length) states.push(initial); return [states[n], value => { states[n] = typeof value === 'function' ? value(states[n]) : value; }]; }, useRef(initial) { const n = ri++; if (n >= refs.length) refs.push({ current: initial }); return refs[n]; }, useEffect(effect) { if (first) cleanups.push(effect()); } };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/collection-batch-panel.tsx', import.meta.url), 'utf8'), { fileName: 'panel.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, AbortController, Error, fetch: () => { throw Error('unexpected request'); }, require(name) {
    if (name === 'react') return hooks;
    if (name === '@/app/registration-navigation') return { registrationSteps: steps };
    if (name === '@/app/collection-batch') return { linkedReceivedJobs: () => [], pendingReceivedJobs: jobs => jobs, importReceivedJobs: async (jobs, options) => { imports++; options.onResult(jobs[0].id, outcome); } };
    return require(name);
  } });
  const render = () => { index = 0; ri = 0; const tree = exports.CollectionBatchPanel({ jobs: [{ id: 'job', offer_id: '123', source_url: 'https://detail.1688.com/offer/123.html' }], onSaved() {}, onOpenProduct }); first = false; return tree; };
  const button = name => { const item = nodes(render()).find(n => n.type === 'button' && n.props.children === name); assert.ok(item, name); return item; };
  return { render, button, get imports() { return imports; }, async start() { nodes(render()).find(n => n.type === 'button').props.onClick(); await settle(); }, unmount() { cleanups.forEach(fn => fn?.()); } };
}
test('all seven stages open the imported product without running the import again', async () => {
  const opened = []; const h = harness(async (id, tab) => opened.push([id, tab])); await h.start();
  for (const [i, step] of steps.entries()) { h.button(`${i + 1}. ${step}`).props.onClick(); await settle(); }
  assert.deepEqual(opened, steps.map(step => ['saved-product', step])); assert.equal(h.imports, 1);
});
test('partial image failure keeps saved product navigation; failed navigation is retryable', async () => {
  let fail = true, calls = 0; const h = harness(async () => { calls++; if (fail) throw Error('refresh failed'); }, { status: 'failed', productId: 'partial-product', completedImages: 1, error: 'image failed' });
  await h.start(); h.button('7. 견적서').props.onClick(); await settle();
  assert.match(JSON.stringify(h.render()), /refresh failed/); assert.equal(h.button('7. 견적서').props.disabled, false);
  fail = false; h.button('7. 견적서').props.onClick(); await settle(); assert.equal(calls, 2); assert.equal(h.imports, 1);
});
test('navigation coalesces clicks and aborts on unmount', async () => {
  let signal, calls = 0, release; const pending = new Promise(resolve => { release = resolve; });
  const h = harness(async (_id, _tab, current) => { calls++; signal = current; await pending; }); await h.start();
  const click = h.button('1. SEO').props.onClick; click(); click(); assert.equal(calls, 1);
  assert.equal(h.button('7. 견적서').props.disabled, true); h.unmount(); assert.equal(signal.aborted, true); release(); await settle();
});
test('failed import without a saved product never offers stage navigation', async () => {
  const h = harness(async () => { throw Error('must not open'); }, { status: 'failed', productId: null, completedImages: 0 }); await h.start();
  assert.equal(nodes(h.render()).some(n => n.type === 'nav'), false);
});
