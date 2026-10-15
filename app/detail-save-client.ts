import type { DetailComposite } from '@/app/detail-image-composite';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { applyQuotationChanges } from '@/app/quotation-schema';
import { DETAIL_SAVE_TEXT_POLICY, detailSaveCommonAltText, detailSaveChanges, type DetailSaveReceipt } from '@/app/detail-save-plan';
import { MAX_IMAGE_BYTES, imageFileType } from '@/app/image-files';
import { readBoundedStream } from '@/app/request-body';
import { labelUploadDigest } from '@/app/label-upload-key';

export type DetailSaveAttempt = { pending?: 'upload' | 'save'; key?: string; completed?: QuotationFieldsView; identity?: string };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const changed = () => Error('상세 이미지·옵션·견적서가 변경됐습니다. 미리보기를 보관한 채 최신 저장본을 확인해주세요.');
const path = (input: DetailComposite, action: 'quotation-fields' | 'detail-save') => `/api/products/${encodeURIComponent(input.productId)}/${action}${input.profileId ? `?profileId=${encodeURIComponent(input.profileId)}` : ''}`;
function bindAttempt(input: DetailComposite, attempt: DetailSaveAttempt) {
  const identity = JSON.stringify([DETAIL_SAVE_TEXT_POLICY, input.productId, input.optionId, input.profileId ?? null, input.view, input.keys, input.sources, input.uploadId, input.sha256, input.width, input.height, input.output.size]);
  if (attempt.identity !== undefined && attempt.identity !== identity) throw changed();
  if (attempt.identity === undefined && (attempt.pending || attempt.completed || attempt.key)) throw changed();
  attempt.identity = identity;
}
async function readView(input: DetailComposite, signal: AbortSignal, fetcher: typeof fetch) {
  signal.throwIfAborted(); const response = await fetcher(path(input, 'quotation-fields'), { signal, cache: 'no-store' });
  const body = await response.json() as QuotationFieldsView & { error?: string }; signal.throwIfAborted();
  if (!response.ok) throw Error(body.error || '상세 저장본을 읽지 못했습니다.'); return body;
}
async function digestFile(key: string, signal: AbortSignal, fetcher: typeof fetch) {
  const response = await fetcher(`/api/files/${key.split('/').map(encodeURIComponent).join('/')}`, { signal, cache: 'no-store' });
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw Error('상세 이미지 파일을 확인하지 못했습니다.');
  const bytes = await readBoundedStream(response.body, MAX_IMAGE_BYTES); signal.throwIfAborted();
  return { sha256: await labelUploadDigest(bytes), type: imageFileType(bytes).contentType };
}
async function uploadReceipt(input: DetailComposite, signal: AbortSignal, fetcher: typeof fetch) {
  const response = await fetcher(`/api/files?labelUploadId=${input.uploadId}`, { signal, cache: 'no-store' });
  const body = await response.json() as { key?: string | null; sha256?: string; size?: number; contentType?: string; error?: string }; signal.throwIfAborted();
  if (!response.ok) throw Error(body.error || '상세 이미지 업로드 결과를 읽지 못했습니다.');
  if (body.key === null) return null;
  if (typeof body.key !== 'string' || !body.key.endsWith(`/quotation-label-${input.uploadId}.png`) || body.contentType !== 'image/png'
    || body.sha256 !== input.sha256 || body.size !== input.output.size) throw changed();
  const actual = await digestFile(body.key, signal, fetcher);
  if (actual.sha256 !== input.sha256 || actual.type !== 'image/png') throw changed(); return body.key;
}
function verifySaved(input: DetailComposite, key: string, saved: QuotationFieldsView, receipt: DetailSaveReceipt) {
  const before = input.view, changes = detailSaveChanges(before, key, DETAIL_SAVE_TEXT_POLICY);
  if (receipt.uploadId !== input.uploadId || receipt.key !== key || receipt.sha256 !== input.sha256 || receipt.bytes !== input.output.size
    || receipt.textPolicy !== DETAIL_SAVE_TEXT_POLICY || receipt.textCommonFilled !== !detailSaveCommonAltText(before)
    || receipt.beforeRevision !== before.revision || receipt.revision !== before.revision + 1 || receipt.sourceOptionId !== input.optionId || receipt.categoryId !== before.categoryContext.categoryId
    || !same(receipt.optionIds, before.resolved.rows.flatMap(row => row.optionId ? [row.optionId] : []))
    || saved.revision !== before.revision + 1 || saved.updatedAt !== saved.productVersion || Date.parse(saved.productVersion) <= Date.parse(before.productVersion)
    || !Number.isFinite(Date.parse(saved.productVersion)) || !/^[a-f0-9]{64}$/.test(saved.inputFingerprint) || saved.inputFingerprint === before.inputFingerprint
    || saved.contentRevision !== before.contentRevision || saved.optionRevision !== before.optionRevision
    || !same(saved.categoryContext, before.categoryContext) || !same(saved.resolved.schema, before.resolved.schema)
    || !same(saved.imageKeys, [...before.imageKeys, key]) || !same(saved.protectedDetailImageKeys, before.protectedDetailImageKeys)
    || !same(saved.optionRegistrationNumbers, before.optionRegistrationNumbers) || !same(saved.packagingBasis, before.packagingBasis)
    || !same(saved.optionPackQuantities, before.optionPackQuantities) || !same(saved.legacyOverrides, before.legacyOverrides)
    || !same(saved.detailSaveTextBasis, before.detailSaveTextBasis)
    || !same(saved.overrides, applyQuotationChanges(before.overrides, changes)) || !same(saved.automatic, before.automatic)) throw changed();
  if (!same(saved.resolved.rows.map(row => [row.optionId, row.included]), before.resolved.rows.map(row => [row.optionId, row.included]))) throw changed();
  for (const row of saved.resolved.rows) {
    const rowChanges = changes.filter(value => value.optionId === row.optionId
      || value.optionId === null && !changes.some(specific => specific.optionId === row.optionId && specific.fieldKey === value.fieldKey));
    const prior = before.resolved.rows.find(value => value.optionId === row.optionId)!;
    if (row.optionLabel !== prior.optionLabel || !same(Object.keys(row.fields), Object.keys(prior.fields))
      || rowChanges.some(change => row.fields[change.fieldKey]?.value !== change.value
        || row.fields[change.fieldKey]?.source !== (change.optionId === null ? 'manual-common' : 'manual-option'))) throw changed();
    for (const [id, cell] of Object.entries(prior.fields)) if (!rowChanges.some(change => change.fieldKey === id) && !same(cell, row.fields[id])) throw changed();
  }
}
/** A save whose ACK is missing is checked by reads only; this never retries a write. */
export async function recoverDetailSave(input: DetailComposite, attempt: DetailSaveAttempt, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<'ready' | 'completed'> {
  bindAttempt(input, attempt);
  if (!attempt.pending && !attempt.completed) return 'ready';
  if (attempt.pending === 'upload') {
    const key = await uploadReceipt(input, signal, fetcher);
    if (!same(await readView(input, signal, fetcher), input.view)) throw changed();
    if (key) attempt.key = key; attempt.pending = undefined; return 'ready';
  }
  attempt.pending = 'save';
  const endpoint = path(input, 'detail-save'), response = await fetcher(`${endpoint}${endpoint.includes('?') ? '&' : '?'}uploadId=${input.uploadId}`, { signal, cache: 'no-store' });
  const body = await response.json() as { applied?: boolean; quotation?: QuotationFieldsView; receipt?: DetailSaveReceipt; error?: string }; signal.throwIfAborted();
  if (!response.ok) throw Error(body.error || '상세 저장 결과를 확인하지 못했습니다. 다시 저장하지 않고 확인을 유지합니다.');
  if (body.applied === true && body.quotation && body.receipt && attempt.key) {
    verifySaved(input, attempt.key, body.quotation, body.receipt);
    if (!same(await readView(input, signal, fetcher), body.quotation)) throw changed();
    attempt.completed = body.quotation; attempt.pending = undefined; return 'completed';
  }
  if (attempt.completed || body.applied !== false || !same(body.quotation, input.view)) throw changed();
  attempt.pending = undefined; return 'ready';
}
/** The reviewed PNG and all quotation scopes commit atomically on the server. */
export async function applyDetailSave(input: DetailComposite, attempt: DetailSaveAttempt, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<QuotationFieldsView> {
  bindAttempt(input, attempt);
  if (attempt.completed) {
    if (!same(await readView(input, signal, fetcher), attempt.completed)) throw changed(); return attempt.completed;
  }
  if (attempt.pending) throw Error('이전 상세 저장 결과를 먼저 확인해주세요.');
  if (!same(await readView(input, signal, fetcher), input.view)) throw changed();
  // Validate targets and all option IDs before allocating a file.
  detailSaveChanges(input.view, `${input.view.imageKeys[0]?.split('/')[0]}/quotation-label-${input.uploadId}.png`, DETAIL_SAVE_TEXT_POLICY);
  if (input.output.type !== 'image/png' || input.output.size < 1 || input.output.size > MAX_IMAGE_BYTES
    || await labelUploadDigest(new Uint8Array(await input.output.arrayBuffer())) !== input.sha256) throw changed();
  signal.throwIfAborted();
  for (const source of input.sources) if ((await digestFile(source.key, signal, fetcher)).sha256 !== source.sha256) throw changed();
  signal.throwIfAborted(); let key = await uploadReceipt(input, signal, fetcher);
  if (!key) {
    const form = new FormData(); form.set('file', new File([input.output], 'sourceflow-quotation-label.png', { type: 'image/png' })); form.set('labelUploadId', input.uploadId);
    attempt.pending = 'upload'; const response = await fetcher('/api/files', { method: 'POST', signal, body: form });
    if (!response.ok) { if (response.status < 500 && response.status !== 429) attempt.pending = undefined; throw Error('상세 이미지 업로드 결과를 확인해주세요. 원본은 유지했습니다.'); }
    key = await uploadReceipt(input, signal, fetcher); if (!key) throw changed(); attempt.pending = undefined;
  }
  attempt.key = key;
  if (!same(await readView(input, signal, fetcher), input.view)) throw changed();
  signal.throwIfAborted(); attempt.pending = 'save';
  const response = await fetcher(path(input, 'detail-save'), { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: input.view.revision,
    expectedInputFingerprint: input.view.inputFingerprint, sourceOptionId: input.optionId, uploadId: input.uploadId, sha256: input.sha256, bytes: input.output.size, textPolicy: DETAIL_SAVE_TEXT_POLICY }) });
  if (!response.ok) { if (response.status < 500 && response.status !== 429) attempt.pending = undefined; const body = await response.json() as { error?: string }; throw Error(body.error || '공통·모든 옵션 상세 저장 결과를 확인해주세요.'); }
  const body = await response.json() as { quotation: QuotationFieldsView; receipt: DetailSaveReceipt }; signal.throwIfAborted();
  verifySaved(input, key, body.quotation, body.receipt);
  const confirmed = await readView(input, signal, fetcher); if (!same(confirmed, body.quotation)) throw changed();
  attempt.completed = confirmed; attempt.pending = undefined; return confirmed;
}
