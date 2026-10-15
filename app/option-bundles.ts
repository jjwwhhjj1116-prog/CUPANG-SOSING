import { applyOptionRows, calculateOptionPrices, optionInputs, OPTION_LIMIT, type BundleSource, type OptionInput, type ProductOptions, type ProductOptionsResponse } from '@/app/product-options';
import type { PricePolicy } from '@/app/pricing';
import { applyQuotationChanges, validateQuotationChanges, type QuotationChange, type QuotationField, type QuotationFieldsView } from '@/app/quotation-schema';
import { quotationPriceTargets } from '@/app/quotation-price-targets';
import { validOptionRegistrationNumbers } from '@/app/product-registration';
import { isQuotationPackagingField, validateQuotationPackagingBasis, type QuotationPackagingBasis } from '@/app/quotation-packaging-basis';

export type BundleAddition = { sourceOptionId: string; optionId: string };
export type BundleAddReceipt = { options: ProductOptionsResponse; quotation: QuotationFieldsView };
const identifier = /^[A-Za-z0-9_-]{1,80}$/;
const bundleId = (value: string) => identifier.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)])) : value;

/** Append-only creation lineage, independent of later selling-pack edits. */
export function validatedBundleSources(options: ProductOptions): Record<string, BundleSource> {
  const input = options.bundleSources;
  if (input === undefined) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 999) throw Error('번들 원본 연결을 확인하지 못했습니다.');
  const pairs = new Set<string>();
  for (const [child, source] of Object.entries(input)) {
    if (!bundleId(child) || !source || typeof source !== 'object' || Array.isArray(source)
      || Object.keys(source).sort().join(',') !== 'quantity,sourceOptionId' || !bundleId(source.sourceOptionId) || child === source.sourceOptionId
      || !Number.isInteger(source.quantity) || source.quantity < 2 || source.quantity > 1e6) throw Error('번들 원본 연결을 확인하지 못했습니다.');
    const pair = `${source.sourceOptionId}:${source.quantity}`;
    if (pairs.has(pair)) throw Error('같은 원본과 수량의 번들이 이미 있습니다.');
    pairs.add(pair);
    const visited = new Set([child]); let cursor = source.sourceOptionId;
    while (Object.hasOwn(input, cursor)) {
      if (visited.has(cursor) || visited.size >= 32) throw Error('번들 원본 연결이 순환하거나 너무 깊습니다.');
      visited.add(cursor); cursor = input[cursor].sourceOptionId;
    }
  }
  return structuredClone(input);
}

export function createBundleAddDraft(options: ProductOptions, additions: readonly BundleAddition[], quantity: number): { rows: OptionInput[]; bundleSources: Record<string, BundleSource> } {
  if (!Number.isInteger(quantity) || quantity < 2 || quantity > 1e6) throw Error('추가할 번들 수량은 2~1,000,000 사이 정수입니다.');
  if (!Array.isArray(additions) || !additions.length || additions.length > OPTION_LIMIT || options.rows.length + additions.length > OPTION_LIMIT) throw Error(`옵션은 최대 ${OPTION_LIMIT}개입니다. 선택할 옵션을 확인해주세요.`);
  const bundleSources = validatedBundleSources(options), sources = new Set<string>(), children = new Set<string>(), rows = optionInputs(options);
  const copies = additions.map(addition => {
    if (!addition || typeof addition !== 'object' || Array.isArray(addition) || Object.keys(addition).sort().join(',') !== 'optionId,sourceOptionId'
      || !bundleId(addition.sourceOptionId) || !bundleId(addition.optionId) || sources.has(addition.sourceOptionId)
      || children.has(addition.optionId) || options.rows.some(row => row.id === addition.optionId) || Object.hasOwn(bundleSources, addition.optionId)) throw Error('번들 원본과 새 옵션 식별자를 다시 확인해주세요.');
    const source = rows.find(row => row.id === addition.sourceOptionId);
    if (!source) throw Error('현재 상품에 저장된 원본 옵션으로 번들을 추가해주세요.');
    if (Object.values(bundleSources).some(value => value.sourceOptionId === source.id && value.quantity === quantity)) throw Error('같은 원본과 수량의 번들이 이미 있습니다. 삭제했던 번들도 새 번호로 중복 추가하지 않습니다.');
    sources.add(source.id); children.add(addition.optionId);
    bundleSources[addition.optionId] = { sourceOptionId: source.id, quantity };
    const name = source.translatedName || source.originalName || [source.color, source.size].filter(Boolean).join(' / ') || '기본 옵션';
    const translatedName = `${name.replace(/\s*\(\d+개묶음\)$/, '')} (${quantity}개묶음)`;
    if (translatedName.length > 500) throw Error('번들 표시를 포함한 옵션 한글명은 500자 이하여야 합니다.');
    return { ...source, id: addition.optionId, translatedName, unitsPerPack: quantity, supplierSku: '',
      stock: source.stock === undefined || source.stock === null ? null : Math.floor(source.stock / quantity), packagingConfirmed: false };
  });
  if (Object.keys(bundleSources).length > 999) throw Error('저장 가능한 번들 원본 연결 수를 초과했습니다.');
  validatedBundleSources({ ...options, bundleSources });
  return { rows: [...rows, ...copies], bundleSources };
}

export function applyBundleAddRows(options: ProductOptions, additions: readonly BundleAddition[], quantity: number, version: string): ProductOptions {
  const draft = createBundleAddDraft(options, additions, quantity), next = { ...applyOptionRows(options, draft.rows, version), bundleSources: draft.bundleSources };
  // An additive action must not normalize or re-confirm older saved originals.
  next.rows = [...options.rows.map(row => structuredClone(row)), ...next.rows.slice(options.rows.length)];
  for (const addition of additions) {
    const source = options.rows.find(row => row.id === addition.sourceOptionId)!, copy = next.rows.find(row => row.id === addition.optionId)!;
    for (const key of Object.keys(source.provenance) as (keyof typeof source.provenance)[]) {
      if (copy[key] === source[key]) copy.provenance[key] = source.provenance[key];
    }
    const hasPackaging = ['packagedWeightG', 'packagedWidthMm', 'packagedLengthMm', 'packagedHeightMm'].some(key => source[key as keyof OptionInput] != null);
    if (hasPackaging) copy.packagingUnitsPerPack = source.packagingUnitsPerPack ?? source.unitsPerPack;
  }
  return next;
}

const labelField = (field: QuotationField) => field.id === 'labelImages' || field.hubWire?.path.at(-1) === 'labelImageFiles'
  || field.type === 'images' && field.hubWire?.name === '제품 한글 표시사항 라벨 또는 도안 이미지';
const priceField = (field: QuotationField) => ['supplyPrice', 'salePrice', 'msrp', 'osrp'].includes(field.id)
  || !field.hubWire?.name && equal(field.hubWire?.path?.slice(0, 2), ['productPage', 'commonAttributes'])
    && ['purchasePrice', 'coupangSalePrice', 'msrp', 'osrp'].includes(field.hubWire?.path?.at(-1) ?? '');

/** Copy only stored source-specific values in the selected schema/scope.
 * Never materialize guessed automatic values or retain a source's label. */
export function bundleQuotationChanges(view: QuotationFieldsView, additions: readonly BundleAddition[], nextRows: readonly OptionInput[], policy: PricePolicy): QuotationChange[] {
  const fields = view.resolved.schema.fields, targets = quotationPriceTargets(fields), changes: QuotationChange[] = [];
  const prices = calculateOptionPrices(nextRows, { ...policy, recalculationMode: 'couplus-stage-two-v1' });
  for (const addition of additions) {
    const source = view.overrides.options[addition.sourceOptionId] ?? {}, row = nextRows.find(value => value.id === addition.optionId);
    if (!row || !view.resolved.rows.some(value => value.optionId === addition.sourceOptionId)) throw Error('번들 원본 견적서를 확인하지 못했습니다.');
    for (const field of fields) {
      if (field.readOnly || priceField(field)) continue;
      if (labelField(field)) { changes.push({ optionId: row.id, fieldKey: field.id, value: '' }); continue; }
      if (Object.hasOwn(source, field.id)) changes.push({ optionId: row.id, fieldKey: field.id, value: source[field.id] });
    }
    const calculated = prices.find(value => value.optionId === row.id)!;
    if (row.included) {
      if (!calculated.calculation) throw Error(calculated.error ?? '번들 가격을 계산하지 못했습니다.');
      for (const key of ['supplyPrice', 'salePrice', 'msrp'] as const)
        for (const fieldKey of targets[key].linked) changes.push({ optionId: row.id, fieldKey, value: String(calculated.calculation[key]) });
    }
  }
  return validateQuotationChanges(changes, { schema: view.resolved.schema, optionIds: nextRows.map(row => row.id), ownedImageKeys: view.imageKeys, overrides: view.overrides });
}

/** A copied physical value is still measured for the source's old selling
 * quantity. Retain recorded facts without confirming the new bundle quantity. */
export function bundleQuotationPackagingBasis(view: QuotationFieldsView, additions: readonly BundleAddition[]): QuotationPackagingBasis | undefined {
  if (!view.packagingBasis) return undefined;
  validateQuotationPackagingBasis(view.packagingBasis);
  const basis = structuredClone(view.packagingBasis);
  for (const addition of additions) {
    const facts = Object.hasOwn(basis.options, addition.sourceOptionId) ? basis.options[addition.sourceOptionId] : undefined;
    const overrides = Object.hasOwn(view.overrides.options, addition.sourceOptionId) ? view.overrides.options[addition.sourceOptionId] : undefined;
    if (!facts || !overrides) continue;
    const copied = Object.fromEntries(Object.entries(facts).filter(([key]) => Object.hasOwn(overrides, key) && isQuotationPackagingField(view.resolved.schema.fields, key)).map(([key, fact]) => [key, {
      ...fact, unitsPerPack: Object.hasOwn(fact.unitsPerPack, addition.sourceOptionId) ? { [addition.optionId]: fact.unitsPerPack[addition.sourceOptionId] } : {},
    }]));
    if (Object.keys(copied).length) Object.defineProperty(basis.options, addition.optionId, { value: copied, enumerable: true, configurable: true, writable: true });
  }
  validateQuotationPackagingBasis(basis);
  return basis;
}

export function verifyBundleAddReceipt(base: ProductOptionsResponse, quotation: QuotationFieldsView, receipt: BundleAddReceipt, additions: readonly BundleAddition[], quantity: number): BundleAddReceipt {
  const actual = receipt?.options, quote = receipt?.quotation;
  if (!actual || !quote) throw Error('번들 저장 응답을 확인하지 못했습니다. 새 옵션 식별자를 유지하고 저장 결과를 조회해주세요.');
  const expected = applyBundleAddRows(base.options, additions, quantity, actual.productVersion);
  const expectedNumbers = base.optionRegistrationNumbers === undefined ? undefined : { ...base.optionRegistrationNumbers };
  if (expectedNumbers) for (const addition of additions) {
    const sourceNumber = expectedNumbers[addition.sourceOptionId];
    if (sourceNumber) expectedNumbers[addition.optionId] = `${sourceNumber}B${quantity}`;
  }
  if (!Number.isFinite(Date.parse(actual.productVersion)) || Date.parse(actual.productVersion) <= Date.parse(base.productVersion)
    || !equal(actual.options, expected) || !equal(actual.pricing.policy, base.pricing.policy)
    || !equal(actual.pricing.rows, calculateOptionPrices(expected.rows, base.pricing.policy))
    || !validOptionRegistrationNumbers(actual.optionRegistrationNumbers, actual.options.rows)
    || !equal(actual.optionRegistrationNumbers, expectedNumbers)) throw Error('번들의 원본·항목·옵션번호 저장 결과가 다릅니다.');
  const changes = bundleQuotationChanges(quotation, additions, expected.rows, base.pricing.policy);
  if (quote.revision !== quotation.revision + 1 || quote.optionRevision !== actual.options.revision || quote.productVersion !== actual.productVersion || quote.updatedAt !== actual.productVersion
    || quote.contentRevision !== quotation.contentRevision || !equal(quote.categoryContext, quotation.categoryContext) || !equal(quote.imageKeys, quotation.imageKeys)
    || !/^[a-f0-9]{64}$/.test(quote.inputFingerprint) || !equal(quote.resolved.schema, quotation.resolved.schema)
    || !equal(quote.optionRegistrationNumbers, actual.optionRegistrationNumbers)
    || !equal(quote.packagingBasis, bundleQuotationPackagingBasis(quotation, additions))
    || !equal(quote.overrides, applyQuotationChanges(quotation.overrides, changes))
    || !equal(quote.resolved.rows.filter(row => row.optionId !== null).map(row => [row.optionId, row.included]), expected.rows.map(row => [row.id, row.included]))
    || !equal(quote.resolved.rows.filter(row => row.optionId === null).map(row => row.included), quotation.resolved.rows.filter(row => row.optionId === null).map(row => row.included))
    || changes.some(change => { const field = quote.resolved.schema.fields.find(value => value.id === change.fieldKey);
      return field && (priceField(field) || labelField(field)) && quote.resolved.rows.find(row => row.optionId === change.optionId)?.fields[change.fieldKey]?.value !== change.value;
    })) throw Error('번들 견적서의 원본·저장 범위를 확인하지 못했습니다.');
  return receipt;
}
