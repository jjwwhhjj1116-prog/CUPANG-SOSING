import { pricePolicy } from '@/app/pricing';

export const defaultSettings = {
  brand: '', manufacturer: '', importer: '',
  tradeType: '', importType: '', taxType: '', serviceContact: '', boxSkuQuantity: 1,
  washingMethod: '', handlingPrecautions: '', manufactureDatePreviousMonth: false,
  shelfLifeDays: null as number | null, handlingReason: '',
  exchangeRate: 190, supplyMargin: 40, coupangMargin: 35, minimumMargin: 3000,
  minimumMarginEnabled: true, msrpMultiple: 1.3, roundingUnit: 100, roundingMode: 'up' as 'up' | 'nearest',
  useIntegratedRate: false, integratedRate: null as number | null,
  bundleEnabled: false,
  // Older snapshots only had an inert bundleEnabled switch. Missing criteria
  // must not retrospectively turn those saved requests into multi-item packs.
  bundleCriterion: null as 'supplyMargin' | 'coupangMargin' | null,
  bundleMinimumSupplyMargin: null as number | null, bundleMinimumCoupangMargin: null as number | null,
  translateImages: true, removeBackground: true, addCopyright: true,
  topImageEnabled: false, bottomImageEnabled: false, topImageKey: '', bottomImageKey: '', translationPrompt: '', hiddenAttributes: false,
};
export type WorkspaceSettings = typeof defaultSettings;
// Initial values for this deployment, matched to the user's observed Couplus
// account (2026-09-27). Existing saved payloads retain legacy missing-field rules.
export const newWorkspaceSettings: WorkspaceSettings = {
  ...defaultSettings, exchangeRate:350, supplyMargin:50, coupangMargin:40,
  roundingUnit:10, roundingMode:'nearest', removeBackground:false,
  shelfLifeDays:0, handlingReason:'해당사항없음',
  bundleCriterion:'supplyMargin', bundleMinimumSupplyMargin:3000, bundleMinimumCoupangMargin:3000,
};
/** Runtime registration facts must come from an explicit saved payload, not UI examples. */
export function savedRegistrationSettings(input: unknown): WorkspaceSettings {
  const settings = input === null || input === undefined ? { ...newWorkspaceSettings } : validateSettings(input);
  const stored = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  for (const key of ['brand', 'manufacturer', 'importer', 'serviceContact', 'tradeType', 'importType', 'taxType'] as const) {
    if (!Object.hasOwn(stored, key)) settings[key] = '';
  }
  return settings;
}
export function validateSettings(input: unknown): WorkspaceSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('설정 객체가 필요합니다.');
  const p = { ...defaultSettings, ...input } as WorkspaceSettings;
  pricePolicy(p);
  if (!Number.isInteger(p.boxSkuQuantity) || p.boxSkuQuantity < 1 || p.boxSkuQuantity > 100000) throw new Error('박스 내 SKU 수량은 1~100,000 사이 정수여야 합니다.');
  if (p.shelfLifeDays !== null && (!Number.isInteger(p.shelfLifeDays) || p.shelfLifeDays < 0 || p.shelfLifeDays > 100000)) throw new Error('유통기간은 0~100,000 사이 정수로 입력해주세요.');
  if (p.bundleCriterion !== null && !['supplyMargin','coupangMargin'].includes(p.bundleCriterion)) throw new Error('번들 수량의 마진 기준을 선택해주세요.');
  for (const key of ['bundleMinimumSupplyMargin','bundleMinimumCoupangMargin'] as const) {
    if (p[key] !== null && (!Number.isSafeInteger(p[key]) || p[key] < 1000)) throw new Error('번들 기준 마진액은 1,000원 이상의 안전한 정수로 입력해주세요.');
  }
  const bundleCriteria = [p.bundleCriterion,p.bundleMinimumSupplyMargin,p.bundleMinimumCoupangMargin];
  if (p.bundleEnabled && bundleCriteria.some(value=>value!==null) && bundleCriteria.some(value=>value===null)) throw new Error('번들 수량의 마진 기준과 최소 마진액을 모두 입력해주세요.');
  for (const key of ['brand','manufacturer','importer','tradeType','importType','serviceContact','translationPrompt','topImageKey','bottomImageKey','washingMethod','handlingPrecautions','handlingReason'] as const) {
    if (typeof p[key] !== 'string' || p[key].length > (key === 'translationPrompt' ? 10000 : 500) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(p[key])) throw new Error('등록 정보 또는 번역 지침의 길이를 확인해주세요.');
  }
  if (!['','제조사','공식총판사','공식대리점','기타 도소매업자'].includes(p.tradeType) || !['','수입대상아님','수입상품','병행수입상품'].includes(p.importType)) throw new Error('거래타입과 수입여부를 확인해주세요.');
  if (!['', '과세', '면세', '영세'].includes(p.taxType)) throw new Error('과세여부를 확인해주세요.');
  if (!['', '해당사항없음', '유리'].includes(p.handlingReason)) throw new Error('취급주의 사유를 확인해주세요.');
  for (const key of ['minimumMarginEnabled','useIntegratedRate','bundleEnabled','translateImages','removeBackground','addCopyright','topImageEnabled','bottomImageEnabled','hiddenAttributes','manufactureDatePreviousMonth'] as const) {
    if (typeof p[key] !== 'boolean') throw new Error('작업 설정은 켜짐/꺼짐 값이어야 합니다.');
  }
  return Object.fromEntries(Object.keys(defaultSettings).map(key=>[key,p[key as keyof WorkspaceSettings]])) as WorkspaceSettings;
}
