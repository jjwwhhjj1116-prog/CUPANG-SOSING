import type { FreeImageRegion } from '@/app/free-image-translation-client';

export const FREE_IMAGE_EDIT_HISTORY_LIMIT = 20;
export type FreeImageEditHistory = {
  past: readonly (readonly FreeImageRegion[])[];
  future: readonly (readonly FreeImageRegion[])[];
  group: string | null;
};
export type FreeImageEditMovement = { history: FreeImageEditHistory; regions: FreeImageRegion[] };

// Copy the mutable geometry while sharing immutable text. Neither image blobs
// nor source/save proofs belong to the region editing history.
function snapshot(rows: readonly FreeImageRegion[]): FreeImageRegion[] {
  return rows.map(row => ({ ...row, box: { ...row.box } }));
}
function sameObject(a: object, b: object): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key =>
    Object.prototype.hasOwnProperty.call(b, key)
    && Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
function sameRows(a: readonly FreeImageRegion[], b: readonly FreeImageRegion[]): boolean {
  return a.length === b.length && a.every((row, index) => {
    const other = b[index];
    const { box: firstBox, ...first } = row;
    const { box: secondBox, ...second } = other;
    return sameObject(first, second) && sameObject(firstBox, secondBox);
  });
}

export function createFreeImageEditHistory(): FreeImageEditHistory {
  return { past: [], future: [], group: null };
}
export function endFreeImageEditGroup(history: FreeImageEditHistory): FreeImageEditHistory {
  return history.group === null ? history : { ...history, group: null };
}
export function recordFreeImageEdit(history: FreeImageEditHistory, before: readonly FreeImageRegion[],
  next: readonly FreeImageRegion[], group: string | null = null): FreeImageEditHistory {
  if (sameRows(before, next)) return history;
  const coalesced = group !== null && group === history.group && history.past.length > 0 && history.future.length === 0;
  return {
    past: coalesced ? history.past : [...history.past, snapshot(before)].slice(-FREE_IMAGE_EDIT_HISTORY_LIMIT),
    future: [], group,
  };
}
export function undoFreeImageEdit(history: FreeImageEditHistory, current: readonly FreeImageRegion[]): FreeImageEditMovement | null {
  const previous = history.past.at(-1);
  if (!previous) return null;
  return {
    regions: snapshot(previous),
    history: { past: history.past.slice(0, -1), future: [...history.future, snapshot(current)], group: null },
  };
}
export function redoFreeImageEdit(history: FreeImageEditHistory, current: readonly FreeImageRegion[]): FreeImageEditMovement | null {
  const next = history.future.at(-1);
  if (!next) return null;
  return {
    regions: snapshot(next),
    history: { past: [...history.past, snapshot(current)], future: history.future.slice(0, -1), group: null },
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
