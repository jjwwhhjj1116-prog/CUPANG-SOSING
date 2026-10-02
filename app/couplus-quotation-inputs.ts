// Exact paths observed in Couplus getDefaultTitle, convertDocToQuotationData,
// applyDefaultSettings and cliPageSyncPricesToDoc. Labels are presentation only.
const inputs={
  'startPage.productName':'title', 'startPage.categoryPath':'category',
  'productPage.modelNumber':'model', 'productPage.brand':'brand',
  'productPage.manufacturer':'manufacturer', 'productPage.businessType':'tradeType',
  'productPage.taxationSchema':'taxType', 'productPage.importType':'importType',
  'productPage.searchTags':'searchTags',
  'productPage.commonAttributes.purchasePrice':'supplyPrice',
  'productPage.commonAttributes.coupangSalePrice':'salePrice',
  'productPage.commonAttributes.msrp':'msrp', 'productPage.commonAttributes.osrp':'msrp',
  'productPage.commonAttributes.productBarcode':'barcode',
  'imagePage.images.mainImage':'mainImage', 'imagePage.images.additionalImage':'additionalImages',
  'imagePage.details.detailedImage':'detailImages',
  'imagePage.details.htmlProductDetailContent':'detailHtml', 'imagePage.details.altText':'altText',
  'legalPage.kcMarkType':'kcMarkType',
  'logisticsPage.totalSKUsInBox':'boxSkuQuantity', 'logisticsPage.daysToExpiration':'shelfLifeDays',
  'logisticsPage.specialHandlingReason':'handlingReason', 'logisticsPage.skuUnitBoxWeight':'packagedWeightG',
  'logisticsPage.skuUnitBoxDimension':'packagedDimensionsMm',
} as const;
export type CouplusQuotationInput=typeof inputs[keyof typeof inputs];
const byPath=new Map(Object.entries(inputs).map(([path,input])=>[JSON.stringify(path.split('.')),input]));
export function couplusQuotationInput(path:readonly string[]):CouplusQuotationInput|undefined{
  return byPath.get(JSON.stringify(path));
}
