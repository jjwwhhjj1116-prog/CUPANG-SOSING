import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, panel, runtime, nodes, text, deferred, plain } from './helpers/detail-workspace.mjs';
import { companies, downloadFixture, json } from './helpers/image-download-ui.mjs';

const photos = h => nodes(h.render()).filter(node => node.type === 'img' && /^상세 작업 사진 /u.test(node.props.alt ?? ''));
const attachmentImageIssue = '이 상품에 저장된 이미지 참조만 중복 없이 선택해주세요.';

for (const company of companies) test(`${company.companyCode} real quotation resolver review notes do not block the source-photo composition`, async () => {
  const f = await downloadFixture(company);
  try {
    const view = await json(await f.api.route(f.base + '/quotation-fields?profileId=cat'));
    const row = view.automatic.rows.find(row => row.optionId && row.included !== false), cell = row.fields.detailImages;
    assert.ok(cell.issues.length > 0); assert.ok(cell.reviewMessages.length > 0); assert.deepEqual(plain(cell.validationIssues), []);
    const before = f.retained(), files = f.originals(), seed = f.api.load('app/detail-workspace-seed.ts').initialDetailWorkspaceDocument;
    const document = seed({ view, workspace: null, roles: { top: [f.keys[2]], bottom: [f.keys[6]] } }, row.optionId);
    assert.deepEqual(plain(document.photos.map(photo => photo.key)), f.keys.slice(2, 7));
    assert.equal(f.retained(), before); assert.equal(f.originals(), files);
  } finally { f.api.close(); }
});

for (const company of companies) test(`${company.companyCode} 29 original body photos and both banners open without inheriting the 30 quotation attachment limit`, async () => {
  const f = await downloadFixture(company);
  try {
    const body = [...f.keys.slice(3, 6), ...Array.from({ length: 26 }, (_, index) => `owner/workspace-detail-${index}.png`)];
    const pool = [...new Set([...f.keys, ...body])], bytes = f.api.objects.get(f.keys[3]);
    for (const key of body) if (!f.api.objects.has(key)) f.api.objects.set(key, bytes.slice());
    f.api.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify(pool), f.product.id);
    const current = await json(await f.api.route(f.base + '/content'));
    await json(await f.api.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: current.content.revision,
      patch: { assets: { detailTop: [f.keys[2]], detail: body, detailBottom: [f.keys[6]] } } } }));
    const view = await json(await f.api.route(f.base + '/quotation-fields?profileId=cat'));
    const row = view.automatic.rows.find(row => row.optionId && row.included !== false), cell = row.fields.detailImages;
    const sequence = [f.keys[2], ...body, f.keys[6]];
    assert.deepEqual(cell.value.split('\n'), sequence); assert.deepEqual(plain(cell.validationIssues), [attachmentImageIssue]);
    const before = f.retained(), files = f.originals(), seed = f.api.load('app/detail-workspace-seed.ts').initialDetailWorkspaceDocument;
    let serial = 0; const document = seed({ view, workspace: null, roles: { top: [f.keys[2]], bottom: [f.keys[6]] } }, row.optionId, () => `source-${serial++}`);
    assert.equal(document.photos.length, 31); assert.equal(document.generatedHtml.match(/<img /gu).length, 31);
    assert.deepEqual(plain(document.photos.map(photo => [photo.originKey, photo.key])), sequence.map(key => [key, key]));
    assert.deepEqual(plain(document.photos.map(photo => photo.role)), ['top', ...body.map(() => 'body'), 'bottom']);
    const quotation = f.api.load('app/quotation-schema.ts');
    assert.equal(view.resolved.schema.fields.find(field => field.id === 'detailImages').maxItems, 30);
    assert.throws(() => quotation.validateQuotationChanges([{ optionId: row.optionId, fieldKey: 'detailImages', value: cell.value }], {
      schema: view.resolved.schema, optionIds: view.resolved.rows.flatMap(item => item.optionId ? [item.optionId] : []), ownedImageKeys: view.imageKeys, overrides: view.overrides,
    }));
    assert.equal(f.retained(), before); assert.equal(f.originals(), files);
  } finally { f.api.close(); }
});

test('source composition accepts 150 ordered owned photos while 151 and non-count validation failures remain rejected', async () => {
  for (const count of [150, 151]) {
    const f = await fixture(), sequence = [f.keys[0], ...Array.from({ length: count - 2 }, (_, index) => `owner/body-${index}.png`), f.keys[3]];
    f.view.imageKeys = [...sequence];
    const cell = f.view.automatic.rows[0].fields.detailImages;
    Object.assign(cell, { value: sequence.join('\n'), validationIssues: [attachmentImageIssue], issues: [attachmentImageIssue] });
    const immutable = JSON.stringify(f.view), { initialDetailWorkspaceDocument: seed } = runtime(f.request).load('app/detail-workspace-seed.ts');
    let serial = 0;
    if (count === 150) {
      const document = seed(f.reply(), 'red', () => `source-${serial++}`);
      assert.deepEqual(plain(document.photos.map(photo => photo.key)), sequence); assert.equal(serial, 150);
    } else { assert.throws(() => seed(f.reply(), 'red', () => `source-${serial++}`)); assert.equal(serial, 0); }
    assert.equal(JSON.stringify(f.view), immutable); assert.equal(f.calls.length, 0);
  }
  for (const change of [
    (f, cell, sequence) => { cell.value = [...sequence.slice(0, -2), sequence.at(-1)].join('\n'); },
    (f, cell, sequence) => { cell.value = [...sequence.slice(0, -2), sequence[1], sequence.at(-1)].join('\n'); },
    (f, cell) => { cell.value += '\n'; },
    (f, cell) => { cell.value = cell.value.replace('owner/body-0.png', ' owner/body-0.png'); },
    (f, cell) => { cell.value = cell.value.replace('owner/body-0.png', 'owner/missing.png'); },
    (f, cell) => { f.view.imageKeys.push('other/source.png'); cell.value = cell.value.replace('owner/body-0.png', 'other/source.png'); },
    (f, cell) => { const key = `owner/${'x'.repeat(512)}.png`; f.view.imageKeys.push(key); cell.value = cell.value.replace('owner/body-0.png', key); },
    (f, cell) => { cell.validationIssues.push('상품에 저장되지 않은 이미지 참조를 제외했습니다. 연결을 다시 확인해주세요.'); },
    (f, cell) => { cell.validationIssues.push('16000자 제한을 초과했습니다.'); },
    (f, cell) => { cell.validationIssues.push('알 수 없는 원본 연결 오류'); },
  ]) {
    const f = await fixture(), sequence = [f.keys[0], ...Array.from({ length: 29 }, (_, index) => `owner/body-${index}.png`), f.keys[3]];
    f.view.imageKeys = [...sequence];
    const cell = f.view.automatic.rows[0].fields.detailImages;
    Object.assign(cell, { value: sequence.join('\n'), validationIssues: [attachmentImageIssue], issues: [attachmentImageIssue] });
    change(f, cell, sequence);
    const immutable = JSON.stringify(f.view), { initialDetailWorkspaceDocument: seed } = runtime(f.request).load('app/detail-workspace-seed.ts');
    assert.throws(() => seed(f.reply(), 'red')); assert.equal(JSON.stringify(f.view), immutable); assert.equal(f.calls.length, 0);
  }
});

test('the new composition uses every exact automatic detail-role photo in order rather than final quotation composites or gallery images', async () => {
  const f = await fixture(), before = plain(f.view);
  const body = Array.from({ length: 11 }, (_, index) => `owner/collected-detail-${index}.png`), gallery = 'owner/unrelated-main.png', composite = 'owner/final-detail.png';
  f.view.imageKeys.push(...body, gallery, composite);
  const sequence = [f.keys[0], ...body, f.keys[3]];
  f.view.automatic.rows[0].fields.detailImages.value = sequence.join('\n');
  f.view.resolved.rows[0].fields.detailImages.value = composite;
  f.view.overrides.options.red.detailImages = composite;
  const immutable = JSON.stringify(f.view), { initialDetailWorkspaceDocument: seed } = runtime(f.request).load('app/detail-workspace-seed.ts');
  let serial = 0; const document = seed(f.reply(), 'red', () => `source-${serial++}`);
  assert.deepEqual(plain(document.photos.map(photo => photo.key)), sequence);
  assert.deepEqual(plain(document.photos.map(photo => photo.originKey)), sequence);
  assert.deepEqual(plain(document.photos.map(photo => photo.role)), ['top', ...body.map(() => 'body'), 'bottom']);
  assert.equal(document.generatedHtml.match(/<img /gu).length, 13);
  assert.equal(JSON.stringify(f.view), immutable); assert.equal(f.calls.length, 0); assert.deepEqual(before.imageKeys, f.keys.slice(0, 5));
});

test('a saved manually edited composition wins over automatic sources and retains IDs, origins, order and spacing', async () => {
  const f = await fixture(), h = panel(f);
  try {
    await h.idle(); await h.click('상세 편집 구성 열기'); await h.click('작업 사진 3 위로');
    h.control('편집 HTML 사진 간격 (px)').props.onChange({ target: { value: '19' } }); h.render(); await h.click('편집 구성 보관');
    const expected = plain(f.workspace.document), { initialDetailWorkspaceDocument: seed } = runtime(f.request).load('app/detail-workspace-seed.ts');
    f.view.automatic.rows[0].fields.detailImages.value = ''; f.view.automatic.rows[0].fields.detailImages.source = 'empty';
    const opened = seed(f.reply(), 'red', () => { throw Error('Saved photo IDs must never be regenerated.'); });
    assert.deepEqual(plain(opened), expected); opened.photos[0].key = 'owner/other.png'; assert.deepEqual(plain(f.workspace.document), expected);
  } finally { h.close(); }
});

test('missing, filtered, unowned or wrongly ordered source inputs never fall back to a final image or all gallery photos', async () => {
  for (const change of [
    f => { delete f.view.automatic.rows[0].fields.detailImages; },
    f => { f.view.automatic.rows[0].fields.detailImages.source = 'manual-option'; },
    f => { f.view.automatic.rows[0].fields.detailImages.issues = ['A collected source was not in the current pool.']; },
    f => { f.view.automatic.rows[0].fields.detailImages.value = 'other/source.png'; },
    f => { f.view.automatic.rows[0].fields.detailImages.value = [f.keys[1], f.keys[0], f.keys[3]].join('\n'); },
    f => { f.view.automatic.rows[0].fields.detailImages.value = f.keys[1]; },
  ]) {
    const f = await fixture(); change(f); const before = JSON.stringify(f.view), { initialDetailWorkspaceDocument: seed } = runtime(f.request).load('app/detail-workspace-seed.ts');
    assert.throws(() => seed(f.reply(), 'red')); assert.equal(JSON.stringify(f.view), before); assert.equal(f.calls.length, 0);
  }
});

test('primary opening reads once and displays the full source sequence without saving, assigning quote fields or imposing the thumbnail height cap', async () => {
  const f = await fixture(), composite = 'owner/final-detail.png'; f.view.imageKeys.push(composite);
  f.view.resolved.rows[0].fields.detailImages.value = composite; f.view.overrides.options.red.detailImages = composite;
  const before = JSON.stringify(f.view), h = panel(f); h.set({ primaryDetailTools: true });
  try {
    await h.idle(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'GET');
    assert.equal(h.render().props['data-workspace-dirty'], false, 'read-only initialization must not require a save to leave the stage');
    assert.deepEqual(photos(h).map(node => node.props.src), f.keys.slice(0, 4).map(key => '/api/files/' + key));
    assert.ok(photos(h).every(node => node.props.style.width === 760 && node.props.style.maxHeight === undefined));
    const stack = h.control('상세 작업 사진 순서'); assert.equal(stack.props.style.maxHeight, undefined); assert.equal(stack.props.style.overflow, undefined);
    for (let index = 0; index < 10; index++) { h.render(); await h.tick(); }
    assert.equal(f.calls.length, 1); assert.equal(f.workspace, null); assert.equal(f.storage.size, 0); assert.equal(h.adopted.length, 0); assert.equal(JSON.stringify(f.view), before);
    await h.click('작업 사진 2 제거'); assert.equal(h.render().props['data-workspace-dirty'], true, 'a real photo edit retains the existing unsaved-change guard');
    await h.click('현재 구성 닫기'); assert.equal(photos(h).length, 0); assert.equal(f.calls.length, 1, 'an explicit close must not trigger another automatic opening');
  } finally { h.close(); }
});

test('primary mode reports missing body photographs explicitly instead of silently showing gallery or final references', async () => {
  const f = await fixture(); f.view.automatic.rows[0].fields.detailImages.value = [f.keys[0], f.keys[3]].join('\n'); const h = panel(f); h.set({ primaryDetailTools: true });
  try {
    await h.idle(); assert.match(text(h.render()), /수집된 상세 본문 사진이 없습니다/u);
    assert.equal(photos(h).length, 2); assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0); assert.equal(h.adopted.length, 0);
  } finally { h.close(); }
});

test('an inactive primary panel performs no read and ignores a late prior-opening response after hide/reopen ABA', async () => {
  const f = await fixture(), gate = deferred(), entered = deferred(); let once = true;
  const request = async (url, init = {}) => { const response = await f.request(url, init); if (once) { once = false; entered.resolve(); await gate.promise; } return response; };
  const h = panel(f, request); h.set({ primaryDetailTools: true, stageActive: false });
  try {
    await h.idle(); assert.equal(f.calls.length, 0);
    h.set({ stageActive: true }); await h.tick(); await entered.promise; h.set({ stageActive: false }); await h.tick(); h.set({ stageActive: true }); await h.tick();
    assert.equal(photos(h).length, 0); gate.resolve(); await h.idle();
    assert.equal(f.calls.length, 2); assert.equal(photos(h).length, 4); assert.ok(f.calls.every(call => call.method === 'GET')); assert.equal(h.adopted.length, 0);
  } finally { gate.resolve(); h.close(); }
});
