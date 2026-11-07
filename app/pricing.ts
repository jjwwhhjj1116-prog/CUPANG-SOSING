/** Reference CNY belongs to the original selection, never a single export row. */
export type SourcingMarginGate = { mode: 'rate' | 'amount' | 'both' | 'either'; minRate?: number | null; minAmount?: number | null; source?: 'default' | 'customer' };
export type FixedSourcingBasis = { version: 1; referenceCny: number; salePrice: number; supplyPrice?: number; purchaseCost?: number; sourceUnitsPerPack?: number; supplyAnchorMargin?: number; marginGate?: SourcingMarginGate | null };
export type PricePolicy = { fixedSourcing?: FixedSourcingBasis; exchangeRate: number; supplyMargin: number; coupangMargin: number; minimumMargin: number; msrpMultiple: number; roundingUnit: number; roundingMode?: 'up' | 'nearest'; arithmeticMode?: 'couplus-number-v1'; useIntegratedRate?: boolean; integratedRate?: number | null; recalculationMode?: 'couplus-stage-two-v1'; recalculationMinimumEnabled?: boolean;
  bundleEnabled?: boolean; bundleCriterion?: 'supplyMargin' | 'coupangMargin'; bundleMinimumSupplyMargin?: number; bundleMinimumCoupangMargin?: number };
export function pricePolicy(input: unknown): PricePolicy {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('가격 설정을 확인해주세요.');
  const record = input as Record<string, unknown>;
  const keys = ['exchangeRate', 'supplyMargin', 'coupangMargin', 'minimumMargin', 'msrpMultiple', 'roundingUnit'] as const;
  for (const key of keys) if (typeof record[key] !== 'number' || !Number.isFinite(record[key])) throw new Error('가격 설정은 유효한 숫자여야 합니다.');
  const p = record as PricePolicy;
  let fixedSourcing = p.fixedSourcing;
  if (Object.hasOwn(record, 'fixedSourcing')) {
    const fixed = record.fixedSourcing;
    if (!fixed || typeof fixed !== 'object' || Array.isArray(fixed)) throw new Error('고정 소싱가격 기준을 확인해주세요.');
    const basis = fixed as Record<string, unknown>;
    if (Object.keys(basis).some(key => !['version', 'referenceCny', 'salePrice', 'supplyPrice', 'purchaseCost', 'sourceUnitsPerPack', 'supplyAnchorMargin', 'marginGate'].includes(key))
      || basis.version !== 1 || typeof basis.referenceCny !== 'number' || !Number.isFinite(basis.referenceCny) || basis.referenceCny <= 0
      || !Number.isSafeInteger(basis.salePrice) || (basis.salePrice as number) <= 0
      || Object.hasOwn(basis, 'supplyAnchorMargin') && !validMargin(basis.supplyAnchorMargin)
      || ['supplyPrice', 'purchaseCost', 'sourceUnitsPerPack'].some(key => Object.hasOwn(basis, key) && (!Number.isSafeInteger(basis[key]) || (basis[key] as number) <= 0)))
      throw new Error('고정 소싱가격의 기준 CNY·양수 원화 금액·구성 수량을 확인해주세요.');
    fixedSourcing = { ...p.fixedSourcing!, ...(basis.marginGate == null ? {} : { marginGate: sourcingMarginGate(basis.marginGate) }) };
  }
  if (p.exchangeRate <= 0 || p.supplyMargin < 0 || p.supplyMargin >= 100 || p.coupangMargin < 0 || p.coupangMargin >= 100 || p.minimumMargin < 0 || p.msrpMultiple < 1 || ![1,10,100,1000].includes(p.roundingUnit)) throw new Error('환율·마진·최소 마진·시장가격 배수·올림 단위를 확인해주세요.');
  if (record.roundingMode !== undefined && record.roundingMode !== 'up' && record.roundingMode !== 'nearest') throw new Error('가격 처리 방식을 확인해주세요.');
  if (record.arithmeticMode !== undefined && record.arithmeticMode !== 'couplus-number-v1') throw new Error('가격 계산 방식을 확인해주세요.');
  if (record.recalculationMode !== undefined && record.recalculationMode !== 'couplus-stage-two-v1') throw new Error('일괄 재계산 방식을 확인해주세요.');
  if (record.recalculationMinimumEnabled !== undefined && typeof record.recalculationMinimumEnabled !== 'boolean') throw new Error('최소 공급 마진 보장의 선택 상태를 확인해주세요.');
  if (record.recalculationMinimumEnabled === false && p.minimumMargin !== 0) throw new Error('최소 공급 마진 보장을 끄면 적용 금액은 0원이어야 합니다.');
  if (record.useIntegratedRate !== undefined && typeof record.useIntegratedRate !== 'boolean') throw new Error('통합통관 환율 사용 여부를 확인해주세요.');
  if (record.integratedRate !== undefined && record.integratedRate !== null
    && (typeof record.integratedRate !== 'number' || !Number.isFinite(record.integratedRate) || record.integratedRate <= 0)) throw new Error('확인한 통합통관 환율을 양수로 입력해주세요.');
  if (record.useIntegratedRate === true && (typeof record.integratedRate !== 'number' || !Number.isFinite(record.integratedRate) || record.integratedRate <= 0)) throw new Error('통합통관 환율을 사용하려면 확인한 양수 환율이 필요합니다.');
  const bundleKeys = ['bundleEnabled', 'bundleCriterion', 'bundleMinimumSupplyMargin', 'bundleMinimumCoupangMargin'];
  // Workspace settings used by old products carry three explicit nulls for an
  // unconfigured, inert bundle switch. Do not activate or serialize a new rule
  // merely by resolving those legacy settings.
  const legacyBundle = typeof record.bundleEnabled === 'boolean'
    && bundleKeys.slice(1).every(key => Object.hasOwn(record, key) && record[key] === null);
  const hasBundle = !legacyBundle && bundleKeys.some(key => Object.hasOwn(record, key));
  if (hasBundle && (bundleKeys.some(key => !Object.hasOwn(record, key)) || typeof record.bundleEnabled !== 'boolean'
    || !['supplyMargin', 'coupangMargin'].includes(record.bundleCriterion as string)
    || ['bundleMinimumSupplyMargin', 'bundleMinimumCoupangMargin'].some(key => !Number.isSafeInteger(record[key]) || (record[key] as number) < 1000)))
    throw new Error('번들 활성화·기준과 두 최소 마진액을 함께 확인해주세요. 기준 금액은 1,000원 이상 정수입니다.');
  // Off/missing integration is the original policy, byte-for-byte. A rate held
  // in the settings editor is not a charge until the owner enables it.
  return { ...Object.fromEntries(keys.map(key => [key, p[key]])), ...(fixedSourcing ? { fixedSourcing } : {}), ...(record.roundingMode === 'nearest' ? { roundingMode: 'nearest' as const } : {}),
    ...(record.arithmeticMode === 'couplus-number-v1' ? { arithmeticMode: 'couplus-number-v1' as const } : {}),
    ...(record.useIntegratedRate === true ? { useIntegratedRate: true, integratedRate: record.integratedRate } : {}),
    ...(record.recalculationMode === 'couplus-stage-two-v1' ? { recalculationMode: 'couplus-stage-two-v1' as const } : {}),
    ...(hasBundle ? { bundleEnabled: record.bundleEnabled, bundleCriterion: record.bundleCriterion,
      bundleMinimumSupplyMargin: record.bundleMinimumSupplyMargin, bundleMinimumCoupangMargin: record.bundleMinimumCoupangMargin } : {}),
    ...(typeof record.recalculationMinimumEnabled === 'boolean' ? { recalculationMinimumEnabled: record.recalculationMinimumEnabled } : {}) } as PricePolicy;
}
function validMargin(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 100;
}
/** Remember the rate that established the fixed sourcing supply amounts when
 * the user edits the selling margin. Historical fixed-price policies have no
 * anchor and keep their recorded sale-led calculation. */
export function changeCoupangMargin(policy: PricePolicy, coupangMargin: number): PricePolicy {
  const basis = policy.fixedSourcing;
  if (!basis || basis.supplyAnchorMargin !== undefined || !validMargin(policy.coupangMargin) || coupangMargin === policy.coupangMargin)
    return { ...policy, coupangMargin };
  return { ...policy, coupangMargin, fixedSourcing: { ...basis, supplyAnchorMargin: policy.coupangMargin } };
}
/** Couplus stage-two pricingInfo keeps the switch separate from its amount,
 * including enabled zero. A missing marker retains the older saved policy. */
export function priceMinimumMarginEnabled(policy: Pick<PricePolicy, 'minimumMargin' | 'recalculationMinimumEnabled'>): boolean {
  return policy.recalculationMinimumEnabled ?? policy.minimumMargin > 0;
}
/** Recorded savePricing recalculates MSRP from the explicitly reviewed sale
 * amount using the saved multiple and nearest currency unit. Other prices and
 * the policy's ordinary rounding mode are not changed by this calculation. */
export function calculateStageTwoMsrp(salePrice: number, input: PricePolicy): number {
  const policy = pricePolicy(input);
  if (!Number.isSafeInteger(salePrice) || salePrice <= 0) throw Error('판매가는 양수 정수 원 단위로 입력해주세요.');
  if (usesCouplusNumbers(policy)) return roundNumberCurrency(salePrice * policy.msrpMultiple, policy.roundingUnit);
  return Number(roundCurrency(multiply(decimal(salePrice), decimal(policy.msrpMultiple)), policy.roundingUnit, 'nearest'));
}
/** Use the same rounding and margin path for a reviewed supply price as for an automatic one. */
export function calculateSalePriceFromSupply(supplyPrice: number, input: PricePolicy): number {
  if (!Number.isSafeInteger(supplyPrice) || supplyPrice <= 0) throw Error('공급가는 양수 정수 원 단위로 입력해주세요.');
  return saleFromSupply(supplyPrice, pricePolicy(input));
}
function saleFromSupply(supplyPrice: number, policy: PricePolicy): number {
  if (policy.fixedSourcing || usesCouplusNumbers(policy))
    return roundNumberCurrency(supplyPrice / (1 - policy.coupangMargin / 100), policy.roundingUnit);
  return Number(decimalSaleFromSupply(BigInt(supplyPrice), policy));
}
function decimalSaleFromSupply(supplyPrice: bigint, policy: PricePolicy): bigint {
  const hundred = decimal(100);
  return roundCurrency(divide(multiply(rational(supplyPrice), hundred), subtract(hundred, decimal(policy.coupangMargin))), policy.roundingUnit, policy.roundingMode);
}
/** The live owner root gate is authoritative; saved product gates are snapshots only. */
export function effectivePricePolicy(input: unknown, settings: unknown): PricePolicy {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return pricePolicy(input);
  const raw = input as PricePolicy;
  if (!raw.fixedSourcing || typeof raw.fixedSourcing !== 'object' || Array.isArray(raw.fixedSourcing)) return pricePolicy(input);
  const fixedSourcing = { ...raw.fixedSourcing };
  delete fixedSourcing.marginGate;
  const gate = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>).rocketMarginGate : undefined;
  if (gate !== null && gate !== undefined) fixedSourcing.marginGate = sourcingMarginGate(gate);
  return pricePolicy({ ...raw, fixedSourcing });
}
/** Representative prices use the selected fixed basis, never an unselected original SKU. */
export function calculateRepresentativePrice(sourcePriceCny: number, input: PricePolicy) {
  const policy = pricePolicy(input);
  return calculatePrice(policy.fixedSourcing?.referenceCny ?? sourcePriceCny, policy);
}
export function calculatePrice(sourcePriceCny: number, input: PricePolicy, unitsPerPack = 1) {
  const p = pricePolicy(input);
  if (!Number.isFinite(sourcePriceCny) || sourcePriceCny <= 0) throw new Error('저장된 상품 원가가 올바르지 않습니다.');
  if (!Number.isSafeInteger(unitsPerPack) || unitsPerPack < 1) throw new Error('판매 단위당 구성 수량은 1 이상 안전한 정수로 입력해주세요.');
  if (p.fixedSourcing) return calculateFixedSourcingPrice(sourcePriceCny, p, unitsPerPack);
  if (usesCouplusNumbers(p)) return calculateCouplusNumberPrice(sourcePriceCny, p, unitsPerPack);
  // Use the finite input number's decimal spelling, rather than intermediate
  // IEEE-754 arithmetic. Every comparison and currency ceiling stays exact.
  const hundred = decimal(100);
  // The pack total must also remain rational. Converting it to a display number
  // first can move the target across a rounding step before applying the rate.
  const packCny = multiply(decimal(sourcePriceCny), rational(BigInt(unitsPerPack)));
  // Recorded Couplus purchaseCost receives the TOTAL selling-pack CNY amount.
  // Handling 200 + barcode 100 are charged once per pack, VAT follows, and the
  // purchase cost is rounded to one KRW before the ordinary margin algorithm.
  const cost = p.useIntegratedRate === true
    ? rational(roundCurrency(multiply(add(multiply(packCny, decimal(p.integratedRate!)), add(decimal(200), decimal(100))), decimal(1.1)), 1, 'nearest'))
    : multiply(packCny, decimal(p.exchangeRate));
  const supplyTarget = divide(multiply(cost, hundred), subtract(hundred, decimal(p.supplyMargin)));
  const minimumTarget = add(cost, decimal(p.minimumMargin));
  // Apply the selected rounding once, after selecting the margin target.
  // Fresh Couplus draft 260927024002: 5.23 * 350 + 3000 = 4830.5,
  // rounded to 4830 (actual margin 2999.5). A second ceiling changes its price.
  // Recorded stage-two updatePricing/recalculateOption directly adds the
  // enabled minimum amount. Only an explicit, saved recalculation uses it;
  // initial drafts and older policies keep the worker's margin-floor rule.
  const target = p.recalculationMode === 'couplus-stage-two-v1' && priceMinimumMarginEnabled(p)
    ? minimumTarget : compare(supplyTarget, minimumTarget) >= 0 ? supplyTarget : minimumTarget;
  const supply = roundCurrency(target, p.roundingUnit, p.roundingMode);
  if (supply === BigInt(0)) throw new Error('반올림한 공급가가 0원입니다. 가격 처리 단위를 줄이거나 최소 공급 마진을 설정해주세요.');
  const sale = decimalSaleFromSupply(supply, p);
  const market = roundCurrency(multiply(rational(sale), decimal(p.msrpMultiple)), p.roundingUnit, p.roundingMode);
  const margin = subtract(rational(supply), cost);
  return { costKrw: toNumber(cost), supplyPrice: Number(supply), salePrice: Number(sale), msrp: Number(market),
    marginKrw: toNumber(margin), actualMargin: toNumber(divide(multiply(margin, hundred), rational(supply))) };
}

export function sourcingMarginGate(input: unknown): Required<SourcingMarginGate> {
  if (input === null || input === undefined) return { mode: 'rate', minRate: 25, minAmount: null, source: 'default' };
  const fail = () => Error('소싱 공급마진 판단 방식과 기준율·금액을 확인해주세요.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail();
  const value = input as Record<string, unknown>, mode = value.mode as SourcingMarginGate['mode'];
  if (!['rate', 'amount', 'both', 'either'].includes(mode)) throw fail();
  const rate = mode !== 'amount', amount = mode !== 'rate';
  const minRate = rate ? Number(value.minRate) : null, minAmount = amount ? Number(value.minAmount) : null;
  if (rate && (value.minRate === '' || value.minRate === null || !Number.isFinite(minRate) || minRate! < 0 || minRate! >= 100)
    || amount && (value.minAmount === '' || value.minAmount === null || !Number.isInteger(minAmount) || minAmount! < 0)) throw fail();
  return { mode, minRate, minAmount, source: 'customer' };
}

function calculateFixedSourcingPrice(cny: number, policy: PricePolicy, units: number) {
  const basis = policy.fixedSourcing!, uplift = cny > basis.referenceCny;
  const purchaseCost = (price: number) => policy.useIntegratedRate
    ? roundNumberCurrency((price * units * policy.integratedRate! + 200 + 100) * 1.1, 1) : price * units * policy.exchangeRate;
  const selectedCost = basis.purchaseCost === undefined ? undefined : units === (basis.sourceUnitsPerPack ?? 1)
    ? basis.purchaseCost : roundNumberCurrency(basis.purchaseCost / (basis.sourceUnitsPerPack ?? 1) * units, 1);
  const costKrw = selectedCost === undefined ? purchaseCost(cny) : selectedCost + (uplift ? purchaseCost(cny) - purchaseCost(basis.referenceCny) : 0);
  const baseSale = uplift ? Math.ceil(basis.salePrice * cny / basis.referenceCny / policy.roundingUnit) * policy.roundingUnit : basis.salePrice;
  const supplyMargin = basis.supplyAnchorMargin ?? policy.coupangMargin;
  const supplyPrice = !uplift && basis.supplyPrice !== undefined ? basis.supplyPrice
    : roundNumberCurrency(baseSale * (1 - supplyMargin / 100), policy.roundingUnit);
  const salePrice = basis.supplyAnchorMargin !== undefined && policy.coupangMargin !== basis.supplyAnchorMargin
    ? saleFromSupply(supplyPrice, policy) : baseSale;
  const msrp = roundNumberCurrency(salePrice * policy.msrpMultiple, policy.roundingUnit);
  if (![costKrw, salePrice, supplyPrice, msrp].every(value => Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER))
    throw new Error('계산 가능한 가격 범위를 초과했습니다.');
  const marginKrw = supplyPrice - costKrw;
  const gate = sourcingMarginGate(basis.marginGate);
  const ratePass = marginKrw >= salePrice * gate.minRate! / 100, amountPass = marginKrw >= gate.minAmount!;
  const passes = gate.mode === 'rate' ? ratePass : gate.mode === 'amount' ? amountPass : gate.mode === 'both' ? ratePass && amountPass : ratePass || amountPass;
  if (!passes) {
    const criterion = gate.mode === 'rate' ? `판매가의 ${gate.minRate}%` : gate.mode === 'amount' ? `${gate.minAmount}원`
      : `판매가의 ${gate.minRate}% ${gate.mode === 'both' ? '및' : '또는'} ${gate.minAmount}원`;
    throw new Error(`공급마진이 ${criterion} 기준을 충족하지 않아 고정 소싱가격을 적용할 수 없습니다.`);
  }
  return { costKrw, supplyPrice, salePrice, msrp, marginKrw, actualMargin: marginKrw / supplyPrice * 100 };
}

function usesCouplusNumbers(policy: PricePolicy): boolean {
  // Existing saved policies and the explicit ceiling option retain their exact
  // decimal arithmetic. Only a newly selected Couplus nearest policy opts in.
  return policy.arithmeticMode === 'couplus-number-v1' && policy.roundingMode === 'nearest';
}
function roundNumberCurrency(value: number, unit: number): number {
  const amount = Math.round(value / unit) * unit;
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(amount) || amount < 0) throw new Error('계산 가능한 가격 범위를 초과했습니다.');
  return amount;
}
function calculateCouplusNumberPrice(sourcePriceCny: number, policy: PricePolicy, unitsPerPack: number) {
  // Recorded purchaseCost receives the total pack first. Preserve the original
  // Number operation order, including +200 then +100 and its one-KRW VAT round.
  const packCny = sourcePriceCny * unitsPerPack;
  if (!Number.isFinite(packCny)) throw new Error('계산 가능한 가격 범위를 초과했습니다.');
  const costKrw = policy.useIntegratedRate === true
    ? roundNumberCurrency((packCny * policy.integratedRate! + 200 + 100) * 1.1, 1)
    : packCny * policy.exchangeRate;
  if (!Number.isFinite(costKrw) || costKrw < 0 || costKrw > Number.MAX_SAFE_INTEGER) throw new Error('계산 가능한 가격 범위를 초과했습니다.');
  const minimumEnabled = priceMinimumMarginEnabled(policy);
  let supplyPrice: number;
  if (policy.recalculationMode === 'couplus-stage-two-v1' && minimumEnabled) {
    supplyPrice = roundNumberCurrency(costKrw + policy.minimumMargin, policy.roundingUnit);
  } else {
    supplyPrice = roundNumberCurrency(costKrw / (1 - policy.supplyMargin / 100), policy.roundingUnit);
    // The initial worker checks the already-rounded supply margin, whereas the
    // explicit stage-two operation above directly uses the enabled minimum.
    if (minimumEnabled && supplyPrice - costKrw < policy.minimumMargin) {
      supplyPrice = roundNumberCurrency(costKrw + policy.minimumMargin, policy.roundingUnit);
    }
  }
  if (supplyPrice === 0) throw new Error('반올림한 공급가가 0원입니다. 가격 처리 단위를 줄이거나 최소 공급 마진을 설정해주세요.');
  const salePrice = saleFromSupply(supplyPrice, policy);
  const msrp = roundNumberCurrency(salePrice * policy.msrpMultiple, policy.roundingUnit);
  const marginKrw = supplyPrice - costKrw;
  return { costKrw, supplyPrice, salePrice, msrp, marginKrw, actualMargin: marginKrw / supplyPrice * 100 };
}

type Rational = { numerator: bigint; denominator: bigint };
const zero = BigInt(0), one = BigInt(1), two = BigInt(2), ten = BigInt(10);
const maximumMoney = BigInt(Number.MAX_SAFE_INTEGER);
function gcd(a: bigint, b: bigint): bigint {
  if (a < zero) a = -a;
  while (b !== zero) { const remainder = a % b; a = b; b = remainder; }
  return a;
}
function rational(numerator: bigint, denominator = one): Rational {
  if (denominator <= zero) throw new Error('계산 가능한 가격 범위를 초과했습니다.');
  if (numerator === zero) return { numerator: zero, denominator: one };
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}
function decimal(value: number): Rational {
  // Public validation permits finite numbers only. Their decimal spelling has
  // bounded length and an exponent in [-324, 308], so BigInt work is bounded.
  const [mantissa, exponent = '0'] = value.toString().toLowerCase().split('e');
  const [integer, fraction = ''] = mantissa.split('.');
  const numerator = BigInt(integer + fraction);
  const scale = fraction.length - Number(exponent);
  return scale >= 0 ? rational(numerator, ten ** BigInt(scale)) : rational(numerator * ten ** BigInt(-scale));
}
function add(a: Rational, b: Rational) { return rational(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator); }
function subtract(a: Rational, b: Rational) { return rational(a.numerator * b.denominator - b.numerator * a.denominator, a.denominator * b.denominator); }
function multiply(a: Rational, b: Rational) { return rational(a.numerator * b.numerator, a.denominator * b.denominator); }
function divide(a: Rational, b: Rational) { return rational(a.numerator * b.denominator, a.denominator * b.numerator); }
function compare(a: Rational, b: Rational) { const difference = a.numerator * b.denominator - b.numerator * a.denominator; return difference < zero ? -1 : difference > zero ? 1 : 0; }
function roundCurrency(value: Rational, unit: number, mode: PricePolicy['roundingMode'] = 'up'): bigint {
  const increment = BigInt(unit); const denominator = value.denominator * increment;
  const amount = (mode === 'nearest' ? (value.numerator * two + denominator) / (denominator * two) : (value.numerator + denominator - one) / denominator) * increment;
  if (amount < zero || amount > maximumMoney) throw new Error('계산 가능한 가격 범위를 초과했습니다.');
  return amount;
}
function roundedDivision(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator; const remainder = numerator % denominator;
  const twice = remainder * two;
  return twice > denominator || (twice === denominator && quotient % two !== zero) ? quotient + one : quotient;
}
function toNumber(value: Rational): number {
  // Only display/summary decimals become numbers. Round once to the nearest
  // representable binary value, including ties-to-even and subnormal values.
  if (value.numerator === zero) return 0;
  const sign = value.numerator < zero ? -1 : 1;
  const numerator = value.numerator < zero ? -value.numerator : value.numerator;
  const denominator = value.denominator;
  let exponent = numerator.toString(2).length - denominator.toString(2).length;
  if (exponent >= 0 ? numerator < (denominator << BigInt(exponent)) : (numerator << BigInt(-exponent)) < denominator) exponent--;
  if (exponent < -1022) return sign * Number(roundedDivision(numerator << BigInt(1074), denominator)) * Number.MIN_VALUE;
  const shift = 52 - exponent;
  const significand = shift >= 0 ? roundedDivision(numerator << BigInt(shift), denominator) : roundedDivision(numerator, denominator << BigInt(-shift));
  return sign * Number(significand) * 2 ** (exponent - 52);
}

// Quoting alone does not prevent spreadsheet formula execution.
export function quotationCsv(rows: (string | number)[][]) {
  return '\uFEFF' + rows.map(row => row.map(value => {
    const raw = String(value);
    const safe = typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(raw) ? "'" + raw : raw;
    return '"' + safe.replace(/"/g, '""') + '"';
  }).join(',')).join('\r\n');
}
