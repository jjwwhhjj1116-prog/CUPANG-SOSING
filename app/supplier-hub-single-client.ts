import type { QuotationFieldsView } from '@/app/quotation-schema';
import type { SupplierHubCompany } from '@/app/supplier-hub-company';

export type SinglePackageView = {
  format: 'yoofam-supplier-hub-single-package-v1'; prepared: boolean; registered: false; remoteWrites: false; submissionReady: false;
  productId: string; fingerprint: string; company: SupplierHubCompany; schemaSha256: string;
  source: { productVersion: string; contentRevision: number; optionRevision: number; quotationRevision: number; profileId: string | null; profileRevision: number | null };
  options: { optionId: string | null; optionLabel: string }[];
  payload: { docId: null; productName: string; categoryPath: string; categoryId: number | string; displayCategoryCode: string;
    jsonDocument: Record<string, unknown>[]; scope: string; productNoticeNumber: number | string; version: number | string; remark?: string };
  review: { canPrepare: boolean; issues: { code: string; level: string; message: string }[]; fields: { optionId: string | null; fieldId: string; savedValue: string }[] };
  manifest: { optionId: string | null; role: string; files: { key: string; url: string; sha256: string; byteLength: number; published: boolean }[] }[];
};
export function singlePackageCurrent(value: SinglePackageView, view: QuotationFieldsView, productId: string) {
  return value.format === 'yoofam-supplier-hub-single-package-v1' && value.productId === productId && value.registered === false
    && value.remoteWrites === false && value.submissionReady === false && /^[a-f0-9]{64}$/.test(value.fingerprint)
    && value.source.productVersion === view.productVersion && value.source.contentRevision === view.contentRevision
    && value.source.optionRevision === view.optionRevision && value.source.quotationRevision === view.revision
    && value.source.profileId === view.categoryContext.profileId && value.payload.displayCategoryCode === view.categoryContext.categoryId
    && Array.isArray(value.options) && value.options.length === value.payload.jsonDocument.length
    && JSON.stringify(value.options.map(row=>row.optionId)) === JSON.stringify(view.resolved.rows.filter(row=>row.included).map(row=>row.optionId));
}
/** One exact included option per Single document; preparation is not a receipt. */
export async function singlePackagePacket(value: SinglePackageView, ownerId: string, optionId: string) {
  if(!value.prepared||!value.review.canPrepare||value.review.issues.some(issue=>issue.level==='error')||!value.source.profileId
    ||value.payload.docId!==null||value.payload.scope!=='Retail_Categorized_Single'||!/^[a-f0-9]{64}$/.test(value.schemaSha256)
    ||value.options.filter(row=>row.optionId===optionId).length!==1||!/^[\w-]{1,100}$/.test(ownerId)||!/^[\w-]{1,100}$/.test(optionId))
    throw Error('저장한 옵션 1개와 준비된 개별 견적 자료를 확인해주세요.');
  const index=value.options.findIndex(row=>row.optionId===optionId), document=structuredClone(value.payload.jsonDocument[index]);
  const start=document.startPage as {productName?:unknown;categoryPath?:unknown}|undefined;
  if(typeof start?.productName!=='string'||!start.productName.trim()||start.categoryPath!==value.payload.categoryPath)throw Error('선택 옵션의 상품명·카테고리 연결을 확인해주세요.');
  const context=new TextEncoder().encode(JSON.stringify(['sourceflow-managed-product-account-v1',ownerId,value.company.code,value.company.name]));
  const accountContext=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',context)),byte=>byte.toString(16).padStart(2,'0')).join('');
  return {type:'YOOFAM_SINGLE_DOCUMENT_TRANSPORT',format:'yoofam-supplier-hub-single-document-v1',requestId:crypto.randomUUID(),ownerId,accountContext,
    company:value.company,productId:value.productId,profileId:value.source.profileId,optionId,categoryId:value.payload.displayCategoryCode,
    fingerprint:value.fingerprint,schemaSha256:value.schemaSha256,
    source:{productVersion:value.source.productVersion,contentRevision:value.source.contentRevision,optionRevision:value.source.optionRevision,
      quotationRevision:value.source.quotationRevision,profileRevision:value.source.profileRevision},
    body:{...value.payload,productName:start.productName,jsonDocument:[document]}};
}
