import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/free-image-edit-history.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const { createFreeImageEditHistory: create, recordFreeImageEdit: record, endFreeImageEditGroup: end,
  undoFreeImageEdit: undo, redoFreeImageEdit: redo, moveFreeImageEditRegion: move, FREE_IMAGE_EDIT_HISTORY_LIMIT: limit } = exports;
const plain = value => JSON.parse(JSON.stringify(value));
const region = (id, patch = {}) => ({ id, text: '原文', translated: '직접 수정', translationProvenance: 'manual',
  issue: null, box: { x: 1, y: 2, width: 90, height: 40 }, confidence: 98, selected: true,
  background: '#ffffff', foreground: '#123456', fontSize: 20, ...patch });

test('undo and redo restore geometry, styles, manual blanks, selection, erase and translation provenance exactly', () => {
  const before = [region('a', { bold: true, lineHeight: 0.8 }), region('b', { erase: true })];
  const next = [region('a', { translated: '', translationProvenance: 'empty', issue: '번역 실패', selected: false,
    italic: true, fontFamily: 'gmarket', textAlign: 'right', box: { x: 40, y: 30, width: 15, height: 8 } })];
  const history = record(create(), before, next), restored = undo(history, next);
  assert.deepEqual(plain(restored.regions), before);
  assert.deepEqual(plain(redo(restored.history, restored.regions).regions), next);
  assert.equal(history.past.length, 1); assert.equal(restored.history.future.length, 1);
});

test('recorded and returned snapshots never share mutable arrays or region geometry with caller', () => {
  const before = [region('a')], next = [region('a', { translated: '다음' })];
  const history = record(create(), before, next);
  before[0].box.x = 777; before[0].translated = '오염'; before.push(region('extra'));
  const restored = undo(history, next);
  assert.equal(restored.regions.length, 1); assert.equal(restored.regions[0].box.x, 1);
  assert.equal(restored.regions[0].translated, '직접 수정');
  restored.regions[0].box.y = 888; next[0].translated = '뒤늦은 변경';
  const replay = redo(restored.history, restored.regions);
  assert.equal(replay.regions[0].translated, '다음');
  replay.regions[0].box.x = 999;
  assert.equal(restored.history.future[0][0].box.x, 1);
  assert.equal(history.past[0][0].box.x, 1);
});

test('typing in one focus session is one undo action and blur starts a separate action', () => {
  let history = create(), rows = [region('a', { translated: '' })];
  for (const translated of ['수', '수정', '수정 완료']) {
    const next = [region('a', { translated })]; history = record(history, rows, next, 'focus-1'); rows = next;
  }
  assert.equal(history.past.length, 1);
  const firstUndo = undo(history, rows); assert.equal(firstUndo.regions[0].translated, '');
  history = end(history);
  const next = [region('a', { translated: '다른 수정' })]; history = record(history, rows, next, 'focus-2');
  assert.equal(history.past.length, 2); assert.equal(undo(history, next).regions[0].translated, '수정 완료');
});

test('different field, discrete operation and accepted translation each separate the history group', () => {
  const initial = [region('a')], text = [region('a', { text: '다른 원문' })], translated = [region('a', { text: '다른 원문', translated: '다른 번역' })];
  let history = record(create(), initial, text, 'source'); history = record(history, text, translated, 'translated');
  const erased = [region('a', { ...translated[0], erase: true })]; history = record(history, translated, erased);
  const accepted = [region('a', { ...erased[0], translated: '자동 번역', translationProvenance: 'generated', issue: null })];
  history = record(history, erased, accepted);
  assert.equal(history.past.length, 4); assert.deepEqual(plain(undo(history, accepted).regions), erased);
});

test('a no-op preserves redo while a real edit after undo clears the previous branch', () => {
  const before = [region('a')], next = [region('a', { translated: '다음' })];
  const restored = undo(record(create(), before, next), next);
  const noOp = record(restored.history, restored.regions, plain(restored.regions), 'focus');
  assert.equal(noOp, restored.history); assert.equal(noOp.future.length, 1);
  const branched = record(noOp, restored.regions, [region('a', { selected: false })], 'focus');
  assert.equal(branched.future.length, 0); assert.equal(redo(branched, before), null);
});

test('last twenty actions share a bounded undo/redo budget and preserve retained baseline', () => {
  let history = create(), rows = [];
  for (let index = 1; index <= 40; index++) {
    const next = [region('a', { translated: String(index) })]; history = record(history, rows, next); rows = next;
  }
  assert.equal(limit, 20); assert.equal(history.past.length, 20);
  for (let index = 0; index < 20; index++) {
    const result = undo(history, rows); history = result.history; rows = result.regions;
    assert.equal(history.past.length + history.future.length, 20);
  }
  assert.equal(rows[0].translated, '20'); assert.equal(undo(history, rows), null);
  for (let index = 0; index < 20; index++) {
    const result = redo(history, rows); history = result.history; rows = result.regions;
    assert.equal(history.past.length + history.future.length, 20);
  }
  assert.equal(rows[0].translated, '40'); assert.equal(redo(history, rows), null);
  const next = [region('a', { translated: '41' })]; assert.equal(record(history, rows, next).past.length, 20);
});

test('delete all regions remains undoable, and moving layers preserves all region contents', () => {
  const rows = [region('bottom'), region('middle', { erase: true }), region('top')];
  assert.deepEqual(plain(undo(record(create(), rows, []), []).regions), rows);
  const forwards = move(rows, 'middle', 1), backwards = move(rows, 'middle', -1);
  assert.deepEqual(Array.from(forwards, row => row.id), ['bottom', 'top', 'middle']);
  assert.deepEqual(Array.from(backwards, row => row.id), ['middle', 'bottom', 'top']);
  for (const shifted of [forwards, backwards]) for (const row of shifted) assert.equal(row, rows.find(value => value.id === row.id));
  assert.deepEqual(plain(undo(record(create(), rows, forwards), forwards).regions), rows);
  assert.deepEqual(rows.map(row => row.id), ['bottom', 'middle', 'top']);
});

test('layer bounds, missing or ambiguous IDs and invalid direction never disturb order', () => {
  const rows = [region('a'), region('b')];
  for (const [id, direction] of [['a', -1], ['b', 1], ['missing', 1], ['a', 0], ['a', 2]]) assert.deepEqual(plain(move(rows, id, direction)), rows);
  const duplicates = [region('a'), region('a')]; assert.deepEqual(plain(move(duplicates, 'a', 1)), duplicates);
});

test('invalid intermediate numeric drafts are retained without JSON coercion or conflation', () => {
  const before = [region('a', { fontSize: NaN, box: { x: -0, y: Infinity, width: 90, height: 40 } })];
  const next = [region('a', { fontSize: null, box: { x: 0, y: null, width: 90, height: 40 } })];
  const history = record(create(), before, next), restored = undo(history, next);
  assert.equal(history.past.length, 1); assert.ok(Number.isNaN(restored.regions[0].fontSize));
  assert.ok(Object.is(restored.regions[0].box.x, -0)); assert.equal(restored.regions[0].box.y, Infinity);
  assert.equal(record(create(), before, [region('a', { ...before[0], box: { ...before[0].box } })]).past.length, 0);
});

test('empty history cannot restore regions and explicit group ending does not mutate prior state', () => {
  const history = create(); assert.equal(undo(history, [region('a')]), null); assert.equal(redo(history, []), null);
  assert.equal(end(history), history);
  const grouped = record(history, [], [region('a')], 'focus'); const ended = end(grouped);
  assert.equal(grouped.group, 'focus'); assert.equal(ended.group, null); assert.equal(ended.past, grouped.past);
});
