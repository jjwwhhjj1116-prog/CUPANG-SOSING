import type { CollectionResult } from '@/app/collection-result';
export type CollectionCapacity = { usedSlots: number; totalImages: number; reusableIndices: number[]; blockedIndices?: number[] };
export function validateCollectionCapacity(input: unknown, totalImages: number): CollectionCapacity {
  const value = input as CollectionCapacity | null;
  if (!value || !Number.isInteger(value.usedSlots) || value.usedSlots < 0 || value.usedSlots > 50
    || value.totalImages !== totalImages || !Array.isArray(value.reusableIndices)
    || value.reusableIndices.length > 200 || new Set(value.reusableIndices).size !== value.reusableIndices.length
    || value.reusableIndices.some(index => !Number.isInteger(index) || index < 0 || index >= totalImages))
    throw new Error('이미지 저장 여유를 확인하지 못했습니다. 수신 결과를 다시 조회해주세요.');
  if (value.blockedIndices !== undefined && (!Array.isArray(value.blockedIndices) || value.blockedIndices.length > 200
    || new Set(value.blockedIndices).size !== value.blockedIndices.length
    || value.blockedIndices.some(index => !Number.isInteger(index) || index < 0 || index >= totalImages || value.reusableIndices.includes(index))))
    throw new Error('제외된 원본 이미지 목록을 확인하지 못했습니다. 다시 조회해주세요.');
  return value;
}
export function collectionSelectionFits(capacity: CollectionCapacity, indices: readonly number[]): boolean {
  const fresh = new Set(indices.filter(index => !capacity.reusableIndices.includes(index)));
  return !indices.some(index => capacity.blockedIndices?.includes(index)) && capacity.usedSlots + fresh.size <= 50;
}

/** Suggest a bounded selection; never downloads, restores excluded images, or changes source order. */
export type CollectionImageGroup = 'all' | 'main' | 'options' | 'additional' | 'detail';
export function recommendCollectionImages(result: Pick<CollectionResult, 'images' | 'options'>, capacity: CollectionCapacity, group: CollectionImageGroup = 'all', reservedSlots = 0): number[] {
  validateCollectionCapacity(capacity, result.images.length);
  if (!Number.isInteger(reservedSlots) || reservedSlots < 0 || reservedSlots > 49) throw new Error('이미지 예약 공간은 0~49개여야 합니다.');
  const all = result.images.map((_, index) => index);
  // A large SKU gallery must not consume every slot before stage-five details.
  // Reuse an attached detail first; never restore an explicitly removed image.
  const details = all.filter(index => result.images[index].role === 'detail' && !capacity.blockedIndices?.includes(index));
  const firstDetail = details.find(index => capacity.reusableIndices.includes(index)) ?? details[0];
  const priority = new Set([
    ...all.filter(index => result.images[index].role === 'main'),
    ...(group === 'all' && firstDetail !== undefined ? [firstDetail] : []),
    ...result.options.flatMap(option => option.imageIndex === undefined ? [] : [option.imageIndex]),
    ...all.filter(index => result.images[index].role === 'additional'),
    ...all,
  ]);
  const selected: number[] = [];
  const optionImages = new Set(result.options.flatMap(option => option.imageIndex === undefined ? [] : [option.imageIndex]));
  for (const index of priority) {
    if (!Number.isInteger(index) || index < 0 || index >= result.images.length) continue;
    if (group !== 'all' && (group === 'options' ? !optionImages.has(index) : result.images[index].role !== group)) continue;
    if (selected.length === 50) break;
    const candidate = [...selected, index];
    const fresh = candidate.filter(item => !capacity.reusableIndices.includes(item)).length;
    // Never remove already attached originals to make room. Reserve space only
    // when selecting new files, including when resuming a partially saved draft.
    if (collectionSelectionFits(capacity, candidate) &&
      (capacity.reusableIndices.includes(index) || capacity.usedSlots + fresh <= 50 - reservedSlots)) selected.push(index);
  }
  return selected.sort((a, b) => a - b);
}
