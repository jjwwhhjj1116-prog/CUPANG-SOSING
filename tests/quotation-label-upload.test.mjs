import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';

function load(file) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, TextEncoder, Uint8Array, crypto: webcrypto,
    require(name) { return load(`${name.slice(2)}.ts`); },
  });
  return exports;
}
const { quotationLabelUploadId: identity, findQuotationLabelUpload: find } = load('app/quotation-label-upload.ts');
const cell = value => ({ value, source: 'manual-option' });
function fixture() {
  return { productId: 'product', endpoint: '/api/products/product/quotation-fields?profileId=profile', optionId: 'red',
    view: { revision: 2, inputFingerprint: 'initial', contentRevision: 3,
      categoryContext: { categoryId: '80719', profileId: 'profile' }, resolved: {
        schema: { categoryId: '80719', categoryPath: ['주방', '수납'], fields: [
          { id: 'title', label: '상품명', section: 'start' }, { id: 'model', label: '모델명', section: 'product' },
          { id: 'salePrice', label: '판매가', section: 'product' },
          { id: 'material', label: '재질', section: 'legal' },
        ] },
        customLabels: [{ id: 'visible', name: '안내', value: '보관 방법', visible: true },
          { id: 'hidden', name: '숨김', value: '초안', visible: false }],
        rows: ['red', 'blue'].map(id => ({ optionId: id, optionLabel: '동일한 이름', included: true,
          fields: { title: cell('제품'), model: cell('모델'), salePrice: cell('10000'), material: cell('') },
        })),
      },
    },
  };
}

test('durable label identity retains files after price, revision, hidden text or another option changes', async () => {
  const original = fixture(), id = await identity(original); assert.match(id, /^[a-f0-9]{64}$/);
  for (const change of [
    input => { input.view.revision++; input.view.inputFingerprint = 'after'; input.view.contentRevision++; },
    input => { input.view.resolved.rows[0].fields.salePrice.value = '20000'; },
    input => { input.view.resolved.customLabels[1].value = '새 숨김 값'; },
    input => { input.view.resolved.rows[1].fields.model.value = '다른 옵션 모델'; },
  ]) {
    const edited = structuredClone(original); change(edited); assert.equal(await identity(edited), id);
  }
});

test('different product, form, category, option or visible label contents cannot reuse the same upload', async () => {
  const original = fixture(), id = await identity(original);
  for (const change of [
    input => { input.productId = 'other'; }, input => { input.endpoint += '&form=other'; },
    input => { input.view.categoryContext.profileId = 'other'; },
    input => { input.view.categoryContext.categoryId = 'other'; input.view.resolved.schema.categoryId = 'other'; },
    input => { input.optionId = 'blue'; },
    input => { input.view.resolved.schema.categoryPath.push('다른 분류'); },
    input => { input.view.resolved.rows[0].fields.model.value = '새 모델'; },
    input => { input.view.resolved.rows[0].fields.material.value = '새 재질'; },
    input => { input.view.resolved.customLabels[0].value = ''; },
    input => { input.view.resolved.customLabels[0].visible = false; },
  ]) {
    const edited = structuredClone(original); change(edited); assert.notEqual(await identity(edited), id);
  }
});

test('label lookup explicitly distinguishes a missing file from an unavailable or malformed response', async () => {
  const input = fixture(), expected = await identity(input); const calls = [];
  const lookup = body => find(input, async (url, options) => { calls.push({ url, options }); return Response.json(body); });
  assert.equal((await lookup({ key: null })).key, null);
  assert.equal((await lookup({ key: 'owner/saved.png' })).key, 'owner/saved.png');
  for (const body of [null, {}, [], { key: '' }, { key: 123 }, { key: 'x'.repeat(513) }]) await assert.rejects(lookup(body), /응답/);
  for (const call of calls) {
    assert.equal(call.url, `/api/files?labelUploadId=${expected}`);
    assert.equal(call.options.cache, 'no-store'); assert.equal(call.options.method, undefined);
  }
  await assert.rejects(find(input, async () => Response.json({ error: '조회 실패' }, { status: 503 })), /조회 실패/);
  await assert.rejects(find(input, async () => new Response('invalid json')), /JSON/);
  await assert.rejects(find(input, async () => { throw Error('연결 유실'); }), /연결 유실/);
});
