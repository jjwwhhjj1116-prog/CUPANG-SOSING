import { inspectImage } from '@/app/automation/image-edit';
import { MAX_IMAGE_BYTES } from '@/app/image-files';
import type { ProductContent } from '@/app/product-content';

export type ResizeSource = { key: string; blob: Blob; width: number; height: number; productVersion: string; contentRevision: number };
export type ResizedImage = ResizeSource & { output: Blob; outputWidth: number; outputHeight: number };
export type ImageTransform = { crop?: { x: number; y: number; width: number; height: number }; rotation?: 0 | 90 | 180 | 270 };

export function imageTransformPlan(source: Pick<ResizeSource, 'width' | 'height'>, transform: ImageTransform = {}) {
  resizeDimensions(source.width, source.height);
  const crop = transform.crop ?? { x: 0, y: 0, width: source.width, height: source.height };
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isSafeInteger) || crop.x < 0 || crop.y < 0
    || crop.width < 1 || crop.height < 1 || crop.x > source.width - crop.width || crop.y > source.height - crop.height) throw Error('자를 영역은 원본 안의 정수 픽셀로 지정해주세요.');
  const rotation = transform.rotation ?? 0;
  if (![0, 90, 180, 270].includes(rotation)) throw Error('회전은 0·90·180·270도만 지원합니다.');
  const quarterTurn = rotation === 90 || rotation === 270;
  return { crop, rotation, width: quarterTurn ? crop.height : crop.width, height: quarterTurn ? crop.width : crop.height };
}

async function decodeImage(blob: Blob, signal: AbortSignal): Promise<HTMLImageElement> {
  signal.throwIfAborted();
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      const finish = () => { signal.removeEventListener('abort', abort); image.onload = null; image.onerror = null; };
      const abort = () => { finish(); image.src = ''; reject(signal.reason); };
      image.onload = () => { finish(); resolve(image); };
      image.onerror = () => { finish(); reject(Error('원본 이미지를 화면에서 읽지 못했습니다.')); };
      signal.addEventListener('abort', abort, { once: true }); image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}
type Product = { id: string; image_keys: string; updated_at: string };
async function json<T>(url: string, signal: AbortSignal, fetcher: typeof fetch, init?: RequestInit): Promise<T> {
  signal.throwIfAborted();
  const response = await fetcher(url, { cache: 'no-store', ...init, signal });
  const body = await response.json() as T & { error?: string }; signal.throwIfAborted();
  if (!response.ok) throw Error(body.error || '이미지 자료를 저장하지 못했습니다.');
  return body as T;
}
async function snapshot(productId: string, signal: AbortSignal, fetcher: typeof fetch) {
  const base = `/api/products/${encodeURIComponent(productId)}`;
  const [{ product }, { content }] = await Promise.all([
    json<{product: Product}>(base, signal, fetcher), json<{content: ProductContent}>(`${base}/content`, signal, fetcher),
  ]);
  if (product?.id !== productId || content?.productId !== productId || !Number.isFinite(Date.parse(product.updated_at)) || !Number.isSafeInteger(content.revision)) throw Error('상품 이미지의 저장 상태를 확인해주세요.');
  const keys: unknown = JSON.parse(product.image_keys);
  if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string')) throw Error('상품 이미지 목록을 확인해주세요.');
  return { product, content, keys: keys as string[] };
}
export async function readResizeSource(productId: string, key: string, contentRevision: number, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<ResizeSource> {
  const current = await snapshot(productId, signal, fetcher);
  if (current.content.revision !== contentRevision || !current.keys.includes(key)) throw Error('이미지 선택 또는 저장 자료가 변경되었습니다. 최신 저장본을 확인해주세요.');
  const response = await fetcher(`/api/files/${key.split('/').map(encodeURIComponent).join('/')}`, { cache: 'no-store', signal });
  if (!response.ok) throw Error('크기를 조절할 원본 이미지를 읽지 못했습니다.');
  const blob = await response.blob(); signal.throwIfAborted();
  inspectImage(new Uint8Array(await blob.arrayBuffer()));
  // Use the decoded orientation, including JPEG EXIF, for the visible crop grid.
  const decoded = await decodeImage(blob, signal); signal.throwIfAborted();
  const dimensions = resizeDimensions(decoded.naturalWidth, decoded.naturalHeight);
  return { key, blob, ...dimensions, productVersion: current.product.updated_at, contentRevision };
}
export function resizeDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 16000 || height > 16000 || width * height > 40000000) throw Error('가로·세로는 1~16,000px 정수, 전체 크기는 4,000만 픽셀 이내로 입력해주세요.');
  return { width, height };
}
/** Local crop/quarter-turn/resize only. The original remains immutable and no
 * model, translation service or background reconstruction is requested. */
export async function renderResizedImage(source: ResizeSource, width: number, height: number, signal: AbortSignal, transform: ImageTransform = {}): Promise<ResizedImage> {
  resizeDimensions(width, height); signal.throwIfAborted();
  const plan = imageTransformPlan(source, transform);
  const image = await decodeImage(source.blob, signal);
  signal.throwIfAborted();
  if (image.naturalWidth !== source.width || image.naturalHeight !== source.height) throw Error('원본 이미지의 화면 크기가 달라졌습니다. 편집할 원본을 다시 선택해주세요.');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d'); if (!context) throw Error('이 브라우저에서 이미지 크기 조절을 사용할 수 없습니다.');
  const { crop, rotation } = plan;
  if (!rotation && crop.x === 0 && crop.y === 0 && crop.width === source.width && crop.height === source.height) context.drawImage(image, 0, 0, width, height);
  else if (!rotation) context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  else {
    context.save(); context.translate(width / 2, height / 2); context.scale(width / plan.width, height / plan.height);
    context.rotate(rotation * Math.PI / 180);
    context.drawImage(image, crop.x, crop.y, crop.width, crop.height, -crop.width / 2, -crop.height / 2, crop.width, crop.height);
    context.restore();
  }
  const output = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('크기 조절 결과를 만들지 못했습니다.')), 'image/png'));
  signal.throwIfAborted();
  if (!output.size || output.size > MAX_IMAGE_BYTES) throw Error('크기 조절 결과가 10MB를 초과합니다. 픽셀 크기를 줄여주세요.');
  return { ...source, output, outputWidth: width, outputHeight: height };
}
/** The existing attachment API preserves every role. The editor applies the
 * new key to its current draft only after this source-bound attachment succeeds. */
export async function attachResizedImage(productId: string, image: ResizedImage, upload: { key?: string }, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const current = await snapshot(productId, signal, fetcher);
  if (current.content.revision !== image.contentRevision || !current.keys.includes(image.key)) throw Error('크기 조절 이후 이미지 자료가 변경되었습니다. 최신 저장본을 확인해주세요.');
  if (upload.key && current.keys.includes(upload.key)) return { key: upload.key, productVersion: current.product.updated_at };
  if (current.product.updated_at !== image.productVersion) throw Error('크기 조절 이후 상품이 변경되었습니다. 원본을 다시 선택해 미리보기를 만들어주세요.');
  if (!upload.key) {
    const form = new FormData(); form.set('file', new File([image.output], `resized-${image.outputWidth}x${image.outputHeight}.png`, { type: 'image/png' }));
    const saved = await json<{key: string}>('/api/files', signal, fetcher, { method: 'POST', body: form });
    if (typeof saved.key !== 'string' || !saved.key || saved.key === image.key) throw Error('업로드한 이미지 연결을 확인하지 못했습니다.');
    upload.key = saved.key;
  }
  const saved = await json<{productVersion: string}>(`/api/products/${encodeURIComponent(productId)}/attachments`, signal, fetcher, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: upload.key, role: null, expectedVersion: image.productVersion, expectedContentRevision: image.contentRevision }),
  });
  if (!Number.isFinite(Date.parse(saved.productVersion))) throw Error('이미지 연결의 저장 버전을 확인하지 못했습니다. 다시 확인해주세요.');
  return { key: upload.key, productVersion: saved.productVersion };
}
