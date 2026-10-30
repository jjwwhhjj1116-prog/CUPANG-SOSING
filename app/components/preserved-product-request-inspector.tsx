'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { inspectPreservedProductRequest, type PreservedProductInspection } from '@/app/preserved-product-request-client';

const states: Record<string, string> = {
  prepared: '전송 준비 기록', created: '문서 생성 확인', updated: '본문 저장 확인', validated: '단계 검증 완료',
  'validation-requested': '단계 검증 응답 미확정', 'validation-rejected': '단계 검증 반려',
  'submit-requested': '제출 요청됨 · 결과 조회 필요', pending: '접수 처리 중', accepted: '파일 처리 완료', rejected: '반려',
};

export function PreservedProductRequestInspector({ ownerId }: { ownerId?: string }) {
  const [productId, setProductId] = useState(''), [requestId, setRequestId] = useState(''), [docId, setDocId] = useState('');
  const [report, setReport] = useState<PreservedProductInspection | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null), epoch = useRef<object | null>(null);
  useLayoutEffect(() => { const token = {}; epoch.current = token; return () => { epoch.current = null; active.current?.abort(); active.current = null; }; }, [ownerId]);
  const [scope, setScope] = useState(ownerId);
  if (scope !== ownerId) { setScope(ownerId); setReport(null); setError(''); setBusy(false); setProductId(''); setRequestId(''); setDocId(''); }
  const changed = (set: (value: string) => void, value: string) => { active.current?.abort(); active.current = null; setBusy(false); setReport(null); setError(''); set(value); };
  async function inspect() {
    if (busy || active.current || !ownerId || !epoch.current) return;
    const controller = new AbortController(), token = epoch.current; active.current = controller; setBusy(true); setReport(null); setError('');
    const current = () => epoch.current === token && active.current === controller && !controller.signal.aborted;
    try {
      const result = await inspectPreservedProductRequest({ productId: productId.trim(), requestId: requestId.trim(), docId: Number(docId) }, ownerId, controller.signal);
      if (current()) setReport(result);
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : '전송 기록을 확인하지 못했습니다.'); }
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
      {busy && <p role="status">원래 요청 기록 확인 중</p>}
      {error && <p role="alert">{error}</p>}
      {report && <section aria-label="보관 요청 확인 결과"><p role="status">{report.diagnostic.message}</p>
        {checkpoint && <dl className="connection-list">
          <div><dt>기존 문서</dt><dd>{String(checkpoint.docId)} · {report.target.company.name}</dd></div>
          <div><dt>마지막 기록</dt><dd>{states[checkpoint.state] ?? checkpoint.state} · 순서 {checkpoint.sequence}</dd></div>
          <div><dt>검증 단계</dt><dd>{checkpoint.validatedSteps.length}/4 · 포함 옵션 {checkpoint.membersCount}개</dd></div>
          <div><dt>기록 시각</dt><dd>{new Date(checkpoint.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST</dd></div>
        </dl>}
        <small>확장에 남은 기록의 조회 결과입니다. Supplier Hub의 현재 저장·접수 상태를 확인한 결과와 구분합니다. 이 조회에서는 문서 생성·파일 저장·본문 업데이트·제출을 실행하지 않습니다.</small>
      </section>}
    </div>
  </details>;
}
