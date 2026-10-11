import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const native = createRequire(import.meta.url);
const plain = value => JSON.parse(JSON.stringify(value));
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
function fixture(patch = {}) {
  let cursor = 0, closed = false, late = 0, serial = 0;
  const states = [], effects = [], starts = [], completed = [], canceled = [], captures = [], releases = [], held = new Set();
  let rect = { left: 10, top: 20, width: 100, height: 50 };
  const surface = { getBoundingClientRect: () => ({ ...rect }), setPointerCapture(id) { held.add(id); captures.push(id); },
    hasPointerCapture: id => held.has(id), releasePointerCapture(id) { held.delete(id); releases.push(id); } };
  let props = { sourceUrl: 'blob:original', width: 200, height: 100, scopeKey: 'source-a:1', enabled: true, disabled: false, size: 10, color: '#abcdef', maxPoints: 2048, strokes: [],
    onBegin() { const id = 'gesture-' + ++serial; starts.push(id); return id; },
    onComplete(id, points) { completed.push({ id, points }); }, onCancel(id) { canceled.push(id); }, ...patch };
  const hooks = {
    useState(initial) { const id = cursor++; if (!(id in states)) states[id] = typeof initial === 'function' ? initial() : initial; return [states[id], value => { if (closed) late++; states[id] = typeof value === 'function' ? value(states[id]) : value; }]; },
    useRef(initial) { const id = cursor++; return states[id] ?? (states[id] = { current: initial }); },
    useEffect(fn, deps) { const id = cursor++, old = states[id]; if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) { const next = { deps }; states[id] = next; effects.push(() => { old?.cleanup?.(); next.cleanup = fn(); }); } },
  };
  hooks.useLayoutEffect = hooks.useEffect;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/free-image-brush-canvas.tsx', import.meta.url), 'utf8'),
    { fileName: 'brush.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require(name) { if (name === 'react') return hooks; if (name === 'react/jsx-runtime') return native(name); assert.equal(name, '@/app/free-image-brush'); return { MAX_FREE_IMAGE_BRUSH_POINTS: 2048 }; } });
  const render = () => { cursor = 0; const tree = exports.FreeImageBrushCanvas(props); effects.splice(0).forEach(fn => fn()); return tree; };
  const drawSurface = () => nodes(render()).find(node => node.type === 'svg');
  const event = (x, y, extra = {}) => ({ currentTarget: surface, clientX: x, clientY: y, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse', isPrimary: true, nativeEvent: {}, preventDefault() {}, ...extra });
  const settle = async () => { for (let index = 0; index < 4; index++) { render(); await new Promise(resolve => setImmediate(resolve)); } };
  render();
  return { render, drawSurface, event, settle, starts, completed, canceled, captures, releases, get late() { return late; },
    async send(name, x = 20, y = 30, extra) { drawSurface().props[name](event(x, y, extra)); await settle(); },
    setRect(next) { rect = { ...rect, ...next }; }, async setProps(next) { props = { ...props, ...next }; await settle(); },
    close() { if (closed) return; states.forEach(state => state?.cleanup?.()); closed = true; },
  };
}

test('displayed image and SVG share an exact aspect ratio and pointer capture maps scaled native points with edge clipping', async () => {
  const h = fixture(); try {
    const tree = h.render(), image = nodes(tree).find(node => node.type === 'img'), svg = h.drawSurface(), fitted = nodes(tree).find(node => node.type === 'div' && node.props.style?.aspectRatio);
    assert.equal(fitted.props.style.aspectRatio, '200/100'); assert.equal(image.props.style.objectFit, undefined);
    assert.equal(svg.props.role, 'img'); assert.equal(svg.props['aria-label'], '브러시 편집 원본'); assert.equal(svg.props.viewBox, '0 0 200 100');
    const hit = nodes(svg).find(node => node.type === 'rect'); assert.deepEqual([hit.props.width, hit.props.height, hit.props.fill, hit.props.pointerEvents], [200, 100, 'transparent', 'all']);
    await h.send('onPointerDown', 20, 30); assert.deepEqual(h.captures, [1]); assert.equal(h.completed.length, 0);
    await h.send('onPointerMove', -100, -100); await h.send('onPointerUp', 500, 500);
    assert.deepEqual(plain(h.completed[0].points), [{ x: 20, y: 20 }, { x: 0, y: 0 }, { x: 199, y: 99 }]);
    assert.deepEqual(h.releases, [1]); assert.equal(h.completed.length, 1); assert.deepEqual(h.canceled, []);
  } finally { h.close(); }
});

test('a primary single click commits one round spot; coalesced motion preserves order and consecutive idle points are deduplicated', async () => {
  const h = fixture(); try {
    await h.send('onPointerDown'); const circle = nodes(h.render()).find(node => node.type === 'circle'); assert.equal(circle.props.r, 5);
    await h.send('onPointerUp'); assert.deepEqual(plain(h.completed[0].points), [{ x: 20, y: 20 }]);
    await h.send('onPointerDown', 30, 30);
    await h.send('onPointerMove', 50, 30, { nativeEvent: { getCoalescedEvents: () => [{ clientX: 30, clientY: 30 }, { clientX: 40, clientY: 35 }, { clientX: 50, clientY: 40 }] } });
    const path = nodes(h.render()).find(node => node.type === 'path'); assert.equal(path.props.strokeLinecap, 'round'); assert.equal(path.props.strokeLinejoin, 'round');
    await h.send('onPointerUp', 50, 40);
    assert.deepEqual(plain(h.completed[1].points), [{ x: 40, y: 20 }, { x: 60, y: 30 }, { x: 80, y: 40 }]);
    h.completed[0].points[0].x = -999; assert.equal(h.completed[1].points[0].x, 40, 'completed paths do not share mutable points');
  } finally { h.close(); }
});

test('cancel, lost capture, disabled state, changed source or unmount never commit unfinished gestures', async () => {
  for (const action of ['cancel', 'lost', 'mouse-release', 'disabled', 'scope', 'url', 'unmount']) {
    const h = fixture(); try {
      await h.send('onPointerDown'); await h.send('onPointerMove', 30, 30);
      if (action === 'cancel') await h.send('onPointerCancel');
      if (action === 'lost') await h.send('onLostPointerCapture');
      if (action === 'mouse-release') await h.send('onPointerMove', 30, 30, { buttons: 0 });
      if (action === 'disabled') await h.setProps({ disabled: true });
      if (action === 'scope') await h.setProps({ scopeKey: 'source-b:2' });
      if (action === 'url') await h.setProps({ sourceUrl: 'blob:changed' });
      if (action === 'unmount') h.close();
      assert.deepEqual(h.canceled, ['gesture-1'], action); assert.equal(h.completed.length, 0, action);
      const up = h.drawSurface().props.onPointerUp; up(h.event(50, 40)); await new Promise(resolve => setImmediate(resolve));
      assert.equal(h.completed.length, 0); assert.equal(h.late, 0);
    } finally { h.close(); }
  }
});

test('old captured handlers cannot append to a new gesture with the same pointer ID or start after a new scope', async () => {
  const h = fixture(); try {
    const old = h.drawSurface().props; await h.send('onPointerDown'); await h.send('onPointerCancel');
    await h.setProps({ scopeKey: 'source-b:2' }); old.onPointerDown(h.event(20, 30)); await h.settle(); assert.equal(h.starts.length, 1);
    await h.send('onPointerDown', 40, 35); old.onPointerMove(h.event(90, 50)); old.onPointerUp(h.event(90, 50)); await h.settle();
    assert.equal(h.completed.length, 0); await h.send('onPointerUp', 40, 35);
    assert.deepEqual(plain(h.completed[0].points), [{ x: 60, y: 30 }]); assert.equal(h.completed.length, 1);
  } finally { h.close(); }
});

test('layout movement and point-budget overflow cancel the entire path instead of rebinding or truncating it', async () => {
  const h = fixture(); try {
    await h.send('onPointerDown'); h.setRect({ top: 25 }); await h.send('onPointerMove', 40, 40);
    assert.equal(h.completed.length, 0); assert.deepEqual(h.canceled, ['gesture-1']);
    await h.setProps({ maxPoints: 2 }); await h.send('onPointerDown', 20, 30); await h.send('onPointerMove', 30, 30); await h.send('onPointerUp', 40, 30);
    assert.equal(h.completed.length, 0); assert.deepEqual(h.canceled, ['gesture-1', 'gesture-2']); assert.match(text(h.render()), /점 수 한도/);
  } finally { h.close(); }
});

test('invalid, nonprimary or locked pointer starts are ignored and selected stored strokes retain drawing order', async () => {
  const strokes = [{ id: 'first', background: '#112233', brush: { size: 4, points: [{ x: 4, y: 5 }] } },
    { id: 'second', background: '#aabbcc', brush: { size: 8, points: [{ x: 1, y: 2 }, { x: 8, y: 9 }] } }];
  const h = fixture({ strokes }); try {
    assert.deepEqual(nodes(h.render()).filter(node => ['circle', 'path'].includes(node.type)).map(node => node.key), ['first', 'second']);
    await h.send('onPointerDown', 20, 30, { button: 2 }); await h.send('onPointerDown', 20, 30, { isPrimary: false });
    await h.setProps({ enabled: false }); await h.send('onPointerDown');
    await h.setProps({ enabled: true, size: 1.5 }); await h.send('onPointerDown');
    await h.setProps({ size: 10, color: 'red' }); await h.send('onPointerDown');
    await h.setProps({ color: '#abcdef', maxPoints: 0 }); await h.send('onPointerDown');
    assert.equal(h.starts.length, 0); assert.equal(h.completed.length, 0); assert.equal(h.captures.length, 0);
    assert.deepEqual(strokes, plain(strokes));
  } finally { h.close(); }
});
