import type { SubmissionReview } from '@/app/submission-review';

export type PackageReview = Pick<SubmissionReview, 'productId' | 'categoryId' | 'issues' | 'errorCount' | 'reviewCount' | 'omittedIssueCount' | 'submissionReady' | 'transport'> & { inputFingerprint: string };

/** Bind the byte-level report to exactly the package preview being displayed. */
export function validatePackageReview(value: unknown, productId: string, categoryId: string | null, fingerprint: string): PackageReview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('첨부 검사 결과가 없습니다. 자료를 다시 준비해주세요.');
  const report = value as Record<string, unknown>;
  if (report.productId !== productId || report.categoryId !== categoryId || report.inputFingerprint !== fingerprint
    || !/^[a-f0-9]{64}$/.test(fingerprint) || report.submissionReady !== false || report.transport !== 'not-connected') throw new Error('첨부 검사 결과와 준비한 견적서가 다릅니다. 자료를 다시 준비해주세요.');
  validateIssueCounts(report);
  return value as PackageReview;
}

function validateIssueCounts(report: Record<string, unknown>) {
  const invalid = () => { throw new Error('검사 항목 또는 항목 수가 일치하지 않습니다. 다시 검사해주세요.'); };
  if (!Array.isArray(report.issues) || report.issues.length > 1000
    || !['errorCount','reviewCount','omittedIssueCount'].every(key => typeof report[key] === 'number' && Number.isSafeInteger(report[key]) && report[key] >= 0)) return invalid();
  let errors = 0, reviews = 0;
  for (const item of report.issues) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return invalid();
    const issue = item as Record<string, unknown>;
    if (!['error','review'].includes(String(issue.kind)) || typeof issue.code !== 'string' || typeof issue.message !== 'string'
      || typeof issue.optionLabel !== 'string' || (issue.optionId !== null && typeof issue.optionId !== 'string')
      || (issue.fieldId !== null && typeof issue.fieldId !== 'string')) return invalid();
    if (issue.kind === 'error') errors++; else reviews++;
  }
  const errorCount = report.errorCount as number, reviewCount = report.reviewCount as number;
  if (!Number.isSafeInteger(errorCount + reviewCount) || errors > errorCount || reviews > reviewCount
    || errorCount + reviewCount - report.issues.length !== report.omittedIssueCount) return invalid();
}

/** Validate the requested identity and bounded report before rendering any totals. */
export function validateSubmissionReviewResponse(value: unknown, productId: string, profileId: string | null): SubmissionReview {
  const invalid = () => { throw new Error('검사 응답의 상품·카테고리 또는 항목 수가 일치하지 않습니다. 다시 검사해주세요.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const report = value as Record<string, unknown>;
  if (report.productId !== productId || report.requestedProfileId !== profileId
    || typeof report.title !== 'string' || typeof report.sourceUrl !== 'string'
    || (report.categoryId !== null && typeof report.categoryId !== 'string')
    || !Array.isArray(report.categoryPath) || !report.categoryPath.every(part => typeof part === 'string')
    || typeof report.checkedAt !== 'string' || !Number.isFinite(Date.parse(report.checkedAt))
    || typeof report.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(report.fingerprint)
    || report.submissionReady !== false || report.transport !== 'not-connected'
    || !Array.isArray(report.limits) || !report.limits.every(item => typeof item === 'string')
    || !Array.isArray(report.issues) || report.issues.length > 1000
    || !['includedOptions','errorCount','reviewCount','omittedIssueCount'].every(key => typeof report[key] === 'number' && Number.isSafeInteger(report[key]) && report[key] >= 0)) return invalid();
  validateIssueCounts(report);
  return value as SubmissionReview;
}
