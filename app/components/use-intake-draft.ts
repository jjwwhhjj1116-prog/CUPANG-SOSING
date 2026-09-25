'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { intakeDraftBody, type IntakeDraft } from '@/app/intake-draft';
import type { IntakeRow } from '@/app/intake-queue';

export function useIntakeDraft() {
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [goal, setGoal] = useState('price');
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('상품 대기열 초안을 불러오는 중…');
  const revision = useRef<number | null>(null);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch('/api/intake-draft', { cache: 'no-store', signal: controller.signal });
      const result = await response.json() as { draft?: IntakeDraft; error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok || !result.draft) throw Error(result.error || '초안을 불러오지 못했습니다.');
      revision.current = result.draft.revision; setRows(result.draft.rows); setGoal(result.draft.goal); setDirty(false); setReady(true);
      generation.current++;
      setMessage(result.draft.updatedAt ? `임시저장 복구 · ${new Date(result.draft.updatedAt).toLocaleString('ko-KR')}` : '새 상품 대기열입니다. 작성 후 임시저장을 눌러주세요.');
    } catch (cause) { if (!controller.signal.aborted) setMessage(cause instanceof Error ? cause.message : '초안 조회 실패'); }
    finally { if (request.current === controller) request.current = null; if (!controller.signal.aborted) setSaving(false); }
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void load(); });
    return () => { active = false; request.current?.abort(); request.current = null; };
  }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function save() {
    if (request.current || revision.current === null) return;
    const controller = new AbortController(); request.current = controller; setSaving(true);
    const started = generation.current;
    try {
      const response = await fetch('/api/intake-draft', { method: 'PUT', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(intakeDraftBody(rows, goal, revision.current)) });
      const result = await response.json() as { draft?: IntakeDraft; error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok || !result.draft) throw Error(result.error || '임시저장 실패');
      revision.current = result.draft.revision;
      if (started === generation.current) setDirty(false);
      setMessage(started === generation.current ? '계정에 임시저장했습니다. 접수 완료 행은 기존 수집 요청에 보관됩니다.' : '이전 입력을 저장했습니다. 방금 수정한 내용은 다시 저장해주세요.');
    } catch (cause) { if (!controller.signal.aborted) setMessage(cause instanceof Error ? cause.message : '임시저장 실패'); }
    finally { if (request.current === controller) request.current = null; if (!controller.signal.aborted) setSaving(false); }
  }
  return { rows, goal, ready, saving, dirty, message, load: () => { if (!request.current) { setSaving(true); void load(); } }, save,
    setRows: (update: (rows: IntakeRow[]) => IntakeRow[]) => { generation.current++; setDirty(true); setRows(update); },
    setGoal: (value: string) => { generation.current++; setDirty(true); setGoal(value); },
  };
}
