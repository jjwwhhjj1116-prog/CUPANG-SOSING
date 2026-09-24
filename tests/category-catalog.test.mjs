import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const observation = JSON.parse(fs.readFileSync(new URL('../docs/couplus-category-dom-2026-09-22.json', import.meta.url), 'utf8'));
const hubObservation = JSON.parse(fs.readFileSync(new URL('../docs/supplier-hub-category-ids-2026-09-22.json', import.meta.url), 'utf8'));
const braceObservation = JSON.parse(fs.readFileSync(new URL('../docs/supplier-hub-81452-product-2026-09-24.json', import.meta.url), 'utf8'));
const source = ts.transpileModule(fs.readFileSync(new URL('../app/category-catalog.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
function load(hub = hubObservation) {
  const model = {};
  vm.runInNewContext(source, { exports: model, require(name) {
    if (name === '../docs/couplus-category-dom-2026-09-22.json') return observation;
    if (name === '../docs/supplier-hub-category-ids-2026-09-22.json') return hub;
    if (name === '@/app/category-profiles') { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/category-profiles.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports }); return exports; }
    throw Error(name);
  } });
  return model;
}
const model = load();
const plain = value => JSON.parse(JSON.stringify(value));
const knownPath = ['주방용품', '주방수납/정리', '주방수납바구니/바스켓'];
const profile = (id, categoryId, categoryPath, extra = {}) => ({ id, name: `설정 ${id}`, categoryId, categoryPath,
  revision: 1, verification: 'draft', template: null, mappings: [], createdAt: '2026-09-22', updatedAt: '2026-09-22', ...extra });

test('hierarchy imports only observed root/child paths with exact order and all 22 observed leaves', () => {
  const choices = model.categoryChoices([]);
  assert.deepEqual(plain(model.categoryLevel(choices, [], 0)), observation.rootLabels);
  let count = 0;
  for (const node of observation.nodes) {
    assert.deepEqual(plain(model.categoryLevel(choices, node.path, node.path.length)), node.children.map(child => child.label));
    if (node.path.length === 1) count += node.children.length;
  }
  assert.equal(count, 173);
  assert.equal(choices.filter(choice => choice.isLeaf).length, 26);
  assert.equal(choices.filter(model.canConfirmCategory).length, model.categoryObservationScope.knownCodes);
  const verified = choices.filter(choice => choice.codeEvidence === 'supplier-hub');
  assert.equal(verified.length, model.categoryObservationScope.supplierHubCodes);
  assert.ok(verified.length >= 5);
  for (const choice of verified.filter(choice => !['64497','103495','77442'].includes(choice.categoryId))) assert.ok([...hubObservation.categoryIds, braceObservation].some(record => record.categoryId === choice.categoryId && JSON.stringify(record.path) === JSON.stringify(choice.path)));
  assert.deepEqual(plain(model.categoryLevel(choices, ['기프트카드'], 1)), []);
  assert.equal(choices.find(choice => choice.path.join() === '기프트카드').childrenObserved, false);
  assert.equal(model.categoryObservationScope.fullCatalogVerified, false);
});

test('unknown leaves and unobserved branches cannot become 80719 profiles, but observed known code preserves its exact path', () => {
  const partial = load({ ...hubObservation, categoryIds: [] });
  for (const choice of partial.categoryChoices([])) {
    if (choice.categoryId === '80719') {
      assert.deepEqual(plain(choice.path), knownPath);
      const result = partial.categoryProfileForChoice(choice);
      assert.equal(result.categoryId, '80719'); assert.equal(result.template, null); assert.deepEqual(plain(result.mappings), []);
    } else if (['77442', '81452', '64497', '103495'].includes(choice.categoryId)) {
      assert.equal(partial.canConfirmCategory(choice), true);
      assert.equal(choice.codeEvidence, ['81452','64497','103495','77442'].includes(choice.categoryId) ? 'supplier-hub' : 'couplus');
    } else {
      assert.equal(partial.canConfirmCategory(choice), false);
      assert.throws(() => partial.categoryProfileForChoice(choice), /코드/);
    }
  }
  const unknown = partial.categoryChoices([]).find(choice => choice.path.at(-1) === '바나나걸이');
  const seed = partial.categoryAdvancedSeed(unknown);
  assert.equal(seed.categoryId, ''); assert.deepEqual(plain(seed.categoryPath), ['주방용품', '주방수납/정리', '바나나걸이']);
  assert.equal(seed.profileId, undefined);
});

test('brace category preserves its path with independently observed Supplier Hub code evidence', () => {
  const leaf = model.categoryChoices([]).find(choice => choice.categoryId === '81452');
  assert.deepEqual(plain(leaf.path), ['스포츠/레져', '헬스/요가', '헬스기구/용품', '헬스보호대']);
  assert.equal(leaf.codeEvidence, 'supplier-hub'); assert.equal(leaf.codeObservedAt, '2026-09-24');
  const profile = model.categoryProfileForChoice(leaf);
  assert.equal(profile.categoryId, '81452'); assert.equal(profile.template, null);
});

test('saved profiles retain their own IDs and exact paths, including duplicate names and distinct configurations', () => {
  const first = profile('one', '90001', ['생활용품', '다른 바스켓']);
  const second = profile('two', '80719', knownPath, { name: '바스켓 원본 연결', template: { storageKey: 'owner/template.xlsx' } });
  const third = profile('three', '80719', knownPath, { name: '바스켓 다른 양식' });
  const fourth = profile('four', '90002', ['별도 대분류', '주방수납바구니/바스켓']);
  const choices = model.categoryChoices([first, second, third, fourth]);
  assert.equal(choices.find(choice => choice.profileId === 'one').categoryId, '90001');
  assert.equal(choices.find(choice => choice.profileId === 'four').categoryId, '90002');
  assert.equal(choices.find(choice => choice.profileId === 'four').codeEvidence, 'saved');
  assert.equal(choices.find(choice => choice.profileId === 'two').templateLinked, true);
  assert.equal(choices.find(choice => choice.profileId === 'two').codeEvidence, 'supplier-hub');
  assert.equal(choices.filter(choice => choice.key === 'observed:80719').length, 0);
  assert.deepEqual(plain(model.categoryChoicesAtPath(choices, knownPath).map(choice => choice.profileId)), ['two', 'three']);
  assert.deepEqual(plain(model.categoryAdvancedSeed(choices.find(choice => choice.profileId === 'two'))), { categoryPath: knownPath, categoryId: '80719', profileId: 'two' });
  assert.ok(model.categoryLevel(choices, [], 0).includes('별도 대분류'));
});

test('saved codes cannot silently replace differing Hub codes, and code-less drafts stay blocked', () => {
  const banana = ['주방용품', '주방수납/정리', '바나나걸이'];
  const draftPath = ['주방용품', '주방수납/정리', '기타수납/정리용품'];
  const choices = model.categoryChoices([profile('manual-banana', '12345', banana), profile('draft', '', draftPath)]);
  assert.equal(model.categoryChoicesAtPath(choices, banana).length, 2);
  assert.equal(model.categoryChoicesAtPath(choices, banana)[0].categoryId, '12345');
  assert.equal(model.categoryChoicesAtPath(choices, banana)[0].codeEvidence, 'saved');
  assert.equal(model.categoryChoicesAtPath(choices, banana)[1].categoryId, '109047');
  assert.equal(model.categoryChoicesAtPath(choices, banana)[1].codeEvidence, 'supplier-hub');
  assert.equal(model.canConfirmCategory(choices.find(choice => choice.profileId === 'draft')), false);
  assert.equal(model.categoryChoicesAtPath(choices, draftPath).length, 2);
  assert.equal(choices.filter(model.canConfirmCategory).length, model.categoryObservationScope.knownCodes + 1);
});

test('only exact observed leaf paths receive Hub IDs; branches, similar labels and conflicting records do not', () => {
  const banana = ['주방용품', '주방수납/정리', '바나나걸이'];
  const records = [
    { path: banana, categoryId: '109047', observedAt: '2026-09-22T11:48:36.726Z' },
    { path: ['주방용품', '주방수납/정리'], categoryId: '99991', observedAt: '2026-09-22' },
    { path: ['생활용품', '바나나걸이'], categoryId: '99992', observedAt: '2026-09-22' },
    { path: ['주방용품', '주방수납/정리', '기타수납/정리용품'], categoryId: '80720', observedAt: '2026-09-22' },
    { path: ['주방용품', '주방수납/정리', '기타수납/정리용품'], categoryId: '99993', observedAt: '2026-09-22' },
  ];
  const bounded = load({ ...hubObservation, categoryIds: records, verifiedLeafCount: 9999 });
  const choices = bounded.categoryChoices([]);
  assert.equal(bounded.categoryObservationScope.supplierHubCodes, 5);
  assert.equal(bounded.categoryObservationScope.knownCodes, 6);
  assert.equal(choices.find(choice => choice.categoryId === '109047').codeEvidence, 'supplier-hub');
  assert.equal(choices.find(choice => choice.categoryId === '80719').codeEvidence, 'couplus');
  assert.equal(choices.find(choice => choice.path.at(-1) === '기타수납/정리용품').categoryId, '');
  assert.ok(!choices.some(choice => choice.categoryId.startsWith('9999')));
  assert.deepEqual(plain(bounded.categoryProfileForChoice(choices.find(choice => choice.categoryId === '109047'))), { name: '바나나걸이', categoryId: '109047', categoryPath: banana, template: null, mappings: [] });
});

test('using a known ID on a different saved path does not transfer official code evidence', () => {
  const choices = model.categoryChoices([profile('wrong-path', '80719', ['다른 대분류', '주방수납바구니/바스켓'])]);
  const saved = choices.find(choice => choice.profileId === 'wrong-path');
  assert.equal(saved.codeEvidence, 'saved'); assert.equal(saved.codeObservedAt, null);
  const observed = choices.find(choice => choice.key === 'observed:80719');
  assert.equal(observed.codeEvidence, 'supplier-hub');
});

test('search finds code, full branch paths and saved profile names without assigning IDs by label similarity', () => {
  const choices = model.categoryChoices([profile('p1', '45678', ['신규 분류', '기타 바스켓'], { name: '우리 회사 새 양식' })]);
  assert.equal(model.searchCategoryChoices(choices, '80719')[0].key, 'observed:80719');
  assert.equal(model.searchCategoryChoices(choices, '우리 회사')[0].profileId, 'p1');
  assert.ok(model.searchCategoryChoices(choices, '주방용품 주방수납').every(choice => choice.path.includes('주방수납/정리')));
  assert.equal(model.searchCategoryChoices(choices, '없는카테고리')[0], undefined);
  assert.deepEqual(plain(model.categoryLevel(choices, [], 1)), []);
  assert.deepEqual(plain(model.categoryLevel(choices, ['뷰티'], -1)), []);
});

test('board category can be reached at every level, searched, and converted to an exact quotation profile',()=>{
 const choices=model.categoryChoices([]);const path=['완구/취미','보드게임','바둑/체스/윷놀이','바둑','바둑알+바둑판'];
 for(let depth=0;depth<path.length;depth++)assert.ok(model.categoryLevel(choices,path.slice(0,depth),depth).includes(path[depth]));
 const leaf=model.searchCategoryChoices(choices,'77442')[0];
 assert.equal(model.canConfirmCategory(leaf),true);assert.equal(leaf.codeEvidence,'supplier-hub');assert.equal(leaf.codeObservedAt,'2026-09-24');
 assert.deepEqual(plain(model.categoryProfileForChoice(leaf)),{name:'바둑알+바둑판',categoryId:'77442',categoryPath:path,template:null,mappings:[]});
 assert.equal(model.categoryChoicesAtPath(choices,path.slice(0,-1))[0].childrenObserved,false);
 const saved=model.categoryChoices([profile('board','77442',path)]);
 assert.equal(saved.filter(c=>c.categoryId==='77442').length,1);assert.equal(saved.find(c=>c.profileId==='board').codeEvidence,'supplier-hub');
 const wrong=model.categoryChoices([profile('wrong','77442',['다른 분류','바둑알+바둑판'])]);
 assert.equal(wrong.find(c=>c.profileId==='wrong').codeEvidence,'saved');
});

test('64497 breadcrumb retains Couplus display with official code evidence and no Excel claim',()=>{
 const choices=model.categoryChoices([]);const leaf=choices.find(choice=>choice.categoryId==='64497');
 const path=['생활용품','욕실용품','욕실수납/정리','양치용품정리'];
 assert.deepEqual(plain(leaf.path),path);assert.equal(leaf.codeEvidence,'supplier-hub');assert.equal(leaf.templateLinked,false);
 for(let index=0;index<path.length;index++)assert.ok(model.categoryLevel(choices,path.slice(0,index),index).includes(path[index]));
 assert.equal(model.canConfirmCategory(leaf),true);assert.equal(model.categoryProfileForChoice(leaf).template,null);
});

test('103495 is reachable by observed breadcrumb without claiming an official template',()=>{
 const choices=model.categoryChoices([]);const leaf=choices.find(choice=>choice.categoryId==='103495');
 const path=['스포츠/레져','기타스포츠','육상/체조','마라톤가방'];
 assert.deepEqual(plain(leaf.path),path);assert.equal(leaf.codeEvidence,'supplier-hub');assert.equal(leaf.templateLinked,false);
 for(let depth=0;depth<path.length;depth++)assert.ok(model.categoryLevel(choices,path.slice(0,depth),depth).includes(path[depth]));
 assert.equal(model.canConfirmCategory(leaf),true);assert.equal(model.categoryProfileForChoice(leaf).template,null);
 assert.equal(model.searchCategoryChoices(choices,'103495')[0].categoryId,'103495');
});

test('invalid legacy saved codes stay visible for repair but cannot confirm category selection', () => {
  for (const categoryId of ['카테고리', 'a'.repeat(101), '80719/81452']) {
    const choices = model.categoryChoices([profile('legacy', categoryId, knownPath)]);
    const saved = choices.find(choice => choice.profileId === 'legacy');
    assert.ok(saved); assert.equal(model.canConfirmCategory(saved), false);
    assert.throws(() => model.categoryProfileForChoice(saved));
    assert.equal(model.categoryAdvancedSeed(saved).profileId, 'legacy');
  }
});
