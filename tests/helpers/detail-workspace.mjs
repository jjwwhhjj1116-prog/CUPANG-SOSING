import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';

const native = createRequire(import.meta.url);
export const plain = value => JSON.parse(JSON.stringify(value));
export const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
export const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
export const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
export function runtime(fetcher, modules = {}, storage = new Map()) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file); const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
      { exports, Error, Date, URL, URLSearchParams, Response, Headers, Blob, File, AbortController, AbortSignal, DOMException, TextEncoder, TextDecoder, Uint8Array, DataView,
        structuredClone, crypto: webcrypto, fetch: fetcher, sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
        require(name) { if (Object.hasOwn(modules, name)) return modules[name]; if (name.startsWith('@/')) return load(name.slice(2) + (name.includes('/components/') ? '.tsx' : '.ts'));
          if (name.startsWith('.')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts'); return native(name); } });
    return exports;
  }
  return { load, client: load('app/detail-workspace-client.ts'), model: load('app/detail-workspace.ts') };
}
export async function fixture(company = { code: 'A01464742', name: '와이홉' }) {
  const keys = ['owner/top.png', 'owner/one.png', 'owner/two.png', 'owner/bottom.png', 'owner/replacement.png'];
  const objects = new Map(); for (const [index, key] of keys.entries()) objects.set(key, await sharp({ create: { width: 20 + index, height: 10 + index, channels: 4, background: '#123456' } }).png().toBuffer());
  const fields = [{ id: 'additionalImages', type: 'images', maxItems: 30 }, { id: 'detailImages', type: 'images', maxItems: 30 }, { id: 'detailHtml', type: 'textarea', maxLength: 150000 }];
  const values = { additionalImages: '', detailImages: keys.slice(0, 4).join('\n'), detailHtml: ' <p>원래 수동 HTML</p> ' }, row = { optionId: 'red', included: true, optionLabel: '빨강', fields: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value, source: 'manual-option', issues: [] }])) };
  const view = { revision: 7, productVersion: '2026-10-16T00:00:00.000Z', contentRevision: 3, optionRevision: 2, inputFingerprint: 'a'.repeat(64), categoryContext: { source: 'profile', profileId: 'profile', categoryId: '81221', categoryPath: ['보관'] },
    imageKeys: keys, protectedDetailImageKeys: [keys[0], keys[3]], overrides: { common: {}, options: { red: values } }, automatic: { schema: { fields }, rows: [plain(row)] }, resolved: { schema: { fields }, rows: [row] } };
  const calls = [], f = { keys, objects, view, company, calls, workspace: null, storage: new Map() };
  f.reply = () => ({ view: plain(f.view), workspace: plain(f.workspace), roles: { top: [keys[0]], bottom: [keys[3]] } });
  f.request = async (url, init = {}) => {
    calls.push({ url, init, method: init.method ?? 'GET' });
    if (url.startsWith('/api/files/')) { const bytes = objects.get(url.slice('/api/files/'.length).split('/').map(decodeURIComponent).join('/')); return bytes ? new Response(bytes, { headers: { 'content-length': String(bytes.length) } }) : new Response(null, { status: 404 }); }
    assert.ok(url.includes('/detail-workspace?'), url);
    const query = new URL(url, 'https://fixture.test').searchParams;
    assert.equal(query.get('profileId'), 'profile');
    assert.equal(query.has('optionId'), (init.method ?? 'GET') === 'GET', 'actual route reserves optionId query for GET only');
    if ((init.method ?? 'GET') === 'PUT') {
      const body = JSON.parse(init.body), { model } = runtime(f.request), files = [];
      for (const key of model.detailWorkspaceFileKeys(body.document)) { const bytes = objects.get(key), metadata = await sharp(bytes).metadata(); files.push({ key, sha256: Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex'), bytes: bytes.length, width: metadata.width, height: metadata.height }); }
      const record = { format: 'detail-workspace-record-v1', productId: 'product', optionId: 'red', context: plain(f.view.categoryContext), company: plain(company), revision: body.expectedRevision + 1,
        updatedAt: '2026-10-16T00:00:01.000Z', requestId: body.requestId, document: body.document, files };
      f.workspace = { ...record, digest: await model.detailWorkspaceDigest(record) };
    }
    return Response.json(f.reply());
  };
  f.selection = () => ({ productId: 'product', optionId: 'red', profileId: 'profile', view: plain(f.view) });
  f.document = () => { const model = runtime(f.request).model, photos = keys.slice(0, 4).map((key, index) => ({ id: 'photo-' + index, originKey: key, key, role: index === 0 ? 'top' : index === 3 ? 'bottom' : 'body' })); return { format: 'detail-workspace-v1', photos, imageMargin: 0, generatedHtml: model.generateDetailWorkspaceHtml(photos, 0) }; };
  return f;
}
export function panel(f, request = f.request) {
  let cursor = 0, epoch = 0, closed = false, props = { ...f.selection(), stageActive: true, disabled: false }; const slots = [], layouts = [], effects = [], adopted = [], locks = [];
  const effect = (queue, fn, deps) => { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) { const next = { deps }; slots[index] = next; queue.push(() => { previous?.cleanup?.(); next.cleanup = fn(); }); } };
  const hooks = { useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, value => { assert.equal(closed, false, 'no late state write'); epoch++; slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }]; },
    useRef(value) { const index = cursor++; return slots[index] ?? (slots[index] = { current: value }); }, useEffect(fn, deps) { effect(effects, fn, deps); }, useLayoutEffect(fn, deps) { effect(layouts, fn, deps); } };
  const r = runtime(request, { react: hooks, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) } }, f.storage), Component = r.load('app/components/detail-workspace-panel.tsx').DetailWorkspaceForm;
  function render() { cursor = 0; const tree = Component({ ...props, onAdopt: keys => adopted.push(plain(keys)), onBusyChange: busy => locks.push(busy) }); layouts.splice(0).forEach(fn => fn()); effects.splice(0).forEach(fn => fn()); return tree; }
  const button = label => nodes(render()).find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node) === label));
  const control = label => nodes(render()).find(node => node.props?.['aria-label'] === label);
  async function idle() { let quiet = 0; const end = Date.now() + 5000; while (quiet < 3) { const before = epoch, count = f.calls.length; render(); await new Promise(resolve => setImmediate(resolve)); const tree = render(); if (epoch === before && count === f.calls.length && !tree.props['aria-busy']) quiet++; else quiet = 0; if (Date.now() > end) throw Error('workspace panel idle timeout'); } }
  return { render, button, control, idle, adopted, locks, props, set(value) { props = { ...props, ...value }; render(); }, async click(label) { const node = button(label); assert.ok(node && !node.props.disabled, label); node.props.onClick(); await idle(); }, async tick() { render(); await new Promise(resolve => setImmediate(resolve)); render(); }, close() { slots.forEach(slot => slot?.cleanup?.()); closed = true; } };
}
