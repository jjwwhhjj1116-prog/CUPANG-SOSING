import type { SubmissionReview } from '@/app/submission-review';
import type { QuotationNavigationTarget } from '@/app/quotation-navigation';
import { QuotationReviewIssues } from '@/app/components/quotation-review-issues';

export type QuotationPreviewReviewData = Pick<SubmissionReview, 'issues' | 'errorCount' | 'reviewCount' | 'omittedIssueCount' | 'limits'>;
export function QuotationPreviewReview({ review, disabled, onInspect }: { review: QuotationPreviewReviewData; disabled: boolean; onInspect: (target: QuotationNavigationTarget) => void }) {
  return <section className="panel-stack" aria-label="견적 출력 전 검사 결과">
    <strong>수정 필요 {review.errorCount}개 · 확인 필요 {review.reviewCount}개</strong>
    <p>현재 저장된 견적과 첨부 파일의 검사 결과입니다. 다운로드는 검토용이며 Supplier Hub 등록 완료를 뜻하지 않습니다.</p>
    <details open={review.errorCount > 0 || review.reviewCount > 0}><summary>옵션별 수정·확인 항목</summary>
      <QuotationReviewIssues issues={review.issues} omittedIssueCount={review.omittedIssueCount} disabled={disabled} onInspect={onInspect}/>
    </details>
    {disabled && <small>저장하지 않은 수정이 있거나 처리 중입니다. 작업을 마친 뒤 항목을 이동해주세요.</small>}
    <details><summary>검사 범위</summary><ul>{review.limits.map(limit => <li key={limit}>{limit}</li>)}</ul></details>
  </section>;
}
