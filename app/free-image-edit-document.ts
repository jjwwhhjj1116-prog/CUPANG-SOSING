import type { FreeImageRegion } from '@/app/free-image-translation-client';
import { MAX_OCR_PIXELS, MAX_OCR_REGIONS, MAX_OCR_TEXT, type FreeImageSource } from '@/app/free-image-translation';
import { validateFreeImageCrop, type FreeImageCrop } from '@/app/free-image-crop';
import { validateFreeImageBrush, MAX_FREE_IMAGE_BRUSH_TOTAL_POINTS } from '@/app/free-image-brush';
import { resolveFreeImageTextStyle } from '@/app/free-image-text-style';

export type FreeImageEditDocument = {
  format: 'free-image-edit-v1';
  width: number;
  height: number;
  sourceLanguage: 'zh' | 'en';
  regions: FreeImageRegion[];
  crop?: FreeImageCrop;
};
export const MAX_FREE_IMAGE_EDIT_BYTES = 512 * 1024;

const documentKeys = ['format', 'width', 'height', 'sourceLanguage', 'regions', 'crop'];
const regionKeys = ['id', 'text', 'box', 'confidence', 'selected', 'translated', 'issue', 'translationProvenance',
  'background', 'foreground', 'fontSize', 'erase', 'brush', 'fontFamily', 'bold', 'italic', 'textAlign', 'lineHeight', 'backgroundMode'];
const boxKeys = ['x', 'y', 'width', 'height'];
// Line breaks and tabs are editable text; other control characters have no
// corresponding image-editor action and cannot enter a saved document.
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const invalid = (): never => { throw Error('저장할 이미지 편집 문구·영역·스타일과 원본 크기를 확인해주세요.'); };
function object(value: unknown, keys: readonly string[], required: readonly string[] = keys): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key)) && required.every(key => Object.hasOwn(value, key));
}
function array(value: unknown): value is unknown[] {
  return Array.isArray(value) && Reflect.ownKeys(value).every(key => typeof key === 'string'
    && (key === 'length' || /^(0|[1-9][0-9]*)$/u.test(key) && Number(key) < value.length));
}
function dimensions(width: unknown, height: unknown): width is number {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && (width as number) > 0 && (height as number) > 0
    && (width as number) <= 16000 && (height as number) <= 16000 && (width as number) * (height as number) <= MAX_OCR_PIXELS;
}
function text(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit && !controls.test(value);
}
function box(value: unknown, width: number, height: number): FreeImageRegion['box'] {
  if (!object(value, boxKeys) || !boxKeys.every(key => Number.isSafeInteger(value[key]))
    || (value.x as number) < 0 || (value.y as number) < 0 || (value.width as number) < 1 || (value.height as number) < 1
    || (value.x as number) > width - (value.width as number) || (value.y as number) > height - (value.height as number)) return invalid();
  return { x: value.x as number, y: value.y as number, width: value.width as number, height: value.height as number };
}

/** The ordered, full editable state is distinct from selected render inputs.
 * No trimming, point deduplication, style defaults or paint-order changes are
 * applied while constructing the canonical, independently owned document. */
export function validateFreeImageEditDocument(value: unknown, source: Pick<FreeImageSource, 'width' | 'height'>): FreeImageEditDocument {
  if (!source || !dimensions(source.width, source.height) || !object(value, documentKeys, documentKeys.slice(0, 5)) || value.format !== 'free-image-edit-v1'
    || !dimensions(value.width, value.height) || !(value.width === source.width && value.height === source.height
      || value.width === source.height && value.height === source.width)
    || value.sourceLanguage !== 'zh' && value.sourceLanguage !== 'en'
    || !array(value.regions) || value.regions.length > MAX_OCR_REGIONS) return invalid();
  const width = value.width as number, height = value.height as number, ids = new Set<string>();
  let originals = 0, translations = 0, brushPoints = 0;
  const regions: FreeImageRegion[] = Array.from(value.regions, item => {
    if (!object(item, regionKeys, regionKeys.slice(0, 11)) || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || ids.has(item.id)
      || !text(item.text, 5000) || !text(item.translated, 5000) || !(item.issue === null || text(item.issue, 2000))
      || typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 100
      || typeof item.selected !== 'boolean' || !['empty', 'generated', 'manual'].includes(item.translationProvenance as string)
      || typeof item.background !== 'string' || !/^#[a-f0-9]{6}$/iu.test(item.background)
      || typeof item.foreground !== 'string' || !/^#[a-f0-9]{6}$/iu.test(item.foreground)
      || !Number.isSafeInteger(item.fontSize) || (item.fontSize as number) < 1 || (item.fontSize as number) > 200
      || item.erase !== undefined && typeof item.erase !== 'boolean'
      || item.backgroundMode !== undefined && item.backgroundMode !== 'inpaint-telea-v1'
      || item.brush !== undefined && item.backgroundMode !== undefined) return invalid();
    ids.add(item.id); originals += item.text.length; translations += item.translated.length;
    if (originals > MAX_OCR_TEXT || translations > MAX_OCR_TEXT) return invalid();
    const bounds = box(item.box, width, height);
    resolveFreeImageTextStyle(item as FreeImageRegion);
    const region: FreeImageRegion = { id: item.id, text: item.text, box: bounds, confidence: item.confidence, selected: item.selected,
      translated: item.translated, issue: item.issue as string | null, translationProvenance: item.translationProvenance as FreeImageRegion['translationProvenance'],
      background: item.background, foreground: item.foreground, fontSize: item.fontSize as number };
    if (item.erase !== undefined) region.erase = item.erase;
    if (item.brush !== undefined) {
      if (item.erase !== true || !object(item.brush, ['size', 'points']) || !array(item.brush.points)
        || item.brush.points.some(point => !object(point, ['x', 'y']))) return invalid();
      // The shared validator owns an exact clone and verifies the stored box
      // against every point without altering an existing brush path.
      const brush = validateFreeImageBrush(item.brush, item.box, width, height).brush;
      brushPoints += brush.points.length;
      if (brushPoints > MAX_FREE_IMAGE_BRUSH_TOTAL_POINTS) return invalid();
      region.brush = brush;
    }
    if (item.fontFamily !== undefined) region.fontFamily = item.fontFamily as FreeImageRegion['fontFamily'];
    if (item.bold !== undefined) region.bold = item.bold as boolean;
    if (item.italic !== undefined) region.italic = item.italic as boolean;
    if (item.textAlign !== undefined) region.textAlign = item.textAlign as FreeImageRegion['textAlign'];
    if (item.lineHeight !== undefined) region.lineHeight = item.lineHeight as number;
    // Optional absence preserves byte-for-byte canonical legacy documents.
    if (item.backgroundMode !== undefined) region.backgroundMode = item.backgroundMode as FreeImageRegion['backgroundMode'];
    return region;
  });
  const result: FreeImageEditDocument = { format: 'free-image-edit-v1', width, height, sourceLanguage: value.sourceLanguage, regions };
  if (value.crop !== undefined) {
    if (!object(value.crop, [...boxKeys, 'sourceWidth', 'sourceHeight'])) return invalid();
    const crop = validateFreeImageCrop(value.crop, { width, height });
    if (crop.sourceWidth !== width || crop.sourceHeight !== height) return invalid();
    result.crop = crop;
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_FREE_IMAGE_EDIT_BYTES) {
    throw Error('저장할 이미지 편집 문서는 512KB 이내로 줄여주세요.');
  }
  return result;
}
