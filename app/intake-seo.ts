/** Preparing a review sends no source to an AI provider and changes no content. */
export async function prepareIntakeSeo(productId: string, fetcher: typeof fetch, signal: AbortSignal) {
  if (signal.aborted) return '';
  try {
    const response = await fetcher(`/api/products/${encodeURIComponent(productId)}/translation`, {
      method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'prepare-collected' }),
    });
    const body = await response.json() as { job?: { productId: string; status: string }; error?: string; remainingOptions?: number };
    if (signal.aborted) return '';
    if (!response.ok || body.job?.productId !== productId) return `상품은 저장됐지만 SEO 요청 준비는 완료되지 않았습니다. ${body.error ?? 'SEO 단계에서 다시 확인해주세요.'}`;
    return `수집 원문·카테고리·옵션으로 SEO 요청을 준비했습니다.${body.remainingOptions ? ` 남은 옵션 번역 항목 ${body.remainingOptions}개는 원문에 보존됩니다.` : ''}`;
  } catch {
    return signal.aborted ? '' : '상품은 저장됐지만 SEO 요청 준비 상태를 확인하지 못했습니다. SEO 단계에서 확인해주세요.';
  }
}
