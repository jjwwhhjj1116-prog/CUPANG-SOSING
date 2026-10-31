import { productLabelChanges, productLabelDefinitions, verifyProductLabelsView, verifyProductLabelSave, type ProductLabelDraft, type ProductLabelsView } from '@/app/product-label';
import { verifyProductLabelDraftResult } from '@/app/product-label-draft';
import { completeProductLabelSave } from '@/app/product-label-save';
import { renderDocument } from '@/app/document-image-render';
import type { ProductLabelUploadCache } from '@/app/product-label-upload';

export type SelectedLabelWorkResult = { status: 'draft' | 'blocked' | 'failed' | 'complete'; message: string; completedOptions: number; totalOptions: number; uncertain: boolean };
type Controls = { fetcher?: typeof fetch; signal: AbortSignal; assertCurrent?: () => void | Promise<void>; render?: typeof renderDocument;trackMutationDispatch?:(onDispatch:()=>void)=>()=>void };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const draftKeys = new Set(['netContents', 'material', 'productType']);
class LabelWorkError extends Error { constructor(message: string, public status: 'blocked' | 'failed', public code?: string) { super(message); } }
const changed = () => new LabelWorkError('표시사항 작업 중 상품·옵션·카테고리 또는 저장값이 변경됐습니다. 확인된 저장본은 보존했습니다.', 'blocked');

/** The explicit selected-product run may save AI proposals and their PNGs.
 * It never edits manual values, blanks, excluded options, or common labels.
 * A saved PNG proves delivery, not a person's factual/legal review: the
 * existing label override schema has no durable review/AI distinction. */
export async function runSelectedLabelWork(productId: string, controls: Controls): Promise<SelectedLabelWorkResult> {
 let completedOptions = 0, totalOptions = 0, savedTexts = 0, pendingSave = false, pendingDraft = false;
 const result = (status: SelectedLabelWorkResult['status'], message: string): SelectedLabelWorkResult => ({ status, message, completedOptions, totalOptions, uncertain: pendingSave || pendingDraft });
 const checkSignal = () => {
  if (controls.signal.aborted) throw new LabelWorkError('표시사항 작업을 중지했습니다. 확인된 저장본은 보존했습니다.', 'blocked');
 };
 const current = async () => {
  checkSignal();
  try { await controls.assertCurrent?.(); } catch (cause) { throw new LabelWorkError(cause instanceof Error ? cause.message : '표시사항 작업의 로그인 계정과 회사를 확인하지 못했습니다.', 'blocked'); }
  checkSignal();
 };
 const request: typeof fetch = async (url, init) => {
  await current();
  // Local planning, reads and rendering cannot leave an unknown remote write.
  // The protected outer fetcher reports dispatch only after its account check.
  // Once any provider/text/upload/reference mutation is handed to transport,
  // a lost response must still fence retries until its exact save is proved.
  const mutation=!!init?.method&&!['GET','HEAD'].includes(init.method.toUpperCase());
  const mark=()=>{if(typeof url==='string'&&url.endsWith('/product-label-draft')&&init?.method==='POST')pendingDraft=true;else pendingSave=true;};
  const stopTracking=mutation?controls.trackMutationDispatch?.(mark):undefined;
  try{
   if(mutation&&!controls.trackMutationDispatch)mark();
   const response = await (controls.fetcher ?? fetch)(url, { ...init, signal: controls.signal, credentials: 'same-origin', redirect: 'error' });
   await current();
   if (response.redirected || response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400) throw new LabelWorkError('표시사항 응답이 다른 화면으로 이동했습니다. 로그인 상태를 확인해주세요.', 'blocked');
   return response;
  }finally{stopTracking?.();}
 };
 async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await request(url, { cache: 'no-store', ...init });
  if (response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw new LabelWorkError('표시사항 서버 응답을 확인하지 못했습니다. 저장 결과를 조회해주세요.', 'failed');
  const body = await response.json() as T & { error?: string; code?: string }; await current();
  if (!response.ok && url.endsWith('/product-label-draft') && ['PRODUCT_LABEL_DRAFT_REQUEST', 'PRODUCT_LABEL_DRAFT_SCOPE', 'PRODUCT_LABEL_DRAFT_SOURCE',
   'PRODUCT_LABEL_DRAFT_NO_FIELDS', 'PRODUCT_LABEL_DRAFT_LIMIT', 'PRODUCT_LABEL_DRAFT_PLAN', 'PRODUCT_LABEL_DRAFT_NOT_CONFIGURED', 'PRODUCT_LABEL_DRAFT_EVIDENCE',
   // The server received and rejected this provider result before saving any
   // proposal. Keep transport/provider/time-out failures fenced separately.
   'PRODUCT_LABEL_DRAFT_RESPONSE'].includes(body?.code ?? '')) pendingDraft = false;
  if (!response.ok) throw new LabelWorkError(typeof body?.error === 'string' ? body.error : '표시사항 작업 요청을 처리하지 못했습니다.', [400, 401, 403, 404, 409].includes(response.status) ? 'blocked' : 'failed', body?.code);
  return body;
 }
 try {
  await current();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(productId)) throw new LabelWorkError('표시사항 작업의 상품을 확인해주세요.', 'blocked');
  const base = `/api/products/${encodeURIComponent(productId)}`, endpoint = base + '/product-labels', quotationEndpoint = base + '/quotation-fields';
  async function read() {
   const view = await json<ProductLabelsView>(endpoint); verifyProductLabelsView(view, null);
   if (view.productId !== productId || !['collection', 'profile'].includes(view.categoryContext.source)) throw changed();
   return view;
  }
  let view = await read();
  const selected = view.rows.filter(row => row.optionId !== null && row.included).map(row => row.optionId!);
  totalOptions = selected.length;
  if (!totalOptions) return result('blocked', '표시사항을 작성할 포함 옵션이 없습니다.');
  if (selected.some(optionId => !view.rows.find(row => row.optionId === optionId)!.values.productName?.trim())) return result('blocked', '포함 옵션의 저장된 제품명이 비어 있습니다. 직접 비운 값은 유지했습니다.');
  const cache = new Map<string, ProductLabelUploadCache>();
  for (const optionId of selected) {
   const fresh = await read(); if (!same(fresh, view)) throw changed(); view = fresh;
   const row = view.rows.find(row => row.optionId === optionId)!;
   const eligible = productLabelDefinitions(view).some(field => draftKeys.has(field.key) && !['manual-common', 'manual-option'].includes(row.sources[field.key]));
   let draft: ProductLabelDraft = {};
   if (eligible) {
    try {
     const value = await json<unknown>(base + '/product-label-draft', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ optionId, expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint }) });
     draft = { ...verifyProductLabelDraftResult(view, optionId, value).values };
     pendingDraft = false;
    } catch (cause) {
     // Content-level manual provenance is known only to the server. Its exact
     // no-fields result is a protected manual row, not a reason to overwrite it.
     if (!(cause instanceof LabelWorkError) || cause.code !== 'PRODUCT_LABEL_DRAFT_NO_FIELDS') throw cause;
    }
    const after = await read(); if (!same(after, view)) throw changed();
   }
   if (Object.keys(draft).length) {
    const before = view, changes = productLabelChanges(before, optionId, draft);
    try {
     const saved = await json<ProductLabelsView>(endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: before.revision, expectedInputFingerprint: before.inputFingerprint, changes }) });
     verifyProductLabelSave(before, saved, optionId, draft); view = saved;
    } catch (cause) {
     await current();
     // A lost ACK may follow a committed text save. One exact read can prove
     // it; never resend the PUT or request another AI proposal automatically.
     const recovered = await read();
     try { verifyProductLabelSave(before, recovered, optionId, draft); } catch { throw cause; }
     view = recovered;
    }
    savedTexts++; pendingSave = false;
   }
   const saved = await completeProductLabelSave({ productId, endpoint, quotationEndpoint, optionId, view, cache,
    render: async plan => { await current(); const rendered = await (controls.render ?? renderDocument)(plan); await current(); return rendered; },
    // The existing helper's assertion is synchronous. Async account checks are
    // awaited by its scoped requests and renderer, never passed as void hooks.
    assertCurrent: checkSignal }, request);
   await current(); view = saved.view; completedOptions++; pendingSave = false;
  }
  return result('draft', `${completedOptions}개 포함 옵션의 표시사항 내용과 PNG를 저장하고 견적서에 연결했습니다. 상품과 대조해 내용을 검토해주세요.`);
 } catch (cause) {
  const prefix = savedTexts || completedOptions || pendingSave ? `초안 내용 저장 ${savedTexts}개 · PNG 연결 ${completedOptions}/${totalOptions}개를 확인했습니다. ` : '';
  const detail = cause instanceof Error ? cause.message : '표시사항 작업을 완료하지 못했습니다. 저장 결과를 확인해주세요.';
  return result(pendingSave || pendingDraft ? 'blocked' : cause instanceof LabelWorkError ? cause.status : 'failed', prefix + detail
   + (pendingSave ? ' 현재 옵션의 저장 결과가 미확인입니다. 자동 재요청하지 않았습니다.' : pendingDraft ? ' 현재 옵션의 AI 초안 생성 결과가 미확인입니다. 자동 재요청하지 않았습니다.' : ''));
 }
}
