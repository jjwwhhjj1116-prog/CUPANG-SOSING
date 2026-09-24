import { calculateOptionPrices, OPTION_LIMIT, type OptionInput } from '@/app/product-options';
import type { PricePolicy } from '@/app/pricing';
import type { AssetRole } from '@/app/product-content';

export type BulkOptionAction = { type: 'unitCostCny' | 'unitsPerPack'; value: number } | { type: 'imageKey'; value: string | null } | { type: 'include' | 'exclude' | 'remove' };
export type BulkOptionPreview = {
  base: string; action: BulkOptionAction; selectedIds: string[]; rows: OptionInput[];
  changes: { id: string; name: string; before: OptionInput; after: OptionInput | null; beforePrice: number | null; afterPrice: number | null; error: string | null }[];
};
export function previewOptionBulk(rows: readonly OptionInput[], selectedIds: readonly string[], action: BulkOptionAction, policy: PricePolicy, imageKeys: readonly string[] = []): BulkOptionPreview {
  const selected = new Set(selectedIds);
  if (!selected.size || selected.size !== selectedIds.length || [...selected].some(id => !rows.some(row => row.id === id))) throw new Error('편집할 옵션을 다시 선택해주세요.');
  if (action.type === 'unitCostCny' && (!Number.isFinite(action.value) || action.value <= 0 || action.value > 1e9)) throw new Error('개당 원가는 0보다 크고 10억 CNY 이하이어야 합니다.');
  if (action.type === 'unitsPerPack' && (!Number.isInteger(action.value) || action.value < 1 || action.value > 1e6)) throw new Error('판매 단위당 구성 수량은 1~1,000,000 사이 정수입니다.');
  if (action.type === 'imageKey' && action.value !== null && !imageKeys.includes(action.value)) throw new Error('이 상품에 저장된 이미지를 다시 선택해주세요.');
  const next = rows.flatMap(row => {
    if (!selected.has(row.id)) return [{ ...row }];
    if (action.type === 'remove') return [];
    if (action.type === 'include' || action.type === 'exclude') return [{ ...row, included: action.type === 'include' }];
    if ('value' in action) return [{ ...row, [action.type]: action.value }];
    throw new Error('지원하지 않는 일괄 편집 작업입니다.');
  });
  const beforePrices = calculateOptionPrices(rows, policy); const afterPrices = calculateOptionPrices(next, policy);
  return { base: JSON.stringify(rows), action, selectedIds: [...selected], rows: next, changes: rows.filter(row => selected.has(row.id)).map(row => {
    const after = next.find(value => value.id === row.id) ?? null; const price = afterPrices.find(value => value.optionId === row.id);
    return { id: row.id, name: row.translatedName || row.originalName || row.supplierSku || '이름 미입력', before: { ...row }, after,
      beforePrice: beforePrices.find(value => value.optionId === row.id)?.calculation?.supplyPrice ?? null, afterPrice: price?.calculation?.supplyPrice ?? null, error: price?.error ?? null };
  }) };
}
export function applyOptionBulk(rows: readonly OptionInput[], preview: BulkOptionPreview, imageKeys: readonly string[] = []): OptionInput[] {
  if (JSON.stringify(rows) !== preview.base) throw new Error('미리보기 후 옵션이 바뀌었습니다. 변경 미리보기를 다시 실행해주세요.');
  if (preview.action.type === 'imageKey' && preview.action.value !== null && !imageKeys.includes(preview.action.value)) throw new Error('선택한 이미지가 상품에서 제외되었습니다. 이미지를 다시 선택해주세요.');
  return preview.rows.map(row => ({ ...row }));
}
export function moveOption(rows: readonly OptionInput[], id: string, offset: -1 | 1): OptionInput[] {
  const index = rows.findIndex(row => row.id === id); const target = index + offset;
  if (index < 0 || target < 0 || target >= rows.length) return [...rows];
  const next = [...rows]; [next[index], next[target]] = [next[target], next[index]]; return next;
}
export function duplicateOption(rows: readonly OptionInput[], id: string, newId: string): OptionInput[] {
  if (rows.length >= OPTION_LIMIT || rows.some(row => row.id === newId)) throw new Error('옵션 개수 또는 새 식별자를 확인해주세요.');
  const index = rows.findIndex(row => row.id === id); if (index < 0) throw new Error('복제할 옵션이 없습니다.');
  const copy = { ...rows[index], id: newId, supplierSku: '', stock: null, included: false };
  return [...rows.slice(0, index + 1), copy, ...rows.slice(index + 1)];
}
export type AssetEditorFilter = 'all' | 'unassigned' | AssetRole;
const roles: AssetRole[] = ['main', 'additional', 'detailTop', 'detail', 'detailBottom', 'size', 'label'];
export function orderedEditorImages(available: readonly string[], assets: Record<AssetRole, string[]>, filter: AssetEditorFilter): string[] {
  const assigned = [...new Set(roles.flatMap(role => assets[role] ?? []))];
  const unassigned = available.filter(key => !assigned.includes(key));
  if (filter === 'unassigned') return unassigned;
  if (filter !== 'all') return assets[filter].filter(key => available.includes(key));
  return [...assigned.filter(key => available.includes(key)), ...unassigned];
}
