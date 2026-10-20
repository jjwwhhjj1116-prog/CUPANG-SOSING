import type { QuotationFieldsView } from '@/app/quotation-schema';

export type RegistrationLayout = {
  format: 'yoofam-registration-layout-v1';
  productId: string;
  productVersion: string;
  categoryContext: QuotationFieldsView['categoryContext'];
  sizeChartRequired: boolean;
};

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const version = (value: unknown): value is string => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));

/** The observed wizard reads this direct JSON path, not a compiled nullable
 * field, category name, saved image, or an inferred clothing category. */
export function sizeChartRequiredFromSchemaString(schemaString: unknown): boolean {
  if (typeof schemaString !== 'string' || schemaString.length > 200000) return false;
  try {
    const raw: unknown = JSON.parse(schemaString);
    if (!object(raw) || !object(raw.properties)) return false;
    const page = raw.properties.imagePage;
    if (!object(page) || !object(page.properties)) return false;
    const images = page.properties.images;
    return object(images) && object(images.properties) && Array.isArray(images.required)
      && images.required.every(value => typeof value === 'string') && images.required.includes('sizeChartImage');
  } catch { return false; }
}

function ownValues(value: unknown, keys: string[]): Record<string, unknown> {
  if (!object(value) || Object.getOwnPropertySymbols(value).length) throw Error('상품 등록 단계 응답을 확인하지 못했습니다.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== keys.length || keys.some(key => !Object.hasOwn(descriptors, key) || !Object.hasOwn(descriptors[key], 'value')))
    throw Error('상품 등록 단계 응답을 확인하지 못했습니다.');
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

/** Bind a read-only layout to the requested product clock and explicit profile.
 * An implicit captured category may retain its own profile id without a query. */
export function readRegistrationLayout(value: unknown, productId: string, productVersion: string, profileId?: string): RegistrationLayout {
  if (!id(productId) || !version(productVersion) || profileId !== undefined && !id(profileId)) throw Error('상품 등록 단계의 조회 대상을 확인해주세요.');
  const raw = ownValues(value, ['format', 'productId', 'productVersion', 'categoryContext', 'sizeChartRequired']);
  if (raw.format !== 'yoofam-registration-layout-v1' || raw.productId !== productId || raw.productVersion !== productVersion || typeof raw.sizeChartRequired !== 'boolean')
    throw Error('상품 저장 상태가 변경되었습니다. 최신 등록 단계를 다시 확인해주세요.');
  const context = ownValues(raw.categoryContext, ['source', 'profileId', 'categoryId', 'categoryPath']);
  if (!['profile', 'collection', 'unknown'].includes(context.source as string) || context.profileId !== null && !id(context.profileId)
    || context.categoryId !== null && (typeof context.categoryId !== 'string' || !/^[1-9]\d{0,19}$/.test(context.categoryId))
    || !Array.isArray(context.categoryPath) || context.categoryPath.length > 10
    || context.categoryPath.some(segment => typeof segment !== 'string' || !segment.trim() || segment !== segment.trim() || segment.length > 120 || /[\u0000-\u001f\u007f]/.test(segment)))
    throw Error('상품 등록 단계의 카테고리를 확인하지 못했습니다.');
  if (context.source === 'unknown' ? context.profileId !== null || context.categoryId !== null || context.categoryPath.length !== 0 || raw.sizeChartRequired
    : !context.categoryPath.length || context.source === 'profile' && context.profileId === null || raw.sizeChartRequired && context.categoryId === null)
    throw Error('상품 등록 단계의 카테고리를 확인하지 못했습니다.');
  if (profileId === undefined ? context.source === 'profile' : context.source !== 'profile' || context.profileId !== profileId)
    throw Error('선택한 카테고리와 등록 단계 응답이 다릅니다.');
  return { format: 'yoofam-registration-layout-v1', productId, productVersion, sizeChartRequired: raw.sizeChartRequired,
    categoryContext: { source: context.source as RegistrationLayout['categoryContext']['source'], profileId: context.profileId as string | null,
      categoryId: context.categoryId as string | null, categoryPath: [...context.categoryPath] as string[] } };
}
