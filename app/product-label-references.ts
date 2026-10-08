import { verifyProductLabelsView, type ProductLabelsView } from '@/app/product-label';
import { applyQuotationChanges, validateQuotationChanges, type QuotationFieldsView } from '@/app/quotation-schema';
import { exactPrimaryQuotationTarget } from '@/app/quotation-seo-targets';

export type ProductLabelReferenceScope = { productId: string; optionId: string | null; endpoint: string; quotationEndpoint: string };
export type ProductLabelReferences = { view: ProductLabelsView; quotation: QuotationFieldsView; keys: string[] };
export class ProductLabelReferenceSaveError extends Error { constructor(message: string, public uncertain: boolean) { super(message); } }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keys = (value: string) => [...new Set(value.split(/\r?\n/).map(key => key.trim()).filter(Boolean))];
function scope(input: ProductLabelReferenceScope) {
  const labels = new URL(input.endpoint,'https://label.invalid'), quote = new URL(input.quotationEndpoint,'https://label.invalid');
  if (!/^\w[\w-]{0,99}$/.test(input.productId) || input.optionId !== null && !/^[A-Za-z0-9_-]{1,80}$/.test(input.optionId)
    || labels.origin !== 'https://label.invalid' || quote.origin !== labels.origin || labels.pathname !== `/api/products/${encodeURIComponent(input.productId)}/product-labels`
    || quote.pathname !== `/api/products/${encodeURIComponent(input.productId)}/quotation-fields` || labels.search !== quote.search || labels.hash || quote.hash
    || [...labels.searchParams.keys()].some(key=>key!=='profileId') || labels.searchParams.getAll('profileId').length > 1
    || labels.searchParams.has('profileId') && !/^[A-Za-z0-9_-]{1,100}$/.test(labels.searchParams.get('profileId')!)) throw Error('최종 라벨의 상품·옵션·카테고리 연결을 확인해주세요.');
  return labels.searchParams.get('profileId') ?? undefined;
}
export function productLabelReferences(input: ProductLabelReferenceScope, view: ProductLabelsView, quotation: QuotationFieldsView): ProductLabelReferences {
  verifyProductLabelsView(view,input.optionId,scope(input));
  if (view.productId !== input.productId || !quotation || quotation.productVersion !== view.productVersion || quotation.inputFingerprint !== view.quotationInputFingerprint
    || quotation.revision !== view.quotationRevision || quotation.contentRevision !== view.contentRevision || quotation.optionRevision !== view.optionRevision
    || !same(quotation.categoryContext,view.categoryContext) || !same(quotation.imageKeys,view.imageKeys)
    || !Array.isArray(quotation.resolved?.schema?.fields) || !Array.isArray(quotation.resolved.rows) || !quotation.overrides?.common || !quotation.overrides.options
    || quotation.resolved.rows.filter(row=>row.optionId===input.optionId).length!==1) throw Error('표시사항과 최종 견적 라벨의 저장 상태가 다릅니다. 다시 조회해주세요.');
  const target=exactPrimaryQuotationTarget(quotation.resolved.schema.fields,'labelImages'),row=quotation.resolved.rows.find(row=>row.optionId===input.optionId)!;
  if (target.fields.some(field=>field.readOnly || typeof row.fields[field.id]?.value!=='string')) throw Error('최종 제품 라벨의 항목 연결을 확인해주세요.');
  return {view,quotation,keys:keys(row.fields[target.primary].value)};
}
export async function readProductLabelReferences(input: ProductLabelReferenceScope, request: typeof fetch = fetch): Promise<ProductLabelReferences> {
  scope(input);
  async function read<T>(url:string):Promise<T>{const response=await request(url,{cache:'no-store'}),body=await response.json() as T & {error?:string};if(!response.ok)throw Error(body?.error||'최종 라벨 저장본을 읽지 못했습니다.');return body;}
  const before=await read<ProductLabelsView>(input.endpoint),quotation=await read<QuotationFieldsView>(input.quotationEndpoint),view=await read<ProductLabelsView>(input.endpoint);
  if (before.revision!==view.revision || before.productVersion!==view.productVersion || before.inputFingerprint!==view.inputFingerprint) throw Error('라벨을 조회하는 동안 저장값이 변경됐습니다. 다시 조회해주세요.');
  return productLabelReferences(input,view,quotation);
}
function changes(input:ProductLabelReferenceScope,before:ProductLabelReferences,selected:readonly string[]) {
  productLabelReferences(input,before.view,before.quotation);
  if(!Array.isArray(selected)||selected.some(key=>typeof key!=='string'||!before.quotation.imageKeys.includes(key))||new Set(selected).size!==selected.length)throw Error('현재 상품에 저장된 이미지 파일만 최종 라벨에 연결해주세요.');
  const target=exactPrimaryQuotationTarget(before.quotation.resolved.schema.fields,'labelImages');
  return validateQuotationChanges(target.linked.map(fieldKey=>({optionId:input.optionId,fieldKey,value:selected.join('\n')})),{schema:before.quotation.resolved.schema,optionIds:before.quotation.resolved.rows.flatMap(row=>row.optionId?[row.optionId]:[]),ownedImageKeys:before.quotation.imageKeys,overrides:before.quotation.overrides});
}
export function verifyProductLabelReferenceSave(input:ProductLabelReferenceScope,before:ProductLabelReferences,saved:ProductLabelReferences,selected:readonly string[]) {
  productLabelReferences(input,saved.view,saved.quotation);const planned=changes(input,before,selected),q=before.quotation,next=saved.quotation;
  const target=exactPrimaryQuotationTarget(q.resolved.schema.fields,'labelImages'),newTarget=exactPrimaryQuotationTarget(next.resolved.schema.fields,'labelImages');
  const stored=input.optionId===null?next.overrides.common:next.overrides.options[input.optionId],row=next.resolved.rows.find(row=>row.optionId===input.optionId)!;
  if(next.revision!==q.revision+1 || next.updatedAt!==next.productVersion || !Number.isFinite(Date.parse(next.productVersion)) || Date.parse(next.productVersion)<=Date.parse(q.productVersion)
    || next.contentRevision!==q.contentRevision || next.optionRevision!==q.optionRevision || !same(next.imageKeys,q.imageKeys) || !same(next.categoryContext,q.categoryContext) || !same(target,newTarget)
    || !same(next.overrides,applyQuotationChanges(q.overrides,planned)) || saved.view.revision!==before.view.revision || !same(saved.view.overrides,before.view.overrides)
    || !same(saved.view.rows,before.view.rows) || planned.some(change=>!stored||!Object.hasOwn(stored,change.fieldKey)||stored[change.fieldKey]!==change.value||row.fields[change.fieldKey]?.value!==change.value))
    throw Error('최종 라벨 저장 응답이 요청한 범위와 다릅니다. 입력과 원본 파일은 유지됩니다.');
}
export function verifyProductLabelReferenceRefresh(input:ProductLabelReferenceScope,before:ProductLabelReferences,latest:ProductLabelReferences){
  productLabelReferences(input,before.view,before.quotation);productLabelReferences(input,latest.view,latest.quotation);
  const q=before.quotation,next=latest.quotation,target=exactPrimaryQuotationTarget(q.resolved.schema.fields,'labelImages');
  const own=(view:QuotationFieldsView,id:string)=>input.optionId===null?view.overrides.common[id]:view.overrides.options[input.optionId]?.[id];
  if(next.revision<q.revision||Date.parse(next.productVersion)<Date.parse(q.productVersion)||next.contentRevision<q.contentRevision||next.optionRevision<q.optionRevision
    ||!same(next.categoryContext,q.categoryContext)||!same(exactPrimaryQuotationTarget(next.resolved.schema.fields,'labelImages'),target)
    ||target.linked.some(id=>!same(own(q,id),own(next,id))||!same(q.overrides.common[id],next.overrides.common[id])
      ||!same(q.resolved.rows.find(row=>row.optionId===input.optionId)?.fields[id],next.resolved.rows.find(row=>row.optionId===input.optionId)?.fields[id])))
    throw Error('최종 라벨 참조에 다른 변경이 있습니다. 입력을 유지했습니다. 저장본과 비교한 뒤 다시 선택해주세요.');
}
/** Explicit reference edits only: no upload, file deletion, product-content edit
 * or nine-row save. A response-loss retry first proves the stored whole override
 * and never repeats a PUT that has already committed. */
export async function saveProductLabelReferences(input:ProductLabelReferenceScope,before:ProductLabelReferences,selected:readonly string[],request:typeof fetch=fetch):Promise<ProductLabelReferences>{
  const planned=changes(input,before,selected),current=await readProductLabelReferences(input,request);
  if(current.quotation.revision!==before.quotation.revision || current.quotation.inputFingerprint!==before.quotation.inputFingerprint || current.view.inputFingerprint!==before.view.inputFingerprint){verifyProductLabelReferenceSave(input,before,current,selected);return current;}
  if(!same(current.quotation.overrides,before.quotation.overrides)||!same(current.view.rows,before.view.rows)||current.quotation.productVersion!==before.quotation.productVersion)throw Error('최종 라벨 저장본이 바뀌었습니다. 입력을 유지하고 다시 조회해주세요.');
  let response:Response|undefined;
  try{
    response=await request(input.quotationEndpoint,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:before.quotation.revision,expectedInputFingerprint:before.quotation.inputFingerprint,changes:planned})});
    const acknowledged=await response.json() as QuotationFieldsView & {error?:string};if(!response.ok)throw Error(acknowledged.error||'최종 라벨 참조를 저장하지 못했습니다.');
    const saved=await readProductLabelReferences(input,request);verifyProductLabelReferenceSave(input,before,saved,selected);
    if(acknowledged.revision!==saved.quotation.revision||acknowledged.productVersion!==saved.quotation.productVersion||acknowledged.inputFingerprint!==saved.quotation.inputFingerprint
      || !same(acknowledged.overrides,saved.quotation.overrides)||!same(acknowledged.resolved,saved.quotation.resolved))throw Error('최종 라벨 저장 응답과 실제 저장본이 다릅니다.');
    return saved;
  }catch(cause){
    try{const recovered=await readProductLabelReferences(input,request);verifyProductLabelReferenceSave(input,before,recovered,selected);return recovered;}catch{/* Preserve exact pending reference choices until an explicit retry/read. */}
    throw new ProductLabelReferenceSaveError(cause instanceof Error?cause.message:'최종 라벨 연결 결과를 확인하지 못했습니다.',!response||response.ok);
  }
}
