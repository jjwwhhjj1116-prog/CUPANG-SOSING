import { readSingleCatalogContext } from '@/app/supplier-hub-single-client';
import { exchange } from '@/app/supplier-hub-handoff';
import { readProductDocumentPending } from '@/app/supplier-hub-product-pending';
import { validatePreservedProductInspectionTarget, validatePreservedProductInspectionResult } from '../extensions/supplier-hub/preserved-product-checkpoint.mjs';

export type PreservedProductPendingDiagnostic = Readonly<{
  status: 'absent' | 'unreadable' | 'same-request' | 'different-request';
  requestId: string | null; createdAt: number | null; sameRequest: boolean | null; message: string;
}>;
export type PreservedProductInspection = ReturnType<typeof validatePreservedProductInspectionResult> & { pendingDiagnostic: PreservedProductPendingDiagnostic };

/** Diagnostic metadata does not authorize resuming or replacing an operation. */
export class PreservedProductInspectionError extends Error {
  constructor(message: string, readonly pendingDiagnostic: PreservedProductPendingDiagnostic) { super(message); this.name = 'PreservedProductInspectionError'; }
}
type Selection = { requestId: string; productId: string; docId: string | number };
const ORIGINS = ['https://sourceflow.jjwwhhjj1116.workers.dev', 'http://localhost:3000', 'http://127.0.0.1:3000'];

/** Read the original extension checkpoint only. This entry has no write action. */
export async function inspectPreservedProductRequest(selection: Selection, ownerId: string, signal: AbortSignal): Promise<PreservedProductInspection> {
  if (!ORIGINS.includes(window.location.origin) || signal.aborted) throw Error('원래 YOOFAM 작업 창에서 전송 기록을 확인해주세요.');
  const before = await readSingleCatalogContext(signal);
  if (before.ownerId !== ownerId) throw Error('현재 로그인 회원이 달라졌습니다. 전송 기록을 다시 확인해주세요.');
  const target = validatePreservedProductInspectionTarget({ ...selection, company: before.company });
  signal.throwIfAborted();
  // Read only this authenticated member/company/product's small web descriptor.
  // Project no body, hashes, tab identity, approval or execution capability.
  let pendingDiagnostic: PreservedProductPendingDiagnostic;
  try {
    const pending = readProductDocumentPending({ identity: { ownerId, productId: target.productId, company: before.company } });
    pendingDiagnostic = Object.freeze(pending ? {
      status: pending.requestId === target.requestId ? 'same-request' : 'different-request', requestId: pending.requestId, createdAt: pending.createdAt,
      sameRequest: pending.requestId === target.requestId,
      message: pending.requestId === target.requestId ? '웹에 보관된 요청번호가 원래 요청과 같습니다. 문서·원본·저장 결과는 추가 확인이 필요합니다.' : '웹에는 다른 요청번호가 보관되어 있습니다. 원래 요청으로 바꾸거나 새 문서를 만들지 않았습니다.',
    } : { status: 'absent', requestId: null, createdAt: null, sameRequest: null, message: '이 회원·회사·상품의 웹 전송 요청 기록이 없습니다. 확장의 원래 문서 기록과 구분해 확인해야 합니다. 새 요청을 만들지 않았습니다.' });
  } catch {
    pendingDiagnostic = Object.freeze({ status: 'unreadable', requestId: null, createdAt: null, sameRequest: null, message: '웹 요청 기록을 읽지 못했거나 저장 형식이 맞지 않습니다. 보관 기록은 변경하지 않았습니다.' });
  }
  const assertCurrent = async () => {
    if (signal.aborted) throw Error('전송 기록 확인을 취소했습니다.');
    const after = await readSingleCatalogContext(signal);
    if (signal.aborted || after.ownerId !== ownerId || after.ownerId !== before.ownerId || after.company.code !== before.company.code || after.company.name !== before.company.name) throw Error('조회 중 로그인 회원·회사가 달라졌습니다. 이전 조회 결과를 적용하지 않았습니다.');
  };
  let report: ReturnType<typeof validatePreservedProductInspectionResult>;
  try {
  signal.throwIfAborted();
  // Older installed workers ignore this read-only command. Check their actual
  // advertised capability before creating a 30-second orphaned request.
  const capability = await exchange('PING', null, signal);
  signal.throwIfAborted();
  const version = capability.version;
  if (typeof version !== 'string' || !/^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){2}$/.test(version)
    || version.split('.').some(part => Number(part) > 65535)) throw Error('현재 Chrome 확장의 설치 버전을 확인하지 못했습니다. 최신 통합 확장을 적용하고 YOOFAM 웹을 새로고침해주세요. 문서 저장·전송은 요청하지 않았습니다.');
  if (capability.preservedProductCheckpointInspection !== true || version.localeCompare('2.1.60', 'en', { numeric: true }) < 0)
    throw Error(`현재 Chrome 확장 ${version}은 원래 전송 기록 조회를 지원하지 않습니다. 기존 통합 확장을 최신 버전으로 새로고침한 뒤 YOOFAM 웹도 새로고침해주세요. 문서 저장·전송은 요청하지 않았습니다.`);
  const result = await new Promise<unknown>((resolve, reject) => {
    if (signal.aborted) { reject(Error('전송 기록 확인을 취소했습니다.')); return; }
    const requestId = crypto.randomUUID();
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(Error('전송 기록 확인을 취소했습니다.')); };
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.channel !== 'YOOFAM_HUB_HANDOFF_RESULT' || event.data.requestId !== requestId) return;
      cleanup();
      const envelope = event.data.result;
      if (!envelope || envelope.ok !== true || !Object.hasOwn(envelope, 'result')) {
        reject(Error(typeof envelope?.error === 'string' && envelope.error.length <= 2000 ? envelope.error : '확장에 보관된 전송 기록을 읽지 못했습니다.'));
      } else resolve(envelope.result);
    };
    const timer = setTimeout(() => { cleanup(); reject(Error('확장 응답이 없습니다. 확장 연결과 설치 버전을 확인해주세요. 문서 저장·전송은 요청하지 않았습니다.')); }, 30000);
    window.addEventListener('message', receive); signal.addEventListener('abort', abort, { once: true });
    try { window.postMessage({ channel: 'YOOFAM_HUB_HANDOFF', requestId, type: 'PRESERVED_PRODUCT_DOCUMENT', payload: { action: 'inspect', target } }, window.location.origin); }
    catch { cleanup(); reject(Error('확장에 전송 기록 조회를 전달하지 못했습니다.')); }
  });
    report = validatePreservedProductInspectionResult(result, target);
  } catch (cause) {
    // Even an unsupported worker can return the local diagnosis, but only after
    // the same authenticated actor is rechecked. Abort/scope changes show none.
    await assertCurrent();
    throw new PreservedProductInspectionError(cause instanceof Error ? cause.message : '확장에 보관된 전송 기록을 읽지 못했습니다.', pendingDiagnostic);
  }
  await assertCurrent();
  return { ...report, pendingDiagnostic };
}
