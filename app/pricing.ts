export type PricePolicy = { exchangeRate: number; supplyMargin: number; coupangMargin: number; minimumMargin: number; msrpMultiple: number; roundingUnit: number; roundingMode?: 'up' | 'nearest' };
export function pricePolicy(input: unknown): PricePolicy {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('가격 설정을 확인해주세요.');
  const record = input as Record<string, unknown>;
  const keys = ['exchangeRate', 'supplyMargin', 'coupangMargin', 'minimumMargin', 'msrpMultiple', 'roundingUnit'] as const;
  for (const key of keys) if (typeof record[key] !== 'number' || !Number.isFinite(record[key])) throw new Error('가격 설정은 유효한 숫자여야 합니다.');
  const p = record as PricePolicy;
  if (p.exchangeRate <= 0 || p.supplyMargin < 0 || p.supplyMargin >= 100 || p.coupangMargin < 0 || p.coupangMargin >= 100 || p.minimumMargin < 0 || p.msrpMultiple < 1 || ![1,10,100,1000].includes(p.roundingUnit)) throw new Error('환율·마진·최소 마진·시장가격 배수·올림 단위를 확인해주세요.');
  if (record.roundingMode !== undefined && record.roundingMode !== 'up' && record.roundingMode !== 'nearest') throw new Error('가격 처리 방식을 확인해주세요.');
  return { ...Object.fromEntries(keys.map(key => [key, p[key]])), ...(record.roundingMode === 'nearest' ? { roundingMode: 'nearest' as const } : {}) } as PricePolicy;
}
export function calculatePrice(sourcePriceCny: number, input: PricePolicy) {
  const p = pricePolicy(input);
  if (!Number.isFinite(sourcePriceCny) || sourcePriceCny <= 0) throw new Error('저장된 상품 원가가 올바르지 않습니다.');
  // Use the finite input number's decimal spelling, rather than intermediate
  // IEEE-754 arithmetic. Every comparison and currency ceiling stays exact.
  const hundred = decimal(100);
  const cost = multiply(decimal(sourcePriceCny), decimal(p.exchangeRate));
  const supplyTarget = divide(multiply(cost, hundred), subtract(hundred, decimal(p.supplyMargin)));
  const minimumTarget = add(cost, decimal(p.minimumMargin));
  let supply = roundCurrency(compare(supplyTarget, minimumTarget) >= 0 ? supplyTarget : minimumTarget, p.roundingUnit, p.roundingMode);
  if (compare(rational(supply), minimumTarget) < 0) supply = roundCurrency(minimumTarget, p.roundingUnit);
  const sale = roundCurrency(divide(multiply(rational(supply), hundred), subtract(hundred, decimal(p.coupangMargin))), p.roundingUnit, p.roundingMode);
  const market = roundCurrency(multiply(rational(sale), decimal(p.msrpMultiple)), p.roundingUnit, p.roundingMode);
  const margin = subtract(rational(supply), cost);
  return { costKrw: toNumber(cost), supplyPrice: Number(supply), salePrice: Number(sale), msrp: Number(market),
    marginKrw: toNumber(margin), actualMargin: toNumber(divide(multiply(margin, hundred), rational(supply))) };
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
