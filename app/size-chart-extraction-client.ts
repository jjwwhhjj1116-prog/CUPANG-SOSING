import { validateFreeImageSource, freeImageSourceIdentity, type FreeImageSource } from '@/app/free-image-translation';
import { readFreeImageSourcePixels, type FreeImageLoaded } from '@/app/free-image-translation-client';
import { verifySizeChartExtractionResult, type SizeChartOcrLine, type SizeChartExtractionResult } from '@/app/size-chart-extraction';

export type SizeChartImageInventory = { purpose: 'size-chart-extraction'; productId: string; productVersion: string; contentRevision: number; images: { key: string; role: 'detail' | 'other' }[] };
const purpose = 'size-chart-extraction';
function endpoint(productId: string) { return `/api/products/${encodeURIComponent(productId)}/size-chart-draft`; }
async function reply(response: Response) {
  const body = await response.json() as { error?: string };
  if (!response.ok) throw Error(body?.error || '사이즈표 이미지 자료를 확인하지 못했습니다.');
  return body;
}
export async function readSizeChartImages(productId: string, version: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<SizeChartImageInventory> {
  const body = await reply(await fetcher(endpoint(productId), { cache: 'no-store', signal })) as unknown as SizeChartImageInventory;
  signal.throwIfAborted();
  if (!body || body.purpose !== purpose || body.productId !== productId || body.productVersion !== version
    || !Number.isSafeInteger(body.contentRevision) || body.contentRevision < 0 || !Array.isArray(body.images) || body.images.length > 150
    || body.images.some(item => !item || typeof item.key !== 'string' || !item.key || item.key.length > 512 || !['detail', 'other'].includes(item.role))
    || new Set(body.images.map(item => item.key)).size !== body.images.length) throw Error('상품과 저장된 이미지 목록이 변경되었습니다. 최신 저장본을 확인해주세요.');
  return body;
}
/** This proof authorizes only a read of this product's stored image. It does
 * not assign a detail role or authorize image replacement in another editor. */
export async function readSizeChartSource(productId: string, version: string, contentRevision: number, key: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<FreeImageSource> {
  const body = await reply(await fetcher(`${endpoint(productId)}?${new URLSearchParams({ sourceKey: key })}`, { cache: 'no-store', signal })) as { purpose?: string; source?: unknown };
  signal.throwIfAborted();
  if (body.purpose !== purpose) throw Error('사이즈표 이미지 확인 응답이 다릅니다.');
  const source = validateFreeImageSource(body.source);
  if (source.productId !== productId || source.productVersion !== version || source.contentRevision !== contentRevision || source.sourceKey !== key || source.role !== 'detail'
    || source.optionImages || source.quotationTarget || source.workspaceTarget || source.editorSource) throw Error('선택한 원본 이미지 또는 저장 버전이 변경되었습니다.');
  return source;
}
export async function loadSizeChartImage(productId: string, inventory: SizeChartImageInventory, key: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<FreeImageLoaded> {
  if (inventory.productId !== productId || !inventory.images.some(item => item.key === key)) throw Error('이 상품의 이미지 목록에서 원본을 선택해주세요.');
  return readFreeImageSourcePixels(await readSizeChartSource(productId, inventory.productVersion, inventory.contentRevision, key, signal, fetcher), signal, fetcher);
}
export async function requestSizeChartExtraction(source: FreeImageSource, language: 'zh' | 'en', lines: readonly SizeChartOcrLine[], display: { width: number; height: number }, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<SizeChartExtractionResult> {
  signal.throwIfAborted();
  const body = await reply(await fetcher(endpoint(source.productId), { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source, language, display, lines }) }));
  signal.throwIfAborted();
  return verifySizeChartExtractionResult(body, source, [...lines], display);
}
export async function sizeChartSourceStillCurrent(source: FreeImageSource, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const current = await readSizeChartSource(source.productId, source.productVersion, source.contentRevision, source.sourceKey, signal, fetcher);
  if (freeImageSourceIdentity(current) !== freeImageSourceIdentity(source)) throw Error('초안을 만든 원본 이미지가 변경되었습니다. 다시 읽어주세요.');
}
