// Exact supplier headings observed in collected source. These describe a
// component or a seller identifier, not a general product-label declaration.
// Never infer scope from an offer ID, attribute value or a word fragment.
const scopedHeadings: Readonly<Record<string, string>> = {
  '镜片材质': '렌즈 재질',
  '镜框材质': '테 재질',
  '镜架材质': '안경테 재질',
  '货号': '판매자 품번',
};

export function translationLabelSourceScope(name: string): string | undefined {
  const heading = name.trim();
  return Object.hasOwn(scopedHeadings, heading) ? scopedHeadings[heading] : undefined;
}
