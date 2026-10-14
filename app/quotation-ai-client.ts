import { quotationValueIssues, type QuotationFieldsView } from '@/app/quotation-schema';

export type QuotationAiProposal = { optionId: string | null; fieldKey: string; value: string };
export type QuotationAiJobView = { id: string; status: 'prepared' | 'running' | 'completed' | 'failed' | 'uncertain'; startedAt?: string | null; canClose?: boolean;
  fingerprint: string; quotationRevision: number; profileId: string | null;
  scope: { optionId: string | null; applyToAllOptions: boolean };
  result: { changes: QuotationAiProposal[]; warnings: string[]; model: string; generatedAt: string } | null;
  error: { code: string; message: string; uncertain: boolean } | null };
export type QuotationAiView = { configuration: { configured: boolean; provider: string; model: string; freeOnly: boolean; notice: string };
  fingerprint: string; productId: string; productVersion: string; contentRevision: number; optionRevision: number;
  quotationRevision: number; profileId: string | null; jobs: QuotationAiJobView[] };
export function quotationAiViewCurrent(value: QuotationAiView, view: QuotationFieldsView, productId: string) {
  return value.productId === productId && /^[a-f0-9]{64}$/.test(value.fingerprint)
    && value.productVersion === view.productVersion && value.contentRevision === view.contentRevision
    && value.optionRevision === view.optionRevision && value.quotationRevision === view.revision
    && value.profileId === view.categoryContext.profileId;
}
/** Reuse one completed whole-product draft across option editors. An unresolved
 * execution remains visible for recovery even after its source was edited. */
export function quotationAiJobForScope(value: QuotationAiView, view: QuotationFieldsView, productId: string, optionId: string | null, all: boolean) {
  if (!quotationAiViewCurrent(value, view, productId)) return null;
  const jobs = value.jobs.filter(job => job.profileId === value.profileId);
  const unsettled = jobs.find(job => job.status === 'running' || job.status === 'uncertain');
  if (unsettled) return unsettled;
  const current = jobs.filter(job => job.fingerprint === value.fingerprint && job.quotationRevision === view.revision);
  if (all) return current.find(job => job.scope.applyToAllOptions) ?? null;
  if (optionId === null) return null;
  return current.find(job => !job.scope.applyToAllOptions && job.scope.optionId === optionId)
    ?? current.find(job => job.scope.applyToAllOptions) ?? null;
}
export function quotationAiScopedProposalChanges(view: QuotationFieldsView, job: QuotationAiJobView, fingerprint: string, optionId: string | null, all: boolean) {
  if (all && !job.scope.applyToAllOptions || !all && optionId === null) throw Error('AI 초안을 적용할 옵션 범위를 확인해주세요.');
  const changes = quotationAiProposalChanges(view, job, fingerprint);
  return all ? changes : changes.filter(change => change.optionId === optionId);
}
/** Recheck every proposed target before placing anything in an unsaved editor. */
export function quotationAiProposalChanges(view: QuotationFieldsView, job: QuotationAiJobView, fingerprint: string) {
  if (job.status !== 'completed' || job.fingerprint !== fingerprint || job.quotationRevision !== view.revision
    || job.profileId !== view.categoryContext.profileId || !job.result || !Array.isArray(job.result.changes) || job.result.changes.length > 1000)
    throw Error('현재 견적서에 연결된 완료 초안을 확인해주세요.');
  const seen = new Set<string>();
  return job.result.changes.map(change => {
    if (!change || typeof change.fieldKey !== 'string' || typeof change.value !== 'string') throw Error('AI 초안의 입력 자료형을 확인해주세요.');
    const field = view.resolved.schema.fields.find(item => item.id === change.fieldKey), row = view.resolved.rows.find(item => item.optionId === change.optionId);
    const wire = field?.hubWire;
    const writable = wire?.name && wire.nameKey && wire.valueKey && !field?.hubInput
      && !/인증|허가|신고|제조국|원산지|제조자|제조사|수입자|수입신고|책임자|전화번호|품질보증|출시|제조년|유통|소비기한|바코드|GTIN|Global Trade|Manufacturer Part Number|모델명|품번|포장|가격|원가|단가|판매가|공급가|MSRP|OSRP|Price|동의|약관/iu.test(wire.name)
      && (['productPage.commonAttributes.exposedAttributes', 'productPage.unexposedAttributes'].includes(wire.path.join('.'))
        && wire.nameKey === 'attributeName' && wire.valueKey === 'attributeValue'
        || wire.path.join('.') === 'legalPage.notices' && wire.nameKey === 'noticeItemName' && ['noticeItemValue', 'noticeContent'].includes(wire.valueKey));
    const key = JSON.stringify([change.optionId, change.fieldKey]);
    if (seen.has(key) || !field || !writable || field.readOnly || !row || !row.included || row.fields[field.id]?.source.startsWith('manual-')
      || !job.scope.applyToAllOptions && change.optionId !== job.scope.optionId
      || field.type === 'images' || ['image', 'logistics'].includes(field.section)
      || /cert|agree|barcode/i.test(field.id) || /cert|agree|barcode/i.test(JSON.stringify(field.hubWire?.path ?? []))
      || ['supplyPrice', 'salePrice', 'msrp', 'osrp'].includes(field.hubInput ?? '')
      || quotationValueIssues(field, change.value).length)
      throw Error('AI 초안의 카테고리·옵션·수동 입력 또는 허용값을 다시 확인해주세요.');
    seen.add(key); return { optionId: change.optionId, fieldKey: change.fieldKey, value: change.value };
  });
}
