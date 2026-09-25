'use client';
import { quotationKeywordPlan } from '@/app/quotation-keywords';

export function QuotationKeywordReview({ value, onApply }: { value: string; onApply: (value: string) => void }) {
  const plan = quotationKeywordPlan(value);
  return <aside className="panel-note" aria-label="견적서 검색태그 길이 확인"><div>
    <p>견적서 검색태그: {plan.currentLength} / 150자 · 태그별 최대 20자</p>
    {plan.omitted.length > 0 && <details><summary>검색어 정리안 검토 · 제외 {plan.omitted.length}개</summary>
      <p>입력한 순서대로 전체 검색어를 선택합니다. 긴 검색어를 잘라 새 단어로 만들지 않습니다. 적용 후 SEO 저장을 눌러야 견적서 자동값에 반영됩니다. 견적서에서 직접 수정한 검색태그는 유지됩니다.</p>
      <p><strong>적용할 검색어 ({plan.resultLength}자)</strong>: {plan.kept.join(', ') || '(없음)'}</p>
      <ul>{plan.omitted.map((item,index)=><li key={index}>{item.value} · {item.reason}</li>)}</ul>
      <button type="button" className="btn ghost" disabled={!plan.kept.length} onClick={()=>onApply(plan.kept.join('\n'))}>검토한 정리안을 SEO 입력에 적용</button>
    </details>}
  </div></aside>;
}
