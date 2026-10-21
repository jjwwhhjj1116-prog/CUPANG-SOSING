import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

export const plain = value => JSON.parse(JSON.stringify(value));
export const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
export const visibleText = value => Array.isArray(value) ? value.map(visibleText).join('') : value && typeof value === 'object' ? visibleText(value.props?.children) : value == null ? '' : String(value);
export const nextVersion = version => new Date(Date.parse(version) + 1).toISOString();
export function deferred() { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
export async function responseJson(response) { assert.equal(response.status, 200, await response.clone().text()); return response.json(); }

/** Actual editor/client modules with controllable React lifecycle boundaries.
 * The supplied harness remains the sole SQLite/API implementation. */
export function seoWorkspaceEditor(api, { props = {}, fetcher, dom = {} } = {}) {
  let currentProps = { productId: api.id, version: api.version, ...props };
  const slots = [], effects = [], layouts = [], calls = [];
  let cursor = 0, closed = false, saved = 0, lateWrites = 0;
  function schedule(queue, fn, deps) {
    const index = cursor++, previous = slots[index];
    if (!previous || JSON.stringify(previous.deps) !== JSON.stringify(deps)) {
      const next = { deps, cleanup: previous?.cleanup }; slots[index] = next;
      queue.push(() => { previous?.cleanup?.(); next.cleanup = fn(); });
    }
  }
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { if (closed) { lateWrites++; return; } slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useEffect(fn, deps) { schedule(effects, fn, deps); }, useLayoutEffect(fn, deps) { schedule(layouts, fn, deps); },
  };
  const route = (url, init) => {
    assert.equal(url, `/api/products/${encodeURIComponent(api.id)}/seo-workspace`, 'only the bound local SEO endpoint is allowed');
    return api.request(init?.method ?? 'GET', init?.body === undefined ? undefined : JSON.parse(init.body), init?.headers);
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../app/components/seo-workspace-editor.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Error, AbortController, Date, structuredClone, fetch: async (url, init) => {
    calls.push({ url, init, method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(init.body) } : {}) });
    return (fetcher ?? route)(url, init, route);
  }, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name.endsWith('.css')) return {};
    if (name.startsWith('@/')) return api.load(name.slice(2) + '.ts');
    throw Error('Unexpected editor dependency: ' + name);
  } }, { filename: 'app/components/seo-workspace-editor.tsx' });
  function render(passive = true) {
    cursor = 0;
    const tree = exports.SeoWorkspaceEditor({ ...currentProps, onSaved() { saved++; currentProps.onSaved?.(); } });
    for(const node of nodes(tree))if(node.props.ref&&typeof node.props.ref==='object')node.props.ref.current=dom[node.props['aria-label']]??null;
    layouts.splice(0).forEach(effect => effect());
    if (passive) effects.splice(0).forEach(effect => effect());
    return tree;
  }
  async function idle() {
    const deadline = Date.now() + 10000;
    let previous = '', stable = 0;
    for (;;) {
      render(); await new Promise(resolve => setImmediate(resolve));
      const tree = render(), identity = JSON.stringify([calls.length, tree]);
      if (!tree.props['data-workspace-saving'] && !effects.length && !layouts.length && identity === previous) stable++; else stable = 0;
      if (stable >= 3) return tree;
      previous = identity;
      assert.ok(Date.now() < deadline, 'SEO workspace editor request timed out');
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }
  const input = (label, tree = render()) => nodes(tree).find(node => ['input', 'textarea'].includes(node.type) && node.props['aria-label'] === label);
  const button = (label, tree = render()) => nodes(tree).find(node => node.type === 'button' && visibleText(node) === label);
  function close() { if (closed) return; slots.forEach(slot => slot?.cleanup?.()); closed = true; }
  render();
  return { api, calls, render, idle, input, button, route, close, get saved() { return saved; }, get lateWrites() { return lateWrites; },
    patch(values, passive = true) { currentProps = { ...currentProps, ...values }; return render(passive); },
    edit(label, value) { const node = input(label); assert.ok(node, 'editor input ' + label); node.props.onChange({ target: { value } }); },
    async click(label) { const node = button(label); assert.ok(node && !node.props.disabled, 'available editor button ' + label); node.props.onClick(); return idle(); },
  };
}
