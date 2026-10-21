import type { SeoWorkspaceView } from '@/app/seo-workspace';

/** Navigation evidence emitted only after the integrated save ACK is checked. */
export type SeoAppliedReceipt = {
  scope: 'all' | 'options'; productId: string; jobId: string; previousVersion: string;
  productVersion: string; contentRevision: number; optionRevision: number;
};

export function sameSeoAppliedSource(value: unknown, productId: string, version: string): value is SeoAppliedReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Partial<SeoAppliedReceipt>;
  return receipt.scope === 'all' && receipt.productId === productId && receipt.previousVersion === version
    && typeof receipt.jobId === 'string' && receipt.jobId.length > 0
    && typeof receipt.productVersion === 'string' && Number.isFinite(Date.parse(version))
    && Number.isFinite(Date.parse(receipt.productVersion)) && Date.parse(receipt.productVersion) > Date.parse(version)
    && [receipt.contentRevision, receipt.optionRevision].every(revision => typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0);
}

export function seoAppliedViewReady(receipt: SeoAppliedReceipt, view: SeoWorkspaceView): boolean {
  return view.productId === receipt.productId && view.productVersion === receipt.productVersion
    && view.content.productId === receipt.productId && view.options.productId === receipt.productId
    && view.content.revision === receipt.contentRevision && view.options.revision === receipt.optionRevision;
}

export const seoAppliedReceiptKey = (receipt: SeoAppliedReceipt) => JSON.stringify([
  receipt.productId, receipt.jobId, receipt.previousVersion, receipt.productVersion, receipt.contentRevision, receipt.optionRevision,
]);
