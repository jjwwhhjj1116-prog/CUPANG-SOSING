import { pricePolicy, type PricePolicy } from '@/app/pricing';

export type BundlePolicy = {
  bundleCriterion: 'supplyMargin' | 'coupangMargin';
  bundleMinimumSupplyMargin: number;
  bundleMinimumCoupangMargin: number;
};

export function bundlePolicy(input: unknown): BundlePolicy {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('번들 기준을 확인해주세요.');
  const value = input as BundlePolicy;
  if (value.bundleCriterion !== 'supplyMargin' && value.bundleCriterion !== 'coupangMargin') throw new Error('번들 기준을 선택해주세요.');
  for (const key of ['bundleMinimumSupplyMargin', 'bundleMinimumCoupangMargin'] as const) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 1000) throw new Error('번들 기준 금액은 1,000원 이상 안전한 정수로 입력해주세요.');
  }
  return { bundleCriterion: value.bundleCriterion, bundleMinimumSupplyMargin: value.bundleMinimumSupplyMargin, bundleMinimumCoupangMargin: value.bundleMinimumCoupangMargin };
}

/** Legacy captures had only an inert enabled flag. They must not acquire a new
 * quantity rule when replayed after this feature is introduced. */
export function configuredBundlePolicy(input: unknown): BundlePolicy | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (['bundleCriterion', 'bundleMinimumSupplyMargin', 'bundleMinimumCoupangMargin'].every(key => value[key] == null)) return null;
  return bundlePolicy(input);
}

/** Observed Couplus quantity selector, separate from final price calculation.
 * Captured public code: step556 processOptions/updateOptionPricing uses 100;
 * pricing editing and the step546 worker pass their configured roundUnit.
 * The loop actually chooses 1, 3, ... 21, despite the page's even-number hint.
 * Minimum supply guarantee and MSRP do not participate in this selector. */
export function suggestBundleQuantity(unitCostCny: number, pricing: PricePolicy, input: BundlePolicy, roundingUnit = pricing.roundingUnit): number {
  const policy = pricePolicy(pricing), bundle = bundlePolicy(input);
  if (!Number.isFinite(unitCostCny) || unitCostCny <= 0 || ![1, 10, 100, 1000].includes(roundingUnit)) throw new Error('번들 원가와 가격 처리 단위를 확인해주세요.');
  const cost = unitCostCny * policy.exchangeRate;
  const supply = Math.round(cost / (1 - policy.supplyMargin / 100) / roundingUnit) * roundingUnit;
  const sale = Math.round(supply / (1 - policy.coupangMargin / 100) / roundingUnit) * roundingUnit;
  const margin = bundle.bundleCriterion === 'supplyMargin' ? supply - cost : sale - supply;
  const minimum = bundle.bundleCriterion === 'supplyMargin' ? bundle.bundleMinimumSupplyMargin : bundle.bundleMinimumCoupangMargin;
  if (![cost, supply, sale, margin].every(Number.isFinite)) throw new Error('계산 가능한 번들 가격 범위를 초과했습니다.');
  let quantity = 1;
  while (margin * quantity < minimum && quantity < 20) quantity += 2;
  return quantity;
}

export function initialBundleQuantity(unitCostCny: number, pricing: PricePolicy, settings: unknown): number {
  if (!settings || typeof settings !== 'object' || (settings as Record<string, unknown>).bundleEnabled !== true) return 1;
  const bundle = configuredBundlePolicy(settings);
  return bundle ? suggestBundleQuantity(unitCostCny, pricing, bundle, 100) : 1;
}
