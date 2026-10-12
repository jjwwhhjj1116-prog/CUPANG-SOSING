import { imageFileType, isOwnedImageKey, MAX_IMAGE_BYTES, PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-files';
import { readBoundedStream } from '@/app/request-body';
import { MAX_ZIP_BYTES, zipFiles } from '@/app/exports/zip';

/** Reads the current selection only. No product write, provider call or public URL is needed. */
export async function imageSelectionArchive(selected: readonly string[], pool: readonly string[], signal: AbortSignal, request: typeof fetch = fetch) {
  // A preserved legacy top/body sharing layout can display the same file in
  // two positions. Indexed names retain both positions without deleting a copy.
  if (!Array.isArray(selected) || !selected.length || selected.length > PRODUCT_IMAGE_POOL_LIMIT
    || selected.some(key => typeof key !== 'string' || !pool.includes(key) || !isOwnedImageKey(key.split('/')[0], key)))
    throw Error('현재 상품에 연결된 이미지를 선택해주세요. 누락된 파일은 먼저 확인해주세요.');
  const files: { name: string; data: Uint8Array }[] = []; let bytes = 22;
  for (const [index, key] of selected.entries()) {
    signal.throwIfAborted();
    const response = await request(`/api/files/${key.split('/').map(encodeURIComponent).join('/')}`, { cache: 'no-store', credentials: 'same-origin', signal });
    if (!response.ok) throw Error(`선택 이미지 ${index + 1}을 내려받지 못했습니다. 선택과 원본 파일은 유지됩니다.`);
    const declared = response.headers.get('content-length');
    if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_IMAGE_BYTES) { await response.body?.cancel(); throw Error('이미지 한 장은 10MB 이하여야 합니다.'); }
    const data = await readBoundedStream(response.body, MAX_IMAGE_BYTES); signal.throwIfAborted();
    const actual = imageFileType(data), contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (contentType !== actual.contentType) throw Error(`선택 이미지 ${index + 1}의 파일 형식을 확인해주세요.`);
    const name = `image-${String(index + 1).padStart(3, '0')}.${actual.extension}`;
    bytes += data.length + 76 + 2 * name.length;
    if (bytes > MAX_ZIP_BYTES) throw Error('이미지 다운로드 ZIP은 30MB 이하여야 합니다. 선택한 이미지 수를 줄여주세요.');
    files.push({ name, data });
  }
  signal.throwIfAborted(); return zipFiles(files);
}

export async function downloadImageSelection(selected: readonly string[], pool: readonly string[], filename: string, signal: AbortSignal) {
  if (!/^YOOFAM-[A-Za-z0-9_-]{1,100}\.zip$/.test(filename)) throw Error('이미지 다운로드 파일명을 확인해주세요.');
  const bytes = await imageSelectionArchive(selected, pool, signal); signal.throwIfAborted();
  const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/zip' }));
  try { const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
