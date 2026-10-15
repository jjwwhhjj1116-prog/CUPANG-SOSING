'use client';

import { useState } from 'react';
import type { ResolvedQuotation } from '@/app/quotation-schema';
import { quotationExposedAttributeComparison } from '@/app/quotation-exposed-duplicates';
import { optionRegistrationLabel } from '@/app/product-registration';

/** Comparison is draft-aware but performs no save. Only the selected group is
 * expanded, bounding the DOM even for 200 options with many form attributes. */
export function QuotationExposedDuplicates({ resolved, readValue, numbers, disabled, onOpen }: {
  resolved: ResolvedQuotation; readValue: (optionId: string, fieldId: string) => string;
  numbers?: Record<string, string>; disabled: boolean;
  onOpen: (optionId: string, fieldId: string) => void;
}) {
  const [selection, setSelection] = useState('');
  const comparison = quotationExposedAttributeComparison(resolved, readValue);
  if (comparison.status !== 'compared' || !comparison.groups.length) return null;
  const key = (group: { optionIds: string[] }) => JSON.stringify(group.optionIds);
  const group = comparison.groups.find(item => key(item) === selection) ?? comparison.groups[0];
  const labels = new Map(resolved.rows.map(row => [row.optionId, row.optionLabel]));
  const fields = new Map(comparison.fields.map(field => [field.fieldId, field.label]));
  const label = (id: string) => optionRegistrationLabel(id, labels.get(id) ?? id, numbers);
  return <details className="quotation-fields-notice" open aria-label="노출 속성 중복 비교">
    <summary>노출 속성이 같은 옵션 · {comparison.groups.length}개 그룹 · {comparison.groups.reduce((sum, item) => sum + item.optionIds.length, 0)}개 옵션</summary>
    <p>견적에 포함한 옵션의 현재 노출 속성을 비교했습니다. 미저장 수정도 반영합니다. 실제 상품의 구분값이 빠졌는지 확인하고 해당 옵션을 수정하세요.</p>
    <label className="field"><span>비교할 옵션 그룹</span><select aria-label="비교할 중복 속성 그룹" value={key(group)} disabled={disabled} onChange={event => {
      if (!disabled && comparison.groups.some(item => key(item) === event.target.value)) setSelection(event.target.value);
    }}>{comparison.groups.map((item, index) => <option key={key(item)} value={key(item)}>{index + 1}. {label(item.optionIds[0])} 외 {item.optionIds.length - 1}개</option>)}</select></label>
    <div className="quote-actions">{group.optionIds.map(id => <button type="button" className="btn ghost" key={id} disabled={disabled} onClick={() => {
      if (!disabled) onOpen(id, comparison.fields[0].fieldId);
    }}>{label(id)} 노출 속성 수정</button>)}</div>
    <div className="quotation-fields-bulk-table"><table><thead><tr><th>노출 속성</th><th>공통으로 입력된 값</th></tr></thead><tbody>{group.values.map(item => <tr key={item.fieldId}>
      <th scope="row">{fields.get(item.fieldId)}</th><td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.value === '' ? '(공란)' : item.value}</td>
    </tr>)}</tbody></table></div>
  </details>;
}
