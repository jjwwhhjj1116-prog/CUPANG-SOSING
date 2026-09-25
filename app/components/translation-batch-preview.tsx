'use client';

import type { ProductContent } from '@/app/product-content';
import type { TranslationJob } from '@/app/automation/translation';
import { translationBatchAdoption } from '@/app/translation-batch-adoption';

export function TranslationBatchPreview({ content, job, version, disabled, onApply }: {
  content: ProductContent; job: TranslationJob; version: string; disabled: boolean;
  onApply: (input: NonNullable<ReturnType<typeof translationBatchAdoption>['input']>) => void;
}) {
  let plan: ReturnType<typeof translationBatchAdoption>;
  try { plan = translationBatchAdoption(content, job, version); }
  catch (cause) { return <p role="status">{cause instanceof Error ? cause.message : '자동작성 내용을 확인할 수 없습니다.'}</p>; }
  return <fieldset disabled={disabled} aria-label="번역 결과 한번에 적용">
    <legend>SEO · 한글 표시사항 한번에 적용</legend>
    <p>직접 수정한 값은 공란도 유지합니다. 표시사항은 번역된 상품 속성과 항목명이 정확히 일치할 때 연결합니다. 저장 후 해당 항목은 카테고리별 견적서에 연동되며, 견적서에서 직접 수정한 값은 유지됩니다.</p>
    {plan.preview.length ? <table><thead><tr><th>항목</th><th>현재 값</th><th>저장할 값</th></tr></thead><tbody>{plan.preview.map(row => <tr key={row.name}><th>{row.name}</th><td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.before || '(공란)'}</td><td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.after}</td></tr>)}</tbody></table> : <p>자동으로 적용할 새 항목이 없습니다. 직접 수정한 항목은 아래 개별 적용에서 변경할 수 있습니다.</p>}
    {plan.skipped.length > 0 && <details><summary>유지하거나 연결하지 않은 항목 · {plan.skipped.length}개</summary><ul>{plan.skipped.map((text, index) => <li key={index}>{text}</li>)}</ul></details>}
    <button className="btn blue" type="button" disabled={disabled || !plan.input} onClick={() => { if (plan.input) onApply(plan.input); }}>검토한 {plan.preview.length}개 항목 한번에 저장</button>
    <small>새 AI 호출 없이 저장합니다. 옵션·이미지는 별도 작업이며 Supplier Hub로 전송하지 않습니다.</small>
  </fieldset>;
}
