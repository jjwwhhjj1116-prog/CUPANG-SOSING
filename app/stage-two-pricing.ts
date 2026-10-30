import { pricePolicy, calculatePrice, type PricePolicy } from '@/app/pricing';
import { suggestBundleQuantity } from '@/app/bundle-policy';
import { applyOptionRows, calculateOptionPrices, optionInputs, type OptionInput, type ProductOptions, type ProductOptionsResponse } from '@/app/product-options';
import { applyQuotationChanges, validateQuotationChanges, type QuotationChange, type QuotationFieldsView } from '@/app/quotation-schema';
import { quotationPriceEditChanges, quotationPriceEditInput } from '@/app/quotation-price-edits';
import { quotationPriceTargets } from '@/app/quotation-price-targets';
import { validOptionRegistrationNumbers } from '@/app/product-registration';
import { preparePolicyQuotationPrices } from '@/app/policy-quotation-prices';
import { applyStageTwoMsrp, scopedStageTwoMsrp, stageTwoMsrpEdits } from '@/app/stage-two-msrp';
import { quotationScope, scopedQuotationOverrides } from '@/app/quotation-scopes';
import type { ProductRecord } from '@/db/queries';
import type { QuotationFieldsState } from '@/db/quotation-fields';
import {matchesStageTwoPricingReview,type StageTwoPricingReview} from '@/app/stage-two-pricing-review';

export type StageTwoPricingRequest = { expectedProductVersion: string; expectedOptionRevision: number; expectedQuotationRevision: number;
  expectedInputFingerprint: string; policy: PricePolicy; rows: OptionInput[]; changes: QuotationChange[]; recalculate: boolean };
export type StageTwoPricingReceipt = { product: ProductRecord; options: ProductOptionsResponse; quotation: QuotationFieldsView;pricingReview?:StageTwoPricingReview|null };
const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)])) : value;
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const bad = () => Error('가격·옵션·견적서의 한 번 저장 결과를 확인하지 못했습니다. 입력을 유지하고 저장 결과를 조회해주세요.');

/** The explicit local recalculation chooses quantity first, then the table's
 * calculateOptionPrices calculates the reviewed final pack. It never invents
 * stock, MOQ, packaging confirmation or bundle lineage. Disabled/absent bundle
 * settings preserve the current count, including a later manual override. */
export function recalculateStageTwoRows(rows: readonly OptionInput[], input: PricePolicy): OptionInput[] {
  const policy = pricePolicy(input);
  return rows.map(row => {
    if (!row.included || policy.bundleEnabled !== true || row.unitCostCny === null || row.unitCostCny <= 0) return { ...row };
    const unitsPerPack = suggestBundleQuantity(row.unitCostCny, policy, {
      bundleCriterion: policy.bundleCriterion!, bundleMinimumSupplyMargin: policy.bundleMinimumSupplyMargin!,
      bundleMinimumCoupangMargin: policy.bundleMinimumCoupangMargin!,
    });
    return { ...row, unitsPerPack, ...(unitsPerPack !== row.unitsPerPack ? { packagingConfirmed: false } : {}) };
  });
}

/** Keep untouched historical option payloads and provenance exactly. Edited
 * values use the shared packaging-basis and manual-provenance rules. */
export function applyStageTwoRows(current: ProductOptions, rows: OptionInput[], version: string): ProductOptions {
  const next = applyOptionRows(current, rows, version), before = new Map(current.rows.map(row => [row.id, row]));
  const inputs = new Map(optionInputs(current).map(row => [row.id, row]));
  next.rows = next.rows.map((row, index) => before.has(row.id) && equal(inputs.get(row.id), rows[index])
    ? structuredClone(before.get(row.id)!) : row);
  return next;
}

/** Current category only. A deliberate recalculate clears direct price edits
 * before subsequent manual changes; sale-derived MSRP keeps its prior explicit
 * manual precedence. This same pure plan drives the editor and the server. */
export function stageTwoQuotationDraft(view: QuotationFieldsView, input: PricePolicy, recalculate: boolean,
  edits: readonly QuotationChange[], suppliedState?: QuotationFieldsState) {
  const policy = pricePolicy(input), categoryId = view.categoryContext.categoryId;
  const state: QuotationFieldsState = suppliedState ?? { schemaVersion: 1, productId: '', revision: view.revision, updatedAt: view.updatedAt,
    overrides: categoryId ? { common: {}, options: {} } : structuredClone(view.overrides),
    ...(categoryId ? { categoryOverrides: { [quotationScope(categoryId)]: structuredClone(view.overrides) },
      ...(view.stageTwoMsrp ? { categoryStageTwoMsrp: { [quotationScope(categoryId)]: structuredClone(view.stageTwoMsrp) } } : {}) }
      : view.stageTwoMsrp ? { stageTwoMsrp: structuredClone(view.stageTwoMsrp) } : {}) };
  const plan = preparePolicyQuotationPrices(view, state, policy, recalculate).state;
  const overrides = scopedQuotationOverrides(plan, categoryId);
  const prepared: QuotationFieldsView = { ...view, overrides, stageTwoMsrp: scopedStageTwoMsrp(plan, categoryId) };
  if (!Array.isArray(edits) || edits.some(edit => !edit || quotationPriceEditInput(view.resolved.schema.fields, edit.fieldKey) === null))
    throw Error('2단계에서는 현재 견적서의 공급가·판매가·MSRP만 수정할 수 있습니다.');
  const linked = quotationPriceEditChanges(view.resolved.schema.fields, edits);
  const checked = linked.length ? validateQuotationChanges(linked, { schema: view.resolved.schema, optionIds: view.resolved.rows.flatMap(row => row.optionId === null ? [] : [row.optionId]),
    ownedImageKeys: view.imageKeys, overrides }) : [];
  const derived = stageTwoMsrpEdits(prepared, checked, policy);
  const changes = derived.changes.length ? validateQuotationChanges(derived.changes, { schema: view.resolved.schema,
    optionIds: view.resolved.rows.flatMap(row => row.optionId === null ? [] : [row.optionId]), ownedImageKeys: view.imageKeys, overrides }) : [];
  const finalOverrides = applyQuotationChanges(overrides, changes), markers = applyStageTwoMsrp(prepared, changes, derived.optionIds);
  if (categoryId) {
    plan.categoryOverrides = { ...plan.categoryOverrides, [quotationScope(categoryId)]: finalOverrides };
    const all = { ...plan.categoryStageTwoMsrp }; if (markers) all[quotationScope(categoryId)] = markers; else delete all[quotationScope(categoryId)];
    if (Object.keys(all).length) plan.categoryStageTwoMsrp = all; else delete plan.categoryStageTwoMsrp;
  } else { plan.overrides = finalOverrides; if (markers) plan.stageTwoMsrp = markers; else delete plan.stageTwoMsrp; }
  return { state: plan, overrides: finalOverrides, stageTwoMsrp: markers, changes };
}

/** Response validation is read-only. An ambiguous POST is resolved using this
 * exact expected commit, never an automatic second write. */
export function verifyStageTwoPricingReceipt(base: ProductOptionsResponse, quotation: QuotationFieldsView,
  request: StageTwoPricingRequest, receipt: StageTwoPricingReceipt): StageTwoPricingReceipt {
  const value = receipt?.options, quote = receipt?.quotation, product = receipt?.product, policy = pricePolicy(request.policy);
  if (!value || !quote || !product || base.options.productId !== product.id || product.id !== value.options?.productId
    || request.expectedProductVersion !== base.productVersion || request.expectedProductVersion !== quotation.productVersion
    || request.expectedOptionRevision !== base.options.revision || request.expectedQuotationRevision !== quotation.revision
    || request.expectedInputFingerprint !== quotation.inputFingerprint || !Number.isFinite(Date.parse(value.productVersion))
    || Date.parse(value.productVersion) <= Date.parse(base.productVersion) || product.updated_at !== value.productVersion) throw bad();
  const expected = applyStageTwoRows(base.options, request.rows, value.productVersion);
  const plan = stageTwoQuotationDraft(quotation, policy, request.recalculate, request.changes);
  if (!equal(value.options, expected) || !equal(value.pricing.policy, policy) || value.pricing.policySource !== 'saved-product'
    || !equal(value.pricing.rows, calculateOptionPrices(expected.rows, policy)) || !validOptionRegistrationNumbers(value.optionRegistrationNumbers, expected.rows)
    || (base.optionRegistrationNumbers !== undefined && expected.rows.some(row => Object.hasOwn(base.optionRegistrationNumbers!, row.id)
      && value.optionRegistrationNumbers?.[row.id] !== base.optionRegistrationNumbers![row.id]))
    || !equal(quote.optionRegistrationNumbers, value.optionRegistrationNumbers) || quote.revision !== quotation.revision + 1
    || quote.optionRevision !== expected.revision || quote.updatedAt !== value.productVersion || quote.productVersion !== value.productVersion
    || quote.contentRevision !== quotation.contentRevision || !equal(quote.categoryContext, quotation.categoryContext)
    || !equal(quote.resolved.schema, quotation.resolved.schema) || !equal(quote.imageKeys, quotation.imageKeys)
    || !equal(quote.overrides, plan.overrides) || !equal(quote.stageTwoMsrp, plan.stageTwoMsrp)
    || !equal(quote.packagingBasis, quotation.packagingBasis) || !/^[a-f0-9]{64}$/.test(quote.inputFingerprint) || quote.inputFingerprint === quotation.inputFingerprint
    || !equal(quote.resolved.rows.filter(row => row.optionId !== null).map(row => [row.optionId, row.included]), expected.rows.map(row => [row.id, row.included]))
    || product.quote_status !== '대기' || product.options_count !== expected.rows.filter(row => row.included).length
    || !equal(JSON.parse(product.pricing_policy ?? 'null'), policy) || product.exchange_rate !== policy.exchangeRate
    || product.supply_margin !== policy.supplyMargin || product.coupang_margin !== policy.coupangMargin) throw bad();
  const calculated = calculatePrice(product.source_price_cny, policy);
  if (product.supply_price !== calculated.supplyPrice || product.sale_price !== calculated.salePrice || product.msrp !== calculated.msrp) throw bad();
  if(expected.rows.some(row=>row.included)&&(!receipt.pricingReview||receipt.pricingReview.productVersion!==product.updated_at
    ||!matchesStageTwoPricingReview(receipt.pricingReview,{ownerId:product.owner_id,product,policy,options:expected,state:{...plan.state,productId:product.id},
      schema:quote.resolved.schema,profileId:quote.categoryContext.profileId,sourceInputFingerprint:request.expectedInputFingerprint,sourceProductVersion:request.expectedProductVersion})))throw bad();
  const targets = quotationPriceTargets(quote.resolved.schema.fields), prices = calculateOptionPrices(expected.rows, policy);
  for (const row of quote.resolved.rows) {
    const automatic = quote.automatic.rows.find(item => item.optionId === row.optionId);
    if (!automatic) throw bad();
    const amounts = row.optionId === null ? calculated : prices.find(item => item.optionId === row.optionId)?.calculation;
    for (const key of ['supplyPrice', 'salePrice', 'msrp'] as const) for (const field of targets[key].linked) {
      const expectedAutomatic = amounts ? String(amounts[key]) : '';
      const own = row.optionId !== null && Object.hasOwn(plan.overrides.options, row.optionId) ? plan.overrides.options[row.optionId] : undefined;
      const final = own && Object.hasOwn(own, field) ? own[field] : Object.hasOwn(plan.overrides.common, field) ? plan.overrides.common[field] : expectedAutomatic;
      if (automatic.fields[field]?.value !== expectedAutomatic || row.fields[field]?.value !== final) throw bad();
    }
  }
  for (const change of plan.changes) if (change.value !== null && quote.resolved.rows.find(row => row.optionId === change.optionId)?.fields[change.fieldKey]?.value !== change.value) throw bad();
  return receipt;
}
export function unchangedStageTwoPricingReceipt(base: ProductOptionsResponse, quotation: QuotationFieldsView, receipt: StageTwoPricingReceipt): boolean {
  return !!receipt && receipt.product?.updated_at === base.productVersion && receipt.options?.productVersion === base.productVersion
    && equal(receipt.options.options, base.options) && equal(receipt.options.pricing, base.pricing)
    && equal(receipt.options.optionRegistrationNumbers, base.optionRegistrationNumbers) && equal(receipt.quotation, quotation);
}
