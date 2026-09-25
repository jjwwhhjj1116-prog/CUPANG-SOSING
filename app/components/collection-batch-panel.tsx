'use client';

import { useEffect, useRef, useState } from 'react';
import type { CollectionJob } from '@/app/sourcing';
import type { CollectionImportOutcome } from '@/app/collection-import';
import { importReceivedJobs, pendingReceivedJobs } from '@/app/collection-batch';

export function CollectionBatchPanel({ jobs, onSaved }: { jobs: CollectionJob[]; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<CollectionJob[]>([]);
  const [results, setResults] = useState<Record<string, CollectionImportOutcome>>({});
  const [progress, setProgress] = useState<Record<string, string>>({});
  const active = useRef(false), stop = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop.current = true; }; }, []);
  const pending = pendingReceivedJobs(jobs);
  async function run(retry: boolean) {
    if (active.current) return;
    const selected = retry ? items.filter(job => results[job.id]?.status !== 'completed') : pending;
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
    <button type="button" className="btn primary" disabled={busy || !pending.length} onClick={() => void run(false)}>수신 완료 {pending.length}건 상품·이미지 일괄 반영</button>
    <p>이미 도착한 원문을 상품·옵션으로 저장하고, 저장 여유 안에서 대표·옵션·추가·상세 이미지를 순서대로 반영합니다. 번역과 Supplier Hub 등록은 별도 단계입니다.</p>
    {!!items.length && <><ul>{items.map(job => <li key={job.id}>
      <a href={job.source_url} target="_blank" rel="noreferrer" style={{ overflowWrap: 'anywhere' }}>{job.source_url}</a>
      <small>{job.context?.category.categoryPath.join(' > ')}</small>
      <p role="status">{results[job.id] ? `${results[job.id].status === 'completed' ? '반영 완료' : results[job.id].status === 'stopped' ? '중단' : '실패'} · 이미지 ${results[job.id].completedImages}개 저장 확인 · ${results[job.id].error ?? ''}` : busy ? progress[job.id] ?? '실행 대기' : '중단 · 재시도 가능'}</p>
      {results[job.id]?.warnings?.map((warning, index) => <p key={index}>{warning}</p>)}
    </li>)}</ul><button type="button" className="btn ghost" disabled={busy || items.every(job => results[job.id]?.status === 'completed')} onClick={() => void run(true)}>미완료 항목만 재시도</button></>}
    {busy && <button type="button" className="btn ghost" onClick={() => { stop.current = true; }}>현재 저장 후 중단</button>}
  </div>;
}
