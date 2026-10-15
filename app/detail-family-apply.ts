import type { SupplierHubCompany } from '@/app/supplier-hub-company';
export type DetailFamilyImage = { key: string; sha256: string; bytes: number; width: 800; height: number };
export type DetailFamilyTarget = { productId: string; title: string; registrationNumber: string | null; optionCount: number; eligible: boolean; reason: string | null };
export type DetailFamilyCatalog = { format: 'detail-family-catalog-v1'; sourceProductId: string; sourceVersion: string;
  inputFingerprint: string; company: SupplierHubCompany; familyId: string | null; sourceReady: boolean; reason: string | null;
  image: DetailFamilyImage | null; targets: DetailFamilyTarget[] };
export type DetailFamilyPreviewTarget = { productId: string; title: string; registrationNumber: string | null;
  beforeVersion: string; revision: number; optionIds: string[] };
export type DetailFamilyPreview = { format: 'detail-family-preview-v1'; requestId: string; fingerprint: string;
  sourceProductId: string; sourceVersion: string; company: SupplierHubCompany; familyId: string; key: string; sha256: string; bytes: number;
  targets: DetailFamilyPreviewTarget[] };
export type DetailFamilyReceipt = Omit<DetailFamilyPreview, 'format' | 'targets'> & { format: 'detail-family-receipt-v1'; committedAt: string;
  targets: (DetailFamilyPreviewTarget & { savedVersion: string; savedRevision: number })[] };
export class DetailFamilyError extends Error {
  constructor(message: string, public readonly status = 409, public readonly code = 'DETAIL_FAMILY_CONFLICT') { super(message); }
}
