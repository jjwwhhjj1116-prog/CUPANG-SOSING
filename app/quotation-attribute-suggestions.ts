import type { TranslationJob } from '@/app/automation/translation';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { loadAttributeRules } from '@/app/quotation-attribute-rules';

/** Read-only suggestions from the user's saved rules; never writes quotation values. */
export async function fetchAttributeSuggestions(productId: string, view: QuotationFieldsView, job: TranslationJob, optionId: string | null, request: typeof fetch = fetch) {
  const empty = { mapping: {} as Record<number, string>, revision: null as number | null, skipped: [] as string[] };
  if (!view.resolved.schema.categoryId || !job.result?.draft.attributes.some(item => job.review.source.attributes[item.sourceIndex]?.name.startsWith('상품속성: '))) {
    return { ...empty, message: '현재 번역 결과에 연결할 상품 속성이 없습니다.' };
  }
  try {
    const response = await request(`/api/quotation-attribute-rules?categoryId=${encodeURIComponent(view.resolved.schema.categoryId)}`, { cache: 'no-store' });
    const body = await response.json() as { error?: string; rules?: unknown; revision?: number };
    if (!response.ok) throw new Error(body.error || '서버 규칙 조회 실패');
    if (!Number.isSafeInteger(body.revision) || body.revision! < 0 || (body.rules === null ? body.revision !== 0 : !body.rules || body.revision === 0)) throw new Error('서버 규칙 응답을 확인하지 못했습니다.');
    if (body.rules === null) return { ...empty, revision: 0, message: '저장된 카테고리 규칙이 없습니다. 연결 항목을 선택하면 서버에 저장할 수 있습니다.' };
    const result = loadAttributeRules(JSON.stringify(body.rules), productId, view, job, optionId);
    return { mapping: Object.fromEntries(result.mappings.map(item => [item.sourceIndex, item.fieldId])), revision: body.revision!, skipped: result.skipped,
      message: `저장된 카테고리 규칙 v${body.revision}으로 ${result.mappings.length}개 연결을 자동 선택했습니다. 변경 전·후 값을 확인한 뒤 견적 초안에 반영해주세요.` };
  } catch (cause) {
    return { ...empty, message: `번역 결과는 불러왔지만 연결 규칙은 적용하지 못했습니다. ${cause instanceof Error ? cause.message : '서버 규칙을 다시 조회해주세요.'}` };
  }
}
