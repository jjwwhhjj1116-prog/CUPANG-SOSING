import type { FreeImageCropRect } from '@/app/free-image-crop';
import type { FreeImageRegion } from '@/app/free-image-translation-client';
import type { FreeImagePhoto } from '@/app/free-image-photo';

export const FREE_IMAGE_EDIT_HISTORY_LIMIT = 20;
type FreeImageEditState = { regions: readonly FreeImageRegion[]; crop: FreeImageCropRect | null; photo?: FreeImagePhoto | null };
export type FreeImageEditHistory = {
  past: readonly FreeImageEditState[];
  future: readonly FreeImageEditState[];
  group: string | null;
};
export type FreeImageEditMovement = { history: FreeImageEditHistory; regions: FreeImageRegion[]; crop: FreeImageCropRect | null; photo?: FreeImagePhoto | null };

// Copy mutable geometry and brush paths while sharing immutable text. Neither image blobs
// nor source/save proofs belong to the editing history.
function copyEditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyEditValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyEditValue(item)]));
  return value;
}
function sameEditValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key)
    && sameEditValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
function snapshot({ regions, crop, photo }: FreeImageEditState) {
  return { regions: regions.map(row => copyEditValue(row) as FreeImageRegion), crop: crop ? { ...crop } : null,
    ...(photo === undefined ? {} : { photo: photo ? { ...photo } : null }) };
}
export function sameFreeImageEditCrop(a: FreeImageCropRect | null, b: FreeImageCropRect | null): boolean {
  return sameEditValue(a, b);
}

export function createFreeImageEditHistory(): FreeImageEditHistory {
  return { past: [], future: [], group: null };
}
export function endFreeImageEditGroup(history: FreeImageEditHistory): FreeImageEditHistory {
  return history.group === null ? history : { ...history, group: null };
}
export function recordFreeImageEdit(history: FreeImageEditHistory, before: readonly FreeImageRegion[],
  next: readonly FreeImageRegion[], group: string | null = null, beforeCrop: FreeImageCropRect | null = null,
  nextCrop = beforeCrop, beforePhoto?: FreeImagePhoto | null, nextPhoto = beforePhoto): FreeImageEditHistory {
  if (sameFreeImageEditCrop(beforeCrop, nextCrop) && sameEditValue(beforePhoto, nextPhoto) && sameEditValue(before, next)) return history;
  const coalesced = group !== null && group === history.group && history.past.length > 0 && history.future.length === 0;
  return {
    past: coalesced ? history.past : [...history.past, snapshot({ regions: before, crop: beforeCrop, photo: beforePhoto })].slice(-FREE_IMAGE_EDIT_HISTORY_LIMIT),
    future: [], group,
  };
}
export function undoFreeImageEdit(history: FreeImageEditHistory, regions: readonly FreeImageRegion[], crop: FreeImageCropRect | null = null, photo?: FreeImagePhoto | null): FreeImageEditMovement | null {
  const previous = history.past.at(-1);
  if (!previous) return null;
  return {
    ...snapshot(previous),
    history: { past: history.past.slice(0, -1), future: [...history.future, snapshot({ regions, crop, photo })], group: null },
  };
}
export function redoFreeImageEdit(history: FreeImageEditHistory, regions: readonly FreeImageRegion[], crop: FreeImageCropRect | null = null, photo?: FreeImagePhoto | null): FreeImageEditMovement | null {
  const next = history.future.at(-1);
  if (!next) return null;
  return {
    ...snapshot(next),
    history: { past: [...history.past, snapshot({ regions, crop, photo })], future: history.future.slice(0, -1), group: null },
  };
}

/** Later array entries paint on top. Move by one visible layer, never by ID sort. */
export function moveFreeImageEditRegion(rows: readonly FreeImageRegion[], id: string, direction: -1 | 1): FreeImageRegion[] {
  const next = [...rows], index = rows.findIndex(row => row.id === id);
  if (direction !== -1 && direction !== 1 || index < 0 || rows.filter(row => row.id === id).length !== 1) return next;
  const target = index + direction;
  if (target < 0 || target >= rows.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
