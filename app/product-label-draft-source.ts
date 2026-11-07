import {readCollectionResult} from '@/db/collection-results';
import {currentLabelBundleQuantity,currentSavedLabelNotices} from '@/app/product-label-current-rules';
import type {ProductLabelDraftSource} from '@/app/product-label-draft';
import type {ProductRecord} from '@/db/queries';
import type {ProductContent} from '@/app/product-content';
import type {ProductOptions} from '@/app/product-options';
import type {QuotationFieldsView} from '@/app/quotation-schema';
import type {QuotationSourceGuard} from '@/db/quotation-fields';
export async function savedProductLabelDraftSource(owner:string,input:{product:ProductRecord;content:ProductContent;options:ProductOptions;quotation:QuotationFieldsView;source:QuotationSourceGuard},optionId:string|null):Promise<ProductLabelDraftSource>{
 const {product,content,options,quotation,source}=input,option=optionId===null?null:options.rows.find(row=>row.id===optionId);
 if(optionId!==null&&!option)throw Error('선택 옵션이 바뀌었습니다.');
 const receipt=source.collection?.snapshot?.linked?await readCollectionResult(owner,source.collection.snapshot.id):null;
 if(source.collection?.snapshot?.linked&&(!receipt||receipt.result.offerId!==source.collection.offerId))throw Error('수집 원문 연결을 확인해주세요.');
 const original=receipt?.result;
 return{originalTitle:original?.title??product.title,productName:quotation.resolved.rows.find(row=>row.optionId===optionId)?.fields.title?.value??content.seo.title.value,
 description:content.detail?.description?.provenance==='manual'?content.detail.description.value:original?.description??content.detail?.description?.value??content.seo.description.value,attributes:original?.attributes??[],manualKeys:(['netContents','material','productType'] as const).filter(key=>content.label[key].provenance==='manual'),
 officialCategory:quotation.categoryContext.source!=='unknown'&&quotation.resolved.schema.status==='observed',
 option:option?{optionId:option.id,originalName:option.originalName,translatedName:option.translatedName,unitsPerPack:option.unitsPerPack}:null,bundleQuantity:currentLabelBundleQuantity(options,optionId),savedNotices:currentSavedLabelNotices(quotation.resolved.schema,quotation.overrides,optionId,content)};
}
