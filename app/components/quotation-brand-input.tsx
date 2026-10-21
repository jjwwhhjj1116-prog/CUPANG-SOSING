'use client';
import type { ResolvedQuotationField } from '@/app/quotation-schema';

/** UI tokens are local. Selecting Brand None explicitly stages the empty
 * string; rendering the control never converts an old value or writes data. */
export function QuotationBrandInput({ cell, brands, id, disabled, invalid, onChange }: {
  cell: ResolvedQuotationField; brands: readonly string[]; id: string; disabled: boolean;
  invalid?: boolean; onChange: (value: string) => void;
}) {
  const choices = Array.isArray(brands) && brands.length <= 500 && brands.every(brand => typeof brand === 'string' && brand.length <= 500)
    ? brands.filter(brand => brand.trim() !== '') : [];
  const selected = choices.findIndex(brand => brand === cell.value);
  const value = cell.value === '' ? 'none' : selected >= 0 ? `brand-${selected}` : 'retained';
  return <select id={id} disabled={disabled} aria-invalid={invalid} aria-describedby={`${id}-notes`} value={value} onChange={event => {
    if (disabled) return;
    if (event.target.value === 'none') onChange('');
    else {
      const index = choices.findIndex((_, at) => event.target.value === `brand-${at}`);
      if (index >= 0) onChange(choices[index]);
    }
  }}>
    <option value="none">브랜드 없음</option>
    {value === 'retained' && <option value="retained">{cell.value} · 기존 입력</option>}
    {choices.map((brand, index) => <option key={index} value={`brand-${index}`}>{brand}</option>)}
  </select>;
}
