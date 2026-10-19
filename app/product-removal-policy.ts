import { parseStoredSupplierHubReceipt, supplierHubReceiptObservationTime, supplierHubReceiptOrder, supplierHubReceiptSummary, type SupplierHubReceiptSummary } from '@/app/supplier-hub-receipt';
import { supplierHubCompany } from '@/app/supplier-hub-company';
import {parseStoredNativeReceipt,nativeReceiptSummary,isNativeReceiptSummary,type NativeReceiptSummary} from '@/app/supplier-hub-product-receipt';

export type ProductRemovalDecision = {
  blocked: boolean;
  code: 'PRODUCT_HUB_TRANSMITTED' | 'PRODUCT_HUB_EVIDENCE_UNCONFIRMED' | null;
  reason: string;
  receipt: SupplierHubReceiptSummary | null;
  singleReceipt?: NativeReceiptSummary | null;
};
export type ProductRemovalReceiptRow = { fingerprint: string; payload: string; observed_at: number; evidence_order: number };
export type ProductRemovalSingleReceiptRow={owner_id:string;product_id:string;request_id:string;observed_at:number;payload:string;created_at:string};
export const PRODUCT_HUB_REMOVAL_REASON = '쿠팡에 이미 전송된 상품이라 삭제할 수 없습니다';
// The exact reviewed receipt snapshot is a single bounded SQL parameter. Large
// histories remain preserved and require a verified read before removal.
export const PRODUCT_REMOVAL_RECEIPT_SNAPSHOT_LIMIT = 512 * 1024;
export function unconfirmedProductRemovalDecision(): ProductRemovalDecision {
  return { blocked: true, code: 'PRODUCT_HUB_EVIDENCE_UNCONFIRMED', reason: '전송 기록을 확인하지 못해 삭제할 수 없습니다. 등록 상태를 다시 확인해주세요.', receipt: null };
}
function validSummary(value: unknown): value is SupplierHubReceiptSummary {
  const summary = value as SupplierHubReceiptSummary;
  return Boolean(summary && typeof summary.label === 'string' && ['파일 반려', '상품 반려', 'SKU ID 확인', '견적서 접수', '파일 검증 중'].includes(summary.label)
    && supplierHubCompany(summary.company?.code, summary.company?.name)
    && (summary.quotationId === null || typeof summary.quotationId === 'string' && summary.quotationId.length <= 200)
    && typeof summary.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(summary.fingerprint)
    && typeof summary.categoryId === 'string' && summary.categoryId.length > 0 && summary.categoryId.length <= 100
    && Number.isSafeInteger(summary.observedAt) && summary.observedAt > 0
    && Number.isSafeInteger(summary.includedOptions) && summary.includedOptions >= 1 && summary.includedOptions <= 200
    && Number.isSafeInteger(summary.issuedSkus) && summary.issuedSkus >= 0 && summary.issuedSkus <= summary.includedOptions);
}
function transmitted(receipt: SupplierHubReceiptSummary): ProductRemovalDecision {
  return { blocked: true, code: 'PRODUCT_HUB_TRANSMITTED', reason: PRODUCT_HUB_REMOVAL_REASON, receipt };
}
/** All-history server evidence, independent of the current draft/category/company.
 * registered=false is part of the observation contract, even for accepted SKUs.
 */
export function productRemovalDecisionFromReceipts(rows: readonly ProductRemovalReceiptRow[],singleRows:readonly ProductRemovalSingleReceiptRow[]=[]): ProductRemovalDecision {
  let unknown = false, latestRejected: SupplierHubReceiptSummary | null = null, latestBlocking: SupplierHubReceiptSummary | null = null;
  for (const row of rows) {
    try {
      const receipt = parseStoredSupplierHubReceipt(row.payload);
      if (receipt.fingerprint !== row.fingerprint || row.observed_at !== supplierHubReceiptObservationTime(receipt.result)
        || row.evidence_order !== supplierHubReceiptOrder(receipt.result)) throw Error('전송 기록과 저장 키가 다릅니다.');
      const summary = supplierHubReceiptSummary(receipt), result = receipt.result;
      const rejectedOnly = result.state === 'validation-rejected' && (result.quotationId === undefined || result.quotationId === '') && result.registration === undefined;
      if (rejectedOnly) {
        if (!latestRejected || summary.observedAt >= latestRejected.observedAt) latestRejected = summary;
      } else if (!latestBlocking || summary.observedAt >= latestBlocking.observedAt) latestBlocking = summary;
    } catch { unknown = true; }
  }
  let latestSingleRejected:NativeReceiptSummary|null=null,latestSingleBlocking:NativeReceiptSummary|null=null;
  for(const row of singleRows){
    try{const receipt=parseStoredNativeReceipt(row.payload);
      if(receipt.requestId!==row.request_id||receipt.productId!==row.product_id||receipt.identity.ownerId!==row.owner_id||receipt.receipt.observedAt!==row.observed_at
        ||typeof row.created_at!=='string'||!Number.isFinite(Date.parse(row.created_at)))throw Error('개별 전송 기록과 저장 키가 다릅니다.');
      const summary=nativeReceiptSummary(receipt,row.created_at);if(!isNativeReceiptSummary(summary))throw Error('문서 전송 요약을 확인하지 못했습니다.');
      if(summary.state==='rejected'){if(!latestSingleRejected||summary.observedAt>=latestSingleRejected.observedAt)latestSingleRejected=summary;}
      else if(!latestSingleBlocking||summary.observedAt>=latestSingleBlocking.observedAt)latestSingleBlocking=summary;
    }catch{unknown=true;}
  }
  if (latestBlocking) return {...transmitted(latestBlocking),...(latestSingleBlocking||latestSingleRejected?{singleReceipt:latestSingleBlocking??latestSingleRejected}:{})};
  if(latestSingleBlocking)return {blocked:true,code:'PRODUCT_HUB_TRANSMITTED',reason:PRODUCT_HUB_REMOVAL_REASON,receipt:latestRejected,singleReceipt:latestSingleBlocking};
  if (unknown || singleRows.length>200 || new TextEncoder().encode(JSON.stringify(rows)).length+(singleRows.length?new TextEncoder().encode(JSON.stringify(singleRows)).length:0) > PRODUCT_REMOVAL_RECEIPT_SNAPSHOT_LIMIT) return unconfirmedProductRemovalDecision();
  return { blocked: false, code: null, reason: '', receipt: latestRejected,...(latestSingleRejected?{singleReceipt:latestSingleRejected}:{}) };
}

/** Consumers use the authoritative all-history decision; missing/failed policy
 * reads never become permission to delete. A legacy positive summary still
 * explains the known transmission, but a latest failure cannot clear history.
 */
export function productRemovalDecision(product: { removal_policy?: ProductRemovalDecision | null; hub_receipt?: SupplierHubReceiptSummary | null;hub_single_receipt?:NativeReceiptSummary|null }): ProductRemovalDecision {
  const decision = product.removal_policy;
  const summary = product.hub_receipt;
  const positiveSummary = validSummary(summary) && (summary.label !== '파일 반려' || Boolean(summary.quotationId) || summary.issuedSkus > 0);
  const single=product.hub_single_receipt,positiveSingle=isNativeReceiptSummary(single)&&single.state!=='rejected';
  const fallback=()=>positiveSummary?transmitted(summary!):positiveSingle?{blocked:true as const,code:'PRODUCT_HUB_TRANSMITTED' as const,reason:PRODUCT_HUB_REMOVAL_REASON,receipt:null,singleReceipt:single}:unconfirmedProductRemovalDecision();
  if (decision && typeof decision.blocked === 'boolean' && typeof decision.reason === 'string'
    && (decision.receipt === null || validSummary(decision.receipt))&&(decision.singleReceipt===undefined||decision.singleReceipt===null||isNativeReceiptSummary(decision.singleReceipt))) {
    const positiveDecisionSingle=isNativeReceiptSummary(decision.singleReceipt)&&decision.singleReceipt.state!=='rejected';
    if (!decision.blocked && decision.code === null && decision.reason === ''
      && !positiveDecisionSingle&&(decision.receipt === null || decision.receipt.label === '파일 반려' && !decision.receipt.quotationId && decision.receipt.issuedSkus === 0)) return positiveSummary||positiveSingle ? fallback() : decision;
    if (decision.blocked && decision.code === 'PRODUCT_HUB_TRANSMITTED' && decision.reason === PRODUCT_HUB_REMOVAL_REASON
      && (positiveDecisionSingle||decision.receipt&&(decision.receipt.label !== '파일 반려' || Boolean(decision.receipt.quotationId) || decision.receipt.issuedSkus > 0))) return decision;
    if (decision.blocked && decision.code === 'PRODUCT_HUB_EVIDENCE_UNCONFIRMED' && decision.reason === unconfirmedProductRemovalDecision().reason && decision.receipt === null) return decision;
  }
  return fallback();
}
