import test from 'node:test';
import assert from 'node:assert/strict';
import { assetProjectionFixture, module, companies, keys, imageBytes, sha, plain, labelName } from './helpers/supplier-hub-single-assets.mjs';
const assets = module('app/supplier-hub-single-assets.ts');
for (const company of companies) test(`prepared ordered image JSON replaces only exact image wires (${company.code})`, async () => {
  const f = assetProjectionFixture(company), input = await f.planInput(), original = JSON.stringify(input.projection);
  const plan = await assets.buildSingleAssetPlan(input); assert.equal(plan.canPrepare, true, JSON.stringify(plan.issues));
  assert.deepEqual(plain(plan.manifest.map(item => [item.role, item.keys])), [
    ['main', [keys[0]]], ['additional', keys.slice(1, 3)], ['label', [keys[6]]], ['detail', keys.slice(3, 6)],
  ]);
  assert.equal(plan.files.length, 7); const document = plan.payload.jsonDocument[0], image = document.imagePage;
  const url = key => plan.files.find(file => file.key === key).url;
  assert.equal(image.images.mainImage, url(keys[0])); assert.equal(image.images.additionalImage, keys.slice(1, 3).map(url).join(','));
  assert.equal(image.details.detailedImage, keys.slice(3, 6).map(url).join(',')); assert.equal(image.details.htmlProductDetailContent, '');
  assert.deepEqual(plain(image.images.labelImages), [{ labelImageType: labelName, labelImageFiles: url(keys[6]) }]);
  assert.equal(document.productPage.modelNumber, ''); assert.equal(document.productPage.commonAttributes.purchasePrice, '11960');
  assert.equal(document.productPage.commonAttributes.count, 0); assert.equal(document.productPage.commonAttributes.booleanValue, false);
  assert.equal(image.msrpAgree, false); assert.equal(image.labelContactAgreed, false); assert.equal(JSON.stringify(input.projection), original);
  const preview = assets.singleAssetPackageView(plan, false); assert.equal(preview.prepared, false); assert.equal(preview.payload.imagePage, undefined);
  assert.equal(preview.payload.jsonDocument[0].imagePage.images.mainImage, undefined); assert.equal(preview.manifest[0].files[0].published, false);
  assert.equal(preview.manifest[0].files[0].verification, 'source-bytes-only'); assert.ok(!JSON.stringify(preview.payload).includes('owner/'));
  const prepared = assets.singleAssetPackageView(plan, true); assert.equal(prepared.prepared, true); assert.equal(prepared.registered, false);
  assert.equal(prepared.remoteWrites, false); assert.equal(prepared.submissionReady, false); assert.equal(prepared.humanAgreementsConfirmed, false);
  assert.equal(prepared.review.externalAvailabilityVerified, false); assert.ok(plan.issues.some(issue => issue.code === 'SINGLE_IMAGE_GUIDANCE' && issue.level === 'review'));
});
test('included row identity preserves per-option selections and excludes foreign working option refs', async () => {
  const f = assetProjectionFixture(), second = structuredClone(f.row), excluded = structuredClone(f.row);
  second.optionId = 'synthetic-two'; second.fields.mainImage.value = keys[1]; excluded.optionId = 'synthetic-excluded'; excluded.included = false; excluded.fields.mainImage.value = 'foreign/unknown.png';
  f.resolved.rows.push(second, excluded); const plan = await assets.buildSingleAssetPlan(await f.planInput()); assert.equal(plan.canPrepare, true);
  assert.equal(plan.payload.jsonDocument.length, 2); const images = plan.payload.jsonDocument.map(doc => doc.imagePage.images.mainImage);
  assert.equal(images[0], plan.files.find(file => file.key === keys[0]).url); assert.equal(images[1], plan.files.find(file => file.key === keys[1]).url);
  assert.ok(!plan.manifest.some(item => item.optionId === excluded.optionId)); assert.ok(!plan.files.some(file => file.key.startsWith('foreign/')));
});
test('manual image blanks stay exact blank, without restoring content images', async () => {
  const f = assetProjectionFixture(); f.set(['imagePage', 'images', 'mainImage'], undefined, '', 'manual-option');
  f.set(['imagePage', 'images', 'labelImages'], labelName, '', 'manual-option');
  const plan = await assets.buildSingleAssetPlan(await f.planInput()); assert.equal(plan.canPrepare, true);
  assert.equal(plan.payload.jsonDocument[0].imagePage.images.mainImage, ''); assert.equal(plan.payload.jsonDocument[0].imagePage.images.labelImages[0].labelImageFiles, '');
  assert.ok(!plan.files.some(file => [keys[0], keys[6]].includes(file.key)));
});
test('single main/label encoding never guesses a delimiter for multiple selected files', async () => {
  for (const [path, name] of [[['imagePage', 'images', 'mainImage'], undefined], [['imagePage', 'images', 'labelImages'], labelName]]) {
    const f = assetProjectionFixture(); f.set(path, name, keys.slice(0, 2).join('\n'));
    const plan = await assets.buildSingleAssetPlan(await f.planInput()); assert.equal(plan.canPrepare, false); assert.ok(plan.issues.some(issue => issue.code === 'SINGLE_IMAGE_COUNT'));
  }
});
test('unknown or forged image wires, duplicate refs and unowned keys fail closed', async () => {
  for (const mutation of [ref => { ref.wire = undefined; }, ref => { ref.wire.name = ''; }, ref => { ref.keys = [keys[0], keys[0]]; }, ref => { ref.keys = ['other/foreign.png']; }]) {
    const f = assetProjectionFixture(), input = await f.planInput(); mutation(input.projection.review.unresolvedImages[0]);
    const plan = await assets.buildSingleAssetPlan(input); assert.equal(plan.canPrepare, false);
    assert.ok(plan.issues.some(issue => ['SINGLE_IMAGE_ENCODING_UNVERIFIED', 'SINGLE_IMAGE_REFERENCE'].includes(issue.code)));
  }
});
test('missing public config, absent bytes, MIME/SHA metadata or unsupported GIF precisely block preparation', async () => {
  for (const kind of ['config', 'missing', 'mime', 'sha', 'gif']) {
    const f = assetProjectionFixture(), input = await f.planInput();
    if (kind === 'config') input.config = null;
    if (kind === 'missing') input.assets = input.assets.filter(asset => asset.key !== keys[0]);
    if (kind === 'mime') input.metadata.get(keys[0]).httpMetadata.contentType = 'image/jpeg';
    if (kind === 'sha') input.metadata.get(keys[0]).customMetadata.sha256 = '0'.repeat(64);
    if (kind === 'gif') { const data = new Uint8Array(Buffer.from('GIF89a\x01\x00\x01\x00', 'binary')); input.assets[0] = { ...input.assets[0], data, sha256: sha(data) };
      input.metadata.set(keys[0], { size: data.length, httpMetadata: { contentType: 'image/gif' } }); }
    const plan = await assets.buildSingleAssetPlan(input); assert.equal(plan.canPrepare, false, kind); assert.ok(plan.issues.some(issue => issue.level === 'error'));
  }
});
test('generated-label source proof errors remain blocking after owned byte resolution', async () => {
  const f = assetProjectionFixture(), input = await f.planInput(); input.sourceIssues = [{ kind: 'error', code: 'GENERATED_LABEL_SOURCE_CHANGED', optionId: null, optionLabel: '공통', fieldId: 'labelImages', message: '생성 당시 원문이 바뀌었습니다.' }];
  const plan = await assets.buildSingleAssetPlan(input); assert.equal(plan.canPrepare, false); assert.ok(plan.issues.some(issue => issue.code === 'GENERATED_LABEL_SOURCE_CHANGED'));
});
test('document row duplication or a missing row identity refuses image assignment', async () => {
  const f = assetProjectionFixture(), input = await f.planInput(); input.projection.review.fields.push({ ...input.projection.review.fields.find(field => field.path.join('.') === 'startPage.productName') });
  await assert.rejects(assets.buildSingleAssetPlan(input), error => error.code === 'SINGLE_IMAGE_ROW');
});
test('asset naming follows actual type/bytes, not old edited filename', async () => {
  const f = assetProjectionFixture(), input = await f.planInput(), data = imageBytes(231); input.assets[0] = { ...input.assets[0], data, sha256: 'forged' };
  input.metadata.set(keys[0], { size: data.byteLength, httpMetadata: { contentType: 'image/png' } });
  const plan = await assets.buildSingleAssetPlan(input); assert.equal(plan.canPrepare, true); const file = plan.files[0];
  assert.equal(file.sha256, sha(data)); assert.equal(file.filename, `single-${sha(data)}.png`); assert.equal(file.contentType, 'image/png');
});
test('only equal exact canonical price summaries are represented by primary string wires', async () => {
  const f = assetProjectionFixture();
  for (const [id, value] of [['supplyPrice', '11960'], ['salePrice', '19930'], ['msrp', '25910']]) f.row.fields[id] = { value, source: 'manual-common', needsReview: true, issues: [], validationIssues: [] };
  const input = await f.planInput(); assert.equal(input.projection.review.issues.filter(issue => issue.code === 'UNBOUND_SAVED_FIELD' && ['supplyPrice', 'salePrice', 'msrp'].includes(issue.fieldId)).length, 3);
  const before = JSON.stringify(input.projection), plan = await assets.buildSingleAssetPlan(input); assert.equal(plan.canPrepare, true);
  assert.ok(!plan.issues.some(issue => issue.code === 'UNBOUND_SAVED_FIELD' && ['supplyPrice', 'salePrice', 'msrp'].includes(issue.fieldId)));
  assert.equal(plan.payload.jsonDocument[0].productPage.commonAttributes.msrp, '25910'); assert.equal(JSON.stringify(input.projection), before);
});
test('conflicting summary, deliberate blank, duplicate primary or absent exact price wire remains blocked', async () => {
  for (const kind of ['different', 'blank', 'duplicate', 'wrong-path']) {
    const f = assetProjectionFixture(); f.row.fields.msrp = { value: kind === 'blank' ? '' : kind === 'different' ? '25911' : '25910', source: 'manual-common', needsReview: true, issues: [], validationIssues: [] };
    const input = await f.planInput(), primary = input.projection.review.fields.find(field => field.path.join('.') === 'productPage.commonAttributes.msrp');
    if (kind === 'duplicate') input.projection.review.fields.push({ ...primary });
    if (kind === 'wrong-path') primary.path = ['productPage', 'different', 'msrp'];
    const before = JSON.stringify(input.projection), plan = await assets.buildSingleAssetPlan(input); assert.equal(plan.canPrepare, false, kind);
    assert.ok(plan.issues.some(issue => issue.code === 'SINGLE_PRICE_SUMMARY_CONFLICT')); assert.equal(JSON.stringify(input.projection), before);
    assert.equal(plan.payload.jsonDocument[0].productPage.commonAttributes.msrp, '25910');
  }
});
