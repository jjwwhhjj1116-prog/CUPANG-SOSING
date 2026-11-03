import { env } from 'cloudflare:workers';
import { imageExtension, type BundleAsset } from '@/app/exports/review-bundle';
import { isOwnedImageKey, PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-files';

export class AttachmentError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function loadAttachments(ownerId: string, productKeysJson: string, requestedKeys: string[], options: { concurrency?: 1 | 3; nativeReadOnly?: true; onVerifiedObject?:(key:string,object:Pick<R2Object,'version'|'size'>)=>void } = {}): Promise<BundleAsset[]> {
  const productKeys: unknown = JSON.parse(productKeysJson);
  const keys = [...new Set(requestedKeys)];
  if (!Array.isArray(productKeys) || keys.length > PRODUCT_IMAGE_POOL_LIMIT || keys.some(key => !isOwnedImageKey(ownerId, key) || !productKeys.includes(key))) throw new AttachmentError('상품의 첨부 이미지 참조를 확인해주세요.', 409);
  const assets: BundleAsset[] = []; let total = 0;
  const limit = (options.nativeReadOnly ? 64 : 20) * 1024 * 1024;
  const preflight = new Map<string,number>();
  if (options.nativeReadOnly) {
    const heads = await Promise.all(keys.map(key => env.FILES.head(key)));let size=0;
    for (const [index,head] of heads.entries()) {
      if (!head) throw new AttachmentError('첨부 이미지가 저장소에 없습니다.',409);
      if (!Number.isSafeInteger(head.size) || head.size < 1 || head.size > 10 * 1024 * 1024) throw new AttachmentError('원본 이미지 파일은 10MB 이하여야 합니다.',413);
      size+=head.size;if(size>limit)throw new AttachmentError('원본 이미지 합계는 64MB 이하여야 합니다.',413);
      preflight.set(keys[index],head.size);
    }
  }
  const concurrency = options.concurrency === 3 ? 3 : 1;
  for (let offset = 0; offset < keys.length; offset += concurrency) {
    const batch = keys.slice(offset, offset + concurrency);
    const fetched = await Promise.allSettled(batch.map(key => env.FILES.get(key)));
    const objects = fetched.map(result => {
      if (result.status === 'rejected') throw result.reason;
      if (!result.value) throw new AttachmentError('첨부 이미지가 저장소에 없습니다.', 409);
      return result.value;
    });
    // Reserve the entire bounded batch before reading any bodies. Concurrency
    // must not weaken the export's aggregate memory/size limit.
    for (const [index,object] of objects.entries()) {
      if(options.nativeReadOnly&&preflight.get(batch[index])!==object.size)throw new AttachmentError('조회 중 원본 이미지 크기가 변경됐습니다.',409);
      total += object.size;
      if (total > limit) throw new AttachmentError(options.nativeReadOnly?'원본 이미지 합계는 64MB 이하여야 합니다.':'첨부 이미지 합계는 20MB 이하여야 합니다.', 413);
    }
    const loaded = await Promise.allSettled(objects.map(async (object, position) => {
      const data = new Uint8Array(await object.arrayBuffer());
      if(options.nativeReadOnly&&data.byteLength!==object.size)throw new AttachmentError('원본 이미지의 실제 크기가 다릅니다.',409);
      let extension: string;
      try { extension = imageExtension(data); } catch { throw new AttachmentError('지원하지 않는 이미지 형식이 포함되어 있습니다.', 400); }
      const digest = await crypto.subtle.digest('SHA-256', data);
      const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      options.onVerifiedObject?.(batch[position],object);
      return { key: batch[position], name: `assets/image-${String(offset + position + 1).padStart(3, '0')}.${extension}`, data, sha256 };
    }));
    for (const result of loaded) {
      if (result.status === 'rejected') throw result.reason;
      assets.push(result.value);
    }
  }
  return assets;
}
