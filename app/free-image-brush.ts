import { MAX_OCR_PIXELS } from '@/app/free-image-translation';

export const MAX_FREE_IMAGE_BRUSH_POINTS = 2048;
export const MAX_FREE_IMAGE_BRUSH_TOTAL_POINTS = 8192;
export type FreeImageBrushPoint = { x: number; y: number };
export type FreeImageBrush = { size: number; points: FreeImageBrushPoint[] };
export type FreeImageBrushBox = { x: number; y: number; width: number; height: number };

const invalid = () => { throw Error('브러시 크기·경로·영역을 확인해주세요.'); };
function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
function readBrush(size: unknown, points: unknown, width: number, height: number): FreeImageBrush {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 16000 || height > 16000 || width * height > MAX_OCR_PIXELS
    || !Number.isSafeInteger(size) || (size as number) < 1 || (size as number) > 200
    || !Array.isArray(points) || !points.length || points.length > MAX_FREE_IMAGE_BRUSH_POINTS) return invalid();
  return { size: size as number, points: Array.from(points, point => {
    if (!exactObject(point, ['x', 'y']) || !Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y)
      || (point.x as number) < 0 || (point.y as number) < 0 || (point.x as number) >= width || (point.y as number) >= height) return invalid();
    return { x: point.x as number, y: point.y as number };
  }) };
}
function brushBox(brush: FreeImageBrush, width: number, height: number): FreeImageBrushBox {
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (const point of brush.points) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); }
  const radius = brush.size / 2, x = Math.max(0, Math.floor(minX - radius)), y = Math.max(0, Math.floor(minY - radius));
  return { x, y, width: Math.min(width, Math.ceil(maxX + radius)) - x, height: Math.min(height, Math.ceil(maxY + radius)) - y };
}

/** A completed gesture owns its coordinates; only consecutive idle moves are removed. */
export function createFreeImageBrush(size: number, points: readonly FreeImageBrushPoint[], width: number, height: number) {
  const brush = readBrush(size, points, width, height);
  brush.points = brush.points.filter((point, index, all) => !index || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
  return { brush, box: brushBox(brush, width, height) };
}

/** Existing paths are checked without deduplication, coercion or input mutation. */
export function validateFreeImageBrush(value: unknown, box: unknown, width: number, height: number) {
  if (!exactObject(value, ['size', 'points'])) return invalid();
  const brush = readBrush(value.size, value.points, width, height), expected = brushBox(brush, width, height);
  if (!exactObject(box, ['x', 'y', 'width', 'height']) || Object.entries(expected).some(([key, number]) => box[key] !== number)) return invalid();
  return { brush, box: expected };
}
