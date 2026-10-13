export type FreeImageCropRect = { x: number; y: number; width: number; height: number };
/** Coordinates refer to the decoded, oriented original canvas, before any
 * overlays or cropping. The source proof continues to identify its raw bytes. */
export type FreeImageCrop = FreeImageCropRect & { sourceWidth: number; sourceHeight: number };
const rectangleKeys = ['x', 'y', 'width', 'height'];
export function validateFreeImageCropRect(value: unknown, width: number, height: number): FreeImageCropRect {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !rectangleKeys.includes(key))
    || ![width, height].every(dimension => Number.isSafeInteger(dimension) && dimension > 0 && dimension <= 16000)) {
    throw Error('잘라낼 영역은 원본 이미지 안의 정수 픽셀로 지정해주세요.');
  }
  const rect = value as FreeImageCropRect;
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger)
    || rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1
    || rect.x > width - rect.width || rect.y > height - rect.height) {
    throw Error('잘라낼 영역은 원본 이미지 안의 정수 픽셀로 지정해주세요.');
  }
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
export function validateFreeImageCrop(value: unknown, source: { width: number; height: number }): FreeImageCrop {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => ![...rectangleKeys, 'sourceWidth', 'sourceHeight'].includes(key))) {
    throw Error('잘라낸 이미지의 원본 크기와 영역을 확인해주세요.');
  }
  const crop = value as FreeImageCrop;
  if (![source.width, source.height, crop.sourceWidth, crop.sourceHeight].every(dimension => Number.isSafeInteger(dimension) && dimension > 0 && dimension <= 16000)
    || !(crop.sourceWidth === source.width && crop.sourceHeight === source.height
      || crop.sourceWidth === source.height && crop.sourceHeight === source.width)) {
    throw Error('잘라낼 원본의 표시 크기가 저장된 이미지 정보와 다릅니다.');
  }
  const rect = validateFreeImageCropRect({ x: crop.x, y: crop.y, width: crop.width, height: crop.height }, crop.sourceWidth, crop.sourceHeight);
  return { ...rect, sourceWidth: crop.sourceWidth, sourceHeight: crop.sourceHeight };
}
