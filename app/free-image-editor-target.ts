import type { FreeImageRole } from '@/app/free-image-translation';
import type { FreeImageQuotationRequest } from '@/app/free-image-translation-client';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { exactPrimaryQuotationTarget } from '@/app/quotation-seo-targets';
import { quotationImageKeys } from '@/app/quotation-image-targets';
import { readCategoryJsonResponse } from '@/app/load-category-profiles';

type QuotationContext = Pick<FreeImageQuotationRequest, 'profileId' | 'optionId' | 'input'>;
type EditorSelection = { productId: string; productVersion: string; sourceKey: string; role: FreeImageRole;
  profileId?: string | null; context?: QuotationContext };
export const isSavedFreeImageResult = (productId: string, key: string) =>
  key.split('/').at(-1)?.startsWith(`free-image-${productId}-`) === true;

/** Discover a unique current quotation slot, never infer it from a filename or
 * a historical edit document. The existing image endpoint rechecks the slot,
 * owner, company and immutable document before returning original pixels. */
export async function readSavedFreeImageQuotationTarget(selection: EditorSelection, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<FreeImageQuotationRequest> {
  signal.throwIfAborted();
  const { productId, productVersion, sourceKey, role, context } = selection;
  const input = role === 'main' ? 'mainImage' : role === 'additional' ? 'additionalImages' : role === 'detail' ? 'detailImages' : null;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(productId) || !isSavedFreeImageResult(productId, sourceKey) || !input || context && context.input !== input)
    throw Error('저장된 편집 이미지의 현재 옵션과 역할을 선택해주세요.');
  const profileId = context ? context.profileId : selection.profileId;
  if (profileId != null && !/^[A-Za-z0-9_-]{1,100}$/.test(profileId)) throw Error('현재 카테고리 양식을 확인해주세요.');
  const response = await fetcher(`/api/products/${encodeURIComponent(productId)}/quotation-fields${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`, { signal, cache: 'no-store' });
  const view = await readCategoryJsonResponse<QuotationFieldsView & { error?: string }>(response, '저장 이미지 견적 연결 조회 [GET /api/products/:id/quotation-fields]'); signal.throwIfAborted();
  if (!response.ok) throw Error(view.error || '저장된 이미지의 현재 견적 연결을 확인하지 못했습니다.');
  if (view.productVersion !== productVersion || !Array.isArray(view.imageKeys) || !view.imageKeys.includes(sourceKey)
    || !Number.isSafeInteger(view.revision) || view.revision < 0 || !Number.isSafeInteger(view.optionRevision) || view.optionRevision < 0
    || typeof view.inputFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(view.inputFingerprint)
    || !view.categoryContext || profileId != null && view.categoryContext.profileId !== profileId
    || !Array.isArray(view.resolved?.schema?.fields) || !Array.isArray(view.resolved?.rows))
    throw Error('상품·카테고리 또는 저장 버전이 변경됐습니다. 최신 저장본에서 다시 선택해주세요.');
  const target = exactPrimaryQuotationTarget(view.resolved.schema.fields, input);
  if (target.fields.some(field => field.readOnly)) throw Error('현재 견적 이미지 항목은 편집할 수 없습니다.');
  const matches: { optionId: string; value: string; slotIndex: number }[] = [];
  for (const row of view.resolved.rows) {
    if (!row.included || row.optionId === null || context && row.optionId !== context.optionId) continue;
    const value = row.fields?.[target.primary]?.value;
    if (typeof value !== 'string' || !quotationImageKeys(value).includes(sourceKey)) continue;
    const keys = quotationImageKeys(value);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(row.optionId) || value.length > 16000 || target.linked.some(id => row.fields[id]?.value !== value)
      || keys.length > 30 || new Set(keys).size !== keys.length || keys.some(key => !view.imageKeys.includes(key)) || input === 'mainImage' && keys.length !== 1)
      throw Error('현재 옵션의 이미지 연결이 일치하지 않습니다. 옵션별 편집 화면에서 확인해주세요.');
    matches.push({ optionId: row.optionId, value, slotIndex: keys.indexOf(sourceKey) });
  }
  if (matches.length !== 1) throw Error(matches.length ? '이 이미지를 사용하는 옵션이 여러 개입니다. 옵션별 이미지에서 편집할 대상을 선택해주세요.' : '이 이미지는 선택한 역할의 현재 옵션 이미지가 아닙니다. 옵션별 이미지에서 저장본을 선택해주세요.');
  if (input === 'detailImages' && (!Array.isArray(view.protectedDetailImageKeys) || view.protectedDetailImageKeys.includes(sourceKey)))
    throw Error('상단·하단 설정 이미지는 유지합니다. 현재 옵션의 본문 이미지를 선택해주세요.');
  return { kind: 'quotation', profileId: context ? context.profileId : profileId ?? view.categoryContext.profileId,
    input, fieldKey: target.primary, ...matches[0], revision: view.revision, inputFingerprint: view.inputFingerprint, optionRevision: view.optionRevision };
}
