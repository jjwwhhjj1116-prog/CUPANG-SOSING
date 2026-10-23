import { pricePolicy } from '@/app/pricing';
import { calculateOptionPrices, resolveOptionPricePolicy, OPTION_LIMIT } from '@/app/product-options';
import { quotationPriceInputs, quotationPriceTargets } from '@/app/quotation-price-targets';
import type { StageTwoPricingReceipt } from '@/app/stage-two-pricing';

export type SelectedPricingWorkResult = { status: 'draft' | 'blocked' | 'failed'; message: string; calculatedOptions: number; totalOptions: number; uncertain: false };
type Controls = { fetcher?: typeof fetch; signal: AbortSignal; assertCurrent?: () => void | Promise<void> };
class PricingWorkError extends Error { constructor(message: string, public status: 'blocked' | 'failed' = 'blocked') { super(message); } }
const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
 ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)])) : value;
const same = (a: unknown, b: unknown) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const bad = () => new PricingWorkError('현재 상품의 가격 정책·옵션 계산·견적서 연결을 확인하지 못했습니다. 2단계 가격을 확인해주세요.');
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function verify(productId: string, receipt: StageTwoPricingReceipt) {
 const product = receipt?.product, value = receipt?.options, quote = receipt?.quotation, options = value?.options;
 if (!product || product.id !== productId || !options || options.schemaVersion !== 1 || options.productId !== productId
  || !Number.isSafeInteger(options.revision) || options.revision < 0 || !Array.isArray(options.rows) || options.rows.length > OPTION_LIMIT
  || !Number.isFinite(Date.parse(product.updated_at)) || value.productVersion !== product.updated_at || !quote
  || quote.productVersion !== product.updated_at || quote.optionRevision !== options.revision
  || !Number.isSafeInteger(quote.revision) || quote.revision < 0 || !/^[a-f0-9]{64}$/.test(quote.inputFingerprint)
  || !record(quote.overrides?.common) || !record(quote.overrides?.options)
  || !Array.isArray(quote.resolved?.rows) || !Array.isArray(quote.automatic?.rows)
  || !Array.isArray(quote.resolved?.schema?.fields) || !same(quote.resolved.schema, quote.automatic.schema)) throw bad();
 const ids = new Set<string>();
 for (const row of options.rows) {
  if (!row || typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(row.id) || ids.has(row.id) || typeof row.included !== 'boolean') throw bad();
  ids.add(row.id);
 }
 const expectedRows = [[null, false], ...options.rows.map(row => [row.id, row.included])];
 // No representative-product fallback when the selected product has no options.
 if (!options.rows.some(row => row.included)) throw new PricingWorkError('가격을 계산할 포함 옵션이 없습니다.');
 if (!same(quote.resolved.rows.map(row => [row.optionId, row.included]), expectedRows)
  || !same(quote.automatic.rows.map(row => [row.optionId, row.included]), expectedRows)) throw bad();
 const policy = pricePolicy(value.pricing?.policy);
 if (!same(policy, value.pricing.policy)) throw bad();
 if (product.pricing_policy) {
  const saved = resolveOptionPricePolicy(product);
  if (value.pricing.policySource !== saved.policySource || !same(policy, saved.policy)) throw bad();
 } else if (value.pricing.policySource !== 'product-and-workspace' || policy.exchangeRate !== product.exchange_rate
  || policy.supplyMargin !== product.supply_margin || policy.coupangMargin !== product.coupang_margin) throw bad();
 const prices = calculateOptionPrices(options.rows, policy);
 if (!same(prices, value.pricing.rows)) throw bad();
 const invalid = prices.filter(row => row.included && (!row.calculation || row.error));
 if (invalid.length) throw new PricingWorkError(`포함 옵션 ${invalid.length}개의 원가·구성 수량 또는 가격 설정을 확인해주세요. 저장된 값은 유지했습니다.`);
 const targets = quotationPriceTargets(quote.resolved.schema.fields);
 let manualFields = 0;
 for (const option of options.rows) {
  const row = quote.resolved.rows.find(row => row.optionId === option.id)!;
  const automatic = quote.automatic.rows.find(row => row.optionId === option.id)!;
  const amounts = prices.find(row => row.optionId === option.id)!.calculation;
  const own = Object.hasOwn(quote.overrides.options, option.id) ? quote.overrides.options[option.id] : undefined;
  if (own !== undefined && !record(own)) throw bad();
  for (const key of quotationPriceInputs) for (const field of targets[key].linked) {
   const expectedAutomatic = amounts ? String(amounts[key]) : '';
   const manualOption = !!own && Object.hasOwn(own, field), manualCommon = Object.hasOwn(quote.overrides.common, field);
   const expectedValue = manualOption ? own![field] : manualCommon ? quote.overrides.common[field] : expectedAutomatic;
   const expectedSource = manualOption ? 'manual-option' : manualCommon ? 'manual-common' : amounts ? 'pricing' : 'empty';
   if (typeof expectedValue !== 'string' || automatic.fields[field]?.value !== expectedAutomatic
    || automatic.fields[field]?.source !== (amounts ? 'pricing' : 'empty')
    || row.fields[field]?.value !== expectedValue || row.fields[field]?.source !== expectedSource) throw bad();
   if (option.included && (manualOption || manualCommon)) manualFields++;
  }
 }
 return { totalOptions: options.rows.filter(row => row.included).length, manualFields };
}

/** Option records persist cost, pack quantity and policy, not calculated price
 * cells. The stage-two GET returns a fenced product/options/quotation snapshot;
 * both options and quotation use calculateOptionPrices. Recompute with that
 * exact policy, verify automatic and manual final prices, then confirm the same
 * snapshot. No CAS write is needed: writing quotation overrides would turn
 * dynamic prices into manual prices, and an explicit stage-two recalculation
 * would alter existing overrides/pack settings. This proves a calculation
 * draft, not human review, a new save, or supplier submission readiness. */
export async function runSelectedPricingWork(productId: string, controls: Controls): Promise<SelectedPricingWorkResult> {
 let totalOptions = 0;
 const result = (status: SelectedPricingWorkResult['status'], message: string, calculatedOptions = 0): SelectedPricingWorkResult =>
  ({ status, message, calculatedOptions, totalOptions, uncertain: false });
 const current = async () => {
  if (controls.signal.aborted) throw new PricingWorkError('가격 계산 확인을 중지했습니다.');
  try { await controls.assertCurrent?.(); } catch (cause) { throw new PricingWorkError(cause instanceof Error ? cause.message : '가격 작업의 로그인 계정과 회사를 확인하지 못했습니다.'); }
  if (controls.signal.aborted) throw new PricingWorkError('가격 계산 확인을 중지했습니다.');
 };
 try {
  await current();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(productId)) throw bad();
  const endpoint = `/api/products/${encodeURIComponent(productId)}/stage-two-pricing`;
  const read = async () => {
   await current();
   const response = await (controls.fetcher ?? fetch)(endpoint, { method: 'GET', cache: 'no-store', signal: controls.signal, credentials: 'same-origin', redirect: 'error' });
   await current();
   if (response.redirected || response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400) throw new PricingWorkError('가격 응답이 다른 화면으로 이동했습니다. 로그인 상태를 확인해주세요.');
   if (response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw new PricingWorkError('가격 서버의 응답을 확인하지 못했습니다.', 'failed');
   const body = await response.json(); await current();
   if (!response.ok) throw new PricingWorkError(record(body) && typeof body.error === 'string' ? body.error : '가격 정보를 읽지 못했습니다.', [400, 401, 403, 404, 409].includes(response.status) ? 'blocked' : 'failed');
   return body as StageTwoPricingReceipt;
  };
  const before = await read(), checked = verify(productId, before); totalOptions = checked.totalOptions;
  const after = await read(); verify(productId, after);
  if (!same(before, after)) throw new PricingWorkError('가격 계산 확인 중 상품·옵션·정책 또는 견적서가 변경됐습니다. 최신 저장값으로 다시 확인해주세요.');
  await current();
  return result('draft', `포함 옵션 ${totalOptions}개의 저장된 정책에 따른 가격 계산과 견적서 연결을 확인했습니다. 자동 가격은 원가·구성 수량에서 계산되며 별도 가격 저장은 없습니다.${checked.manualFields ? ` 수동 가격 ${checked.manualFields}칸(공란 포함)을 유지했습니다.` : ''} 최종 가격 검토가 필요한 초안입니다.`, totalOptions);
 } catch (cause) {
  if (controls.signal.aborted) return result('blocked', '가격 계산 확인을 중지했습니다.');
  return result(cause instanceof PricingWorkError ? cause.status : 'failed', cause instanceof Error ? cause.message : '가격 계산을 확인하지 못했습니다.');
 }
}
