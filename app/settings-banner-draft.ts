import { isOwnedImageKey, MAX_IMAGE_BYTES } from '@/app/image-files';

export type SettingsBannerKey = 'topImageKey' | 'bottomImageKey';
export type SettingsBannerDraft = { file: File; previewUrl: string; uploadedKey?: string };
export type SettingsBannerDrafts = Partial<Record<SettingsBannerKey, SettingsBannerDraft>>;

/** Local checks never replace the upload route's image-byte validation. */
export function validateSettingsBannerFile(file: File): File {
  if (!(file instanceof File) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_IMAGE_BYTES)
    throw Error('공통 이미지는 10MB 이하의 이미지 파일을 선택해주세요.');
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(file.type))
    throw Error('공통 이미지는 PNG·JPEG·WebP·GIF·AVIF만 지원합니다.');
  return file;
}

/** Upload acknowledgement must be an owned key, never a URL or another account. */
export async function uploadSettingsBanner(file: File, signal: AbortSignal, ownerId?: string, fetcher: typeof fetch = fetch): Promise<string> {
  validateSettingsBannerFile(file);
  if (signal.aborted) throw Error('공통 이미지 저장을 취소했습니다.');
  const form = new FormData(); form.set('file', file);
  const response = await fetcher('/api/files', {method: 'POST', body: form, signal});
  const body = await response.json() as {key?: unknown; error?: unknown};
  if (signal.aborted) throw Error('공통 이미지 저장을 취소했습니다.');
  if (!response.ok) throw Error(typeof body?.error === 'string' ? body.error : '이미지를 업로드하지 못했습니다.');
  const key = body?.key;
  if (typeof key !== 'string' || !isOwnedImageKey(ownerId ?? key.split('/')[0], key)) throw Error('공통 이미지 저장 경로의 계정을 확인하지 못했습니다.');
  return key;
}
