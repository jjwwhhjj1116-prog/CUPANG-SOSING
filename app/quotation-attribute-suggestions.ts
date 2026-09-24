import type { TranslationJob } from '@/app/automation/translation';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { loadAttributeRules } from '@/app/quotation-attribute-rules';
import { canMapTranslatedAttribute, quotationTranslationDraft, type AttributeMapping } from '@/app/quotation-translation-adoption';

/** First-use suggestions are limited to exact category product attributes, not legal or commercial defaults. */
export function suggestCategoryAttributes(productId: string, view: QuotationFieldsView, job: TranslationJob, optionId: string | null) {
  const mappings: AttributeMapping[] = [], skipped: string[] = [];
  const attributes = job.result?.draft.attributes ?? [];
  const fields = view.resolved.schema.fields.filter(field => field.section === 'product' && field.visibility !== 'common' && canMapTranslatedAttribute(field));
  for (const attribute of attributes) {
    if (!job.review.source.attributes[attribute.sourceIndex]?.name.startsWith('상품속성: ')) continue;
    const name = attribute.name.trim();
    const candidates = fields.filter(field => field.label === name);
    if (!candidates.length) continue;
    if (candidates.length !== 1 || attributes.filter(item => item.name.trim() === name).length !== 1) {
      skipped.push(`${name}: 같은 이름이 여러 개여서 자동 연결하지 않았습니다.`); continue;
    }
    const mapping = { sourceIndex: attribute.sourceIndex, fieldId: candidates[0].id };
    try {
      quotationTranslationDraft(productId, view, job, optionId, [mapping]);
      mappings.push(mapping);
    } catch (cause) { skipped.push(`${name}: ${cause instanceof Error ? cause.message : '자동 연결 불가'}`); }
  }
  return { mappings, skipped };
}

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
    if (body.rules === null) {
      const result = suggestCategoryAttributes(productId, view, job, optionId);
      return { mapping: Object.fromEntries(result.mappings.map(item => [item.sourceIndex, item.fieldId])), revision: 0, skipped: result.skipped,
        message: `저장된 카테고리 규칙이 없어 이름이 정확히 같은 상품 속성 ${result.mappings.length}개를 자동 선택했습니다. 변경 전·후 값을 확인한 뒤 초안에 반영하거나 연결 규칙을 저장해주세요.` };
    }
    const result = loadAttributeRules(JSON.stringify(body.rules), productId, view, job, optionId);
    return { mapping: Object.fromEntries(result.mappings.map(item => [item.sourceIndex, item.fieldId])), revision: body.revision!, skipped: result.skipped,
      message: `저장된 카테고리 규칙 v${body.revision}으로 ${result.mappings.length}개 연결을 자동 선택했습니다. 변경 전·후 값을 확인한 뒤 견적 초안에 반영해주세요.` };
  } catch (cause) {
    return { ...empty, message: `번역 결과는 불러왔지만 연결 규칙은 적용하지 못했습니다. ${cause instanceof Error ? cause.message : '서버 규칙을 다시 조회해주세요.'}` };
  }
}
