import { calculatePrice, pricePolicy, type PricePolicy } from '@/app/pricing';
import { defaultSettings } from '@/app/workspace-settings';

export const OPTION_LIMIT = 200;
export const OPTIONS_BODY_LIMIT = 512 * 1024;
export const optionFieldNames = {
  originalName: '옵션명 원문', translatedName: '옵션명 한국어', supplierSku: '공급자 SKU',
  color: '색상', size: '구매 사이즈', stock: '공급자 재고',
  unitCostCny: '개당 원가 CNY', unitsPerPack: '판매 단위당 구성 수량', minimumOrderQuantity: '최소 주문 수량',
  widthCm: '가로 cm', lengthCm: '세로 cm', heightCm: '높이 cm', weightKg: '판매 단위 무게 kg',
  packagedWeightG: '포장 무게 g', packagedWidthMm: '포장 가로 mm', packagedLengthMm: '포장 세로 mm', packagedHeightMm: '포장 높이 mm',
  included: '견적 포함', imageKey: '옵션 이미지',
} as const;
export type OptionField = keyof typeof optionFieldNames;
export type OptionValues = {
  color?: string; size?: string; stock?: number | null;
  packagedWeightG?: number | null; packagedWidthMm?: number | null; packagedLengthMm?: number | null; packagedHeightMm?: number | null;
  originalName: string; translatedName: string; supplierSku: string; unitCostCny: number | null;
  unitsPerPack: number; minimumOrderQuantity: number | null; widthCm: number | null; lengthCm: number | null;
  heightCm: number | null; weightKg: number | null; included: boolean; imageKey: string | null;
};
export type OptionInput = OptionValues & { id: string; packagingConfirmed?: boolean };
export type ProductOption = OptionInput & {
  packagingUnitsPerPack?: number;
  provenance: Record<OptionField, 'unverified' | 'manual' | 'collected' | 'translated'>;
  updatedAt: string;
};
export type ProductOptions = { schemaVersion: 1; productId: string; revision: number; updatedAt: string | null; rows: ProductOption[] };
export type OptionCalculation = { optionId: string; included: boolean; sourceCostCny: number | null; calculation: ReturnType<typeof calculatePrice> | null; error: string | null };
export type OptionPricing = { policy: PricePolicy; policySource: 'saved-product' | 'product-and-workspace'; rows: OptionCalculation[] };
export type ProductOptionsResponse = { options: ProductOptions; pricing: OptionPricing; productVersion: string };

/** Export values preserve deliberately cleared names; display labels may use IDs. */
export function optionQuotationName(option: Pick<OptionValues, 'translatedName' | 'originalName'> & {
  provenance?: Partial<Pick<ProductOption['provenance'], 'translatedName'>>;
}): string {
  return option.provenance?.translatedName === 'manual' ? option.translatedName : option.translatedName || option.originalName;
}

/** The option editor's null choice explicitly means "use the common main image".
 * An intentional quotation blank belongs to the quotation override layer. */
export function quotationMainImageKeys(option: Pick<OptionValues, 'imageKey'> | null, common: readonly string[]): readonly string[] {
  return option?.imageKey ? [option.imageKey] : common;
}

export function emptyProductOptions(productId: string): ProductOptions { return { schemaVersion: 1, productId, revision: 0, updatedAt: null, rows: [] }; }
export function emptyOptionInput(id: string): OptionInput {
  return { id, originalName: '', translatedName: '', supplierSku: '', color: '', size: '', stock: null, unitCostCny: null, unitsPerPack: 1,
    minimumOrderQuantity: null, widthCm: null, lengthCm: null, heightCm: null, weightKg: null, packagedWeightG: null, packagedWidthMm: null, packagedLengthMm: null, packagedHeightMm: null, included: false, imageKey: null };
}
function object(value: unknown, keys: readonly string[], name: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} 객체가 필요합니다.`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key))) throw new Error(`${name}에 지원하지 않는 항목이 있습니다.`);
  return record;
}
function text(value: unknown, max: number, name: string) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw new Error(`${name}은 ${max}자 이내 텍스트로 입력해주세요.`);
  return value.trim();
}
function number(value: unknown, max: number, integer: boolean, nullable: boolean, name: string): number | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max || (integer && !Number.isInteger(value))) throw new Error(`${name}은 ${max.toLocaleString('ko-KR')} 이하의 양수${integer ? ' 정수' : ''}로 입력해주세요.`);
  return value;
}
export function validateOptionsInput(input: unknown, ownerId: string, imageKeys: readonly string[]) {
  const body = object(input, ['expectedRevision', 'expectedProductVersion', 'rows'], '옵션 요청');
  if (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) throw new Error('옵션 저장 버전을 다시 불러와주세요.');
  if (typeof body.expectedProductVersion !== 'string' || !Number.isFinite(Date.parse(body.expectedProductVersion))) throw new Error('상품 저장 버전을 다시 불러와주세요.');
  if (!Array.isArray(body.rows) || body.rows.length > OPTION_LIMIT) throw new Error(`옵션은 최대 ${OPTION_LIMIT}개입니다.`);
  const identifiers = new Set<string>(); const supplierSkus = new Set<string>();
  const rows = body.rows.map((value, index): OptionInput => {
    const raw = object(value, ['id', 'packagingConfirmed', ...Object.keys(optionFieldNames)], `${index + 1}번 옵션`);
    if (typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(raw.id) || identifiers.has(raw.id)) throw new Error('옵션 ID가 잘못되었거나 중복되었습니다.');
    identifiers.add(raw.id);
    if (raw.packagingConfirmed !== undefined && typeof raw.packagingConfirmed !== 'boolean') throw Error('포장 정보 확인 여부를 확인해주세요.');
    const originalName = text(raw.originalName, 500, '옵션명 원문'); const translatedName = text(raw.translatedName, 500, '옵션명 한국어');
    const supplierSku = text(raw.supplierSku, 200, '공급자 SKU');
    if (!originalName && !translatedName && !supplierSku) throw new Error(`${index + 1}번 옵션의 이름 또는 공급자 SKU를 입력해주세요.`);
    if (supplierSku && supplierSkus.has(supplierSku)) throw new Error(`공급자 SKU가 중복되었습니다: ${supplierSku}`);
    if (supplierSku) supplierSkus.add(supplierSku);
    if (typeof raw.included !== 'boolean') throw new Error('견적 포함 여부를 확인해주세요.');
    if (raw.imageKey !== null && (typeof raw.imageKey !== 'string' || !raw.imageKey.startsWith(`${ownerId}/`) || !imageKeys.includes(raw.imageKey))) throw new Error('이 상품에 업로드한 본인 소유 이미지만 연결할 수 있습니다.');
    const unitCostCny = number(raw.unitCostCny, 1e9, false, !raw.included, '개당 원가 CNY');
    if (raw.stock !== undefined && raw.stock !== null && (!Number.isSafeInteger(raw.stock) || (raw.stock as number) < 0)) throw new Error('공급자 재고는 0 이상 안전한 정수로 입력해주세요. 미확인은 공란으로 두세요.');
    return {
      id: raw.id, ...(raw.packagingConfirmed !== undefined ? {packagingConfirmed: raw.packagingConfirmed as boolean} : {}), originalName, translatedName, supplierSku, included: raw.included, imageKey: raw.imageKey as string | null, unitCostCny,
      ...(raw.color !== undefined ? { color: text(raw.color, 200, '색상') } : {}),
      ...(raw.size !== undefined ? { size: text(raw.size, 200, '구매 사이즈') } : {}),
      ...(raw.stock !== undefined ? { stock: raw.stock as number | null } : {}),
      ...(raw.packagedWeightG !== undefined ? { packagedWeightG: number(raw.packagedWeightG, 1e9, true, true, optionFieldNames.packagedWeightG) } : {}),
      ...(raw.packagedWidthMm !== undefined ? { packagedWidthMm: number(raw.packagedWidthMm, 1e6, true, true, optionFieldNames.packagedWidthMm) } : {}),
      ...(raw.packagedLengthMm !== undefined ? { packagedLengthMm: number(raw.packagedLengthMm, 1e6, true, true, optionFieldNames.packagedLengthMm) } : {}),
      ...(raw.packagedHeightMm !== undefined ? { packagedHeightMm: number(raw.packagedHeightMm, 1e6, true, true, optionFieldNames.packagedHeightMm) } : {}),
      unitsPerPack: number(raw.unitsPerPack, 1e6, true, false, '구성 수량')!,
      minimumOrderQuantity: number(raw.minimumOrderQuantity, 1e9, true, true, '최소 주문 수량'),
      widthCm: number(raw.widthCm, 1e5, false, true, '가로 cm'), lengthCm: number(raw.lengthCm, 1e5, false, true, '세로 cm'),
      heightCm: number(raw.heightCm, 1e5, false, true, '높이 cm'), weightKg: number(raw.weightKg, 1e6, false, true, '무게 kg'),
    };
  });
  return { expectedRevision: body.expectedRevision as number, expectedProductVersion: body.expectedProductVersion, rows };
}
export function applyOptionRows(current: ProductOptions, rows: OptionInput[], now: string): ProductOptions {
  const previous = new Map(current.rows.map(row => [row.id, row]));
  return { schemaVersion: 1, productId: current.productId, revision: current.revision + 1, updatedAt: now,
    rows: rows.map(row => {
      const before = previous.get(row.id); let changed = !before;
      // Older clients omit the new attributes. Omission must not erase saved facts.
      row = { ...row, color: row.color ?? before?.color ?? '', size: row.size ?? before?.size ?? '', stock: row.stock === undefined ? before?.stock ?? null : row.stock };
      for (const key of ['packagedWeightG','packagedWidthMm','packagedLengthMm','packagedHeightMm'] as const) row[key] = row[key] === undefined ? before?.[key] ?? null : row[key];
      const provenance = Object.fromEntries((Object.keys(optionFieldNames) as OptionField[]).map(key => {
        if (before && before[key] === row[key]) return [key, before.provenance[key] ?? 'unverified'];
        changed = true;
        // Editing an existing value, including clearing it, is deliberate.
        // Otherwise quotation fallbacks can silently restore the removed fact.
        if (before) return [key, 'manual'];
        if (key === 'widthCm' || key === 'lengthCm' || key === 'heightCm') return [key, row[key] === null ? 'unverified' : 'manual'];
        if (key === 'stock') return [key, row.stock === null ? 'unverified' : 'manual'];
        // Clearing an assigned image is an explicit choice to use the common image.
        if (key === 'imageKey') return [key, row.imageKey === null ? 'unverified' : 'manual'];
        if (key === 'color' || key === 'size') return [key, row[key] === '' ? 'unverified' : 'manual'];
        return [key, row[key] === '' || row[key] === null ? 'unverified' : 'manual'];
      })) as ProductOption['provenance'];
      const { packagingConfirmed, ...values } = row;
      const hasPackaging = ['packagedWeightG','packagedWidthMm','packagedLengthMm','packagedHeightMm'].some(key => values[key as keyof OptionValues] != null);
      const hadPackaging = before && ['packagedWeightG','packagedWidthMm','packagedLengthMm','packagedHeightMm'].some(key => before[key as keyof OptionValues] != null);
      const packagingUnitsPerPack = hasPackaging ? packagingConfirmed ? row.unitsPerPack : hadPackaging ? before.packagingUnitsPerPack ?? before.unitsPerPack : row.unitsPerPack : undefined;
      if (packagingUnitsPerPack !== before?.packagingUnitsPerPack) changed = true;
      return { ...values, ...(packagingUnitsPerPack === undefined ? {} : {packagingUnitsPerPack}), provenance, updatedAt: changed ? now : before!.updatedAt };
    }),
  };
}
export function optionInputs(options: ProductOptions): OptionInput[] {
  return options.rows.map(row => Object.fromEntries(['id', ...Object.keys(optionFieldNames)].map(key => [key, row[key as keyof ProductOption]])) as OptionInput);
}
export function optionSourceCostCny(unitCostCny: number, unitsPerPack: number) {
  if (!Number.isFinite(unitCostCny) || unitCostCny <= 0 || !Number.isSafeInteger(unitsPerPack) || unitsPerPack < 1) throw new Error('원가와 구성 수량을 입력해주세요.');
  // Multiply the entered decimal by the integer quantity before returning to a
  // JS number: 0.1 × 3 must not round a 30 KRW cost up to 40 KRW accidentally.
  const [decimal, exponent = '0'] = unitCostCny.toString().toLowerCase().split('e');
  const [integer, fraction = ''] = decimal.split('.');
  const coefficient = BigInt(integer + fraction) * BigInt(unitsPerPack);
  return Number(`${coefficient}e${Number(exponent) - fraction.length}`);
}
export function calculateOptionPrices(rows: readonly OptionInput[], policy: PricePolicy): OptionCalculation[] {
  return rows.map(row => {
    if (!row.included) return { optionId: row.id, included: false, sourceCostCny: null, calculation: null, error: null };
    try {
      if (row.unitCostCny === null || !Number.isInteger(row.unitsPerPack) || row.unitsPerPack <= 0) throw new Error('원가와 구성 수량을 입력해주세요.');
      const sourceCostCny = optionSourceCostCny(row.unitCostCny, row.unitsPerPack);
      return { optionId: row.id, included: true, sourceCostCny, calculation: calculatePrice(sourceCostCny, policy), error: null };
    } catch (error) { return { optionId: row.id, included: true, sourceCostCny: null, calculation: null, error: error instanceof Error ? error.message : '옵션 가격을 계산하지 못했습니다.' }; }
  });
}
export function resolveOptionPricePolicy(product: { pricing_policy?: string | null; exchange_rate: number; supply_margin: number; coupang_margin: number }, workspaceInput: unknown = defaultSettings): Pick<OptionPricing, 'policy' | 'policySource'> {
  if (product.pricing_policy) return { policy: pricePolicy(JSON.parse(product.pricing_policy)), policySource: 'saved-product' };
  if (!workspaceInput || typeof workspaceInput !== 'object' || Array.isArray(workspaceInput)) throw new Error('가격 설정 객체가 필요합니다.');
  const settings = { ...defaultSettings, ...workspaceInput };
  // Registration facts can be intentionally absent; only price inputs affect this calculation.
  pricePolicy(settings);
  if (typeof settings.minimumMarginEnabled !== 'boolean') throw new Error('최소 마진 적용 여부를 확인해주세요.');
  return { policy: pricePolicy({ ...settings, exchangeRate: product.exchange_rate, supplyMargin: product.supply_margin, coupangMargin: product.coupang_margin, minimumMargin: settings.minimumMarginEnabled ? settings.minimumMargin : 0 }), policySource: 'product-and-workspace' };
}
