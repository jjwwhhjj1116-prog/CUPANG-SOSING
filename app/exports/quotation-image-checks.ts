import type { ResolvedQuotation } from '@/app/quotation-schema';
import type { BundleAsset } from '@/app/exports/review-bundle';
import type { ImageCheck } from '@/app/quotation-image-review';
import { imageFileType, MAX_IMAGE_BYTES } from '@/app/image-files';
import { imageDimensions } from '@/app/image-dimensions';
import { imageSizeGuidance } from '@/app/image-size-guidance';

/** Inspect exactly the bytes being archived, without additional network reads. */
export function inspectQuotationAssets(resolved: ResolvedQuotation, assets: readonly BundleAsset[]): Map<string, ImageCheck> {
  const roles = new Map<string, Set<string>>();
  for (const row of resolved.rows.filter(row => row.included)) {
    for (const field of resolved.schema.fields.filter(field => field.type === 'images')) {
      for (const key of (row.fields[field.id]?.value ?? '').split('\n').map(value => value.trim()).filter(Boolean)) {
        if (!roles.has(key)) roles.set(key, new Set());
        roles.get(key)!.add(field.id);
      }
    }
  }
  const byKey = new Map(assets.map(asset => [asset.key, asset]));
  const checks = new Map<string, ImageCheck>();
  for (const [key, uses] of roles) {
    const data = byKey.get(key)?.data;
    if (!data?.byteLength || data.byteLength > MAX_IMAGE_BYTES) {
      checks.set(key, { kind: 'error', message: '첨부 이미지 파일이 없거나 허용 크기를 벗어났습니다.' });
      continue;
    }
    try { imageFileType(data); }
    catch { checks.set(key, { kind: 'error', message: '첨부 이미지 파일 형식을 확인해주세요.' }); continue; }
    if (!uses.has('mainImage') && !uses.has('detailImages')) continue;
    const size = imageDimensions(data);
    if (!size) {
      checks.set(key, { kind: 'review', message: '첨부 파일에서 픽셀 크기를 읽지 못했습니다. 원본 이미지 크기를 확인해주세요.' });
      continue;
    }
    const messages = [...uses].flatMap(role => imageSizeGuidance(role, size.width, size.height));
    if (messages.length) checks.set(key, { kind: 'review', message: `첨부 이미지 ${size.width}×${size.height}px: ${messages.join(' / ')}. 파일 헤더 기준이며 화질·실제 접수 검증은 아닙니다.` });
  }
  return checks;
}
