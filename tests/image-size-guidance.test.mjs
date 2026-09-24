import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const nativeRequire = createRequire(import.meta.url);
function load(file) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require(name) {
    if (name === '@/app/image-size-guidance') return load('app/image-size-guidance.ts');
    return nativeRequire(name);
  } });
  return exports;
}
const { imageSizeGuidance: guide } = load('app/image-size-guidance.ts');
const { ImageSizeNotice } = load('app/components/image-size-notice.tsx');
test('editor roles and quotation roles agree at image-size boundaries', () => {
  for (const role of ['main', 'mainImage']) {
    assert.equal(guide(role, 1000, 1000).length, 0);
    assert.match(guide(role, 999, 1500)[0], /대표/);
    assert.match(guide(role, 1500, 999)[0], /대표/);
  }
  for (const role of ['detailTop', 'detail', 'detailBottom', 'detailImages']) {
    assert.equal(guide(role, 780, 1500).length, 0);
    assert.match(guide(role, 780, 1501)[0], /상세/);
    assert.match(guide(role, 779, 1000)[0], /상세/);
  }
  for (const role of ['', 'label', 'size', 'additional']) assert.equal(guide(role, 1, 2000).length, 0);
  for (const value of [0, -1, NaN, Infinity, 1.5]) assert.match(guide('main', value, 1000)[0], /확인하지 못/);
});
test('image notice distinguishes unloaded, failed, measured and role changes without claiming acceptance', () => {
  const render = (size, role) => renderToStaticMarkup(createElement(ImageSizeNotice, { size, role }));
  assert.match(render(undefined, 'main'), /불러오면/);
  assert.match(render(null, 'main'), /불러오지 못/);
  const size = { width: 780, height: 1500 };
  assert.match(render(size, 'main'), /대표 이미지는/);
  assert.ok(!render(size, 'detail').includes('대표 이미지는'));
  assert.match(render(size, 'detail'), /780×1,500px/);
  assert.ok(!render(size, 'detail').includes('완료'));
});
