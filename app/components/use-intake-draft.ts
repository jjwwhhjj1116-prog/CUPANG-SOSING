'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { confirmIntakeDraftSave, intakeDraftBody, readIntakeDraftResponse } from '@/app/intake-draft';
import type { IntakeRow } from '@/app/intake-queue';

export function useIntakeDraft() {
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [goal, setGoal] = useState('price');
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(true);
  const [loading, setLoading] = useState(true);
  const [autoPaused, setAutoPaused] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('상품 대기열 초안을 불러오는 중…');
  const revision = useRef<number | null>(null);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const unconfirmed = useRef<{ body: ReturnType<typeof intakeDraftBody>; generation: number } | null>(null);
  const load = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch('/api/intake-draft', { cache: 'no-store', signal: controller.signal });
      const result = await response.json() as { error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok) throw Error(result?.error || '초안을 불러오지 못했습니다.');
      const draft = readIntakeDraftResponse(result);
      revision.current = draft.revision; unconfirmed.current = null; setRows(draft.rows); setGoal(draft.goal); setDirty(false); setReady(true); setAutoPaused(false);
      generation.current++;
      setMessage(draft.updatedAt ? `임시저장 복구 · ${new Date(draft.updatedAt).toLocaleString('ko-KR')}` : '입력을 마치면 대기열이 자동 저장됩니다.');
    } catch (cause) { if (!controller.signal.aborted) setMessage(cause instanceof Error ? cause.message : '초안 조회 실패'); }
    finally { if (request.current === controller) request.current = null; if (!controller.signal.aborted) { setSaving(false); setLoading(false); } }
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
  const save = useCallback(async () => {
    if (request.current || revision.current === null) return;
    const controller = new AbortController(); request.current = controller; setSaving(true);
    const started = generation.current;
    let reconciling = false;
    const acknowledge = (savedGeneration: number, recovered = false) => {
      setAutoPaused(false);
      if (savedGeneration === generation.current) setDirty(false);
      setMessage(savedGeneration !== generation.current ? '이전 입력 저장 완료 · 최신 변경을 이어서 저장합니다.'
        : recovered ? '서버의 저장 결과를 확인해 복구했습니다.' : '자동저장 완료 · 접수 완료 행은 기존 수집 요청에 보관됩니다.');
    };
    const reconcile = async () => {
      const pending = unconfirmed.current;
      if (!pending) return null;
      const response = await fetch('/api/intake-draft', { cache: 'no-store', signal: controller.signal });
      const result = await response.json() as { error?: string };
      if (controller.signal.aborted) return null;
      if (!response.ok) throw Error(result?.error || '서버의 저장 결과를 조회하지 못했습니다.');
      const draft = readIntakeDraftResponse(result);
      if (draft.revision === pending.body.expectedRevision) { unconfirmed.current = null; return null; }
      confirmIntakeDraftSave(result, pending.body);
      revision.current = draft.revision; unconfirmed.current = null;
      return pending;
    };
    try {
      if (unconfirmed.current) {
        reconciling = true;
        const recovered = await reconcile();
        reconciling = false;
        if (controller.signal.aborted) return;
        if (recovered && recovered.generation === started) { acknowledge(recovered.generation, true); return; }
      }
      const body = intakeDraftBody(rows, goal, revision.current);
      unconfirmed.current = { body, generation: started };
      const response = await fetch('/api/intake-draft', { method: 'PUT', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok) throw Error(result?.error || '임시저장 실패');
      const draft = confirmIntakeDraftSave(result, body);
      revision.current = draft.revision; unconfirmed.current = null;
      acknowledge(started);
    } catch (cause) {
      if (controller.signal.aborted) return;
      let failure = cause;
      if (unconfirmed.current && !reconciling) {
        try {
          const recovered = await reconcile();
          if (controller.signal.aborted) return;
          if (recovered) { acknowledge(recovered.generation, true); return; }
        } catch (error) { failure = error; }
      }
      if (!controller.signal.aborted) { setAutoPaused(true); setMessage(`자동저장 일시중지 · ${failure instanceof Error ? failure.message : '임시저장 실패'}`); }
    }
    finally { if (request.current === controller) request.current = null; if (!controller.signal.aborted) setSaving(false); }
  }, [rows, goal]);
  useEffect(() => {
    if (!ready || !dirty || saving || autoPaused) return;
    const timer = window.setTimeout(() => { void save(); }, 1000);
    return () => window.clearTimeout(timer);
  }, [ready, dirty, saving, autoPaused, save]);
  return { rows, goal, ready, saving, loading, dirty, autoPaused, message, load: () => { if (!request.current) { setSaving(true); setLoading(true); void load(); } }, save,
    setRows: (update: (rows: IntakeRow[]) => IntakeRow[]) => { generation.current++; setDirty(true); setRows(update); },
    setGoal: (value: string) => { generation.current++; setDirty(true); setGoal(value); },
  };
}
