import { pricePolicy } from '@/app/pricing';

export const defaultSettings = {
  brand: 'SourceFlow Select', manufacturer: '해외 협력 제조사', importer: '로켓셀러',
  tradeType: '제조사', importType: '수입상품', serviceContact: '', boxSkuQuantity: 1,
  exchangeRate: 190, supplyMargin: 40, coupangMargin: 35, minimumMargin: 3000,
  minimumMarginEnabled: true, msrpMultiple: 1.3, roundingUnit: 100,
  bundleEnabled: false, translateImages: true, removeBackground: true, addCopyright: true,
  topImageEnabled: false, bottomImageEnabled: false, translationPrompt: '', hiddenAttributes: false,
};
export type WorkspaceSettings = typeof defaultSettings;
/** Runtime registration facts must come from an explicit saved payload, not UI examples. */
export function savedRegistrationSettings(input: unknown): WorkspaceSettings {
  const settings = input === null || input === undefined ? { ...defaultSettings } : validateSettings(input);
  const stored = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  for (const key of ['brand', 'manufacturer', 'importer', 'serviceContact', 'tradeType', 'importType'] as const) {
    if (!Object.hasOwn(stored, key)) settings[key] = '';
  }
  return settings;
}
export function validateSettings(input: unknown): WorkspaceSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('설정 객체가 필요합니다.');
  const p = { ...defaultSettings, ...input } as WorkspaceSettings;
  pricePolicy(p);
  if (!Number.isInteger(p.boxSkuQuantity) || p.boxSkuQuantity < 1 || p.boxSkuQuantity > 100000) throw new Error('박스 내 SKU 수량은 1~100,000 사이 정수여야 합니다.');
  for (const key of ['brand','manufacturer','importer','tradeType','importType','serviceContact','translationPrompt'] as const) {
    if (typeof p[key] !== 'string' || p[key].length > (key === 'translationPrompt' ? 10000 : 500)) throw new Error('등록 정보 또는 번역 지침의 길이를 확인해주세요.');
  }
  if (!['제조사','공식총판사','공식대리점','기타 도소매업자'].includes(p.tradeType) || !['수입대상아님','수입상품','병행수입상품'].includes(p.importType)) throw new Error('거래타입과 수입여부를 확인해주세요.');
  for (const key of ['minimumMarginEnabled','bundleEnabled','translateImages','removeBackground','addCopyright','topImageEnabled','bottomImageEnabled','hiddenAttributes'] as const) {
    if (typeof p[key] !== 'boolean') throw new Error('작업 설정은 켜짐/꺼짐 값이어야 합니다.');
  }
  return Object.fromEntries(Object.keys(defaultSettings).map(key=>[key,p[key as keyof WorkspaceSettings]])) as WorkspaceSettings;
}
