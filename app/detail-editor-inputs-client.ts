import type { QuotationFieldsView } from '@/app/quotation-schema';
import { validateDetailEditorInputs, type DetailEditorInputs } from '@/app/detail-editor-inputs';
import { optionImageTargets } from '@/app/quotation-image-targets';
import { imageFileType, MAX_IMAGE_BYTES } from '@/app/image-files';
import { imageDisplayDimensions } from '@/app/image-dimensions';
import { labelUploadDigest } from '@/app/label-upload-key';
import { readBoundedStream } from '@/app/request-body';

export type PreparedDetailInputs = { productId: string; optionId: string; profileId?: string; view: QuotationFieldsView; inputs: DetailEditorInputs; keys: string[] };
type Selection = Pick<PreparedDetailInputs, 'productId' | 'optionId' | 'profileId' | 'view'>;
const changed = () => Error('저장된 상세 이미지나 편집 기준이 바뀌었습니다. 현재 입력을 유지하고 저장본을 다시 확인해주세요.');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const url = (key: string) => `/api/files/${key.split('/').map(encodeURIComponent).join('/')}`;

function selection(input: Selection): DetailEditorInputs {
  const { view, optionId, profileId } = input, raw = view?.detailEditorInputs;
  if (!raw || !view.categoryContext?.categoryId || profileId && profileId !== view.categoryContext.profileId
    || !/^[A-Za-z0-9_-]{1,80}$/u.test(input.productId) || !/^[A-Za-z0-9_-]{1,80}$/u.test(optionId)
    || !/^[a-f0-9]{64}$/u.test(view.inputFingerprint) || !Number.isFinite(Date.parse(view.productVersion))) throw changed();
  const owner = raw.output?.key?.split('/')[0]; if (!owner) throw changed();
  const saved = validateDetailEditorInputs(raw, owner, view.categoryContext.categoryId);
  const rows = view.resolved.rows.filter(row => row.optionId === optionId), target = optionImageTargets(view.resolved.schema.fields).detailImages;
  if (rows.length !== 1 || target.fields.some(field => field.readOnly) || !view.imageKeys.includes(saved.output.key)
    || target.linked.some(id => rows[0].fields[id]?.value !== saved.output.key) || saved.images.some(image => !view.imageKeys.includes(image.key))) throw changed();
  return saved;
}
export function canEditSavedDetailInputs(input: Selection): boolean { try { selection(input); return true; } catch { return false; } }

/** Read-only preparation. The caller stages a local draft; an existing explicit
 * option-image save remains the only write. Original OCR/job claims are not made. */
export async function prepareSavedDetailInputs(input: Selection, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<PreparedDetailInputs> {
  signal.throwIfAborted(); const saved = selection(input);
  const endpoint = `/api/products/${encodeURIComponent(input.productId)}/quotation-fields${input.profileId ? `?profileId=${encodeURIComponent(input.profileId)}` : ''}`;
  async function current() {
    const response = await fetcher(endpoint, { signal, cache: 'no-store' }), value: unknown = await response.json(); signal.throwIfAborted();
    if (!response.ok || !same(value, input.view)) throw changed();
  }
  async function read(key: string) {
    const response = await fetcher(url(key), { signal, cache: 'no-store' });
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw Error('저장 전 개별 상세 사진을 읽지 못했습니다. 현재 견적서는 유지됩니다.');
    const bytes = await readBoundedStream(response.body, MAX_IMAGE_BYTES); signal.throwIfAborted();
    const type = imageFileType(bytes), size = imageDisplayDimensions(bytes);
    if (!size) throw changed(); return { ...size, sha256: await labelUploadDigest(bytes), bytes: bytes.length, type: type.contentType };
  }
  await current();
  const result = await read(saved.output.key), height = saved.images.reduce((sum, image) => sum + Math.max(1, Math.round(image.height * 800 / image.width)), 0);
  if (result.type !== 'image/png' || result.width !== 800 || result.height !== height || result.sha256 !== saved.output.sha256 || result.bytes !== saved.output.bytes) throw changed();
  let total = 0; const files = new Map<string, Awaited<ReturnType<typeof read>>>();
  for (const image of saved.images) {
    signal.throwIfAborted(); const file = files.get(image.key) ?? await read(image.key); files.set(image.key, file); total += file.bytes;
    if (total > 30 * 1024 * 1024 || file.sha256 !== image.sha256 || file.width !== image.width || file.height !== image.height) throw changed();
  }
  await current(); signal.throwIfAborted();
  return { ...input, inputs: saved, keys: saved.images.map(image => image.key) };
}
