export class QuotationResultSourceChanged extends Error {}

/** Recheck the current saved source before showing an extension's older observation. */
export async function verifyQuotationResultSource(
  prepared: { productId: string; profileId: string; categoryId: string; fingerprint: string; filename: string },
  signal: AbortSignal,
) {
  const response = await fetch(`/api/products/${encodeURIComponent(prepared.productId)}/quotation`, {
    method: 'POST', signal, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'source', ...(prepared.profileId ? { profileId: prepared.profileId } : {}) }),
  });
  const body = await response.json() as { error?: unknown; fingerprint?: unknown; filename?: unknown; report?: { productId?: unknown; categoryId?: unknown; profileId?: unknown; submissionReady?: unknown } } | null;
  if (signal.aborted) throw new Error('작업을 취소했습니다.');
  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error : '현재 견적서 저장본을 확인하지 못했습니다.';
    if (response.status === 409) throw new QuotationResultSourceChanged(message);
    throw new Error(message);
  }
  if (body?.fingerprint !== prepared.fingerprint || body?.filename !== prepared.filename
    || body?.report?.productId !== prepared.productId || body?.report?.categoryId !== prepared.categoryId
    || body?.report?.profileId !== prepared.profileId || body?.report?.submissionReady !== false) {
    throw new QuotationResultSourceChanged('견적서 준비 이후 저장된 상품 또는 양식이 변경되었습니다. 견적서와 첨부 파일을 다시 준비해주세요.');
  }
}
