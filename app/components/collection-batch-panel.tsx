'use client';

import { useEffect, useRef, useState } from 'react';
import type { CollectionJob } from '@/app/sourcing';
import type { CollectionImportOutcome } from '@/app/collection-import';
import { importReceivedJobs, pendingReceivedJobs, linkedReceivedJobs } from '@/app/collection-batch';
import { registrationSteps, type CollectionEditorTab } from '@/app/registration-navigation';

export function CollectionBatchPanel({ jobs, onSaved, onOpenProduct }: { jobs: CollectionJob[]; onSaved: () => void; onOpenProduct?: (id: string, tab: CollectionEditorTab, signal: AbortSignal) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<CollectionJob[]>([]);
  const [results, setResults] = useState<Record<string, CollectionImportOutcome>>({});
  const [progress, setProgress] = useState<Record<string, string>>({});
  const active = useRef(false), stop = useRef(false), mounted = useRef(true);
  const navigation = useRef<AbortController | null>(null);
  const [opening, setOpening] = useState(false);
  const [navigationError, setNavigationError] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop.current = true; navigation.current?.abort(); }; }, []);
  async function openEditor(jobId: string, tab: CollectionEditorTab) {
    const productId = results[jobId]?.productId;
    if (!productId || !onOpenProduct || active.current) return;
    const controller = new AbortController(); navigation.current = controller;
    active.current = true; setOpening(true); setNavigationError('');
    try { await onOpenProduct(productId, tab, controller.signal); }
    catch (cause) { if (mounted.current && !controller.signal.aborted) setNavigationError(cause instanceof Error ? cause.message : '저장된 상품을 열지 못했습니다. 다시 시도해주세요.'); }
    finally { if (navigation.current === controller) { navigation.current = null; active.current = false; if (mounted.current) setOpening(false); } }
  }
  const pending = pendingReceivedJobs(jobs);
  const linked = linkedReceivedJobs(jobs);
  async function run(retry: boolean, recover = false) {
    if (active.current) return;
    const selected = retry ? items.filter(job => results[job.id]?.status !== 'completed') : recover ? linked : pending;
    if (!selected.length) return;
    active.current = true; stop.current = false; setBusy(true);
    if (!retry) { setItems(selected); setResults({}); setProgress({}); }
    try {
      await importReceivedJobs(selected, { fetcher: fetch, shouldStop: () => stop.current,
        onProgress: (id, message) => { if (mounted.current) { setProgress(previous => ({ ...previous, [id]: message })); setResults(previous => { const next = { ...previous }; delete next[id]; return next; }); } },
        onResult: (id, result) => { if (mounted.current) setResults(previous => ({ ...previous, [id]: result })); },
      });
    } finally {
      active.current = false;
      if (mounted.current) { setBusy(false); onSaved(); }
    }
  }
  return <div className="collection-receipt">
    <button type="button" className="btn primary" disabled={busy || opening || !pending.length} onClick={() => void run(false)}>수신 완료 {pending.length}건 상품·이미지 일괄 반영</button>
    <button type="button" className="btn ghost" disabled={busy || opening || !linked.length} onClick={() => void run(false, true)}>이미 저장된 {linked.length}건 누락 이미지 다시 반영</button>
    <small>새로고침 전에 중단된 이미지 작업도 다시 실행할 수 있습니다. 기존 상품·저장 이미지는 재사용하며 직접 제외한 원본은 건너뜁니다. 저장 여유 안에서 원본 이미지를 추가하므로 파일 저장 공간을 사용합니다.</small>
    <p>이미 도착한 원문을 상품·옵션으로 저장하고, 저장 여유 안에서 대표·옵션·추가·상세 이미지를 순서대로 반영합니다. 번역과 Supplier Hub 등록은 별도 단계입니다.</p>
    {!!items.length && <><ul>{items.map(job => <li key={job.id}>
      <a href={job.source_url} target="_blank" rel="noreferrer" style={{ overflowWrap: 'anywhere' }}>{job.source_url}</a>
      <small>{job.context?.category.categoryPath.join(' > ')}</small>
      <p role="status">{results[job.id] ? `${results[job.id].status === 'completed' ? '반영 완료' : results[job.id].status === 'stopped' ? '중단' : '실패'} · 이미지 ${results[job.id].completedImages}개 저장 확인 · ${results[job.id].error ?? ''}` : busy ? progress[job.id] ?? '실행 대기' : '중단 · 재시도 가능'}</p>
      {results[job.id]?.warnings?.map((warning, index) => <p key={index}>{warning}</p>)}
      {results[job.id]?.productId && onOpenProduct && <div className="collection-editor-actions"><p>저장된 상품에서 다음 작업을 이어가세요. 이미지 일부가 실패해도 저장된 상품을 편집할 수 있습니다.</p><nav aria-label={`${job.offer_id} 상품 등록 7단계`}>{registrationSteps.map((step, index) => <button type="button" className="btn ghost" key={step} disabled={busy || opening} onClick={() => void openEditor(job.id, step as CollectionEditorTab)}>{`${index + 1}. ${step}`}</button>)}</nav></div>}
    </li>)}</ul><button type="button" className="btn ghost" disabled={busy || opening || items.every(job => results[job.id]?.status === 'completed')} onClick={() => void run(true)}>미완료 항목만 재시도</button></>}
    {opening && <p role="status">최신 상품을 불러오는 중…</p>}
    {navigationError && <p role="alert">{navigationError}</p>}
    {busy && <button type="button" className="btn ghost" onClick={() => { stop.current = true; }}>현재 저장 후 중단</button>}
  </div>;
}
