import { applyOptionRows, calculateOptionPrices, optionInputs, type OptionInput, type ProductOptionsResponse } from '@/app/product-options';

const ordered=(value:unknown):unknown=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'
  ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,ordered(item)])):value;
const same=(a:unknown,b:unknown)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
/** A grid source save must acknowledge the complete ordered draft before its
 * returned clocks can become the base for a separate quotation price write. */
export function verifyGridOptionSave(base:ProductOptionsResponse,saved:ProductOptionsResponse,draft:readonly OptionInput[]) {
  if(!saved?.options||saved.options.productId!==base.options.productId||saved.options.revision!==base.options.revision+1
    ||!Number.isFinite(Date.parse(saved.productVersion))||Date.parse(saved.productVersion)<=Date.parse(base.productVersion)
    ||saved.options.updatedAt!==saved.productVersion||!same(saved.pricing?.policy,base.pricing.policy))throw Error('옵션 저장 결과의 상품·가격 버전을 확인하지 못했습니다. 입력은 유지했습니다.');
  // The existing options endpoint trims text. It also owns provenance and the
  // packaging-confirmation transition; use that same pure transition to verify.
  const normalized=draft.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='string'&&key!=='id'?value.trim():value])) as OptionInput);
  const expected=applyOptionRows(base.options,normalized,saved.productVersion);
  if(!same(saved.options,expected)||!same(saved.pricing.rows,calculateOptionPrices(saved.options.rows,base.pricing.policy)))throw Error('저장된 옵션의 전체 항목·순서가 요청한 입력과 다릅니다. 가격 입력은 유지했습니다.');
  return saved;
}
export function unchangedGridOptionSave(base:ProductOptionsResponse,latest:ProductOptionsResponse) {
  return latest.options.productId===base.options.productId&&latest.options.revision===base.options.revision
    &&latest.productVersion===base.productVersion&&same(optionInputs(latest.options),optionInputs(base.options))&&same(latest.pricing.policy,base.pricing.policy);
}
