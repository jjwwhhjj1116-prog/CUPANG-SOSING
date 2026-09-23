export type CollectionCapacity = { usedSlots: number; totalImages: number; reusableIndices: number[] };
export function validateCollectionCapacity(input: unknown, totalImages: number): CollectionCapacity {
  const value = input as CollectionCapacity | null;
  if (!value || !Number.isInteger(value.usedSlots) || value.usedSlots < 0 || value.usedSlots > 50
    || value.totalImages !== totalImages || !Array.isArray(value.reusableIndices)
    || value.reusableIndices.length > 200 || new Set(value.reusableIndices).size !== value.reusableIndices.length
    || value.reusableIndices.some(index => !Number.isInteger(index) || index < 0 || index >= totalImages))
    throw new Error('이미지 저장 여유를 확인하지 못했습니다. 수신 결과를 다시 조회해주세요.');
  return value;
}
export function collectionSelectionFits(capacity: CollectionCapacity, indices: readonly number[]): boolean {
  const fresh = new Set(indices.filter(index => !capacity.reusableIndices.includes(index)));
  return capacity.usedSlots + fresh.size <= 50;
}
