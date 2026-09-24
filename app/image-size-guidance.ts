/** Supplier Hub bulk-upload guidance observed 2026-09-24. Advisory, not acceptance validation. */
export function imageSizeGuidance(role: string, width: number, height: number): string[] {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) return ['이미지 픽셀 크기를 확인하지 못했습니다.'];
  if (['main', 'mainImage'].includes(role) && (width < 1000 || height < 1000)) return ['대표 이미지는 1,000×1,000px 이상 권장'];
  if (['detailTop', 'detail', 'detailBottom', 'detailImages'].includes(role) && (width !== 780 || height > 1500)) return ['상세 이미지는 개당 가로 780px·세로 1,500px 이내 안내'];
  return [];
}
