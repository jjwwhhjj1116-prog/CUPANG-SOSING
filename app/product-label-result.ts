import {productLabelPlan} from '@/app/product-label';
import {readProductLabelReferences,type ProductLabelReferences,type ProductLabelReferenceScope} from '@/app/product-label-references';
import {readProductLabelReceipt,type ProductLabelReceipt} from '@/app/product-label-proof';
import {exactPrimaryQuotationTarget} from '@/app/quotation-seo-targets';
import {labelUploadDigest} from '@/app/label-upload-key';

export type CurrentProductLabelResult = {
  references:ProductLabelReferences;
  result:{key:string;proof:ProductLabelReceipt;plan:'filtered'|'legacy-full'}|null;
  reason:null|'missing'|'manual'|'stale'|'unconfirmed'|'ambiguous';
};
const digest=(value:unknown)=>labelUploadDigest(new TextEncoder().encode(JSON.stringify(value)));

/** A completed card needs a currently selected, owner-authenticated generated
 * PNG. Its filename locates the receipt; it never establishes completion. No
 * upload, regeneration, reference edit or other write occurs during this read. */
export async function readCurrentProductLabelResult(input:ProductLabelReferenceScope,request:typeof fetch=fetch):Promise<CurrentProductLabelResult>{
  const references=await readProductLabelReferences(input,request);
  const incomplete=(reason:Exclude<CurrentProductLabelResult['reason'],null>):CurrentProductLabelResult=>({references,result:null,reason});
  if(!references.keys.length)return incomplete('missing');
  if(references.keys.length!==1)return incomplete('ambiguous');
  const key=references.keys[0];
  if(!references.view.imageKeys.includes(key))return incomplete('unconfirmed');
  const locator=/^[^/\\\s%?#]+\/quotation-label-([a-f0-9]{64})\.png$/.exec(key);
  if(!locator)return incomplete('manual');
  const receipt=await readProductLabelReceipt(locator[1],request);
  if(receipt.key===null)return incomplete('unconfirmed');
  if(receipt.key!==key)throw Error('저장된 표시사항 파일과 현재 계정의 생성 증빙이 다릅니다. 다시 조회해주세요.');
  const proof=receipt.proof;
  if(!proof)return incomplete('manual');
  const {view,quotation}=references;
  if(proof.productId!==input.productId||proof.profileId!==view.categoryContext.profileId||(proof.renderEpoch??0)!==(view.renderEpoch??0)
    ||proof.categorySha256!==await digest([view.categoryContext.categoryId,view.categoryContext.categoryPath]))return incomplete('stale');
  const target=exactPrimaryQuotationTarget(quotation.resolved.schema.fields,'labelImages'),row=quotation.resolved.rows.find(item=>item.optionId===input.optionId)!;
  if(proof.optionId!==input.optionId){
    const own=input.optionId===null?undefined:quotation.overrides.options[input.optionId],value=row.fields[target.primary].value;
    const inherited=input.optionId!==null&&proof.optionId===null&&target.linked.every(id=>(!own||!Object.hasOwn(own,id))
      &&Object.hasOwn(quotation.overrides.common,id)&&quotation.overrides.common[id]===value&&row.fields[id]?.value===value);
    if(!inherited)return incomplete('stale');
  }
  let plan:'filtered'|'legacy-full';
  try{
    if(proof.planSha256===await digest(productLabelPlan(view,input.optionId)))plan='filtered';
    else if(proof.planSha256===await digest(productLabelPlan(view,input.optionId,{includeEmpty:true})))plan='legacy-full';
    else return incomplete('stale');
  }catch{return incomplete('stale');}
  // The image may have been read while another tab rewrites values, structure,
  // references or epoch. A previous valid proof must not hide the new editor.
  const confirmed=await readProductLabelReferences(input,request);
  if(JSON.stringify(confirmed)!==JSON.stringify(references))throw Error('표시사항 결과를 확인하는 동안 저장값이 변경됐습니다. 다시 조회해주세요.');
  return {references:confirmed,result:{key,proof,plan},reason:null};
}
