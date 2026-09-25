import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file) {
  const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require(name) { if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`); throw Error(name); } });
  return exports;
}
const model = load('app/product-options.ts'); const tools = load('app/option-editor-tools.ts');
const policy = { exchangeRate: 100, supplyMargin: 0, coupangMargin: 0, minimumMargin: 0, msrpMultiple: 1, roundingUnit: 10 };
const row = (id, extra = {}) => ({ ...model.emptyOptionInput(id), originalName: `原文-${id}`, translatedName: `옵션 ${id}`, supplierSku: `SKU-${id}`, unitCostCny: 0.1, unitsPerPack: 1, widthCm: 10, imageKey: 'owner/image.png', included: true, ...extra });

test('bulk image preview preserves unselected options and facts, permits common-image reset and rejects removed files',()=>{
 const rows=[row('a'),row('b',{stock:25})],before=JSON.stringify(rows),keys=['owner/image.png','owner/new.png'];
 const preview=tools.previewOptionBulk(rows,['b'],{type:'imageKey',value:keys[1]},policy,keys);
 assert.equal(JSON.stringify(rows),before);assert.equal(preview.rows[0].imageKey,keys[0]);assert.equal(preview.rows[1].imageKey,keys[1]);assert.equal(preview.rows[1].stock,25);assert.equal(preview.rows[1].supplierSku,'SKU-b');assert.equal(preview.changes[0].beforePrice,preview.changes[0].afterPrice);
 assert.throws(()=>tools.applyOptionBulk(rows,preview,policy,[keys[0]]),/이미지/);
 const next=tools.applyOptionBulk(rows,preview,policy,keys);assert.equal(next[1].imageKey,keys[1]);
 const clear=tools.previewOptionBulk(next,['b'],{type:'imageKey',value:null},policy,keys);assert.equal(tools.applyOptionBulk(next,clear,policy,keys)[1].imageKey,null);assert.equal(next[1].imageKey,keys[1]);
 assert.throws(()=>tools.previewOptionBulk(rows,['b'],{type:'imageKey',value:'another/image.png'},policy,keys),/이미지/);
});

test('bulk quantity preview changes only chosen rows and recalculates actual supply price without mutating input', () => {
  const rows = [row('a'), row('b')]; const original = JSON.stringify(rows);
  const preview = tools.previewOptionBulk(rows, ['b'], { type: 'unitsPerPack', value: 3 }, policy);
  assert.equal(JSON.stringify(rows), original); assert.equal(preview.rows[0].unitsPerPack, 1); assert.equal(preview.rows[1].unitsPerPack, 3);
  assert.equal(preview.changes[0].beforePrice, 10); assert.equal(preview.changes[0].afterPrice, 30);
  assert.equal(preview.rows[1].supplierSku, 'SKU-b'); assert.equal(preview.rows[1].widthCm, 10); assert.equal(preview.rows[1].imageKey, 'owner/image.png');
  const applied = tools.applyOptionBulk(rows, preview, policy); assert.equal(applied[1].unitsPerPack, 3); assert.notEqual(applied, preview.rows);
});

test('stale previews cannot overwrite subsequent edits or reordered options', () => {
  const rows = [row('a'), row('b')]; const preview = tools.previewOptionBulk(rows, ['a'], { type: 'unitCostCny', value: 12.5 }, policy);
  assert.throws(() => tools.applyOptionBulk([{ ...rows[0], translatedName: '이후 수정' }, rows[1]], preview, policy), /미리보기/);
  assert.throws(() => tools.applyOptionBulk([...rows].reverse(), preview, policy), /미리보기/);
  assert.equal(rows[0].unitCostCny, 0.1);
});

test('include/exclude/remove previews preserve facts, expose missing-cost calculation errors and permit cancellation without writes', () => {
  const rows = [row('a', { included: false, unitCostCny: null }), row('b')];
  const include = tools.previewOptionBulk(rows, ['a'], { type: 'include' }, policy);
  assert.equal(include.rows[0].included, true); assert.equal(include.rows[0].unitCostCny, null); assert.ok(include.changes[0].error);
  const exclude = tools.previewOptionBulk(rows, ['b'], { type: 'exclude' }, policy);
  assert.equal(exclude.rows[1].included, false); assert.equal(exclude.rows[1].supplierSku, 'SKU-b'); assert.equal(exclude.changes[0].afterPrice, null);
  const remove = tools.previewOptionBulk(rows, ['a'], { type: 'remove' }, policy);
  assert.deepEqual(Array.from(remove.rows, item => item.id), ['b']); assert.equal(remove.changes[0].after, null);
  assert.equal(rows.length, 2); assert.equal(rows[0].included, false);
});

test('batch numbers and selections are validated rather than accepting invalid bulk changes', () => {
  const rows = [row('a')];
  for (const action of [{ type: 'unitsPerPack', value: 0 }, { type: 'unitsPerPack', value: 1.5 }, { type: 'unitsPerPack', value: 1000001 }, { type: 'unitCostCny', value: 0 }, { type: 'unitCostCny', value: NaN }, { type: 'unitCostCny', value: Infinity }]) assert.throws(() => tools.previewOptionBulk(rows, ['a'], action, policy));
  for (const selected of [[], ['missing'], ['a', 'a']]) assert.throws(() => tools.previewOptionBulk(rows, selected, { type: 'include' }, policy));
});

test('reordering preserves row identity and duplication keeps facts but clears the unique supplier SKU and inclusion', () => {
  const rows = [row('a'), row('b'), row('c')];
  assert.deepEqual(Array.from(tools.moveOption(rows, 'b', -1), item => item.id), ['b', 'a', 'c']);
  assert.equal(tools.moveOption(rows, 'a', -1)[0], rows[0]); assert.equal(rows[0].id, 'a');
  const copied = tools.duplicateOption(rows, 'b', 'copy');
  assert.deepEqual(Array.from(copied, item => item.id), ['a', 'b', 'copy', 'c']); assert.equal(copied[2].supplierSku, ''); assert.equal(copied[2].included, false);
  for (const key of ['originalName', 'translatedName', 'unitCostCny', 'unitsPerPack', 'widthCm', 'imageKey']) assert.equal(copied[2][key], rows[1][key]);
  assert.throws(() => tools.duplicateOption(rows, 'b', 'a'));
});

test('asset list displays saved role order, supports assigned/unassigned filters and excludes unavailable references', () => {
  const assets = { main: ['m'], additional: ['b', 'a'], detail: ['d', 'missing'], size: [], label: [] };
  assert.deepEqual(Array.from(tools.orderedEditorImages(['a', 'b', 'm', 'unused', 'd'], assets, 'all')), ['m', 'b', 'a', 'd', 'unused']);
  assert.deepEqual(Array.from(tools.orderedEditorImages(['a', 'b', 'm', 'unused', 'd'], assets, 'additional')), ['b', 'a']);
  assert.deepEqual(Array.from(tools.orderedEditorImages(['a', 'b', 'm', 'unused', 'd'], assets, 'unassigned')), ['unused']);
  assets.additional.reverse(); assert.deepEqual(Array.from(tools.orderedEditorImages(['a', 'b'], assets, 'additional')), ['a', 'b']);
});

test('duplicating an option clears SKU-specific stock while bulk edits retain it',()=>{
 const rows=[row('a',{stock:23})];const copy=tools.duplicateOption(rows,'a','copy');
 assert.equal(copy[0].stock,23);assert.equal(copy[1].stock,null);assert.equal(copy[1].supplierSku,'');assert.equal(copy[1].included,false);
 const preview=tools.previewOptionBulk(rows,['a'],{type:'unitsPerPack',value:3},policy);
 assert.equal(tools.applyOptionBulk(rows,preview,policy)[0].stock,23);assert.equal(rows[0].stock,23);
});

test('bundle addition preserves original options and calculates separate bundle prices without inventing stock or packaging',()=>{
 const rows=[row('a',{stock:23,weightKg:0.4}),row('b')],before=JSON.stringify(rows);
 const preview=tools.previewOptionBulk(rows,['a'],{type:'addBundle',value:3,newIds:{a:'bundle-a'}},policy);
 assert.equal(JSON.stringify(rows),before);
 assert.equal(JSON.stringify(preview.rows[0]),JSON.stringify(rows[0]));
 assert.equal(JSON.stringify(preview.rows[2]),JSON.stringify(rows[1]));
 const added=preview.rows[1];
 assert.equal(added.id,'bundle-a');assert.equal(added.unitsPerPack,3);assert.equal(added.translatedName,'옵션 a (3개입)');
 assert.equal(added.unitCostCny,0.1);assert.equal(added.imageKey,rows[0].imageKey);assert.equal(added.supplierSku,'');
 for(const key of ['stock','minimumOrderQuantity','widthCm','lengthCm','heightCm','weightKg']) assert.equal(added[key],null);
 assert.equal(preview.changes[0].after.id,'bundle-a');assert.equal(preview.changes[0].beforePrice,10);assert.equal(preview.changes[0].afterPrice,30);
 assert.equal(tools.applyOptionBulk(rows,preview,policy).length,3);
 assert.throws(()=>tools.applyOptionBulk([{...rows[0],unitCostCny:1},rows[1]],preview,policy),/미리보기/);
});

test('bundle addition rejects invalid quantities, duplicate IDs and option capacity overflow',()=>{
 const rows=[row('a'),row('b')];
 for(const value of [1,101,2.5,NaN]) assert.throws(()=>tools.previewOptionBulk(rows,['a'],{type:'addBundle',value,newIds:{a:'new'}},policy));
 for(const newIds of [{},{a:'a'},{a:'same',b:'same'}]) assert.throws(()=>tools.previewOptionBulk(rows,['a','b'],{type:'addBundle',value:2,newIds},policy));
 assert.throws(()=>tools.previewOptionBulk(Array.from({length:model.OPTION_LIMIT},(_,i)=>row(String(i))),['0'],{type:'addBundle',value:2,newIds:{0:'new'}},policy));
 const blank=tools.previewOptionBulk([row('a',{translatedName:''})],['a'],{type:'addBundle',value:2,newIds:{a:'new'}},policy);
 assert.equal(blank.rows[1].translatedName,'');
});

test('bulk previews must be recalculated after any price policy change without changing the draft',()=>{
 const rows=[row('a'),row('b',{included:false})];
 const action={type:'unitsPerPack',value:3};
 const preview=tools.previewOptionBulk(rows,['a'],action,policy);
 const before=JSON.stringify(rows);
 for(const [field,value] of Object.entries({exchangeRate:200,supplyMargin:20,coupangMargin:20,minimumMargin:3000,msrpMultiple:1.3,roundingUnit:100,roundingMode:'nearest'})){
  assert.throws(()=>tools.applyOptionBulk(rows,preview,{...policy,[field]:value}),/가격 정책/);
  assert.equal(JSON.stringify(rows),before);
 }
 const reordered=Object.fromEntries(Object.entries({...policy,roundingMode:'up'}).reverse());
 assert.equal(tools.applyOptionBulk(rows,preview,reordered)[0].unitsPerPack,3);
 const changed={...policy,exchangeRate:200};
 const fresh=tools.previewOptionBulk(rows,['a'],action,changed);
 const applied=tools.applyOptionBulk(rows,fresh,changed);
 assert.equal(fresh.changes[0].afterPrice,preview.changes[0].afterPrice*2);
 assert.equal(applied[1].included,false);assert.equal(applied[1].unitsPerPack,rows[1].unitsPerPack);
});
