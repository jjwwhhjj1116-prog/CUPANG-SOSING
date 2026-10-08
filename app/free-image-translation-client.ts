import {
  MAX_OCR_PIXELS, MAX_OCR_REGIONS, MAX_OCR_TEXT, validateFreeImageSource, validateImageTextRegions,
  freeImageApplyIdentity, freeImageSourceIdentity, validateFreeImageOptionIds,
  type FreeImageRole, type FreeImageSource, type ImageTextRegion, type ImageTextTranslation,
} from '@/app/free-image-translation';
import { isOwnedImageKey, MAX_IMAGE_BYTES } from '@/app/image-files';
import type { Worker, WorkerOptions, LoggerMessage } from 'tesseract.js';

export type OcrBox = { x: number; y: number; width: number; height: number };
export type FreeImageRegion = {
  id: string; text: string; box: OcrBox; confidence: number; selected: boolean;
  translated: string; issue: string | null; translationProvenance: 'empty' | 'generated' | 'manual';
  background: string; foreground: string; fontSize: number;
};
export type FreeImageLoaded = { source: FreeImageSource; blob: Blob; canvas: HTMLCanvasElement; width: number; height: number };
export type FreeImageRendered = { source: FreeImageSource; output: Blob; width: number; height: number; optionImageIds?: string[] };
export type FreeImageQuotationRequest = Omit<NonNullable<FreeImageSource['quotationTarget']>, 'bindingSha256'>;
export function sameFreeImageQuotationRequest(actual: FreeImageSource['quotationTarget'] | FreeImageQuotationRequest | null | undefined, expected: FreeImageQuotationRequest | null | undefined): boolean {
  if (!actual || !expected) return !actual && !expected;
  return actual.kind === expected.kind && actual.profileId === expected.profileId && actual.optionId === expected.optionId && actual.input === expected.input
    && actual.fieldKey === expected.fieldKey && actual.slotIndex === expected.slotIndex && actual.revision === expected.revision
    && actual.inputFingerprint === expected.inputFingerprint && actual.optionRevision === expected.optionRevision && actual.value === expected.value;
}
function quotationSourceQuery(target: FreeImageQuotationRequest, role: FreeImageRole, sourceKey: string): Record<string, string> {
  if (target.kind !== 'quotation' || !(target.profileId === null || typeof target.profileId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(target.profileId))
    || !/^[a-zA-Z0-9_-]{1,80}$/.test(target.optionId) || !['mainImage', 'additionalImages', 'detailImages'].includes(target.input)
    || role !== (target.input === 'mainImage' ? 'main' : target.input === 'additionalImages' ? 'additional' : 'detail') || typeof target.fieldKey !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(target.fieldKey)
    || !Number.isSafeInteger(target.slotIndex) || target.slotIndex < 0 || target.slotIndex > 29 || !Number.isSafeInteger(target.revision) || target.revision < 0
    || !Number.isSafeInteger(target.optionRevision) || target.optionRevision < 0 || !/^[a-f0-9]{64}$/.test(target.inputFingerprint)
    || typeof target.value !== 'string' || target.value.length > 16000 || target.value.split('\n').map(key => key.trim()).filter(Boolean)[target.slotIndex] !== sourceKey
    || target.input === 'mainImage' && (target.slotIndex !== 0 || target.value.split('\n').map(key => key.trim()).filter(Boolean).length !== 1)) {
    throw Error('선택 옵션의 최종 이미지 연결을 확인해주세요.');
  }
  return { target: 'quotation', optionId: target.optionId, fieldKey: target.fieldKey, slotIndex: String(target.slotIndex), ...(target.profileId ? { profileId: target.profileId } : {}) };
}
type OcrWorker = Pick<Worker, 'recognize' | 'terminate'>;
export type OcrWorkerFactory = (languages: string[], oem: 1, options: Partial<WorkerOptions>) => Promise<OcrWorker>;
// A cancelled initialization can finish after its view closes. Queue the next
// OCR behind that worker's termination instead of creating two local engines.
let workerSlot: Promise<void> = Promise.resolve();
export function sameFreeImageSource(actual: unknown, expected: FreeImageSource): boolean {
  try { return freeImageSourceIdentity(validateFreeImageSource(actual)) === freeImageSourceIdentity(validateFreeImageSource(expected)); } catch { return false; }
}
export function validateOcrBox(box: OcrBox, width: number, height: number): OcrBox {
  if (!box || ![box.x, box.y, box.width, box.height].every(Number.isSafeInteger) || box.x < 0 || box.y < 0
    || box.width < 1 || box.height < 1 || box.x > width - box.width || box.y > height - box.height) throw Error('문구 영역은 원본 이미지 안의 정수 픽셀로 지정해주세요.');
  return box;
}
function dimensions(width: number, height: number) {
  if (![width, height].every(Number.isSafeInteger) || width < 1 || height < 1 || width > 16000 || height > 16000
    || width * height > MAX_OCR_PIXELS) throw Error('문구 인식은 1,200만 픽셀 이내 이미지에서 사용할 수 있습니다.');
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason ?? Error('이미지 작업을 취소했습니다.')); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); if (signal.aborted) reject(signal.reason); else resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
async function decodeImage(blob: Blob, signal: AbortSignal): Promise<HTMLImageElement> {
  signal.throwIfAborted(); const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      const finish = () => { signal.removeEventListener('abort', abort); image.onload = null; image.onerror = null; };
      const abort = () => { finish(); image.src = ''; reject(signal.reason); };
      image.onload = () => { finish(); resolve(image); };
      image.onerror = () => { finish(); reject(Error('원본 이미지 파일을 화면에서 읽지 못했습니다.')); };
      signal.addEventListener('abort', abort, { once: true }); image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}
function canvas(width: number, height: number) {
  dimensions(width, height); const value = document.createElement('canvas'); value.width = width; value.height = height;
  const context = value.getContext('2d'); if (!context) throw Error('이 브라우저에서 이미지 문구 편집을 사용할 수 없습니다.');
  return { canvas: value, context };
}

/** Read only authenticated app files, and bind the decoded visible orientation
 * to the exact SHA-256 source proof returned by the current role's endpoint. */
export async function readFreeImageSource(productId: string, version: string, sourceKey: string, role: FreeImageRole,
  signal: AbortSignal, fetcher: typeof fetch = fetch, quotationTarget?: FreeImageQuotationRequest): Promise<FreeImageLoaded> {
  signal.throwIfAborted();
  const response = await fetcher(`/api/products/${encodeURIComponent(productId)}/image-text?${new URLSearchParams({ sourceKey, role, ...(quotationTarget ? quotationSourceQuery(quotationTarget, role, sourceKey) : {}) })}`, { signal, cache: 'no-store' });
  const body = await response.json() as { source?: unknown; error?: string }; signal.throwIfAborted();
  if (!response.ok) throw Error(body.error || '현재 역할의 이미지 원본을 확인하지 못했습니다.');
  const source = validateFreeImageSource(body.source);
  if (source.productId !== productId || source.productVersion !== version || source.sourceKey !== sourceKey || source.role !== role
    || !sameFreeImageQuotationRequest(source.quotationTarget, quotationTarget)) throw Error('상품·이미지·역할 또는 저장 버전이 변경됐습니다. 최신 저장본에서 다시 선택해주세요.');
  const file = await fetcher(`/api/files/${sourceKey.split('/').map(encodeURIComponent).join('/')}`, { signal, cache: 'no-store' });
  if (!file.ok) throw Error('번역할 원본 파일을 읽지 못했습니다.');
  const blob = await file.blob(); signal.throwIfAborted();
  if (!blob.size || blob.size > MAX_IMAGE_BYTES) throw Error('원본 이미지는 10MB 이내 파일로 선택해주세요.');
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()); signal.throwIfAborted();
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (sha256 !== source.sourceSha256) throw Error('선택한 이미지 원본이 변경됐습니다. 다시 확인해주세요.');
  const image = await decodeImage(blob, signal); signal.throwIfAborted();
  const width = image.naturalWidth, height = image.naturalHeight; dimensions(width, height);
  if (!(width === source.width && height === source.height || width === source.height && height === source.width)) throw Error('원본의 표시 크기와 저장된 이미지 정보가 다릅니다.');
  const oriented = canvas(width, height); oriented.context.drawImage(image, 0, 0);
  return { source, blob, canvas: oriented.canvas, width, height };
}

/** Tesseract lines, never an invented full-image rectangle. An unreadable line
 * stays outside the replacement set until the user adds/corrects a region. */
export function readOcrRegions(data: unknown, width: number, height: number): FreeImageRegion[] {
  dimensions(width, height);
  if (!data || typeof data !== 'object' || !Array.isArray((data as { blocks?: unknown }).blocks)) throw Error('이미지의 문구 영역을 읽지 못했습니다. 원본을 확인한 뒤 영역을 직접 추가할 수 있습니다.');
  const regions: FreeImageRegion[] = []; let characters = 0;
  for (const block of (data as { blocks: unknown[] }).blocks) {
    if (!block || typeof block !== 'object' || !Array.isArray((block as { paragraphs?: unknown }).paragraphs)) throw Error('문구 인식 결과의 영역 정보를 확인하지 못했습니다.');
    for (const paragraph of (block as { paragraphs: unknown[] }).paragraphs) {
      if (!paragraph || typeof paragraph !== 'object' || !Array.isArray((paragraph as { lines?: unknown }).lines)) throw Error('문구 인식 결과의 줄 정보를 확인하지 못했습니다.');
      for (const line of (paragraph as { lines: unknown[] }).lines) {
        const current = line as { text?: unknown; confidence?: unknown; bbox?: { x0?: unknown; y0?: unknown; x1?: unknown; y1?: unknown } };
        if (!current || typeof current.text !== 'string' || !current.text.trim()) continue;
        const text = current.text.trim(), bbox = current.bbox;
        if (!bbox || ![bbox.x0, bbox.y0, bbox.x1, bbox.y1].every(Number.isSafeInteger)) throw Error('문구 인식 결과의 좌표를 확인하지 못했습니다.');
        const box = validateOcrBox({ x: Number(bbox.x0), y: Number(bbox.y0), width: Number(bbox.x1) - Number(bbox.x0), height: Number(bbox.y1) - Number(bbox.y0) }, width, height);
        characters += text.length;
        if (regions.length >= MAX_OCR_REGIONS || characters > MAX_OCR_TEXT || text.length > 5000) throw Error('인식 결과가 100개 영역 또는 총 20,000자를 초과했습니다. 이미지를 나누거나 필요한 문구 영역을 직접 추가해주세요.');
        validateImageTextRegions([{ id: 'line', text }]);
        const confidence = typeof current.confidence === 'number' && Number.isFinite(current.confidence) ? Math.max(0, Math.min(100, current.confidence)) : 0;
        regions.push({ id: `ocr-${regions.length + 1}`, text, box, confidence, selected: confidence >= 50, translated: '', issue: null,
          translationProvenance: 'empty', background: '#ffffff', foreground: '#111111', fontSize: Math.max(1, Math.min(200, Math.floor(box.height * 0.8))) });
      }
    }
  }
  if (!regions.length) throw Error('읽을 수 있는 문구를 찾지 못했습니다. 필요한 영역과 원문을 직접 추가해주세요.');
  return regions;
}

export async function recognizeFreeImage(image: FreeImageLoaded, sourceLanguage: 'zh' | 'en', signal: AbortSignal,
  onProgress: (message: string) => void = () => {}, factory?: OcrWorkerFactory): Promise<FreeImageRegion[]> {
  dimensions(image.width, image.height); signal.throwIfAborted();
  const previous = workerSlot; let release: () => void = () => {};
  const lifetime = new Promise<void>(resolve => { release = resolve; }); workerSlot = previous.then(() => lifetime);
  let worker: OcrWorker | null = null, terminated: Promise<unknown> | null = null;
  let starting: Promise<OcrWorker> | null = null;
  const terminate = () => { if (worker && !terminated) terminated = worker.terminate().catch(() => {}); return terminated; };
  const abort = () => { void terminate(); }; signal.addEventListener('abort', abort, { once: true });
  try {
    await abortable(previous, signal); signal.throwIfAborted();
    const create: OcrWorkerFactory = factory ?? ((languages, oem, options) => import('@/app/free-ocr-worker').then(module => module.createFreeOcrWorker(languages, oem, options, signal)));
    const options = { workerPath: '/ocr/7.0.0/worker.min.js', corePath: '/ocr/7.0.0/core', langPath: '/ocr/7.0.0/lang', workerBlobURL: false,
      logger: (message: LoggerMessage) => { if (!signal.aborted) onProgress(message.status === 'recognizing text' ? `문구 인식 ${Math.round(message.progress * 100)}%` : '문구 인식 도구 준비 중'); } };
    starting = create(sourceLanguage === 'zh' ? ['chi_sim', 'eng'] : ['eng'], 1, options).then(value => {
      worker = value; if (signal.aborted) { void terminate(); throw signal.reason; } return value;
    });
    const readyWorker = await abortable(starting, signal); signal.throwIfAborted();
    const result = await abortable(readyWorker.recognize(image.canvas, { rotateAuto: false }, { blocks: true, text: true }), signal);
    signal.throwIfAborted(); return readOcrRegions(result.data, image.width, image.height);
  } finally {
    signal.removeEventListener('abort', abort);
    if (starting && !worker) {
      // The SDK exposes its handle only after language initialization. A late
      // cancelled handle is terminated before another worker can be created.
      void starting.then(() => terminate(), () => terminate()).finally(release);
    } else { try { await terminate(); } finally { release(); } }
  }
}

export type FreeImageTranslationReply = { source: FreeImageSource; regions: ImageTextTranslation[]; requests: number; stoppedHttpStatus: number | null; warnings: string[] };
export function readFreeImageTranslationReply(input: unknown, source: FreeImageSource, requested: readonly ImageTextRegion[]): FreeImageTranslationReply {
  const fail = () => { throw Error('번역 응답의 원본·문구 연결이 요청과 다릅니다. 기존 편집값은 유지합니다.'); };
  if (!input || typeof input !== 'object') return fail();
  const body = input as FreeImageTranslationReply;
  if (!sameFreeImageSource(body.source, source) || !Array.isArray(body.regions) || body.regions.length !== requested.length
    || !Number.isSafeInteger(body.requests) || body.requests < 0 || body.requests > 49
    || !(body.stoppedHttpStatus === null || body.stoppedHttpStatus === 429 || Number.isInteger(body.stoppedHttpStatus) && body.stoppedHttpStatus >= 500 && body.stoppedHttpStatus <= 599)
    || !Array.isArray(body.warnings) || body.warnings.length > 100 || body.warnings.some(value => typeof value !== 'string' || value.length > 2000)) return fail();
  const requestedIds = new Map(requested.map(row => [row.id, row.text])), found = new Map<string, ImageTextTranslation>();
  for (const row of body.regions) {
    if (!row || !requestedIds.has(row.id) || found.has(row.id) || row.original !== requestedIds.get(row.id)
      || !(row.translated === null || typeof row.translated === 'string' && !!row.translated.trim() && row.translated.length <= 5000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(row.translated))
      || !(row.issue === null || typeof row.issue === 'string' && row.issue.length <= 2000)) return fail();
    found.set(row.id, row);
  }
  return { ...body, regions: requested.map(row => found.get(row.id)!) };
}
export async function translateFreeImageRegions(source: FreeImageSource, sourceLanguage: 'zh' | 'en', regions: readonly ImageTextRegion[],
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<FreeImageTranslationReply> {
  validateFreeImageSource(source); const requested = validateImageTextRegions(regions); signal.throwIfAborted();
  const response = await fetcher(`/api/products/${encodeURIComponent(source.productId)}/image-text`, { method: 'POST', signal,
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'translate', source, sourceLanguage, regions: requested }) });
  const body = await response.json() as { error?: string }; signal.throwIfAborted();
  if (!response.ok) throw Error(body.error || '이미지 문구 번역을 받지 못했습니다. 원문과 편집값은 유지합니다.');
  return readFreeImageTranslationReply(body, source, requested);
}

function wrappedLines(context: CanvasRenderingContext2D, value: string, maximumWidth: number) {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r\n|[\r\n]/u)) {
    let line = '';
    for (const character of Array.from(paragraph)) {
      if (line && context.measureText(line + character).width > maximumWidth) { lines.push(line); line = character; } else line += character;
    }
    lines.push(line);
  }
  return lines;
}
/** Only chosen rectangles are painted. This preserves every pixel outside
 * them; a flat fill is a reviewed text replacement, not AI reconstruction. */
export async function renderFreeImageTranslation(image: FreeImageLoaded, regions: readonly FreeImageRegion[], signal: AbortSignal, optionImageIds: readonly string[] = []): Promise<FreeImageRendered> {
  dimensions(image.width, image.height); signal.throwIfAborted();
  const selectedOptions = validateFreeImageOptionIds(image.source, [...optionImageIds]);
  if (image.source.optionImages?.commonAssigned === false && !selectedOptions.length) throw Error('이 개별 사진을 반영할 옵션을 한 개 이상 선택해주세요. 공통 대표 이미지는 변경하지 않습니다.');
  const chosen = regions.filter(row => row.selected);
  if (!chosen.length || chosen.length > MAX_OCR_REGIONS) throw Error('이미지에 적용할 문구 영역을 선택해주세요.');
  validateImageTextRegions(chosen.map(region => ({ id: region.id, text: region.translated })));
  const ids = new Set<string>(); let total = 0;
  for (const region of chosen) {
    validateOcrBox(region.box, image.width, image.height);
    if (ids.has(region.id) || typeof region.translated !== 'string' || !region.translated.trim() || region.translated.length > 5000
      || !/^#[a-f0-9]{6}$/iu.test(region.background) || !/^#[a-f0-9]{6}$/iu.test(region.foreground)
      || !Number.isInteger(region.fontSize) || region.fontSize < 1 || region.fontSize > 200) throw Error('선택한 번역 문구·색상·글자 크기를 확인해주세요.');
    ids.add(region.id); total += region.translated.length;
  }
  if (total > MAX_OCR_TEXT) throw Error('적용할 문구는 총 20,000자 이내로 입력해주세요.');
  const output = canvas(image.width, image.height); output.context.drawImage(image.canvas, 0, 0);
  for (const region of chosen) {
    signal.throwIfAborted(); const { x, y, width, height } = region.box;
    const padding = Math.min(3, Math.floor(Math.min(width, height) / 10)), maximumWidth = Math.max(1, width - padding * 2), maximumHeight = Math.max(1, height - padding * 2);
    let fontSize = region.fontSize, lines: string[] = [], lineHeight = 0;
    for (; fontSize >= 1; fontSize--) {
      output.context.font = `${fontSize}px Arial, "Noto Sans KR", sans-serif`;
      lines = wrappedLines(output.context, region.translated, maximumWidth); lineHeight = fontSize * 1.2;
      if (lines.length * lineHeight <= maximumHeight && lines.every(line => output.context.measureText(line).width <= maximumWidth)) break;
    }
    if (fontSize < 1) throw Error('문구가 선택 영역에 들어가지 않습니다. 문구를 줄이거나 영역 크기를 조절해주세요.');
    output.context.save(); output.context.beginPath(); output.context.rect(x, y, width, height); output.context.clip();
    output.context.fillStyle = region.background; output.context.fillRect(x, y, width, height);
    output.context.fillStyle = region.foreground; output.context.textBaseline = 'top';
    lines.forEach((line, index) => output.context.fillText(line, x + padding, y + padding + index * lineHeight));
    output.context.restore();
  }
  const blob = await abortable(new Promise<Blob>((resolve, reject) => output.canvas.toBlob(value => value ? resolve(value) : reject(Error('번역 이미지 미리보기를 만들지 못했습니다.')), 'image/png')), signal);
  signal.throwIfAborted();
  if (!blob.size || blob.size > MAX_IMAGE_BYTES) throw Error('번역 이미지가 10MB를 초과합니다. 원본 크기를 줄여주세요.');
  return { source: image.source, output: blob, width: image.width, height: image.height, ...(selectedOptions.length ? { optionImageIds: selectedOptions } : {}) };
}

export class FreeImageApplyError extends Error { constructor(message: string, public uncertain: boolean) { super(message); } }
export type FreeImageApplyReply = { source: FreeImageSource; key: string; productVersion: string; contentRevision: number; applied: true; replayed?: boolean; optionImageIds?: string[]; optionRevision?: number; quotationRevision?: number; quotationInputFingerprint?: string };
export async function expectedFreeImageOutputKey(image: FreeImageRendered): Promise<string> {
  const source = validateFreeImageSource(image.source), owner = source.sourceKey.split('/')[0];
  if (!isOwnedImageKey(owner, source.sourceKey)) throw new FreeImageApplyError('원본 이미지 저장 범위를 확인해주세요.', false);
  const identity = freeImageApplyIdentity(source, image.optionImageIds ?? []);
  const digest = async (bytes: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), byte => byte.toString(16).padStart(2, '0')).join('');
  const [fingerprint, outputSha256] = await Promise.all([digest(new TextEncoder().encode(identity)), digest(await image.output.arrayBuffer())]);
  return `${owner}/free-image-${source.productId}-${fingerprint}-${outputSha256}.png`;
}
export function readFreeImageApplyReply(input: unknown, image: FreeImageRendered, expectedKey: string): FreeImageApplyReply {
  const body = input as FreeImageApplyReply, owner = image.source.sourceKey.split('/')[0];
  const ids = validateFreeImageOptionIds(image.source, image.optionImageIds ?? []);
  const quotationTarget = image.source.quotationTarget;
  const contentDelta = quotationTarget || image.source.optionImages?.commonAssigned === false ? 0 : 1;
  if (!body || image.source.optionImages?.commonAssigned === false && !ids.length
    || !sameFreeImageSource(body.source, image.source) || body.applied !== true || !isOwnedImageKey(owner, body.key)
    || body.key === image.source.sourceKey || body.key !== expectedKey || typeof body.productVersion !== 'string' || !Number.isFinite(Date.parse(body.productVersion))
    || Date.parse(body.productVersion) <= Date.parse(image.source.productVersion) || !Number.isSafeInteger(body.contentRevision)
    || (body.replayed === true ? body.contentRevision < image.source.contentRevision + contentDelta : body.contentRevision !== image.source.contentRevision + contentDelta)
    || body.replayed !== undefined && typeof body.replayed !== 'boolean'
    || ids.length === 0 && body.optionImageIds !== undefined && (!Array.isArray(body.optionImageIds) || body.optionImageIds.length > 0)
    || ids.length > 0 && (JSON.stringify(body.optionImageIds) !== JSON.stringify(ids) || !Number.isSafeInteger(body.optionRevision)
      || (body.replayed === true ? body.optionRevision! < image.source.optionImages!.revision + 1 : body.optionRevision !== image.source.optionImages!.revision + 1))
    || quotationTarget && (ids.length > 0 || body.contentRevision !== image.source.contentRevision || body.optionRevision !== quotationTarget.optionRevision
      || body.quotationRevision !== quotationTarget.revision + 1 || typeof body.quotationInputFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.quotationInputFingerprint))) {
    throw new FreeImageApplyError('저장 응답의 원본·결과 연결을 확인하지 못했습니다. 같은 미리보기의 저장 상태를 다시 확인해주세요.', true);
  }
  return body;
}
export type FreeImageRecoveryReply = FreeImageApplyReply | { source: FreeImageSource; key: string; applied: false };
/** A quotation retry first checks the exact PNG digest without uploading it.
 * Only a verified fresh, unapplied response permits a separate explicit save. */
export async function recoverFreeImageTranslation(image: FreeImageRendered, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<FreeImageRecoveryReply> {
  validateFreeImageSource(image.source); signal.throwIfAborted();
  if (!image.source.quotationTarget || image.output.type !== 'image/png' || !image.output.size || image.output.size > MAX_IMAGE_BYTES) throw new FreeImageApplyError('저장 상태를 확인할 옵션 이미지 미리보기를 확인해주세요.', true);
  const expectedKey = await expectedFreeImageOutputKey(image);
  const outputSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await image.output.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
  signal.throwIfAborted();
  let response: Response, body: unknown;
  try {
    response = await fetcher(`/api/products/${encodeURIComponent(image.source.productId)}/image-text`, { method: 'POST', signal,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'recover', source: image.source, outputSha256, outputBytes: image.output.size }) });
    body = await response.json();
  } catch { throw new FreeImageApplyError('같은 미리보기의 저장 상태를 확인하지 못했습니다. 다시 확인해주세요.', true); }
  signal.throwIfAborted();
  if (!response.ok) throw new FreeImageApplyError((body as { error?: string })?.error || '같은 미리보기의 저장 상태를 확인하지 못했습니다.', true);
  if ((body as FreeImageRecoveryReply)?.applied === true) return readFreeImageApplyReply(body, image, expectedKey);
  const recovered = body as FreeImageRecoveryReply;
  if (!recovered || recovered.applied !== false || !sameFreeImageSource(recovered.source, image.source) || recovered.key !== expectedKey
    || Object.keys(recovered).some(key => !['source', 'key', 'applied'].includes(key))) throw new FreeImageApplyError('저장 상태 응답의 이미지 연결을 확인하지 못했습니다. 같은 미리보기로 다시 확인해주세요.', true);
  return recovered;
}
/** Reuse the exact source proof and PNG on an explicit uncertain-outcome retry.
 * Never refetch, rerender, or perform an automatic second save. */
export async function applyFreeImageTranslation(image: FreeImageRendered, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<FreeImageApplyReply> {
  validateFreeImageSource(image.source); signal.throwIfAborted();
  if (image.output.type !== 'image/png' || !image.output.size || image.output.size > MAX_IMAGE_BYTES) throw new FreeImageApplyError('저장할 PNG 미리보기를 확인해주세요.', false);
  const expectedKey = await expectedFreeImageOutputKey(image); signal.throwIfAborted();
  const form = new FormData(); form.set('action', 'apply'); form.set('source', JSON.stringify(image.source));
  const ids = validateFreeImageOptionIds(image.source, image.optionImageIds ?? []);
  if (ids.length) form.set('optionImageIds', JSON.stringify(ids));
  form.set('file', new File([image.output], 'translated-text.png', { type: 'image/png' }));
  let response: Response;
  try { response = await fetcher(`/api/products/${encodeURIComponent(image.source.productId)}/image-text`, { method: 'POST', signal, body: form }); }
  catch { throw new FreeImageApplyError('저장 응답을 확인하지 못했습니다. 같은 결과를 다시 확인하면 중복 이미지 적용을 피할 수 있습니다.', true); }
  let body: unknown;
  try { body = await response.json(); } catch { throw new FreeImageApplyError('저장 응답을 읽지 못했습니다. 같은 미리보기의 저장 상태를 다시 확인해주세요.', true); }
  signal.throwIfAborted();
  if (!response.ok) throw new FreeImageApplyError((body as { error?: string })?.error || '번역 이미지 적용을 확인하지 못했습니다.', response.status >= 500);
  return readFreeImageApplyReply(body, image, expectedKey);
}
