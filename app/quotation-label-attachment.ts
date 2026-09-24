import type { QuotationFieldsView } from '@/app/quotation-schema';
import { quotationLabelPlan } from '@/app/quotation-label-plan';

type Input = {
  productId: string; endpoint: string; renderedView: QuotationFieldsView; optionId: string | null;
  blob: Blob; uploadedKey: string | null; onUploaded: (key: string) => void;
};
/** Resumable steps: uploaded files may survive a conflict; existing attachments are never removed. */
export async function attachQuotationLabel(input: Input, request: typeof fetch = fetch): Promise<QuotationFieldsView> {
  const expectedPlan = JSON.stringify(quotationLabelPlan(input.renderedView.resolved, input.optionId));
  async function read<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await request(url, { cache: 'no-store', ...init });
    const body = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(body.error || '표시사항 이미지 연결을 저장하지 못했습니다.');
    return body;
  }
  function validate(view: QuotationFieldsView) {
    if (!view?.resolved || !Array.isArray(view.imageKeys) || !Number.isSafeInteger(view.revision) || !view.inputFingerprint) throw new Error('최신 견적을 읽지 못했습니다.');
    if (view.resolved.schema.categoryId !== input.renderedView.resolved.schema.categoryId
      || JSON.stringify(view.categoryContext) !== JSON.stringify(input.renderedView.categoryContext)
      || JSON.stringify(quotationLabelPlan(view.resolved, input.optionId)) !== expectedPlan) {
      throw new Error('PNG 생성 후 카테고리 또는 표시사항 값이 변경되었습니다. 최신 견적으로 PNG를 다시 만들어주세요.');
    }
    return view.resolved.rows.find(row => row.optionId === input.optionId)!;
  }
  const labels = (view: QuotationFieldsView) => (validate(view).fields.labelImages?.value ?? '').split('\n').map(key => key.trim()).filter(Boolean);
  let view = await read<QuotationFieldsView>(input.endpoint);
  let key = input.uploadedKey;
  const current = labels(view);
  if (key && view.imageKeys.includes(key) && current.includes(key)) return view;
  if (current.length >= 30 || (view.imageKeys.length >= 50 && (!key || !view.imageKeys.includes(key)))) throw new Error('라벨 최대 30개 또는 상품 이미지 최대 50개 한도입니다. 기존 첨부를 확인해주세요.');
  if (!key) {
    const form = new FormData(); form.set('file', new File([input.blob], 'sourceflow-quotation-label.png', { type: 'image/png' }));
    const uploaded = await read<{ key?: string }>('/api/files', { method: 'POST', body: form });
    if (!uploaded.key) throw new Error('PNG 업로드 결과를 확인하지 못했습니다.');
    key = uploaded.key; input.onUploaded(key);
  }
  if (!view.imageKeys.includes(key)) {
    await read(`/api/products/${encodeURIComponent(input.productId)}/attachments`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, role: null, expectedVersion: view.productVersion, expectedContentRevision: view.contentRevision }),
    });
  }
  // The product attachment changes the input fingerprint. Re-read and recheck
  // the rendered values before writing the option-specific label reference.
  view = await read<QuotationFieldsView>(input.endpoint);
  const previous = labels(view);
  if (!view.imageKeys.includes(key)) throw new Error('상품 이미지 연결을 확인하지 못했습니다. 다시 시도해주세요.');
  if (previous.includes(key)) return view;
  if (previous.length >= 30) throw new Error('라벨 첨부가 30개입니다. 업로드한 파일은 보존했으며 견적 연결은 추가하지 않았습니다.');
  const saved = await read<QuotationFieldsView>(input.endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
      changes: [{ fieldKey: 'labelImages', optionId: input.optionId, value: [...previous, key].join('\n') }] }),
  });
  if (!labels(saved).includes(key) || !saved.imageKeys.includes(key)) throw new Error('최종 라벨 연결을 확인하지 못했습니다. 다시 검사해주세요.');
  return saved;
}
