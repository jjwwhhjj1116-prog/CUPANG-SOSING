'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { inspectPreservedProductRequest, PreservedProductInspectionError, type PreservedProductInspection, type PreservedProductPendingDiagnostic } from '@/app/preserved-product-request-client';
import { syncPreservedProductReceipt } from '@/app/preserved-product-receipt-client';
import type { ProductReceiptRecord } from '@/app/supplier-hub-product-receipt';

const states: Record<string, string> = {
  prepared: '전송 준비 기록', created: '문서 생성 확인', 'update-requested': '파일·본문 저장 결과 미확정', updated: '본문 저장 확인', validated: '단계 검증 완료',
  'validation-requested': '단계 검증 응답 미확정', 'validation-rejected': '단계 검증 반려',
  'submit-requested': '제출 요청됨 · 결과 조회 필요', pending: '접수 처리 중', accepted: '파일 처리 완료', rejected: '반려',
};

export function PreservedProductRequestInspector({ ownerId, onReceiptSaved }: { ownerId?: string; onReceiptSaved?: (productId: string) => void }) {
  const [productId, setProductId] = useState(''), [requestId, setRequestId] = useState(''), [docId, setDocId] = useState('');
  const [qvtRequestId, setQvtRequestId] = useState(''), [receipt, setReceipt] = useState<ProductReceiptRecord | null>(null);
  const [report, setReport] = useState<PreservedProductInspection | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [pendingDiagnostic, setPendingDiagnostic] = useState<PreservedProductPendingDiagnostic | null>(null);
  const active = useRef<AbortController | null>(null), epoch = useRef<object | null>(null);
  useLayoutEffect(() => { const token = {}; epoch.current = token; return () => { epoch.current = null; active.current?.abort(); active.current = null; }; }, [ownerId]);
  const [scope, setScope] = useState(ownerId);
  if (scope !== ownerId) { setScope(ownerId); setReport(null); setPendingDiagnostic(null); setError(''); setBusy(false); setProductId(''); setRequestId(''); setDocId(''); setQvtRequestId(''); setReceipt(null); }
  const changed = (set: (value: string) => void, value: string) => { active.current?.abort(); active.current = null; setBusy(false); setReport(null); setPendingDiagnostic(null); setReceipt(null); setError(''); set(value); };
  async function inspect() {
    if (busy || active.current || !ownerId || !epoch.current) return;
    const controller = new AbortController(), token = epoch.current; active.current = controller; setBusy(true); setReport(null); setPendingDiagnostic(null); setError('');
    const current = () => epoch.current === token && active.current === controller && !controller.signal.aborted;
    try {
      const result = await inspectPreservedProductRequest({ productId: productId.trim(), requestId: requestId.trim(), docId: Number(docId) }, ownerId, controller.signal);
      if (current()) { setReport(result); setPendingDiagnostic(result.pendingDiagnostic); }
    } catch (cause) { if (current()) { setPendingDiagnostic(cause instanceof PreservedProductInspectionError ? cause.pendingDiagnostic : null); setError(cause instanceof Error ? cause.message : '전송 기록을 확인하지 못했습니다.'); } }
    finally { if (current()) { active.current = null; setBusy(false); } }
  }
  async function syncReceipt() {
    if (busy || active.current || !ownerId || !epoch.current) return;
    const controller = new AbortController(), token = epoch.current; active.current = controller; setBusy(true); setReceipt(null); setError('');
    const current = () => epoch.current === token && active.current === controller && !controller.signal.aborted;
    try {
      const result = await syncPreservedProductReceipt({ productId: productId.trim(), requestId: requestId.trim(), docId: Number(docId), qvtRequestId: qvtRequestId.trim() }, ownerId, controller.signal);
      if (current()) { setReceipt(result); onReceiptSaved?.(result.productId); }
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : '기존 문서의 접수 결과를 확인하지 못했습니다.'); }
    finally { if (current()) { active.current = null; setBusy(false); } }
  }
  const checkpoint = report?.checkpoint;
  return <details className="preserved-request-inspector"><summary>보관된 전송 요청 확인</summary>
    <div className="panel-stack" style={{ paddingTop: 12 }}>
      <p>기존 문서를 다시 만들지 않고 이 Chrome에 남아 있는 원래 요청의 저장 기록을 확인합니다.</p>
      <div className="form-grid">
        <label className="field"><span>원래 상품 ID</span><input aria-label="보관 요청 상품 ID" value={productId} disabled={busy} onChange={event => changed(setProductId, event.target.value)} /></label>
        <label className="field"><span>원래 요청번호</span><input aria-label="보관 요청번호" value={requestId} disabled={busy} onChange={event => changed(setRequestId, event.target.value)} /></label>
        <label className="field"><span>Supplier Hub 문서번호</span><input aria-label="보관 문서번호" inputMode="numeric" value={docId} disabled={busy} onChange={event => changed(setDocId, event.target.value)} /></label>
      </div>
      <button type="button" className="btn ghost" disabled={busy || !ownerId || !productId.trim() || !requestId.trim() || !/^[1-9]\d*$/.test(docId)} onClick={() => void inspect()}>원래 전송 기록 조회</button>
      {busy && <p role="status">원래 요청·문서의 결과 확인 중</p>}
      {error && <p role="alert">{error}</p>}
      {pendingDiagnostic && <section aria-label="웹에 보관된 요청 연결"><p role="status">{pendingDiagnostic.message}</p>
        {pendingDiagnostic.requestId && <dl className="connection-list">
          <div><dt>웹 요청번호</dt><dd>{pendingDiagnostic.requestId}</dd></div>
          <div><dt>원래 요청과 비교</dt><dd>{pendingDiagnostic.sameRequest ? '같은 요청번호' : '다른 요청번호'}</dd></div>
          <div><dt>웹 기록 시각</dt><dd>{new Date(pendingDiagnostic.createdAt!).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST</dd></div>
        </dl>}
        <small>현재 웹 기록의 연결 진단입니다. 문서 저장·접수 확인이나 전송 재개 권한은 아닙니다.</small>
      </section>}
      {report && <section aria-label="보관 요청 확인 결과"><p role="status">{report.diagnostic.message}</p>
        {checkpoint && <dl className="connection-list">
          <div><dt>기존 문서</dt><dd>{String(checkpoint.docId)} · {report.target.company.name}</dd></div>
          <div><dt>마지막 기록</dt><dd>{states[checkpoint.state] ?? checkpoint.state} · 순서 {checkpoint.sequence}</dd></div>
          <div><dt>검증 단계</dt><dd>{checkpoint.validatedSteps.length}/4 · 포함 옵션 {checkpoint.membersCount}개</dd></div>
          <div><dt>기록 시각</dt><dd>{new Date(checkpoint.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST</dd></div>
        </dl>}
        {checkpoint && <details><summary>요청 연결 정보</summary><dl className="connection-list">
          <div><dt>원래 작업</dt><dd>{checkpoint.operationId ?? '기록 없음'}</dd></div>
          <div><dt>원래 검증 탭</dt><dd>{checkpoint.savedHubTabId === null ? '기록 없음' : String(checkpoint.savedHubTabId)}</dd></div>
          <div><dt>문서 단계</dt><dd>{checkpoint.preparedLifecycle ? '등록전송 단계' : '초안 저장·검증 단계'}</dd></div>
        </dl></details>}
        <small>확장에 남은 기록의 조회 결과입니다. Supplier Hub의 현재 저장·접수 상태를 확인한 결과와 구분합니다. 이 조회에서는 문서 생성·파일 저장·본문 업데이트·제출을 실행하지 않습니다.</small>
      </section>}
      <details><summary>이미 제출한 문서의 접수 결과 연결</summary>
        <div className="panel-stack" style={{ paddingTop: 12 }}>
          <label className="field"><span>등록 파일 번호(QVT)</span><input aria-label="보관 등록 파일 번호" value={qvtRequestId} disabled={busy} onChange={event => changed(setQvtRequestId, event.target.value)} /></label>
          <button type="button" className="btn primary" disabled={busy || !ownerId || !productId.trim() || !requestId.trim() || !/^[1-9]\d*$/.test(docId) || !qvtRequestId.trim()} onClick={() => void syncReceipt()}>기존 문서 접수 결과 동기화</button>
          {receipt && <p role="status">문서 {String(receipt.docId)} · 등록 파일 {String(receipt.receipt.qvtRequestId)} · {({ SUBMITTED: '접수 처리 중', FINISHED: '파일 처리 완료', REJECTED: '반려' })[receipt.receipt.sourceStatus]} · YOOFAM 목록에 반영했습니다.</p>}
          <small>열려 있는 같은 회사의 Supplier Hub에서 원래 문서의 결과만 조회합니다. 새 문서 생성·파일 업로드·본문 저장·제출은 하지 않습니다.</small>
        </div>
      </details>
    </div>
  </details>;
}
