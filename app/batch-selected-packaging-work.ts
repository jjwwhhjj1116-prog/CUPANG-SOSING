import type { QuotationFieldsView } from '@/app/quotation-schema';
import { quotationValueIssues, validateQuotationChanges } from '@/app/quotation-schema';
import { isQuotationPackagingField, quotationPackagingDraftInputsForChanges, validateQuotationPackagingDraftInputs } from '@/app/quotation-packaging-basis';
import { quotationPackagedWeightEditChanges, quotationPackagedWeightVisibleFields } from '@/app/quotation-packaged-weight';
import { PACKAGING_DRAFT_MODEL, quotationPackagingDraftChanges, quotationPackagingDraftInputs, type PackagingDraftResult } from '@/app/quotation-packaging-draft';
import { confirmQuotationFieldsSave } from '@/app/quotation-fields-confirmation';
import { readCategoryJsonResponse } from '@/app/load-category-profiles';

type Controls = { view: QuotationFieldsView; signal: AbortSignal; fetcher: typeof fetch; assertCurrent: () => void | Promise<void>; profileId?: string | null };
export type SelectedPackagingWorkResult = { view: QuotationFieldsView; status: 'draft' | 'unchanged' | 'incomplete'; changed: number;
  estimated: number; fallback: number; remaining: number; recovered: boolean; message: string };
const invalid = () => Error('포장 초안의 상품·옵션·카테고리 저장 범위를 확인하지 못했습니다. 기존 값을 유지했습니다.');
function missing(view: QuotationFieldsView) {
  const fields = view.resolved.schema.fields;
  return view.resolved.rows.filter(row => row.included && row.optionId !== null).flatMap(row =>
    quotationPackagedWeightVisibleFields(fields, id => row.fields[id]?.value ?? '').filter(field => isQuotationPackagingField(fields, field.id)).flatMap(field => {
      const cell = row.fields[field.id]; if (!cell || typeof cell.value !== 'string' || typeof cell.source !== 'string') throw invalid();
      return !cell.value.trim() || cell.validationIssues?.length || quotationValueIssues(field, cell.value).length
        ? [{ optionId: row.optionId, label: field.label, draftable: !cell.value.trim() && !cell.source.startsWith('manual-') }] : [];
    }));
}

/** Only an explicit selected-work request may call this adapter. Its caller
 * must retain a once/pending ledger across retries: generation is one request,
 * never replayed here. A lost save ACK is proved by one read, not another PUT. */
export async function runSelectedPackagingWork(productId: string, controls: Controls): Promise<SelectedPackagingWorkResult> {
  const { signal, fetcher } = controls, before = structuredClone(controls.view), scope = { optionId: null, applyToAllOptions: true };
  const current = async () => { signal.throwIfAborted(); await controls.assertCurrent(); signal.throwIfAborted(); };
  await current();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(productId) || !before?.categoryContext || !Array.isArray(before.resolved?.schema?.fields)
    || !Array.isArray(before.resolved.rows) || !before.resolved.rows.some(row => row.included && row.optionId !== null)
    || !Number.isSafeInteger(before.revision) || before.revision < 0 || !/^[a-f0-9]{64}$/.test(before.inputFingerprint)) throw invalid();
  const profileId = controls.profileId === undefined ? before.categoryContext.source === 'profile' ? before.categoryContext.profileId : null : controls.profileId;
  if (profileId !== null && (!/^[A-Za-z0-9_-]{1,100}$/.test(profileId) || profileId !== before.categoryContext.profileId)) throw invalid();
  const base = `/api/products/${encodeURIComponent(productId)}`, endpoint = base + '/quotation-fields' + (profileId ? `?profileId=${encodeURIComponent(profileId)}` : '');
  const request = async <T>(url: string, method: 'POST' | 'PUT' | 'GET', body?: unknown) => {
    await current();
    const response = await fetcher(url, { method, signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    await current();
    if (response.redirected || response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400) throw Error('포장 초안 응답이 다른 화면으로 이동했습니다. 로그인 상태를 확인해주세요.');
    const value = await readCategoryJsonResponse<T & { error?: string }>(response, `포장 초안 ${method === 'POST' ? '작성' : method === 'PUT' ? '저장' : '저장 확인'}`);
    await current(); if (!response.ok) throw Error(value.error || `포장 초안 요청 실패 [HTTP ${response.status}].`); return value;
  };
  const outcome = (view: QuotationFieldsView, result?: PackagingDraftResult, recovered = false): SelectedPackagingWorkResult => {
    const remaining = missing(view).length, changed = result?.proposals.length ?? 0, estimated = result?.proposals.filter(row => row.origin === 'ai-estimate').length ?? 0,
      fallback = result?.proposals.filter(row => row.origin === 'couplus-fallback').length ?? 0;
    const message = (changed ? `포장 규격 ${changed}개를 견적 초안에 저장했습니다.${estimated ? ` AI 추정 ${estimated}개.` : ''}${fallback ? ` 쿠플러스 방식 기본 초안 ${fallback}개.` : ''}${estimated || fallback ? ' 추정·기본 초안은 실측값이 아닙니다.' : ''}`
      : '새로 저장할 포장 규격 초안이 없어 기존 값을 유지했습니다.')
      + (remaining ? ` 포장 항목 ${remaining}개는 추정 근거 또는 저장값 검토가 남아 완료되지 않았습니다. 7단계 포장 규격 초안에서 사유와 원문을 확인할 수 있습니다.` : '')
      // The interactive panel's apply/save instruction does not describe this
      // adapter's already-confirmed save. Keep every evidence/failure warning.
      + (result?.warnings.length ? ' ' + result.warnings.filter(value => value !== '포장 초안의 추정값은 실측 정보가 아닙니다. 확인·수정한 뒤 입력란에 적용하고 저장해주세요.').join(' ') : '')
      + (recovered ? ' 응답이 확인되지 않은 저장은 재전송 없이 저장본과 출처를 대조했습니다.' : '');
    return { view, status: remaining ? 'incomplete' : changed ? 'draft' : 'unchanged', changed, estimated, fallback, remaining, recovered, message };
  };
  if (!missing(before).some(item => item.draftable)) return outcome(before);
  const result = await request<PackagingDraftResult>(base + '/quotation-packaging-draft', 'POST', { action: 'generate', profileId,
    expectedRevision: before.revision, expectedInputFingerprint: before.inputFingerprint, ...scope });
  const proposed = quotationPackagingDraftChanges(before, result, productId, scope);
  if (![0, 1].includes(result.aiRequests) || result.model !== (result.aiRequests ? PACKAGING_DRAFT_MODEL : null)
    || result.proposals.some(item => item.origin === 'ai-estimate' && result.aiRequests !== 1)
    || !Array.isArray(result.warnings) || result.warnings.length > 100 || result.warnings.some(value => typeof value !== 'string' || value.length > 2000)) throw invalid();
  if (!proposed.length) return outcome(before, result);
  const fields = before.resolved.schema.fields;
  const changes = validateQuotationChanges(quotationPackagedWeightEditChanges(fields, proposed), { schema: before.resolved.schema,
    optionIds: before.resolved.rows.flatMap(row => row.optionId === null ? [] : [row.optionId]), ownedImageKeys: before.imageKeys, overrides: before.overrides });
  const drafts = validateQuotationPackagingDraftInputs(quotationPackagingDraftInputsForChanges(quotationPackagingDraftInputs(before, result, productId, scope), fields, changes),
    fields, before.optionPackQuantities ?? {}, changes);
  const confirm = (saved: QuotationFieldsView) => confirmQuotationFieldsSave(before, saved, changes, undefined, drafts);
  let saved: QuotationFieldsView, recovered = false;
  try {
    saved = confirm(await request<QuotationFieldsView>(endpoint, 'PUT', { expectedRevision: before.revision, expectedInputFingerprint: before.inputFingerprint,
      changes, ...(drafts.length ? { packagingDrafts: drafts } : {}) }));
  } catch (cause) {
    await current();
    try { saved = confirm(await request<QuotationFieldsView>(endpoint, 'GET')); recovered = true; }
    catch { throw cause; }
  }
  await current(); return outcome(saved, result, recovered);
}
