import type { QuotationField } from '@/app/quotation-schema';

/** Live JSON Schema lengths count Unicode code points, not UTF-16 units. */
export function quotationValueLength(field: QuotationField, value: string): number {
  if (!field.hubWire) return value.length;
  return Array.from(value).length;
}

export function isNumericQuotationField(field: QuotationField): boolean {
  return field.type === 'number' || field.numericValue === true || field.numericText === true;
}

/** Parse exactly the value emitted by the quotation exporter. */
export function quotationNumericValue(field: QuotationField, value: string): number | undefined {
  if (!isNumericQuotationField(field)) return undefined;
  const syntax = field.numericText&&field.hubInput==='packagedWeightG' ? /^\d+$/
    : field.hubWire ? /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/ : /^\d+(?:\.\d+)?$/;
  if (!syntax.test(value)) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || (numeric === 0 && /[1-9]/.test(value.split(/[eE]/)[0]))) return undefined;
  return numeric;
}

function decimalParts(value: number): { coefficient: bigint; scale: number } {
  // Finite JS numbers have bounded decimal exponents (-324..308). Normalizing
  // first keeps this calculation identical to the number serialized for Hub.
  const [significand, exponent = '0'] = String(value).toLowerCase().split('e');
  const [whole, fraction = ''] = significand.split('.');
  return { coefficient: BigInt(whole + fraction), scale: fraction.length - Number(exponent) };
}

export function isQuotationDecimalMultiple(value: number, multiple: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(multiple) || multiple <= 0) return false;
  const left = decimalParts(value), right = decimalParts(multiple);
  const scale = Math.max(left.scale, right.scale);
  const numerator = left.coefficient * BigInt(10) ** BigInt(scale - left.scale);
  const denominator = right.coefficient * BigInt(10) ** BigInt(scale - right.scale);
  return numerator % denominator === BigInt(0);
}

export function quotationScalarValueIssues(field: QuotationField, value: string): string[] {
  const issues: string[] = [], length = quotationValueLength(field, value);
  if (field.minLength !== undefined && length < field.minLength) issues.push(`최소 ${field.minLength}자 이상 입력해주세요.`);
  if (field.maxLength !== undefined && length > field.maxLength) issues.push(`${field.maxLength}자 제한을 초과했습니다.`);
  if (!isNumericQuotationField(field)) return issues;
  const numeric = quotationNumericValue(field, value);
  if (numeric === undefined || (field.integer && !Number.isSafeInteger(numeric))
    || (field.min !== undefined && numeric < field.min) || (field.max !== undefined && numeric > field.max)) {
    issues.push(`${field.unit ?? '숫자'} 값의 형식과 범위를 확인해주세요.`);
    return issues;
  }
  if (field.exclusiveMinimum !== undefined && numeric <= field.exclusiveMinimum) issues.push(`${field.exclusiveMinimum}보다 큰 값을 입력해주세요.`);
  if (field.exclusiveMaximum !== undefined && numeric >= field.exclusiveMaximum) issues.push(`${field.exclusiveMaximum}보다 작은 값을 입력해주세요.`);
  if (field.multipleOf !== undefined && !isQuotationDecimalMultiple(numeric, field.multipleOf)) issues.push(`${field.multipleOf}의 배수로 입력해주세요.`);
  return issues;
}
