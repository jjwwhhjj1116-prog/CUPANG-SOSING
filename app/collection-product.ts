import { validateCollectionResult, type CollectionResult } from '@/app/collection-result';
import { validateSettings } from '@/app/workspace-settings';
import { calculatePrice, pricePolicy } from '@/app/pricing';
import { emptyProductOptions, emptyOptionInput, optionFieldNames, validateOptionsInput, type ProductOption } from '@/app/product-options';
import { workspaceBannerAssignments } from '@/app/workspace-banners';
import { emptyProductContent } from '@/app/product-content';
import { initialStatuses } from '@/app/workflow';
import { collectionKeywords, type CollectionJob } from '@/app/sourcing';
import type { ProductRecord } from '@/db/queries';

export function prepareCollectionProduct(owner:string,job:CollectionJob,receipt:CollectionResult,id:string,now:string){
  if(!job.context?.category?.id)throw new Error('요청 당시 카테고리와 기본설정이 필요합니다.');
  const {offerId,...raw}=receipt;const result=validateCollectionResult(raw,job.offer_id);
  if(offerId!==job.offer_id)throw new Error('원문의 상품번호가 다릅니다.');
  const settings=validateSettings(job.context.settings);
  const policy=pricePolicy({...settings,minimumMargin:settings.minimumMarginEnabled?settings.minimumMargin:0});
  // Representative price is the lowest observed SKU unit price, never an invented bundle.
  const cost=Math.min(...result.options.map(row=>row.unitPriceCny));const price=calculatePrice(cost,policy);
  const rows=result.options.map((row,index)=>({...emptyOptionInput(`collected-${index+1}`),originalName:row.name,supplierSku:row.sku,stock:row.stock,color:row.color??'',size:row.size??'',unitCostCny:row.unitPriceCny,minimumOrderQuantity:row.minimumOrder,included:true}));
  validateOptionsInput({expectedRevision:0,expectedProductVersion:now,rows},owner,[]);
  for(const row of rows)calculatePrice(row.unitCostCny,policy);
  const options={...emptyProductOptions(id),revision:1,updatedAt:now,rows:rows.map(row=>({...row,updatedAt:now,provenance:Object.fromEntries(Object.keys(optionFieldNames).map(key=>[key,['originalName','supplierSku','unitCostCny','minimumOrderQuantity'].includes(key)||key==='stock'&&row.stock!==null||key==='color'&&row.color||key==='size'&&row.size?'collected':['unitsPerPack','included'].includes(key)?'manual':'unverified']))} as ProductOption))};
  const content=emptyProductContent(id);content.revision=1;content.updatedAt=now;
  content.seo.title={value:result.title,provenance:'collected',updatedAt:now};content.seo.description={value:result.description,provenance:'collected',updatedAt:now};
  const keywords=collectionKeywords(job.context.keywords);
  if (keywords.length) content.seo.keywords={value:keywords,provenance:'manual',updatedAt:now};
  // These are the owner's captured registration inputs, not supplier facts or
  // translated claims. Explicit blanks must survive later workspace changes.
  for (const [field, setting] of [['manufacturer','manufacturer'],['importer','importer'],['contact','serviceContact']] as const) {
    if (Object.hasOwn(job.context.settings, setting)) content.label[field] = { value: settings[setting], provenance: 'manual', updatedAt: now };
  }
  const product:ProductRecord={id,owner_id:owner,source_url:result.sourceUrl,title:result.title,source_price_cny:cost,exchange_rate:policy.exchangeRate,supply_margin:policy.supplyMargin,coupang_margin:policy.coupangMargin,supply_price:price.supplyPrice,sale_price:price.salePrice,msrp:price.msrp,options_count:rows.length,...initialStatuses,registration_status:'수집 원문 반영',image_keys:'[]',goal_stage:job.goal,created_at:now,updated_at:now};
  const banners=workspaceBannerAssignments(settings,owner);
  for(const [role,key] of banners)content.assets[role]={value:[key],provenance:'manual',updatedAt:now};
  product.image_keys=JSON.stringify(banners.map(([,key])=>key));
  return {product,policy,options,content};
}
