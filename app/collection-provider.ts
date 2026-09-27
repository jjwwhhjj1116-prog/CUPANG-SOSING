import type { AlibabaProductCredentials } from '@/app/alibaba-product-api';

export type CollectionProvider = {kind: 'public-page'} | {kind: 'alibaba-api'; credentials: AlibabaProductCredentials};

/** Server bindings only; never accept provider selection or secrets from a URL,
 * client request, saved product, or supplier response. */
export function collectionProvider(bindings: Record<string, unknown>): CollectionProvider {
  const enabled = bindings.ALIBABA_PRODUCT_API_ENABLED;
  if (enabled === undefined || enabled === '' || enabled === 'false') return {kind: 'public-page'};
  if (enabled !== 'true') throw Error('1688 API 활성화 설정을 확인해주세요.');
  const appKey = bindings.ALIBABA_APP_KEY;
  const appSecret = bindings.ALIBABA_APP_SECRET;
  const accessToken = bindings.ALIBABA_ACCESS_TOKEN;
  if (typeof appKey !== 'string' || !/^\d{1,30}$/.test(appKey) ||
      ![appSecret, accessToken].every(value => typeof value === 'string' && value.trim().length > 0 && value.length <= 4096 && !/[\r\n]/.test(value))) {
    throw Error('1688 API의 앱 키·비밀키·조회 토큰 설정이 필요합니다.');
  }
  return {kind: 'alibaba-api', credentials: {appKey, appSecret: appSecret as string, accessToken: accessToken as string}};
}
