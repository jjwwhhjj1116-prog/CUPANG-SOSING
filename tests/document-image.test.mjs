import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';

function load(file, overrides = {}, mode = 'development', globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, Response, TextEncoder, TextDecoder, Uint8Array, DataView, structuredClone, ...globals, process: { env: { NODE_ENV: mode } }, require(name) {
    if (name in overrides) return overrides[name];
    if (name === 'next/server') return { NextResponse: Response };
    if (name === '@/app/chatgpt-auth') return { getChatGPTUser: async () => ({ userId: 'owner' }), getWorkspaceOwnerId: async () => 'owner' };
    if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`, overrides, mode);
    throw Error(name);
  } });
  return exports;
}
const contentModel = load('app/product-content.ts'); const optionsModel = load('app/product-options.ts'); const model = load('app/document-image.ts');
const version = '2026-09-22T00:00:00.000Z'; const nextVersion = '2026-09-22T00:00:00.001Z';
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=', 'base64'));
const empty = () => contentModel.emptyProductContent('test');

test('document plans use saved label/size values only and never fabricate blank legal or dimension facts', () => {
  const content = contentModel.applyContentPatch(empty(), { label: { productName: '저장한 품명', material: '면' } }, version);
  const options = optionsModel.applyOptionRows(optionsModel.emptyProductOptions('test'), [{ ...optionsModel.emptyOptionInput('a'), originalName: '原文', translatedName: '대형', included: true, widthCm: 10.5, unitsPerPack: 2 }], version);
  const label = model.documentImagePlan('label', content, options);
  assert.equal(label.rows.find(row => row[0] === '품명')[1], '저장한 품명'); assert.equal(label.rows.find(row => row[0] === '제조국')[1], '[미입력]');
  const size = model.documentImagePlan('size', content, options);
  assert.deepEqual(Array.from(size.rows[0]), ['대형', '10.5', '[미입력]', '[미입력]', '[미입력]', '2']);
  assert.equal(size.columnWidths.reduce((sum, width) => sum + width, 80), size.width);
  assert.throws(() => model.documentImagePlan('label', empty(), options));
  assert.throws(() => model.documentImagePlan('size', content, optionsModel.emptyProductOptions('test')));
  const tooMany = { ...options, rows: Array.from({ length: 61 }, () => options.rows[0]) };
  assert.throws(() => model.documentImagePlan('size', content, tooMany), /60/);
});

test('document line wrapping preserves Korean, explicit blank lines and unicode symbols within measured widths', () => {
  const lines = model.wrapDocumentText('한글줄바꿈\n\nA😀B', 20, value => [...value].length * 10);
  assert.deepEqual(Array.from(lines), ['한글', '줄바', '꿈', '', 'A😀', 'B']);
  assert.ok(lines.every(line => [...line].length <= 2));
});

function sqliteFixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE products(id TEXT PRIMARY KEY,owner_id TEXT,updated_at TEXT,image_keys TEXT,quote_status TEXT); INSERT INTO products VALUES('test','owner','${version}','["owner/original.png"]','완료'); CREATE TABLE product_content(product_id TEXT PRIMARY KEY,owner_id TEXT,revision INTEGER,payload TEXT,updated_at TEXT);`);
  const db = { prepare(sql) { let args = []; const q = { bind(...values) { args = values; return q; }, execute() { return sqlite.prepare(sql).all(...args); } }; return q; }, async batch(queries) { sqlite.exec('BEGIN'); try { const results = queries.map(query => ({ results: query.execute() })); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
  const api = load('db/product-attachments.ts', { 'cloudflare:workers': { env: { DB: db } } });
  return { sqlite, attach: api.attachProductDocument };
}
function attachment(contentMutated = true) {
  return { productId: 'test', expectedVersion: version, expectedContentRevision: 0, previousImageKeys: '["owner/original.png"]', imageKeys: ['owner/original.png', 'owner/document.png'],
    content: contentMutated ? contentModel.applyContentPatch(empty(), { assets: { label: ['owner/document.png'] } }, nextVersion) : empty(), productVersion: nextVersion, contentMutated };
}
test('real SQLite links the new document atomically while preserving original product keys and other roles', async () => {
  const { sqlite, attach } = sqliteFixture();
  try {
    assert.ok(await attach('owner', attachment()));
    const product = sqlite.prepare('SELECT * FROM products').get(); assert.deepEqual(JSON.parse(product.image_keys), ['owner/original.png', 'owner/document.png']); assert.equal(product.quote_status, '대기');
    const content = JSON.parse(sqlite.prepare('SELECT payload FROM product_content').get().payload); assert.equal(content.assets.label.value[0], 'owner/document.png');
    assert.equal(await attach('owner', attachment()), null);
    assert.equal(await attach('other', attachment()), null);
    assert.equal(JSON.parse(sqlite.prepare('SELECT payload FROM product_content').get().payload).revision, 1);
  } finally { sqlite.close(); }
});
test('same-timestamp image changes and content-revision changes prevent lost updates; role null changes no content', async () => {
  const { sqlite, attach } = sqliteFixture();
  try {
    sqlite.prepare('UPDATE products SET image_keys=?').run('["owner/original.png","owner/concurrent.png"]');
    assert.equal(await attach('owner', attachment()), null); assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM product_content').get().count, 0);
    sqlite.prepare('UPDATE products SET image_keys=?').run('["owner/original.png"]');
    assert.ok(await attach('owner', attachment(false))); assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM product_content').get().count, 0);
    const inserted = contentModel.applyContentPatch(empty(), { seo: { title: '다른 작업' } }, nextVersion);
    sqlite.prepare('INSERT INTO product_content VALUES(?,?,?,?,?)').run('test', 'owner', 1, JSON.stringify(inserted), nextVersion);
    assert.equal(await attach('owner', { ...attachment(false), expectedVersion: nextVersion, previousImageKeys: '["owner/original.png","owner/document.png"]' }), null);
    assert.equal(JSON.parse(sqlite.prepare('SELECT payload FROM product_content').get().payload).seo.title.value, '다른 작업');
  } finally { sqlite.close(); }
});

function routeWith({ find = async () => ({ id: 'test', image_keys: '["owner/original.png"]', updated_at: version }), read = async () => empty(), readOptions = async () => optionsModel.emptyProductOptions('test'), save = async (_owner, value) => ({ content: value.content, imageKeys: value.imageKeys, productVersion: value.productVersion }), get = async () => ({ size: png.length, body: new ReadableStream({ start(controller) { controller.enqueue(png); controller.close(); } }) }), mode } = {}) {
  return load('app/api/products/[id]/attachments/route.ts', { '@/db/queries': { findProduct: find }, '@/db/product-content': { readProductContent: read }, '@/db/product-options': { readProductOptions: readOptions }, '@/db/product-attachments': { attachProductDocument: save }, 'cloudflare:workers': { env: { FILES: { get } } } }, mode);
}
const body = { key: 'owner/document.png', role: 'label', expectedVersion: version, expectedContentRevision: 0 };
const request = value => new Request('http://localhost', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
const context = { params: Promise.resolve({ id: 'test' }) };
test('attachment API validates snapshots/ownership/header and nullable role avoids automatic role assignment', async () => {
  const response = await routeWith().POST(request(body), context); assert.equal(response.status, 200);
  const saved = await response.json(); assert.equal(saved.content.assets.label.value[0], body.key); assert.ok(saved.imageKeys.includes('owner/original.png'));
  const plain = await routeWith().POST(request({ ...body, role: null }), context); const result = await plain.json();
  assert.equal(plain.status, 200); assert.equal(result.content.revision, 0); assert.equal(result.content.assets.label.value.length, 0);
  for (const [overrides, expected] of [[{ find: async () => null }, 404], [{ get: async () => null }, 400], [{ save: async () => null }, 409], [{ read: async () => ({ ...empty(), revision: 1 }) }, 409]]) assert.equal((await routeWith(overrides).POST(request(body), context)).status, expected);
  assert.equal((await routeWith().POST(request({ ...body, key: 'other/document.png' }), context)).status, 400);
  assert.equal((await routeWith().POST(request({ ...body, role: 'main' }), context)).status, 400);
  assert.equal((await routeWith({ mode: 'production' }).POST(request(body), context)).status, 503);
});

test('size attachment requires the rendered option revision while label/plain callers remain compatible', async () => {
  let writes = 0; let requestedRevision;
  const route = routeWith({ readOptions: async () => ({ ...optionsModel.emptyProductOptions('test'), revision: 2 }), save: async (_owner, input) => { writes++; requestedRevision = input.expectedOptionRevision; return input; } });
  for (const expectedOptionRevision of [undefined, -1, 0.5, '2']) assert.equal((await route.POST(request({ ...body, role: 'size', expectedOptionRevision }), context)).status, 400);
  assert.equal((await route.POST(request({ ...body, role: 'size', expectedOptionRevision: 1 }), context)).status, 409);
  assert.equal(writes, 0);
  assert.equal((await route.POST(request({ ...body, role: 'size', expectedOptionRevision: 2 }), context)).status, 200);
  assert.equal(writes, 1); assert.equal(requestedRevision, 2);
  assert.equal((await route.POST(request(body), context)).status, 200); assert.equal(requestedRevision, undefined);
  assert.equal((await route.POST(request({ ...body, role: null }), context)).status, 200); assert.equal(requestedRevision, undefined);
});

test('real SQLite rejects option revision changes during image validation before writing any document refs', async () => {
  for (const initialRevision of [0, 1]) {
    const { sqlite, attach } = sqliteFixture();
    try {
      sqlite.exec('CREATE TABLE product_options(product_id TEXT PRIMARY KEY,owner_id TEXT,revision INTEGER)');
      if (initialRevision) sqlite.prepare('INSERT INTO product_options VALUES(?,?,?)').run('test', 'owner', initialRevision);
      const route = routeWith({ readOptions: async () => ({ ...optionsModel.emptyProductOptions('test'), revision: initialRevision }), save: attach, get: async () => {
        // Simulate a concurrent save after the route's read but before the D1
        // batch. Hold product.updated_at constant to isolate the option guard.
        sqlite.prepare('INSERT INTO product_options VALUES(?,?,?) ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision').run('test', 'owner', initialRevision + 1);
        return { size: png.length, body: new ReadableStream({ start(controller) { controller.enqueue(png); controller.close(); } }) };
      } });
      assert.equal((await route.POST(request({ ...body, role: 'size', expectedOptionRevision: initialRevision }), context)).status, 409);
      assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM product_content').get().count, 0);
      const product = sqlite.prepare('SELECT * FROM products').get();
      assert.equal(product.image_keys, '["owner/original.png"]'); assert.equal(product.updated_at, version); assert.equal(product.quote_status, '완료');
    } finally { sqlite.close(); }
  }
});

test('size attachment revision zero means no options row and cannot match another owner row', async () => {
  for (const existingOwner of [null, 'other']) {
    const { sqlite, attach } = sqliteFixture();
    try {
      sqlite.exec('CREATE TABLE product_options(product_id TEXT PRIMARY KEY,owner_id TEXT,revision INTEGER)');
      if (existingOwner) sqlite.prepare('INSERT INTO product_options VALUES(?,?,?)').run('test', existingOwner, 1);
      const result = await attach('owner', { ...attachment(), expectedOptionRevision: 0 });
      assert.equal(Boolean(result), existingOwner === null);
    } finally { sqlite.close(); }
  }
});

function panelHarness({ productVersion = version, optionVersion = version } = {}) {
  const state = []; let hook = 0; let resolveSettled; let canvases = 0; let uploads = 0; const attached = [];
  const react = {
    useState(initial) { const index = hook++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; if (index === 1 && value === false) resolveSettled?.(); }]; },
    useRef(initial) { const index = hook++; if (!(index in state)) state[index] = { current: initial }; return state[index]; }, useEffect() {},
  };
  const jsx = (type, props) => ({ type, props });
  const options = optionsModel.applyOptionRows(optionsModel.emptyProductOptions('test'), [{ ...optionsModel.emptyOptionInput('a'), translatedName: '저장된 치수', included: true, widthCm: 12 }], version);
  const api = load('app/components/document-image-panel.tsx', { react, 'react/jsx-runtime': { jsx, jsxs: jsx } }, 'development', {
    Blob, File, FormData, URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} },
    document: { fonts: { load: async () => [], ready: Promise.resolve() }, createElement() { canvases++; return { width: 0, height: 0, getContext: () => ({ measureText: text => ({ width: text.length * 10 }), fillRect() {}, strokeRect() {}, fillText() {} }), toBlob: callback => callback(new Blob([png], { type: 'image/png' })) }; } },
    fetch: async (path, init) => {
      if (path === '/api/files') { uploads++; return Response.json({ key: 'owner/document.png' }); }
      if (path.endsWith('/attachments')) { attached.push(JSON.parse(init.body)); return attached.length === 1 ? Response.json({ error: '일시적인 저장 오류' }, { status: 503 }) : Response.json({ productVersion: nextVersion }); }
      if (path.endsWith('/options')) return Response.json({ options, productVersion: optionVersion });
      if (path.endsWith('/content')) return Response.json({ content: empty() });
      return Response.json({ product: { updated_at: productVersion } });
    },
  });
  const render = () => { hook = 0; const wrapper = api.DocumentImagePanel({ productId: 'test', version: productVersion, section: 'size' }); return wrapper.type(wrapper.props); };
  const find = (node, label) => {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'button' && node.props.children === label) return node;
    for (const child of [node.props?.children].flat(Infinity)) { const found = find(child, label); if (found) return found; }
    return null;
  };
  return {
    async click(label) { const button = find(render(), label); assert.ok(button, `Missing button ${label}`); const settled = new Promise(resolve => { resolveSettled = resolve; }); button.props.onClick(); await settled; },
    get error() { return state[2]; }, get preview() { return state[0]; }, get canvases() { return canvases; }, get uploads() { return uploads; }, attached,
  };
}

test('size preview refuses parallel GETs that combine an older options snapshot with a newer product', async () => {
  const panel = panelHarness({ productVersion: nextVersion, optionVersion: version });
  await panel.click('저장한 값으로 PNG 미리보기');
  assert.match(panel.error, /상품 또는 옵션이 변경/); assert.equal(panel.preview, null); assert.equal(panel.canvases, 0); assert.equal(panel.uploads, 0);
});

test('size preview carries the rendered options revision and retries attachment with the already-uploaded PNG', async () => {
  const panel = panelHarness(); await panel.click('저장한 값으로 PNG 미리보기');
  assert.equal(panel.error, ''); assert.equal(panel.preview.optionRevision, 1);
  await panel.click('PNG 업로드·상품 자료에 추가'); assert.match(panel.error, /일시적인/);
  await panel.click('PNG 업로드·상품 자료에 추가');
  assert.equal(panel.uploads, 1); assert.equal(panel.attached.length, 2); assert.equal(panel.error, '');
  for (const input of panel.attached) { assert.equal(input.role, 'size'); assert.equal(input.expectedOptionRevision, 1); assert.equal(input.expectedVersion, version); assert.equal(input.key, 'owner/document.png'); }
});
