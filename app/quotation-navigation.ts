import type { QuotationFieldsView } from './quotation-schema';

export type QuotationNavigationTarget = { optionId: string | null; fieldId: string; categoryId?: string | null };

// Resolve against freshly loaded data: a stale review must never select another option.
export function resolveQuotationNavigation(resolved: QuotationFieldsView['resolved'], target: QuotationNavigationTarget) {
  if (target.categoryId !== undefined && target.categoryId !== resolved.schema.categoryId) return { ok: false as const, message: '검사 당시 카테고리와 현재 견적 카테고리가 다릅니다. 분류를 확인하고 다시 검사해주세요.' };
  const row = resolved.rows.find(item => item.optionId === target.optionId);
  if (!row) return { ok: false as const, message: '검사한 옵션이 현재 견적에 없습니다. 옵션 구성을 확인하고 등록 준비 검사를 다시 실행해주세요.' };
  const field = resolved.schema.fields.find(item => item.id === target.fieldId);
  if (!field) return { ok: false as const, message: '검사한 항목이 현재 카테고리 양식에 없습니다. 선택한 양식을 확인하고 등록 준비 검사를 다시 실행해주세요.' };
  return { ok: true as const, optionId: row.optionId, fieldId: field.id, section: field.section,
    message: `${row.optionLabel} · ${field.label} 항목을 열었습니다.${row.included ? '' : ' 현재 견적에서 제외된 옵션입니다.'}${field.readOnly ? ' 자동 연동 항목이므로 원본 단계에서 수정해주세요.' : ''}` };
}
