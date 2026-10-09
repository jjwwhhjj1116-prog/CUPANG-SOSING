import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';

const modules=new Map();
function load(file) {
  if(modules.has(file))return modules.get(file);
  const exports = {};
  modules.set(file,exports);
  const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, URL, Error, TextEncoder, Uint8Array, crypto: webcrypto,
    require(name) { return load(`${name.slice(2)}.ts`); },
  });
  return exports;
}
const { quotationLabelUploadId: identity, findQuotationLabelUpload: find } = load('app/quotation-label-upload.ts');
const cell = value => ({ value, source: 'manual-option' });
function fixture() {
  return { productId: 'product', endpoint: '/api/products/product/quotation-fields?profileId=profile', optionId: 'red',
    view: { revision: 2, inputFingerprint: '1'.repeat(64), contentRevision: 3,optionRevision:1,productVersion:'2026-10-06T00:00:00.000Z',
      categoryContext: { categoryId: '80719',categoryPath:['주방','수납'], profileId: 'profile' }, resolved: {
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
    input => { input.view.revision++; input.view.inputFingerprint = '2'.repeat(64); input.view.contentRevision++; },
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
  const metadata=await load('app/quotation-label-proof.ts').verifiedQuotationLabelMetadata(load('app/quotation-label-proof.ts').quotationLabelProofRequest(input),input.view,expected);
  const proof=load('app/quotation-label-proof.ts').quotationLabelReceiptFromMetadata({...metadata,labelUploadId:expected,labelBlobSha256:'a'.repeat(64)});
  const saved={key:`owner/quotation-label-${expected}.png`,contentType:'image/png',size:123,sha256:'a'.repeat(64),quotationLabelProof:proof};
  assert.equal((await lookup(saved)).key,saved.key);
  for (const body of [null, {}, [], { key: '' }, { key: 123 }, { key: 'x'.repeat(513) }]) await assert.rejects(lookup(body), /응답/);
  for(const change of [value=>{delete value.quotationLabelProof;},value=>{value.quotationLabelProof.productId='other';},value=>{value.quotationLabelProof.optionId='blue';},value=>{value.quotationLabelProof.profileId='other';},value=>{value.quotationLabelProof.planSha256='b'.repeat(64);},value=>{value.quotationLabelProof.categorySha256='b'.repeat(64);}]){
    const forged=structuredClone(saved);change(forged);await assert.rejects(lookup(forged),/원천/);
  }
  for(const change of [value=>{value.key='owner/saved.png';},value=>{value.contentType='image/jpeg';},value=>{value.size=0;},value=>{value.sha256='before';}]){
    const forged=structuredClone(saved);change(forged);await assert.rejects(lookup(forged),/응답/);
  }
  const legacy={...saved};delete legacy.quotationLabelProof;
  assert.equal((await load('app/quotation-label-upload.ts').readQuotationLabelReceipt(expected,async()=>Response.json(legacy))).proof,null,'an unmarked durable receipt cannot be inferred to be a replaceable v2 label');
  for (const call of calls) {
    assert.equal(call.url, `/api/files?labelUploadId=${expected}`);
    assert.equal(call.options.cache, 'no-store'); assert.equal(call.options.method, undefined);
  }
  await assert.rejects(find(input, async () => Response.json({ error: '조회 실패' }, { status: 503 })), /조회 실패/);
  await assert.rejects(find(input, async () => new Response('invalid json')), /JSON/);
  await assert.rejects(find(input, async () => { throw Error('연결 유실'); }), /연결 유실/);
});
