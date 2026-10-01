import type { CollectionSourceGap } from '@/app/collection-source-gaps';
import type { SubmissionIssue } from '@/app/submission-review';

/** These reminders describe missing supplier evidence, not missing manual cells.
 * They never overwrite a user's values or claim that a generated draft is verified. */
export function collectionSourceReview(gaps: readonly CollectionSourceGap[] = []): SubmissionIssue[] {
  return gaps.map(gap => ({ kind: 'review', code: 'COLLECTION_SOURCE_GAP', optionId: null,
    optionLabel: '상품 공통', fieldId: gap.fieldId,
    message: `${gap.label}: 1688 옵션 조회 원문에 포함되지 않은 항목입니다. 직접 작성하거나 생성한 초안을 실제 상품과 대조해주세요.`,
  }));
}
