import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import sharp from 'sharp';
import { pathToFileURL } from 'node:url';
import { compositeFixture, compositePanel, nodes, text } from './helpers/workspace-composite-ui.mjs';

const fixtureURL = pathToFileURL(process.cwd() + '/tests/detail-image-composite-panel.test.mjs'), source = fs.readFileSync(fixtureURL, 'utf8'), ast = ts.createSourceFile('fixture.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const statements = ast.statements.filter(node => ts.isImportDeclaration(node) || ts.isFunctionDeclaration(node) && node.name?.text === 'panel');
const extracted = statements.map(node => {
  let value = node.getFullText(ast);
  if (ts.isImportDeclaration(node)) { const name = node.moduleSpecifier.text; if (name.startsWith('.')) value = value.replace("'" + name + "'", JSON.stringify(new URL(name, fixtureURL).href)); }
  return value;
}).join('\n').replace('return{render,button,locks,saved,props', 'return{runtime,render,button,locks,saved,props') + '\nexport {panel,companies,makeCompositeFixture};';
const { panel, companies, makeCompositeFixture } = await import('data:text/javascript,' + encodeURIComponent(extracted));

test('saved workspace preview shows every ordered part and downloads the complete PNG ZIP read-only', async () => {
  const f = await compositeFixture(), h = compositePanel(f, { prepare: async (selection, saved) => {
    const original = f.prepared(selection, saved), first = new Blob(['first'], { type: 'image/png' }), second = new Blob(['second'], { type: 'image/png' });
    return { ...original, output: first, height: 12000, partsPolicy: 'photo-boundary-parts-v2', parts: [
      { output: first, start: 0, end: 2, width: 800, height: 12000 },
      { output: second, start: 2, end: original.keys.length, width: 800, height: 10000 },
    ] };
  } });
  try {
    await h.click('보관 구성 합치기');
    const images = nodes(h.render()).filter(node => node.type === 'img');
    assert.equal(images.length, 2); assert.notEqual(images[0].props.src, images[1].props.src);
    assert.match(text(h.render()), /원본 \d+장 → 출력 2장/); assert.match(text(h.render()), /12,000px/); assert.match(text(h.render()), /10,000px/);
    await h.click('보관 구성 PNG 다운로드'); assert.equal(h.downloads.length, 1); assert.match(h.downloads[0].download, /workspace-detail\.zip$/);
    assert.equal(h.calls.filter(call => call.action === 'apply').length, 0); assert.equal(h.saved.length, 0);
  } finally { h.close(); }
});

test('ordinary detail preview shows both full-size parts and names multi-JPG downloads as ZIP', async () => {
  const f = await makeCompositeFixture(companies[0], { count: 4 }); let h;
  try {
    for (const [index, key] of f.selectedKeys.entries()) f.api.objects.set(key, new Uint8Array(await sharp({ create: { width: 800, height: 6000, channels: 4, background: index % 2 ? '#ee8800' : '#1199aa' } }).png().toBuffer()));
    h = panel(f); const downloads = [], document = h.runtime.document, create = document.createElement.bind(document);
    document.createElement = tag => tag === 'a' ? { click() { downloads.push({ name: this.download, blob: h.runtime.blobs.get(this.href) }); } } : create(tag);
    const before = f.retained(); await h.click('상세 이미지 합치기');
    assert.equal(nodes(h.render()).filter(node => node.type === 'img').length, 2); assert.match(text(h.render()), /원본 4장 → 출력 2장/);
    await h.click('통합 이미지 다운로드'); assert.equal(downloads.length, 1); assert.match(downloads[0].name, /detail\.zip$/); assert.equal(downloads[0].blob.type, 'application/zip');
    assert.equal(f.retained(), before); assert.equal(f.calls.filter(call => ['POST', 'PUT', 'PATCH'].includes(call.init.method)).length, 0);
  } finally { h?.close(); f.api.close(); }
});
