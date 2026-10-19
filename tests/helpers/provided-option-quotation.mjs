import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createHash, webcrypto } from 'node:crypto';
import * as parse5 from 'parse5';
import ts from 'typescript';
import * as rejectionDetails from '../../extensions/supplier-hub/rejection-details.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = new Map();
export const providedOptionFacts = Object.freeze({
  sourceUrl: 'https://detail.1688.com/offer/1012144591864.html',
  title: '单层硅胶髌骨带专业可调节透气防滑保护运动防损伤护膝登山',
  optionName: '黑色单层', unitCostCny: 2.99,
});
export const providedOptionReviewedNames = Object.freeze({
  title: '실리콘 슬개골 스트랩 무릎 보호대', optionName: '검정 단층',
  evidence: '시험 작성자가 검토한 한국어 이름이며 서비스 번역 실행 결과가 아닙니다.',
});
export const providedOptionCategoryPath = Object.freeze(['스포츠/레져', '헬스/요가', '헬스기구/용품', '헬스보호대']);
export const providedOptionOriginalPaths = Object.freeze({
  profile: path.join(root, 'outputs/step650-official-81452-profile-after.json'),
  workbook: path.join(root, 'outputs/step650-official-81452-original.xlsx'),
});

/** Only pure application modules are available. No seller fixture, DB, URL
 * fetch, AI or extension collector is loaded to turn missing facts into facts. */
export function providedOptionModule(file) {
  if (cache.has(file)) return cache.get(file);
  if (!file.startsWith('app/')) throw Error('Only pure app modules are available.');
  const resolved = path.resolve(root, file);
  if (!resolved.startsWith(path.join(root, 'app') + path.sep)) throw Error('Invalid app module path.');
  const exports = {};
  cache.set(file, exports);
  const output = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  try {
    vm.runInNewContext(output, {
      exports, Error, RangeError, URL, URLSearchParams, Date, Response, Request, Headers, Blob,
      TextEncoder, TextDecoder, Uint8Array, DataView, CompressionStream, DecompressionStream,
      structuredClone, crypto: webcrypto, AbortController, setTimeout, clearTimeout,
      fetch() { throw Error('External requests are forbidden for user-provided facts.'); },
      require(name) {
        if(name==='../extensions/supplier-hub/rejection-details.mjs')return rejectionDetails;
        if (name === 'parse5') return parse5;
        if (name.startsWith('@/app/')) return providedOptionModule(name.slice(2) + '.ts');
        if (name.startsWith('./') || name.startsWith('../')) return providedOptionModule(path.posix.join(path.posix.dirname(file), name) + '.ts');
        throw Error('Unsupported dependency: ' + name);
      },
    }, { filename: file });
  } catch (error) { cache.delete(file); throw error; }
  return exports;
}
const clone = value => JSON.parse(JSON.stringify(value));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** A local manual review model, never an immutable supplier collection receipt.
 * Selling pack 1 is an explicit test configuration, not supplier MOQ or stock. */
export function providedOptionFixture({ unitCostCny = providedOptionFacts.unitCostCny, included = true,
  reviewedNames = false, pricePolicyOverride = {}, title, translatedName } = {}) {
  const timestamp = '2026-10-14T01:00:00.000Z', productId = 'local-provided-option-651';
  const contentModel = providedOptionModule('app/product-content.ts');
  const optionModel = providedOptionModule('app/product-options.ts');
  const pricing = providedOptionModule('app/pricing.ts');
  const settings = {
    ...providedOptionModule('app/workspace-settings.ts').defaultSettings,
    ...providedOptionModule('app/observed-price-preset.ts').observedCouplusPricePreset,
    ...pricePolicyOverride, brand: '', manufacturer: '', importer: '', serviceContact: '',
  };
  const policy = pricing.pricePolicy({ ...settings, minimumMargin: settings.minimumMarginEnabled ? settings.minimumMargin : 0 });
  const calculation = pricing.calculatePrice(unitCostCny, policy, 1);
  const baseTitle = title ?? (reviewedNames ? providedOptionReviewedNames.title : providedOptionFacts.title);
  const name = translatedName ?? (reviewedNames ? providedOptionReviewedNames.optionName : '');
  const content = contentModel.applyContentPatch(contentModel.emptyProductContent(productId), {
    seo: { title: baseTitle, description: '', keywords: [] }, label: { productName: baseTitle },
  }, timestamp);
  const row = { ...optionModel.emptyOptionInput('manual-option-1'), originalName: providedOptionFacts.optionName,
    translatedName: name, unitCostCny, unitsPerPack: 1, included };
  const options = optionModel.applyOptionRows(optionModel.emptyProductOptions(productId), [row], timestamp);
  const product = { id: productId, owner_id: 'local-synthetic-owner', source_url: providedOptionFacts.sourceUrl,
    title: baseTitle, source_price_cny: unitCostCny, exchange_rate: policy.exchangeRate,
    supply_margin: policy.supplyMargin, coupang_margin: policy.coupangMargin,
    supply_price: calculation.supplyPrice, sale_price: calculation.salePrice, msrp: calculation.msrp,
    options_count: 1, seo_status: '대기', image_status: '대기', quote_status: '대기', registration_status: '미전송',
    supplier_hub_status: '미전송', image_keys: '[]', goal_stage: 'collect',
    created_at: timestamp, updated_at: timestamp, pricing_policy: JSON.stringify(policy) };
  return { categoryId: '81452', categoryPath: [...providedOptionCategoryPath], product, content, options, settings, policy,
    calculation, suppliedFacts: { ...providedOptionFacts }, localOnly: true, sourceCollected: false, transmitted: false,
    reviewedNameEvidence: reviewedNames ? providedOptionReviewedNames.evidence : null };
}

/** Models an explicit option editor save while retaining unknown supplier facts. */
export function editProvidedOption(fixture, changes, timestamp = '2026-10-14T01:00:00.001Z') {
  const next = clone(fixture), model = providedOptionModule('app/product-options.ts');
  const rows = model.optionInputs(next.options).map(row => ({ ...row, ...changes }));
  const validated = model.validateOptionsInput({ expectedRevision: next.options.revision,
    expectedProductVersion: next.product.updated_at, rows }, next.product.owner_id, []);
  next.options = model.applyOptionRows(next.options, validated.rows, timestamp);
  next.product.updated_at = timestamp;
  next.product.options_count = next.options.rows.filter(row => row.included).length;
  return next;
}

/** Preserve literal manual blanks rather than invoking defaults or label autofill. */
export function editProvidedContent(fixture, patch, timestamp = '2026-10-14T01:00:00.002Z') {
  const next = clone(fixture);
  next.content = providedOptionModule('app/product-content.ts').applyContentPatch(next.content, patch, timestamp);
  next.product.updated_at = timestamp;
  return next;
}

export function resolveProvidedOption(fixture = providedOptionFixture(), { profile = null, overrides } = {}) {
  const before = JSON.stringify(fixture);
  const source = { ...fixture, ...(profile ? { profile, hubSchema: profile.hubSchema, template: profile.template } : {}) };
  const resolved = providedOptionModule('app/quotation-schema.ts').resolveQuotationFields({ ...source,
    ...(overrides ? { overrides } : {}) });
  const review = providedOptionModule('app/submission-review.ts').inspectSubmission(resolved, []);
  const rows = resolved.rows.some(row => row.included)
    ? providedOptionModule('app/exports/quotation-fields.ts').resolvedQuotationRows(source, resolved, []) : [];
  if (JSON.stringify(fixture) !== before) throw Error('Manual source model changed during resolution.');
  return { fixture, source, resolved, rows, review, transmitted: false, sourceCollected: false };
}

/** Files are private captured artifacts. An absent artifact skips only the
 * original workbook case; an existing malformed or mismatched artifact fails. */
export function readProvidedOptionOriginal(paths = providedOptionOriginalPaths) {
  if (!fs.existsSync(paths.profile) || !fs.existsSync(paths.workbook)) return null;
  const profileBytes = fs.readFileSync(paths.profile), workbookBytes = fs.readFileSync(paths.workbook);
  const profile = JSON.parse(profileBytes.toString('utf8'));
  if (profile.categoryId !== '81452' || JSON.stringify(profile.categoryPath) !== JSON.stringify(providedOptionCategoryPath)
    || profile.hubSchema?.company?.code !== 'A01526306' || profile.hubSchema?.company?.name !== '유앤채') throw Error('Captured original category/company differs.');
  if (sha256(workbookBytes) !== profile.template?.sha256) throw Error('Captured original workbook SHA-256 differs.');
  return { profile, workbookBytes, profileBytes, paths, sha256: profile.template.sha256,
    profileSha256: sha256(profileBytes) };
}

/** Returns reviewable bytes without storing a product, publishing or transmitting.
 * The writer rechecks exact SHA, category dropdown, original headers and rules. */
export async function buildProvidedOptionWorkbook({ fixture = providedOptionFixture(), original = readProvidedOptionOriginal(), overrides } = {}) {
  if (!original) return null;
  if (sha256(original.workbookBytes) !== original.profile.template?.sha256) throw Error('Captured original workbook SHA-256 differs before mapping.');
  const before = JSON.stringify(original.profile), result = resolveProvidedOption(fixture, { profile: original.profile, overrides });
  if (!result.rows.length) throw Error('No included option; no workbook output is generated.');
  // Copy only exact bytes, independent of a Buffer's pooled backing allocation.
  const exactBytes = Uint8Array.from(original.workbookBytes).buffer;
  const generated = await providedOptionModule('app/exports/mapped-quotation.ts').createMappedQuotation({
    originalBytes: exactBytes, profile: original.profile, rows: result.rows,
    dataStartRow: providedOptionModule('app/category-profiles.ts').quotationStartRow(original.profile.template),
  });
  if (JSON.stringify(original.profile) !== before || sha256(original.workbookBytes) !== original.sha256) throw Error('Original workbook/profile changed.');
  return { ...result, ...generated, originalSha256: original.sha256, originalProfileSha256: original.profileSha256,
    incomplete: result.review.errorCount > 0 || generated.report.missingRequired.length > 0 || generated.report.validationIssueCount > 0,
    transmitted: false, sourceCollected: false };
}
