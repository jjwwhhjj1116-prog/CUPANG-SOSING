import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { sizeChartApiFixture, companies, json, sizeKeys, allTables } from './helpers/supplier-hub-single-size-chart.mjs';

const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null ? '' : String(tree);
const sleep = () => new Promise(resolve => setTimeout(resolve, 1));
const fixtureUrl = new URL('./size-chart-workspace.test.mjs', import.meta.url), source = fs.readFileSync(fixtureUrl, 'utf8');
const ast = ts.createSourceFile(fixtureUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declaration = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'workspace');
assert.ok(declaration, 'reuse only the current actual-component fixture, without registering its test cases');
const workspace = vm.runInNewContext('(' + declaration.getText(ast).replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href)) + ')', {
  fs, vm, ts, assert, nodes, text, sleep, Request, Response, URL, structuredClone, Date, setTimeout,
});
const chart = { sizeType: '공급자에게 확인한 표', sizeUnits: 'inch', sizes: ['S', 'M'], measurements: [{ name: '길이', values: ['12 / 13', ''] }] };
const result = ui => nodes(ui.render()).find(node => node.props?.['data-saved-size-chart']);
const download = ui => nodes(ui.render()).find(node => node.type === 'a' && node.props['aria-label'] === '저장된 사이즈표 이미지 다운로드');
const productVersion = f => f.h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(f.id).updated_at;
async function manualFixture(company = companies[0]) {
  const f = await sizeChartApiFixture(company);
  let content = (await json(await f.route(f.base + '/content'))).content;
  await json(await f.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision, patch: { manualSizeChart: chart } } }));
  content = (await json(await f.route(f.base + '/content'))).content;
  await json(await f.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision, patch: { assets: { size: [sizeKeys[0]] } } } }));
  // Warm optional, read-only product summary setup before the no-change snapshot.
  await f.h.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test' + f.base), { params: Promise.resolve({ id: f.id }) });
  return f;
}
function mutate(response, transform) { return response.json().then(body => Response.json(transform(body), { status: response.status })); }

for (const company of companies) test(`owned saved image opens as a read-only result, downloads exact private bytes and rewrites locally (${company.code})`, async () => {
  const f = await manualFixture(company); let ui;
  try {
    const before = allTables(f), files = new Map([...f.h.objects].map(([key, bytes]) => [key, bytes.slice()]));
    ui = workspace(f); await ui.idle();
    assert.ok(result(ui)); assert.equal(result(ui).props.src, '/api/files/' + sizeKeys[0]);
    assert.equal(result(ui).props.width, undefined); assert.equal(result(ui).props.height, undefined, 'saved dimensions are not fabricated');
    assert.equal(ui.input('사이즈 유형'), undefined); assert.equal(ui.png, undefined); assert.equal(ui.render().props['data-workspace-dirty'], false);
    assert.equal(download(ui).props.download, 'size_chart.png'); assert.ok(ui.calls.every(call => call.method === 'GET'));
    const bytes = await f.h.load('app/api/files/[...key]/route.ts').GET(new Request('https://app.test' + download(ui).props.href), { params: Promise.resolve({ key: sizeKeys[0].split('/') }) });
    assert.equal(bytes.status, 200); assert.deepEqual(new Uint8Array(await bytes.arrayBuffer()), f.h.objects.get(sizeKeys[0]));
    ui.confirm(false); await ui.click('재작성'); assert.ok(result(ui)); assert.equal(ui.confirmations.length, 1);
    ui.confirm(true); await ui.click('재작성'); assert.equal(result(ui), undefined); assert.equal(ui.input('사이즈 유형').props.value, chart.sizeType);
    assert.equal(ui.input('측정 항목 1 사이즈 1 값').props.value, '12 / 13'); assert.equal(ui.input('측정 항목 1 사이즈 2 값').props.value, '');
    assert.equal(ui.render().props['data-workspace-dirty'], false); assert.equal(ui.png.props.disabled, false);
    await ui.click('저장된 사이즈표 보기'); assert.ok(result(ui)); assert.equal(ui.calls.filter(call => call.method !== 'GET').length, 0);
    assert.equal(allTables(f), before); for (const [key, value] of files) assert.deepEqual(f.h.objects.get(key), value);
    assert.deepEqual(f.h.network, []);
  } finally { ui?.close(); f.close(); }
});

test('no image opens a real editable blank chart and never invents supplier measurements', async () => {
  const f = await sizeChartApiFixture(); let ui;
  try {
    const content = (await json(await f.route(f.base + '/content'))).content;
    await json(await f.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision, patch: { assets: { size: [] } } } }));
    ui = workspace(f); await ui.idle(); assert.equal(result(ui), undefined); assert.ok(ui.png);
    await ui.click('사이즈표 직접 작성'); assert.equal(ui.input('측정 항목 1 이름').props.value, ''); assert.equal(ui.input('측정 항목 1 사이즈 1 값').props.value, '');
    assert.equal(ui.render().props['data-workspace-dirty'], true); assert.equal(ui.png.props.disabled, true); assert.ok(ui.calls.every(call => call.method === 'GET'));
    assert.deepEqual(f.h.network, []);
  } finally { ui?.close(); f.close(); }
});

for (const kind of ['foreign key', 'removed key', 'multiple size images', 'wrong product', 'changed version', 'changed owner', 'changed image pool']) test(`a ${kind} cannot become a saved-size result`, async () => {
  const f = await manualFixture(); let ui, productReads = 0;
  try {
    ui = workspace(f, async (path, _init, send) => {
      const response = await send();
      if (path === f.base) {
        productReads++;
        if (kind === 'wrong product') return mutate(response, body => ({ product: { ...body.product, id: 'other-product' } }));
        if (productReads === 2 && kind === 'changed version') return mutate(response, body => ({ product: { ...body.product, updated_at: new Date(Date.parse(body.product.updated_at) + 1).toISOString() } }));
        if (productReads === 2 && kind === 'changed owner') return mutate(response, body => ({ product: { ...body.product, owner_id: 'foreign-owner' } }));
        if (productReads === 2 && kind === 'changed image pool') return mutate(response, body => ({ product: { ...body.product, image_keys: JSON.stringify(JSON.parse(body.product.image_keys).slice(1)) } }));
      }
      if (path.endsWith('/content') && ['foreign key', 'removed key', 'multiple size images'].includes(kind)) return mutate(response, body => {
        body.content.assets.size.value = kind === 'foreign key' ? ['other-owner/proof.png'] : kind === 'removed key' ? ['owner/not-in-this-product.png'] : [sizeKeys[0], sizeKeys[1]]; return body;
      });
      return response;
    });
    await ui.idle(); assert.equal(result(ui), undefined); assert.equal(download(ui), undefined); assert.equal(ui.calls.some(call => call.method !== 'GET'), false);
    assert.match(text(ui.render()), /확인하지 못|변경|읽지 못/); assert.deepEqual(f.h.network, []);
  } finally { ui?.close(); f.close(); }
});

test('manual edits survive a source version change and retained result actions cannot discard the draft', async () => {
  const f = await manualFixture(); let ui;
  try {
    ui = workspace(f); await ui.idle(); const oldRewrite = ui.button('재작성').props.onClick;
    await ui.click('재작성'); ui.edit('측정 항목 1 사이즈 1 값', '검토 중인 14');
    const content = (await json(await f.route(f.base + '/content'))).content;
    await json(await f.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision, patch: { label: { material: '다른 단계에서 확인한 재질' } } } }));
    const confirms = ui.confirmations.length; ui.setVersion(productVersion(f)); await ui.idle(); oldRewrite();
    assert.equal(ui.confirmations.length, confirms); assert.equal(result(ui), undefined); assert.equal(ui.input('측정 항목 1 사이즈 1 값').props.value, '검토 중인 14');
    assert.equal(ui.button('사이즈표 정보 저장').props.disabled, true); assert.equal(ui.png.props.disabled, true);
    await ui.click('입력 유지·최신 사이즈표 조회'); assert.equal(ui.input('측정 항목 1 사이즈 1 값').props.value, '검토 중인 14'); assert.equal(ui.button('사이즈표 정보 저장').props.disabled, false);
    await ui.click('사이즈표 정보 저장'); assert.equal(result(ui), undefined); assert.ok(ui.png); assert.equal(ui.png.props.disabled, false);
    const saved = (await json(await f.route(f.base + '/content'))).content;
    assert.equal(saved.manualSizeChart.measurements[0].values[0], '검토 중인 14'); assert.equal(saved.label.material.value, '다른 단계에서 확인한 재질'); assert.deepEqual(saved.assets.size.value, []);
    assert.ok(f.h.objects.has(sizeKeys[0]), 'rewriting preserves the old file'); assert.deepEqual(f.h.network, []);
  } finally { ui?.close(); f.close(); }
});

test('an exact image-attachment callback rechecks current product/content before returning to the replacement result', async () => {
  const f = await manualFixture(); let ui;
  try {
    ui = workspace(f); await ui.idle(); await ui.click('재작성'); const callback = ui.png.props.onSaved;
    const content = (await json(await f.route(f.base + '/content'))).content;
    await json(await f.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision, patch: { assets: { size: [sizeKeys[3]] } } } }));
    callback(); await ui.idle(); assert.equal(result(ui).props.src, '/api/files/' + sizeKeys[3]); assert.equal(ui.saves, 1);
    assert.ok(f.h.objects.has(sizeKeys[0])); assert.equal(ui.calls.some(call => call.method !== 'GET'), false, 'fixture mutation models an existing child acknowledgement, not a new wrapper write');
    const before = ui.saves; ui.close(); callback(); await sleep(); assert.equal(ui.saves, before); assert.deepEqual(f.h.network, []);
  } finally { ui?.close(); f.close(); }
});

test('a late saved-result response or extraction callback cannot replace a newer draft or a closed workspace', async () => {
  const f = await manualFixture(); let ui, release, hold = false;
  try {
    ui = workspace(f, async (path, _init, send) => {
      const response = await send(); if (hold && path.endsWith('/content')) { hold = false; await new Promise(resolve => { release = resolve; }); } return response;
    });
    await ui.idle(); await ui.click('재작성'); await ui.click('이미지에서 사이즈표 초안 만들기');
    const extraction = nodes(ui.render()).find(node => typeof node.type === 'function' && typeof node.props?.onDraft === 'function');
    await ui.click('저장된 사이즈표 보기'); extraction.props.onDraft({ ...chart, sizeType: '닫힌 추출 창에서 온 값' });
    assert.ok(result(ui)); assert.equal(ui.render().props['data-workspace-dirty'], false);
    await ui.click('재작성'); ui.edit('측정 항목 1 사이즈 1 값', '16');
    hold = true; const refresh = ui.button('입력 유지·최신 사이즈표 조회').props.onClick; refresh(); while (!release) await sleep();
    const value = ui.input('측정 항목 1 사이즈 1 값').props.value; ui.close(); release(); await sleep(); await sleep();
    assert.equal(value, '16'); assert.equal(ui.saves, 0); assert.equal(ui.calls.some(call => call.method !== 'GET'), false); assert.deepEqual(f.h.network, []);
  } finally { ui?.close(); f.close(); }
});
