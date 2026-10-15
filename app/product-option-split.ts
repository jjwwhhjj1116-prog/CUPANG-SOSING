import type { SupplierHubCompany } from '@/app/supplier-hub-company';
export type { ProductOptionSplitGroup } from '@/app/product-option-split-plan';
export type ProductOptionSplitPreviewGroup = {
  productId: string; label: string; title: string; seoTitle: string; optionIds: string[]; sourceOptionIds: string[]; retainsSource: boolean;
};
export type ProductOptionSplitPreview = {
  format: 'product-option-split-preview-v1'; requestId: string; fingerprint: string; sourceProductId: string;
  sourceVersion: string; company: SupplierHubCompany; groups: ProductOptionSplitPreviewGroup[]; warnings: string[];
};
export type ProductOptionSplitReceipt = Omit<ProductOptionSplitPreview, 'format' | 'groups'> & {
  format: 'product-option-split-receipt-v1'; familyId: string; committedAt: string;
  groups: (ProductOptionSplitPreviewGroup & { jobId: string; productVersion: string; contentRevision: number;
    optionsRevision: number; quotationRevision: number; labelsRevision: number; registrationNumber: string | null })[];
};
export class ProductOptionSplitError extends Error {
  constructor(message: string, public readonly status = 409, public readonly code = 'OPTION_SPLIT_CONFLICT') { super(message); }
}
