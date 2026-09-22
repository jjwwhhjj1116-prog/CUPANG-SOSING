import { env } from 'cloudflare:workers';
import { imageExtension, type BundleAsset } from '@/app/exports/review-bundle';
import { isOwnedImageKey } from '@/app/image-files';

export class AttachmentError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function loadAttachments(ownerId: string, productKeysJson: string, requestedKeys: string[]): Promise<BundleAsset[]> {
  const productKeys: unknown = JSON.parse(productKeysJson);
  const keys = [...new Set(requestedKeys)];
  if (!Array.isArray(productKeys) || keys.length > 50 || keys.some(key => !isOwnedImageKey(ownerId, key) || !productKeys.includes(key))) throw new AttachmentError('상품의 첨부 이미지 참조를 확인해주세요.', 409);
  const assets: BundleAsset[] = []; let total = 0;
  for (const [index, key] of keys.entries()) {
    const object = await env.FILES.get(key);
    if (!object) throw new AttachmentError('첨부 이미지가 저장소에 없습니다.', 409);
    total += object.size;
    if (total > 20 * 1024 * 1024) throw new AttachmentError('첨부 이미지 합계는 20MB 이하여야 합니다.', 413);
    const data = new Uint8Array(await object.arrayBuffer());
    let extension: string;
    try { extension = imageExtension(data); } catch { throw new AttachmentError('지원하지 않는 이미지 형식이 포함되어 있습니다.', 400); }
    assets.push({ key, name: `assets/image-${String(index + 1).padStart(3, '0')}.${extension}`, data });
  }
  return assets;
}
