import type { QuotationChange, QuotationFieldsView } from '@/app/quotation-schema';
import { optionImageChanges, optionImageTargets, optionImageValue, quotationImageKeys, verifyOptionImageRecovery } from '@/app/quotation-image-targets';
import { PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-pool-limit';
import { MAX_IMAGE_BYTES, imageFileType } from '@/app/image-files';
import { inspectImage } from '@/app/automation/image-edit';
import { readBoundedStream } from '@/app/request-body';
import { labelUploadDigest } from '@/app/label-upload-key';
import { imageDimensions } from '@/app/image-dimensions';

export type DetailComposite = {
  productId: string; optionId: string; profileId?: string; view: QuotationFieldsView;
  keys: string[]; sources: { key: string; sha256: string; width: number; height: number }[];
  output: Blob; width: 800; height: number; sha256: string; uploadId: string;
};
export type DetailCompositeAttempt = {
  key?: string; pending?: 'upload' | 'pool' | 'quote'; poolBefore?: QuotationFieldsView;
  quoteBefore?: QuotationFieldsView; changes?: QuotationChange[]; completed?: QuotationFieldsView;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const endpoint = (input: Pick<DetailComposite, 'productId' | 'profileId'>) => `/api/products/${encodeURIComponent(input.productId)}/quotation-fields${input.profileId ? `?profileId=${encodeURIComponent(input.profileId)}` : ''}`;
const fileUrl = (key: string) => `/api/files/${key.split('/').map(encodeURIComponent).join('/')}`;
const changed = () => Error('상세 이미지·옵션·저장 자료가 변경되었습니다. 원본과 미리보기는 유지했으며 다시 확인해주세요.');
function selection(view: QuotationFieldsView, optionId: string, profileId?: string) {
  if (!view || !Number.isSafeInteger(view.revision) || !Number.isSafeInteger(view.contentRevision) || !Number.isSafeInteger(view.optionRevision)
    || !Number.isFinite(Date.parse(view.productVersion)) || !/^[a-f0-9]{64}$/.test(view.inputFingerprint)
    || !Array.isArray(view.imageKeys) || view.imageKeys.length > PRODUCT_IMAGE_POOL_LIMIT || new Set(view.imageKeys).size !== view.imageKeys.length
    || view.resolved?.rows.filter(row => row.optionId === optionId).length !== 1 || (profileId && view.categoryContext?.profileId !== profileId)) throw changed();
  const target = optionImageTargets(view.resolved.schema.fields).detailImages, value = optionImageValue(view, optionId, 'detailImages');
  const keys = quotationImageKeys(value);
  if (!keys.length || keys.length > PRODUCT_IMAGE_POOL_LIMIT || keys.some(key => !view.imageKeys.includes(key))
    || target.fields.some(field => field.readOnly) || target.linked.some(id => optionImageValue(view, optionId, 'detailImages', {}, id) !== value)) throw Error('저장한 상세 이미지와 견적서 연결을 확인해주세요.');
  // Existing top/body sharing is a visible repeated position, not a new role assignment.
  return keys;
}
async function readView(input: Pick<DetailComposite, 'productId' | 'optionId' | 'profileId'>, signal: AbortSignal, fetcher: typeof fetch) {
  signal.throwIfAborted(); const response = await fetcher(endpoint(input), { cache: 'no-store', signal });
  const body = await response.json() as QuotationFieldsView & { error?: string }; signal.throwIfAborted();
  if (!response.ok) throw Error(body.error || '상세 이미지 저장본을 읽지 못했습니다.'); selection(body, input.optionId, input.profileId); return body;
}
async function readImage(key: string, signal: AbortSignal, fetcher: typeof fetch) {
  const response = await fetcher(fileUrl(key), { cache: 'no-store', signal });
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw Error('선택한 원본 이미지를 읽지 못했습니다.');
  const bytes = await readBoundedStream(response.body, MAX_IMAGE_BYTES); signal.throwIfAborted();
  const type = imageFileType(bytes), header = imageDimensions(bytes);
  if (header) dimensions(header.width, header.height);
  return { blob: new Blob([new Uint8Array(bytes).buffer], { type: type.contentType }), sha256: await labelUploadDigest(bytes) };
}
async function decode(blob: Blob, signal: AbortSignal): Promise<HTMLImageElement> {
  signal.throwIfAborted(); const url = URL.createObjectURL(blob);
  try { return await new Promise((resolve, reject) => {
    const image = new Image(); const finish = () => { signal.removeEventListener('abort', abort); image.onload = image.onerror = null; };
    const abort = () => { finish(); image.src = ''; reject(signal.reason); };
    image.onload = () => { finish(); resolve(image); }; image.onerror = () => { finish(); reject(Error('원본 사진을 화면에서 읽지 못했습니다.')); };
    signal.addEventListener('abort', abort, { once: true }); image.src = url;
  }); } finally { URL.revokeObjectURL(url); }
}
function dimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 16000 || height > 16000 || width * height > 40000000) throw Error('합칠 이미지가 화면 처리 크기를 초과합니다. 이미지를 나누거나 줄여주세요.');
}
type DetailImageInput = Pick<DetailComposite, 'productId' | 'optionId' | 'profileId' | 'view'>;
async function renderDetailImages(input: DetailImageInput, keys: string[], signal: AbortSignal, fetcher: typeof fetch, format: 'png' | 'jpeg') {
  signal.throwIfAborted();
  if (!same(await readView(input, signal, fetcher), input.view)) throw changed();
  const sources: DetailComposite['sources'] = []; let height = 0, totalBytes = 0;
  // Keep only one decoded source in memory. The second pass also confirms its bytes.
  for (const key of keys) {
    const source = await readImage(key, signal, fetcher); totalBytes += source.blob.size;
    if (totalBytes > 30 * 1024 * 1024) throw Error('합칠 원본의 전체 크기는 30MB 이내여야 합니다.');
    const image = await decode(source.blob, signal); signal.throwIfAborted(); dimensions(image.naturalWidth, image.naturalHeight);
    height += Math.max(1, Math.round(image.naturalHeight * 800 / image.naturalWidth)); dimensions(800, height);
    sources.push({ key, sha256: source.sha256, width: image.naturalWidth, height: image.naturalHeight });
  }
  const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = height;
  const context = canvas.getContext('2d'); if (!context) throw Error('이 브라우저에서 상세 이미지 합치기를 사용할 수 없습니다.');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, 800, height); let y = 0;
  for (const source of sources) {
    const current = await readImage(source.key, signal, fetcher); if (current.sha256 !== source.sha256) throw changed();
    const image = await decode(current.blob, signal); signal.throwIfAborted();
    if (image.naturalWidth !== source.width || image.naturalHeight !== source.height) throw changed();
    const scaledHeight = Math.max(1, Math.round(source.height * 800 / source.width)); context.drawImage(image, 0, y, 800, scaledHeight); y += scaledHeight;
  }
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const output = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('상세 이미지 합치기 결과를 만들지 못했습니다.')), mime, format === 'jpeg' ? 0.92 : undefined));
  signal.throwIfAborted(); if (!output.size || output.size > MAX_IMAGE_BYTES) throw Error('합친 이미지는 10MB 이내여야 합니다.');
  const bytes = new Uint8Array(await output.arrayBuffer()), metadata = inspectImage(bytes);
  if (metadata.mime !== mime || metadata.width !== 800 || metadata.height !== height) throw Error('합친 이미지의 파일과 화면 크기를 확인하지 못했습니다.');
  if (!same(await readView(input, signal, fetcher), input.view)) throw changed();
  return { keys, sources, output, width: 800 as const, height, bytes };
}
/** Download the current saved sequence without allocating or replacing files. */
export async function prepareDetailImageDownload(input: DetailImageInput, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<{ output: Blob; width: 800; height: number; keys: string[] }> {
  const keys = selection(input.view, input.optionId, input.profileId);
  const rendered = await renderDetailImages(input, keys, signal, fetcher, 'jpeg');
  return { output: rendered.output, width: rendered.width, height: rendered.height, keys: rendered.keys };
}
/** Read and render only. No uploads or automatic replacement during preview. */
export async function prepareDetailComposite(input: DetailImageInput, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<DetailComposite> {
  const keys = selection(input.view, input.optionId, input.profileId);
  if (input.view.imageKeys.length >= PRODUCT_IMAGE_POOL_LIMIT) throw Error('새 합친 이미지를 저장할 공간이 없습니다. 원본은 유지됩니다.');
  const { sources, output, height, bytes } = await renderDetailImages(input, keys, signal, fetcher, 'png');
  const sha256 = await labelUploadDigest(bytes), uploadId = await labelUploadDigest(new TextEncoder().encode(JSON.stringify({ kind: 'detail-composite-v1', productId: input.productId, optionId: input.optionId, category: input.view.categoryContext, fingerprint: input.view.inputFingerprint, sources, width: 800, height, sha256 })));
  return { ...input, keys, sources, output, width: 800, height, sha256, uploadId };
}
async function verifySources(input: DetailComposite, signal: AbortSignal, fetcher: typeof fetch) {
  for (const source of input.sources) if ((await readImage(source.key, signal, fetcher)).sha256 !== source.sha256) throw changed();
}
async function receipt(input: DetailComposite, signal: AbortSignal, fetcher: typeof fetch) {
  const response = await fetcher(`/api/files?labelUploadId=${input.uploadId}`, { cache: 'no-store', signal });
  const body = await response.json() as { key?: string | null; contentType?: string; size?: number; sha256?: string; error?: string }; signal.throwIfAborted();
  if (!response.ok) throw Error(body.error || '합친 이미지 업로드 결과를 읽지 못했습니다.');
  if (body.key === null) return null;
  if (typeof body.key !== 'string' || !body.key.endsWith(`/quotation-label-${input.uploadId}.png`) || body.contentType !== 'image/png' || body.size !== input.output.size || body.sha256 !== input.sha256) throw Error('저장한 합친 이미지가 미리보기 파일과 다릅니다.');
  if ((await readImage(body.key, signal, fetcher)).sha256 !== input.sha256) throw Error('합친 이미지의 저장 파일을 확인하지 못했습니다.'); return body.key;
}
function poolCommit(before: QuotationFieldsView, after: QuotationFieldsView, key: string) {
  const omitClock = (view: QuotationFieldsView) => { const rest: Partial<QuotationFieldsView> = { ...view }; delete rest.productVersion; delete rest.inputFingerprint; delete rest.imageKeys; return rest; };
  if (before.imageKeys.includes(key) || !same(after.imageKeys, [...before.imageKeys, key]) || Date.parse(after.productVersion) <= Date.parse(before.productVersion)
    || !same(omitClock(before), omitClock(after))) throw changed();
}
/** Uncertain writes are reconciled by reads only. A subsequent explicit click
 * can resume the next step; a completed quote is never written twice. */
export async function recoverDetailComposite(input: DetailComposite, attempt: DetailCompositeAttempt, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  if (!attempt.pending) return attempt.completed ? 'completed' as const : 'ready' as const;
  if (attempt.pending === 'upload') { const key = await receipt(input, signal, fetcher); if (key) attempt.key = key; attempt.pending = undefined; return 'ready' as const; }
  const current = await readView(input, signal, fetcher);
  if (attempt.pending === 'pool' && attempt.poolBefore && attempt.key) {
    if (same(current, attempt.poolBefore)) { attempt.pending = undefined; return 'ready' as const; }
    poolCommit(attempt.poolBefore, current, attempt.key); attempt.quoteBefore = current; attempt.pending = undefined; return 'ready' as const;
  }
  if (attempt.pending === 'quote' && attempt.quoteBefore && attempt.changes) {
    if (same(current, attempt.quoteBefore)) { attempt.pending = undefined; return 'ready' as const; }
    verifyOptionImageRecovery(attempt.quoteBefore, current, input.optionId, attempt.changes);
    attempt.completed = current; attempt.pending = undefined; return 'completed' as const;
  }
  throw changed();
}
export async function applyDetailComposite(input: DetailComposite, attempt: DetailCompositeAttempt, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  if (attempt.completed) return attempt.completed;
  if (attempt.pending) throw Error('이전 저장 결과를 먼저 확인해주세요. 이미지를 다시 업로드하지 않습니다.');
  let current = await readView(input, signal, fetcher);
  if (!same(current, attempt.quoteBefore ?? input.view)) throw changed();
  if (!current.imageKeys.includes(attempt.key ?? '') && current.imageKeys.length >= PRODUCT_IMAGE_POOL_LIMIT) throw Error('새 합친 이미지를 저장할 공간이 없습니다. 원본은 유지됩니다.');
  await verifySources(input, signal, fetcher); let key = await receipt(input, signal, fetcher);
  if (!key) {
    const form = new FormData(); form.set('file', new File([input.output], 'sourceflow-quotation-label.png', { type: 'image/png' })); form.set('labelUploadId', input.uploadId);
    attempt.pending = 'upload'; const response = await fetcher('/api/files', { method: 'POST', body: form, signal });
    if (!response.ok) { if (response.status < 500 && response.status !== 429) attempt.pending = undefined; throw Error('합친 이미지 업로드 결과를 확인해주세요. 원본은 유지됩니다.'); }
    key = await receipt(input, signal, fetcher); if (!key) throw Error('합친 이미지 저장 결과를 확인하지 못했습니다.'); attempt.pending = undefined;
  }
  attempt.key = key; signal.throwIfAborted();
  if (!same(await readView(input, signal, fetcher), current)) throw changed();
  if (!current.imageKeys.includes(key)) {
    attempt.poolBefore = current; attempt.pending = 'pool';
    const response = await fetcher(`/api/products/${encodeURIComponent(input.productId)}/attachments`, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, role: null, expectedVersion: current.productVersion, expectedContentRevision: current.contentRevision }) });
    if (!response.ok) { if (response.status < 500 && response.status !== 429) attempt.pending = undefined; throw Error('합친 이미지 연결 결과를 확인해주세요. 원본은 유지됩니다.'); }
    const saved = await readView(input, signal, fetcher); poolCommit(current, saved, key); current = saved; attempt.quoteBefore = current; attempt.pending = undefined;
  }
  await verifySources(input, signal, fetcher);
  if (!same(await readView(input, signal, fetcher), current)) throw changed();
  const changes = optionImageChanges(current, input.optionId, { detailImages: key }); attempt.quoteBefore = current; attempt.changes = changes; attempt.pending = 'quote';
  const response = await fetcher(endpoint(input), { method: 'PUT', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: current.revision, expectedInputFingerprint: current.inputFingerprint, changes }) });
  if (!response.ok) { if (response.status < 500 && response.status !== 429) attempt.pending = undefined; throw Error('선택 옵션 상세 이미지 저장 결과를 확인해주세요. 원본과 HTML은 유지됩니다.'); }
  // Confirm the actual quote, including every unrelated override, instead of
  // treating a successful HTTP status or a stale callback as a completed save.
  const confirmed = await readView(input, signal, fetcher); verifyOptionImageRecovery(current, confirmed, input.optionId, changes);
  attempt.completed = confirmed; attempt.pending = undefined; return confirmed;
}
