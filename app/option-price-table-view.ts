import type { OptionInput } from '@/app/product-options';
import { savedOptionRegistrationNumber } from '@/app/product-registration';
import { matchesRegistrationColumnFilter, type RegistrationColumnFilter } from '@/app/registration-column-filter';

export type PriceColumnId = 'name' | 'id' | 'quantity' | 'stock' | 'cost' | 'supply' | 'supplyMargin' | 'sale' | 'coupangMargin';
export type PriceSort = { column: PriceColumnId; direction: 'ascending' | 'descending' };
export type PriceEntry = { row: OptionInput; index: number; result?: { calculation: { costKrw: number; supplyPrice: number; salePrice: number; marginKrw: number } | null; error?: string | null } };
export type PriceColumnFilters = Partial<Record<PriceColumnId, RegistrationColumnFilter>>;
const collator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' });
const numeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
export const numericPriceColumn = (column: PriceColumnId) => column !== 'name' && column !== 'id';

/** Raw values keep condition filters independent of currency/percent formatting. */
export function priceColumnText(entry: PriceEntry, column: PriceColumnId, numbers?: Readonly<Record<string, string>>): string {
  const { row, result } = entry, calculation = result?.calculation;
  switch (column) {
    case 'name': return row.translatedName || row.originalName || `옵션 ${entry.index + 1}`;
    case 'id': return savedOptionRegistrationNumber(row.id, numbers);
    case 'quantity': return numeric(row.unitsPerPack);
    case 'stock': return numeric(row.stock);
    case 'cost': return numeric(row.unitCostCny);
    case 'supply': return numeric(calculation?.supplyPrice);
    case 'sale': return numeric(calculation?.salePrice);
    case 'supplyMargin': return numeric(calculation?.marginKrw);
    case 'coupangMargin': return calculation ? numeric(calculation.salePrice - calculation.supplyPrice) : '';
  }
}
export function filterPriceTableRows<T extends PriceEntry>(entries: readonly T[], query: string, filters: PriceColumnFilters,
  numbers?: Readonly<Record<string, string>>, omitColumn?: PriceColumnId): T[] {
  const tokens = query.trim().toLocaleLowerCase('ko-KR').split(/\s+/u).filter(Boolean);
  return entries.filter(entry => {
    const { row, result } = entry;
    const values = [savedOptionRegistrationNumber(row.id, numbers), row.id, row.supplierSku, row.originalName, row.translatedName,
      row.unitsPerPack, row.stock, row.unitCostCny, result?.calculation?.supplyPrice, result?.calculation?.salePrice, result?.calculation?.marginKrw]
      .filter(value => value != null).map(value => String(value).toLocaleLowerCase('ko-KR'));
    return tokens.every(token => values.some(value => value.includes(token)))
      && (Object.keys(filters) as PriceColumnId[]).every(column => column === omitColumn || matchesRegistrationColumnFilter(priceColumnText(entry, column, numbers), filters[column], numericPriceColumn(column)));
  });
}
export function sortPriceTableRows<T extends PriceEntry>(entries: readonly T[], sorts: readonly PriceSort[], numbers?: Readonly<Record<string, string>>): T[] {
  return [...entries].sort((left, right) => {
    for (const sort of sorts.slice(0, 3)) {
      const first = priceColumnText(left, sort.column, numbers), second = priceColumnText(right, sort.column, numbers);
      if (!first || !second) { if (first !== second) return first ? -1 : 1; continue; }
      const comparison = numericPriceColumn(sort.column) ? Number(first) - Number(second) : collator.compare(first, second);
      if (comparison) return comparison * (sort.direction === 'ascending' ? 1 : -1);
    }
    return left.index - right.index;
  });
}
export function nextPriceTableSort(sorts: readonly PriceSort[], column: PriceColumnId, direction?: PriceSort['direction']): PriceSort[] {
  const previous = sorts.find(sort => sort.column === column), remaining = sorts.filter(sort => sort.column !== column);
  const next = direction ?? (previous?.direction === 'ascending' ? 'descending' : previous ? null : 'ascending');
  return next ? [{ column, direction: next }, ...remaining].slice(0, 3) : remaining;
}
export function pricePinnedOffsets(columns: readonly { id: PriceColumnId; width: number }[], pinned: PriceColumnId | '', selectionWidth: number): Map<PriceColumnId, number> {
  const end = columns.findIndex(column => column.id === pinned), offsets = new Map<PriceColumnId, number>();
  let left = selectionWidth;
  for (let index = 0; index <= end; index++) { offsets.set(columns[index].id, left); left += columns[index].width; }
  return offsets;
}
