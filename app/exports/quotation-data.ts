import type { CategoryField } from '@/app/category-profiles';
import { contentDetailImageKeys, savedTextOrFallback, type ProductContent } from '@/app/product-content';
import type { WorkspaceSettings } from '@/app/workspace-settings';
import type { ProductRecord } from '@/db/queries';
import { calculatePrice } from '@/app/pricing';
import { optionSourceCostCny, resolveOptionPricePolicy } from '@/app/product-options';
import type { BundleAsset } from '@/app/exports/review-bundle';

export type QuotationOption = {
  id: string; originalName: string; translatedName: string; supplierSku: string;
  unitCostCny: number | null; unitsPerPack: number; included: boolean; imageKey: string | null;
};
export type QuotationRowData = Partial<Record<Exclude<CategoryField, 'constant'>, string | number | null>>;

/** Values are read from saved records; absent legal/product facts remain blank. */
export function quotationData(product: ProductRecord, content: ProductContent, settings: WorkspaceSettings, options: QuotationOption[], assets: BundleAsset[]) {
  const filename = (key: string | null | undefined) => {
    if (!key) return '';
    const asset = assets.find(asset => asset.key === key);
    if (!asset) throw new Error('견적서에 연결한 이미지 파일이 누락되었습니다.');
    return asset.name;
  };
  const base: QuotationRowData = {
    title: savedTextOrFallback(content.seo.title, product.title), sourceUrl: product.source_url,
    brand: settings.brand, manufacturer: savedTextOrFallback(content.label.manufacturer, settings.manufacturer),
    importer: savedTextOrFallback(content.label.importer, settings.importer), serviceContact: savedTextOrFallback(content.label.contact, settings.serviceContact),
    boxQuantity: settings.boxSkuQuantity, material: content.label.material.value,
    countryOfOrigin: content.label.countryOfOrigin.value, barcode: '',
    mainImage: filename(content.assets.main.value[0]),
    detailImage: contentDetailImageKeys(content).map(filename).join('\n'),
    label: content.assets.label.value.map(filename).join('\n'),
  };
  if (!options.length) return [{ ...base, sourcePriceCny: product.source_price_cny, supplyPrice: product.supply_price, salePrice: product.sale_price, msrp: product.msrp }];
  const included = options.filter(option => option.included);
  if (!included.length) throw new Error('견적서에 포함할 옵션을 한 개 이상 선택해주세요.');
  const { policy } = resolveOptionPricePolicy(product, settings);
  return included.map(option => {
    if (option.unitCostCny === null) throw new Error('포함 옵션의 원가와 구성 수량을 확인해주세요.');
    const sourcePriceCny = optionSourceCostCny(option.unitCostCny, option.unitsPerPack);
    const price = calculatePrice(sourcePriceCny, policy);
    return { ...base, skuName: option.translatedName || option.originalName, skuId: option.supplierSku,
      sourcePriceCny, supplyPrice: price.supplyPrice, salePrice: price.salePrice, msrp: price.msrp,
      mainImage: filename(option.imageKey) || base.mainImage,
    };
  });
}
