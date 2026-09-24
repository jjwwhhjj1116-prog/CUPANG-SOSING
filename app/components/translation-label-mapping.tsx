'use client';
import { useState } from 'react';
import type { TranslationJob } from '@/app/automation/translation';
import { labelFields, type LabelField, type ProductContent } from '@/app/product-content';
import { translationLabelAdoption, type TranslationLabelMapping } from '@/app/translation-label-adoption';

export function TranslationLabelMappingEditor({ content, job, version, disabled, onApply }: {
  content: ProductContent; job: TranslationJob; version: string; disabled: boolean;
  onApply: (mappings: TranslationLabelMapping[]) => void;
}) {
  const [mapping, setMapping] = useState<Record<number, LabelField | ''>>({});
  const attributes = job.result?.draft.attributes.filter(item => job.review.source.attributes[item.sourceIndex]?.name.startsWith('상품속성: ')) ?? [];
  if (!attributes.length) return null;
  const selected = Object.entries(mapping).filter(([, field]) => field).map(([index, field]) => ({ sourceIndex: Number(index), field: field as LabelField }));
  let plan: ReturnType<typeof translationLabelAdoption> | null = null, error = '';
  if (selected.length) {
    try { plan = translationLabelAdoption(content, job, version, selected); }
    catch (cause) { error = cause instanceof Error ? cause.message : '연결 항목을 확인해주세요.'; }
  }
  return <details className="panel-stack"><summary>번역한 상품 속성을 한글 표시사항에 연결</summary>
    <p>원문과 번역값을 확인하고 연결할 항목을 선택하세요. 직접 수정한 값과 공란은 보존합니다. 이 작업은 추가 AI 호출 없이 저장된 번역을 사용합니다.</p>
    <fieldset disabled={disabled}>
      {attributes.map(attribute => <label key={attribute.sourceIndex}>
        {attribute.name} · {attribute.value}
        <small style={{ display: 'block', whiteSpace: 'pre-wrap' }}>원문: {job.review.source.attributes[attribute.sourceIndex].value}</small>
        <select aria-label={`${attribute.name} 표시사항 연결`} value={mapping[attribute.sourceIndex] ?? ''} onChange={event => setMapping(previous => ({ ...previous, [attribute.sourceIndex]: event.target.value as LabelField | '' }))}>
          <option value="">연결하지 않음</option>
          {(Object.keys(labelFields) as LabelField[]).map(field => <option key={field} value={field} disabled={content.label[field]?.provenance === 'manual'}>{labelFields[field]}{content.label[field]?.provenance === 'manual' ? ' · 직접 수정값 보존' : ''}</option>)}
        </select>
      </label>)}
      {error && <p role="alert">{error}</p>}
      {plan && <table><thead><tr><th>표시사항</th><th>현재값</th><th>적용할 번역값</th></tr></thead><tbody>{plan.preview.map(item => <tr key={item.field}><td>{item.name}</td><td style={{whiteSpace:'pre-wrap'}}>{item.before || '(공란)'}</td><td style={{whiteSpace:'pre-wrap'}}>{item.after}</td></tr>)}</tbody></table>}
      <button type="button" className="btn" disabled={!plan || disabled} onClick={() => { if (plan && !disabled) onApply(selected); }}>변경값 확인 · 선택한 표시사항 함께 저장</button>
    </fieldset>
    <small>저장된 값은 한글 라벨 생성과 연결된 카테고리 견적 항목에 사용됩니다. 기존 라벨 이미지는 다시 생성해야 하며, 견적서 직접 수정값은 유지됩니다.</small>
  </details>;
}
