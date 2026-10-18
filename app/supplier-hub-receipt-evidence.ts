import type { SupplierHubResult } from '@/app/supplier-hub-handoff';

const skuId = (value: unknown) => typeof value === 'string' && value.trim() && !/\.\.\.|…/.test(value)
 && !/^(?:-|—|n\/a|미표시|해당사항없음)$/i.test(value.trim()) ? value.trim() : null;

/** Call only for the same source receipt. An explicit rejection remains a new
 * observation; pending or partial reads cannot revoke already issued SKU IDs. */
export function supplierHubReceiptEvidenceRegression(previous: SupplierHubResult | null | undefined, next: SupplierHubResult | null | undefined): 'pending' | 'sku-missing' | null {
 if (!previous || !next || previous.state !== 'validation-complete' || previous.registered !== false || next.registered !== false
  || previous.filename !== next.filename || previous.company?.code !== next.company?.code || previous.company?.name !== next.company?.name
  || previous.includedOptions !== next.includedOptions || typeof previous.quotationId !== 'string' || !previous.quotationId
  || next.quotationId && next.quotationId !== previous.quotationId || previous.registration?.quotationId !== previous.quotationId
  || previous.registration.registered !== false || previous.registration.includedOptions !== previous.includedOptions) return null;
 const known = previous.registration.rows.map(row => skuId(row.skuId)).filter((id): id is string => id !== null);
 if (!known.length) return null;
 if (next.state === 'validation-pending') return 'pending';
 if (next.state !== 'validation-complete' || next.quotationId !== previous.quotationId || !next.registration) return null;
 const observed = new Set(next.registration.rows.map(row => skuId(row.skuId)).filter((id): id is string => id !== null));
 return known.some(id => !observed.has(id)) ? 'sku-missing' : null;
}
export class SupplierHubReceiptEvidenceRegression extends Error {
 constructor() { super('현재 조회에 이미 확인된 SKU 접수 근거가 빠졌습니다. 기존 결과를 유지했습니다. 다시 조회해주세요.'); }
}
export function assertSupplierHubReceiptEvidence(previous: SupplierHubResult | null | undefined, next: SupplierHubResult | null | undefined) {
 if (supplierHubReceiptEvidenceRegression(previous, next)) throw new SupplierHubReceiptEvidenceRegression();
}
