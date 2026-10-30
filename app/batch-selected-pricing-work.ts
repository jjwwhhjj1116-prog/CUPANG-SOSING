import { pricePolicy } from '@/app/pricing';
import { calculateOptionPrices, resolveOptionPricePolicy, optionInputs, OPTION_LIMIT } from '@/app/product-options';
import { quotationPriceInputs, quotationPriceTargets } from '@/app/quotation-price-targets';
import {stageTwoQuotationDraft,verifyStageTwoPricingReceipt,type StageTwoPricingReceipt,type StageTwoPricingRequest} from '@/app/stage-two-pricing';
import {matchesStageTwoPricingReview} from '@/app/stage-two-pricing-review';
import {quotationNumericValue,quotationScalarValueIssues} from '@/app/quotation-scalar-constraints';

export type SelectedPricingWorkResult = { status: 'complete' | 'draft' | 'blocked' | 'failed'; message: string; calculatedOptions: number; totalOptions: number; uncertain: boolean };
type Controls = { fetcher?: typeof fetch; signal: AbortSignal; assertCurrent?: () => void | Promise<void>;expectedOwnerId:string;keys:Map<string,string>;trackMutationDispatch?:(onDispatch:()=>void)=>()=>void };
type PricingSaveAttempt={format:'yoofam-selected-pricing-save-v1';ownerId:string;productId:string;before:StageTwoPricingReceipt;request:StageTwoPricingRequest};
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

/** An explicit selected-work action saves a current price review through the
 * ordinary stage-two CAS endpoint. It keeps rows, policy and manual overrides,
 * never uses recalculation to erase an edit, and retains an ambiguous POST in
 * the request-owned ledger for read-only recovery. */
export async function runSelectedPricingWork(productId: string, controls: Controls): Promise<SelectedPricingWorkResult> {
 let totalOptions = 0,uncertain=false;
 const result = (status: SelectedPricingWorkResult['status'], message: string, calculatedOptions = 0): SelectedPricingWorkResult =>
  ({ status, message, calculatedOptions, totalOptions, uncertain });
 const current = async () => {
  if (controls.signal.aborted) throw new PricingWorkError('가격 계산 확인을 중지했습니다.');
  try { await controls.assertCurrent?.(); } catch (cause) { throw new PricingWorkError(cause instanceof Error ? cause.message : '가격 작업의 로그인 계정과 회사를 확인하지 못했습니다.'); }
  if (controls.signal.aborted) throw new PricingWorkError('가격 계산 확인을 중지했습니다.');
 };
 try {
  await current();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(productId)||!/^[A-Za-z0-9_-]{1,100}$/.test(controls.expectedOwnerId)||!controls.keys||typeof controls.keys.get!=='function'||typeof controls.keys.set!=='function') throw bad();
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
  const bound=(receipt:StageTwoPricingReceipt)=>{if(receipt?.product?.owner_id!==controls.expectedOwnerId)throw bad();return verify(productId,receipt);};
  const saveRequest=(before:StageTwoPricingReceipt):StageTwoPricingRequest=>({expectedProductVersion:before.product.updated_at,expectedOptionRevision:before.options.options.revision,
   expectedQuotationRevision:before.quotation.revision,expectedInputFingerprint:before.quotation.inputFingerprint,policy:before.options.pricing.policy,rows:optionInputs(before.options.options),changes:[],recalculate:false});
  const key=controls.expectedOwnerId+':'+productId+':pricing-save-v1',retained=controls.keys.get(key);
  const confirmed=(attempt:PricingSaveAttempt,saved:StageTwoPricingReceipt)=>{
   bound(saved);verifyStageTwoPricingReceipt(attempt.before.options,attempt.before.quotation,attempt.request,saved);
   controls.keys.delete(key);uncertain=false;
   return result('complete',`포함 옵션 ${totalOptions}개의 가격 설정과 현재 견적 가격을 저장·재조회해 확인했습니다. 기존 정책·구성 수량·수동 가격을 유지했으며 서플라이허브 전송은 실행하지 않았습니다.`,totalOptions);
  };
  if(retained!==undefined){
   // No new write is authorized by a remount or by a failed readback.
   uncertain=true;let attempt:PricingSaveAttempt;
   try{attempt=JSON.parse(retained) as PricingSaveAttempt;if(attempt.format!=='yoofam-selected-pricing-save-v1'||attempt.ownerId!==controls.expectedOwnerId||attempt.productId!==productId
     ||!same(Object.keys(attempt).sort(),['before','format','ownerId','productId','request'])||!same(attempt.request,saveRequest(attempt.before)))throw bad();
    totalOptions=bound(attempt.before).totalOptions;
   }catch{throw new PricingWorkError('이전 가격 저장 요청의 계정·상품·원문을 확인하지 못했습니다. 자동으로 다시 저장하지 않았습니다.');}
   try{const saved=await read();await current();return confirmed(attempt,saved);}catch{throw new PricingWorkError('이전 가격 저장 결과를 아직 확인하지 못했습니다. 원래 요청을 유지하고 재전송하지 않았습니다.');}
  }
  const before = await read(), checked = verify(productId, before); totalOptions = checked.totalOptions;
  bound(before);const after = await read(); bound(after);
  if (!same(before, after)) throw new PricingWorkError('가격 계산 확인 중 상품·옵션·정책 또는 견적서가 변경됐습니다. 최신 저장값으로 다시 확인해주세요.');
  await current();
  const policy=before.options.pricing.policy,plan=stageTwoQuotationDraft(before.quotation,policy,false,[]),state={...plan.state,productId};
  if(!same(plan.overrides,before.quotation.overrides)||!same(plan.stageTwoMsrp,before.quotation.stageTwoMsrp))throw new PricingWorkError('저장된 수동 가격·MSRP를 바꾸지 않고 확인할 수 없습니다. 2단계에서 현재 값을 검토해주세요.');
  if(matchesStageTwoPricingReview(before.pricingReview,{ownerId:controls.expectedOwnerId,product:before.product,policy,options:before.options.options,state,schema:before.quotation.resolved.schema,profileId:before.quotation.categoryContext.profileId}))
   return result('complete',`포함 옵션 ${totalOptions}개의 현재 가격 설정과 견적 가격에 일치하는 저장 기록을 확인했습니다. 추가 저장 없이 기존 정책·수동 가격을 유지했습니다.`,totalOptions);
  // Validate the final amounts before requesting a durable review. Deliberate
  // blanks stay blank and require editing rather than a made-up price.
  const targets=quotationPriceTargets(before.quotation.resolved.schema.fields);
  if(before.quotation.resolved.rows.filter(row=>row.included&&row.optionId!==null).some(row=>{
   if(quotationPriceInputs.some(input=>targets[input].linked.some(field=>{
    const definition=before.quotation.resolved.schema.fields.find(item=>item.id===field),value=row.fields[field]?.value;
    if(!definition||typeof value!=='string')return true;
    if(!value.trim())return input!=='msrp'||!!definition.required;
    const amount=quotationNumericValue(definition,value);return amount===undefined||amount<=0||quotationScalarValueIssues(definition,value).length>0;
   })))return true;
   const read=(input:'supplyPrice'|'salePrice')=>{const field=before.quotation.resolved.schema.fields.find(item=>item.id===targets[input].primary)!;return quotationNumericValue(field,row.fields[field.id].value)!;};
   return before.quotation.resolved.schema.salePriceMustCoverSupply===true&&read('salePrice')<read('supplyPrice');
  }))throw new PricingWorkError('직접 비운 값 또는 유효하지 않은 최종 가격이 있습니다. 기존 수동 가격과 공란을 유지했으며 저장하지 않았습니다. 2단계에서 확인해주세요.');
  const attempt:PricingSaveAttempt={format:'yoofam-selected-pricing-save-v1',ownerId:controls.expectedOwnerId,productId,before,request:saveRequest(before)};
  const encoded=JSON.stringify(attempt);if(encoded.length>4*1024*1024)throw new PricingWorkError('가격 저장 확인 자료가 너무 큽니다. 2단계에서 현재 값을 확인해주세요.');
  await current();controls.keys.set(key,encoded);uncertain=true;
  // A protected fetcher can reject its account preflight before handing the
  // POST to transport. Only that proven unsent case is safe to retry.
  let dispatched=!controls.trackMutationDispatch;const stopTracking=controls.trackMutationDispatch?.(()=>{dispatched=true;});
  try{
   const response=await(controls.fetcher??fetch)(endpoint,{method:'POST',signal:controls.signal,cache:'no-store',credentials:'same-origin',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify(attempt.request)});
   await current();
   if(response.redirected||response.type==='opaqueredirect'||!response.ok||response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')throw bad();
   const saved=await response.json() as StageTwoPricingReceipt;await current();
   // Validate the POST and then independently reread the same commit.
   bound(saved);verifyStageTwoPricingReceipt(before.options,before.quotation,attempt.request,saved);
   const reread=await read();if(!same(saved,reread))throw bad();await current();return confirmed(attempt,reread);
  }catch{
   if(!dispatched){controls.keys.delete(key);uncertain=false;throw new PricingWorkError('가격 저장 전 계정·회사 확인이 중단되어 요청을 보내지 않았습니다. 저장값을 유지했으며 다시 작업할 수 있습니다.');}
   await current();
   try{const saved=await read();await current();return confirmed(attempt,saved);}catch{throw new PricingWorkError('가격 저장 응답이 미확정입니다. 원래 요청을 유지하고 저장본만 다시 확인합니다. 자동 재전송하지 않았습니다.');}
  }finally{stopTracking?.();}
 } catch (cause) {
  if (controls.signal.aborted) return result('blocked', '가격 계산 확인을 중지했습니다.');
  return result(cause instanceof PricingWorkError ? cause.status : 'failed', cause instanceof Error ? cause.message : '가격 계산을 확인하지 못했습니다.');
 }
}
