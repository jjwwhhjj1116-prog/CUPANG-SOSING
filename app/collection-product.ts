import { usableCategoryCode } from '@/app/category-profiles';
import { validateCategoryIdentity } from '@/app/category-identity';
import { validateCollectionResult, type CollectionResult } from '@/app/collection-result';
import { validateSettings } from '@/app/workspace-settings';
import { calculatePrice, calculateRepresentativePrice, pricePolicy } from '@/app/pricing';
import { initialBundleQuantity } from '@/app/bundle-policy';
import { emptyProductOptions, emptyOptionInput, optionFieldNames, validateOptionsInput, type ProductOption } from '@/app/product-options';
import { workspaceBannerAssignments } from '@/app/workspace-banners';
import { fillLabelDraft, labelDateNotice } from '@/app/label-autofill';
import { collectionLabelAttributes, confirmedCollectionOrigin } from '@/app/collection-label-attributes';
import { quotationStructuredOptionColor, translateCollectedOptionColor } from '@/app/quotation-option-color';
import { newProductContent, type LabelField } from '@/app/product-content';
import { initialStatuses } from '@/app/workflow';
import { collectionKeywords, collectionSourceReference, type CollectionJob } from '@/app/sourcing';
import type { ProductRecord } from '@/db/queries';
import { capturedCollectionCompany } from '@/app/collection-company';
import { createInitialLegalNotices } from '@/app/initial-legal-notices';
import { getQuotationSchema } from '@/app/quotation-schema';
import { registrationBrandChoices } from '@/app/quotation-brand-choices';

export function prepareCollectionProduct(owner:string,job:CollectionJob,receipt:CollectionResult,id:string,now:string){
  if(!job.context?.category?.id)throw new Error('요청 당시 카테고리와 기본설정이 필요합니다.');
  capturedCollectionCompany(job.context);
  const category = job.context.category;
  if (!usableCategoryCode(category.categoryId) || !Array.isArray(category.categoryPath)
    || !category.categoryPath.length || category.categoryPath.some(part => typeof part !== 'string' || !part.trim())) {
    throw new Error('수집 요청의 카테고리 코드와 전체 경로를 다시 선택해주세요. 원문은 보존됩니다.');
  }
  validateCategoryIdentity(category);
  const {offerId,...raw}=receipt;const result=validateCollectionResult(raw,job.offer_id);
  if(offerId!==job.offer_id)throw new Error('원문의 상품번호가 다릅니다.');
  const capturedSettings={...job.context.settings};delete capturedSettings.rocketMarginGate;
  const settings=validateSettings(capturedSettings);
  const policy=pricePolicy({...settings,...(settings.roundingMode==='nearest'?{arithmeticMode:'couplus-number-v1'}:{}),minimumMargin:settings.minimumMarginEnabled?settings.minimumMargin:0,recalculationMinimumEnabled:settings.minimumMarginEnabled});
  const native = category.hubSchema?.nativeSerializationPolicy === 'supplier-hub-native-required-form-v1';
  // Use observed SKU prices, or the separately proved product-level default.
  const cost=Math.min(...result.options.map(row=>row.unitPriceCny));const price=calculateRepresentativePrice(cost,policy);
  const productColors = native && result.options.length === 1 ? new Set((result.attributes ?? [])
    .filter(pair => ['색상', '颜色', '顏色', 'color', 'colour'].includes(pair.name.trim().toLowerCase())).map(pair => pair.value.trim())) : new Set<string>();
  const onlyColor = productColors.size === 1 ? [...productColors][0] : '';
  const singleOptionColor = quotationStructuredOptionColor(onlyColor) ? onlyColor : '';
  const rawColors = result.options.map(row => row.color || singleOptionColor);
  const translatedColors = native ? rawColors.map(translateCollectedOptionColor) : [];
  const rows=result.options.map((row,index)=>({...emptyOptionInput(`collected-${index+1}`),originalName:row.name,supplierSku:row.sku,stock:row.stock,color:translatedColors[index]??rawColors[index],size:row.size??'',unitCostCny:row.unitPriceCny,unitsPerPack:initialBundleQuantity(row.unitPriceCny,policy,settings),minimumOrderQuantity:row.minimumOrder,included:true,
    ...(row.packaging?{packagedWeightG:row.packaging.weightG??null,packagedWidthMm:row.packaging.widthMm??null,packagedLengthMm:row.packaging.lengthMm??null,packagedHeightMm:row.packaging.heightMm??null}:{})}));
  validateOptionsInput({expectedRevision:0,expectedProductVersion:now,rows},owner,[]);
  for(const row of rows)calculatePrice(row.unitCostCny,policy,row.unitsPerPack);
  const options={...emptyProductOptions(id),revision:1,updatedAt:now,rows:rows.map((row,index)=>{
    const provenance = Object.fromEntries(Object.keys(optionFieldNames).map(key=>[key,
      ['originalName','unitCostCny'].includes(key)||key==='minimumOrderQuantity'&&row.minimumOrderQuantity!==null||key==='supplierSku'&&row.supplierSku!==''||key==='stock'&&row.stock!==null||key==='color'&&row.color||key==='size'&&row.size||['packagedWeightG','packagedWidthMm','packagedLengthMm','packagedHeightMm'].includes(key)&&row[key as keyof typeof row]!=null?'collected':['unitsPerPack','included'].includes(key)?'manual':'unverified',
    ])) as ProductOption['provenance'];
    if (translatedColors[index]) provenance.color = 'translated';
    return {...row,...(result.options[index].packaging?{packagingUnitsPerPack:1}:{}),updatedAt:now,provenance};
  })};
  const content=newProductContent(id);content.revision=1;content.updatedAt=now;
  if (native) {
    content.quotationWorkflow = 'collected-native-v1';
    content.collectedFacts = 'confirmed-origin-color-v1';
    content.labelDefaults = 'couplus-category-v1';
  }
  content.seo.title={value:result.title,provenance:'collected',updatedAt:now};content.seo.description={value:result.description,provenance:'collected',updatedAt:now};
  content.detailDescriptionLinked = true;
  const keywords=collectionKeywords(job.context.keywords);
  if (keywords.length) {
    content.seo.keywords={value:keywords,provenance:'manual',updatedAt:now};
    content.intakeKeywordSeed={value:[...keywords],updatedAt:now,sourceReference:collectionSourceReference(job.id,result.sourceUrl)};
  }
  for (const [field, value] of Object.entries(collectionLabelAttributes(result.attributes))) {
    if (native && field === 'countryOfOrigin') continue;
    content.label[field as LabelField] = { value, provenance: 'collected', updatedAt: now };
  }
  const origin = native && confirmedCollectionOrigin(result.attributes);
  if (origin) content.label.countryOfOrigin = { ...origin, updatedAt: now };
  // Native drafts use the captured brand for missing company label defaults.
  // Captured text and future explicit product edits keep their own provenance.
  const brand = native ? registrationBrandChoices(settings.brand)[0] : undefined;
  for (const [field, setting] of [['manufacturer','manufacturer'],['importer','importer'],['contact','serviceContact']] as const) {
    if (brand && field !== 'contact' && !settings[setting].trim()) {
      content.label[field] = { value: field === 'manufacturer' ? `${brand} 협력사` : brand, provenance: 'generated', updatedAt: now };
    } else if (Object.hasOwn(job.context.settings, setting)) {
      content.label[field] = { value: settings[setting], provenance: 'manual', updatedAt: now };
    }
  }
  // Prepare a reviewable stage-six label without replacing the independent
  // initial legal-notice values in the selected quotation form.
  const labelDraft = Object.fromEntries(Object.entries(content.label).map(([key,field]) => [key,field.value])) as Record<LabelField,string>;
  const dateNotice = labelDateNotice(category.categoryId, category.categoryPath, category.hubSchema);
  const autofill = fillLabelDraft(labelDraft, content, result.title, job.context.settings, category.categoryId, [], job.context.capturedAt ?? now, dateNotice);
  for (const key of autofill.filled) content.label[key] = { value: autofill.label[key], provenance: 'generated', updatedAt: now };
  content.labelProductNameLinked = autofill.filled.includes('productName');
  const initialNotices = createInitialLegalNotices(getQuotationSchema(category.categoryId, category.categoryPath, category.hubSchema, category.template),
    job.context.settings, now);
  if (initialNotices) content.initialLegalNotices = initialNotices;
  const product:ProductRecord={id,owner_id:owner,source_url:result.sourceUrl,title:result.title,source_price_cny:cost,exchange_rate:policy.exchangeRate,supply_margin:policy.supplyMargin,coupang_margin:policy.coupangMargin,supply_price:price.supplyPrice,sale_price:price.salePrice,msrp:price.msrp,options_count:rows.length,...initialStatuses,registration_status:'수집 원문 반영',image_keys:'[]',goal_stage:job.goal,created_at:now,updated_at:now};
  const banners=workspaceBannerAssignments(settings,owner);
  for(const [role,key] of banners)content.assets[role]={value:[key],provenance:'manual',updatedAt:now};
  product.image_keys=JSON.stringify(banners.map(([,key])=>key));
  return {product,policy,options,content};
}
