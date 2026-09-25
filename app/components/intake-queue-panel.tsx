'use client';
import { useEffect, useRef, useState } from 'react';
import { CategoryPicker } from '@/app/components/category-picker';
import { intakeRow, submitIntakeQueue, type IntakeRow } from '@/app/intake-queue';
import { collectionBlock, type CollectionJob } from '@/app/sourcing';
import type { CategoryProfile } from '@/app/category-profiles';
import type { CategoryAdvancedSeed } from '@/app/category-catalog';
import { IntakeQuotationPreview } from '@/app/components/intake-quotation-preview';

export function IntakeQueuePanel({ rows, onRows, profiles, onProfile, onAdvanced, onJobs, onBusy, goal, onGoal }: {
  rows: IntakeRow[]; onRows: (update: (rows: IntakeRow[]) => IntakeRow[]) => void;
  profiles: CategoryProfile[]; onProfile: (profile: CategoryProfile) => void;
  onAdvanced: (seed?: CategoryAdvancedSeed) => void; onJobs: (jobs: CollectionJob[]) => void; onBusy: (busy: boolean) => void;
  goal: string; onGoal: (goal: string) => void;
}) {
  const [categoryTarget, setCategoryTarget] = useState<string | null>(rows.length ? null : 'new');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewRow = rows.find(row => row.id === previewId);
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);
  const pending = rows.filter(row => row.status !== 'saved').length;
  function edit(id: string, patch: Partial<IntakeRow>) {
    if (running.current) return;
    onRows(previous => previous.map(row => row.id === id ? { ...row, ...patch, status: 'draft', message: '' } : row));
  }
  async function submit() {
    if (running.current || !pending) return;
    const controller = new AbortController(); running.current = controller; setBusy(true); onBusy(true); setError('');
    try {
      await submitIntakeQueue(rows, goal, { signal: controller.signal, fetcher: fetch,
        onRow: (id, patch) => onRows(previous => previous.map(row => row.id === id ? { ...row, ...patch } : row)), onJobs });
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '입력 내용을 확인해주세요.'); }
    finally { running.current = null; if (!controller.signal.aborted) { setBusy(false); onBusy(false); } }
  }
  if (categoryTarget) return <div><button type="button" className="btn ghost" onClick={() => setCategoryTarget(null)}>← 상품 대기열</button><CategoryPicker profiles={profiles} selectedId={rows.find(row => row.id === categoryTarget)?.profile.id ?? ''} onAdvanced={onAdvanced} onSelected={profile => {
    onProfile(profile);
    if (categoryTarget === 'new') onRows(previous => previous.length < 50 ? [...previous, intakeRow(profile, crypto.randomUUID())] : previous);
    else edit(categoryTarget, { profile });
    setCategoryTarget(null);
  }} /></div>;
  return <div className="modal-form intake-queue">
    <div className="intake-queue-table"><table><thead><tr><th>카테고리</th><th>1688 링크</th><th>특징</th><th>키워드</th><th>상태</th><th>관리</th></tr></thead><tbody>
      {rows.map((row, index) => <tr key={row.id}>
        <td><button type="button" className="intake-category-button" disabled={busy || row.status === 'saved'} onClick={() => setCategoryTarget(row.id)}>{row.profile.categoryPath.join(' > ')}</button><small className="intake-profile-summary">코드 {row.profile.categoryId || '미입력'} · v{row.profile.revision}<br/>{row.profile.template ? `양식: ${row.profile.template.name}` : 'Excel 양식 미연결'}</small><button type="button" className="btn ghost" aria-expanded={previewId === row.id} onClick={() => setPreviewId(previewId === row.id ? null : row.id)}>견적 항목·양식 확인</button></td>
        <td><input aria-label={`${index + 1}번째 1688 링크`} value={row.url} maxLength={2048} disabled={busy || row.status === 'saved'} placeholder="https://detail.1688.com/offer/…" onChange={event => edit(row.id, { url: event.target.value })} /></td>
        <td><textarea aria-label={`${index + 1}번째 특징`} value={row.features} maxLength={2000} disabled={busy || row.status === 'saved'} placeholder="상품 특징" onChange={event => edit(row.id, { features: event.target.value })} /></td>
        <td><textarea aria-label={`${index + 1}번째 키워드`} value={row.keywords} maxLength={2000} disabled={busy || row.status === 'saved'} placeholder="타겟 키워드" onChange={event => edit(row.id, { keywords: event.target.value })} /></td>
        <td role="status" className={row.status === 'error' ? 'collection-error' : ''}>{row.message || '입력 대기'}</td>
        <td><button type="button" className="btn ghost" disabled={busy || rows.length >= 50} onClick={() => onRows(previous => [...previous, { ...intakeRow(row.profile, crypto.randomUUID()), features: row.features, keywords: row.keywords }])}>복제</button><button type="button" className="btn ghost" disabled={busy} onClick={() => onRows(previous => previous.filter(item => item.id !== row.id))}>행 삭제</button></td>
      </tr>)}
    </tbody></table>{!rows.length && <p className="collection-empty">대기열이 비어있습니다. [+ 상품 추가] 버튼으로 카테고리를 선택해주세요.</p>}</div>
    {previewRow && <div><button type="button" className="btn ghost" onClick={() => setPreviewId(null)}>견적 연결 미리보기 닫기</button><IntakeQuotationPreview profile={previewRow.profile}/></div>}
    <fieldset className="goal-list" disabled={busy}><legend>어디까지 진행할까요?</legend>{[
      ['collect', '상품추가', '원문·옵션·가격 수집을 요청합니다.'], ['price', 'SEO+가격', '수집 후 번역·가격 단계까지의 작업 목표를 저장합니다.'],
      ['work', '작업개시', '이미지·한글표시사항·견적서까지의 작업 목표를 저장합니다.'], ['transmit', '등록전송', '최종 등록 목표를 저장합니다. 현재 실제 전송은 연결되지 않았습니다.'],
    ].map(([id, title, description]) => <label className="goal-card" key={id}><input type="radio" name="queue-goal" checked={goal === id} onChange={() => onGoal(id)} /><span><strong>{title}</strong><small>{description}</small></span></label>)}</fieldset>
    <p className="collection-notice">{collectionBlock}</p><small>복제는 카테고리·특징·키워드를 복사하며 새 URL을 입력해야 합니다. 행 삭제는 이 입력 목록만 지우며 서버에 저장한 요청을 취소하지 않습니다.</small>
    {error && <p role="alert" className="collection-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="btn ghost" disabled={busy || rows.length >= 50} onClick={() => setCategoryTarget('new')}>＋ 상품 추가</button><button type="button" className="btn primary" disabled={busy || !pending} onClick={() => void submit()}>{busy ? '요청 저장 중…' : `전체 요청 저장 (${pending}건)`}</button></div>
  </div>;
}
