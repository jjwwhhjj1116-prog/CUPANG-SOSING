import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { fixture, runtime, plain, nodes, text } from './detail-workspace.mjs';
export { plain, nodes, text };
const native = createRequire(import.meta.url);
export async function compositeFixture(company) {
  const f = await fixture(company), base = plain(f.view.resolved.rows[0]);
  f.view.resolved.schema.fields.push({ id: 'altText', type: 'text', maxLength: 20000 });
  f.view.automatic.schema = plain(f.view.resolved.schema);
  const common = { ...plain(base), optionId: null, optionLabel: '공통', fields: { ...plain(base.fields), altText: { value: '  ', source: 'manual-common', issues: [] } } };
  base.fields.altText = { value: 'old red ALT', source: 'manual-option', issues: [] };
  const blue = { ...plain(base), optionId: 'blue', included: false, optionLabel: '파랑' }; blue.fields.altText.value = 'old excluded ALT';
  f.view.resolved.rows = [common, base, blue]; f.view.automatic.rows = plain(f.view.resolved.rows);
  f.view.overrides.common = { altText: '  ', detailHtml: '' };
  f.view.overrides.options.blue = { detailHtml: '', altText: 'old excluded ALT' };
  f.view.overrides.options.red.altText = 'old red ALT';
  f.view.detailSaveTextBasis = { policy: 'couplus-detail-alt-v1', productName: '원본 상품', metaDescription: '상세 설명', optionNames: { red: '빨강', blue: '파랑' } };
  const r = runtime(f.request), selection = f.selection(), saved = await r.client.readDetailWorkspace(selection, new AbortController().signal);
  const input = await r.client.createDetailWorkspaceSave(selection, saved, f.document());
  await r.client.saveDetailWorkspace(input, {}, new AbortController().signal);
  f.selection = () => ({ productId: 'product', optionId: 'red', profileId: 'profile', view: plain(f.view) });
  f.prepared = (selection, saved) => ({ ...selection, view: plain(selection.view), workspace: plain(saved.workspace), keys: saved.workspace.document.photos.map(photo => photo.key),
    sources: saved.workspace.document.photos.map(photo => { const file = saved.workspace.files.find(file => file.key === photo.key); return { key: file.key, sha256: file.sha256, width: file.width, height: file.height }; }),
    output: new Blob(['synthetic PNG'], { type: 'image/png' }), width: 800, height: 400, sha256: 'c'.repeat(64), uploadId: 'd'.repeat(64) });
  f.savedView = () => {
    const next = plain(f.view), key = 'owner/final-workspace-detail.png'; next.revision++; next.productVersion = '2026-10-16T00:00:03.000Z'; next.updatedAt = next.productVersion;
    next.inputFingerprint = 'd'.repeat(64); next.imageKeys.push(key);
    for (const row of next.resolved.rows) { row.fields.detailImages.value = key; row.fields.detailHtml.value = ''; if (row.optionId !== null) row.fields.altText.value = `상세 설명 - ${row.optionId === 'red' ? '빨강' : '파랑'}`; }
    return next;
  };
  return f;
}
export function compositePanel(f, behavior = {}, mode = 'composite') {
  let cursor = 0, epoch = 0, closed = false, lateWrites = 0, props = { selection: f.selection(), saved: f.reply(), stageActive: true, sourceCurrent: true, disabled: false };
  const slots = [], layouts = [], effects = [], saved = [], latest = [], locks = [], calls = [], downloads = [], cache = new Map();
  const effect = (queue, fn, deps) => { const index = cursor++, old = slots[index]; if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps[i]))) { const next = { deps }; slots[index] = next; queue.push(() => { old?.cleanup?.(); next.cleanup = fn(); }); } };
  const hooks = { useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, value => { if (closed) { lateWrites++; return; } const next = typeof value === 'function' ? value(slots[index].value) : value; if (!Object.is(next, slots[index].value)) { epoch++; slots[index].value = next; } }]; },
    useRef(value) { const index = cursor++; return slots[index] ?? (slots[index] = { current: value }); }, useEffect(fn, deps) { effect(effects, fn, deps); }, useLayoutEffect(fn, deps) { effect(layouts, fn, deps); } };
  const api = {
    async prepareDetailWorkspaceComposite(selection, before, signal) { calls.push({ action: 'prepare', signal, selection, before }); return behavior.prepare ? behavior.prepare(selection, before, signal) : f.prepared(selection, before); },
    async applyDetailWorkspaceComposite(prepared, attempt, signal) { calls.push({ action: 'apply', signal, prepared }); attempt.pending = 'save'; if (behavior.apply) return behavior.apply(prepared, attempt, signal); const next = f.savedView(); attempt.completed = next; delete attempt.pending; return next; },
    async recoverDetailWorkspaceComposite(prepared, attempt, signal) { calls.push({ action: 'recover', signal, prepared }); if (behavior.recover) return behavior.recover(prepared, attempt, signal); attempt.completed = f.savedView(); delete attempt.pending; return 'completed'; },
    async readLatestDetailWorkspaceComposite(selection, signal) { calls.push({ action: 'latest', signal, selection }); return behavior.latest ? behavior.latest(selection, signal) : f.reply(); },
  };
  const bannerApi = {
    async readDetailWorkspaceBannerRebase(selection, signal) { calls.push({ action: 'prepare', signal, selection }); return behavior.prepare ? behavior.prepare(selection, signal) : plain(f.bannerPreview); },
    async applyDetailWorkspaceBannerRebase(selection, preview, attempt, signal) { calls.push({ action: 'apply', signal, selection, preview }); attempt.pending = true; if (behavior.apply) return behavior.apply(preview, attempt, signal); attempt.completed = await f.rebasedReply(preview); attempt.pending = false; return attempt.completed; },
    async recoverDetailWorkspaceBannerRebase(selection, preview, attempt, signal) { calls.push({ action: 'recover', signal, selection, preview }); if (behavior.recover) return behavior.recover(preview, attempt, signal); attempt.completed = await f.rebasedReply(preview); attempt.pending = false; return 'completed'; },
    async readLatestDetailWorkspaceBannerRebase(selection, attempt, signal) { calls.push({ action: 'latest', signal, selection }); const value = behavior.latest ? await behavior.latest(selection, signal) : plain(f.bannerPreview); attempt.superseded = true; attempt.pending = false; return value; },
  };
  class LocalURL extends URL { static createObjectURL() { return 'blob:fixture-' + Math.random(); } static revokeObjectURL() {} }
  const document = { createElement(tag) { assert.equal(tag, 'a'); return { click() { downloads.push({ href: this.href, download: this.download }); } }; } };
  function load(file) {
    if (cache.has(file)) return cache.get(file); const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
      { exports, Error, Date, URL: LocalURL, URLSearchParams, Response, Request, Headers, Blob, File, FormData, AbortController, AbortSignal, DOMException, TextEncoder, TextDecoder, Uint8Array, DataView, structuredClone, crypto: webcrypto,
        document, setTimeout: fn => { fn(); return 1; }, fetch: () => { throw Error('unexpected network'); }, require(name) {
          if (name === 'react') return hooks; if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
          if (name === '@/app/detail-workspace-composite-client') return api;
          if (name === '@/app/detail-workspace-banner-rebase-client') return bannerApi;
          if (name.startsWith('@/')) return load(name.slice(2) + (name.includes('/components/') ? '.tsx' : '.ts'));
          if (name.startsWith('.')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts'); return native(name);
        } }); return exports;
  }
  const Component = mode === 'rebase' ? load('app/components/detail-workspace-rebase-panel.tsx').DetailWorkspaceRebasePanel : load('app/components/detail-workspace-composite-panel.tsx').DetailWorkspaceCompositePanel;
  function render() { cursor = 0; const tree = Component({ ...props, onSaved: view => saved.push(plain(view)), onLatestRead: reply => latest.push(plain(reply)), onBusyChange: value => locks.push(value) }); layouts.splice(0).forEach(fn => fn()); effects.splice(0).forEach(fn => fn()); return tree; }
  const button = label => nodes(render()).find(node => node.type === 'button' && text(node) === label);
  const checkbox = () => nodes(render()).find(node => node.type === 'input' && node.props.type === 'checkbox');
  async function tick() { render(); await new Promise(resolve => setImmediate(resolve)); render(); }
  async function idle() { let quiet = 0; const end = Date.now() + 5000; while (quiet < 3) { const before = epoch, count = calls.length; await tick(); const tree = render(); quiet = epoch === before && count === calls.length && !tree.props['aria-busy'] ? quiet + 1 : 0; assert.ok(Date.now() < end, 'composite UI did not settle'); } }
  render();
  return { render, button, checkbox, saved, latest, locks, calls, downloads, idle, tick, get lateWrites() { return lateWrites; }, set(value) { props = { ...props, ...value }; render(); render(); },
    async click(label) { const node = button(label); assert.ok(node && !node.props.disabled, label + '\n' + text(render())); node.props.onClick(); await idle(); },
    review() { const node = checkbox(); assert.ok(node && !node.props.disabled); node.props.onChange({ target: { checked: true } }); render(); }, close() { slots.forEach(slot => slot?.cleanup?.()); closed = true; } };
}
export const rebasePanel = (f, behavior) => compositePanel(f, behavior, 'rebase');
