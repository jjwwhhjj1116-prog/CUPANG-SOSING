import { validateCollectionResult, type CollectionResult } from '@/app/collection-result';

/** Bind a persisted receipt to the job being displayed before exposing import actions. */
export function validateCollectionReceiptResponse(input: unknown, jobId: string, offerId: string): CollectionResult | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('수집 응답 형식을 확인할 수 없습니다.');
  const body = input as Record<string, unknown>;
  if (body.jobId !== jobId || body.offerId !== offerId) throw new Error('수집 응답이 요청한 상품과 다릅니다. 다시 조회해주세요.');
  if (body.receipt === null) return null;
  if (!body.receipt || typeof body.receipt !== 'object' || Array.isArray(body.receipt)) throw new Error('수집 원문 수신 확인이 없습니다.');
  const raw = (body.receipt as Record<string, unknown>).result;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('수집 원문 내용이 없습니다.');
  const { offerId: receivedOfferId, ...payload } = raw as Record<string, unknown>;
  if (receivedOfferId !== offerId) throw new Error('수집 원문의 상품번호가 다릅니다.');
  return validateCollectionResult(payload, offerId);
}
