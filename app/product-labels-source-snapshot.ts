import {readProductLabels,productLabelsSourcesCurrent,type ProductLabelSourceGuard} from '@/db/product-labels';
import {resolveProductLabels,verifyProductLabelsView,type ProductLabelsView,type ProductLabelsState} from '@/app/product-label';
import {fingerprint} from '@/app/automation/model';
import {productImageKeys,type ProductContent} from '@/app/product-content';
import {isOwnedImageKey} from '@/app/image-files';
import type {ProductRecord} from '@/db/queries';
import type {ProductOptions} from '@/app/product-options';
import type {WorkspaceSettings} from '@/app/workspace-settings';
import type {QuotationFieldsView} from '@/app/quotation-schema';
import type {QuotationSourceGuard} from '@/db/quotation-fields';
export class ProductLabelsSnapshotError extends Error {constructor(message:string,public status:number,public code?:string){super(message);}}
const LabelError=ProductLabelsSnapshotError;
const conflict=()=>new LabelError('상품·옵션·설정·카테고리·견적 또는 표시사항 저장값이 변경되었습니다. 입력을 유지하고 최신 자료를 다시 확인해주세요.',409,'PRODUCT_LABELS_CONFLICT');
type Source={owner:string;id:string;profileId:string|null;product:ProductRecord;content:ProductContent;options:ProductOptions;settings:WorkspaceSettings;source:QuotationSourceGuard;quotation:QuotationFieldsView;state?:ProductLabelsState};
/** Internal, phase-local source reuse only. Labels and their complete SQL fence
 * remain fresh; public requests never supply a preloaded source. */
export async function productLabelsSnapshotFromSource(input:Source){
  const {owner,id,profileId,product,content,options,settings,quotation}=input;
  if(product.owner_id!==owner||product.id!==id||content.productId!==id||options.productId!==id)throw conflict();
  const state=input.state??await readProductLabels(owner,id);
  const imageKeys = productImageKeys(product.image_keys).filter(key => isOwnedImageKey(owner, key));
  if (quotation.productVersion !== product.updated_at || quotation.contentRevision !== content.revision || quotation.optionRevision !== options.revision
    || JSON.stringify(quotation.imageKeys) !== JSON.stringify(imageKeys)) throw conflict();
  if (!quotation.categoryContext?.categoryId) throw new LabelError('상품에 맞는 카테고리를 선택한 뒤 표시사항을 작성해주세요.', 409, 'PRODUCT_LABELS_CATEGORY_REQUIRED');
  const source: ProductLabelSourceGuard = { ...input.source, quotationRevision: quotation.revision };
  const rows = resolveProductLabels({ productId: id, state, content, options, quotation, settings });
  const inputFingerprint = await fingerprint({ recipe: 'product-label-source-v1', productId: id, source,
    quotationInputFingerprint: quotation.inputFingerprint, categoryContext: quotation.categoryContext, labelRevision: state.revision, overrides: state.overrides, rows,
    ...(state.structure === undefined ? {} : { structure: state.structure }), ...(state.renderEpoch === undefined ? {} : { renderEpoch: state.renderEpoch }) });
  const view: ProductLabelsView = { productId: id, revision: state.revision, inputFingerprint, productVersion: product.updated_at,
    contentRevision: content.revision, optionRevision: options.revision, quotationRevision: quotation.revision,
    quotationInputFingerprint: quotation.inputFingerprint, categoryContext: quotation.categoryContext, imageKeys,
    overrides: state.overrides, rows, updatedAt: state.updatedAt, ...(state.structure === undefined ? {} : { structure: state.structure }),
    ...(state.renderEpoch === undefined ? {} : { renderEpoch: state.renderEpoch }) };
  verifyProductLabelsView(view, null, profileId ?? undefined);
  if (!await productLabelsSourcesCurrent(owner, id, source, state.revision)) throw conflict();
  return { view, source, options };
}
