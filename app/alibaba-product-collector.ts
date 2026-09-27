import { queryAlibabaProduct, type AlibabaProductCredentials } from '@/app/alibaba-product-api';
import { parseAlibabaProduct } from '@/app/alibaba-product-result';

/** Server-side collector, available through explicit deployment configuration.
 * Actual provider response compatibility still requires live verification. */
export async function collectAlibabaProduct(sourceUrl: string, credentials: AlibabaProductCredentials, options: {fetcher?: typeof fetch; signal?: AbortSignal} = {}) {
  const response = await queryAlibabaProduct(sourceUrl, credentials, options);
  if (options.signal?.aborted) throw Error('상품 수집이 취소되었습니다.');
  return parseAlibabaProduct(response.payload, sourceUrl);
}
