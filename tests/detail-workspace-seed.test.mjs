import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, panel, runtime, nodes, text, deferred, plain } from './helpers/detail-workspace.mjs';
import { companies, downloadFixture, json } from './helpers/image-download-ui.mjs';

const photos = h => nodes(h.render()).filter(node => node.type === 'img' && /^상세 작업 사진 /u.test(node.props.alt ?? ''));

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
