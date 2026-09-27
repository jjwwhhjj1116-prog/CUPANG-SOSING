import type { CollectionResult } from '@/app/collection-result';
import type { LabelField } from '@/app/product-content';

// Exact whole-attribute names only. SKU, packing dimensions, origin and legal
// declarations must not be inferred from similar words in supplier descriptions.
const names: Partial<Record<LabelField, readonly string[]>> = {
  material: ['재질', '材质', 'material'],
  model: ['모델명', '型号', 'model'],
  components: ['제품 구성품', '구성품', '包装清单', 'package contents'],
};

export function collectionLabelField(name: string): LabelField | undefined {
  return Object.entries(names).find(([, aliases]) => aliases.includes(name.trim().toLowerCase()))?.[0] as LabelField | undefined;
}

/** Original-language values for a new editable draft, never translated claims. */
export function collectionLabelAttributes(attributes: CollectionResult['attributes']) {
  const values: Partial<Record<LabelField, string>> = {};
  for (const [field, aliases] of Object.entries(names)) {
    const matches = (attributes ?? []).filter(attribute => aliases.includes(attribute.name.trim().toLowerCase()));
    const candidates = new Set(matches.map(attribute => attribute.value.trim()));
    if (candidates.size !== 1) continue;
    const value = [...candidates][0];
    if (value && value.length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) values[field as LabelField] = value;
  }
  return values;
}
