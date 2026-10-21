import { imageMetadata, type ImageEditJob, type ImageEditView } from '@/app/automation/image-edit';
import { isOwnedImageKey, MAX_IMAGE_BYTES } from '@/app/image-files';
import { MainImageSaveError } from '@/app/quotation-main-image';
import { optionImageChanges, optionImageTargets, optionImageValue, quotationImageKeys, verifyOptionImageRecovery, verifyOptionImageRestored } from '@/app/quotation-image-targets';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import type { FreeImageQuotationRequest } from '@/app/free-image-translation-client';

export type AdditionalImageAiTarget = { ownerId: string; productId: string; sourceKey: string; productVersion: string; quotationTarget: FreeImageQuotationRequest; quotationView: QuotationFieldsView };
export type AdditionalImageAiApplyAttempt = { target: AdditionalImageAiTarget; job: ImageEditJob; before: QuotationFieldsView; alreadyApplied?: QuotationFieldsView };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const fail = (): never => { throw Error('AI 결과를 만들 때 선택한 옵션·추가이미지 위치 또는 견적서 저장값이 변경되었습니다. 현재 이미지에서 다시 확인해주세요.'); };
function binding(view: QuotationFieldsView, optionId: string) {
  if (!view || !Number.isSafeInteger(view.revision) || view.revision < 0 || !/^[a-f0-9]{64}$/.test(view.inputFingerprint)
    || !Number.isFinite(Date.parse(view.productVersion)) || ![view.contentRevision, view.optionRevision].every(n => Number.isSafeInteger(n) && n >= 0)
    || !Array.isArray(view.imageKeys) || new Set(view.imageKeys).size !== view.imageKeys.length || !Array.isArray(view.resolved?.schema?.fields)
    || !Array.isArray(view.resolved.rows) || !Array.isArray(view.automatic?.rows) || !view.overrides?.common || !view.overrides.options
    || view.resolved.rows.filter(row => row.optionId === optionId).length !== 1) return fail();
  const target = optionImageTargets(view.resolved.schema.fields).additionalImages;
  const value = optionImageValue(view, optionId, 'additionalImages'), keys = quotationImageKeys(value);
  if (!keys.length || new Set(keys).size !== keys.length || keys.some(key => !view.imageKeys.includes(key))
    || target.fields.some(field => field.readOnly) || target.linked.some(id => optionImageValue(view, optionId, 'additionalImages', {}, id) !== value)) return fail();
  return target;
}
function validateTarget(target: AdditionalImageAiTarget) {
  const { quotationTarget: slot, quotationView: view } = target, result = binding(view, slot.optionId);
  if (!/^\w[\w-]{0,99}$/.test(target.productId) || !isOwnedImageKey(target.ownerId, target.sourceKey) || slot.kind !== 'quotation' || slot.input !== 'additionalImages'
    || !Number.isSafeInteger(slot.slotIndex) || slot.slotIndex < 0 || slot.slotIndex > 29 || quotationImageKeys(slot.value)[slot.slotIndex] !== target.sourceKey
    || slot.value !== optionImageValue(view, slot.optionId, 'additionalImages') || slot.fieldKey !== result.primary || slot.revision !== view.revision
    || slot.inputFingerprint !== view.inputFingerprint || slot.optionRevision !== view.optionRevision || view.productVersion !== target.productVersion
    || slot.profileId !== null && slot.profileId !== view.categoryContext.profileId || !view.imageKeys.includes(target.sourceKey)) return fail();
  return result;
}
function validateJob(target: AdditionalImageAiTarget, job: ImageEditJob) {
  const result = job.result;
  if (job.productId !== target.productId || job.productVersion !== target.productVersion || job.contentRevision !== target.quotationView.contentRevision
    || job.status !== 'completed' || job.error !== null || job.review.sourceKey !== target.sourceKey || job.review.purpose !== 'cleanup'
    || !result?.attached || result.purpose !== 'cleanup' || result.provenance !== 'generated' || result.reviewRequired !== true || result.assignedRole !== false
    || !isOwnedImageKey(target.ownerId, result.storageKey) || result.storageKey === target.sourceKey || target.quotationView.imageKeys.includes(result.storageKey)
    || !/^[a-f0-9]{64}$/.test(job.review.fingerprint) || !/^[a-f0-9]{64}$/.test(result.sha256) || result.mime !== 'image/png') return fail();
  return result;
}
function comparable(view: QuotationFieldsView, optionId?: string, fields: readonly string[] = []) {
  const value = JSON.parse(JSON.stringify(view)) as Record<string, unknown>;
  for (const key of ['productVersion', 'inputFingerprint', 'imageKeys']) delete value[key];
  if (optionId) {
    delete value.revision; delete value.updatedAt;
    const overrides = value.overrides as QuotationFieldsView['overrides'];
    for (const field of fields) delete overrides.options[optionId]?.[field];
    if (overrides.options[optionId] && !Object.keys(overrides.options[optionId]).length) delete overrides.options[optionId];
    const resolved = value.resolved as QuotationFieldsView['resolved'];
    for (const field of fields) delete resolved.rows.find(row => row.optionId === optionId)?.fields[field];
  }
  return value;
}
const endpoint = (target: AdditionalImageAiTarget) => `/api/products/${encodeURIComponent(target.productId)}/quotation-fields${target.quotationTarget.profileId ? `?profileId=${encodeURIComponent(target.quotationTarget.profileId)}` : ''}`;
async function read(target: AdditionalImageAiTarget, request: typeof fetch) {
  const response = await request(endpoint(target), { cache: 'no-store' }), view = await response.json() as QuotationFieldsView & { error?: string };
  if (!response.ok) throw Error(view.error || '최종 추가이미지를 읽지 못했습니다.');
  binding(view, target.quotationTarget.optionId); return view;
}
function replacement(target: AdditionalImageAiTarget, job: ImageEditJob) {
  const keys = quotationImageKeys(target.quotationTarget.value); keys[target.quotationTarget.slotIndex] = validateJob(target, job).storageKey;
  return keys.join('\n');
}
function changes(attempt: AdditionalImageAiApplyAttempt) {
  return optionImageChanges(attempt.before, attempt.target.quotationTarget.optionId, { additionalImages: replacement(attempt.target, attempt.job) });
}
function verifySave(attempt: AdditionalImageAiApplyAttempt, after: QuotationFieldsView) {
  const { target, before } = attempt, fields = validateTarget(target).linked;
  if (!same(binding(before, target.quotationTarget.optionId), binding(after, target.quotationTarget.optionId))) return fail();
  const patch = changes(attempt); verifyOptionImageRecovery(before, after, target.quotationTarget.optionId, patch);
  if (!same(comparable(before, target.quotationTarget.optionId, fields), comparable(after, target.quotationTarget.optionId, fields))) return fail();
}
/** Verify the one completed owned result and current quotation before preparing
 * a single-slot replacement. No provider, upload or source writes occur here. */
export async function prepareAdditionalImageAiApply(target: AdditionalImageAiTarget, selected: ImageEditJob, currentVersion: string, currentKeys: readonly string[], request: typeof fetch = fetch): Promise<AdditionalImageAiApplyAttempt> {
  const fields = validateTarget(target), result = validateJob(target, selected), base = target.quotationView;
  const response = await request(`/api/products/${encodeURIComponent(target.productId)}/image-generation`, { cache: 'no-store' });
  const history = await response.json() as ImageEditView & { error?: string };
  if (!response.ok) throw Error(history.error || '저장된 AI 결과를 확인하지 못했습니다.');
  const matches = history.jobs?.filter(job => job.id === selected.id);
  if (matches?.length !== 1 || !same(matches[0], selected) || history.product?.id !== target.productId || history.product.version !== currentVersion
    || !same(history.product.imageKeys, currentKeys) || !same(currentKeys, [...base.imageKeys, result.storageKey]) || Date.parse(currentVersion) <= Date.parse(target.productVersion)) return fail();
  validateJob(target, matches[0]);
  const before = await read(target, request);
  if (before.productVersion !== currentVersion || !same(before.imageKeys, currentKeys) || !same(binding(before, target.quotationTarget.optionId), fields)) return fail();
  let alreadyApplied: QuotationFieldsView | undefined;
  if (!same(comparable(base), comparable(before))) {
    const rebased = { ...base, imageKeys: before.imageKeys };
    verifySave({ target, job: selected, before: rebased }, before); alreadyApplied = before;
  } else if (optionImageValue(before, target.quotationTarget.optionId, 'additionalImages') !== target.quotationTarget.value) return fail();
  const file = await request(`/api/files/${result.storageKey.split('/').map(encodeURIComponent).join('/')}`, { cache: 'no-store' });
  if (!file.ok || file.redirected || file.headers.get('content-type')?.split(';')[0].trim() !== 'image/png') throw Error('저장된 AI 결과 이미지 파일을 확인하지 못했습니다.');
  const blob = await file.blob(); if (!blob.size || blob.size > MAX_IMAGE_BYTES) throw Error('AI 결과 이미지 용량을 확인해주세요.');
  const metadata = await imageMetadata(new Uint8Array(await blob.arrayBuffer()), 'image/png');
  if (!same(metadata, { mime: result.mime, width: result.width, height: result.height, bytes: result.bytes, sha256: result.sha256 })) throw Error('AI 결과 이미지 파일이 검토한 저장 결과와 다릅니다.');
  return { target, job: selected, before, ...(alreadyApplied ? { alreadyApplied } : {}) };
}
/** A current CAS changes only the selected additional-image slot and its exact
 * linked wire. Unknown writes require explicit read recovery, never a retry. */
export async function applyAdditionalImageAiResult(attempt: AdditionalImageAiApplyAttempt, request: typeof fetch = fetch) {
  validateTarget(attempt.target); validateJob(attempt.target, attempt.job);
  const current = await read(attempt.target, request);
  if (attempt.alreadyApplied) { if (!same(current, attempt.alreadyApplied)) return fail(); return current; }
  if (!same(current, attempt.before)) { verifySave(attempt, current); return current; }
  let response: Response | undefined;
  try {
    const patch = changes(attempt);
    response = await request(endpoint(attempt.target), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: attempt.before.revision, expectedInputFingerprint: attempt.before.inputFingerprint, changes: patch }) });
    const ack = await response.json() as QuotationFieldsView & { error?: string };
    if (!response.ok) throw Error(ack.error || '선택 옵션 추가이미지를 저장하지 못했습니다.');
    verifySave(attempt, ack);
    const saved = await read(attempt.target, request); verifySave(attempt, saved); verifyOptionImageRestored(ack, saved, attempt.target.quotationTarget.optionId, patch);
    if (!same(ack.overrides, saved.overrides) || !same(ack.resolved, saved.resolved)) throw Error('추가이미지 응답과 저장본이 다릅니다.');
    return saved;
  } catch (cause) {
    // Read only: a committed write with a lost ACK can be proved immediately;
    // otherwise the caller retains this exact attempt for explicit recovery.
    try { const saved = await read(attempt.target, request); verifySave(attempt, saved); return saved; } catch { /* Retain uncertainty without another PUT. */ }
    throw new MainImageSaveError(cause instanceof Error ? cause.message : '최종 추가이미지 저장 결과 확인 실패', !response || response.ok || response.status >= 500 || response.status === 429);
  }
}
export async function recoverAdditionalImageAiResult(attempt: AdditionalImageAiApplyAttempt, request: typeof fetch = fetch) {
  validateTarget(attempt.target); validateJob(attempt.target, attempt.job);
  const current = await read(attempt.target, request);
  if (attempt.alreadyApplied) { if (!same(current, attempt.alreadyApplied)) return fail(); return current; }
  verifySave(attempt, current); return current;
}
