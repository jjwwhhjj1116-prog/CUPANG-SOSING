import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const observation = JSON.parse(fs.readFileSync(new URL('../docs/couplus-category-dom-2026-09-22.json', import.meta.url), 'utf8'));
const hubObservation = JSON.parse(fs.readFileSync(new URL('../docs/supplier-hub-category-ids-2026-09-22.json', import.meta.url), 'utf8'));
const source = ts.transpileModule(fs.readFileSync(new URL('../app/category-catalog.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
function load(hub = hubObservation) {
  const model = {};
  vm.runInNewContext(source, { exports: model, require(name) {
    if (name === '../docs/couplus-category-dom-2026-09-22.json') return observation;
    if (name === '../docs/supplier-hub-category-ids-2026-09-22.json') return hub;
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
  assert.equal(choices.filter(choice => choice.isLeaf).length, 22);
  assert.equal(choices.filter(model.canConfirmCategory).length, model.categoryObservationScope.knownCodes);
  const verified = choices.filter(choice => choice.codeEvidence === 'supplier-hub');
  assert.equal(verified.length, model.categoryObservationScope.supplierHubCodes);
  assert.ok(verified.length >= 5);
  for (const choice of verified) assert.ok(hubObservation.categoryIds.some(record => record.categoryId === choice.categoryId && JSON.stringify(record.path) === JSON.stringify(choice.path)));
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
  assert.equal(bounded.categoryObservationScope.supplierHubCodes, 1);
  assert.equal(bounded.categoryObservationScope.knownCodes, 2);
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
