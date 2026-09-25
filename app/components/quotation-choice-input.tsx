'use client';
import type { QuotationField, ResolvedQuotationField } from '@/app/quotation-schema';

/** UI tokens never reach the quotation API. Explicit empty choices stay empty strings. */
export function QuotationChoiceInput({ field, cell, id, disabled, invalid, onChange }: {
  field: QuotationField; cell: ResolvedQuotationField; id: string; disabled: boolean; invalid?: boolean; onChange: (value: string) => void;
}) {
  const choices = field.choices ?? [];
  const index = choices.findIndex(choice => choice.value === cell.value);
  const missing = cell.value === '' && cell.source === 'empty';
  const value = missing || (cell.value === '' && index < 0) ? 'unset' : index >= 0 ? `choice-${index}` : 'legacy';
  return <select id={id} disabled={disabled} aria-invalid={invalid} aria-describedby={`${id}-notes`} value={value} onChange={event => {
    const token = event.target.value;
    const selected = choices.find((_, i) => token === `choice-${i}`);
    if (selected) onChange(selected.value);
    else if (token === 'unset' && !choices.some(choice => choice.value === '')) onChange('');
  }}>
    <option value="unset" disabled={choices.some(choice => choice.value === '')}>선택하지 않음 · 미입력</option>
    {value === 'legacy' && <option value="legacy">{cell.value} · 목록 외 저장값</option>}
    {choices.map((choice, i) => <option key={i} value={`choice-${i}`}>{choice.label}</option>)}
  </select>;
}
