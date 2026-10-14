import type { OptionCalculation, OptionInput } from '@/app/product-options';
import type { QuotationChange, QuotationFieldsView } from '@/app/quotation-schema';
import { quotationPriceInputs, quotationPriceTargets } from '@/app/quotation-price-targets';

export type EffectiveGridCalculation = Omit<NonNullable<OptionCalculation['calculation']>, 'msrp'> & { msrp: number | null };
export type EffectiveGridPrice = { supply: string; sale: string; msrp: string; calculation: EffectiveGridCalculation | null; manual: boolean; error: string | null };

function positivePrice(value: string): number | null {
  const text = value.trim();
  if (!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
  const amount = Number(text);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

/** Presentation over an already verified quotation view. Automatic prices use
 * the current option draft, never the older quotation snapshot. Only exact
 * primary price wires select manual values; linked mismatches remain owned by
 * the quotation controller's separate validation and explicit save. */
export function effectiveGridPrices(rows: readonly OptionInput[], calculations: readonly OptionCalculation[],
  view: QuotationFieldsView | null, edits: readonly QuotationChange[] = []): Map<string, EffectiveGridPrice> {
  const targets = view ? quotationPriceTargets(view.resolved.schema.fields) : null;
  const byId = new Map(calculations.map(result => [result.optionId, result]));
  const pending = new Map<string, string | null>();
  for (const edit of edits) {
    const key = JSON.stringify([edit.optionId, edit.fieldKey]);
    if (pending.has(key)) throw Error('같은 옵션 가격에 중복 입력이 있습니다. 현재 입력을 확인해주세요.');
    pending.set(key, edit.value);
  }
  function manualValue(optionId: string | null, fieldId: string): string | undefined {
    const key = JSON.stringify([optionId, fieldId]);
    if (pending.has(key)) return pending.get(key) ?? undefined;
    const values = optionId === null ? view?.overrides.common : view?.overrides.options[optionId];
    return values && Object.hasOwn(values, fieldId) ? values[fieldId] : undefined;
  }
  return new Map(rows.map(row => {
    const result = byId.get(row.id), automatic = result?.calculation ?? null;
    let manual = false;
    const values = Object.fromEntries(quotationPriceInputs.map(input => {
      const primary = targets?.[input].primary;
      const own = primary ? manualValue(row.id, primary) : undefined;
      const common = primary ? manualValue(null, primary) : undefined;
      const selected = own ?? common;
      if (selected !== undefined) manual = true;
      return [input, selected ?? (automatic ? String(automatic[input]) : '')];
    })) as Record<typeof quotationPriceInputs[number], string>;
    const supply = positivePrice(values.supplyPrice), sale = positivePrice(values.salePrice);
    const msrp = values.msrp.trim() ? positivePrice(values.msrp) : null;
    let calculation: EffectiveGridCalculation | null = null;
    let error = row.included ? result?.error ?? (!automatic ? '원가와 구성 수량을 확인해주세요.' : null) : null;
    if (row.included && automatic && !error) {
      if (supply === null || sale === null) error = '공급가와 판매가에 양수의 정수 금액을 입력해주세요.';
      else if (sale < supply) error = '판매가는 공급가보다 작을 수 없습니다.';
      else if (values.msrp.trim() && msrp === null) error = '권장소비자가에 양수의 정수 금액을 입력해주세요.';
      else {
        const marginKrw = supply - automatic.costKrw;
        calculation = { ...automatic, supplyPrice: supply, salePrice: sale, msrp, marginKrw, actualMargin: marginKrw / supply * 100 };
      }
    }
    return [row.id, { supply: values.supplyPrice, sale: values.salePrice, msrp: values.msrp, calculation, manual, error }];
  }));
}
