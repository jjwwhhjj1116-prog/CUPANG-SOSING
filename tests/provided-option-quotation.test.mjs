import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { providedOptionFacts, providedOptionFixture, providedOptionModule, providedOptionOriginalPaths,
  readProvidedOptionOriginal, resolveProvidedOption, editProvidedOption, editProvidedContent, buildProvidedOptionWorkbook } from './helpers/provided-option-quotation.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const prices = row => [row.supplyPrice, row.salePrice, row.msrp];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function unknownsUnchanged(row) {
  assert.equal(row.supplierSku, '');
  for (const key of ['minimumOrderQuantity', 'stock', 'widthCm', 'lengthCm', 'heightCm', 'weightKg',
    'packagedWeightG', 'packagedWidthMm', 'packagedLengthMm', 'packagedHeightMm', 'imageKey']) assert.equal(row[key], null, key);
  assert.equal(row.color, ''); assert.equal(row.size, '');
  assert.equal(row.provenance.supplierSku, 'unverified');
  assert.equal(row.provenance.minimumOrderQuantity, 'unverified');
}

test('human-provided one option reaches a manual 81452 review with literal source text and no invented seller facts', () => {
  const f = providedOptionFixture(), result = resolveProvidedOption(f);
  assert.equal(f.content.seo.title.value, providedOptionFacts.title);
  assert.equal(f.content.seo.title.provenance, 'manual');
  assert.equal(f.options.rows.length, 1);
  assert.equal(f.options.rows[0].originalName, '黑色单层');
  assert.equal(f.options.rows[0].provenance.originalName, 'manual');
  assert.equal(f.options.rows[0].unitCostCny, 2.99);
  assert.equal(f.options.rows[0].provenance.unitCostCny, 'manual');
  unknownsUnchanged(f.options.rows[0]);
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].skuId, '');
  assert.equal(result.rows[0].sourcePriceCny, 2.99);
  assert.equal(result.rows[0].title, providedOptionFacts.title);
  assert.deepEqual(prices(result.rows[0]), [4050, 6750, 8780]);
  for (const key of ['model', 'packagedWeightG', 'packagedDimensionsMm', 'mainImage', 'additionalImages', 'detailImages', 'labelImages']) assert.equal(result.rows[0][key], '', key);
  assert.equal(result.rows[0].size, '해당사항없음');
  assert.equal(result.resolved.rows[0].fields.size.source, 'couplus-default', 'a recorded form default is separate from an observed supplier size');
  assert.equal(result.review.includedOptions, 1); assert.ok(result.review.errorCount > 0);
  assert.equal(result.review.submissionReady, false); assert.equal(result.transmitted, false); assert.equal(result.sourceCollected, false);
  assert.equal(f.product.image_keys, '[]'); assert.equal(f.product.registration_status, '미전송');
});

test('the saved integrated 290 policy calculates only the provided unit cost without replacing any unknown measurement', () => {
  const f = providedOptionFixture({ pricePolicyOverride: { useIntegratedRate: true, integratedRate: 290 } });
  const before = JSON.stringify(f), result = resolveProvidedOption(f);
  assert.deepEqual(prices(result.rows[0]), [4280, 7130, 9270]);
  assert.equal(f.calculation.costKrw, 1284); assert.equal(result.rows[0].sourcePriceCny, 2.99);
  unknownsUnchanged(f.options.rows[0]); assert.equal(JSON.stringify(f), before);
});

test('an explicit unit-cost edit recalculates the one quotation row and preserves the original manual model', () => {
  const f = providedOptionFixture(), before = JSON.stringify(f);
  const edited = editProvidedOption(f, { unitCostCny: 3.99 }), result = resolveProvidedOption(edited);
  assert.equal(JSON.stringify(f), before); assert.equal(f.options.rows[0].unitCostCny, 2.99);
  assert.equal(edited.options.rows[0].unitCostCny, 3.99); assert.equal(edited.options.rows[0].provenance.unitCostCny, 'manual');
  assert.equal(result.rows[0].sourcePriceCny, 3.99);
  assert.deepEqual(prices(result.rows[0]), [4400, 7330, 9530]);
  unknownsUnchanged(edited.options.rows[0]);
  assert.equal(edited.options.revision, f.options.revision + 1);
  assert.equal(result.transmitted, false);
});

test('excluded single option produces no substitute common row or export and literal quotation blanks survive review', async () => {
  const f = providedOptionFixture({ reviewedNames: true }), sourceBefore = JSON.stringify(f);
  const translated = resolveProvidedOption(f);
  assert.equal(translated.rows[0].title, '실리콘 슬개골 스트랩 무릎 보호대, 검정 단층');
  assert.match(f.reviewedNameEvidence, /서비스 번역 실행 결과가 아닙니다/);
  const blank = editProvidedContent(f, { seo: { title: '' }, label: { model: '' }, labelClears: ['model'] });
  const blankResult = resolveProvidedOption(blank, { overrides: { common: { title: '', supplyPrice: '', salePrice: '', msrp: '', size: '' }, options: {} } });
  for (const key of ['title', 'supplyPrice', 'salePrice', 'msrp', 'model', 'size']) assert.equal(blankResult.rows[0][key], '', key);
  assert.equal(blankResult.resolved.rows[0].fields.title.source, 'manual-common'); assert.ok(blankResult.review.errorCount > 0);
  const excluded = resolveProvidedOption(editProvidedOption(f, { included: false }));
  assert.equal(excluded.rows.length, 0); assert.equal(excluded.review.includedOptions, 0);
  assert.ok(excluded.review.issues.some(issue => issue.code === 'NO_INCLUDED_OPTIONS'));
  assert.equal(excluded.resolved.rows.filter(row => row.optionId === null && row.included).length, 0);
  assert.equal(JSON.stringify(f), sourceBefore);
});

const originalAvailable = Object.values(providedOptionOriginalPaths).every(file => fs.existsSync(file));
test('the captured 81452 original writes exactly one user-provided option, preserves blanks and reports an incomplete untransmitted draft', { skip: !originalAvailable }, async () => {
  const original = readProvidedOptionOriginal(), profileBefore = original.profileBytes.slice(), workbookBefore = original.workbookBytes.slice();
  const fixture = providedOptionFixture({ reviewedNames: true, pricePolicyOverride: { useIntegratedRate: true, integratedRate: 290 } });
  const result = await buildProvidedOptionWorkbook({ fixture, original }), reader = providedOptionModule('app/xlsx-template.ts');
  assert.equal(result.report.rowCount, 1); assert.equal(result.rows.length, 1);
  assert.equal(result.report.dataStartRow, 9); assert.equal(result.incomplete, true); assert.equal(result.transmitted, false); assert.equal(result.sourceCollected, false);
  assert.ok(result.report.missingRequired.length > 0 || result.report.validationIssueCount > 0);
  const writtenArchive = await reader.readXlsxArchive(result.bytes.slice().buffer);
  const originalArchive = await reader.readXlsxArchive(Uint8Array.from(original.workbookBytes).buffer);
  const inspection = reader.inspectXlsxArchive(writtenArchive), originalInspection = reader.inspectXlsxArchive(originalArchive);
  const worksheetPath = reader.xlsxWorksheetPath(originalArchive, original.profile.template.sheetName);
  assert.deepEqual([...writtenArchive.keys()].sort(), [...originalArchive.keys()].sort());
  for (const [entry, bytes] of originalArchive) if (entry !== worksheetPath) assert.deepEqual(writtenArchive.get(entry), bytes, 'unchanged original part ' + entry);
  for (const row of [1, 4, 5, 6, 7, 8, 10]) assert.deepEqual(plain(reader.xlsxHeaders(inspection, original.profile.template.sheetName, row)),
    plain(reader.xlsxHeaders(originalInspection, original.profile.template.sheetName, row)), 'only the one reviewed product row is populated; row ' + row);
  const cells = reader.xlsxHeaders(inspection, original.profile.template.sheetName, 9);
  for (const mapping of original.profile.mappings) {
    if (mapping.field === 'constant') continue;
    const expected = result.values[0][mapping.column];
    assert.equal(cells[mapping.column] ?? '', String(expected ?? ''), 'written field ' + mapping.field);
  }
  for (const [key, wire, expected] of [['supplyPrice', 'purchasePrice', '4280'], ['salePrice', 'coupangSalePrice', '7130'], ['msrp', 'msrp', '9270']]) {
    const fields = result.resolved.schema.fields.filter(field => !field.hubWire?.name
      && JSON.stringify(field.hubWire?.path) === JSON.stringify(['productPage', 'commonAttributes', wire]));
    assert.equal(fields.length, 1, key); const field = fields[0];
    assert.equal(result.resolved.rows[0].fields[field.id].value, expected);
    const mapping = original.profile.mappings.find(item => item.field === field.id); assert.ok(mapping, key);
    assert.equal(cells[mapping.column], expected);
  }
  unknownsUnchanged(result.fixture.options.rows[0]);
  assert.equal(result.rows[0].skuId, '');
  assert.deepEqual(fs.readFileSync(original.paths.profile), profileBefore);
  assert.deepEqual(fs.readFileSync(original.paths.workbook), workbookBefore);
  assert.equal(result.originalSha256, sha256(workbookBefore));
  assert.deepEqual(plain(result.fixture.suppliedFacts), { ...providedOptionFacts });
});

test('captured workbook SHA is checked before mapping and a discarded option cannot create original-template output', { skip: !originalAvailable }, async () => {
  const original = readProvidedOptionOriginal();
  const mismatch = { ...original, profile: structuredClone(original.profile) };
  mismatch.profile.template.sha256 = '0'.repeat(64);
  await assert.rejects(buildProvidedOptionWorkbook({ original: mismatch }), /SHA-256 differs before mapping/);
  await assert.rejects(buildProvidedOptionWorkbook({ original, fixture: providedOptionFixture({ included: false }) }), /No included option/);
});
