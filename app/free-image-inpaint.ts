/** Limits apply before allocating a Worker or copying image pixels. The OCR
 * rectangle is the mask, not a claim about product/foreground segmentation. */
export const FREE_IMAGE_INPAINT_MODE = 'inpaint-telea-v1' as const;
export const FREE_IMAGE_INPAINT_ASSET = '/inpaint/5.0.0-release.1/inpaint-worker-masks-v1.js';
export const MAX_FREE_IMAGE_INPAINT_ROI_PIXELS = 1_500_000;
export const MAX_FREE_IMAGE_INPAINT_TOTAL_PIXELS = 4_000_000;
export const MAX_FREE_IMAGE_INPAINT_REGIONS = 32;
export type InpaintRect = { x: number; y: number; width: number; height: number };
export type InpaintPixels = { width: number; height: number; data: Uint8ClampedArray }
  & ({ mask: InpaintRect; masks?: never } | { masks: readonly InpaintRect[]; mask?: never });
const invalid = () => Error('배경 복원 영역이 너무 크거나 주변 픽셀이 부족합니다. 영역을 나눠 조정해주세요.');
export function freeImageInpaintRoi(box: InpaintRect, width: number, height: number): InpaintRect {
  if (![width, height, box?.x, box?.y, box?.width, box?.height].every(Number.isSafeInteger)
    || width < 1 || height < 1 || box.x < 0 || box.y < 0 || box.width < 1 || box.height < 1
    || box.x > width - box.width || box.y > height - box.height) throw invalid();
  const context = 12, x = Math.max(0, box.x - context), y = Math.max(0, box.y - context);
  const roi = { x, y, width: Math.min(width, box.x + box.width + context) - x, height: Math.min(height, box.y + box.height + context) - y };
  if (roi.width < 3 || roi.height < 3 || roi.width * roi.height > MAX_FREE_IMAGE_INPAINT_ROI_PIXELS
    || roi.width * roi.height - box.width * box.height < 16) throw invalid();
  return roi;
}
export function validateFreeImageInpaintPixels(input: InpaintPixels): void {
  if (!input || !(input.data instanceof Uint8ClampedArray) || input.data.length !== input.width * input.height * 4
    || input.width * input.height > MAX_FREE_IMAGE_INPAINT_ROI_PIXELS) throw invalid();
  if (('mask' in input) === ('masks' in input)) throw invalid();
  if ('masks' in input) validateMasks(input.masks, input.width, input.height);
  else freeImageInpaintRoi(input.mask, input.width, input.height);
}
function validateMasks(masks: readonly InpaintRect[] | undefined, width: number, height: number): void {
  if (!Array.isArray(masks) || masks.length < 1 || masks.length > MAX_FREE_IMAGE_INPAINT_REGIONS) throw invalid();
  for (const box of masks) freeImageInpaintRoi(box, width, height);
  // Count the union so overlapping masks do not consume background twice.
  const xs = [...new Set(masks.flatMap(box => [box.x, box.x + box.width]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < xs.length; i++) {
    const intervals = masks.filter(box => box.x < xs[i] && box.x + box.width > xs[i - 1])
      .map(box => [box.y, box.y + box.height]).sort((a, b) => a[0] - b[0]);
    let end = 0, covered = 0;
    for (const [start, next] of intervals) { covered += Math.max(0, next - Math.max(end, start)); end = Math.max(end, next); }
    area += (xs[i] - xs[i - 1]) * covered;
  }
  if (width * height - area < 16) throw invalid();
}
export type InpaintRoiGroup = { roi: InpaintRect; masks: InpaintRect[]; indexes: number[] };
/** Group intersecting context crops before reading pixels, so no requested
 * glyph can become background for another mask in the same crop. */
export function groupFreeImageInpaintRois(boxes: readonly InpaintRect[], width: number, height: number): InpaintRoiGroup[] {
  if (!Array.isArray(boxes) || boxes.length > MAX_FREE_IMAGE_INPAINT_REGIONS
    || ![width, height].every(Number.isSafeInteger) || width < 1 || height < 1) throw invalid();
  const groups = boxes.map((box, index) => ({ roi: freeImageInpaintRoi(box, width, height), indexes: [index] }));
  let merged: boolean;
  do {
    merged = false;
    scan: for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i].roi, b = groups[j].roi;
      if (a.x >= b.x + b.width || b.x >= a.x + a.width || a.y >= b.y + b.height || b.y >= a.y + a.height) continue;
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      groups[i] = { roi: { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }, indexes: [...groups[i].indexes, ...groups[j].indexes] };
      groups.splice(j, 1); merged = true; break scan;
    }
  } while (merged);
  let total = 0;
  return groups.map(({ roi, indexes }) => {
    if (roi.width * roi.height > MAX_FREE_IMAGE_INPAINT_ROI_PIXELS || (total += roi.width * roi.height) > MAX_FREE_IMAGE_INPAINT_TOTAL_PIXELS) throw invalid();
    indexes.sort((a, b) => a - b);
    const masks = indexes.map(index => ({ ...boxes[index], x: boxes[index].x - roi.x, y: boxes[index].y - roi.y }));
    validateMasks(masks, roi.width, roi.height);
    return { roi, masks, indexes };
  });
}
export type OpenCvInpaint = Pick<typeof import('@techstark/opencv-js'), 'Mat' | 'matFromArray' | 'cvtColor' | 'inpaint' | 'CV_8UC4' | 'CV_8UC1' | 'COLOR_RGBA2RGB' | 'INPAINT_TELEA'>;
/** OpenCV photo.inpaint accepts RGB8UC3 + an 8UC1 mask. Keep the caller's
 * buffer intact, and copy only masked RGB channels; alpha never comes from CV. */
export function inpaintFreeImagePixels(cv: OpenCvInpaint, input: InpaintPixels): Uint8ClampedArray {
  validateFreeImageInpaintPixels(input);
  const mats: { delete(): void }[] = [];
  try {
    const rgba = cv.matFromArray(input.height, input.width, cv.CV_8UC4, input.data); mats.push(rgba);
    const rgb = new cv.Mat(); mats.push(rgb);
    const mask = cv.Mat.zeros(input.height, input.width, cv.CV_8UC1); mats.push(mask);
    const restored = new cv.Mat(); mats.push(restored);
    const boxes = input.masks ?? [input.mask];
    for (const box of boxes) for (let y = box.y; y < box.y + box.height; y++) mask.data.fill(255, y * input.width + box.x, y * input.width + box.x + box.width);
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    cv.inpaint(rgb, mask, restored, 3, cv.INPAINT_TELEA);
    if (restored.rows !== input.height || restored.cols !== input.width || restored.data.length !== input.width * input.height * 3) throw Error('배경 복원 결과의 크기를 확인하지 못했습니다.');
    const result = input.data.slice();
    for (const box of boxes) for (let y = box.y; y < box.y + box.height; y++) for (let x = box.x; x < box.x + box.width; x++) {
      const pixel = y * input.width + x;
      result.set(restored.data.subarray(pixel * 3, pixel * 3 + 3), pixel * 4);
    }
    return result;
  } finally { for (const mat of mats.reverse()) mat.delete(); }
}
